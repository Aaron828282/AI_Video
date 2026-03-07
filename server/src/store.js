const fs = require("fs/promises");
const path = require("path");

const configuredDataDir = String(process.env.DATA_DIR || "").trim();
const DATA_DIR = configuredDataDir ? path.resolve(configuredDataDir) : path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "products.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }
}

async function loadProducts() {
  await ensureStore();
  const content = await fs.readFile(DATA_FILE, "utf8");
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function saveProducts(products) {
  await ensureStore();
  await fs.writeFile(DATA_FILE, JSON.stringify(products, null, 2), "utf8");
}

module.exports = {
  loadProducts,
  saveProducts
};
