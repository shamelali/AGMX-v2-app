"use strict";

const { neon } = require("@neondatabase/serverless");

let sqlClient = null;

function databaseUrl() {
  return String(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "").trim();
}

function isConfigured() {
  return Boolean(databaseUrl());
}

function sql() {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) {
    // Neon’s HTTP driver avoids holding a database socket across Vercel
    // invocations and works well with pooled/serverless connections.
    sqlClient = neon(url, { fetchOptions: { cache: "no-store" } });
  }
  return sqlClient;
}

async function ping() {
  const startedAt = Date.now();
  if (!isConfigured()) {
    return {
      configured: false,
      ok: false,
      latencyMs: null,
      error: "DATABASE_URL is not configured",
    };
  }

  try {
    const rows = await sql()`select 1 as ok`;
    return {
      configured: true,
      ok: rows && rows[0] && Number(rows[0].ok) === 1,
      latencyMs: Date.now() - startedAt,
    };
  } catch (_) {
    // Never return connection strings or provider details to the browser.
    sqlClient = null;
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: "Neon database is unreachable",
    };
  }
}

async function knowledgeSchemaStatus(query) {
  if (!isConfigured()) {
    return {
      configured: false,
      ready: false,
      missing: ["DATABASE_URL"],
      invalid: [],
    };
  }
  try {
    const rows = await (query || sql())`
      select
        to_regclass('public.knowledge_jobs') is not null as jobs,
        to_regclass('public.knowledge_chunks') is not null as chunks,
        to_regclass('public.knowledge_assertions') is not null as assertions,
        exists (
          select 1 from pg_extension where extname = 'vector'
        ) as vector_extension,
        exists (
          select 1
            from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = 'knowledge_chunks'
             and a.attname = 'embedding'
             and a.attnum > 0
             and not a.attisdropped
             and format_type(a.atttypid, a.atttypmod) = 'vector(1024)'
        ) as embedding_column,
        exists (
          select 1 from pg_constraint
           where conname = 'knowledge_assertions_document_chunk_fkey'
             and conrelid = to_regclass('public.knowledge_assertions')
             and convalidated
        ) as assertion_tenant_constraint
    `;
    const row = rows[0] || {};
    const missing = [];
    if (!row.jobs || !row.chunks || !row.assertions) missing.push("GRAPHRAG_TABLES");
    if (!row.vector_extension) missing.push("VECTOR_EXTENSION");
    if (!row.embedding_column) missing.push("KNOWLEDGE_EMBEDDING_COLUMN");
    if (!row.assertion_tenant_constraint) missing.push("KNOWLEDGE_ASSERTION_CONSTRAINT");
    return { configured: true, ready: missing.length === 0, missing, invalid: [] };
  } catch (_) {
    sqlClient = null;
    return {
      configured: true,
      ready: false,
      missing: [],
      invalid: ["KNOWLEDGE_SCHEMA"],
    };
  }
}

module.exports = { databaseUrl, isConfigured, sql, ping, knowledgeSchemaStatus };
