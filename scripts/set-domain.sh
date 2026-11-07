#!/usr/bin/env bash
# ============================================================
# Flip the host the product publishes, across the runtime files
# that must agree on it.
#
#   scripts/set-domain.sh myagmx.com            # dry run
#   scripts/set-domain.sh myagmx.com --apply    # write
#
# This touches only files whose host is load-bearing at runtime: the canonical
# link and share-preview tags, the sitemap and robots files, the config
# fallbacks, and the Edge Function's APP_URL fallback. Prose is left alone on
# purpose — the same string appears in documents as a record of what happened
# on a date ("deployed at https://... on 2026-11-05"), and rewriting those
# would make the history false. Review the docs by hand; the script prints them.
#
# The reachability guard is the point of the script. A host that does not
# answer is not a host to publish: flipping first would put a dead name in
# every shared link and payment redirect, and check.sh would then fail rather
# than pass. --force exists for a deliberate staging flip only.
# ============================================================
set -euo pipefail

NEW_HOST="${1:-}"
shift || true
OLD_HOST=""
APPLY=0
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --old)   OLD_HOST="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$NEW_HOST" ]; then
  echo "usage: scripts/set-domain.sh <new-host> [--old <old-host>] [--apply] [--force]" >&2
  exit 2
fi
NEW_HOST="${NEW_HOST#https://}"; NEW_HOST="${NEW_HOST%/}"

# The old host is whatever sitemap.xml publishes today — the file that defines it.
if [ -z "$OLD_HOST" ]; then
  OLD_HOST=$(grep -oE '<loc>[^<]+</loc>' sitemap.xml 2>/dev/null | head -1 \
             | sed -E 's|.*<loc>https?://([^/]+).*|\1|')
fi
if [ -z "$OLD_HOST" ]; then
  echo "could not read the current host from sitemap.xml — pass --old <host>" >&2
  exit 2
fi
if [ "$OLD_HOST" = "$NEW_HOST" ]; then
  echo "already publishing $NEW_HOST — nothing to do"
  exit 0
fi

# Guard: the new host must be serving before it is published.
if [ "$FORCE" = "0" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$NEW_HOST/" 2>/dev/null) || code="000"
  if [ "$code" != "200" ]; then
    cat >&2 <<EOF
[STOP] https://$NEW_HOST/ answered HTTP $code, not 200.

Publishing a host that does not serve would put a dead name in the canonical
link, the sitemap and every payment redirect, and check.sh passes 5 and 23
would fail. Register the domain, add it in Vercel, and point DNS first:

  1. register the domain
  2. Vercel -> Settings -> Domains -> add $NEW_HOST (and www)
  3. create the DNS records Vercel shows (A at the apex, CNAME for www)
  4. re-run this script once https://$NEW_HOST/ answers 200

Use --force only for a deliberate staging flip.
EOF
    exit 1
  fi
  echo "[ok] https://$NEW_HOST/ answers 200"
fi

# Runtime files only. Ordered as the tree reads.
FILES=(
  index.html
  app.html
  sitemap.xml
  robots.txt
  api/config.js
  config.example.js
  .env.example
  supabase/functions/money-flow/index.ts
)

echo "host: $OLD_HOST -> $NEW_HOST"
echo ""

changed=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "  [skip] $f (absent)"; continue; }
  n=$(grep -cF "$OLD_HOST" "$f" || true)
  if [ "$n" = "0" ]; then
    echo "  [skip] $f (no reference)"
    continue
  fi
  if [ "$APPLY" = "1" ]; then
    sed -i "s|https://$OLD_HOST|https://$NEW_HOST|g" "$f"
    echo "  [wrote] $f ($n reference(s))"
  else
    echo "  [would] $f ($n reference(s))"
  fi
  changed=$((changed + n))
done

echo ""
if [ "$APPLY" = "1" ]; then
  echo "$changed reference(s) rewritten in runtime files."
else
  echo "$changed reference(s) would be rewritten. Re-run with --apply to write."
fi

# Docs are a hand pass: the same string appears there as dated history too.
DOCS=$(git grep -lF "$OLD_HOST" -- '*.md' 2>/dev/null || true)
if [ -n "$DOCS" ]; then
  echo ""
  echo "Review these by hand — update the live statements, keep the dated ones:"
  printf '%s\n' "$DOCS" | sed 's/^/  /'
fi

cat <<'EOF'

After the flip, set the host where the deployment reads it at runtime:
  Vercel     NEXT_PUBLIC_APP_URL=https://<new-host>
  Supabase   APP_URL, BILLPLZ_CALLBACK_URL=https://<new-host>/api/billplz/callback
  Supabase   Auth -> URL Configuration: site URL + redirect URLs
  Google     OAuth client: authorised JavaScript origins + redirect URIs
Then: npm test (check.sh passes 5, 19 and 23 read the host from sitemap.xml)
EOF
