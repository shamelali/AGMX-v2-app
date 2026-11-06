/*
 * tools/test_service_worker_policy.mjs
 *
 * The service worker used to answer every same-origin GET from the cache,
 * cache-first, including /api/config.js — whose own `Cache-Control: no-store`
 * is a header the Cache API never reads. The deployment it pinned reported
 * demoMode:true, so api.js bound the browser-local adapter and checkout wrote
 * quotes and payments into the visitor's localStorage while printing a paid
 * receipt. The fix could not reach a browser that had already visited.
 *
 * sw.js registers its listeners on a global `self`, so this harness loads the
 * file as written into a stub worker scope and drives the real handler. A
 * rewrite that returns to blanket caching fails here instead of shipping.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ORIGIN = "https://agmx.test";
const SW = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sw.js");

function response(body, { status = 200, contentType = "text/plain" } = {}) {
  const res = {
    status,
    ok: status >= 200 && status < 300,
    type: "basic",
    body,
    headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? contentType : null) },
    clone() { return response(body, { status, contentType }); },
  };
  return res;
}

function makeScope() {
  const listeners = {};
  const cachesMap = new Map();
  const state = { networkCalls: [], network: () => response("unset") };

  const keyOf = (req) => {
    const url = typeof req === "string" ? req : req.url;
    return url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url;
  };

  const cache = {
    async put(req, res) {
      const url = keyOf(req);
      const entry = cachesMap.get(url);
      const list = entry || [];
      list.push({ request: { url }, response: res });
      cachesMap.set(url, list);
    },
    async addAll(paths) {
      for (const p of paths) await cache.put({ url: ORIGIN + p }, state.network({ url: ORIGIN + p }));
    },
  };

  const caches = {
    async open() { return cache; },
    async match(req) {
      const list = cachesMap.get(keyOf(req));
      return list && list.length ? list[list.length - 1].response : undefined;
    },
    async keys() { return [...cachesMap.keys()].length ? ["agmx-something"] : []; },
    async delete() { cachesMap.clear(); return true; },
  };

  const sandbox = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
      registration: { scope: ORIGIN + "/" },
    },
    caches,
    fetch: (req) => {
      const url = typeof req === "string" ? req : req.url;
      state.networkCalls.push(url);
      const out = state.network({ url });
      if (out instanceof Error) return Promise.reject(out);
      return Promise.resolve(out);
    },
    URL,
    console,
    setTimeout,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(fs.readFileSync(SW, "utf8"), sandbox, { filename: SW });

  return {
    listeners,
    state,
    /** Serve one request through the real fetch handler. */
    async dispatch(url, { method = "GET" } = {}) {
      let handled = null;
      const event = {
        request: { url: ORIGIN + url, method },
        respondWith: (p) => { handled = p; },
      };
      if (!listeners.fetch) throw new Error("sw.js registers no fetch handler");
      listeners.fetch(event);
      if (!handled) return { intercepted: false };
      return { intercepted: true, response: await handled };
    },
    /** Seed the cache the way a previous visit would have. */
    async seed(url, res) { await cache.put({ url: ORIGIN + url }, res); },
  };
}

