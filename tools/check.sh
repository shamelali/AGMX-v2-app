#!/usr/bin/env bash
# ============================================================
# AGMX — Repository checks
# ------------------------------------------------------------
# Run locally:      ./tools/check.sh
# Run in CI:         bash tools/check.sh
# Install as hook:   ln -sf ../../tools/check.sh .git/hooks/pre-commit
#
# No dependencies beyond node + python3.
# Exits non-zero on the first failure so hooks and CI both block.
# ============================================================

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

FAIL=0
PASS=0
WARN=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ----------------------------------------------------------------
head_ "1. JavaScript syntax"
# ----------------------------------------------------------------
# Check every top-level .js file, excluding vendored/minified output.
while IFS= read -r f; do
  if node --check "$f" 2>/dev/null; then ok "$f"; else
    bad "$f"
    node --check "$f" 2>&1 | head -5 | sed 's/^/      /'
  fi
done < <(find . -maxdepth 1 -name '*.js' -not -name '*.min.js' | sort)

# PocketBase JSVM hooks (routerAdd/$app globals are runtime-injected;
# node --check only parses, which is exactly what we want here).
if [ -d pb_hooks ]; then
  while IFS= read -r f; do
    if node --check "$f" 2>/dev/null; then ok "$f"; else
      bad "$f"
      node --check "$f" 2>&1 | head -5 | sed 's/^/      /'
    fi
  done < <(find pb_hooks -name '*.js' | sort)
fi
[ "$PASS" -gt 0 ] || true

# ----------------------------------------------------------------
head_ "2. JSON validity"
# ----------------------------------------------------------------
for f in vercel.json manifest.json package.json sitemap.xml; do
  [ -f "$f" ] || continue
  case "$f" in
    *.xml) continue ;;
  esac
  if node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
    ok "$f"
  else
    bad "$f — invalid JSON"
  fi
done

# sitemap.xml and the pocketbase payloads
for f in sitemap.xml; do
  [ -f "$f" ] || continue
  if python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse('$f')" 2>/dev/null; then
    ok "$f (well-formed XML)"
  else
    bad "$f — malformed XML"
  fi
done

for f in pocketbase/collections.json pocketbase/seed.json; do
  [ -f "$f" ] || continue
  if python3 -c "import json; json.load(open('$f'))" 2>/dev/null; then
    ok "$f"
  else
    bad "$f — invalid JSON"
  fi
done

# ----------------------------------------------------------------
head_ "3. Vercel routing + security-header invariants"
# ----------------------------------------------------------------
# Regression guards, in the modern rewrites/headers model:
#   a) a legacy "routes" array silently disables top-level "headers", so the
#      CSP/X-Frame-Options block is served to nobody (this bit us: the security
#      headers were in vercel.json but never reached a browser);
#   b) the SPA catch-all in beforeFiles swallows every static asset, which is
#      the new shape of the old "filesystem after catch-all" bug;
#   c) the catch-all must be the LAST afterFiles rewrite, so real pages like
#      /assessment.html win before index.html is reached.
if [ -f vercel.json ]; then
  if python3 - <<'PY'
import json, sys
try:
    cfg = json.load(open("vercel.json"))
except Exception as e:
    print(f"  \033[31m✗\033[0m vercel.json unreadable: {e}"); sys.exit(1)

fails = []

# --- (a) legacy "routes" beats "headers" -------------------------
if "routes" in cfg:
    fails.append(
        'legacy "routes" array present — Vercel ignores the top-level "headers" '
        'block whenever "routes" is set, so CSP/X-Frame-Options/HSTS are never sent. '
        'Express routing as "rewrites" instead.'
    )
else:
    print("  \033[32m✓\033[0m no legacy \"routes\" array (headers stay in force)")

# --- (b)+(c) catch-all placement in rewrites ---------------------
rewrites = cfg.get("rewrites", {})
# The array shorthand means "afterFiles"; the object form names each phase.
if isinstance(rewrites, list):
    after, before = rewrites, []
elif isinstance(rewrites, dict):
    after  = rewrites.get("afterFiles", []) or []
    before = rewrites.get("beforeFiles", []) or []
else:
    after, before = [], []

catch_all = lambda r: r.get("source") == "/(.*)" and r.get("destination") == "/index.html"

if any(catch_all(r) for r in before):
    fails.append('SPA catch-all lives in beforeFiles — it runs before the filesystem lookup, '
                 'so every asset resolves to index.html')
