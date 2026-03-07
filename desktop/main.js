const { app, dialog, shell } = require("electron");
const { fork } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SERVER_PORT = Number(process.env.PORT || 8790);
const SERVER_HOST = "127.0.0.1";
const HEALTH_PATH = "/api/health";
const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

let serverProcess = null;
let appQuitting = false;

function sanitizePathSegment(input, fallback = "default") {
  const normalized = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function resolveBuildSegment() {
  const exeName = sanitizePathSegment(path.basename(process.execPath, path.extname(process.execPath)), "app");
  try {
    const stat = fs.statSync(process.execPath);
    const size = Number.isFinite(stat.size) ? String(stat.size) : "0";
    const mtime = Number.isFinite(stat.mtimeMs) ? String(Math.floor(stat.mtimeMs)) : "0";
    return sanitizePathSegment(`${exeName}_${size}_${mtime}`, exeName);
  } catch (_error) {
    return exeName;
  }
}

function resolveDataDirStrategy() {
  const strategyRaw = String(process.env.DATA_DIR_STRATEGY || "").trim().toLowerCase();
  const defaultStrategy = app.isPackaged ? "build" : "shared";
  return strategyRaw || defaultStrategy;
}

function resolveBaseDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function resolveRuntimeDataDir() {
  const baseDataDir = resolveBaseDataDir();
  const strategy = resolveDataDirStrategy();
  if (strategy === "shared") {
    return baseDataDir;
  }
  if (strategy === "version") {
    return path.join(baseDataDir, `version_${sanitizePathSegment(app.getVersion(), "0")}`);
  }
  if (strategy === "build") {
    return path.join(baseDataDir, `build_${resolveBuildSegment()}`);
  }
  return baseDataDir;
}

function safeStatSync(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch (_error) {
    return null;
  }
}

function hasProductData(dirPath) {
  if (!dirPath) {
    return false;
  }
  const productsPath = path.join(dirPath, "products.json");
  const stat = safeStatSync(productsPath);
  return Boolean(stat && stat.isFile() && stat.size > 2);
}

function listDataMigrationSources(baseDataDir, targetDataDir) {
  const sources = [];
  const sharedStat = safeStatSync(baseDataDir);
  if (sharedStat && sharedStat.isDirectory() && path.resolve(baseDataDir) !== path.resolve(targetDataDir)) {
    sources.push(baseDataDir);
  }
  try {
    const entries = fs.readdirSync(baseDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry || !entry.isDirectory()) {
        continue;
      }
      const name = String(entry.name || "");
      if (!name.startsWith("build_") && !name.startsWith("version_")) {
        continue;
      }
      const fullPath = path.join(baseDataDir, name);
      if (path.resolve(fullPath) === path.resolve(targetDataDir)) {
        continue;
      }
      sources.push(fullPath);
    }
  } catch (_error) {
    // no-op
  }
  return sources;
}

function pickLatestProductSource(candidates) {
  let chosen = null;
  let latestMtime = 0;
  for (const candidate of candidates) {
    if (!hasProductData(candidate)) {
      continue;
    }
    const stat = safeStatSync(path.join(candidate, "products.json"));
    const mtime = stat && Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
    if (!chosen || mtime >= latestMtime) {
      chosen = candidate;
      latestMtime = mtime;
    }
  }
  return chosen;
}

