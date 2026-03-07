const fs = require("fs/promises");
const path = require("path");
const { VIDEO_KNOWLEDGE_BLOCKS, VIDEO_KNOWLEDGE_DEFAULT_BLOCKS } = require("./video-knowledge-base");

let sharp = null;
try {
  sharp = require("sharp");
} catch (_error) {
  sharp = null;
}

const CLAUDE_DEFAULT_BASE_URL = "https://code.newcli.com/claude/droid";
const CLAUDE_MODEL_SONNET = "claude-sonnet-4-6";
const CLAUDE_MODEL_OPUS = "claude-opus-4-6";
const CLAUDE_DEFAULT_MODEL = CLAUDE_MODEL_SONNET;
const CLAUDE_API_PATH = "/v1/messages";
const VECTORENGINE_DEFAULT_BASE_URL = "https://api.vectorengine.ai";
const VECTORENGINE_CHAT_API_PATH = "/v1/chat/completions";
const FIRST_PASS_GEMINI_MODEL = "gemini-2.5-flash-lite-thinking";
const SECOND_STAGE_PROMPT_GEMINI_MODEL = "gemini-2.5-flash-lite-thinking";
const SECOND_STAGE_SYSTEM_PROMPT =
  "You are a strict e-commerce prompt generator. Output valid JSON only and follow the output contract exactly. Non-negotiable count rule: main_images must be 9 and detail_images must be 5.";
const ANALYSIS_JSON_KEYS = [
  "material_analysis",
  "appearance_description",
  "color_analysis",
  "size_and_specs",
  "usage_and_target_audience",
  "detailed_description",
  "selling_points",
  "procurement_risks"
];
const PROMPT_JSON_KEYS = ["top_selling_points", "main_images", "detail_images"];
const PROMPT_TEMPLATE_V21_KEYS = ["product_name", "product_profile", "main_images", "detail_images", "metadata"];
const DETAIL_PROMPT_ASPECT_RATIOS = new Set(["1:1", "9:16"]);
const DEFAULT_PROMPT_PACK_TARGET_MARKET = "United States";
const DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE = "English";
const DEFAULT_PROMPT_PACK_IN_IMAGE_TEXT_LANGUAGE = "English";
const PROMPT_SEGMENT_KEYS = [
  "image_type",
  "subject_description",
  "scene_background",
  "people_or_props",
  "color_style",
  "portuguese_text",
  "composition",
  "mood_keywords"
];
const CATEGORY_RECOGNITION_KEYS = ["category_id", "category_name", "confidence", "reason"];
const KNOWLEDGE_IMAGE_ANALYSIS_KEYS = [
  "positive_prompt",
  "negative_prompt",
  "overall_style",
  "color_scheme",
  "background_description",
  "model_info",
  "composition",
  "lighting_and_texture",
  "summary"
];
const KNOWLEDGE_COMPRESSION_KEYS = [
  "positive_prompt",
  "negative_prompt",
  "overall_style",
  "color_scheme",
  "background_description",
  "model_info",
  "composition",
  "lighting_and_texture",
  "summary"
];
const VIDEO_SCRIPT_FORMAT_ERROR = "VIDEO_SCRIPT_FORMAT_INVALID";
const VIDEO_SCRIPT_SCENE_COUNT_MIN = 7;
const VIDEO_SCRIPT_SCENE_COUNT_MAX = 8;
const VIDEO_SCRIPT_SCENE_DURATION_MIN = 4;
const VIDEO_SCRIPT_SCENE_DURATION_MAX = 6;
const VIDEO_SCRIPT_TOTAL_DURATION_MIN = 35;
const VIDEO_SCRIPT_TOTAL_DURATION_MAX = 40;
const VIDEO_SCRIPT_ALLOWED_MODES = new Set(["首帧生视频", "首尾帧生视频"]);

const MAIN_IMAGE_SLOTS = [
  {
    id: 1,
    type: "白底标准图",
    description: "产品正面全貌，白底，主体居中，轮廓清晰",
    defaultPortugueseText: "Produto original em destaque"
  },
  {
    id: 2,
    type: "卖点爆炸贴图",
    description: "白底基础上增加卖点爆炸贴和葡语标注",
    defaultPortugueseText: "Vantagens principais: Qualidade, Resistência e Uso fácil"
  },
  {
    id: 3,
    type: "场景生活图",
    description: "巴西家庭、厨房或户外真实使用场景",
    defaultPortugueseText: "Perfeito para o dia a dia no Brasil"
  },
  {
    id: 4,
    type: "多角度展示图",
    description: "正面、侧面、背面组合展示",
    defaultPortugueseText: "Visão completa em vários ângulos"
  },
  {
    id: 5,
    type: "细节放大图",
    description: "核心功能部件或材质纹理特写",
    defaultPortugueseText: "Detalhes que fazem diferença"
  },
  {
    id: 6,
    type: "对比图",
    description: "使用前后对比或与同类产品优势对比",
    defaultPortugueseText: "Antes e depois: resultado visível"
  },
  {
    id: 7,
    type: "人物互动图",
    description: "巴西本地人物使用产品，情绪自然热情",
    defaultPortugueseText: "Mais praticidade para sua rotina"
  },
  {
    id: 8,
    type: "套装/配件全家福",
    description: "展示套装内容和配件完整性",
    defaultPortugueseText: "Kit completo pronto para usar"
  },
  {
    id: 9,
    type: "促销氛围图",
    description: "融入巴西节日与促销元素，强调紧迫感",
    defaultPortugueseText: "Oferta por tempo limitado: aproveite agora"
  }
];

const DETAIL_IMAGE_SLOTS = [
  {
    id: 1,
    type: "核心卖点总览图",
    description: "集中呈现3-5个核心卖点并葡语标注",
    defaultPortugueseText: "Principais benefícios em um só olhar"
  },
  {
    id: 2,
    type: "功能拆解说明图",
    description: "各部件功能图解，配葡语说明",
    defaultPortugueseText: "Entenda cada função com clareza"
  },
  {
    id: 3,
    type: "使用场景沉浸图",
    description: "深度巴西本土生活场景，强调日常融入感",
    defaultPortugueseText: "Feito para o estilo de vida brasileiro"
  },
  {
    id: 4,
    type: "尺寸/规格参数图",
    description: "尺寸、重量、材质等参数可视化展示",
    defaultPortugueseText: "Medidas e especificações claras"
  },
  {
    id: 5,
    type: "信任背书/售后保障图",
    description: "品质认证、售后政策、评价背书",
    defaultPortugueseText: "Compra segura com suporte garantido"
  }
];

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => safeText(item)).filter(Boolean))];
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function createJobId(recordId) {
  const safeRecordId = safeText(recordId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `job_${safeRecordId}_${Date.now()}`;
}

function sanitizeAnalysisResult(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const sellingPoints = uniqueStrings(source.selling_points || source.sellingPoints || []).slice(0, 5);
  const procurementRisks = uniqueStrings(source.procurement_risks || source.procurementRisks || []).slice(0, 8);

  return {
    materialAnalysis: safeText(source.material_analysis || source.materialAnalysis),
    appearanceDescription: safeText(source.appearance_description || source.appearanceDescription),
    colorAnalysis: safeText(source.color_analysis || source.colorAnalysis),
    sizeAndSpecs: safeText(source.size_and_specs || source.sizeAndSpecs),
    usageAndTargetAudience: safeText(source.usage_and_target_audience || source.usageAndTargetAudience),
    detailedDescription: safeText(source.detailed_description || source.detailedDescription),
    sellingPoints,
    procurementRisks
  };
}

function safePromptText(value, fallback = "") {
  return safeText(value, fallback).replace(/\s+/g, " ").trim();
}

function buildStructuredPromptText(segments) {
  return (
    `[${segments.imageType}] + ` +
    `[${segments.subjectDescription}] + ` +
    `[${segments.sceneBackground}] + ` +
    `[${segments.peopleOrProps}] + ` +
    `[${segments.colorStyle}] + ` +
    `[${segments.portugueseText}] + ` +
    `[${segments.composition}] + ` +
    `[${segments.moodKeywords}]`
  );
}

function pickTopSellingPoints(inputPoints, analysisResult) {
  const seeded = uniqueStrings(inputPoints || []).slice(0, 5);
  if (seeded.length >= 3) {
    return seeded;
  }

  const fromAnalysis = uniqueStrings(analysisResult?.sellingPoints || []).slice(0, 5);
  const fallback = uniqueStrings([
    analysisResult?.materialAnalysis,
    analysisResult?.appearanceDescription,
    analysisResult?.colorAnalysis,
    analysisResult?.usageAndTargetAudience
  ]);

  const merged = uniqueStrings([...seeded, ...fromAnalysis, ...fallback]);
  if (merged.length >= 3) {
    return merged.slice(0, 5);
  }

  return [
    "品质稳定，做工扎实",
    "使用便捷，场景适配度高",
    "视觉突出，适合电商转化"
  ];
}

function normalizePromptCard(rawCard, slot, index, topSellingPoints) {
  const source = rawCard && typeof rawCard === "object" ? rawCard : {};
  const corePointText = topSellingPoints.slice(0, 3).join("；");
  const imageType = safePromptText(source.image_type || source.imageType, slot.type);
  const subjectDescription = safePromptText(
    source.subject_description || source.subjectDescription,
    `突出商品主体与核心卖点：${corePointText || "核心卖点强化"}`
  );
  const sceneBackground = safePromptText(
    source.scene_background || source.sceneBackground,
    `围绕${slot.type}设计，融入巴西本地生活语境`
  );
  const peopleOrProps = safePromptText(
    source.people_or_props || source.peopleOrProps,
    "加入巴西本土人物或辅助道具，强化使用场景"
  );
  const colorStyle = safePromptText(
    source.color_style || source.colorStyle,
    "高饱和巴西风格，绿色/黄色/蓝色与暖色强调购买欲"
  );
  const portugueseText = safePromptText(source.portuguese_text || source.portugueseText, slot.defaultPortugueseText);
  const composition = safePromptText(
    source.composition,
    index <= 9 ? "主体大比例居中，信息分区清晰，缩略图可读性高" : "分层排版，信息路径清晰，便于详情页阅读"
  );
  const moodKeywords = safePromptText(
    source.mood_keywords || source.moodKeywords,
    "energético, caloroso, confiável, desejo de compra"
  );

  const card = {
    id: slot.id,
    type: slot.type,
    imageType,
    subjectDescription,
    sceneBackground,
    peopleOrProps,
    colorStyle,
    portugueseText,
    composition,
    moodKeywords
  };

  return {
    ...card,
    prompt: buildStructuredPromptText(card)
  };
}

function parseConfidence(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1) {
      return Math.max(0, Math.min(1, Number((value / 100).toFixed(4))));
    }
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }
  const matched = safeText(value).match(/-?\d+(\.\d+)?/);
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

function sanitizeStyleParameters(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    positivePrompt: safePromptText(source.positive_prompt || source.positivePrompt),
    negativePrompt: safePromptText(source.negative_prompt || source.negativePrompt),
    recommendedStyle: safePromptText(source.recommended_style || source.recommendedStyle),
    backgroundPlan: safePromptText(source.background_plan || source.backgroundPlan),
    compositionGuidance: safePromptText(source.composition_guidance || source.compositionGuidance),
    colorDirection: safePromptText(source.color_direction || source.colorDirection),
    lightingStyle: safePromptText(source.lighting_style || source.lightingStyle),
    productFocus: safePromptText(source.product_focus || source.productFocus),
    notes: safePromptText(source.notes || source.extra_notes || source.extraNotes)
  };
}

function sanitizeCategoryReference(raw, fallback = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  const confidence = parseConfidence(
    source.confidence ?? source.category_confidence ?? fallbackSource.confidence,
    parseConfidence(fallbackSource.confidence, 0)
  );
  return {
    categoryId: safeText(source.category_id || source.categoryId || fallbackSource.categoryId),
    categoryName: safeText(source.category_name || source.categoryName || fallbackSource.categoryName),
    confidence,
    reason: safeText(source.reason || source.judgement || fallbackSource.reason)
  };
}

function sanitizePromptGenerationResult(payload, analysisResult, extra = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const topSellingPoints = pickTopSellingPoints(source.top_selling_points || source.topSellingPoints, analysisResult);

  const mainRaw = toArray(source.main_images || source.mainImages);
  const detailRaw = toArray(source.detail_images || source.detailImages);
  const mainById = new Map(mainRaw.map((item) => [Number(item?.id), item]));
  const detailById = new Map(detailRaw.map((item) => [Number(item?.id), item]));

  const mainImagePrompts = MAIN_IMAGE_SLOTS.map((slot, index) =>
    normalizePromptCard(mainById.get(slot.id) || mainRaw[index] || {}, slot, index + 1, topSellingPoints)
  );
  const detailImagePrompts = DETAIL_IMAGE_SLOTS.map((slot, index) =>
    normalizePromptCard(detailById.get(slot.id) || detailRaw[index] || {}, slot, index + 10, topSellingPoints)
  );
  const styleParameters = sanitizeStyleParameters(source.style_parameters || source.styleParameters || {});
  const categoryReference = sanitizeCategoryReference(
    source.category_reference || source.categoryReference || {},
    extra.categoryReference || {}
  );

  return {
    topSellingPoints,
    mainImagePrompts,
    detailImagePrompts,
    styleParameters,
    categoryReference,
    matchedCategoryId: safeText(extra.matchedCategoryId || categoryReference.categoryId),
    matchedCategoryName: safeText(extra.matchedCategoryName || categoryReference.categoryName),
    knowledgeSummary: safeText(extra.knowledgeSummary),
    referenceImageUrl: safeText(extra.referenceImageUrl),
    optionalWhiteImageUrl: safeText(extra.optionalWhiteImageUrl),
    generatedAt: nowIso()
  };
}

