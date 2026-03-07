export type PriceTier = {
  quantityLabel: string;
  unitPrice: number | null;
  unitPriceText?: string;
};

export type SkuDimension = {
  name: string;
  options: string[];
};

export type ProductAnalysisStatus = "idle" | "queued" | "processing" | "completed" | "failed";

export type ProductAnalysisResult = {
  materialAnalysis: string;
  appearanceDescription: string;
  colorAnalysis: string;
  sizeAndSpecs: string;
  usageAndTargetAudience: string;
  detailedDescription: string;
  sellingPoints: string[];
  procurementRisks: string[];
  whiteBackgroundImageUrl: string;
  referenceImageUrl: string;
  generatedAt: string | null;
};

export type ProductAnalysisState = {
  status: ProductAnalysisStatus;
  jobId: string | null;
  error: string | null;
  updatedAt: string | null;
  result: ProductAnalysisResult | null;
};

export type PromptGenerationStatus = "idle" | "processing" | "awaiting_category_confirmation" | "completed" | "failed";

export type CategoryReference = {
  categoryId: string;
  categoryName: string;
  confidence: number;
  reason: string;
};

export type PromptCard = {
  id: number;
  type: string;
  prompt: string;
  imageType: string;
  subjectDescription: string;
  sceneBackground: string;
  peopleOrProps: string;
  colorStyle: string;
  portugueseText: string;
  composition: string;
  moodKeywords: string;
};

export type PromptGenerationResult = {
  topSellingPoints: string[];
  mainImagePrompts: PromptCard[];
  detailImagePrompts: PromptCard[];
  styleParameters: {
    positivePrompt: string;
    negativePrompt: string;
    recommendedStyle: string;
    backgroundPlan: string;
    compositionGuidance: string;
    colorDirection: string;
    lightingStyle: string;
    productFocus: string;
    notes: string;
  };
  categoryReference: CategoryReference;
  matchedCategoryId: string;
  matchedCategoryName: string;
  knowledgeSummary: string;
  referenceImageUrl: string;
  optionalWhiteImageUrl: string;
  generatedAt: string | null;
};

export type PromptGenerationState = {
  status: PromptGenerationStatus;
  error: string | null;
  updatedAt: string | null;
  result: PromptGenerationResult | null;
  categoryRecognition: CategoryReference;
  confidenceThreshold: number;
  candidateCategories: Array<{
    id: string;
    name: string;
    path: string[];
  }>;
};

export type SecondPromptGenerationStatus = "idle" | "processing" | "completed" | "failed";

export type SecondPromptGenerationResult = {
  referenceImageUrl: string;
  templateVersion: string;
  detailAspectRatio: "1:1" | "9:16";
  requestContext?: {
    productReference?: {
      title?: string;
      shop?: string;
      url?: string;
    };
    firstPassAnalysis?: Record<string, unknown>;
    productProfile?: {
      appearanceDetails?: string;
      materialDetails?: string;
      shapeDetails?: string;
      sizeDetails?: string;
      colorDetails?: string;
    } | null;
    locale?: {
      targetMarket?: string;
      promptLanguage?: string;
      inImageTextLanguage?: string;
    };
    template?: {
      version?: string;
      required?: boolean;
      charLength?: number;
    };
    qualityRetryUsed?: boolean;
  };
  rawModelText?: string;
  rawRepairedTextV1?: string;
  rawRepairedTextV2?: string;
  rawModelJson?: Record<string, unknown> | null;
  parseWarning?: string;
  output: Record<string, unknown> | null;
  outputText: string;
  generatedAt: string | null;
};

export type SecondPromptGenerationState = {
  status: SecondPromptGenerationStatus;
  jobId: string | null;
  error: string | null;
  updatedAt: string | null;
  result: SecondPromptGenerationResult | null;
};

export type VideoScriptGenerationStatus = "idle" | "processing" | "completed" | "failed";

export type VideoScriptGenerationResult = {
  inputPayload: {
    product_images: string[];
    product_params: Record<string, unknown>;
  } | null;
  requestContext?: {
    locale?: {
      targetMarket?: string;
      promptLanguage?: string;
      inImageTextLanguage?: string;
    };
  } | null;
  modelRequest: {
    endpoint: string;
    requestBody: Record<string, unknown> | null;
    sentAt: string | null;
  } | null;
  outputPayload: {
    product_info: Record<string, unknown> | null;
    script_set_1: Record<string, unknown> | null;
    script_set_2: Record<string, unknown> | null;
    script_set_3: Record<string, unknown> | null;
    scripts: Array<{
      script_id: string;
      digital_human_base_image_prompt: string;
      shots: Array<{
        shot_id: string;
        image_prompt: string;
        video_prompt: string;
        manual_shoot_required: boolean;
        manual_shoot_script: string | null;
      }>;
    }>;
    production_notes: Record<string, unknown> | null;
    raw: Record<string, unknown> | null;
  } | null;
  scriptPackages: Array<{
    scriptId: string;
    digitalHumanBaseImagePrompt: string;
    shots: Array<{
      shotId: string;
      imagePrompt: string;
      videoPrompt: string;
      manualShootRequired: boolean;
      manualShootScript: string;
    }>;
  }>;
  scriptSets: Array<{
    setKey: "script_set_1" | "script_set_2" | "script_set_3";
    scriptName: string;
    strategy: string;
    targetAudience: string;
    totalDuration: string;
    videoStructure: string;
    clips: Array<{
      clipNumber: number | null;
      duration: string;
      sceneType: string;
      sceneDescription: string;
      marketingPurpose: string;
      generationMethod: string;
      aiOrReal: string;
      firstFramePrompt: string;
      lastFramePrompt: string;
      videoAudioPrompt: string;
      imageGenerationPrompt: string;
      videoGenerationPrompt: string;
      audioDescription: string;
      narrationPortuguese: string;
      visualElements: string;
      styleNotes: string;
    }>;
    raw: Record<string, unknown>;
  }>;
  generatedAt: string | null;
};

