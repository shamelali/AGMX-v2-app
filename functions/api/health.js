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

// Retrieval providers, in the order llm.ts selects them; `needed` names the
// variables supabase/functions/_shared/llm.ts actually reads. Ported from
// api/health.js, which replaced NVIDIA_ENV — names no code path ever looked for.
const LLM_PROVIDERS = [
  { name: "openai", needed: ["OPENAI_API_KEY"] },
  { name: "nvidia", needed: ["NVIDIA_NIM_API_KEY", "NGC_API_KEY"] },
];

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
  return { url, key: keyName ? String(env[keyName]).trim() : "", keyName };
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

// The LLM_* names this platform holds say nothing about the Supabase project's
// secrets: the Edge Functions read their own environment, so a deployment could
// report knowledge ready while every question answered 503 LLM_NOT_CONFIGURED.
// A GET is rejected by the handler with 405 plus its own llmReadiness(), which
// is the function's view of the same question — no question is embedded, no
// completion is billed, and the tenant tables are never touched.
async function llmProbe(url, key) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/functions/v1/knowledge-query`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return {
      checked: true,
      reachable: true,
      status: response.status,
      // 405 is the only shape that carries a verdict; anything else means the
      // gateway answered instead of the handler (404 = not deployed).
      deployed: response.status === 405 || Boolean(body && "llmConfigured" in body),
      llmConfigured: body && typeof body.llmConfigured === "boolean" ? body.llmConfigured : null,
      provider: (body && body.provider) || null,
      latencyMs: Date.now() - startedAt,
    };
  } catch (_) {
    return { checked: true, reachable: false, status: 0, deployed: null, llmConfigured: null, provider: null, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function databaseStatus(env) {
  const { url, key, keyName } = supabaseSettings(env);
  if (!url || !key) {
    return { configured: false, ok: false, latencyMs: null, error: "Supabase is not configured" };
  }
  let checkedTable = "organizations";
  let probe = await restProbe(url, key, checkedTable);
  let latencyMs = probe.latencyMs;
  if (keyName !== "SUPABASE_SECRET_KEY" && (probe.status === 401 || probe.status === 403)) {
    // Anonymous clients can read the plan catalog even when tenant tables are private.
    checkedTable = "plans";
    probe = await restProbe(url, key, checkedTable);
    latencyMs += probe.latencyMs;
  }
  const result = { configured: true, ok: probe.ok, latencyMs, credential: keyName, checkedTable };
  if (probe.ok) return result;
  return {
    ...result,
    status: probe.status,
    error: probe.status === 404
      ? "Supabase schema is not applied"
      : probe.status === 401 || probe.status === 403
        ? `PostgREST denied read access to ${checkedTable} with ${keyName}`
        : "Supabase is unreachable",
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
  const has = (name) => !!String(env[name] || "").trim();
  const chosenName = String(env.LLM_PROVIDER || env.NEXT_PUBLIC_LLM_PROVIDER || "openai").toLowerCase();
  const chosen = LLM_PROVIDERS.find((provider) => provider.name === chosenName) || LLM_PROVIDERS[0];
  const present = chosen.needed.filter((name) => has(name));
  // Any one of these names configures the provider — llm.ts takes the first that
  // is set, and /api/config publishes the room on the same rule. Demanding the
  // alias too would report unconfigured while the site advertises the room.
  const configured = present.length > 0;
  const missing = configured ? [] : chosen.needed;
  const schema = { configured: database.configured, ready: false, missing: [], invalid: [] };
  const { url, key } = supabaseSettings(env);
  if (database.ok) {
    const probe = await restProbe(url, key, "knowledge_chunks");
    schema.ready = probe.ok;
    schema.status = probe.status;
    if (!probe.ok && probe.status !== 401 && probe.status !== 403) schema.invalid = ["KNOWLEDGE_SCHEMA"];
  }
  // `ready` used to mean "this platform holds an LLM key and the table exists",
  // which was true of a project whose functions answered 503 to every question.
  // The function is asked directly; an unreachable probe cannot prove readiness,
  // so it reports null rather than falling back to this platform's guess.
  const functionProbe = configured && database.ok
    ? await llmProbe(url, key)
    : { checked: false, reachable: null, status: 0, deployed: null, llmConfigured: null, provider: null, latencyMs: 0 };
  const invalid = [...schema.invalid];
  if (functionProbe.checked && functionProbe.reachable) {
    if (functionProbe.deployed === false) invalid.push("KNOWLEDGE_FUNCTION_NOT_DEPLOYED");
    if (functionProbe.llmConfigured === false) invalid.push("LLM_NOT_CONFIGURED");
  }
  return {
    provider: `supabase-pgvector+${chosen.name}`,
    configured,
    ready: configured && schema.ready && functionProbe.llmConfigured !== false && functionProbe.deployed !== false,
    missing,
    invalid,
    schema,
    function: functionProbe,
    note: functionProbe.checked
      ? "llm readiness read from the knowledge-query function, not from this platform's variables"
      : "scope: this platform's environment variables, not the Supabase Edge Function's",
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
