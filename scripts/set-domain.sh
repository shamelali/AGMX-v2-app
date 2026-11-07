#!/usr/bin/env bash
# ============================================================
# Flip the host the product publishes, across the runtime files
# that must agree on it.
#
#   scripts/set-domain.sh myagmx.com            # dry run
#   scripts/set-domain.sh myagmx.com --apply    # write
#   scripts/set-domain.sh myagmx.com --check    # poll until the host serves
#
# This touches every file whose host is load-bearing: the canonical link and
# share-preview tags, the sitemap and robots files, the config fallbacks, the
# Edge Function's APP_URL fallback, the two operator scripts that carry the host
# as a default, the service worker cache version, and the live documents §19
# reads. Lines that record a past deploy are printed afterwards to be reworded
# by hand rather than silently rewritten.
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
WATCH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --old)   OLD_HOST="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --force) FORCE=1; shift ;;
    --check) WATCH=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$NEW_HOST" ]; then
  echo "usage: scripts/set-domain.sh <new-host> [--old <old-host>] [--apply] [--force] [--check]" >&2
  exit 2
fi
NEW_HOST="${NEW_HOST#https://}"; NEW_HOST="${NEW_HOST%/}"

# --check: report when the host starts serving, so nobody re-runs blind.
# DNS and the certificate lag the registrar purchase by minutes to hours.
if [ "$WATCH" = "1" ]; then
  echo "watching $NEW_HOST — checking every 60s, Ctrl-C to stop"
  i=0
  while true; do
    i=$((i + 1))
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$NEW_HOST/" 2>/dev/null) || code="000"
    ts=$(date '+%H:%M:%S')
    if [ "$code" = "200" ]; then
      echo "[$ts] $NEW_HOST is live (HTTP 200) — run: scripts/set-domain.sh $NEW_HOST --apply"
      exit 0
    fi
    printf '[%s] check %d: HTTP %s (not yet)\n' "$ts" "$i" "$code"
    sleep 60
  done
fi

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
#
# scripts/ is here because those two scripts carry the host as a default value,
# not as prose: set-supabase-secrets.sh writes APP_URL into Supabase, so leaving
# the old host there would re-point payment redirects at the retired deployment
# the next time an operator runs it — the failure §19 exists to catch.
FILES=(
  index.html
  app.html
  sitemap.xml
  robots.txt
  api/config.js
  config.example.js
  .env.example
  supabase/functions/money-flow/index.ts
  scripts/set-supabase-secrets.sh
  scripts/smoke-test.sh
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

# Precached files are served cache-first, and an installed worker only re-runs
# install when sw.js changes byte-for-byte. So editing index.html/app.html
# without bumping CACHE ships nothing to anyone who already has the site: the
# deploy goes out and every installed client keeps the old copy. §7 fails on
# exactly this, so bump the version here rather than leaving it to be discovered
# after the flip. The suffix is the host label, which is what changed.
if grep -qE '^[[:space:]]*"/(index|app)\.html"' sw.js 2>/dev/null; then
  bump_tag=$(printf '%s' "$NEW_HOST" | tr -c 'a-zA-Z0-9' '-' | sed 's/-\+$//')
  cur_cache=$(grep -oE 'const CACHE = "[^"]+"' sw.js | sed -E 's/.*"([^"]+)"/\1/')
  case "$cur_cache" in
    *-"$bump_tag") new_cache="$cur_cache" ;;   # already bumped for this host
    *)             new_cache="${cur_cache%%-*}-$bump_tag" ;;
  esac
  if [ "$new_cache" != "$cur_cache" ]; then
    if [ "$APPLY" = "1" ]; then
      sed -i "s|const CACHE = \"$cur_cache\"|const CACHE = \"$new_cache\"|" sw.js
      echo "  [wrote] sw.js (CACHE $cur_cache -> $new_cache)"
    else
      echo "  [would] sw.js (CACHE $cur_cache -> $new_cache)"
    fi
  fi
fi

# Docs are load-bearing too: §19 requires every live file to name only the
# canonical host, so leaving the old host in a live doc fails the suite. They
# are rewritten here for that reason. A few lines record a past deploy ("deployed
# at X", "Verified <date>"); rewriting those would make the record false, so
# they are printed afterwards to be reworded by hand rather than left as a
# silent edit. archive/ and superseded docs are history and stay untouched.
DOCS=$(git grep -lF "$OLD_HOST" -- '*.md' ':!archive' 2>/dev/null || true)
DATED=""
if [ -n "$DOCS" ]; then
  echo ""
  echo "Docs:"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    n=$(grep -cF "$OLD_HOST" "$f" || true)
    # A line that records a past deploy, not the current host. Capture it
    # before the rewrite — afterwards the old host is gone and nothing matches.
    hits=$(grep -nF "$OLD_HOST" "$f" | grep -iE 'deployed|verified|[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
    if [ "$APPLY" = "1" ]; then
      # Replace the bare host, not `https://` + host: prose writes it in
      # backticks with no scheme, and those are live claims too — README said
      # "a merge to main deploys to agmx-v2.vercel.app", which goes false on
      # cutover. §19's sweep matches only the scheme-qualified form, so a bare
      # mention would leave the suite green over a stale document.
      sed -i "s|$OLD_HOST|$NEW_HOST|g" "$f"
      echo "  [wrote] $f ($n reference(s))"
    else
      echo "  [would] $f ($n reference(s))"
    fi
    [ -n "$hits" ] && DATED="$DATED
  $f:
$(printf '%s\n' "$hits" | sed 's/^/    /')"
  done <<< "$DOCS"
fi

if [ -n "$DATED" ]; then
  cat <<EOF

Reword these by hand — they record a deploy that happened at the old host, so
the hostname change should be noted rather than silently applied:$DATED
EOF
fi

cat <<'EOF'

After the flip, set the host where the deployment reads it at runtime:
  Vercel     NEXT_PUBLIC_APP_URL=https://<new-host>
  Supabase   APP_URL, BILLPLZ_CALLBACK_URL=https://<new-host>/api/billplz/callback
  Supabase   Auth -> URL Configuration: site URL + redirect URLs
  Google     OAuth client: authorised JavaScript origins + redirect URIs
Then: npm test (check.sh passes 5, 19 and 23 read the host from sitemap.xml)
EOF
