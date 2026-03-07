import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyzeStatusResponse,
  AnalyzeTriggerResponse,
  ApiListResponse,
  GenerateClipVideoResponse,
  GenerateSecondPromptResponse,
  GenerateVideoScriptResponse,
  ProductAnalysisState,
  ProductRecord,
  SecondPromptStatusResponse,
  SecondPromptGenerationState,
  VideoClipGenerationState,
  VideoScriptGenerationState
} from "./types";
import { ApiKeyManagerSection } from "./components/ApiKeyManagerSection";

const API_BASE = String(import.meta.env.VITE_API_BASE ?? "")
  .trim()
  .replace(/\/+$/, "");
const GENSPARK_IMAGE_URL = "https://www.genspark.ai/ai_image";
const MAIN_IMAGE_OPENING =
  "你是一名电商商品生图助手。请基于以下【主图提示词】逐条生成1:1主图。要求：保持同一商品主体、材质、结构和比例一致；不要新增原图不存在的文字/Logo；画面应适配目标市场电商平台。若提示词与参考图中的产品外观存在差别，必须优先以参考图外观为准进行绘制，并严格保持产品主体一致性。";
const DETAIL_IMAGE_OPENING =
  "你是一名电商商品详情图生图助手。请基于以下【详情页提示词】逐条生成9:16详情图。要求：保持与主图同款商品一致性；突出功能演示与信息表达；不要新增原图不存在的品牌文字或结构。若提示词与参考图中的产品外观存在差别，必须优先以参考图外观为准进行绘制，并严格保持产品主体一致性。";
const PRODUCT_CONSISTENCY_RULE =
  "若提示词与参考图中的产品外观存在差别，必须优先以参考图外观为准进行绘制，并严格保持产品主体一致性。";
const VIDEO_SCRIPT_AGENT_ENABLED = true;
const API_KEY_MANAGER_SESSION_STORAGE_KEY = "capturehub_api_key_manager_token";
const DEFAULT_PROMPT_PACK_TARGET_MARKET = "United States";
const DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE = "English";
const DEFAULT_PROMPT_PACK_IN_IMAGE_TEXT_LANGUAGE = "English";
const PROMPT_PACK_CUSTOM_OPTION = "__custom__";
const PROMPT_PACK_TARGET_MARKET_SUGGESTIONS = [
  "United States",
  "Brazil",
  "Mexico",
  "Canada",
  "United Kingdom",
  "Germany",
  "France",
  "Italy",
  "Spain",
  "Portugal",
  "Netherlands",
  "Poland",
  "Turkey",
  "Saudi Arabia",
  "United Arab Emirates",
  "Egypt",
  "South Africa",
  "India",
  "Indonesia",
  "Thailand",
  "Vietnam",
  "Malaysia",
  "Philippines",
  "Japan",
  "South Korea",
  "Australia",
  "New Zealand",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru"
];
const PROMPT_PACK_TEXT_LANGUAGE_SUGGESTIONS = [
  "English",
  "Portuguese (Brazil)",
  "Spanish",
  "Portuguese",
  "French",
  "German",
  "Italian",
  "Dutch",
  "Polish",
  "Turkish",
  "Arabic",
  "Hindi",
  "Indonesian",
  "Thai",
  "Vietnamese",
  "Malay",
  "Filipino",
  "Japanese",
  "Korean",
  "Russian"
];

const DEFAULT_ANALYSIS_STATE: ProductAnalysisState = {
  status: "idle",
  jobId: null,
  error: null,
  updatedAt: null,
  result: null
};

const DEFAULT_SECOND_PROMPT_STATE: SecondPromptGenerationState = {
  status: "idle",
  jobId: null,
  error: null,
  updatedAt: null,
  result: null
};

const DEFAULT_VIDEO_SCRIPT_STATE: VideoScriptGenerationState = {
  status: "idle",
  error: null,
  updatedAt: null,
  result: null
};

const DEFAULT_VIDEO_CLIP_GENERATION_STATE: VideoClipGenerationState = {
  updatedAt: null,
  items: []
};

function toCurrency(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "Price N/A";
  }
  return `CNY ${value.toFixed(2)}`;
}

function toDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function isHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function buildDisplayImageUrl(imageUrl: string | null | undefined, refererUrl: string | null | undefined = "") {
  const raw = String(imageUrl || "").trim();
  if (!raw) {
    return "";
  }
  if (/^data:image\//i.test(raw)) {
    return raw;
  }
  if (!isHttpUrl(raw)) {
    return raw;
  }
  const lower = raw.toLowerCase();
  if (lower.includes("/static/manual-product-images/") || lower.includes("/static/knowledge-base-images/")) {
    return raw;
  }
  const referer = String(refererUrl || "").trim();
  const params = new URLSearchParams();
  params.set("url", raw);
  if (referer) {
    params.set("referer", referer);
  }
  return `${API_BASE}/api/image-proxy?${params.toString()}`;
}

function normalizeAnalysisState(input: ProductRecord["analysis"]): ProductAnalysisState {
  const source = input ?? DEFAULT_ANALYSIS_STATE;
  const allowed = new Set(["idle", "queued", "processing", "completed", "failed"]);
  const status = allowed.has(source.status) ? source.status : "idle";
  const resultSource = source.result;
  return {
    status,
    jobId: source.jobId ?? null,
    error: source.error ?? null,
    updatedAt: source.updatedAt ?? null,
    result: resultSource
      ? {
          materialAnalysis: resultSource.materialAnalysis ?? "",
          appearanceDescription: resultSource.appearanceDescription ?? "",
          colorAnalysis: resultSource.colorAnalysis ?? "",
          sizeAndSpecs: resultSource.sizeAndSpecs ?? "",
          usageAndTargetAudience: resultSource.usageAndTargetAudience ?? "",
          detailedDescription: resultSource.detailedDescription ?? "",
          sellingPoints: Array.isArray(resultSource.sellingPoints) ? resultSource.sellingPoints.map((item) => String(item || "")).filter(Boolean) : [],
          procurementRisks: Array.isArray(resultSource.procurementRisks)
            ? resultSource.procurementRisks.map((item) => String(item || "")).filter(Boolean)
            : [],
          whiteBackgroundImageUrl: resultSource.whiteBackgroundImageUrl ?? "",
          referenceImageUrl: resultSource.referenceImageUrl ?? "",
          generatedAt: resultSource.generatedAt ?? null
        }
      : null
  };
}

function normalizeSecondPromptState(input: ProductRecord["secondPromptGeneration"]): SecondPromptGenerationState {
  const source = input ?? DEFAULT_SECOND_PROMPT_STATE;
  const allowed = new Set(["idle", "processing", "completed", "failed"]);
  const status = allowed.has(source.status) ? source.status : "idle";
  return {
    status,
    jobId: source.jobId ?? null,
    error: source.error ?? null,
    updatedAt: source.updatedAt ?? null,
    result: source.result
      ? {
          referenceImageUrl: source.result.referenceImageUrl ?? "",
          templateVersion: source.result.templateVersion ?? "v2.1",
          detailAspectRatio: source.result.detailAspectRatio === "1:1" ? "1:1" : "9:16",
          requestContext: source.result.requestContext
            ? {
                productReference: source.result.requestContext.productReference
                  ? {
                      title: source.result.requestContext.productReference.title ?? "",
                      shop: source.result.requestContext.productReference.shop ?? "",
                      url: source.result.requestContext.productReference.url ?? ""
                    }
                  : undefined,
                firstPassAnalysis:
                  source.result.requestContext.firstPassAnalysis && typeof source.result.requestContext.firstPassAnalysis === "object"
                    ? source.result.requestContext.firstPassAnalysis
                    : undefined,
                productProfile: source.result.requestContext.productProfile
                  ? {
                      appearanceDetails: source.result.requestContext.productProfile.appearanceDetails ?? "",
                      materialDetails: source.result.requestContext.productProfile.materialDetails ?? "",
                      shapeDetails: source.result.requestContext.productProfile.shapeDetails ?? "",
                      sizeDetails: source.result.requestContext.productProfile.sizeDetails ?? "",
                      colorDetails: source.result.requestContext.productProfile.colorDetails ?? ""
                    }
                  : undefined,
                locale: source.result.requestContext.locale
                  ? {
                      targetMarket: source.result.requestContext.locale.targetMarket ?? "",
                      promptLanguage: source.result.requestContext.locale.promptLanguage ?? "",
                      inImageTextLanguage: source.result.requestContext.locale.inImageTextLanguage ?? ""
                    }
                  : undefined,
                template: source.result.requestContext.template
                  ? {
                      version: source.result.requestContext.template.version ?? "",
                      required: Boolean(source.result.requestContext.template.required),
                      charLength: Number(source.result.requestContext.template.charLength || 0)
                    }
                  : undefined,
                qualityRetryUsed: Boolean(source.result.requestContext.qualityRetryUsed)
              }
            : undefined,
          output: source.result.output ?? null,
          outputText: source.result.outputText ?? "",
          generatedAt: source.result.generatedAt ?? null
        }
      : null
  };
}

function normalizeVideoScriptState(input: ProductRecord["videoScriptGeneration"]): VideoScriptGenerationState {
  const source = input ?? DEFAULT_VIDEO_SCRIPT_STATE;
  const allowed = new Set(["idle", "processing", "completed", "failed"]);
  const status = allowed.has(source.status) ? source.status : "idle";
  const resultSource = source.result;
  return {
    status,
    error: source.error ?? null,
    updatedAt: source.updatedAt ?? null,
    result: resultSource
      ? {
          inputPayload:
            resultSource.inputPayload && typeof resultSource.inputPayload === "object"
              ? {
                  product_images: Array.isArray(resultSource.inputPayload.product_images)
                    ? resultSource.inputPayload.product_images.map((item) => String(item || "")).filter(Boolean)
                    : [],
                  product_params:
                    resultSource.inputPayload.product_params && typeof resultSource.inputPayload.product_params === "object"
                      ? resultSource.inputPayload.product_params
                      : {}
                }
              : null,
          outputPayload:
            resultSource.outputPayload && typeof resultSource.outputPayload === "object"
              ? {
                  product_info:
                    resultSource.outputPayload.product_info && typeof resultSource.outputPayload.product_info === "object"
                      ? resultSource.outputPayload.product_info
                      : null,
                  script_set_1:
                    resultSource.outputPayload.script_set_1 && typeof resultSource.outputPayload.script_set_1 === "object"
                      ? resultSource.outputPayload.script_set_1
                      : null,
                  script_set_2:
                    resultSource.outputPayload.script_set_2 && typeof resultSource.outputPayload.script_set_2 === "object"
                      ? resultSource.outputPayload.script_set_2
                      : null,
                  script_set_3:
                    resultSource.outputPayload.script_set_3 && typeof resultSource.outputPayload.script_set_3 === "object"
                      ? resultSource.outputPayload.script_set_3
                      : null,
                  scripts: Array.isArray(resultSource.outputPayload.scripts)
                    ? resultSource.outputPayload.scripts
                        .map((script) => {
                          const sourceScript = script as Record<string, unknown>;
                          const shots = Array.isArray(sourceScript["shots"]) ? (sourceScript["shots"] as unknown[]) : [];
                          return {
                            script_id: String(sourceScript["script_id"] || ""),
                            digital_human_base_image_prompt: String(sourceScript["digital_human_base_image_prompt"] || ""),
                            shots: shots
                              .map((shot) => {
                                const sourceShot = shot as Record<string, unknown>;
                                return {
                                  shot_id: String(sourceShot["shot_id"] || ""),
                                  image_prompt: String(sourceShot["image_prompt"] || ""),
                                  video_prompt: String(sourceShot["video_prompt"] || ""),
                                  manual_shoot_required: Boolean(sourceShot["manual_shoot_required"]),
                                  manual_shoot_script: sourceShot["manual_shoot_script"] ? String(sourceShot["manual_shoot_script"]) : null
                                };
                              })
                              .filter(Boolean)
                          };
                        })
                        .filter(Boolean)
                    : [],
                  production_notes:
                    resultSource.outputPayload.production_notes && typeof resultSource.outputPayload.production_notes === "object"
                      ? resultSource.outputPayload.production_notes
                      : null,
                  raw: resultSource.outputPayload.raw && typeof resultSource.outputPayload.raw === "object" ? resultSource.outputPayload.raw : null
                }
              : null,
          requestContext:
            resultSource.requestContext && typeof resultSource.requestContext === "object"
              ? {
                  locale:
                    resultSource.requestContext.locale && typeof resultSource.requestContext.locale === "object"
                      ? {
                          targetMarket: String(resultSource.requestContext.locale.targetMarket || ""),
                          promptLanguage: String(resultSource.requestContext.locale.promptLanguage || ""),
                          inImageTextLanguage: String(resultSource.requestContext.locale.inImageTextLanguage || "")
                        }
                      : undefined
                }
              : null,
          modelRequest:
            resultSource.modelRequest && typeof resultSource.modelRequest === "object"
              ? {
                  endpoint: String(resultSource.modelRequest.endpoint || ""),
                  requestBody:
                    resultSource.modelRequest.requestBody && typeof resultSource.modelRequest.requestBody === "object"
                      ? (resultSource.modelRequest.requestBody as Record<string, unknown>)
                      : null,
                  sentAt: resultSource.modelRequest.sentAt ? String(resultSource.modelRequest.sentAt) : null
                }
              : null,
          scriptPackages: Array.isArray(resultSource.scriptPackages)
            ? resultSource.scriptPackages
                .map((script) => {
                  const sourceScript = script as Record<string, unknown>;
                  const shots = Array.isArray(sourceScript["shots"]) ? (sourceScript["shots"] as unknown[]) : [];
                  return {
                    scriptId: String(sourceScript["scriptId"] || ""),
                    digitalHumanBaseImagePrompt: String(sourceScript["digitalHumanBaseImagePrompt"] || ""),
                    shots: shots
                      .map((shot) => {
                        const sourceShot = shot as Record<string, unknown>;
                        return {
                          shotId: String(sourceShot["shotId"] || ""),
                          imagePrompt: String(sourceShot["imagePrompt"] || ""),
                          videoPrompt: String(sourceShot["videoPrompt"] || ""),
                          manualShootRequired: Boolean(sourceShot["manualShootRequired"]),
                          manualShootScript: String(sourceShot["manualShootScript"] || "")
                        };
                      })
                      .filter(Boolean)
                  };
                })
                .filter(Boolean) as NonNullable<VideoScriptGenerationState["result"]>["scriptPackages"]
            : [],
          scriptSets: Array.isArray(resultSource.scriptSets)
            ? resultSource.scriptSets
                .map((set) => {
                  if (!set || typeof set !== "object") {
                    return null;
                  }
                  const key = String(set.setKey || "").trim();
                  if (key !== "script_set_1" && key !== "script_set_2" && key !== "script_set_3") {
                    return null;
                  }
                  return {
                    setKey: key as "script_set_1" | "script_set_2" | "script_set_3",
                    scriptName: String(set.scriptName || ""),
                    strategy: String(set.strategy || ""),
                    targetAudience: String(set.targetAudience || ""),
                    totalDuration: String(set.totalDuration || ""),
                    videoStructure: String(set.videoStructure || ""),
                    clips: Array.isArray(set.clips)
                      ? set.clips.map((clip) => ({
                          clipNumber: typeof clip?.clipNumber === "number" ? clip.clipNumber : null,
                          duration: String(clip?.duration || ""),
                          sceneType: String(clip?.sceneType || ""),
                          sceneDescription: String(clip?.sceneDescription || ""),
                          marketingPurpose: String(clip?.marketingPurpose || ""),
                          generationMethod: String(clip?.generationMethod || ""),
                          aiOrReal: String(clip?.aiOrReal || ""),
                          firstFramePrompt: String(clip?.firstFramePrompt ?? clip?.imageGenerationPrompt ?? ""),
                          lastFramePrompt: String(clip?.lastFramePrompt ?? ""),
                          videoAudioPrompt: String(clip?.videoAudioPrompt || ""),
                          imageGenerationPrompt: String(
                            clip?.imageGenerationPrompt ?? clip?.firstFramePrompt ?? ""
                          ),
                          videoGenerationPrompt: String(clip?.videoGenerationPrompt || ""),
                          audioDescription: String(clip?.audioDescription || ""),
                          narrationPortuguese: String(clip?.narrationPortuguese || ""),
                          visualElements: String(clip?.visualElements || ""),
                          styleNotes: String(clip?.styleNotes || "")
                        }))
                      : [],
                    raw: set.raw && typeof set.raw === "object" ? set.raw : {}
                  };
                })
                .filter(Boolean) as NonNullable<VideoScriptGenerationState["result"]>["scriptSets"]
            : [],
          generatedAt: resultSource.generatedAt ?? null
        }
      : null
  };
}

function normalizeVideoClipGenerationState(input: ProductRecord["videoClipGeneration"]): VideoClipGenerationState {
  const source = input ?? DEFAULT_VIDEO_CLIP_GENERATION_STATE;
  return {
    updatedAt: source.updatedAt ?? null,
    items: Array.isArray(source.items)
      ? source.items
          .map((item) => {
            const setKey = String(item?.setKey || "").trim();
            const clipIndex = typeof item?.clipIndex === "number" && Number.isFinite(item.clipIndex) ? Math.max(0, Math.floor(item.clipIndex)) : 0;
            const key = String(item?.key || `${setKey}::${clipIndex}`).trim();
            if (!setKey || !key) {
              return null;
            }
            const rawStatus = String(item?.status || "idle").trim();
            const status = ["idle", "queued", "processing", "succeeded", "failed"].includes(rawStatus) ? rawStatus : "idle";
            return {
              key,
              setKey,
              clipIndex,
              status: status as VideoClipGenerationState["items"][number]["status"],
              jobId: item?.jobId ? String(item.jobId) : null,
              taskId: item?.taskId ? String(item.taskId) : null,
              prompt: String(item?.prompt || ""),
              firstFrameUrl: String(item?.firstFrameUrl || ""),
              lastFrameUrl: String(item?.lastFrameUrl || ""),
              firstFrameName: String(item?.firstFrameName || ""),
              lastFrameName: String(item?.lastFrameName || ""),
              aspectRatio: String(item?.aspectRatio || "9:16"),
              retryCount: typeof item?.retryCount === "number" && Number.isFinite(item.retryCount) ? Math.max(0, Math.floor(item.retryCount)) : 0,
              maxRetries: typeof item?.maxRetries === "number" && Number.isFinite(item.maxRetries) ? Math.max(1, Math.floor(item.maxRetries)) : 3,
              videoUrl: String(item?.videoUrl || ""),
              error: item?.error ? String(item.error) : null,
              createdAt: item?.createdAt ? String(item.createdAt) : null,
              startedAt: item?.startedAt ? String(item.startedAt) : null,
              completedAt: item?.completedAt ? String(item.completedAt) : null,
              updatedAt: item?.updatedAt ? String(item.updatedAt) : null
            };
          })
          .filter(Boolean) as VideoClipGenerationState["items"]
      : []
  };
}

function normalizeProductRecord(item: ProductRecord): ProductRecord {
  const imageList = Array.isArray(item.images) ? item.images.filter((entry) => typeof entry === "string" && entry.trim()) : [];
  return {
    ...item,
    images: [...new Set([item.triggeredImage, ...imageList].filter(Boolean))],
    analysis: normalizeAnalysisState(item.analysis),
    videoScriptGeneration: normalizeVideoScriptState(item.videoScriptGeneration),
    secondPromptGeneration: normalizeSecondPromptState(item.secondPromptGeneration),
    videoClipGeneration: normalizeVideoClipGenerationState(item.videoClipGeneration)
  };
}

function analysisStatusLabel(status: ProductAnalysisState["status"]) {
  switch (status) {
    case "queued":
      return "排队中";
    case "processing":
      return "分析中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "未分析";
  }
}

