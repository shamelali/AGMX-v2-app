"use strict";

const assert = require("node:assert/strict");
const health = require("../api/health");

const SUPABASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
const NVIDIA_ENV = ["NVIDIA_API_KEY", "NVIDIA_BASE_URL"];
// Cleared too, so the payments assertions describe the handler and not the
// shell it happens to run in: the assertions below check which gateway the
// handler selects, and a HITPAY_API_KEY left in a developer's or CI
// environment would silently change the case being tested.
const PAYMENT_ENV = [
  "HITPAY_API_KEY",
  "HITPAY_SALT",
  "HITPAY_API_BASE_URL",
  "BILLPLZ_API_KEY",
  "BILLPLZ_COLLECTION_ID",
  "BILLPLZ_X_SIGNATURE_KEY",
  "BILLPLZ_CALLBACK_URL",
  "BILLPLZ_API_BASE_URL",
];
const ALL_ENV = [...SUPABASE_ENV, ...NVIDIA_ENV, ...PAYMENT_ENV];

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
}

async function run() {
  const saved = Object.fromEntries(ALL_ENV.map((name) => [name, process.env[name]]));
  const realFetch = global.fetch;
  ALL_ENV.forEach((name) => delete process.env[name]);

  try {
    const degraded = response();
    await health({ method: "GET" }, degraded);
    assert.equal(degraded.statusCode, 503);
    const payload = JSON.parse(degraded.body);
    assert.equal(payload.status, "degraded");
    assert.equal(payload.backend, "supabase");
    assert.equal(payload.checks.database.configured, false);
    assert.equal(payload.checks.database.ok, false);
    assert.equal(payload.checks.database.error, "Supabase is not configured");
    assert.equal(payload.checks.payments.provider, null, "no gateway is configured in this case");
    assert.equal(payload.checks.payments.can_charge, false);
    assert.equal(payload.checks.payments.configured, false);
    assert.deepEqual(payload.checks.payments.missing, ["HITPAY_API_KEY", "HITPAY_SALT"]);
    assert.equal(payload.checks.knowledge.provider, "supabase-pgvector+nvidia");
    assert.equal(payload.checks.knowledge.configured, false);
    assert.equal(payload.checks.knowledge.ready, false);
    assert.deepEqual(payload.checks.knowledge.missing, ["NVIDIA_API_KEY", "NVIDIA_BASE_URL"]);
    assert.deepEqual(payload.checks.knowledge.invalid, []);
    assert.equal(payload.checks.knowledge.schema.ready, false);

    process.env.NVIDIA_API_KEY = "test-nvidia-key";
    process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
    const knowledgeOnly = response();
    await health({ method: "GET" }, knowledgeOnly);
    const knowledgePayload = JSON.parse(knowledgeOnly.body);
    assert.equal(knowledgePayload.checks.knowledge.configured, true);
    assert.equal(knowledgePayload.checks.knowledge.ready, false, "schema cannot be ready without a database");

    // Healthy path: both REST probes answer 200, no network involved.
    const requested = [];
    global.fetch = async (url) => {
      requested.push(String(url));
      return { ok: true, status: 200 };
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co/";
    process.env.SUPABASE_SECRET_KEY = "service-test-key";
    const healthy = response();
    await health({ method: "GET" }, healthy);
    const healthyPayload = JSON.parse(healthy.body);
    assert.equal(healthy.statusCode, 200);
    assert.equal(healthyPayload.ok, true);
    assert.equal(healthyPayload.backend, "supabase");
    assert.equal(healthyPayload.checks.database.ok, true);
    assert.equal(typeof healthyPayload.checks.database.latencyMs, "number");
    assert.equal(healthyPayload.checks.knowledge.ready, true);
    assert.deepEqual(requested, [
      "https://project.supabase.co/rest/v1/organizations?select=id&limit=0",
      "https://project.supabase.co/rest/v1/knowledge_chunks?select=id&limit=0",
    ]);

    // Schema never applied: PostgREST answers 404 for both probes.
    global.fetch = async () => ({ ok: false, status: 404 });
    const missingSchema = response();
    await health({ method: "GET" }, missingSchema);
    const missingPayload = JSON.parse(missingSchema.body);
    assert.equal(missingSchema.statusCode, 503);
    assert.equal(missingPayload.checks.database.error, "Supabase schema is not applied");
    assert.equal(missingPayload.checks.knowledge.ready, false);

    // Partial schema: transactional tables exist but knowledge was never applied.
    global.fetch = async (url) => ({ ok: !String(url).includes("knowledge_chunks"), status: String(url).includes("knowledge_chunks") ? 404 : 200 });
    const partialSchema = response();
    await health({ method: "GET" }, partialSchema);
    const partialPayload = JSON.parse(partialSchema.body);
    assert.equal(partialPayload.checks.database.ok, true);
    assert.equal(partialPayload.checks.knowledge.ready, false);
    assert.deepEqual(partialPayload.checks.knowledge.schema.invalid, ["KNOWLEDGE_SCHEMA"]);

    // Unreachable database is not reported as a missing schema.
    global.fetch = async () => { throw new Error("network down"); };
    const unreachable = response();
    await health({ method: "GET" }, unreachable);
    assert.equal(JSON.parse(unreachable.body).checks.database.error, "Supabase is unreachable");

    // Which gateway the probe names, and whether half a gateway is distinguish-
    // able from a whole one. This block is the test that was missing: the probe
    // asserted provider "billplz" unconditionally, so a deployment configured
    // for the shipping gateway (HitPay) reported configured:false while
    // /api/config published paymentsMode "all" from the very key health ignored.
    global.fetch = async () => ({ ok: true, status: 200 });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "service-test-key";
    const payments = async () => {
      const res = response();
      await health({ method: "GET" }, res);
      return JSON.parse(res.body).checks.payments;
    };

    process.env.HITPAY_API_KEY = "hk_live_test_key";
    const keyWithoutSalt = await payments();
    assert.equal(keyWithoutSalt.provider, "hitpay");
    assert.equal(keyWithoutSalt.can_charge, true, "a payment request can be created");
    assert.equal(keyWithoutSalt.configured, false, "but no callback can be believed without the salt");
    assert.deepEqual(keyWithoutSalt.missing, ["HITPAY_SALT"]);
    assert.equal(keyWithoutSalt.mode, "live", "api/hitpay defaults to the live host when unset");

    process.env.HITPAY_SALT = "webhook-salt";
    process.env.HITPAY_API_BASE_URL = "https://api.sandbox.hit-pay.com";
    const hitpay = await payments();
    assert.equal(hitpay.provider, "hitpay");
    assert.equal(hitpay.can_charge, true);
    assert.equal(hitpay.configured, true);
    assert.deepEqual(hitpay.missing, []);
    assert.equal(hitpay.mode, "sandbox", "the configured URL decides, not a default");

    delete process.env.HITPAY_API_KEY;
    delete process.env.HITPAY_SALT;
    delete process.env.HITPAY_API_BASE_URL;
    process.env.BILLPLZ_API_KEY = "legacy-key";
    process.env.BILLPLZ_COLLECTION_ID = "legacy-collection";
    process.env.BILLPLZ_X_SIGNATURE_KEY = "legacy-signature";
    process.env.BILLPLZ_CALLBACK_URL = "https://example.test/api/billplz/callback";
    const billplz = await payments();
    assert.equal(billplz.provider, "billplz", "an older deployment reports the gateway it holds");
    assert.equal(billplz.configured, true);

    // HitPay is the shipping gateway: with both configured, health names it.
    process.env.HITPAY_API_KEY = "hk_live_test_key";
    process.env.HITPAY_SALT = "webhook-salt";
    assert.equal((await payments()).provider, "hitpay");
    delete process.env.HITPAY_API_KEY;
    delete process.env.HITPAY_SALT;

    // The Cloudflare port answers the same question for the same dashboard, from
    // context.env instead of process.env, so the two drift unless something
    // compares them — and a bug in one is invisible in the other.
    let cf = null;
    try {
      cf = await import("../functions/api/health.js");
    } catch (error) {
      assert.fail(`the Cloudflare health port cannot be loaded for comparison: ${error.message}`);
    }
    const cfPayments = async (env) => {
      const res = await cf.onRequest({
        request: { method: "GET", url: "https://cf.test/api/health" },
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SECRET_KEY: "service-test-key",
          ...env,
        },
      });
      return (await res.json()).checks.payments;
    };
    for (const testCase of [
      {},
      { HITPAY_API_KEY: "hk_live_key" },
      { HITPAY_API_KEY: "hk_live_key", HITPAY_SALT: "webhook-salt" },
      { HITPAY_API_KEY: "hk_live_key", HITPAY_SALT: "webhook-salt", HITPAY_API_BASE_URL: "https://api.sandbox.hit-pay.com" },
      { BILLPLZ_API_KEY: "bk", BILLPLZ_COLLECTION_ID: "bc-1" },
      { BILLPLZ_API_KEY: "bk", BILLPLZ_COLLECTION_ID: "bc-1", BILLPLZ_X_SIGNATURE_KEY: "sig", BILLPLZ_CALLBACK_URL: "https://host.test/api/billplz/callback" },
    ]) {
      for (const name of PAYMENT_ENV) delete process.env[name];
      Object.assign(process.env, testCase);
      assert.deepEqual(
        await cfPayments(testCase),
        await payments(),
        `the two health ports disagree for ${JSON.stringify(testCase)}`,
      );
    }
    for (const name of PAYMENT_ENV) delete process.env[name];

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = "service-test-key";
    global.fetch = realFetch;
    const head = response();
    await health({ method: "HEAD" }, head);
    assert.equal(head.statusCode, 503);
    assert.equal(head.body, undefined);

    const notAllowed = response();
    await health({ method: "POST" }, notAllowed);
    assert.equal(notAllowed.statusCode, 405);
    assert.equal(JSON.parse(notAllowed.body).error, "Method not allowed");

    console.log("health endpoint tests passed");
  } finally {
    global.fetch = realFetch;
    for (const name of ALL_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
