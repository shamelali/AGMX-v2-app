#!/usr/bin/env bash
# Enable the Google provider in Supabase using a Google OAuth client ID + secret.
# You create the client in Google Cloud Console (dashboard only); everything after that
# can be done by this script. Read-only unless --apply.
#
#   export SUPABASE_ACCESS_TOKEN=sbp_...          # https://supabase.com/dashboard/account/tokens
#   export GOOGLE_CLIENT_ID=....apps.googleusercontent.com
#   export GOOGLE_CLIENT_SECRET=GOCSPX-...
#   bash scripts/enable-google-provider.sh              # dry run: shows what would change
#   bash scripts/enable-google-provider.sh --apply      # enable and verify
#
# Optional: SUPABASE_PROJECT_REF, NEW_HOST
set -uo pipefail

NEW="${NEW_HOST:-www.agmx.my}"
APPLY=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
CID="${GOOGLE_CLIENT_ID:-}"
CSEC="${GOOGLE_CLIENT_SECRET:-}"

missing=0
[ -z "$TOKEN" ] && { echo "  [STOP] SUPABASE_ACCESS_TOKEN not set" >&2; missing=1; }
[ -z "$CID" ]   && { echo "  [STOP] GOOGLE_CLIENT_ID not set" >&2; missing=1; }
[ -z "$CSEC" ]  && { echo "  [STOP] GOOGLE_CLIENT_SECRET not set" >&2; missing=1; }
if [ "$missing" = "1" ]; then
  cat >&2 <<'MSG'

  Nothing has been changed. Where each value comes from:

    SUPABASE_ACCESS_TOKEN  https://supabase.com/dashboard/account/tokens
    GOOGLE_CLIENT_ID       Google Cloud Console -> APIs & Services -> Credentials
    GOOGLE_CLIENT_SECRET   same screen, shown once when the OAuth client is created

  Create the OAuth client as: Web application, authorised JavaScript origin
  https://<new-host>, authorised redirect URI
  https://<ref>.supabase.co/auth/v1/callback
MSG
  exit 1
fi

REF="${SUPABASE_PROJECT_REF:-}"
if [ -z "$REF" ]; then
  REF=$(curl -sS --max-time 20 "https://$NEW/api/config" 2>/dev/null | python3 -c '
import sys, re
t = sys.stdin.read()
m = re.search(r"https://([a-z0-9]{16,24})\.supabase\.co", t)
sys.stdout.write(m.group(1) if m else "")' 2>/dev/null)
fi
[ -z "$REF" ] && { echo "  [STOP] cannot determine project ref; set SUPABASE_PROJECT_REF" >&2; exit 1; }

PASS=0; FAIL=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
api(){ curl -sS -X "$1" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        ${3:+-d "$3"} -w '\n%{http_code}' "https://api.supabase.com/v1/$2"; }

# mask anything long enough to be a credential before it reaches stdout
mask(){ python3 -c '
import sys
v = sys.stdin.read().strip()
print(v[:6] + "…" + v[-4:] + " (%d chars)" % len(v)) if len(v) > 12 else print("<empty>")'; }

echo "── project $REF ($NEW) ──"
RESP=$(api GET "projects/$REF/config/auth"); CODE=$(printf '%s' "$RESP" | tail -1); BODY=$(printf '%s' "$RESP" | sed '$d')
[ "$CODE" != "200" ] && { bad "GET config/auth -> HTTP $CODE"; printf '%s\n' "$BODY" | head -c 200 | sed 's/^/    /'; echo; exit 1; }

CUR_EN=$(printf '%s' "$BODY" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(str(d.get("external_google_enabled")).lower())')
CUR_ID=$(printf '%s' "$BODY" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("external_google_client_id") or "")')
echo "    external_google_enabled  = $CUR_EN"
printf '    external_google_client_id = '; printf '%s' "$CUR_ID" | mask
printf '    new client id             = '; printf '%s' "$CID" | mask

if [ "$CUR_EN" = "true" ] && [ "$CUR_ID" = "$CID" ]; then
  ok "Google provider already enabled with this client id — nothing to do"
else
  if [ "$APPLY" = "1" ]; then
    PAYLOAD=$(python3 - "$CID" "$CSEC" <<'PY'
import json, sys
print(json.dumps({"external_google_enabled": True,
                  "external_google_client_id": sys.argv[1],
                  "external_google_secret": sys.argv[2]}))
PY
)
    R=$(api PATCH "projects/$REF/config/auth" "$PAYLOAD"); C=$(printf '%s' "$R" | tail -1)
    if [ "$C" = "200" ]; then ok "PATCH config/auth -> Google enabled"
    else bad "PATCH config/auth -> HTTP $C"; printf '%s\n' "$R" | sed '$d' | head -c 300 | sed 's/^/    /'; echo; fi
  else
    bad "would enable Google with this client id (dry run — re-run with --apply)"
  fi
fi

# ── verification: does the provider actually work now? ───────────────────────
echo "── verification ──"
ANON=$(curl -sS --max-time 20 "https://$NEW/api/config" 2>/dev/null | python3 -c '
import sys,re
t=sys.stdin.read(); m=re.search(r"\"supabaseAnonKey\"\s*:\s*\"([^\"]+)\"", t)
sys.stdout.write(m.group(1) if m else "")' 2>/dev/null)

G=$(curl -sS -H "apikey: $ANON" "https://$REF.supabase.co/auth/v1/settings" 2>/dev/null | python3 -c '
import sys,json
d=json.load(sys.stdin); print((d.get("external") or {}).get("google"))' 2>/dev/null)
[ "$G" = "True" ] && ok "/auth/v1/settings external.google = True" || bad "/auth/v1/settings external.google = ${G:-unreadable}"

LOC=$(curl -sS -o /dev/null -D - -H "apikey: $ANON" \
      "https://$REF.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://$NEW" 2>/dev/null \
      | grep -i '^location:' | tr -d '\r' | sed 's/^[Ll]ocation: *//')
case "$LOC" in
  *accounts.google.com*) ok "authorize redirects to Google consent screen" ;;
  "")                    bad "authorize returned no Location header" ;;
  *)                     bad "authorize -> $LOC (expected accounts.google.com)" ;;
esac
echo "    if that passed, the redirect carries client_id — the browser then shows Google's screen"

echo
printf '  summary: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] && exit 0 || exit 1
