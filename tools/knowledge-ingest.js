"use strict";

const fs = require("fs");
const path = require("path");

const MAX_PAGES = 200;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_CHARS = 500000;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function pdfPages(filename) {
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("PDF must be a local file no larger than 20MB");
  const data = fs.readFileSync(filename);
  if (data.length > MAX_BYTES) throw new Error("PDF must be a local file no larger than 20MB");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs-dist 6 expects a Uint8Array in Node; passing the Buffer directly
  // fails before any page text can be extracted.
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep,
    disableWorker: true,
  });
  try {
    const document = await task.promise;
    if (document.numPages < 1 || document.numPages > MAX_PAGES) throw new Error("PDF must contain 1-200 pages");
    const pages = [];
    let chars = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => typeof item.str === "string" ? item.str : "").join(" ").trim();
      chars += text.length;
      if (chars > MAX_CHARS) throw new Error("PDF text exceeds 500000 characters");
      pages.push({ page: pageNumber, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function ingest(filename) {
  const orgId = String(process.env.AGMX_ORG_ID || process.env.AGMX_ORGANIZATION_ID || "").trim();
  if (!orgId) throw new Error("AGMX_ORG_ID is not configured");
  const apiUrl = String(process.env.AGMX_API_URL || process.env.AGMX_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!apiUrl) throw new Error("AGMX_API_URL is not configured");
  const token = required("AGMX_API_TOKEN");
  const title = String(process.env.AGMX_KNOWLEDGE_TITLE || path.basename(filename, path.extname(filename))).trim();
  if (!title || title.length > 500) throw new Error("Knowledge title must be 1-500 characters");
  const pages = await pdfPages(filename);
  const endpoint = String(
    process.env.AGMX_KNOWLEDGE_INGEST_URL ||
    `${apiUrl}${apiUrl.endsWith("/api") ? "" : "/api"}/knowledge/ingest`
  ).trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, title, pages }),
  });
  if (!response.ok) throw new Error(`Knowledge API returned HTTP ${response.status}`);
  const result = await response.json();
  if (!result || typeof result.id !== "string" || typeof result.status !== "string") {
    throw new Error("Knowledge API returned an invalid enqueue response");
  }
  return { id: result.id, status: result.status, pages: pages.length };
}

if (require.main === module) {
  const filename = process.argv[2];
  if (!filename) {
    process.stderr.write("Usage: node tools/knowledge-ingest.js <local.pdf>\n");
    process.exitCode = 2;
  } else {
    ingest(filename).then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    }).catch(() => {
      process.stderr.write("knowledge ingestion failed\n");
      process.exitCode = 1;
    });
  }
}

module.exports = { ingest, pdfPages };
