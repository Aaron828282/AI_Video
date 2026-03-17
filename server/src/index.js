const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const crypto = require("crypto");
const net = require("net");
const tls = require("tls");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const { loadProducts, saveProducts } = require("./store");
const {
  loadCategories,
  saveCategories,
  syncCategories,
  loadImageKnowledgeBase,
  saveImageKnowledgeBase,
  ensureKnowledgeCategory,
  findKnowledgeItemById,
  recalcCategoryTotalLength,
  normalizeCompressedKnowledge,
  toKnowledgeSummary,
  FALLBACK_CATEGORY_ID
} = require("./image-knowledge-base-store");
const {
  analyzeProduct,
  identifyProductCategory,
  analyzeKnowledgeReferenceImage,
  compressCategoryKnowledge,
  createJobId,
  sanitizeAnalysisResult,
  sanitizeCategoryRecognitionResult,
  sanitizePromptGenerationResult,
  generatePromptPack,
  generateSecondStagePromptPack,
  CLAUDE_MODEL_SONNET
} = require("./analysis");

const app = express();
const PORT = Number(process.env.PORT || 8790);
const configuredDataDir = String(process.env.DATA_DIR || "").trim();
const DATA_DIR = configuredDataDir ? path.resolve(configuredDataDir) : path.join(__dirname, "..", "data");
const WEB_DIST_DIR = path.join(__dirname, "..", "..", "web", "dist");
const WEB_INDEX_FILE = path.join(WEB_DIST_DIR, "index.html");
const HAS_WEB_DIST = fsSync.existsSync(WEB_INDEX_FILE);
const rawAnalysisConcurrency = Number(process.env.ANALYSIS_CONCURRENCY || 4);
const ANALYSIS_CONCURRENCY = Number.isFinite(rawAnalysisConcurrency)
  ? Math.max(1, Math.min(16, Math.floor(rawAnalysisConcurrency)))
  : 4;
const rawKnowledgeAnalysisConcurrency = Number(process.env.KB_ANALYSIS_CONCURRENCY || 2);
const KB_ANALYSIS_CONCURRENCY = Number.isFinite(rawKnowledgeAnalysisConcurrency)
  ? Math.max(1, Math.min(8, Math.floor(rawKnowledgeAnalysisConcurrency)))
  : 2;
const CATEGORY_CONFIDENCE_THRESHOLD = Number.isFinite(Number(process.env.CATEGORY_CONFIDENCE_THRESHOLD))
  ? Math.max(0.1, Math.min(0.99, Number(process.env.CATEGORY_CONFIDENCE_THRESHOLD)))
  : 0.68;
const KB_CATEGORY_MAX_CONTENT_LENGTH = Number.isFinite(Number(process.env.KB_CATEGORY_MAX_CONTENT_LENGTH))
  ? Math.max(2000, Math.floor(Number(process.env.KB_CATEGORY_MAX_CONTENT_LENGTH)))
  : 26000;
const ANALYSIS_IMAGE_DIR = path.join(DATA_DIR, "analysis-images");
const KB_IMAGE_DIR = path.join(DATA_DIR, "knowledge-base-images");
const MANUAL_PRODUCT_IMAGE_DIR = path.join(DATA_DIR, "manual-product-images");
const DOWNLOADS_DIR = path.join(__dirname, "..", "..", "downloads");
const STATIC_PUBLIC_DIRS = new Set(["analysis-images", "knowledge-base-images", "manual-product-images"]);
const SECOND_PROMPT_TEMPLATE_FILE = path.join(__dirname, "templates", "prompt-template-v2.1.md");
const VIDEO_PROMPT_SPEC_FILE = path.join(__dirname, "templates", "ai-video-generation-v2.1.md");
const API_KEY_SETTINGS_FILE = path.join(DATA_DIR, "api-key-settings.json");
const rawDefaultManagerPassword = String(process.env.API_KEY_PAGE_DEFAULT_PASSWORD || "12345678");
const API_KEY_PAGE_DEFAULT_PASSWORD = rawDefaultManagerPassword.length >= 8 ? rawDefaultManagerPassword : "12345678";
const API_KEY_RESET_EMAIL = "haowenjiang75@gmail.com";
const API_KEY_RESET_CODE_TTL_MS = 5 * 60 * 1000;
const API_KEY_RESET_VERIFIED_TTL_MS = 5 * 60 * 1000;
const API_KEY_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RESET_EMAIL_SMTP_HOST = String(process.env.RESET_EMAIL_SMTP_HOST || "").trim();
const RESET_EMAIL_SMTP_PORT = Number(process.env.RESET_EMAIL_SMTP_PORT || 465);
const RESET_EMAIL_SMTP_SECURE = String(process.env.RESET_EMAIL_SMTP_SECURE || "true")
  .trim()
  .toLowerCase() !== "false";
const RESET_EMAIL_SMTP_USER = String(process.env.RESET_EMAIL_SMTP_USER || "").trim();
const RESET_EMAIL_SMTP_PASS = String(process.env.RESET_EMAIL_SMTP_PASS || "").trim();
const RESET_EMAIL_FROM = String(process.env.RESET_EMAIL_FROM || RESET_EMAIL_SMTP_USER).trim();
const RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS = Number.isFinite(Number(process.env.RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS))
  ? Math.max(5000, Math.min(120000, Math.floor(Number(process.env.RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS))))
  : 25000;
const RESET_EMAIL_SMTP_RESPONSE_TIMEOUT_MS = Number.isFinite(Number(process.env.RESET_EMAIL_SMTP_RESPONSE_TIMEOUT_MS))
  ? Math.max(5000, Math.min(120000, Math.floor(Number(process.env.RESET_EMAIL_SMTP_RESPONSE_TIMEOUT_MS))))
  : 30000;
const RESET_EMAIL_SMTP_AUTO_FALLBACK = String(process.env.RESET_EMAIL_SMTP_AUTO_FALLBACK || "true")
  .trim()
  .toLowerCase() !== "false";
const rawResetEmailSmtpFamily = Number(process.env.RESET_EMAIL_SMTP_FAMILY || 0);
const RESET_EMAIL_SMTP_FAMILY = rawResetEmailSmtpFamily === 4 || rawResetEmailSmtpFamily === 6 ? rawResetEmailSmtpFamily : 0;
const FIXED_CHAT_COMPLETIONS_API_URL = "https://api.vectorengine.ai/v1/chat/completions";
const FIXED_SHORT_VIDEO_CREATE_API_URL = "https://api.vectorengine.ai/v1/video/create";
const FIXED_SHORT_VIDEO_QUERY_API_URL = "https://api.vectorengine.ai/v1/video/query";
const FIXED_FIRST_PASS_MODEL = "gemini-2.5-flash-lite-thinking";
const FIXED_PROMPT_PACK_MODEL = "gemini-3-flash-preview";
const FIXED_SHORT_VIDEO_PROMPT_MODEL = "gpt-5.3-codex-low";
const FIXED_SHORT_VIDEO_RENDER_MODEL = "veo_3_1-fast-4K";
const FIXED_SHORT_VIDEO_BASE_API_URL = "https://api.vectorengine.ai";
const DEFAULT_UNIFIED_API_KEY = String(
  process.env.UNIFIED_API_KEY ||
    process.env.FIRST_PASS_ANALYSIS_API_KEY ||
    process.env.SECOND_STAGE_PROMPT_API_KEY ||
    process.env.SHORT_VIDEO_PROMPT_API_KEY ||
    process.env.SHORT_VIDEO_RENDER_API_KEY ||
    process.env.SHORT_VIDEO_API_KEY ||
    process.env.VECTORENGINE_API_KEY ||
    process.env.VECTORENGINE_SECOND_STAGE_API_KEY ||
    process.env.COZE_API_TOKEN ||
    process.env.COZE_AUTH_TOKEN ||
    process.env.VEO_API_KEY ||
    process.env.GEMINI_FLASH_LITE_THINKING_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
).trim();
const DEFAULT_FIRST_PASS_API_KEY = DEFAULT_UNIFIED_API_KEY;
const DEFAULT_PROMPT_PACK_API_KEY = DEFAULT_UNIFIED_API_KEY;
const DEFAULT_COZE_WORKFLOW_API_URL = String(process.env.COZE_WORKFLOW_API_URL || "https://rqmnzsj4gn.coze.site/run").trim();
const DEFAULT_SHORT_VIDEO_API_KEY = DEFAULT_UNIFIED_API_KEY;
const DEFAULT_SHORT_VIDEO_PROMPT_API_KEY = DEFAULT_UNIFIED_API_KEY;
const DEFAULT_SHORT_VIDEO_RENDER_API_KEY = DEFAULT_UNIFIED_API_KEY;
const COZE_REQUEST_TIMEOUT_MS = Number.isFinite(Number(process.env.COZE_REQUEST_TIMEOUT_MS))
  ? Math.max(30000, Math.min(900000, Math.floor(Number(process.env.COZE_REQUEST_TIMEOUT_MS))))
  : 420000;
const SHORT_VIDEO_PROMPT_API_URL = FIXED_CHAT_COMPLETIONS_API_URL;
const SHORT_VIDEO_PROMPT_TIMEOUT_MS = 30 * 60 * 1000;
const SHORT_VIDEO_PROMPT_MAX_TOKENS = Number.isFinite(Number(process.env.SHORT_VIDEO_PROMPT_MAX_TOKENS))
  ? Math.max(1200, Math.min(12000, Math.floor(Number(process.env.SHORT_VIDEO_PROMPT_MAX_TOKENS))))
  : 7600;
const SHORT_VIDEO_PROMPT_TEMPERATURE = Number.isFinite(Number(process.env.SHORT_VIDEO_PROMPT_TEMPERATURE))
  ? Math.max(0, Math.min(1.2, Number(process.env.SHORT_VIDEO_PROMPT_TEMPERATURE)))
  : 0.2;
const SHORT_VIDEO_CREATE_API_URL = FIXED_SHORT_VIDEO_CREATE_API_URL;
const SHORT_VIDEO_QUERY_API_URL = FIXED_SHORT_VIDEO_QUERY_API_URL;
const SHORT_VIDEO_CREATE_TIMEOUT_MS = Number.isFinite(Number(process.env.SHORT_VIDEO_CREATE_TIMEOUT_MS))
  ? Math.max(15000, Math.min(300000, Math.floor(Number(process.env.SHORT_VIDEO_CREATE_TIMEOUT_MS))))
  : 60000;
const SHORT_VIDEO_QUERY_TIMEOUT_MS = Number.isFinite(Number(process.env.SHORT_VIDEO_QUERY_TIMEOUT_MS))
  ? Math.max(10000, Math.min(180000, Math.floor(Number(process.env.SHORT_VIDEO_QUERY_TIMEOUT_MS))))
  : 30000;
const SHORT_VIDEO_POLL_INTERVAL_MS = Number.isFinite(Number(process.env.SHORT_VIDEO_POLL_INTERVAL_MS))
  ? Math.max(1000, Math.min(60000, Math.floor(Number(process.env.SHORT_VIDEO_POLL_INTERVAL_MS))))
  : 5000;
const SHORT_VIDEO_POLL_TIMEOUT_MS = Number.isFinite(Number(process.env.SHORT_VIDEO_POLL_TIMEOUT_MS))
  ? Math.max(15000, Math.min(1800000, Math.floor(Number(process.env.SHORT_VIDEO_POLL_TIMEOUT_MS))))
  : 600000;
const DEFAULT_VEO_API_BASE_URL = String(process.env.VEO_API_BASE_URL || "https://grsai.dakka.com.cn").trim();
const DEFAULT_VEO_API_KEY = String(process.env.VEO_API_KEY || "").trim();
const VEO_CREATE_VIDEO_PATH = "/v1/video/veo";
const VEO_GET_RESULT_PATH = "/v1/draw/result";
const VEO_DEFAULT_MODEL = FIXED_SHORT_VIDEO_RENDER_MODEL;
const DEFAULT_FIRST_PASS_MODEL = FIXED_FIRST_PASS_MODEL;
const DEFAULT_PROMPT_PACK_MODEL = FIXED_PROMPT_PACK_MODEL;
const DEFAULT_SHORT_VIDEO_PROMPT_MODEL = FIXED_SHORT_VIDEO_PROMPT_MODEL;
const DEFAULT_SHORT_VIDEO_RENDER_MODEL = FIXED_SHORT_VIDEO_RENDER_MODEL;
const SHORT_VIDEO_CREATE_PATH_SUFFIX = "/v1/video/create";
const SHORT_VIDEO_QUERY_PATH_SUFFIX = "/v1/video/query";
const DEFAULT_SHORT_VIDEO_BASE_API_URL = FIXED_SHORT_VIDEO_BASE_API_URL;
const DEFAULT_FIRST_PASS_ANALYSIS_API_URL = FIXED_CHAT_COMPLETIONS_API_URL;
const DEFAULT_SECOND_STAGE_PROMPT_API_URL = FIXED_CHAT_COMPLETIONS_API_URL;
const VEO_DEFAULT_ASPECT_RATIO = String(process.env.VEO_DEFAULT_ASPECT_RATIO || "9:16").trim();
const VEO_CREATE_TIMEOUT_MS = Number.isFinite(Number(process.env.VEO_CREATE_TIMEOUT_MS ?? process.env.VEO_REQUEST_TIMEOUT_MS))
  ? Math.max(15000, Math.min(300000, Math.floor(Number(process.env.VEO_CREATE_TIMEOUT_MS ?? process.env.VEO_REQUEST_TIMEOUT_MS))))
  : 60000;
const VEO_RESULT_TIMEOUT_MS = Number.isFinite(Number(process.env.VEO_RESULT_TIMEOUT_MS ?? process.env.VEO_REQUEST_TIMEOUT_MS))
  ? Math.max(10000, Math.min(180000, Math.floor(Number(process.env.VEO_RESULT_TIMEOUT_MS ?? process.env.VEO_REQUEST_TIMEOUT_MS))))
  : 30000;
const VEO_POLL_INTERVAL_MS = Number.isFinite(Number(process.env.VEO_POLL_INTERVAL_MS))
  ? Math.max(1000, Math.min(60000, Math.floor(Number(process.env.VEO_POLL_INTERVAL_MS))))
  : 5000;
const VEO_POLL_TIMEOUT_MS = Number.isFinite(Number(process.env.VEO_POLL_TIMEOUT_MS))
  ? Math.max(15000, Math.min(1800000, Math.floor(Number(process.env.VEO_POLL_TIMEOUT_MS))))
  : 600000;
const rawVideoClipConcurrency = Number(process.env.VIDEO_CLIP_CONCURRENCY || 3);
const VIDEO_CLIP_CONCURRENCY = Number.isFinite(rawVideoClipConcurrency)
  ? Math.max(1, Math.min(12, Math.floor(rawVideoClipConcurrency)))
  : 3;
const rawVideoClipMaxRetries = Number(process.env.VIDEO_CLIP_MAX_RETRIES || 3);
const VIDEO_CLIP_MAX_RETRIES = Number.isFinite(rawVideoClipMaxRetries)
  ? Math.max(1, Math.min(6, Math.floor(rawVideoClipMaxRetries)))
  : 3;
const VIDEO_CLIP_RETRY_DELAY_MS = Number.isFinite(Number(process.env.VIDEO_CLIP_RETRY_DELAY_MS))
  ? Math.max(500, Math.min(30000, Math.floor(Number(process.env.VIDEO_CLIP_RETRY_DELAY_MS))))
  : 5000;
const VIDEO_AGENT_IMAGE_LIMIT = Number.isFinite(Number(process.env.VIDEO_AGENT_IMAGE_LIMIT))
  ? Math.max(1, Math.min(8, Math.floor(Number(process.env.VIDEO_AGENT_IMAGE_LIMIT))))
  : 4;
const MAX_MANUAL_IMAGE_BYTES = Number.isFinite(Number(process.env.MAX_MANUAL_IMAGE_BYTES))
  ? Math.max(1024 * 128, Math.min(1024 * 1024 * 50, Math.floor(Number(process.env.MAX_MANUAL_IMAGE_BYTES))))
  : 1024 * 1024 * 10;
const MAX_MANUAL_DESCRIPTION_LENGTH = Number.isFinite(Number(process.env.MAX_MANUAL_DESCRIPTION_LENGTH))
  ? Math.max(50, Math.min(12000, Math.floor(Number(process.env.MAX_MANUAL_DESCRIPTION_LENGTH))))
  : 5000;
const PRODUCT_CONSISTENCY_RULE =
  "若提示词与参考图中的产品外观存在差别，必须优先以参考图外观为准进行绘制，并严格保持产品主体一致性。";
const PRODUCT_CONSISTENCY_REQUIREMENT_LINE = `一致性要求: ${PRODUCT_CONSISTENCY_RULE}`;
const DETAIL_PROMPT_ASPECT_RATIOS = new Set(["1:1", "9:16"]);
const DEFAULT_PROMPT_PACK_TARGET_MARKET = "United States";
const DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE = String(process.env.PROMPT_PACK_PROMPT_LANGUAGE || "English").trim() || "English";
const DEFAULT_PROMPT_PACK_IN_IMAGE_TEXT_LANGUAGE = "English";
const SHORT_VIDEO_PROMPT_DEFAULT_MODEL = FIXED_SHORT_VIDEO_PROMPT_MODEL;
const SHORT_VIDEO_PROMPT_BASE_OPENING = [
  "你是一名资深短视频脚本与提示词专家。",
  "任务目标：基于图词请求阶段产出的产品细节信息（外观/材质/形状/尺寸）、第一次分析结果和《AI视频生成规范》文档，生成可直接执行的 JSON。",
  "请严格遵守文档中的输入约束、镜头结构、音频规范与输出 schema。",
  "必须只输出 JSON，不要输出 Markdown、解释、注释或额外前后缀。",
  "硬性语言约束：所有提示词字段（如 digital_human_base_image_prompt、image_prompt、video_prompt）必须使用英文，严禁出现中文。"
];
const VIDEO_AGENT_OUTPUT_WRAPPER_KEYS = new Set([
  "product_info",
  "productInfo",
  "product_analysis",
  "productAnalysis",
  "scripts",
  "script_variants",
  "scriptVariants",
  "script_set_1",
  "script_set_2",
  "script_set_3",
  "scriptSet1",
  "scriptSet2",
  "scriptSet3",
  "production_notes",
  "productionNotes",
  "raw",
  "model",
  "raw_model_text",
  "rawModelText"
]);

app.use(cors());
app.use(express.json({ limit: "40mb" }));
app.use("/static/analysis-images", express.static(ANALYSIS_IMAGE_DIR));
app.use("/static/knowledge-base-images", express.static(KB_IMAGE_DIR));
app.use("/static/manual-product-images", express.static(MANUAL_PRODUCT_IMAGE_DIR));
app.use("/downloads", express.static(DOWNLOADS_DIR));

const analysisQueue = [];
let analysisWorkersRunning = 0;
const knowledgeAnalysisQueue = [];
let knowledgeWorkersRunning = 0;
const videoClipQueue = [];
let videoClipWorkersRunning = 0;
const activeVideoClipJobKeys = new Set();
let apiKeySettingsCache = null;
let apiKeySettingsLoadingPromise = null;
const apiKeyManagerSessions = new Map();
let runtimeApiKeys = {
  firstPassApiKey: DEFAULT_FIRST_PASS_API_KEY,
  promptPackApiKey: DEFAULT_PROMPT_PACK_API_KEY,
  shortVideoApiKey: DEFAULT_SHORT_VIDEO_RENDER_API_KEY || DEFAULT_SHORT_VIDEO_API_KEY,
  shortVideoPromptApiKey: DEFAULT_SHORT_VIDEO_PROMPT_API_KEY,
  shortVideoRenderApiKey: DEFAULT_SHORT_VIDEO_RENDER_API_KEY || DEFAULT_SHORT_VIDEO_API_KEY
};
let runtimeRequestModels = {
  firstPassModel: DEFAULT_FIRST_PASS_MODEL,
  promptPackModel: DEFAULT_PROMPT_PACK_MODEL,
  shortVideoPromptModel: DEFAULT_SHORT_VIDEO_PROMPT_MODEL,
  shortVideoRenderModel: DEFAULT_SHORT_VIDEO_RENDER_MODEL
};
let runtimeApiEndpoints = {
  firstPassAnalysisApiUrl: DEFAULT_FIRST_PASS_ANALYSIS_API_URL,
  secondStagePromptApiUrl: DEFAULT_SECOND_STAGE_PROMPT_API_URL,
  shortVideoPromptApiUrl: SHORT_VIDEO_PROMPT_API_URL,
  shortVideoBaseApiUrl: DEFAULT_SHORT_VIDEO_BASE_API_URL,
  shortVideoCreateApiUrl: SHORT_VIDEO_CREATE_API_URL,
  shortVideoQueryApiUrl: SHORT_VIDEO_QUERY_API_URL
};

function normalizeObject(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function hashWithSalt(secret, salt) {
  const source = `${String(salt || "").trim()}:${String(secret || "")}`;
  return crypto.createHash("sha256").update(source).digest("hex");
}

function createSecretSalt(size = 16) {
  return crypto.randomBytes(size).toString("hex");
}

function generateNumericCode(length = 16) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += String(crypto.randomInt(0, 10));
  }
  return code;
}

