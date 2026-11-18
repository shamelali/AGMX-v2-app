#!/usr/bin/env python3
"""Write the two migrations this repository is missing, from the live catalog.

Version 0011 (knowledge_embedding_halfvec2048) and the current body of
auto_provision_user_on_signup() were applied to the linked project from a
branch that never landed here, so `supabase migration list` reported them
applied while no file described them, and the generated bundle still carried
the pre-halfvec knowledge_search and a sign-up trigger that never created
the profiles row the dashboard then failed to find.

The bodies are taken from pg_proc.prosrc on the linked project, not from
pg_get_functiondef: the drift check hashes prosrc, and the catalog's
pretty-printed form is not what the database stores.
"""
import json
import pathlib

PROSRC = json.load(open("/tmp/opencode/prosrc.json"))
BODIES = {row["proname"]: row["prosrc"] for row in PROSRC}

KNOWLEDGE_SEARCH = BODIES["knowledge_search"]
AUTO_PROVISION = BODIES["auto_provision_user_on_signup"]

migrations = pathlib.Path("supabase/migrations")

# ---------------------------------------------------------------- 0011
(migrations / "0011_knowledge_embedding_halfvec2048.sql").write_text(
    f"""-- ============================================================
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
as $function${KNOWLEDGE_SEARCH}$function$;

revoke execute on function public.knowledge_search(vector, integer, numeric) from public, anon;
grant execute on function public.knowledge_search(vector, integer, numeric) to authenticated;
""",
    encoding="utf-8",
)

# ------------------------------------------------- 20261113083423
(migrations / "20261113083423_auto_provision_user.sql").write_text(
    f"""-- Auto-provision organization + profile when a new user signs up.
-- Without this, auth.users rows have no matching profiles row, so
-- AGMX_API.loadDashboard() fails with "Profile not found" and the
-- landing page never loads after sign-in.
--
-- The body below is the text the linked project runs, byte for byte:
-- the version that shipped from a branch which never landed in this
-- repository also creates the profiles row, and the file that was
-- here did not, so the repository described a trigger production
-- never ran.
--
-- Rerun-safe: every statement is create or replace / insert ... on conflict
-- / drop trigger if exists.

create or replace function public.auto_provision_user_on_signup()
returns trigger language plpgsql as $function${AUTO_PROVISION}$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.auto_provision_user_on_signup();
""",
    encoding="utf-8",
)

print("wrote 0011_knowledge_embedding_halfvec2048.sql")
print("rewrote 20261113083423_auto_provision_user.sql")