function secondPromptStatusLabel(status: SecondPromptGenerationState["status"]) {
  switch (status) {
    case "processing":
      return "生成中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "未生成";
  }
}

function videoScriptStatusLabel(status: VideoScriptGenerationState["status"]) {
  switch (status) {
    case "processing":
      return "生成中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "未生成";
  }
}

type PromptCardEntry = {
  imageId: string;
  sceneType: string;
  sceneDescription: string;
  promptEn: string;
};

type PromptSection = {
  title: string;
  cards: PromptCardEntry[];
  copyText: string;
};

type SplitPromptSections = {
  main: PromptSection;
  detail: PromptSection;
};

type PromptPackProductProfile = {
  appearanceDetails: string;
  materialDetails: string;
  shapeDetails: string;
  sizeDetails: string;
  colorDetails: string;
};

type PromptPackLocaleSettings = {
  targetMarket: string;
  inImageTextLanguage: string;
};

type GenerateVideoScriptOptions = {
  productInfoText?: string;
};

type GenerateVideoScriptHandler = (recordId: string, options?: GenerateVideoScriptOptions) => Promise<void>;

type ManualUploadResponse = {
  ok: boolean;
  item?: ProductRecord;
  productLink?: string;
  message?: string;
};

type VideoScriptStatusResponse = {
  ok: boolean;
  recordId: string;
  videoScriptGeneration?: VideoScriptGenerationState;
  message?: string;
};

type ProductInfoFieldKey =
  | "materialAnalysis"
  | "appearanceDescription"
  | "colorAnalysis"
  | "sizeAndSpecs"
  | "usageAndTargetAudience"
  | "detailedDescription"
  | "sellingPoints"
  | "procurementRisks";

type ProductInfoFieldMap = Record<ProductInfoFieldKey, string>;

const PRODUCT_INFO_EDIT_FIELDS: Array<{
  key: ProductInfoFieldKey;
  label: string;
  placeholder: string;
  rows: number;
}> = [
  { key: "materialAnalysis", label: "材质分析", placeholder: "例如：杯体材质、刀片材质、工艺处理。", rows: 4 },
  { key: "appearanceDescription", label: "外观描述", placeholder: "例如：造型、结构、操作区外观、设计风格。", rows: 4 },
  { key: "colorAnalysis", label: "颜色信息", placeholder: "例如：主色、配色、可选颜色与风格倾向。", rows: 4 },
  { key: "sizeAndSpecs", label: "尺寸规格", placeholder: "例如：尺寸、容量、重量、不同规格差异。", rows: 4 },
  { key: "usageAndTargetAudience", label: "使用场景/目标人群", placeholder: "例如：使用场景、核心人群、购买动机。", rows: 4 },
  { key: "detailedDescription", label: "详细描述", placeholder: "用于补充产品完整卖点与整体产品理解。", rows: 5 },
  { key: "sellingPoints", label: "卖点", placeholder: "每行一个卖点。", rows: 5 },
  { key: "procurementRisks", label: "采购风险", placeholder: "每行一个风险点。", rows: 4 }
];

const PRODUCT_INFO_FIELD_ALIAS_MAP: Record<string, ProductInfoFieldKey> = {
  materialanalysis: "materialAnalysis",
  "材质": "materialAnalysis",
  "材质分析": "materialAnalysis",
  appearancedescription: "appearanceDescription",
  "外观": "appearanceDescription",
  "外观描述": "appearanceDescription",
  coloranalysis: "colorAnalysis",
  "颜色": "colorAnalysis",
  "颜色分析": "colorAnalysis",
  sizeandspecs: "sizeAndSpecs",
  "尺寸": "sizeAndSpecs",
  "规格": "sizeAndSpecs",
  "尺寸规格": "sizeAndSpecs",
  usageandtargetaudience: "usageAndTargetAudience",
  "使用场景": "usageAndTargetAudience",
  "目标人群": "usageAndTargetAudience",
  "使用场景目标人群": "usageAndTargetAudience",
  detaileddescription: "detailedDescription",
  "详情描述": "detailedDescription",
  "详细描述": "detailedDescription",
  sellingpoints: "sellingPoints",
  "卖点": "sellingPoints",
  procurementrisks: "procurementRisks",
  "采购风险": "procurementRisks"
};

function buildVideoClipInfoBundle(sceneDescription: string, marketingPurpose: string, videoAudioPrompt: string) {
  const lines = [
    `scene_description: ${safeText(sceneDescription)}`,
    `marketing_purpose: ${safeText(marketingPurpose)}`,
    `video_audio_prompt: ${safeText(videoAudioPrompt)}`
  ];
  return lines.join("\n");
}