elif not after:
    fails.append("no afterFiles rewrites — extensionless pages like /assessment would 404")
elif not catch_all(after[-1]):
    fails.append('last afterFiles rewrite must be the "/(.*)" → "/index.html" SPA catch-all, '
                 f"found {after[-1]!r}")
else:
    print("  \033[32m✓\033[0m SPA catch-all is last in afterFiles (assets resolve first)")

# --- headers actually present ------------------------------------
hdrs = {h.get("source"): {kv.get("key"): kv.get("value") for kv in h.get("headers", [])}
        for h in cfg.get("headers", []) if isinstance(h, dict)}

wild = hdrs.get("/(.*)", {})
for required in ("Content-Security-Policy", "X-Frame-Options",
                 "X-Content-Type-Options", "Referrer-Policy"):
    if required not in wild:
        fails.append(f'security header "{required}" missing from the "/(.*)" headers block')
if "Cache-Control" not in hdrs.get("/sw.js", {}):
    fails.append('/sw.js headers block no longer sets Cache-Control — '
                 'a stale service worker survives deploys')
if not fails:
    print("  \033[32m✓\033[0m security headers defined for all pages + /sw.js")

# A redirect to another host breaks the deployment if that alias is unset.
for r in cfg.get("redirects", []):
    dest = r.get("destination", "")
    if dest.startswith("http"):
        print(f"  \033[33m!\033[0m cross-host redirect to {dest} — confirm that alias resolves")

for f in fails:
    print(f"  \033[31m✗\033[0m {f}")
sys.exit(1 if fails else 0)
PY
  then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# ----------------------------------------------------------------
head_ "4. HTML asset references"
# ----------------------------------------------------------------
# Every local src/href in the HTML must resolve to a real file.
if python3 - <<'PY'
import os, re, sys, glob
missing = []
checked = 0
for page in ["index.html", "app.html", "assessment.html", "checkout.html", "leads.html", "offline.html", "404.html"]:
    if not os.path.exists(page):
        continue
    html = open(page, encoding="utf-8").read()
    for url in re.findall(r'(?:src|href)\s*=\s*"([^"]+)"', html):
        if url.startswith(("http://", "https://", "//", "data:", "#", "mailto:", "tel:")):
            continue
        path = url.split("?")[0].split("#")[0]
        if not path or path == "/":
            continue  # site root, served by index.html
        if path.lstrip("/") == "config.js":
            continue  # optional per-deployment file (script tag is onerror-guarded)
        checked += 1
        if not os.path.exists(path.lstrip("/")):
            missing.append(f"{page} → {url}")

if missing:
    print(f"  \033[31m✗\033[0m {len(missing)} broken reference(s):")
    for m in sorted(set(missing)):
        print(f"      {m}")
    sys.exit(1)
print(f"  \033[32m✓\033[0m {checked} local reference(s) resolve")
PY
  then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# ----------------------------------------------------------------
head_ "5. Absolute URLs point at a live deployment"
# ----------------------------------------------------------------
# You already shipped index.html + sitemap.xml referencing an alias that
# 404'd. This catches that class of error offline.
# Capture bare hostnames — the loop prepends the scheme.
# Content references (pages/sitemap/robots) MUST serve 200.
HOSTS=$(grep -rhoE 'https://[a-z0-9.-]+\.vercel\.app' \
        index.html app.html assessment.html checkout.html leads.html sitemap.xml robots.txt 2>/dev/null \
        | sed 's|^https://||' | sort -u)
# CSP allow-list entries in vercel.json are permissions, not references —
# a PocketBase host that is not deployed yet must not fail the build,
# but it deserves a warning so nobody forgets it.
CSP_HOSTS=$(grep -oE 'https://[a-z0-9.-]+\.vercel\.app' vercel.json 2>/dev/null \
        | sed 's|^https://||' | sort -u)
for h in $CSP_HOSTS; do
  case " $HOSTS " in *" $h "*) ;; *) warn "$h (CSP allow-list only — deploy it or remove the entry)";; esac
