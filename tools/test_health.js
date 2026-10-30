"use strict";

const assert = require("node:assert/strict");
const health = require("../api/health");
const { knowledgeSchemaStatus } = require("../api/_lib/neon");
const { knowledgeConfigStatus } = require("../api/_lib/knowledge-providers");

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
}

async function run() {
  const previousDatabase = process.env.DATABASE_URL;
  const previousNeon = process.env.NEON_DATABASE_URL;
  const knowledgeEnv = [
    "NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_EMBEDDING_MODEL", "NVIDIA_CONCIERGE_MODEL",
  ];
  const previousKnowledge = Object.fromEntries(knowledgeEnv.map((name) => [name, process.env[name]]));
  delete process.env.DATABASE_URL;
  delete process.env.NEON_DATABASE_URL;
  knowledgeEnv.forEach((name) => delete process.env[name]);

  try {
    const degraded = response();
    await health({ method: "GET" }, degraded);
    assert.equal(degraded.statusCode, 503);
    const payload = JSON.parse(degraded.body);
    assert.equal(payload.status, "degraded");
    assert.equal(payload.backend, "neon");
    assert.equal(payload.checks.database.configured, false);
    assert.equal(payload.checks.payments.provider, "billplz");
    assert.equal(payload.checks.knowledge.provider, "neon-pgvector+nvidia");
    assert.equal(payload.checks.knowledge.configured, false);
    assert.equal(payload.checks.knowledge.ready, false);
    assert.deepEqual(payload.checks.knowledge.schema.missing, ["DATABASE_URL"]);
    assert.deepEqual(payload.checks.knowledge.missing, ["NVIDIA_API_KEY", "NVIDIA_BASE_URL"]);
    assert.deepEqual(payload.checks.knowledge.invalid, []);

    process.env.NVIDIA_API_KEY = "test-nvidia-key";
    process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
    assert.deepEqual(knowledgeConfigStatus(), {
      provider: "neon-pgvector+nvidia", configured: true, ready: true, missing: [], invalid: [],
    });
    process.env.NVIDIA_BASE_URL = "http://untrusted.example";
    assert.deepEqual(knowledgeConfigStatus().invalid, ["NVIDIA_BASE_URL"]);
    process.env.NVIDIA_EMBEDDING_MODEL = "other/model";
    assert.deepEqual(knowledgeConfigStatus().invalid, ["NVIDIA_BASE_URL", "NVIDIA_EMBEDDING_MODEL"]);
    process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
    assert.deepEqual(knowledgeConfigStatus().invalid, ["NVIDIA_EMBEDDING_MODEL"]);
    process.env.NVIDIA_EMBEDDING_MODEL = "baai/bge-m3";
    assert.equal(knowledgeConfigStatus().ready, true);
    process.env.NVIDIA_CONCIERGE_MODEL = "invalid/model/name";
    assert.deepEqual(knowledgeConfigStatus().invalid, ["NVIDIA_CONCIERGE_MODEL"]);

    // Exercise schema-readiness aggregation without sending a real DB request.
    process.env.DATABASE_URL = "postgresql://test@example.invalid/test";
    const query = async () => [{
      jobs: true, chunks: true, assertions: true,
      vector_extension: true, embedding_column: true,
      assertion_tenant_constraint: true,
    }];
    assert.deepEqual(await knowledgeSchemaStatus(query), {
      configured: true, ready: true, missing: [], invalid: [],
    });
    assert.deepEqual((await knowledgeSchemaStatus(async () => [{
      jobs: true, chunks: true, assertions: true,
      vector_extension: false, embedding_column: false,
      assertion_tenant_constraint: false,
    }])).missing, ["VECTOR_EXTENSION", "KNOWLEDGE_EMBEDDING_COLUMN", "KNOWLEDGE_ASSERTION_CONSTRAINT"]);
    delete process.env.DATABASE_URL;
    knowledgeEnv.forEach((name) => delete process.env[name]);

    const notAllowed = response();
    await health({ method: "POST" }, notAllowed);
    assert.equal(notAllowed.statusCode, 405);
    assert.equal(JSON.parse(notAllowed.body).error, "Method not allowed");
    console.log("health endpoint tests passed");
  } finally {
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousNeon === undefined) delete process.env.NEON_DATABASE_URL;
    else process.env.NEON_DATABASE_URL = previousNeon;
    for (const name of knowledgeEnv) {
      if (previousKnowledge[name] === undefined) delete process.env[name];
      else process.env[name] = previousKnowledge[name];
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
