#!/usr/bin/env bash
# Link the repo to Supabase project jchfalaibabmszewemat and push migration 0011.
# Run this from the ROOT of your AGMX-v2-app clone (the dir containing supabase/).
# Never prints file contents. Aborts on the first problem.
set -euo pipefail

REF="jchfalaibabmszewemat"
MIG="supabase/migrations/0011_knowledge_embedding_2048.sql"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }

say "0. preflight"
[ -d supabase ] || { bad "no supabase/ here. cd to your AGMX-v2-app repo root."; exit 1; }
ok "repo root: $(pwd)"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  bad "SUPABASE_ACCESS_TOKEN is not set."
  echo "     export SUPABASE_ACCESS_TOKEN='sbp_...'   # account token, not the service_role key"
  echo "     Get one: https://supabase.com/dashboard/account/tokens"
  exit 1
fi
ok "access token present (${#SUPABASE_ACCESS_TOKEN} chars)"

[ -f "$MIG" ] || { bad "missing $MIG — apply agmx-knowledge-and-health.patch first"; exit 1; }
ok "migration present: $(basename "$MIG") ($(wc -l < "$MIG") lines)"

grep -q 'vector(2048)' "$MIG" && ok "migration declares vector(2048)" || { bad "migration does not mention vector(2048)"; exit 1; }

# db push needs the DB password; it will not read it from a flag-free prompt in CI
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  warn "SUPABASE_DB_PASSWORD not set — link/db push will prompt for it"
  echo "     (dashboard -> Project Settings -> Database -> Database password)"
fi

say "1. link"
supabase link --project-ref "$REF" --yes
ok "linked to $REF"
[ -f supabase/.temp/project-ref ] && ok "supabase/.temp/project-ref written"

say "2. what would be applied (no writes)"
supabase db push --remote --dry-run

say "3. push"
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  supabase db push --remote --yes -p "$SUPABASE_DB_PASSWORD"
else
  supabase db push --remote --yes
fi
ok "migrations applied"

say "4. verify (run in the SQL editor or via MCP execute_sql)"
cat <<'SQL'
  -- a) the column is 2048-wide
  select f.table_name, f.column_name, a.atttypmod as typmod
  from information_schema.columns f
  join pg_attribute a on a.attname = f.column_name
  where f.column_name = 'embedding';

  -- b) the function signature moved off 1024
  select p.proname, pg_get_function_arguments(p.oid)
  from pg_proc p where p.proname = 'knowledge_search';

  -- c) every embedding was nulled — expect 0 non-null until you re-ingest
  select count(*) as chunks, count(embedding) as embedded from knowledge_chunks;
SQL

say "next"
echo "  - redeploy the two functions so the new models take effect:"
echo "      supabase functions deploy knowledge-query"
echo "      supabase functions deploy knowledge-ingest"
echo "  - then re-ingest every document; until then knowledge_search returns 0 rows."
