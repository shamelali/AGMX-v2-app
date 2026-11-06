/**
 * AGMX Knowledge Query — Supabase Edge Function
 * Supports OpenAI + NVIDIA NIM via unified LLM client
 * 
 * POST /functions/v1/knowledge-query
 *   { question: string, organization_id?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getEmbedding, chatCompletion, llmReadiness } from "../_shared/llm.ts"

// SUPABASE_SECRET_KEY is this repo's Vercel-side name; the Edge Runtime injects
// SUPABASE_SERVICE_ROLE_KEY and has no secret called SUPABASE_SECRET_KEY (see
// `supabase secrets list`). Reading only the first made createClient() throw
// `supabaseKey is required.` while the module was still evaluating, so the
// runtime answered `{"code":"WORKER_ERROR"}` to every request — even a GET, which
// the handler below would have rejected with 405. A module-scope throw produces
// no log line and no JSON body, which is why this went unnoticed.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SECRET_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || ""

function makeAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)
}

// Annotated from a real call rather than ReturnType<typeof createClient>: the
// generic overloads collapse to a client whose rpc() takes `undefined` and whose
// from() resolves to never, so `deno check` rejects every call site.
let admin: ReturnType<typeof makeAdminClient> | null = null

// Built on first request rather than at module scope: an unconfigured project must
// be able to answer "not configured", and cannot if loading the file is what
// fails. Every caller runs behind the backendReady() guard in the handler.
function backendReady() {
  return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY)
}

function adminClient() {
  if (!admin) admin = makeAdminClient()
  return admin
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

interface QueryRequest {
  question: string
  // organization_id is deliberately not accepted: knowledge_search derives the
  // tenant from the caller's JWT (schema_final.sql), and honouring a body value
  // would let any authenticated user read another organisation's documents.
}

interface SearchResult {
  chunk_id: string
  document_id: string
  title: string | null
  content: string
  page: number | null
  similarity: number
  assertions: any[]
}

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return null
  const token = authHeader.replace("Bearer ", "")
  const { data: { user }, error } = await adminClient().auth.getUser(token)
  if (error || !user) return null
  return user
}

async function checkRateLimit(req: Request): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
             req.headers.get("x-real-ip") || 
             "unknown"
  
  try {
    const { data, error } = await adminClient().rpc("check_rate_limit", {
      p_ip: ip,
      p_limit: 30,
      p_window: "1 minute"
    })
    if (error) {
      console.error("Rate limit check failed:", error)
      return false // Fail closed
    }
    return data === true
  } catch (err) {
    console.error("Rate limit RPC failed:", err)
    return false // Fail closed
  }
}

// knowledge_search filters by public.current_org_id(), i.e. the org of
// auth.uid(). That only resolves for a client carrying the caller's JWT: the
// service-role client used elsewhere in this function has no uid, so every
// search would return zero rows, and passing an org id in the body (the
// previous design) turns a tenancy check into a caller-supplied field.
async function searchKnowledge(token: string, embedding: number[], limit = 8): Promise<SearchResult[]> {
  if (!SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY is not configured")
  const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await asCaller.rpc("knowledge_search", {
    p_query_embedding: embedding,
    p_limit: limit,
    p_threshold: 0.65,
  })
  if (error) throw new Error(`Knowledge search error: ${error.message}`)
  return data || []
}

async function generateAnswer(question: string, results: SearchResult[]) {
  if (!results.length) {
    return {
      claims: [],
      unknowns: ["No relevant documents found in your knowledge base."],
      evidence: { chunks: [], assertions: [] },
    }
  }

  const context = results.map((r, i) => 
    `[${i + 1}] ${r.title || "Untitled"} (page ${r.page || "N/A"}):\n${r.content.slice(0, 2000)}`
  ).join("\n\n---\n\n")

  const prompt = `You are an AI Governance Copilot for Malaysian cooperatives. Answer the question using ONLY the provided context from the organization's indexed documents.

Rules:
- Each claim must cite source chunks using [1], [2], etc.
- Mark claims as "fact" (directly stated) or "inference" (reasoned from context)
- List unknowns that cannot be answered from the context
- Be concise and professional

Context:
${context}

Question: ${question}

Respond in this exact JSON format:
{
  "claims": [
    { "text": "Claim text", "kind": "fact", "citations": ["1", "2"] },
    { "text": "Another claim", "kind": "inference", "citations": ["3"] }
  ],
  "unknowns": ["What the documents don't cover"],
  "evidence": { "chunks": [], "assertions": [] }
}`

  const content = await chatCompletion({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    maxTokens: 2000,
  })

  const parsed = JSON.parse(content)

  return {
    claims: parsed.claims || [],
    unknowns: parsed.unknowns || [],
    evidence: { chunks: results, assertions: results.flatMap(r => r.assertions) },
  }
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== "POST") {
    const readiness = llmReadiness()
    return json(405, {
      error: "Method not allowed",
      provider: readiness.provider,
      llmConfigured: readiness.configured,
    })
  }

  // Before the rate-limit check, so a project with no credentials is told the
  // truth about its credentials instead of being told it sent too fast.
  if (!backendReady()) {
    return json(503, {
      code: "BACKEND_NOT_CONFIGURED",
      error: "Knowledge retrieval is unavailable: this project exposes no Supabase service key",
    })
  }
  const readiness = llmReadiness()
  if (!readiness.configured) {
    return json(503, {
      code: "LLM_NOT_CONFIGURED",
      provider: readiness.provider,
      error: `Knowledge retrieval is unavailable: no API key for provider "${readiness.provider}" — set ${readiness.keyEnv}`,
    })
  }

  // Rate limiting (fail closed)
  if (!(await checkRateLimit(req))) {
    return json(429, { error: "Rate limit exceeded" })
  }

  try {
    const { question }: QueryRequest = await req.json()

    if (!question || question.length < 3 || question.length > 2000) {
      return json(400, { error: "Question must be 3-2000 characters" })
    }

    // The caller's identity is the tenancy context for the search, so it is
    // required rather than optional.
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "")
    const user = token ? await getAuthUser(req) : null
    if (!user) {
      return json(401, { error: "Unauthorized" })
    }

    // Generate embedding
    const embedding = await getEmbedding(question)

    // Search knowledge base
    const results = await searchKnowledge(token, embedding)

    // Generate answer with citations
    const answer = await generateAnswer(question, results)

    return new Response(JSON.stringify(answer), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    console.error("Knowledge query error:", err)
    return json(500, { error: err instanceof Error ? err.message : "Internal error" })
  }
})