function normalizeDetailPromptAspectRatio(value) {
  const ratio = safeText(value, "9:16");
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

function sanitizeKnowledgeImageAnalysisResult(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    positivePrompt: safePromptText(source.positive_prompt || source.positivePrompt),
    negativePrompt: safePromptText(source.negative_prompt || source.negativePrompt),
    overallStyle: safePromptText(source.overall_style || source.overallStyle),
    colorScheme: safePromptText(source.color_scheme || source.colorScheme),
    backgroundDescription: safePromptText(source.background_description || source.backgroundDescription),
    modelInfo: safePromptText(source.model_info || source.modelInfo),
    composition: safePromptText(source.composition),
    lightingAndTexture: safePromptText(source.lighting_and_texture || source.lightingAndTexture),
    summary: safePromptText(source.summary)
  };
}

function sanitizeKnowledgeCompressionResult(payload, sourceItemIds = []) {
  const normalized = sanitizeKnowledgeImageAnalysisResult(payload);
  return {
    ...normalized,
    sourceItemIds: uniqueStrings(sourceItemIds).slice(0, 200),
    modelVersion: CLAUDE_MODEL_SONNET,
    generatedAt: nowIso()
  };
}

function sanitizeCategoryRecognitionResult(payload, categories = []) {
  const source = payload && typeof payload === "object" ? payload : {};
  const normalizedCategories = toArray(categories)
    .map((item) => ({
      id: safeText(item?.id || item?.categoryId),
      name: safeText(item?.name || item?.categoryName)
    }))
    .filter((item) => item.id && item.name);
  const categoryById = new Map(normalizedCategories.map((item) => [item.id, item]));
  const categoryByName = new Map(normalizedCategories.map((item) => [item.name.toLowerCase(), item]));

  const requestedId = safeText(source.category_id || source.categoryId);
  const requestedName = safeText(source.category_name || source.categoryName);
  const byId = requestedId ? categoryById.get(requestedId) : null;
  const byName = requestedName ? categoryByName.get(requestedName.toLowerCase()) : null;
  const chosen = byId || byName || null;

  return {
    categoryId: chosen ? chosen.id : requestedId,
    categoryName: chosen ? chosen.name : requestedName,
    confidence: parseConfidence(source.confidence, 0),
    reason: safeText(source.reason || source.judgement),
    matchedFromCatalog: Boolean(chosen)
  };
}

function findFirstJsonObjectBlock(source) {
  const start = source.indexOf("{");
  if (start < 0) {
    return "";
  }
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
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
        return source.slice(start, i + 1);
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

function extractJsonObject(text) {
  const source = safeText(text);
  if (!source) {
    throw new Error("Model returned empty content.");
  }

  const candidates = [];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1]);
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

  if (!candidates.length) {
    throw new Error("Model response does not contain JSON.");
  }

  let lastError = null;
  for (const raw of candidates) {
    const attempts = [safeText(raw), normalizeJsonCandidate(raw)];
    for (const candidate of attempts) {
      if (!candidate) {
        continue;
      }
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw new Error(
    `Model JSON parse failed: ${lastError instanceof Error ? lastError.message : "Unknown parse error"}`
  );
}

function findFieldIndex(source, key) {
  const pattern = new RegExp(`["']?${key}["']?\\s*:`, "i");
  const matched = pattern.exec(source);
  if (!matched || typeof matched.index !== "number") {
    return { index: -1, colonIndex: -1 };
  }
  const colonIndex = source.indexOf(":", matched.index);
  return {
    index: matched.index,
    colonIndex
  };
}

function cleanLooseString(value) {
  let text = safeText(value);
  text = text.replace(/^[,\s]+/, "").replace(/[,\s]+$/, "");
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  text = text
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function parseLooseArray(value) {
  const source = safeText(value);
  if (!source) {
    return [];
  }

  const quotedItems = [];
  const doubleQuoted = source.match(/"((?:\\.|[^"\\])*)"/g) || [];
  for (const token of doubleQuoted) {
    const cleaned = cleanLooseString(token);
    if (cleaned) {
      quotedItems.push(cleaned);
    }
  }
  if (quotedItems.length) {
    return uniqueStrings(quotedItems);
  }

  const singleQuoted = source.match(/'((?:\\.|[^'\\])*)'/g) || [];
  for (const token of singleQuoted) {
    const cleaned = cleanLooseString(token);
    if (cleaned) {
      quotedItems.push(cleaned);
    }
  }
  if (quotedItems.length) {
    return uniqueStrings(quotedItems);
  }

  const withoutBrackets = source.replace(/^\s*\[/, "").replace(/\]\s*$/, "");
  const roughParts = withoutBrackets
    .split(/\r?\n|,|;/)
    .map((item) => cleanLooseString(item.replace(/^[-*\d.\s]+/, "")))
    .filter(Boolean);
  return uniqueStrings(roughParts);
}

function extractAnalysisByKnownKeys(text) {
  const source = safeText(text);
  if (!source) {
    return null;
  }

  const located = ANALYSIS_JSON_KEYS.map((key) => ({
    key,
    ...findFieldIndex(source, key)
  }))
    .filter((entry) => entry.index >= 0 && entry.colonIndex >= 0)
    .sort((a, b) => a.index - b.index);

  if (located.length < 4) {
    return null;
  }

  const output = {};
  for (let i = 0; i < located.length; i += 1) {
    const current = located[i];
    const next = located[i + 1];
    const valueStart = current.colonIndex + 1;
    const valueEnd = next ? next.index : source.length;
    const rawValue = source.slice(valueStart, valueEnd).trim();

    if (current.key === "selling_points" || current.key === "procurement_risks") {
      output[current.key] = parseLooseArray(rawValue);
    } else {
      output[current.key] = cleanLooseString(rawValue);
    }
  }

  return output;
}

function guessMimeType(url, headerType) {
  const loweredHeader = safeText(headerType).toLowerCase();
  if (loweredHeader.startsWith("image/")) {
    return loweredHeader.split(";")[0];
  }
  const loweredUrl = safeText(url).toLowerCase();
  if (loweredUrl.endsWith(".png")) {
    return "image/png";
  }
  if (loweredUrl.endsWith(".webp")) {
    return "image/webp";
  }
  if (loweredUrl.endsWith(".gif")) {
    return "image/gif";
  }
  return "image/jpeg";
}