export type VideoScriptGenerationState = {
  status: VideoScriptGenerationStatus;
  error: string | null;
  updatedAt: string | null;
  result: VideoScriptGenerationResult | null;
};

export type VideoClipGenerationTaskStatus = "idle" | "queued" | "processing" | "succeeded" | "failed";

export type VideoClipGenerationTask = {
  key: string;
  setKey: string;
  clipIndex: number;
  status: VideoClipGenerationTaskStatus;
  jobId: string | null;
  taskId: string | null;
  prompt: string;
  firstFrameUrl: string;
  lastFrameUrl: string;
  urls?: string[];
  firstFrameName: string;
  lastFrameName: string;
  aspectRatio: string;
  retryCount: number;
  maxRetries: number;
  videoUrl: string;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
};

export type VideoClipGenerationState = {
  updatedAt: string | null;
  items: VideoClipGenerationTask[];
};

export type ProductRecord = {
  recordId: string;
  productId: string;
  title: string;
  url: string;
  shopName: string;
  images: string[];
  triggeredImage: string;
  skuDimensions: SkuDimension[];
  skuItems: Array<{
    attrs: string[];
    price: number | null;
    stock: number | null;
    stockText?: string;
  }>;
  priceTiers: PriceTier[];
  priceMin: number | null;
  priceMax: number | null;
  productAttributes?: Array<{
    name: string;
    value: string;
  }>;
  packageSpecs?: string[];
  categoryId?: string;
  categoryName?: string;
  categoryPath?: string[];
  capturedAt: string;
  source: string;
  analysis?: ProductAnalysisState;
  promptGeneration?: PromptGenerationState;
  videoScriptGeneration?: VideoScriptGenerationState;
  secondPromptGeneration?: SecondPromptGenerationState;
  videoClipGeneration?: VideoClipGenerationState;
};

export type ApiListResponse = {
  total: number;
  items: ProductRecord[];
};

export type AnalyzeTriggerResponse = {
  ok: boolean;
  accepted: boolean;
  recordId: string;
  jobId: string;
  status: ProductAnalysisStatus;
};

export type AnalyzeStatusResponse = {
  ok: boolean;
  recordId: string;
  analysis: ProductAnalysisState;
  promptGeneration?: PromptGenerationState;
  videoScriptGeneration?: VideoScriptGenerationState;
  secondPromptGeneration?: SecondPromptGenerationState;
  videoClipGeneration?: VideoClipGenerationState;
};

export type GeneratePromptResponse = {
  ok: boolean;
  recordId: string;
  promptGeneration: PromptGenerationState;
  code?: string;
  message?: string;
};

export type GenerateSecondPromptResponse = {
  ok: boolean;
  accepted?: boolean;
  recordId: string;
  jobId?: string;
  status?: SecondPromptGenerationStatus;
  secondPromptGeneration?: SecondPromptGenerationState;
  code?: string;
  message?: string;
};

export type SecondPromptStatusResponse = {
  ok: boolean;
  recordId: string;
  secondPromptGeneration: SecondPromptGenerationState;
};

export type KnowledgeBaseCategory = {
  id: string;
  name: string;
  path: string[];
  stats?: {
    totalItems: number;
    completedItems: number;
    totalLength: number;
    compressed: boolean;
    compressedAt: string | null;
  };
};

export type KnowledgeBaseItem = {
  id: string;
  imageUrl: string;
  uploadedAt: string;
  updatedAt: string;
  analysisModelVersion: string;
  status: "processing" | "completed" | "failed";
  error: string | null;
  summary: string;
  analysis: {
    positivePrompt: string;
    negativePrompt: string;
    overallStyle: string;
    colorScheme: string;
    backgroundDescription: string;
    modelInfo: string;
    composition: string;
    lightingAndTexture: string;
    summary: string;
  };
};

export type GenerateVideoScriptResponse = {
  ok: boolean;
  recordId: string;
  videoScriptGeneration: VideoScriptGenerationState;
  debug?: boolean;
  code?: string;
  message?: string;
};

export type GenerateVeoVideoResponse = {
  ok: boolean;
  taskId?: string | null;
  status?: string;
  videoUrl?: string;
  message?: string;
  createResponse?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  updatedAt?: string;
};

export type GenerateClipVideoResponse = {
  ok: boolean;
  accepted?: boolean;
  recordId: string;
  task?: VideoClipGenerationTask | null;
  videoClipGeneration?: VideoClipGenerationState;
  message?: string;
};

export type VideoClipStatusResponse = {
  ok: boolean;
  recordId: string;
  videoClipGeneration: VideoClipGenerationState;
};

