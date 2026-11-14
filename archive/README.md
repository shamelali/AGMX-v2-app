# Archive — superseded backend layers

**Decision (2026-10-30): Supabase is the canonical backend.**
The production deployment (`agmx-v2-app.vercel.app`) runs Supabase auth with
the SPA (`supabase-client.js`), and `supabase/schema_final.sql` plus
`supabase/functions/*` cover the transactional and knowledge paths. The
layers below are reference-only: not deployed, not wired into the app, and
kept out of the Vercel/Cloudflare uploads.

## pocketbase-v1/

The AGMX v1 backend: PocketBase 0.40 JSVM money-flow hooks, collection
schemas and seeds, a dependency-free browser SDK, and the Fly.io/Docker
deployment. `pb_migrations/` is local-only (gitignored). The money-flow
hooks encode the tested quote → invoice → payment logic and are the
reference for the Supabase port.

Run its suites from `archive/pocketbase-v1/` (live suites need PocketBase):

```bash
node tools/test_money_flow_pb.mjs --url http://127.0.0.1:8090 --email … --password …
node tools/test_money_flow_adapter.mjs
python3 tools/test_pb_schema.py
```

`tools/check.sh` still validates this layer (passes 6, 10, 11, 12, 13) so
the reference cannot silently rot.

## neon/

The v1 GraphRAG backend on Neon pgvector: `/api/knowledge/*` endpoints, the
knowledge worker/backfill, NVIDIA embedding providers, and the SQL
migrations. Superseded by `supabase/knowledge_final.sql` and the Supabase
Edge Functions (`supabase/functions/knowledge-*`). The Node dependencies
(`@neondatabase/serverless`, `pdfjs-dist`) stay in `package.json` so these
references remain runnable.

## The v1 Neon agent skills are not kept here

`shamelali/AGMX` (v1) tracked `.agents/skills/neon/` and
`.agents/skills/neon-postgres/` — 12 files of vendored Neon documentation.
They are deliberately not copied into this repository:

- They are third-party content installed by the Neon CLI (`neon skills`), not
  authored here. Their own text says to refresh them with `neon skills update`,
  so a copy would go stale silently.
- `.gitignore` here ignores `.agents/` ("local only"), so committing them would
  take a `git add -f`.
- Nothing in this tree uses Neon: `archive/docs/NEON_BACKEND.md` marks it superseded and no
  non-archived file imports `@neondatabase/*`.

They are not lost — v1 is archived on GitHub with them intact. Reinstall with
`neon skills`, or copy from `.agents/skills/` in `shamelali/AGMX` if a Neon
task ever needs them.

## Reviving a layer

`git mv` the directories out of `archive/`, restore the matching entries in
`tools/check.sh`, and re-add the paths to `.vercelignore` / `.wrignore` as
needed.