function migrateProductDataWithoutPassword({ baseDataDir, targetDataDir, strategy }) {
  if (strategy !== "build") {
    return;
  }
  const markerFile = path.join(targetDataDir, ".build-migration.json");
  if (safeStatSync(markerFile)) {
    return;
  }

  const candidates = listDataMigrationSources(baseDataDir, targetDataDir);
  const sourceDir = pickLatestProductSource(candidates);
  const copiedItems = [];
  if (sourceDir) {
    const filesToCopy = ["products.json", "categories.json", "image-knowledge-base.json"];
    for (const fileName of filesToCopy) {
      const sourceFile = path.join(sourceDir, fileName);
      const targetFile = path.join(targetDataDir, fileName);
      const sourceStat = safeStatSync(sourceFile);
      if (!sourceStat || !sourceStat.isFile() || safeStatSync(targetFile)) {
        continue;
      }
      fs.copyFileSync(sourceFile, targetFile);
      copiedItems.push(fileName);
    }

    const dirsToCopy = ["manual-product-images", "knowledge-base-images"];
    for (const dirName of dirsToCopy) {
      const sourceSubDir = path.join(sourceDir, dirName);
      const targetSubDir = path.join(targetDataDir, dirName);
      const sourceStat = safeStatSync(sourceSubDir);
      if (!sourceStat || !sourceStat.isDirectory() || safeStatSync(targetSubDir)) {
        continue;
      }
      fs.cpSync(sourceSubDir, targetSubDir, { recursive: true, force: false, errorOnExist: false });
      copiedItems.push(dirName);
    }
  }

  const markerPayload = {
    migratedAt: new Date().toISOString(),
    from: sourceDir || "",
    copiedItems,
    resetPasswordConfig: true
  };
  fs.writeFileSync(markerFile, JSON.stringify(markerPayload, null, 2), "utf8");
}

function resolveServerEntry() {
  const primary = path.join(app.getAppPath(), "server", "src", "index.js");
  if (fs.existsSync(primary)) {
    return primary;
  }
  return path.join(__dirname, "..", "server", "src", "index.js");
}

function resolveServerCwd(serverEntry) {
  const fallback = process.resourcesPath || path.dirname(process.execPath);
  const normalized = path.normalize(String(serverEntry || "")).toLowerCase();
  if (normalized.includes(`${path.sep}app.asar${path.sep}`)) {
    return fallback;
  }
  const candidate = path.dirname(path.dirname(serverEntry));
  if (candidate && fs.existsSync(candidate)) {
    return candidate;
  }
  return fallback;
}

function requestHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: HEALTH_PATH,
        timeout: 1500
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForServerReady() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await requestHealth();
    if (ok) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

async function launchServerAndOpenPage() {
  const serverEntry = resolveServerEntry();
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server entry not found: ${serverEntry}`);
  }
  const serverCwd = resolveServerCwd(serverEntry);

  const configuredDataDir = String(process.env.DATA_DIR || "").trim();
  const baseDataDir = resolveBaseDataDir();
  const dataStrategy = resolveDataDirStrategy();
  const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : resolveRuntimeDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  if (!configuredDataDir) {
    migrateProductDataWithoutPassword({
      baseDataDir,
      targetDataDir: dataDir,
      strategy: dataStrategy
    });
  }

  serverProcess = fork(serverEntry, [], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      DATA_DIR: dataDir
    },
    stdio: "ignore"
  });

  serverProcess.on("exit", (code, signal) => {
    if (appQuitting) {
      return;
    }
    const reason = signal ? `signal=${signal}` : `code=${code}`;
    void dialog.showErrorBox("服务异常退出", `后端服务已退出（${reason}）。`);
    app.quit();
  });

  serverProcess.on("error", (error) => {
    if (appQuitting) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    void dialog.showErrorBox("鍚姩澶辫触", `鍚庣鏈嶅姟杩涚▼鍚姩澶辫触锛歿message}`);
    app.quit();
  });

  const ready = await waitForServerReady();
  if (!ready) {
    throw new Error("等待服务启动超时，请检查日志或端口占用。");
  }

  await shell.openExternal(`http://${SERVER_HOST}:${SERVER_PORT}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void shell.openExternal(`http://${SERVER_HOST}:${SERVER_PORT}`);
  });

  app.whenReady()
    .then(async () => {
      await launchServerAndOpenPage();
    })
    .catch((error) => {
      dialog.showErrorBox("启动失败", error instanceof Error ? error.message : String(error));
      app.quit();
    });
}

app.on("before-quit", () => {
  appQuitting = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
