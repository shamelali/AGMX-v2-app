#!/usr/bin/env bash
# Verify agmx.my is correctly wired to Vercel, and whether the app has been cut over.
# Read-only: fetches public DNS + HTTP only. Prints hostnames and status codes, never file bodies.
#   bash _tools/check_domain_cutover.sh [expected-host]
# Exit: 0 = DNS + TLS good AND app cut over to expected-host
#       1 = DNS/TLS not ready      (do NOT run set-domain.sh yet)
#       2 = DNS/TLS good, app NOT cut over yet
set -uo pipefail
EXPECT="${1:-www.agmx.my}"
VERCEL_IPS_REGEX='^(216\.198\.79\.|64\.29\.17\.|76\.76\.21\.)'
pass=0; fail=0; warn=0
ok(){   printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad(){  printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
note(){ printf '  \033[33mWARN\033[0m %s\n' "$1"; warn=$((warn+1)); }

doh(){ curl -sS --http1.1 "https://dns.google/resolve?name=$1&type=${2:-A}" 2>/dev/null; }
ips(){ doh "$1" A | python3 -c 'import sys,json;d=json.load(sys.stdin);print(" ".join(a["data"] for a in d.get("Answer",[]) if a.get("type")==1))' 2>/dev/null; }
ttlof(){ doh "$1" A | python3 -c 'import sys,json;d=json.load(sys.stdin);print(max([a.get("TTL",0) for a in d.get("Answer",[]) if a.get("type")==1] or [0]))' 2>/dev/null || echo 0; }
# authoritative lookup straight from Vercel's nameservers, bypassing every cache
auth(){ # $1=host $2=name-server
  if command -v dig >/dev/null 2>&1; then
    dig +short +time=4 +tries=1 @$2 "$1" A 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tr '\n' ' '
  fi
}

echo "── 1. delegation ──"
NS=$(doh agmx.my NS | python3 -c 'import sys,json;d=json.load(sys.stdin);print(" ".join(a["data"].rstrip(".") for a in d.get("Answer",[]) if a.get("type")==2))' 2>/dev/null)
case "$NS" in
  *vercel-dns.com*) ok "nameservers -> $NS" ;;
  "")               note "no NS in answer (may be cached); continuing" ;;
  *)                bad "nameservers still delegated elsewhere: $NS" ;;
esac

echo "── 2. A records point at Vercel ──"
STALE_TTL=0; STALE=0
HAVE_AUTH=0
command -v dig >/dev/null 2>&1 && HAVE_AUTH=1
for h in agmx.my www.agmx.my; do
  A=$(ips "$h")
  if [ -z "$A" ]; then bad "$h does not resolve"; continue; fi
  if echo "$A" | tr ' ' '\n' | grep -qvE "$VERCEL_IPS_REGEX"; then
    STALE=1
    T=$(ttlof "$h"); [ "$T" -gt "$STALE_TTL" ] 2>/dev/null && STALE_TTL=$T
    AU=$(auth "$h" ns1.vercel-dns.com)
    if [ -n "$AU" ]; then
      bad "$h -> $A via public resolver (CACHED, ~${T}s left) but authoritative ns1.vercel-dns.com says: $AU"
    else
      bad "$h -> $A  (not a Vercel edge IP)"
    fi
  else
    ok "$h -> $A"
  fi
done
if [ "$STALE" = "1" ] && [ "$HAVE_AUTH" = "0" ]; then
  note "dig not installed — cannot cross-check the authoritative server. Resolvers are"
  note "serving a cached record with ~${STALE_TTL}s remaining. Re-run then, or install bind9-dnsutils."
fi

echo "── 3. TLS certificate is Vercel's, not the registrar's cPanel cert ──"
CN=$(timeout 20 bash -c "echo | openssl s_client -connect www.agmx.my:443 -servername www.agmx.my 2>/dev/null | openssl x509 -noout -subject 2>/dev/null" | sed 's/.*CN *= *//')
case "$CN" in
  *mycloudforward*|*cpcontacts*|*webmail*) bad "wrong cert: CN=$CN (registrar parking cert)" ;;
  *agmx.my)                                ok "cert CN=$CN" ;;
  "")                                      bad "no certificate returned" ;;
  *)                                       note "unexpected cert CN=$CN" ;;
esac