const tests = {

  "runtime config is never served from, or written to, the cache": async () => {
    const sw = makeScope();
    sw.state.network = () => response("window.AGMX_CONFIG = { demoMode: false };", { contentType: "application/javascript" });
    const first = await sw.dispatch("/api/config.js");
    assert.equal(first.intercepted, false, "the worker intercepted /api/config.js — it will answer from a pinned copy");
    assert.equal(sw.state.networkCalls.length, 0, "a /api/ request was fetched by the worker instead of the page");

    const health = await sw.dispatch("/api/health");
    assert.equal(health.intercepted, false, "/api/health was intercepted: a 503 is never stored, so the last healthy 200 is served forever");
  },

  "writes are left to the browser": async () => {
    const sw = makeScope();
    for (const url of ["/api/billplz/callback", "/api/hitpay/webhook", "/subscription/create"]) {
      const r = await sw.dispatch(url, { method: "POST" });
      assert.equal(r.intercepted, false, `a POST to ${url} was intercepted`);
    }
    assert.equal(sw.state.networkCalls.length, 0, "non-GET requests were prefetched by the worker");
  },

  "the app shell is cache-first and survives a bump-free offline load": async () => {
    const sw = makeScope();
    sw.state.network = () => response("body-1", { contentType: "application/javascript" });
    await sw.dispatch("/api.js");
    assert.deepEqual(sw.state.networkCalls, [ORIGIN + "/api.js"], "the first shell hit did not reach the network");

    sw.state.network = () => response("body-2", { contentType: "application/javascript" });
    const again = await sw.dispatch("/api.js");
    assert.equal(again.response.body, "body-1", "a precached file was re-fetched; CACHE-versioned assets are meant to be cache-first");
    assert.equal(sw.state.networkCalls.length, 1, "the second precached hit reached the network");
  },

  "page copy the deploy changes is fetched first, cached only as fallback": async () => {
    const sw = makeScope();
    sw.state.network = () => response("<h1>privacy v1</h1>", { contentType: "text/html" });
    await sw.dispatch("/privacy.html");
    assert.equal(sw.state.networkCalls.length, 1, "the first visit did not reach the network");

    // A deploy corrects the wording without touching sw.js. terms.html and
    // privacy.html are not in PRECACHE, so no CACHE bump will ever happen —
    // cache-first here pins the old claim until the worker is replaced.
    sw.state.network = () => response("<h1>privacy v2 — Supabase hosts the data</h1>", { contentType: "text/html" });
    const second = await sw.dispatch("/privacy.html");
    assert.equal(second.response.body, "<h1>privacy v2 — Supabase hosts the data</h1>", "an unprefixed page served a pinned copy after the deploy changed it");
  },

  "an HTML body is never stored under a script or stylesheet URL": async () => {
    const sw = makeScope();
    // vercel.json rewrites unmatched paths to /index.html, so a missing asset
    // answers 200 with markup.
    sw.state.network = () => response("<!doctype html><html>…</html>", { contentType: "text/html; charset=utf-8" });
    for (const url of ["/missing.js", "/app/styles.css", "/manifest.json"]) {
      const r = await sw.dispatch(url);
      assert.match(r.response.body, /doctype/, "the page should still get the 200 it asked for");
      const probe = await sw.dispatch(url);
      assert.equal(probe.response.body, "<!doctype html><html>…</html>", `${url} was cached as an asset; the browser will parse markup as ${path.extname(url)}`);
    }
    assert.equal(sw.state.networkCalls.length, 6, "a mislabelled response was written to the cache, so the second dispatch was served from it");
  },

  "offline still resolves, and a real 404 is not treated as a body": async () => {
    const sw = makeScope();
    sw.state.network = () => response("offline shell", { contentType: "text/html" });
    await sw.dispatch("/offline.html");

    sw.state.network = () => new TypeError("Failed to fetch");
    const cold = await sw.dispatch("/somepage.html");
    assert.equal(cold.response.body, "offline shell", "an offline visit did not fall back to the cached offline page");

    sw.state.network = () => response("nope", { status: 404, contentType: "text/plain" });
    const missing = await sw.dispatch("/does-not-exist");
    assert.equal(missing.response.status, 404, "a 404 was swallowed");
    sw.state.network = () => response("served now", { contentType: "text/plain" });
    const after = await sw.dispatch("/does-not-exist");
    assert.equal(after.response.body, "served now", "the worker cached a 404 and keeps serving it after the file exists");
  },

  "cross-origin requests are left alone": async () => {
    const sw = makeScope();
    let handled = null;
    sw.listeners.fetch({
      request: { url: "https://cdn.example.com/x.js", method: "GET" },
      respondWith: (p) => { handled = p; },
    });
    assert.equal(handled, null, "the worker responded for a cross-origin request");
  },

  "every precached entry is still a same-origin path": async () => {
    const src = fs.readFileSync(SW, "utf8");
    const block = /const PRECACHE = \[([\s\S]*?)\];/.exec(src);
    assert.ok(block, "PRECACHE not found in sw.js");
    const entries = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(entries.length > 10, "PRECACHE looks empty");
    for (const e of entries) {
      assert.ok(e.startsWith("/"), `${e} is not an absolute path`);
      assert.ok(!e.startsWith("/api/"), `${e} puts runtime config inside the cache-first shell`);
    }
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error && error.message ? error.message : error}`);
  }
}

if (failed) {
  console.error(`service worker cache policy: ${failed} assertion group(s) failed`);
  process.exit(1);
}
console.log("service worker cache policy: all assertion groups passed");
