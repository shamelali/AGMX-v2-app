/**
 * AGMX Document Ingestion — Supabase Edge Function
 * Indexes documents into pgvector knowledge store
 * Supports OpenAI + NVIDIA NIM via unified LLM client
 * 
 * POST /functions/v1/knowledge-ingest
 *   { document_id: string, organization_id?: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders, handleCors } from "../_shared/cors.ts"
import { getEmbedding, chatCompletion } from "../_shared/llm.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const CHUNK_SIZE = 1000 // tokens
const CHUNK_OVERLAP = 200

interface IngestRequest {
  document_id: string
  organization_id?: string
}

async function extractTextFromDocument(documentId: string): Promise<string> {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("storage_path, mime, filename")
    .eq("id", documentId)
    .single()

  if (error || !doc) throw new Error("Document not found")

  const { data: fileData, error: downloadError } = await supabase.storage
    .from("documents")
    .download(doc.storage_path)

  if (downloadError || !fileData) throw new Error("Failed to download document")

  const arrayBuffer = await fileData.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  const mime = doc.mime || ""
  let text = ""

  if (mime === "application/pdf") {
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
    text = decoder.decode(uint8Array)
    text = text.replace(/[^\x20-\x7E\n\r\t]/g, " ")
  } else if (mime.includes("word") || mime.includes("officedocument")) {
    const decoder = new TextDecoder("utf-8")
    text = decoder.decode(uint8Array)
  } else {
    const decoder = new TextDecoder("utf-8")
    text = decoder.decode(uint8Array)
  }

  return text.slice(0, 50000)
}

function chunkText(text: string, chunkSize: number, overlap: number): Array<{ content: string; index: number }> {
  const chunks = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  let currentChunk = ""
  let index = 0

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push({ content: currentChunk.trim(), index: index++ })
      const words = currentChunk.split(/\s+/)
      const overlapWords = words.slice(-Math.floor(overlap / 5))
      currentChunk = overlapWords.join(" ") + " " + sentence
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({ content: currentChunk.trim(), index: index++ })
  }

  return chunks
}

async function extractAssertions(chunkText: string): Promise<Array<{ subject: string; predicate: string; object: string; quote: string; confidence: number }>> {
  const prompt = `Extract 3-5 key factual assertions from this text as (subject, predicate, object) triples.
Return JSON array: [{"subject": "...", "predicate": "...", "object": "...", "quote": "...", "confidence": 0.9}]

Text: ${chunkText.slice(0, 1500)}`

  try {
    const content = await chatCompletion({
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      responseFormat: { type: "json_object" },
    })
    return JSON.parse(content)?.assertions || []
  } catch {
    return []
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

  try {
    const { document_id, organization_id }: IngestRequest = await req.json()

    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, organization_id, filename")
      .eq("id", document_id)
      .single()

    if (docError || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const orgId = organization_id || doc.organization_id

    const { data: job, error: jobError } = await supabase
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
      const text = await extractTextFromDocument(doc.id)
      if (!text.trim()) throw new Error("No text extracted")

      const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP)
      const processedChunks = []
      const allAssertions = []

      for (const chunk of chunks) {
        const embedding = await getEmbedding(chunk.content)
        const assertions = await extractAssertions(chunk.content)

        const { data: chunkData, error: chunkError } = await supabase
          .from("knowledge_chunks")
          .insert({
            organization_id: orgId,
            document_id: doc.id,
            job_id: job.id,
            chunk_index: chunk.index,
            title: doc.filename,
            content: chunk.content,
            page: null,
            token_count: Math.ceil(chunk.content.length / 4),
            embedding: `[${embedding.join(",")}]`,
            metadata: {},
          })
          .select()
          .single()

        if (chunkError) throw chunkError

        if (assertions.length > 0) {
          const assertionsWithChunk = assertions.map(a => ({
            organization_id: orgId,
            document_id: doc.id,
            chunk_id: chunkData.id,
            subject: a.subject,
            predicate: a.predicate,
            object: a.object,
            quote: a.quote,
            confidence: a.confidence || 0.8,
          }))
          await supabase.from("knowledge_assertions").insert(assertionsWithChunk)
          allAssertions.push(...assertionsWithChunk)
        }

        processedChunks.push(chunkData)
      }

      await supabase
        .from("knowledge_jobs")
        .update({
          status: "completed",
          total_chunks: chunks.length,
          processed_chunks: processedChunks.length,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id)

      return new Response(JSON.stringify({
        success: true,
        jobId: job.id,
        chunks: processedChunks.length,
        assertions: allAssertions.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })

    } catch (err) {
      await supabase
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