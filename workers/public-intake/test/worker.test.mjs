import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

// Node 18 has no global crypto; the Worker validates secrets via subtle.digest.
globalThis.crypto = webcrypto;

const here = path.dirname(fileURLToPath(import.meta.url));

// node loads .js as CommonJS (no "type": "module"), but worker.js is an ES module,
// so load it from a temp .mjs copy.
function loadEsModule(relativePath) {
  const src = fs.readFileSync(path.resolve(here, relativePath), "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agmx-worker-test-"));
  const file = path.join(dir, "loaded.mjs");
  fs.writeFileSync(file, src);
  return import(pathToFileURL(file).href);
}

const handleIntake = (await loadEsModule("../worker.js")).handleIntake;

const SUBMISSION_ID = "1df1f7d4-94b2-4f36-a90d-bfcca2f5d201";
const PROXY_SECRET = "proxy-secret-for-tests";
const INTERNAL_KEY = "internal-key-for-tests";
const TURNSTILE_SECRET = "turnstile-secret-for-tests";
const CHECKOUT_TOKEN = "checkout-token-must-not-leak";

function validPayload() {
  return {
    submissionId: SUBMISSION_ID,
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
  };
}

function validEnv() {
  return {
    INTAKE_PROXY_SECRET: PROXY_SECRET,
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    INTAKE_INTERNAL_KEY: INTERNAL_KEY,
    SUPABASE_FUNCTION_URL: "https://project.supabase.co/functions/v1/money-flow/assessment",
    RESEND_API_KEY: "resend-key-for-tests",
    SMTP_FROM: "AGMX <noreply@agmx.my>",
    INTAKE_EMAIL_TO: "leads@agmx.my",
    TURNSTILE_EXPECTED_HOSTNAME: "www.agmx.my",
    TURNSTILE_EXPECTED_ACTION: "assessment_submit",
    INTAKE_ALLOWED_ORIGIN: "https://www.agmx.my",
  };
}

function request(body = validPayload(), options = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "https://www.agmx.my",
    "x-agmx-intake-proxy-secret": PROXY_SECRET,
  });
  if (options.contentLength !== undefined) headers.set("content-length", String(options.contentLength));
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.proxySecret !== undefined) headers.set("x-agmx-intake-proxy-secret", options.proxySecret);
  if (options.contentType !== undefined) headers.set("content-type", options.contentType);
  return new Request("https://worker.test/api/intake", {
    method: options.method || "POST",
    headers,
    body: options.rawBody !== undefined
      ? options.rawBody
      : options.streamBody || (options.noBody ? undefined : JSON.stringify(body)),
    ...(options.streamBody ? { duplex: "half" } : {}),
  });
}

function successBody(overrides = {}) {
  return {
    ok: true,
    submissionId: SUBMISSION_ID,
    assessmentId: "98dd5721-27ad-4f5c-b53f-7085706c36f7",
    reference: "LD-TEST-001",
    token: CHECKOUT_TOKEN,
    complexityScore: 42,
    recommendedPlan: "professional_agm",
    quoteUrl: `https://www.agmx.my/checkout.html?ref=LD-TEST-001&t=${CHECKOUT_TOKEN}`,
    replayed: false,
    ...overrides,
  };
}

