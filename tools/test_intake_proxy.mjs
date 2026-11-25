import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

// Node 18 has no global crypto; the intake Worker validates secrets via subtle.digest.
globalThis.crypto = webcrypto;

const here = path.dirname(fileURLToPath(import.meta.url));

// node loads .js as CommonJS (no "type": "module"), but these are ES modules,
// so load each from a temp .mjs copy.
function loadEsModule(relativePath) {
  const src = fs.readFileSync(path.resolve(here, relativePath), "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agmx-proxy-"));
  const file = path.join(dir, "loaded.mjs");
  fs.writeFileSync(file, src);
  return import(pathToFileURL(file).href);
}

const vercelProxy = (await loadEsModule("../api/intake.js")).proxyIntake;
const pagesProxy = (await loadEsModule("../functions/api/intake.js")).proxyIntake;
const handleIntake = (await loadEsModule("../workers/public-intake/worker.js")).handleIntake;

const PAYLOAD = JSON.stringify({ submissionId: "1df1f7d4-94b2-4f36-a90d-bfcca2f5d201", turnstileToken: "token" });
const WORKER_URL = "https://intake-worker.example/api/intake";
const PROXY_SECRET = "proxy-secret-for-tests";

function env() {
  return {
    INTAKE_WORKER_URL: WORKER_URL,
    INTAKE_PROXY_SECRET: PROXY_SECRET,
  };
}

function response(body, status = 201) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function vercelResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    end(body = "") { this.body = body; return this; },
  };
}

function vercelRequest({ body = PAYLOAD, method = "POST", contentType = "application/json", headers = {} } = {}) {
  return {
    method,
    headers: { "content-type": contentType, origin: "https://www.agmx.my", "x-vercel-forwarded-for": "203.0.113.8", ...headers },
    async *[Symbol.asyncIterator]() {
      const bytes = new TextEncoder().encode(body);
      for (let offset = 0; offset < bytes.length; offset += 4) yield bytes.slice(offset, offset + 4);
    },
  };
}

test("Vercel proxy rejects non-POST requests", async () => {
  const res = vercelResponse();
  await vercelProxy(vercelRequest({ method: "GET", body: "" }), res, { env: env() });
  assert.equal(res.statusCode, 405);
});

test("Vercel proxy rejects non-JSON requests", async () => {
  const res = vercelResponse();
  await vercelProxy(vercelRequest({ contentType: "text/plain" }), res, { env: env() });
  assert.equal(res.statusCode, 415);
});

test("Vercel proxy bounds the request body before forwarding", async () => {
  const res = vercelResponse();
  await vercelProxy(vercelRequest({ body: "x".repeat(16385) }), res, { env: env() });
  assert.equal(res.statusCode, 413);
});

test("Vercel proxy fails closed when its Worker configuration is missing", async () => {
  const res = vercelResponse();
  await vercelProxy(vercelRequest(), res, { env: { INTAKE_WORKER_URL: WORKER_URL } });
  assert.equal(res.statusCode, 503);
});

test("Vercel proxy authenticates to the Worker and preserves status and body", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response(JSON.stringify({ ok: true, reference: "LD-TEST" }), 201);
  };
  const res = vercelResponse();
  await vercelProxy(vercelRequest(), res, { env: env(), fetchImpl });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(JSON.parse(res.body), { ok: true, reference: "LD-TEST" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, WORKER_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["x-agmx-intake-proxy-secret"], PROXY_SECRET);
  assert.equal(calls[0].init.headers.origin, "https://www.agmx.my");
  assert.equal(calls[0].init.headers["x-agmx-client-ip"], "203.0.113.8");
  assert.equal(calls[0].init.body, PAYLOAD);
});

