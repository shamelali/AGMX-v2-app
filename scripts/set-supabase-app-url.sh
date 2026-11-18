#!/usr/bin/env bash
# Repoint the Supabase-side host used by auth + payment callbacks, and verify it.
# Run this AFTER the agmx.my cutover deploy. Read-only by default; --apply changes things.
#
#   bash scripts/set-supabase-app-url.sh                     # show current + diff, change nothing
#   bash scripts/set-supabase-app-url.sh --apply             # write auth site_url + allow list
#   bash scripts/set-supabase-app-url.sh --apply --secrets   # also upsert APP_URL / BILLPLZ_CALLBACK_URL
#
# Needs an access token with the right scopes:
#   https://supabase.com/dashboard/account/tokens   export SUPABASE_ACCESS_TOKEN=sbp_...
# Optional overrides: SUPABASE_PROJECT_REF, NEW_HOST, OLD_HOST
set -uo pipefail

NEW="${NEW_HOST:-www.agmx.my}"
OLD="${OLD_HOST:-agmx-v2.vercel.app}"
REF="${SUPABASE_PROJECT_REF:-}"
APPLY=0; SECRETS=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --secrets) SECRETS=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null || { echo "curl required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  cat <<'MSG'
  [STOP] SUPABASE_ACCESS_TOKEN is not set.

  1. https://supabase.com/dashboard/account/tokens  -> Generate new token
  2. export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx
  3. re-run this script

  Nothing has been changed. Use a personal access token, not a service-role key.
MSG
  exit 1
fi

api(){ # method path [json-body]
  local m="$1" p="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$m" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "$body" -w '\n%{http_code}' "https://api.supabase.com/v1/$p"
  else
    curl -sS -X "$m" -H "Authorization: Bearer $TOKEN" -w '\n%{http_code}' "https://api.supabase.com/v1/$p"
  fi
}

# ── resolve the project if not supplied ──────────────────────────────────────
# Prefer the ref the deployed app actually talks to; fall back to the project list.
if [ -z "$REF" ]; then
  echo "── resolving project ──"
  REF=$(curl -sS --max-time 20 "https://$NEW/api/config" 2>/dev/null | python3 -c '
import sys, re
t = sys.stdin.read()
m = re.search(r"https://([a-z0-9]{16,24})\.supabase\.co", t)
sys.stdout.write(m.group(1) if m else "")' 2>/dev/null)
  if [ -n "$REF" ]; then
    echo "  ref from the live app's /api/config: $REF"
  else
    echo "  could not read the live config; asking the API for the project list"
    RESP=$(api GET projects)
    CODE=$(printf '%s' "$RESP" | tail -1)
    if [ "$CODE" != "200" ]; then
      echo "  [STOP] GET /v1/projects -> HTTP $CODE"
      printf '%s\n' "$RESP" | head -c 300 | sed 's/^/    /'
      echo; echo "  A 401 means the token is bad or lacks scope; nothing was changed."
      exit 1
    fi
    printf '%s' "$RESP" | sed '$d' | python3 -c '
import sys, json
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else d.get("projects", [])
sys.stderr.write("  %d project(s):\n" % len(rows))
for p in rows:
    sys.stderr.write("    %s  %s\n" % (p.get("id"), p.get("name", "")))
hit = [p.get("id") for p in rows if "agmx" in (str(p.get("name","")) + str(p.get("id",""))).lower()]
if hit:
    sys.stdout.write(hit[0])
elif len(rows) == 1:
    sys.stdout.write(rows[0].get("id") or "")
' > /tmp/._sbref 2>/tmp/._sblist
    cat /tmp/._sblist
    REF=$(cat /tmp/._sbref)
    rm -f /tmp/._sbref /tmp/._sblist
    if [ -z "$REF" ]; then
      echo "  [STOP] ambiguous project list — re-run with SUPABASE_PROJECT_REF=<ref>"; exit 1
    fi
    echo "  using: $REF"
  fi
fi

NEWURL="https://$NEW"
PASS=0; FAIL=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

# ── 1. auth config ───────────────────────────────────────────────────────────
echo "── 1. auth URL configuration ──"
RESP=$(api GET "projects/$REF/config/auth"); CODE=$(printf '%s' "$RESP" | tail -1); BODY=$(printf '%s' "$RESP" | sed '$d')
if [ "$CODE" != "200" ]; then
  bad "GET config/auth -> HTTP $CODE (token scope?) — cannot read or check site_url"
  printf '%s\n' "$BODY" | head -c 300 | sed 's/^/    /'; echo
else
  CUR=$(printf '%s' "$BODY" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("site_url") or "")')
  ALLOW=$(printf '%s' "$BODY" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("uri_allow_list") or "")')
  echo "    site_url       = ${CUR:-<empty>}"
  echo "    uri_allow_list = ${ALLOW:-<empty>}"
  if [ "$CUR" = "$NEWURL" ] || [ "$CUR" = "$NEWURL/" ]; then ok "site_url already $NEWURL"
  else
    if [ "$APPLY" = "1" ]; then
      NEWALLOW=$(python3 - "$ALLOW" "$NEWURL" "$OLD" <<'PY'
import sys
allow,new,old=sys.argv[1],sys.argv[2],sys.argv[3]
items=[x.strip() for x in allow.split(',') if x.strip()]
out=[]
for i in items:
    newi = i.replace(old, new.replace('https://','')) if old in i else i
    if newi not in out: out.append(newi)
for a in (new,new+'/**',new+'/api/billplz/callback'):
    if a not in out: out.append(a)
print(','.join(out))
PY
)
      update=$(python3 - "$NEWURL" "$NEWALLOW" <<'PY'
import json,sys
print(json.dumps({"site_url":sys.argv[1],"uri_allow_list":sys.argv[2]}))
PY
)
      R=$(api PATCH "projects/$REF/config/auth" "$update"); C=$(printf '%s' "$R" | tail -1)
      [ "$C" = "200" ] && ok "site_url set to $NEWURL and allow list updated" || { bad "PATCH config/auth -> HTTP $C"; printf '%s\n' "$R" | head -c 300 | sed 's/^/    /'; echo; }
    else
      bad "site_url is ${CUR:-<empty>}, expected $NEWURL (dry run — re-run with --apply)"
    fi
  fi
fi

# ── 2. edge-function secrets ──────────────────────────────────────────────────
if [ "$SECRETS" = "1" ]; then
  echo "── 2. edge-function secrets ──"
  RESP=$(api GET "projects/$REF/secrets"); CODE=$(printf '%s' "$RESP" | tail -1); BODY=$(printf '%s' "$RESP" | sed '$d')
  if [ "$CODE" != "200" ]; then
    bad "GET secrets -> HTTP $CODE"; printf '%s\n' "$BODY" | head -c 300 | sed 's/^/    /'; echo
  else
    HAVE=$(printf '%s' "$BODY" | python3 -c '
import sys,json
d=json.load(sys.stdin); rows=d if isinstance(d,list) else d.get("secrets",[])
print(",".join(sorted(s.get("name","") for s in rows)))')
    echo "    existing secret names: ${HAVE:-<none>}"
    PAYLOAD=$(python3 - "$NEWURL" <<'PY'
import json,sys
u=sys.argv[1]
print(json.dumps([{"name":"APP_URL","value":u},
                  {"name":"BILLPLZ_CALLBACK_URL","value":u+"/api/billplz/callback"}]))
PY
)
    if [ "$APPLY" = "1" ]; then
      R=$(api POST "projects/$REF/secrets" "$PAYLOAD"); C=$(printf '%s' "$R" | tail -1)
      [ "$C" = "200" ] || [ "$C" = "201" ] && ok "APP_URL and BILLPLZ_CALLBACK_URL upserted" || { bad "POST secrets -> HTTP $C"; printf '%s\n' "$R" | head -c 300 | sed 's/^/    /'; echo; }
    else
      bad "would upsert APP_URL=$NEWURL and BILLPLZ_CALLBACK_URL (dry run)"
    fi
  fi
fi

# ── 3. independent HTTP verification ─────────────────────────────────────────
echo "── 3. verification against the live services ──"
# this project requires an apikey header even on /auth/v1/* — read the public key from the app
ANON=$(curl -sS --max-time 20 "https://$NEW/api/config" 2>/dev/null | python3 -c '
import sys, re
t = sys.stdin.read()
m = re.search(r"\"supabaseAnonKey\"\s*:\s*\"([^\"]+)\"", t)
sys.stdout.write(m.group(1) if m else "")' 2>/dev/null)
EH=$(curl -sS -o /dev/null -w '%{http_code}' -H "apikey: $ANON" "https://$REF.supabase.co/auth/v1/health" 2>/dev/null)
[ "$EH" = "200" ] && ok "supabase auth health 200" || bad "supabase auth health $EH (with apikey header)"
LIVE=$(curl -sS --http1.1 "https://$NEW/api/config" 2>/dev/null | python3 -c '
import sys,re
t=sys.stdin.read()
m=re.search(r"\"appUrl\"\s*:\s*\"([^\"]+)\"",t)
print(m.group(1) if m else "")' 2>/dev/null)
if [ "$LIVE" = "$NEWURL" ] || [ "$LIVE" = "$NEWURL/" ]; then ok "live /api/config appUrl = $LIVE"
else bad "live /api/config appUrl = ${LIVE:-<unreadable>} (expected $NEWURL — the cutover deploy may not have run yet)"; fi

echo
printf '  summary: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] && exit 0 || exit 1
