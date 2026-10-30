/* ============================================================
   AGMX — Config (per-deployment)
   ------------------------------------------------------------
   Copy to config.local.js for dev, or set these on Vercel.
   DO NOT commit real values.
   ============================================================ */

window.AGMX_CONFIG = {
  // --- Supabase (Primary Backend) ---
  supabaseUrl: "",           // https://xxx.supabase.co
  supabaseAnonKey: "",       // anon public key (client-safe; RLS enforces access)
  // SUPABASE_SERVICE_ROLE_KEY is server-only (Vercel env / Supabase Edge Functions)

  // --- Legacy PocketBase (Auth + Realtime bridge; optional) ---
  url: "http://127.0.0.1:8090",           // PocketBase instance
  googleClientId: "",       // Google OAuth2 client ID (see GOOGLE_AUTH_SETUP.md)
  pocketbaseRealtimeOnly: true,  // If true, skip PB auth, use only for SSE/realtime

  // --- Backend / Diagnostics ---
  appName: "AGMX",
  backend: "pocketbase-bridge",
  healthUrl: "/api/health",
  requestTimeoutMs: 10000,
  knowledgeTimeoutMs: 90000,  // GraphRAG retrieval + generation; allow longer than CRUD calls.
  devTools: false,

  // --- App ---
  appUrl: "https://agmx-v2-app.vercel.app",  // Production URL

  // --- LLM Provider (AI Copilot + Knowledge RAG) ---
  // Choose ONE: "openai" or "nvidia"
  llmProvider: "openai",     // or "nvidia" for NVIDIA NIM
  // OpenAI (used when llmProvider: "openai")
  openaiApiKey: "",          // sk-... (for Edge Functions only)
  openaiEmbeddingModel: "text-embedding-3-large",
  openaiChatModel: "gpt-4o-mini",
  // NVIDIA NIM (used when llmProvider: "nvidia")
  nvidiaNimApiKey: "",       // NGC API Key or NIM API Key (server-only)
  nvidiaNimBaseUrl: "https://integrate.api.nvidia.com/v1",
  nvidiaNimEmbeddingModel: "nvidia/nv-embedqa-e5-v5",       // 1024 dims
  nvidiaNimChatModel: "meta/llama-3.1-70b-instruct",
  nvidiaNimEmbeddingDims: 1024,

  // --- Payment Gateways (Server-side only) ---
  // Billplz
  billplzApiKey: "",         // Billplz API key (sandbox: sandbox_...)
  billplzCollectionId: "",   // Billplz collection ID
  // HitPay
  hitpayApiKey: "",          // HitPay API key
  hitpaySalt: "",            // HitPay salt for signature verification

  // --- Feature Flags ---
  demoMode: true,            // Fallback to mock data if backend unavailable
  paymentDemo: true,         // Payment flow is demonstrative until gateway/webhook configured
  knowledgeRagEnabled: true, // Enable AI Copilot with RAG
  realtimeEnabled: true,     // Enable live quorum/voting (PocketBase or Supabase Realtime)

  // --- Demo / Fallback ---
  // When true and backend is unreachable, fall back to data.js mock data so
  // the demo still runs. Set false in production.
};
