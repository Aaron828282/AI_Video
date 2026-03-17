const API_BASE_STORAGE_KEY = "apiBase";
const ONLINE_API_BASE = "https://ai-auto-1688-server-production.up.railway.app";
const LOCAL_API_BASE = "http://127.0.0.1:8790";
const DEFAULT_API_BASE = ONLINE_API_BASE;
const LEGACY_LOCAL_API_BASES = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);
const RECENT_KEY = "recentRecords";
const MAX_RECENT = 20;
let apiBase = DEFAULT_API_BASE;

const panelShell = document.getElementById("panelShell");
const togglePanelBtn = document.getElementById("togglePanelBtn");
const dropZone = document.getElementById("dropZone");
const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const retryBtn = document.getElementById("retryBtn");
const apiBaseModeSelect = document.getElementById("apiBaseMode");
const apiBaseInput = document.getElementById("apiBaseInput");
const apiBaseSaveBtn = document.getElementById("apiBaseSaveBtn");
const apiBaseHint = document.getElementById("apiBaseHint");
const latestCard = document.getElementById("latestCard");
const latestImage = document.getElementById("latestImage");
const latestTitle = document.getElementById("latestTitle");
const latestPrice = document.getElementById("latestPrice");
const latestShop = document.getElementById("latestShop");
const latestCapturedAt = document.getElementById("latestCapturedAt");
const recentList = document.getElementById("recentList");

let pendingUploadRecord = null;

const SUPPORTED_SITES_TEXT = "1688/淘宝/天猫/拼多多";

function detectSiteType(url) {
  const href = String(url || "");
  if (!/^https?:\/\//i.test(href)) {
    return "unknown";
  }
  try {
    const hostname = new URL(href).hostname.toLowerCase();
    if (hostname.endsWith("1688.com")) {
      return "1688";
    }
    if (hostname.endsWith("taobao.com") || hostname.endsWith("tmall.com")) {
      return "taobao";
    }
    if (hostname.endsWith("yangkeduo.com") || hostname.endsWith("pinduoduo.com")) {
      return "pdd";
    }
  } catch (_error) {
    return "unknown";
  }
  return "unknown";
}

function normalizeApiBase(value) {
  const base = String(value || "").trim();
  if (!base) {
    return "";
  }
  return base.replace(/\/+$/, "");
}

function buildApiUrl(pathname) {
  const normalizedPath = String(pathname || "").startsWith("/") ? pathname : `/${String(pathname || "")}`;
  const base = normalizeApiBase(apiBase);
  return `${base}${normalizedPath}`;
}

function shouldMigrateApiBase(base) {
  const normalized = normalizeApiBase(base).toLowerCase();
  if (!normalized) {
    return false;
  }
  return LEGACY_LOCAL_API_BASES.has(normalized);
}

function inferApiBaseMode(base) {
  const normalized = normalizeApiBase(base).toLowerCase();
  if (normalized === ONLINE_API_BASE.toLowerCase()) {
    return "online";
  }
  if (normalized === LOCAL_API_BASE.toLowerCase() || normalized === "http://localhost:8790") {
    return "local";
  }
  return "custom";
}

function setApiBaseHint(text, isError = false) {
  if (!apiBaseHint) {
    return;
  }
  apiBaseHint.textContent = text;
  apiBaseHint.classList.toggle("error", Boolean(isError));
}

function syncApiBaseControls(base) {
  if (!apiBaseModeSelect || !apiBaseInput) {
    return;
  }
  const mode = inferApiBaseMode(base);
  apiBaseModeSelect.value = mode;
  if (mode === "online") {
    apiBaseInput.value = ONLINE_API_BASE;
  } else if (mode === "local") {
    apiBaseInput.value = LOCAL_API_BASE;
  } else {
    apiBaseInput.value = normalizeApiBase(base);
  }
}

async function persistApiBase(nextBase) {
  const normalized = normalizeApiBase(nextBase);
  if (!/^https?:\/\//i.test(normalized)) {
    setApiBaseHint("地址格式错误，请输入 http:// 或 https:// 开头的地址。", true);
    return false;
  }
  apiBase = normalized;
  await chrome.storage.sync.set({ [API_BASE_STORAGE_KEY]: apiBase });
  syncApiBaseControls(apiBase);
  setApiBaseHint(`当前接收地址：${apiBase}`);
  return true;
}

