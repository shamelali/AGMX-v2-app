/**
 * AGMX — Vercel Edge Function: Runtime Config
 * Serves client-side config from Vercel environment variables
 * 
 * GET /api/config.js
 * Returns: window.AGMX_CONFIG = { ... }
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed')
  }

  const config = {
    // Supabase (client-safe)
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',

    // LLM Provider
    llmProvider: process.env.NEXT_PUBLIC_LLM_PROVIDER || 'openai',
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
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://agmx-v2-app.vercel.app',

    // Feature flags
    demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || true,
    knowledgeRagEnabled: process.env.NEXT_PUBLIC_KNOWLEDGE_RAG === 'true' || true,
    realtimeEnabled: process.env.NEXT_PUBLIC_REALTIME === 'true' || true,

    // Legacy PocketBase (optional, for realtime only)
    pocketbaseUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL || '',
    pocketbaseRealtimeOnly: true,
  }

  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Cache-Control', 'no-store, must-revalidate')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const js = `window.AGMX_CONFIG = ${JSON.stringify(config, null, 2)};`
  res.status(200).send(js)
}