done
if [ -n "$HOSTS" ]; then
  for h in $HOSTS; do
    if [ "${AGMX_SKIP_NET:-0}" = "1" ]; then
      warn "$h (network check skipped)"
      continue
    fi
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$h/" 2>/dev/null)
    rc=$?
    if [ "$rc" -ne 0 ] || [ -z "$code" ] || [ "$code" = "000" ]; then
      bad "$h → unreachable from this network (curl exit $rc)"
    elif [ "$code" = "200" ]; then
      ok "$h → 200"
    else
      bad "$h → HTTP $code (referenced but not serving)"
    fi
  done
else
  warn "no absolute deployment URLs found"
fi

# ----------------------------------------------------------------
head_ "6. PocketBase schema integrity"
# ----------------------------------------------------------------
if [ -f pocketbase/collections.json ]; then
  if python3 - <<'PY'
import json, sys
cols   = json.load(open("pocketbase/collections.json"))
names  = {c["name"] for c in cols}
fails  = []

# Relations must point at a collection that exists (or a PB built-in).
for c in cols:
    for f in c.get("schema", []):
        if f.get("type") == "relation":
            t = f.get("collectionId", "")
            if t and not t.startswith("_pb_") and t not in names:
                fails.append(f"{c['name']}.{f['name']} → unknown collection '{t}'")

# Tenancy boundary: every business table must be org-scoped.
# `federations` deliberately uses ownerOrgId — it is the federation itself,
# and federation_organizations joins child orgs.
ORG_SCOPED = {"organizations", "plans", "compliance_rules"}
ORG_FIELDS = {"organizationId", "ownerOrgId"}
for c in cols:
    if c["name"] in ORG_SCOPED:
        continue
    if not any(f.get("name") in ORG_FIELDS for f in c.get("schema", [])):
        fails.append(f"{c['name']} has no organizationId — tenancy gap")

# Append-only tables must forbid update and delete.
for c in cols:
    if c["name"] in ("votes", "audit_events"):
        if c.get("updateRule") != "" or c.get("deleteRule") != "":
            fails.append(f"{c['name']} is not append-only — votes/audit must be immutable")

# `required` on a number means "non-zero"; on a bool it means "always true".
# So it cannot express "must be provided", and it silently rejects valid zero
# values — arrears=0, votesYa=0, eligible=false, tax=0. That bug shipped once
# already and every valid write failed with "Cannot be blank."
for c in cols:
    for f in c.get("schema", []):
        if f.get("required") and f.get("type") in ("number", "bool"):
            fails.append(
                f"{c['name']}.{f['name']} ({f['type']}) is required — "
                f"PocketBase reads that as {'non-zero' if f['type']=='number' else 'always true'}; "
                f"use required=false and validate in the app"
            )

if fails:
    for f in fails:
        print(f"  \033[31m✗\033[0m {f}")
    sys.exit(1)
print(f"  \033[32m✓\033[0m {len(cols)} collections — relations, tenancy, append-only, zero-value fields OK")
PY
    then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# ----------------------------------------------------------------
head_ "7. Service worker cache manifest"
# ----------------------------------------------------------------
if [ -f sw.js ]; then
  if python3 - <<'PY'
import re, sys, os
src = open("sw.js").read()
m   = re.search(r"PRECACHE\s*=\s*\[(.*?)\]", src, re.S)
if not m:
    print("  \033[33m!\033[0m no PRECACHE array found"); sys.exit(0)

entries = re.findall(r'"([^"]+)"', m.group(1))
missing = [e for e in entries if e != "/" and not os.path.exists(e.lstrip("/"))]

# Per-deployment config must never be precached: it changes per environment
# and a cached copy would pin a stale Google client id / PocketBase URL.
NEVER_CACHE = {"sw.js"}
def never_cache(f):
    return f in NEVER_CACHE or f.startswith("config.")

# Warn when a top-level script is absent from the precache list.
scripts = {f for f in os.listdir(".") if f.endswith(".js")}
listed  = {e.lstrip("/") for e in entries}
unlisted = sorted(f for f in scripts
                  if f not in listed and not never_cache(f) and os.path.getsize(f) > 0)

if missing:
    print(f"  \033[31m✗\033[0m precache references missing files: {missing}")
    sys.exit(1)