function dependencies(options = {}) {
  const calls = { turnstile: [], supabase: [], resend: [] };
  const logs = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      calls.turnstile.push({ url: target, init });
      if (options.turnstileError) throw options.turnstileError;
      return new Response(JSON.stringify(options.turnstile || {
        success: true,
        hostname: "www.agmx.my",
        action: "assessment_submit",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target === validEnv().SUPABASE_FUNCTION_URL) {
      calls.supabase.push({ url: target, init });
      if (options.supabaseError) throw options.supabaseError;
      const status = options.supabaseStatus || 201;
      const body = options.supabaseBody === undefined ? successBody() : options.supabaseBody;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    if (target === "https://api.resend.com/emails") {
      calls.resend.push({ url: target, init });
      if (options.resendError) throw options.resendError;
      return new Response(JSON.stringify({ id: "email-test-id" }), {
        status: options.resendStatus || 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  return {
    calls,
    logs,
    deps: {
      fetchImpl,
      logger: {
        info: (entry) => logs.push(entry),
        warn: (entry) => logs.push(entry),
        error: (entry) => logs.push(entry),
      },
    },
  };
}

const ctx = { waitUntil() {} };

async function invoke(req = request(), env = validEnv(), deps = dependencies().deps) {
  const response = await handleIntake(req, env, ctx, deps);
  return { response, json: await response.json() };
}

test("rejects methods other than POST", async () => {
  const { response, json } = await invoke(request(validPayload(), { method: "GET", noBody: true }));
  assert.equal(response.status, 405);
  assert.equal(json.ok, false);
});

test("rejects non-JSON content types", async () => {
  const { response, json } = await invoke(request(validPayload(), { contentType: "text/plain" }));
  assert.equal(response.status, 415);
  assert.equal(json.error.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("rejects an oversized declared body before reading it", async () => {
  const { response, json } = await invoke(request(validPayload(), { contentLength: 16385 }));
  assert.equal(response.status, 413);
  assert.equal(json.error.code, "PAYLOAD_TOO_LARGE");
});

test("rejects an oversized streamed body", async () => {
  const streamBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(8192)));
      controller.enqueue(new TextEncoder().encode("x".repeat(8193)));
      controller.close();
    },
  });
  const { response, json } = await invoke(request(validPayload(), { streamBody }));
  assert.equal(response.status, 413);
  assert.equal(json.error.code, "PAYLOAD_TOO_LARGE");
});

test("rejects malformed JSON", async () => {
  const { response, json } = await invoke(request(validPayload(), { rawBody: "{" }));
  assert.equal(response.status, 400);
  assert.equal(json.error.code, "INVALID_JSON");
});

test("rejects unknown assessment fields instead of trusting commercial authority", async () => {
  const payload = validPayload();
  payload.assessment.organization_id = "22222222-2222-4222-8222-222222222222";
  payload.assessment.score = 100;
  const { response, json } = await invoke(request(payload));
  assert.equal(response.status, 400);
  assert.equal(json.error.code, "INVALID_INPUT");
  assert.ok(json.error.fields.organization_id);
  assert.ok(json.error.fields.score);
});

test("rejects attendance greater than membership", async () => {
  const payload = validPayload();
  payload.assessment.expectedAttendance = payload.assessment.members + 1;
  const { response, json } = await invoke(request(payload));
  assert.equal(response.status, 400);
  assert.match(json.error.fields.expectedAttendance, /members/i);
});

test("requires a UUID v4 submission id", async () => {
  const payload = validPayload();
  payload.submissionId = "1df1f7d4-94b2-1f36-a90d-bfcca2f5d201";
  const { response, json } = await invoke(request(payload));
  assert.equal(response.status, 400);
  assert.ok(json.error.fields.submissionId);
});

test("rejects an origin outside the configured allowlist", async () => {
  const mocked = dependencies();
  const { response, json } = await invoke(
    request(validPayload(), { origin: "https://attacker.example" }),
    validEnv(),
    mocked.deps,
  );
  assert.equal(response.status, 403);
  assert.equal(json.error.code, "ORIGIN_REJECTED");
  assert.equal(mocked.calls.turnstile.length, 0);
  assert.equal(mocked.calls.supabase.length, 0);
});

test("rejects a missing proxy credential", async () => {
  const mocked = dependencies();
  const { response, json } = await invoke(
    request(validPayload(), { proxySecret: "" }),
    validEnv(),
    mocked.deps,
  );
  assert.equal(response.status, 403);
  assert.equal(json.error.code, "PROXY_REJECTED");
  assert.equal(mocked.calls.turnstile.length, 0);
});

test("fails closed when required runtime configuration is missing", async () => {
  const env = validEnv();
  delete env.TURNSTILE_SECRET_KEY;
  const { response, json } = await invoke(request(), env);
  assert.equal(response.status, 503);
  assert.equal(json.error.code, "INTAKE_NOT_CONFIGURED");
});

test("rejects a failed Turnstile verification without persisting", async () => {
  const mocked = dependencies({ turnstile: { success: false, "error-codes": ["invalid-input-response"] } });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 403);
  assert.equal(json.error.code, "TURNSTILE_REJECTED");
  assert.equal(mocked.calls.supabase.length, 0);
  assert.equal(mocked.calls.resend.length, 0);
});

test("rejects a Turnstile hostname mismatch", async () => {
  const mocked = dependencies({ turnstile: { success: true, hostname: "attacker.example", action: "assessment_submit" } });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 403);
  assert.equal(json.error.code, "TURNSTILE_REJECTED");
  assert.equal(mocked.calls.supabase.length, 0);
});

test("rejects a Turnstile action mismatch", async () => {
  const mocked = dependencies({ turnstile: { success: true, hostname: "www.agmx.my", action: "login" } });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 403);
  assert.equal(json.error.code, "TURNSTILE_REJECTED");
  assert.equal(mocked.calls.supabase.length, 0);
});

test("persists normalized input and sends only a fixed-template notification", async () => {
  const mocked = dependencies();
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(json.ok, true);
  assert.equal(json.reference, "LD-TEST-001");
  assert.equal(json.token, CHECKOUT_TOKEN);
  assert.equal(json.email.status, "queued");

  const persisted = JSON.parse(mocked.calls.supabase[0].init.body);
  assert.equal(persisted.submissionId, SUBMISSION_ID);
  assert.equal(persisted.assessment.currentProcess, "partial");
  assert.equal(persisted.assessment.organization_id, undefined);
  assert.equal(persisted.assessment.score, undefined);
  assert.equal(mocked.calls.supabase[0].init.headers["x-agmx-intake-key"], INTERNAL_KEY);

  const mail = JSON.parse(mocked.calls.resend[0].init.body);
  assert.equal(mail.from, "AGMX <noreply@agmx.my>");
  assert.deepEqual(mail.to, ["leads@agmx.my"]);
  assert.equal(mail.subject, "New AGMX assessment: LD-TEST-001");
  assert.ok(mail.text.includes("Koperasi Pekerja Maju Berhad"));
  assert.ok(mail.html.includes("Koperasi Pekerja Maju Berhad"));
  assert.equal(JSON.stringify(mail).includes(CHECKOUT_TOKEN), false);
  assert.equal(mocked.calls.resend[0].init.headers["idempotency-key"], `agmx-intake-${SUBMISSION_ID}`);
});

test("keeps a persisted lead successful when notification delivery fails", async () => {
  const mocked = dependencies({ resendStatus: 500 });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 201);
  assert.equal(json.ok, true);
  assert.equal(json.reference, "LD-TEST-001");
  assert.equal(json.email.status, "failed");
});

