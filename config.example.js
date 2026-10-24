/* ============================================================
   AGMX — Config (per-deployment) — Supabase-first Architecture
   ------------------------------------------------------------
   Copy to config.local.js for dev, or set these on Vercel.
   DO NOT commit real values.
   ============================================================ */

window.AGMX_CONFIG = {
  // --- Supabase (Primary Backend) ---
  supabaseUrl: "",           // https://xxx.supabase.co
  supabaseAnonKey: "",       // anon public key
  // SUPABASE_SERVICE_ROLE_KEY is server-only (Vercel env / Supabase Edge Functions)

  // --- LLM Provider (AI Copilot + Knowledge RAG) ---
  // Choose ONE: "openai" or "nvidia"
  llmProvider: "openai",     // or "nvidia" for NVIDIA NIM

  // OpenAI (used when llmProvider: "openai")
  openaiApiKey: "",          // sk-... (for Edge Functions only)
  openaiEmbeddingModel: "text-embedding-3-large",
  openaiChatModel: "gpt-4o-mini",

  // NVIDIA NIM (used when llmProvider: "nvidia")
  // Get API key from https://build.nvidia.com/ (NGC API Key)
  // Or self-host NIM and set baseUrl to your endpoint
  nvidiaNimApiKey: "",       // NGC API Key or NIM API Key
  nvidiaNimBaseUrl: "https://integrate.api.nvidia.com/v1",  // Or your self-hosted NIM URL
  nvidiaNimEmbeddingModel: "nvidia/nv-embedqa-e5-v5",       // 1024 dims
  nvidiaNimChatModel: "meta/llama-3.1-70b-instruct",        // or nemotron-3-ultra, etc.
  nvidiaNimEmbeddingDims: 1024,                             // Match pgvector schema

  // --- Payment Gateways (Server-side only) ---
  // Billplz
  billplzApiKey: "",         // Billplz API key (sandbox: sandbox_...)
  billplzCollectionId: "",   // Billplz collection ID
  // HitPay
  hitpayApiKey: "",          // HitPay API key
  hitpaySalt: "",            // HitPay salt for signature verification

  // --- App ---
  appName: "AGMX",
  appUrl: "https://agmx-v2-app.vercel.app",  // Production URL

  // --- Legacy PocketBase (Realtime only - optional) ---
  // Set if using PocketBase for live quorum/voting
  pocketbaseUrl: "",         // https://agmx-pb.fly.dev
  pocketbaseRealtimeOnly: true,  // If true, skip PB auth, use only for SSE

  // --- Feature Flags ---
  demoMode: true,            // Fallback to mock data if Supabase unavailable
  knowledgeRagEnabled: true, // Enable AI Copilot with RAG
  realtimeEnabled: true,     // Enable live quorum/voting (PocketBase or Supabase Realtime)
};