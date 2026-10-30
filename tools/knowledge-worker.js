"use strict";

const store = require("../api/_lib/knowledge-store");
let providers;

function providerModule() {
  // Loaded when a job is actually run so helper exports remain usable in
  // environments that only install providers in the worker deployment.
  if (!providers) providers = require("../api/_lib/knowledge-providers");
  return providers;
}

const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS = 300;
const EMBEDDING_DIMENSIONS = 1024;
const MAX_ASSERTIONS = 3000;
const HEARTBEAT_INTERVAL_MS = 30_000;

function pageChunks(job) {
  if (!job || !Array.isArray(job.pages)) throw new Error("Invalid knowledge job payload");
  const pages = [...job.pages].sort((a, b) => a.page - b.page);
  const chunks = [];
  for (const page of pages) {
    if (!page || !Number.isSafeInteger(page.page) || typeof page.text !== "string") {
      throw new Error("Invalid knowledge page payload");
    }
    const value = page.text;
    if (value.length === 0) continue;
    let start = 0;
    while (start < value.length) {
      const end = Math.min(start + CHUNK_SIZE, value.length);
      chunks.push({
        id: `${job.id}:${chunks.length}`,
        documentId: job.id,
        title: job.title,
        page: page.page,
        text: value.slice(start, end),
      });
      if (chunks.length > MAX_CHUNKS) throw new Error("Document produces more than 300 chunks");
      if (end === value.length) break;
      start = end - CHUNK_OVERLAP;
    }
  }
  if (chunks.length === 0) throw new Error("Document contains no text");
  return chunks;
}

function vector(values) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS ||
      values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`Embedding provider returned an invalid ${EMBEDDING_DIMENSIONS}-dimensional vector`);
  }
  if (values.every((value) => value === 0)) throw new Error("Embedding provider returned a zero vector");
  return values;
}

async function run(dependencies) {
  const runtime = dependencies && typeof dependencies === "object" ? dependencies : {};
  const knowledgeStore = runtime.store || store;
  const provider = runtime.providers || providerModule();
  if (typeof provider.knowledgeConfigStatus === "function") {
    const status = provider.knowledgeConfigStatus();
    if (!status.ready) {
      const details = [...(status.missing || []), ...(status.invalid || [])].join(", ");
      throw new Error(`Knowledge provider is not ready${details ? `: ${details}` : ""}`);
    }
  }
  if (typeof knowledgeStore.schemaStatus === "function") {
    const status = await knowledgeStore.schemaStatus();
    if (!status.ready) {
      const details = [...(status.missing || []), ...(status.invalid || [])].join(", ");
      throw new Error(`Knowledge schema is not ready${details ? `: ${details}` : ""}`);
    }
  }
  const job = await knowledgeStore.claim();
  if (!job) return { status: "idle" };
  const leaseToken = job.leaseToken || job.lease_token;
  let lastHeartbeat = Date.now();
  async function heartbeat(force = false) {
    if (typeof knowledgeStore.renew !== "function") return;
    if (!force && Date.now() - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
    const renewed = await knowledgeStore.renew(job.id, leaseToken);
    if (!renewed) throw new Error("Knowledge job lease is stale or no longer processing");
    lastHeartbeat = Date.now();
  }
  try {
    const chunks = pageChunks(job);
    const embeddings = [];
    const assertions = [];
    for (const chunk of chunks) {
      await heartbeat();
      const extracted = await provider.extract(chunk);
      if (!Array.isArray(extracted)) throw new Error("Assertion provider returned invalid data");
      assertions.push(...extracted.map((item) => ({ ...item, chunkId: item && item.chunkId || chunk.id })));
      if (assertions.length > MAX_ASSERTIONS) {
        throw new Error(`Knowledge job contains more than ${MAX_ASSERTIONS} assertions`);
      }
      embeddings.push({ id: chunk.id, values: vector(await provider.embed(chunk.text, "document")) });
    }
    await heartbeat(true);
    await knowledgeStore.complete(job.id, leaseToken, chunks, assertions, embeddings);
    return { status: "ready", id: job.id, chunks: chunks.length, assertions: assertions.length };
  } catch (error) {
    try { await knowledgeStore.fail(job.id, leaseToken); } catch (_) { /* lease may have expired; never publish stale work */ }
    throw error;
  }
}

if (require.main === module) {
  run().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }).catch(() => {
    process.stderr.write("knowledge worker failed\n");
    process.exitCode = 1;
  });
}

module.exports = { run, pageChunks };
