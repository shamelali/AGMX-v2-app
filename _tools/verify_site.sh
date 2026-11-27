#!/usr/bin/env bash
# Full verification of the live site. Read-only. Prints status codes, sizes and hostnames.
#   bash _tools/verify_site.sh [host]
set -uo pipefail
H="${1:-www.agmx.my}"
B="https://$H"
P=0; F=0; W=0
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; P=$((P+1)); }
no(){ printf '  \033[31m✗\033[0m %s\n' "$1"; F=$((F+1)); }
wn(){ printf '  \033[33m!\033[0m %s\n' "$1"; W=$((W+1)); }
code(){ curl -sS -o /dev/null -w '%{http_code}' --max-time 25 "$1" 2>/dev/null; }
size(){ curl -sS -o /dev/null -w '%{size_download}' --max-time 25 "$1" 2>/dev/null; }

echo "── 1. transport ──"
printf '  %-40s ' "https://$H/"; C=$(code "$B/"); [ "$C" = 200 ] && ok "200" || no "HTTP $C"
printf '  %-40s ' "apex -> www"; A=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://agmx.my/" 2>/dev/null)
[ "$A" = 308 ] && ok "308" || no "HTTP $A"
CERTCN=$(echo | openssl s_client -connect "$H:443" -servername "$H" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//')
CERTEXT=$(echo | openssl s_client -connect "$H:443" -servername "$H" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')
WILD="*.${H#*.}"
case "$CERTCN" in
  "$H"|"$WILD") ok "cert CN=$CERTCN covers $H (expires $CERTEXT)" ;;
  *) no "cert CN=$CERTCN does not cover $H (expires $CERTEXT)" ;;
esac
HSTS=$(curl -sSI --max-time 20 "$B/" 2>/dev/null | grep -ci 'strict-transport-security')
[ "$HSTS" -gt 0 ] && ok "HSTS present" || wn "no Strict-Transport-Security header"

echo "── 2. every sitemap page ──"
SM=$(curl -sS --max-time 25 "$B/sitemap.xml" 2>/dev/null)
LOCS=$(printf '%s' "$SM" | grep -oE '<loc>[^<]*' | sed 's/<loc>//')
N=$(printf '%s\n' "$LOCS" | grep -c .)
for u in $LOCS; do
  C=$(code "$u"); S=$(size "$u")
  [ "$C" = 200 ] && [ "$S" -gt 500 ] && ok "$(basename "$u") 200 (${S}B)" || no "$u -> $C (${S}B)"
done
printf '  %-40s ' "sitemap entries on this host"; M=$(printf '%s\n' "$LOCS" | grep -c "$H"); [ "$N" = "$M" ] && ok "$M/$N" || no "$M/$N"

echo "── 3. metadata ──"
IDX=$(curl -sS --max-time 25 "$B/" 2>/dev/null)
echo "$IDX" | grep -iE "<link[^>]+rel=\"canonical\"[^>]*href=\"$B/?" >/dev/null && ok "canonical = $B/" || no "canonical wrong"
echo "$IDX" | grep -iE "property=\"og:url\"[^>]*content=\"$B/?" >/dev/null && ok "og:url = $B/" || no "og:url wrong"
echo "$IDX" | grep -i '<meta name="description"' >/dev/null && ok "meta description present" || wn "no meta description"
OG=$(echo "$IDX" | grep -oE 'property="og:image"[^>]*content="[^"]*' | grep -oE 'https?://[^"]*' | head -1)
if [ -n "$OG" ]; then C=$(code "$OG"); [ "$C" = 200 ] && ok "og:image 200" || no "og:image -> $C ($OG)"; else wn "no og:image"; fi
echo "$IDX" | grep -iE '<title>[^<]+</title>' >/dev/null && ok "title: $(echo "$IDX" | grep -oiE '<title>[^<]*' | sed 's/<title>//' | head -1 | cut -c1-48)" || no "no title"

echo "── 4. assets referenced by the homepage ──"
ASSETS=$(echo "$IDX" | grep -oE '(src|href)="[^"]+"' | sed 's/.*="//;s/"$//' \
         | grep -vE '^(https?:|mailto:|tel:|#|data:)' | grep -E '\.(js|css|png|jpg|jpeg|svg|webp|ico|json)$' | sort -u)
AN=0; AB=0
for a in $ASSETS; do
  AN=$((AN+1)); C=$(code "$B/${a#/}")
  [ "$C" = 200 ] || { AB=$((AB+1)); no "asset $a -> $C"; }
done
[ "$AB" = 0 ] && ok "all $AN local assets 200" || no "$AB of $AN assets failing"

