"use strict";

const { sql } = require("./neon");

const MAX_PAGES = 200;
const MAX_PAGE_CHARS = 500000;
const MAX_TITLE_CHARS = 500;
const MAX_SEED_IDS = 20;
const EMBEDDING_DIMENSIONS = 1024;
const SUPPORTED_TYPES = new Set([
  "PROPOSED_BY", "SECONDED_BY", "ADOPTED_AT", "ASSIGNS_TO", "GOVERNED_BY",
  "AMENDS", "SUPERSEDES", "REQUIRES", "MEMBER_OF",
]);

function text(value, name, max) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  const result = value.trim();
  if (result.length > max) throw new RangeError(`${name} is too long`);
  return result;
}

function boundedString(value, name, max) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  if (value.length > max) throw new RangeError(`${name} is too long`);
  return value;
}

function organization(value) {
  return text(value, "orgId", 200);
}

function uuid(value, name) {
  const result = text(value, name, 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new TypeError(`${name} must be a UUID`);
  }
  return result;
}

function validatePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > MAX_PAGES) {
    throw new RangeError(`pages must contain 1-${MAX_PAGES} pages`);
  }
  let total = 0;
  const seen = new Set();
  return pages.map((page) => {
    if (!page || !Number.isSafeInteger(page.page) || page.page < 1) {
      throw new TypeError("each page must have a positive integer page number");
    }
    if (seen.has(page.page)) throw new TypeError("page numbers must be unique");
    seen.add(page.page);
    if (typeof page.text !== "string") throw new TypeError("each page text must be a string");
    total += page.text.length;
    if (total > MAX_PAGE_CHARS) throw new RangeError("document text exceeds 500000 characters");
    return { page: page.page, text: page.text };
  });
}

function normalizeEntity(value, name) {
  let kind;
  let label;
  if (typeof value === "string") {
    label = value;
  } else if (value && typeof value === "object") {
    label = value.name || value.label;
    kind = value.type;
  }
  label = text(label, name, 500).replace(/\s+/g, " ").toLowerCase();
  if (kind !== undefined) {
    kind = text(kind, `${name}.type`, 80).toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return `${kind}:${label}`.slice(0, 512);
  }
  return label.slice(0, 512);
}

function normalizeType(value) {
  const result = text(value, "assertion.type", 80).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (!SUPPORTED_TYPES.has(result)) throw new TypeError(`unsupported assertion type: ${result}`);
  return result;
}

function normalizeChunks(jobId, chunks) {
  if (!Array.isArray(chunks) || chunks.length > 300) {
    throw new RangeError("chunks must contain 0-300 items");
  }
  const ids = new Set();
  return chunks.map((chunk) => {
    if (!chunk || typeof chunk !== "object") throw new TypeError("invalid chunk");
    const id = text(chunk.id, "chunk.id", 200);
    if (ids.has(id)) throw new TypeError("duplicate chunk id");
    ids.add(id);
    const suffix = id.slice(`${jobId}:`.length);
    if (!id.startsWith(`${jobId}:`) || !/^\d+$/.test(suffix) || String(Number(suffix)) !== suffix || Number(suffix) >= 300) {
      throw new TypeError("chunk id must be documentId:index");
    }
    if (!Number.isSafeInteger(chunk.page) || chunk.page < 1) throw new TypeError("chunk.page must be positive");
    const body = boundedString(chunk.text, "chunk.text", 5000);
    return { id, title: text(chunk.title, "chunk.title", MAX_TITLE_CHARS), page: chunk.page, body };
  });
}

function normalizeAssertions(jobId, chunks, assertions) {
  if (!Array.isArray(assertions) || assertions.length > 3000) throw new RangeError("invalid assertions");
  const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk.body]));
  const unique = new Set();
  return assertions.map((assertion) => {
    if (!assertion || typeof assertion !== "object") throw new TypeError("invalid assertion");
    const chunkId = text(assertion.chunkId, "assertion.chunkId", 200);
    const body = chunkMap.get(chunkId);
    if (!body) throw new TypeError("assertion references an unknown chunk");
    const source = normalizeEntity(assertion.source, "assertion.source");
    const target = normalizeEntity(assertion.target, "assertion.target");
    const type = normalizeType(assertion.type);
    const quote = boundedString(assertion.quote, "assertion.quote", 2000);
    if (!body.includes(quote)) throw new TypeError("assertion quote is not an exact chunk substring");
    const key = `${chunkId}\u0000${source}\u0000${type}\u0000${target}\u0000${quote}`;
    if (unique.has(key)) return null;
    unique.add(key);
    return { documentId: jobId, source, type, target, quote, chunkId };
  }).filter(Boolean);
}

