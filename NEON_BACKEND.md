# AGMX backend direction: Neon + Vercel Functions

## Recommendation

Use **Neon Postgres** as the production transactional database and keep the
browser talking only to same-origin Vercel functions. Neon is a good fit here
because AGMX has relational, tenant-scoped records and serverless deployment
patterns; the Neon serverless driver uses HTTP requests and does not keep a
database socket open between Vercel invocations.

The current PocketBase client remains a compatibility bridge for authentication,
realtime, and existing governance methods while the migration is completed.
The new health endpoint already reports Neon readiness, and `neon/schema.sql`
contains the first transactional slice: organizations, users, assessments,
quotes, invoices, and payments. It also contains the versioned domain-pack
contract and its organization index.

## Environment variables

Set these in Vercel, never in `config.js` or browser JavaScript:

```text
DATABASE_URL=postgresql://...@...neon.tech/...?...sslmode=require
```

`NEON_DATABASE_URL` is accepted as an alias for local tooling. The server uses
the Neon HTTP driver, so do not put a long-lived `pg.Pool` in a serverless
function or use named prepared statements with transaction pooling.

## Health endpoint

```text
GET /api/health
```

It returns database readiness, Billplz configuration readiness, GraphRAG
configuration readiness, deployment region, and commit metadata without
returning credentials. `checks.knowledge.missing` and
`checks.knowledge.invalid` contain environment-variable names only. A healthy
database returns HTTP 200; missing or unreachable Neon returns HTTP 503 with a
safe `degraded` payload. The GraphRAG check is reported independently so the
transactional application can start while Copilot configuration is completed.

## Migration sequence

1. Create a Neon project and apply `neon/schema.sql`, then
   `neon/graphrag.sql`, then `neon/graphrag-pgvector.sql` in that order. The
   domain-pack contract is included in `neon/schema.sql`; no separate domain-
   pack migration is required.
2. Add `DATABASE_URL` to Vercel Production and Preview environments.
3. Move public assessment/quote writes behind same-origin Vercel functions.
4. Move invoice/payment records and Billplz callbacks to Neon transactions.
5. Migrate tenant-authenticated governance reads/writes from PocketBase.
6. Retire PocketBase only after auth and realtime have equivalent coverage.

Every business table must carry `organization_id`; every server handler must
derive or verify the tenant from authenticated context. Public assessment rows
may have a null organization until they are converted into a tenant.

## Billplz

Billplz remains server-only. Configure:

```text
BILLPLZ_API_KEY
BILLPLZ_COLLECTION_ID
BILLPLZ_X_SIGNATURE_KEY
BILLPLZ_CALLBACK_URL=https://agmx-project.vercel.app/api/billplz/callback
BILLPLZ_API_BASE_URL=https://www.billplz.com/api
```

Use `https://www.billplz-sandbox.com/api` for sandbox testing. The existing
handlers validate amounts, tenant ownership, duplicate payment attempts, HTTPS
gateway URLs, callback signatures, and idempotent settlement transitions.

## GraphRAG deployment readiness

The Copilot depends on both the Vercel API and a separate worker. Configure the
following server-side variables in Vercel and in the worker environment:

```text
NVIDIA_API_KEY
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_CONCIERGE_MODEL=meta/llama-3.2-11b-vision-instruct
NVIDIA_EMBEDDING_MODEL=baai/bge-m3
```

Neon stores the embeddings with the `vector` extension. Apply
`neon/graphrag-pgvector.sql` after the base and GraphRAG migrations. The selected
NVIDIA embedding model returns 1024-dimensional vectors, and the migration
keeps the column nullable until existing ready chunks are backfilled.
Test the migration on a Neon branch first using a direct (unpooled) connection.
Import existing PocketBase organization IDs into `organizations` before
ingesting; the auth bridge and Neon must agree on tenant IDs. The backfill
handles only chunks already in Neon, not documents existing only in Pinecone.

The deployment check is safe to run without credentials:

```bash
curl -sS https://agmx-project.vercel.app/api/health
```

Confirm `checks.database.ok` is `true` and `checks.knowledge.ready` is `true`.
The knowledge check verifies provider configuration and the GraphRAG/pgvector
schema, including the assertion-to-chunk constraint; it does not verify model
reachability or the presence of imported tenant organizations.
The response never includes secret values. Run only one backfill process, then
start the worker separately after the migrations and variables are ready:

```bash
npm ci
npm run knowledge:backfill
npm run knowledge:worker
```

`npm run knowledge:worker` processes **one job and exits**. Schedule it at a
repeating interval, or run a supervised container loop with a delay between
idle invocations. Keep one invocation at a time until monitoring confirms that
lease renewal and provider rate limits are adequate for concurrent work.

## Handoff — 2026-10-14: pgvector cutover in progress

- **Goal:** replace Pinecone with Neon pgvector for tenant-scoped GraphRAG
  retrieval. The local code uses NVIDIA `baai/bge-m3` (1024 dimensions) for
  embeddings, keeps NVIDIA for extraction/generation, and publishes chunks,
  embeddings, and assertions atomically. Backfill only covers existing Neon
  chunks; documents that exist only in Pinecone must be re-ingested separately.
- **Files:** `neon/graphrag-pgvector.sql` is the forward migration;
  `neon/graphrag.sql` adds assertion/chunk integrity. `api/_lib/knowledge-*.js`,
  `api/_lib/neon.js`, `api/health.js`, and `tools/knowledge-worker.js` carry the
  provider, search, preflight, and heartbeat changes.
  `tools/knowledge-embedding-backfill.js`, `package.json`, `.env.example`,
  `README.md`, and the knowledge tests document/verify the local workflow.
- **Checks (workspace root):** `npm test` passed 82 checks, with one warning
  because its live network probe was skipped. `node tools/test_knowledge_store.js`
  also passed after adding the expired-lease check. `node --check` for changed
  runtime files, `bash -n tools/check.sh`, and `git diff --check` passed. No
  separate lint, typecheck, or build script exists;
  none was run. The database tests use PGlite with a test-only `vector` text
  domain: they do not validate the real pgvector migration or cosine query.
- **Blocked:** the container's Neon CLI profile is unauthenticated and no
  `DATABASE_URL`/`NEON_DATABASE_URL` is configured. No Neon branch or database
  URL was fetched, no migration or backfill ran on Neon, and nothing was
  deployed. A local Postgres install attempt failed on container `dpkg`/`chown`
  restrictions. No live NVIDIA request was made; rotate the key previously
  disclosed in chat before adding a replacement to server-only configuration.
- **Next step:** supply a connection string for an isolated Neon branch via an
  ignored local env file (do not paste it into chat). Prefer a schema-only or
  anonymized branch if source data is sensitive. Apply the three SQL files in
  order using its **direct/unpooled** URL, import/verify matching PocketBase
  organization IDs, test actual `vector(1024)` cosine ranking and cross-tenant
  isolation, then run one backfill process and sample live Copilot responses.
  Measure exact-query latency/recall on that branch before considering an ANN
  index; no performance improvement is claimed without that baseline.
