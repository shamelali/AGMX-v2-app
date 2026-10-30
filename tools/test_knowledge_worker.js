"use strict";

const assert = require("node:assert/strict");
const { pageChunks, run } = require("./knowledge-worker");

async function runTests() {
  const chunks = pageChunks({
    id: "job-1",
    title: "Minutes",
    pages: [
      { page: 2, text: "page two" },
      { page: 1, text: "a".repeat(3000) },
    ],
  });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].id, "job-1:0");
  assert.equal(chunks[0].page, 1);
  assert.equal(chunks[1].text.slice(0, 1), "a");
  assert.equal(chunks[1].text.length, 700);
  assert.equal(chunks[2].page, 2);

  const events = [];
  const result = await run({
    store: {
      async claim() {
        events.push("claim");
        return {
          id: "job-2",
          organizationId: "org-2",
          title: "Policy",
          leaseToken: "lease-2",
          pages: [{ page: 1, text: "The board adopted the policy." }],
        };
      },
      async complete(jobId, leaseToken, processedChunks, assertions, embeddings) {
        events.push(["complete", jobId, leaseToken, processedChunks.length, assertions.length, embeddings.length]);
      },
      async renew(jobId, leaseToken) {
        events.push(["renew", jobId, leaseToken]);
        return true;
      },
      async fail() {
        events.push("fail");
      },
    },
    providers: {
      async extract(chunk) {
        events.push(["extract", chunk.id]);
        return [{ source: "board", type: "ADOPTED_AT", target: "policy", quote: "The board adopted the policy.", chunkId: chunk.id }];
      },
      async embed(text, task) {
        events.push(["embed", text, task]);
        const values = Array(1024).fill(0);
        values[0] = 0.1;
        values[1] = 0.2;
        return values;
      },
    },
  });

  assert.deepEqual(result, { status: "ready", id: "job-2", chunks: 1, assertions: 1 });
  assert.equal(events[0], "claim");
  assert.equal(events[1][0], "extract");
  assert.equal(events[2][0], "embed");
  assert.equal(events[3][0], "renew");
  assert.equal(events[4][0], "complete");
  assert.equal(events[4][1], "job-2");
  assert.equal(events[4][5], 1);

  let claimedWithBadProvider = false;
  await assert.rejects(() => run({
    store: {
      async claim() { claimedWithBadProvider = true; throw new Error("must not claim"); },
    },
    providers: { knowledgeConfigStatus() { return { ready: false, missing: ["NVIDIA_API_KEY"], invalid: [] }; } },
  }), /Knowledge provider is not ready: NVIDIA_API_KEY/);
  assert.equal(claimedWithBadProvider, false);

  let claimedWithBadSchema = false;
  await assert.rejects(() => run({
    store: {
      async schemaStatus() { return { ready: false, missing: ["VECTOR_EXTENSION"], invalid: [] }; },
      async claim() { claimedWithBadSchema = true; throw new Error("must not claim"); },
    },
    providers: {},
  }), /Knowledge schema is not ready: VECTOR_EXTENSION/);
  assert.equal(claimedWithBadSchema, false);

  let failed = false;
  await assert.rejects(
    () => run({
      store: {
        async claim() { return { id: "job-3", organizationId: "org-3", leaseToken: "lease-3", title: "Broken", pages: [{ page: 1, text: "text" }] }; },
        async complete() { throw new Error("complete must not run"); },
        async fail(jobId, leaseToken) { failed = jobId === "job-3" && leaseToken === "lease-3"; },
      },
      providers: {
        async extract() { throw new Error("provider failed"); },
        async embed() { return [1]; },
      },
    }),
    /provider failed/,
  );
  assert.equal(failed, true);

  const idle = await run({ store: { async claim() { return null; } }, providers: {} });
  assert.deepEqual(idle, { status: "idle" });
  console.log("knowledge worker chunking, publish ordering, and lease failure tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