function setStatus(state, text, { showRetry = false } = {}) {
  statusBox.dataset.state = state;
  statusText.textContent = text;
  retryBtn.classList.toggle("hidden", !showRetry);
}

function toCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Price N/A";
  }
  return `CNY ${Number(value).toFixed(2)}`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch (_error) {
    return iso || "-";
  }
}

function renderLatest(item) {
  if (!item) {
    latestCard.classList.add("hidden");
    return;
  }
  latestCard.classList.remove("hidden");
  latestImage.src = item.triggeredImage || "";
  latestTitle.textContent = item.title || "Untitled Product";
  latestTitle.href = item.url || "about:blank";
  const priceText =
    item.priceMin !== null && item.priceMax !== null
      ? `${toCurrency(item.priceMin)} - ${toCurrency(item.priceMax)}`
      : toCurrency(item.priceMin);
  latestPrice.textContent = `Price: ${priceText}`;
  latestShop.textContent = `Shop: ${item.shopName || "Unknown"}`;
  latestCapturedAt.textContent = `Captured At: ${formatDate(item.capturedAt)}`;
}

function renderRecent(items) {
  recentList.innerHTML = "";
  if (!items?.length) {
    const li = document.createElement("li");
    li.innerHTML = '<div class="line-2">No local capture records</div>';
    recentList.appendChild(li);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="line-1">${item.title || "Untitled Product"}</div>
      <div class="line-2">${toCurrency(item.priceMin)} | ${formatDate(item.capturedAt)}</div>
    `;
    li.title = item.url || "";
    li.addEventListener("click", () => {
      if (item.url) {
        chrome.tabs.create({ url: item.url });
      }
    });
    recentList.appendChild(li);
  });
}

async function getRecentRecords() {
  const data = await chrome.storage.local.get(RECENT_KEY);
  return Array.isArray(data[RECENT_KEY]) ? data[RECENT_KEY] : [];
}

async function saveRecentRecord(item) {
  const current = await getRecentRecords();
  const next = [item, ...current.filter((record) => record.recordId !== item.recordId)].slice(0, MAX_RECENT);
  await chrome.storage.local.set({ [RECENT_KEY]: next });
  renderRecent(next);
}

function isLikelyImageUrl(url) {
  const value = String(url || "").trim();
  if (!value) {
    return false;
  }
  if (/^data:image\//i.test(value)) {
    return true;
  }
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    const pathname = String(parsed.pathname || "").toLowerCase();
    const hostname = String(parsed.hostname || "").toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:$|[?#])/.test(pathname)) {
      return true;
    }
    if (/alicdn\.com$/.test(hostname) && pathname.includes("/img/")) {
      return true;
    }
    if (/taobaocdn\.com$/.test(hostname)) {
      return true;
    }
    if (/(pddimg|pddpic)\.com$/.test(hostname)) {
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
}

function normalize1688ImageUrl(url) {
  const value = String(url || "").trim();
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (!/alicdn\.com$/i.test(parsed.hostname)) {
      return value;
    }
    const fixedPath = String(parsed.pathname || "").replace(/(\.(?:jpe?g|png|gif|bmp))_\.(?:webp|avif)$/i, "$1");
    if (fixedPath && fixedPath !== parsed.pathname) {
      parsed.pathname = fixedPath;
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    }
  } catch (_error) {
    return value;
  }
  return value;
}

function extractImageFromTransfer(dataTransfer) {
  const uri = (dataTransfer.getData("text/uri-list") || "").split("\n").map((item) => item.trim()).filter(Boolean);
  const text = dataTransfer.getData("text/plain") || "";
  const html = dataTransfer.getData("text/html") || "";

  const htmlCandidates = Array.from(html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi))
    .map((match) => String(match?.[1] || "").trim())
    .filter(Boolean);
  const textCandidates = text
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = [...uri, ...htmlCandidates, ...textCandidates];
  for (const candidate of candidates) {
    const normalized = normalize1688ImageUrl(candidate);
    if (isLikelyImageUrl(normalized)) {
      return normalized;
    }
  }
  return "";
}

function buildRecordId(productId, capturedAt) {
  return `${productId || "unknown"}_${capturedAt}`;
}

async function uploadProduct(product) {
  const response = await fetch(buildApiUrl("/api/products"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product)
  });
  if (!response.ok) {
    throw new Error(`上传失败: ${response.status}`);
  }
}

async function scrapeByActiveTab(droppedImage) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error("无法获取当前标签页");
  }
  const siteType = detectSiteType(activeTab.url);
  if (siteType === "unknown") {
    throw new Error(`请在支持的商品页拖拽图片（${SUPPORTED_SITES_TEXT}）`);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    args: [droppedImage, siteType],
    func: (injectedImage, injectedSiteType) => {
      const MAX_TEXT_SCAN_LINES = 1500;

      const safeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const toAbs = (url) => {
        if (!url) {
          return "";
        }
        try {
          return new URL(url, location.href).href;
        } catch (_error) {
          return "";
        }
      };
      const unique = (values) => [...new Set(values.filter(Boolean))];
      const isLikelyImageUrl = (url) => {
        const value = safeText(url);
        if (!value) {
          return false;
        }
        if (/^data:image\//i.test(value)) {
          return true;
        }
        if (!/^https?:\/\//i.test(value)) {
          return false;
        }
        try {
          const parsed = new URL(value);
          const pathname = safeText(parsed.pathname).toLowerCase();
          const hostname = safeText(parsed.hostname).toLowerCase();
          if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:$|[?#])/.test(pathname)) {
            return true;
          }
          if (/alicdn\.com$/.test(hostname) && pathname.includes("/img/")) {
            return true;
          }
          if (/taobaocdn\.com$/.test(hostname)) {
            return true;
          }
          if (/(pddimg|pddpic)\.com$/.test(hostname)) {
            return true;
          }
        } catch (_error) {
          return false;
        }
        return false;
      };
      const normalize1688ImageUrlLocal = (url) => {
        const value = String(url || "").trim();
        if (!/^https?:\/\//i.test(value)) {
          return value;
        }
        try {
          const parsed = new URL(value);
          if (!/alicdn\.com$/i.test(parsed.hostname)) {
            return value;
          }
          const fixedPath = String(parsed.pathname || "").replace(/(\.(?:jpe?g|png|gif|bmp))_\.(?:webp|avif)$/i, "$1");
          if (fixedPath && fixedPath !== parsed.pathname) {
            parsed.pathname = fixedPath;
            parsed.search = "";
            parsed.hash = "";
            return parsed.href;
          }
        } catch (_error) {
          return value;
        }
        return value;
      };
      const normalizeImageUrl = (value) => {
        const absolute = normalize1688ImageUrlLocal(toAbs(value));
        return isLikelyImageUrl(absolute) ? absolute : "";
      };
      const collectBodyLines = () =>
        document.body.innerText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, MAX_TEXT_SCAN_LINES);

      const extractFirstPrice = (text) => {
        const cleaned = safeText(text).replace(/[,，]/g, "");
        if (!cleaned) {
          return null;
        }
        const match = cleaned.match(/(?:¥|￥)?\s*(\d+(?:\.\d+)?)/);
        return match ? Number(match[1]) : null;
      };

      const getMetaContent = (selector) => safeText(document.querySelector(selector)?.getAttribute("content"));

      const collectMainPrice = (selectors) => {
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          const text = safeText(node?.textContent || node?.getAttribute("content"));
          const price = extractFirstPrice(text);
          if (price !== null) {
            return price;
          }
        }
        return null;
      };

      const inferPriceTiers = (unitKeywords) => {
        const lines = collectBodyLines();
        const tiers = [];
        for (const line of lines) {
          if (!/(¥|￥)/.test(line)) {
            continue;
          }
          if (!unitKeywords.test(line)) {
            continue;
          }
          const priceMatch = line.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
          if (!priceMatch) {
            continue;
          }

          const quantityMatch =
            line.match(/(\d+\s*(?:-|~|到)?\s*\d*\s*(?:件|套|个|pcs|箱|袋|支|只|米|卷|公斤|kg))/i) ||
            line.match(/(\d+\s*(?:件|套|个|pcs|箱|袋|支|只|米|卷|公斤|kg)\s*起批)/i);
          const quantityLabel = quantityMatch ? quantityMatch[1] : "Min Qty";

          tiers.push({
            quantityLabel,
            unitPrice: Number(priceMatch[1]),
            unitPriceText: `${priceMatch[0]}`
          });
          if (tiers.length >= 8) {
            break;
          }
        }
        return tiers;
      };

      const collectOptionGroups = () => {
        const seen = new Set();
        const groups = [];
        const list = Array.from(document.querySelectorAll("li, div, dl, section")).slice(0, 1200);

        for (const container of list) {
          const optionNodes = container.querySelectorAll("button, li, a, span, div");
          if (optionNodes.length < 2 || optionNodes.length > 40) {
            continue;
          }

          const options = unique(
            Array.from(optionNodes)
              .map((node) => safeText(node.textContent))
              .filter((text) => text && text.length <= 30)
              .filter((text) => /[A-Za-z0-9xX*×\-]|mm|cm|inch|寸|色|规格|型号|套|件|cm|mm/.test(text))
          ).slice(0, 16);

          if (options.length < 2) {
            continue;
          }

          const labelNode =
            container.querySelector("label, dt, h4, h5, .title, .name, [class*=\"label\"], [class*=\"title\"]") ||
            container.previousElementSibling;
          const labelText = safeText(labelNode?.textContent);
          if (!labelText || labelText.length > 20) {
            continue;
          }

          const key = `${labelText}__${options.join("|")}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          groups.push({
            name: labelText,
            options
          });
          if (groups.length >= 8) {
            break;
          }
        }
        return groups;
      };

      const collectSkuItems = () => {
        const rows = Array.from(document.querySelectorAll("table tr, [role=\"row\"], .table-row, .sku-row")).slice(0, 400);
        const items = [];
        for (const row of rows) {
          const rowText = safeText(row.textContent);
          if (!rowText || !/[¥￥]\s*\d/.test(rowText)) {
            continue;
          }

          const cells = Array.from(row.querySelectorAll("td, th, div, span"))
            .map((cell) => safeText(cell.textContent))
            .filter(Boolean);
          const attrs = unique(
            cells.filter((text) => text.length <= 40 && !/[¥￥]\s*\d/.test(text) && !/^\d+$/.test(text))
          ).slice(0, 5);

          const priceMatch = rowText.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
          const stockMatch =
            rowText.match(/[|｜]\s*(\d{1,9})/) ||
            rowText.match(/库存[:：]?\s*(\d{1,9})/i) ||
            rowText.match(/(\d{1,9})\s*(?:件|套|个|pcs)\b/i);

          items.push({
            attrs,
            price: priceMatch ? Number(priceMatch[1]) : null,
            stock: stockMatch ? Number(stockMatch[1]) : null
          });
          if (items.length >= 60) {
            break;
          }
        }
        return items;
      };

      const collectAttributesFromTables = () => {
        const blocks = [];
        const rows = Array.from(document.querySelectorAll("table tr, .detail-attrs-row, .attributes-row")).slice(0, 800);
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll("th, td, dt, dd, span"))
            .map((cell) => safeText(cell.textContent))
            .filter(Boolean);
          if (cells.length < 2) {
            continue;
          }
          for (let i = 0; i + 1 < cells.length; i += 2) {
            const name = cells[i];
            const value = cells[i + 1];
            if (!name || !value) {
              continue;
            }
            if (name.length > 20 || value.length > 120) {
              continue;
            }
            blocks.push({ name, value });
          }
          if (blocks.length >= 120) {
            break;
          }
        }
        return blocks;
      };

      const collectPackagingSpecs = () => {
        const lines = collectBodyLines();
        const items = [];
        for (const line of lines) {
          if (!/(mm|cm|kg|g|尺寸|规格|重量|长|宽|高)/i.test(line)) {
            continue;
          }
          if (line.length < 4 || line.length > 80) {
            continue;
          }
          items.push(line);
          if (items.length >= 80) {
            break;
          }
        }
        return unique(items);
      };

      const findTitle = (selectors) => {
        for (const selector of selectors) {
          const text = safeText(document.querySelector(selector)?.textContent);
          if (text && text.length > 4) {
            return text;
          }
        }
        const ogTitle = getMetaContent("meta[property=\"og:title\"]");
        if (ogTitle) {
          return ogTitle;
        }
        return safeText(document.title.replace(/[-_].*$/, "")) || "Untitled Product";
      };

      const findShopName = (selectors) => {
        for (const selector of selectors) {
          const text = safeText(document.querySelector(selector)?.textContent);
          if (text) {
            return text;
          }
        }
        const ogSite = getMetaContent("meta[property=\"og:site_name\"]");
        return ogSite || "Unknown Shop";
      };

      const collectCategoryPath = (selectorCandidates) => {
        for (const selector of selectorCandidates) {
          const parts = unique(
            Array.from(document.querySelectorAll(selector))
              .map((node) => safeText(node.textContent))
              .filter((text) => text && text.length <= 30)
          );
          if (parts.length >= 2) {
            return parts.slice(0, 8);
          }
        }
        return [];
      };

      const collectProductImages = (selectors) => {
        const candidates = [];
        for (const selector of selectors) {
          const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 200);
          for (const node of nodes) {
            const attrs = [
              node.currentSrc,
              node.getAttribute("src"),
              node.getAttribute("data-src"),
              node.getAttribute("data-lazy-src"),
              node.getAttribute("data-ks-lazyload"),
              node.getAttribute("data-imgsrc"),
              node.getAttribute("data-origin"),
              node.getAttribute("data-zoom"),
              node.getAttribute("data-srcset")
            ];
            for (const raw of attrs) {
              const normalized = normalizeImageUrl(raw);
              if (normalized) {
                candidates.push(normalized);
              }
            }
          }
          if (candidates.length >= 30) {
            break;
          }
        }
        return unique(candidates).slice(0, 16);
      };

      const collectProductId = (href) => {
        const match =
          href.match(/offer\/(\d+)\.html/i) ||
          href.match(/detail\/(\d+)\.html/i) ||
          href.match(/[?&]id=(\d+)/i) ||
          href.match(/[?&]item_id=(\d+)/i) ||
          href.match(/[?&]goods_id=(\d+)/i);
        return match ? match[1] : `unknown_${Date.now()}`;
      };

      const buildPayload = ({
        href,
        title,
        shopName,
        images,
        triggeredImage,
        skuDimensions,
        skuItems,
        priceTiers,
        priceMin,
        priceMax,
        productAttributes,
        packageSpecs,
        categoryPath
      }) => {
        const categoryName = categoryPath.length ? categoryPath[categoryPath.length - 1] : "";
        const categoryId = categoryPath.length ? categoryPath.join(">") : "";
        return {
          productId: collectProductId(href),
          title,
          url: href,
          shopName,
          images,
          triggeredImage,
          skuDimensions,
          skuItems,
          priceTiers,
          priceMin,
          priceMax,
          productAttributes,
          packageSpecs,
          categoryId,
          categoryName,
          categoryPath,
          capturedAt: new Date().toISOString(),
          source: "chrome-extension"
        };
      };

      const scrape1688 = () => {
        const href = location.href;
        const scrapedImages = collectProductImages([
          ".magnifier-image img",
          ".detail-gallery img",
          "[class*=\"gallery\"] img",
          "[class*=\"sku\"] img",
          ".detail-gallery-list img",
          ".offer-img img",
          "img"
        ]);
        const droppedImage = normalizeImageUrl(injectedImage || "");
        const triggeredImage = droppedImage || scrapedImages[0] || "";
        const images = unique([triggeredImage, ...scrapedImages]).slice(0, 16);
        const title = findTitle(["h1", ".d-title", ".title-text", ".offer-title", "[class*=\"title\"] h1"]);
        const shopName = findShopName([".company-name", ".mod-detail-CompanyName a", "[class*=\"shop-name\"]", "[class*=\"companyName\"]"]);
        const categoryPath = collectCategoryPath([
          ".breadcrumb a",
          "[class*=\"breadcrumb\"] a",
          ".mod-breadcrumb a",
          "[data-spm-anchor-id*=\"breadcrumb\"] a",
          ".next-breadcrumb-item a",
          ".crumb a"
        ]);
        const priceTiers = inferPriceTiers(/(起批|件|套|个|pcs|箱|袋|支|只|米|卷|公斤|kg)/i);
        const skuDimensions = collectOptionGroups();
        const skuItems = collectSkuItems();
        const productAttributes = collectAttributesFromTables();
        const packageSpecs = collectPackagingSpecs();
        const allPriceCandidates = [
          ...priceTiers.map((tier) => tier.unitPrice),
          ...skuItems.map((sku) => sku.price),
          collectMainPrice([
            "[class*=\"price\"] [class*=\"value\"]",
            "[class*=\"priceDisplay\"]",
            "[class*=\"price\"]",
            ".price",
            ".od-pc-offer-price",
            ".mod-detail-price"
          ])
        ].filter((num) => Number.isFinite(num));
        const priceMin = allPriceCandidates.length ? Math.min(...allPriceCandidates) : null;
        const priceMax = allPriceCandidates.length ? Math.max(...allPriceCandidates) : null;
        return buildPayload({
          href,
          title,
          shopName,
          images,
          triggeredImage,
          skuDimensions,
          skuItems,
          priceTiers,
          priceMin,
          priceMax,
          productAttributes,
          packageSpecs,
          categoryPath
        });
      };

      const scrapeTaobao = () => {
        const href = location.href;
        const scrapedImages = collectProductImages([
          "#J_ThumbView img",
          "#J_UlThumb img",
          "#J_DivItemDesc img",
          "[class*=\"thumb\"] img",
          "[class*=\"gallery\"] img",
          "[data-spm*=\"pic\"] img",
          "img"
        ]);
        const droppedImage = normalizeImageUrl(injectedImage || "");
        const triggeredImage = droppedImage || scrapedImages[0] || "";
        const images = unique([triggeredImage, ...scrapedImages]).slice(0, 16);
        const title =
          safeText(getMetaContent("meta[name=\"title\"]")) ||
          safeText(getMetaContent("meta[property=\"og:title\"]")) ||
          findTitle(["#J_Title h3", "#J_Title", ".tb-main-title", "h1", "[data-title]"]);
        const shopName = findShopName([".shop-name", "#J_ShopInfo .shop-name", ".shop-info .shop-name", "[class*=\"shop\"] a", ".si-provider a"]);
        const categoryPath = collectCategoryPath([".tb-crumbs a", "[class*=\"breadcrumb\"] a", ".crumbs a"]);
        const priceTiers = [];
        const skuDimensions = collectOptionGroups();
        const skuItems = collectSkuItems();
        const productAttributes = collectAttributesFromTables();
        const packageSpecs = collectPackagingSpecs();
        const priceMin =
          collectMainPrice([
            ".tb-rmb-num",
            "#J_StrPrice .tb-rmb-num",
            "#J_PromoPrice .tb-rmb-num",
            "[class*=\"price\"] [class*=\"num\"]",
            "meta[property=\"product:price:amount\"]",
            "meta[property=\"og:price:amount\"]",
            "meta[name=\"data-price\"]"
          ]) || extractFirstPrice(getMetaContent("meta[itemprop=\"price\"]"));
        const priceMax = priceMin;
        return buildPayload({
          href,
          title,
          shopName,
          images,
          triggeredImage,
          skuDimensions,
          skuItems,
          priceTiers,
          priceMin,
          priceMax,
          productAttributes,
          packageSpecs,
          categoryPath
        });
      };

      const scrapePdd = () => {
        const href = location.href;
        const scrapedImages = collectProductImages([
          "[class*=\"goods\"] img",
          "[class*=\"thumb\"] img",
          "[class*=\"gallery\"] img",
          "img"
        ]);
        const droppedImage = normalizeImageUrl(injectedImage || "");
        const triggeredImage = droppedImage || scrapedImages[0] || "";
        const images = unique([triggeredImage, ...scrapedImages]).slice(0, 16);
        const title =
          safeText(getMetaContent("meta[property=\"og:title\"]")) ||
          findTitle(["h1", "[class*=\"title\"]", "[class*=\"goods\"] [class*=\"title\"]"]);
        const shopName = findShopName(["[class*=\"mall\"] [class*=\"name\"]", "[class*=\"shop\"] [class*=\"name\"]", "[class*=\"store\"] [class*=\"name\"]"]);
        const categoryPath = collectCategoryPath(["[class*=\"breadcrumb\"] a", ".crumb a"]);
        const priceTiers = [];
        const skuDimensions = collectOptionGroups();
        const skuItems = collectSkuItems();
        const productAttributes = collectAttributesFromTables();
        const packageSpecs = collectPackagingSpecs();
        const priceMin = collectMainPrice([
          "[class*=\"price\"]",
          "[class*=\"group\"] [class*=\"price\"]",
          "meta[property=\"og:price:amount\"]",
          "meta[itemprop=\"price\"]"
        ]);
        const priceMax = priceMin;
        return buildPayload({
          href,
          title,
          shopName,
          images,
          triggeredImage,
          skuDimensions,
          skuItems,
          priceTiers,
          priceMin,
          priceMax,
          productAttributes,
          packageSpecs,
          categoryPath
        });
      };

      const siteType = injectedSiteType;
      if (siteType === "1688") {
        return scrape1688();
      }
      if (siteType === "taobao") {
        return scrapeTaobao();
      }
      if (siteType === "pdd") {
        return scrapePdd();
      }
      return scrape1688();
    }
  });

  const data = results?.[0]?.result;
  if (!data) {
    throw new Error("抓取失败");
  }
  if (!data.triggeredImage) {
    throw new Error("当前页面未找到可用商品图片");
  }

  return {
    ...data,
    recordId: buildRecordId(data.productId, data.capturedAt)
  };
}