function sanitizeApiKeysPayload(input, fallback = runtimeApiKeys) {
  const source = normalizeObject(input);
  const fallbackSource = normalizeObject(fallback);
  const candidateValues = [
    source.unifiedApiKey,
    source.apiKey,
    source.firstPassApiKey,
    source.first_request_api_key,
    source.FIRST_PASS_ANALYSIS_API_KEY,
    source.VECTORENGINE_API_KEY,
    source.promptPackApiKey,
    source.prompt_pack_api_key,
    source.SECOND_STAGE_PROMPT_API_KEY,
    source.VECTORENGINE_SECOND_STAGE_API_KEY,
    source.shortVideoPromptApiKey,
    source.short_video_prompt_api_key,
    source.SHORT_VIDEO_PROMPT_API_KEY,
    source.shortVideoRenderApiKey,
    source.short_video_render_api_key,
    source.SHORT_VIDEO_RENDER_API_KEY,
    source.shortVideoApiKey,
    source.short_video_api_key,
    source.SHORT_VIDEO_API_KEY,
    source.COZE_API_TOKEN,
    source.COZE_AUTH_TOKEN,
    source.cozeApiToken,
    source.veoApiKey,
    source.VEO_API_KEY,
    source.claudeAuthToken,
    source.CLAUDE_AUTH_TOKEN,
    source.GEMINI_FLASH_LITE_THINKING_API_KEY,
    source.GEMINI_API_KEY,
    fallbackSource.firstPassApiKey,
    fallbackSource.promptPackApiKey,
    fallbackSource.shortVideoPromptApiKey,
    fallbackSource.shortVideoRenderApiKey,
    fallbackSource.shortVideoApiKey
  ];
  const unifiedApiKey = candidateValues
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
  return {
    firstPassApiKey: unifiedApiKey,
    promptPackApiKey: unifiedApiKey,
    shortVideoApiKey: unifiedApiKey,
    shortVideoPromptApiKey: unifiedApiKey,
    shortVideoRenderApiKey: unifiedApiKey
  };
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function inferShortVideoBaseApiUrl(createUrl, queryUrl) {
  const create = trimTrailingSlash(createUrl);
  const query = trimTrailingSlash(queryUrl);
  const createLower = create.toLowerCase();
  const queryLower = query.toLowerCase();
  const createSuffixLower = SHORT_VIDEO_CREATE_PATH_SUFFIX.toLowerCase();
  const querySuffixLower = SHORT_VIDEO_QUERY_PATH_SUFFIX.toLowerCase();
  if (createLower.endsWith(createSuffixLower) && queryLower.endsWith(querySuffixLower)) {
    const createBase = create.slice(0, create.length - SHORT_VIDEO_CREATE_PATH_SUFFIX.length);
    const queryBase = query.slice(0, query.length - SHORT_VIDEO_QUERY_PATH_SUFFIX.length);
    if (createBase && createBase === queryBase) {
      return createBase;
    }
  }
  if (createLower.endsWith(createSuffixLower)) {
    return create.slice(0, create.length - SHORT_VIDEO_CREATE_PATH_SUFFIX.length);
  }
  if (queryLower.endsWith(querySuffixLower)) {
    return query.slice(0, query.length - SHORT_VIDEO_QUERY_PATH_SUFFIX.length);
  }
  return "";
}

function buildShortVideoEndpointByBase(baseUrl, suffix) {
  const base = trimTrailingSlash(baseUrl);
  if (!base) {
    return "";
  }
  return `${base}${suffix}`;
}

function sanitizeApiEndpointsPayload(input, fallback = runtimeApiEndpoints) {
  void input;
  void fallback;
  return {
    firstPassAnalysisApiUrl: DEFAULT_FIRST_PASS_ANALYSIS_API_URL,
    secondStagePromptApiUrl: DEFAULT_SECOND_STAGE_PROMPT_API_URL,
    shortVideoPromptApiUrl: SHORT_VIDEO_PROMPT_API_URL,
    shortVideoBaseApiUrl: DEFAULT_SHORT_VIDEO_BASE_API_URL,
    shortVideoCreateApiUrl: SHORT_VIDEO_CREATE_API_URL,
    shortVideoQueryApiUrl: SHORT_VIDEO_QUERY_API_URL
  };
}

function sanitizeRequestModelsPayload(input, fallback = runtimeRequestModels) {
  void input;
  void fallback;
  return {
    firstPassModel: DEFAULT_FIRST_PASS_MODEL,
    promptPackModel: DEFAULT_PROMPT_PACK_MODEL,
    shortVideoPromptModel: DEFAULT_SHORT_VIDEO_PROMPT_MODEL,
    shortVideoRenderModel: DEFAULT_SHORT_VIDEO_RENDER_MODEL
  };
}

function applyRuntimeApiKeys(input) {
  runtimeApiKeys = sanitizeApiKeysPayload(input, runtimeApiKeys);
  process.env.FIRST_PASS_ANALYSIS_API_KEY = runtimeApiKeys.firstPassApiKey;
  process.env.VECTORENGINE_API_KEY = runtimeApiKeys.firstPassApiKey;
  process.env.SECOND_STAGE_PROMPT_API_KEY = runtimeApiKeys.promptPackApiKey || runtimeApiKeys.firstPassApiKey;
  process.env.VECTORENGINE_SECOND_STAGE_API_KEY = runtimeApiKeys.promptPackApiKey || runtimeApiKeys.firstPassApiKey;
  process.env.SHORT_VIDEO_PROMPT_API_KEY = runtimeApiKeys.shortVideoPromptApiKey || runtimeApiKeys.shortVideoApiKey;
  process.env.SHORT_VIDEO_RENDER_API_KEY = runtimeApiKeys.shortVideoRenderApiKey || runtimeApiKeys.shortVideoApiKey;
  process.env.SHORT_VIDEO_API_KEY = runtimeApiKeys.shortVideoRenderApiKey || runtimeApiKeys.shortVideoApiKey;
  process.env.COZE_API_TOKEN = runtimeApiKeys.shortVideoRenderApiKey || runtimeApiKeys.shortVideoApiKey;
  process.env.COZE_AUTH_TOKEN = runtimeApiKeys.shortVideoRenderApiKey || runtimeApiKeys.shortVideoApiKey;
}

function applyRuntimeApiEndpoints(input) {
  runtimeApiEndpoints = sanitizeApiEndpointsPayload(input, runtimeApiEndpoints);
  process.env.FIRST_PASS_ANALYSIS_API_URL = runtimeApiEndpoints.firstPassAnalysisApiUrl || DEFAULT_FIRST_PASS_ANALYSIS_API_URL;
  process.env.SECOND_STAGE_PROMPT_API_URL = runtimeApiEndpoints.secondStagePromptApiUrl || DEFAULT_SECOND_STAGE_PROMPT_API_URL;
  process.env.SHORT_VIDEO_PROMPT_API_URL = runtimeApiEndpoints.shortVideoPromptApiUrl || SHORT_VIDEO_PROMPT_API_URL;
  process.env.SHORT_VIDEO_BASE_API_URL = runtimeApiEndpoints.shortVideoBaseApiUrl || DEFAULT_SHORT_VIDEO_BASE_API_URL;
  process.env.SHORT_VIDEO_CREATE_API_URL = runtimeApiEndpoints.shortVideoCreateApiUrl || SHORT_VIDEO_CREATE_API_URL;
  process.env.SHORT_VIDEO_QUERY_API_URL = runtimeApiEndpoints.shortVideoQueryApiUrl || SHORT_VIDEO_QUERY_API_URL;
}

function applyRuntimeRequestModels(input) {
  runtimeRequestModels = sanitizeRequestModelsPayload(input, runtimeRequestModels);
  process.env.FIRST_PASS_ANALYSIS_MODEL = runtimeRequestModels.firstPassModel || DEFAULT_FIRST_PASS_MODEL;
  process.env.SECOND_STAGE_PROMPT_MODEL = runtimeRequestModels.promptPackModel || DEFAULT_PROMPT_PACK_MODEL;
  process.env.SHORT_VIDEO_PROMPT_MODEL = runtimeRequestModels.shortVideoPromptModel || DEFAULT_SHORT_VIDEO_PROMPT_MODEL;
  process.env.SHORT_VIDEO_RENDER_MODEL = runtimeRequestModels.shortVideoRenderModel || DEFAULT_SHORT_VIDEO_RENDER_MODEL;
  process.env.VEO_DEFAULT_MODEL = runtimeRequestModels.shortVideoRenderModel || DEFAULT_SHORT_VIDEO_RENDER_MODEL;
}

function buildDefaultApiKeySettings() {
  const passwordSalt = createSecretSalt();
  return {
    password: {
      salt: passwordSalt,
      hash: hashWithSalt(API_KEY_PAGE_DEFAULT_PASSWORD, passwordSalt),
      updatedAt: new Date().toISOString()
    },
    apiKeys: sanitizeApiKeysPayload(runtimeApiKeys, runtimeApiKeys),
    models: sanitizeRequestModelsPayload(runtimeRequestModels, runtimeRequestModels),
    apiEndpoints: sanitizeApiEndpointsPayload(runtimeApiEndpoints, runtimeApiEndpoints),
    resetFlow: {
      codeSalt: "",
      codeHash: "",
      expiresAt: null,
      verifiedUntil: null,
      updatedAt: null
    }
  };
}

function normalizeResetFlow(input) {
  const source = normalizeObject(input);
  const expiresAt = safeOptionalDateISOString(source.expiresAt);
  const verifiedUntil = safeOptionalDateISOString(source.verifiedUntil);
  return {
    codeSalt: String(source.codeSalt || "").trim(),
    codeHash: String(source.codeHash || "").trim(),
    expiresAt,
    verifiedUntil,
    updatedAt: safeOptionalDateISOString(source.updatedAt)
  };
}

function normalizeApiKeySettingsPayload(input) {
  const source = normalizeObject(input);
  const defaultSettings = buildDefaultApiKeySettings();
  const password = normalizeObject(source.password);
  const passwordSalt = String(password.salt || defaultSettings.password.salt).trim() || createSecretSalt();
  const passwordHash = String(password.hash || "").trim() || hashWithSalt(API_KEY_PAGE_DEFAULT_PASSWORD, passwordSalt);
  return {
    password: {
      salt: passwordSalt,
      hash: passwordHash,
      updatedAt: safeOptionalDateISOString(password.updatedAt) || defaultSettings.password.updatedAt
    },
    apiKeys: sanitizeApiKeysPayload(source.apiKeys, defaultSettings.apiKeys),
    models: sanitizeRequestModelsPayload(source.models || source.requestModels || source.modelSettings, defaultSettings.models),
    apiEndpoints: sanitizeApiEndpointsPayload(source.apiEndpoints || source.endpoints || source.api_urls, defaultSettings.apiEndpoints),
    resetFlow: normalizeResetFlow(source.resetFlow)
  };
}

async function persistApiKeySettings(settings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(API_KEY_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

async function loadApiKeySettings() {
  if (apiKeySettingsCache) {
    return apiKeySettingsCache;
  }
  if (apiKeySettingsLoadingPromise) {
    return apiKeySettingsLoadingPromise;
  }
  apiKeySettingsLoadingPromise = (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let parsed = null;
    try {
      const raw = await fs.readFile(API_KEY_SETTINGS_FILE, "utf8");
      parsed = JSON.parse(raw);
    } catch (_error) {
      parsed = null;
    }
    const normalized = parsed ? normalizeApiKeySettingsPayload(parsed) : buildDefaultApiKeySettings();
    apiKeySettingsCache = normalized;
    applyRuntimeApiKeys(normalized.apiKeys);
    applyRuntimeRequestModels(normalized.models);
    applyRuntimeApiEndpoints(normalized.apiEndpoints);
    await persistApiKeySettings(normalized);
    return normalized;
  })()
    .catch((error) => {
      apiKeySettingsLoadingPromise = null;
      throw error;
    })
    .finally(() => {
      apiKeySettingsLoadingPromise = null;
    });
  return apiKeySettingsLoadingPromise;
}

function saveApiKeySettingsToCache(settings) {
  apiKeySettingsCache = normalizeApiKeySettingsPayload(settings);
  applyRuntimeApiKeys(apiKeySettingsCache.apiKeys);
  applyRuntimeRequestModels(apiKeySettingsCache.models);
  applyRuntimeApiEndpoints(apiKeySettingsCache.apiEndpoints);
  return apiKeySettingsCache;
}

async function updateApiKeySettings(mutator) {
  const current = await loadApiKeySettings();
  const next = mutator(normalizeApiKeySettingsPayload(current));
  const normalized = saveApiKeySettingsToCache(next);
  await persistApiKeySettings(normalized);
  return normalized;
}

function createApiKeyManagerSessionToken() {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + API_KEY_SESSION_TTL_MS;
  apiKeyManagerSessions.set(token, {
    expiresAt
  });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

function clearExpiredApiKeyManagerSessions() {
  const now = Date.now();
  for (const [token, session] of apiKeyManagerSessions.entries()) {
    if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
      apiKeyManagerSessions.delete(token);
    }
  }
}

function getApiKeyManagerSessionToken(req) {
  const headerToken = String(req.headers["x-settings-token"] || "").trim();
  if (headerToken) {
    return headerToken;
  }
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function isValidManagerPassword(value) {
  const text = String(value || "");
  return text.length >= 8 && text.length <= 128;
}

function verifyManagerPassword(settings, password) {
  const source = normalizeObject(settings.password);
  const salt = String(source.salt || "").trim();
  const hash = String(source.hash || "").trim();
  if (!salt || !hash) {
    return false;
  }
  return hashWithSalt(password, salt) === hash;
}

function isValidResetCode(value) {
  return /^\d{16}$/.test(String(value || "").trim());
}

function createCodedError(code, message) {
  const error = new Error(String(message || "Unknown error"));
  error.code = String(code || "UNKNOWN_ERROR");
  return error;
}

function formatResetCodeExpiresAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "");
  }
  return date.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
}

async function sendResetCodeEmail(code, expiresAt) {
  if (!RESET_EMAIL_SMTP_HOST || !Number.isFinite(RESET_EMAIL_SMTP_PORT) || !RESET_EMAIL_SMTP_USER || !RESET_EMAIL_SMTP_PASS || !RESET_EMAIL_FROM) {
    throw createCodedError(
      "RESET_EMAIL_NOT_CONFIGURED",
      "验证码邮件服务未配置，请设置 RESET_EMAIL_SMTP_HOST/PORT/USER/PASS/FROM。"
    );
  }
  const expiresAtLabel = formatResetCodeExpiresAt(expiresAt);
  const text = [
    "API Key 管理页验证码",
    "",
    `验证码：${code}`,
    `有效期至（北京时间）：${expiresAtLabel}`,
    "",
    "请在 5 分钟内完成校验。若非本人操作，请忽略本邮件。"
  ].join("\n");

  const readResponseBlock = (readerState) => {
    let cursor = 0;
    const lines = [];
    while (true) {
      const lineEnd = readerState.buffer.indexOf("\r\n", cursor);
      if (lineEnd < 0) {
        return null;
      }
      const line = readerState.buffer.slice(cursor, lineEnd);
      lines.push(line);
      cursor = lineEnd + 2;
      if (/^\d{3} /.test(line)) {
        const codeNumber = Number(line.slice(0, 3));
        readerState.buffer = readerState.buffer.slice(cursor);
        return {
          code: codeNumber,
          lines
        };
      }
    }
  };

  const readSmtpResponse = (socket, readerState, timeoutMs = RESET_EMAIL_SMTP_RESPONSE_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      const existing = readResponseBlock(readerState);
      if (existing) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("SMTP 响应超时。"));
      }, timeoutMs);
      const onData = (chunk) => {
        readerState.buffer += String(chunk || "");
        const parsed = readResponseBlock(readerState);
        if (!parsed) {
          return;
        }
        cleanup();
        resolve(parsed);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("SMTP 连接已关闭。"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      socket.on("data", onData);
      socket.on("error", onError);
      socket.on("close", onClose);
    });

  const ensureCode = (response, allowed, command) => {
    if (allowed.includes(response.code)) {
      return;
    }
    const detail = response.lines.join(" | ");
    throw new Error(`${command} 失败，SMTP 返回 ${response.code}: ${detail}`);
  };

  const sendCommand = async (socket, readerState, command, allowedCodes) => {
    socket.write(`${command}\r\n`);
    const response = await readSmtpResponse(socket, readerState);
    ensureCode(response, allowedCodes, command);
  };

  const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
  const smtpBody = String(text || "")
    .replace(/\r?\n/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
  const smtpPayload = [
    `From: ${RESET_EMAIL_FROM}`,
    `To: ${API_KEY_RESET_EMAIL}`,
    `Subject: ${encodeHeader("API Key 管理页验证码")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    `Date: ${new Date().toUTCString()}`,
    "",
    smtpBody,
    "."
  ].join("\r\n");

  const describeSmtpEndpoint = (secureMode) =>
    `${RESET_EMAIL_SMTP_HOST}:${RESET_EMAIL_SMTP_PORT} (${secureMode ? "SMTPS" : "STARTTLS"})`;

  const buildSmtpConnectOptions = () => {
    const options = {
      host: RESET_EMAIL_SMTP_HOST,
      port: RESET_EMAIL_SMTP_PORT
    };
    if (RESET_EMAIL_SMTP_FAMILY) {
      options.family = RESET_EMAIL_SMTP_FAMILY;
    }
    return options;
  };

  const connectTlsSocket = () =>
    new Promise((resolve, reject) => {
      const socket = tls.connect({
        ...buildSmtpConnectOptions(),
        servername: RESET_EMAIL_SMTP_HOST
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SMTP 连接超时：${describeSmtpEndpoint(true)}，超时 ${RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS}ms。`));
      }, RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS);
      const onSecure = () => {
        cleanup();
        resolve(socket);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("secureConnect", onSecure);
        socket.off("error", onError);
      };
      socket.on("secureConnect", onSecure);
      socket.on("error", onError);
    });

  const connectPlainSocket = () =>
    new Promise((resolve, reject) => {
      const socket = net.connect(buildSmtpConnectOptions());
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SMTP 连接超时：${describeSmtpEndpoint(false)}，超时 ${RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS}ms。`));
      }, RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS);
      const onConnect = () => {
        cleanup();
        resolve(socket);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("connect", onConnect);
        socket.off("error", onError);
      };
      socket.on("connect", onConnect);
      socket.on("error", onError);
    });

  const upgradeToTlsSocket = (plainSocket) =>
    new Promise((resolve, reject) => {
      const secureSocket = tls.connect({
        socket: plainSocket,
        servername: RESET_EMAIL_SMTP_HOST
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`STARTTLS 升级超时：${describeSmtpEndpoint(false)}，超时 ${RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS}ms。`));
      }, RESET_EMAIL_SMTP_CONNECT_TIMEOUT_MS);
      const onSecure = () => {
        cleanup();
        resolve(secureSocket);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        secureSocket.off("secureConnect", onSecure);
        secureSocket.off("error", onError);
      };
      secureSocket.on("secureConnect", onSecure);
      secureSocket.on("error", onError);
    });

  let socket = null;
  const readerState = {
    buffer: ""
  };
  const connectByMode = async (secureMode) => {
    let currentSocket = null;
    try {
      if (secureMode) {
        currentSocket = await connectTlsSocket();
        ensureCode(await readSmtpResponse(currentSocket, readerState), [220], "CONNECT");
        await sendCommand(currentSocket, readerState, "EHLO localhost", [250]);
        return currentSocket;
      }
      currentSocket = await connectPlainSocket();
      ensureCode(await readSmtpResponse(currentSocket, readerState), [220], "CONNECT");
      await sendCommand(currentSocket, readerState, "EHLO localhost", [250]);
      await sendCommand(currentSocket, readerState, "STARTTLS", [220]);
      currentSocket = await upgradeToTlsSocket(currentSocket);
      readerState.buffer = "";
      await sendCommand(currentSocket, readerState, "EHLO localhost", [250]);
      return currentSocket;
    } catch (error) {
      if (currentSocket && !currentSocket.destroyed) {
        currentSocket.destroy();
      }
      throw error;
    }
  };

  try {
    const connectModeCandidates = RESET_EMAIL_SMTP_AUTO_FALLBACK
      ? [RESET_EMAIL_SMTP_SECURE, !RESET_EMAIL_SMTP_SECURE]
      : [RESET_EMAIL_SMTP_SECURE];
    let connectError = null;
    for (let i = 0; i < connectModeCandidates.length; i += 1) {
      const mode = connectModeCandidates[i];
      try {
        socket = await connectByMode(mode);
        connectError = null;
        break;
      } catch (error) {
        connectError = error;
        readerState.buffer = "";
        if (socket && !socket.destroyed) {
          socket.destroy();
        }
        socket = null;
      }
    }
    if (!socket) {
      throw connectError || new Error("SMTP 连接失败。");
    }

    await sendCommand(socket, readerState, "AUTH LOGIN", [334]);
    await sendCommand(socket, readerState, Buffer.from(RESET_EMAIL_SMTP_USER, "utf8").toString("base64"), [334]);
    await sendCommand(socket, readerState, Buffer.from(RESET_EMAIL_SMTP_PASS, "utf8").toString("base64"), [235]);
    await sendCommand(socket, readerState, `MAIL FROM:<${RESET_EMAIL_FROM}>`, [250]);
    await sendCommand(socket, readerState, `RCPT TO:<${API_KEY_RESET_EMAIL}>`, [250, 251]);
    await sendCommand(socket, readerState, "DATA", [354]);
    socket.write(`${smtpPayload}\r\n`);
    ensureCode(await readSmtpResponse(socket, readerState), [250], "DATA");
    socket.write("QUIT\r\n");
  } catch (error) {
    throw createCodedError(
      "RESET_EMAIL_SEND_FAILED",
      safeText(error instanceof Error ? error.message : String(error), "验证码邮件发送失败。")
    );
  } finally {
    if (socket && !socket.destroyed) {
      socket.end();
    }
  }
}

function getCozeApiToken() {
  return String(runtimeApiKeys.shortVideoRenderApiKey || runtimeApiKeys.shortVideoApiKey || "").trim();
}

function getShortVideoApiKey() {
  return getShortVideoRenderApiKey();
}

function getCozeWorkflowApiUrl() {
  return String(process.env.COZE_WORKFLOW_API_URL || DEFAULT_COZE_WORKFLOW_API_URL || "").trim();
}

function getShortVideoPromptApiKey() {
  return String(runtimeApiKeys.shortVideoPromptApiKey || runtimeApiKeys.promptPackApiKey || runtimeApiKeys.shortVideoApiKey || "").trim();
}

function getShortVideoRenderApiKey() {
  return String(runtimeApiKeys.shortVideoRenderApiKey || runtimeApiKeys.shortVideoApiKey || runtimeApiKeys.shortVideoPromptApiKey || "").trim();
}

function getShortVideoPromptApiUrl() {
  return safeText(runtimeApiEndpoints.shortVideoPromptApiUrl, SHORT_VIDEO_PROMPT_API_URL);
}

function getShortVideoCreateApiUrl() {
  return safeText(runtimeApiEndpoints.shortVideoCreateApiUrl, SHORT_VIDEO_CREATE_API_URL);
}

function getShortVideoQueryApiUrl() {
  return safeText(runtimeApiEndpoints.shortVideoQueryApiUrl, SHORT_VIDEO_QUERY_API_URL);
}

function getVeoApiKey() {
  return String(process.env.VEO_API_KEY || DEFAULT_VEO_API_KEY || "").trim();
}

function getVeoApiBaseUrl() {
  return String(process.env.VEO_API_BASE_URL || DEFAULT_VEO_API_BASE_URL || "").trim();
}

function getVeoDefaultModel() {
  return safeText(runtimeRequestModels.shortVideoRenderModel, VEO_DEFAULT_MODEL);
}

function getShortVideoRenderModel() {
  return safeText(runtimeRequestModels.shortVideoRenderModel, VEO_DEFAULT_MODEL);
}

function getShortVideoPromptModel() {
  return safeText(runtimeRequestModels.shortVideoPromptModel, SHORT_VIDEO_PROMPT_DEFAULT_MODEL);
}

function getFirstPassAnalysisApiKey() {
  return String(runtimeApiKeys.firstPassApiKey || "").trim();
}

function getPromptPackApiKey() {
  return String(runtimeApiKeys.promptPackApiKey || runtimeApiKeys.firstPassApiKey || "").trim();
}

async function requireApiKeyManagerSession(req, res, next) {
  try {
    await loadApiKeySettings();
    clearExpiredApiKeyManagerSessions();
    const token = getApiKeyManagerSessionToken(req);
    if (!token || !apiKeyManagerSessions.has(token)) {
      return res.status(401).json({
        ok: false,
        code: "UNAUTHORIZED",
        message: "请先输入密码进入 API Key 管理页面。"
      });
    }
    req.apiKeyManagerSessionToken = token;
    return next();
  } catch (error) {
    return res.status(500).json({
      ok: false,
      code: "SETTINGS_LOAD_FAILED",
      message: safeText(error instanceof Error ? error.message : String(error), "配置加载失败。")
    });
  }
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function isLikelyImageReference(value) {
  const raw = safeText(value);
  if (!raw) {
    return false;
  }
  if (/^data:image\//i.test(raw)) {
    return true;
  }
  if (raw.startsWith("/static/") || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/static\//i.test(raw)) {
    return true;
  }
  if (!/^https?:\/\//i.test(raw)) {
    return false;
  }
  try {
    const parsed = new URL(raw);
    const pathname = safeText(parsed.pathname).toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:$|[?#])/.test(pathname)) {
      return true;
    }
    if (/alicdn\.com$/i.test(parsed.hostname) && pathname.includes("/img/")) {
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseNumber(input) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input !== "string") {
    return null;
  }
  const matched = input.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!matched) {
    return null;
  }
  const value = Number(matched[0]);
  return Number.isFinite(value) ? value : null;
}

function safeDateISOString(input) {
  if (!input) {
    return new Date().toISOString();
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function safeOptionalDateISOString(input) {
  if (!input) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function safeTextOrNull(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function safeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function parseLocalStaticRelativePath(imageUrl) {
  const raw = safeText(imageUrl);
  if (!raw || /^data:/i.test(raw)) {
    return "";
  }

  let pathname = "";
  if (raw.startsWith("/")) {
    pathname = raw;
  } else {
    try {
      pathname = safeText(new URL(raw).pathname);
    } catch (_error) {
      return "";
    }
  }

  const normalizedPath = pathname.replace(/\\/g, "/");
  const marker = "/static/";
  const markerIndex = normalizedPath.toLowerCase().indexOf(marker);
  if (markerIndex < 0) {
    return "";
  }

  const relativePath = normalizedPath.slice(markerIndex + marker.length).replace(/^\/+/, "");
  if (!relativePath) {
    return "";
  }

  const safeRelativePath = path.posix.normalize(`/${relativePath}`).replace(/^\/+/, "");
  if (!safeRelativePath || safeRelativePath.startsWith("..")) {
    return "";
  }
  const topLevelDir = safeRelativePath.split("/")[0];
  if (!STATIC_PUBLIC_DIRS.has(topLevelDir)) {
    return "";
  }

  return safeRelativePath;
}

async function inspectLocalStaticImageUrl(imageUrl, cache) {
  const key = safeText(imageUrl);
  if (!key) {
    return {
      isLocalStatic: false,
      exists: false,
      canonicalUrl: "",
      relativePath: ""
    };
  }
  if (cache.has(key)) {
    return cache.get(key);
  }

  const relativePath = parseLocalStaticRelativePath(key);
  if (!relativePath) {
    const result = {
      isLocalStatic: false,
      exists: false,
      canonicalUrl: key,
      relativePath: ""
    };
    cache.set(key, result);
    return result;
  }

  const fullPath = path.join(DATA_DIR, ...relativePath.split("/"));
  let exists = true;
  try {
    await fs.access(fullPath);
  } catch (_error) {
    exists = false;
  }
  const result = {
    isLocalStatic: true,
    exists,
    canonicalUrl: `/static/${relativePath}`,
    relativePath
  };
  cache.set(key, result);
  return result;
}

function isSameStringArray(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

async function repairBrokenProductImageRecordsOnStartup() {
  const products = await loadProducts();
  if (!Array.isArray(products) || !products.length) {
    return;
  }

  const inspectCache = new Map();
  const repairedProducts = [];
  let fixedProducts = 0;
  let removedImageRefs = 0;
  let canonicalizedImageRefs = 0;
  let clearedTriggered = 0;

  for (const product of products) {
    const source = product && typeof product === "object" ? product : {};
    const currentTriggered = safeText(source.triggeredImage);
    const currentImages = uniqueStrings(toArray(source.images || []));
    const nextImages = [];

    for (const imageUrl of currentImages) {
      const inspected = await inspectLocalStaticImageUrl(imageUrl, inspectCache);
      if (!inspected.isLocalStatic) {
        const normalized = safeText(imageUrl);
        if (!isLikelyImageReference(normalized)) {
          removedImageRefs += 1;
          continue;
        }
        nextImages.push(normalized);
        continue;
      }
      if (!inspected.exists) {
        removedImageRefs += 1;
        continue;
      }
      if (inspected.canonicalUrl !== safeText(imageUrl)) {
        canonicalizedImageRefs += 1;
      }
      nextImages.push(inspected.canonicalUrl);
    }

    let nextTriggered = currentTriggered;
    if (nextTriggered) {
      const inspected = await inspectLocalStaticImageUrl(nextTriggered, inspectCache);
      if (inspected.isLocalStatic) {
        if (!inspected.exists) {
          nextTriggered = "";
          removedImageRefs += 1;
          clearedTriggered += 1;
        } else {
          if (inspected.canonicalUrl !== currentTriggered) {
            canonicalizedImageRefs += 1;
          }
          nextTriggered = inspected.canonicalUrl;
        }
      } else if (!isLikelyImageReference(nextTriggered)) {
        nextTriggered = "";
        removedImageRefs += 1;
        clearedTriggered += 1;
      }
    }

    const mergedImages = uniqueStrings([nextTriggered, ...nextImages]);
    if (!nextTriggered) {
      nextTriggered = mergedImages[0] || "";
    }

    const triggeredChanged = nextTriggered !== currentTriggered;
    const imagesChanged = !isSameStringArray(mergedImages, currentImages);
    if (triggeredChanged || imagesChanged) {
      fixedProducts += 1;
      repairedProducts.push({
        ...source,
        triggeredImage: nextTriggered,
        images: mergedImages
      });
    } else {
      repairedProducts.push(product);
    }
  }

  if (!fixedProducts) {
    console.log(`[startup] image record check completed: ${products.length} product(s), no repair needed.`);
    return;
  }

  await saveProducts(repairedProducts);
  console.log(
    `[startup] image record repair completed: total=${products.length}, fixedProducts=${fixedProducts}, removedRefs=${removedImageRefs}, canonicalizedRefs=${canonicalizedImageRefs}, clearedTriggered=${clearedTriggered}.`
  );
}

function appendConsistencyRequirementToImagePrompt(prompt) {
  const text = safeText(prompt);
  if (!text) {
    return "";
  }
  if (text.includes(PRODUCT_CONSISTENCY_RULE)) {
    return text;
  }
  return `${text}\n${PRODUCT_CONSISTENCY_REQUIREMENT_LINE}`;
}

function normalizeModelErrorMessage(error) {
  const raw = safeText(error);
  if (!raw) {
    return "图词请求失败";
  }
  if (/524|504|408|timed out|timeout|aborted|abort/i.test(raw)) {
    return "模型服务超时，请稍后重试。";
  }
  const noHtml = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return noHtml.slice(0, 240) || "图词请求失败";
}

function parseConfidence(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1) {
      return Math.max(0, Math.min(1, Number((value / 100).toFixed(4))));
    }
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }
  const matched = String(value ?? "").match(/-?\d+(\.\d+)?/);
  if (!matched) {
    return fallback;
  }
  const parsed = Number(matched[0]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed > 1) {
    return Math.max(0, Math.min(1, Number((parsed / 100).toFixed(4))));
  }
  return Math.max(0, Math.min(1, Number(parsed.toFixed(4))));
}

function normalizeCategoryPath(input) {
  if (!Array.isArray(input)) {
    if (!input) {
      return [];
    }
    const text = safeText(input);
    if (!text) {
      return [];
    }
    return text
      .split(/[>/|]/)
      .map((item) => safeText(item))
      .filter(Boolean)
      .slice(0, 8);
  }
  const flattened = [];
  for (const value of input) {
    const raw = safeText(value);
    if (!raw) {
      continue;
    }
    const parts = raw
      .split(/[>/|]/)
      .map((item) => safeText(item))
      .filter(Boolean);
    flattened.push(...parts);
  }
  return [...new Set(flattened)].slice(0, 8);
}

function normalizeCategoryReference(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    categoryId: safeText(source.categoryId || source.category_id),
    categoryName: safeText(source.categoryName || source.category_name),
    confidence: parseConfidence(source.confidence, 0),
    reason: safeText(source.reason)
  };
}

function safeIdFragment(value) {
  return safeText(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function createManualProductId(...candidates) {
  for (const candidate of candidates) {
    const normalized = safeIdFragment(candidate).slice(0, 60);
    if (normalized) {
      return normalized;
    }
  }
  return `manual_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function extractProductId(url, fallbackId) {
  if (fallbackId) {
    return String(fallbackId);
  }
  const source = String(url || "");
  const matched =
    source.match(/offer\/(\d+)\.html/i) ||
    source.match(/detail\/(\d+)\.html/i) ||
    source.match(/[?&]id=(\d+)/i) ||
    source.match(/[?&]item_id=(\d+)/i) ||
    source.match(/[?&]goods_id=(\d+)/i);
  return matched ? matched[1] : `unknown_${Date.now()}`;
}

function escapeHtml(text) {
  const source = safeText(text);
  if (!source) {
    return "";
  }
  return source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizePriceTiers(priceTiers) {
  if (!Array.isArray(priceTiers)) {
    return [];
  }
  return priceTiers
    .map((tier) => {
      const quantityLabel = String(tier?.quantityLabel || tier?.quantity || "").trim();
      const rawPrice = tier?.unitPrice ?? tier?.price ?? "";
      const unitPrice = parseNumber(rawPrice);
      if (!quantityLabel && unitPrice === null) {
        return null;
      }
      return {
        quantityLabel: quantityLabel || "Unknown Qty",
        unitPrice,
        unitPriceText: String(rawPrice || "").trim()
      };
    })
    .filter(Boolean);
}

function normalizeSkuDimensions(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((dimension) => {
      const name = String(dimension?.name || "").trim();
      const options = uniqueStrings(dimension?.options || []);
      if (!name && options.length === 0) {
        return null;
      }
      return {
        name: name || "Unnamed Spec",
        options
      };
    })
    .filter(Boolean);
}

function normalizeSkuItems(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((sku) => {
      const attrs = uniqueStrings(sku?.attrs || sku?.specs || []);
      const price = parseNumber(sku?.price);
      const stock = parseNumber(sku?.stock);
      if (!attrs.length && price === null && stock === null) {
        return null;
      }
      return {
        attrs,
        price,
        stock,
        stockText: String(sku?.stock ?? "").trim()
      };
    })
    .filter(Boolean);
}

function normalizeProductAttributes(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      const name = String(item?.name || item?.key || "").trim();
      const value = String(item?.value || "").trim();
      if (!name || !value) {
        return null;
      }
      return {
        name,
        value
      };
    })
    .filter(Boolean)
    .slice(0, 120);
}

function normalizePackageSpecs(input) {
  return uniqueStrings(Array.isArray(input) ? input : []).slice(0, 120);
}

function normalizeAnalysisResult(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const base = sanitizeAnalysisResult(input);
  return {
    ...base,
    whiteBackgroundImageUrl: String(input.whiteBackgroundImageUrl || "").trim(),
    referenceImageUrl: String(input.referenceImageUrl || "").trim(),
    generatedAt: safeOptionalDateISOString(input.generatedAt)
  };
}

function normalizeAnalysisState(input) {
  const source = input && typeof input === "object" ? input : {};
  const status = String(source.status || "idle").trim();
  const safeStatus = ["idle", "queued", "processing", "completed", "failed"].includes(status) ? status : "idle";
  return {
    status: safeStatus,
    jobId: safeTextOrNull(source.jobId),
    error: safeTextOrNull(source.error),
    updatedAt: safeOptionalDateISOString(source.updatedAt),
    result: normalizeAnalysisResult(source.result)
  };
}

function normalizePromptGenerationResult(input, analysisResult = null) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const base = sanitizePromptGenerationResult(input, analysisResult || {});
  return {
    ...base,
    matchedCategoryId: safeText(input.matchedCategoryId || base.matchedCategoryId),
    matchedCategoryName: safeText(input.matchedCategoryName || base.matchedCategoryName),
    knowledgeSummary: safeText(input.knowledgeSummary || base.knowledgeSummary),
    referenceImageUrl: String(input.referenceImageUrl || base.referenceImageUrl || "").trim(),
    optionalWhiteImageUrl: String(input.optionalWhiteImageUrl || base.optionalWhiteImageUrl || "").trim(),
    generatedAt: safeOptionalDateISOString(input.generatedAt || base.generatedAt)
  };
}