function vectorLiteral(values, name) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(`${name} must contain exactly ${EMBEDDING_DIMENSIONS} dimensions`);
  }
  if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError(`${name} must contain only finite numbers`);
  }
  if (values.every(value => value === 0)) throw new RangeError(`${name} must not be zero`);
  return `[${values.join(",")}]`;
}

function normalizeEmbeddings(chunks, embeddings) {
  if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) {
    throw new RangeError("embeddings must contain one record per chunk");
  }
  const ids = new Set(chunks.map(chunk => chunk.id));
  const byId = new Map();
  for (const embedding of embeddings) {
    if (!embedding || typeof embedding !== "object") throw new TypeError("invalid embedding");
    const id = text(embedding.id, "embedding.id", 200);
    if (!ids.has(id) || byId.has(id)) throw new TypeError("embedding id must match a unique chunk id");
    byId.set(id, vectorLiteral(embedding.values, "embedding.values"));
  }
  return chunks.map(chunk => ({ ...chunk, embedding: byId.get(chunk.id) }));
}

async function enqueue(orgId, input) {
  const organizationId = organization(orgId);
  if (!input || typeof input !== "object") throw new TypeError("input is required");
  const title = text(input.title, "title", MAX_TITLE_CHARS);
  const pages = validatePages(input.pages);
  const rows = await sql()`
    insert into knowledge_jobs (organization_id, title, pages)
    select o.id, ${title}, ${JSON.stringify(pages)}::jsonb
      from organizations o
     where o.id = ${organizationId} and o.status in ('active', 'trial')
    returning id::text as id, status
  `;
  return rows[0] ? { id: rows[0].id, status: rows[0].status } : null;
}

async function job(orgId, id) {
  const rows = await sql()`
      select knowledge_jobs.id::text as id, knowledge_jobs.organization_id as "organizationId",
           knowledge_jobs.title, knowledge_jobs.pages, knowledge_jobs.status,
           knowledge_jobs.attempts, knowledge_jobs.lease_token::text as "leaseToken",
           knowledge_jobs.lease_expires_at as "leaseExpiresAt",
           knowledge_jobs.created_at as "createdAt", knowledge_jobs.updated_at as "updatedAt",
           knowledge_jobs.completed_at as "completedAt"
      from knowledge_jobs
      join organizations o on o.id = knowledge_jobs.organization_id
     where knowledge_jobs.organization_id = ${organization(orgId)}
       and knowledge_jobs.id = ${uuid(id, "id")}::uuid
       and o.status in ('active', 'trial')
     limit 1
  `;
  return rows[0] || null;
}

async function claim() {
  const rows = await sql()`
    with expired as (
      update knowledge_jobs
         set status = 'failed', lease_token = null, lease_expires_at = null,
             updated_at = now(), last_error = 'lease expired after maximum attempts'
       where status = 'processing' and attempts >= 3 and lease_expires_at < now()
      returning id
    ), candidate as (
      select knowledge_jobs.id
        from knowledge_jobs
        join organizations o on o.id = knowledge_jobs.organization_id
       where knowledge_jobs.attempts < 3
         and o.status in ('active', 'trial')
         and not exists (select 1 from expired e where e.id = knowledge_jobs.id)
         and (knowledge_jobs.status = 'queued' or
              (knowledge_jobs.status = 'processing' and knowledge_jobs.lease_expires_at < now()))
       order by knowledge_jobs.created_at
        for update of knowledge_jobs skip locked
       limit 1
    ), claimed as (
      update knowledge_jobs j
         set status = 'processing', attempts = j.attempts + 1,
             lease_token = gen_random_uuid(), lease_expires_at = now() + interval '15 minutes',
             updated_at = now(), last_error = null
        from candidate c
       where j.id = c.id
       returning j.id::text as id, j.organization_id as "organizationId", j.title, j.pages,
                 j.status, j.attempts, j.lease_token::text as "leaseToken",
                 j.lease_expires_at as "leaseExpiresAt"
    )
    select * from claimed
  `;
  return rows[0] || null;
}