async function downloadImage(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000);
  const referer = safeText(options.referer);

  if (typeof fetch !== "function") {
    throw new Error("Current Node runtime does not provide fetch. Please use Node.js 18+.");
  }
  const sourceUrl = safeText(url);
  if (!sourceUrl) {
    throw new Error("Empty image URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };
    if (referer) {
      headers.Referer = referer;
    }
    const response = await fetch(sourceUrl, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Image download failed (${response.status}).`);
    }
    const contentType = response.headers.get("content-type");
    const mimeType = guessMimeType(sourceUrl, contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error("Downloaded image is empty.");
    }
    return { url: sourceUrl, mimeType, buffer };
  } finally {
    clearTimeout(timeout);
  }
}

async function preprocessForClaude(imageBuffer) {
  if (!sharp) {
    return {
      mimeType: "image/jpeg",
      buffer: imageBuffer
    };
  }

  const buffer = await sharp(imageBuffer, { failOn: "none" })
    .rotate()
    .resize({
      width: 1400,
      height: 1400,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  return {
    mimeType: "image/jpeg",
    buffer
  };
}

function pixelDistance(data, pixelOffset, color) {
  const dr = data[pixelOffset] - color.r;
  const dg = data[pixelOffset + 1] - color.g;
  const db = data[pixelOffset + 2] - color.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function getCornerPalette(data, width, height) {
  const sampleSize = Math.max(2, Math.floor(Math.min(width, height) * 0.02));
  const corners = [
    { xStart: 0, xEnd: sampleSize, yStart: 0, yEnd: sampleSize },
    { xStart: width - sampleSize, xEnd: width, yStart: 0, yEnd: sampleSize },
    { xStart: 0, xEnd: sampleSize, yStart: height - sampleSize, yEnd: height },
    { xStart: width - sampleSize, xEnd: width, yStart: height - sampleSize, yEnd: height }
  ];

  return corners.map((corner) => {
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let count = 0;
    for (let y = corner.yStart; y < corner.yEnd; y += 1) {
      for (let x = corner.xStart; x < corner.xEnd; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        if (alpha < 10) {
          continue;
        }
        totalR += data[offset];
        totalG += data[offset + 1];
        totalB += data[offset + 2];
        count += 1;
      }
    }
    if (!count) {
      return { r: 255, g: 255, b: 255 };
    }
    return {
      r: Math.round(totalR / count),
      g: Math.round(totalG / count),
      b: Math.round(totalB / count)
    };
  });
}

function isBackgroundPixel(data, pixelOffset, palette, tolerance) {
  const alpha = data[pixelOffset + 3];
  if (alpha < 12) {
    return true;
  }
  let minDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const distance = pixelDistance(data, pixelOffset, color);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance <= tolerance;
}

function markBackgroundRegion(data, width, height, palette, tolerance = 46) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    const index = y * width + x;
    if (visited[index]) {
      return;
    }
    const pixelOffset = index * 4;
    if (!isBackgroundPixel(data, pixelOffset, palette, tolerance)) {
      return;
    }
    visited[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length) {
    const index = queue.pop();
    const x = index % width;
    const y = Math.floor(index / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return visited;
}

async function removeBackgroundToWhite(imageBuffer) {
  if (!sharp) {
    throw new Error("sharp dependency is required. Please run npm install in server workspace.");
  }

  const raw = await sharp(imageBuffer, { failOn: "none" }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const { width, height } = info;
  const palette = getCornerPalette(data, width, height);
  const backgroundMask = markBackgroundRegion(data, width, height, palette);
  const outputRaw = Buffer.from(data);

  for (let i = 0; i < backgroundMask.length; i += 1) {
    if (!backgroundMask[i]) {
      continue;
    }
    const alphaOffset = i * 4 + 3;
    outputRaw[alphaOffset] = 0;
  }

  const transparentProduct = await sharp(outputRaw, {
    raw: { width, height, channels: 4 }
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite([{ input: transparentProduct }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function saveWhiteBackgroundImage({ dataDir, recordId, imageBuffer }) {
  const imageDir = path.join(dataDir, "analysis-images");
  await fs.mkdir(imageDir, { recursive: true });
  const fileName = `${safeText(recordId, "unknown").replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}.jpg`;
  const fullPath = path.join(imageDir, fileName);
  await fs.writeFile(fullPath, imageBuffer);
  return fileName;
}

function buildSkuText(product) {
  const dimensions = toArray(product?.skuDimensions)
    .map((dimension) => {
      const name = safeText(dimension?.name, "规格维度");
      const options = uniqueStrings(dimension?.options || []).join(" / ");
      return `- ${name}: ${options || "无"}`;
    })
    .join("\n");

  const skuItems = toArray(product?.skuItems)
    .slice(0, 30)
    .map((sku, index) => {
      const attrs = uniqueStrings(sku?.attrs || []).join(" | ");
      const price = safeText(sku?.price, "N/A");
      const stock = safeText(sku?.stock, safeText(sku?.stockText, "N/A"));
      return `${index + 1}. attrs=${attrs || "N/A"}; price=${price}; stock=${stock}`;
    })
    .join("\n");

  return `SKU维度:\n${dimensions || "- 无"}\n\nSKU明细:\n${skuItems || "- 无"}`;
}

function buildPriceTierText(product) {
  const tiers = toArray(product?.priceTiers)
    .map((tier) => {
      const quantity = safeText(tier?.quantityLabel, "数量未知");
      const unitPrice = safeText(tier?.unitPriceText, safeText(tier?.unitPrice, "N/A"));
      return `- ${quantity}: ${unitPrice}`;
    })
    .join("\n");
  return tiers || "- 无";
}

function buildAttributeText(product) {
  const rows = toArray(product?.productAttributes)
    .slice(0, 80)
    .map((item) => `- ${safeText(item?.name, "属性")}: ${safeText(item?.value, "无")}`)
    .join("\n");
  return rows || "- 无";
}

function buildPackageSpecsText(product) {
  const rows = toArray(product?.packageSpecs)
    .slice(0, 80)
    .map((line) => `- ${safeText(line)}`)
    .join("\n");
  return rows || "- 无";
}

function buildPrompt(product) {
  const text = [
    "You are a senior product analyst for e-commerce sourcing.",
    "Your output must be strict JSON only. Do not output any text outside JSON.",
    "",
    "Evidence priority rules (must follow strictly):",
    "1) Primary source: product images. Use visual evidence as the main basis for material, appearance, and color judgments.",
    "2) Secondary source: product text (title, attributes, SKU names, package specs, price tiers). Use text only for supplement and cross-check.",
    "3) If image evidence conflicts with text evidence, image evidence wins.",
    "4) When conflict exists, keep image-based conclusion and add a short note in the relevant field like: （文字信息冲突：...）.",
    "5) If a detail cannot be confirmed visually, clearly say it is inferred and low confidence.",
    "",
    "Target fields (use exactly these keys):",
    "{",
    '  "material_analysis": "string",',
    '  "appearance_description": "string",',
    '  "color_analysis": "string",',
    '  "size_and_specs": "string",',
    '  "usage_and_target_audience": "string",',
    '  "detailed_description": "string",',
    '  "selling_points": ["string", "string", "string"],',
    '  "procurement_risks": ["string", "string"]',
    "}",
    "",
    "Requirements:",
    "1) material_analysis: analyze main material, secondary material, surface treatment, and tactile feel. Prioritize visual evidence.",
    "2) appearance_description: analyze silhouette, visible structure, craftsmanship details, and design style. Prioritize visual evidence.",
    "3) color_analysis: analyze dominant and secondary colors, color style, and scenario fit. Prioritize visual evidence.",
    "4) size_and_specs: infer dimensions/specs by combining visual cues and text references; mark uncertain parts as inferred.",
    "5) usage_and_target_audience: provide likely use cases and target users based on product form and context.",
    "6) detailed_description: provide one concise paragraph in Chinese that integrates key material, appearance, color, specs, usage, and caveats.",
    "7) selling_points: provide 3-5 concrete and verifiable points, image-grounded first.",
    "8) procurement_risks: provide potential quality/process/consistency risks, including image-text mismatch risks if any.",
    "9) Respond in Chinese. Avoid vague generic wording.",
    "",
    "Reference text data (secondary evidence only):",
    `标题: ${safeText(product?.title, "未知")}`,
    `店铺: ${safeText(product?.shopName, "未知")}`,
    `商品链接: ${safeText(product?.url, "未知")}`,
    "",
    "价格阶梯:",
    buildPriceTierText(product),
    "",
    buildSkuText(product),
    "",
    "商品属性:",
    buildAttributeText(product),
    "",
    "包装与规格补充:",
    buildPackageSpecsText(product)
  ];
  return text.join("\n");
}

function getClaudeBaseUrl() {
  return safeText(process.env.CLAUDE_BASE_URL || process.env.ANTHROPIC_BASE_URL, CLAUDE_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getClaudeAuthToken() {
  return safeText(process.env.CLAUDE_AUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getVectorEngineBaseUrl() {
  return safeText(process.env.VECTORENGINE_BASE_URL, VECTORENGINE_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getVectorEngineChatApiUrl() {
  return `${getVectorEngineBaseUrl()}${VECTORENGINE_CHAT_API_PATH}`;
}

function getFirstPassAnalysisApiUrl() {
  return safeText(process.env.FIRST_PASS_ANALYSIS_API_URL || process.env.VECTORENGINE_FIRST_PASS_API_URL, getVectorEngineChatApiUrl());
}

function getSecondStagePromptApiUrl() {
  return safeText(process.env.SECOND_STAGE_PROMPT_API_URL || process.env.VECTORENGINE_SECOND_STAGE_API_URL, getFirstPassAnalysisApiUrl());
}

function getFirstPassAnalysisApiKey() {
  return safeText(
    process.env.FIRST_PASS_ANALYSIS_API_KEY ||
      process.env.VECTORENGINE_API_KEY ||
      process.env.GEMINI_FLASH_LITE_THINKING_API_KEY ||
      process.env.GEMINI_API_KEY
  );
}

function getSecondStagePromptApiKey() {
  return safeText(
    process.env.SECOND_STAGE_PROMPT_API_KEY ||
      process.env.VECTORENGINE_SECOND_STAGE_API_KEY ||
      process.env.FIRST_PASS_ANALYSIS_API_KEY ||
      process.env.VECTORENGINE_API_KEY ||
      process.env.GEMINI_FLASH_LITE_THINKING_API_KEY ||
      process.env.GEMINI_API_KEY
  );
}

function getFirstPassAnalysisModel() {
  return safeText(process.env.FIRST_PASS_ANALYSIS_MODEL, FIRST_PASS_GEMINI_MODEL);
}

function getSecondStagePromptModel() {
  return safeText(process.env.SECOND_STAGE_PROMPT_MODEL, SECOND_STAGE_PROMPT_GEMINI_MODEL);
}

function getClaudePrimaryApiKey() {
  return safeText(
    process.env.CLAUDE_PRIMARY_API_KEY ||
      process.env.ANTHROPIC_PRIMARY_API_KEY ||
      process.env.CLAUDE_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );
}

function shouldUseTokenAsApiKey(baseUrl) {
  const normalized = safeText(baseUrl).toLowerCase();
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch (_error) {
    return normalized.includes("api.anthropic.com");
  }
}

function buildClaudeHeaders(token, baseUrl = getClaudeBaseUrl()) {
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    Authorization: `Bearer ${token}`
  };
  const primaryApiKey = getClaudePrimaryApiKey();
  if (primaryApiKey) {
    headers["x-api-key"] = primaryApiKey;
  } else if (shouldUseTokenAsApiKey(baseUrl)) {
    // Official Anthropic endpoint requires x-api-key.
    headers["x-api-key"] = token;
  }
  return headers;
}

function buildVectorEngineHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };
}

function buildImageDataUrl(image) {
  const mimeType = safeText(image?.mimeType, "image/jpeg");
  const base64 = image?.buffer?.toString ? image.buffer.toString("base64") : "";
  if (!base64) {
    return "";
  }
  return `data:${mimeType};base64,${base64}`;
}

async function requestClaudeJsonRepair({ endpoint, headers, model, rawText, requiredKeys = ANALYSIS_JSON_KEYS, arrayFields = [] }) {
  const required = uniqueStrings(requiredKeys);
  const arrayRules = uniqueStrings(arrayFields);
  const repairPrompt = [
    "Convert the following content to a strict JSON object.",
    "Output JSON only. No markdown, no comments.",
    "Return compact JSON in one line. Escape any quote inside string values.",
    `Required keys: ${required.join(", ")}`,
    "Rules:",
    "- Keep original meaning.",
    "- If a field is missing, use empty string or empty array.",
    arrayRules.length ? `- These fields must be arrays of strings: ${arrayRules.join(", ")}.` : "",
    "",
    "Content to repair:",
    rawText
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model,
    max_tokens: 1800,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: repairPrompt }]
      }
    ]
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = safeText(await response.text(), "Unknown error");
    throw new Error(`Claude repair failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const json = await response.json();
  return toArray(json?.content)
    .filter((part) => part?.type === "text")
    .map((part) => safeText(part?.text))
    .join("\n")
    .trim();
}

async function requestOpenAiJsonRepair({
  endpoint,
  headers,
  model,
  rawText,
  requiredKeys = ANALYSIS_JSON_KEYS,
  arrayFields = [],
  timeoutMs = 90000,
  maxTokens = 1800
}) {
  const required = uniqueStrings(requiredKeys);
  const arrayRules = uniqueStrings(arrayFields);
  const repairPrompt = [
    "Convert the following content to a strict JSON object.",
    "Output JSON only. No markdown, no comments.",
    "Return valid JSON object text (multi-line is allowed).",
    `Required keys: ${required.join(", ")}`,
    "Rules:",
    "- Keep original meaning.",
    "- If a field is missing, use empty string or empty array.",
    "- If the source appears truncated, reconstruct a complete valid JSON with the same schema using available context.",
    arrayRules.length ? `- These fields must be arrays of strings: ${arrayRules.join(", ")}.` : "",
    "",
    "Content to repair:",
    rawText
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model: safeText(model, FIRST_PASS_GEMINI_MODEL),
    temperature: 0,
    max_tokens: Math.max(600, Math.floor(Number(maxTokens) || 1800)),
    messages: [
      {
        role: "user",
        content: repairPrompt
      }
    ]
  };

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    },
    timeoutMs
  );
  if (!response.ok) {
    const detail = safeText(await response.text(), "Unknown error");
    throw new Error(`JSON repair failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const json = await response.json();
  return extractOpenAiTextContent(json);
}

function extractClaudeTextContent(json) {
  return toArray(json?.content)
    .filter((part) => part?.type === "text")
    .map((part) => safeText(part?.text))
    .join("\n")
    .trim();
}

function extractOpenAiTextContent(json) {
  const message = toArray(json?.choices)?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") {
    return safeText(content);
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return safeText(part);
        }
        if (part?.type === "text") {
          return safeText(part?.text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRetryableNetworkError(error) {
  const message = error instanceof Error ? error.message : safeText(error);
  return /timed out|timeout|econnreset|network|socket|fetch failed|aborted|connection/i.test(message);
}

async function requestVectorEngineJsonByModel({
  apiKey = "",
  endpoint = "",
  model,
  userContent,
  systemPrompt = "You are a helpful assistant.",
  maxTokens = 2200,
  temperature = 0.2,
  requiredKeys = [],
  arrayFields = [],
  timeoutMs = 90000,
  repairMaxTokens = 2200,
  maxAttempts = 3,
  errorPrefix = "Gemini request",
  missingApiKeyMessage = "VECTORENGINE_API_KEY (or GEMINI_API_KEY) is missing.",
  allowRawFallback = false,
  debugCollector = null
}) {
  const resolvedApiKey = safeText(apiKey, getFirstPassAnalysisApiKey());
  if (!resolvedApiKey) {
    throw new Error(safeText(missingApiKeyMessage, "VECTORENGINE_API_KEY (or GEMINI_API_KEY) is missing."));
  }
  const resolvedEndpoint = safeText(endpoint, getVectorEngineChatApiUrl());
  const headers = buildVectorEngineHeaders(resolvedApiKey);
  const selectedModel = safeText(model, getFirstPassAnalysisModel());
  const systemText = safeText(systemPrompt, "You are a helpful assistant.");

  const body = {
    model: selectedModel,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userContent }
    ],
    temperature,
    max_tokens: maxTokens
  };

  let lastError = null;
  let lastContentText = "";
  let repairedTextV1 = "";
  let repairedTextV2 = "";
  let lastJson = null;
  const flushDebug = () => {
    if (!debugCollector || typeof debugCollector !== "object") {
      return;
    }
    debugCollector.rawModelText = safeText(lastContentText);
    debugCollector.repairedTextV1 = safeText(repairedTextV1);
    debugCollector.repairedTextV2 = safeText(repairedTextV2);
    debugCollector.rawModelJson = lastJson && typeof lastJson === "object" ? lastJson : null;
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        resolvedEndpoint,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        },
        timeoutMs
      );

      if (!response.ok) {
        const detail = safeText(await response.text(), "Unknown error");
        throw new Error(`${errorPrefix} failed (${response.status}): ${detail.slice(0, 400)}`);
      }

      const json = await response.json();
      lastJson = json;
      const contentText = extractOpenAiTextContent(json);
      lastContentText = contentText;
      if (!contentText) {
        throw new Error(`${errorPrefix} returned empty content.`);
      }

      try {
        const parsed = extractJsonObject(contentText);
        flushDebug();
        return parsed;
      } catch (parseError) {
        const computedRepairMaxTokens = Math.max(
          1800,
          Math.floor(Number(repairMaxTokens) || 2200),
          Math.min(7200, Math.floor(Number(maxTokens) || 2200))
        );
        const repairedText = await requestOpenAiJsonRepair({
          endpoint: resolvedEndpoint,
          headers,
          model: selectedModel,
          rawText: contentText,
          requiredKeys: requiredKeys.length ? requiredKeys : ANALYSIS_JSON_KEYS,
          arrayFields,
          timeoutMs: Math.min(timeoutMs, 90000),
          maxTokens: computedRepairMaxTokens
        });
        repairedTextV1 = repairedText;
        try {
          const parsed = extractJsonObject(repairedText);
          flushDebug();
          return parsed;
        } catch (repairParseError) {
          const secondRepairText = await requestOpenAiJsonRepair({
            endpoint: resolvedEndpoint,
            headers,
            model: selectedModel,
            rawText: repairedText,
            requiredKeys: requiredKeys.length ? requiredKeys : ANALYSIS_JSON_KEYS,
            arrayFields,
            timeoutMs: Math.min(timeoutMs, 90000),
            maxTokens: computedRepairMaxTokens
          });
          repairedTextV2 = secondRepairText;
          try {
            const parsed = extractJsonObject(secondRepairText);
            flushDebug();
            return parsed;
          } catch (secondRepairParseError) {
            if (allowRawFallback) {
              flushDebug();
              return {
                raw_model_text: contentText,
                repaired_text_v1: repairedText,
                repaired_text_v2: secondRepairText,
                parse_error: `${parseError instanceof Error ? parseError.message : "unknown"}`
              };
            }
            throw new Error(
              `${errorPrefix} JSON parse failed after repair. raw=${
                parseError instanceof Error ? parseError.message : "unknown"
              }; repaired=${repairParseError instanceof Error ? repairParseError.message : "unknown"}; repaired2=${
                secondRepairParseError instanceof Error ? secondRepairParseError.message : "unknown"
              }`
            );
          }
        }
      }
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableNetworkError(error)) {
        break;
      }
      await sleep(1200 * attempt);
    }
  }
  flushDebug();
  if (allowRawFallback && lastContentText) {
    return {
      raw_model_text: safeText(lastContentText),
      repaired_text_v1: safeText(repairedTextV1),
      repaired_text_v2: safeText(repairedTextV2),
      parse_error: safeText(lastError instanceof Error ? lastError.message : lastError)
    };
  }
  throw lastError instanceof Error ? lastError : new Error(`${errorPrefix} failed.`);
}

async function requestClaudeJsonByModel({
  model,
  systemPrompt = "",
  userContent,
  maxTokens = 2200,
  temperature = 0.2,
  requiredKeys = [],
  arrayFields = [],
  timeoutMs = 90000
}) {
  const token = getClaudeAuthToken();
  if (!token) {
    throw new Error("CLAUDE_AUTH_TOKEN/ANTHROPIC_AUTH_TOKEN is missing.");
  }
  const baseUrl = getClaudeBaseUrl();
  const endpoint = `${baseUrl}${CLAUDE_API_PATH}`;
  const headers = buildClaudeHeaders(token, baseUrl);

  const body = {
    model: safeText(model, CLAUDE_DEFAULT_MODEL),
    max_tokens: maxTokens,
    temperature,
    messages: [
      {
        role: "user",
        content: userContent
      }
    ]
  };
  const systemText = safeText(systemPrompt);
  if (systemText) {
    body.system = systemText;
  }

  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        },
        timeoutMs
      );
      if (!response.ok) {
        const detail = safeText(await response.text(), "Unknown error");
        throw new Error(`Claude request failed (${response.status}): ${detail.slice(0, 400)}`);
      }

      const json = await response.json();
      const contentText = extractClaudeTextContent(json);
      if (!contentText) {
        throw new Error("Claude returned empty content.");
      }

      try {
        return extractJsonObject(contentText);
      } catch (parseError) {
        const repairedText = await requestClaudeJsonRepair({
          endpoint,
          headers,
          model: safeText(model, CLAUDE_DEFAULT_MODEL),
          rawText: contentText,
          requiredKeys: requiredKeys.length ? requiredKeys : ANALYSIS_JSON_KEYS,
          arrayFields
        });
        try {
          return extractJsonObject(repairedText);
        } catch (repairParseError) {
          throw new Error(
            `Claude JSON parse failed after repair. raw=${
              parseError instanceof Error ? parseError.message : "unknown"
            }; repaired=${repairParseError instanceof Error ? repairParseError.message : "unknown"}`
          );
        }
      }
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      const isTimeout = /timed out|timeout/i.test(message);
      if (!isTimeout || attempt >= maxAttempts) {
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Claude request failed.");
}

async function identifyProductCategory({ product, categories }) {
  const categoryList = toArray(categories).filter((item) => safeText(item?.id || item?.categoryId) && safeText(item?.name || item?.categoryName));
  if (!categoryList.length) {
    throw new Error("Category list is empty.");
  }

  const imageUrls = pickImageUrls(product);
  if (!imageUrls.length) {
    throw new Error("No valid product image URL found for category recognition.");
  }
  const downloaded = await downloadImage(imageUrls[0], {
    referer: safeText(product?.url)
  });
  const prepared = await preprocessForClaude(downloaded.buffer);

  const parsed = await requestClaudeJsonByModel({
    model: CLAUDE_MODEL_SONNET,
    userContent: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: prepared.mimeType,
          data: prepared.buffer.toString("base64")
        }
      },
      {
        type: "text",
        text: buildCategoryRecognitionTaskText(categoryList)
      }
    ],
    maxTokens: 900,
    temperature: 0,
    requiredKeys: CATEGORY_RECOGNITION_KEYS
  });

  const result = sanitizeCategoryRecognitionResult(parsed, categoryList);

  return {
    ...result,
    referenceImageUrl: downloaded.url,
    modelVersion: CLAUDE_MODEL_SONNET,
    generatedAt: nowIso()
  };
}

async function analyzeKnowledgeReferenceImage({ imageBuffer, category }) {
  if (!imageBuffer || !imageBuffer.length) {
    throw new Error("Knowledge reference image is empty.");
  }
  const prepared = await preprocessForClaude(imageBuffer);
  const parsed = await requestClaudeJsonByModel({
    model: CLAUDE_MODEL_SONNET,
    userContent: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: prepared.mimeType,
          data: prepared.buffer.toString("base64")
        }
      },
      {
        type: "text",
        text: buildKnowledgeImageAnalysisTaskText(category)
      }
    ],
    maxTokens: 2000,
    temperature: 0.1,
    requiredKeys: KNOWLEDGE_IMAGE_ANALYSIS_KEYS
  });
  return sanitizeKnowledgeImageAnalysisResult(parsed);
}

async function compressCategoryKnowledge({ category, entries }) {
  const safeEntries = toArray(entries).filter((entry) => safeText(entry?.id) && entry?.analysis);
  if (!safeEntries.length) {
    return sanitizeKnowledgeCompressionResult({}, []);
  }
  const parsed = await requestClaudeJsonByModel({
    model: CLAUDE_MODEL_SONNET,
    userContent: [
      {
        type: "text",
        text: buildKnowledgeCompressionTaskText(category, safeEntries)
      }
    ],
    maxTokens: 2600,
    temperature: 0.1,
    requiredKeys: KNOWLEDGE_COMPRESSION_KEYS
  });
  return sanitizeKnowledgeCompressionResult(parsed, safeEntries.map((item) => item.id));
}

async function requestClaudeAnalysis({ product, images }) {
  const model = getFirstPassAnalysisModel();

  const userContent = [
    { type: "text", text: buildPrompt(product) },
    ...images
      .map((image) => {
        const url = buildImageDataUrl(image);
        if (!url) {
          return null;
        }
        return {
          type: "image_url",
          image_url: { url }
        };
      })
      .filter(Boolean)
  ];

  const parsed = await requestVectorEngineJsonByModel({
    apiKey: getFirstPassAnalysisApiKey(),
    endpoint: getFirstPassAnalysisApiUrl(),
    model,
    userContent,
    maxTokens: 2200,
    temperature: 0,
    requiredKeys: ANALYSIS_JSON_KEYS,
    arrayFields: ["selling_points", "procurement_risks"],
    timeoutMs: 120000,
    errorPrefix: "Gemini first-pass request",
    missingApiKeyMessage: "FIRST_PASS_ANALYSIS_API_KEY is missing."
  });

  try {
    return sanitizeAnalysisResult(parsed);
  } catch (_error) {
    const looseParsed = extractAnalysisByKnownKeys(JSON.stringify(parsed)) || extractAnalysisByKnownKeys(String(parsed));
    if (looseParsed) {
      return sanitizeAnalysisResult(looseParsed);
    }
    throw new Error("Gemini first-pass response format is invalid.");
  }
}

function buildPromptSlotText(slots) {
  return slots
    .map((slot) => `${slot.id}. ${slot.type}: ${slot.description}`)
    .join("\n");
}

function buildPromptGenerationTaskText({ product, analysisResult, topSellingPoints }) {
  const points = topSellingPoints.map((point, index) => `${index + 1}. ${point}`).join("\n");
  return [
    "You are a senior e-commerce visual strategist for Brazil marketplaces (Shopee BR and Mercado Livre).",
    "Output strict JSON only. Do not include markdown or extra text.",
    "",
    "Input context priority:",
    "1) AI analysis result and extracted core selling points.",
    "2) Product drag image(s).",
    "3) Optional white-background image uploaded by user.",
    "",
    "Hard requirements:",
    "- Generate exactly 9 prompts for main images and 5 prompts for detail images.",
    "- Every prompt must follow 8 segments in this order:",
    `  ${PROMPT_SEGMENT_KEYS.join(" | ")}`,
    "- portuguese_text must be explicit Portuguese copy ready to place on image.",
    "- All image text must be Portuguese only; never use Chinese or English text inside portuguese_text.",
    "- Promote conversion and selling points, not artistic abstraction.",
    "- Visual style must match Brazil local preference: high saturation, warm contrast, green/yellow/blue accents, energetic mood.",
    "- Include Brazilian local people diversity, realistic daily scenes, and e-commerce-friendly typography layout notes.",
    "",
    "Main image slot definitions (must keep exact order and id 1-9):",
    buildPromptSlotText(MAIN_IMAGE_SLOTS),
    "",
    "Detail image slot definitions (must keep exact order and id 1-5):",
    buildPromptSlotText(DETAIL_IMAGE_SLOTS),
    "",
    "Output JSON schema:",
    "{",
    '  "top_selling_points": ["string", "string", "string"],',
    '  "main_images": [',
    "    {",
    '      "id": 1,',
    '      "image_type": "string",',
    '      "subject_description": "string",',
    '      "scene_background": "string",',
    '      "people_or_props": "string",',
    '      "color_style": "string",',
    '      "portuguese_text": "string",',
    '      "composition": "string",',
    '      "mood_keywords": "string"',
    "    }",
    "  ],",
    '  "detail_images": [same object structure, id 1-5]',
    "}",
    "",
    "You must keep top_selling_points as 3-5 concise points and reinforce them repeatedly in both main and detail images.",
    "",
    "Reference product info:",
    `title: ${safeText(product?.title, "unknown")}`,
    `shop: ${safeText(product?.shopName, "unknown")}`,
    `url: ${safeText(product?.url, "unknown")}`,
    "",
    "AI analysis result:",
    `material_analysis: ${safeText(analysisResult?.materialAnalysis, "N/A")}`,
    `appearance_description: ${safeText(analysisResult?.appearanceDescription, "N/A")}`,
    `color_analysis: ${safeText(analysisResult?.colorAnalysis, "N/A")}`,
    `size_and_specs: ${safeText(analysisResult?.sizeAndSpecs, "N/A")}`,
    `usage_and_target_audience: ${safeText(analysisResult?.usageAndTargetAudience, "N/A")}`,
    `detailed_description: ${safeText(analysisResult?.detailedDescription, "N/A")}`,
    `selling_points: ${toArray(analysisResult?.sellingPoints).join(" | ") || "N/A"}`,
    "",
    "Core selling points to prioritize (3-5):",
    points
  ].join("\n");
}

function buildCategoryCatalogText(categories) {
  return toArray(categories)
    .map((item, index) => {
      const id = safeText(item?.id || item?.categoryId);
      const name = safeText(item?.name || item?.categoryName);
      const pathText = toArray(item?.path || item?.categoryPath)
        .map((value) => safeText(value))
        .filter(Boolean)
        .join(" > ");
      return `${index + 1}. id=${id}; name=${name}; path=${pathText || name}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildCategoryRecognitionTaskText(categories) {
  return [
    "You are a category classifier for e-commerce product images.",
    "Choose one category from the provided category list only.",
    "Never invent a new category outside the list.",
    "Output strict JSON only.",
    "JSON schema:",
    "{",
    '  "category_id": "string",',
    '  "category_name": "string",',
    '  "confidence": 0.0,',
    '  "reason": "string"',
    "}",
    "",
    "Candidate categories:",
    buildCategoryCatalogText(categories)
  ].join("\n");
}

function buildKnowledgeImageAnalysisTaskText(category) {
  return [
    "You are an e-commerce image style analyst.",
    "Analyze the reference image and return strict JSON only.",
    "The output must be directly useful for image generation prompt design.",
    "",
    "JSON schema:",
    "{",
    '  "positive_prompt": "string",',
    '  "negative_prompt": "string",',
    '  "overall_style": "string",',
    '  "color_scheme": "string",',
    '  "background_description": "string",',
    '  "model_info": "string",',
    '  "composition": "string",',
    '  "lighting_and_texture": "string",',
    '  "summary": "string"',
    "}",
    "",
    `Category id: ${safeText(category?.id || category?.categoryId)}`,
    `Category name: ${safeText(category?.name || category?.categoryName)}`
  ].join("\n");
}

function buildKnowledgeCompressionTaskText(category, entries) {
  const blocksText = toArray(entries)
    .map((entry) => {
      const id = safeText(entry?.id);
      const analysis = entry?.analysis || {};
      return [
        `- id: ${id}`,
        `  positive_prompt: ${safeText(analysis?.positivePrompt)}`,
        `  negative_prompt: ${safeText(analysis?.negativePrompt)}`,
        `  overall_style: ${safeText(analysis?.overallStyle)}`,
        `  color_scheme: ${safeText(analysis?.colorScheme)}`,
        `  background_description: ${safeText(analysis?.backgroundDescription)}`,
        `  model_info: ${safeText(analysis?.modelInfo)}`,
        `  composition: ${safeText(analysis?.composition)}`,
        `  lighting_and_texture: ${safeText(analysis?.lightingAndTexture)}`,
        `  summary: ${safeText(analysis?.summary)}`
      ].join("\n");
    })
    .join("\n");

  return [
    "You are an expert at deduplicating and compressing style knowledge for image generation.",
    "Merge repeated or highly similar statements across entries, keep representative and differentiated key traits.",
    "Delete low-information and redundant descriptions.",
    "Return strict JSON only and keep the same semantic dimensions.",
    "",
    "JSON schema:",
    "{",
    '  "positive_prompt": "string",',
    '  "negative_prompt": "string",',
    '  "overall_style": "string",',
    '  "color_scheme": "string",',
    '  "background_description": "string",',
    '  "model_info": "string",',
    '  "composition": "string",',
    '  "lighting_and_texture": "string",',
    '  "summary": "string"',
    "}",
    "",
    `Category id: ${safeText(category?.id || category?.categoryId)}`,
    `Category name: ${safeText(category?.name || category?.categoryName)}`,
    "Input blocks:",
    blocksText
  ].join("\n");
}

function buildPromptGenerationTaskWithKnowledgeText({
  product,
  analysisResult,
  topSellingPoints,
  categoryRecognition,
  categoryKnowledgeText
}) {
  const points = topSellingPoints.map((point, index) => `${index + 1}. ${point}`).join("\n");
  return [
    "You are a senior e-commerce visual strategist for Brazil marketplaces (Shopee BR and Mercado Livre).",
    "You must synthesize category knowledge as style baseline, not copy a single reference image.",
    "Output strict JSON only. No markdown and no extra text.",
    "",
    "Hard rules:",
    "- Generate exactly 9 prompts for main images and exactly 5 prompts for detail images.",
    "- Every image prompt card must include all 8 fields in this exact order:",
    `  ${PROMPT_SEGMENT_KEYS.join(" | ")}`,
    "- Also output global style parameters for user editing.",
    "- Portuguese copy inside image must be Portuguese only.",
    "",
    "Output JSON schema:",
    "{",
    '  "category_reference": {',
    '    "category_id": "string",',
    '    "category_name": "string",',
    '    "confidence": 0.0,',
    '    "reason": "string"',
    "  },",
    '  "style_parameters": {',
    '    "positive_prompt": "string",',
    '    "negative_prompt": "string",',
    '    "recommended_style": "string",',
    '    "background_plan": "string",',
    '    "composition_guidance": "string",',
    '    "color_direction": "string",',
    '    "lighting_style": "string",',
    '    "product_focus": "string",',
    '    "notes": "string"',
    "  },",
    '  "top_selling_points": ["string", "string", "string"],',
    '  "main_images": [ ...9 items with id 1..9 and prompt segment fields ... ],',
    '  "detail_images": [ ...5 items with id 1..5 and prompt segment fields ... ]',
    "}",
    "",
    "Main image slot definitions (id 1-9):",
    buildPromptSlotText(MAIN_IMAGE_SLOTS),
    "",
    "Detail image slot definitions (id 1-5):",
    buildPromptSlotText(DETAIL_IMAGE_SLOTS),
    "",
    "Product context:",
    `title: ${safeText(product?.title, "unknown")}`,
    `shop: ${safeText(product?.shopName, "unknown")}`,
    `url: ${safeText(product?.url, "unknown")}`,
    "",
    "AI analysis context:",
    `material_analysis: ${safeText(analysisResult?.materialAnalysis, "N/A")}`,
    `appearance_description: ${safeText(analysisResult?.appearanceDescription, "N/A")}`,
    `color_analysis: ${safeText(analysisResult?.colorAnalysis, "N/A")}`,
    `size_and_specs: ${safeText(analysisResult?.sizeAndSpecs, "N/A")}`,
    `usage_and_target_audience: ${safeText(analysisResult?.usageAndTargetAudience, "N/A")}`,
    `selling_points: ${toArray(analysisResult?.sellingPoints).join(" | ") || "N/A"}`,
    "",
    "Category recognition result:",
    `category_id: ${safeText(categoryRecognition?.categoryId)}`,
    `category_name: ${safeText(categoryRecognition?.categoryName)}`,
    `confidence: ${parseConfidence(categoryRecognition?.confidence, 0)}`,
    `reason: ${safeText(categoryRecognition?.reason)}`,
    "",
    "Category knowledge baseline:",
    categoryKnowledgeText || "No category knowledge available. Keep style consistent and pragmatic.",
    "",
    "Core selling points to prioritize (3-5):",
    points
  ].join("\n");
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
      throw new Error("White-background image payload is empty.");
    }
    return { mimeType, buffer };
  }

  const rawBase64 = source.replace(/\s+/g, "");
  const buffer = Buffer.from(rawBase64, "base64");
  if (!buffer.length) {
    throw new Error("White-background image payload is invalid.");
  }
  return { mimeType: "image/jpeg", buffer };
}

async function requestClaudePromptGeneration({ product, analysisResult, images, topSellingPoints }) {
  const token = getClaudeAuthToken();
  if (!token) {
    throw new Error("CLAUDE_AUTH_TOKEN/ANTHROPIC_AUTH_TOKEN is missing.");
  }

  const baseUrl = getClaudeBaseUrl();
  const model = CLAUDE_MODEL_OPUS;
  const endpoint = `${baseUrl}${CLAUDE_API_PATH}`;

  const imageContents = images.map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: image.mimeType,
      data: image.buffer.toString("base64")
    }
  }));

  const body = {
    model,
    max_tokens: 4200,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          ...imageContents,
          {
            type: "text",
            text: buildPromptGenerationTaskText({
              product,
              analysisResult,
              topSellingPoints
            })
          }
        ]
      }
    ]
  };

  const headers = buildClaudeHeaders(token, baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = safeText(await response.text(), "Unknown error");
    throw new Error(`Claude prompt request failed (${response.status}): ${detail.slice(0, 400)}`);
  }

  const json = await response.json();
  const contentText = toArray(json?.content)
    .filter((part) => part?.type === "text")
    .map((part) => safeText(part?.text))
    .join("\n")
    .trim();

  let parsed = null;
  try {
    parsed = extractJsonObject(contentText);
  } catch (parseError) {
    const repairedText = await requestClaudeJsonRepair({
      endpoint,
      headers,
      model,
      rawText: contentText,
      requiredKeys: PROMPT_JSON_KEYS,
      arrayFields: ["top_selling_points"]
    });
    try {
      parsed = extractJsonObject(repairedText);
    } catch (repairParseError) {
      throw new Error(
        `Claude prompt JSON parse failed after repair. raw=${
          parseError instanceof Error ? parseError.message : "unknown"
        }; repaired=${repairParseError instanceof Error ? repairParseError.message : "unknown"}`
      );
    }
  }

  return parsed;
}

