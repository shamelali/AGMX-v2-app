"use strict";

const assert = require("node:assert/strict");
const health = require("../api/health");

const SUPABASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
// The names the retrieval code actually reads (supabase/functions/_shared/llm.ts),
// plus the provider selector and the openai key. The handler picks a provider by
// LLM_PROVIDER, so any of these left in the shell would change the case under test.
const LLM_ENV = [
  "LLM_PROVIDER",
  "NEXT_PUBLIC_LLM_PROVIDER",
  "OPENAI_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "NGC_API_KEY",
];
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
const ALL_ENV = [...SUPABASE_ENV, ...LLM_ENV, ...PAYMENT_ENV];

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
    assert.equal(payload.checks.knowledge.provider, "supabase-pgvector+openai");
    assert.equal(payload.checks.knowledge.configured, false);
    assert.equal(payload.checks.knowledge.ready, false);
    assert.deepEqual(payload.checks.knowledge.missing, ["OPENAI_API_KEY"]);
    assert.deepEqual(payload.checks.knowledge.invalid, []);
    assert.equal(payload.checks.knowledge.schema.ready, false);

    process.env.OPENAI_API_KEY = "test-openai-key";
    const knowledgeOnly = response();
    await health({ method: "GET" }, knowledgeOnly);
    const knowledgePayload = JSON.parse(knowledgeOnly.body);
    assert.equal(knowledgePayload.checks.knowledge.configured, true);
    assert.equal(knowledgePayload.checks.knowledge.ready, false, "schema cannot be ready without a database");

    // The nvidia branch reads NVIDIA_NIM_API_KEY/NGC_API_KEY and never the
    // openai key, so a provider switch must not report an openai key as enough.
    process.env.LLM_PROVIDER = "nvidia";
    delete process.env.OPENAI_API_KEY;
    const nvidiaMissing = response();
    await health({ method: "GET" }, nvidiaMissing);
    const nvidiaPayload = JSON.parse(nvidiaMissing.body);
    assert.equal(nvidiaPayload.checks.knowledge.provider, "supabase-pgvector+nvidia");
    assert.equal(nvidiaPayload.checks.knowledge.configured, false);
    assert.deepEqual(nvidiaPayload.checks.knowledge.missing, ["NVIDIA_NIM_API_KEY", "NGC_API_KEY"]);
    process.env.NVIDIA_NIM_API_KEY = "test-nvidia-key";
    const nvidiaReady = response();
    await health({ method: "GET" }, nvidiaReady);
    assert.equal(JSON.parse(nvidiaReady.body).checks.knowledge.configured, true);
    delete process.env.LLM_PROVIDER;
    delete process.env.NVIDIA_NIM_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai-key";

    // Healthy path: both REST probes answer 200 and the function reports its own
    // LLM readiness, no network involved.
    const requested = [];
    const functionAnswer = (body, status = 405) => ({
      ok: false,
      status,
      json: async () => body,
    });
    global.fetch = async (url) => {
      requested.push(String(url));
      if (String(url).includes("/functions/v1/knowledge-query")) {
        return functionAnswer({ error: "Method not allowed", provider: "openai", llmConfigured: true });
      }
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
    assert.ok(
      requested.includes("https://project.supabase.co/functions/v1/knowledge-query"),
      "readiness must be read from the function, whose secrets this host cannot see"
    );
    assert.deepEqual(healthyPayload.checks.knowledge.invalid, []);
    // The GET probe must stay a GET: a POST would embed the question and bill a
    // completion on every health check.
    assert.equal(
      requested.filter((u) => u.includes("/functions/v1/knowledge-query")).length,
      1,
      "one probe per health call"
    );

    // The shape this guards against: this host holds NVIDIA_NIM_API_KEY, so the
    // old check reported ready:true while the deployed function answered every
    // question with 503 LLM_NOT_CONFIGURED because Supabase had no such secret.
    global.fetch = async (url) => {
      if (String(url).includes("/functions/v1/knowledge-query")) {
        return functionAnswer({ error: "Method not allowed", provider: "nvidia", llmConfigured: false });
      }
      return { ok: true, status: 200 };
    };
    const keyOnHostNotFunction = response();
    await health({ method: "GET" }, keyOnHostNotFunction);
    const hostOnly = JSON.parse(keyOnHostNotFunction.body).checks.knowledge;
    assert.equal(hostOnly.configured, true, "this host still holds a key");
    assert.equal(hostOnly.ready, false, "but the function cannot answer");
    assert.ok(hostOnly.invalid.includes("LLM_NOT_CONFIGURED"));
    assert.equal(hostOnly.function.llmConfigured, false);

    // A gateway 404 means the function was never deployed, which the schema
    // probe cannot see: knowledge_chunks can exist without the function.
    global.fetch = async (url) => {
      if (String(url).includes("/functions/v1/knowledge-query")) {
        return functionAnswer({ message: "Not Found" }, 404);
      }
      return { ok: true, status: 200 };
    };
    const notDeployed = response();
    await health({ method: "GET" }, notDeployed);
    const undeployed = JSON.parse(notDeployed.body).checks.knowledge;
    assert.equal(undeployed.ready, false);
    assert.ok(undeployed.invalid.includes("KNOWLEDGE_FUNCTION_NOT_DEPLOYED"));

    // An unreachable probe proves nothing either way, so it must not flip the
    // verdict to false: a transient network error is not a feature outage.
    global.fetch = async (url) => {
      if (String(url).includes("/functions/v1/knowledge-query")) throw new Error("fetch failed");
      return { ok: true, status: 200 };
    };
    const probeDown = response();
    await health({ method: "GET" }, probeDown);
    const unproven = JSON.parse(probeDown.body).checks.knowledge;
    assert.equal(unproven.function.reachable, false);
    assert.equal(unproven.ready, true, "cannot disprove readiness, so do not claim it is broken");
    assert.deepEqual(unproven.invalid, []);

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

    // Both ports answer knowledge readiness from the same function probe, so
    // they must agree on it too — the payments loop above only covers gateways.
    const cfKnowledge = async (env, answer) => {
      global.fetch = async (url) => {
        if (String(url).includes("/functions/v1/knowledge-query")) return answer();
        return { ok: true, status: 200 };
      };
      const res = await cf.onRequest({
        request: { method: "GET", url: "https://cf.test/api/health" },
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SECRET_KEY: "service-test-key",
          OPENAI_API_KEY: "test-openai-key",
          ...env,
        },
      });
      return (await res.json()).checks.knowledge;
    };
    for (const [label, answer, ready, invalid] of [
      ["llm configured", () => functionAnswer({ provider: "openai", llmConfigured: true }), true, []],
      ["llm missing in function", () => functionAnswer({ provider: "nvidia", llmConfigured: false }), false, ["LLM_NOT_CONFIGURED"]],
      ["function not deployed", () => functionAnswer({ message: "Not Found" }, 404), false, ["KNOWLEDGE_FUNCTION_NOT_DEPLOYED"]],
    ]) {
      process.env.OPENAI_API_KEY = "test-openai-key";
      global.fetch = async (url) => {
        if (String(url).includes("/functions/v1/knowledge-query")) return answer();
        return { ok: true, status: 200 };
      };
      const res = response();
      await health({ method: "GET" }, res);
      const vercel = JSON.parse(res.body).checks.knowledge;
      const cloudflare = await cfKnowledge({}, answer);
      assert.equal(vercel.ready, ready, `vercel port: ${label}`);
      assert.equal(cloudflare.ready, ready, `cloudflare port: ${label}`);
      assert.deepEqual(vercel.invalid, invalid, `vercel port: ${label}`);
      assert.deepEqual(cloudflare.invalid, invalid, `cloudflare port: ${label}`);
    }
    global.fetch = async () => ({ ok: true, status: 200 });

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
