"use strict";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
// Preference order: server secret > publishable key > legacy anon key.
const SUPABASE_KEY_ENVS = [
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const NVIDIA_ENV = ["NVIDIA_API_KEY", "NVIDIA_BASE_URL"];

const BILLPLZ_ENV = [
  "BILLPLZ_API_KEY",
  "BILLPLZ_COLLECTION_ID",
  "BILLPLZ_X_SIGNATURE_KEY",
  "BILLPLZ_CALLBACK_URL",
];

const PROBE_TIMEOUT_MS = 5000;

function supabaseSettings() {
  const url = String(process.env[SUPABASE_URL_ENV] || "").trim().replace(/\/+$/, "");
  const keyName = SUPABASE_KEY_ENVS.find((name) => String(process.env[name] || "").trim());
  return { url, key: keyName ? String(process.env[keyName]).trim() : "" };
}

// PostgREST answers 200 for an existing table (RLS may return zero rows) and
// 404 when the schema was never applied. The status code is all we read.
async function restProbe(url, key, table) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/rest/v1/${table}?select=id&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, latencyMs: Date.now() - startedAt };
  } catch (_) {
    return { ok: false, status: 0, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function databaseStatus() {
  const { url, key } = supabaseSettings();
  if (!url || !key) {
    return { configured: false, ok: false, latencyMs: null, error: "Supabase is not configured" };
  }
  const probe = await restProbe(url, key, "organizations");
  if (probe.ok) {
    return { configured: true, ok: true, latencyMs: probe.latencyMs };
  }
  return {
    configured: true,
    ok: false,
    latencyMs: probe.latencyMs,
    error: probe.status === 404 ? "Supabase schema is not applied" : "Supabase is unreachable",
  };
}

function paymentStatus() {
  const missing = BILLPLZ_ENV.filter((name) => !String(process.env[name] || "").trim());
  return {
    provider: "billplz",
    configured: missing.length === 0,
    missing,
    mode: String(process.env.BILLPLZ_API_BASE_URL || "").includes("sandbox") ? "sandbox" : "live",
  };
}

async function knowledgeStatus(database) {
  const missing = NVIDIA_ENV.filter((name) => !String(process.env[name] || "").trim());
  const configured = missing.length === 0;
  const schema = { configured: database.configured, ready: false, missing: [], invalid: [] };
  if (database.ok) {
    const { url, key } = supabaseSettings();
    const probe = await restProbe(url, key, "knowledge_chunks");
    schema.ready = probe.ok;
    if (!probe.ok) schema.invalid = ["KNOWLEDGE_SCHEMA"];
  }
  return {
    provider: "supabase-pgvector+nvidia",
    configured,
    ready: configured && schema.ready,
    missing,
    invalid: [],
    schema,
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

  const database = await databaseStatus();
  const payments = paymentStatus();
  const knowledge = await knowledgeStatus(database);
  const ready = database.ok;
  const payload = {
    ok: ready,
    status: ready ? "ok" : "degraded",
    service: "agmx",
    backend: "supabase",
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