# --- cache-version invariant -------------------------------------------
# The fetch handler below is cache-first, and the browser only re-installs
# the worker when sw.js changes byte-for-byte. So editing a precached file
# WITHOUT bumping the CACHE string leaves every installed client serving the
# old copy indefinitely — the deploy goes out and nothing changes. This bit
# us: relabelling a diagnostics row shipped nowhere because sw.js was
# untouched.
#
# Invariant: since the commit that last changed the CACHE line, every
# PRECACHE entry must be byte-identical — unless the CACHE string has moved
# since (in the working tree or in a later commit).
import subprocess
def show(rev, path):
    p = subprocess.run(["git", "show", f"{rev}:{path}"],
                       capture_output=True, text=True)
    return None if p.returncode else p.stdout

cur = re.search(r'const\s+CACHE\s*=\s*"([^"]+)"', src)
# -G (not -S): -S counts occurrences of the literal, which does not change
# when only the quoted value does — it would return the commit that
# introduced the line rather than the last bump. -G matches on line content.
bump = subprocess.run(["git", "log", "-1", "--format=%H", "-G", r"const CACHE\s*=", "--", "sw.js"],
                      capture_output=True, text=True).stdout.strip()

if cur and bump:
    bumped_val = re.search(r'const\s+CACHE\s*=\s*"([^"]+)"', show(bump, "sw.js") or "")
    stale = []
    if bumped_val and bumped_val.group(1) == cur.group(1):
        for e in entries:
            p = e.lstrip("/")
            if p == "/" or not os.path.exists(p):
                continue
            old = show(bump, p)
            if old is None or old != open(p).read():
                stale.append(p)
    if stale:
        print(f"  \033[31m✗\033[0m precached file(s) changed since the CACHE bump at "
              f"{bump[:7]} but CACHE is still \"{cur.group(1)}\":")
        for s in stale:
            print(f"      {s}")
        print("      Bump const CACHE in sw.js — the fetch handler is cache-first, so "
              "installed clients keep the old copy until sw.js itself changes.")
        sys.exit(1)
    print(f"  \033[32m✓\033[0m CACHE \"{cur.group(1)}\" covers every precached change "
          f"since {bump[:7]}")
else:
    print("  \033[33m!\033[0m could not resolve CACHE history — version invariant skipped")

if unlisted:
    print(f"  \033[33m!\033[0m not precached (offline will miss them): {', '.join(unlisted)}")
else:
    print(f"  \033[32m✓\033[0m {len(entries)} precache entries resolve; all runtime scripts cached")
PY
    then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# ----------------------------------------------------------------
head_ "8. Secrets hygiene"
# ----------------------------------------------------------------
# Nothing that looks like a live credential may be committed.
# The pattern is assembled from fragments so this file does not match itself.
SK_P="sk""_live_"
AK="AK""IA[0-9A-Z]{16}"
PEM="-----BEGIN [A-Z ]*PR""IVATE KEY-----"
JWT="eyJ""hbGciOi[A-Za-z0-9_-]{10,}\."
# This script and its documentation legitimately contain the patterns.
SELF="^tools/check\.sh$|^tools/CHECKS\.md$"

LEAKS=$(git ls-files -z 2>/dev/null \
        | grep -zvE "$SELF" \
        | xargs -0 grep -lIE "($SK_P|$AK|$PEM|$JWT)" 2>/dev/null || true)

if [ -n "$LEAKS" ]; then
  bad "possible secrets in: $(echo "$LEAKS" | tr '\n' ' ')"
  printf '      Review before pushing — if these are false positives, refine the pattern.\n'
else
  ok "no credential patterns in tracked files"
fi

# config.js must never be tracked — it holds per-deployment values.
if git ls-files --error-unmatch config.js >/dev/null 2>&1; then
  bad "config.js is tracked but should be gitignored"
else
  ok "config.js is not tracked"
fi

# Being gitignored is NOT enough for a Vercel deploy: `vercel deploy` uploads
# the working tree and does not read .gitignore, so a gitignored config.js
# holding real credentials was served publicly at /config.js for ~15 minutes
# on 2026-10-17. The .vercelignore entry is the actual control.
#
# The pattern must also be root-anchored ("/config.js"): a bare "config.js"
# matches at any depth in gitignore semantics and would delete api/config.js,
# the function that serves production config.
if [ -f .vercelignore ]; then
  if grep -qE '^/config\.js$' .vercelignore; then
    ok ".vercelignore excludes /config.js (root-anchored)"
  elif grep -qE '^config\.js$' .vercelignore; then
    bad ".vercelignore has 'config.js' unanchored — that also matches api/config.js and deletes the config function; use '/config.js'"
  else
    bad ".vercelignore missing '/config.js' — 'vercel deploy' ignores .gitignore, so the local config.js (and any credential in it) ships to the public site"
  fi