function normalizePromptGenerationState(input, analysisResult = null) {
  const source = input && typeof input === "object" ? input : {};
  const status = String(source.status || "idle").trim();
  const safeStatus = ["idle", "processing", "awaiting_category_confirmation", "completed", "failed"].includes(status)
    ? status
    : "idle";
  return {
    status: safeStatus,
    error: safeTextOrNull(source.error),
    updatedAt: safeOptionalDateISOString(source.updatedAt),
    result: normalizePromptGenerationResult(source.result, analysisResult),
    categoryRecognition: normalizeCategoryReference(source.categoryRecognition),
    confidenceThreshold:
      Number.isFinite(Number(source.confidenceThreshold)) && Number(source.confidenceThreshold) > 0
        ? Number(source.confidenceThreshold)
        : CATEGORY_CONFIDENCE_THRESHOLD,
    candidateCategories: Array.isArray(source.candidateCategories)
      ? source.candidateCategories
          .map((item) => ({
            id: safeText(item?.id || item?.categoryId),
            name: safeText(item?.name || item?.categoryName),
            path: normalizeCategoryPath(item?.path || item?.categoryPath)
          }))
          .filter((item) => item.id && item.name)
      : []
  };
}

function safeObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input;
}

function normalizeVideoAgentInputPayload(input) {
  const source = safeObject(input);
  if (!source) {
    return null;
  }
  const productImages = uniqueStrings(toArray(source.product_images || source.productImages)).slice(0, 16);
  const rawParams = safeObject(source.product_params || source.productParams) || {};
  const productParams = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      productParams[key] = String(value);
      continue;
    }
    if (Array.isArray(value)) {
      productParams[key] = uniqueStrings(value.map((item) => String(item ?? "")));
      continue;
    }
    if (value && typeof value === "object") {
      productParams[key] = value;
    }
  }
  return {
    product_images: productImages,
    product_params: productParams
  };
}

function normalizeVideoScriptClip(input) {
  const source = safeObject(input);
  if (!source) {
    return null;
  }
  const clipNumberRaw = parseNumber(source.clip_number ?? source.clipNumber);
  const firstFramePrompt = safeText(
    source.first_frame_prompt ??
      source.first_frame_promp ??
      source.firstFramePrompt ??
      source.firstFramePromp ??
      source.image_generation_prompt ??
      source.imageGenerationPrompt
  );
  const lastFramePrompt = safeText(
    source.last_frame_prompt ?? source.last_frame_promp ?? source.lastFramePrompt ?? source.lastFramePromp
  );
  const imageGenerationPrompt = safeText(source.image_generation_prompt ?? source.imageGenerationPrompt, firstFramePrompt);
  return {
    clipNumber: clipNumberRaw === null ? null : Math.max(0, Math.floor(clipNumberRaw)),
    duration: safeText(source.duration),
    sceneType: safeText(source.scene_type ?? source.sceneType),
    sceneDescription: safeText(source.scene_description ?? source.sceneDescription),
    marketingPurpose: safeText(source.marketing_purpose ?? source.marketingPurpose),
    generationMethod: safeText(source.generation_method ?? source.generationMethod),
    aiOrReal: safeText(source.ai_or_real ?? source.aiOrReal),
    firstFramePrompt: appendConsistencyRequirementToImagePrompt(firstFramePrompt),
    lastFramePrompt: appendConsistencyRequirementToImagePrompt(lastFramePrompt),
    videoAudioPrompt: safeText(source.video_audio_prompt ?? source.videoAudioPrompt),
    imageGenerationPrompt: appendConsistencyRequirementToImagePrompt(imageGenerationPrompt),
    videoGenerationPrompt: safeText(source.video_generation_prompt ?? source.videoGenerationPrompt),
    audioDescription: safeText(source.audio_description ?? source.audioDescription),
    narrationPortuguese: safeText(source.narration_portuguese ?? source.narrationPortuguese),
    visualElements: safeText(source.visual_elements ?? source.visualElements),
    styleNotes: safeText(source.style_notes ?? source.styleNotes)
  };
}

function normalizeVideoScriptSet(input, setKey) {
  const source = safeObject(input);
  if (!source) {
    return null;
  }
  const clips = toArray(source.clips).map((item) => normalizeVideoScriptClip(item)).filter(Boolean);
  return {
    setKey,
    scriptName: safeText(source.script_name || source.scriptName),
    strategy: safeText(source.strategy),
    targetAudience: safeText(source.target_audience || source.targetAudience),
    totalDuration: safeText(source.total_duration || source.totalDuration),
    videoStructure: safeText(source.video_structure || source.videoStructure),
    clips,
    raw: source
  };
}

function normalizeVideoScriptVariantSet(input, index) {
  const source = safeObject(input);
  if (!source) {
    return null;
  }
  const variantName = safeText(source.variant_name || source.variantName, `script_variant_${index + 1}`);
  const targetAudience = safeText(source.target_audience || source.targetAudience);
  const styleDescription = safeText(source.style_description || source.styleDescription);
  const firstFramePrompt = appendConsistencyRequirementToImagePrompt(
    safeText(source.first_frame_prompt || source.firstFramePrompt)
  );
  const segmentAPrompt = safeText(source.segment_a_prompt || source.segmentAPrompt);
  const segmentBPrompt = safeText(source.segment_b_prompt || source.segmentBPrompt);
  const usageGuide = safeText(source.usage_guide || source.usageGuide);

  // 新结构没有 clips，映射成单分镜，保持现有前端可消费的数据形态
  const fallbackClip = {
    clipNumber: 1,
    duration: "",
    sceneType: "script_variant",
    sceneDescription: segmentAPrompt,
    marketingPurpose: segmentBPrompt,
    generationMethod: "",
    aiOrReal: "",
    firstFramePrompt,
    lastFramePrompt: "",
    videoAudioPrompt: usageGuide,
    imageGenerationPrompt: firstFramePrompt,
    videoGenerationPrompt: [segmentAPrompt, segmentBPrompt].filter(Boolean).join("\n\n"),
    audioDescription: "",
    narrationPortuguese: "",
    visualElements: "",
    styleNotes: styleDescription
  };

  return {
    setKey: `script_set_${index + 1}`,
    scriptName: variantName,
    strategy: styleDescription,
    targetAudience,
    totalDuration: "",
    videoStructure: "",
    clips: [fallbackClip],
    raw: source
  };
}

function isVideoAgentOutputWrapperShape(input) {
  const source = safeObject(input);
  if (!source) {
    return false;
  }
  const keys = Object.keys(source);
  if (!keys.length || !keys.includes("raw")) {
    return false;
  }
  return keys.every((key) => VIDEO_AGENT_OUTPUT_WRAPPER_KEYS.has(key));
}

function extractStableVideoAgentRawPayload(input) {
  let current = safeObject(input);
  if (!current) {
    return null;
  }
  const seen = new Set();
  for (let depth = 0; depth < 24; depth += 1) {
    if (!current || seen.has(current)) {
      break;
    }
    seen.add(current);
    const nested = safeObject(current.raw);
    if (!nested || !isVideoAgentOutputWrapperShape(current)) {
      break;
    }
    current = nested;
  }
  return current;
}

function hasVideoAgentStructuredOutput(outputPayload) {
  const source = safeObject(outputPayload);
  if (!source) {
    return false;
  }
  if (toArray(source.scripts).length > 0) {
    return true;
  }
  if (safeObject(source.script_set_1) || safeObject(source.script_set_2) || safeObject(source.script_set_3)) {
    return true;
  }
  if (toArray(source.script_variants).length > 0) {
    return true;
  }
  return false;
}

function normalizeVideoAgentOutputPayload(input) {
  const source = safeObject(input);
  if (!source) {
    return null;
  }
  const stableRaw = extractStableVideoAgentRawPayload(source) || source;
  const rawDebug = safeObject(source.raw);
  const sourceOutputRaw = safeObject(rawDebug?.source_output_raw) || safeObject(stableRaw?.source_output_raw);
  const effectiveSource = hasVideoAgentStructuredOutput(source) ? source : sourceOutputRaw || source;
  const scriptVariants = toArray(effectiveSource.script_variants || effectiveSource.scriptVariants)
    .map((item) => safeObject(item))
    .filter(Boolean);
  const promptScripts = toArray(effectiveSource.scripts || effectiveSource.script_packages || effectiveSource.scriptPackages)
    .map((item, index) => normalizeShortVideoScriptPackage(item, index))
    .filter((item) => item.shots.length);
  return {
    product_info: safeObject(effectiveSource.product_info || effectiveSource.productInfo),
    product_analysis: safeObject(effectiveSource.product_analysis || effectiveSource.productAnalysis),
    scripts: promptScripts,
    script_variants: scriptVariants,
    script_set_1: safeObject(effectiveSource.script_set_1 || effectiveSource.scriptSet1),
    script_set_2: safeObject(effectiveSource.script_set_2 || effectiveSource.scriptSet2),
    script_set_3: safeObject(effectiveSource.script_set_3 || effectiveSource.scriptSet3),
    production_notes: safeObject(effectiveSource.production_notes || effectiveSource.productionNotes),
    raw: stableRaw
  };
}

function normalizeVideoScriptGenerationResult(input) {
  const source = safeObject(input);
  if (!source) {
    return null;
  }
  const inputPayload = normalizeVideoAgentInputPayload(source.inputPayload || source.input || source.cozeInput);
  const directOutput =
    safeObject(source.outputPayload || source.output || source.cozeOutput) ||
    (safeObject(source.script_set_1) ||
    safeObject(source.script_set_2) ||
    safeObject(source.script_set_3) ||
    safeObject(source.product_info) ||
    safeObject(source.product_analysis) ||
    Array.isArray(source.script_variants) ||
    Array.isArray(source.scripts)
      ? source
      : null);
  const outputPayload = normalizeVideoAgentOutputPayload(directOutput);
  const legacyScriptSets = ["script_set_1", "script_set_2", "script_set_3"]
    .map((key) => normalizeVideoScriptSet(outputPayload?.[key], key))
    .filter(Boolean);
  const variantScriptSets = toArray(outputPayload?.script_variants)
    .map((item, index) => normalizeVideoScriptVariantSet(item, index))
    .filter(Boolean);
  const promptScriptSets = convertShortVideoScriptsToLegacySets(outputPayload?.scripts || []);
  const scriptSets = legacyScriptSets.length ? legacyScriptSets : variantScriptSets.length ? variantScriptSets : promptScriptSets;
  const modelRequestSource = safeObject(source.modelRequest || source.model_request);
  const modelRequest = modelRequestSource
    ? {
        endpoint: safeText(modelRequestSource.endpoint),
        requestBody: safeObject(modelRequestSource.requestBody || modelRequestSource.request_body),
        sentAt: safeOptionalDateISOString(modelRequestSource.sentAt || modelRequestSource.sent_at)
      }
    : null;
  const requestContextSource = safeObject(source.requestContext || source.request_context);
  const localeSource = safeObject(requestContextSource?.locale);
  const hasLocale =
    Boolean(safeText(localeSource?.targetMarket || localeSource?.target_market)) ||
    Boolean(safeText(localeSource?.promptLanguage || localeSource?.prompt_language || localeSource?.language)) ||
    Boolean(safeText(localeSource?.inImageTextLanguage || localeSource?.in_image_text_language || localeSource?.targetLanguage));
  const requestContext = hasLocale
    ? {
        locale: normalizePromptPackLocaleConfig(localeSource)
      }
    : null;
  return {
    inputPayload,
    outputPayload,
    requestContext,
    scriptSets,
    modelRequest,
    generatedAt: safeOptionalDateISOString(source.generatedAt)
  };
}

function mergeVideoScriptFailureResult(existingResult, debugResult) {
  const existing = normalizeVideoScriptGenerationResult(existingResult);
  const debug = normalizeVideoScriptGenerationResult(debugResult);
  if (!debug) {
    return existing;
  }
  if (!existing) {
    return debug;
  }
  const debugOutput = normalizeVideoAgentOutputPayload(debug.outputPayload);
  if (hasVideoAgentStructuredOutput(debugOutput)) {
    return debug;
  }
  const existingOutput = normalizeVideoAgentOutputPayload(existing.outputPayload);
  const mergedOutputSource = {
    ...(existingOutput || {}),
    raw: safeObject(debugOutput?.raw) || safeObject(existingOutput?.raw) || null
  };
  const mergedOutput = normalizeVideoAgentOutputPayload(mergedOutputSource) || existing.outputPayload;
  return {
    ...existing,
    inputPayload: debug.inputPayload || existing.inputPayload,
    requestContext: debug.requestContext || existing.requestContext,
    modelRequest: debug.modelRequest || existing.modelRequest,
    outputPayload: mergedOutput,
    generatedAt: debug.generatedAt || existing.generatedAt
  };
}

function normalizeVideoScriptGenerationState(input) {
  const source = input && typeof input === "object" ? input : {};
  const status = String(source.status || "idle").trim();
  const safeStatus = ["idle", "processing", "completed", "failed"].includes(status) ? status : "idle";
  return {
    status: safeStatus,
    error: safeTextOrNull(source.error),
    updatedAt: safeOptionalDateISOString(source.updatedAt),
    result: normalizeVideoScriptGenerationResult(source.result)
  };
}

function normalizePromptPackProductProfile(input, fallbackAnalysis = null) {
  const source = safeObject(input) || {};
  const fallbackSource = safeObject(fallbackAnalysis) || {};
  const appearanceDetails = safeText(
    source.appearance_details || source.appearanceDetails || source.appearance_description || source.appearanceDescription,
    safeText(fallbackSource.appearance_description || fallbackSource.appearanceDescription)
  );
  const materialDetails = safeText(
    source.material_details || source.materialDetails || source.material_analysis || source.materialAnalysis,
    safeText(fallbackSource.material_analysis || fallbackSource.materialAnalysis)
  );
  const shapeDetails = safeText(
    source.shape_details ||
      source.shapeDetails ||
      source.shape_analysis ||
      source.shapeAnalysis ||
      source.structure_description ||
      source.structureDescription,
    safeText(fallbackSource.shape_details || fallbackSource.shapeDetails || fallbackSource.appearance_description || fallbackSource.appearanceDescription)
  );
  const sizeDetails = safeText(
    source.size_details || source.sizeDetails || source.size_and_specs || source.sizeAndSpecs || source.dimension_details || source.dimensionDetails,
    safeText(fallbackSource.size_and_specs || fallbackSource.sizeAndSpecs)
  );
  const colorDetails = safeText(
    source.color_details || source.colorDetails || source.color_analysis || source.colorAnalysis || source.color_info || source.colorInfo,
    safeText(fallbackSource.color_analysis || fallbackSource.colorAnalysis)
  );
  if (!appearanceDetails && !materialDetails && !shapeDetails && !sizeDetails && !colorDetails) {
    return null;
  }
  return {
    appearanceDetails,
    materialDetails,
    shapeDetails,
    sizeDetails,
    colorDetails
  };
}

function extractPromptPackProductProfile(secondPromptResult, analysisResult = null) {
  const resultSource = safeObject(secondPromptResult) || {};
  const requestContext = safeObject(resultSource.requestContext) || {};
  const outputSource = safeObject(resultSource.output) || {};
  const firstPassAnalysis = safeObject(requestContext.firstPassAnalysis) || {};
  const analysisFallback = safeObject(analysisResult)
    ? {
        material_analysis: safeText(analysisResult.materialAnalysis),
        appearance_description: safeText(analysisResult.appearanceDescription),
        size_and_specs: safeText(analysisResult.sizeAndSpecs),
        color_analysis: safeText(analysisResult.colorAnalysis)
      }
    : {};
  return normalizePromptPackProductProfile(
    requestContext.productProfile ||
      requestContext.product_profile ||
      outputSource.product_profile ||
      outputSource.productProfile ||
      outputSource.product_details ||
      outputSource.productDetails,
    {
      ...firstPassAnalysis,
      ...analysisFallback
    }
  );
}

