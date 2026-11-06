"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "pocketbase-client.js"), "utf8");

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function harness(user, body = {}, status = 200) {
  const values = new Map();
  const calls = [];
  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode: false, knowledgeTimeoutMs: 1000 } },
    localStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); },
    },
    fetch: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return response(body, status);
    },
    AbortController,
    URL,
    URLSearchParams,
    EventSource: function EventSource() {},
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  if (user) context.window.AGMX_PB._saveAuth("test-token", user);
  return { api: context.window.AGMX_API, calls };
}

function validResult() {
  return {
    claims: [{ text: "The annual review is required.", kind: "fact", citations: ["doc-1:0"] }],
    unknowns: [],
    evidence: {
      chunks: [{ id: "doc-1:0", documentId: "doc-1", title: "Minutes", page: 3, text: "The annual review is required." }],
      assertions: [],
    },
  };
}

async function run() {
  const user = { id: "admin-1", organizationId: "org-1", role: "admin", email: "admin@example.test" };
  const h = harness(user, validResult());
  assert.equal(h.api.canQueryKnowledge(), true);
  const result = await h.api.queryKnowledge("What review is required?");
  assert.equal(result.claims[0].citations[0], "doc-1:0");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "/api/knowledge/query");
  assert.equal(h.calls[0].options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(h.calls[0].body, { query: "What review is required?" });

  for (const role of ["member", "chairman", "treasurer"]) {
    const denied = harness({ id: role, organizationId: "org-1", role }, validResult());
    assert.equal(denied.api.canQueryKnowledge(), false);
    await assert.rejects(() => denied.api.queryKnowledge("Question"), error => error.knowledgeCode === "forbidden");
    assert.equal(denied.calls.length, 0, "denied roles must not call the knowledge endpoint");
  }

  const malformed = harness(user, {
    claims: [{ text: "Uncited answer", kind: "fact", citations: ["unknown"] }],
    unknowns: [],
    evidence: { chunks: [], assertions: [] },
  });
  await assert.rejects(() => malformed.api.queryKnowledge("Question"), error => error.knowledgeCode === "invalid_response");

  const forbiddenResponse = harness(user, { error: "Organization staff required" }, 403);
  await assert.rejects(() => forbiddenResponse.api.queryKnowledge("Question"), error => error.knowledgeCode === "forbidden");

  const serverError = harness(user, { error: "Knowledge service unavailable" }, 503);
  await assert.rejects(() => serverError.api.queryKnowledge("Question"), error => error.knowledgeCode === "unavailable");

  const invalid = harness(user, validResult());
  await assert.rejects(() => invalid.api.queryKnowledge(" "), error => error.knowledgeCode === "validation");
  assert.equal(invalid.calls.length, 0);

  console.log("knowledge browser client: authorization, same-origin request, validation, and response-boundary tests passed");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