async function requestClaudePromptGenerationWithKnowledge({
  product,
  analysisResult,
  images,
  topSellingPoints,
  categoryRecognition,
  categoryKnowledgeText
}) {
  const imageContents = images.map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: image.mimeType,
      data: image.buffer.toString("base64")
    }
  }));

  return requestClaudeJsonByModel({
    model: CLAUDE_MODEL_OPUS,
    userContent: [
      ...imageContents,
      {
        type: "text",
        text: buildPromptGenerationTaskWithKnowledgeText({
          product,
          analysisResult,
          topSellingPoints,
          categoryRecognition,
          categoryKnowledgeText
        })
      }
    ],
    maxTokens: 5200,
    temperature: 0.2,
    requiredKeys: [...PROMPT_JSON_KEYS, "style_parameters", "category_reference"],
    arrayFields: ["top_selling_points"],
    timeoutMs: 180000
  });
}

function pickImageUrls(product) {
  return uniqueStrings([product?.triggeredImage, ...(product?.images || [])]).filter((value) => /^https?:\/\//i.test(value));
}

async function analyzeProduct({ product }) {
  const imageUrls = pickImageUrls(product);
  if (!imageUrls.length) {
    throw new Error("No valid product image URL found.");
  }

  const downloads = [];
  for (const url of imageUrls.slice(0, 4)) {
    try {
      const downloaded = await downloadImage(url, {
        referer: safeText(product?.url)
      });
      downloads.push(downloaded);
    } catch (_error) {
      // keep processing with other images
    }
  }
  if (!downloads.length) {
    throw new Error("Failed to download reference images.");
  }

  const primaryImage = downloads[0];
  const claudeImages = [];
  for (const downloaded of downloads.slice(0, 3)) {
    const prepared = await preprocessForClaude(downloaded.buffer);
    claudeImages.push(prepared);
  }

  const modelResult = await requestClaudeAnalysis({
    product,
    images: claudeImages
  });

  return {
    ...modelResult,
    referenceImageUrl: primaryImage.url,
    generatedAt: nowIso()
  };
}

async function generatePromptPack({
  product,
  analysisResult,
  optionalWhiteImageData,
  categoryRecognition = null,
  categoryKnowledgeText = "",
  knowledgeSummary = "",
  matchedCategoryId = "",
  matchedCategoryName = ""
}) {
  const topSellingPoints = pickTopSellingPoints([], analysisResult);
  const imageUrls = pickImageUrls(product);
  const downloads = [];

  for (const url of imageUrls.slice(0, 3)) {
    try {
      const downloaded = await downloadImage(url, {
        referer: safeText(product?.url)
      });
      downloads.push(downloaded);
    } catch (_error) {
      // continue with available images
    }
  }

  if (!downloads.length) {
    throw new Error("Failed to download product reference images for prompt generation.");
  }

  const claudeImages = [];
  for (const downloaded of downloads.slice(0, 2)) {
    const prepared = await preprocessForClaude(downloaded.buffer);
    claudeImages.push(prepared);
  }

  let optionalWhiteImageProvided = false;
  if (optionalWhiteImageData) {
    const parsedWhite = parseBase64ImageInput(optionalWhiteImageData);
    if (parsedWhite?.buffer?.length) {
      const whitePrepared = await preprocessForClaude(parsedWhite.buffer);
      claudeImages.push(whitePrepared);
      optionalWhiteImageProvided = true;
    }
  }

  let rawPromptResult = null;
  if (categoryRecognition) {
    try {
      rawPromptResult = await requestClaudePromptGenerationWithKnowledge({
        product,
        analysisResult,
        images: claudeImages,
        topSellingPoints,
        categoryRecognition,
        categoryKnowledgeText
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/timed out|timeout/i.test(message)) {
        throw error;
      }
      const conciseKnowledge = safeText(categoryKnowledgeText).slice(0, 3200);
      rawPromptResult = await requestClaudePromptGenerationWithKnowledge({
        product,
        analysisResult,
        images: claudeImages.slice(0, 1),
        topSellingPoints,
        categoryRecognition,
        categoryKnowledgeText: conciseKnowledge
      });
    }
  } else {
    rawPromptResult = await requestClaudePromptGeneration({
      product,
      analysisResult,
      images: claudeImages,
      topSellingPoints
    });
  }

  return sanitizePromptGenerationResult(rawPromptResult, analysisResult, {
    categoryReference: categoryRecognition || null,
    matchedCategoryId: safeText(matchedCategoryId || categoryRecognition?.categoryId),
    matchedCategoryName: safeText(matchedCategoryName || categoryRecognition?.categoryName),
    knowledgeSummary: safeText(knowledgeSummary),
    referenceImageUrl: downloads[0]?.url || safeText(product?.triggeredImage),
    optionalWhiteImageUrl: optionalWhiteImageProvided ? "uploaded://white-background-image" : ""
  });
}

function buildSecondStagePromptText({
  product,
  analysisResult,
  templateText,
  detailAspectRatio = "9:16",
  priorityDetailedDescription = "",
  targetMarket = DEFAULT_PROMPT_PACK_TARGET_MARKET,
  promptLanguage = DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE,
  inImageTextLanguage = DEFAULT_PROMPT_PACK_IN_IMAGE_TEXT_LANGUAGE
}) {
  const normalizedDetailAspectRatio = normalizeDetailPromptAspectRatio(detailAspectRatio);
  const normalizedAnalysis = sanitizeAnalysisResult(analysisResult || {});
  const normalizedPriorityDetailedDescription = safeText(priorityDetailedDescription);
  const normalizedLocale = normalizePromptPackLocaleConfig({
    targetMarket,
    promptLanguage,
    inImageTextLanguage
  });
  const effectiveDetailedDescription = safeText(normalizedPriorityDetailedDescription, normalizedAnalysis.detailedDescription);
  const analysisJson = JSON.stringify(
    {
      material_analysis: normalizedAnalysis.materialAnalysis,
      appearance_description: normalizedAnalysis.appearanceDescription,
      color_analysis: normalizedAnalysis.colorAnalysis,
      size_and_specs: normalizedAnalysis.sizeAndSpecs,
      usage_and_target_audience: normalizedAnalysis.usageAndTargetAudience,
      detailed_description: effectiveDetailedDescription,
      selling_points: normalizedAnalysis.sellingPoints,
      procurement_risks: normalizedAnalysis.procurementRisks
    },
    null,
    2
  );

  return [
    "You are a senior e-commerce AI prompt engineer.",
    "Output strict JSON only. Do not output markdown or explanatory text.",
    "Use the provided template as strategy reference. If template conflicts with rules below, rules below take precedence.",
    "NON-NEGOTIABLE: The final JSON must include exactly 9 items in main_images and exactly 5 items in detail_images.",
    "Do not return fewer items. Do not merge items. Do not omit detail_images.",
    `All detail_images.aspect_ratio must be exactly "${normalizedDetailAspectRatio}".`,
    `Use ${normalizedLocale.promptLanguage} for prompt_en content. Do NOT output prompt_pt or bilingual duplicate fields.`,
    "Every prompt_en must be concrete and executable (not generic placeholders), 45-90 words per image.",
    "Keep all prompts concise to avoid truncation while preserving key visual details.",
    `All in-image visible text must use ${normalizedLocale.inImageTextLanguage}.`,
    `HARD RULE: Visual style, scene cues, lifestyle context, and consumer preference framing must match ${normalizedLocale.targetMarket}.`,
    `HARD RULE: If any visible text appears in generated images, it must be ${normalizedLocale.inImageTextLanguage} only; do not mix any other language.`,
    `HARD RULE: For scenes that include text overlays, prompt_en must explicitly state Text Rendering instructions in ${normalizedLocale.inImageTextLanguage}.`,
    "Use product images as primary evidence and text as supplementary evidence.",
    "If there is a conflict between image and text, image evidence wins.",
    "If priority_detailed_description is provided, treat it as the highest-priority text reference for product understanding.",
    "You must explicitly analyze the product image and return detailed appearance/material/shape/size information in product_profile.",
    "",
    "Output contract (exact keys):",
    "{",
    '  "product_name": "string",',
    '  "product_profile": {',
    '    "appearance_details": "string",',
    '    "material_details": "string",',
    '    "shape_details": "string",',
    '    "size_details": "string",',
    '    "color_details": "string"',
    "  },",
    '  "main_images": [',
    "    {",
    '      "image_id": "main_01..main_09",',
    '      "aspect_ratio": "1:1",',
    '      "scene_type": "string",',
    '      "scene_description": "string",',
    '      "prompt_en": "string",',
    '      "key_features": ["string"],',
    '      "target_use": "string",',
    '      "industry_adaptation": "string"',
    "    }",
    "  ],",
    '  "detail_images": [',
    "    {",
    '      "image_id": "detail_01..detail_05",',
    `      "aspect_ratio": "${normalizedDetailAspectRatio}",`,
    '      "scene_type": "string",',
    '      "scene_description": "string",',
    '      "prompt_en": "string",',
    '      "key_features": ["string"],',
    '      "target_use": "string",',
    '      "industry_adaptation": "string"',
    "    }",
    "  ],",
    '  "metadata": {',
    `    "target_market": "${normalizedLocale.targetMarket}",`,
    `    "language": "${normalizedLocale.promptLanguage}",`,
    `    "in_image_text_language": "${normalizedLocale.inImageTextLanguage}",`,
    '    "total_images": 14,',
    `    "detail_aspect_ratio": "${normalizedDetailAspectRatio}"`,
    "  }",
    "}",
    "Array length contract:",
    "- main_images.length MUST be 9",
    "- detail_images.length MUST be 5",
    "- If your draft has fewer items, continue generating until lengths are satisfied.",
    "detail_images scene coverage must include: tutorial, multi-scenario, detail-breakdown, care, specifications.",
    "",
    "Product reference info:",
    `title: ${safeText(product?.title, "unknown")}`,
    `shop: ${safeText(product?.shopName, "unknown")}`,
    `url: ${safeText(product?.url, "unknown")}`,
    "",
    "First-pass analysis result (JSON):",
    analysisJson,
    normalizedPriorityDetailedDescription ? `priority_detailed_description (highest priority): ${normalizedPriorityDetailedDescription}` : "",
    "",
    "Template document (reference; apply structure and scenario logic):",
    safeText(templateText),
    "",
    "Reminder:",
    `- Keep market aligned with ${normalizedLocale.targetMarket}.`,
    `- Keep prompt_en language aligned with ${normalizedLocale.promptLanguage}.`,
    `- Keep all in-image text aligned with ${normalizedLocale.inImageTextLanguage}.`,
    "- If an image scene has visible text, include explicit Text Rendering instructions and quoted localized strings in prompt_en.",
    "- Never output any in-image visible text in a language different from in_image_text_language.",
    "- Reject and regenerate any draft that violates market-style or language rules before final output.",
    "- product_profile must be based on visual evidence from product image, then supplemented by first-pass analysis text.",
    "- product_profile must include appearance/material/shape/size/color details.",
    "- Ensure all visual descriptions are grounded in the input image.",
    "- Every detail_images.prompt_en must be concrete and unique; do not use generic placeholders.",
    "- Do NOT output generic phrases like 'product e-commerce shot', 'keep exact product appearance', or 'conversion-oriented layout' as full prompts.",
    "- For every detail image, provide executable prompt_en with product details, background, camera angle, lighting, and composition.",
    "- Final self-check before output: main_images=9 and detail_images=5."
  ].join("\n");
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => safeText(item)).filter(Boolean));
  }
  const text = safeText(value);
  if (!text) {
    return [];
  }
  return uniqueStrings(
    text
      .split(/\r?\n|,|;|\||，|；/)
      .map((item) => safeText(item))
      .filter(Boolean)
  );
}

