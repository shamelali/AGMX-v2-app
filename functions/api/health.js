// AGMX — Cloudflare Pages Function: Health Check
// Port of the Vercel function api/health.js (Node req/res → Workers context).
// Probes Supabase REST (schema applied), Billplz config presence, and
// NVIDIA + knowledge_chunks readiness.

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
// Preference order: server secret > publishable key > legacy anon key.
const SUPABASE_KEY_ENVS = [
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const NVIDIA_ENV = ["NVIDIA_API_KEY", "NVIDIA_BASE_URL"];

// Both ports must answer this the same way or the two backends disagree about
// whether money can move, so the shape lives twice: api/health.js holds the
// explanation of needed vs callback, and why HitPay is checked first.
const GATEWAYS = [
  {
    name: "hitpay",
    needed: ["HITPAY_API_KEY"],
    callback: ["HITPAY_SALT"],
    urlEnv: "HITPAY_API_BASE_URL",
  },
  {
    name: "billplz",
    needed: ["BILLPLZ_API_KEY", "BILLPLZ_COLLECTION_ID"],
    callback: ["BILLPLZ_X_SIGNATURE_KEY", "BILLPLZ_CALLBACK_URL"],
    urlEnv: "BILLPLZ_API_BASE_URL",
  },
];

const PROBE_TIMEOUT_MS = 5000;

function supabaseSettings(env) {
  const url = String(env[SUPABASE_URL_ENV] || "").trim().replace(/\/+$/, "");
  const keyName = SUPABASE_KEY_ENVS.find((name) => String(env[name] || "").trim());
  return { url, key: keyName ? String(env[keyName]).trim() : "" };
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

async function databaseStatus(env) {
  const { url, key } = supabaseSettings(env);
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

function paymentStatus(env) {
  const has = (name) => !!String(env[name] || "").trim();
  const ready = GATEWAYS.find((gateway) => gateway.needed.every(has));
  const chosen = ready || GATEWAYS[0];
  const missing = [...chosen.needed, ...chosen.callback].filter((name) => !has(name));
  const url = String(env[chosen.urlEnv] || "");
  return {
    provider: ready ? ready.name : null,
    can_charge: Boolean(ready),
    configured: Boolean(ready) && missing.length === 0,
    missing,
    mode: ready ? (url.includes("sandbox") ? "sandbox" : "live") : null,
    note: "scope: this platform's environment variables, not the Supabase Edge Function's",
  };
}

async function knowledgeStatus(env, database) {
  const missing = NVIDIA_ENV.filter((name) => !String(env[name] || "").trim());
  const configured = missing.length === 0;
  const schema = { configured: database.configured, ready: false, missing: [], invalid: [] };
  if (database.ok) {
    const { url, key } = supabaseSettings(env);
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

function send(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-AGMX-Health": "runtime",
      ...extraHeaders,
    },
  });
}

export async function onRequest(context) {
  const method = context.request.method;
  if (method !== "GET" && method !== "HEAD") {
    return send(405, { error: "Method not allowed" }, { Allow: "GET, HEAD" });
  }

  const env = context.env;
  const database = await databaseStatus(env);
  const payments = paymentStatus(env);
  const knowledge = await knowledgeStatus(env, database);
  const ready = database.ok;

  if (method === "HEAD") {
    return new Response(null, {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0", "X-AGMX-Health": "runtime" },
    });
  }

  return send(ready ? 200 : 503, {
    ok: ready,
    status: ready ? "ok" : "degraded",
    service: "agmx",
    backend: "supabase",
    checkedAt: new Date().toISOString(),
    checks: { database, payments, knowledge },
    deployment: { provider: "cloudflare-pages", region: context.request.cf?.colo || null },
  });
}
