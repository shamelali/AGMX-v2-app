"use strict";

const assert = require("node:assert/strict");
const { ask } = require("../api/_lib/knowledge-core");

async function run() {
  const calls = [];
  const evidenceText = "The 2024 resolution was proposed by the secretary.";
  const result = await ask("org-knowledge", "Who proposed the 2024 resolution?", {
    providers: {
      async embed(question, task) {
        calls.push(["embed", question, task]);
        return [0.25, 0.75];
      },
      async generate(question, evidence) {
        calls.push(["generate", question, evidence]);
        return {
          answer: "This caller-provided answer must not bypass claim validation.",
          claims: [
            { text: "The secretary proposed the 2024 resolution.", kind: "fact", citations: ["chunk-1"] },
            { text: "The policy requires annual review.", kind: "fact", citations: ["graph-chunk"] },
            { text: "This citation is not in the evidence.", kind: "fact", citations: ["unknown"] },
            { text: "This claim has no citation.", kind: "inference", citations: [] },
          ],
          unknowns: ["  The exact meeting date is not stated.  ", 42],
        };
      },
    },
    store: {
      async semanticSearch(orgId, vector) {
        calls.push(["query", orgId, vector]);
        return [
          { id: "chunk-1", score: 0.99 },
          { id: "chunk-1", score: 0.98 },
          { id: "invalid-score", score: "0.2" },
          { id: "chunk-2", score: 0.7 },
        ];
      },
      async evidence(orgId, ids, question) {
        calls.push(["evidence", orgId, ids, question]);
        return {
          chunks: [
            { id: "chunk-1", documentId: "doc-1", title: "Minutes", page: 4, text: evidenceText },
            { id: "chunk-1", documentId: "doc-1", title: "Duplicate", page: 4, text: evidenceText },
            { id: "graph-chunk", documentId: "doc-2", title: "Policy", page: 1, text: "The policy requires annual review." },
          ],
          assertions: [
            null,
            {
              source: "Resolution 2024",
              type: "PROPOSED_BY",
              target: "Secretary",
              quote: "The 2024 resolution was proposed by the secretary.",
              chunkId: "chunk-1",
            },
            {
              source: "Untrusted",
              type: "PROPOSED_BY",
              target: "Someone",
              quote: "Not present in the source chunk.",
              chunkId: "chunk-1",
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(calls[0], ["embed", "Who proposed the 2024 resolution?", "query"]);
  assert.deepEqual(calls[1], ["query", "org-knowledge", [0.25, 0.75]]);
  assert.deepEqual(calls[2], ["evidence", "org-knowledge", ["chunk-1", "chunk-2"], "Who proposed the 2024 resolution?"]);
  assert.equal(calls[3][0], "generate");
  assert.equal(result.claims.length, 2);
  assert.deepEqual(result.claims[1].citations, ["graph-chunk"]);
  assert.equal(result.claims[0].citations[0], "chunk-1");
  assert.match(result.answer, /^Fact: The secretary proposed/);
  assert.deepEqual(result.unknowns, ["The exact meeting date is not stated."]);
  assert.equal(result.evidence.chunks.length, 2);
  assert.equal(result.evidence.assertions.length, 1);
  assert.equal(result.evidence.assertions[0].source, "resolution 2024");
  assert.equal(typeof result.timings.totalMs, "number");

  await assert.rejects(
    () => ask("org-knowledge", "   ", { providers: {}, store: {} }),
    /query must contain 1 to 2000 characters/,
  );

  const insufficient = await ask("org-knowledge", "Anything else?", {
    providers: {
      async embed() { return [1]; },
      async generate() { throw new Error("generation should not run without evidence"); },
    },
    store: {
      async semanticSearch() { return []; },
      async evidence() { return { chunks: [], assertions: [] }; },
    },
  });
  assert.equal(insufficient.answer, "Insufficient evidence to answer the question from the supplied sources.");
  assert.deepEqual(insufficient.claims, []);

  console.log("knowledge core citation validation and expanded evidence tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
