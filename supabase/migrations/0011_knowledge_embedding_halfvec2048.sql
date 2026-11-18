-- ============================================================
-- 0011 — Knowledge embeddings move to halfvec(2048)
-- ------------------------------------------------------------
-- This version was applied to the linked project before its file
-- existed in this repository, so the migration history named a
-- version no file here could describe. It is reconstructed from the
-- live catalog: knowledge_chunks.embedding is halfvec(2048), the
-- similarity index is HNSW over halfvec_cosine_ops, and
-- knowledge_search() takes an unbounded vector and casts it to the
-- stored halfvec dimension inside the function.
--
-- Why halfvec: a half-precision vector stores two bytes per
-- dimension, so 2048 dimensions fit the space a 1024-dimension
-- float4 vector used to occupy, and the index fits in memory at
-- the member counts a cooperative reaches. The embedding provider
-- returns 2048-dimension vectors, so the previous vector(1024)
-- column could not hold them at all.
--
-- Rerun-safe: every statement is `if exists` / `or replace` / a
-- drop before a create.
-- ============================================================

-- ------------------------------------------------------------
-- The column itself
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_namespace where nspname = 'extensions'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'knowledge_chunks'
      and column_name = 'embedding'
  ) then
    execute 'alter table public.knowledge_chunks '
         || 'alter column embedding type halfvec(2048) '
         || 'using embedding::halfvec(2048)';
  end if;
end $$;

-- ------------------------------------------------------------
-- The index: ivfflat over float4 is replaced by HNSW over
-- half-precision cosine distance
-- ------------------------------------------------------------
drop index if exists public.idx_knowledge_chunks_embedding;
create index if not exists idx_knowledge_chunks_embedding
  on public.knowledge_chunks using hnsw (embedding halfvec_cosine_ops);

-- ------------------------------------------------------------
-- knowledge_search()
-- ------------------------------------------------------------
-- The old signature took vector(1024). It is dropped rather than
-- replaced, because a bounded vector(1024) and an unbounded vector
-- are different argument types: `create or replace` cannot change
-- a function's argument types, and leaving the old signature in
-- place would keep a function that casts 2048-dimension input
-- into 1024 dimensions and silently truncates it.
--
-- The body below is the text the live catalog stores, byte for
-- byte, so the generated bundle hashes the same as production.
-- ------------------------------------------------------------
drop function if exists public.knowledge_search(vector(1024), int, numeric);

create or replace function public.knowledge_search(
  p_query_embedding vector,
  p_limit integer default 10,
  p_threshold numeric default 0.65
)
returns table(
  chunk_id uuid,
  document_id uuid,
  title text,
  content text,
  page integer,
  similarity numeric,
  assertions jsonb
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select
    kc.id as chunk_id,
    kc.document_id,
    kc.title,
    kc.content,
    kc.page,
    1 - (kc.embedding <=> p_query_embedding::halfvec(2048)) as similarity,
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'subject', ka.subject, 'predicate', ka.predicate, 'object', ka.object,
          'quote', ka.quote, 'confidence', ka.confidence
        )
      ), '[]'::jsonb)
      from public.knowledge_assertions ka
      where ka.chunk_id = kc.id
    ) as assertions
  from public.knowledge_chunks kc
  where kc.organization_id = public.current_org_id()
    and kc.embedding is not null
    and 1 - (kc.embedding <=> p_query_embedding::halfvec(2048)) >= p_threshold
  order by kc.embedding <=> p_query_embedding::halfvec(2048)
  limit p_limit;
$function$;

revoke execute on function public.knowledge_search(vector, integer, numeric) from public, anon;
grant execute on function public.knowledge_search(vector, integer, numeric) to authenticated;