function normalizeSecondPromptGenerationResult(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const requestContextSource = safeObject(input.requestContext) || {};
  const productReference = safeObject(requestContextSource.productReference) || {};
  const templateMeta = safeObject(requestContextSource.template) || {};
  const outputSource = safeObject(input.output) || {};
  const outputMetadata = safeObject(outputSource.metadata) || {};
  const localeSource = safeObject(requestContextSource.locale) || {};
  const locale = normalizePromptPackLocaleConfig({
    targetMarket: localeSource.targetMarket || localeSource.target_market || outputMetadata.target_market || outputMetadata.targetMarket,
    promptLanguage:
      localeSource.promptLanguage ||
      localeSource.prompt_language ||
      outputMetadata.prompt_language ||
      outputMetadata.promptLanguage ||
      outputMetadata.language_pair ||
      outputMetadata.languagePair ||
      outputMetadata.language,
    inImageTextLanguage:
      localeSource.inImageTextLanguage ||
      localeSource.in_image_text_language ||
      outputMetadata.in_image_text_language ||
      outputMetadata.inImageTextLanguage ||
      outputMetadata.text_overlay_language ||
      outputMetadata.textOverlayLanguage
  });
  const productProfile = extractPromptPackProductProfile(
    {
      requestContext: requestContextSource,
      output: outputSource
    },
    requestContextSource.firstPassAnalysis
  );
  return {
    referenceImageUrl: safeText(input.referenceImageUrl),
    templateVersion: safeText(input.templateVersion, "v2.1"),
    detailAspectRatio: DETAIL_PROMPT_ASPECT_RATIOS.has(safeText(input.detailAspectRatio || input.detail_aspect_ratio))
      ? safeText(input.detailAspectRatio || input.detail_aspect_ratio)
      : "9:16",
    requestContext: {
      productReference: {
        title: safeText(productReference.title, "unknown"),
        shop: safeText(productReference.shop, "unknown"),
        url: safeText(productReference.url, "unknown")
      },
      firstPassAnalysis: safeObject(requestContextSource.firstPassAnalysis) || {},
      productProfile,
      locale,
      template: {
        version: safeText(templateMeta.version, "v2.1"),
        required: Boolean(templateMeta.required),
        charLength: Number.isFinite(Number(templateMeta.charLength)) ? Number(templateMeta.charLength) : 0
      },
      qualityRetryUsed: Boolean(requestContextSource.qualityRetryUsed)
    },
    rawModelText: safeText(input.rawModelText),
    rawRepairedTextV1: safeText(input.rawRepairedTextV1),
    rawRepairedTextV2: safeText(input.rawRepairedTextV2),
    rawModelJson: safeObject(input.rawModelJson) || null,
    parseWarning: safeText(input.parseWarning),
    output: input.output && typeof input.output === "object" ? input.output : null,
    outputText: safeText(input.outputText),
    generatedAt: safeOptionalDateISOString(input.generatedAt)
  };
}

function normalizeDetailPromptAspectRatio(input) {
  const ratio = safeText(input, "9:16");
  return DETAIL_PROMPT_ASPECT_RATIOS.has(ratio) ? ratio : "9:16";
}

function normalizePromptPackLocaleConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  const targetMarket = safeText(source.targetMarket || source.target_market, DEFAULT_PROMPT_PACK_TARGET_MARKET);
  const promptLanguage = safeText(source.promptLanguage || source.prompt_language || source.language, DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE);
  const inImageTextLanguage = safeText(
    source.inImageTextLanguage ||
      source.in_image_text_language ||
      source.targetLanguage ||
      source.target_language ||
      source.imageTextLanguage ||
      source.image_text_language,
    DEFAULT_PROMPT_PACK_IN_IMAGE_TEXT_LANGUAGE
  );
  return {
    targetMarket,
    promptLanguage,
    inImageTextLanguage
  };
}

function buildShortVideoPromptOpening(localeConfig) {
  const locale = normalizePromptPackLocaleConfig(localeConfig);
  return [
    ...SHORT_VIDEO_PROMPT_BASE_OPENING,
    `硬性市场约束：人物设定、生活场景、消费偏好、镜头风格必须与目标市场 ${locale.targetMarket} 一致。`,
    `硬性语言约束：视频中所有人物对白、画面文字、旁白、字幕等面向观众的语言必须是 ${locale.inImageTextLanguage}。`,
    `硬性语言约束：禁止混入任何非 ${locale.inImageTextLanguage} 的面向观众语言。`
  ].join("\n");
}

function normalizeSecondPromptGenerationState(input) {
  const source = input && typeof input === "object" ? input : {};
  const status = String(source.status || "idle").trim();
  const safeStatus = ["idle", "processing", "completed", "failed"].includes(status) ? status : "idle";
  return {
    status: safeStatus,
    jobId: safeTextOrNull(source.jobId),
    error: safeTextOrNull(source.error),
    updatedAt: safeOptionalDateISOString(source.updatedAt),
    result: normalizeSecondPromptGenerationResult(source.result)
  };
}

function buildVideoClipTaskKey(setKey, clipIndex) {
  return `${safeText(setKey)}::${Math.max(0, Math.floor(Number(clipIndex) || 0))}`;
}

function normalizeVideoClipTask(input) {
  const source = input && typeof input === "object" ? input : {};
  const status = safeText(source.status || "idle");
  const safeStatus = ["idle", "queued", "processing", "succeeded", "failed"].includes(status) ? status : "idle";
  const setKey = safeText(source.setKey);
  const clipIndexRaw = Number(source.clipIndex);
  const clipIndex = Number.isFinite(clipIndexRaw) ? Math.max(0, Math.floor(clipIndexRaw)) : 0;
  const key = safeText(source.key, buildVideoClipTaskKey(setKey, clipIndex));
  const retryCountRaw = Number(source.retryCount);
  const maxRetriesRaw = Number(source.maxRetries);
  const retryCount = Number.isFinite(retryCountRaw) ? Math.max(0, Math.floor(retryCountRaw)) : 0;
  const maxRetries = Number.isFinite(maxRetriesRaw) ? Math.max(1, Math.floor(maxRetriesRaw)) : VIDEO_CLIP_MAX_RETRIES;
  return {
    key,
    setKey,
    clipIndex,
    status: safeStatus,
    jobId: safeTextOrNull(source.jobId),
    taskId: safeTextOrNull(source.taskId),
    prompt: safeText(source.prompt),
    firstFrameUrl: safeText(source.firstFrameUrl),
    lastFrameUrl: safeText(source.lastFrameUrl),
    urls: uniqueStrings(toArray(source.urls || source.images || [])).slice(0, 8),
    firstFrameName: safeText(source.firstFrameName),
    lastFrameName: safeText(source.lastFrameName),
    aspectRatio: safeText(source.aspectRatio, VEO_DEFAULT_ASPECT_RATIO),
    retryCount,
    maxRetries,
    videoUrl: safeText(source.videoUrl),
    error: safeTextOrNull(source.error),
    createdAt: safeOptionalDateISOString(source.createdAt),
    startedAt: safeOptionalDateISOString(source.startedAt),
    completedAt: safeOptionalDateISOString(source.completedAt),
    updatedAt: safeOptionalDateISOString(source.updatedAt)
  };
}

function normalizeVideoClipGenerationState(input) {
  const source = input && typeof input === "object" ? input : {};
  const items = Array.isArray(source.items)
    ? source.items
        .map((item) => normalizeVideoClipTask(item))
        .filter((item) => item.key && item.setKey)
    : [];
  return {
    updatedAt: safeOptionalDateISOString(source.updatedAt),
    items
  };
}

function normalizeCapturedImageUrl(input) {
  const raw = safeText(input);
  if (!raw || !/^https?:\/\//i.test(raw)) {
    return raw;
  }
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    return raw;
  }
  const hostname = safeText(parsed.hostname).toLowerCase();
  if (!/alicdn\.com$/.test(hostname)) {
    return raw;
  }
  const pathname = safeText(parsed.pathname);
  // 1688 常见图片后缀形态: xxx.jpg_.webp；在部分 Electron 环境会解码异常，回退到原始 jpg/png。
  const fixedPath = pathname.replace(/(\.(?:jpe?g|png|gif|bmp))_\.(?:webp|avif)$/i, "$1");
  if (!fixedPath || fixedPath === pathname) {
    return raw;
  }
  parsed.pathname = fixedPath;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeProduct(payload, existingProduct) {
  const capturedAt = safeDateISOString(payload?.capturedAt);
  const productUrl = String(payload?.url || payload?.productUrl || "").trim();
  const productId = extractProductId(productUrl, payload?.productId);
  const sourceImagesRaw = uniqueStrings(payload?.images || payload?.mainImages || []).map((item) => normalizeCapturedImageUrl(item));
  const sourceImages = sourceImagesRaw.filter((imageUrl) => isLikelyImageReference(imageUrl));
  const incomingTriggeredImage = normalizeCapturedImageUrl(
    String(payload?.triggeredImage || payload?.droppedImage || sourceImagesRaw[0] || "").trim()
  );
  const triggeredImage = isLikelyImageReference(incomingTriggeredImage) ? incomingTriggeredImage : sourceImages[0] || "";
  const images = uniqueStrings([triggeredImage, ...sourceImages]);
  const priceTiersSource = Array.isArray(payload?.priceTiers) ? payload?.priceTiers : existingProduct?.priceTiers;
  const skuDimensionsSource = Array.isArray(payload?.skuDimensions) ? payload?.skuDimensions : existingProduct?.skuDimensions;
  const skuItemsSource = Array.isArray(payload?.skuItems) ? payload?.skuItems : existingProduct?.skuItems;
  const attributesSource = Array.isArray(payload?.productAttributes)
    ? payload?.productAttributes
    : existingProduct?.productAttributes;
  const packageSpecsSource = Array.isArray(payload?.packageSpecs) ? payload?.packageSpecs : existingProduct?.packageSpecs;
  const categoryPath = normalizeCategoryPath(payload?.categoryPath || payload?.category?.path || existingProduct?.categoryPath);
  const categoryId = safeText(
    payload?.categoryId || payload?.category?.id || existingProduct?.categoryId || categoryPath.join(">")
  );
  const categoryName = safeText(
    payload?.categoryName || payload?.category?.name || existingProduct?.categoryName || categoryPath[categoryPath.length - 1]
  );

  const priceTiers = normalizePriceTiers(priceTiersSource);
  const skuItems = normalizeSkuItems(skuItemsSource);

  const allPrices = [
    ...priceTiers.map((item) => item.unitPrice),
    ...skuItems.map((item) => item.price)
  ].filter((item) => item !== null);
  const priceMin = parseNumber(payload?.priceMin) ?? (allPrices.length ? Math.min(...allPrices) : null);
  const priceMax = parseNumber(payload?.priceMax) ?? (allPrices.length ? Math.max(...allPrices) : null);
  const recordId = String(payload?.recordId || `${productId}_${capturedAt}`).trim();

  const hasIncomingAnalysis = Object.prototype.hasOwnProperty.call(payload || {}, "analysis");
  const analysisSource = hasIncomingAnalysis ? payload?.analysis : existingProduct?.analysis;
  const normalizedAnalysis = normalizeAnalysisState(analysisSource);
  const hasIncomingPromptGeneration = Object.prototype.hasOwnProperty.call(payload || {}, "promptGeneration");
  const promptGenerationSource = hasIncomingPromptGeneration ? payload?.promptGeneration : existingProduct?.promptGeneration;
  const hasIncomingVideoScriptGeneration = Object.prototype.hasOwnProperty.call(payload || {}, "videoScriptGeneration");
  const videoScriptGenerationSource = hasIncomingVideoScriptGeneration
    ? payload?.videoScriptGeneration
    : existingProduct?.videoScriptGeneration;
  const hasIncomingSecondPromptGeneration = Object.prototype.hasOwnProperty.call(payload || {}, "secondPromptGeneration");
  const secondPromptGenerationSource = hasIncomingSecondPromptGeneration
    ? payload?.secondPromptGeneration
    : existingProduct?.secondPromptGeneration;
  const hasIncomingVideoClipGeneration = Object.prototype.hasOwnProperty.call(payload || {}, "videoClipGeneration");
  const videoClipGenerationSource = hasIncomingVideoClipGeneration ? payload?.videoClipGeneration : existingProduct?.videoClipGeneration;

  return {
    recordId,
    productId,
    title: String(payload?.title || "Untitled Product").trim(),
    url: productUrl,
    shopName: String(payload?.shopName || "鏈煡搴楅摵").trim(),
    images,
    triggeredImage,
    skuDimensions: normalizeSkuDimensions(skuDimensionsSource),
    skuItems,
    priceTiers,
    priceMin,
    priceMax,
    productAttributes: normalizeProductAttributes(attributesSource),
    packageSpecs: normalizePackageSpecs(packageSpecsSource),
    categoryId,
    categoryName,
    categoryPath,
    capturedAt,
    source: String(payload?.source || "chrome-extension").trim(),
    analysis: normalizedAnalysis,
    promptGeneration: normalizePromptGenerationState(promptGenerationSource, normalizedAnalysis.result),
    videoScriptGeneration: normalizeVideoScriptGenerationState(videoScriptGenerationSource),
    secondPromptGeneration: normalizeSecondPromptGenerationState(secondPromptGenerationSource),
    videoClipGeneration: normalizeVideoClipGenerationState(videoClipGenerationSource)
  };
}

function sortProducts(items, sortBy, order) {
  const direction = order === "asc" ? 1 : -1;
  const safeSortBy = sortBy === "priceMin" ? "priceMin" : "capturedAt";
  return [...items].sort((a, b) => {
    if (safeSortBy === "priceMin") {
      if (a.priceMin === null && b.priceMin === null) {
        return 0;
      }
      if (a.priceMin === null) {
        return 1;
      }
      if (b.priceMin === null) {
        return -1;
      }
      const aValue = a.priceMin;
      const bValue = b.priceMin;
      return (aValue - bValue) * direction;
    }
    const aTime = new Date(a.capturedAt).getTime();
    const bTime = new Date(b.capturedAt).getTime();
    return (aTime - bTime) * direction;
  });
}

async function loadNormalizedProducts() {
  const items = await loadProducts();
  return items.map((item) => normalizeProduct(item, item));
}

function normalizeCatalogCategory(input) {
  const source = input && typeof input === "object" ? input : {};
  const id = safeText(source.id || source.categoryId);
  const name = safeText(source.name || source.categoryName);
  if (!id || !name) {
    return null;
  }
  if (/^https?:\/\//i.test(name) || /^https?:\/\//i.test(id)) {
    return null;
  }
  return {
    id,
    name,
    path: normalizeCategoryPath(source.path || source.categoryPath || name),
    parentId: safeText(source.parentId) || null,
    source: safeText(source.source, "website-sync"),
    active: source.active !== false
  };
}

async function listAvailableCategories() {
  await syncCategoryCatalogFromProducts();
  const [catalog, products] = await Promise.all([loadCategories(), loadNormalizedProducts()]);
  const categoryMap = new Map(
    catalog
      .map((item) => normalizeCatalogCategory(item))
      .filter((item) => item?.active !== false)
      .filter(Boolean)
      .map((item) => [item.id, item])
  );

  for (const product of products) {
    const id = safeText(product.categoryId);
    const name = safeText(product.categoryName);
    if (!id || !name) {
      continue;
    }
    if (/^https?:\/\//i.test(id) || /^https?:\/\//i.test(name)) {
      continue;
    }
    if (!categoryMap.has(id)) {
      categoryMap.set(id, {
        id,
        name,
        path: normalizeCategoryPath(product.categoryPath),
        parentId: null,
        source: "product-capture",
        active: true
      });
    }
  }
  return [...categoryMap.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

async function listWebsiteSyncedCategories() {
  const categories = await loadCategories();
  return categories
    .map((item) => normalizeCatalogCategory(item))
    .filter(Boolean)
    .filter((item) => item.active !== false)
    .filter((item) => item.id !== FALLBACK_CATEGORY_ID)
    .filter((item) => safeText(item.source) !== "product-capture")
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

async function syncCategoryCatalogFromProducts() {
  const products = await loadNormalizedProducts();
  const capturedCategories = products
    .map((item) => {
      if (!item.categoryId || !item.categoryName) {
        return null;
      }
      if (/^https?:\/\//i.test(item.categoryId) || /^https?:\/\//i.test(item.categoryName)) {
        return null;
      }
      return {
        id: item.categoryId,
        name: item.categoryName,
        path: normalizeCategoryPath(item.categoryPath),
        source: "product-capture",
        active: true
      };
    })
    .filter(Boolean);
  if (!capturedCategories.length) {
    return;
  }
  const current = await loadCategories();
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of capturedCategories) {
    if (map.has(item.id)) {
      continue;
    }
    map.set(item.id, item);
  }
  await syncCategories([...map.values()]);
}

async function ensureValidCategorySelection(categoryId) {
  const categories = await listAvailableCategories();
  const byId = new Map(categories.map((item) => [item.id, item]));
  const selected = byId.get(safeText(categoryId));
  return {
    categories,
    selected: selected || byId.get(FALLBACK_CATEGORY_ID) || categories[0] || null
  };
}

async function reassignOrphanKnowledgeCategories(activeCategories) {
  const activeSet = new Set(
    toArray(activeCategories)
      .filter((item) => item.active !== false)
      .map((item) => safeText(item.id || item.categoryId))
      .filter(Boolean)
  );
  activeSet.add(FALLBACK_CATEGORY_ID);

  const db = await loadImageKnowledgeBase();
  const orphanIds = Object.keys(db.categories).filter((categoryId) => !activeSet.has(categoryId));
  if (!orphanIds.length) {
    return;
  }

  const fallbackCategory = ensureKnowledgeCategory(db, FALLBACK_CATEGORY_ID, "未归类");
  for (const orphanId of orphanIds) {
    const orphanBucket = db.categories[orphanId];
    if (!orphanBucket?.items?.length) {
      delete db.categories[orphanId];
      continue;
    }
    for (const item of orphanBucket.items) {
      fallbackCategory.items.push({
        ...item,
        categoryId: FALLBACK_CATEGORY_ID,
        updatedAt: new Date().toISOString()
      });
    }
    delete db.categories[orphanId];
  }
  recalcCategoryTotalLength(fallbackCategory);
  await saveImageKnowledgeBase(db);
}

function findCategoryById(categories, categoryId) {
  return toArray(categories).find((item) => safeText(item?.id || item?.categoryId) === safeText(categoryId)) || null;
}

async function updateProductsCategoryMapping(sourceCategoryId, targetCategory) {
  const safeSourceId = safeText(sourceCategoryId);
  if (!safeSourceId) {
    return 0;
  }
  const targetId = safeText(targetCategory?.id || targetCategory?.categoryId);
  const targetName = safeText(targetCategory?.name || targetCategory?.categoryName);
  const targetPath = normalizeCategoryPath(targetCategory?.path || targetCategory?.categoryPath);

  const items = await loadProducts();
  let updated = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    if (safeText(item.categoryId) !== safeSourceId) {
      continue;
    }
    items[i] = {
      ...item,
      categoryId: targetId,
      categoryName: targetName,
      categoryPath: targetPath
    };
    updated += 1;
  }
  if (updated > 0) {
    await saveProducts(items);
  }
  return updated;
}

async function moveKnowledgeCategory(sourceCategoryId, targetCategory) {
  const sourceId = safeText(sourceCategoryId);
  const targetId = safeText(targetCategory?.id || targetCategory?.categoryId);
  const targetName = safeText(targetCategory?.name || targetCategory?.categoryName, targetId);
  if (!sourceId || !targetId || sourceId === targetId) {
    return { movedItems: 0 };
  }

  const db = await loadImageKnowledgeBase();
  const sourceBucket = db.categories[sourceId];
  if (!sourceBucket) {
    return { movedItems: 0 };
  }
  const targetBucket = ensureKnowledgeCategory(db, targetId, targetName);
  const sourceItems = toArray(sourceBucket.items);
  for (const item of sourceItems) {
    targetBucket.items.push({
      ...item,
      categoryId: targetId,
      updatedAt: new Date().toISOString()
    });
  }
  targetBucket.compressedKnowledge = null;
  recalcCategoryTotalLength(targetBucket);
  delete db.categories[sourceId];
  await saveImageKnowledgeBase(db);
  return { movedItems: sourceItems.length };
}

async function removeCategoryFromCatalog(categoryId) {
  const sourceId = safeText(categoryId);
  if (!sourceId || sourceId === FALLBACK_CATEGORY_ID) {
    return 0;
  }
  const categories = await loadCategories();
  const next = categories.filter((item) => safeText(item?.id || item?.categoryId) !== sourceId);
  if (next.length === categories.length) {
    return 0;
  }
  await saveCategories(next);
  return 1;
}

async function mergeCategoriesAndData(sourceCategoryId, targetCategoryId) {
  const sourceId = safeText(sourceCategoryId);
  const targetId = safeText(targetCategoryId);
  if (!sourceId || !targetId || sourceId === targetId) {
    throw new Error("Invalid merge category ids.");
  }
  const categories = await listAvailableCategories();
  const knowledgeDb = await loadImageKnowledgeBase();
  let source = findCategoryById(categories, sourceId);
  let target = findCategoryById(categories, targetId);
  if (!source && knowledgeDb.categories[sourceId]) {
    source = {
      id: sourceId,
      name: safeText(knowledgeDb.categories[sourceId].categoryName, sourceId),
      path: [safeText(knowledgeDb.categories[sourceId].categoryName, sourceId)],
      source: "knowledge-base",
      active: true
    };
  }
  if (!target && knowledgeDb.categories[targetId]) {
    target = {
      id: targetId,
      name: safeText(knowledgeDb.categories[targetId].categoryName, targetId),
      path: [safeText(knowledgeDb.categories[targetId].categoryName, targetId)],
      source: "knowledge-base",
      active: true
    };
  }
  if (!source) {
    throw new Error("Source category not found.");
  }
  if (!target) {
    throw new Error("Target category not found.");
  }
  if (source.id === FALLBACK_CATEGORY_ID) {
    throw new Error("Fallback category cannot be merged into another category.");
  }

  const productUpdated = await updateProductsCategoryMapping(source.id, target);
  const knowledgeMoved = await moveKnowledgeCategory(source.id, target);
  await removeCategoryFromCatalog(source.id);
  return {
    source,
    target,
    productUpdated,
    knowledgeMoved: knowledgeMoved.movedItems
  };
}

async function deleteCategoryAndReassign(categoryId, targetCategoryId) {
  const sourceId = safeText(categoryId);
  if (!sourceId || sourceId === FALLBACK_CATEGORY_ID) {
    throw new Error("Fallback category cannot be deleted.");
  }
  const categories = await listAvailableCategories();
  const knowledgeDb = await loadImageKnowledgeBase();
  let source = findCategoryById(categories, sourceId);
  if (!source && knowledgeDb.categories[sourceId]) {
    source = {
      id: sourceId,
      name: safeText(knowledgeDb.categories[sourceId].categoryName, sourceId),
      path: [safeText(knowledgeDb.categories[sourceId].categoryName, sourceId)],
      source: "knowledge-base",
      active: true
    };
  }
  if (!source) {
    throw new Error("Category not found.");
  }
  const targetId = safeText(targetCategoryId, FALLBACK_CATEGORY_ID);
  const target =
    findCategoryById(categories, targetId) ||
    (knowledgeDb.categories[targetId]
      ? {
          id: targetId,
          name: safeText(knowledgeDb.categories[targetId].categoryName, targetId),
          path: [safeText(knowledgeDb.categories[targetId].categoryName, targetId)],
          source: "knowledge-base",
          active: true
        }
      : null) ||
    findCategoryById(categories, FALLBACK_CATEGORY_ID);
  if (!target) {
    throw new Error("Target category not found.");
  }
  if (source.id === target.id) {
    throw new Error("Delete target cannot be the same as source category.");
  }

  const productUpdated = await updateProductsCategoryMapping(source.id, target);
  const knowledgeMoved = await moveKnowledgeCategory(source.id, target);
  await removeCategoryFromCatalog(source.id);
  return {
    source,
    target,
    productUpdated,
    knowledgeMoved: knowledgeMoved.movedItems
  };
}

async function updateProductByRecordId(recordId, updater) {
  const items = await loadProducts();
  const index = items.findIndex((item) => item.recordId === recordId);
  if (index < 0) {
    return { ok: false, item: null, updated: false };
  }
  const current = normalizeProduct(items[index], items[index]);
  const next = updater(current);
  if (!next) {
    return { ok: true, item: current, updated: false };
  }
  items[index] = next;
  await saveProducts(items);
  return { ok: true, item: next, updated: true };
}

async function setAnalysisState(recordId, partialState, expectedJobId = null) {
  return updateProductByRecordId(recordId, (current) => {
    const currentJobId = current.analysis?.jobId;
    if (expectedJobId && currentJobId && currentJobId !== expectedJobId) {
      return null;
    }
    const merged = {
      ...current.analysis,
      ...partialState
    };
    return {
      ...current,
      analysis: normalizeAnalysisState(merged)
    };
  });
}

async function setPromptGenerationState(recordId, partialState) {
  return updateProductByRecordId(recordId, (current) => {
    const merged = {
      ...current.promptGeneration,
      ...partialState
    };
    return {
      ...current,
      promptGeneration: normalizePromptGenerationState(merged, current.analysis?.result || null)
    };
  });
}

async function setVideoScriptGenerationState(recordId, partialState) {
  return updateProductByRecordId(recordId, (current) => {
    const merged = {
      ...current.videoScriptGeneration,
      ...partialState
    };
    return {
      ...current,
      videoScriptGeneration: normalizeVideoScriptGenerationState(merged)
    };
  });
}

async function setSecondPromptGenerationState(recordId, partialState, expectedJobId = null) {
  return updateProductByRecordId(recordId, (current) => {
    const currentJobId = current.secondPromptGeneration?.jobId;
    if (expectedJobId && currentJobId && currentJobId !== expectedJobId) {
      return null;
    }
    const merged = {
      ...current.secondPromptGeneration,
      ...partialState
    };
    return {
      ...current,
      secondPromptGeneration: normalizeSecondPromptGenerationState(merged)
    };
  });
}

async function setVideoClipGenerationState(recordId, partialState) {
  return updateProductByRecordId(recordId, (current) => {
    const merged = {
      ...current.videoClipGeneration,
      ...partialState
    };
    return {
      ...current,
      videoClipGeneration: normalizeVideoClipGenerationState(merged)
    };
  });
}

async function upsertVideoClipTaskState(recordId, setKey, clipIndex, partialTaskState) {
  const safeSetKey = safeText(setKey);
  const safeClipIndex = Math.max(0, Math.floor(Number(clipIndex) || 0));
  const key = buildVideoClipTaskKey(safeSetKey, safeClipIndex);
  return updateProductByRecordId(recordId, (current) => {
    const currentState = normalizeVideoClipGenerationState(current.videoClipGeneration);
    const now = new Date().toISOString();
    const items = [...currentState.items];
    const index = items.findIndex((item) => item.key === key);
    const base = index >= 0
      ? items[index]
      : normalizeVideoClipTask({
          key,
          setKey: safeSetKey,
          clipIndex: safeClipIndex,
          status: "idle",
          createdAt: now,
          updatedAt: now
        });
    const merged = normalizeVideoClipTask({
      ...base,
      ...partialTaskState,
      key,
      setKey: safeSetKey,
      clipIndex: safeClipIndex,
      updatedAt: now
    });
    if (!merged.createdAt) {
      merged.createdAt = now;
    }
    if (index >= 0) {
      items[index] = merged;
    } else {
      items.push(merged);
    }
    return {
      ...current,
      videoClipGeneration: normalizeVideoClipGenerationState({
        ...currentState,
        updatedAt: now,
        items
      })
    };
  });
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_API_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const host = req.get("host");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim();
  const protocol = forwardedProto || req.protocol || "http";
  return `${protocol}://${host}`;
}

function parseBase64ImageInput(input) {
  const source = safeText(input);
  if (!source) {
    return null;
  }
  const dataUrlMatch = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch?.[1] && dataUrlMatch?.[2]) {
    const mimeType = safeText(dataUrlMatch[1], "image/jpeg");
    const buffer = Buffer.from(dataUrlMatch[2], "base64");
    if (!buffer.length) {
      throw new Error("Image payload is empty.");
    }
    return { mimeType, buffer };
  }
  const rawBase64 = source.replace(/\s+/g, "");
  const buffer = Buffer.from(rawBase64, "base64");
  if (!buffer.length) {
    throw new Error("Image payload is invalid.");
  }
  return { mimeType: "image/jpeg", buffer };
}