function pickPromptArray(source, explicitKeys, keyword) {
  const safeSource = source && typeof source === "object" ? source : {};
  for (const key of explicitKeys) {
    const list = toArray(safeSource?.[key]);
    if (list.length) {
      return list;
    }
  }
  const loweredKeyword = safeText(keyword).toLowerCase();
  for (const [key, value] of Object.entries(safeSource)) {
    if (!Array.isArray(value)) {
      continue;
    }
    if (safeText(key).toLowerCase().includes(loweredKeyword) && value.length) {
      return value;
    }
  }
  return [];
}

function inferCardOrder(raw, fallbackIndex) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawId = safeText(source.image_id || source.imageId || source.id);
  const matched = rawId.match(/(\d{1,3})$/);
  if (matched?.[1]) {
    const parsed = Number(matched[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallbackIndex;
}

function normalizeSecondStageImageItem(raw, { kind, index, aspectRatio, slot, targetMarket = DEFAULT_PROMPT_PACK_TARGET_MARKET }) {
  const source = raw && typeof raw === "object" ? raw : {};
  const fallbackId = `${kind}_${String(index).padStart(2, "0")}`;
  const fallbackSceneType = kind === "main" ? safeText(slot?.type, "hero_shot") : safeText(slot?.type, "detail_scene");
  const fallbackSceneDesc = safeText(
    slot?.description,
    kind === "main" ? "Main image for e-commerce listing." : "Detail image for e-commerce description."
  );
  const fallbackPromptPt = safeText(slot?.defaultPortugueseText, "");

  return {
    image_id: safeText(source.image_id || source.imageId || source.id, fallbackId),
    aspect_ratio: aspectRatio,
    scene_type: safeText(source.scene_type || source.sceneType || source.image_type || source.imageType, fallbackSceneType),
    scene_description: safeText(
      source.scene_description || source.sceneDescription || source.subject_description || source.subjectDescription,
      fallbackSceneDesc
    ),
    prompt_en: safeText(source.prompt_en || source.promptEn || source.prompt),
    prompt_pt: safeText(source.prompt_pt || source.promptPt || source.portuguese_text || source.portugueseText, fallbackPromptPt),
    key_features: toStringArray(source.key_features || source.keyFeatures),
    target_use: safeText(source.target_use || source.targetUse, kind === "main" ? "listing_main_image" : "product_detail_page"),
    industry_adaptation: safeText(source.industry_adaptation || source.industryAdaptation, `${targetMarket} e-commerce adaptation`)
  };
}

function normalizeStageList(rawList, slots, kind, aspectRatio, targetMarket = DEFAULT_PROMPT_PACK_TARGET_MARKET) {
  const list = toArray(rawList).filter((item) => item && typeof item === "object");
  const sorted = [...list].sort((left, right) => inferCardOrder(left, Number.MAX_SAFE_INTEGER) - inferCardOrder(right, Number.MAX_SAFE_INTEGER));
  return sorted.map((item, index) => {
    const slot = slots[index] || slots[slots.length - 1];
    return normalizeSecondStageImageItem(item, {
      kind,
      index: index + 1,
      aspectRatio,
      slot,
      targetMarket
    });
  });
}

function normalizePromptPackProductProfile(input, analysisResult = null) {
  const source = input && typeof input === "object" ? input : {};
  const fallback = sanitizeAnalysisResult(analysisResult || {});
  return {
    appearance_details: safeText(
      source.appearance_details || source.appearanceDetails || source.appearance_description || source.appearanceDescription,
      fallback.appearanceDescription
    ),
    material_details: safeText(
      source.material_details || source.materialDetails || source.material_analysis || source.materialAnalysis,
      fallback.materialAnalysis
    ),
    shape_details: safeText(
      source.shape_details || source.shapeDetails || source.shape_analysis || source.shapeAnalysis || source.structure_description || source.structureDescription,
      fallback.appearanceDescription
    ),
    size_details: safeText(
      source.size_details || source.sizeDetails || source.size_and_specs || source.sizeAndSpecs || source.dimension_details || source.dimensionDetails,
      fallback.sizeAndSpecs
    ),
    color_details: safeText(
      source.color_details || source.colorDetails || source.color_analysis || source.colorAnalysis || source.color_info || source.colorInfo,
      fallback.colorAnalysis
    )
  };
}

function normalizeSecondStagePromptOutput(payload, detailAspectRatio = "9:16", analysisResult = null, localeConfig = null) {
  const normalizedDetailAspectRatio = normalizeDetailPromptAspectRatio(detailAspectRatio);
  const normalizedLocale = normalizePromptPackLocaleConfig(localeConfig);
  const source = payload && typeof payload === "object" ? payload : {};
  const root = source.output && typeof source.output === "object" ? source.output : source;
  const productProfile = normalizePromptPackProductProfile(
    root.product_profile || root.productProfile || root.product_details || root.productDetails,
    analysisResult
  );

  let mainRaw = pickPromptArray(root, ["main_images", "mainImages", "main_image_prompts", "mainImagePrompts"], "main");
  let detailRaw = pickPromptArray(root, ["detail_images", "detailImages", "detail_image_prompts", "detailImagePrompts"], "detail");

  if (!mainRaw.length || !detailRaw.length) {
    const allCards = pickPromptArray(root, ["images", "image_cards", "image_prompts", "prompts", "cards"], "image");
    if (allCards.length) {
      const splitMain = [];
      const splitDetail = [];
      allCards.forEach((item, index) => {
        const ratio = safeText(item?.aspect_ratio || item?.aspectRatio || item?.ratio);
        if (ratio === normalizedDetailAspectRatio) {
          splitDetail.push(item);
        } else if (ratio === "1:1") {
          splitMain.push(item);
        } else if (index < MAIN_IMAGE_SLOTS.length) {
          splitMain.push(item);
        } else {
          splitDetail.push(item);
        }
      });
      if (!mainRaw.length) {
        mainRaw = splitMain;
      }
      if (!detailRaw.length) {
        detailRaw = splitDetail;
      }
    }
  }

  const mainImages = normalizeStageList(mainRaw, MAIN_IMAGE_SLOTS, "main", "1:1", normalizedLocale.targetMarket);
  const detailImages = normalizeStageList(
    detailRaw,
    DETAIL_IMAGE_SLOTS,
    "detail",
    normalizedDetailAspectRatio,
    normalizedLocale.targetMarket
  );
  return {
    ...root,
    product_profile: productProfile,
    main_images: mainImages,
    detail_images: detailImages,
    metadata: {
      ...(root?.metadata && typeof root.metadata === "object" ? root.metadata : {}),
      target_market: safeText(root?.metadata?.target_market || root?.metadata?.targetMarket, normalizedLocale.targetMarket),
      language_pair: safeText(
        root?.metadata?.language_pair || root?.metadata?.languagePair || root?.metadata?.language,
        normalizedLocale.promptLanguage
      ),
      in_image_text_language: safeText(
        root?.metadata?.in_image_text_language || root?.metadata?.inImageTextLanguage || root?.metadata?.text_overlay_language,
        normalizedLocale.inImageTextLanguage
      ),
      total_images: 14,
      detail_aspect_ratio: normalizedDetailAspectRatio
    }
  };
}

async function generateSecondStagePromptPack({
  product,
  analysisResult,
  templateText,
  detailAspectRatio = "9:16",
  priorityDetailedDescription = "",
  targetMarket = DEFAULT_PROMPT_PACK_TARGET_MARKET,
  promptLanguage = DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE,
  inImageTextLanguage = DEFAULT_PROMPT_PACK_IN_IMAGE_TEXT_LANGUAGE
}) {
  const normalizedDetailAspectRatio = normalizeDetailPromptAspectRatio(detailAspectRatio);
  const normalizedAnalysis = sanitizeAnalysisResult(analysisResult || {});
  const normalizedPriorityDetailedDescription = safeText(priorityDetailedDescription);
  const normalizedLocale = normalizePromptPackLocaleConfig({
    targetMarket,
    promptLanguage,
    inImageTextLanguage
  });
  const effectiveAnalysis = {
    ...normalizedAnalysis,
    detailedDescription: safeText(normalizedPriorityDetailedDescription, normalizedAnalysis.detailedDescription)
  };
  const imageUrls = pickImageUrls(product);
  if (!imageUrls.length) {
    throw new Error("No valid product image URL found for second-stage prompt generation.");
  }

  const downloaded = await downloadImage(imageUrls[0], {
    referer: safeText(product?.url)
  });
  const preparedImage = await preprocessForClaude(downloaded.buffer);
  const imageDataUrl = buildImageDataUrl(preparedImage);
  if (!imageDataUrl) {
    throw new Error("Failed to encode reference image for second-stage prompt generation.");
  }

  const baseImageContent = {
    type: "image_url",
    image_url: { url: imageDataUrl }
  };

  const model = getSecondStagePromptModel();
  const baseTaskText = buildSecondStagePromptText({
    product,
    analysisResult: effectiveAnalysis,
    templateText,
    detailAspectRatio: normalizedDetailAspectRatio,
    priorityDetailedDescription: normalizedPriorityDetailedDescription,
    targetMarket: normalizedLocale.targetMarket,
    promptLanguage: normalizedLocale.promptLanguage,
    inImageTextLanguage: normalizedLocale.inImageTextLanguage
  });
  const debugPayload = {};
  const parsed = await requestVectorEngineJsonByModel({
    apiKey: getSecondStagePromptApiKey(),
    endpoint: getSecondStagePromptApiUrl(),
    model,
    systemPrompt: SECOND_STAGE_SYSTEM_PROMPT,
    userContent: [
      {
        type: "text",
        text: baseTaskText
      },
      baseImageContent
    ],
    maxTokens: 5600,
    repairMaxTokens: 9000,
    temperature: 0.1,
    requiredKeys: PROMPT_TEMPLATE_V21_KEYS,
    timeoutMs: 150000,
    errorPrefix: "Gemini prompt-pack request",
    missingApiKeyMessage: "SECOND_STAGE_PROMPT_API_KEY is missing.",
    allowRawFallback: true,
    debugCollector: debugPayload
  });
  const output = normalizeSecondStagePromptOutput(parsed, normalizedDetailAspectRatio, effectiveAnalysis, normalizedLocale);
  const mainCount = toArray(output?.main_images).length;
  const detailCount = toArray(output?.detail_images).length;
  const hasStructuredOutput = mainCount > 0 || detailCount > 0;
  const rawModelText = safeText(parsed?.raw_model_text || debugPayload.rawModelText);
  const fallbackOutputText = hasStructuredOutput ? JSON.stringify(output, null, 2) : rawModelText;

  return {
    referenceImageUrl: downloaded.url,
    templateVersion: "v2.1",
    detailAspectRatio: normalizedDetailAspectRatio,
    requestContext: {
      productReference: {
        title: safeText(product?.title, "unknown"),
        shop: safeText(product?.shopName, "unknown"),
        url: safeText(product?.url, "unknown")
      },
      firstPassAnalysis: {
        material_analysis: effectiveAnalysis.materialAnalysis,
        appearance_description: effectiveAnalysis.appearanceDescription,
        color_analysis: effectiveAnalysis.colorAnalysis,
        size_and_specs: effectiveAnalysis.sizeAndSpecs,
        usage_and_target_audience: effectiveAnalysis.usageAndTargetAudience,
        detailed_description: effectiveAnalysis.detailedDescription,
        selling_points: effectiveAnalysis.sellingPoints,
        procurement_risks: effectiveAnalysis.procurementRisks
      },
      priorityDetailedDescription: normalizedPriorityDetailedDescription || null,
      productProfile: output?.product_profile || null,
      locale: {
        targetMarket: normalizedLocale.targetMarket,
        promptLanguage: normalizedLocale.promptLanguage,
        inImageTextLanguage: normalizedLocale.inImageTextLanguage
      },
      template: {
        version: "v2.1",
        required: true,
        charLength: safeText(templateText).length
      },
      qualityRetryUsed: false
    },
    rawModelText,
    rawRepairedTextV1: safeText(parsed?.repaired_text_v1 || debugPayload.repairedTextV1),
    rawRepairedTextV2: safeText(parsed?.repaired_text_v2 || debugPayload.repairedTextV2),
    rawModelJson: debugPayload.rawModelJson,
    parseWarning: safeText(parsed?.parse_error),
    output,
    outputText: fallbackOutputText,
    generatedAt: nowIso()
  };
}

function createVideoScriptFormatError(message) {
  const error = new Error(message);
  error.code = VIDEO_SCRIPT_FORMAT_ERROR;
  return error;
}

function parseNumericValue(input) {
  const matched = safeText(input).match(/-?\d+(\.\d+)?/);
  if (!matched) {
    return null;
  }
  const value = Number(matched[0]);
  return Number.isFinite(value) ? value : null;
}

function normalizeVideoTextValue(value) {
  const raw = safeText(value).trim();
  if (!raw) {
    return "";
  }
  const maybeBracket = raw.match(/^\[\s*([\s\S]*?)\s*\]$/);
  if (maybeBracket?.[1]) {
    return safeText(maybeBracket[1]).trim();
  }
  return raw;
}

function normalizeVideoBulletKey(key) {
  return safeText(key).replace(/\s+/g, "").trim();
}

function parseBulletMap(text) {
  const lines = safeText(text).split(/\r?\n/);
  const map = {};
  let activeKey = "";
  for (const line of lines) {
    const matched = line.match(/^\s*·\s*([^：:]+?)\s*[：:]\s*(.*)$/);
    if (matched?.[1]) {
      activeKey = normalizeVideoBulletKey(matched[1]);
      map[activeKey] = safeText(matched[2]);
      continue;
    }
    if (!activeKey) {
      continue;
    }
    const merged = [map[activeKey], line].filter(Boolean).join("\n");
    map[activeKey] = merged.trim();
  }
  return map;
}

function pickBulletFieldValue(map, keyPrefixes) {
  const normalizedPrefixes = toArray(keyPrefixes).map((item) => normalizeVideoBulletKey(item));
  const entries = Object.entries(map || {});
  for (const prefix of normalizedPrefixes) {
    const found = entries.find(([key]) => key.startsWith(prefix));
    if (found) {
      return normalizeVideoTextValue(found[1]);
    }
  }
  return "";
}

function parseVideoStoryboardText(rawText) {
  const text = safeText(rawText);
  if (!text) {
    throw createVideoScriptFormatError("脚本内容为空");
  }

  const overviewHeaderIndex = text.indexOf("【脚本总览】");
  if (overviewHeaderIndex < 0) {
    throw createVideoScriptFormatError("缺少脚本总览区块");
  }

  const scenePattern = /【分镜\s*(\d+)\s*\/\s*共\s*(\d+)段】/g;
  const sceneMatches = [...text.matchAll(scenePattern)];
  if (!sceneMatches.length) {
    throw createVideoScriptFormatError("缺少分镜区块");
  }

  const storyboards = sceneMatches.map((matched, index) => {
    const start = matched.index ?? 0;
    const nextStart = sceneMatches[index + 1]?.index ?? overviewHeaderIndex;
    const block = text.slice(start, nextStart).trim();
    const sceneNo = Number(matched[1]);
    const totalScenes = Number(matched[2]);
    const fields = parseBulletMap(block);

    const durationSeconds = parseNumericValue(pickBulletFieldValue(fields, ["时长建议"]));
    const generationMode = pickBulletFieldValue(fields, ["生成模式"]);
    const cameraMovementType = pickBulletFieldValue(fields, ["运镜类型"]);
    const cameraMovementIntent = pickBulletFieldValue(fields, ["运镜意图"]);
    const firstFramePrompt = pickBulletFieldValue(fields, ["首帧生图提示词（英文）", "首帧生图提示词"]);
    const tailFramePrompt = pickBulletFieldValue(fields, ["尾帧生图提示词（英文，仅首尾帧模式填写，首帧模式此项留空）", "尾帧生图提示词"]);
    const motionPrompt = pickBulletFieldValue(fields, ["视频运动提示词（英文）", "视频运动提示词"]);
    const voiceoverPt = pickBulletFieldValue(fields, ["口播文案（葡萄牙语）", "口播文案"]);
    const subtitlePt = pickBulletFieldValue(fields, ["画面字幕（葡萄牙语）", "画面字幕"]);
    const soundDesign = pickBulletFieldValue(fields, ["音效建议"]);
    const visualDescriptionZh = pickBulletFieldValue(fields, ["画面说明（中文）", "画面说明"]);

    return {
      sceneNo,
      totalScenes,
      durationSeconds,
      generationMode,
      cameraMovementType,
      cameraMovementIntent,
      firstFramePrompt,
      tailFramePrompt,
      motionPrompt,
      voiceoverPt,
      subtitlePt,
      soundDesign,
      visualDescriptionZh
    };
  });

  const overviewBlock = text.slice(overviewHeaderIndex).trim();
  const overviewFields = parseBulletMap(overviewBlock);
  const overview = {
    totalScenes: parseNumericValue(pickBulletFieldValue(overviewFields, ["总分镜数"])),
    estimatedTotalDuration: parseNumericValue(pickBulletFieldValue(overviewFields, ["预估总时长"])),
    storyline: pickBulletFieldValue(overviewFields, ["整体剧情框架"]),
    sellingPointsCoverage: pickBulletFieldValue(overviewFields, ["核心卖点覆盖"]),
    portugueseVoiceSuggestion: pickBulletFieldValue(overviewFields, ["葡萄牙语配音建议"])
  };

  return {
    storyboards,
    overview
  };
}

function validateVideoStoryboardData(parsed) {
  const storyboards = toArray(parsed?.storyboards);
  const overview = parsed?.overview || {};
  if (storyboards.length < VIDEO_SCRIPT_SCENE_COUNT_MIN || storyboards.length > VIDEO_SCRIPT_SCENE_COUNT_MAX) {
    throw createVideoScriptFormatError("分镜数量不符合要求（需为7或8段）");
  }

  let totalDuration = 0;
  for (const scene of storyboards) {
    if (!Number.isFinite(scene.sceneNo) || scene.sceneNo < 1) {
      throw createVideoScriptFormatError("分镜编号异常");
    }
    if (!Number.isFinite(scene.durationSeconds)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少有效时长`);
    }
    if (scene.durationSeconds < VIDEO_SCRIPT_SCENE_DURATION_MIN || scene.durationSeconds > VIDEO_SCRIPT_SCENE_DURATION_MAX) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}时长必须在4-6秒`);
    }
    if (!VIDEO_SCRIPT_ALLOWED_MODES.has(scene.generationMode)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}生成模式异常`);
    }
    if (!safeText(scene.cameraMovementType)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少运镜类型`);
    }
    if (!safeText(scene.cameraMovementIntent)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少运镜意图`);
    }
    if (!safeText(scene.firstFramePrompt)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少首帧生图提示词`);
    }
    if (scene.generationMode === "首尾帧生视频" && !safeText(scene.tailFramePrompt)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}为首尾帧模式时必须填写尾帧提示词`);
    }
    if (!safeText(scene.motionPrompt)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少视频运动提示词`);
    }
    if (!safeText(scene.voiceoverPt)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少口播文案`);
    }
    if (!safeText(scene.subtitlePt)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少画面字幕`);
    }
    if (!safeText(scene.soundDesign)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少音效建议`);
    }
    if (!safeText(scene.visualDescriptionZh)) {
      throw createVideoScriptFormatError(`分镜${scene.sceneNo}缺少画面说明`);
    }
    totalDuration += scene.durationSeconds;
  }

  if (totalDuration < VIDEO_SCRIPT_TOTAL_DURATION_MIN || totalDuration > VIDEO_SCRIPT_TOTAL_DURATION_MAX) {
    throw createVideoScriptFormatError("所有分镜时长之和必须在35-40秒");
  }

  if (!Number.isFinite(overview.totalScenes) || overview.totalScenes !== storyboards.length) {
    throw createVideoScriptFormatError("脚本总览中的分镜数与明细不一致");
  }
  if (!Number.isFinite(overview.estimatedTotalDuration)) {
    throw createVideoScriptFormatError("脚本总览缺少有效总时长");
  }
  if (!safeText(overview.storyline)) {
    throw createVideoScriptFormatError("脚本总览缺少整体剧情框架");
  }
  if (!safeText(overview.sellingPointsCoverage)) {
    throw createVideoScriptFormatError("脚本总览缺少核心卖点覆盖");
  }
  if (!safeText(overview.portugueseVoiceSuggestion)) {
    throw createVideoScriptFormatError("脚本总览缺少葡萄牙语配音建议");
  }
}

function safeVideoDuration(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Number(value.toFixed(2)));
}

function sanitizeVideoScriptResult(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const storyboards = toArray(payload.storyboards)
    .map((scene) => {
      const sceneNo = Number(scene?.sceneNo);
      const totalScenes = Number(scene?.totalScenes);
      const generationMode = safeText(scene?.generationMode);
      if (!Number.isFinite(sceneNo) || sceneNo < 1 || !VIDEO_SCRIPT_ALLOWED_MODES.has(generationMode)) {
        return null;
      }
      return {
        sceneNo,
        totalScenes: Number.isFinite(totalScenes) ? totalScenes : null,
        durationSeconds: safeVideoDuration(Number(scene?.durationSeconds)),
        generationMode,
        cameraMovementType: safeText(scene?.cameraMovementType),
        cameraMovementIntent: safeText(scene?.cameraMovementIntent),
        firstFramePrompt: safeText(scene?.firstFramePrompt),
        tailFramePrompt: safeText(scene?.tailFramePrompt),
        motionPrompt: safeText(scene?.motionPrompt),
        voiceoverPt: safeText(scene?.voiceoverPt),
        subtitlePt: safeText(scene?.subtitlePt),
        soundDesign: safeText(scene?.soundDesign),
        visualDescriptionZh: safeText(scene?.visualDescriptionZh)
      };
    })
    .filter(Boolean);

  const overviewSource = payload.overview && typeof payload.overview === "object" ? payload.overview : {};
  const overview = {
    totalScenes: Number.isFinite(Number(overviewSource.totalScenes)) ? Number(overviewSource.totalScenes) : null,
    estimatedTotalDuration: safeVideoDuration(Number(overviewSource.estimatedTotalDuration)),
    storyline: safeText(overviewSource.storyline),
    sellingPointsCoverage: safeText(overviewSource.sellingPointsCoverage),
    portugueseVoiceSuggestion: safeText(overviewSource.portugueseVoiceSuggestion)
  };

  return {
    selectedKnowledgeBlocks: uniqueStrings(payload.selectedKnowledgeBlocks || []).filter((block) => /^(A|B|C|D|E|F)$/.test(block)),
    selectedKnowledgeFallback: Boolean(payload.selectedKnowledgeFallback),
    knowledgeSelectionError: safeText(payload.knowledgeSelectionError),
    referenceImageUrl: safeText(payload.referenceImageUrl),
    rawScriptText: safeText(payload.rawScriptText),
    storyboards,
    overview,
    generatedAt: safeText(payload.generatedAt) || nowIso()
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestClaudeText({ systemPrompt, userContent, maxTokens = 3600, temperature = 0.2, timeoutMs = 90000 }) {
  const token = getClaudeAuthToken();
  if (!token) {
    throw new Error("CLAUDE_AUTH_TOKEN/ANTHROPIC_AUTH_TOKEN is missing.");
  }

  const baseUrl = getClaudeBaseUrl();
  const model = CLAUDE_DEFAULT_MODEL;
  const endpoint = `${baseUrl}${CLAUDE_API_PATH}`;

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: safeText(systemPrompt),
    messages: [
      {
        role: "user",
        content: userContent
      }
    ]
  };

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: buildClaudeHeaders(token, baseUrl),
      body: JSON.stringify(body)
    },
    timeoutMs
  );

  if (!response.ok) {
    const detail = safeText(await response.text(), "Unknown error");
    throw new Error(`Claude request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const json = await response.json();
  return toArray(json?.content)
    .filter((part) => part?.type === "text")
    .map((part) => safeText(part?.text))
    .join("\n")
    .trim();
}