async function handleDrop(dataTransfer) {
  const droppedImage = extractImageFromTransfer(dataTransfer);

  setStatus("loading", "正在抓取商品...");
  const product = await scrapeByActiveTab(droppedImage);
  await saveRecentRecord(product);
  renderLatest(product);

  try {
    await uploadProduct(product);
    pendingUploadRecord = null;
    setStatus("success", "抓取并上传成功");
  } catch (error) {
    pendingUploadRecord = product;
    setStatus("error", `${error.message}，已本地缓存`, { showRetry: true });
  }
}

function bindDragEvents() {
  const enter = (event) => {
    event.preventDefault();
    dropZone.classList.add("is-hover");
    setStatus("hover", "松开鼠标开始抓取");
  };
  const leave = (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-hover");
    setStatus("idle", "等待拖拽");
  };

  dropZone.addEventListener("dragenter", enter);
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  dropZone.addEventListener("dragleave", leave);
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-hover");
    try {
      await handleDrop(event.dataTransfer);
    } catch (error) {
      setStatus("error", error.message || "抓取失败", { showRetry: Boolean(pendingUploadRecord) });
    }
  });
}

function bindRetry() {
  retryBtn.addEventListener("click", async () => {
    if (!pendingUploadRecord) {
      setStatus("idle", "等待拖拽");
      return;
    }
    setStatus("loading", "正在重试上传...");
    try {
      await uploadProduct(pendingUploadRecord);
      pendingUploadRecord = null;
      setStatus("success", "重试上传成功");
    } catch (error) {
      setStatus("error", error.message || "重试失败", { showRetry: true });
    }
  });
}

