#!/usr/bin/env bash
# AGMX production smoke test — the §127 deployment matrix.
# Usage: BASE=https://agmx-v2-app.vercel.app bash scripts/smoke-test.sh
set -u
BASE="${BASE:-https://agmx-v2-app.vercel.app}"
pass=0; fail=0
check() { # name path expect_status
  local name="$1" path="$2" expect="${3:-200}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$BASE$path")
  if [ "$code" = "$expect" ]; then
    echo "  ✅ $name ($path) → $code"; pass=$((pass+1))
  else
    echo "  ❌ $name ($path) → $code (want $expect)"; fail=$((fail+1))
  fi
}
echo "AGMX smoke test → $BASE"
echo "-- pages:"
check "home"        "/"
check "home (file)" "/index.html"
check "app"         "/app.html"
check "assessment"  "/assessment.html"
check "checkout"    "/checkout.html"
check "leads"       "/leads.html"
check "privacy"     "/privacy.html"
check "terms"       "/terms.html"
check "404 page"    "/404.html"
echo "-- core assets:"
check "styles.css"  "/styles.css"
check "app.js"      "/app.js"
check "data.js"     "/data.js"
echo "-- pwa + meta:"
check "sw.js"       "/sw.js"
check "manifest"    "/manifest.json"
check "robots.txt"  "/robots.txt"
check "sitemap.xml" "/sitemap.xml"
echo "-- spa fallback:"
check "SPA route /app" "/app" 200
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