async function renew(jobId, leaseToken) {
  const id = uuid(jobId, "jobId");
  const lease = uuid(leaseToken, "leaseToken");
  const rows = await sql()`
    update knowledge_jobs
       set lease_expires_at = now() + interval '15 minutes', updated_at = now()
     where id = ${id}::uuid and status = 'processing' and lease_token = ${lease}::uuid
       and lease_expires_at > now()
     returning id::text as id
  `;
  return Boolean(rows[0]);
}

async function complete(jobId, leaseToken, chunks, assertions, embeddings) {
  const id = uuid(jobId, "jobId");
  const lease = uuid(leaseToken, "leaseToken");
  const safeChunks = normalizeChunks(id, chunks);
  const safeAssertions = normalizeAssertions(id, safeChunks, assertions);
  const publishChunks = normalizeEmbeddings(safeChunks, embeddings);
  const rows = await sql()`
    with guarded as (
      select id from knowledge_jobs
       where id = ${id}::uuid and status = 'processing'
         and lease_token = ${lease}::uuid and lease_expires_at > now()
       for update
    ), inserted_chunks as (
      insert into knowledge_chunks (id, document_id, title, page, "text", embedding)
      select c.id, g.id, c.title, c.page, c.body, c.embedding::vector
        from guarded g
        cross join jsonb_to_recordset(${JSON.stringify(publishChunks)}::jsonb)
          as c(id text, title text, page integer, body text, embedding text)
      returning id
    ), inserted_assertions as (
      insert into knowledge_assertions (document_id, source, type, target, quote, chunk_id)
       select a."documentId"::uuid, a.source, a.type, a.target, a.quote, a."chunkId"
        from guarded g
        cross join jsonb_to_recordset(${JSON.stringify(safeAssertions)}::jsonb)
           as a("documentId" text, source text, type text, target text, quote text, "chunkId" text)
        where a."documentId"::uuid = g.id
          and exists (select 1 from inserted_chunks c where c.id = a."chunkId")
      returning id
    )
    update knowledge_jobs j
       set status = 'ready', lease_token = null, lease_expires_at = null,
           completed_at = now(), updated_at = now()
     where j.id in (select id from guarded)
     returning j.id::text as id
  `;
  if (!rows[0]) throw new Error("Knowledge job lease is stale or no longer processing");
}

async function semanticSearch(orgId, vector) {
  const organizationId = organization(orgId);
  const embedding = vectorLiteral(vector, "query vector");
  const rows = await sql()`
    with scoped as materialized (
      select c.id, c.embedding
        from knowledge_chunks c
        join knowledge_jobs j on j.id = c.document_id
        join organizations o on o.id = j.organization_id
       where j.organization_id = ${organizationId}
         and j.status = 'ready' and o.status in ('active', 'trial')
         and c.embedding is not null
    ), query_vector as (select ${embedding}::vector as embedding)
    select c.id, 1 - (c.embedding <=> q.embedding) as score
      from scoped c cross join query_vector q
     order by c.embedding <=> q.embedding, c.id
     limit 20
  `;
  return rows.map(row => ({ id: row.id, score: Number(row.score) }));
}

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new RangeError("limit must be an integer between 1 and 100");
  }
  return parsed;
}

async function unembeddedChunks(limit = 50) {
  const batchSize = boundedLimit(limit);
  return sql()/* sql */`
    select c.id, c."text"
      from knowledge_chunks c
      join knowledge_jobs j on j.id = c.document_id
      join organizations o on o.id = j.organization_id
     where j.status = 'ready'
       and o.status in ('active', 'trial')
       and c.embedding is null
     order by c.id
     limit ${batchSize}
  `;
}

async function setEmbedding(chunkId, values) {
  const id = text(chunkId, "chunkId", 200);
  const embedding = vectorLiteral(values, "embedding");
  const rows = await sql()/* sql */`
    update knowledge_chunks
       set embedding = ${embedding}::vector
     where id = ${id} and embedding is null
     returning id
  `;
  return Boolean(rows[0]);
}

