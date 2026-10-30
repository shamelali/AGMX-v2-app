-- Apply after neon/schema.sql and neon/graphrag.sql.
-- NVIDIA baai/bge-m3 embeddings are fixed at 1024 dimensions. Existing
-- chunks remain nullable until republished with an embedding.
create extension if not exists vector;

do $$
declare
  existing_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into existing_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'knowledge_chunks'
     and a.attname = 'embedding'
     and a.attnum > 0
     and not a.attisdropped;

  if existing_type is null then
    alter table knowledge_chunks add column embedding vector(1024);
  elsif existing_type <> 'vector(1024)' then
    raise exception 'knowledge_chunks.embedding must be vector(1024), found %', existing_type;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'knowledge_assertions_document_chunk_fkey'
       and conrelid = 'knowledge_assertions'::regclass
  ) then
    alter table knowledge_assertions
      add constraint knowledge_assertions_document_chunk_fkey
      foreign key (document_id, chunk_id)
      references knowledge_chunks(document_id, id) on delete cascade;
  end if;
end $$;

-- Start with exact, tenant-scoped cosine search. The existing jobs org/status
-- and chunks document indexes support the filter; an ANN index can postfilter
-- away tenant matches and should only be added after measuring the workload.
