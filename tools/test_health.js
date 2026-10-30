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
const ALL_ENV = [...SUPABASE_ENV, ...NVIDIA_ENV];

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
    assert.equal(payload.checks.payments.provider, "billplz");
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
