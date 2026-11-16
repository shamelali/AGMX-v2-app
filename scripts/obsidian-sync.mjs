#!/usr/bin/env node
/**
 * AGMX — Index an Obsidian vault into the knowledge store
 *
 * The Knowledge page asks the deployed knowledge-query function, which runs on
 * Supabase and reads public.knowledge_chunks. It cannot read Obsidian: the
 * Local REST API binds 127.0.0.1 on the authoring machine, so agmx.my could
 * never reach it (and a browser page on agmx.my could not call https://127.0.0.1
 * at all — mixed content plus a CORS gate that plugin does not open). Obsidian
 * therefore has to push its notes into PostgreSQL; that is what this script
 * does. Run it wherever the vault lives, whenever the vault changes.
 *
 *   node scripts/obsidian-sync.mjs --vault ~/Vault
 *   node scripts/obsidian-sync.mjs --api https://127.0.0.1:27123
 *
 * --vault reads the folder directly (simplest, and what a cron job wants).
 * --api talks to the Obsidian Local REST API plugin and needs OBSIDIAN_API_KEY.
 *
 * Required environment:
 *   SUPABASE_URL          project URL
 *   SUPABASE_SECRET_KEY   service-role key (writes bypass RLS by design)
 *
 * Embeddings come from the same providers the Edge Functions use:
 *   LLM_PROVIDER=nvidia  → NVIDIA_NIM_API_KEY or NGC_API_KEY (1024 dims)
 *   LLM_PROVIDER=openai  → OPENAI_API_KEY (requested at 1024 dims)
 *
 * The embedding is 1024 wide because public.knowledge_chunks declares
 * vector(1024). _shared/llm.ts asks OpenAI for 3072, so an OpenAI-backed ingest
 * through the Edge Function would fail this column; requesting 1024 here keeps
 * the vector the schema actually has.
 *
 * Notes are deduplicated by SHA-256, so re-running only re-embeds what changed.
 * Nothing is deleted unless --prune is passed, and --prune only removes rows
 * this script created (category 'obsidian').
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_NOTE = 400;
const EMBEDDING_DIMS = 1024;
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const VAULT = value("vault");
const API = value("api");
const ORG = value("org");
const EXCLUDE = value("exclude", ".obsidian");
const PRUNE = flag("prune");
const DRY = flag("dry-run");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || "";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!VAULT && !API) fail("pass --vault <dir> or --api <url>");
if (!SUPABASE_URL || !SUPABASE_KEY) fail("set SUPABASE_URL and SUPABASE_SECRET_KEY");

function llm() {
  const provider = (process.env.LLM_PROVIDER || "").trim() === "nvidia" ? "nvidia" : "openai";
  if (provider === "nvidia") {
    const key = (process.env.NVIDIA_NIM_API_KEY || process.env.NGC_API_KEY || "").trim();
    return {
      provider,
      key,
      baseUrl: (process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, ""),
      model: process.env.NVIDIA_NIM_EMBEDDING_MODEL || "nvidia/nv-embedqa-e5-v5",
      keyEnv: "NVIDIA_NIM_API_KEY or NGC_API_KEY",
    };
  }
  return {
    provider,
    key: (process.env.OPENAI_API_KEY || "").trim(),
    baseUrl: "https://api.openai.com/v1",
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large",
    keyEnv: "OPENAI_API_KEY",
  };
}

const LLM = llm();

async function embed(text) {
  const body = { model: LLM.model, input: text, dimensions: EMBEDDING_DIMS };
  const response = await fetch(`${LLM.baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LLM.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${LLM.provider} embedding failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("embedding response carried no vector");
  if (vector.length !== EMBEDDING_DIMS) {
    throw new Error(`embedding is ${vector.length}-dimensional, but knowledge_chunks declares vector(${EMBEDDING_DIMS})`);
  }
  return vector;
}

function rest(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
}

async function restJson(path, init) {
  const response = await rest(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${path} → ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveOrg() {
  if (ORG) return ORG;
  const rows = await restJson("organizations?select=id,name&limit=2");
  if (!rows || rows.length === 0) fail("no organization exists; create one or pass --org <uuid>");
  if (rows.length > 1) fail(`several organizations exist (${rows.map((r) => r.name).join(", ")}); pass --org <uuid>`);
  return rows[0].id;
}

/* ---- reading the vault ---- */

async function walk(dir, root = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, root)));
    else if (entry.name.toLowerCase().endsWith(".md")) out.push({ path: relative(root, full).split(sep).join("/"), read: () => readFile(full, "utf8") });
  }
  return out;
}

async function listApi() {
  const token = process.env.OBSIDIAN_API_KEY || "";
  if (!token) fail("--api needs OBSIDIAN_API_KEY");
  const base = API.replace(/\/+$/, "").replace(/\/vault$/, "");
  const headers = { Authorization: `Bearer ${token}` };
  const listing = await fetch(`${base}/vault/`, { headers });
  if (!listing.ok) throw new Error(`Obsidian Local REST API answered ${listing.status}`);
  const payload = await listing.json();
  return (payload.files || [])
    .filter((file) => file.toLowerCase().endsWith(".md"))
    .map((file) => ({
      path: file,
      read: async () => {
        const response = await fetch(`${base}/vault/${file}`, { headers });
        if (!response.ok) throw new Error(`GET ${file} → ${response.status}`);
        return response.text();
      },
    }));
}