test("Vercel proxy maps Worker network failures to a safe 502", async () => {
  const res = vercelResponse();
  await vercelProxy(vercelRequest(), res, {
    env: env(),
    fetchImpl: async () => { throw new Error(`leaked ${PROXY_SECRET}`); },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.includes(PROXY_SECRET), false);
});

test("Vercel proxy allows the Worker's full 23-second internal timeout budget", async (t) => {
  t.mock.timers.enable(["setTimeout"]);
  let upstreamSignal;
  let finish;
  const fetchImpl = (_url, { signal }) => {
    upstreamSignal = signal;
    return new Promise((resolve) => { finish = resolve; });
  };
  const res = vercelResponse();
  const pending = vercelProxy(vercelRequest(), res, { env: env(), fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(23_000);
  assert.equal(upstreamSignal.aborted, false);
  finish(response(JSON.stringify({ ok: true }), 201));
  await pending;
  assert.equal(res.statusCode, 201);
});

test("Vercel proxy bounds upstream responses by bytes rather than characters", async () => {
  const res = vercelResponse();
  await vercelProxy(vercelRequest(), res, {
    env: env(),
    fetchImpl: async () => response("é".repeat(17_000)),
  });
  assert.equal(res.statusCode, 502);
});

function pagesRequest({ body = PAYLOAD, method = "POST", contentType = "application/json" } = {}) {
  return new Request("https://www.agmx.my/api/intake", {
    method,
    headers: { "content-type": contentType, origin: "https://www.agmx.my", "cf-connecting-ip": "203.0.113.9" },
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  });
}

test("Pages proxy rejects non-POST requests", async () => {
  const res = await pagesProxy(pagesRequest({ method: "GET", body: "" }), env());
  assert.equal(res.status, 405);
});

test("Pages proxy bounds the request body before forwarding", async () => {
  const res = await pagesProxy(pagesRequest({ body: "x".repeat(16385) }), env());
  assert.equal(res.status, 413);
});

test("Pages proxy authenticates to the Worker and preserves status and body", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response(JSON.stringify({ ok: true, reference: "LD-TEST" }), 200);
  };
  const res = await pagesProxy(pagesRequest(), env(), { fetchImpl });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, reference: "LD-TEST" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["x-agmx-intake-proxy-secret"], PROXY_SECRET);
  assert.equal(calls[0].init.headers.origin, "https://www.agmx.my");
  assert.equal(calls[0].init.headers["x-agmx-client-ip"], "203.0.113.9");
  assert.equal(calls[0].init.body, PAYLOAD);
});