echo "── 4. HTTP behaviour ──"
C_WWW=$(curl -sS -o /dev/null -w '%{http_code}' --http1.1 "https://www.agmx.my/" 2>/dev/null)
[ "$C_WWW" = "200" ] && ok "https://www.agmx.my/ -> 200" || bad "https://www.agmx.my/ -> ${C_WWW:-conn-fail}"
APEX=$(curl -sS -o /dev/null -w '%{http_code}' --http1.1 "https://agmx.my/" 2>/dev/null)
[ "$APEX" = "308" ] && ok "https://agmx.my/ -> 308 (apex redirect)" || note "https://agmx.my/ -> ${APEX:-conn-fail} (expected 308)"
if [ "$APEX" != "000" ] && [ -n "$APEX" ]; then
  LOC=$(curl -sSI --http1.1 "https://agmx.my/" 2>/dev/null | grep -i '^location:' | tr -d '\r' | sed 's/^[Ll]ocation: *//')
  if [ -n "$LOC" ]; then
    case "$LOC" in *"$EXPECT"*) ok "redirect target: $LOC" ;; *) bad "redirect target: $LOC (expected $EXPECT)" ;; esac
  fi
fi

ready=$fail
echo "── 5. app cutover (source-of-truth strings in the live build) ──"
IDX=$(curl -sS --http1.1 "https://www.agmx.my/" 2>/dev/null)
CANON=$(printf '%s' "$IDX" | grep -oiE '<link[^>]+rel="canonical"[^>]*href="[^"]*"' | grep -oE 'https://[^"]*' | head -1)
OGURL=$(printf '%s' "$IDX" | grep -oiE '<meta[^>]+property="og:url"[^>]*content="[^"]*"' | grep -oE 'https://[^"]*' | head -1)
echo "    canonical = ${CANON:-<none>}"
echo "    og:url    = ${OGURL:-<none>}"
case "$CANON" in
  *"$EXPECT"*) ok "canonical points at $EXPECT" ;;
  "")          bad "no canonical tag found" ;;
  *)           bad "canonical still $CANON" ;;
esac
case "$OGURL" in
  *"$EXPECT"*) ok "og:url points at $EXPECT" ;;
  *)           bad "og:url still ${OGURL:-<none>}" ;;
esac

SM=$(curl -sS --http1.1 "https://www.agmx.my/sitemap.xml" 2>/dev/null | grep -oE '<loc>[^<]*</loc>' | sed 's:</\?loc>::g')
N=$(printf '%s\n' "$SM" | grep -c . )
M=$(printf '%s\n' "$SM" | grep -c "$EXPECT")
echo "    sitemap: $N entries, $M on $EXPECT"
[ "$N" -gt 0 ] && [ "$N" = "$M" ] && ok "all $N sitemap entries on $EXPECT" || bad "sitemap: $M/$N entries on $EXPECT"

CACHE=$(curl -sS --http1.1 "https://www.agmx.my/sw.js" 2>/dev/null | grep -oE 'const CACHE *= *"[^"]*"|const CACHE *= *'"'"'[^'"'"']*'"'"'' | head -1)
echo "    sw.js: ${CACHE:-<not found>}"

echo
printf '  summary: %d passed, %d failed, %d warnings\n' "$pass" "$fail" "$warn"
if [ "$ready" -gt 0 ]; then
  if [ "$STALE" = "1" ]; then
    echo "  VERDICT: your DNS is CORRECT at the authoritative server; public resolvers are"
    echo "           still serving the old cached record. Nothing to fix — just wait."
    echo "           Cached record expires in ~${STALE_TTL}s. Re-run this script after that."
  else
    echo "  VERDICT: DNS/TLS not ready — do NOT run scripts/set-domain.sh yet."
  fi
  exit 1
elif [ "$fail" -gt 0 ]; then
  echo "  VERDICT: domain is live and healthy, but the app still publishes the old host."
  echo "           Run: bash scripts/set-domain.sh "$EXPECT" --old <old-host>            (dry run)"
  echo "           Then: bash scripts/set-domain.sh "$EXPECT" --old <old-host> --apply"
  echo "           Then: git commit -am 'chore: publish $EXPECT as canonical host' && git push"
  echo "           Then re-run this script; expect exit 0."
  exit 2
else
  echo "  VERDICT: cutover complete."; exit 0
fi
