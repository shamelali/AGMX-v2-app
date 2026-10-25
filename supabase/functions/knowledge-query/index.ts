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
import { getEmbedding, chatCompletion } from "../_shared/llm.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SECRET_KEY")!

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

interface QueryRequest {
  question: string
  organization_id?: string
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
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
}

async function getUserOrg(userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .single()
  return profile
}

async function checkRateLimit(req: Request): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
             req.headers.get("x-real-ip") || 
             "unknown"
  
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
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

async function searchKnowledge(orgId: string, embedding: number[], limit = 8): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc("knowledge_search", {
    p_org_id: orgId,
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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Rate limiting (fail closed)
  if (!(await checkRateLimit(req))) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const { question, organization_id }: QueryRequest = await req.json()

    if (!question || question.length < 3 || question.length > 2000) {
      return new Response(JSON.stringify({ error: "Question must be 3-2000 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Get org_id from auth if not provided
    let orgId = organization_id
    if (!orgId) {
      const authHeader = req.headers.get("Authorization")
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "")
        const { data: { user } } = await supabase.auth.getUser(token)
        if (user) {
          const profile = await getUserOrg(user.id)
          orgId = profile?.organization_id
        }
      }
    }

    if (!orgId) {
      return new Response(JSON.stringify({ error: "Organization context required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Generate embedding
    const embedding = await getEmbedding(question)

    // Search knowledge base
    const results = await searchKnowledge(orgId, embedding)

    // Generate answer with citations
    const answer = await generateAnswer(question, results)

    return new Response(JSON.stringify(answer), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (err) {
    console.error("Knowledge query error:", err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})