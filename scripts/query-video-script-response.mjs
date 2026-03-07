#!/usr/bin/env node

/**
 * Manual debug helper for querying video-script model responses.
 *
 * Usage:
 *   node scripts/query-video-script-response.mjs --recordId <id>
 *   node scripts/query-video-script-response.mjs --recordId <id> --baseUrl http://localhost:8790
 *   node scripts/query-video-script-response.mjs --recordId <id> --save ./video-script-debug.json
 */

import fs from "node:fs/promises";

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    return "";
  }
  return String(process.argv[index + 1] || "").trim();
}

function usage() {
  console.log("Usage:");
  console.log("  node scripts/query-video-script-response.mjs --recordId <id> [--baseUrl <url>] [--save <path>]");
}

const recordId = getArg("--recordId");
const baseUrl = getArg("--baseUrl") || process.env.API_BASE || "http://localhost:8790";
const savePath = getArg("--save");

if (!recordId) {
  usage();
  process.exit(1);
}

const url = `${baseUrl.replace(/\/+$/, "")}/api/products/${encodeURIComponent(recordId)}/video-script/status`;

async function main() {
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    json = null;
  }

  if (!response.ok) {
    console.error(`Request failed: ${response.status}`);
    console.error(text);
    process.exit(2);
  }

  if (!json || typeof json !== "object") {
    console.error("Response is not valid JSON.");
    console.error(text);
    process.exit(3);
  }

  const state = json.videoScriptGeneration || {};
  const result = state.result || {};
  const raw = result.outputPayload?.raw ?? null;

  console.log("=== Video Script Status ===");
  console.log(`recordId: ${recordId}`);
  console.log(`status  : ${state.status || "unknown"}`);
  console.log(`updated : ${state.updatedAt || ""}`);
  console.log(`error   : ${state.error || ""}`);
  console.log("");
  console.log("=== Raw Output (outputPayload.raw) ===");
  console.log(raw ? JSON.stringify(raw, null, 2) : "(empty)");
  console.log("");
  console.log("=== Full Response JSON ===");
  console.log(JSON.stringify(json, null, 2));

  if (savePath) {
    await fs.writeFile(savePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    console.log(`Saved to: ${savePath}`);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error instanceof Error ? error.message : String(error));
  process.exit(99);
});