let cachedSecondPromptTemplate = "";
let cachedSecondPromptTemplateMtimeMs = 0;
let cachedVideoPromptSpecTemplate = "";
let cachedVideoPromptSpecTemplateMtimeMs = 0;

async function loadSecondPromptTemplate() {
  let stat = null;
  try {
    stat = await fs.stat(SECOND_PROMPT_TEMPLATE_FILE);
  } catch (_error) {
    stat = null;
  }
  const latestMtimeMs = Number(stat?.mtimeMs || 0);
  if (cachedSecondPromptTemplate && cachedSecondPromptTemplateMtimeMs === latestMtimeMs && latestMtimeMs > 0) {
    return cachedSecondPromptTemplate;
  }
  const content = await fs.readFile(SECOND_PROMPT_TEMPLATE_FILE, "utf8");
  cachedSecondPromptTemplate = safeText(content);
  cachedSecondPromptTemplateMtimeMs = latestMtimeMs;
  if (!cachedSecondPromptTemplate) {
    throw new Error("Second prompt template is empty.");
  }
  return cachedSecondPromptTemplate;
}

async function loadVideoPromptSpecTemplate() {
  let stat = null;
  try {
    stat = await fs.stat(VIDEO_PROMPT_SPEC_FILE);
  } catch (_error) {
    stat = null;
  }
  const latestMtimeMs = Number(stat?.mtimeMs || 0);
  if (cachedVideoPromptSpecTemplate && cachedVideoPromptSpecTemplateMtimeMs === latestMtimeMs && latestMtimeMs > 0) {
    return cachedVideoPromptSpecTemplate;
  }
  const content = await fs.readFile(VIDEO_PROMPT_SPEC_FILE, "utf8");
  cachedVideoPromptSpecTemplate = safeText(content);
  cachedVideoPromptSpecTemplateMtimeMs = latestMtimeMs;
  if (!cachedVideoPromptSpecTemplate) {
    throw new Error("Video prompt spec template is empty.");
  }
  return cachedVideoPromptSpecTemplate;
}

function ensureFetchSupport() {
  if (typeof fetch !== "function") {
    throw new Error("Current Node runtime does not support fetch.");
  }
}

function chooseImageMimeType(contentType, url = "") {
  const normalized = safeText(contentType).toLowerCase();
  if (normalized.startsWith("image/")) {
    return normalized.split(";")[0];
  }
  const lowerUrl = safeText(url).toLowerCase();
  if (lowerUrl.endsWith(".png")) {
    return "image/png";
  }
  if (lowerUrl.endsWith(".webp")) {
    return "image/webp";
  }
  if (lowerUrl.endsWith(".gif")) {
    return "image/gif";
  }
  return "image/jpeg";
}

async function fetchImageAsDataUrl(url, referer = "") {
  const fetched = await fetchRemoteImageBuffer(url, {
    referer,
    timeoutMs: 45000
  });
  if (!fetched) {
    return "";
  }
  return `data:${fetched.mimeType};base64,${fetched.buffer.toString("base64")}`;
}

async function fetchRemoteImageBuffer(url, options = {}) {
  ensureFetchSupport();
  const target = safeText(url);
  if (!/^https?:\/\//i.test(target)) {
    return null;
  }
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(2000, Math.min(120000, Math.floor(Number(options.timeoutMs))))
    : 45000;
  const safeReferer = safeText(options.referer);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };
    if (safeReferer) {
      headers.Referer = safeReferer;
    }
    const response = await fetch(target, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error("Image payload is empty.");
    }
    const mimeType = chooseImageMimeType(response.headers.get("content-type"), target);
    return { mimeType, buffer };
  } finally {
    clearTimeout(timer);
  }
}

function formatPromptPackProductProfileText(profile) {
  const normalized = normalizePromptPackProductProfile(profile);
  if (!normalized) {
    return "";
  }
  const lines = [
    normalized.appearanceDetails ? `appearance_details: ${normalized.appearanceDetails}` : "",
    normalized.materialDetails ? `material_details: ${normalized.materialDetails}` : "",
    normalized.shapeDetails ? `shape_details: ${normalized.shapeDetails}` : "",
    normalized.sizeDetails ? `size_details: ${normalized.sizeDetails}` : "",
    normalized.colorDetails ? `color_details: ${normalized.colorDetails}` : ""
  ].filter(Boolean);
  return lines.join("；");
}

async function buildVideoAgentInputPayload({ analysisResult, secondPromptResult = null, existingInputPayload = null }) {
  const existing = normalizeVideoAgentInputPayload(existingInputPayload) || {
    product_images: [],
    product_params: {}
  };
  const analysis = analysisResult && typeof analysisResult === "object" ? analysisResult : {};
  const promptPackProductProfile = extractPromptPackProductProfile(secondPromptResult, analysis);
  const promptPackProfileText = formatPromptPackProductProfileText(promptPackProductProfile);
  const fallbackDescription = [
    safeText(analysis.materialAnalysis),
    safeText(analysis.appearanceDescription),
    safeText(analysis.colorAnalysis),
    safeText(analysis.sizeAndSpecs),
    safeText(analysis.usageAndTargetAudience)
  ]
    .filter(Boolean)
    .join("；");
  const existingParams = safeObject(existing.product_params) || {};
  const productDescription = safeText(
    existingParams.product_description || existingParams.productDescription,
    safeText(promptPackProfileText, safeText(analysis.detailedDescription, fallbackDescription))
  );

  return {
    product_images: [],
    product_params: {
      ...existingParams,
      prompt_pack_product_profile: promptPackProductProfile || {},
      product_description: productDescription
    }
  };
}

function mergeVideoAgentInputPayload(baseInputPayload, overrideInputPayload) {
  const base = normalizeVideoAgentInputPayload(baseInputPayload) || {
    product_images: [],
    product_params: {}
  };
  const override = normalizeVideoAgentInputPayload(overrideInputPayload);
  if (!override) {
    return base;
  }
  const baseParams = safeObject(base.product_params) || {};
  const overrideParams = safeObject(override.product_params) || {};
  return {
    product_images: [],
    product_params: {
      ...baseParams,
      ...overrideParams
    }
  };
}

function objectToInfoText(input, depth = 0) {
  const source = safeObject(input);
  if (!source || depth > 2) {
    return "";
  }
  const lines = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) {
      continue;
    }
    const label = safeText(key);
    if (!label) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = safeText(value);
      if (text) {
        lines.push(`${label}: ${text}`);
      }
      continue;
    }
    if (Array.isArray(value)) {
      const items = uniqueStrings(value.map((item) => safeText(item)).filter(Boolean));
      if (items.length) {
        lines.push(`${label}: ${items.join(" / ")}`);
      }
      continue;
    }
    if (value && typeof value === "object") {
      const nested = objectToInfoText(value, depth + 1);
      if (nested) {
        lines.push(`${label}: ${nested}`);
      }
    }
  }
  return lines.join("；");
}

function toVideoProductInfoText(productParams, analysisResult = null) {
  const params = safeObject(productParams) || {};
  const priorityDetailedDescription = safeText(
    params.priority_detailed_description ||
      params.priorityDetailedDescription ||
      params.detailed_description ||
      params.detailedDescription
  );
  const promptPackProfile = normalizePromptPackProductProfile(
    params.prompt_pack_product_profile || params.promptPackProductProfile || params.product_profile || params.productProfile
  );
  const promptPackProfileText = formatPromptPackProductProfileText(promptPackProfile);
  const customObject = safeObject(
    params.product_info_customized ||
      params.custom_product_info ||
      params.product_info ||
      params.productInfo
  );
  const explicitDescription = safeText(
    params.product_description ||
      params.productDescription ||
      params.product_info_text ||
      params.productInfoText
  );
  const customObjectText = objectToInfoText(customObject);
  const paramsText = objectToInfoText(params);
  const analysis = safeObject(analysisResult) || {};
  const analysisFallback = [
    safeText(analysis.materialAnalysis),
    safeText(analysis.appearanceDescription),
    safeText(analysis.colorAnalysis),
    safeText(analysis.sizeAndSpecs),
    safeText(analysis.usageAndTargetAudience),
    safeText(analysis.detailedDescription)
  ]
    .filter(Boolean)
    .join("；");
  const prioritizedSections = [
    promptPackProfileText ? `highest_priority_prompt_pack_profile: ${promptPackProfileText}` : "",
    priorityDetailedDescription ? `highest_priority_user_detailed_description: ${priorityDetailedDescription}` : "",
    explicitDescription ? `product_description: ${explicitDescription}` : "",
    customObjectText ? `product_info_customized: ${customObjectText}` : "",
    paramsText ? `product_params: ${paramsText}` : "",
    analysisFallback ? `analysis_fallback: ${analysisFallback}` : ""
  ].filter(Boolean);
  return prioritizedSections.join("\n");
}

function extractVideoScriptInputPayloadOverride(payload) {
  const source = safeObject(payload);
  if (!source) {
    return null;
  }
  const overrideFromInput = normalizeVideoAgentInputPayload(
    source.inputPayload || source.input_payload || source.videoAgentInputPayload
  );
  const override = overrideFromInput || {
    product_images: [],
    product_params: {}
  };
  const currentParams = safeObject(override.product_params) || {};
  const bodyParamsNormalized = normalizeVideoAgentInputPayload({
    product_params: source.product_params || source.productParams
  });
  const bodyParams = safeObject(bodyParamsNormalized?.product_params) || {};
  const customProductInfo = safeObject(source.product_info || source.productInfo);
  const productDescription = safeText(
    source.product_description ||
      source.productDescription ||
      source.custom_product_description ||
      source.customProductDescription
  );
  const productInfoText = safeText(
    source.product_info_text ||
      source.productInfoText ||
      (typeof source.product_info === "string" ? source.product_info : "") ||
      (typeof source.productInfo === "string" ? source.productInfo : "")
  );
  const priorityDetailedDescription = safeText(
    source.priority_detailed_description ||
      source.priorityDetailedDescription ||
      source.detailed_description ||
      source.detailedDescription ||
      bodyParams.priority_detailed_description ||
      bodyParams.priorityDetailedDescription
  );
  const mergedParams = {
    ...currentParams,
    ...bodyParams
  };
  if (customProductInfo) {
    mergedParams.product_info_customized = customProductInfo;
  }
  if (productDescription) {
    mergedParams.product_description = productDescription;
  } else if (productInfoText) {
    mergedParams.product_description = productInfoText;
  }
  if (priorityDetailedDescription) {
    mergedParams.priority_detailed_description = priorityDetailedDescription;
  }
  const hasImages = toArray(override.product_images).length > 0;
  const hasParams = Object.keys(mergedParams).length > 0;
  if (!hasImages && !hasParams) {
    return null;
  }
  return {
    product_images: hasImages ? toArray(override.product_images) : [],
    product_params: mergedParams
  };
}

function findFirstJsonObjectBlock(source) {
  const text = safeText(source);
  const start = text.indexOf("{");
  if (start < 0) {
    return "";
  }
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return "";
}

function normalizeJsonCandidate(candidate) {
  return safeText(candidate)
    .replace(/\u201c|\u201d/g, "\"")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function collectJsonObjectCandidates(text) {
  const source = safeText(text);
  if (!source) {
    return [];
  }
  const candidates = [];
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let matched = fencedPattern.exec(source);
  while (matched) {
    if (matched[1]) {
      candidates.push(safeText(matched[1]));
    }
    matched = fencedPattern.exec(source);
  }
  const balanced = findFirstJsonObjectBlock(source);
  if (balanced) {
    candidates.push(balanced);
  } else {
    const firstBrace = source.indexOf("{");
    const lastBrace = source.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(source.slice(firstBrace, lastBrace + 1));
    }
  }
  return uniqueStrings(candidates.filter(Boolean));
}

function parseJsonObjectCandidate(text, depth = 0) {
  const source = safeText(text);
  if (!source || depth > 3) {
    return null;
  }
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    if (typeof parsed === "string") {
      return parseJsonObjectCandidate(parsed, depth + 1);
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function parseJsonObject(value) {
  if (value && typeof value === "object") {
    return value;
  }
  const text = safeText(value);
  if (!text) {
    return null;
  }
  const direct = parseJsonObjectCandidate(text);
  if (direct) {
    return direct;
  }
  const candidates = collectJsonObjectCandidates(text);
  for (const raw of candidates) {
    const attempts = [safeText(raw), normalizeJsonCandidate(raw)];
    for (const candidate of attempts) {
      const parsed = parseJsonObjectCandidate(candidate, 1);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}

function pickVideoAgentOutput(payload) {
  const source = parseJsonObject(payload);
  if (!source) {
    return null;
  }
  const direct =
    parseJsonObject(source.output) ||
    parseJsonObject(source.data) ||
    parseJsonObject(source.result) ||
    parseJsonObject(source.payload);
  const candidate = direct || source;
  if (safeObject(candidate?.script_set_1) || safeObject(candidate?.script_set_2) || safeObject(candidate?.script_set_3)) {
    return candidate;
  }
  return candidate;
}

function toPlainBase64FromImageInput(input) {
  const source = safeText(input);
  if (!source) {
    return "";
  }
  const dataUrlMatch = source.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
  if (dataUrlMatch?.[1]) {
    return safeText(dataUrlMatch[1]).replace(/\s+/g, "");
  }
  return source.replace(/\s+/g, "");
}

function extractOpenAiLikeTextContent(payload) {
  const source = safeObject(payload) || {};
  const flattenTextParts = (value) => {
    if (typeof value === "string") {
      return safeText(value);
    }
    if (!Array.isArray(value)) {
      return "";
    }
    return value
      .map((part) => {
        if (typeof part === "string") {
          return safeText(part);
        }
        if (part?.type === "text" || part?.type === "output_text") {
          return safeText(part?.text);
        }
        if (Array.isArray(part?.content)) {
          return flattenTextParts(part.content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  };

  const directText = safeText(source.output_text || source.outputText || source.text);
  if (directText) {
    return directText;
  }

  const firstChoice = toArray(source.choices)?.[0] || {};
  const message = safeObject(firstChoice.message) || {};
  const messageText = flattenTextParts(message.content);
  if (messageText) {
    return messageText;
  }
  const choiceText = safeText(firstChoice.text);
  if (choiceText) {
    return choiceText;
  }

  const outputText = toArray(source.output)
    .map((item) => {
      const current = safeObject(item) || {};
      const nestedText = flattenTextParts(current.content);
      return safeText(current.text, nestedText);
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  if (outputText) {
    return outputText;
  }

  const candidateText = toArray(source.candidates)
    .map((item) => {
      const current = safeObject(item) || {};
      const content = safeObject(current.content) || {};
      return toArray(content.parts)
        .map((part) => safeText(part?.text))
        .filter(Boolean)
        .join("\n")
        .trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  if (candidateText) {
    return candidateText;
  }

  const nestedData = safeObject(source.data);
  if (nestedData && nestedData !== source) {
    return extractOpenAiLikeTextContent(nestedData);
  }
  return "";
}

function normalizeShortVideoShot(input, index) {
  const source = safeObject(input) || {};
  const shotId = safeText(source.shot_id || source.shotId, `shot_${String(index + 1).padStart(2, "0")}`);
  const imagePrompt = safeText(source.image_prompt || source.imagePrompt);
  const videoPrompt = safeText(source.video_prompt || source.videoPrompt);
  const manualShootRequired = Boolean(source.manual_shoot_required ?? source.manualShootRequired);
  const manualShootScript = safeTextOrNull(source.manual_shoot_script ?? source.manualShootScript);
  return {
    shot_id: shotId,
    image_prompt: imagePrompt,
    video_prompt: videoPrompt,
    manual_shoot_required: manualShootRequired,
    manual_shoot_script: manualShootRequired ? manualShootScript : null
  };
}

function normalizeShortVideoScriptPackage(input, index) {
  const source = safeObject(input) || {};
  const scriptId = safeText(source.script_id || source.scriptId, `script_${String(index + 1).padStart(2, "0")}`);
  const shotsRaw = Array.isArray(source.shots) ? source.shots : [];
  const shots = shotsRaw.map((item, shotIndex) => normalizeShortVideoShot(item, shotIndex)).filter((shot) => shot.video_prompt);
  return {
    script_id: scriptId,
    digital_human_base_image_prompt: safeText(
      source.digital_human_base_image_prompt || source.digitalHumanBaseImagePrompt
    ),
    shots
  };
}

function normalizeShortVideoOutputPayload(input) {
  return (
    normalizeVideoAgentOutputPayload(input) || {
      product_info: null,
      product_analysis: null,
      scripts: [],
      script_variants: [],
      script_set_1: null,
      script_set_2: null,
      script_set_3: null,
      production_notes: null,
      raw: null
    }
  );
}

function convertShortVideoScriptsToLegacySets(scripts) {
  return toArray(scripts)
    .map((script, scriptIndex) => {
      const scriptId = safeText(script?.script_id, `script_${String(scriptIndex + 1).padStart(2, "0")}`);
      const shots = toArray(script?.shots);
      if (!shots.length) {
        return null;
      }
      const clips = shots
        .map((shot, shotIndex) => {
          const source = safeObject(shot) || {};
          const imagePrompt = safeText(source.image_prompt || source.imagePrompt);
          const videoPrompt = safeText(source.video_prompt || source.videoPrompt);
          if (!videoPrompt) {
            return null;
          }
          const manualShootRequired = Boolean(source.manual_shoot_required ?? source.manualShootRequired);
          const manualShootScript = safeText(source.manual_shoot_script ?? source.manualShootScript);
          return {
            clipNumber: shotIndex + 1,
            duration: "8s",
            sceneType: safeText(source.shot_id || source.shotId, `shot_${shotIndex + 1}`),
            sceneDescription: imagePrompt,
            marketingPurpose: manualShootRequired ? "需人工实拍" : "AI生成",
            generationMethod: manualShootRequired ? "manual" : "ai",
            aiOrReal: manualShootRequired ? "real" : "ai",
            firstFramePrompt: imagePrompt,
            lastFramePrompt: "",
            videoAudioPrompt: videoPrompt,
            imageGenerationPrompt: imagePrompt,
            videoGenerationPrompt: videoPrompt,
            audioDescription: "",
            narrationPortuguese: "",
            visualElements: "",
            styleNotes: manualShootScript
          };
        })
        .filter(Boolean);
      if (!clips.length) {
        return null;
      }
      return {
        setKey: `script_set_${scriptIndex + 1}`,
        scriptName: scriptId,
        strategy: "",
        targetAudience: "",
        totalDuration: `${clips.length * 8}s`,
        videoStructure: "3-shot structure",
        clips,
        raw: script
      };
    })
    .filter(Boolean);
}

function buildShortVideoPromptUserPayload({ product, analysisResult, inputPayload, specText, localeConfig = null }) {
  const normalizedInput = normalizeVideoAgentInputPayload(inputPayload) || { product_images: [], product_params: {} };
  const productParams = safeObject(normalizedInput.product_params) || {};
  const productInfoText = toVideoProductInfoText(productParams, analysisResult);
  const locale = normalizePromptPackLocaleConfig(localeConfig);
  const priorityDetailedDescription = safeText(
    productParams.priority_detailed_description ||
      productParams.priorityDetailedDescription ||
      productParams.detailed_description ||
      productParams.detailedDescription
  );
  const promptPackProductProfile = normalizePromptPackProductProfile(
    productParams.prompt_pack_product_profile || productParams.promptPackProductProfile || productParams.product_profile || productParams.productProfile
  );
  return {
    opening: buildShortVideoPromptOpening(locale),
    task:
      `请严格根据规范文档生成短视频提示词，不要遗漏字段。请基于图词请求阶段产出的产品细节信息（外观/材质/形状/尺寸/颜色）进行生成，并将该信息作为最高优先级参考源。目标市场为 ${locale.targetMarket}，画面风格、人物设定和生活场景必须符合该市场偏好。所有提示词内容必须为英文；面向观众的对白/画面文字/旁白/字幕必须全部使用 ${locale.inImageTextLanguage}，不得混入其他语言。`,
    product_reference: {
      title: safeText(product?.title),
      shop_name: safeText(product?.shopName),
      product_url: safeText(product?.url),
      image_count: 0
    },
    locale: {
      target_market: locale.targetMarket,
      prompt_language: locale.promptLanguage,
      in_image_text_language: locale.inImageTextLanguage
    },
    product_info: productInfoText,
    priority_detailed_description: priorityDetailedDescription || null,
    product_params: productParams,
    prompt_pack_product_profile: promptPackProductProfile || null,
    first_pass_analysis: safeObject(analysisResult) || {},
    generation_constraints_document: safeText(specText)
  };
}

async function requestShortVideoPromptScripts({ product, analysisResult, inputPayload, localeConfig = null }) {
  ensureFetchSupport();
  const apiKey = getShortVideoPromptApiKey();
  if (!apiKey) {
    throw new Error("Server is missing SHORT_VIDEO_PROMPT_API_KEY.");
  }
  const endpoint = safeText(getShortVideoPromptApiUrl(), SHORT_VIDEO_PROMPT_API_URL);
  if (!endpoint) {
    throw new Error("Server is missing SHORT_VIDEO_PROMPT_API_URL.");
  }
  const specText = await loadVideoPromptSpecTemplate();
  const normalizedInputPayload = normalizeVideoAgentInputPayload(inputPayload);
  const normalizedLocale = normalizePromptPackLocaleConfig(localeConfig);
  const systemPrompt = buildShortVideoPromptOpening(normalizedLocale);
  const requestPayload = buildShortVideoPromptUserPayload({
    product,
    analysisResult,
    inputPayload: normalizedInputPayload,
    specText,
    localeConfig: normalizedLocale
  });
  const model = getShortVideoPromptModel();
  const requestBody = {
    model,
    temperature: SHORT_VIDEO_PROMPT_TEMPERATURE,
    max_tokens: SHORT_VIDEO_PROMPT_MAX_TOKENS,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: JSON.stringify(requestPayload, null, 2)
      }
    ]
  };
  const sentAt = new Date().toISOString();
  const buildDebugResult = ({
    responseStatus = null,
    responseText = "",
    parsedResponse = null,
    modelText = "",
    parsedOutput = null,
    normalizedOutput = null,
    stage = "",
    note = ""
  } = {}) => {
    const normalizedOutputPayload = normalizedOutput || normalizeShortVideoOutputPayload(parsedOutput || {});
    const rawResponseJson = safeObject(parsedResponse) || null;
    const modelOutputJson = safeObject(parsedOutput) || null;
    const mergedRaw = {
      stage: safeText(stage),
      note: safeText(note),
      response_status: Number.isFinite(Number(responseStatus)) ? Number(responseStatus) : null,
      response_text: String(responseText || ""),
      response_json: rawResponseJson,
      raw_model_text: safeText(modelText),
      model_output_json: modelOutputJson,
      source_output_raw: safeObject(normalizedOutputPayload.raw) || null
    };
    return {
      inputPayload: normalizedInputPayload,
      requestContext: {
        locale: normalizedLocale
      },
      modelRequest: {
        endpoint,
        requestBody,
        sentAt
      },
      outputPayload: {
        ...normalizedOutputPayload,
        raw: mergedRaw,
        model,
        raw_model_text: safeText(modelText)
      },
      scriptSets: convertShortVideoScriptsToLegacySets(normalizedOutputPayload.scripts),
      generatedAt: new Date().toISOString()
    };
  };
  const createDebugError = (message, debugResult) => {
    const error = new Error(message);
    error.debugResult = debugResult;
    return error;
  };
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(SHORT_VIDEO_PROMPT_TIMEOUT_MS)
    });
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error || "fetch failed");
    throw createDebugError(
      `短视频提示词请求失败: ${note}`,
      buildDebugResult({
        stage: "request_exception",
        note
      })
    );
  }
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error || "response read failed");
    throw createDebugError(
      `短视频提示词响应读取失败: ${note}`,
      buildDebugResult({
        responseStatus: response.status,
        stage: "response_read_exception",
        note
      })
    );
  }
  if (!response.ok) {
    throw createDebugError(
      `短视频提示词请求失败 (${response.status}): ${safeText(text).slice(0, 360)}`,
      buildDebugResult({
        responseStatus: response.status,
        responseText: text,
        stage: "http_error"
      })
    );
  }
  const parsedResponse = parseJsonObject(text);
  return buildDebugResult({
    responseStatus: response.status,
    responseText: text,
    parsedResponse,
    stage: "success_raw_passthrough",
    note: "raw response passthrough mode"
  });
}

function toVeoBaseUrl(baseUrl = "") {
  const base = safeText(baseUrl || getVeoApiBaseUrl()).replace(/\/$/, "");
  if (!base) {
    throw new Error("Server is missing VEO_API_BASE_URL.");
  }
  return base;
}

function toVeoApiKey(apiKey = "") {
  const key = safeText(apiKey || getVeoApiKey());
  if (!key) {
    throw new Error("Server is missing VEO_API_KEY.");
  }
  return key;
}

function buildVeoErrorSnippet(text, maxLength = 320) {
  return safeText(text).replace(/\s+/g, " ").slice(0, maxLength);
}

function parseVeoCreateResponseText(text) {
  const source = safeText(text);
  const direct = parseJsonObject(source);
  if (direct) {
    return direct;
  }
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const current = safeText(line);
    if (!current.toLowerCase().startsWith("data:")) {
      continue;
    }
    const payload = safeText(current.slice(5));
    if (!payload) {
      continue;
    }
    const parsed = parseJsonObject(payload);
    if (parsed) {
      return parsed;
    }
  }
  throw new Error(`VEO create API returned invalid JSON: ${buildVeoErrorSnippet(source, 500)}`);
}

function tryParseVeoCreateResponseChunk(text) {
  const source = safeText(text);
  if (!source) {
    return null;
  }
  const direct = parseJsonObject(source);
  if (direct) {
    return direct;
  }
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const current = safeText(line);
    if (!current.toLowerCase().startsWith("data:")) {
      continue;
    }
    const payload = safeText(current.slice(5));
    if (!payload || payload === "[DONE]") {
      continue;
    }
    const parsed = parseJsonObject(payload);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

async function parseVeoCreateResponseFromStream(response) {
  const reader = response?.body && typeof response.body.getReader === "function" ? response.body.getReader() : null;
  if (!reader) {
    const text = await response.text();
    return parseVeoCreateResponseText(text);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const parsed = tryParseVeoCreateResponseChunk(buffer);
      if (parsed) {
        try {
          await reader.cancel();
        } catch (_error) {
          // Ignore cancel errors.
        }
        return parsed;
      }
      if (buffer.length > 1024 * 1024) {
        buffer = buffer.slice(-65536);
      }
    }
  }
  buffer += decoder.decode();
  return parseVeoCreateResponseText(buffer);
}

function extractVeoTaskId(createResponse) {
  const source = safeObject(createResponse) || {};
  const data = safeObject(source.data) || {};
  const taskId = safeText(data.id || source.id);
  if (!taskId) {
    throw new Error(`VEO create API did not return task id: ${buildVeoErrorSnippet(JSON.stringify(source), 500)}`);
  }
  return taskId;
}

function normalizeVeoResultPayload(input) {
  if (safeObject(input)) {
    return input;
  }
  const text = safeText(input);
  if (!text) {
    return { _raw: "", _status_code: 200 };
  }
  const parsed = parseJsonObject(text);
  if (parsed) {
    return parsed;
  }
  return {
    _raw: text
  };
}

function pickVeoResultStatus(resultPayload) {
  const source = safeObject(resultPayload) || {};
  const nested = safeObject(source.data) || source;
  return safeText(nested.status || nested.state).toLowerCase();
}

function pickVeoResultReason(resultPayload) {
  const source = safeObject(resultPayload) || {};
  const nested = safeObject(source.data) || source;
  return safeText(
    nested.failure_reason ||
      nested.failureReason ||
      nested.error ||
      nested.message ||
      source.error ||
      source.message ||
      source.msg
  );
}

function pickVeoVideoUrl(resultPayload) {
  const source = safeObject(resultPayload) || {};
  const nested = safeObject(source.data) || source;
  return safeText(
    nested.url ||
      nested.videoUrl ||
      nested.video_url ||
      nested.outputUrl ||
      nested.output_url ||
      source.url ||
      source.videoUrl ||
      source.video_url
  );
}

function toVeoRequestBody(params) {
  const source = safeObject(params) || {};
  const model = safeText(source.model, getVeoDefaultModel());
  const prompt = safeText(source.prompt);
  const firstFrameUrl = safeText(source.firstFrameUrl);
  const lastFrameUrl = safeText(source.lastFrameUrl);
  const urls = uniqueStrings(toArray(source.urls)).slice(0, 8);
  const aspectRatio = safeText(source.aspectRatio, VEO_DEFAULT_ASPECT_RATIO);
  if (!prompt) {
    throw new Error("prompt 不能为空。");
  }
  return {
    model,
    prompt,
    firstFrameUrl,
    lastFrameUrl,
    urls,
    aspectRatio,
    webHook: "",
    shutProgress: false
  };
}

async function requestVeoCreateVideoTask(params, options = {}) {
  ensureFetchSupport();
  const apiKey = toVeoApiKey(options.apiKey);
  const baseUrl = toVeoBaseUrl(options.baseUrl);
  const body = toVeoRequestBody(params);
  const createTimeoutMs = parseIntWithBounds(options.createTimeoutMs, VEO_CREATE_TIMEOUT_MS, 15000, 300000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), createTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}${VEO_CREATE_VIDEO_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`VEO create request failed (${response.status}): ${buildVeoErrorSnippet(text)}`);
    }
    return await parseVeoCreateResponseFromStream(response);
  } finally {
    clearTimeout(timer);
  }
}

