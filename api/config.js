/**
 * AGMX — Vercel Edge Function: Runtime Config
 * Serves client-side config from Vercel environment variables
 * 
 * GET /api/config  (vercel.json rewrites /config.js here)
 * Returns: window.AGMX_CONFIG = { ... }
 *
 * The route must stay extensionless: outputDirectory is ".", so this source file
 * is also published as the static path /api/config.js, and Vercel's filesystem
 * lookup runs before rewrites — asking for that path returns this file's own
 * text instead of its output.
 */

export default async function handler(req, res) {
  // HEAD is a read as much as GET is — probes that check this endpoint with
  // curl -I would otherwise be told 405 by the site's own config route.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Method Not Allowed')
  }

  // Feature flags are opt-IN. They used to be opt-OUT (`v !== 'false'`, so an
  // unset variable meant ON), and every Vercel deployment has been created
  // without setting them — which is why the production site reported
  // demoMode:true and api.js:1578 bound the localStorage adapter: quotes,
  // invoices and payments were written to the visitor's browser while the page
  // printed a paid receipt. A backend that exists but is not configured must
  // look absent, never look like a working one.
  const optIn = (v) => v === 'true'

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const demoMode = optIn(process.env.NEXT_PUBLIC_DEMO_MODE)

  // Which gateway methods the checkout page may offer. api/health.js:65 applies
  // the same presence test to the same variables. checkout.js hides every
  // gateway option when this is not "all", so an operator can still narrow a
  // deployment with NEXT_PUBLIC_PAYMENTS_MODE — but asking for "all" without
  // keys is refused, because that is a bill no server can create.
  const gatewayReady = !!(process.env.BILLPLZ_API_KEY && process.env.BILLPLZ_COLLECTION_ID)
    || !!process.env.HITPAY_API_KEY
  const requestedMode = String(process.env.NEXT_PUBLIC_PAYMENTS_MODE || '').toLowerCase()
  const paymentsMode = requestedMode === 'all' || !requestedMode
    ? (gatewayReady ? 'all' : 'bank_transfer')
    : requestedMode

  // Which retrieval provider the knowledge functions will use, and whether this
  // platform holds the key it reads. supabase/functions/_shared/llm.ts selects on
  // LLM_PROVIDER and then needs OPENAI_API_KEY, or NVIDIA_NIM_API_KEY/NGC_API_KEY;
  // NVIDIA_API_KEY and NVIDIA_BASE_URL — the names api/health.js tested — belong to
  // no code path. knowledgeRagEnabled used to be a copy of NEXT_PUBLIC_KNOWLEDGE_RAG,
  // so a deployment advertised a knowledge room whose two Edge Functions answered
  // HTTP 500 to every request. Same rule as paymentsMode a few lines above: the
  // flag may narrow a capability, never invent one. Scope caveat: the keys live in
  // the Supabase project's secrets, so this is this platform's view of them.
  const llmProvider = String(process.env.LLM_PROVIDER || process.env.NEXT_PUBLIC_LLM_PROVIDER || 'openai').toLowerCase()
  const PROVIDER_KEYS = {
    openai: ['OPENAI_API_KEY'],
    nvidia: ['NVIDIA_NIM_API_KEY', 'NGC_API_KEY'],
  }
  const ragReady = (PROVIDER_KEYS[llmProvider] || []).some((name) => !!String(process.env[name] || '').trim())

  const config = {
    // Supabase (client-safe). Publishable key preferred; legacy anon key
    // remains accepted so existing deployments keep working.
    supabaseUrl,
    supabaseAnonKey: anonKey,

    // Stated explicitly so the adapter is chosen by what the deployment
    // declared, not by which of two implicit fallbacks happens to match.
    mode: (!demoMode && supabaseUrl) ? 'supabase' : 'local',

    // LLM Provider
    llmProvider,
    // OpenAI (client-safe, only model names)
    openaiEmbeddingModel: process.env.NEXT_PUBLIC_OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large',
    openaiChatModel: process.env.NEXT_PUBLIC_OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    // NVIDIA NIM (client-safe, only model names)
    nvidiaNimBaseUrl: process.env.NEXT_PUBLIC_NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    nvidiaNimEmbeddingModel: process.env.NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5',
    nvidiaNimChatModel: process.env.NEXT_PUBLIC_NVIDIA_NIM_CHAT_MODEL || 'meta/llama-3.1-70b-instruct',
    nvidiaNimEmbeddingDims: parseInt(process.env.NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_DIMS || '1024', 10),

    // App
    appName: 'AGMX',
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://www.agmx.my',

    // Feature flags
    demoMode,
    // "bank_transfer" hides gateway methods until Billplz/HitPay keys exist.
    // An explicit NEXT_PUBLIC_PAYMENTS_MODE can still force a mode, but only
    // downward: naming "all" without gateway keys would lie.
    paymentsMode,
    // Requires both the operator's opt-in and a provider key this platform can see.
    knowledgeRagEnabled: optIn(process.env.NEXT_PUBLIC_KNOWLEDGE_RAG) && ragReady,
    realtimeEnabled: optIn(process.env.NEXT_PUBLIC_REALTIME),

  }

  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Cache-Control', 'no-store, must-revalidate')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const js = `window.AGMX_CONFIG = ${JSON.stringify(config, null, 2)};`
  // end(), not send(): Vercel's Express-like res.send() overwrites the
  // Content-Type with text/html, and a <script> served as text/html under
  // X-Content-Type-Options: nosniff is refused by the browser — so the page
  // loads with no window.AGMX_CONFIG at all.
  res.status(200).end(js)
}