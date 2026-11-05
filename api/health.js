"use strict";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
// Preference order: server secret > publishable key > legacy anon key.
const SUPABASE_KEY_ENVS = [
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const NVIDIA_ENV = ["NVIDIA_API_KEY", "NVIDIA_BASE_URL"];

// Gateways in the order this product ships them. HitPay is first because
// Billplz was retired after a key leaked; its variables stay readable so an
// older deployment reports what it actually holds instead of being reported as
// unconfigured.
//   needed   — enough to ask a customer for money
//   callback — enough to believe the notification that says the money arrived
// `configured` used to mean "all four BILLPLZ_* names are set", a test no
// correct HitPay deployment can pass: /api/config published paymentsMode "all"
// from HITPAY_API_KEY while /api/health answered configured:false about a
// gateway it had never looked for. Both endpoints now read the same variables.
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

function supabaseSettings() {
  const url = String(process.env[SUPABASE_URL_ENV] || "").trim().replace(/\/+$/, "");
  const keyName = SUPABASE_KEY_ENVS.find((name) => String(process.env[name] || "").trim()) || null;
  // The name is reported, never the value: without it a 401 here is
  // indistinguishable from a database that is genuinely down.
  return { url, key: keyName ? String(process.env[keyName]).trim() : "", keyName };
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
  const { url, key, keyName } = supabaseSettings();
  if (!url || !key) {
    return { configured: false, ok: false, latencyMs: null, error: "Supabase is not configured" };
  }
  const probe = await restProbe(url, key, "organizations");
  if (probe.ok) {
    return { configured: true, ok: true, latencyMs: probe.latencyMs, credential: keyName };
  }
  // 42501 is not an outage. `grant select ... to authenticated` is the only
  // table grant in supabase/migrations/0001_schema.sql, so a publishable key is
  // refused on every table by design and no probe can pass with one; calling
  // that "unreachable" sends the operator to check the network.
  const refused = probe.status === 401 || probe.status === 403;
  return {
    configured: true,
    ok: false,
    latencyMs: probe.latencyMs,
    credential: keyName,
    status: probe.status,
    error: probe.status === 404
      ? "Supabase schema is not applied"
      : refused
        ? `PostgREST refused the probe (401/403): this check needs a secret key, and ${keyName} only reaches authenticated-granted tables. Set SUPABASE_SECRET_KEY.`
        : "Supabase is unreachable",
  };
}

function paymentStatus(env = process.env) {
  const has = (name) => !!String(env[name] || "").trim();
  const ready = GATEWAYS.find((gateway) => gateway.needed.every(has));
  // When nothing can charge, report against the gateway this product ships,
  // so `missing` names the variables an operator should actually set.
  const chosen = ready || GATEWAYS[0];
  const missing = [...chosen.needed, ...chosen.callback].filter((name) => !has(name));
  const url = String(env[chosen.urlEnv] || "");
  return {
    provider: ready ? ready.name : null,
    // Split in two, because half a gateway is the dangerous shape: bills can be
    // created and paid while the callback that marks them paid is unverifiable,
    // and a single boolean previously hid that behind one word.
    can_charge: Boolean(ready),
    configured: Boolean(ready) && missing.length === 0,
    missing,
    // Both Vercel gateway endpoints default to their live host, so an unset URL
    // means live here. money-flow defaults to sandbox and names its variable
    // HITPAY_API_URL instead; this probe reports the mode its platform implies.
    mode: ready ? (url.includes("sandbox") ? "sandbox" : "live") : null,
    // Read alongside `configured`, never instead of it: money-flow runs in
    // Supabase with its own HITPAY_* secrets, and nothing on this side of that
    // boundary can prove they exist.
    note: "scope: this platform's environment variables, not the Supabase Edge Function's",
  };
}

async function knowledgeStatus(database) {
  const missing = NVIDIA_ENV.filter((name) => !String(process.env[name] || "").trim());
  const configured = missing.length === 0;
  const schema = { configured: database.configured, ready: false, missing: [], invalid: [] };
  // knowledge_chunks is an authenticated-granted table too, so this probe is
  // only meaningful once the database check is holding a secret key.
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