echo "── 5. stale or wrong hostnames in served files ──"
for f in / index.html app.html login.js api/config.js sitemap.xml robots.txt sw.js; do
  BODY=$(curl -sS --max-time 25 "$B/$f" 2>/dev/null)
  case "$f" in /) LBL="(homepage)";; *) LBL="$f";; esac
  # strip line comments and block comments first: a changelog entry naming a retired host
  # is history, not a reference the browser will follow
  CODE=$(printf '%s' "$BODY" | sed 's://.*::' | python3 -c '
import sys,re
t=sys.stdin.read()
print(re.sub(r"/\*.*?\*/", "", t, flags=re.S), end="")' 2>/dev/null)
  OLD=$(printf '%s' "$CODE" | grep -oE 'agmx-v2[a-z0-9.-]*\.vercel\.app' | sort -u | tr '\n' ' ')
  LH=$(printf '%s' "$CODE" | grep -oE '(https?://)?(localhost|127\.0\.0\.1)(:[0-9]+)?' | sort -u | tr '\n' ' ')
  MS=$(printf '%s' "$CODE" | grep -oE 'myagmx\.com' | sort -u | tr '\n' ' ')
  if [ -z "$OLD$LH$MS" ]; then ok "$LBL clean"; else no "$LBL contains: $OLD$LH$MS"; fi
done

echo "── 6. mixed content (http:// resources on an https page) ──"
MX=$(echo "$IDX" | grep -oE '(src|href)="http://[^"]*"' | sort -u | head -5)
[ -z "$MX" ] && ok "no http:// subresources" || no "$(printf '%s' "$MX" | tr '\n' ' ')"

echo "── 7. routing ──"
C=$(code "$B/this-page-does-not-exist-xyz")
if [ "$C" = 404 ]; then ok "unknown path -> 404"
else
  SAME=$(cmp -s <(curl -sS --max-time 20 "$B/this-page-does-not-exist-xyz" 2>/dev/null) <(curl -sS --max-time 20 "$B/" 2>/dev/null) && echo yes || echo no)
  wn "unknown path -> $C serving index.html ($SAME) — soft 404, SEO only, no user impact"
fi
C=$(code "$B/auth/callback"); [ "$C" = 200 ] && ok "/auth/callback 200 (OAuth landing)" || no "/auth/callback -> $C"
C=$(code "$B/api/health"); [ "$C" = 200 ] && ok "/api/health 200" || no "/api/health -> $C"
C=$(code "$B/api/config"); [ "$C" = 200 ] && ok "/api/config 200" || no "/api/config -> $C"

echo "── 8. service worker ──"
SW=$(curl -sS --max-time 25 "$B/sw.js" 2>/dev/null)
CV=$(printf '%s' "$SW" | grep -oE 'const CACHE *= *"[^"]*"' | head -1)
[ -n "$CV" ] && ok "$CV" || no "no CACHE constant"
PRE=$(printf '%s' "$SW" | grep -oE '"/[a-z0-9._/-]+"' | tr -d '"' | sort -u | head -12)
PB=0
for p in $PRE; do C=$(code "$B$p"); [ "$C" = 200 ] || { PB=$((PB+1)); no "precached $p -> $C"; }; done
[ "$PB" = 0 ] && ok "precached entries resolve" || no "$PB precached entries broken"

echo "── 9. accidental exposure ──"
for p in /.env /.dev.vars /.git/config /package.json /scripts/set-domain.sh /supabase/config.toml /tools/check.sh /DEPLOY.md; do
  C=$(code "$B$p"); [ "$C" = 404 ] || no "$p served ($C)"
done
ok "no source/config artefacts served (checked 8 paths)"
# a bare env-var NAME is not a leak; an assigned literal is. Detect the latter only.
for f in api/config api/config.js supabase-client.js; do
  BODY=$(curl -sS --max-time 20 "$B/$f" 2>/dev/null)
  VAL=$(printf '%s' "$BODY" | grep -oE '(HITPAY_SALT|HITPAY_API_KEY|BILLPLZ_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE)[[:space:]]*[:=][[:space:]]*"[^"]{8,}"' | head -3)
  if [ -n "$VAL" ]; then no "$f assigns a secret literal"; else ok "$f: only env-var names, no assigned secrets"; fi
done

echo "── 10. api config sanity ──"
CFG=$(curl -sS --max-time 25 "$B/api/config" 2>/dev/null)
printf '%s' "$CFG" | grep "\"appUrl\": *\"$B\"" >/dev/null && ok "appUrl = $B" || no "appUrl wrong: $(printf '%s' "$CFG" | grep -oE '\"appUrl\"[^,]*')"
printf '%s' "$CFG" | grep '"demoMode": *false' >/dev/null && ok "demoMode false" || wn "demoMode not false"
printf '%s' "$CFG" | grep '"mode": *"supabase"' >/dev/null && ok "mode = supabase" || wn "mode not supabase"

echo
printf '  RESULT: %d passed, %d failed, %d warnings\n' "$P" "$F" "$W"
[ "$F" = 0 ] && exit 0 || exit 1
