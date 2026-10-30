/* Quote POST contract against the declared PocketBase fields and money totals. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "pocketbase-client.js"), "utf8");
const collections = JSON.parse(fs.readFileSync(path.join(root, "pocketbase", "collections.json"), "utf8"));
const quotes = collections.find((collection) => collection.name === "quotes");
const fields = new Map(quotes.schema.map((field) => [field.name, field]));

async function run() {
  const calls = [];
  const store = new Map();
  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode: false } },
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, text: async () => JSON.stringify(
        url.includes("/quotes/") ? { id: "quote-1" } : { id: "assessment-1" }
      ) };
    },
    location: { origin: "http://app.test", pathname: "/assessment.html" },
    EventSource: function EventSource() {}, URLSearchParams, console,
  };
  vm.runInNewContext(source, context);
  context.window.AGMX_PB._saveAuth("staff-token", {
    id: "user-1", organizationId: "org-1", role: "secretary",
  });

  for (const [key, price] of [["essential", 1500], ["professional", 3500], ["enterprise", 7500]]) {
    const first = calls.length;
    const result = await context.window.AGMX_API.submitAssessment({
      data: {
        coopName: "Koperasi Ujian", coopReg: "TEST-1", state: "Selangor",
        members: 2000, agmDate: "", mode: "hybrid", attendance: 500,
        candidates: 0, motions: 0, process: "manual", managed: true,
        contactName: "PIC", contactPhone: "0123", contactEmail: "",
      },
      score: { total: 60, factors: [] },
      pkg: { key, name: `AGMX ${key} AGM`, price },
    });
    assert.strictEqual(result.quoteStatus, "created");
    assert.strictEqual(calls.length, first + 2, "assessment followed by exactly one quote");
    assert.strictEqual(calls[first + 1].url, "http://pb.test/api/collections/quotes/records");
    assert.strictEqual(calls[first + 1].options.method, "POST");
    assert.strictEqual(calls[first + 1].options.headers.Authorization, "staff-token");

    const payload = JSON.parse(calls[first + 1].options.body);
    assert.ok(Object.keys(payload).every((name) => fields.has(name)), "quote POST must contain only schema fields");
    assert.ok([...fields.values()].filter((field) => field.required).every((field) =>
      payload[field.name] !== undefined && payload[field.name] !== ""), "all required quote fields must be populated");
    assert.strictEqual(payload.organizationId, "org-1");
    assert.strictEqual(payload.assessmentId, "assessment-1");
    assert.match(payload.number, /^AGMX-\d{8}-[A-Z0-9]+$/);
    assert.ok(payload.number.length <= fields.get("number").max);
    assert.strictEqual(payload.status, "draft");
    assert.ok(fields.get("status").values.includes(payload.status));
    assert.match(payload.validUntil, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(payload.subtotal, price);
    assert.strictEqual(payload.tax, 0);
    assert.strictEqual(payload.sstRate, 8);
    assert.strictEqual(payload.total, price);
    assert.deepStrictEqual(payload.items, [{
      name: `AGMX ${key} AGM — AGM`, quantity: 1, unitPrice: price, total: price,
    }]);
  }

  context.window.AGMX_PB._saveAuth("member-token", {
    id: "member-1", organizationId: "org-1", role: "member",
  });
  const first = calls.length;
  const member = await context.window.AGMX_API.submitAssessment({
    data: { coopName: "Test", members: 200, mode: "physical", process: "manual",
      contactName: "PIC", contactPhone: "0123" },
    score: { total: 34, factors: [] },
    pkg: { key: "essential", name: "AGMX Essential AGM", price: 1500 },
  });
  assert.strictEqual(member.quoteStatus, "not-available");
  assert.strictEqual(calls.length, first + 1, "member never attempts protected quote write");
  console.log("quote payload/schema and role boundary: passed");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
