"use strict";

const store = require("../api/_lib/knowledge-store");
const providers = require("../api/_lib/knowledge-providers");

const DEFAULT_BATCH_SIZE = 50;

function batchSize() {
  const value = process.env.KNOWLEDGE_BACKFILL_BATCH || String(DEFAULT_BATCH_SIZE);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("KNOWLEDGE_BACKFILL_BATCH must be an integer between 1 and 100");
  }
  return parsed;
}

async function run(dependencies) {
  const runtime = dependencies && typeof dependencies === "object" ? dependencies : {};
  const knowledgeStore = runtime.store || store;
  const embeddingProvider = runtime.providers || providers;
  const limit = batchSize();
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const rows = await knowledgeStore.unembeddedChunks(limit);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || typeof row.text !== "string") {
        throw new Error("Backfill returned an invalid chunk row");
      }
      const values = await embeddingProvider.embed(row.text, "document");
      if (!Array.isArray(values)) throw new Error("Embedding provider returned an invalid vector");
      if (await knowledgeStore.setEmbedding(row.id, values)) updated += 1;
      scanned += 1;
    }
  }
  return { scanned, updated };
}

if (require.main === module) {
  run().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }).catch(() => {
    process.stderr.write("knowledge embedding backfill failed\n");
    process.exitCode = 1;
  });
}

module.exports = { run, batchSize };