function titleOf(notePath, markdown) {
  const front = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (front) {
    const titled = front[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titled) return titled[1].trim();
  }
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : notePath.replace(/\.md$/i, "").split("/").pop();
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function chunk(text) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = buffer.length > CHUNK_OVERLAP ? buffer.slice(-CHUNK_OVERLAP) : "";
  };
  for (const paragraph of paragraphs) {
    if (buffer.length + paragraph.length + 2 <= CHUNK_SIZE) {
      buffer += (buffer ? "\n\n" : "") + paragraph;
      continue;
    }
    flush();
    if (paragraph.length > CHUNK_SIZE) {
      for (let i = 0; i < paragraph.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(paragraph.slice(i, i + CHUNK_SIZE));
      }
      buffer = "";
    } else {
      buffer += (buffer ? "\n\n" : "") + paragraph;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.slice(0, MAX_CHUNKS_PER_NOTE);
}

/* ---- writing ---- */

async function existingHashes(orgId) {
  const rows = await restJson(
    `documents?select=id,filename,sha256&organization_id=eq.${orgId}&category=eq.obsidian`,
  );
  return new Map((rows || []).map((row) => [row.sha256, row]));
}

async function syncOne(note, orgId, known) {
  const markdown = await note.read();
  const sha256 = createHash("sha256").update(markdown).digest("hex");
  if (known.has(sha256)) return { skipped: "unchanged" };

  const body = stripFrontmatter(markdown);
  const pieces = chunk(body);
  if (pieces.length === 0) return { skipped: "empty" };
  if (DRY) return { title: titleOf(note.path, markdown), chunks: pieces.length, dry: true };

  const [document] = await restJson("documents", {
    method: "POST",
    body: JSON.stringify({
      organization_id: orgId,
      category: "obsidian",
      filename: note.path,
      mime: "text/markdown",
      size_bytes: Buffer.byteLength(markdown, "utf8"),
      storage_path: `obsidian/${sha256}.md`,
      sha256,
    }),
  });

  const [job] = await restJson("knowledge_jobs", {
    method: "POST",
    body: JSON.stringify({
      organization_id: orgId,
      document_id: document.id,
      status: "processing",
      source_type: "obsidian",
      source_path: note.path,
      total_chunks: pieces.length,
      started_at: new Date().toISOString(),
    }),
  });

  const title = titleOf(note.path, markdown);
  const embeddings = [];
  for (const piece of pieces) embeddings.push(await embed(piece));

  const rows = pieces.map((content, index) => ({
    organization_id: orgId,
    document_id: document.id,
    job_id: job.id,
    chunk_index: index,
    title,
    content,
    token_count: Math.ceil(content.length / 4),
    embedding: embeddings[index],
    metadata: { source: "obsidian", path: note.path, sha256 },
  }));
  await restJson("knowledge_chunks", { method: "POST", body: JSON.stringify(rows) });

  await restJson(`knowledge_jobs?id=eq.${job.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      processed_chunks: pieces.length,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  return { title, chunks: pieces.length, documentId: document.id };
}

async function prune(orgId, keepPaths) {
  const rows = await restJson(`documents?select=id,filename&organization_id=eq.${orgId}&category=eq.obsidian`);
  const stale = (rows || []).filter((row) => !keepPaths.has(row.filename));
  if (stale.length === 0) return 0;
  if (DRY) return stale.length;
  const ids = stale.map((row) => row.id).join(",");
  await restJson(`documents?id=in.(${ids})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return stale.length;
}

async function main() {
  if (!LLM.key) fail(`no embedding key — set ${LLM.keyEnv}`);

  const orgId = await resolveOrg();
  const notes = (VAULT ? await walk(VAULT) : await listApi()).filter((note) => !note.path.split("/").includes(EXCLUDE));
  if (notes.length === 0) fail("no markdown notes found");

  const known = await existingHashes(orgId);
  console.log(`AGMX Obsidian sync → org ${orgId}`);
  console.log(`${notes.length} note(s), ${known.size} already indexed, embeddings ${LLM.provider}/${LLM.model}`);

  const stats = { added: 0, skipped: 0, failed: 0, chunks: 0 };
  for (let i = 0; i < notes.length; i += CONCURRENCY) {
    const batch = notes.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((note) => syncOne(note, orgId, known)));
    results.forEach((result, offset) => {
      const note = batch[offset];
      if (result.status === "rejected") {
        stats.failed += 1;
        console.error(`  ✗ ${note.path}: ${result.reason?.message || result.reason}`);
        return;
      }
      if (result.value.skipped) {
        stats.skipped += 1;
        return;
      }
      stats.added += 1;
      stats.chunks += result.value.chunks;
      console.log(`  ✓ ${note.path} → ${result.value.chunks} chunk(s)${result.value.dry ? " (dry run)" : ""}`);
    });
  }

  if (PRUNE) {
    const removed = await prune(orgId, new Set(notes.map((note) => note.path)));
    if (removed) console.log(`pruned ${removed} document(s) no longer in the vault`);
  }

  console.log(`done: ${stats.added} added, ${stats.skipped} unchanged, ${stats.failed} failed, ${stats.chunks} chunk(s)`);
  if (stats.failed > 0) process.exit(1);
}

main().catch((error) => fail(error.message));