async function schemaStatus() {
  const { knowledgeSchemaStatus } = require("./neon");
  return knowledgeSchemaStatus();
}

async function fail(jobId, leaseToken) {
  const id = uuid(jobId, "jobId");
  const lease = uuid(leaseToken, "leaseToken");
  await sql()`
    update knowledge_jobs
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           lease_token = null, lease_expires_at = null, updated_at = now(),
           last_error = 'ingestion worker failed'
     where id = ${id}::uuid and status = 'processing' and lease_token = ${lease}::uuid
  `;
}

async function evidence(orgId, chunkIds, query) {
  const organizationId = organization(orgId);
  if (!Array.isArray(chunkIds)) throw new TypeError("chunkIds must be an array");
  const seeds = [...new Set(chunkIds.slice(0, MAX_SEED_IDS).map((id) => text(id, "chunkId", 200)))];
  const search = typeof query === "string" ? query.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
  const rows = await sql()`
    with ready_chunks as (
      select c.id, c.document_id, c.title, c.page, c."text"
        from knowledge_chunks c
        join knowledge_jobs j on j.id = c.document_id
        join organizations o on o.id = j.organization_id
       where j.organization_id = ${organizationId} and j.status = 'ready'
         and o.status in ('active', 'trial')
     ), vector_seeds as (
       select c.id, s.rank
         from unnest(${seeds}::text[]) with ordinality as s(id, rank)
         join ready_chunks c on c.id = s.id
     ), lexical_seeds as (
       select id, 100 + row_number() over (order by id) as rank from ready_chunks
        where ${search} <> ''
          and to_tsvector('simple', coalesce(title, '') || ' ' || coalesce("text", ''))
              @@ plainto_tsquery('simple', ${search})
          and id not in (select id from vector_seeds)
        order by id
        limit 12
     ), seed_ids as (
       select * from vector_seeds union all select * from lexical_seeds
        order by rank limit ${MAX_SEED_IDS}
    ), first_edges as (
      select a.id, a.document_id, a.source, a.type, a.target, a.quote, a.chunk_id
        from knowledge_assertions a
        join ready_chunks c on c.id = a.chunk_id
       where a.document_id = c.document_id
         and a.chunk_id in (select id from seed_ids)
       order by a.id
       limit 60
    ), nodes as (
      select source as node from first_edges union select target from first_edges
    ), second_edges as (
      select a.id, a.document_id, a.source, a.type, a.target, a.quote, a.chunk_id
        from knowledge_assertions a
        join ready_chunks c on c.id = a.chunk_id
       where a.document_id = c.document_id
         and (a.source in (select node from nodes) or a.target in (select node from nodes))
         and a.id not in (select id from first_edges)
       order by a.id
       limit 60
    ), selected_edges as (
      select * from first_edges union all select * from second_edges
    ), selected_chunks as (
      select id from seed_ids
      union
      select chunk_id from selected_edges
    ), bounded_chunks as (
       select c.*, coalesce(seed.rank, 1000) as rank
         from ready_chunks c join selected_chunks s on s.id = c.id
         left join seed_ids seed on seed.id = c.id
       order by rank, c.page, c.id limit 24
    ), bounded_edges as (
      select e.* from selected_edges e
      join bounded_chunks c on c.id = e.chunk_id
      order by e.id limit 60
    )
    select jsonb_build_object(
      'chunks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'documentId', document_id::text, 'title', title, 'page', page, 'text', "text"
         ) order by rank, page, id) from bounded_chunks), '[]'::jsonb),
      'assertions', coalesce((select jsonb_agg(jsonb_build_object(
        'source', source, 'type', type, 'target', target, 'quote', quote, 'chunkId', chunk_id
        ) order by id) from bounded_edges), '[]'::jsonb)
    ) as result
  `;
  return rows[0] && rows[0].result ? rows[0].result : { chunks: [], assertions: [] };
}

module.exports = {
  enqueue,
  job,
  claim,
  renew,
  complete,
  fail,
  evidence,
  semanticSearch,
  unembeddedChunks,
  setEmbedding,
  schemaStatus,
};
