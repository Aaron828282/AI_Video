const API_BASE_STORAGE_KEY = "apiBase";
const DEFAULT_API_BASE = "http://127.0.0.1:8787";
const RECENT_KEY = "recentRecords";
const MAX_RECENT = 20;
let apiBase = DEFAULT_API_BASE;

const panelShell = document.getElementById("panelShell");
const togglePanelBtn = document.getElementById("togglePanelBtn");
const dropZone = document.getElementById("dropZone");
const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");
const retryBtn = document.getElementById("retryBtn");
const latestCard = document.getElementById("latestCard");
const latestImage = document.getElementById("latestImage");
const latestTitle = document.getElementById("latestTitle");
const latestPrice = document.getElementById("latestPrice");
const latestShop = document.getElementById("latestShop");
const latestCapturedAt = document.getElementById("latestCapturedAt");
const recentList = document.getElementById("recentList");

let pendingUploadRecord = null;

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
  latestTitle.href = item.url || "https://www.1688.com/";
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
    throw new Error(`Upload failed: ${response.status}`);
  }
}

async function scrapeByActiveTab(droppedImage) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error("Cannot find active tab");
  }
  if (!activeTab.url || !/1688\.com/i.test(activeTab.url)) {
    throw new Error("Please drag image on a 1688 product page");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    args: [droppedImage],
    func: (injectedImage) => {
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
      };
      const normalizeImageUrl = (value) => {
        const absolute = normalize1688ImageUrl(toAbs(value));
        return isLikelyImageUrl(absolute) ? absolute : "";
      };

      const collectBodyLines = () =>
        document.body.innerText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, MAX_TEXT_SCAN_LINES);

      const collectMainPrice = () => {
        const candidates = [
          "[class*='price'] [class*='value']",
          "[class*='priceDisplay']",
          "[class*='price']",
          ".price",
          ".od-pc-offer-price",
          ".mod-detail-price"
        ];
        for (const selector of candidates) {
          const node = document.querySelector(selector);
          const text = safeText(node?.textContent);
          if (!text) {
            continue;
          }
          const match = text.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
          if (match) {
            return Number(match[1]);
          }
        }
        return null;
      };

      const inferPriceTiers = () => {
        const lines = collectBodyLines();
        const tiers = [];
        for (const line of lines) {
          if (!/[¥￥]\s*\d/.test(line)) {
            continue;
          }
          if (!/(起批|件|套|个|pcs|箱|袋|支|只|米|卷|公斤|kg)/i.test(line)) {
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
            container.querySelector("label, dt, h4, h5, .title, .name, [class*='label'], [class*='title']") ||
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
        const rows = Array.from(document.querySelectorAll("table tr, [role='row'], .table-row, .sku-row")).slice(0, 400);
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

      const findTitle = () => {
        const selectors = ["h1", ".d-title", ".title-text", ".offer-title", "[class*='title'] h1"];
        for (const selector of selectors) {
          const text = safeText(document.querySelector(selector)?.textContent);
          if (text && text.length > 4) {
            return text;
          }
        }
        return safeText(document.title.replace(/[-_].*$/, "")) || "Untitled Product";
      };

      const findShopName = () => {
        const selectors = [".company-name", ".mod-detail-CompanyName a", "[class*='shop-name']", "[class*='companyName']"];
        for (const selector of selectors) {
          const text = safeText(document.querySelector(selector)?.textContent);
          if (text) {
            return text;
          }
        }
        return "Unknown Shop";
      };

      const collectCategoryPath = () => {
        const selectorCandidates = [
          ".breadcrumb a",
          "[class*='breadcrumb'] a",
          ".mod-breadcrumb a",
          "[data-spm-anchor-id*='breadcrumb'] a",
          ".next-breadcrumb-item a",
          ".crumb a"
        ];
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

      const collectProductImages = () => {
        const selectors = [
          ".magnifier-image img",
          ".detail-gallery img",
          "[class*='gallery'] img",
          "[class*='sku'] img",
          ".detail-gallery-list img",
          ".offer-img img",
          "img"
        ];
        const candidates = [];
        for (const selector of selectors) {
          const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 120);
          for (const node of nodes) {
            const attrs = [
              node.currentSrc,
              node.getAttribute("src"),
              node.getAttribute("data-src"),
              node.getAttribute("data-lazy-src"),
              node.getAttribute("data-ks-lazyload"),
              node.getAttribute("data-imgsrc")
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

      const href = location.href;
      const productIdMatch =
        href.match(/offer\/(\d+)\.html/i) || href.match(/detail\/(\d+)\.html/i) || href.match(/[?&]id=(\d+)/i);
      const productId = productIdMatch ? productIdMatch[1] : `unknown_${Date.now()}`;

      const scrapedImages = collectProductImages();
      const droppedImage = normalizeImageUrl(injectedImage || "");
      const triggeredImage = droppedImage || scrapedImages[0] || "";
      const images = unique([triggeredImage, ...scrapedImages]).slice(0, 16);
      const title = findTitle();
      const shopName = findShopName();
      const categoryPath = collectCategoryPath();
      const categoryName = categoryPath.length ? categoryPath[categoryPath.length - 1] : "";
      const categoryId = categoryPath.length ? categoryPath.join(">") : "";

      const priceTiers = inferPriceTiers();
      const skuDimensions = collectOptionGroups();
      const skuItems = collectSkuItems();
      const productAttributes = collectAttributesFromTables();
      const packageSpecs = collectPackagingSpecs();

      const allPriceCandidates = [
        ...priceTiers.map((tier) => tier.unitPrice),
        ...skuItems.map((sku) => sku.price),
        collectMainPrice()
      ].filter((num) => Number.isFinite(num));

      const priceMin = allPriceCandidates.length ? Math.min(...allPriceCandidates) : null;
      const priceMax = allPriceCandidates.length ? Math.max(...allPriceCandidates) : null;

      return {
        productId,
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
    }
  });

  const data = results?.[0]?.result;
  if (!data) {
    throw new Error("Capture failed");
  }
  if (!data.triggeredImage) {
    throw new Error("Cannot locate usable product image on current page");
  }

  return {
    ...data,
    recordId: buildRecordId(data.productId, data.capturedAt)
  };
}

async function handleDrop(dataTransfer) {
  const droppedImage = extractImageFromTransfer(dataTransfer);

  setStatus("loading", "Capturing product...");
  const product = await scrapeByActiveTab(droppedImage);
  await saveRecentRecord(product);
  renderLatest(product);

  try {
    await uploadProduct(product);
    pendingUploadRecord = null;
    setStatus("success", "Captured and uploaded");
  } catch (error) {
    pendingUploadRecord = product;
    setStatus("error", `${error.message}, cached locally`, { showRetry: true });
  }
}

function bindDragEvents() {
  const enter = (event) => {
    event.preventDefault();
    dropZone.classList.add("is-hover");
    setStatus("hover", "Release mouse to capture");
  };
  const leave = (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-hover");
    setStatus("idle", "Waiting for drag");
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
      setStatus("error", error.message || "Capture failed", { showRetry: Boolean(pendingUploadRecord) });
    }
  });
}

function bindRetry() {
  retryBtn.addEventListener("click", async () => {
    if (!pendingUploadRecord) {
      setStatus("idle", "Waiting for drag");
      return;
    }
    setStatus("loading", "Retrying upload...");
    try {
      await uploadProduct(pendingUploadRecord);
      pendingUploadRecord = null;
      setStatus("success", "Retry uploaded");
    } catch (error) {
      setStatus("error", error.message || "Retry failed", { showRetry: true });
    }
  });
}

function bindCollapse() {
  togglePanelBtn.addEventListener("click", () => {
    panelShell.classList.toggle("collapsed");
  });
}

async function init() {
  try {
    const config = await chrome.storage.sync.get(API_BASE_STORAGE_KEY);
    apiBase = normalizeApiBase(config?.[API_BASE_STORAGE_KEY]) || DEFAULT_API_BASE;
  } catch (_error) {
    apiBase = DEFAULT_API_BASE;
  }
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
