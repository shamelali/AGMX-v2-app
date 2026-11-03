// AGMX — Cloudflare Pages Function: Runtime Config
// Serves client-side config from Pages environment variables.
// Port of the Vercel function api/config.js: Workers have no process.env,
// env arrives via context, and handlers return Response objects.
// The double extension is load-bearing: Pages file routing strips one .js,
// so this file serves the route /config.js that every HTML page requests.

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const env = context.env;

  // Flags are opt-IN, matching api/config.js. `v !== "false"` made an unset
  // variable mean ON, so a Pages deployment that never set the flags served
  // demoMode:true and the browser silently wrote quotes and payments to
  // localStorage instead of the configured backend.
  const optIn = (v) => v === "true";

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "";
  const demoMode = optIn(env.NEXT_PUBLIC_DEMO_MODE);
  const gatewayReady = !!(env.BILLPLZ_API_KEY && env.BILLPLZ_COLLECTION_ID) || !!env.HITPAY_API_KEY;
  const requestedMode = String(env.NEXT_PUBLIC_PAYMENTS_MODE || "").toLowerCase();
  const paymentsMode = requestedMode === "all" || !requestedMode
    ? (gatewayReady ? "all" : "bank_transfer")
    : requestedMode;

  const config = {
    // Supabase (client-safe). Publishable key preferred; legacy anon key
    // remains accepted so existing deployments keep working.
    supabaseUrl,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",

    // Stated explicitly so the adapter is chosen by what the deployment
    // declared, not by which implicit fallback happens to match.
    mode: !demoMode && supabaseUrl ? "supabase" : "local",

    // LLM Provider
    llmProvider: env.NEXT_PUBLIC_LLM_PROVIDER || "openai",
    openaiEmbeddingModel: env.NEXT_PUBLIC_OPENAI_EMBEDDING_MODEL || "text-embedding-3-large",
    openaiChatModel: env.NEXT_PUBLIC_OPENAI_CHAT_MODEL || "gpt-4o-mini",
    nvidiaNimBaseUrl: env.NEXT_PUBLIC_NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
    nvidiaNimEmbeddingModel: env.NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_MODEL || "nvidia/nv-embedqa-e5-v5",
    nvidiaNimChatModel: env.NEXT_PUBLIC_NVIDIA_NIM_CHAT_MODEL || "meta/llama-3.1-70b-instruct",
    nvidiaNimEmbeddingDims: parseInt(env.NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_DIMS || "1024", 10),

    appName: "AGMX",
    appUrl: env.NEXT_PUBLIC_APP_URL || "https://agmx.pages.dev",

    demoMode,
    paymentsMode,
    knowledgeRagEnabled: optIn(env.NEXT_PUBLIC_KNOWLEDGE_RAG),
    realtimeEnabled: optIn(env.NEXT_PUBLIC_REALTIME),

    pocketbaseUrl: env.NEXT_PUBLIC_POCKETBASE_URL || "",
    pocketbaseRealtimeOnly: true,
  };

  return new Response(`window.AGMX_CONFIG = ${JSON.stringify(config, null, 2)};`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
