/**
 * AGMX Document Ingestion — Supabase Edge Function
 * Indexes documents into pgvector knowledge store
 * Supports OpenAI + NVIDIA NIM via unified LLM client
 * 
 * POST /functions/v1/knowledge-ingest
 *   { document_id: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getEmbedding, chatCompletion, getClientLLMConfig, llmReadiness } from "../_shared/llm.ts"

import { readPassages, splitPassages, maxFileBytes } from "../_shared/document-text.ts"

// SUPABASE_SECRET_KEY is this repo's Vercel-side name; the Edge Runtime injects
// SUPABASE_SERVICE_ROLE_KEY and has no secret called SUPABASE_SECRET_KEY (see
// `supabase secrets list`). Reading only the first made createClient() throw
// `supabaseKey is required.` while the module was still evaluating, so the runtime
// answered `{"code":"WORKER_ERROR"}` to every request, with no log line and no
// JSON body — the same failure knowledge-query shipped with.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SECRET_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || ""

let admin: ReturnType<typeof makeAdminClient> | null = null

function makeAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)
}

// Built on first request, behind the backendReady() guard in the handler, so an
// unconfigured project can answer "not configured" instead of failing to load.
function backendReady() {
  return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && publicKey)
}

function db() {
  if (!admin) admin = makeAdminClient()
  return admin
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

interface IngestRequest {
  document_id: string
}

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return null
  const token = authHeader.replace("Bearer ", "")
  const { data: { user }, error } = await db().auth.getUser(token)
  if (error || !user) return null
  return user
}

async function getUserOrg(userId: string) {
  const { data: profile } = await db()
    .from("profiles")
    .select("organization_id, role")
    .eq("id", userId)
    .single()
  return profile
}

async function checkRateLimit(req: Request): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
             req.headers.get("x-real-ip") || 
             "unknown"
  
  try {
    const { data, error } = await db().rpc("check_rate_limit", {
      p_ip: ip,
      p_limit: 10,
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

async function extractAssertions(chunkText: string): Promise<Array<{ subject: string; predicate: string; object: string; quote: string; confidence: number }>> {
  const prompt = `Extract 3-5 key factual assertions from this text as (subject, predicate, object) triples.
Return a JSON object: {"assertions":[{"subject":"...", "predicate":"...", "object":"...", "quote":"exact passage from the text", "confidence":0.9}]}. Use an empty array if the text contains no factual assertions.

Text: ${chunkText.slice(0, 1500)}`

  try {
    const content = await chatCompletion({
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      responseFormat: { type: "json_object" },
    })
    const items = JSON.parse(content)?.assertions
    if (!Array.isArray(items)) return []
    return items.filter(item => item && ["subject","predicate","object","quote"].every(
      field => typeof item[field] === "string" && item[field].trim().length > 0 && item[field].length <= 1500
    ) && chunkText.includes(item.quote) && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1).slice(0,5)
  } catch {
    return []
  }
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== "POST") {
    const readiness = llmReadiness()
    return new Response(JSON.stringify({
      error: "Method not allowed",
      provider: readiness.provider,
      llmConfigured: readiness.configured,
    }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Both guards run before anything is written: an ingest that cannot embed would
  // leave a knowledge_jobs row stuck in "processing" for a document that can never
  // be indexed.
  if (!backendReady()) {
    return new Response(JSON.stringify({
      code: "BACKEND_NOT_CONFIGURED",
      error: "Ingestion is unavailable: this project exposes no Supabase service key",
    }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const readiness = llmReadiness()
  if (!readiness.configured) {
    return new Response(JSON.stringify({
      code: "LLM_NOT_CONFIGURED",
      provider: readiness.provider,
      error: `Ingestion is unavailable: no API key for provider "${readiness.provider}" — set ${readiness.keyEnv}`,
    }), {
      status: 503,
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
    const { document_id }: IngestRequest = await req.json()

    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // The tenant always comes from the caller's profile, never the body:
    // the writes below run under the service-role key, so a body-supplied
    // organization_id would let any authenticated user re-ingest another
    // tenant's document as long as they knew its id.
    const user = await getAuthUser(req)
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const profile = await getUserOrg(user.id)
    const orgId = profile?.organization_id
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Organization context required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (!["admin","administrator","secretary"].includes(String(profile.role).toLowerCase())) {
      return json(403, { error: "An administrator or secretary must index organisation documents" })
    }
    const caller = createClient(SUPABASE_URL, publicKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: doc, error: docError } = await caller.from("documents")
      .select("id, filename, storage_path, size_bytes, sha256").eq("id", document_id).eq("organization_id", orgId).maybeSingle()
    if (docError || !doc) return json(404, { error: "Document not found" })
    if (!/\.(pdf|docx|md|txt)$/i.test(doc.filename)) return json(415, { error: "Supported formats: PDF, DOCX, TXT and Markdown" })
    if (doc.size_bytes > maxFileBytes) return json(413, { error: "Maximum file size is 8 MiB" })
    const folders = String(doc.storage_path).split("/")
    if (folders[0] !== orgId || folders.some(segment => !segment || segment === "." || segment === "..")) {
      return json(422, { error: "The file must be stored in this organisation’s documents folder" })
    }
    const { data: file, error: downloadError } = await caller.storage.from("documents").download(doc.storage_path)
    if (downloadError || !file) return json(404, { error: "Stored file could not be read" })
    if (file.size > maxFileBytes) return json(413, { error: "Maximum file size is 8 MiB" })
    if (doc.sha256) {
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))
      const hex = Array.from(hash, n => n.toString(16).padStart(2, "0")).join("")
      if (hex !== String(doc.sha256).toLowerCase()) return json(409, { error: "Stored file differs from its registered hash" })
    }
    let passages
    try { passages = splitPassages(await readPassages(file, doc.filename)) }
    catch (error) { return json(422, { error: error instanceof Error ? error.message : "Document could not be read" }) }

    const { data: job, error: jobError } = await db()
      .from("knowledge_jobs")
      .insert({
        organization_id: orgId,
        document_id: doc.id,
        status: "processing",
        source_type: doc.filename.split(".").pop() || "unknown",
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (jobError) throw jobError

    try {
      const model = getClientLLMConfig().embeddingModel
      const indexed = []
      let assertionCount = 0
      for (const passage of passages) {
        const embedding = await getEmbedding(passage.text, "passage")
        const assertions = await extractAssertions(passage.text)
        assertionCount += assertions.length
        indexed.push({ ...passage, model, embedding: JSON.stringify(embedding), assertions })
      }
      const { error } = await db().rpc("publish_document_index", { p_document: doc.id, p_job: job.id, p_chunks: indexed })
      if (error) throw new Error(error.message)
      return json(200, { success: true, jobId: job.id, chunks: indexed.length, assertions: assertionCount })
    } catch (err) {
      await db()
        .from("knowledge_jobs")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id)
      throw err
    }

  } catch (err) {
    console.error("Knowledge ingest error:", err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
