/* Credential-free contract test for the assessment PocketBase submission path. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const clientSource = fs.readFileSync(path.join(__dirname, "..", "pocketbase-client.js"), "utf8");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  };
}

async function run() {
  const store = new Map();
  const calls = [];
  let failQuote = false;
  let failAssessment = false;
  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode: false } },
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (failAssessment && url.includes("/agm_assessments/")) return response({ message: "Invalid assessment" }, 400);
      if (failQuote && url.includes("/quotes/")) return response({ message: "Quote rejected" }, 403);
      return response(url.includes("/quotes/") ? { id: "quote-1", number: "AGMX-TEST" } : { id: "assessment-1" });
    },
    location: { origin: "http://app.test", pathname: "/assessment.html" },
    EventSource: function EventSource() {},
    URLSearchParams,
    console,
  };
  vm.runInNewContext(clientSource, context);

  const input = {
    data: {
      coopName: "Koperasi Ujian", coopReg: "TEST-1", state: "Selangor", members: 500,
      agmDate: "", mode: "hybrid", attendance: 200, candidates: 2, motions: 3,
      process: "mixed", managed: true, contactName: "PIC", contactPhone: "0123", contactEmail: "",
    },
    score: { total: 42, factors: [] },
    pkg: { key: "professional", name: "AGMX Professional AGM", price: 3500 },
  };

  const result = await context.window.AGMX_API.submitAssessment(input);
  assert.strictEqual(result.quoteStatus, "not-available", "public assessment must not fake a quote without tenant auth");
  assert.strictEqual(result.assessment.id, "assessment-1");
  assert.strictEqual(calls[0].options.headers.Authorization, undefined);
  assert.strictEqual(calls[0].url, "http://pb.test/api/collections/agm_assessments/records");
  const assessmentPayload = JSON.parse(calls[0].options.body);
  assert.strictEqual(assessmentPayload.organizationId, "");
  assert.strictEqual(assessmentPayload.currentProcess, "partial");
  assert.strictEqual(assessmentPayload.expectedAttendance, 200);
  assert.strictEqual(assessmentPayload.complexityScore, 42);
  assert.strictEqual(assessmentPayload.status, "lead");
  assert.strictEqual(assessmentPayload.answers.contactPhone, undefined, "do not duplicate PII in answers JSON");
  assert.strictEqual(assessmentPayload.answers.contactName, undefined);

  context.window.AGMX_PB._saveAuth("token", { id: "user-1", organizationId: "org-1", role: "secretary" });
  const authenticated = context.window.AGMX_API;
  const staffResult = await authenticated.submitAssessment(input);
  assert.strictEqual(staffResult.quoteStatus, "created");
  assert.strictEqual(calls.length, 3, "public assessment plus authenticated assessment and quote should be sent");
  const quotePayload = JSON.parse(calls[2].options.body);
  assert.strictEqual(quotePayload.organizationId, "org-1");
  assert.strictEqual(quotePayload.assessmentId, "assessment-1");
  assert.strictEqual(quotePayload.subtotal, 3500);
  assert.strictEqual(quotePayload.total, 3500);
  assert.strictEqual(calls[1].options.headers.Authorization, "token");

  failQuote = true;
  const partial = await authenticated.submitAssessment(input);
  assert.strictEqual(partial.assessment.id, "assessment-1");
  assert.strictEqual(partial.quoteStatus, "failed", "a failed quote must not erase a saved assessment");

  context.window.AGMX_PB._saveAuth("", null);
  failAssessment = true;
  await assert.rejects(context.window.AGMX_API.submitAssessment(input), /Invalid assessment/);
  assert.strictEqual(calls.at(-1).options.headers.Authorization, undefined);

  context.window.AGMX_PB._saveAuth("stale-token", { id: "user-2", role: "member" });
  const count = calls.length;
  await assert.rejects(context.window.AGMX_API.submitAssessment(input), /tidak dipautkan/);
  assert.strictEqual(calls.length, count, "invalid tenant auth must not write");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
