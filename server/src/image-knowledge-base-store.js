const fs = require("fs/promises");
const path = require("path");

const configuredDataDir = String(process.env.DATA_DIR || "").trim();
const DATA_DIR = configuredDataDir ? path.resolve(configuredDataDir) : path.join(__dirname, "..", "data");
const CATEGORY_FILE = path.join(DATA_DIR, "categories.json");
const IMAGE_KB_FILE = path.join(DATA_DIR, "image-knowledge-base.json");

const FALLBACK_CATEGORY_ID = "__unassigned__";
const FALLBACK_CATEGORY_NAME = "未归类";

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function ensureJsonFile(filePath, fallbackJsonText) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(filePath);
  } catch (_error) {
    await fs.writeFile(filePath, fallbackJsonText, "utf8");
  }
}

function normalizeCategory(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const id = safeText(source.id || source.categoryId);
  const name = safeText(source.name || source.categoryName);
  if (!id || !name) {
    return null;
  }
  const pathItems = toArray(source.path || source.categoryPath || [name])
    .flatMap((item) =>
      safeText(item)
        .split(/[>/|]/)
        .map((segment) => safeText(segment))
        .filter(Boolean)
    )
    .filter(Boolean);
  return {
    id,
    name,
    path: pathItems,
    parentId: safeText(source.parentId) || null,
    active: source.active !== false,
    source: safeText(source.source, "website-sync"),
    updatedAt: safeText(source.updatedAt) || nowIso()
  };
}

function ensureFallbackCategory(categories) {
  const hasFallback = categories.some((item) => item.id === FALLBACK_CATEGORY_ID);
  if (hasFallback) {
    return categories;
  }
  return [
    ...categories,
    {
      id: FALLBACK_CATEGORY_ID,
      name: FALLBACK_CATEGORY_NAME,
      path: [FALLBACK_CATEGORY_NAME],
      parentId: null,
      active: true,
      source: "system",
      updatedAt: nowIso()
    }
  ];
}

async function loadCategories() {
  await ensureJsonFile(CATEGORY_FILE, "[]");
  const text = await fs.readFile(CATEGORY_FILE, "utf8");
  let parsed = [];
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    parsed = [];
  }
  const normalized = toArray(parsed).map(normalizeCategory).filter(Boolean);
  return ensureFallbackCategory(normalized);
}

async function saveCategories(categories) {
  const normalized = ensureFallbackCategory(toArray(categories).map(normalizeCategory).filter(Boolean));
  await ensureJsonFile(CATEGORY_FILE, "[]");
  await fs.writeFile(CATEGORY_FILE, JSON.stringify(normalized, null, 2), "utf8");
}

function mergeCategories(currentCategories, incomingCategories) {
  const now = nowIso();
  const currentMap = new Map(currentCategories.map((item) => [item.id, item]));
  const incomingMap = new Map();
  for (const item of toArray(incomingCategories).map(normalizeCategory).filter(Boolean)) {
    incomingMap.set(item.id, item);
  }

  const next = [];
  for (const incoming of incomingMap.values()) {
    const current = currentMap.get(incoming.id);
    next.push({
      ...current,
      ...incoming,
      active: true,
      updatedAt: now
    });
  }

  for (const current of currentMap.values()) {
    if (incomingMap.has(current.id)) {
      continue;
    }
    next.push({
      ...current,
      active: false,
      updatedAt: now
    });
  }

  return ensureFallbackCategory(next);
}

async function syncCategories(incomingCategories) {
  const current = await loadCategories();
  const merged = mergeCategories(current, incomingCategories);
  await saveCategories(merged);
  return merged;
}

function normalizeKnowledgeAnalysis(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    positivePrompt: safeText(source.positivePrompt),
    negativePrompt: safeText(source.negativePrompt),
    overallStyle: safeText(source.overallStyle),
    colorScheme: safeText(source.colorScheme),
    backgroundDescription: safeText(source.backgroundDescription),
    modelInfo: safeText(source.modelInfo),
    composition: safeText(source.composition),
    lightingAndTexture: safeText(source.lightingAndTexture),
    summary: safeText(source.summary)
  };
}

function normalizeKnowledgeItem(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const id = safeText(source.id || source.imageId);
  if (!id) {
    return null;
  }
  return {
    id,
    imageHash: safeText(source.imageHash),
    categoryId: safeText(source.categoryId),
    imageUrl: safeText(source.imageUrl),
    uploadedAt: safeText(source.uploadedAt) || nowIso(),
    updatedAt: safeText(source.updatedAt) || nowIso(),
    analysisModelVersion: safeText(source.analysisModelVersion || source.modelVersion, "claude-sonnet-4-6"),
    status: safeText(source.status, "processing"),
    error: safeText(source.error) || null,
    analysis: normalizeKnowledgeAnalysis(source.analysis),
    rawAnalysis: source.rawAnalysis || null
  };
}

