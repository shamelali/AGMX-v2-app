-- ============================================================
-- AGMX Knowledge Store — pgvector Schema (Supabase)
-- Fixed: secure function, rerun-safe policies, proper grants
-- ============================================================

create extension if not exists "vector";

-- ------------------------------------------------------------
-- KNOWLEDGE JOBS
-- ------------------------------------------------------------
create table if not exists public.knowledge_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete set null,
  status          text not null default 'pending',
  source_type     text not null,
  source_path     text,
  total_chunks    int default 0,
  processed_chunks int default 0,
  error_message   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_jobs_org on public.knowledge_jobs(organization_id);
create index if not exists idx_knowledge_jobs_status on public.knowledge_jobs(status);

-- ------------------------------------------------------------
-- KNOWLEDGE CHUNKS
-- ------------------------------------------------------------
create table if not exists public.knowledge_chunks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  job_id          uuid references public.knowledge_jobs(id) on delete set null,
  chunk_index     int not null,
  title           text,
  content         text not null,
  page            int,
  token_count     int,
  embedding       vector(1024),
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_chunks_org on public.knowledge_chunks(organization_id);
create index if not exists idx_knowledge_chunks_doc on public.knowledge_chunks(document_id);
create index if not exists idx_knowledge_chunks_embedding 
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ------------------------------------------------------------
-- KNOWLEDGE ASSERTIONS
-- ------------------------------------------------------------
create table if not exists public.knowledge_assertions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  chunk_id        uuid not null references public.knowledge_chunks(id) on delete cascade,
  subject         text not null,
  predicate       text not null,
  object          text not null,
  quote           text,
  confidence      numeric(3,2) default 0.9,
  created_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_assertions_org on public.knowledge_assertions(organization_id);
create index if not exists idx_knowledge_assertions_chunk on public.knowledge_assertions(chunk_id);
create index if not exists idx_knowledge_assertions_subject on public.knowledge_assertions(subject);
create index if not exists idx_knowledge_assertions_predicate on public.knowledge_assertions(predicate);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.knowledge_jobs      enable row level security;
alter table public.knowledge_chunks    enable row level security;
alter table public.knowledge_assertions enable row level security;

do $$
begin
  execute 'drop policy if exists kj_org on public.knowledge_jobs';
  execute 'create policy kj_org on public.knowledge_jobs for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  execute 'drop policy if exists kc_org on public.knowledge_chunks';
  execute 'create policy kc_org on public.knowledge_chunks for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  execute 'drop policy if exists ka_org on public.knowledge_assertions';
  execute 'create policy ka_org on public.knowledge_assertions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
end $$;

-- ------------------------------------------------------------
-- SECURE VECTOR SEARCH FUNCTION
-- ------------------------------------------------------------
-- Verifies caller belongs to the organization they're querying
-- Returns only chunks/assertions from caller's organization
create or replace function public.knowledge_search(
  p_query_embedding vector(1024),
  p_limit int default 10,
  p_threshold numeric default 0.65
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  content text,
  page int,
  similarity numeric,
  assertions jsonb
) language sql stable security definer as $$
  select 
    kc.id as chunk_id,
    kc.document_id,
    kc.title,
    kc.content,
    kc.page,
    1 - (kc.embedding <=> p_query_embedding) as similarity,
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'subject', ka.subject,
          'predicate', ka.predicate,
          'object', ka.object,
          'quote', ka.quote,
          'confidence', ka.confidence
        )
      ), '[]'::jsonb)
      from public.knowledge_assertions ka
      where ka.chunk_id = kc.id
    ) as assertions
  from public.knowledge_chunks kc
  where kc.organization_id = public.current_org_id()  -- Enforce caller's org
    and kc.embedding is not null
    and 1 - (kc.embedding <=> p_query_embedding) >= p_threshold
  order by kc.embedding <=> p_query_embedding
  limit p_limit;
$$;

-- ------------------------------------------------------------
-- GRANT PERMISSIONS (explicit, no PUBLIC execute)
-- ------------------------------------------------------------
revoke execute on function public.knowledge_search(vector(1024), int, numeric) from public, anon;
grant execute on function public.knowledge_search(vector(1024), int, numeric) to authenticated;
grant all on public.knowledge_jobs to authenticated, service_role;
grant all on public.knowledge_chunks to authenticated, service_role;
grant all on public.knowledge_assertions to authenticated, service_role;