async function requestVeoResult(taskId, options = {}) {
  ensureFetchSupport();
  const apiKey = toVeoApiKey(options.apiKey);
  const baseUrl = toVeoBaseUrl(options.baseUrl);
  const safeTaskId = safeText(taskId);
  if (!safeTaskId) {
    throw new Error("taskId 不能为空。");
  }

  const resultTimeoutMs = parseIntWithBounds(options.resultTimeoutMs, VEO_RESULT_TIMEOUT_MS, 10000, 180000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resultTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}${VEO_GET_RESULT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ id: safeTaskId }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`VEO poll request failed (${response.status}): ${buildVeoErrorSnippet(text)}`);
    }
    return normalizeVeoResultPayload(text);
  } finally {
    clearTimeout(timer);
  }
}

function sleepMs(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, durationMs));
  });
}

function parseIntWithBounds(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function isTransientVeoPollError(error) {
  const message = safeText(error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("aborted") ||
    message.includes("abort") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("econnreset")
  );
}

async function pollVeoUntilDone(taskId, options = {}) {
  const pollIntervalMs = parseIntWithBounds(options.pollIntervalMs, VEO_POLL_INTERVAL_MS, 1000, 60000);
  const pollTimeoutMs = parseIntWithBounds(options.pollTimeoutMs, VEO_POLL_TIMEOUT_MS, 15000, 1800000);
  const successStatuses = new Set(["succeeded", "success", "completed", "done"]);
  const failedStatuses = new Set(["failed", "error", "cancelled", "canceled"]);
  const deadline = Date.now() + pollTimeoutMs;
  let lastResult = null;
  let lastTransientError = "";

  while (Date.now() < deadline) {
    try {
      const resultPayload = await requestVeoResult(taskId, options);
      lastResult = resultPayload;
      lastTransientError = "";
      const codeValue = safeObject(resultPayload) ? resultPayload.code : undefined;
      if (codeValue !== undefined && codeValue !== null && Number(codeValue) !== 0) {
        throw new Error(`VEO poll returned code != 0: ${buildVeoErrorSnippet(JSON.stringify(resultPayload))}`);
      }

      const status = pickVeoResultStatus(resultPayload);
      if (successStatuses.has(status)) {
        return {
          resultPayload,
          status
        };
      }
      if (failedStatuses.has(status)) {
        const reason = pickVeoResultReason(resultPayload) || "未知错误";
        throw new Error(`VEO 生成失败: ${reason}`);
      }
      if (!status && pickVeoVideoUrl(resultPayload)) {
        return {
          resultPayload,
          status: "succeeded"
        };
      }
    } catch (error) {
      if (isTransientVeoPollError(error)) {
        lastTransientError = safeText(error instanceof Error ? error.message : String(error));
        await sleepMs(pollIntervalMs);
        continue;
      }
      throw error;
    }

    await sleepMs(pollIntervalMs);
  }
  const lastResultText = lastResult ? `，最后一次响应: ${buildVeoErrorSnippet(JSON.stringify(lastResult), 500)}` : "";
  const transientErrorText = lastTransientError ? `，最后一次轮询错误: ${buildVeoErrorSnippet(lastTransientError, 240)}` : "";
  throw new Error(`VEO 轮询超时（${pollTimeoutMs}ms）${lastResultText}${transientErrorText}`);
}

function pickShortVideoTaskId(payload) {
  const source = safeObject(payload) || {};
  const data = safeObject(source.data) || {};
  return safeText(source.id || source.task_id || source.taskId || data.id || data.task_id || data.taskId);
}

function pickShortVideoTaskStatus(payload) {
  const source = safeObject(payload) || {};
  const data = safeObject(source.data) || {};
  return safeText(source.status || source.state || data.status || data.state).toLowerCase();
}

function pickShortVideoTaskVideoUrl(payload) {
  const source = safeObject(payload) || {};
  const data = safeObject(source.data) || {};
  return safeText(
    source.video_url || source.videoUrl || source.url || data.video_url || data.videoUrl || data.url || data.output_url || data.outputUrl
  );
}

function pickShortVideoTaskError(payload) {
  const source = safeObject(payload) || {};
  const data = safeObject(source.data) || {};
  return safeText(
    source.error ||
      source.message ||
      source.msg ||
      source.reason ||
      data.error ||
      data.message ||
      data.msg ||
      data.reason
  );
}

async function requestShortVideoCreateTask(params, options = {}) {
  ensureFetchSupport();
  const apiKey = safeText(options.apiKey, getShortVideoRenderApiKey());
  if (!apiKey) {
    throw new Error("Server is missing SHORT_VIDEO_RENDER_API_KEY.");
  }
  const endpoint = safeText(options.endpoint, getShortVideoCreateApiUrl());
  if (!endpoint) {
    throw new Error("Server is missing SHORT_VIDEO_CREATE_API_URL.");
  }
  const timeoutMs = parseIntWithBounds(options.createTimeoutMs, SHORT_VIDEO_CREATE_TIMEOUT_MS, 15000, 300000);
  const payload = {
    model: safeText(params.model, getShortVideoRenderModel()),
    prompt: safeText(params.prompt),
    images: uniqueStrings(toArray(params.images).map((item) => toPlainBase64FromImageInput(item)).filter(Boolean)).slice(0, 8),
    enhance_prompt: params.enhancePrompt !== false,
    enable_upsample: params.enableUpsample !== false,
    aspect_ratio: safeText(params.aspectRatio, VEO_DEFAULT_ASPECT_RATIO)
  };
  if (!payload.prompt) {
    throw new Error("视频生成缺少 prompt。");
  }
  if (!payload.images.length) {
    throw new Error("视频生成缺少图片 Base64。");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  const parsed = parseJsonObject(text) || {};
  if (!response.ok) {
    throw new Error(`短视频创建失败 (${response.status}): ${safeText(text).slice(0, 360)}`);
  }
  const taskId = pickShortVideoTaskId(parsed);
  if (!taskId) {
    throw new Error(`短视频创建返回中缺少任务ID: ${safeText(text).slice(0, 300)}`);
  }
  return {
    payload: parsed,
    taskId
  };
}

async function requestShortVideoQueryTask(taskId, options = {}) {
  ensureFetchSupport();
  const apiKey = safeText(options.apiKey, getShortVideoRenderApiKey());
  if (!apiKey) {
    throw new Error("Server is missing SHORT_VIDEO_RENDER_API_KEY.");
  }
  const endpoint = safeText(options.endpoint, getShortVideoQueryApiUrl());
  if (!endpoint) {
    throw new Error("Server is missing SHORT_VIDEO_QUERY_API_URL.");
  }
  const timeoutMs = parseIntWithBounds(options.resultTimeoutMs, SHORT_VIDEO_QUERY_TIMEOUT_MS, 10000, 180000);
  const safeTaskId = safeText(taskId);
  if (!safeTaskId) {
    throw new Error("任务ID为空，无法查询短视频状态。");
  }
  const queryUrl = `${endpoint}${endpoint.includes("?") ? "&" : "?"}id=${encodeURIComponent(safeTaskId)}`;
  const response = await fetch(queryUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  const parsed = parseJsonObject(text) || {};
  if (!response.ok) {
    throw new Error(`短视频状态查询失败 (${response.status}): ${safeText(text).slice(0, 360)}`);
  }
  return parsed;
}

function isTransientShortVideoPollError(error) {
  const message = safeText(error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("econnreset") ||
    message.includes("aborted")
  );
}

async function pollShortVideoTaskUntilDone(taskId, options = {}) {
  const pollIntervalMs = parseIntWithBounds(options.pollIntervalMs, SHORT_VIDEO_POLL_INTERVAL_MS, 1000, 60000);
  const pollTimeoutMs = parseIntWithBounds(options.pollTimeoutMs, SHORT_VIDEO_POLL_TIMEOUT_MS, 15000, 1800000);
  const successStatuses = new Set(["completed", "success", "succeeded", "done"]);
  const failedStatuses = new Set(["failed", "error", "cancelled", "canceled"]);
  const deadline = Date.now() + pollTimeoutMs;
  let lastPayload = null;
  let lastTransientError = "";

  while (Date.now() < deadline) {
    try {
      const payload = await requestShortVideoQueryTask(taskId, options);
      lastPayload = payload;
      lastTransientError = "";
      const status = pickShortVideoTaskStatus(payload);
      const videoUrl = pickShortVideoTaskVideoUrl(payload);
      if (successStatuses.has(status) && videoUrl) {
        return { payload, status, videoUrl };
      }
      if (failedStatuses.has(status)) {
        throw new Error(`短视频生成失败: ${pickShortVideoTaskError(payload) || status}`);
      }
      if (!status && videoUrl) {
        return { payload, status: "completed", videoUrl };
      }
    } catch (error) {
      if (isTransientShortVideoPollError(error)) {
        lastTransientError = safeText(error instanceof Error ? error.message : String(error));
        await sleepMs(pollIntervalMs);
        continue;
      }
      throw error;
    }
    await sleepMs(pollIntervalMs);
  }
  const lastPayloadText = lastPayload ? `，最后响应: ${buildVeoErrorSnippet(JSON.stringify(lastPayload), 500)}` : "";
  const transientErrorText = lastTransientError ? `，最后轮询错误: ${buildVeoErrorSnippet(lastTransientError, 240)}` : "";
  throw new Error(`短视频轮询超时（${pollTimeoutMs}ms）${lastPayloadText}${transientErrorText}`);
}

async function loadProductImageBase64ByRecordId(recordId, limit = VIDEO_AGENT_IMAGE_LIMIT) {
  const safeRecordId = safeText(recordId);
  if (!safeRecordId) {
    return [];
  }
  const products = await loadNormalizedProducts();
  const product = products.find((item) => item.recordId === safeRecordId);
  if (!product) {
    return [];
  }
  const imageUrls = uniqueStrings([...(product.images || []), product.triggeredImage]).filter((item) => /^https?:\/\//i.test(item));
  const selected = imageUrls.slice(0, Math.max(1, Math.min(8, Math.floor(Number(limit) || VIDEO_AGENT_IMAGE_LIMIT))));
  const output = [];
  for (const imageUrl of selected) {
    try {
      const fetched = await fetchRemoteImageBuffer(imageUrl, {
        referer: safeText(product.url),
        timeoutMs: 45000
      });
      if (fetched?.buffer?.length) {
        output.push(fetched.buffer.toString("base64"));
      }
    } catch (_error) {
      // Skip broken image and continue.
    }
  }
  return uniqueStrings(output.filter(Boolean));
}

function collectFallbackBase64ImagesFromJob(job) {
  const urls = uniqueStrings([safeText(job?.firstFrameUrl), safeText(job?.lastFrameUrl), ...toArray(job?.urls || [])]);
  return uniqueStrings(urls.map((item) => toPlainBase64FromImageInput(item)).filter(Boolean)).slice(0, 8);
}

function buildVideoClipJobRuntimeKey(recordId, setKey, clipIndex) {
  return `${safeText(recordId)}::${buildVideoClipTaskKey(setKey, clipIndex)}`;
}

function enqueueVideoClipJob(job) {
  const runtimeKey = buildVideoClipJobRuntimeKey(job.recordId, job.setKey, job.clipIndex);
  if (!safeText(job.recordId) || !safeText(job.setKey) || !safeText(job.prompt)) {
    return false;
  }
  if (activeVideoClipJobKeys.has(runtimeKey)) {
    return false;
  }
  const existsInQueue = videoClipQueue.some(
    (entry) => buildVideoClipJobRuntimeKey(entry.recordId, entry.setKey, entry.clipIndex) === runtimeKey
  );
  if (existsInQueue) {
    return false;
  }
  videoClipQueue.push(job);
  return true;
}

async function processVideoClipJob(job) {
  const recordId = safeText(job?.recordId);
  const setKey = safeText(job?.setKey);
  const clipIndex = Math.max(0, Math.floor(Number(job?.clipIndex) || 0));
  const prompt = safeText(job?.prompt);
  const firstFrameUrl = safeText(job?.firstFrameUrl);
  const lastFrameUrl = safeText(job?.lastFrameUrl);
  const firstFrameName = safeText(job?.firstFrameName);
  const lastFrameName = safeText(job?.lastFrameName);
  const aspectRatio = safeText(job?.aspectRatio, VEO_DEFAULT_ASPECT_RATIO);
  const jobId = safeText(job?.jobId, createJobId(`veoclip_${recordId}_${setKey}_${clipIndex}`));
  const maxRetries = parseIntWithBounds(job?.maxRetries, VIDEO_CLIP_MAX_RETRIES, 1, 6);
  const retryDelayMs = parseIntWithBounds(job?.retryDelayMs, VIDEO_CLIP_RETRY_DELAY_MS, 500, 30000);
  const options = {
    createTimeoutMs: parseIntWithBounds(job?.createTimeoutMs, SHORT_VIDEO_CREATE_TIMEOUT_MS, 15000, 300000),
    resultTimeoutMs: parseIntWithBounds(job?.resultTimeoutMs, SHORT_VIDEO_QUERY_TIMEOUT_MS, 10000, 180000),
    pollIntervalMs: parseIntWithBounds(job?.pollIntervalMs, SHORT_VIDEO_POLL_INTERVAL_MS, 1000, 60000),
    pollTimeoutMs: parseIntWithBounds(job?.pollTimeoutMs, SHORT_VIDEO_POLL_TIMEOUT_MS, 15000, 1800000),
    apiKey: safeText(job?.apiKey)
  };
  if (!recordId || !setKey || !prompt) {
    return;
  }
  const runtimeKey = buildVideoClipJobRuntimeKey(recordId, setKey, clipIndex);
  activeVideoClipJobKeys.add(runtimeKey);
  try {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        await upsertVideoClipTaskState(recordId, setKey, clipIndex, {
          status: "processing",
          jobId,
          taskId: null,
          prompt,
          firstFrameUrl,
          lastFrameUrl,
          firstFrameName,
          lastFrameName,
          aspectRatio,
          retryCount: attempt,
          maxRetries,
          videoUrl: "",
          error: null,
          startedAt: new Date().toISOString()
        });
        const requestImages = collectFallbackBase64ImagesFromJob(job);
        if (!requestImages.length) {
          throw new Error("请先上传至少一张图片后再生成视频。");
        }
        const { taskId } = await requestShortVideoCreateTask(
          {
            prompt,
            model: safeText(job?.model, getShortVideoRenderModel()),
            images: requestImages,
            aspectRatio
          },
          options
        );
        await upsertVideoClipTaskState(recordId, setKey, clipIndex, {
          status: "processing",
          retryCount: attempt,
          maxRetries,
          taskId,
          error: null
        });
        const { videoUrl } = await pollShortVideoTaskUntilDone(taskId, options);
        if (!videoUrl) {
          throw new Error("接口已返回成功，但未提供视频链接。");
        }
        await upsertVideoClipTaskState(recordId, setKey, clipIndex, {
          status: "succeeded",
          retryCount: attempt,
          maxRetries,
          taskId,
          videoUrl,
          error: null,
          completedAt: new Date().toISOString()
        });
        return;
      } catch (error) {
        const errorText = safeText(error instanceof Error ? error.message : String(error), "视频生成失败");
        if (attempt < maxRetries) {
          await upsertVideoClipTaskState(recordId, setKey, clipIndex, {
            status: "queued",
            retryCount: attempt,
            maxRetries,
            taskId: null,
            error: `第 ${attempt} 次失败，${Math.ceil(retryDelayMs / 1000)} 秒后重试：${errorText}`
          });
          await sleepMs(retryDelayMs);
          continue;
        }
        await upsertVideoClipTaskState(recordId, setKey, clipIndex, {
          status: "failed",
          retryCount: attempt,
          maxRetries,
          error: `重试 ${maxRetries} 次后失败：${errorText}`,
          completedAt: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    await upsertVideoClipTaskState(recordId, setKey, clipIndex, {
      status: "failed",
      retryCount: maxRetries,
      maxRetries,
      error: safeText(error instanceof Error ? error.message : String(error), "视频生成失败"),
      completedAt: new Date().toISOString()
    });
  } finally {
    activeVideoClipJobKeys.delete(runtimeKey);
  }
}

function runVideoClipQueue() {
  while (videoClipWorkersRunning < VIDEO_CLIP_CONCURRENCY && videoClipQueue.length) {
    const job = videoClipQueue.shift();
    if (!job) {
      return;
    }
    videoClipWorkersRunning += 1;
    void processVideoClipJob(job).finally(() => {
      videoClipWorkersRunning = Math.max(0, videoClipWorkersRunning - 1);
      runVideoClipQueue();
    });
  }
}

async function restoreVideoClipQueueFromStore() {
  const products = await loadNormalizedProducts();
  for (const product of products) {
    const generationState = normalizeVideoClipGenerationState(product.videoClipGeneration);
    for (const task of generationState.items) {
      if (!["queued", "processing"].includes(task.status)) {
        continue;
      }
      await upsertVideoClipTaskState(product.recordId, task.setKey, task.clipIndex, {
        status: "queued",
        error: null
      });
      enqueueVideoClipJob({
        recordId: product.recordId,
        setKey: task.setKey,
        clipIndex: task.clipIndex,
        prompt: task.prompt,
        firstFrameUrl: task.firstFrameUrl,
        lastFrameUrl: task.lastFrameUrl,
        urls: uniqueStrings(toArray(task.urls || [])).slice(0, 8),
        firstFrameName: task.firstFrameName,
        lastFrameName: task.lastFrameName,
        aspectRatio: task.aspectRatio || VEO_DEFAULT_ASPECT_RATIO,
        pollIntervalMs: SHORT_VIDEO_POLL_INTERVAL_MS,
        pollTimeoutMs: SHORT_VIDEO_POLL_TIMEOUT_MS,
        createTimeoutMs: SHORT_VIDEO_CREATE_TIMEOUT_MS,
        resultTimeoutMs: SHORT_VIDEO_QUERY_TIMEOUT_MS,
        maxRetries: task.maxRetries || VIDEO_CLIP_MAX_RETRIES,
        retryDelayMs: VIDEO_CLIP_RETRY_DELAY_MS,
        jobId: task.jobId || createJobId(`veoclip_restore_${product.recordId}_${task.setKey}_${task.clipIndex}`)
      });
    }
  }
  runVideoClipQueue();
}

function extByMimeType(mimeType) {
  const value = safeText(mimeType).toLowerCase();
  if (value.includes("png")) {
    return "png";
  }
  if (value.includes("webp")) {
    return "webp";
  }
  if (value.includes("gif")) {
    return "gif";
  }
  return "jpg";
}

async function saveKnowledgeImage({ buffer, mimeType }) {
  await fs.mkdir(KB_IMAGE_DIR, { recursive: true });
  const imageHash = crypto.createHash("sha1").update(buffer).digest("hex");
  const ext = extByMimeType(mimeType);
  const fileName = `${Date.now()}_${imageHash.slice(0, 12)}.${ext}`;
  const fullPath = path.join(KB_IMAGE_DIR, fileName);
  await fs.writeFile(fullPath, buffer);
  return {
    imageHash,
    fileName,
    imageUrl: `/static/knowledge-base-images/${fileName}`,
    fullPath
  };
}

async function saveManualProductImage({ buffer, mimeType }) {
  await fs.mkdir(MANUAL_PRODUCT_IMAGE_DIR, { recursive: true });
  const imageHash = crypto.createHash("sha1").update(buffer).digest("hex");
  const ext = extByMimeType(mimeType);
  const fileName = `${Date.now()}_${imageHash.slice(0, 12)}.${ext}`;
  const fullPath = path.join(MANUAL_PRODUCT_IMAGE_DIR, fileName);
  await fs.writeFile(fullPath, buffer);
  return {
    imageHash,
    fileName,
    imageUrl: `/static/manual-product-images/${fileName}`,
    fullPath
  };
}

function pickProductDescription(product) {
  const attributes = toArray(product?.productAttributes);
  for (const entry of attributes) {
    const name = safeText(entry?.name).toLowerCase();
    if (!name) {
      continue;
    }
    if (name.includes("描述") || name.includes("description")) {
      const value = safeText(entry?.value);
      if (value) {
        return value;
      }
    }
  }
  const packageSpecs = toArray(product?.packageSpecs).map((item) => safeText(item)).filter(Boolean);
  return packageSpecs.join("；");
}

function renderManualProductPage(product) {
  const title = safeText(product?.title, "手动上传商品");
  const imageUrl = safeText(product?.triggeredImage || toArray(product?.images)[0]);
  const description = safeText(pickProductDescription(product), "暂无商品描述");
  const shopName = safeText(product?.shopName, "手动上传");
  const capturedAt = safeText(product?.capturedAt);
  const recordId = safeText(product?.recordId);
  const productId = safeText(product?.productId);
  const descriptionHtml = escapeHtml(description).replace(/\r?\n/g, "<br />");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: "Segoe UI", "PingFang SC", sans-serif; background: #f5f8fc; color: #182944; }
    .shell { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }
    .card { background: #fff; border: 1px solid #d9e4f3; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 26px rgba(16, 35, 63, 0.08); }
    .image-wrap { background: linear-gradient(160deg, #ffffff, #eef4ff); display: grid; place-items: center; min-height: 340px; }
    .image-wrap img { max-width: 100%; max-height: 540px; object-fit: contain; display: block; }
    .body { padding: 16px; display: grid; gap: 12px; }
    h1 { margin: 0; font-size: 24px; line-height: 1.3; }
    .meta { color: #586c89; font-size: 13px; display: grid; gap: 4px; }
    .desc { border: 1px solid #e2eaf7; border-radius: 12px; background: #f9fbff; padding: 12px; line-height: 1.65; white-space: normal; }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card">
      <div class="image-wrap">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />` : "<div>无商品图片</div>"}</div>
      <div class="body">
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">
          <div>商品ID: ${escapeHtml(productId || "-")}</div>
          <div>记录ID: ${escapeHtml(recordId || "-")}</div>
          <div>来源: ${escapeHtml(shopName)}</div>
          <div>创建时间: ${escapeHtml(capturedAt || "-")}</div>
        </div>
        <section class="desc">${descriptionHtml}</section>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function toPublicKnowledgeSummary(item) {
  return toKnowledgeSummary(item);
}

function buildCategoryKnowledgeContext(categoryRecord) {
  const category = categoryRecord && typeof categoryRecord === "object" ? categoryRecord : {};
  const completedItems = Array.isArray(category.items) ? category.items.filter((item) => item.status === "completed") : [];
  if (category.compressedKnowledge && category.compressedKnowledge.summary) {
    const compressed = category.compressedKnowledge;
    const summary = safeText(compressed.summary);
    const text = [
      `compressed_summary: ${summary}`,
      `overall_style: ${safeText(compressed.overallStyle)}`,
      `color_scheme: ${safeText(compressed.colorScheme)}`,
      `background_description: ${safeText(compressed.backgroundDescription)}`,
      `composition: ${safeText(compressed.composition)}`,
      `lighting_and_texture: ${safeText(compressed.lightingAndTexture)}`,
      `model_info: ${safeText(compressed.modelInfo)}`,
      `positive_prompt: ${safeText(compressed.positivePrompt)}`,
      `negative_prompt: ${safeText(compressed.negativePrompt)}`
    ].join("\n");
    return {
      knowledgeText: text,
      knowledgeSummary: summary,
      sourceItemCount: completedItems.length,
      compressed: true
    };
  }

  const blocks = completedItems.map((item) => {
    const analysis = item.analysis || {};
    return [
      `id: ${safeText(item.id)}`,
      `summary: ${safeText(analysis.summary)}`,
      `overall_style: ${safeText(analysis.overallStyle)}`,
      `color_scheme: ${safeText(analysis.colorScheme)}`,
      `background_description: ${safeText(analysis.backgroundDescription)}`,
      `composition: ${safeText(analysis.composition)}`,
      `lighting_and_texture: ${safeText(analysis.lightingAndTexture)}`,
      `model_info: ${safeText(analysis.modelInfo)}`,
      `positive_prompt: ${safeText(analysis.positivePrompt)}`,
      `negative_prompt: ${safeText(analysis.negativePrompt)}`
    ].join("\n");
  });
  return {
    knowledgeText: blocks.join("\n\n"),
    knowledgeSummary: blocks.length ? `鍏?{blocks.length}涓弬鑰冨浘鍒嗗潡` : "",
    sourceItemCount: completedItems.length,
    compressed: false
  };
}

async function maybeCompressKnowledgeCategory({ db, categoryId, categoryName }) {
  const category = db.categories[categoryId];
  if (!category) {
    return;
  }
  const totalLength = recalcCategoryTotalLength(category);
  if (totalLength <= KB_CATEGORY_MAX_CONTENT_LENGTH) {
    return;
  }
  const completedEntries = category.items.filter((item) => item.status === "completed");
  if (!completedEntries.length) {
    return;
  }
  const compressed = await compressCategoryKnowledge({
    category: {
      id: categoryId,
      name: safeText(categoryName || category.categoryName)
    },
    entries: completedEntries.map((item) => ({
      id: item.id,
      analysis: item.analysis
    }))
  });
  category.compressedKnowledge = normalizeCompressedKnowledge(compressed);
  category.updatedAt = new Date().toISOString();
}

async function processKnowledgeAnalysisJob(job) {
  const itemId = safeText(job?.itemId);
  if (!itemId) {
    return;
  }
  const db = await loadImageKnowledgeBase();
  const located = findKnowledgeItemById(db, itemId);
  if (!located) {
    return;
  }
  const { category, index, item } = located;
  category.items[index] = {
    ...item,
    status: "processing",
    error: null,
    updatedAt: new Date().toISOString()
  };
  await saveImageKnowledgeBase(db);

  try {
    const imageUrl = safeText(item.imageUrl);
    const relativePath = imageUrl.replace(/^\/?static\//, "");
    const fullPath = path.join(DATA_DIR, relativePath);
    const imageBuffer = await fs.readFile(fullPath);
    const analysis = await analyzeKnowledgeReferenceImage({
      imageBuffer,
      category: {
        id: category.categoryId,
        name: category.categoryName
      }
    });

    const nextDb = await loadImageKnowledgeBase();
    const nextLocated = findKnowledgeItemById(nextDb, itemId);
    if (!nextLocated) {
      return;
    }
    const nextCategory = nextLocated.category;
    const nextItem = nextLocated.item;
    nextCategory.items[nextLocated.index] = {
      ...nextItem,
      status: "completed",
      error: null,
      updatedAt: new Date().toISOString(),
      analysisModelVersion: CLAUDE_MODEL_SONNET,
      analysis,
      rawAnalysis: analysis
    };
    await maybeCompressKnowledgeCategory({
      db: nextDb,
      categoryId: nextCategory.categoryId,
      categoryName: nextCategory.categoryName
    });
    await saveImageKnowledgeBase(nextDb);
  } catch (error) {
    const nextDb = await loadImageKnowledgeBase();
    const nextLocated = findKnowledgeItemById(nextDb, itemId);
    if (!nextLocated) {
      return;
    }
    nextLocated.category.items[nextLocated.index] = {
      ...nextLocated.item,
      status: "failed",
      error: error instanceof Error ? error.message : "Knowledge analysis failed",
      updatedAt: new Date().toISOString(),
      analysisModelVersion: CLAUDE_MODEL_SONNET
    };
    recalcCategoryTotalLength(nextLocated.category);
    await saveImageKnowledgeBase(nextDb);
  }
}

function runKnowledgeAnalysisQueue() {
  while (knowledgeWorkersRunning < KB_ANALYSIS_CONCURRENCY && knowledgeAnalysisQueue.length) {
    const job = knowledgeAnalysisQueue.shift();
    if (!job) {
      return;
    }
    knowledgeWorkersRunning += 1;
    void processKnowledgeAnalysisJob(job).finally(() => {
      knowledgeWorkersRunning = Math.max(0, knowledgeWorkersRunning - 1);
      runKnowledgeAnalysisQueue();
    });
  }
}

async function processAnalysisJob(job) {
  const { recordId, jobId } = job;
  try {
    const processingState = await setAnalysisState(
      recordId,
      {
        status: "processing",
        error: null,
        updatedAt: new Date().toISOString()
      },
      jobId
    );
    if (!processingState.updated) {
      return;
    }

    const normalizedItems = await loadNormalizedProducts();
    const product = normalizedItems.find((item) => item.recordId === recordId);
    if (!product) {
      throw new Error("Product record not found.");
    }

    const result = await analyzeProduct({ product });

    const completedState = await setAnalysisState(
      recordId,
      {
        status: "completed",
        error: null,
        updatedAt: new Date().toISOString(),
        result
      },
      jobId
    );
    if (completedState.updated) {
      await setVideoScriptGenerationState(recordId, {
        status: "idle",
        error: null,
        updatedAt: new Date().toISOString(),
        result: null
      });
      await setVideoClipGenerationState(recordId, {
        updatedAt: new Date().toISOString(),
        items: []
      });
    }
  } catch (error) {
    await setAnalysisState(
      recordId,
      {
        status: "failed",
        error: error instanceof Error ? error.message : "AI analysis failed",
        updatedAt: new Date().toISOString(),
        result: null
      },
      jobId
    );
  }
}

function runAnalysisQueue() {
  while (analysisWorkersRunning < ANALYSIS_CONCURRENCY && analysisQueue.length) {
    const job = analysisQueue.shift();
    if (!job) {
      return;
    }
    analysisWorkersRunning += 1;
    void processAnalysisJob(job).finally(() => {
      analysisWorkersRunning = Math.max(0, analysisWorkersRunning - 1);
      runAnalysisQueue();
    });
  }
}

async function processPromptPackJob(job) {
  const { recordId, jobId } = job;
  const detailAspectRatio = normalizeDetailPromptAspectRatio(job?.detailAspectRatio);
  const priorityDetailedDescription = safeText(job?.priorityDetailedDescription || job?.priority_detailed_description);
  const locale = normalizePromptPackLocaleConfig(job);
  try {
    const processingState = await setSecondPromptGenerationState(
      recordId,
      {
        status: "processing",
        jobId,
        error: null,
        updatedAt: new Date().toISOString(),
        result: null
      },
      jobId
    );
    if (!processingState.updated) {
      return;
    }

    const normalizedItems = await loadNormalizedProducts();
    const product = normalizedItems.find((item) => item.recordId === recordId);
    if (!product) {
      throw new Error("Product record not found.");
    }
    const analysis = normalizeAnalysisState(product.analysis);
    if (analysis.status !== "completed" || !analysis.result) {
      throw new Error("请先完成第一次 AI 分析，再发起图词请求。");
    }

    const templateText = await loadSecondPromptTemplate();
    const result = await generateSecondStagePromptPack({
      product,
      analysisResult: analysis.result,
      templateText,
      detailAspectRatio,
      priorityDetailedDescription,
      targetMarket: locale.targetMarket,
      promptLanguage: locale.promptLanguage,
      inImageTextLanguage: locale.inImageTextLanguage
    });

    await setSecondPromptGenerationState(
      recordId,
      {
        status: "completed",
        jobId,
        error: null,
        updatedAt: new Date().toISOString(),
        result
      },
      jobId
    );
  } catch (error) {
    const errorMessage = normalizeModelErrorMessage(error instanceof Error ? error.message : error);
    await setSecondPromptGenerationState(
      recordId,
      {
        status: "failed",
        jobId,
        error: errorMessage,
        updatedAt: new Date().toISOString(),
        result: null
      },
      jobId
    );
  }
}

void loadApiKeySettings().catch((error) => {
  console.error("loadApiKeySettings failed:", error);
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ai-auto-1688-server",
    now: new Date().toISOString()
  });
});

app.post("/api/system/credentials/login", async (req, res) => {
  const password = String(req.body?.password || "");
  if (!password) {
    return res.status(400).json({
      ok: false,
      code: "PASSWORD_REQUIRED",
      message: "请输入密码。"
    });
  }
  try {
    const settings = await loadApiKeySettings();
    if (!verifyManagerPassword(settings, password)) {
      return res.status(401).json({
        ok: false,
        code: "PASSWORD_INCORRECT",
        message: "密码错误。"
      });
    }
    const session = createApiKeyManagerSessionToken();
    return res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: safeText(error instanceof Error ? error.message : String(error), "登录失败。")
    });
  }
});

app.post("/api/system/credentials/logout", requireApiKeyManagerSession, async (req, res) => {
  const token = getApiKeyManagerSessionToken(req);
  if (token) {
    apiKeyManagerSessions.delete(token);
  }
  return res.json({
    ok: true
  });
});

app.get("/api/system/api-keys", requireApiKeyManagerSession, async (_req, res) => {
  try {
    const settings = await loadApiKeySettings();
    return res.json({
      ok: true,
      apiKeys: sanitizeApiKeysPayload(settings.apiKeys, runtimeApiKeys),
      models: sanitizeRequestModelsPayload(settings.models, runtimeRequestModels),
      apiEndpoints: sanitizeApiEndpointsPayload(settings.apiEndpoints, runtimeApiEndpoints),
      updatedAt: settings.password.updatedAt || new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: safeText(error instanceof Error ? error.message : String(error), "读取 API Key 失败。")
    });
  }
});

app.put("/api/system/api-keys", requireApiKeyManagerSession, async (req, res) => {
  const incomingApiKeys = req.body?.apiKeys || req.body || {};
  const incomingModels = req.body?.models || req.body?.requestModels || req.body?.modelSettings || req.body || {};
  const incomingApiEndpoints = req.body?.apiEndpoints || req.body?.endpoints || req.body?.api_urls || req.body || {};
  try {
    const settings = await updateApiKeySettings((current) => {
      current.apiKeys = sanitizeApiKeysPayload(incomingApiKeys, current.apiKeys);
      current.models = sanitizeRequestModelsPayload(incomingModels, current.models);
      current.apiEndpoints = sanitizeApiEndpointsPayload(incomingApiEndpoints, current.apiEndpoints);
      return current;
    });
    return res.json({
      ok: true,
      apiKeys: sanitizeApiKeysPayload(settings.apiKeys, runtimeApiKeys),
      models: sanitizeRequestModelsPayload(settings.models, runtimeRequestModels),
      apiEndpoints: sanitizeApiEndpointsPayload(settings.apiEndpoints, runtimeApiEndpoints),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: safeText(error instanceof Error ? error.message : String(error), "保存 API Key 失败。")
    });
  }
});

app.post("/api/system/credentials/password-reset/request", async (_req, res) => {
  try {
    const code = generateNumericCode(16);
    const now = Date.now();
    const expiresAt = new Date(now + API_KEY_RESET_CODE_TTL_MS).toISOString();
    const settings = await updateApiKeySettings((current) => {
      const codeSalt = createSecretSalt();
      current.resetFlow = {
        codeSalt,
        codeHash: hashWithSalt(code, codeSalt),
        expiresAt,
        verifiedUntil: null,
        updatedAt: new Date(now).toISOString()
      };
      return current;
    });
    try {
      await sendResetCodeEmail(code, expiresAt);
    } catch (error) {
      await updateApiKeySettings((current) => {
        current.resetFlow = {
          codeSalt: "",
          codeHash: "",
          expiresAt: null,
          verifiedUntil: null,
          updatedAt: new Date().toISOString()
        };
        return current;
      });
      const errorCode = error && typeof error === "object" ? String(error.code || "") : "";
      const statusCode = errorCode === "RESET_EMAIL_NOT_CONFIGURED" ? 503 : 502;
      return res.status(statusCode).json({
        ok: false,
        code: errorCode || "RESET_EMAIL_SEND_FAILED",
        message: safeText(error instanceof Error ? error.message : String(error), "验证码邮件发送失败。")
      });
    }
    return res.json({
      ok: true,
      email: API_KEY_RESET_EMAIL,
      expiresAt: settings.resetFlow.expiresAt,
      message: "16 位验证码已发送到指定邮箱，请在 5 分钟内输入并完成校验。"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: safeText(error instanceof Error ? error.message : String(error), "验证码请求失败。")
    });
  }
});

app.post("/api/system/credentials/password-reset/verify", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!isValidResetCode(code)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_RESET_CODE",
      message: "请输入正确的 16 位验证码。"
    });
  }
  try {
    const settings = await loadApiKeySettings();
    const resetFlow = normalizeResetFlow(settings.resetFlow);
    const expiresAt = resetFlow.expiresAt ? new Date(resetFlow.expiresAt).getTime() : 0;
    if (!resetFlow.codeSalt || !resetFlow.codeHash || !expiresAt || Date.now() > expiresAt) {
      return res.status(410).json({
        ok: false,
        code: "RESET_CODE_EXPIRED",
        message: "验证码已失效，请重新生成并发送邮件。"
      });
    }
    const incomingHash = hashWithSalt(code, resetFlow.codeSalt);
    if (incomingHash !== resetFlow.codeHash) {
      return res.status(400).json({
        ok: false,
        code: "RESET_CODE_MISMATCH",
        message: "验证码不正确。"
      });
    }
    const verifiedUntil = new Date(Date.now() + API_KEY_RESET_VERIFIED_TTL_MS).toISOString();
    await updateApiKeySettings((current) => {
      current.resetFlow = {
        codeSalt: "",
        codeHash: "",
        expiresAt: null,
        verifiedUntil,
        updatedAt: new Date().toISOString()
      };
      return current;
    });
    return res.json({
      ok: true,
      verifiedUntil
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: safeText(error instanceof Error ? error.message : String(error), "验证码校验失败。")
    });
  }
});

app.post("/api/system/credentials/password/update", async (req, res) => {
  const newPassword = String(req.body?.newPassword || "");
  if (!isValidManagerPassword(newPassword)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_PASSWORD",
      message: "新密码长度需在 8-128 个字符之间。"
    });
  }
  try {
    const settings = await loadApiKeySettings();
    const resetFlow = normalizeResetFlow(settings.resetFlow);
    const verifiedUntil = resetFlow.verifiedUntil ? new Date(resetFlow.verifiedUntil).getTime() : 0;
    if (!verifiedUntil || Date.now() > verifiedUntil) {
      return res.status(403).json({
        ok: false,
        code: "RESET_NOT_VERIFIED",
        message: "请先完成邮箱验证码校验，再修改密码。"
      });
    }
    const nextSalt = createSecretSalt();
    await updateApiKeySettings((current) => {
      current.password = {
        salt: nextSalt,
        hash: hashWithSalt(newPassword, nextSalt),
        updatedAt: new Date().toISOString()
      };
      current.resetFlow = {
        codeSalt: "",
        codeHash: "",
        expiresAt: null,
        verifiedUntil: null,
        updatedAt: new Date().toISOString()
      };
      return current;
    });
    apiKeyManagerSessions.clear();
    return res.json({
      ok: true,
      message: "密码修改成功，请使用新密码重新登录。"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: safeText(error instanceof Error ? error.message : String(error), "密码修改失败。")
    });
  }
});

app.get("/api/categories", async (_req, res) => {
  res.status(410).json({
    ok: false,
    code: "FEATURE_REMOVED",
    message: "分类管理功能已下线。"
  });
});

app.post("/api/categories/sync", async (req, res) => {
  res.status(410).json({
    ok: false,
    code: "FEATURE_REMOVED",
    message: "分类同步功能已下线。"
  });
});

app.post("/api/categories/merge", async (req, res) => {
  res.status(410).json({
    ok: false,
    code: "FEATURE_REMOVED",
    message: "分类合并功能已下线。"
  });
});

app.post("/api/categories/delete", async (req, res) => {
  res.status(410).json({
    ok: false,
    code: "FEATURE_REMOVED",
    message: "分类删除功能已下线。"
  });
});

app.use("/api/knowledge-base", (_req, res) => {
  res.status(410).json({
    ok: false,
    code: "FEATURE_REMOVED",
    message: "图片知识库功能已下线。"
  });
});

app.get("/products/manual/:recordId", async (req, res) => {
  const recordId = safeText(req.params.recordId);
  if (!recordId) {
    return res.status(400).send("Missing recordId.");
  }
  const items = await loadNormalizedProducts();
  const product = items.find((entry) => entry.recordId === recordId);
  if (!product) {
    return res.status(404).send("Product record not found.");
  }
  res.set("Content-Type", "text/html; charset=utf-8");
  return res.send(renderManualProductPage(product));
});

app.get("/api/image-proxy", async (req, res) => {
  const imageUrl = safeText(req.query.url);
  const referer = safeText(req.query.referer);
  if (!/^https?:\/\//i.test(imageUrl)) {
    return res.status(400).json({
      ok: false,
      message: "Invalid image url."
    });
  }

  try {
    const fetched = await fetchRemoteImageBuffer(imageUrl, {
      referer,
      timeoutMs: 45000
    });
    if (!fetched?.buffer?.length) {
      return res.status(502).json({
        ok: false,
        message: "Image fetch failed."
      });
    }
    res.set("Content-Type", fetched.mimeType);
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(fetched.buffer);
  } catch (_error) {
    return res.status(502).json({
      ok: false,
      message: "Image fetch failed."
    });
  }
});

app.get("/api/products", async (req, res) => {
  const items = await loadNormalizedProducts();
  const sortBy = String(req.query.sortBy || "capturedAt");
  const order = String(req.query.order || "desc");
  const sorted = sortProducts(items, sortBy, order);
  res.json({
    total: sorted.length,
    items: sorted
  });
});

app.post("/api/products/manual-upload", async (req, res) => {
  const payload = req.body?.product || req.body || {};
  const description = safeText(payload?.description || payload?.productDescription).slice(0, MAX_MANUAL_DESCRIPTION_LENGTH);
  const title = safeText(payload?.title || payload?.productTitle);
  const shopName = safeText(payload?.shopName, "手动上传");
  const imageInput = safeText(
    payload?.imageDataUrl || payload?.imageBase64 || payload?.image || payload?.whiteImageDataUrl || payload?.whiteImageBase64
  );

  if (!description) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_DESCRIPTION",
      message: "商品描述不能为空。"
    });
  }
  if (!imageInput) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_IMAGE",
      message: "请上传白底图。"
    });
  }

  let parsedImage = null;
  try {
    parsedImage = parseBase64ImageInput(imageInput);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_IMAGE_PAYLOAD",
      message: safeText(error instanceof Error ? error.message : String(error), "图片格式无效。")
    });
  }
  if (!parsedImage?.buffer?.length) {
    return res.status(400).json({
      ok: false,
      code: "EMPTY_IMAGE",
      message: "图片内容为空。"
    });
  }
  if (parsedImage.buffer.length > MAX_MANUAL_IMAGE_BYTES) {
    return res.status(413).json({
      ok: false,
      code: "IMAGE_TOO_LARGE",
      message: `图片大小超过限制（${Math.floor(MAX_MANUAL_IMAGE_BYTES / 1024 / 1024)}MB）。`
    });
  }

  const savedImage = await saveManualProductImage(parsedImage);
  const publicBaseUrl = getPublicBaseUrl(req);
  const capturedAt = new Date().toISOString();
  const productId = createManualProductId(payload?.productId, title);
  const recordId = `${productId}_${capturedAt}`;
  const imageUrl = `${publicBaseUrl}${savedImage.imageUrl}`;
  const productLink = `${publicBaseUrl}/products/manual/${encodeURIComponent(recordId)}`;

  const manualProductPayload = {
    recordId,
    productId,
    title: title || `手动上传商品 ${productId}`,
    url: productLink,
    shopName,
    images: [imageUrl],
    triggeredImage: imageUrl,
    skuDimensions: [],
    skuItems: [],
    priceTiers: [],
    priceMin: null,
    priceMax: null,
    productAttributes: [
      {
        name: "商品描述",
        value: description
      }
    ],
    packageSpecs: [],
    capturedAt,
    source: "web-manual-upload"
  };

  const incoming = normalizeProduct(manualProductPayload, null);
  const items = await loadProducts();
  items.push(incoming);
  await saveProducts(items);
  await syncCategoryCatalogFromProducts();
  return res.status(201).json({
    ok: true,
    item: incoming,
    productLink
  });
});

app.post("/api/products", async (req, res) => {
  const payload = req.body?.product || req.body || {};
  const recordId = String(payload?.recordId || "").trim();
  const items = await loadProducts();
  const existingIndex = recordId ? items.findIndex((item) => item.recordId === recordId) : -1;
  const existing = existingIndex >= 0 ? items[existingIndex] : null;
  const incoming = normalizeProduct(payload, existing);

  if (existingIndex >= 0) {
    items[existingIndex] = incoming;
  } else {
    items.push(incoming);
  }
  await saveProducts(items);
  await syncCategoryCatalogFromProducts();
  res.status(201).json({
    ok: true,
    item: incoming
  });
});

app.post("/api/products/:recordId/analyze", async (req, res) => {
  if (!getFirstPassAnalysisApiKey()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing FIRST_PASS_ANALYSIS_API_KEY"
    });
  }

  const recordId = String(req.params.recordId || "").trim();
  const items = await loadNormalizedProducts();
  const exists = items.some((item) => item.recordId === recordId);
  if (!exists) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }

  const jobId = createJobId(recordId);
  await setAnalysisState(recordId, {
    status: "queued",
    jobId,
    error: null,
    updatedAt: new Date().toISOString(),
    result: null
  });

  analysisQueue.push({
    recordId,
    jobId
  });
  void runAnalysisQueue();

  res.status(202).json({
    ok: true,
    accepted: true,
    recordId,
    jobId,
    status: "queued"
  });
});

app.get("/api/products/:recordId/analyze/status", async (req, res) => {
  const recordId = String(req.params.recordId || "").trim();
  const items = await loadNormalizedProducts();
  const item = items.find((entry) => entry.recordId === recordId);
  if (!item) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }
  res.json({
    ok: true,
    recordId,
    analysis: item.analysis,
    videoScriptGeneration: item.videoScriptGeneration,
    secondPromptGeneration: item.secondPromptGeneration,
    videoClipGeneration: item.videoClipGeneration
  });
});

app.post("/api/products/:recordId/prompt-pack", async (req, res) => {
  if (!getPromptPackApiKey()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing SECOND_STAGE_PROMPT_API_KEY"
    });
  }

  const recordId = String(req.params.recordId || "").trim();
  const priorityDetailedDescription = safeText(
    req.body?.priority_detailed_description ||
      req.body?.priorityDetailedDescription ||
      req.body?.detailed_description ||
      req.body?.detailedDescription
  );
  const detailAspectRatio = normalizeDetailPromptAspectRatio(
    req.body?.detailAspectRatio || req.body?.detail_aspect_ratio || req.query?.detailAspectRatio || req.query?.detail_aspect_ratio
  );
  const locale = normalizePromptPackLocaleConfig({
    targetMarket:
      req.body?.target_market ||
      req.body?.targetMarket ||
      req.query?.target_market ||
      req.query?.targetMarket ||
      req.body?.market ||
      req.query?.market,
    promptLanguage:
      req.body?.prompt_language ||
      req.body?.promptLanguage ||
      req.query?.prompt_language ||
      req.query?.promptLanguage ||
      req.body?.language ||
      req.query?.language,
    inImageTextLanguage:
      req.body?.in_image_text_language ||
      req.body?.inImageTextLanguage ||
      req.query?.in_image_text_language ||
      req.query?.inImageTextLanguage ||
      req.body?.target_language ||
      req.body?.targetLanguage ||
      req.query?.target_language ||
      req.query?.targetLanguage
  });
  const items = await loadNormalizedProducts();
  const product = items.find((entry) => entry.recordId === recordId);
  if (!product) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }

  const analysis = normalizeAnalysisState(product.analysis);
  if (analysis.status !== "completed" || !analysis.result) {
    return res.status(409).json({
      ok: false,
      message: "请先完成第一次 AI 分析，再发起图词请求。"
    });
  }

  const jobId = createJobId(`prompt_${recordId}`);
  await setSecondPromptGenerationState(recordId, {
    status: "processing",
    jobId,
    error: null,
    updatedAt: new Date().toISOString(),
    result: null
  });

  void processPromptPackJob({
    recordId,
    jobId,
    detailAspectRatio,
    priorityDetailedDescription,
    targetMarket: locale.targetMarket,
    promptLanguage: locale.promptLanguage,
    inImageTextLanguage: locale.inImageTextLanguage
  });

  res.status(202).json({
    ok: true,
    accepted: true,
    recordId,
    jobId,
    status: "processing",
    secondPromptGeneration: {
      status: "processing",
      jobId,
      error: null,
      updatedAt: new Date().toISOString(),
      result: null
    },
    detailAspectRatio,
    priorityDetailedDescription: priorityDetailedDescription || null,
    targetMarket: locale.targetMarket,
    promptLanguage: locale.promptLanguage,
    inImageTextLanguage: locale.inImageTextLanguage
  });
});

app.get("/api/products/:recordId/prompt-pack/status", async (req, res) => {
  const recordId = String(req.params.recordId || "").trim();
  const items = await loadNormalizedProducts();
  const item = items.find((entry) => entry.recordId === recordId);
  if (!item) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }
  res.json({
    ok: true,
    recordId,
    secondPromptGeneration: item.secondPromptGeneration
  });
});

app.post("/api/products/:recordId/video-script", async (req, res) => {
  const recordId = String(req.params.recordId || "").trim();
  const items = await loadNormalizedProducts();
  const product = items.find((entry) => entry.recordId === recordId);
  if (!product) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }
  const analysis = normalizeAnalysisState(product.analysis);
  if (analysis.status !== "completed" || !analysis.result) {
    return res.status(409).json({
      ok: false,
      message: "请先完成第一次 AI 分析，再发起短视频提示词请求。"
    });
  }
  const secondPrompt = normalizeSecondPromptGenerationState(product.secondPromptGeneration);
  if (secondPrompt.status !== "completed" || !secondPrompt.result) {
    return res.status(409).json({
      ok: false,
      message: "请先完成图词请求，生成产品详细外观/材质/形状/尺寸信息后再发起短视频提示词请求。"
    });
  }
  const promptPackProductProfile = extractPromptPackProductProfile(secondPrompt.result, analysis.result);
  if (!promptPackProductProfile) {
    return res.status(409).json({
      ok: false,
      message: "图词请求结果中缺少产品详细外观/材质/形状/尺寸信息，请先重跑图词请求。"
    });
  }
  if (!getShortVideoPromptApiKey()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing SHORT_VIDEO_PROMPT_API_KEY"
    });
  }
  if (!getShortVideoPromptApiUrl()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing SHORT_VIDEO_PROMPT_API_URL"
    });
  }
  const secondPromptLocale = normalizePromptPackLocaleConfig(secondPrompt.result?.requestContext?.locale || {});
  const locale = normalizePromptPackLocaleConfig({
    targetMarket:
      req.body?.target_market ||
      req.body?.targetMarket ||
      req.query?.target_market ||
      req.query?.targetMarket ||
      req.body?.market ||
      req.query?.market ||
      secondPromptLocale.targetMarket,
    promptLanguage:
      req.body?.prompt_language ||
      req.body?.promptLanguage ||
      req.query?.prompt_language ||
      req.query?.promptLanguage ||
      req.body?.language ||
      req.query?.language ||
      secondPromptLocale.promptLanguage,
    inImageTextLanguage:
      req.body?.in_image_text_language ||
      req.body?.inImageTextLanguage ||
      req.query?.in_image_text_language ||
      req.query?.inImageTextLanguage ||
      req.body?.target_language ||
      req.body?.targetLanguage ||
      req.query?.target_language ||
      req.query?.targetLanguage ||
      secondPromptLocale.inImageTextLanguage
  });

  const inputPayloadOverride = extractVideoScriptInputPayloadOverride(req.body);
  const existingVideoState = normalizeVideoScriptGenerationState(product.videoScriptGeneration);
  await setVideoScriptGenerationState(recordId, {
    status: "processing",
    error: null,
    updatedAt: new Date().toISOString(),
    result: existingVideoState.result
  });
  await setVideoClipGenerationState(recordId, {
    updatedAt: new Date().toISOString(),
    items: []
  });

  try {
    const builtInputPayload = await buildVideoAgentInputPayload({
      analysisResult: analysis.result,
      secondPromptResult: secondPrompt.result,
      existingInputPayload: existingVideoState.result?.inputPayload || null
    });
    const inputPayload = mergeVideoAgentInputPayload(builtInputPayload, inputPayloadOverride);
    if (!safeText(inputPayload.product_params?.product_description)) {
      throw new Error("第一次分析缺少商品描述，请先重新执行 AI 分析。");
    }

    const result = await requestShortVideoPromptScripts({
      product,
      analysisResult: analysis.result,
      inputPayload,
      localeConfig: locale
    });
    const saved = await setVideoScriptGenerationState(recordId, {
      status: "completed",
      error: null,
      updatedAt: new Date().toISOString(),
      result
    });
    return res.json({
      ok: true,
      recordId,
      videoScriptGeneration: saved.item?.videoScriptGeneration || normalizeVideoScriptGenerationState({
        status: "completed",
        error: null,
        updatedAt: new Date().toISOString(),
        result
      })
    });
  } catch (error) {
    const debugResult =
      error && typeof error === "object" && safeObject(error.debugResult) ? normalizeVideoScriptGenerationResult(error.debugResult) : null;
    const mergedFailureResult = mergeVideoScriptFailureResult(existingVideoState.result, debugResult);
    const message = normalizeModelErrorMessage(error instanceof Error ? error.message : error);
    const saved = await setVideoScriptGenerationState(recordId, {
      status: "failed",
      error: message,
      updatedAt: new Date().toISOString(),
      result: mergedFailureResult
    });
    return res.status(502).json({
      ok: false,
      recordId,
      message,
      videoScriptGeneration: saved.item?.videoScriptGeneration || normalizeVideoScriptGenerationState({
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString(),
        result: mergedFailureResult
      })
    });
  }
});

app.post("/api/products/:recordId/video-script/debug", async (req, res) => {
  const recordId = String(req.params.recordId || "").trim();
  const items = await loadNormalizedProducts();
  const product = items.find((entry) => entry.recordId === recordId);
  if (!product) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }
  const analysis = normalizeAnalysisState(product.analysis);
  if (analysis.status !== "completed" || !analysis.result) {
    return res.status(409).json({
      ok: false,
      message: "请先完成第一次 AI 分析，再发起短视频调试请求。"
    });
  }
  const secondPrompt = normalizeSecondPromptGenerationState(product.secondPromptGeneration);
  if (secondPrompt.status !== "completed" || !secondPrompt.result) {
    return res.status(409).json({
      ok: false,
      message: "请先完成图词请求，生成产品详细外观/材质/形状/尺寸信息后再发起短视频调试请求。"
    });
  }
  const promptPackProductProfile = extractPromptPackProductProfile(secondPrompt.result, analysis.result);
  if (!promptPackProductProfile) {
    return res.status(409).json({
      ok: false,
      message: "图词请求结果中缺少产品详细外观/材质/形状/尺寸信息，请先重跑图词请求。"
    });
  }
  if (!getShortVideoPromptApiKey()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing SHORT_VIDEO_PROMPT_API_KEY"
    });
  }
  if (!getShortVideoPromptApiUrl()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing SHORT_VIDEO_PROMPT_API_URL"
    });
  }
  const secondPromptLocale = normalizePromptPackLocaleConfig(secondPrompt.result?.requestContext?.locale || {});
  const locale = normalizePromptPackLocaleConfig({
    targetMarket:
      req.body?.target_market ||
      req.body?.targetMarket ||
      req.query?.target_market ||
      req.query?.targetMarket ||
      req.body?.market ||
      req.query?.market ||
      secondPromptLocale.targetMarket,
    promptLanguage:
      req.body?.prompt_language ||
      req.body?.promptLanguage ||
      req.query?.prompt_language ||
      req.query?.promptLanguage ||
      req.body?.language ||
      req.query?.language ||
      secondPromptLocale.promptLanguage,
    inImageTextLanguage:
      req.body?.in_image_text_language ||
      req.body?.inImageTextLanguage ||
      req.query?.in_image_text_language ||
      req.query?.inImageTextLanguage ||
      req.body?.target_language ||
      req.body?.targetLanguage ||
      req.query?.target_language ||
      req.query?.targetLanguage ||
      secondPromptLocale.inImageTextLanguage
  });

  const inputPayloadOverride = extractVideoScriptInputPayloadOverride(req.body);
  const existingVideoState = normalizeVideoScriptGenerationState(product.videoScriptGeneration);
  try {
    const builtInputPayload = await buildVideoAgentInputPayload({
      analysisResult: analysis.result,
      secondPromptResult: secondPrompt.result,
      existingInputPayload: existingVideoState.result?.inputPayload || null
    });
    const inputPayload = mergeVideoAgentInputPayload(builtInputPayload, inputPayloadOverride);
    if (!safeText(inputPayload.product_params?.product_description)) {
      throw new Error("第一次分析缺少商品描述，请先重新执行 AI 分析。");
    }

    const debugResult = await requestShortVideoPromptScripts({
      product,
      analysisResult: analysis.result,
      inputPayload,
      localeConfig: locale
    });
    const mergedResult = mergeVideoScriptFailureResult(existingVideoState.result, debugResult);
    const nextStatus = existingVideoState.status === "completed" ? "completed" : "failed";
    const saved = await setVideoScriptGenerationState(recordId, {
      status: nextStatus,
      error: null,
      updatedAt: new Date().toISOString(),
      result: mergedResult
    });
    return res.json({
      ok: true,
      debug: true,
      recordId,
      message: "调试请求成功，已更新原始响应信息。",
      videoScriptGeneration: saved.item?.videoScriptGeneration || normalizeVideoScriptGenerationState({
        status: nextStatus,
        error: null,
        updatedAt: new Date().toISOString(),
        result: mergedResult
      })
    });
  } catch (error) {
    const debugResult =
      error && typeof error === "object" && safeObject(error.debugResult) ? normalizeVideoScriptGenerationResult(error.debugResult) : null;
    const mergedFailureResult = mergeVideoScriptFailureResult(existingVideoState.result, debugResult);
    const message = normalizeModelErrorMessage(error instanceof Error ? error.message : error);
    const saved = await setVideoScriptGenerationState(recordId, {
      status: "failed",
      error: `[调试] ${message}`,
      updatedAt: new Date().toISOString(),
      result: mergedFailureResult
    });
    return res.status(502).json({
      ok: false,
      debug: true,
      recordId,
      message,
      videoScriptGeneration: saved.item?.videoScriptGeneration || normalizeVideoScriptGenerationState({
        status: "failed",
        error: `[调试] ${message}`,
        updatedAt: new Date().toISOString(),
        result: mergedFailureResult
      })
    });
  }
});

app.get("/api/products/:recordId/video-script/status", async (req, res) => {
  const recordId = String(req.params.recordId || "").trim();
  const items = await loadNormalizedProducts();
  const item = items.find((entry) => entry.recordId === recordId);
  if (!item) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }
  res.json({
    ok: true,
    recordId,
    videoScriptGeneration: item.videoScriptGeneration
  });
});

app.post("/api/products/:recordId/video-clips/generate", async (req, res) => {
  const recordId = safeText(req.params.recordId);
  const items = await loadNormalizedProducts();
  const product = items.find((entry) => entry.recordId === recordId);
  if (!product) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }
  if (!getShortVideoRenderApiKey()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing SHORT_VIDEO_RENDER_API_KEY"
    });
  }
  if (!getShortVideoCreateApiUrl() || !getShortVideoQueryApiUrl()) {
    return res.status(503).json({
      ok: false,
      message: "Server is missing SHORT_VIDEO_CREATE_API_URL or SHORT_VIDEO_QUERY_API_URL"
    });
  }
  const body = safeObject(req.body) || {};
  const setKey = safeText(body.setKey);
  const clipIndex = Math.max(0, Math.floor(Number(body.clipIndex) || 0));
  const prompt = safeText(body.prompt);
  const firstFrameUrl = safeText(body.firstFrameUrl);
  const lastFrameUrl = safeText(body.lastFrameUrl);
  const urls = uniqueStrings(toArray(body.urls || [])).slice(0, 8);
  const firstFrameName = safeText(body.firstFrameName);
  const lastFrameName = safeText(body.lastFrameName);
  const aspectRatio = safeText(body.aspectRatio, VEO_DEFAULT_ASPECT_RATIO);
  const maxRetries = parseIntWithBounds(body.maxRetries, VIDEO_CLIP_MAX_RETRIES, 1, 6);
  const retryDelayMs = parseIntWithBounds(body.retryDelayMs, VIDEO_CLIP_RETRY_DELAY_MS, 500, 30000);
  const normalizedRequestImages = collectFallbackBase64ImagesFromJob({
    firstFrameUrl,
    lastFrameUrl,
    urls
  });
  if (!setKey) {
    return res.status(400).json({ ok: false, message: "setKey 不能为空。" });
  }
  if (!prompt) {
    return res.status(400).json({ ok: false, message: "prompt 不能为空。" });
  }
  if (!normalizedRequestImages.length) {
    return res.status(400).json({ ok: false, message: "请先上传至少一张图片后再生成视频。" });
  }

  const existingState = normalizeVideoClipGenerationState(product.videoClipGeneration);
  const taskKey = buildVideoClipTaskKey(setKey, clipIndex);
  const existingTask = existingState.items.find((item) => item.key === taskKey) || null;
  if (existingTask && (existingTask.status === "queued" || existingTask.status === "processing")) {
    return res.status(202).json({
      ok: true,
      accepted: false,
      recordId,
      task: existingTask,
      videoClipGeneration: existingState
    });
  }

  const jobId = createJobId(`veoclip_${recordId}_${setKey}_${clipIndex}`);
  const queued = await upsertVideoClipTaskState(recordId, setKey, clipIndex, {
    status: "queued",
    jobId,
    retryCount: 0,
    maxRetries,
    taskId: null,
    prompt,
    firstFrameUrl,
    lastFrameUrl,
    urls,
    firstFrameName,
    lastFrameName,
    aspectRatio,
    videoUrl: "",
    error: null,
    completedAt: null
  });
  const task = normalizeVideoClipGenerationState(queued.item?.videoClipGeneration).items.find((item) => item.key === taskKey) || null;

  enqueueVideoClipJob({
    recordId,
    setKey,
    clipIndex,
    prompt,
    firstFrameUrl,
    lastFrameUrl,
    urls,
    firstFrameName,
    lastFrameName,
    aspectRatio,
    pollIntervalMs: parseIntWithBounds(body.pollIntervalMs, SHORT_VIDEO_POLL_INTERVAL_MS, 1000, 60000),
    pollTimeoutMs: parseIntWithBounds(body.pollTimeoutMs, SHORT_VIDEO_POLL_TIMEOUT_MS, 15000, 1800000),
    createTimeoutMs: parseIntWithBounds(body.createTimeoutMs, SHORT_VIDEO_CREATE_TIMEOUT_MS, 15000, 300000),
    resultTimeoutMs: parseIntWithBounds(body.resultTimeoutMs, SHORT_VIDEO_QUERY_TIMEOUT_MS, 10000, 180000),
    maxRetries,
    retryDelayMs,
    jobId
  });
  runVideoClipQueue();

  return res.status(202).json({
    ok: true,
    accepted: true,
    recordId,
    task,
    videoClipGeneration: normalizeVideoClipGenerationState(queued.item?.videoClipGeneration)
  });
});

app.get("/api/products/:recordId/video-clips/status", async (req, res) => {
  const recordId = safeText(req.params.recordId);
  const items = await loadNormalizedProducts();
  const item = items.find((entry) => entry.recordId === recordId);
  if (!item) {
    return res.status(404).json({ ok: false, message: "Product record not found" });
  }
  return res.json({
    ok: true,
    recordId,
    videoClipGeneration: normalizeVideoClipGenerationState(item.videoClipGeneration)
  });
});

app.post("/api/video/veo/create-and-wait", async (req, res) => {
  const body = safeObject(req.body) || {};
  const prompt = safeText(body.prompt);
  if (!prompt) {
    return res.status(400).json({
      ok: false,
      message: "prompt 不能为空。"
    });
  }

  const requestOptions = {
    baseUrl: safeText(body.baseUrl),
    apiKey: safeText(body.apiKey),
    createTimeoutMs: parseIntWithBounds(body.createTimeoutMs, VEO_CREATE_TIMEOUT_MS, 15000, 300000),
    resultTimeoutMs: parseIntWithBounds(body.resultTimeoutMs, VEO_RESULT_TIMEOUT_MS, 10000, 180000),
    pollIntervalMs: parseIntWithBounds(body.pollIntervalMs, VEO_POLL_INTERVAL_MS, 1000, 60000),
    pollTimeoutMs: parseIntWithBounds(body.pollTimeoutMs, VEO_POLL_TIMEOUT_MS, 15000, 1800000)
  };

  let taskId = "";
  let createResponse = null;
  try {
    createResponse = await requestVeoCreateVideoTask(
      {
        prompt,
        model: safeText(body.model, getVeoDefaultModel()),
        firstFrameUrl: safeText(body.firstFrameUrl),
        lastFrameUrl: safeText(body.lastFrameUrl),
        urls: uniqueStrings(toArray(body.urls || [])).slice(0, 8),
        aspectRatio: safeText(body.aspectRatio, VEO_DEFAULT_ASPECT_RATIO)
      },
      requestOptions
    );
    taskId = extractVeoTaskId(createResponse);
    const { resultPayload, status } = await pollVeoUntilDone(taskId, requestOptions);
    const videoUrl = pickVeoVideoUrl(resultPayload);
    return res.json({
      ok: true,
      taskId,
      status,
      videoUrl,
      createResponse,
      result: resultPayload,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    const message = buildVeoErrorSnippet(error instanceof Error ? error.message : String(error), 360) || "VEO 请求失败";
    const statusCode = /missing VEO_API_(KEY|BASE_URL)/i.test(message) ? 503 : 502;
    return res.status(statusCode).json({
      ok: false,
      message,
      taskId: taskId || null,
      createResponse: createResponse || null
    });
  }
});

app.delete("/api/products/:recordId", async (req, res) => {
  const recordId = String(req.params.recordId || "").trim();
  const items = await loadProducts();
  const next = items.filter((item) => item.recordId !== recordId);
  const removed = items.length - next.length;
  await saveProducts(next);
  res.json({
    ok: true,
    removed
  });
});

app.post("/api/products/batch-delete", async (req, res) => {
  const recordIds = uniqueStrings(req.body?.recordIds || []);
  if (!recordIds.length) {
    return res.status(400).json({ ok: false, message: "recordIds 涓嶈兘涓虹┖" });
  }
  const recordSet = new Set(recordIds);
  const items = await loadProducts();
  const next = items.filter((item) => !recordSet.has(item.recordId));
  const removed = items.length - next.length;
  await saveProducts(next);
  res.json({
    ok: true,
    removed
  });
});

if (HAS_WEB_DIST) {
  app.use(express.static(WEB_DIST_DIR));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(WEB_INDEX_FILE);
  });
} else {
  console.warn(`[web] dist not found at ${WEB_INDEX_FILE}, UI routes are disabled.`);
}

app.listen(PORT, () => {
  console.log(`API server started at http://localhost:${PORT} (analysis concurrency=${ANALYSIS_CONCURRENCY})`);
  void repairBrokenProductImageRecordsOnStartup().catch((error) => {
    console.error("repairBrokenProductImageRecordsOnStartup failed:", error);
  });
  void restoreVideoClipQueueFromStore().catch((error) => {
    console.error("restoreVideoClipQueueFromStore failed:", error);
  });
});