else
  bad "no .vercelignore — 'vercel deploy' ignores .gitignore, so gitignored config.js and pb_data/ get uploaded"
fi

# Same trap, second host: wrangler.jsonc points assets.directory at the repo
# root, and `wrangler pages deploy` honours only .wrignore (plus .git and
# node_modules). Without it, .env.local and pb_data/ go public.
if [ -f wrangler.jsonc ] || [ -f wrangler.toml ]; then
  if [ ! -f .wrignore ]; then
    bad "no .wrignore while a wrangler config deploys the repo root — .env.local and pb_data/ would be uploaded to Cloudflare Pages"
  elif ! grep -qE '^/config\.js$' .wrignore; then
    bad ".wrignore missing '/config.js' — the same 2026-10-17 exposure applies to a wrangler deploy"
  elif ! grep -qE '^pb_data/?$' .wrignore; then
    bad ".wrignore missing 'pb_data/' — the local PocketBase SQLite file would be served publicly"
  else
    ok ".wrignore excludes /config.js and pb_data/"
  fi
fi

# The inverse failure, caught in the same session: an unanchored "config.js"
# in .gitignore also ignores api/config.js, so the config function is never
# committed and every GitHub-integration deploy ships without it.
if [ -f api/config.js ]; then
  if git check-ignore -q api/config.js 2>/dev/null; then
    bad "api/config.js is gitignored (unanchored 'config.js' in .gitignore) — git deploys ship without the config function"
  else
    ok "api/config.js is committable"
  fi
fi

# ----------------------------------------------------------------
head_ "9. Money-flow test suite"
# ----------------------------------------------------------------
if [ -f tools/test_money_flow.mjs ]; then
  if OUT=$(node tools/test_money_flow.mjs 2>&1); then
    COUNT=$(printf '%s' "$OUT" | grep -oE 'Passed: [0-9]+' | grep -oE '[0-9]+')
    ok "tools/test_money_flow.mjs (${COUNT:-?} assertions)"
  else
    bad "tools/test_money_flow.mjs failed"
    printf '%s\n' "$OUT" | tail -8 | sed 's/^/      /'
  fi
else
  warn "tools/test_money_flow.mjs not found"
fi

