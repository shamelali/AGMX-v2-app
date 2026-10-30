"use strict";

const { ping, knowledgeSchemaStatus } = require("./_lib/neon");
const { knowledgeConfigStatus } = require("./_lib/knowledge-providers");

const BILLPLZ_ENV = [
  "BILLPLZ_API_KEY",
  "BILLPLZ_COLLECTION_ID",
  "BILLPLZ_X_SIGNATURE_KEY",
  "BILLPLZ_CALLBACK_URL",
];

function paymentStatus() {
  const missing = BILLPLZ_ENV.filter((name) => !String(process.env[name] || "").trim());
  return {
    provider: "billplz",
    configured: missing.length === 0,
    missing,
    mode: String(process.env.BILLPLZ_API_BASE_URL || "").includes("sandbox") ? "sandbox" : "live",
  };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-AGMX-Health", "runtime");
  res.end(JSON.stringify(payload));
}

module.exports = async function health(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, { error: "Method not allowed" });
  }

  const database = await ping();
  const payments = paymentStatus();
  const knowledgeConfig = knowledgeConfigStatus();
  const schema = database.ok
    ? await knowledgeSchemaStatus()
    : { configured: false, ready: false, missing: ["DATABASE_URL"], invalid: [] };
  const knowledge = {
    ...knowledgeConfig,
    schema,
    ready: knowledgeConfig.ready && schema.ready,
  };
  const ready = database.ok;
  const payload = {
    ok: ready,
    status: ready ? "ok" : "degraded",
    service: "agmx",
    backend: "neon",
    checkedAt: new Date().toISOString(),
    checks: { database, payments, knowledge },
    deployment: {
      provider: "vercel",
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      region: process.env.VERCEL_REGION || null,
    },
  };

  if (req.method === "HEAD") {
    res.statusCode = ready ? 200 : 503;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-AGMX-Health", "runtime");
    return res.end();
  }
  return send(res, ready ? 200 : 503, payload);
};