function buildVideoScriptProductInfoText(product, analysisResult) {
  const points = uniqueStrings(analysisResult?.sellingPoints || []).slice(0, 8);
  return [
    `商品标题: ${safeText(product?.title, "未知商品")}`,
    `店铺: ${safeText(product?.shopName, "未知店铺")}`,
    `链接: ${safeText(product?.url, "无")}`,
    `材质分析: ${safeText(analysisResult?.materialAnalysis, "无")}`,
    `外观描述: ${safeText(analysisResult?.appearanceDescription, "无")}`,
    `颜色分析: ${safeText(analysisResult?.colorAnalysis, "无")}`,
    `尺寸规格: ${safeText(analysisResult?.sizeAndSpecs, "无")}`,
    `使用场景与受众: ${safeText(analysisResult?.usageAndTargetAudience, "无")}`,
    `核心卖点: ${points.join("；") || "无"}`,
    `采购风险: ${uniqueStrings(analysisResult?.procurementRisks || []).join("；") || "无"}`
  ].join("\n");
}

function parseKnowledgeModuleIds(text) {
  const source = safeText(text).toUpperCase();
  const strict = source.match(/\b[A-F]\b/g) || [];
  const fallback = source.match(/[A-F]/g) || [];
  const merged = uniqueStrings(strict.length ? strict : fallback).filter((item) => /^(A|B|C|D|E|F)$/.test(item));
  return merged.slice(0, 3);
}