# ----------------------------------------------------------------
head_ "10. PocketBase JSVM API compatibility"
# ----------------------------------------------------------------
if ls pb_hooks/*.js >/dev/null 2>&1; then
  if python3 - <<'PY'
import glob, re, sys

# APIs PocketBase 0.23 renamed or removed. They parse fine and only fail at
# runtime inside the server, so without this pass a 0.22-era hook merges
# cleanly and breaks every money-flow route at the first call.
STALE = [
    (r"\$app\.dao\(",              "$app.dao() — the DAO was flattened onto $app in 0.23"),
    (r"\.saveRecord\(",            ".saveRecord() — renamed .save() in 0.23"),
    (r"\$apis\.",                  "$apis.* — removed; use c.requestInfo()"),
    (r"\bc\.queryParam\(",         "c.queryParam() — removed; use c.requestInfo().query[k]"),
    (r"\.getId\(\)",               ".getId() — not bound in the 0.40 JSVM; use .id"),
    (r"\.schema\b",                "Collection.schema — renamed Collection.fields in 0.23"),
]

def strip_comments(src):
    """Blank out // and /* */ comments, preserving line numbering."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '"' or c == "'" or c == "`":
            q, i = c, i + 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == q:
                    i += 1
                    break
                i += 1
            out.append(' ')
            continue
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
            continue
        if src.startswith("/*", i):
            i += 2
            while i < n and not src.startswith("*/", i):
                # keep newlines so reported line numbers stay accurate
                out.append("\n" if src[i] == "\n" else " ")
                i += 1
            i += 2
            out.append("  ")
            continue
        out.append(c)
        i += 1
    return "".join(out)

hits = []
for path in sorted(glob.glob("pb_hooks/*.js")):
    code = strip_comments(open(path).read())
    for lineno, line in enumerate(code.split("\n"), 1):
        for pattern, why in STALE:
            if re.search(pattern, line):
                hits.append(f"{path}:{lineno}  {why}")
                break

if hits:
    for h in hits:
        print(f"  \033[31m✗\033[0m {h}")
    sys.exit(1)

n = len(glob.glob("pb_hooks/*.js"))
print(f"  \033[32m✓\033[0m {n} hook file(s) use no PocketBase 0.22-only APIs")
PY
    then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# ----------------------------------------------------------------
head_ "11. Client/server endpoint consistency"
# ----------------------------------------------------------------
# Every AGMX route the browser can call must exist on the server. These
# live in pb_hooks/*.js as routerAdd() registrations; the client reaches them
# through api.js, which prefixes "/api/agmx" onto a relative path.
#
# The rule: a client path under /api/agmx/ must be registered. Other /api/...
# paths are PocketBase's native collections API and always exist.
if ls pb_hooks/*.js >/dev/null 2>&1; then
  if python3 - <<'PY'
import glob, re, sys

# Server: every route the JSVM registers.
server = set()
for path in sorted(glob.glob("pb_hooks/*.js")):
    src = open(path).read()
    for method, route in re.findall(r'routerAdd\(\s*"(\w+)"\s*,\s*"([^"]+)"', src):
        server.add(route)

# Client: (a) api.js relative paths get the /api/agmx prefix api.js applies;
#         (b) any literal /api/agmx/... path is already absolute.
client = set()
api = open("api.js").read() if __import__("os").path.exists("api.js") else ""
for method, rel in re.findall(r'_req\(\s*"(\w+)"\s*,\s*"([^"]+)"', api):
    client.add("/api/agmx" + rel)
for path in sorted(glob.glob("*.js")):
    if path.startswith("tools/"):
        continue
    src = open(path).read()
    # strip comments so doc notes do not count as calls
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", " ", src)
    for lit in re.findall(r'"(/api/agmx/[^"]+)"', src):
        client.add(lit)

missing = sorted(p for p in client if p not in server)
if missing:
    for m in missing:
        print(f"  \033[31m✗\033[0m client calls {m} but pb_hooks/ registers no such route")
    sys.exit(1)

print(f"  \033[32m✓\033[0m {len(client)} AGMX endpoint(s) all have server routes "
      f"({len(server)} registered)")
PY
    then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# ----------------------------------------------------------------
head_ "12. Route handlers are exported by their module"
# ----------------------------------------------------------------
# money_flow.pb.js routes dispatch through require(__hooks + "/X.js").fn(c).
# If fn is missing from X.js's module.exports, the require() succeeds, the
# route registers, and the client sees a bare "Something went wrong" 400 —
# no stack trace, no failing test, because the route never ran. This bit the
# Billplz gateway: both /payment/link and /payment/callback were live in the
# router but absent from module.exports.
if ls pb_hooks/*.js >/dev/null 2>&1; then
  if python3 - <<'PY'
import glob, re, sys

def exports_of(path):
    """Names listed in a module's `module.exports = { a: a, b: b, ... }`."""
    src = open(path).read()
    m = re.search(r"module\.exports\s*=\s*\{([^}]*)\}", src, re.DOTALL)
    if not m:
        return None  # file has no exports table at all
    body = m.group(1)
    # strip comments first: an inline /* ... */ would otherwise swallow the
    # name that follows it and mask a real export.
    body = re.sub(r"/\*.*?\*/", " ", body, flags=re.DOTALL)
    body = re.sub(r"//[^\n]*", " ", body)
    names = set()
    for entry in body.split(","):
        # accept `name: value` and bare `name`
        name = entry.split(":")[0].strip()
        if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
            names.add(name)
    return names

problems = []
checked = 0
for path in sorted(glob.glob("pb_hooks/*.js")):
    src = open(path).read()
    for mod, fn in re.findall(
        r'require\([^)]*?["\']([^"\']+\.js)["\']\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(', src
    ):
        target = "pb_hooks/" + mod.rsplit("/", 1)[-1]
        checked += 1
        try:
            available = exports_of(target)
        except OSError:
            available = None
        if available is None:
            problems.append(f"{path} calls {fn}() from {target}, which has no module.exports")
        elif fn not in available:
            problems.append(
                f"{path} calls require({target}).{fn}() but {target} does not export {fn}"
            )

if problems:
    for p in problems:
        print(f"  \033[31m✗\033[0m {p}")
    print("  \033[31m✗\033[0m every routerAdd handler must exist on its module's exports")
    sys.exit(1)

print(f"  \033[32m✓\033[0m {checked} require().fn() dispatch(es) resolve to exported handlers")
PY
    then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# --- payment credentials are not interchangeable ---------------------
# Pass 13. A gateway's Secret key and its webhook-signing key are DIFFERENT
# credentials. Billplz says so explicitly, and using one for the other
# accepts nothing while looking correct in every negative test (a wrong but
# consistent key still 403s a forged request). This shipped once, on
# 2026-10-18: callbacks were HMAC'd with BILLPLZ_API_KEY and would have
# rejected every real payment. Guard the invariant, not the spelling —
# it applies to any gateway added later.
if [ -d pb_hooks ]; then
printf '\n\033[1m%s\033[0m\n' "──── pass 13: webhook signing keys ────"
python3 - <<'PY' && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
import re, pathlib, sys

hooks = sorted(pathlib.Path("pb_hooks").glob("*.js"))
problems, checked = [], 0

ENV = r'env\(\s*"(\w+)"'

def is_auth(varname):
    """An API credential — used to authenticate, never to sign."""
    return varname.endswith("_API_KEY") or varname.endswith("_SECRET_KEY")

for path in hooks:
    src = path.read_text(encoding="utf-8")

    # 1. env() bindings: `var x = env("VAR")` -> x is bound to VAR.
    binds = dict(re.findall(r'var\s+(\w+)\s*=\s*' + ENV, src))

    # 2. Object-literal field bindings: `return { key: key }` inside a function
    #    that reads env() makes cfg.key an API credential. This is what turns
    #    cfg.key into BILLPLZ_API_KEY — the exact path the shipped bug used.
    for m in re.finditer(r'return\s*\{([^}]*)\}\s*;\s*\n\}', src):
        for pair in m.group(1).split(","):
            if ":" in pair:
                fld, val = (p.strip() for p in pair.split(":", 1))
                if val in binds:
                    binds["cfg." + fld] = binds[val]

    # 3. One level of helper indirection: `var k = fn()` where fn reads env().
    #    Lets the fixed code (sigKey = billplzSignatureKey()) resolve cleanly.
    helpers = {}
    for m in re.finditer(r'function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*?' + ENV, src):
        helpers[m.group(1)] = m.group(2)
    for var, fn in re.findall(r'var\s+(\w+)\s*=\s*(\w+)\s*\(\s*\)', src):
        if fn in helpers:
            binds[var] = helpers[fn]

    # 4. Signing-sensitive wrappers: a function whose 2nd param flows into
    #    hs256's secret slot. Tracking the WRAPPER is the whole point — the
    #    hs256 call always names its own parameter, so inspecting it directly
    #    can only ever report that parameter. The credential is chosen at the
    #    call site, so that is where it must be checked.
    #
    #    Body extent is found by brace matching, not a fixed window: the
    #    function's own comment block is longer than any sane window, and a
    #    window that misses the hs256 call makes this check pass vacuously —
    #    a green tick that verifies nothing. That was the second failure mode
    #    of the first draft of this pass.
    def fn_body(start):
        depth, i = 0, src.index("{", start)
        while i < len(src):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    return src[start:i + 1]
            i += 1
        return ""

    wrappers = set()
    for m in re.finditer(r'function\s+(\w+)\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{', src):
        name, _p1, p2 = m.groups()
        if re.search(r'\$security\.hs256\s*\([^,]+,\s*' + re.escape(p2) + r'\b',
                     fn_body(m.start())):
            wrappers.add(name)

    # 5. Check every call to such a wrapper.
    for name in wrappers:
        for m in re.finditer(re.escape(name) + r'\s*\(([^)]*)\)', src):
            args = [a.strip() for a in m.group(1).split(",")]
            if len(args) < 2:
                continue
            checked += 1
            secret = args[1]
            if is_auth(secret) or binds.get(secret) and is_auth(binds[secret]):
                problems.append(
                    f"{path}: {name}() signs with {secret}"
                    + (f" (bound to {binds[secret]})" if secret in binds else "")
                    + " — an API credential, not a signing key"
                )

    # 6. A signing-key env() must exist wherever an HMAC is computed.
    #    Keyed on the hs256 call, not the gateway name: the router file
    #    (money_flow.pb.js) merely dispatches and mentions Billplz in a comment,
    #    so requiring the key there would be a false positive. Only the file
    #    that computes the HMAC can be holding the wrong credential.
    computes_hmac = "$security.hs256(" in src
    if computes_hmac and not wrappers:
        # Fail loud rather than tick green. If hs256 is called but no wrapper
        # was recognised, steps 4-5 checked nothing and any "pass" is a lie.
        problems.append(
            f"{path}: computes HMACs but pass 13 found no signing wrapper to "
            f"inspect — the call site is unguarded, not verified"
        )
    for gw, sigvar in (("billplz", "BILLPLZ_X_SIGNATURE"),):
        if computes_hmac and gw in src.lower() and f'env("{sigvar}"' not in src:
            problems.append(f"{path}: computes {gw} HMACs but never reads {sigvar}")

if problems:
    for p in problems:
        print(f"  \033[31m✗\033[0m {p}")
    print("  \033[31m✗\033[0m a gateway's Secret key must never be used to verify webhooks")
    sys.exit(1)

print(f"  \033[32m✓\033[0m {checked} HMAC call(s) sign with a dedicated key, never an API credential")
PY
fi

# ----------------------------------------------------------------
head_ "14. Runtime config flags are env-driven"

# api/config.js shipped `process.env.X === 'true' || true`, which is always
# true: passing NEXT_PUBLIC_DEMO_MODE=false still served demoMode: true, so
# demo mode could not be disabled by any setting. Both halves are asserted —
# the dead pattern must not come back, and the handler must actually honour
# the variable when it is loaded.
# Scan code only: a comment describing the old bug must not trip the check.
if grep -vE '^[[:space:]]*(//|\*)' api/config.js | grep -qE "=== *['\"]true['\"] *\|\| *true"; then
  bad "api/config.js has an always-true flag expression again — that flag is a constant env cannot turn off"
else
  ok "no always-true flag expressions in api/config.js"
fi

CFG_HARNESS=$(mktemp /tmp/agmx-cfg-XXXXXX.mjs)
cat > "$CFG_HARNESS" <<'JS'
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.cwd() + "/api/config.js").href);
const mk = () => { const r = { b: null, setHeader() {}, status() { return r; }, send(x) { r.b = x; return r; } }; return r; };
// "false" must disable; unset must stay ON — that default is what every
// deployment has been serving, so flipping it here would be a live change.
process.env.NEXT_PUBLIC_DEMO_MODE = "false";
delete process.env.NEXT_PUBLIC_KNOWLEDGE_RAG;
const r = mk();
await mod.default({ method: "GET" }, r);
const cfg = JSON.parse(r.b.replace(/^\s*window\.AGMX_CONFIG\s*=\s*/, "").replace(/;\s*$/, ""));
if (cfg.demoMode !== false) { console.error(`demoMode stayed ${cfg.demoMode} with NEXT_PUBLIC_DEMO_MODE=false`); process.exit(1); }
if (cfg.knowledgeRagEnabled !== true) { console.error(`knowledgeRagEnabled was ${cfg.knowledgeRagEnabled} while unset — defaults must stay ON`); process.exit(1); }
JS
CFG_ERR=$(node "$CFG_HARNESS" 2>&1); CFG_RC=$?
rm -f "$CFG_HARNESS"
if [ "$CFG_RC" = 0 ]; then
  ok "api/config.js honours NEXT_PUBLIC_*=false and defaults to ON when unset"
else
  case "$CFG_ERR" in
    *ERR_MODULE_NOT_FOUND*|*SyntaxError*|*Cannot\ use\ import*)
      # Node too old to load an ESM file with no package.json beside it. Warn,
      # never tick green: a pass that executed nothing proves nothing.
      warn "flag behaviour not executed on $(node --version) (ESM load failed) — static check only: ${CFG_ERR%%$'\n'*}"
      ;;
    *)
      bad "api/config.js flag behaviour check failed: ${CFG_ERR%%$'\n'*}"
      ;;
  esac
fi

# ----------------------------------------------------------------
printf '\n\033[1m%s\033[0m\n' "───────────────────────────────────────"

if [ "$FAIL" -gt 0 ]; then
  printf '\033[31m✗\033[0m  %d passed · %d warning(s) · \033[31m%d failed\033[0m\n' "$PASS" "$WARN" "$FAIL"
  exit 1
else
  printf '\033[32m✓ all checks passed\033[0m  (%d passed · %d warning(s))\n' "$PASS" "$WARN"
  exit 0
fi
