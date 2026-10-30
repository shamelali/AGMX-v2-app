"use strict";

const assert = require("node:assert/strict");
const { run, batchSize } = require("./knowledge-embedding-backfill");

async function runTests() {
  const previousBatch = process.env.KNOWLEDGE_BACKFILL_BATCH;
  const calls = [];
  const values = Array(1024).fill(0);
  values[0] = 1;
  let batches = 0;
  process.env.KNOWLEDGE_BACKFILL_BATCH = "2";
  try {
    const result = await run({
      store: {
        async unembeddedChunks(limit) {
          calls.push(["list", limit]);
          batches += 1;
          return batches === 1 ? [{ id: "chunk-1", text: "one" }, { id: "chunk-2", text: "two" }] : [];
        },
        async setEmbedding(id, embedding) {
          calls.push(["update", id, embedding]);
          return true;
        },
      },
      providers: {
        async embed(text, task) {
          calls.push(["embed", text, task]);
          return values;
        },
      },
    });

    assert.deepEqual(result, { scanned: 2, updated: 2 });
    assert.deepEqual(calls.map(call => call[0]), ["list", "embed", "update", "embed", "update", "list"]);
    assert.deepEqual(calls[1], ["embed", "one", "document"]);
    assert.equal(calls[2][2].length, 1024);

    process.env.KNOWLEDGE_BACKFILL_BATCH = "0";
    assert.throws(() => batchSize(), /between 1 and 100/);
    process.env.KNOWLEDGE_BACKFILL_BATCH = "101";
    assert.throws(() => batchSize(), /between 1 and 100/);

    process.env.KNOWLEDGE_BACKFILL_BATCH = "1";
    await assert.rejects(
      () => run({
        store: { async unembeddedChunks() { return [{ id: "chunk-1" }]; } },
        providers: { async embed() { return values; } },
      }),
      /invalid chunk row/,
    );

    console.log("knowledge embedding backfill batching, validation, and resumability tests passed");
  } finally {
    if (previousBatch === undefined) delete process.env.KNOWLEDGE_BACKFILL_BATCH;
    else process.env.KNOWLEDGE_BACKFILL_BATCH = previousBatch;
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