function bindCollapse() {
  togglePanelBtn.addEventListener("click", () => {
    panelShell.classList.toggle("collapsed");
  });
}

function bindApiBaseControls() {
  if (!apiBaseModeSelect || !apiBaseInput || !apiBaseSaveBtn) {
    return;
  }

  apiBaseModeSelect.addEventListener("change", () => {
    if (apiBaseModeSelect.value === "online") {
      apiBaseInput.value = ONLINE_API_BASE;
    } else if (apiBaseModeSelect.value === "local") {
      apiBaseInput.value = LOCAL_API_BASE;
    }
  });

  apiBaseSaveBtn.addEventListener("click", async () => {
    const mode = apiBaseModeSelect.value;
    const candidate = mode === "online" ? ONLINE_API_BASE : mode === "local" ? LOCAL_API_BASE : apiBaseInput.value;
    try {
      await persistApiBase(candidate);
    } catch (_error) {
      setApiBaseHint("保存失败，请稍后重试。", true);
    }
  });
}

async function init() {
  try {
    const config = await chrome.storage.sync.get(API_BASE_STORAGE_KEY);
    const storedApiBase = normalizeApiBase(config?.[API_BASE_STORAGE_KEY]);
    if (!storedApiBase || shouldMigrateApiBase(storedApiBase)) {
      apiBase = DEFAULT_API_BASE;
      await chrome.storage.sync.set({ [API_BASE_STORAGE_KEY]: apiBase });
    } else {
      apiBase = storedApiBase;
    }
  } catch (_error) {
    apiBase = DEFAULT_API_BASE;
  }
  syncApiBaseControls(apiBase);
  setApiBaseHint(`当前接收地址：${apiBase}`);
  bindApiBaseControls();
  bindCollapse();
  bindDragEvents();
  bindRetry();
  const recent = await getRecentRecords();
  renderRecent(recent);
  if (recent[0]) {
    renderLatest(recent[0]);
  }
}

init();