test("Pages proxy allows the Worker's full 23-second internal timeout budget", async (t) => {
  t.mock.timers.enable(["setTimeout"]);
  let upstreamSignal;
  let finish;
  const fetchImpl = (_url, { signal }) => {
    upstreamSignal = signal;
    return new Promise((resolve) => { finish = resolve; });
  };
  const pending = pagesProxy(pagesRequest(), env(), { fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(23_000);
  assert.equal(upstreamSignal.aborted, false);
  finish(response(JSON.stringify({ ok: true }), 201));
  assert.equal((await pending).status, 201);
});

test("Pages proxy bounds upstream responses by bytes rather than characters", async () => {
  const res = await pagesProxy(pagesRequest(), env(), {
    fetchImpl: async () => response("é".repeat(17_000)),
  });
  assert.equal(res.status, 502);
});

const FULL_PAYLOAD = JSON.stringify({
  submissionId: "1df1f7d4-94b2-4f36-a90d-bfcca2f5d201",
  turnstileToken: "turnstile-token-for-tests",
  assessment: {
    coopName: "Koperasi Pekerja Maju Berhad",
    coopReg: "KPM-142/2010",
    state: "Selangor",
    members: 1284,
    agmDate: "2026-12-01",
    mode: "hybrid",
    expectedAttendance: 403,
    candidates: 8,
    motions: 12,
    currentProcess: "mixed",
    needsManaged: true,
    contactName: "Pn. Aishah Rahman",
    contactPhone: "+60123456789",
    contactEmail: "aishah@kopemaju.my",
  },
});

function workerEnv() {
  return {
    INTAKE_PROXY_SECRET: PROXY_SECRET,
    TURNSTILE_SECRET_KEY: "turnstile-secret-for-tests",
    INTAKE_INTERNAL_KEY: "internal-key-for-tests",
    SUPABASE_FUNCTION_URL: "https://project.supabase.co/functions/v1/money-flow/assessment",
    RESEND_API_KEY: "resend-key-for-tests",
    SMTP_FROM: "AGMX <noreply@agmx.my>",
    INTAKE_EMAIL_TO: "leads@agmx.my",
    TURNSTILE_EXPECTED_HOSTNAME: "www.agmx.my",
    TURNSTILE_EXPECTED_ACTION: "assessment_submit",
    INTAKE_ALLOWED_ORIGIN: "https://www.agmx.my",
  };
}

function workerDependencies(calls) {
  return {
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      calls.push({ target, init });
      if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
        return response(JSON.stringify({ success: true, hostname: "www.agmx.my", action: "assessment_submit" }));
      }
      if (target === workerEnv().SUPABASE_FUNCTION_URL) {
        return response(JSON.stringify({
          ok: true,
          submissionId: "1df1f7d4-94b2-4f36-a90d-bfcca2f5d201",
          assessmentId: "98dd5721-27ad-4f5c-b53f-7085706c36f7",
          reference: "LD-INTEGRATION",
          token: "checkout-token-for-tests",
          complexityScore: 42,
          recommendedPlan: "professional_agm",
          quoteUrl: "https://www.agmx.my/checkout.html?ref=LD-INTEGRATION&t=checkout-token-for-tests",
          replayed: false,
        }));
      }
      if (target === "https://api.resend.com/emails") return response(JSON.stringify({ id: "email-test-id" }));
      throw new Error(`unexpected fetch: ${target}`);
    },
    logger: { info() {}, warn() {}, error() {} },
  };
}

function assertIntegratedPersistence(calls) {
  const turnstile = calls.find((call) => call.target.endsWith("/siteverify"));
  const supabase = calls.find((call) => call.target === workerEnv().SUPABASE_FUNCTION_URL);
  const resend = calls.find((call) => call.target === "https://api.resend.com/emails");
  assert.ok(turnstile);
  assert.ok(supabase);
  assert.ok(resend);
  assert.equal(supabase.init.headers["x-agmx-intake-key"], "internal-key-for-tests");
  assert.equal(supabase.init.headers["x-agmx-client-ip"].startsWith("203.0.113."), true);
  const persisted = JSON.parse(supabase.init.body);
  assert.equal(persisted.submissionId, "1df1f7d4-94b2-4f36-a90d-bfcca2f5d201");
  assert.equal(persisted.assessment.currentProcess, "partial");
  assert.equal(persisted.assessment.members, 1284);
  assert.equal(resend.init.headers["idempotency-key"], "agmx-intake-1df1f7d4-94b2-4f36-a90d-bfcca2f5d201");
}

test("Vercel proxy integrates with the real intake Worker", async () => {
  const calls = [];
  const fetchImpl = (url, init) => handleIntake(
    new Request(url, init),
    workerEnv(),
    { waitUntil() {} },
    workerDependencies(calls)
  );
  const res = vercelResponse();
  await vercelProxy(vercelRequest({ body: FULL_PAYLOAD }), res, { env: env(), fetchImpl });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).reference, "LD-INTEGRATION");
  assert.equal(JSON.parse(res.body).email.status, "queued");
  assertIntegratedPersistence(calls);
});

test("Pages proxy integrates with the real intake Worker", async () => {
  const calls = [];
  const fetchImpl = (url, init) => handleIntake(
    new Request(url, init),
    workerEnv(),
    { waitUntil() {} },
    workerDependencies(calls)
  );
  const res = await pagesProxy(pagesRequest({ body: FULL_PAYLOAD }), env(), { fetchImpl });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).reference, "LD-INTEGRATION");
  assertIntegratedPersistence(calls);
});