function buildVideoKnowledgeSlice(moduleIds) {
  return uniqueStrings(moduleIds)
    .filter((id) => Object.prototype.hasOwnProperty.call(VIDEO_KNOWLEDGE_BLOCKS, id))
    .map((id) => `【模块${id}】\n${VIDEO_KNOWLEDGE_BLOCKS[id]}`)
    .join("\n\n");
}

async function selectVideoKnowledgeModules(productInfoText) {
  const selectionPrompt = [
    "根据以下商品信息，判断制作短视频脚本最需要参考哪些知识模块。",
    "只允许从 A/B/C/D/E/F 中选择，最多选择3个。",
    "仅返回模块编号，例如：A,C,D。不要返回任何解释。",
    "",
    "商品信息：",
    productInfoText
  ].join("\n");

  const responseText = await requestClaudeText({
    systemPrompt: "你是短视频运镜知识路由器，只输出模块编号。",
    userContent: [{ type: "text", text: selectionPrompt }],
    maxTokens: 120,
    temperature: 0,
    timeoutMs: 30000
  });

  const selected = parseKnowledgeModuleIds(responseText);
  if (!selected.length) {
    throw new Error("Knowledge module selection returned empty result.");
  }
  return selected;
}

function buildVideoScriptSystemPrompt() {
  return [
    "你是一名专业短视频导演与脚本策划。",
    "硬性规则：",
    "1) 脚本中面向观众的文字（口播文案、画面字幕）必须使用葡萄牙语。",
    "2) 画面描述、运镜说明等解释性文字必须使用中文。",
    "3) 所有提示词必须使用英文。",
    "4) 输出必须严格遵循指定分镜卡片格式，不得添加格式外内容。",
    "5) 优先展示商品核心卖点，画面需具备社交媒体传播视觉冲击力。"
  ].join("\n");
}

