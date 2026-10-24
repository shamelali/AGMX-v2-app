-- ============================================================
-- AGMX Knowledge Store — pgvector Schema (Supabase)
-- Run in Supabase SQL Editor after: CREATE EXTENSION IF NOT EXISTS vector;
-- ============================================================

-- Enable pgvector if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------
-- KNOWLEDGE JOBS — Track document ingestion jobs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id     UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
  source_type     TEXT NOT NULL,                    -- pdf | docx | txt | md | url
  source_path     TEXT,                             -- Storage path or URL
  total_chunks    INT DEFAULT 0,
  processed_chunks INT DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_org ON public.knowledge_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_status ON public.knowledge_jobs(status);

-- ------------------------------------------------------------
-- KNOWLEDGE CHUNKS — Document chunks with embeddings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  job_id          UUID REFERENCES public.knowledge_jobs(id) ON DELETE SET NULL,
  chunk_index     INT NOT NULL,
  title           TEXT,
  content         TEXT NOT NULL,
  page            INT,
  token_count     INT,
  embedding       VECTOR(1024),  -- OpenAI text-embedding-3-large = 3072 dims; adjust as needed
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org ON public.knowledge_chunks(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON public.knowledge_chunks(document_id);
-- Vector similarity search index (IVFFlat for pgvector)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding 
  ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ------------------------------------------------------------
-- KNOWLEDGE ASSERTIONS — Extracted graph relationships (RAG)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_assertions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_id        UUID NOT NULL REFERENCES public.knowledge_chunks(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  object          TEXT NOT NULL,
  quote           TEXT,           -- Exact text span supporting this assertion
  confidence      NUMERIC(3,2) DEFAULT 0.9,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_assertions_org ON public.knowledge_assertions(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_assertions_chunk ON public.knowledge_assertions(chunk_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_assertions_subject ON public.knowledge_assertions(subject);
CREATE INDEX IF NOT EXISTS idx_knowledge_assertions_predicate ON public.knowledge_assertions(predicate);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.knowledge_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_assertions ENABLE ROW LEVEL SECURITY;

-- Helper function for current org (matches schema.sql)
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT organization_id FROM public.profiles WHERE id = AUTH.UID();
$$;

-- Knowledge Jobs policies
CREATE POLICY "knowledge_jobs_org_isolation" ON public.knowledge_jobs
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- Knowledge Chunks policies
CREATE POLICY "knowledge_chunks_org_isolation" ON public.knowledge_chunks
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- Knowledge Assertions policies
CREATE POLICY "knowledge_assertions_org_isolation" ON public.knowledge_assertions
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- ------------------------------------------------------------
-- VECTOR SEARCH FUNCTION (for Edge Function)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.knowledge_search(
  p_org_id UUID,
  p_query_embedding VECTOR(1024),
  p_limit INT DEFAULT 10,
  p_threshold NUMERIC DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  title TEXT,
  content TEXT,
  page INT,
  similarity NUMERIC,
  assertions JSONB
) LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT 
    kc.id AS chunk_id,
    kc.document_id,
    kc.title,
    kc.content,
    kc.page,
    1 - (kc.embedding <=> p_query_embedding) AS similarity,
    (
      SELECT COALESCE(JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'subject', ka.subject,
          'predicate', ka.predicate,
          'object', ka.object,
          'quote', ka.quote,
          'confidence', ka.confidence
        )
      ), '[]'::jsonb)
      FROM public.knowledge_assertions ka
      WHERE ka.chunk_id = kc.id
    ) AS assertions
  FROM public.knowledge_chunks kc
  WHERE kc.organization_id = p_org_id
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> p_query_embedding) >= p_threshold
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

-- ------------------------------------------------------------
-- GRANT PERMISSIONS
-- ------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.knowledge_jobs TO anon, authenticated, service_role;
GRANT ALL ON public.knowledge_chunks TO anon, authenticated, service_role;
GRANT ALL ON public.knowledge_assertions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_search TO anon, authenticated, service_role;