function safeText(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

function normalizePromptPackLocaleSettings(input?: Partial<PromptPackLocaleSettings> | null): PromptPackLocaleSettings {
  const source = input && typeof input === "object" ? input : {};
  return {
    targetMarket: safeText(source.targetMarket) || DEFAULT_PROMPT_PACK_TARGET_MARKET,
    inImageTextLanguage: safeText(source.inImageTextLanguage) || DEFAULT_PROMPT_PACK_IN_IMAGE_TEXT_LANGUAGE
  };
}

function createEmptyProductInfoFields(): ProductInfoFieldMap {
  return {
    materialAnalysis: "",
    appearanceDescription: "",
    colorAnalysis: "",
    sizeAndSpecs: "",
    usageAndTargetAudience: "",
    detailedDescription: "",
    sellingPoints: "",
    procurementRisks: ""
  };
}

function toMultilineListText(input: unknown) {
  if (!Array.isArray(input)) {
    return "";
  }
  const lines = input.map((item) => safeText(item)).filter(Boolean);
  if (!lines.length) {
    return "";
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

function normalizeProductInfoFieldAlias(input: string) {
  return safeText(input)
    .toLowerCase()
    .replace(/[：:\s_\-()（）]/g, "");
}

function buildVideoProductInfoTextFromFields(fields: ProductInfoFieldMap) {
  const lines: string[] = [];
  PRODUCT_INFO_EDIT_FIELDS.forEach((field) => {
    const value = String(fields[field.key] || "");
    const valueLines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!valueLines.length) {
      return;
    }
    lines.push(`${field.key}: ${valueLines[0]}`);
    valueLines.slice(1).forEach((line) => {
      lines.push(`  ${line}`);
    });
  });
  return lines.join("\n");
}

function parseVideoProductInfoTextToFields(text: string, fallback?: ProductInfoFieldMap): ProductInfoFieldMap {
  const next = {
    ...createEmptyProductInfoFields(),
    ...(fallback || {})
  };
  const source = String(text || "");
  if (!safeText(source)) {
    return next;
  }
  let activeKey: ProductInfoFieldKey | null = null;
  source.split(/\r?\n/).forEach((rawLine) => {
    const line = String(rawLine || "");
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const colonIndex = (() => {
      const idxCn = trimmed.indexOf("：");
      const idxEn = trimmed.indexOf(":");
      if (idxCn === -1) {
        return idxEn;
      }
      if (idxEn === -1) {
        return idxCn;
      }
      return Math.min(idxCn, idxEn);
    })();
    if (colonIndex > 0) {
      const rawLabel = trimmed.slice(0, colonIndex);
      const rawValue = trimmed.slice(colonIndex + 1).trim();
      const key = PRODUCT_INFO_FIELD_ALIAS_MAP[normalizeProductInfoFieldAlias(rawLabel)] || null;
      if (key) {
        next[key] = rawValue;
        activeKey = key;
        return;
      }
    }
    if (activeKey) {
      next[activeKey] = [next[activeKey], trimmed].filter(Boolean).join("\n");
    } else {
      next.detailedDescription = [next.detailedDescription, trimmed].filter(Boolean).join("\n");
    }
  });
  return next;
}

function extractPriorityDetailedDescription(productInfoText: string) {
  const fields = parseVideoProductInfoTextToFields(productInfoText);
  return safeText(fields.detailedDescription);
}

function buildVideoProductInfoOverrideRequestBody(productInfoText: string) {
  const normalizedText = safeText(productInfoText);
  const priorityDetailedDescription = extractPriorityDetailedDescription(normalizedText);
  if (!normalizedText && !priorityDetailedDescription) {
    return null;
  }
  const body: Record<string, unknown> = {};
  if (normalizedText) {
    body.product_info_text = normalizedText;
    body.product_description = normalizedText;
    body.product_params = {
      product_info_text: normalizedText,
      product_description: normalizedText
    };
  }
  if (priorityDetailedDescription) {
    body.priority_detailed_description = priorityDetailedDescription;
  }
  return body;
}

function buildSecondPromptRequestBody(productInfoText: string, locale: PromptPackLocaleSettings) {
  const normalizedLocale = normalizePromptPackLocaleSettings(locale);
  const baseBody = buildVideoProductInfoOverrideRequestBody(productInfoText) || {};
  return {
    ...baseBody,
    target_market: normalizedLocale.targetMarket,
    prompt_language: DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE,
    in_image_text_language: normalizedLocale.inImageTextLanguage
  };
}

function buildVideoScriptRequestBody(productInfoText: string, locale: PromptPackLocaleSettings) {
  const normalizedLocale = normalizePromptPackLocaleSettings(locale);
  const baseBody = buildVideoProductInfoOverrideRequestBody(productInfoText) || {};
  return {
    ...baseBody,
    target_market: normalizedLocale.targetMarket,
    prompt_language: DEFAULT_PROMPT_PACK_PROMPT_LANGUAGE,
    in_image_text_language: normalizedLocale.inImageTextLanguage
  };
}

function buildFallbackVideoProductInfoFields(
  item: ProductRecord,
  analysisResult: ProductAnalysisState["result"] | null
) {
  const fields = createEmptyProductInfoFields();
  fields.materialAnalysis = safeText(analysisResult?.materialAnalysis);
  fields.appearanceDescription = safeText(analysisResult?.appearanceDescription);
  fields.colorAnalysis = safeText(analysisResult?.colorAnalysis);
  fields.sizeAndSpecs = safeText(analysisResult?.sizeAndSpecs);
  fields.usageAndTargetAudience = safeText(analysisResult?.usageAndTargetAudience);
  fields.detailedDescription = safeText(analysisResult?.detailedDescription);
  fields.sellingPoints = toMultilineListText(analysisResult?.sellingPoints);
  fields.procurementRisks = toMultilineListText(analysisResult?.procurementRisks);
  const hasAnyValue = Object.values(fields).some((value) => safeText(value));
  if (!hasAnyValue) {
    fields.detailedDescription = [safeText(item.title), safeText(item.shopName)].filter(Boolean).join("\n");
  }
  return fields;
}

function buildFallbackVideoProductInfoText(item: ProductRecord, analysisResult: ProductAnalysisState["result"] | null) {
  return buildVideoProductInfoTextFromFields(buildFallbackVideoProductInfoFields(item, analysisResult));
}

function toPrettyJsonText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function buildVideoScriptRawDebugText(result: VideoScriptGenerationState["result"] | null) {
  if (!result) {
    return "";
  }
  const rawPayload = result.outputPayload?.raw;
  if (rawPayload && typeof rawPayload === "object" && typeof rawPayload.response_text === "string" && rawPayload.response_text) {
    return rawPayload.response_text;
  }
  const blocks: string[] = [];
  if (result.modelRequest?.requestBody) {
    blocks.push(`[model_request]\n${toPrettyJsonText(result.modelRequest.requestBody)}`);
  }
  if (result.outputPayload?.raw) {
    blocks.push(`[output_payload.raw]\n${toPrettyJsonText(result.outputPayload.raw)}`);
  } else if (result.outputPayload) {
    blocks.push(`[output_payload]\n${toPrettyJsonText(result.outputPayload)}`);
  }
  if (!blocks.length) {
    blocks.push(toPrettyJsonText(result));
  }
  return blocks.join("\n\n");
}

function toObjectArray(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}

function parseSecondPromptOutput(result: NonNullable<SecondPromptGenerationState["result"]>) {
  if (result.output && typeof result.output === "object") {
    return result.output as Record<string, unknown>;
  }
  const text = safeText(result.outputText);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch (_error) {
    return null;
  }
}

function parseSecondPromptLocaleSettings(result: NonNullable<SecondPromptGenerationState["result"]> | null | undefined) {
  if (!result) {
    return null;
  }
  const output = parseSecondPromptOutput(result);
  const metadata = output?.metadata && typeof output.metadata === "object" ? (output.metadata as Record<string, unknown>) : null;
  const locale = result.requestContext?.locale;
  return normalizePromptPackLocaleSettings({
    targetMarket: safeText(locale?.targetMarket) || safeText(metadata?.target_market ?? metadata?.targetMarket),
    inImageTextLanguage:
      safeText(locale?.inImageTextLanguage) ||
      safeText(metadata?.in_image_text_language ?? metadata?.inImageTextLanguage ?? metadata?.text_overlay_language ?? metadata?.textOverlayLanguage)
  });
}

function parseVideoScriptLocaleSettings(result: NonNullable<VideoScriptGenerationState["result"]> | null | undefined) {
  if (!result) {
    return null;
  }
  const locale = result.requestContext?.locale;
  const targetMarket = safeText(locale?.targetMarket);
  const inImageTextLanguage = safeText(locale?.inImageTextLanguage);
  if (!targetMarket && !inImageTextLanguage) {
    return null;
  }
  return normalizePromptPackLocaleSettings({
    targetMarket,
    inImageTextLanguage
  });
}

function normalizePromptPackProductProfile(input: unknown): PromptPackProductProfile | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const source = input as Record<string, unknown>;
  const appearanceDetails = safeText(
    source.appearanceDetails ?? source.appearance_details ?? source.appearanceDescription ?? source.appearance_description
  );
  const materialDetails = safeText(source.materialDetails ?? source.material_details ?? source.materialAnalysis ?? source.material_analysis);
  const shapeDetails = safeText(
    source.shapeDetails ?? source.shape_details ?? source.shapeAnalysis ?? source.shape_analysis ?? source.structureDescription ?? source.structure_description
  );
  const sizeDetails = safeText(
    source.sizeDetails ?? source.size_details ?? source.sizeAndSpecs ?? source.size_and_specs ?? source.dimensionDetails ?? source.dimension_details
  );
  const colorDetails = safeText(
    source.colorDetails ?? source.color_details ?? source.colorAnalysis ?? source.color_analysis ?? source.colorInfo ?? source.color_info
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

function buildFallbackPromptPackProductProfileFromAnalysis(analysisResult: ProductAnalysisState["result"] | null): PromptPackProductProfile {
  return {
    appearanceDetails: safeText(analysisResult?.appearanceDescription),
    materialDetails: safeText(analysisResult?.materialAnalysis),
    shapeDetails: safeText(analysisResult?.appearanceDescription),
    sizeDetails: safeText(analysisResult?.sizeAndSpecs),
    colorDetails: safeText(analysisResult?.colorAnalysis)
  };
}

function parseSecondPromptProductProfile(
  result: NonNullable<SecondPromptGenerationState["result"]>,
  fallbackAnalysis: ProductAnalysisState["result"] | null = null
) {
  const output = parseSecondPromptOutput(result);
  const outputProfile = normalizePromptPackProductProfile(
    output?.product_profile ?? output?.productProfile ?? output?.product_details ?? output?.productDetails
  );
  const contextProfile = normalizePromptPackProductProfile(result.requestContext?.productProfile ?? null);
  const firstPass = result.requestContext?.firstPassAnalysis ?? null;
  const fallbackProfile = normalizePromptPackProductProfile(
    firstPass
      ? {
          appearance_details:
            (firstPass as Record<string, unknown>).appearance_description ?? (firstPass as Record<string, unknown>).appearanceDescription,
          material_details: (firstPass as Record<string, unknown>).material_analysis ?? (firstPass as Record<string, unknown>).materialAnalysis,
          shape_details:
            (firstPass as Record<string, unknown>).shape_details ??
            (firstPass as Record<string, unknown>).shapeDetails ??
            (firstPass as Record<string, unknown>).appearance_description,
          size_details: (firstPass as Record<string, unknown>).size_and_specs ?? (firstPass as Record<string, unknown>).sizeAndSpecs,
          color_details:
            (firstPass as Record<string, unknown>).color_details ??
            (firstPass as Record<string, unknown>).colorDetails ??
            (firstPass as Record<string, unknown>).color_analysis ??
            (firstPass as Record<string, unknown>).colorAnalysis
        }
      : null
  );
  const analysisFallbackProfile = buildFallbackPromptPackProductProfileFromAnalysis(fallbackAnalysis);
  const merged: PromptPackProductProfile = {
    appearanceDetails:
      outputProfile?.appearanceDetails || contextProfile?.appearanceDetails || fallbackProfile?.appearanceDetails || analysisFallbackProfile.appearanceDetails,
    materialDetails:
      outputProfile?.materialDetails || contextProfile?.materialDetails || fallbackProfile?.materialDetails || analysisFallbackProfile.materialDetails,
    shapeDetails: outputProfile?.shapeDetails || contextProfile?.shapeDetails || fallbackProfile?.shapeDetails || analysisFallbackProfile.shapeDetails,
    sizeDetails: outputProfile?.sizeDetails || contextProfile?.sizeDetails || fallbackProfile?.sizeDetails || analysisFallbackProfile.sizeDetails,
    colorDetails: outputProfile?.colorDetails || contextProfile?.colorDetails || fallbackProfile?.colorDetails || analysisFallbackProfile.colorDetails
  };
  return merged;
}

function normalizePromptCards(input: unknown, fallbackPrefix: string) {
  return toObjectArray(input).map((item, index) => {
    const rawId = safeText(item.image_id ?? item.imageId);
    const imageId = rawId || `${fallbackPrefix}_${String(index + 1).padStart(2, "0")}`;
    return {
      imageId,
      sceneType: safeText(item.scene_type ?? item.sceneType),
      sceneDescription: safeText(item.scene_description ?? item.sceneDescription),
      promptEn: safeText(item.prompt_en ?? item.promptEn ?? item.prompt)
    };
  });
}

function buildPromptCopyText(opening: string, title: string, cards: PromptCardEntry[]) {
  const lines = [opening, "", `【${title}】`, `共 ${cards.length} 条。`, ""];
  if (!cards.length) {
    lines.push("暂无可用提示词。");
    return lines.join("\n");
  }
  cards.forEach((card, index) => {
    lines.push(`${index + 1}. ${card.imageId}${card.sceneDescription ? ` - ${card.sceneDescription}` : ""}`);
    if (card.sceneType) {
      lines.push(`场景类型: ${card.sceneType}`);
    }
    const promptBody = card.promptEn || "（空）";
    lines.push(`EN: ${promptBody}`);
    lines.push(`一致性要求: ${PRODUCT_CONSISTENCY_RULE}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

function splitSecondPromptSections(result: NonNullable<SecondPromptGenerationState["result"]>): SplitPromptSections {
  const output = parseSecondPromptOutput(result);
  const mainSource = output ? output.main_images ?? output.mainImages : null;
  const detailSource = output ? output.detail_images ?? output.detailImages : null;
  const mainCards = normalizePromptCards(mainSource, "main");
  const detailCards = normalizePromptCards(detailSource, "detail");
  return {
    main: {
      title: "主图提示词",
      cards: mainCards,
      copyText: buildPromptCopyText(MAIN_IMAGE_OPENING, "主图提示词", mainCards)
    },
    detail: {
      title: "详情页提示词",
      cards: detailCards,
      copyText: buildPromptCopyText(DETAIL_IMAGE_OPENING, "详情页提示词", detailCards)
    }
  };
}

type StructuredVideoPromptItem = {
  scriptId: string;
  shotId: string;
  shotIndex: number;
  digitalHumanBaseImagePrompt: string;
  imagePrompt: string;
  videoPrompt: string;
};

const IMAGE_PROMPT_CONSISTENCY_RULE_SHOT_1 = "注意保持产品与参考图中的产品主体一致性";
const IMAGE_PROMPT_CONSISTENCY_RULE_SHOT_2_AND_3 =
  "注意保持产品与参考图中的产品主体一致性，注意保持画面场景与参考图中的画面场景一致性";

function appendLineIfMissing(baseText: string, line: string) {
  const normalizedBase = String(baseText || "").trim();
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return normalizedBase;
  }
  if (!normalizedBase) {
    return normalizedLine;
  }
  return normalizedBase.includes(normalizedLine) ? normalizedBase : `${normalizedBase}\n${normalizedLine}`;
}

function withImagePromptConsistencyRule(prompt: string, shotIndex: number) {
  const rule = shotIndex <= 0 ? IMAGE_PROMPT_CONSISTENCY_RULE_SHOT_1 : IMAGE_PROMPT_CONSISTENCY_RULE_SHOT_2_AND_3;
  return appendLineIfMissing(prompt, rule);
}

function findFirstJsonObjectBlockFromText(input: string) {
  const text = safeText(input);
  const start = text.indexOf("{");
  if (start < 0) {
    return "";
  }
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return "";
}

function parseJsonObjectLoose(input: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || input === null || input === undefined) {
    return null;
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== "string") {
    return null;
  }
  const text = String(input || "").trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed === "string") {
      return parseJsonObjectLoose(parsed, depth + 1);
    }
  } catch (_error) {
    // keep fallback parsing
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsedFenced = parseJsonObjectLoose(fenced[1], depth + 1);
    if (parsedFenced) {
      return parsedFenced;
    }
  }
  const block = findFirstJsonObjectBlockFromText(text);
  if (block && block !== text) {
    const parsedBlock = parseJsonObjectLoose(block, depth + 1);
    if (parsedBlock) {
      return parsedBlock;
    }
  }
  return null;
}

function extractTextFromMessageContent(input: unknown) {
  if (typeof input === "string") {
    return safeText(input);
  }
  if (!Array.isArray(input)) {
    return "";
  }
  return input
    .map((part) => {
      if (typeof part === "string") {
        return safeText(part);
      }
      if (part && typeof part === "object") {
        const source = part as Record<string, unknown>;
        return safeText(source.text);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractScriptsArrayFromUnknown(input: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 5) {
    return [];
  }
  const object = parseJsonObjectLoose(input, depth);
  if (!object) {
    return [];
  }
  if (Array.isArray(object.scripts)) {
    return object.scripts.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
  }
  const choices = Array.isArray(object.choices) ? object.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }
    const sourceChoice = choice as Record<string, unknown>;
    const message = sourceChoice.message;
    if (!message || typeof message !== "object") {
      continue;
    }
    const sourceMessage = message as Record<string, unknown>;
    const contentText = extractTextFromMessageContent(sourceMessage.content);
    if (!contentText) {
      continue;
    }
    const fromChoice = extractScriptsArrayFromUnknown(contentText, depth + 1);
    if (fromChoice.length) {
      return fromChoice;
    }
  }
  const nestedKeys = ["data", "output", "result", "payload", "raw", "response", "message", "content"];
  for (const key of nestedKeys) {
    const nested = extractScriptsArrayFromUnknown(object[key], depth + 1);
    if (nested.length) {
      return nested;
    }
  }
  return [];
}

type StructuredVideoPromptPackage = {
  scriptId: string;
  digitalHumanBaseImagePrompt: string;
  shots: Array<{
    shotId: string;
    imagePrompt: string;
    videoPrompt: string;
  }>;
};

function mapRawScriptsToStructuredPackages(rawScripts: Array<Record<string, unknown>>): StructuredVideoPromptPackage[] {
  return rawScripts.map((script, scriptIndex) => {
    const scriptId = safeText(script.script_id ?? script.scriptId) || `script_${String(scriptIndex + 1).padStart(2, "0")}`;
    const digitalHumanBaseImagePrompt = safeText(
      script.digital_human_base_image_prompt ?? script.digitalHumanBaseImagePrompt
    );
    const shotsSource = Array.isArray(script.shots) ? script.shots : [];
    const shots = shotsSource
      .map((shot, shotIndex) => {
        if (!shot || typeof shot !== "object") {
          return null;
        }
        const sourceShot = shot as Record<string, unknown>;
        return {
          shotId: safeText(sourceShot.shot_id ?? sourceShot.shotId) || `shot_${String(shotIndex + 1).padStart(2, "0")}`,
          imagePrompt: safeText(sourceShot.image_prompt ?? sourceShot.imagePrompt),
          videoPrompt: safeText(sourceShot.video_prompt ?? sourceShot.videoPrompt)
        };
      })
      .filter(Boolean) as StructuredVideoPromptPackage["shots"];
    return {
      scriptId,
      digitalHumanBaseImagePrompt,
      shots
    };
  });
}

function hasUsefulStructuredPackage(packages: StructuredVideoPromptPackage[]) {
  return packages.some(
    (entry) =>
      safeText(entry.digitalHumanBaseImagePrompt) ||
      entry.shots.some((shot) => safeText(shot.imagePrompt) || safeText(shot.videoPrompt))
  );
}

function extractStructuredVideoPromptItems(result: NonNullable<VideoScriptGenerationState["result"]>): StructuredVideoPromptItem[] {
  const fromPackages = Array.isArray(result.scriptPackages)
    ? result.scriptPackages.map((item, scriptIndex) => ({
        scriptId: safeText(item.scriptId) || `script_${String(scriptIndex + 1).padStart(2, "0")}`,
        digitalHumanBaseImagePrompt: safeText(item.digitalHumanBaseImagePrompt),
        shots: Array.isArray(item.shots)
          ? item.shots.map((shot, shotIndex) => ({
              shotId: safeText(shot.shotId) || `shot_${String(shotIndex + 1).padStart(2, "0")}`,
              imagePrompt: safeText(shot.imagePrompt),
              videoPrompt: safeText(shot.videoPrompt)
            }))
          : []
      }))
    : [];
  const fromOutputScripts = mapRawScriptsToStructuredPackages(
    Array.isArray(result.outputPayload?.scripts)
      ? (result.outputPayload.scripts as Array<Record<string, unknown>>)
      : []
  );
  const rawCandidates: unknown[] = [
    result.outputPayload?.raw,
    (result.outputPayload?.raw as Record<string, unknown> | null)?.response_text ?? null,
    (result.outputPayload?.raw as Record<string, unknown> | null)?.responseText ?? null,
    result.modelRequest?.requestBody
  ];
  const fromRaw = mapRawScriptsToStructuredPackages(
    rawCandidates
      .map((candidate) => extractScriptsArrayFromUnknown(candidate))
      .find((items) => items.length > 0) || []
  );
  const fallbackPackages = hasUsefulStructuredPackage(fromPackages)
    ? fromPackages
    : hasUsefulStructuredPackage(fromOutputScripts)
      ? fromOutputScripts
      : fromRaw;
  const rows: StructuredVideoPromptItem[] = [];
  fallbackPackages.forEach((script, scriptIndex) => {
    const scriptId = safeText(script.scriptId) || `script_${String(scriptIndex + 1).padStart(2, "0")}`;
    const digitalHumanBaseImagePrompt = safeText(script.digitalHumanBaseImagePrompt);
    const shots = Array.isArray(script.shots) ? script.shots : [];
    if (!shots.length) {
      rows.push({
        scriptId,
        shotId: "shot_01",
        shotIndex: 0,
        digitalHumanBaseImagePrompt,
        imagePrompt: "",
        videoPrompt: ""
      });
      return;
    }
    shots.forEach((shot, shotIndex) => {
      rows.push({
        scriptId,
        shotId: safeText(shot.shotId) || `shot_${String(shotIndex + 1).padStart(2, "0")}`,
        shotIndex,
        digitalHumanBaseImagePrompt,
        imagePrompt: withImagePromptConsistencyRule(safeText(shot.imagePrompt), shotIndex),
        videoPrompt: safeText(shot.videoPrompt)
      });
    });
  });
  return rows;
}

function buildVideoPromptDraftKey(recordId: string, setKey: string, clipIndex: number, field: string) {
  return `${recordId}::${setKey}::${clipIndex}::${field}`;
}

type ClipVideoGenerationStatus = "idle" | "queued" | "processing" | "succeeded" | "failed";

type ClipVideoGenerationState = {
  firstFrameDataUrl: string;
  firstFrameName: string;
  lastFrameDataUrl: string;
  lastFrameName: string;
  uploadedImageDataUrls: string[];
  uploadedImageNames: string[];
  status: ClipVideoGenerationStatus;
  taskId: string;
  videoUrl: string;
  error: string;
  updatedAt: string | null;
};

const DEFAULT_CLIP_VIDEO_GENERATION_STATE: ClipVideoGenerationState = {
  firstFrameDataUrl: "",
  firstFrameName: "",
  lastFrameDataUrl: "",
  lastFrameName: "",
  uploadedImageDataUrls: [],
  uploadedImageNames: [],
  status: "idle",
  taskId: "",
  videoUrl: "",
  error: "",
  updatedAt: null
};

function isSameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function getClipVideoStatusText(status: ClipVideoGenerationStatus) {
  if (status === "queued") {
    return "任务排队中";
  }
  if (status === "processing") {
    return "视频生成中";
  }
  if (status === "succeeded") {
    return "生成成功";
  }
  if (status === "failed") {
    return "生成失败";
  }
  return "未发起请求";
}

function buildClipVideoStateKey(recordId: string, setKey: string, clipIndex: number) {
  return `${recordId}::${setKey}::${clipIndex}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("文件读取结果为空。"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      reject(new Error("文件读取失败。"));
    };
    reader.readAsDataURL(file);
  });
}

async function copyText(value: string) {
  const text = safeText(value);
  if (!text) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      // fallback to textarea copy.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_error) {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

function ProductDetailsPanel(props: { item: ProductRecord | null }) {
  const { item } = props;
  if (!item) {
    return (
      <aside className="details-panel">
        <h3>商品详情</h3>
        <p className="details-empty">点击左侧商品卡片查看详情。</p>
      </aside>
    );
  }

  const priceText =
    item.priceMax !== null && item.priceMax !== item.priceMin
      ? `${toCurrency(item.priceMin)} - ${toCurrency(item.priceMax)}`
      : toCurrency(item.priceMin);
  const hasSourceLink = isHttpUrl(item.url);
  const sourceLinkLabel = item.source === "chrome-extension" ? "打开 1688 原始链接" : "打开商品链接";

  return (
    <aside className="details-panel">
      <h3>商品详情</h3>
      <div className="details-image-wrap">
        {item.triggeredImage ? (
          <img src={buildDisplayImageUrl(item.triggeredImage, item.url)} alt={item.title} />
        ) : (
          <div className="image-fallback">No Image</div>
        )}
      </div>

      <div className="details-title">{item.title}</div>

      <div className="details-row">
        <span>商品ID</span>
        <span>{item.productId}</span>
      </div>
      <div className="details-row">
        <span>店铺</span>
        <span>{item.shopName}</span>
      </div>
      <div className="details-row">
        <span>价格区间</span>
        <span>{priceText}</span>
      </div>
      <div className="details-row">
        <span>抓取时间</span>
        <span>{toDate(item.capturedAt)}</span>
      </div>

      <div className="details-block">
        <div className="details-subtitle">价格阶梯</div>
        {item.priceTiers.length ? (
          <ul className="details-list">
            {item.priceTiers.slice(0, 8).map((tier, index) => (
              <li key={`${item.recordId}_tier_${index}`}>
                {tier.quantityLabel}: {tier.unitPriceText || toCurrency(tier.unitPrice)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="details-muted">暂无价格阶梯</p>
        )}
      </div>

      <div className="details-block">
        <div className="details-subtitle">规格维度</div>
        {item.skuDimensions.length ? (
          <ul className="details-list">
            {item.skuDimensions.slice(0, 10).map((dimension, index) => (
              <li key={`${item.recordId}_dim_${index}`}>
                {dimension.name}: {dimension.options.slice(0, 8).join(", ") || "-"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="details-muted">暂无规格维度</p>
        )}
      </div>

      <div className="details-block">
        <div className="details-subtitle">SKU明细</div>
        {item.skuItems.length ? (
          <ul className="details-list">
            {item.skuItems.slice(0, 12).map((sku, index) => (
              <li key={`${item.recordId}_sku_${index}`}>
                {sku.attrs.join(" / ") || "N/A"} | 价格: {toCurrency(sku.price)} | 库存: {sku.stock ?? sku.stockText ?? "N/A"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="details-muted">暂无 SKU 明细</p>
        )}
      </div>

      <div className="details-block">
        <div className="details-subtitle">商品属性</div>
        {item.productAttributes?.length ? (
          <ul className="details-list">
            {item.productAttributes.slice(0, 20).map((attr, index) => (
              <li key={`${item.recordId}_attr_${index}`}>
                {attr.name}: {attr.value}
              </li>
            ))}
          </ul>
        ) : (
          <p className="details-muted">暂无商品属性</p>
        )}
      </div>

      <div className="details-block">
        <div className="details-subtitle">包装信息</div>
        {item.packageSpecs?.length ? (
          <ul className="details-list">
            {item.packageSpecs.slice(0, 20).map((line, index) => (
              <li key={`${item.recordId}_pkg_${index}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="details-muted">暂无包装信息</p>
        )}
      </div>

      {hasSourceLink ? (
        <a className="source-link" href={item.url} rel="noreferrer" target="_blank">
          {sourceLinkLabel}
        </a>
      ) : (
        <p className="details-muted">暂无可访问的商品链接</p>
      )}
    </aside>
  );
}

function AIResultsPage(props: {
  items: ProductRecord[];
  onAnalyze: (recordId: string) => Promise<void>;
  onGenerateSecondPrompt: (recordId: string) => Promise<void>;
  onGenerateVideoScript: GenerateVideoScriptHandler;
  onDebugVideoScript: GenerateVideoScriptHandler;
  videoProductInfoOverrides: Record<string, string>;
  promptPackLocaleOverrides: Record<string, PromptPackLocaleSettings>;
  videoScriptLocaleOverrides: Record<string, PromptPackLocaleSettings>;
  onChangeVideoProductInfo: (recordId: string, value: string) => void;
  onChangePromptPackLocale: (recordId: string, value: PromptPackLocaleSettings) => void;
  onChangeVideoScriptLocale: (recordId: string, value: PromptPackLocaleSettings) => void;
  onOpenProduct: (recordId: string) => void;
}) {
  const {
    items,
    onAnalyze,
    onGenerateSecondPrompt,
    onGenerateVideoScript,
    onDebugVideoScript,
    videoProductInfoOverrides,
    onChangeVideoProductInfo,
    promptPackLocaleOverrides,
    onChangePromptPackLocale,
    videoScriptLocaleOverrides,
    onChangeVideoScriptLocale,
    onOpenProduct
  } =
    props;
  const [modalRecordId, setModalRecordId] = useState<string | null>(null);
  const [copyTip, setCopyTip] = useState("");
  const [videoPromptDrafts, setVideoPromptDrafts] = useState<Record<string, string>>({});
  const [clipVideoStates, setClipVideoStates] = useState<Record<string, ClipVideoGenerationState>>({});
  const [debuggingRecordMap, setDebuggingRecordMap] = useState<Record<string, boolean>>({});
  const copyTipTimerRef = useRef<number | null>(null);

  const rows = items
    .map((item) => ({
      item,
      analysis: normalizeAnalysisState(item.analysis),
      videoScript: normalizeVideoScriptState(item.videoScriptGeneration),
      secondPrompt: normalizeSecondPromptState(item.secondPromptGeneration),
      videoClipGeneration: normalizeVideoClipGenerationState(item.videoClipGeneration)
    }))
    .filter(({ analysis }) => analysis.status !== "idle")
    .sort((a, b) => {
      const aTime = new Date(a.analysis.updatedAt || a.item.capturedAt || 0).getTime();
      const bTime = new Date(b.analysis.updatedAt || b.item.capturedAt || 0).getTime();
      return bTime - aTime;
    });

  useEffect(() => {
    if (modalRecordId && !rows.some((row) => row.item.recordId === modalRecordId)) {
      setModalRecordId(null);
    }
  }, [rows, modalRecordId]);

  useEffect(() => {
    if (!modalRecordId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModalRecordId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalRecordId]);

  useEffect(() => {
    return () => {
      if (copyTipTimerRef.current !== null) {
        window.clearTimeout(copyTipTimerRef.current);
      }
    };
  }, []);

  if (!rows.length) {
    return (
      <section className="ai-page-empty">
        <h2>暂无 AI 分析结果</h2>
        <p>先在商品库中点击“AI分析”，完成后会集中展示在这里。</p>
      </section>
    );
  }

  const modalRow = modalRecordId ? rows.find((row) => row.item.recordId === modalRecordId) ?? null : null;
  const modalItem = modalRow?.item ?? null;
  const modalAnalysis = modalRow?.analysis ?? null;
  const modalVideoScript = modalRow?.videoScript ?? null;
  const modalSecondPrompt = modalRow?.secondPrompt ?? null;
  const modalVideoClipGeneration = modalRow?.videoClipGeneration ?? DEFAULT_VIDEO_CLIP_GENERATION_STATE;
  const modalResult = modalAnalysis?.result ?? null;
  const modalAnalyzing = modalAnalysis ? modalAnalysis.status === "queued" || modalAnalysis.status === "processing" : false;
  const modalVideoGenerating = modalVideoScript ? modalVideoScript.status === "processing" : false;
  const modalPromptGenerating = modalSecondPrompt ? modalSecondPrompt.status === "processing" : false;
  const modalSecondPromptResult = modalSecondPrompt?.result ?? null;
  const modalRunningClipTasks = modalVideoClipGeneration.items.filter((entry) => entry.status === "queued" || entry.status === "processing").length;
  const modalFailedClipTasks = modalVideoClipGeneration.items.filter((entry) => entry.status === "failed").length;
  const modalSucceededClipTasks = modalVideoClipGeneration.items.filter((entry) => entry.status === "succeeded").length;
  const modalVideoProductInfoFallback = useMemo(() => {
    if (!modalItem) {
      return "";
    }
    return buildFallbackVideoProductInfoText(modalItem, modalResult);
  }, [modalItem, modalResult]);
  const modalVideoProductInfoText = useMemo(() => {
    if (!modalItem) {
      return "";
    }
    if (Object.prototype.hasOwnProperty.call(videoProductInfoOverrides, modalItem.recordId)) {
      return videoProductInfoOverrides[modalItem.recordId] || "";
    }
    return modalVideoProductInfoFallback;
  }, [modalItem, modalVideoProductInfoFallback, videoProductInfoOverrides]);
  const modalVideoProductInfoFieldFallback = useMemo(() => {
    if (!modalItem) {
      return createEmptyProductInfoFields();
    }
    return buildFallbackVideoProductInfoFields(modalItem, modalResult);
  }, [modalItem, modalResult]);
  const modalVideoProductInfoFields = useMemo(
    () => parseVideoProductInfoTextToFields(modalVideoProductInfoText, modalVideoProductInfoFieldFallback),
    [modalVideoProductInfoFieldFallback, modalVideoProductInfoText]
  );
  const modalVideoProductInfoComposedText = useMemo(
    () => buildVideoProductInfoTextFromFields(modalVideoProductInfoFields),
    [modalVideoProductInfoFields]
  );
  const modalPromptPackLocaleFallback = useMemo(
    () => normalizePromptPackLocaleSettings(parseSecondPromptLocaleSettings(modalSecondPrompt?.result ?? null)),
    [modalSecondPrompt]
  );
  const modalPromptPackLocale = useMemo(() => {
    if (!modalItem) {
      return modalPromptPackLocaleFallback;
    }
    if (Object.prototype.hasOwnProperty.call(promptPackLocaleOverrides, modalItem.recordId)) {
      return normalizePromptPackLocaleSettings(promptPackLocaleOverrides[modalItem.recordId]);
    }
    return modalPromptPackLocaleFallback;
  }, [modalItem, modalPromptPackLocaleFallback, promptPackLocaleOverrides]);
  const modalTargetMarketIsPreset = useMemo(
    () => PROMPT_PACK_TARGET_MARKET_SUGGESTIONS.includes(modalPromptPackLocale.targetMarket),
    [modalPromptPackLocale.targetMarket]
  );
  const modalTargetMarketSelectValue = modalTargetMarketIsPreset ? modalPromptPackLocale.targetMarket : PROMPT_PACK_CUSTOM_OPTION;
  const modalTextLanguageIsPreset = useMemo(
    () => PROMPT_PACK_TEXT_LANGUAGE_SUGGESTIONS.includes(modalPromptPackLocale.inImageTextLanguage),
    [modalPromptPackLocale.inImageTextLanguage]
  );
  const modalTextLanguageSelectValue = modalTextLanguageIsPreset
    ? modalPromptPackLocale.inImageTextLanguage
    : PROMPT_PACK_CUSTOM_OPTION;
  const modalVideoScriptLocaleFallback = useMemo(
    () =>
      normalizePromptPackLocaleSettings(
        parseVideoScriptLocaleSettings(modalVideoScript?.result ?? null) || parseSecondPromptLocaleSettings(modalSecondPrompt?.result ?? null)
      ),
    [modalSecondPrompt, modalVideoScript]
  );
  const modalVideoScriptLocale = useMemo(() => {
    if (!modalItem) {
      return modalVideoScriptLocaleFallback;
    }
    if (Object.prototype.hasOwnProperty.call(videoScriptLocaleOverrides, modalItem.recordId)) {
      return normalizePromptPackLocaleSettings(videoScriptLocaleOverrides[modalItem.recordId]);
    }
    return modalVideoScriptLocaleFallback;
  }, [modalItem, modalVideoScriptLocaleFallback, videoScriptLocaleOverrides]);
  const modalVideoTargetMarketIsPreset = useMemo(
    () => PROMPT_PACK_TARGET_MARKET_SUGGESTIONS.includes(modalVideoScriptLocale.targetMarket),
    [modalVideoScriptLocale.targetMarket]
  );
  const modalVideoTargetMarketSelectValue = modalVideoTargetMarketIsPreset
    ? modalVideoScriptLocale.targetMarket
    : PROMPT_PACK_CUSTOM_OPTION;
  const modalVideoTextLanguageIsPreset = useMemo(
    () => PROMPT_PACK_TEXT_LANGUAGE_SUGGESTIONS.includes(modalVideoScriptLocale.inImageTextLanguage),
    [modalVideoScriptLocale.inImageTextLanguage]
  );
  const modalVideoTextLanguageSelectValue = modalVideoTextLanguageIsPreset
    ? modalVideoScriptLocale.inImageTextLanguage
    : PROMPT_PACK_CUSTOM_OPTION;
  const modalVideoScriptRawText = useMemo(
    () => buildVideoScriptRawDebugText(modalVideoScript?.result ?? null),
    [modalVideoScript]
  );
  const modalStructuredVideoPromptItems = useMemo(
    () => (modalVideoScript?.result ? extractStructuredVideoPromptItems(modalVideoScript.result) : []),
    [modalVideoScript]
  );
  const modalPromptProductProfile = useMemo(
    () =>
      modalSecondPromptResult
        ? parseSecondPromptProductProfile(modalSecondPromptResult, modalResult)
        : buildFallbackPromptPackProductProfileFromAnalysis(modalResult),
    [modalSecondPromptResult, modalResult]
  );
  const modalPromptSections = useMemo(
    () => (modalSecondPromptResult ? splitSecondPromptSections(modalSecondPromptResult) : null),
    [modalSecondPromptResult]
  );
  const modalVideoDebugging = modalItem ? Boolean(debuggingRecordMap[modalItem.recordId]) : false;

  const showCopyTip = useCallback((text: string) => {
    setCopyTip(text);
    if (copyTipTimerRef.current !== null) {
      window.clearTimeout(copyTipTimerRef.current);
    }
    copyTipTimerRef.current = window.setTimeout(() => {
      setCopyTip("");
      copyTipTimerRef.current = null;
    }, 2800);
  }, []);

  const handleCopyAndMaybeOpenPrompt = useCallback(
    async (text: string, openPlatform: boolean) => {
      const ok = await copyText(text);
      if (openPlatform) {
        const opened = window.open(GENSPARK_IMAGE_URL, "_blank", "noopener,noreferrer");
        if (!opened) {
          showCopyTip("浏览器拦截了新窗口，请允许弹窗后重试。");
          return;
        }
      }
      if (ok) {
        showCopyTip(openPlatform ? "已复制并跳转生图页，可直接粘贴使用。" : "提示词已复制，可直接粘贴使用。");
      } else {
        showCopyTip("自动复制失败，请手动复制文本框内容。");
      }
    },
    [showCopyTip]
  );

  const handleCopyPromptSection = useCallback(
    async (text: string, openPlatform: boolean) => {
      await handleCopyAndMaybeOpenPrompt(text, openPlatform);
    },
    [handleCopyAndMaybeOpenPrompt]
  );

  const getVideoPromptValue = useCallback(
    (recordId: string, setKey: string, clipIndex: number, field: string, fallback: string) => {
      const key = buildVideoPromptDraftKey(recordId, setKey, clipIndex, field);
      const cached = videoPromptDrafts[key];
      return typeof cached === "string" ? cached : fallback;
    },
    [videoPromptDrafts]
  );

  const handleVideoPromptChange = useCallback((recordId: string, setKey: string, clipIndex: number, field: string, value: string) => {
    const key = buildVideoPromptDraftKey(recordId, setKey, clipIndex, field);
    setVideoPromptDrafts((prev) => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const getPersistedClipTask = useCallback(
    (recordId: string, setKey: string, clipIndex: number) => {
      const row = rows.find((entry) => entry.item.recordId === recordId);
      if (!row) {
        return null;
      }
      const key = buildClipVideoStateKey(recordId, setKey, clipIndex);
      return row.videoClipGeneration.items.find((item) => item.key === key) || null;
    },
    [rows]
  );

  useEffect(() => {
    setClipVideoStates((prev) => {
      const next = { ...prev };
      let changed = false;
      rows.forEach((row) => {
        row.videoClipGeneration.items.forEach((task) => {
          const key = buildClipVideoStateKey(row.item.recordId, task.setKey, task.clipIndex);
          const hasLocalState = Object.prototype.hasOwnProperty.call(next, key);
          const current = (hasLocalState ? next[key] : null) ?? DEFAULT_CLIP_VIDEO_GENERATION_STATE;
          const persistedUploadedImageDataUrls = task.clipIndex === 1 && task.firstFrameUrl ? [task.firstFrameUrl] : [];
          const persistedUploadedImageNames = task.clipIndex === 1 && task.firstFrameName ? [task.firstFrameName] : [];
          const merged: ClipVideoGenerationState = {
            ...current,
            status: task.status,
            taskId: task.taskId || "",
            videoUrl: task.videoUrl || "",
            error: task.error || "",
            firstFrameName: hasLocalState ? current.firstFrameName : task.firstFrameName || "",
            lastFrameName: hasLocalState ? current.lastFrameName : task.lastFrameName || "",
            firstFrameDataUrl: hasLocalState ? current.firstFrameDataUrl : task.firstFrameUrl || "",
            lastFrameDataUrl: hasLocalState ? current.lastFrameDataUrl : task.lastFrameUrl || "",
            uploadedImageDataUrls: hasLocalState ? current.uploadedImageDataUrls : persistedUploadedImageDataUrls,
            uploadedImageNames: hasLocalState ? current.uploadedImageNames : persistedUploadedImageNames,
            updatedAt: task.updatedAt || current.updatedAt
          };
          const same =
            current.status === merged.status &&
            current.taskId === merged.taskId &&
            current.videoUrl === merged.videoUrl &&
            current.error === merged.error &&
            current.firstFrameName === merged.firstFrameName &&
            current.lastFrameName === merged.lastFrameName &&
            current.firstFrameDataUrl === merged.firstFrameDataUrl &&
            current.lastFrameDataUrl === merged.lastFrameDataUrl &&
            isSameStringArray(current.uploadedImageDataUrls, merged.uploadedImageDataUrls) &&
            isSameStringArray(current.uploadedImageNames, merged.uploadedImageNames) &&
            current.updatedAt === merged.updatedAt;
          if (!same) {
            next[key] = merged;
            changed = true;
          }
        });
      });
      return changed ? next : prev;
    });
  }, [rows]);

  const getClipVideoState = useCallback(
    (recordId: string, setKey: string, clipIndex: number) => {
      const key = buildClipVideoStateKey(recordId, setKey, clipIndex);
      const localState = clipVideoStates[key];
      const persistedTask = getPersistedClipTask(recordId, setKey, clipIndex);
      const persistedState: ClipVideoGenerationState | null = persistedTask
        ? {
            firstFrameDataUrl: persistedTask.firstFrameUrl || "",
            firstFrameName: persistedTask.firstFrameName || "",
            lastFrameDataUrl: persistedTask.lastFrameUrl || "",
            lastFrameName: persistedTask.lastFrameName || "",
            uploadedImageDataUrls: persistedTask.clipIndex === 1 && persistedTask.firstFrameUrl ? [persistedTask.firstFrameUrl] : [],
            uploadedImageNames: persistedTask.clipIndex === 1 && persistedTask.firstFrameName ? [persistedTask.firstFrameName] : [],
            status: persistedTask.status,
            taskId: persistedTask.taskId || "",
            videoUrl: persistedTask.videoUrl || "",
            error: persistedTask.error || "",
            updatedAt: persistedTask.updatedAt || null
          }
        : null;
      return {
        ...DEFAULT_CLIP_VIDEO_GENERATION_STATE,
        ...(persistedState || {}),
        ...(localState || {})
      };
    },
    [clipVideoStates, getPersistedClipTask]
  );

  const patchClipVideoState = useCallback(
    (recordId: string, setKey: string, clipIndex: number, patch: Partial<ClipVideoGenerationState>) => {
      const key = buildClipVideoStateKey(recordId, setKey, clipIndex);
      setClipVideoStates((prev) => {
        const base = prev[key] ?? DEFAULT_CLIP_VIDEO_GENERATION_STATE;
        return {
          ...prev,
          [key]: {
            ...base,
            ...patch,
            updatedAt: new Date().toISOString()
          }
        };
      });
    },
    []
  );

  const handleClipFrameFileChange = useCallback(
    async (recordId: string, setKey: string, clipIndex: number, frame: "first" | "last", file: File | null) => {
      if (!file) {
        if (frame === "first") {
          patchClipVideoState(recordId, setKey, clipIndex, {
            firstFrameDataUrl: "",
            firstFrameName: "",
            error: ""
          });
        } else {
          patchClipVideoState(recordId, setKey, clipIndex, {
            lastFrameDataUrl: "",
            lastFrameName: "",
            error: ""
          });
        }
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (frame === "first") {
          patchClipVideoState(recordId, setKey, clipIndex, {
            firstFrameDataUrl: dataUrl,
            firstFrameName: file.name,
            error: ""
          });
        } else {
          patchClipVideoState(recordId, setKey, clipIndex, {
            lastFrameDataUrl: dataUrl,
            lastFrameName: file.name,
            error: ""
          });
        }
      } catch (error) {
        patchClipVideoState(recordId, setKey, clipIndex, {
          status: "failed",
          error: error instanceof Error ? error.message : "图片读取失败，请重试。"
        });
      }
    },
    [patchClipVideoState]
  );

  const handleClipReferenceImagesChange = useCallback(
    async (recordId: string, setKey: string, clipIndex: number, files: FileList | null) => {
      if (!files || files.length < 1) {
        patchClipVideoState(recordId, setKey, clipIndex, {
          uploadedImageDataUrls: [],
          uploadedImageNames: [],
          error: ""
        });
        return;
      }
      const selectedFiles = Array.from(files).slice(0, 8);
      try {
        const dataUrls = await Promise.all(selectedFiles.map((file) => readFileAsDataUrl(file)));
        patchClipVideoState(recordId, setKey, clipIndex, {
          uploadedImageDataUrls: dataUrls,
          uploadedImageNames: selectedFiles.map((file) => file.name),
          error: ""
        });
      } catch (error) {
        patchClipVideoState(recordId, setKey, clipIndex, {
          status: "failed",
          error: error instanceof Error ? error.message : "图片读取失败，请重试。"
        });
      }
    },
    [patchClipVideoState]
  );

  const handleGenerateClipVideo = useCallback(
    async (
      recordId: string,
      setKey: string,
      clipIndex: number,
      prompt: string,
      firstFrameDataUrl: string,
      lastFrameDataUrl: string,
      uploadedImageDataUrls: string[] = []
    ) => {
      const normalizedPrompt = safeText(prompt);
      if (!normalizedPrompt) {
        patchClipVideoState(recordId, setKey, clipIndex, {
          status: "failed",
          error: "分镜信息为空，无法发起视频生成。"
        });
        return;
      }

      patchClipVideoState(recordId, setKey, clipIndex, {
        status: "queued",
        error: "",
        videoUrl: "",
        taskId: ""
      });

      let json: GenerateClipVideoResponse | null = null;
      try {
        const normalizedFirstFrameUrl = safeText(firstFrameDataUrl);
        const normalizedLastFrameUrl = safeText(lastFrameDataUrl);
        const normalizedUploadedUrls = Array.from(new Set(uploadedImageDataUrls.map((item) => safeText(item)).filter(Boolean))).slice(0, 8);
        let requestFirstFrameUrl = normalizedFirstFrameUrl;
        let requestLastFrameUrl = normalizedLastFrameUrl;
        let requestUrls: string[] = [];
        if (clipIndex === 0) {
          requestLastFrameUrl = "";
          requestUrls = [];
        } else if (clipIndex === 1) {
          requestFirstFrameUrl = "";
          requestLastFrameUrl = "";
          requestUrls = normalizedUploadedUrls.length > 0 ? normalizedUploadedUrls : normalizedFirstFrameUrl ? [normalizedFirstFrameUrl] : [];
        }
        const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/video-clips/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            setKey,
            clipIndex,
            prompt: normalizedPrompt,
            firstFrameUrl: requestFirstFrameUrl,
            lastFrameUrl: requestLastFrameUrl,
            urls: requestUrls,
            firstFrameName: getClipVideoState(recordId, setKey, clipIndex).firstFrameName,
            lastFrameName: getClipVideoState(recordId, setKey, clipIndex).lastFrameName,
            aspectRatio: "9:16",
            pollIntervalMs: 5000,
            pollTimeoutMs: 600000,
            createTimeoutMs: 60000,
            resultTimeoutMs: 30000
          })
        });
        try {
          json = (await response.json()) as GenerateClipVideoResponse;
        } catch (_error) {
          json = null;
        }
        if (!response.ok || !json?.ok) {
          const detail = safeText(json?.message) || `请求失败: ${response.status}`;
          patchClipVideoState(recordId, setKey, clipIndex, {
            status: "failed",
            error: detail,
            taskId: safeText(json?.task?.taskId || "")
          });
          return;
        }
        patchClipVideoState(recordId, setKey, clipIndex, {
          status: json.task?.status === "processing" ? "processing" : "queued",
          error: "",
          taskId: safeText(json.task?.taskId || "")
        });
      } catch (error) {
        patchClipVideoState(recordId, setKey, clipIndex, {
          status: "failed",
          error: error instanceof Error ? error.message : "视频生成请求失败，请稍后重试。",
          taskId: safeText(json?.task?.taskId || "")
        });
      }
    },
    [getClipVideoState, patchClipVideoState]
  );

  const handleGenerateSetVideos = useCallback(
    async (
      recordId: string,
      setKey: string,
      clips: Array<{
        sceneDescription: string;
        marketingPurpose: string;
        videoAudioPrompt: string;
      }>
    ) => {
      const jobs = clips
        .map((clip, clipIndex) => {
          const promptField = clipIndex === 1 ? "segment_b_prompt" : "segment_a_prompt";
          const fallbackPrompt =
            clipIndex === 1 ? safeText(clip.marketingPurpose) : safeText(clip.sceneDescription) || buildVideoClipInfoBundle(clip.sceneDescription, clip.marketingPurpose, clip.videoAudioPrompt);
          const prompt = getVideoPromptValue(recordId, setKey, -1, promptField, fallbackPrompt);
          const state = getClipVideoState(recordId, setKey, clipIndex);
          if (!safeText(prompt)) {
            return null;
          }
          return handleGenerateClipVideo(
            recordId,
            setKey,
            clipIndex,
            prompt,
            state.firstFrameDataUrl,
            state.lastFrameDataUrl,
            state.uploadedImageDataUrls
          );
        })
        .filter(Boolean) as Array<Promise<void>>;
      if (!jobs.length) {
        return;
      }
      await Promise.allSettled(jobs);
    },
    [getClipVideoState, getVideoPromptValue, handleGenerateClipVideo]
  );

  const handleCopyVideoPrompt = useCallback(
    async (text: string, openPlatform: boolean) => {
      await handleCopyAndMaybeOpenPrompt(text, openPlatform);
    },
    [handleCopyAndMaybeOpenPrompt]
  );

  const handleOpenGensparkWindow = useCallback(() => {
    const opened = window.open(GENSPARK_IMAGE_URL, "_blank", "noopener,noreferrer");
    if (!opened) {
      showCopyTip("浏览器拦截了新窗口，请允许弹窗后重试。");
    }
  }, [showCopyTip]);

  const handleManualDebugVideoScript = useCallback(
    async (recordId: string, options?: GenerateVideoScriptOptions) => {
      setDebuggingRecordMap((current) => ({
        ...current,
        [recordId]: true
      }));
      try {
        await onDebugVideoScript(recordId, options);
      } finally {
        setDebuggingRecordMap((current) => {
          const next = { ...current };
          delete next[recordId];
          return next;
        });
      }
    },
    [onDebugVideoScript]
  );

  return (
    <>
      <section className="ai-page-grid">
        {rows.map(({ item, analysis, videoScript, secondPrompt, videoClipGeneration }) => {
          const result = analysis.result;
          const analyzing = analysis.status === "queued" || analysis.status === "processing";
          const videoGenerating = videoScript.status === "processing";
          const promptGenerating = secondPrompt.status === "processing";
          const runningClipTasks = videoClipGeneration.items.filter((entry) => entry.status === "queued" || entry.status === "processing").length;
          const failedClipTasks = videoClipGeneration.items.filter((entry) => entry.status === "failed").length;
          const succeededClipTasks = videoClipGeneration.items.filter((entry) => entry.status === "succeeded").length;
          const canRunSecondPrompt = analysis.status === "completed";
          const canRunVideoScript = analysis.status === "completed" && secondPrompt.status === "completed";
          const secondPromptReady = secondPrompt.status === "completed" && secondPrompt.result;
          return (
            <article
              className={`ai-page-card compact-card ${modalRecordId === item.recordId ? "opened" : ""}`}
              key={item.recordId}
              onClick={() => setModalRecordId(item.recordId)}
            >
              <div className="ai-page-head">
                {item.triggeredImage ? (
                  <img src={buildDisplayImageUrl(item.triggeredImage, item.url)} alt={item.title} />
                ) : (
                  <div className="image-fallback">No Image</div>
                )}
                <div>
                  <div className="ai-page-title">{item.title}</div>
                  <div className="ai-page-meta">店铺: {item.shopName}</div>
                  <div className={`analysis-chip status-${analysis.status}`}>AI: {analysisStatusLabel(analysis.status)}</div>
                  {VIDEO_SCRIPT_AGENT_ENABLED ? (
                    <div className={`prompt-chip status-${videoScript.status}`}>短视频: {videoScriptStatusLabel(videoScript.status)}</div>
                  ) : null}
                  <div className={`prompt-chip status-${runningClipTasks ? "processing" : failedClipTasks ? "failed" : succeededClipTasks ? "completed" : "idle"}`}>
                    分镜视频: {runningClipTasks ? `后台执行中 ${runningClipTasks}` : failedClipTasks ? `失败 ${failedClipTasks}` : succeededClipTasks ? `完成 ${succeededClipTasks}` : "未开始"}
                  </div>
                  <div className={`prompt-chip status-${secondPrompt.status}`}>图词: {secondPromptStatusLabel(secondPrompt.status)}</div>
                  <div className="analysis-time">更新时间: {toDate(analysis.updatedAt)}</div>
                </div>
              </div>

              {analysis.status === "failed" ? <div className="analysis-error">分析失败: {analysis.error || "未知错误"}</div> : null}
              {VIDEO_SCRIPT_AGENT_ENABLED && videoScript.status === "failed" ? (
                <div className="analysis-error">短视频提示词失败: {videoScript.error || "未知错误"}</div>
              ) : null}
              {secondPrompt.status === "failed" ? <div className="analysis-error">图词请求失败: {secondPrompt.error || "未知错误"}</div> : null}
              {analysis.status === "completed" && result ? (
                <div className="ai-page-snippet compact-snippet">
                  <div>
                    <strong>材质:</strong> {result.materialAnalysis || "无"}
                  </div>
                  <div>
                    <strong>外观:</strong> {result.appearanceDescription || "无"}
                  </div>
                  <div>
                    <strong>详情描述:</strong> {result.detailedDescription || "无"}
                  </div>
                </div>
              ) : null}
              {secondPromptReady ? (
                <div className="ai-page-snippet compact-snippet">
                  <div>
                    <strong>图词输出:</strong> 已生成 9 张主图 + 5 张详情页提示词
                  </div>
                  <div>
                    <strong>模板版本:</strong> {secondPrompt.result?.templateVersion || "v2.1"}
                  </div>
                </div>
              ) : null}

              <div className="ai-page-actions">
                <button
                  className="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setModalRecordId(item.recordId);
                  }}
                  type="button"
                >
                  查看详情
                </button>
                <button
                  className="primary-btn"
                  disabled={analyzing}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onAnalyze(item.recordId);
                  }}
                  type="button"
                >
                  {analyzing ? "分析中..." : analysis.status === "completed" ? "重新分析" : "开始分析"}
                </button>
                {VIDEO_SCRIPT_AGENT_ENABLED ? (
                  <button
                    className="ghost"
                    disabled={!canRunVideoScript || videoGenerating}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onGenerateVideoScript(item.recordId);
                    }}
                    type="button"
                  >
                    {!canRunVideoScript
                      ? analysis.status !== "completed"
                        ? "先完成分析"
                        : "先完成图词"
                      : videoGenerating
                        ? "短视频生成中..."
                        : videoScript.status === "completed"
                          ? "重跑短视频提示词"
                          : "短视频提示词"}
                  </button>
                ) : null}
                <button
                  className="ghost"
                  disabled={!canRunSecondPrompt || promptGenerating}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onGenerateSecondPrompt(item.recordId);
                  }}
                  type="button"
                >
                  {!canRunSecondPrompt ? "先完成分析" : promptGenerating ? "图词生成中..." : secondPrompt.status === "completed" ? "重跑图词请求" : "图词请求"}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {modalItem && modalAnalysis ? (
        <div className="ai-modal-backdrop" onClick={() => setModalRecordId(null)}>
          <section aria-modal="true" className="ai-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="ai-modal-header">
              <div className="ai-inspector-head">
                {modalItem.triggeredImage ? (
                  <img src={buildDisplayImageUrl(modalItem.triggeredImage, modalItem.url)} alt={modalItem.title} />
                ) : (
                  <div className="image-fallback">No Image</div>
                )}
                <div>
                  <div className="ai-page-title">{modalItem.title}</div>
                  <div className="ai-page-meta">店铺: {modalItem.shopName}</div>
                  <div className={`analysis-chip status-${modalAnalysis.status}`}>AI: {analysisStatusLabel(modalAnalysis.status)}</div>
                  {VIDEO_SCRIPT_AGENT_ENABLED && modalVideoScript ? (
                    <div className={`prompt-chip status-${modalVideoScript.status}`}>短视频: {videoScriptStatusLabel(modalVideoScript.status)}</div>
                  ) : null}
                  <div
                    className={`prompt-chip status-${modalRunningClipTasks ? "processing" : modalFailedClipTasks ? "failed" : modalSucceededClipTasks ? "completed" : "idle"}`}
                  >
                    分镜视频: {modalRunningClipTasks ? `后台执行中 ${modalRunningClipTasks}` : modalFailedClipTasks ? `失败 ${modalFailedClipTasks}` : modalSucceededClipTasks ? `完成 ${modalSucceededClipTasks}` : "未开始"}
                  </div>
                  {modalSecondPrompt ? (
                    <div className={`prompt-chip status-${modalSecondPrompt.status}`}>图词: {secondPromptStatusLabel(modalSecondPrompt.status)}</div>
                  ) : null}
                  <div className="analysis-time">更新时间: {toDate(modalAnalysis.updatedAt)}</div>
                </div>
              </div>
              <button className="ghost close-btn" onClick={() => setModalRecordId(null)} type="button">
                关闭
              </button>
            </div>

            <div className="ai-modal-body">
              {modalAnalysis.status === "failed" ? <div className="analysis-error">分析失败: {modalAnalysis.error || "未知错误"}</div> : null}
              {modalAnalyzing ? <div className="analysis-loading">AI 正在分析，请稍候...</div> : null}
              {VIDEO_SCRIPT_AGENT_ENABLED && modalVideoScript?.status === "failed" ? (
                <div className="analysis-error">短视频提示词失败: {modalVideoScript.error || "未知错误"}</div>
              ) : null}
              {VIDEO_SCRIPT_AGENT_ENABLED && modalVideoScript?.status === "failed" ? (
                <div className="prompt-card-actions">
                  <button
                    className="ghost"
                    disabled={modalVideoDebugging}
                    onClick={() =>
                      void handleManualDebugVideoScript(modalItem.recordId, { productInfoText: modalVideoProductInfoComposedText })
                    }
                    type="button"
                  >
                    {modalVideoDebugging ? "调试请求中..." : "手动调试并抓取原始响应"}
                  </button>
                </div>
              ) : null}
              {VIDEO_SCRIPT_AGENT_ENABLED && modalVideoGenerating ? <div className="analysis-loading">短视频提示词生成中，请稍候...</div> : null}
              {modalRunningClipTasks > 0 ? (
                <div className="analysis-loading">分镜视频后台执行中（{modalRunningClipTasks} 个任务），关闭页面不会中断。</div>
              ) : null}
              {modalSecondPrompt?.status === "failed" ? (
                <div className="analysis-error">图词请求失败: {modalSecondPrompt.error || "未知错误"}</div>
              ) : null}
              {modalPromptGenerating ? <div className="analysis-loading">图词请求生成中，请稍候...</div> : null}
              {modalAnalysis.status === "completed" && modalItem ? (
                <div className="prompt-result-panel prompt-locale-panel">
                  <div className="prompt-result-head">
                    <strong>图词请求目标市场与语言</strong>
                    <span>支持下拉预设 + 自定义输入；后端会严格按此生成对应市场风格与语言约束</span>
                  </div>
                  <div className="prompt-locale-grid">
                    <label className="prompt-locale-field">
                      <span>目标市场（target_market）</span>
                      <select
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === PROMPT_PACK_CUSTOM_OPTION) {
                            const customValue = modalTargetMarketIsPreset ? "" : modalPromptPackLocale.targetMarket;
                            onChangePromptPackLocale(modalItem.recordId, {
                              ...modalPromptPackLocale,
                              targetMarket: customValue
                            });
                            return;
                          }
                          onChangePromptPackLocale(modalItem.recordId, {
                            ...modalPromptPackLocale,
                            targetMarket: nextValue
                          });
                        }}
                        value={modalTargetMarketSelectValue}
                      >
                        {PROMPT_PACK_TARGET_MARKET_SUGGESTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={PROMPT_PACK_CUSTOM_OPTION}>自定义输入</option>
                      </select>
                      {!modalTargetMarketIsPreset ? (
                        <input
                          className="prompt-locale-custom-input"
                          onChange={(event) =>
                            onChangePromptPackLocale(modalItem.recordId, {
                              ...modalPromptPackLocale,
                              targetMarket: event.target.value
                            })
                          }
                          placeholder="输入任意目标市场，例如：Nordics / LATAM"
                          type="text"
                          value={modalPromptPackLocale.targetMarket}
                        />
                      ) : null}
                    </label>
                    <label className="prompt-locale-field">
                      <span>目标语言（in_image_text_language）</span>
                      <select
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === PROMPT_PACK_CUSTOM_OPTION) {
                            const customValue = modalTextLanguageIsPreset ? "" : modalPromptPackLocale.inImageTextLanguage;
                            onChangePromptPackLocale(modalItem.recordId, {
                              ...modalPromptPackLocale,
                              inImageTextLanguage: customValue
                            });
                            return;
                          }
                          onChangePromptPackLocale(modalItem.recordId, {
                            ...modalPromptPackLocale,
                            inImageTextLanguage: nextValue
                          });
                        }}
                        value={modalTextLanguageSelectValue}
                      >
                        {PROMPT_PACK_TEXT_LANGUAGE_SUGGESTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={PROMPT_PACK_CUSTOM_OPTION}>自定义输入</option>
                      </select>
                      {!modalTextLanguageIsPreset ? (
                        <input
                          className="prompt-locale-custom-input"
                          onChange={(event) =>
                            onChangePromptPackLocale(modalItem.recordId, {
                              ...modalPromptPackLocale,
                              inImageTextLanguage: event.target.value
                            })
                          }
                          placeholder="输入任意语言，例如：Portuguese (Portugal)"
                          type="text"
                          value={modalPromptPackLocale.inImageTextLanguage}
                        />
                      ) : null}
                    </label>
                  </div>
                </div>
              ) : null}
              {VIDEO_SCRIPT_AGENT_ENABLED && modalAnalysis.status === "completed" && modalItem ? (
                <div className="prompt-result-panel prompt-locale-panel">
                  <div className="prompt-result-head">
                    <strong>短视频提示词目标市场与语言</strong>
                    <span>独立于图词请求配置；支持下拉预设 + 自定义输入</span>
                  </div>
                  <div className="prompt-locale-grid">
                    <label className="prompt-locale-field">
                      <span>目标市场（target_market）</span>
                      <select
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === PROMPT_PACK_CUSTOM_OPTION) {
                            const customValue = modalVideoTargetMarketIsPreset ? "" : modalVideoScriptLocale.targetMarket;
                            onChangeVideoScriptLocale(modalItem.recordId, {
                              ...modalVideoScriptLocale,
                              targetMarket: customValue
                            });
                            return;
                          }
                          onChangeVideoScriptLocale(modalItem.recordId, {
                            ...modalVideoScriptLocale,
                            targetMarket: nextValue
                          });
                        }}
                        value={modalVideoTargetMarketSelectValue}
                      >
                        {PROMPT_PACK_TARGET_MARKET_SUGGESTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={PROMPT_PACK_CUSTOM_OPTION}>自定义输入</option>
                      </select>
                      {!modalVideoTargetMarketIsPreset ? (
                        <input
                          className="prompt-locale-custom-input"
                          onChange={(event) =>
                            onChangeVideoScriptLocale(modalItem.recordId, {
                              ...modalVideoScriptLocale,
                              targetMarket: event.target.value
                            })
                          }
                          placeholder="输入任意目标市场，例如：United States / Japan"
                          type="text"
                          value={modalVideoScriptLocale.targetMarket}
                        />
                      ) : null}
                    </label>
                    <label className="prompt-locale-field">
                      <span>目标语言（in_image_text_language）</span>
                      <select
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === PROMPT_PACK_CUSTOM_OPTION) {
                            const customValue = modalVideoTextLanguageIsPreset ? "" : modalVideoScriptLocale.inImageTextLanguage;
                            onChangeVideoScriptLocale(modalItem.recordId, {
                              ...modalVideoScriptLocale,
                              inImageTextLanguage: customValue
                            });
                            return;
                          }
                          onChangeVideoScriptLocale(modalItem.recordId, {
                            ...modalVideoScriptLocale,
                            inImageTextLanguage: nextValue
                          });
                        }}
                        value={modalVideoTextLanguageSelectValue}
                      >
                        {PROMPT_PACK_TEXT_LANGUAGE_SUGGESTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={PROMPT_PACK_CUSTOM_OPTION}>自定义输入</option>
                      </select>
                      {!modalVideoTextLanguageIsPreset ? (
                        <input
                          className="prompt-locale-custom-input"
                          onChange={(event) =>
                            onChangeVideoScriptLocale(modalItem.recordId, {
                              ...modalVideoScriptLocale,
                              inImageTextLanguage: event.target.value
                            })
                          }
                          placeholder="输入任意语言，例如：Spanish / Japanese"
                          type="text"
                          value={modalVideoScriptLocale.inImageTextLanguage}
                        />
                      ) : null}
                    </label>
                  </div>
                </div>
              ) : null}

              {modalAnalysis.status === "completed" && modalItem ? (
                <div className="prompt-result-panel video-script-panel">
                  <div className="prompt-result-head">
                    <strong>第一次请求响应信息（可修改）</strong>
                    <span>修改后将作为后续图词与短视频请求的产品参考信息</span>
                  </div>
                  <div className="product-info-edit-grid">
                    {PRODUCT_INFO_EDIT_FIELDS.map((field) => (
                      <div className="product-info-edit-card" key={field.key}>
                        <div className="product-info-edit-head">
                          <strong className="product-info-edit-label">{field.label}</strong>
                          <span className="product-info-edit-key">{field.key}</span>
                        </div>
                        <textarea
                          className="prompt-copy-textarea prompt-copy-textarea-compact product-info-edit-textarea"
                          onChange={(event) => {
                            const nextFields: ProductInfoFieldMap = {
                              ...modalVideoProductInfoFields,
                              [field.key]: event.target.value
                            };
                            onChangeVideoProductInfo(modalItem.recordId, buildVideoProductInfoTextFromFields(nextFields));
                          }}
                          placeholder={field.placeholder}
                          rows={field.rows}
                          value={modalVideoProductInfoFields[field.key]}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="prompt-card-actions">
                    <button
                      className="ghost"
                      disabled={!safeText(modalVideoProductInfoComposedText)}
                      onClick={() => void handleCopyVideoPrompt(modalVideoProductInfoComposedText, false)}
                      type="button"
                    >
                      复制响应信息
                    </button>
                    <button className="ghost" onClick={() => onChangeVideoProductInfo(modalItem.recordId, "")} type="button">
                      恢复第一次请求原始信息
                    </button>
                  </div>
                </div>
              ) : null}

              {VIDEO_SCRIPT_AGENT_ENABLED &&
              modalItem &&
              modalVideoScript?.status === "completed" &&
              modalVideoScript.result &&
              modalStructuredVideoPromptItems.length ? (
                <div className="prompt-result-panel video-script-panel">
                  <div className="prompt-result-head">
                    <strong>短视频结构化提示词（可编辑）</strong>
                    <span>按字段拆分：digital_human_base_image_prompt / image_prompt / video_prompt</span>
                  </div>
                  <div className="video-structured-grid">
                    {modalStructuredVideoPromptItems.map((entry) => {
                      const scriptLabel = safeText(entry.scriptId) || "script";
                      const shotLabel = safeText(entry.shotId) || `shot_${String(entry.shotIndex + 1).padStart(2, "0")}`;
                      const digitalHumanPrompt = getVideoPromptValue(
                        modalItem.recordId,
                        entry.scriptId,
                        -1,
                        "digital_human_base_image_prompt",
                        entry.digitalHumanBaseImagePrompt
                      );
                      const imagePrompt = getVideoPromptValue(
                        modalItem.recordId,
                        entry.scriptId,
                        entry.shotIndex,
                        "image_prompt",
                        entry.imagePrompt
                      );
                      const videoPrompt = getVideoPromptValue(
                        modalItem.recordId,
                        entry.scriptId,
                        entry.shotIndex,
                        "video_prompt",
                        entry.videoPrompt
                      );
                      const clipState = getClipVideoState(modalItem.recordId, entry.scriptId, entry.shotIndex);
                      const persistedTask = getPersistedClipTask(modalItem.recordId, entry.scriptId, entry.shotIndex);
                      const creatingVideo = clipState.status === "queued" || clipState.status === "processing";
                      const inputId = `structured_video_upload_${modalItem.recordId}_${entry.scriptId}_${entry.shotIndex}`.replace(
                        /[^a-zA-Z0-9_-]/g,
                        "_"
                      );
                      return (
                        <div className="prompt-card prompt-split-card" key={`${modalItem.recordId}_${entry.scriptId}_${entry.shotIndex}`}>
                          <div className="prompt-item-title">{scriptLabel}</div>
                          <div className="prompt-item-subtitle">{shotLabel}</div>
                          <div className="video-structured-field-grid">
                            <div className="prompt-card prompt-split-card">
                              <div className="prompt-item-title">digital_human_base_image_prompt</div>
                              <textarea
                                className="prompt-copy-textarea prompt-copy-textarea-compact"
                                value={digitalHumanPrompt}
                                onChange={(event) =>
                                  handleVideoPromptChange(
                                    modalItem.recordId,
                                    entry.scriptId,
                                    -1,
                                    "digital_human_base_image_prompt",
                                    event.target.value
                                  )
                                }
                              />
                              <div className="prompt-card-actions">
                                <button
                                  className="ghost"
                                  onClick={() => void handleCopyVideoPrompt(digitalHumanPrompt, false)}
                                  type="button"
                                >
                                  复制
                                </button>
                                <button
                                  className="primary-btn"
                                  onClick={() => void handleCopyVideoPrompt(digitalHumanPrompt, true)}
                                  type="button"
                                >
                                  复制并跳转生图页
                                </button>
                              </div>
                            </div>

                            <div className="prompt-card prompt-split-card">
                              <div className="prompt-item-title">image_prompt</div>
                              <textarea
                                className="prompt-copy-textarea prompt-copy-textarea-compact"
                                value={imagePrompt}
                                onChange={(event) =>
                                  handleVideoPromptChange(
                                    modalItem.recordId,
                                    entry.scriptId,
                                    entry.shotIndex,
                                    "image_prompt",
                                    event.target.value
                                  )
                                }
                              />
                              <div className="prompt-card-actions">
                                <button className="ghost" onClick={() => void handleCopyVideoPrompt(imagePrompt, false)} type="button">
                                  复制
                                </button>
                                <button className="primary-btn" onClick={() => void handleCopyVideoPrompt(imagePrompt, true)} type="button">
                                  复制并跳转生图页
                                </button>
                              </div>
                            </div>

                            <div className="prompt-card prompt-split-card">
                              <div className="prompt-item-title">video_prompt</div>
                              <textarea
                                className="prompt-copy-textarea prompt-copy-textarea-compact"
                                value={videoPrompt}
                                onChange={(event) =>
                                  handleVideoPromptChange(
                                    modalItem.recordId,
                                    entry.scriptId,
                                    entry.shotIndex,
                                    "video_prompt",
                                    event.target.value
                                  )
                                }
                              />
                              <div className="video-clip-upload-grid">
                                <div className="video-clip-upload-item">
                                  <span>上传图片（必填）</span>
                                  <input
                                    accept="image/*"
                                    className="video-file-input"
                                    id={inputId}
                                    onClick={(event) => {
                                      event.currentTarget.value = "";
                                    }}
                                    onChange={(event) =>
                                      void handleClipFrameFileChange(
                                        modalItem.recordId,
                                        entry.scriptId,
                                        entry.shotIndex,
                                        "first",
                                        event.target.files?.[0] ?? null
                                      )
                                    }
                                    type="file"
                                  />
                                  <div className="video-file-row">
                                    <label className="video-file-trigger" htmlFor={inputId}>
                                      上传图片
                                    </label>
                                    <small>{clipState.firstFrameName || "未上传"}</small>
                                  </div>
                                </div>
                              </div>
                              <div className="prompt-card-actions">
                                <button
                                  className="ghost"
                                  disabled={!clipState.firstFrameDataUrl}
                                  onClick={() =>
                                    patchClipVideoState(modalItem.recordId, entry.scriptId, entry.shotIndex, {
                                      firstFrameDataUrl: "",
                                      firstFrameName: "",
                                      error: ""
                                    })
                                  }
                                  type="button"
                                >
                                  清空图片
                                </button>
                                <button
                                  className="primary-btn"
                                  disabled={!safeText(videoPrompt) || !clipState.firstFrameDataUrl || creatingVideo}
                                  onClick={() =>
                                    void handleGenerateClipVideo(
                                      modalItem.recordId,
                                      entry.scriptId,
                                      entry.shotIndex,
                                      videoPrompt,
                                      clipState.firstFrameDataUrl,
                                      ""
                                    )
                                  }
                                  type="button"
                                >
                                  {creatingVideo ? "视频生成中..." : clipState.videoUrl ? "重新创建视频" : "创建视频"}
                                </button>
                              </div>
                              <div className={`clip-status-panel status-${clipState.status}`}>
                                <div className="clip-status-main">
                                  <span className="clip-status-label">请求状态</span>
                                  <strong>{getClipVideoStatusText(clipState.status)}</strong>
                                </div>
                                <div className="clip-status-meta">
                                  <span>更新时间: {toDate(clipState.updatedAt)}</span>
                                  {clipState.taskId ? <span>任务ID: {clipState.taskId}</span> : null}
                                  {persistedTask ? <span>重试: {persistedTask.retryCount}/{persistedTask.maxRetries}</span> : null}
                                </div>
                              </div>
                              {clipState.status === "failed" ? (
                                <div className="analysis-error">视频生成失败: {clipState.error || "未知错误"}</div>
                              ) : null}
                              {clipState.videoUrl ? (
                                <div className="video-clip-result">
                                  <a href={clipState.videoUrl} rel="noreferrer" target="_blank">
                                    打开视频链接
                                  </a>
                                  <video className="video-clip-player" controls preload="metadata" src={clipState.videoUrl} />
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {VIDEO_SCRIPT_AGENT_ENABLED && modalVideoScript?.status === "completed" && modalVideoScript.result ? (
                <div className="prompt-result-panel video-script-panel">
                  <div className="prompt-result-head">
                    <strong>短视频提示词（Coze 智能体）</strong>
                    <span>{toDate(modalVideoScript.result.generatedAt)}</span>
                  </div>
                  <div className="video-script-meta">
                    <div>
                      <strong>模板数量:</strong> {modalVideoScript.result.scriptSets.length} 套
                    </div>
                  </div>
                  {modalVideoScript.result.scriptSets.length ? (
                    <div className="prompt-split-grid">
                      {modalVideoScript.result.scriptSets.map((set) => {
                        const raw = set.raw && typeof set.raw === "object" ? set.raw : {};
                        const firstFramePrompt = getVideoPromptValue(
                          modalItem.recordId,
                          set.setKey,
                          -1,
                          "first_frame_prompt",
                          safeText(raw.first_frame_prompt ?? raw.firstFramePrompt) ||
                            set.clips[0]?.firstFramePrompt ||
                            set.clips[0]?.imageGenerationPrompt ||
                            ""
                        );
                        const segmentAPrompt = getVideoPromptValue(
                          modalItem.recordId,
                          set.setKey,
                          -1,
                          "segment_a_prompt",
                          safeText(raw.segment_a_prompt ?? raw.segmentAPrompt) || set.clips[0]?.sceneDescription || ""
                        );
                        const segmentBPrompt = getVideoPromptValue(
                          modalItem.recordId,
                          set.setKey,
                          -1,
                          "segment_b_prompt",
                          safeText(raw.segment_b_prompt ?? raw.segmentBPrompt) || set.clips[0]?.marketingPurpose || ""
                        );
                        const usageGuide = safeText(raw.usage_guide ?? raw.usageGuide);
                        const segmentAState = getClipVideoState(modalItem.recordId, set.setKey, 0);
                        const segmentBState = getClipVideoState(modalItem.recordId, set.setKey, 1);
                        const segmentATask = getPersistedClipTask(modalItem.recordId, set.setKey, 0);
                        const segmentBTask = getPersistedClipTask(modalItem.recordId, set.setKey, 1);
                        const segmentAProcessing = segmentAState.status === "processing" || segmentAState.status === "queued";
                        const segmentBProcessing = segmentBState.status === "processing" || segmentBState.status === "queued";
                        const segmentAInputId = `segment_a_first_${modalItem.recordId}_${set.setKey}`.replace(/[^a-zA-Z0-9_-]/g, "_");
                        const segmentBInputId = `segment_b_first_${modalItem.recordId}_${set.setKey}`.replace(/[^a-zA-Z0-9_-]/g, "_");
                        return (
                        <div className="prompt-card prompt-split-card" key={`${modalItem.recordId}_${set.setKey}`}>
                          <div className="prompt-item-title">{set.scriptName || set.setKey}</div>
                          <div className="prompt-item-subtitle">
                            {set.videoStructure || "未提供结构"} · {set.totalDuration || "时长未提供"}
                          </div>
                          <div className="video-script-meta">
                            <div>
                              <strong>策略:</strong> {set.strategy || "无"}
                            </div>
                            <div>
                              <strong>目标人群:</strong> {set.targetAudience || "无"}
                            </div>
                            <div>
                              <strong>片段数量:</strong> 2
                            </div>
                          </div>
                          <div className="prompt-split-grid">
                            <div className="prompt-card prompt-split-card">
                              <div className="prompt-item-title">first_frame_prompt</div>
                              <textarea
                                className="prompt-copy-textarea prompt-copy-textarea-compact"
                                value={firstFramePrompt}
                                onChange={(event) =>
                                  handleVideoPromptChange(
                                    modalItem.recordId,
                                    set.setKey,
                                    -1,
                                    "first_frame_prompt",
                                    event.target.value
                                  )
                                }
                              />
                              <div className="prompt-card-actions">
                                <button className="ghost" onClick={() => void handleCopyVideoPrompt(firstFramePrompt, false)} type="button">
                                  复制 first_frame_prompt
                                </button>
                                <button className="primary-btn" onClick={() => void handleCopyVideoPrompt(firstFramePrompt, true)} type="button">
                                  复制并跳转生图页
                                </button>
                              </div>
                            </div>

                            <div className="prompt-card prompt-split-card">
                              <div className="prompt-item-title">segment_a_prompt</div>
                              <textarea
                                className="prompt-copy-textarea prompt-copy-textarea-compact"
                                value={segmentAPrompt}
                                onChange={(event) =>
                                  handleVideoPromptChange(
                                    modalItem.recordId,
                                    set.setKey,
                                    -1,
                                    "segment_a_prompt",
                                    event.target.value
                                  )
                                }
                              />
                              <div className="video-clip-upload-grid">
                                <div className="video-clip-upload-item">
                                  <span>上传图片（可选）</span>
                                  <input
                                    accept="image/*"
                                    className="video-file-input"
                                    id={segmentAInputId}
                                    onClick={(event) => {
                                      event.currentTarget.value = "";
                                    }}
                                    onChange={(event) =>
                                      void handleClipFrameFileChange(
                                        modalItem.recordId,
                                        set.setKey,
                                        0,
                                        "first",
                                        event.target.files?.[0] ?? null
                                      )
                                    }
                                    type="file"
                                  />
                                  <div className="video-file-row">
                                    <label className="video-file-trigger" htmlFor={segmentAInputId}>
                                      上传图片
                                    </label>
                                    <small>{segmentAState.firstFrameName || "未上传"}</small>
                                  </div>
                                </div>
                              </div>
                              <div className="prompt-card-actions">
                                <button
                                  className="ghost"
                                  disabled={!segmentAState.firstFrameDataUrl}
                                  onClick={() =>
                                    patchClipVideoState(modalItem.recordId, set.setKey, 0, {
                                      firstFrameDataUrl: "",
                                      firstFrameName: "",
                                      error: ""
                                    })
                                  }
                                  type="button"
                                >
                                  清空图片
                                </button>
                                <button
                                  className="primary-btn"
                                  disabled={!safeText(segmentAPrompt) || segmentAProcessing}
                                  onClick={() =>
                                    void handleGenerateClipVideo(
                                      modalItem.recordId,
                                      set.setKey,
                                      0,
                                      segmentAPrompt,
                                      segmentAState.firstFrameDataUrl,
                                      ""
                                    )
                                  }
                                  type="button"
                                >
                                  {segmentAState.status === "queued"
                                    ? "任务排队中..."
                                    : segmentAState.status === "processing"
                                      ? "视频生成中..."
                                      : segmentAState.videoUrl
                                        ? "重新生成 A 段视频"
                                        : "生成 A 段视频"}
                                </button>
                              </div>
                              <div className={`clip-status-panel status-${segmentAState.status}`}>
                                <div className="clip-status-main">
                                  <span className="clip-status-label">请求状态</span>
                                  <strong>{getClipVideoStatusText(segmentAState.status)}</strong>
                                </div>
                                <div className="clip-status-meta">
                                  <span>更新时间: {toDate(segmentAState.updatedAt)}</span>
                                  {segmentAState.taskId ? <span>任务ID: {segmentAState.taskId}</span> : null}
                                  {segmentATask ? <span>重试: {segmentATask.retryCount}/{segmentATask.maxRetries}</span> : null}
                                </div>
                              </div>
                              {segmentAProcessing ? (
                                <div className="analysis-loading">
                                  {segmentAState.status === "queued"
                                    ? `任务已入队，后台准备执行（重试 ${segmentATask?.retryCount ?? 0}/${segmentATask?.maxRetries ?? 3}）...`
                                    : `后台执行中（尝试 ${Math.max(segmentATask?.retryCount ?? 1, 1)}/${segmentATask?.maxRetries ?? 3}），正在轮询视频结果...`}
                                </div>
                              ) : null}
                              {segmentAState.status === "failed" ? (
                                <div className="analysis-error">视频生成失败: {segmentAState.error || "未知错误"}</div>
                              ) : null}
                              {segmentAState.videoUrl ? (
                                <div className="video-clip-result">
                                  <a href={segmentAState.videoUrl} rel="noreferrer" target="_blank">
                                    打开视频链接
                                  </a>
                                  <video className="video-clip-player" controls preload="metadata" src={segmentAState.videoUrl} />
                                </div>
                              ) : null}
                            </div>

                            <div className="prompt-card prompt-split-card">
                              <div className="prompt-item-title">segment_b_prompt</div>
                              <textarea
                                className="prompt-copy-textarea prompt-copy-textarea-compact"
                                value={segmentBPrompt}
                                onChange={(event) =>
                                  handleVideoPromptChange(
                                    modalItem.recordId,
                                    set.setKey,
                                    -1,
                                    "segment_b_prompt",
                                    event.target.value
                                  )
                                }
                              />
                              <div className="video-clip-upload-grid">
                                <div className="video-clip-upload-item">
                                  <span>上传图片（可选）</span>
                                  <input
                                    accept="image/*"
                                    className="video-file-input"
                                    id={segmentBInputId}
                                    multiple
                                    onClick={(event) => {
                                      event.currentTarget.value = "";
                                    }}
                                    onChange={(event) =>
                                      void handleClipReferenceImagesChange(
                                        modalItem.recordId,
                                        set.setKey,
                                        1,
                                        event.target.files
                                      )
                                    }
                                    type="file"
                                  />
                                  <div className="video-file-row">
                                    <label className="video-file-trigger" htmlFor={segmentBInputId}>
                                      上传图片
                                    </label>
                                    <small>
                                      {segmentBState.uploadedImageNames.length
                                        ? `${segmentBState.uploadedImageNames.length} 张: ${segmentBState.uploadedImageNames.join(", ")}`
                                        : "未上传"}
                                    </small>
                                  </div>
                                </div>
                              </div>
                              <div className="prompt-card-actions">
                                <button
                                  className="ghost"
                                  disabled={!segmentBState.uploadedImageDataUrls.length}
                                  onClick={() =>
                                    patchClipVideoState(modalItem.recordId, set.setKey, 1, {
                                      firstFrameDataUrl: "",
                                      firstFrameName: "",
                                      uploadedImageDataUrls: [],
                                      uploadedImageNames: [],
                                      error: ""
                                    })
                                  }
                                  type="button"
                                >
                                  清空图片
                                </button>
                                <button
                                  className="primary-btn"
                                  disabled={!safeText(segmentBPrompt) || segmentBProcessing}
                                  onClick={() =>
                                    void handleGenerateClipVideo(
                                      modalItem.recordId,
                                      set.setKey,
                                      1,
                                      segmentBPrompt,
                                      segmentBState.firstFrameDataUrl,
                                      "",
                                      segmentBState.uploadedImageDataUrls
                                    )
                                  }
                                  type="button"
                                >
                                  {segmentBState.status === "queued"
                                    ? "任务排队中..."
                                    : segmentBState.status === "processing"
                                      ? "视频生成中..."
                                      : segmentBState.videoUrl
                                        ? "重新生成 B 段视频"
                                        : "生成 B 段视频"}
                                </button>
                              </div>
                              <div className={`clip-status-panel status-${segmentBState.status}`}>
                                <div className="clip-status-main">
                                  <span className="clip-status-label">请求状态</span>
                                  <strong>{getClipVideoStatusText(segmentBState.status)}</strong>
                                </div>
                                <div className="clip-status-meta">
                                  <span>更新时间: {toDate(segmentBState.updatedAt)}</span>
                                  {segmentBState.taskId ? <span>任务ID: {segmentBState.taskId}</span> : null}
                                  {segmentBTask ? <span>重试: {segmentBTask.retryCount}/{segmentBTask.maxRetries}</span> : null}
                                </div>
                              </div>
                              {segmentBProcessing ? (
                                <div className="analysis-loading">
                                  {segmentBState.status === "queued"
                                    ? `任务已入队，后台准备执行（重试 ${segmentBTask?.retryCount ?? 0}/${segmentBTask?.maxRetries ?? 3}）...`
                                    : `后台执行中（尝试 ${Math.max(segmentBTask?.retryCount ?? 1, 1)}/${segmentBTask?.maxRetries ?? 3}），正在轮询视频结果...`}
                                </div>
                              ) : null}
                              {segmentBState.status === "failed" ? (
                                <div className="analysis-error">视频生成失败: {segmentBState.error || "未知错误"}</div>
                              ) : null}
                              {segmentBState.videoUrl ? (
                                <div className="video-clip-result">
                                  <a href={segmentBState.videoUrl} rel="noreferrer" target="_blank">
                                    打开视频链接
                                  </a>
                                  <video className="video-clip-player" controls preload="metadata" src={segmentBState.videoUrl} />
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {usageGuide ? <div className="analysis-loading">使用说明: {usageGuide}</div> : null}
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="analysis-loading">智能体返回中未识别到 script_set_1~3 结构。</div>
                  )}
                </div>
              ) : null}

              {VIDEO_SCRIPT_AGENT_ENABLED && modalVideoScript?.result ? (
                <div className="prompt-result-panel video-script-panel">
                  <div className="prompt-result-head">
                    <strong>短视频原始响应信息（调试）</strong>
                    <span>失败状态下也会保留最近一次请求的原始数据</span>
                  </div>
                  <textarea
                    className="prompt-copy-textarea prompt-copy-textarea-compact"
                    readOnly
                    value={modalVideoScriptRawText || "暂无可展示的原始响应信息。"}
                  />
                  <div className="prompt-card-actions">
                    <button
                      className="ghost"
                      disabled={!safeText(modalVideoScriptRawText)}
                      onClick={() => void handleCopyVideoPrompt(modalVideoScriptRawText, false)}
                      type="button"
                    >
                      复制原始响应
                    </button>
                  </div>
                </div>
              ) : null}

              {modalSecondPrompt?.status === "completed" ? (
                <div className="prompt-result-panel">
                  <div className="prompt-result-head">
                    <strong>产品外观/材质/形状/尺寸/颜色信息（图词请求返回）</strong>
                    <span>短视频提示词请求会基于该信息生成</span>
                  </div>
                  <div className="product-profile-grid">
                    <div className="product-profile-card">
                      <div className="product-profile-title">外观细节</div>
                      <textarea className="prompt-copy-textarea prompt-copy-textarea-compact" readOnly value={modalPromptProductProfile.appearanceDetails || "暂无"} />
                    </div>
                    <div className="product-profile-card">
                      <div className="product-profile-title">材质细节</div>
                      <textarea className="prompt-copy-textarea prompt-copy-textarea-compact" readOnly value={modalPromptProductProfile.materialDetails || "暂无"} />
                    </div>
                    <div className="product-profile-card">
                      <div className="product-profile-title">形状细节</div>
                      <textarea className="prompt-copy-textarea prompt-copy-textarea-compact" readOnly value={modalPromptProductProfile.shapeDetails || "暂无"} />
                    </div>
                    <div className="product-profile-card">
                      <div className="product-profile-title">尺寸细节</div>
                      <textarea className="prompt-copy-textarea prompt-copy-textarea-compact" readOnly value={modalPromptProductProfile.sizeDetails || "暂无"} />
                    </div>
                    <div className="product-profile-card">
                      <div className="product-profile-title">颜色细节</div>
                      <textarea className="prompt-copy-textarea prompt-copy-textarea-compact" readOnly value={modalPromptProductProfile.colorDetails || "暂无"} />
                    </div>
                  </div>
                </div>
              ) : null}

              {modalSecondPrompt?.status === "completed" && modalPromptSections ? (
                <div className="prompt-result-panel">
                  <div className="prompt-result-head">
                    <strong>图词请求结果（主图/详情页拆分）</strong>
                    <span>
                      版本 {modalSecondPrompt.result?.templateVersion} · {toDate(modalSecondPrompt.result?.generatedAt)}
                    </span>
                  </div>
                  <div className="prompt-split-grid">
                    <div className="prompt-card prompt-split-card">
                      <div className="prompt-item-title">
                        {modalPromptSections.main.title}（{modalPromptSections.main.cards.length}条）
                      </div>
                      <div className="prompt-item-subtitle">固定开场白 + EN 提示词，可直接复制到生图模型。</div>
                      <textarea className="prompt-copy-textarea" readOnly value={modalPromptSections.main.copyText} />
                      <div className="prompt-card-actions">
                        <button className="ghost" onClick={() => void handleCopyPromptSection(modalPromptSections.main.copyText, false)} type="button">
                          复制主图提示词
                        </button>
                        <button
                          className="primary-btn"
                          onClick={() => void handleCopyPromptSection(modalPromptSections.main.copyText, true)}
                          type="button"
                        >
                          复制并跳转生图页
                        </button>
                      </div>
                    </div>
                    <div className="prompt-card prompt-split-card">
                      <div className="prompt-item-title">
                        {modalPromptSections.detail.title}（{modalPromptSections.detail.cards.length}条）
                      </div>
                      <div className="prompt-item-subtitle">固定开场白 + EN 提示词，可直接复制到生图模型。</div>
                      <textarea className="prompt-copy-textarea" readOnly value={modalPromptSections.detail.copyText} />
                      <div className="prompt-card-actions">
                        <button className="ghost" onClick={() => void handleCopyPromptSection(modalPromptSections.detail.copyText, false)} type="button">
                          复制详情页提示词
                        </button>
                        <button
                          className="primary-btn"
                          onClick={() => void handleCopyPromptSection(modalPromptSections.detail.copyText, true)}
                          type="button"
                        >
                          复制并跳转生图页
                        </button>
                      </div>
                    </div>
                  </div>
                  {copyTip ? <div className="genspark-hint status-opened">{copyTip}</div> : null}
                  <div className="genspark-hint status-opening">
                    点击“复制并跳转生图页”将打开 {GENSPARK_IMAGE_URL}，请在新页面粘贴提示词生图。
                  </div>
                </div>
              ) : null}
            </div>

            <div className="ai-modal-actions">
              <button className="ghost" onClick={() => onOpenProduct(modalItem.recordId)} type="button">
                查看商品
              </button>
              <button className="primary-btn" disabled={modalAnalyzing} onClick={() => onAnalyze(modalItem.recordId)} type="button">
                {modalAnalyzing ? "分析中..." : modalAnalysis.status === "completed" ? "重新分析" : "开始分析"}
              </button>
              {VIDEO_SCRIPT_AGENT_ENABLED ? (
                <button
                  className="ghost"
                  disabled={modalAnalysis.status !== "completed" || modalVideoGenerating || modalVideoDebugging}
                  onClick={() => void onGenerateVideoScript(modalItem.recordId, { productInfoText: modalVideoProductInfoComposedText })}
                  type="button"
                >
                  {modalAnalysis.status !== "completed"
                    ? "先完成分析"
                    : modalVideoGenerating
                      ? "短视频生成中..."
                      : modalVideoDebugging
                        ? "调试请求中..."
                      : modalVideoScript?.status === "completed"
                        ? "重跑短视频提示词"
                        : "短视频提示词"}
                </button>
              ) : null}
              <button
                className="ghost"
                disabled={modalAnalysis.status !== "completed" || modalPromptGenerating}
                onClick={() => void onGenerateSecondPrompt(modalItem.recordId)}
                type="button"
              >
                {modalAnalysis.status !== "completed"
                  ? "先完成分析"
                  : modalPromptGenerating
                    ? "图词生成中..."
                    : modalSecondPrompt?.status === "completed"
                      ? "重跑图词请求"
                      : "图词请求"}
              </button>
              <button className="ghost" onClick={handleOpenGensparkWindow} type="button">
                新窗口打开生图页
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ProductCard(props: {
  item: ProductRecord;
  selected: boolean;
  detailActive: boolean;
  onOpenDetail: (recordId: string) => void;
  onSelect: (recordId: string, checked: boolean) => void;
  onDelete: (recordId: string) => Promise<void>;
  onAnalyze: (recordId: string) => Promise<void>;
  onGenerateVideoScript: GenerateVideoScriptHandler;
  onGenerateSecondPrompt: (recordId: string) => Promise<void>;
}) {
  const { item, selected, detailActive, onOpenDetail, onSelect, onDelete, onAnalyze, onGenerateVideoScript, onGenerateSecondPrompt } = props;
  const analysis = normalizeAnalysisState(item.analysis);
  const videoScript = normalizeVideoScriptState(item.videoScriptGeneration);
  const secondPrompt = normalizeSecondPromptState(item.secondPromptGeneration);
  const analyzing = analysis.status === "queued" || analysis.status === "processing";
  const generatingVideoScript = videoScript.status === "processing";
  const generatingPrompt = secondPrompt.status === "processing";
  const canRunSecondPrompt = analysis.status === "completed";
  const canRunVideoScript = analysis.status === "completed" && secondPrompt.status === "completed";
  const skuSummary = item.skuDimensions
    .slice(0, 2)
    .map((dimension) => `${dimension.name}${dimension.options.length ? ` (${dimension.options.length})` : ""}`)
    .join(" / ");

  return (
    <article className={`product-card ${detailActive ? "active" : ""}`}>
      <div className="card-image-wrap">
        {item.triggeredImage ? (
          <img src={buildDisplayImageUrl(item.triggeredImage, item.url)} alt={item.title} />
        ) : (
          <div className="image-fallback">No Image</div>
        )}
        <label className="select-chip">
          <input checked={selected} onChange={(event) => onSelect(item.recordId, event.target.checked)} type="checkbox" />
          选择
        </label>
      </div>
      <div className="card-content">
        <button className="title-link-btn" onClick={() => onOpenDetail(item.recordId)} type="button">
          {item.title}
        </button>
        <div className="card-price">
          {toCurrency(item.priceMin)}
          {item.priceMax !== null && item.priceMax !== item.priceMin ? ` - ${toCurrency(item.priceMax)}` : ""}
        </div>
        <div className="card-meta">{skuSummary || "规格信息待补全"}</div>
        <div className="card-meta">店铺: {item.shopName}</div>
        <div className="card-meta">抓取时间: {toDate(item.capturedAt)}</div>
        <div className={`analysis-chip status-${analysis.status}`}>AI: {analysisStatusLabel(analysis.status)}</div>
        {VIDEO_SCRIPT_AGENT_ENABLED ? (
          <div className={`prompt-chip status-${videoScript.status}`}>短视频: {videoScriptStatusLabel(videoScript.status)}</div>
        ) : null}
        <div className={`prompt-chip status-${secondPrompt.status}`}>图词: {secondPromptStatusLabel(secondPrompt.status)}</div>
        <div className="card-actions">
          <button className="primary-btn" disabled={analyzing} onClick={() => onAnalyze(item.recordId)} type="button">
            {analyzing ? "分析中..." : analysis.status === "completed" ? "重跑分析" : "AI分析"}
          </button>
          {VIDEO_SCRIPT_AGENT_ENABLED ? (
            <button
              className="ghost"
              disabled={!canRunVideoScript || generatingVideoScript}
              onClick={() => void onGenerateVideoScript(item.recordId)}
              type="button"
            >
              {!canRunVideoScript
                ? analysis.status !== "completed"
                  ? "先完成分析"
                  : "先完成图词"
                : generatingVideoScript
                  ? "短视频生成中..."
                  : videoScript.status === "completed"
                    ? "重跑短视频提示词"
                    : "短视频提示词"}
            </button>
          ) : null}
          <button
            className="ghost"
            disabled={!canRunSecondPrompt || generatingPrompt}
            onClick={() => void onGenerateSecondPrompt(item.recordId)}
            type="button"
          >
            {!canRunSecondPrompt ? "先完成分析" : generatingPrompt ? "图词生成中..." : secondPrompt.status === "completed" ? "重跑图词请求" : "图词请求"}
          </button>
          <button className="danger-btn" onClick={() => onDelete(item.recordId)} type="button">
            删除
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductRow(props: {
  item: ProductRecord;
  selected: boolean;
  detailActive: boolean;
  onOpenDetail: (recordId: string) => void;
  onSelect: (recordId: string, checked: boolean) => void;
  onDelete: (recordId: string) => Promise<void>;
  onAnalyze: (recordId: string) => Promise<void>;
  onGenerateVideoScript: GenerateVideoScriptHandler;
  onGenerateSecondPrompt: (recordId: string) => Promise<void>;
}) {
  const { item, selected, detailActive, onOpenDetail, onSelect, onDelete, onAnalyze, onGenerateVideoScript, onGenerateSecondPrompt } = props;
  const analysis = normalizeAnalysisState(item.analysis);
  const videoScript = normalizeVideoScriptState(item.videoScriptGeneration);
  const secondPrompt = normalizeSecondPromptState(item.secondPromptGeneration);
  const analyzing = analysis.status === "queued" || analysis.status === "processing";
  const generatingVideoScript = videoScript.status === "processing";
  const generatingPrompt = secondPrompt.status === "processing";
  const canRunSecondPrompt = analysis.status === "completed";
  const canRunVideoScript = analysis.status === "completed" && secondPrompt.status === "completed";

  return (
    <div className={`product-row ${detailActive ? "active" : ""}`}>
      <label>
        <input checked={selected} onChange={(event) => onSelect(item.recordId, event.target.checked)} type="checkbox" />
      </label>
      <img src={buildDisplayImageUrl(item.triggeredImage || "", item.url)} alt={item.title} />
      <button className="row-link-btn" onClick={() => onOpenDetail(item.recordId)} type="button">
        {item.title}
      </button>
      <div>{toCurrency(item.priceMin)}</div>
      <div>{item.shopName}</div>
      <div>{analysisStatusLabel(analysis.status)} / {secondPromptStatusLabel(secondPrompt.status)}</div>
      <div className="row-actions">
        <button className="primary-btn small" disabled={analyzing} onClick={() => onAnalyze(item.recordId)} type="button">
          {analyzing ? "中..." : "分析"}
        </button>
        {VIDEO_SCRIPT_AGENT_ENABLED ? (
          <button
            className="ghost small-inline"
            disabled={!canRunVideoScript || generatingVideoScript}
            onClick={() => void onGenerateVideoScript(item.recordId)}
            type="button"
          >
            {!canRunVideoScript ? (analysis.status !== "completed" ? "先分析" : "先图词") : generatingVideoScript ? "短视频中..." : "短视频"}
          </button>
        ) : null}
        <button
          className="ghost small-inline"
          disabled={!canRunSecondPrompt || generatingPrompt}
          onClick={() => void onGenerateSecondPrompt(item.recordId)}
          type="button"
        >
          {!canRunSecondPrompt ? "先分析" : generatingPrompt ? "图词中..." : "图词请求"}
        </button>
        <button className="danger-btn small" onClick={() => onDelete(item.recordId)} type="button">
          删除
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState<ProductRecord[]>([]);
  const [videoProductInfoOverrides, setVideoProductInfoOverrides] = useState<Record<string, string>>({});
  const [promptPackLocaleOverrides, setPromptPackLocaleOverrides] = useState<Record<string, PromptPackLocaleSettings>>({});
  const [videoScriptLocaleOverrides, setVideoScriptLocaleOverrides] = useState<Record<string, PromptPackLocaleSettings>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<"library" | "aiResults" | "apiKeys">("library");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"capturedAt" | "priceMin">("capturedAt");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualShopName, setManualShopName] = useState("手动上传");
  const [manualDescription, setManualDescription] = useState("");
  const [manualImageFile, setManualImageFile] = useState<File | null>(null);
  const [manualImagePreviewUrl, setManualImagePreviewUrl] = useState("");
  const [manualProductLink, setManualProductLink] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [sidebarManualCollapse, setSidebarManualCollapse] = useState(false);
  const [isCompact, setIsCompact] = useState(window.innerWidth <= 1024);
  const pollingLocks = useRef<Set<string>>(new Set());
  const secondPromptPollingLocks = useRef<Set<string>>(new Set());
  const manualImageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handler = () => setIsCompact(window.innerWidth <= 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    if (!manualImageFile) {
      setManualImagePreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(manualImageFile);
    setManualImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [manualImageFile]);

  const sidebarCollapsed = isCompact || sidebarManualCollapse;

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/products?sortBy=${sortBy}&order=${order}`);
      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }
      const json = (await response.json()) as ApiListResponse;
      const nextItems = Array.isArray(json.items) ? json.items.map(normalizeProductRecord) : [];
      setItems(nextItems);
      setVideoProductInfoOverrides((prev) => {
        const allowed = new Set(nextItems.map((item) => item.recordId));
        const entries = Object.entries(prev).filter(([recordId]) => allowed.has(recordId));
        if (entries.length === Object.keys(prev).length) {
          return prev;
        }
        return Object.fromEntries(entries);
      });
      setPromptPackLocaleOverrides((prev) => {
        const allowed = new Set(nextItems.map((item) => item.recordId));
        const entries = Object.entries(prev).filter(([recordId]) => allowed.has(recordId));
        if (entries.length === Object.keys(prev).length) {
          return prev;
        }
        return Object.fromEntries(entries);
      });
      setVideoScriptLocaleOverrides((prev) => {
        const allowed = new Set(nextItems.map((item) => item.recordId));
        const entries = Object.entries(prev).filter(([recordId]) => allowed.has(recordId));
        if (entries.length === Object.keys(prev).length) {
          return prev;
        }
        return Object.fromEntries(entries);
      });
      setSelectedIds((prev) => prev.filter((id) => nextItems.some((item) => item.recordId === id)));
      setDetailRecordId((prev) => {
        if (prev && nextItems.some((item) => item.recordId === prev)) {
          return prev;
        }
        return nextItems[0]?.recordId ?? null;
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [sortBy, order]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const updateItemAnalysis = useCallback((recordId: string, analysis: ProductAnalysisState) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.recordId !== recordId) {
          return item;
        }
        return {
          ...item,
          analysis: normalizeAnalysisState(analysis)
        };
      })
    );
  }, []);

  const updateItemSecondPrompt = useCallback((recordId: string, secondPromptGeneration: SecondPromptGenerationState) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.recordId !== recordId) {
          return item;
        }
        return {
          ...item,
          secondPromptGeneration: normalizeSecondPromptState(secondPromptGeneration)
        };
      })
    );
  }, []);

  const updateItemVideoScript = useCallback((recordId: string, videoScriptGeneration: VideoScriptGenerationState) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.recordId !== recordId) {
          return item;
        }
        return {
          ...item,
          videoScriptGeneration: normalizeVideoScriptState(videoScriptGeneration)
        };
      })
    );
  }, []);

  const updateItemVideoClipGeneration = useCallback((recordId: string, videoClipGeneration: VideoClipGenerationState) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.recordId !== recordId) {
          return item;
        }
        return {
          ...item,
          videoClipGeneration: normalizeVideoClipGenerationState(videoClipGeneration)
        };
      })
    );
  }, []);

  const fetchVideoScriptStatus = useCallback(
    async (recordId: string) => {
      try {
        const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/video-script/status`);
        if (!response.ok) {
          return null;
        }
        const json = (await response.json()) as VideoScriptStatusResponse;
        if (!json.videoScriptGeneration) {
          return null;
        }
        updateItemVideoScript(recordId, json.videoScriptGeneration);
        return json.videoScriptGeneration;
      } catch (_error) {
        return null;
      }
    },
    [updateItemVideoScript]
  );

  const fetchVideoScriptStatusWithRetry = useCallback(
    async (recordId: string, attempts = 3, delayMs = 450) => {
      for (let index = 0; index < attempts; index += 1) {
        const synced = await fetchVideoScriptStatus(recordId);
        if (synced) {
          return synced;
        }
        if (index < attempts - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
      return null;
    },
    [fetchVideoScriptStatus]
  );

  const pollAnalysisStatus = useCallback(
    async (recordId: string) => {
      if (pollingLocks.current.has(recordId)) {
        return;
      }
      pollingLocks.current.add(recordId);
      try {
        const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/analyze/status`);
        if (!response.ok) {
          return;
        }
        const json = (await response.json()) as AnalyzeStatusResponse;
        if (!json.analysis) {
          return;
        }
        updateItemAnalysis(recordId, json.analysis);
        if (json.videoScriptGeneration) {
          updateItemVideoScript(recordId, json.videoScriptGeneration);
        }
        if (json.secondPromptGeneration) {
          updateItemSecondPrompt(recordId, json.secondPromptGeneration);
        }
        if (json.videoClipGeneration) {
          updateItemVideoClipGeneration(recordId, json.videoClipGeneration);
        }
      } finally {
        pollingLocks.current.delete(recordId);
      }
    },
    [updateItemAnalysis, updateItemSecondPrompt, updateItemVideoClipGeneration, updateItemVideoScript]
  );

  const pollSecondPromptStatus = useCallback(
    async (recordId: string) => {
      if (secondPromptPollingLocks.current.has(recordId)) {
        return;
      }
      secondPromptPollingLocks.current.add(recordId);
      try {
        const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/prompt-pack/status`);
        if (!response.ok) {
          return;
        }
        const json = (await response.json()) as SecondPromptStatusResponse;
        if (!json.secondPromptGeneration) {
          return;
        }
        updateItemSecondPrompt(recordId, json.secondPromptGeneration);
      } finally {
        secondPromptPollingLocks.current.delete(recordId);
      }
    },
    [updateItemSecondPrompt]
  );

  const pendingRecordIds = useMemo(() => {
    return items
      .filter((item) => {
        const analysisStatus = normalizeAnalysisState(item.analysis).status;
        return analysisStatus === "queued" || analysisStatus === "processing";
      })
      .map((item) => item.recordId);
  }, [items]);

  useEffect(() => {
    if (!pendingRecordIds.length) {
      return;
    }
    const tick = () => {
      pendingRecordIds.forEach((recordId) => {
        void pollAnalysisStatus(recordId);
      });
    };
    tick();
    const timer = window.setInterval(tick, 2500);
    return () => window.clearInterval(timer);
  }, [pendingRecordIds, pollAnalysisStatus]);

  const pendingSecondPromptRecordIds = useMemo(() => {
    return items
      .filter((item) => {
        const status = normalizeSecondPromptState(item.secondPromptGeneration).status;
        return status === "processing";
      })
      .map((item) => item.recordId);
  }, [items]);

  useEffect(() => {
    if (!pendingSecondPromptRecordIds.length) {
      return;
    }
    const tick = () => {
      pendingSecondPromptRecordIds.forEach((recordId) => {
        void pollSecondPromptStatus(recordId);
      });
    };
    tick();
    const timer = window.setInterval(tick, 2500);
    return () => window.clearInterval(timer);
  }, [pendingSecondPromptRecordIds, pollSecondPromptStatus]);

  const pendingVideoClipRecordIds = useMemo(() => {
    return items
      .filter((item) =>
        normalizeVideoClipGenerationState(item.videoClipGeneration).items.some(
          (entry) => entry.status === "queued" || entry.status === "processing"
        )
      )
      .map((item) => item.recordId);
  }, [items]);

  useEffect(() => {
    if (!pendingVideoClipRecordIds.length) {
      return;
    }
    const tick = () => {
      pendingVideoClipRecordIds.forEach((recordId) => {
        void pollAnalysisStatus(recordId);
      });
    };
    tick();
    const timer = window.setInterval(tick, 2500);
    return () => window.clearInterval(timer);
  }, [pendingVideoClipRecordIds, pollAnalysisStatus]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const detailItem = useMemo(() => items.find((item) => item.recordId === detailRecordId) ?? null, [items, detailRecordId]);
  const analyzedCount = useMemo(
    () => items.filter((item) => normalizeAnalysisState(item.analysis).status !== "idle").length,
    [items]
  );

  const pageHeader = useMemo(() => {
    if (activeSection === "library") {
      return {
        title: "商品库",
        subtitle: `共 ${items.length} 条商品记录`
      };
    }
    if (activeSection === "aiResults") {
      return {
        title: "AI分析结果",
        subtitle: `共 ${analyzedCount} 条分析记录`
      };
    }
    return {
      title: "API Key 管理",
      subtitle: "统一管理所有请求使用的 API Key 与页面密码"
    };
  }, [activeSection, analyzedCount, items.length]);

  const handleOpenProduct = useCallback((recordId: string) => {
    setDetailRecordId(recordId);
    setActiveSection("library");
  }, []);

  const handleChangeVideoProductInfo = useCallback((recordId: string, value: string) => {
    const nextValue = String(value || "");
    setVideoProductInfoOverrides((prev) => {
      if (!recordId) {
        return prev;
      }
      if (!safeText(nextValue)) {
        if (!Object.prototype.hasOwnProperty.call(prev, recordId)) {
          return prev;
        }
        const next = { ...prev };
        delete next[recordId];
        return next;
      }
      if (prev[recordId] === nextValue) {
        return prev;
      }
      return {
        ...prev,
        [recordId]: nextValue
      };
    });
  }, []);

  const handleChangePromptPackLocale = useCallback((recordId: string, value: PromptPackLocaleSettings) => {
    if (!recordId) {
      return;
    }
    const normalized = normalizePromptPackLocaleSettings(value);
    setPromptPackLocaleOverrides((prev) => {
      const current = prev[recordId];
      if (current && current.targetMarket === normalized.targetMarket && current.inImageTextLanguage === normalized.inImageTextLanguage) {
        return prev;
      }
      return {
        ...prev,
        [recordId]: normalized
      };
    });
  }, []);

  const handleChangeVideoScriptLocale = useCallback((recordId: string, value: PromptPackLocaleSettings) => {
    if (!recordId) {
      return;
    }
    const normalized = normalizePromptPackLocaleSettings(value);
    setVideoScriptLocaleOverrides((prev) => {
      const current = prev[recordId];
      if (current && current.targetMarket === normalized.targetMarket && current.inImageTextLanguage === normalized.inImageTextLanguage) {
        return prev;
      }
      return {
        ...prev,
        [recordId]: normalized
      };
    });
  }, []);

  const handleSelect = (recordId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        return [...new Set([...prev, recordId])];
      }
      return prev.filter((id) => id !== recordId);
    });
  };

  const handleDeleteOne = async (recordId: string) => {
    const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}`, { method: "DELETE" });
    if (!response.ok) {
      setError(`删除失败: ${response.status}`);
      return;
    }
    await fetchProducts();
  };

  const handleBatchDelete = async () => {
    if (!selectedIds.length) {
      return;
    }
    const response = await fetch(`${API_BASE}/api/products/batch-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordIds: selectedIds })
    });
    if (!response.ok) {
      setError(`批量删除失败: ${response.status}`);
      return;
    }
    await fetchProducts();
  };

  const handleAnalyze = useCallback(
    async (recordId: string) => {
      setError("");
      const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/analyze`, {
        method: "POST"
      });
      if (!response.ok) {
        let detail = "";
        try {
          const json = await response.json();
          detail = json?.message ? ` - ${String(json.message)}` : "";
        } catch (_error) {
          detail = "";
        }
        setError(`触发分析失败: ${response.status}${detail}`);
        return;
      }
      const json = (await response.json()) as AnalyzeTriggerResponse;
      updateItemAnalysis(recordId, {
        status: "queued",
        jobId: json.jobId,
        error: null,
        updatedAt: new Date().toISOString(),
        result: null
      });
      void pollAnalysisStatus(recordId);
    },
    [pollAnalysisStatus, updateItemAnalysis]
  );

  const handleGenerateSecondPrompt = useCallback(
    async (recordId: string) => {
      setError("");
      updateItemSecondPrompt(recordId, {
        status: "processing",
        jobId: null,
        error: null,
        updatedAt: new Date().toISOString(),
        result: null
      });

      const overrideProductInfoText = safeText(videoProductInfoOverrides[recordId]);
      const localeSettings = normalizePromptPackLocaleSettings(promptPackLocaleOverrides[recordId]);
      const requestBody = buildSecondPromptRequestBody(overrideProductInfoText, localeSettings);
      const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/prompt-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      let json: GenerateSecondPromptResponse | null = null;
      try {
        json = (await response.json()) as GenerateSecondPromptResponse;
      } catch (_error) {
        json = null;
      }

      if (!response.ok) {
        const detail = json?.message ? ` - ${String(json.message)}` : "";
        setError(`图词请求失败: ${response.status}${detail}`);
        if (json?.secondPromptGeneration) {
          updateItemSecondPrompt(recordId, json.secondPromptGeneration);
        } else {
          updateItemSecondPrompt(recordId, {
            status: "failed",
            jobId: null,
            error: `请求失败: ${response.status}`,
            updatedAt: new Date().toISOString(),
            result: null
          });
        }
        return;
      }

      if (!json?.secondPromptGeneration) {
        if (json?.accepted && json?.jobId) {
          updateItemSecondPrompt(recordId, {
            status: "processing",
            jobId: json.jobId,
            error: null,
            updatedAt: new Date().toISOString(),
            result: null
          });
        } else {
          setError("图词请求成功但未返回任务状态。");
        }
      } else {
        updateItemSecondPrompt(recordId, json.secondPromptGeneration);
      }
      void pollSecondPromptStatus(recordId);
    },
    [pollSecondPromptStatus, promptPackLocaleOverrides, updateItemSecondPrompt, videoProductInfoOverrides]
  );

  const resolveVideoScriptLocaleSettings = useCallback(
    (recordId: string) => {
      const override = videoScriptLocaleOverrides[recordId];
      if (override) {
        return normalizePromptPackLocaleSettings(override);
      }
      const item = items.find((entry) => entry.recordId === recordId);
      if (!item) {
        return normalizePromptPackLocaleSettings();
      }
      const videoFallback = parseVideoScriptLocaleSettings(normalizeVideoScriptState(item.videoScriptGeneration).result ?? null);
      if (videoFallback) {
        return normalizePromptPackLocaleSettings(videoFallback);
      }
      const secondPromptFallback = parseSecondPromptLocaleSettings(normalizeSecondPromptState(item.secondPromptGeneration).result ?? null);
      return normalizePromptPackLocaleSettings(secondPromptFallback);
    },
    [items, videoScriptLocaleOverrides]
  );

  const handleGenerateVideoScript = useCallback(
    async (recordId: string, options?: GenerateVideoScriptOptions) => {
      setError("");
      updateItemVideoScript(recordId, {
        status: "processing",
        error: null,
        updatedAt: new Date().toISOString(),
        result: null
      });

      const optionProductInfoText = safeText(options?.productInfoText);
      const overrideProductInfoText = optionProductInfoText || safeText(videoProductInfoOverrides[recordId]);
      const localeSettings = resolveVideoScriptLocaleSettings(recordId);
      const requestBody = buildVideoScriptRequestBody(overrideProductInfoText, localeSettings);
      try {
        const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/video-script`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });
        let json: GenerateVideoScriptResponse | null = null;
        try {
          json = (await response.json()) as GenerateVideoScriptResponse;
        } catch (_error) {
          json = null;
        }

        if (!response.ok) {
          const detail = json?.message ? ` - ${String(json.message)}` : "";
          setError(`短视频提示词请求失败: ${response.status}${detail}`);
          if (json?.videoScriptGeneration) {
            updateItemVideoScript(recordId, json.videoScriptGeneration);
          } else {
            const synced = await fetchVideoScriptStatusWithRetry(recordId);
            if (!synced) {
              updateItemVideoScript(recordId, {
                status: "failed",
                error: `请求失败: ${response.status}`,
                updatedAt: new Date().toISOString(),
                result: null
              });
            }
          }
          return;
        }

        if (json?.videoScriptGeneration) {
          updateItemVideoScript(recordId, json.videoScriptGeneration);
          return;
        }

        const synced = await fetchVideoScriptStatusWithRetry(recordId);
        if (synced) {
          setError("短视频请求已执行，但响应体缺少状态字段；已自动同步后台保存结果。");
        } else {
          setError("短视频提示词请求成功但未返回任务状态。");
        }
      } catch (requestError) {
        const synced = await fetchVideoScriptStatusWithRetry(recordId);
        const message = requestError instanceof Error ? requestError.message : String(requestError || "network error");
        if (synced) {
          setError(`短视频请求前端连接异常: ${message}（已同步后台执行结果）`);
          return;
        }
        setError(`短视频提示词请求失败: ${message}`);
        updateItemVideoScript(recordId, {
          status: "failed",
          error: message || "fetch failed",
          updatedAt: new Date().toISOString(),
          result: null
        });
      }
    },
    [fetchVideoScriptStatusWithRetry, resolveVideoScriptLocaleSettings, updateItemVideoScript, videoProductInfoOverrides]
  );

  const handleDebugVideoScript = useCallback(
    async (recordId: string, options?: GenerateVideoScriptOptions) => {
      setError("");
      const optionProductInfoText = safeText(options?.productInfoText);
      const overrideProductInfoText = optionProductInfoText || safeText(videoProductInfoOverrides[recordId]);
      const localeSettings = resolveVideoScriptLocaleSettings(recordId);
      const requestBody = buildVideoScriptRequestBody(overrideProductInfoText, localeSettings);
      try {
        const response = await fetch(`${API_BASE}/api/products/${encodeURIComponent(recordId)}/video-script/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });
        let json: GenerateVideoScriptResponse | null = null;
        try {
          json = (await response.json()) as GenerateVideoScriptResponse;
        } catch (_error) {
          json = null;
        }

        if (json?.videoScriptGeneration) {
          updateItemVideoScript(recordId, json.videoScriptGeneration);
        } else {
          await fetchVideoScriptStatusWithRetry(recordId);
        }

        if (!response.ok) {
          const detail = json?.message ? ` - ${String(json.message)}` : "";
          setError(`短视频调试请求失败: ${response.status}${detail}`);
          return;
        }
      } catch (requestError) {
        const synced = await fetchVideoScriptStatusWithRetry(recordId);
        const message = requestError instanceof Error ? requestError.message : String(requestError || "network error");
        if (synced) {
          setError(`短视频调试请求连接异常: ${message}（已同步后台状态）`);
          return;
        }
        setError(`短视频调试请求失败: ${message}`);
      }
    },
    [fetchVideoScriptStatusWithRetry, resolveVideoScriptLocaleSettings, updateItemVideoScript, videoProductInfoOverrides]
  );

  const handleCreateManualProduct = useCallback(async () => {
    setError("");
    if (!manualImageFile) {
      setError("请先上传商品白底图。");
      return;
    }
    const description = safeText(manualDescription);
    if (!description) {
      setError("请填写商品描述。");
      return;
    }

    setManualSubmitting(true);
    try {
      const imageDataUrl = await readFileAsDataUrl(manualImageFile);
      const response = await fetch(`${API_BASE}/api/products/manual-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: safeText(manualTitle),
          shopName: safeText(manualShopName) || "手动上传",
          description,
          imageDataUrl
        })
      });

      let json: ManualUploadResponse | null = null;
      try {
        json = (await response.json()) as ManualUploadResponse;
      } catch (_error) {
        json = null;
      }

      if (!response.ok) {
        const detail = safeText(json?.message);
        throw new Error(`手动创建失败: ${response.status}${detail ? ` - ${detail}` : ""}`);
      }

      const createdItem = json?.item ? normalizeProductRecord(json.item) : null;
      setManualProductLink(safeText(json?.productLink || createdItem?.url));
      setManualTitle("");
      setManualDescription("");
      setManualImageFile(null);
      if (manualImageInputRef.current) {
        manualImageInputRef.current.value = "";
      }

      await fetchProducts();
      if (createdItem?.recordId) {
        setDetailRecordId(createdItem.recordId);
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "手动创建失败");
    } finally {
      setManualSubmitting(false);
    }
  }, [fetchProducts, manualDescription, manualImageFile, manualShopName, manualTitle]);

  const handleCopyManualProductLink = useCallback(async () => {
    const link = safeText(manualProductLink);
    if (!link) {
      return;
    }
    const copied = await copyText(link);
    if (!copied) {
      setError("链接复制失败，请手动复制。");
    }
  }, [manualProductLink]);

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="brand">CaptureHub</div>
        <input className="global-search" disabled placeholder="全局搜索（Phase 2）" />
        <div className="topbar-tools">
          <button className="ghost" type="button">
            消息
          </button>
          <div className="avatar-slot">U</div>
        </div>
      </header>

      <div className="content-shell">
        <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
          <button className="collapse-toggle" onClick={() => setSidebarManualCollapse((prev) => !prev)} type="button">
            {sidebarCollapsed ? "展开" : "收起"}
          </button>
          <nav>
            <button
              className={`menu-item menu-item-btn ${activeSection === "library" ? "active" : ""}`}
              onClick={() => setActiveSection("library")}
              type="button"
            >
              商品库
            </button>
            <button
              className={`menu-item menu-item-btn ${activeSection === "aiResults" ? "active" : ""}`}
              onClick={() => setActiveSection("aiResults")}
              type="button"
            >
              AI分析结果
            </button>
            <button
              className={`menu-item menu-item-btn ${activeSection === "apiKeys" ? "active" : ""}`}
              onClick={() => setActiveSection("apiKeys")}
              type="button"
            >
              API Key管理
            </button>
            <a className="menu-item disabled">
              数据分析 <span>即将上线</span>
            </a>
            <a className="menu-item disabled">
              采购清单 <span>即将上线</span>
            </a>
            <a className="menu-item disabled">
              价格监控 <span>即将上线</span>
            </a>
          </nav>
        </aside>

        <main className="main">
          <section className="page-head">
            <div>
              <h1>{pageHeader.title}</h1>
              <p>{pageHeader.subtitle}</p>
            </div>
            {activeSection === "library" ? (
              <div className="head-actions">
                <button className="ghost" onClick={() => setView("grid")} type="button">
                  网格
                </button>
                <button className="ghost" onClick={() => setView("list")} type="button">
                  列表
                </button>
                <button className="danger-btn" onClick={handleBatchDelete} type="button">
                  批量删除({selectedIds.length})
                </button>
              </div>
            ) : (
              <div className="head-actions">
                <button className="ghost" onClick={() => setActiveSection("library")} type="button">
                  返回商品库
                </button>
              </div>
            )}
          </section>

          {activeSection === "library" ? (
            <>
              <section className="toolbar">
                <label>
                  排序字段
                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "capturedAt" | "priceMin")}>
                    <option value="capturedAt">抓取时间</option>
                    <option value="priceMin">价格</option>
                  </select>
                </label>
                <label>
                  顺序
                  <select value={order} onChange={(event) => setOrder(event.target.value as "desc" | "asc")}>
                    <option value="desc">最新 / 最高</option>
                    <option value="asc">最旧 / 最低</option>
                  </select>
                </label>
                <label className="placeholder-filter">
                  分类筛选
                  <input disabled placeholder="预留入口（Phase 2）" />
                </label>
              </section>

              <section className="manual-create-panel">
                <div className="manual-create-head">
                  <h3>手动创建商品链接</h3>
                  <p>无需插件，上传白底图并填写商品描述后即可生成可访问商品链接并写入商品库。</p>
                </div>
                <div className="manual-create-grid">
                  <label className="manual-create-field">
                    商品标题
                    <input
                      maxLength={120}
                      onChange={(event) => {
                        setManualTitle(event.target.value);
                        setManualProductLink("");
                      }}
                      placeholder="例如：便携式不锈钢保温杯"
                      type="text"
                      value={manualTitle}
                    />
                  </label>
                  <label className="manual-create-field">
                    店铺名称
                    <input
                      maxLength={80}
                      onChange={(event) => {
                        setManualShopName(event.target.value);
                        setManualProductLink("");
                      }}
                      placeholder="默认：手动上传"
                      type="text"
                      value={manualShopName}
                    />
                  </label>
                  <label className="manual-create-field manual-create-description">
                    商品描述
                    <textarea
                      maxLength={5000}
                      onChange={(event) => {
                        setManualDescription(event.target.value);
                        setManualProductLink("");
                      }}
                      placeholder="填写材质、尺寸、功能、适用场景等关键信息。"
                      rows={4}
                      value={manualDescription}
                    />
                  </label>
                  <label className="manual-create-field manual-create-upload">
                    商品白底图
                    <input
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (file && !file.type.startsWith("image/")) {
                          setError("仅支持上传图片文件。");
                          event.currentTarget.value = "";
                          setManualImageFile(null);
                          return;
                        }
                        setManualImageFile(file);
                        setManualProductLink("");
                      }}
                      ref={manualImageInputRef}
                      type="file"
                    />
                    {manualImagePreviewUrl ? (
                      <img alt="上传预览" className="manual-upload-preview" src={manualImagePreviewUrl} />
                    ) : (
                      <div className="manual-upload-placeholder">尚未选择图片</div>
                    )}
                    <small>{manualImageFile ? `${manualImageFile.name} · ${Math.ceil(manualImageFile.size / 1024)}KB` : "建议清晰白底图"}</small>
                  </label>
                </div>
                <div className="manual-create-actions">
                  <button className="primary-btn" disabled={manualSubmitting} onClick={() => void handleCreateManualProduct()} type="button">
                    {manualSubmitting ? "创建中..." : "上传并创建商品链接"}
                  </button>
                  {manualProductLink ? (
                    <>
                      <a className="source-link manual-link" href={manualProductLink} rel="noreferrer" target="_blank">
                        打开新建商品链接
                      </a>
                      <button className="ghost" onClick={() => void handleCopyManualProductLink()} type="button">
                        复制链接
                      </button>
                    </>
                  ) : null}
                </div>
              </section>

              {error ? <div className="error-banner">{error}</div> : null}
              {loading ? <div className="loading">加载中...</div> : null}

              {!loading && items.length === 0 ? (
                <section className="empty-state">
                  <div className="art"></div>
                  <h2>还没有抓取任何商品</h2>
                  <p>可通过插件拖拽 1688 商品图，或在上方手动上传白底图与商品描述开始创建。</p>
                </section>
              ) : null}

              {!loading && items.length > 0 ? (
                <section className="library-layout">
                  <div className="library-content">
                    {view === "grid" ? (
                      <section className="grid">
                        {items.map((item) => (
                          <ProductCard
                            detailActive={detailRecordId === item.recordId}
                            item={item}
                            key={item.recordId}
                            onAnalyze={handleAnalyze}
                            onGenerateVideoScript={handleGenerateVideoScript}
                            onGenerateSecondPrompt={handleGenerateSecondPrompt}
                            onDelete={handleDeleteOne}
                            onOpenDetail={setDetailRecordId}
                            onSelect={handleSelect}
                            selected={selectedSet.has(item.recordId)}
                          />
                        ))}
                      </section>
                    ) : (
                      <section className="list">
                        <div className="product-row header">
                          <div>选中</div>
                          <div>图片</div>
                          <div>商品标题</div>
                          <div>价格</div>
                          <div>店铺</div>
                          <div>AI状态</div>
                          <div>操作</div>
                        </div>
                        {items.map((item) => (
                          <ProductRow
                            detailActive={detailRecordId === item.recordId}
                            item={item}
                            key={item.recordId}
                            onAnalyze={handleAnalyze}
                            onGenerateVideoScript={handleGenerateVideoScript}
                            onGenerateSecondPrompt={handleGenerateSecondPrompt}
                            onDelete={handleDeleteOne}
                            onOpenDetail={setDetailRecordId}
                            onSelect={handleSelect}
                            selected={selectedSet.has(item.recordId)}
                          />
                        ))}
                      </section>
                    )}
                  </div>
                  <div className="right-col">
                    <ProductDetailsPanel item={detailItem} />
                  </div>
                </section>
              ) : null}
            </>
          ) : activeSection === "aiResults" ? (
            <>
              {error ? <div className="error-banner">{error}</div> : null}
              {loading ? <div className="loading">加载中...</div> : null}
              {!loading ? (
                <AIResultsPage
                  items={items}
                  onAnalyze={handleAnalyze}
                  onGenerateVideoScript={handleGenerateVideoScript}
                  onDebugVideoScript={handleDebugVideoScript}
                  onGenerateSecondPrompt={handleGenerateSecondPrompt}
                  onChangeVideoProductInfo={handleChangeVideoProductInfo}
                  promptPackLocaleOverrides={promptPackLocaleOverrides}
                  onChangePromptPackLocale={handleChangePromptPackLocale}
                  videoScriptLocaleOverrides={videoScriptLocaleOverrides}
                  onChangeVideoScriptLocale={handleChangeVideoScriptLocale}
                  onOpenProduct={handleOpenProduct}
                  videoProductInfoOverrides={videoProductInfoOverrides}
                />
              ) : null}
            </>
          ) : (
            <ApiKeyManagerSection apiBase={API_BASE} sessionStorageKey={API_KEY_MANAGER_SESSION_STORAGE_KEY} />
          )}
        </main>
      </div>
    </div>
  );
}