function buildVideoScriptUserPrompt({ productInfoText, knowledgeSliceText }) {
  const outputTemplate = `【分镜 N / 共X段】

· 时长建议：X秒
· 生成模式：首帧生视频 / 首尾帧生视频
· 运镜类型：（如：推镜头 / 环绕镜头 / 低角度仰拍等）
· 运镜意图：（简要说明该镜头在整体叙事中的作用）

· 首帧生图提示词（英文）：
[在此填写用于生成该分镜首帧静态图片的完整英文提示词]

· 尾帧生图提示词（英文，仅首尾帧模式填写，首帧模式此项留空）：
[在此填写用于生成该分镜尾帧静态图片的完整英文提示词]

· 视频运动提示词（英文）：
[在此填写输入Seedance 2.0图生视频时使用的运镜运动描述提示词]

· 口播文案（葡萄牙语）：
[该分镜对应的解说词或旁白文案]

· 画面字幕（葡萄牙语）：
[该分镜需叠加的字幕文字，若无字幕则填写"无"]

· 音效建议：
[建议配合该分镜使用的背景音乐风格或音效类型描述]

· 画面说明（中文）：
[对该分镜画面内容的中文描述，帮助用户理解该镜头的视觉呈现效果]`;

  const overviewTemplate = `【脚本总览】

· 总分镜数：X段
· 预估总时长：XX秒
· 整体剧情框架：（简要描述本次脚本的叙事结构与情绪走向）
· 核心卖点覆盖：（列出本次脚本重点展示的商品卖点）
· 葡萄牙语配音建议：（整体语气风格建议，如热情、专业、亲切等）`;

  return [
    "以下为运镜创作参考知识库，请在构思分镜时优先参照其中的运镜类型、提示词结构与拍摄手法。",
    knowledgeSliceText,
    "",
    "以下是本次视频的核心表达对象（商品信息）：",
    productInfoText,
    "",
    "商品图片说明：提供的图片仅用于理解产品外观与特征。",
    "要求：所有分镜关键帧必须通过英文生图提示词重新生成，不得直接复用原图风格。",
    "",
    "创作硬性约束：",
    "1) 视频总时长必须在35秒至40秒之间。",
    "2) 分镜总数必须为7段或8段。",
    "3) 每段分镜时长必须在4秒至6秒之间。",
    "4) 所有分镜时长之和必须在35至40秒。",
    "5) 每段必须明确生成模式（首帧生视频 或 首尾帧生视频）。",
    "6) 首帧模式适用于单方向运动、主体相对静止。",
    "7) 首尾帧模式适用于需要明确起止状态变化的镜头。",
    "8) 所有面向观众的内容必须为葡萄牙语。",
    "",
    "输出格式要求：严格使用以下格式，按分镜顺序输出7或8段，然后输出脚本总览。",
    outputTemplate,
    "",
    overviewTemplate
  ].join("\n");
}

async function requestVideoStoryboard({ image, productInfoText, knowledgeSliceText }) {
  const userContent = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.buffer.toString("base64")
      }
    },
    {
      type: "text",
      text: buildVideoScriptUserPrompt({ productInfoText, knowledgeSliceText })
    }
  ];

  return requestClaudeText({
    systemPrompt: buildVideoScriptSystemPrompt(),
    userContent,
    maxTokens: 6200,
    temperature: 0.3,
    timeoutMs: 120000
  });
}

async function generateVideoScript({ product, analysisResult }) {
  const imageUrls = pickImageUrls(product);
  if (!imageUrls.length) {
    throw new Error("No valid product image URL found for video script generation.");
  }

  const downloaded = await downloadImage(imageUrls[0], {
    referer: safeText(product?.url)
  });
  const preparedImage = await preprocessForClaude(downloaded.buffer);
  const productInfoText = buildVideoScriptProductInfoText(product, analysisResult);

  let selectedKnowledgeBlocks = [...VIDEO_KNOWLEDGE_DEFAULT_BLOCKS];
  let selectedKnowledgeFallback = true;
  let knowledgeSelectionError = "";

  try {
    selectedKnowledgeBlocks = await selectVideoKnowledgeModules(productInfoText);
    selectedKnowledgeFallback = false;
  } catch (error) {
    selectedKnowledgeBlocks = [...VIDEO_KNOWLEDGE_DEFAULT_BLOCKS];
    selectedKnowledgeFallback = true;
    knowledgeSelectionError = error instanceof Error ? error.message : "Knowledge module selection failed";
  }

  const knowledgeSliceText = buildVideoKnowledgeSlice(selectedKnowledgeBlocks);
  const rawScriptText = await requestVideoStoryboard({
    image: preparedImage,
    productInfoText,
    knowledgeSliceText
  });

  const parsed = parseVideoStoryboardText(rawScriptText);
  validateVideoStoryboardData(parsed);

  return sanitizeVideoScriptResult({
    selectedKnowledgeBlocks,
    selectedKnowledgeFallback,
    knowledgeSelectionError,
    referenceImageUrl: downloaded.url,
    rawScriptText,
    storyboards: parsed.storyboards,
    overview: parsed.overview,
    generatedAt: nowIso()
  });
}

module.exports = {
  createJobId,
  analyzeProduct,
  identifyProductCategory,
  analyzeKnowledgeReferenceImage,
  compressCategoryKnowledge,
  sanitizeAnalysisResult,
  sanitizeCategoryRecognitionResult,
  sanitizeKnowledgeImageAnalysisResult,
  sanitizeKnowledgeCompressionResult,
  sanitizePromptGenerationResult,
  sanitizeVideoScriptResult,
  generatePromptPack,
  generateSecondStagePromptPack,
  generateVideoScript,
  VIDEO_SCRIPT_FORMAT_ERROR,
  CLAUDE_MODEL_SONNET,
  CLAUDE_MODEL_OPUS
};