test("returns 200 for an exact Supabase replay and reuses the email idempotency key", async () => {
  const mocked = dependencies({ supabaseStatus: 200, supabaseBody: successBody({ replayed: true }) });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 200);
  assert.equal(json.replayed, true);
  assert.equal(mocked.calls.resend[0].init.headers["idempotency-key"], `agmx-intake-${SUBMISSION_ID}`);
});

test("returns 409 for conflicting reuse and sends no email", async () => {
  const mocked = dependencies({
    supabaseStatus: 409,
    supabaseBody: { ok: false, error: { code: "SUBMISSION_CONFLICT", message: "Submission id already used" } },
  });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 409);
  assert.equal(json.error.code, "SUBMISSION_CONFLICT");
  assert.equal(mocked.calls.resend.length, 0);
});

test("maps persistence outages to a secret-safe 502", async () => {
  const mocked = dependencies({ supabaseError: new Error(`upstream leaked ${INTERNAL_KEY} aishah@kopemaju.my`) });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 502);
  assert.equal(json.error.code, "PERSISTENCE_UNAVAILABLE");
  assert.equal(JSON.stringify(json).includes(INTERNAL_KEY), false);
  assert.equal(JSON.stringify(json).includes("aishah@kopemaju.my"), false);
  const logged = JSON.stringify(mocked.logs);
  assert.equal(logged.includes(INTERNAL_KEY), false);
  assert.equal(logged.includes(TURNSTILE_SECRET), false);
  assert.equal(logged.includes(CHECKOUT_TOKEN), false);
  assert.equal(logged.includes("aishah@kopemaju.my"), false);
});

test("rejects a malformed persistence response without returning upstream data", async () => {
  const mocked = dependencies({ supabaseStatus: 201, supabaseBody: { ok: true, reference: "LD-LEAK" } });
  const { response, json } = await invoke(request(), validEnv(), mocked.deps);
  assert.equal(response.status, 502);
  assert.equal(json.error.code, "PERSISTENCE_UNAVAILABLE");
  assert.equal(JSON.stringify(json).includes("LD-LEAK"), false);
  assert.equal(mocked.calls.resend.length, 0);
});