function normalizeCompressedKnowledge(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sourceItemIds = toArray(source.sourceItemIds).map((item) => safeText(item)).filter(Boolean);
  return {
    modelVersion: safeText(source.modelVersion, "claude-sonnet-4-6"),
    generatedAt: safeText(source.generatedAt) || nowIso(),
    sourceItemIds,
    positivePrompt: safeText(source.positivePrompt),
    negativePrompt: safeText(source.negativePrompt),
    overallStyle: safeText(source.overallStyle),
    colorScheme: safeText(source.colorScheme),
    backgroundDescription: safeText(source.backgroundDescription),
    modelInfo: safeText(source.modelInfo),
    composition: safeText(source.composition),
    lightingAndTexture: safeText(source.lightingAndTexture),
    summary: safeText(source.summary)
  };
}

function normalizeKnowledgeCategory(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const categoryId = safeText(source.categoryId);
  if (!categoryId) {
    return null;
  }
  const items = toArray(source.items).map(normalizeKnowledgeItem).filter(Boolean);
  const totalLength = Number.isFinite(Number(source.totalLength)) ? Number(source.totalLength) : 0;
  const compressedKnowledge = source.compressedKnowledge ? normalizeCompressedKnowledge(source.compressedKnowledge) : null;
  return {
    categoryId,
    categoryName: safeText(source.categoryName, categoryId),
    updatedAt: safeText(source.updatedAt) || nowIso(),
    totalLength,
    compressedKnowledge,
    items
  };
}

function normalizeKnowledgeBase(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const inputCategories = source.categories && typeof source.categories === "object" ? source.categories : {};
  const categories = {};
  for (const [categoryId, value] of Object.entries(inputCategories)) {
    const normalized = normalizeKnowledgeCategory({
      ...value,
      categoryId: safeText(value?.categoryId, categoryId)
    });
    if (!normalized) {
      continue;
    }
    categories[normalized.categoryId] = normalized;
  }
  return {
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : 1,
    updatedAt: safeText(source.updatedAt) || nowIso(),
    categories
  };
}

async function loadImageKnowledgeBase() {
  await ensureJsonFile(IMAGE_KB_FILE, JSON.stringify({ version: 1, updatedAt: nowIso(), categories: {} }, null, 2));
  const text = await fs.readFile(IMAGE_KB_FILE, "utf8");
  try {
    return normalizeKnowledgeBase(JSON.parse(text));
  } catch (_error) {
    return normalizeKnowledgeBase({});
  }
}

async function saveImageKnowledgeBase(db) {
  const normalized = normalizeKnowledgeBase(db);
  normalized.updatedAt = nowIso();
  await ensureJsonFile(IMAGE_KB_FILE, JSON.stringify({ version: 1, updatedAt: nowIso(), categories: {} }, null, 2));
  await fs.writeFile(IMAGE_KB_FILE, JSON.stringify(normalized, null, 2), "utf8");
}

function ensureKnowledgeCategory(db, categoryId, categoryName = "") {
  if (!db.categories[categoryId]) {
    db.categories[categoryId] = {
      categoryId,
      categoryName: safeText(categoryName, categoryId),
      updatedAt: nowIso(),
      totalLength: 0,
      compressedKnowledge: null,
      items: []
    };
  } else if (categoryName) {
    db.categories[categoryId].categoryName = safeText(categoryName, db.categories[categoryId].categoryName);
  }
  db.categories[categoryId].updatedAt = nowIso();
  return db.categories[categoryId];
}

function findKnowledgeItemById(db, itemId) {
  for (const category of Object.values(db.categories)) {
    const index = category.items.findIndex((item) => item.id === itemId);
    if (index >= 0) {
      return {
        category,
        index,
        item: category.items[index]
      };
    }
  }
  return null;
}

function recalcCategoryTotalLength(category) {
  const completedItems = category.items.filter((item) => item.status === "completed");
  let total = 0;
  for (const item of completedItems) {
    const text = JSON.stringify(item.analysis || {});
    total += text.length;
  }
  category.totalLength = total;
  category.updatedAt = nowIso();
  return total;
}

function toKnowledgeSummary(item) {
  return {
    id: item.id,
    imageUrl: item.imageUrl,
    uploadedAt: item.uploadedAt,
    updatedAt: item.updatedAt,
    analysisModelVersion: item.analysisModelVersion,
    status: item.status,
    error: item.error || null,
    summary: safeText(item.analysis?.summary),
    analysis: item.analysis
  };
}

module.exports = {
  CATEGORY_FILE,
  IMAGE_KB_FILE,
  FALLBACK_CATEGORY_ID,
  FALLBACK_CATEGORY_NAME,
  loadCategories,
  saveCategories,
  syncCategories,
  loadImageKnowledgeBase,
  saveImageKnowledgeBase,
  ensureKnowledgeCategory,
  findKnowledgeItemById,
  recalcCategoryTotalLength,
  normalizeKnowledgeItem,
  normalizeCompressedKnowledge,
  toKnowledgeSummary
};
