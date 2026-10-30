-- AGMX GraphRAG persistence migration.
--
-- Apply this file after neon/schema.sql. Pages are deliberately kept in the
-- queue row as JSONB for now; object storage is an explicit future upgrade.
-- The tables have RLS enabled, but no browser policies: the server-side
-- database owner is the only supported access path in this MVP.

create table if not exists knowledge_jobs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    text not null references organizations(id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 500),
  pages              jsonb not null check (jsonb_typeof(pages) = 'array'),
  status             text not null default 'queued'
                     check (status in ('queued', 'processing', 'ready', 'failed')),
  attempts           integer not null default 0 check (attempts between 0 and 3),
  lease_token        uuid,
  lease_expires_at   timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create table if not exists knowledge_chunks (
  id                 text primary key,
  document_id        uuid not null references knowledge_jobs(id) on delete cascade,
  title              text not null,
  page               integer not null check (page > 0),
  "text"             text not null check (char_length("text") > 0),
  created_at         timestamptz not null default now(),
  unique (document_id, id)
);

create table if not exists knowledge_assertions (
  id                 bigserial primary key,
  document_id        uuid not null references knowledge_jobs(id) on delete cascade,
  source             text not null check (char_length(source) between 1 and 512),
  type               text not null check (type in (
    'PROPOSED_BY', 'SECONDED_BY', 'ADOPTED_AT', 'ASSIGNS_TO', 'GOVERNED_BY',
    'AMENDS', 'SUPERSEDES', 'REQUIRES', 'MEMBER_OF'
  )),
  target             text not null check (char_length(target) between 1 and 512),
  quote             text not null check (char_length(quote) between 1 and 2000),
  chunk_id          text not null references knowledge_chunks(id) on delete cascade,
  constraint knowledge_assertions_document_chunk_fkey
    foreign key (document_id, chunk_id)
    references knowledge_chunks(document_id, id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (document_id, chunk_id, source, type, target, quote)
);

create index if not exists idx_knowledge_jobs_claim
  on knowledge_jobs (status, lease_expires_at, attempts, created_at);
create index if not exists idx_knowledge_jobs_org_status
  on knowledge_jobs (organization_id, status, created_at desc);
create index if not exists idx_knowledge_chunks_document_page
  on knowledge_chunks (document_id, page, id);
create index if not exists idx_knowledge_assertions_document_chunk
  on knowledge_assertions (document_id, chunk_id);
create index if not exists idx_knowledge_assertions_source
  on knowledge_assertions (document_id, source);
create index if not exists idx_knowledge_assertions_target
  on knowledge_assertions (document_id, target);
create index if not exists idx_knowledge_chunks_search
  on knowledge_chunks using gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce("text", ''))
  );

alter table knowledge_jobs enable row level security;
alter table knowledge_chunks enable row level security;
alter table knowledge_assertions enable row level security;

comment on table knowledge_jobs is
  'Durable GraphRAG ingestion queue; pages remain JSONB until object storage is added.';
comment on table knowledge_chunks is
  'Published only when its knowledge job reaches ready.';
comment on table knowledge_assertions is
  'Normalized, quote-provenanced graph edges published with a ready job.';
