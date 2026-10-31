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

  // Unset means ON — set the literal "false" to opt out.
  const flag = (v) => v !== "false";

  const config = {
    // Supabase (client-safe). Publishable key preferred; legacy anon key
    // remains accepted so existing deployments keep working.
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",

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

    demoMode: flag(env.NEXT_PUBLIC_DEMO_MODE),
    knowledgeRagEnabled: flag(env.NEXT_PUBLIC_KNOWLEDGE_RAG),
    realtimeEnabled: flag(env.NEXT_PUBLIC_REALTIME),

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
