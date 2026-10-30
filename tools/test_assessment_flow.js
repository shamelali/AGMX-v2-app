/* Public form outcome: saved reference, failed write, and labelled demo fallback. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const client = fs.readFileSync(path.join(root, "pocketbase-client.js"), "utf8");
const assessment = fs.readFileSync(path.join(root, "assessment.js"), "utf8");

function page(demoMode, failure = "") {
  const entries = new Map();
  const requests = [];
  let releaseWrite;
  const values = {
    "coop-name": "Koperasi Test", "coop-reg": "K-1", "coop-state": "Selangor",
    "coop-members": "500", "agm-date": "", "agm-attendance": "200",
    "agm-candidates": "2", "agm-motions": "3", "agm-process": "mixed",
    "contact-name": "PIC", "contact-phone": "0123", "contact-email": "",
  };
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set(id === "lead-card" || id === "book-btn" || id === "result-card" ? ["result-hidden"] : []);
      nodes.set(id, {
        value: values[id] || "", textContent: "", innerHTML: "", disabled: false,
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
        style: {}, scrollIntoView() {}, checkValidity: () => true, reportValidity() {},
        addEventListener(_event, fn) { this.submit = fn; },
      });
    }
    return nodes.get(id);
  }
  const document = {
    getElementById: node,
    querySelector: (selector) => ({ value: selector.includes("managed") ? "yes" : "hybrid" }),
    addEventListener: (_event, callback) => callback(),
  };
  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode } }, document,
    localStorage: {
      getItem: (key) => entries.get(key) || null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (failure === "offline") throw new TypeError("Network unavailable");
      if (failure === "pending") await new Promise((resolve) => { releaseWrite = resolve; });
      return { ok: failure !== "rejected", status: failure === "rejected" ? 403 : 200,
        text: async () => JSON.stringify(failure === "rejected" ? { message: "Not permitted" } : { id: "assessment-123" }) };
    },
    URLSearchParams, setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {}, console,
  };
  vm.runInNewContext(client, context);
  vm.runInNewContext(assessment, context);
  return { node, entries, requests, release: () => releaseWrite(),
    submit: () => node("assessment-form").submit({ preventDefault() {} }) };
}

async function run() {
  const live = page(false);
  await live.submit();
  assert.strictEqual(live.requests.length, 1);
  assert.match(live.node("lead-thanks").textContent, /assessment-123/);
  assert.match(live.node("submission-status").textContent, /PocketBase/);
  assert.strictEqual(live.node("submit-btn").disabled, true);
  assert.strictEqual(live.entries.size, 0);
  await live.submit();
  assert.strictEqual(live.requests.length, 1, "repeat click cannot duplicate a saved submission");

  const pending = page(false, "pending");
  const first = pending.submit();
  await pending.submit();
  assert.strictEqual(pending.requests.length, 1, "repeat click during a pending write cannot duplicate it");
  pending.release();
  await first;

  const invalid = page(false);
  invalid.node("agm-attendance").value = "501";
  await invalid.submit();
  assert.strictEqual(invalid.requests.length, 0, "attendance above member count is not submitted");

  const rejected = page(false, "rejected");
  await rejected.submit();
  assert.strictEqual(rejected.node("lead-card").classList.contains("result-hidden"), true);
  assert.strictEqual(rejected.node("book-btn").classList.contains("result-hidden"), true);
  assert.match(rejected.node("submission-status").textContent, /tidak dapat disahkan/);
  assert.strictEqual(rejected.entries.size, 0, "failed live write must not silently become a local lead");

  const rejectedDemo = page(true, "rejected");
  await rejectedDemo.submit();
  assert.strictEqual(rejectedDemo.entries.size, 0, "permission rejection must not become demo success");

  const demo = page(true, "offline");
  await demo.submit();
  assert.strictEqual(demo.requests.length, 1);
  assert.match(demo.node("submission-status").textContent, /demo\/offline/);
  assert.strictEqual(JSON.parse(demo.entries.get("agmx_leads_v1")).length, 1);
  await demo.submit();
  assert.strictEqual(demo.requests.length, 1);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
