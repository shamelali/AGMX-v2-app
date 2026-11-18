#!/usr/bin/env bash
# Get a Supabase personal access token (sbp_...) and verify it works.
#
# There is no API that mints one of these: it is issued by the dashboard and is the
# root credential for the account. Neither the MCP server nor the CLI can produce it —
# both REQUIRE it. So "get the token from the CLI" is circular by construction.
set -euo pipefail

ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

case "${1:-}" in
  verify)
    say "verifying SUPABASE_ACCESS_TOKEN"
    [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { bad "not set"; exit 1; }
    ok "present (${#SUPABASE_ACCESS_TOKEN} chars, starts '${SUPABASE_ACCESS_TOKEN:0:4}')"
    code=$(curl -s -o /tmp/_sbresp.json -w '%{http_code}' \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      https://api.supabase.com/v1/projects)
    if [ "$code" = "200" ]; then
      ok "token accepted by api.supabase.com (HTTP 200)"
      python3 - <<'PY'
import json
d=json.load(open('/tmp/_sbresp.json'))
for p in d:
    if p.get('id')=='jchfalaibabmszewemat':
        print(f"  target project found: {p['name']} ({p['id']}), region {p.get('region')}, status {p.get('status')}")
PY
    elif [ "$code" = "401" ]; then
      bad "401 — token is invalid, revoked, or expired"
      exit 1
    else
      bad "HTTP $code"; head -c 300 /tmp/_sbresp.json; echo; exit 1
    fi
    rm -f /tmp/_sbresp.json
    ;;

  login)
    say "storing the token via the CLI"
    [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { bad "export SUPABASE_ACCESS_TOKEN first"; exit 1; }
    supabase login --token "$SUPABASE_ACCESS_TOKEN" --name agmx 2>&1
    ok "stored at ~/.supabase/access-token (this sandbox does not persist it)"
    ;;

  *)
    say "How to get an sbp_ token"
    cat <<'EOF'
  1. Open  https://supabase.com/dashboard/account/tokens
     (Dashboard → your avatar → Account → Access Tokens → Generate new token)
  2. Name it e.g. "agmx-cli", generate, and copy the sbp_... value once.
  3. Export it in the shell you'll use:
        export SUPABASE_ACCESS_TOKEN='sbp_...'
  4. Verify:   bash scripts/supabase-token.sh verify
  5. Store it:  bash scripts/supabase-token.sh login
  6. Then:      bash scripts/supabase-link-and-push.sh

  Scopes needed for the pending work:
    projects_read, project_admin_read   (link)
    + database/migrations write         (db push of 0011)
    + edge function deploy              (knowledge-query, knowledge-ingest)
EOF
    ;;
esac
