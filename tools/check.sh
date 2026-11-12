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
  # A joined line — a comment that swallows the statement after it — still parses,
  # because the comment simply hides an object key (db.money lost its namespace this
  # way and only the browser noticed). A comment cannot legitimately end in "{".
  while IFS= read -r hit; do
    bad "$f:${hit} — a comment swallows the code after it"
  done < <(grep -nE '^[[:space:]]*//.*\{[[:space:]]*$' "$f" | cut -d: -f1)
done < <(find . -maxdepth 1 -name '*.js' -not -name '*.min.js' | sort)

# PocketBase JSVM hooks (routerAdd/$app globals are runtime-injected;
# node --check only parses, which is exactly what we want here).
if [ -d archive/pocketbase-v1/pb_hooks ]; then
  while IFS= read -r f; do
    if node --check "$f" 2>/dev/null; then ok "$f"; else
      bad "$f"
      node --check "$f" 2>&1 | head -5 | sed 's/^/      /'
    fi
  done < <(find archive/pocketbase-v1/pb_hooks -name '*.js' | sort)
fi
[ "$PASS" -gt 0 ] || true

# ----------------------------------------------------------------
head_ "2. JSON validity"
# ----------------------------------------------------------------
for f in vercel.json manifest.json package.json .mcp.json sitemap.xml; do
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

for f in archive/pocketbase-v1/pocketbase/collections.json archive/pocketbase-v1/pocketbase/seed.json; do
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
import json, os, re, sys
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

catch_all = lambda r: r.get("destination") == "/index.html" and r.get("source", "").startswith("/(")

# The catch-all used to be "/(.*)", which also swallows /price-list.js when that
# file is missing from a deploy: Vercel answers 200 with index.html, the service
# worker stores it under the .js URL, and the browser is handed markup that
# parses as nothing forever — including after the next deploy fixes the file.
# So the catch-all must exclude paths with a file extension, and the exclusion is
# tested as a regex, not just looked for in the text.
if any(catch_all(r) for r in before):
    fails.append('SPA catch-all lives in beforeFiles — it runs before the filesystem lookup, '
                 'so every asset resolves to index.html')
elif not after:
    fails.append("no afterFiles rewrites — extensionless pages like /assessment would 404")
elif not catch_all(after[-1]):
    fails.append('last afterFiles rewrite must be the SPA catch-all → "/index.html", '
                 f"found {after[-1]!r}")
else:
    src = after[-1]["source"]
    # path-to-regexp custom-match group: /((?!...)-> becomes an anchored regex here
    pattern = re.compile("^" + src.lstrip("/") + "$")
    hits = [p_ for p_ in ("assessment", "checkout", "404", "leads") if pattern.match(p_)]
    misses = [p_ for p_ in ("price-list.js", "styles.css", "api/config.js", "sw.js")
              if pattern.match(p_)]
    if len(hits) != 4:
        fails.append(f'catch-all source {src!r} does not match extensionless pages '
                     f"(matched {hits})")
    elif misses:
        fails.append(f'catch-all source {src!r} still rewrites asset paths to index.html '
                     f"(matched {misses}) — a missing .js would be served as 200 HTML and "
                     "cached by sw.js as JavaScript")
    else:
        print("  \033[32m✓\033[0m SPA catch-all is last, serves extensionless routes, "
              "and leaves asset paths to 404")

# --- (d) a rewrite must not target a function's own source path --------------
# /config.js rewrote to /api/config.js. With outputDirectory "." the function's
# source is ALSO published at that path, so Vercel's filesystem lookup answered
# it: the browser got the text of api/config.js — "export default" in a classic
# <script> is a SyntaxError — and never received window.AGMX_CONFIG. Every page
# then ran with no backend on a site that looked perfectly healthy. The
# function's route is extensionless: /api/config.
fn_shadow = []
pub_root = (cfg.get("outputDirectory") or ".").rstrip("/") or "."
for r in after:
    d = r.get("destination") or ""
    if pub_root == "." and re.match(r"^/api/[^/]+\.js$", d) and os.path.isfile("." + d):
        fn_shadow.append(f'{r.get("source")} -> {d}')
if fn_shadow:
    fails.append('rewrite(s) target a function\'s own source path, which the filesystem '
                 'serves instead of running it: ' + "; ".join(fn_shadow)
                 + ' — drop the ".js" so the route reaches the function (/api/config)')
else:
    print("  \033[32m✓\033[0m no rewrite targets a function source path")

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
import os, re, sys, glob, json
missing = []
checked = 0

# A reference is also resolved by the routing table, so read that too. Without
# it this pass could only ever check pages whose refs were all plain files, and
# it was handed a hardcoded page list that silently left callback.html — which
# links /app, a rewrite, not a file — outside the check entirely.
ROUTED = set()
try:
    for r in json.load(open("vercel.json")).get("rewrites", []):
        s = r.get("source", "")
        if s and not re.search(r"[\\[(]", s):  # literal only; skip splat patterns
            ROUTED.add(s)
except (OSError, ValueError):
    pass  # pass 3 reports a config that does not parse
try:
    for ln in open("_redirects"):
        parts = ln.split()
        if len(parts) >= 2 and parts[0].startswith("/"):
            ROUTED.add(parts[0])
except OSError:
    pass


def resolves(p):
    q = p.lstrip("/")
    return (os.path.exists(q) or os.path.exists(q + ".html")
            or os.path.exists(os.path.join(q, "index.html")) or p in ROUTED)


# Read off the tree, not a hardcoded list: the page set grew past it once
# already, and a broken ref on a page nobody remembered to add here is a 404
# in production that this pass reports as green.
for page in sorted(glob.glob("*.html")):
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
        if not resolves(path):
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
#
# The deployment host is read from sitemap.xml, not matched as `*.vercel.app`:
# a custom domain has no such suffix, so the old pattern would have found
# nothing and warned instead of probing. Any `.vercel.app` host the pages still
# name stays in the probe set, which is what the pattern used to be for.
CANON_HOST=$(grep -oE '<loc>[^<]+</loc>' sitemap.xml 2>/dev/null | head -1 \
             | sed -E 's|.*<loc>https?://([^/]+).*|\1|')
HOSTS=$( { [ -n "$CANON_HOST" ] && echo "$CANON_HOST"
          grep -rhoE 'https://[a-z0-9.-]+\.vercel\.app' \
            index.html app.html assessment.html checkout.html leads.html sitemap.xml robots.txt 2>/dev/null \
            | sed 's|^https://||'
        } | sort -u )
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
if [ -f archive/pocketbase-v1/pocketbase/collections.json ]; then
  if python3 - <<'PY'
import json, sys
cols   = json.load(open("archive/pocketbase-v1/pocketbase/collections.json"))
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

# The runtime set is what a page actually asks the browser to run, so read it
# off the markup. This used to sweep every top-level .js on disk, which called
# copilot.js and domain-packs.js offline gaps forever — nothing loads either,
# only tools/*.js requires them — while staying silent on a precache entry for
# a script no page loads. A ref that does not resolve at all is pass 4's job.
pages = [f for f in os.listdir(".") if f.endswith(".html")]
loaded = set()
for page in pages:
    body = open(page, encoding="utf-8").read()
    for raw in re.findall(r'<script[^>]*\bsrc="([^"]+)"', body, re.I):
        if raw.startswith("http") or raw.startswith("//"):
            continue
        path = raw.split("?")[0].split("#")[0].lstrip("/")
        if os.path.exists(path):
            loaded.add(path)
listed = {e.lstrip("/") for e in entries}
unlisted = sorted(f for f in loaded
                  if f not in listed and not never_cache(f) and os.path.getsize(f) > 0)
orphaned = sorted(f for f in listed if f.endswith(".js")
                  and f not in loaded and not never_cache(f))

if missing:
    print(f"  \033[31m✗\033[0m precache references missing files: {missing}")
    sys.exit(1)

# --- cache-version invariant -------------------------------------------
# Precached files are served cache-first, and the browser only re-installs the
# worker when sw.js changes byte-for-byte. So editing a precached file WITHOUT
# bumping the CACHE string leaves every installed client serving the old copy
# indefinitely — the deploy goes out and nothing changes. This bit us:
# relabelling a diagnostics row shipped nowhere because sw.js was untouched.
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
        print("      Bump const CACHE in sw.js — precached files are served "
              "cache-first, so installed clients keep the old copy until sw.js "
              "itself changes.")
        sys.exit(1)
    print(f"  \033[32m✓\033[0m CACHE \"{cur.group(1)}\" covers every precached change "
          f"since {bump[:7]}")
else:
    print("  \033[33m!\033[0m could not resolve CACHE history — version invariant skipped")

if unlisted:
    print(f"  \033[33m!\033[0m not precached (offline will miss them): {', '.join(unlisted)}")
else:
    print(f"  \033[32m✓\033[0m {len(entries)} precache entries resolve; all "
          f"{len(loaded)} scripts loaded by {len(pages)} pages are cached")

if orphaned:
    print(f"  \033[33m!\033[0m precached but no page loads it (every install stores it, "
          f"nothing runs it): {', '.join(orphaned)}")
PY
    then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# The manifest check above proves the list is right, not that the handler
# behaves. sw.js used to answer every same-origin GET from the cache,
# cache-first, which pinned /api/config.js — including the demoMode:true that
# made production write payments to localStorage — for as long as that worker
# stayed installed. This harness loads sw.js as written into a stub worker scope
# and drives its real fetch handler.
if [ -f tools/test_service_worker_policy.mjs ]; then
  if OUT=$(node tools/test_service_worker_policy.mjs 2>&1); then
    ok "tools/test_service_worker_policy.mjs (cache policy)"
  else
    bad "tools/test_service_worker_policy.mjs failed — the worker caches something it must not"
    printf '%s\n' "$OUT" | grep -E '^  ✗|^[a-z]' | head -6 | sed 's/^/      /'
  fi
else
  warn "tools/test_service_worker_policy.mjs not found"
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
NV="nv""api-[A-Za-z0-9_-]{32,}"
# Supabase's non-JWT credential formats. The legacy service_role key is a JWT
# and $JWT already catches it; these are the current ones, which nothing here
# matched — a sb_secret_ key pasted into any tracked file used to pass this pass.
SB_SEC="sb""_secret_[A-Za-z0-9_-]{20,}"
SB_PAT="sb""p_[A-Za-z0-9_-]{20,}"
# This script and its documentation legitimately contain the patterns.
SELF="^tools/check\.sh$|^tools/CHECKS\.md$"

LEAKS=$(git ls-files -z 2>/dev/null \
        | grep -zvE "$SELF" \
        | xargs -0 grep -lIE "($SK_P|$AK|$PEM|$JWT|$NV|$SB_SEC|$SB_PAT)" 2>/dev/null || true)

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

# The money-flow Edge Function queries with the service-role key, so RLS
# separates nothing there; every tenant boundary is an application guard in
# supabase/functions/money-flow/index.ts. This harness loads that file as
# written and drives its real handler, so deleting or weakening a guard fails
# the suite instead of shipping.
if [ -f tools/test_money_flow_auth.mjs ]; then
  if OUT=$(node tools/test_money_flow_auth.mjs 2>&1); then
    COUNT=$(printf '%s' "$OUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
    ok "tools/test_money_flow_auth.mjs (${COUNT:-?} assertions)"
  else
    bad "tools/test_money_flow_auth.mjs failed — a tenant boundary in money-flow is not holding"
    printf '%s\n' "$OUT" | grep -E '^  ✗' | head -8 | sed 's/^/      /'
  fi
else
  warn "tools/test_money_flow_auth.mjs not found"
fi

# The server-side suites above prove money-flow answers correctly. Neither one
# loads api.js, so the client could ask for a route the function never served —
# which is exactly what Sprint 3 shipped (POST /subscription, an invoice by
# subscriptionId, events as a path segment, a flat response envelope). Every
# such call 404s or reads undefined and nothing fails, because no test crossed
# the boundary. This drives the real Supabase adapter against stubbed responses
# shaped like the deployed function's.
if [ -f tools/test_subscription_client.js ]; then
  if OUT=$(node tools/test_subscription_client.js 2>&1); then
    ok "tools/test_subscription_client.js (all assertions passed)"
  else
    bad "tools/test_subscription_client.js failed — api.js no longer matches the deployed money-flow contract"
    printf '%s\n' "$OUT" | head -8 | sed 's/^/      /'
  fi
else
  warn "tools/test_subscription_client.js not found"
fi

# The assessment page is the front door to a quote: it decides which package a
# cooperative is told they need. It used to invent its own complexity bands and
# floor everything at 2,000 members, so it disagreed with recommendPlan() at 34
# and sold a 1,999-member AGM on a 500-member package. Its harness then ran with
# no rate card installed, so RATE_CARD was null, every price assertion compared
# against null, and the file was not wired into this suite at all — three green
# statements about a path nobody had tested.
if [ -f tools/test_assessment_scoring.js ]; then
  if OUT=$(node tools/test_assessment_scoring.js 2>&1); then
    ok "tools/test_assessment_scoring.js (score bands, caps, annual plans)"
  else
    bad "tools/test_assessment_scoring.js failed — the assessment page no longer recommends what the server will price"
    printf '%s\n' "$OUT" | head -8 | sed 's/^/      /'
  fi
else
  warn "tools/test_assessment_scoring.js not found"
fi

# ----------------------------------------------------------------
head_ "10. PocketBase JSVM API compatibility"
# ----------------------------------------------------------------
if ls archive/pocketbase-v1/pb_hooks/*.js >/dev/null 2>&1; then
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
for path in sorted(glob.glob("archive/pocketbase-v1/pb_hooks/*.js")):
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

n = len(glob.glob("archive/pocketbase-v1/pb_hooks/*.js"))
print(f"  \033[32m✓\033[0m {n} hook file(s) use no PocketBase 0.22-only APIs")
PY
    then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
fi

# ----------------------------------------------------------------
head_ "11. Client/server endpoint consistency"
# ----------------------------------------------------------------
# Every AGMX route the browser can call must exist on a server. Two backends
# serve the same money flow and the client picks one at runtime: api.js's
# PocketBase adapter prefixes "/api/agmx" onto the path and reaches the JSVM
# routerAdd() hooks, its Supabase adapter prefixes "/functions/v1/money-flow"
# and reaches the Edge Function. Checking either adapter's call sites against
# the other's route table only invents failures, so each _req() is attributed
# to the adapter that contains it and validated against that adapter's routes.
#
# Other /api/... paths are PocketBase's native collections API and always exist.
if ls archive/pocketbase-v1/pb_hooks/*.js >/dev/null 2>&1; then
  if python3 - <<'PY'
import glob, os, re, sys

PB, SB = "pocketbase", "supabase"
FN = "supabase/functions/money-flow/index.ts"

pb_routes = set()
for path in sorted(glob.glob("archive/pocketbase-v1/pb_hooks/*.js")):
    for method, route in re.findall(r'routerAdd\(\s*"(\w+)"\s*,\s*"([^"]+)"', open(path).read()):
        pb_routes.add(route)

# The Edge Function routes with `path === "/x"` and, for the record lookups,
# `path.startsWith("/x/")`. Both forms have to be honoured or a call site that
# concatenates an id onto a prefix looks like a missing route.
sb_exact, sb_prefix = set(), set()
if os.path.exists(FN):
    fn_src = open(FN).read()
    sb_exact = set(re.findall(r'path === "(/[^"]*)"', fn_src))
    # The router also normalises its own prefix with path.startsWith("/"), and
    # that is not a route — only the "/x/" record lookups are.
    sb_prefix = {p for p in re.findall(r'path\.startsWith\("(/[^"]*)"', fn_src)
                 if len(p) > 1 and p.endswith("/")}

def served_pb(p):
    # routerAdd() matches exactly, so a path that merely starts with a
    # registered route is a bug, not a hit.
    return p in pb_routes

def served_sb(p):
    return p in sb_exact or any(p.startswith(pre) for pre in sb_prefix)

# The two adapters are object literals in one file, so a call site belongs to
# the _req() definition above it. Each definition names the prefix it builds.
api = open("api.js").read() if os.path.exists("api.js") else ""
starts = [m.start() for m in re.finditer(r'async _req\(', api)]
adapters = []
for i, start in enumerate(starts):
    body = api[start: starts[i + 1] if i + 1 < len(starts) else start + 1500]
    if "/functions/v1/money-flow" in body:
        adapters.append((start, SB))
    elif "/api/agmx" in body:
        adapters.append((start, PB))

def backend_for(offset):
    chosen = None
    for start, name in adapters:
        if start <= offset:
            chosen = name
    return chosen

missing, checked = [], 0
for m in re.finditer(r'_req\(\s*"(\w+)"\s*,\s*"([^"]+)"', api):
    rel = m.group(2)
    backend = backend_for(m.start())
    if backend is None:
        continue
    checked += 1
    if backend == SB:
        if not served_sb(rel):
            missing.append((FN, rel))
    elif not served_pb("/api/agmx" + rel):
        missing.append(("archive/pocketbase-v1/pb_hooks/", "/api/agmx" + rel))

# An absolute /api/agmx/... literal is a PocketBase call by shape.
for path in sorted(glob.glob("*.js")):
    src = open(path).read()
    # strip comments so doc notes do not count as calls
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", " ", src)
    for lit in re.findall(r'"(/api/agmx/[^"]+)"', src):
        checked += 1
        if not served_pb(lit):
            missing.append((path, lit))

if missing:
    for where, p in sorted(set(missing)):
        print(f"  \033[31m✗\033[0m {p} is called but {where} serves no such route")
    sys.exit(1)

print(f"  \033[32m✓\033[0m {checked} client call(s) resolve against "
      f"{len(pb_routes)} PocketBase and {len(sb_exact) + len(sb_prefix)} Edge Function route(s)")
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
if ls archive/pocketbase-v1/pb_hooks/*.js >/dev/null 2>&1; then
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
for path in sorted(glob.glob("archive/pocketbase-v1/pb_hooks/*.js")):
    src = open(path).read()
    for mod, fn in re.findall(
        r'require\([^)]*?["\']([^"\']+\.js)["\']\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(', src
    ):
        target = "archive/pocketbase-v1/pb_hooks/" + mod.rsplit("/", 1)[-1]
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
if [ -d archive/pocketbase-v1/pb_hooks ]; then
printf '\n\033[1m%s\033[0m\n' "──── pass 13: webhook signing keys ────"
python3 - <<'PY' && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
import re, pathlib, sys

hooks = sorted(pathlib.Path("archive/pocketbase-v1/pb_hooks").glob("*.js"))
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
head_ "14. Runtime config flags are opt-IN"

# Both config emitters used `flag = (v) => v !== 'false'`, so an unset variable
# meant ON and every deployment that never set the flags served demoMode:true.
# api.js:1578 binds the Supabase adapter only on demoMode:false, so production
# silently fell back to the localStorage adapter and printed paid receipts for
# payments that existed only in the visitor's browser. Flags are now opt-IN, so
# the default must be OFF in every emitter. Scanned over both files: fixing one
# and leaving the Cloudflare port fail-open would just move the bug.
CFG_EMITTERS="api/config.js functions/config.js.js"
for f in $CFG_EMITTERS; do
  if [ ! -f "$f" ]; then
    warn "$f not found"
    continue
  fi
  if grep -vE '^[[:space:]]*(//|\*|/\*)' "$f" | grep -qE "!== *['\"]false['\"]"; then
    bad "$f opts a flag OUT again (!== 'false' means unset is ON); flags must be opt-IN"
  elif grep -vE '^[[:space:]]*(//|\*|/\*)' "$f" | grep -qE "=== *['\"]true['\"] *\|\| *true"; then
    bad "$f has an always-true flag expression — that flag is a constant env cannot turn off"
  else
    ok "$f feature flags are opt-IN (unset is off)"
  fi
done

CFG_HARNESS=$(mktemp /tmp/agmx-cfg-XXXXXX.mjs)
cat > "$CFG_HARNESS" <<'JS'
import { pathToFileURL } from "node:url";
const mk = () => { const r = { b: null, setHeader() {}, status() { return r; }, end(x) { r.b = x; return r; }, send() { throw new Error("api/config.js replied with res.send(): Vercel's Express-like polyfill overwrites Content-Type with text/html, and a <script> served as text/html is blocked by X-Content-Type-Options: nosniff. Reply with res.end() so the application/javascript header survives."); } }; return r; };
const parse = (js) => JSON.parse(js.replace(/^\s*window\.AGMX_CONFIG\s*=\s*/, "").replace(/;\s*$/, ""));
const KEYS = [
  "NEXT_PUBLIC_DEMO_MODE", "NEXT_PUBLIC_KNOWLEDGE_RAG", "NEXT_PUBLIC_REALTIME",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_PAYMENTS_MODE", "BILLPLZ_API_KEY", "BILLPLZ_COLLECTION_ID", "HITPAY_API_KEY",
  "LLM_PROVIDER", "NEXT_PUBLIC_LLM_PROVIDER", "OPENAI_API_KEY", "NVIDIA_NIM_API_KEY", "NGC_API_KEY",
];
const reset = () => { for (const k of KEYS) delete process.env[k]; };
const mod = await import(pathToFileURL(process.cwd() + "/api/config.js").href);
const read = async () => {
  const r = mk();
  await mod.default({ method: "GET" }, r);
  return parse(r.b);
};
const fail = (msg) => { console.error(msg); process.exit(1); };

// 1. A deployment that sets nothing must not look like a demo, must not claim
//    a Supabase backend it was never given, and must not offer a gateway it
//    cannot call.
reset();
let cfg = await read();
if (cfg.demoMode !== false) fail(`demoMode was ${cfg.demoMode} with NEXT_PUBLIC_DEMO_MODE unset — an unset flag must be OFF`);
if (cfg.knowledgeRagEnabled !== false) fail(`knowledgeRagEnabled was ${cfg.knowledgeRagEnabled} while unset`);
if (cfg.realtimeEnabled !== false) fail(`realtimeEnabled was ${cfg.realtimeEnabled} while unset`);
if (cfg.mode !== "local") fail(`mode was ${cfg.mode} with no Supabase URL — the browser would bind an adapter it cannot reach`);
if (cfg.paymentsMode !== "bank_transfer") fail(`paymentsMode was ${cfg.paymentsMode} with no gateway keys — checkout would offer a bill no server can create`);

// 2. Explicit false still means false (the original bug honoured nothing).
process.env.NEXT_PUBLIC_DEMO_MODE = "false";
cfg = await read();
if (cfg.demoMode !== false) fail(`demoMode stayed ${cfg.demoMode} with NEXT_PUBLIC_DEMO_MODE=false`);

// 3. Supabase URL + demo off must name the backend, not rely on a fallback.
reset();
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
cfg = await read();
if (cfg.mode !== "supabase") fail(`mode was ${cfg.mode} with a Supabase URL and demo off — api.js will not bind the Supabase adapter`);
if (cfg.supabaseAnonKey !== "sb_publishable_test") fail("the publishable key did not reach the client config");

// 4. Demo mode wins over a configured backend: NEXT_PUBLIC_DEMO_MODE=true is a
//    statement that nothing must be written to the real database.
process.env.NEXT_PUBLIC_DEMO_MODE = "true";
cfg = await read();
if (cfg.demoMode !== true || cfg.mode !== "local") fail(`demoMode=true still produced mode ${cfg.mode}`);

// 5. Gateway keys turn the gateway on; an operator may still narrow, never widen.
reset();
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.BILLPLZ_API_KEY = "k";
process.env.BILLPLZ_COLLECTION_ID = "c";
cfg = await read();
if (cfg.paymentsMode !== "all") fail(`paymentsMode was ${cfg.paymentsMode} with Billplz keys present`);
process.env.NEXT_PUBLIC_PAYMENTS_MODE = "bank_transfer";
cfg = await read();
if (cfg.paymentsMode !== "bank_transfer") fail(`an explicit NEXT_PUBLIC_PAYMENTS_MODE=bank_transfer was overridden by ${cfg.paymentsMode}`);
reset();
process.env.NEXT_PUBLIC_PAYMENTS_MODE = "all";
cfg = await read();
if (cfg.paymentsMode === "all") fail("NEXT_PUBLIC_PAYMENTS_MODE=all was honoured with no gateway keys");

// 6. The Cloudflare port must agree with the Vercel one; it serves the same
//    window.AGMX_CONFIG to the same api.js.
reset();
const cf = await import(pathToFileURL(process.cwd() + "/functions/config.js.js").href);
const cfRes = await cf.onRequest({ request: { method: "GET" }, env: {} });
const cfCfg = parse(await cfRes.text());
if (cfCfg.demoMode !== false) fail(`functions/config.js.js served demoMode:${cfCfg.demoMode} with no env — the two emitters disagree`);
if (cfCfg.mode !== "local") fail(`functions/config.js.js served mode:${cfCfg.mode} with no env`);
if (cfCfg.paymentsMode !== "bank_transfer") fail(`functions/config.js.js served paymentsMode:${cfCfg.paymentsMode} with no gateway keys`);
const cfCfg2 = parse(await (await cf.onRequest({
  request: { method: "GET" },
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" },
})).text());
if (cfCfg2.mode !== "supabase") fail(`functions/config.js.js served mode:${cfCfg2.mode} with a Supabase URL`);

// 7. Retrieval is a capability, not a switch. NEXT_PUBLIC_KNOWLEDGE_RAG=true used
//    to be copied straight into knowledgeRagEnabled, which is how production came to
//    advertise a knowledge room while its two Edge Functions threw at module scope
//    and answered HTTP 500 to every request. The flag may now only narrow: without a
//    key for the provider llm.ts will actually use, the config must say false.
reset();
process.env.NEXT_PUBLIC_KNOWLEDGE_RAG = "true";
cfg = await read();
if (cfg.knowledgeRagEnabled !== false) fail(`knowledgeRagEnabled was ${cfg.knowledgeRagEnabled} with NEXT_PUBLIC_KNOWLEDGE_RAG=true and no provider key — the flag widened a capability`);
process.env.OPENAI_API_KEY = "k";
cfg = await read();
if (cfg.knowledgeRagEnabled !== true) fail(`knowledgeRagEnabled was ${cfg.knowledgeRagEnabled} with the opt-in and an OPENAI_API_KEY present`);
delete process.env.OPENAI_API_KEY;
// The nvidia branch reads NVIDIA_NIM_API_KEY/NGC_API_KEY, never NVIDIA_API_KEY, so
// selecting nvidia must not find the openai key.
process.env.LLM_PROVIDER = "nvidia";
process.env.OPENAI_API_KEY = "k";
cfg = await read();
if (cfg.knowledgeRagEnabled !== false) fail(`knowledgeRagEnabled was ${cfg.knowledgeRagEnabled} with LLM_PROVIDER=nvidia and only an OPENAI_API_KEY — health would call it configured for a provider it cannot use`);
if (cfg.llmProvider !== "nvidia") fail(`llmProvider was ${cfg.llmProvider} while LLM_PROVIDER=nvidia — /api/config and llm.ts would disagree`);
process.env.NVIDIA_NIM_API_KEY = "n";
cfg = await read();
if (cfg.knowledgeRagEnabled !== true) fail(`knowledgeRagEnabled was ${cfg.knowledgeRagEnabled} with LLM_PROVIDER=nvidia and NVIDIA_NIM_API_KEY present`);
reset();
const cfRag = (e) => cf.onRequest({ request: { method: "GET" }, env: { NEXT_PUBLIC_KNOWLEDGE_RAG: "true", ...e } });
const cfCfg3 = parse(await (await cfRag({})).text());
if (cfCfg3.knowledgeRagEnabled !== false) fail(`functions/config.js.js served knowledgeRagEnabled:${cfCfg3.knowledgeRagEnabled} with no provider key — the two emitters disagree`);
const cfCfg4 = parse(await (await cfRag({ OPENAI_API_KEY: "k" })).text());
if (cfCfg4.knowledgeRagEnabled !== true) fail(`functions/config.js.js served knowledgeRagEnabled:${cfCfg4.knowledgeRagEnabled} with a provider key present`);

// 8. The two health ports must test the same provider names as the two config
//    emitters: health answering configured:false about NVIDIA_API_KEY is what let
//    the contradiction survive its own checks. No Supabase URL here on purpose —
//    databaseStatus() short-circuits without one, so this stays an offline pass.
reset();
process.env.OPENAI_API_KEY = "k";
const vercelHealth = await import(pathToFileURL(process.cwd() + "/api/health.js").href);
const hv = mk();
await vercelHealth.default({ method: "GET" }, hv);
const hvcfg = JSON.parse(hv.b);
if (hvcfg.checks?.knowledge?.configured !== true) fail(`api/health.js reported knowledge.configured ${hvcfg.checks?.knowledge?.configured} with OPENAI_API_KEY present — it tests a different variable name than /api/config`);
if (hvcfg.checks?.knowledge?.provider !== "supabase-pgvector+openai") fail(`api/health.js named provider ${hvcfg.checks?.knowledge?.provider} with no LLM_PROVIDER set, but llm.ts defaults to openai`);
const cfHealth = await import(pathToFileURL(process.cwd() + "/functions/api/health.js").href);
const hc = await cfHealth.onRequest({ request: { method: "GET" }, env: { OPENAI_API_KEY: "k" } });
const hccfg = JSON.parse(await hc.text());
if (hccfg.checks?.knowledge?.configured !== true) fail(`functions/api/health.js reported knowledge.configured ${hccfg.checks?.knowledge?.configured} with OPENAI_API_KEY present — the two health ports disagree`);
JS
CFG_ERR=$(node "$CFG_HARNESS" 2>&1); CFG_RC=$?
rm -f "$CFG_HARNESS"
if [ "$CFG_RC" = 0 ]; then
  ok "both config emitters default to OFF and name their backend explicitly"
else
  case "$CFG_ERR" in
    *ERR_MODULE_NOT_FOUND*|*SyntaxError*|*Cannot\ use\ import*)
      # Node too old to load an ESM file with no package.json beside it. Warn,
      # never tick green: a pass that executed nothing proves nothing.
      warn "flag behaviour not executed on $(node --version) (ESM load failed) — static check only: ${CFG_ERR%%$'\n'*}"
      ;;
    *)
      bad "config flag behaviour check failed: ${CFG_ERR%%$'\n'*}"
      ;;
  esac
fi

# The health ports had a second failure the harness above could not see: they
# demanded every alias of a provider key while llm.ts takes the first one that is
# set, so a deployment holding NVIDIA_NIM_API_KEY was reported unconfigured
# while /api/config on the same host advertised the room. This file drives the
# real handler and both ports.
if [ -f tools/test_health.js ]; then
  if OUT=$(node tools/test_health.js 2>&1); then
    ok "tools/test_health.js (both health ports name the variables the code reads)"
  else
    bad "tools/test_health.js failed — ${OUT%%$'\n'*}"
  fi
else
  warn "tools/test_health.js not found"
fi

# ----------------------------------------------------------------
head_ "15. Supabase RPC calls match a declared SQL signature"

# supabase.rpc("name") is a runtime lookup — nothing in TypeScript or the
# browser binds the name to the schema, so a typo, an RPC that was never
# written, or an argument name Postgres does not recognise fails only when a
# live request hits it. Every call site is compared against the create-function
# statements in supabase/*.sql, parameters included: PostgREST calls by named
# argument, so an unknown or missing key raises the same PGRST202 as a missing
# function.
RPC_OUT=$(mktemp /tmp/agmx-rpc-XXXXXX.txt)
python3 - "$RPC_OUT" <<'PY'
import pathlib, re, sys

out = open(sys.argv[1], "w")
# python classifies; bash renders the glyph and tallies PASS/FAIL/WARN. ANSI
# codes must not be baked into these lines — any later grep for the mark would
# match nothing and the failures would print without ever being counted.
def emit(kind, text):
    out.write(f"{kind}\t{text}\n")

defs = {}
sigs = {}

def split_top(s):
    """Split a parameter/argument list on commas outside nested brackets."""
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts

def matching(text, start, openers, closers):
    depth, i = 1, start
    while i < len(text):
        if text[i] in openers:
            depth += 1
        elif text[i] in closers:
            depth -= 1
            if depth == 0:
                return text[start:i], i + 1
        i += 1
    return None, None

# Archive/ is parsed too: a call that only matches a superseded file must be
# reported as such, not silently treated as undefined.
for p in sorted(pathlib.Path("supabase").rglob("*.sql")):
    text = p.read_text()
    for m in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([A-Za-z0-9_]+)"?\s*\(',
                         text, re.I):
        name = m.group(1)
        defs.setdefault(name, set()).add(str(p))
        raw, _ = matching(text, m.end(), "([{", ")]}")
        if raw is None:
            sigs.setdefault(name, []).append((str(p), None))   # unparseable signature
            continue
        args = []
        for part in split_top(raw):
            part = part.strip()
            if not part:
                continue
            pm = re.match(r'(?:in|out|inout|variadic)?\s*([A-Za-z_][A-Za-z0-9_]*)\b(.*)$',
                          part, re.I | re.S)
            if not pm:
                continue
            args.append((pm.group(1), bool(re.search(r'\bdefault\b', pm.group(2), re.I))))
        sigs.setdefault(name, []).append((str(p), args))

# The one file deploy.sh, DEPLOY.md and VERCEL_ENV.md tell operators to paste.
# It is generated from supabase/migrations/*.sql, so an RPC that migrations
# define and this bundle lacks means the bundle was never regenerated.
# The superseded archive/ files stay on disk and are still parsed, but matching
# one of them is not a pass.
DEPLOY_PAIR = {"supabase/schema_final.sql"}

sites = [pathlib.Path("supabase-client.js")]
sites += [p for p in pathlib.Path("supabase/functions").rglob("*.ts")]

called = {}
for p in sites:
    if not p.exists():
        continue
    text = p.read_text()
    for m in re.finditer(r'\.rpc\(\s*[\'"]([A-Za-z0-9_]+)[\'"]', text):
        tail = text[m.end():]
        brace = tail.find("{")
        keys = None
        if brace != -1:
            raw, _ = matching(tail, brace + 1, "([{", ")]}")
            if raw is not None:
                keys = []
                for part in split_top(raw):
                    km = re.match(r'\s*[\'"]?([A-Za-z_][A-Za-z0-9_]*)[\'"]?\s*:', part)
                    if km:
                        keys.append(km.group(1))
                keys = keys or []
        called.setdefault(m.group(1), []).append(
            (f"{p}:{text[:m.start()].count(chr(10)) + 1}", keys))

problems, warnings, checked = [], [], 0
for name, hits in sorted(called.items()):
    checked += 1
    places = ", ".join(sorted({h[0] for h in hits}))
    if name not in defs:
        problems.append(
            f'rpc "{name}" is called by {places} but no supabase/*.sql defines it '
            f"— every call returns PGRST202 and the handler's fail-closed path runs")
        continue
    files = set(defs[name])
    if not (files & DEPLOY_PAIR):
        warnings.append(
            f'rpc "{name}" is defined only in {", ".join(sorted(defs[name]))}, not in '
            f"supabase/schema_final.sql — regenerate the bundle: python3 tools/build_schema_bundle.py")

    # PostgREST calls by named argument, so a key that is not a parameter — or
    # a required parameter left out — fails with the same opaque PGRST202 as a
    # missing function. The duplicate p_txn_id key this pass first found is
    # exactly this class of drift.
    for path, keys in hits:
        if keys is None:
            continue
        accepted, rejected, unknown = [], [], []
        for fname, sig in sigs[name]:
            if sig is None:
                unknown.append(fname)
                continue
            param = dict(sig)
            bad_keys = [k for k in keys if k not in param]
            missing = [k for k, has_default in sig
                       if not has_default and k not in keys]
            if bad_keys or missing:
                bits = []
                if bad_keys:
                    bits.append("passes " + ", ".join(sorted(bad_keys)))
                if missing:
                    bits.append("omits required " + ", ".join(sorted(missing)))
                rejected.append((fname, "; ".join(bits)))
            else:
                accepted.append(fname)
        detail = " vs ".join(f"{f} ({b})" for f, b in rejected)
        deploy_rejected = [f for f, _ in rejected if f in DEPLOY_PAIR]
        if unknown and not accepted and not rejected:
            warnings.append(f'rpc "{name}" at {path} — signature could not be parsed, not verified')
        elif rejected and not accepted:
            problems.append(
                f'rpc "{name}" at {path} is called with arguments no variant accepts: '
                f'{detail} — PGRST202 whichever file is applied')
        elif deploy_rejected and accepted:
            warnings.append(
                f'rpc "{name}" at {path} is rejected by the documented schema — {detail} — '
                f"and would only work if an older file were applied; on the deploy path "
                f"deploy.sh and DEPLOY.md describe it fails with PGRST202")
        elif rejected and accepted:
            warnings.append(
                f'rpc "{name}" at {path} matches {", ".join(accepted)} and the documented '
                f"bundle, but {detail} would reject it — harmless unless a superseded "
                f"file is applied")

for w in warnings:
    emit("WARN", w)
for p in problems:
    emit("BAD", p)
if problems:
    rc = 1
elif not checked:
    emit("WARN", "no supabase.rpc() call sites found — nothing was matched")
    rc = 2
else:
    emit("OK", f"{checked} supabase.rpc() call(s) compared — each resolves to a "
                f"declared signature in at least one schema variant")
    rc = 0
out.close()
sys.exit(rc)
PY
RPC_RC=$?
while IFS=$'\t' read -r kind text; do
  [ -n "${kind:-}" ] || continue
  case "$kind" in
    BAD)  bad "$text";;
    WARN) warn "$text";;
    OK)   ok "$text";;
    *)    bad "pass 15 emitted an unrecognised result line: $kind";;
  esac
done < "$RPC_OUT"
rm -f "$RPC_OUT"
if [ "$RPC_RC" -gt 2 ]; then
  bad "pass 15 could not complete (python exit $RPC_RC) — RPC names were not verified"
fi

# ----------------------------------------------------------------
head_ "16. Edge Functions type-check"

# The three functions under supabase/functions/ are Deno TypeScript and were
# never compiled by anything in this repo — duplicated declarations in
# money-flow/index.ts (auditLog, checkRateLimit, a second p_txn_id key) sat
# unnoticed. Third-party .d.ts noise (std@0.168 on Deno 2, esm.sh auth-js)
# is excluded: this pass asserts only that our own files are clean, so it
# does not require a runtime we do not control.
if ! command -v deno >/dev/null 2>&1; then
  warn "deno not installed — Edge Functions were not type-checked"
else
  DENO_OUT=$(mktemp /tmp/agmx-deno-XXXXXX.txt)
  # NO_COLOR is not cosmetic: deno colourises even when redirected, so the
  # "at file://" location line becomes "at \e[36mfile://…" and grepping for a
  # local error finds nothing — a pass that reports failure as a warning.
  if ! NO_COLOR=1 timeout 180 deno check --remote \
        supabase/functions/money-flow/index.ts \
        supabase/functions/knowledge-query/index.ts \
        supabase/functions/knowledge-ingest/index.ts >"$DENO_OUT" 2>&1; then
    LOCAL_ERRS=$(grep -c '^[[:space:]]*at file://' "$DENO_OUT" || true)
    if [ "$LOCAL_ERRS" -gt 0 ]; then
      bad "$LOCAL_ERRS type error(s) in our own Edge Function files:"
      grep -B3 '^[[:space:]]*at file://' "$DENO_OUT" | head -30 | sed 's/^/      /'
    elif grep -qiE 'error: (uncaught|relative import|module not found|fetch|network)|a network error|timed out' "$DENO_OUT"; then
      warn "Edge Functions not type-checked — remote modules could not be resolved: $(grep -iE '^error:' "$DENO_OUT" | head -1)"
    else
      warn "Edge Functions type-check unresolved on deno $(deno --version | awk 'NR==1{print $2}') — all reported errors are in remote modules (std@0.168 / esm.sh), not repo code"
    fi
  else
    ok "deno check clean: supabase/functions/**/*.ts"
  fi
  rm -f "$DENO_OUT"
fi

# ----------------------------------------------------------------
head_ "17. Insert payloads match the deployed table columns"

# .from("t").insert({...}) is another runtime lookup: PostgREST resolves the
# table and every key in the payload against the schema cache, so one stale
# key rejects the whole row with a 400. TypeScript cannot see it, and the RPC
# pass above only covers .rpc(). Selects are deliberately out of scope —
# embedded joins ("plans(id)") would make every select a false positive.
# Scope is the generated supabase/schema_final.sql bundle deploy.sh applies;
# a table defined only in archive/ is not a pass here.
SER_OUT=$(mktemp /tmp/agmx-series-XXXXXX.txt)
python3 - "$SER_OUT" <<'PY'
import pathlib, re, sys

out = open(sys.argv[1], "w")
def emit(kind, text):
    out.write(f"{kind}\t{text}\n")

def split_top(s):
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts

def matching(text, start, openers, closers):
    depth, i = 1, start
    while i < len(text):
        if text[i] in openers:
            depth += 1
        elif text[i] in closers:
            depth -= 1
            if depth == 0:
                return text[start:i], i + 1
        i += 1
    return None, None

DEPLOY_PAIR = ["supabase/schema_final.sql"]
tables = {}
for f in DEPLOY_PAIR:
    path = pathlib.Path(f)
    if not path.exists():
        continue
    text = path.read_text()
    for m in re.finditer(
            r'create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?\s*\(',
            text, re.I):
        raw, _ = matching(text, m.end(), "(", ")")
        if raw is None:
            continue
        cols = set()
        for part in split_top(raw):
            part = part.strip()
            if not part:
                continue
            # table-level constraints are not columns
            if re.match(r'(constraint|primary|unique|check|foreign|exclude|like)\b', part, re.I):
                continue
            cm = re.match(r'"?([A-Za-z_][A-Za-z0-9_]*)"?\s+', part)
            if cm:
                cols.add(cm.group(1).lower())
        tables[m.group(1).lower()] = (f, cols)

sites = [pathlib.Path("supabase-client.js")]
sites += [p for p in pathlib.Path("supabase/functions").rglob("*.ts")]

problems, warnings, checked = [], [], 0
for p in sites:
    if not p.exists():
        continue
    text = p.read_text()
    for m in re.finditer(r'\.from\(\s*[\'"]([A-Za-z0-9_]+)[\'"]\s*\)', text):
        tail = text[m.end():]
        # only a direct insert/upsert on this from(); anything else is a
        # different chain and its braces belong to another call
        chained = re.match(r'\s*\.(insert|upsert)\s*\(', tail)
        if not chained:
            continue
        start = chained.end()
        while start < len(tail) and tail[start] in " \t\r\n":
            start += 1
        if start >= len(tail) or tail[start] != "{":
            brace = tail.find("{", start)
            if brace == -1 or ")" in tail[start:brace]:
                continue
            start = brace
        raw, _ = matching(tail, start + 1, "([{", ")]}")
        if raw is None:
            continue
        keys = []
        for part in split_top(raw):
            km = re.match(r'\s*[\'"]?([A-Za-z_][A-Za-z0-9_]*)[\'"]?\s*:', part)
            if km:
                keys.append(km.group(1).lower())
        where = f"{p}:{text[:m.start()].count(chr(10)) + 1}"
        table = m.group(1).lower()
        checked += 1
        if table not in tables:
            warnings.append(
                f'{chained.group(1)} into "{table}" at {where}, which '
                f"supabase/schema_final.sql does not create — fails with PGRST205 "
                f"unless that table exists outside the bundle")
            continue
        path_used, cols = tables[table]
        bad = [k for k in keys if k not in cols]
        if bad:
            problems.append(
                f'{chained.group(1)} into "{table}" at {where} passes '
                f'{", ".join(bad)}, not declared in {path_used} — PostgREST '
                f"rejects the whole statement (42703), so the handler's error "
                f"branch runs instead")

for w in warnings:
    emit("WARN", w)
for p in problems:
    emit("BAD", p)
if problems:
    rc = 1
elif not checked:
    emit("WARN", "no .from().insert()/.upsert() call sites found — nothing was matched")
    rc = 2
else:
    emit("OK", f"{checked} insert/upsert call(s) compared against "
                f"{len(tables)} table definition(s) in the generated bundle")
    rc = 0
out.close()
sys.exit(rc)
PY
SER_RC=$?
while IFS=$'\t' read -r kind text; do
  [ -n "${kind:-}" ] || continue
  case "$kind" in
    BAD)  bad "$text";;
    WARN) warn "$text";;
    OK)   ok "$text";;
    *)    bad "pass 17 emitted an unrecognised result line: $kind";;
  esac
done < "$SER_OUT"
rm -f "$SER_OUT"
if [ "$SER_RC" -gt 2 ]; then
  bad "pass 17 could not complete (python exit $SER_RC) — insert payloads were not verified"
fi

# ----------------------------------------------------------------
head_ "18. Commit author identity"
# ----------------------------------------------------------------
# Vercel attributes a deploy made from a git checkout to the latest commit's author
# and Blocks the deployment when that email is not a member of the team. The block
# names neither the email nor the reason, and one bad commit is enough to fail every
# deploy after it, so check the two places the address can go wrong.
placeholder_email() {
  case "$1" in
    ""|*@example.com|*@example.org|*@localhost|*@local) return 0 ;;
    *) return 1 ;;
  esac
}

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  author_email=$(git log -1 --format='%ae')
  if placeholder_email "$author_email"; then
    bad "HEAD author email is a placeholder: ${author_email:-<empty>} — re-author the commit before deploying"
  else
    ok "HEAD author: $author_email"
  fi
fi

# The runner's own git identity is not the one that ships, so in CI only the
# commit already in the checkout is worth judging.
if [ -z "${GITHUB_ACTIONS:-}" ]; then
  cfg_email=$(git config user.email || true)
  if placeholder_email "$cfg_email"; then
    bad "git config user.email is a placeholder: ${cfg_email:-<unset>} — the next commit inherits it"
  else
    ok "git config user.email: $cfg_email"
  fi
fi

# ----------------------------------------------------------------
head_ "19. One canonical host"
# ----------------------------------------------------------------
# Pass 5 proves a referenced host is alive, which cannot notice this: a retired
# deployment stays alive and the page points at it. Compare every absolute host in
# the landing page against the single host the sitemap declares, and require the
# canonical link the share-preview tags were missing.
# The canonical host is whatever sitemap.xml publishes, on any TLD — a custom
# domain has no `.vercel.app` suffix, so matching that suffix would have found
# no host at all and warned "nothing to compare against" instead of comparing.
# The stray sweep below still matches `*.vercel.app`: those are the retired
# deployment aliases this pass exists to catch, and they stay that shape when
# the canonical host moves to a custom domain.
SITEMAP_HOSTS=$(grep -oE '<loc>[^<]+</loc>' sitemap.xml 2>/dev/null \
                | sed -E 's|.*<loc>https?://([^/]+).*|\1|' | sort -u)
CANON_COUNT=$(printf '%s\n' "$SITEMAP_HOSTS" | grep -c . || true)
if [ "$CANON_COUNT" = "0" ]; then
  warn "sitemap.xml declares no absolute host — nothing to compare against"
elif [ "$CANON_COUNT" -gt 1 ]; then
  bad "sitemap.xml declares $(printf '%s ' $SITEMAP_HOSTS) — one product needs one host"
else
  CANON_HOST="$SITEMAP_HOSTS"
  STRAY=$(grep -oE 'https://[a-z0-9.-]+\.vercel\.app' index.html 2>/dev/null | sed 's|^https://||' | sort -u | grep -vxF "$CANON_HOST" || true)
  if [ -n "$STRAY" ]; then
    bad "index.html references $(printf '%s ' $STRAY) but the canonical host is $CANON_HOST"
  else
    ok "index.html references only $CANON_HOST"
  fi
  canon=$(grep -c 'rel="canonical"' index.html 2>/dev/null || true)
  if [ "$canon" = "1" ] && grep -q "rel=\"canonical\"[^>]*https://$CANON_HOST" index.html; then
    ok "exactly one canonical link, set to $CANON_HOST"
  else
    bad "index.html needs one rel=canonical pointing at https://$CANON_HOST/ (found $canon)"
  fi

  # The landing page is not the only surface that can point at a retired
  # deployment, and the one that was missed is the worst place to miss it:
  # supabase/functions/money-flow/index.ts fell back to an APP_URL of
  # agmx-project.vercel.app, and the Supabase secret of that name held the same
  # value, so the checkout link in a quote, the paymentUrl on an invoice and the
  # gateway's post-payment redirect all led a paying customer to a v31 build
  # running in demo mode. Passes 19 and 23 stayed green because they read
  # index.html and the Vercel surface, and the Edge Function appears on neither.
  # So: sweep every tracked file. archive/ and any doc that opens with a
  # superseded banner are history and may name old hosts; a live file may name
  # exactly one. This comment is written without a scheme for that reason —
  # the rule has no exemptions, not even for the checker.
  STRAY_HOSTS=$(python3 - "$CANON_HOST" <<'PY'
import pathlib, re, subprocess, sys

canon = sys.argv[1]
pat = re.compile(rb"https://([a-z0-9][a-z0-9.-]*)\.vercel\.app")
files = subprocess.run(["git", "ls-files", "-z"], capture_output=True).stdout.split(b"\0")
for f in files:
    name = f.decode(errors="replace")
    if not name or name.startswith("archive/"):
        continue
    p = pathlib.Path(name)
    if not p.is_file():
        continue
    data = p.read_bytes()
    # A history banner, not the word anywhere: the first 12 lines only, so an
    # ops doc cannot exempt itself by using "superseded" in passing prose.
    head = b"\n".join(data.split(b"\n")[:12])
    if re.search(rb"superseded", head, re.I):
        continue
    hosts = set()
    for m in pat.finditer(data):
        # The pattern matches only `*.vercel.app`, so every hit is a deployment
        # alias. If the canonical host is a custom domain, none of them can be
        # it, and each one is a retired alias this pass exists to catch.
        full = m.group(1).decode() + ".vercel.app"
        if full != canon and not full.endswith("." + canon):
            hosts.add(full)
    if hosts:
        print(f"{name}\t{' '.join(sorted(hosts))}")
PY
) || true
  if [ -n "$STRAY_HOSTS" ]; then
    bad "live files name a vercel.app host that is not $CANON_HOST"
    printf '%s\n' "$STRAY_HOSTS" | sed 's/^/      /'
  else
    ok "no live file names a vercel.app host other than $CANON_HOST"
  fi
fi

# ----------------------------------------------------------------
head_ "20. Governance view harness"
# ----------------------------------------------------------------
# AGM Hall renders role-gated controls and posts payloads the governance Edge
# Function actually reads. This harness drives the real governance-ui.js against
# a DOM stub that throws on innerHTML, so a widened gate, a renamed payload key
# or a value rendered as markup fails the suite instead of an AGM.
if [ -f tools/test_governance_ui.js ]; then
  if OUT=$(node tools/test_governance_ui.js 2>&1); then
    ok "tools/test_governance_ui.js (all assertions passed)"
  else
    bad "tools/test_governance_ui.js failed — the governance views no longer match the function contract"
    printf '%s\n' "$OUT" | head -8 | sed 's/^/      /'
  fi
else
  warn "tools/test_governance_ui.js not found"
fi

# ----------------------------------------------------------------
head_ "21. SQL deploy bundle is generated, complete and rerun-safe"
# ----------------------------------------------------------------
# DEPLOY.md, deploy.sh and VERCEL_ENV.md all send an operator to one SQL file.
# When that file was hand-maintained it silently lost 15 of the 23 RPCs, so a
# fresh deploy had the AGM Hall UI with no functions behind it and every write
# answered PGRST202. It is now generated from supabase/migrations/, and this pass
# is the reason that stays true.
BUNDLE_OUT=$(mktemp /tmp/agmx-bundle-XXXXXX.txt)
python3 - "$BUNDLE_OUT" <<'PY'
import pathlib, re, subprocess, sys

out = open(sys.argv[1], "w")
def emit(kind, text):
    out.write(f"{kind}\t{text}\n")

GEN = pathlib.Path("tools/build_schema_bundle.py")
MIG = pathlib.Path("supabase/migrations")
BUNDLE = pathlib.Path("supabase/schema_final.sql")
DOCS = ["DEPLOY.md", "deploy.sh", "VERCEL_ENV.md", "README.md"]

if not (GEN.exists() and BUNDLE.is_file() and MIG.is_dir()):
    emit("BAD", "schema bundle generator, migrations/ or schema_final.sql is missing")
    out.close(); sys.exit(1)

# 1. The generator's own check: bundle bytes == migrations, and every
#    `create policy` carries a `drop policy if exists` guard.
r = subprocess.run([sys.executable, str(GEN), "--check"],
                   capture_output=True, text=True)
if r.returncode == 0:
    emit("OK", "schema_final.sql matches supabase/migrations/*.sql")
else:
    first = (r.stdout + r.stderr).strip().splitlines()
    emit("BAD", "schema_final.sql is stale or not rerun-safe — " +
                (first[0] if first else "generator gave no reason"))
    for line in first[1:6]:
        emit("BAD", "    " + line)

migs = sorted(MIG.glob("*.sql"))
FNAME = re.compile(r"create\s+or\s+replace\s+function\s+([A-Za-z0-9_.]+)\s*\(", re.I)
GUARD = re.compile(r"drop\s+policy\s+if\s+exists\s+([A-Za-z0-9_]+)\s+on\s+([A-Za-z0-9_.]+)", re.I)
CREATE = re.compile(r"create\s+policy\s+([A-Za-z0-9_]+)\s+on\s+([A-Za-z0-9_.]+)", re.I)

mig_text = "".join(p.read_text() for p in migs)
bundle_text = BUNDLE.read_text()

# 2. Function parity, asserted independently of the generator so a hand-edit of
#    the bundle is caught even if someone drops the --check call above.
fm = {n.lower().split(".")[-1] for n in FNAME.findall(mig_text)}
fb = {n.lower().split(".")[-1] for n in FNAME.findall(bundle_text)}
if fm - fb:
    emit("BAD", "schema_final.sql does not create: " + ", ".join(sorted(fm - fb)) +
                " — the deploy docs apply this file, so an RPC the app calls would "
                "return PGRST202 on a fresh deploy")
if fb - fm:
    emit("BAD", "schema_final.sql creates functions no migration defines: " +
                ", ".join(sorted(fb - fm)) + " — the bundle was hand-edited")
if not (fm - fb) and not (fb - fm):
    emit("OK", f"all {len(fm)} migration-defined functions are in the bundle")

# 3. Rerun safety, independently of the generator.
guarded = {(m.group(1), m.group(2)) for m in GUARD.finditer(bundle_text)}
bare = [f"{m.group(1)} on {m.group(2)}" for m in CREATE.finditer(bundle_text)
        if (m.group(1), m.group(2)) not in guarded]
if bare:
    emit("BAD", "unguarded create policy: " + ", ".join(bare) +
                " — a second paste aborts on 42710 and rolls back the grants "
                "that follow it")
else:
    emit("OK", f"{len(list(CREATE.finditer(bundle_text)))} policies, each preceded "
               f"by drop policy if exists — the rerun-safe claim holds")

# 4. Docs must point at the generated bundle. A mention of the retired file is
#    only allowed on a line that also says it is gone — history is worth naming,
#    an instruction to paste it is not.
RETIRED = ("deleted", "retired", "superseded", "used to", "no longer", "never")
offenders = []
for d in DOCS:
    for i, ln in enumerate(pathlib.Path(d).read_text().splitlines(), 1):
        if "knowledge_final" in ln and not any(w in ln.lower() for w in RETIRED):
            offenders.append(f"{d}:{i}: {ln.strip()[:70]}")
if offenders:
    emit("BAD", "the retired bundle is still presented as current in " +
                "; ".join(offenders[:3]) +
                " — supabase/knowledge_final.sql was deleted; 0002 ships inside "
                "schema_final.sql now, and pasting both re-runs the same objects")
else:
    emit("OK", "no doc presents the retired knowledge_final.sql as current")

# 5. Every function directory is deployed by the documented command.
fns = sorted(p.name for p in pathlib.Path("supabase/functions").iterdir()
             if p.is_dir() and not p.name.startswith("_"))
deploy_md = pathlib.Path("DEPLOY.md").read_text()
missing = [f for f in fns if f"functions deploy {f}" not in deploy_md]
if missing:
    emit("BAD", "DEPLOY.md never deploys: " + ", ".join(missing) +
                " — the UI calls them and the endpoint answers 404")
else:
    emit("OK", "DEPLOY.md deploys all " + str(len(fns)) + " functions: " +
                ", ".join(fns))

# 6. Secret names: every Deno.env.get("X") the functions read must be documented
#    by name. SUPABASE_ANON_KEY here would be wrong — knowledge-* read
#    SUPABASE_SECRET_KEY, and a doc that sets the other name leaves a function
#    that dies at boot on an undefined key.
reads = set()
for p in pathlib.Path("supabase/functions").rglob("*.ts"):
    reads |= set(re.findall(r'Deno\.env\.get\(\s*["\']([A-Z0-9_]+)["\']', p.read_text()))
undocumented = sorted(v for v in reads if not re.search(r"\b" + v + r"\b", deploy_md))
if undocumented:
    emit("BAD", "env vars read by supabase/functions but named nowhere in DEPLOY.md: "
                + ", ".join(undocumented))
else:
    emit("OK", f"all {len(reads)} Deno.env names the functions read appear in DEPLOY.md")

# 7. `supabase functions deploy` needs a config.toml; without it the documented
#    command cannot run from a fresh clone at all.
cfg = pathlib.Path("supabase/config.toml")
if not cfg.is_file():
    emit("BAD", "supabase/config.toml is missing — supabase db push and "
                "functions deploy both require it")
else:
    text = cfg.read_text()
    nogates = [f for f in fns if f"[functions.{f}]" not in text]
    if nogates:
        emit("BAD", "supabase/config.toml declares no [functions.x] block for: " +
                    ", ".join(nogates) + " — verify_jwt then comes from whatever "
                    "the last deploy flag happened to say")
    else:
        mf = re.search(r"\[functions\.money-flow\]\s*\nverify_jwt\s*=\s*false", text)
        if not mf:
            emit("BAD", "money-flow must have verify_jwt = false — a Billplz/HitPay "
                        "webhook carries no Supabase JWT, so verification on rejects "
                        "it before the signature check and the invoice stays UNPAID")
        else:
            emit("OK", "config.toml present; verify_jwt declared for every function, "
                       "money-flow false so gateway webhooks reach the handler")
out.close()
sys.exit(0)
PY
BUNDLE_RC=$?
while IFS=$'\t' read -r kind text; do
  [ -n "${kind:-}" ] || continue
  case "$kind" in
    BAD)  bad "$text";;
    WARN) warn "$text";;
    OK)   ok "$text";;
    *)    bad "pass 21 emitted an unrecognised result line: $kind";;
  esac
done < "$BUNDLE_OUT"
rm -f "$BUNDLE_OUT"
[ "$BUNDLE_RC" -le 1 ] || bad "pass 21 could not complete (python exit $BUNDLE_RC)"

# ----------------------------------------------------------------
head_ "22. Rate card, i18n keys and error states cannot drift apart"
# ----------------------------------------------------------------
# Every rule below is a bug this repo actually shipped: four price books
# disagreeing by up to 15x, MAP keys containing <code> that no text node could
# ever match, an inbox rendering "professional_agm · RM0" because api.js loaded
# without the rate card, and a roster read that failed and drew "0 hadir / 0".
GUARD_OUT=$(mktemp /tmp/agmx-guard-XXXXXX.txt)
python3 - "$GUARD_OUT" <<'PY'
import html, json, pathlib, re, sys

out = open(sys.argv[1], "w")
def emit(kind, text):
    out.write("%s\t%s\n" % (kind, text))

def unesc(s):
    try:
        return json.loads('"%s"' % s)
    except Exception:
        return s

def balanced(text, idx, opener, closer):
    depth, i = 0, idx
    while i < len(text):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                return text[idx:i + 1]
        i += 1
    return None

def split_top(s):
    parts, cur, depth, q = [], "", 0, None
    for ch in s:
        if q:
            cur += ch
            if ch == q:
                q = None
            continue
        if ch in "'\"":
            q = ch; cur += ch; continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip()); cur = ""
        else:
            cur += ch
    parts.append(cur.strip())
    return parts

def strip_comments(text):
    """Blank out comments so a price named in prose is not read as a literal.

    api.js documents the old bug ("an RM 2,999 plan that bills RM 9,600") in a
    comment; without this, the guard would report its own explanation as a
    violation.
    """
    text = re.sub(r"<!--.*?-->", lambda m: " " * len(m.group(0)), text, flags=re.S)
    res, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and text[i + 1:i + 2] == "*":
            j = text.find("*/", i + 2); j = n if j == -1 else j + 2
            res.append(" " * (j - i)); i = j
        elif c == "/" and text[i + 1:i + 2] == "/":
            j = text.find("\n", i); j = n if j == -1 else j
            res.append(" " * (j - i)); i = j
        elif c in "\"'`":
            q = c; res.append(c); i += 1
            while i < n:
                if text[i] == "\\":
                    res.append(text[i:i + 2]); i += 2; continue
                if text[i] == q:
                    res.append(q); i += 1; break
                if text[i] == "\n" and q != "`":
                    break
                res.append(text[i]); i += 1
        else:
            res.append(c); i += 1
    return "".join(res)

# --- 1. price-list.js must mirror the seeded plans table -------------------
SEEDS = ["supabase/migrations/0003_plans_seed.sql",
         "supabase/migrations/0006_subscriptions_billing.sql"]
seeded = {}
for name in SEEDS:
    p = pathlib.Path(name)
    if not p.is_file():
        continue
    t = p.read_text()
    m = re.search(r"insert\s+into\s+public\.plans\s*\(([^)]*)\)\s*values", t, re.I | re.S)
    if not m:
        continue
    cols = [c.strip() for c in m.group(1).split(",")]
    stop = re.search(r"on\s+conflict", t[m.end():], re.I)
    body = t[m.end(): m.end() + (stop.start() if stop else len(t))]
    depth, start = 0, None
    for k, ch in enumerate(body):
        if ch == "(":
            if depth == 0:
                start = k + 1
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0 and start is not None:
                rec = dict(zip(cols, split_top(body[start:k])))
                code = rec.get("code", "").strip("'")
                if code:
                    seeded[code] = rec
                start = None

def num(v):
    v = (v or "").strip()
    if v in ("", "null", "NULL"):
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    return int(n) if n == int(n) else n

PL = pathlib.Path("price-list.js")
if not PL.is_file() or not seeded:
    emit("BAD", "price-list.js or the plans seed is missing — nothing to compare")
    card = {}
else:
    pl = PL.read_text()
    card = {}
    for m in re.finditer(
            r'code:\s*"([A-Za-z0-9_]+)",\s*key:\s*"[A-Za-z0-9_]+",\s*type:\s*"([A-Za-z0-9_]+)",\s*\n'
            r'\s*name:\s*"([^"]+)",\s*memberCap:\s*(\d+),\s*monthly:\s*(\d+|null),\s*'
            r'annual:\s*(\d+|null),\s*oneoff:\s*(\d+|null)', pl):
        card[m.group(1)] = {
            "type": m.group(2), "name": m.group(3), "memberCap": int(m.group(4)),
            "monthly": None if m.group(5) == "null" else int(m.group(5)),
            "annual": None if m.group(6) == "null" else int(m.group(6)),
            "oneoff": None if m.group(7) == "null" else int(m.group(7)),
        }

    drift = []
    for code, rec in sorted(seeded.items()):
        if code not in card:
            drift.append("%s is seeded in SQL but absent from price-list.js" % code)
            continue
        c = card[code]
        for sql_col, js_col in (("price_monthly", "monthly"), ("price_annual", "annual"),
                                ("price_oneoff", "oneoff"), ("max_members", "memberCap")):
            sv = num(rec.get(sql_col))
            if sv == 0 and js_col == "oneoff":
                sv = None          # 0 is the column default for a subscription plan
            if sv != c[js_col]:
                drift.append("%s.%s: SQL says %s, price-list.js says %s"
                             % (code, sql_col, sv, c[js_col]))
    for code in sorted(set(card) - set(seeded)):
        drift.append("price-list.js advertises %s, which no migration seeds — money-flow "
                     "answers 'Invalid plan' for it" % code)
    if drift:
        emit("BAD", "price-list.js no longer mirrors public.plans:")
        for d in drift:
            emit("BAD", "    " + d)
    else:
        emit("OK", "price-list.js mirrors the seeded plans exactly (%d plans, %d prices)"
             % (len(card), sum(1 for c in card.values()
                               for k in ("monthly", "annual", "oneoff") if c[k])))

# --- 2. no page may quote a price that is not on the card ------------------
book = set()
for c in card.values():
    book |= {c[k] for k in ("monthly", "annual", "oneoff") if c[k]}
SURFACES = ["index.html", "app.html", "assessment.html", "assessment.js",
            "checkout.html", "checkout.js", "leads.html", "leads.js",
            "app.js", "api.js", "README.md", "terms.html", "privacy.html"]
RM = re.compile(r"RM\s*([0-9][0-9,]*)")
quotes, price_offenders = 0, []
for name in SURFACES:
    p = pathlib.Path(name)
    if not p.is_file():
        continue
    clean = strip_comments(p.read_text())
    for m in RM.finditer(clean):
        val = int(m.group(1).replace(",", ""))
        if val < 100:          # RM0 placeholders and sub-RM demo figures
            continue
        quotes += 1
        if val not in book:
            line = clean[:m.start()].count("\n") + 1
            price_offenders.append("%s:%d quotes RM%s — a number nothing in "
                                   "price-list.js or public.plans will charge"
                                   % (name, line, format(val, ",")))
if price_offenders:
    for o in price_offenders:
        emit("BAD", o)
elif quotes:
    emit("OK", "%d RM amount(s) written into the public surfaces, each one a price "
               "on the card" % quotes)
else:
    emit("OK", "no RM amount is written into the public surfaces at all — every price "
               "on screen comes from price-list.js or the server")

# --- 3. api.js reads the card off globalThis, so the page must load it -----
no_card = []
for p in sorted(pathlib.Path(".").glob("*.html")):
    t = p.read_text()
    if re.search(r'src="[^"]*/api\.js"', t) and not re.search(r'src="[^"]*/price-list\.js"', t):
        no_card = p.name
        break
if no_card:
    emit("BAD", "%s loads api.js without price-list.js — RATE_CARD is null, so plan "
                "names fall back to the raw code and every amount to RM0" % no_card)
else:
    emit("OK", "every page loading api.js also loads the rate card")

# --- 4. the two half-translators in this repo ------------------------------
# checkout/assessment/leads translate by walking text nodes and looking the
# trimmed string up in `var MAP`. Two failure classes were found here: a key
# containing markup can never match a text node (the sentence renders in one
# language only), and a key left behind when its sentence was edited is dead
# weight that hides the fact the new sentence has no key at all.
map_problems = []
for name, js in (("checkout.html", "checkout.js"), ("assessment.html", "assessment.js"),
                 ("leads.html", "leads.js")):
    p = pathlib.Path(name)
    if not p.is_file():
        continue
    lines = p.read_text().splitlines()
    idx = next((i for i, l in enumerate(lines) if re.match(r"\s*var MAP\s*=\s*\{", l)), None)
    if idx is None:
        map_problems.append("%s has no `var MAP` — the page cannot translate itself" % name)
        continue
    pairs = re.findall(r'"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"', lines[idx])
    hay = html.unescape("\n".join(lines[:idx] + lines[idx + 1:]))
    if pathlib.Path(js).is_file():
        hay += html.unescape(pathlib.Path(js).read_text())
    dead = [unesc(k) for k, v in pairs if k != "__title__" and unesc(k) not in hay]
    markup = [unesc(k) for k, v in pairs if "<" in unesc(k) or ">" in unesc(k)]
    if markup:
        map_problems.append("%s: %d MAP key(s) contain markup, which no text node can "
                            "match — e.g. %r" % (name, len(markup), markup[0][:60]))
    if dead:
        map_problems.append("%s: %d MAP key(s) match no text in the page or its script "
                            "— e.g. %r" % (name, len(dead), dead[0][:60]))
if map_problems:
    for m in map_problems:
        emit("BAD", m)
else:
    emit("OK", "MAP keys in checkout/assessment/leads carry no markup and none is orphaned")

# --- 5. PocketBase is retired; it may only be named as retired -------------
pb_bad = []
for p in sorted(pathlib.Path(".").glob("*.html")):
    for i, ln in enumerate(p.read_text().splitlines(), 1):
        if "pocketbase" in ln.lower() and not any(
                w in ln.lower() for w in ("bersara", "retired", "archive", "superseded",
                                          "no longer", "dahulu")):
            pb_bad.append("%s:%d" % (p.name, i))
if pb_bad:
    emit("BAD", "PocketBase offered as if it still works in " + ", ".join(pb_bad[:4]) +
                " — /api/config.js no longer emits pocketbaseUrl and the operator "
                "dialog was replaced by a read-only status panel")
else:
    emit("OK", "no page presents PocketBase as a live option")

# --- 6. a swallowed error must not paint a populated view ------------------
GUI = pathlib.Path("governance-ui.js")
if not GUI.is_file():
    emit("BAD", "governance-ui.js is missing")
else:
    g = GUI.read_text().replace("\r", "")
    PAINT = ("textContent", "innerHTML", "appendChild", "replaceChildren",
             "statusPill", 'agmx-empty')
    blind = []
    for m in re.finditer(r"catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{", g):
        body = balanced(g, g.index("{", m.end() - 1), "{", "}") or ""
        if any(tok in body for tok in PAINT) and \
           not any(tok in body for tok in ("renderError", "statusFailure", "error")) and \
           m.group(1) not in body:
            blind.append(":%d catch (%s)" % (g[:m.start()].count("\n") + 1, m.group(1)))
    if blind:
        emit("BAD", "governance-ui.js renders a view from a catch that never mentions "
                    "the error: " + ", ".join(blind) +
                    " — a failed read must not draw '0 hadir' or 'None recorded yet'")
    else:
        emit("OK", "no catch in governance-ui.js paints a result it could not read")
    defs = len(re.findall(r"function\s+(?:renderError|statusFailure)\b", g))
    calls = len(re.findall(r"\b(?:renderError|statusFailure)\s*\(", g)) - defs
    if defs < 2 or calls < 2:
        emit("BAD", "governance-ui.js error states are not wired: %d definitions, "
                    "%d call sites — a failing read must render one of them" % (defs, calls))
    else:
        emit("OK", "renderError/statusFailure defined and used at %d call site(s)" % calls)
out.close()
sys.exit(0)
PY
GUARD_RC=$?
while IFS=$'\t' read -r kind text; do
  [ -n "${kind:-}" ] || continue
  case "$kind" in
    BAD)  bad "$text";;
    WARN) warn "$text";;
    OK)   ok "$text";;
    *)    bad "pass 22 emitted an unrecognised result line: $kind";;
  esac
done < "$GUARD_OUT"
rm -f "$GUARD_OUT"
[ "$GUARD_RC" -le 1 ] || bad "pass 22 could not complete (python exit $GUARD_RC)"

# ----------------------------------------------------------------
head_ "23. The deployed surface and the published numbers"
# ----------------------------------------------------------------
# Everything above is a true statement about this tree. None of it can notice
# that the tree is not what users receive: production served sw.js v31 and
# demoMode:true for weeks after the repo moved past both, and the landing page
# quoted table and policy counts the schema never installed. So this pass asks
# the running site the questions the offline passes ask the files, and asks the
# files the question a marketing number always invites — can a fresh deploy of
# the documented bundle actually produce it?
LIVE_OUT=$(mktemp /tmp/agmx-live-XXXXXX.txt)
LIVE_DIR=$(mktemp -d /tmp/agmx-live-XXXXXX)
LIVE_HOST="${CANON_HOST:-}"
LIVE_TRY=0
CFG_CODE=000
SW_CODE=000
HEALTH_CODE=000
if [ -z "$LIVE_HOST" ]; then
  warn "pass 19 resolved no canonical host — the deployed surface was not verified"
elif [ "${AGMX_SKIP_NET:-0}" = "1" ]; then
  warn "AGMX_SKIP_NET=1 — deployed /api/config and /sw.js NOT verified; clear it before a release"
elif ! command -v curl >/dev/null 2>&1; then
  warn "curl not found — the deployed surface was not verified"
else
  LIVE_TRY=1
  # The content probes below fetch with -L, so a canonical host that merely
  # redirected still passed. That is exactly what happened when Vercel
  # reassigned this project's production alias: sitemap.xml and rel=canonical
  # kept publishing a host that only answered 307, every shared link and
  # payment redirect went through it, and only pass 5 noticed. The URL the
  # product publishes must be the URL that answers, so the first hop is judged
  # on its own, without following anything.
  CANON_CODE=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "https://$LIVE_HOST/" 2>/dev/null)
  CANON_LOC=$(curl -sI --max-time 20 "https://$LIVE_HOST/" 2>/dev/null \
              | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r\n')
  if [ "$CANON_CODE" = "200" ]; then
    ok "https://$LIVE_HOST/ answers 200 on the first hop — the published host is the serving host"
  elif [ -n "$CANON_LOC" ]; then
    bad "https://$LIVE_HOST/ is a $CANON_CODE redirect to $CANON_LOC — publish the host that answers, not an alias that forwards to it"
  else
    bad "https://$LIVE_HOST/ answered HTTP $CANON_CODE — the canonical host is not serving this product"
  fi
  CFG_CODE=$(curl -sL --max-time 20 -o "$LIVE_DIR/api-config.js" -w '%{http_code}' \
            "https://$LIVE_HOST/api/config" 2>/dev/null)
  SW_CODE=$(curl -sL --max-time 20 -o "$LIVE_DIR/sw.js" -w '%{http_code}' \
            "https://$LIVE_HOST/sw.js" 2>/dev/null)
  # /api/health is the same deployment accounting for itself. /api/config alone can
  # only report what the site offers; the health route is what makes "we accept card
  # payments" and "the knowledge room is live" into claims that can be disproved.
  HEALTH_CODE=$(curl -sL --max-time 20 -o "$LIVE_DIR/api-health.json" -w '%{http_code}' \
               "https://$LIVE_HOST/api/health" 2>/dev/null)
fi
python3 - "$LIVE_OUT" "$LIVE_HOST" "$LIVE_TRY" "$CFG_CODE" "$SW_CODE" "$LIVE_DIR" "$HEALTH_CODE" <<'PY'
import json, pathlib, re, sys, urllib.error, urllib.request

out = open(sys.argv[1], "w")
def emit(kind, text):
    out.write("%s\t%s\n" % (kind, " ".join(str(text).split())))

def balanced(text, idx, opener="{", closer="}"):
    depth, i, q, esc = 0, idx, None, False
    while i < len(text):
        c = text[i]
        if q:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == q: q = None
        elif c in "\"'": q = c
        elif c == opener: depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0: return text[idx:i + 1]
        i += 1
    return None

# --- 1. the landing page may only quote numbers a fresh deploy produces ------
# "all 50 tables" was true of one production database and of nothing else: the
# migrations install 40, so every cooperative onboarding from the documented
# bundle got a schema the marketing page did not describe. Counting from the
# generated bundle (which pass 21 proves is current) makes the claim checkable
# by anyone who can run supabase db push.
BUNDLE = pathlib.Path("supabase/schema_final.sql")
if not BUNDLE.is_file():
    emit("BAD", "supabase/schema_final.sql is missing — run python3 tools/build_schema_bundle.py")
else:
    sql = BUNDLE.read_text()
    n_tables = len(set(n.strip('"').lower() for _s, n in re.findall(
        r'create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+)\.([a-z_0-9"]+)', sql, re.I)))
    n_pol = len(re.findall(r'create\s+policy\s+[a-z_0-9"]+\s+on\s+[a-z_]+\.[a-z_0-9"]+', sql, re.I))
    offenders = []
    if pathlib.Path("index.html").is_file():
        page = pathlib.Path("index.html").read_text()
        for num, word in re.findall(r'(\d[\d,]*)\s+(tables?|polic(?:y|ies)|jadual|polisi)\b', page, re.I):
            want = n_tables if word.lower().startswith(("table", "jadual")) else n_pol
            if int(num.replace(",", "")) != want:
                offenders.append("%s %s" % (num, word))
    if offenders:
        emit("BAD", "index.html states %s, but the bundle a fresh deploy installs has %d tables "
                    "and %d policies — a published number must be one the repository can produce"
                    % (", ".join(offenders), n_tables, n_pol))
    else:
        emit("OK", "index.html's schema counts match the generated bundle (%d tables, %d policies)"
             % (n_tables, n_pol))

# --- 2. what the running site actually answers -------------------------------
host, tried = sys.argv[2], sys.argv[3] == "1"
cfg_code, sw_code = sys.argv[4] or "000", sys.argv[5] or "000"
live = pathlib.Path(sys.argv[6])
health_code = sys.argv[7] or "000"
if not tried:
    out.close()
    sys.exit(0)

repo_sw = pathlib.Path("sw.js").read_text()
def cache_of(t):
    m = re.search(r'const\s+CACHE\s*=\s*"([^"]+)"', t)
    return m.group(1) if m else None
repo_n = cache_of(repo_sw)

live_sw = (live / "sw.js").read_text(errors="replace") if (live / "sw.js").is_file() else ""
live_n = cache_of(live_sw)
if live_n is None:
    emit("BAD", "GET https://%s/sw.js → HTTP %s with no const CACHE — the SPA catch-all is "
                "answering for a missing asset, and an installed client will cache HTML as "
                "JavaScript" % (host, sw_code))
elif repo_n is None:
    emit("BAD", "this repo's sw.js has no CACHE version to compare against")

strict = None not in (live_n, repo_n) and live_n >= repo_n
if live_n is not None and repo_n is not None and live_n > repo_n:
    emit("BAD", "production runs %s while this repo ships %s — the tree no longer "
                "describes what users get; reconcile it before deploying over it" % (live_n, repo_n))
elif live_n is not None and repo_n is not None and live_n == repo_n and live_sw != repo_sw:
    emit("BAD", "%s is on production and in this repo but the two sw.js files differ — a "
                "precached edit went out without its own version number, so installed clients "
                "cannot tell the two builds apart" % live_n)
elif live_n is not None and repo_n is not None and live_n == repo_n:
    emit("OK", "deployed sw.js is byte-identical to the copy tools/test_service_worker_policy.mjs "
               "validated (%s)" % live_n)

findings = []
cfg = None
if cfg_code != "200":
    emit("BAD", "GET https://%s/api/config → HTTP %s" % (host, cfg_code))
else:
    txt = (live / "api-config.js").read_text(errors="replace")
    m = re.search(r"AGMX_CONFIG\s*=\s*\{", txt)
    body = balanced(txt, m.end() - 1) if m else None
    if body is None:
        emit("BAD", "deployed /api/config serves no AGMX_CONFIG object (%d bytes) — the config "
                    "route is not answering" % len(txt))
    else:
        try:
            cfg = json.loads(body.rstrip().rstrip(";"))
        except Exception as exc:
            emit("BAD", "deployed /api/config is not parseable — is the probe pointed at the "
                        "static copy of the function instead of its route? %s" % exc)

# --- 2b. the deployment's own account of itself ------------------------------
# /api/config states what the site offers; /api/health states what it can do, read
# from the same variables on the same platform. Asking both is what turns "paymentsMode
# all promises a real gateway, confirm it yourself" into a check this repository runs.
# A degraded site still answers 503 with a body, so both codes are read; anything else
# means the route is not there at all.
health = None
if health_code in ("200", "503"):
    try:
        health = json.loads((live / "api-health.json").read_text(errors="replace"))
    except Exception as exc:
        emit("BAD", "https://%s/api/health answered %s with a body that is not JSON (%s) — a "
                    "health route that cannot be read looks like a passing check while proving "
                    "nothing" % (host, health_code, exc))
elif cfg is not None:
    emit("WARN" if not strict else "BAD",
         "https://%s/api/health answered HTTP %s while /api/config answered 200 — the deployment "
         "advertises capabilities it cannot account for%s"
         % (host, health_code,
            "; 404 usually means this tree's api/health.js has not been deployed"
            if health_code == "404" else ""))

if cfg is not None:
    if cfg.get("demoMode") is not False:
        findings.append("demoMode is %s — api.js binds the Supabase adapter only when it is false, "
                        "so every quote, invoice and payment written in a browser is going to that "
                        "browser's localStorage" % json.dumps(cfg.get("demoMode")))
    if cfg.get("mode") != "supabase":
        findings.append("mode is %s — the client has no way to know which backend answers"
                        % json.dumps(cfg.get("mode")))
    if not cfg.get("supabaseUrl"):
        findings.append("supabaseUrl is empty")
    if not re.search(r'pathname\.startsWith\(\s*"/api/"', live_sw):
        findings.append("the installed worker still caches /api/* — a client that loaded this build "
                        "keeps its stale config and its stale health probe even after a fixed deploy")
    live_pays = json.dumps(cfg.get("paymentsMode"))

    # Two endpoints, one truth each. Each finding below is a sentence the site says
    # about itself that its own health route contradicts.
    if health is not None:
        pays = (health.get("checks") or {}).get("payments") or {}
        know = (health.get("checks") or {}).get("knowledge") or {}
        offering_gateway = cfg.get("paymentsMode") == "all"
        if offering_gateway and not pays.get("provider"):
            findings.append("reports paymentsMode \"all\" while its own /api/health finds no "
                            "gateway provider at all (missing %s) — checkout would offer a bill "
                            "no server can create" % json.dumps(pays.get("missing") or []))
        elif offering_gateway and pays.get("can_charge") is False:
            findings.append('reports paymentsMode "all" while /api/health says can_charge:false '
                            "(missing %s)" % json.dumps(pays.get("missing") or []))
        # A gateway that can create a bill but cannot verify the callback marks invoices
        # paid on nothing, so it is named even though the two statements do not contradict
        # each other and it is a legitimate mid-setup state.
        if offering_gateway and pays.get("can_charge") is True and pays.get("configured") is False:
            emit("WARN", "https://%s can charge through %s (%s) but reports configured:false — %s "
                         "missing, so the payment callback cannot be verified yet"
                 % (host, pays.get("provider"), pays.get("mode"),
                    json.dumps(pays.get("missing") or [])))
        if cfg.get("knowledgeRagEnabled") is True and know.get("ready") is not True:
            findings.append("advertises the knowledge room (knowledgeRagEnabled:true) while /api/health "
                            "reports ready:%s — configured:%s, missing %s, knowledge_chunks probe %s. "
                            "The knowledge functions cannot embed a question without a provider key"
                            % (json.dumps(know.get("ready")), json.dumps(know.get("configured")),
                               json.dumps(know.get("missing") or []),
                               json.dumps((know.get("schema") or {}).get("ready"))))
        if know.get("provider") and cfg.get("llmProvider") and \
           not str(know.get("provider")).endswith(str(cfg.get("llmProvider"))):
            findings.append("tells the browser it uses llmProvider %s while /api/health resolved %s — "
                            "the two read different variables for the same decision"
                            % (json.dumps(cfg.get("llmProvider")), json.dumps(know.get("provider"))))

    # --- 2c. the deployed knowledge function must load, and must be the provider
    # the site names. /api/config and /api/health both run on the site's own
    # platform; the Edge Function runs on Supabase's. A module-scope throw in
    # the function (a secret read at import time that the runtime does not
    # inject) makes every request a bare 500 WORKER_ERROR, while the site
    # keeps advertising the feature. GET is used because the function answers
    # a non-POST with 405 before it touches the database, so the probe cannot
    # write a row; the key it carries is the publishable one the site already
    # publishes, so this check needs no secret of its own.
    su = str(cfg.get("supabaseUrl") or "")
    anon = str(cfg.get("supabaseAnonKey") or "")
    if su.startswith("https://") and anon:
        fn_url = su.rstrip("/") + "/functions/v1/knowledge-query"
        req = urllib.request.Request(fn_url, method="GET",
                                     headers={"Authorization": "Bearer " + anon,
                                              "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                fn_code = resp.getcode()
                fn_body = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            fn_code = exc.code
            fn_body = exc.read().decode("utf-8", "replace")
        except Exception as exc:
            fn_code = 0
            fn_body = str(exc)
        try:
            fn_json = json.loads(fn_body)
        except Exception:
            fn_json = None
        if fn_code == 500 or (isinstance(fn_json, dict) and fn_json.get("code") == "WORKER_ERROR"):
            emit("BAD", "%s answered HTTP %s — the deployed knowledge function cannot load, so every "
                        "knowledge request is a 500 regardless of what the site advertises%s"
                 % (fn_url, fn_code,
                    " (%s)" % fn_body[:200] if fn_code == 500 and fn_body else ""))
        elif fn_code == 405:
            fn_provider = (fn_json or {}).get("provider")
            if not fn_provider:
                emit("WARN", "%s answered 405 without naming its provider — the deployed build predates "
                             "the readiness report, so this check cannot confirm which provider it uses"
                     % fn_url)
            elif cfg.get("llmProvider") and fn_provider != str(cfg.get("llmProvider")):
                findings.append("publishes llmProvider %s while the deployed knowledge function selects %s — "
                                "the browser and the function read different variables for the same decision"
                                % (json.dumps(cfg.get("llmProvider")), json.dumps(fn_provider)))
            else:
                emit("OK", "%s loads and selects provider %s, matching the site's llmProvider"
                     % (fn_url, json.dumps(fn_provider)))
        elif fn_code in (401, 403):
            emit("WARN", "%s answered HTTP %s — the publishable key the site publishes cannot open this "
                         "function, so the deployed knowledge function could not be checked"
                     % (fn_url, fn_code))
        elif fn_code == 404:
            emit("WARN", "%s answered 404 — no knowledge-query function is deployed on this project"
                 % fn_url)
        elif fn_code == 0:
            emit("WARN", "%s could not be reached (%s) — the deployed knowledge function could not be checked"
                 % (fn_url, fn_body[:120]))
        else:
            emit("WARN", "%s answered HTTP %s where a 405 was expected — the deployed knowledge function "
                         "answers in a shape this check does not understand" % (fn_url, fn_code))
    elif su:
        emit("WARN", "%s publishes no supabaseAnonKey — the deployed knowledge function could not be checked"
             % su)

    if findings:
        if strict:
            for f in findings:
                emit("BAD", "https://%s: %s" % (host, f))
        else:
            behind = ("production runs agmx-v%d while this repo is agmx-v%d" % (live_n, repo_n)
                      if None not in (live_n, repo_n)
                      else "the deployed worker could not be versioned")
            emit("WARN", "%s, so these are warnings for an undeployed fix rather than failures: %s. "
                         "Deploy this tree and each one becomes a hard check. (paymentsMode on the "
                         "wire: %s)" % (behind, "; ".join(findings), live_pays))
    else:
        paid = "paymentsMode %s" % live_pays
        if health is not None:
            pays = (health.get("checks") or {}).get("payments") or {}
            if cfg.get("paymentsMode") == "all":
                paid += ", gateway %s confirmed by /api/health" % json.dumps(pays.get("provider"))
            else:
                paid += " (%s), no gateway offered" % json.dumps(pays.get("provider"))
            if cfg.get("knowledgeRagEnabled") is not True:
                paid += ", knowledgeRagEnabled false"
        emit("OK", "https://%s: demoMode false, mode supabase, %s" % (host, paid))
out.close()
sys.exit(0)
PY
LIVE_RC=$?
while IFS=$'\t' read -r kind text; do
  [ -n "${kind:-}" ] || continue
  case "$kind" in
    BAD)  bad "$text";;
    WARN) warn "$text";;
    OK)   ok "$text";;
    *)    bad "pass 23 emitted an unrecognised result line: $kind";;
  esac
done < "$LIVE_OUT"
rm -f "$LIVE_OUT"; rm -rf "$LIVE_DIR"
[ "$LIVE_RC" -eq 0 ] || bad "pass 23 could not complete (python exit $LIVE_RC)"

# The config the *server* reads. Everything above judges what the browser gets;
# money-flow builds its checkout links from the APP_URL secret, and that secret
# survives every redeploy — so a tree that names one host and a project that
# answers another is invisible to passes 19 and 23 until a customer follows a
# link to the wrong site. `supabase secrets list` prints only a sha256 digest of
# each value, which is exactly enough to compare a public URL without ever
# reading a secret.
if [ -n "$LIVE_HOST" ] && [ "${AGMX_SKIP_NET:-0}" != "1" ] && command -v supabase >/dev/null 2>&1; then
  SB_REF=$(python3 -c 'import json;print(json.load(open("supabase/.temp/linked-project.json"))["ref"])' 2>/dev/null || true)
  SB_LIST=""
  if [ -n "$SB_REF" ]; then
    SB_LIST=$(supabase secrets list --project-ref "$SB_REF" 2>/dev/null || true)
  fi
  APP_URL_DIGEST=$(printf '%s\n' "$SB_LIST" | awk -F'|' '$1 ~ /APP_URL/ {gsub(/[[:space:]]/,"",$2); print $2}')
  WANT_APP_URL=$(python3 -c 'import hashlib,sys;print(hashlib.sha256(("https://"+sys.argv[1]).encode()).hexdigest())' "$LIVE_HOST")
  if [ -z "$SB_REF" ]; then
    warn "no supabase/.temp/linked-project.json — run \`supabase link\` to verify the deployed APP_URL"
  elif [ -z "$APP_URL_DIGEST" ]; then
    warn "APP_URL was not read from project $SB_REF (unauthenticated CLI, or the secret is unset) — money-flow then uses the host compiled into it"
  elif [ "$APP_URL_DIGEST" = "$WANT_APP_URL" ]; then
    ok "the deployed APP_URL secret digests to https://$LIVE_HOST — the links money-flow generates are this site"
  else
    bad "APP_URL on project $SB_REF is not https://$LIVE_HOST (digest $APP_URL_DIGEST) — every quote link, paymentUrl and gateway redirect points at another deployment"
  fi
fi

# ----------------------------------------------------------------
head_ "24. The MVP acceptance journey runs on real Postgres"
# ----------------------------------------------------------------
# AGMX_V2_PLAN.md §9 names one test that nothing else in this suite can
# substitute for: assessment → payment → AGM scheduled → meeting run → minutes
# produced. Every other pass reads files. This one boots the generated deploy
# bundle on embedded Postgres (tools/agmx_db.mjs), then loads
# supabase/functions/money-flow/index.ts and supabase/functions/governance/index.ts
# as written — the only substitution is their three imports and Deno.env — and
# drives the handlers they pass to serve() with real Request objects. Each read
# and write those handlers make compiles against the live catalog, so the quorum
# maths, ballot secrecy, resolution thresholds, idempotency lock and audit hash
# chain are decided by the same plpgsql a cooperative's meeting would run.
#
# It earned its place on the first run, by failing on five defects no file
# reading could see:
#   * cast_vote's quorum guard called max(boolean) — an aggregate Postgres does
#     not have, so every ballot in production would have raised 500.
#   * The rewritten guard used coalesce(...) INTO a variable, which Postgres
#     overwrites with NULL when the query matches no rows: an AGM with no
#     attendance record would have failed OPEN and let anyone vote.
#   * Two RPCs referenced undeclared plpgsql variables (0007 v_satisfied,
#     0008 v_existing) — a compile error the moment the function is called.
#   * 0008 assigned a jsonb row into a uuid variable.
#   * audit_events.organization_id was NOT NULL while both audit writers map a
#     pre-organization lead to NULL, so the prospect's own submission was
#     silently dropped from the log.
#
# It needs no credentials and no network: the HitPay call is answered by an
# in-process stub that throws on any other URL, so this pass runs in the
# pre-commit hook. The assertion floor is a real floor — a run that quietly
# stops asserting must fail, not go green.
if [ -f tools/test_agm_journey.mjs ] && [ -f tools/agmx_db.mjs ]; then
  if [ ! -d node_modules/@electric-sql/pglite ]; then
    warn "tools/test_agm_journey.mjs skipped — npm install @electric-sql/pglite to boot the deploy bundle on real Postgres"
  elif OUT=$(node tools/test_agm_journey.mjs 2>&1); then
    COUNT=$(printf '%s' "$OUT" | grep -oE '[0-9]+ assertions passed' | grep -oE '[0-9]+')
    if [ -z "$COUNT" ]; then
      bad "tools/test_agm_journey.mjs exited 0 but printed no assertion total — the run cannot be trusted"
    elif [ "$COUNT" -lt 100 ]; then
      bad "tools/test_agm_journey.mjs ran only ${COUNT} assertions (floor is 100) — the journey was cut short, not passed"
    else
      ok "tools/test_agm_journey.mjs — assessment → payment → AGM → votes → minutes on real Postgres (${COUNT} assertions)"
    fi
  else
    bad "tools/test_agm_journey.mjs failed — the MVP journey does not run on the bundle this repo deploys"
    printf '%s\n' "$OUT" | grep -E '^  ✗|^FAILED|Error' | head -10 | sed 's/^/      /'
  fi
else
  warn "tools/test_agm_journey.mjs / tools/agmx_db.mjs not found"
fi

# ----------------------------------------------------------------
head_ "25. A fresh deploy bundle replays clean and writes the audit trail"
# ----------------------------------------------------------------
# Pass 24 proves the journey works; this proves the *file* works, twice.
# DEPLOY.md and supabase/deploy.sh both send an operator to
# supabase/schema_final.sql, and the normal recovery after a partial paste is to
# paste it again — which is also how a rerun-safe file is proven, because
# Postgres answers "success" to a statement that changed nothing. Pass 21 checks
# the rerun claim by pattern (every `create policy` preceded by a `drop policy if
# exists`); this applies the bundle a second time to the same database and
# compares the catalog before and after, so an unguarded `add constraint`, a
# `create trigger` without its drop, or a seed row without `on conflict` fails
# here instead of in front of an operator with a cooperative's data already in
# the tables.
#
# It also runs the SQL audit writer, which pass 24 cannot see: governance's RPCs
# `perform log_audit(...)`, while every audit row pass 24 asserts was written by
# money-flow's client-side hash chain. That gap held the worst defect the suite
# has found — log_audit read its chain head with `select coalesce(hash,'0') into
# v_prev ... limit 1`, which leaves the variable NULL when no row matches, so an
# organization's first event hashed NULL into a NOT NULL column and its own
# `exception when others` handler swallowed the violation. The chain could never
# start, so no governance audit event was ever recorded, for any tenant, behind
# an HTTP 200 and a warning in the log.
if [ -f tools/test_bundle_replay.mjs ] && [ -f tools/agmx_db.mjs ]; then
  if [ ! -d node_modules/@electric-sql/pglite ]; then
    warn "tools/test_bundle_replay.mjs skipped — npm install @electric-sql/pglite"
  elif OUT=$(node tools/test_bundle_replay.mjs 2>&1); then
    ok "$(printf '%s\n' "$OUT" | tail -1)"
  else
    bad "the documented deploy bundle does not replay clean, or its audit trail is not being written"
    printf '%s\n' "$OUT" | grep -E '^  FAILED|^[0-9]+ check' | head -8 | sed 's/^/      /'
  fi
else
  warn "tools/test_bundle_replay.mjs / tools/agmx_db.mjs not found"
fi

# ----------------------------------------------------------------
head_ "26. The linked project still runs the SQL in this repository"
# ----------------------------------------------------------------
# Passes 21, 24 and 25 all read files, so they agree with one another no matter what
# a live database holds. And `supabase db push` compares *version numbers*, not
# content: edit a migration after its first apply and the CLI skips it forever.
# Production ran `cast_vote` with `max(boolean)` — an aggregate Postgres does not
# have, so every ballot errored — and `log_audit()`'s no-row chain-head read, which
# wrote no audit event at all, while `supabase migration list` reported 0007-0009
# applied and three status docs insisted no remote project had been touched. Version
# 0010 had been applied in the dashboard with no file here, so nothing in this suite
# could have seen that either.
#
# This reads the live catalog instead: md5 over pg_proc.prosrc against the same hash
# of each body in the generated bundle, plus recorded migration versions against the
# files that describe them. It needs credentials, so an unreadable project is a
# warning (exit 2) rather than a failure — the pre-commit hook on a machine with no
# project linked must not go red for the wrong reason.
if [ ! -f tools/test_production_drift.mjs ]; then
  warn "tools/test_production_drift.mjs not found"
elif ! command -v supabase >/dev/null 2>&1; then
  warn "supabase CLI not installed — the linked project was not compared with this tree"
elif [ "${AGMX_SKIP_NET:-0}" = "1" ]; then
  warn "AGMX_SKIP_NET=1 — production drift not checked; clear it before a release"
elif [ ! -f supabase/.temp/linked-project.json ] || [ ! -f supabase/.temp/project-ref ]; then
  warn "no linked project — run \`supabase link\` to compare the live catalog with supabase/schema_final.sql"
else
  if OUT=$(node tools/test_production_drift.mjs 2>&1); then
    ok "$(printf '%s\n' "$OUT" | tail -1)"
  else
    CODE=$?
    if [ "$CODE" -eq 2 ]; then
      warn "production drift not checked — $(printf '%s\n' "$OUT" | head -1)"
    else
      bad "the linked project does not match the SQL this repository deploys"
      printf '%s\n' "$OUT" | grep -E '^  DRIFT|^  note' | head -12 | sed 's/^/      /'
    fi
  fi
fi

# ----------------------------------------------------------------
head_ "27. The live ballot path is the repaired one, proven write-free"
# ----------------------------------------------------------------
# Supabase branching answers 402 entitlement_required — "Branching is supported only
# on the Pro plan or above" — so the journey cannot be replayed on a copy of
# production the way archive/docs/REPO_AND_VERCEL_STATUS.md demands (its live suites must never
# point at production). This is what is left, and it is read-only by construction:
# cast_vote's first statement selects a motion by id and returns when no row matches,
# so a random uuid exercises the live function without reaching an insert. votes and
# audit_events are counted before and after to prove that, because audit_events is
# append-only by trigger — a row written in error could not be taken back afterwards.
#
# It reads the live bodies as text rather than trusting pass 26's hash, and states
# what the hash is standing for: the defective `coalesce(max(satisfied), false) into`
# guard is gone, the fixed latest-snapshot read is present, log_audit() matches a NULL
# organization and seeds its own chain head, and this engine has no max(boolean) at
# all — so the text production used to run was fatal here, not merely untidy.
if [ ! -f tools/test_production_ballot_path.mjs ]; then
  warn "tools/test_production_ballot_path.mjs not found"
elif ! command -v supabase >/dev/null 2>&1; then
  warn "supabase CLI not installed — the live ballot path was not exercised"
elif [ "${AGMX_SKIP_NET:-0}" = "1" ]; then
  warn "AGMX_SKIP_NET=1 — live ballot path not exercised; clear it before a release"
elif [ ! -f supabase/.temp/linked-project.json ] || [ ! -f supabase/.temp/project-ref ]; then
  warn "no linked project — run \`supabase link\` to exercise the live ballot path"
else
  if OUT=$(node tools/test_production_ballot_path.mjs 2>&1); then
    ok "$(printf '%s\n' "$OUT" | tail -1)"
  else
    CODE=$?
    if [ "$CODE" -eq 2 ]; then
      warn "live ballot path not exercised — $(printf '%s\n' "$OUT" | head -1)"
    else
      bad "the live project does not run the repaired ballot path"
      printf '%s\n' "$OUT" | grep -E '^  FAIL|live Postgres' | head -10 | sed 's/^/      /'
    fi
  fi
fi

# ----------------------------------------------------------------
head_ "28. No Edge Function can fail to load"
# ----------------------------------------------------------------
# knowledge-query and knowledge-ingest answered HTTP 500
# {"code":"WORKER_ERROR","message":"Function exited due to an error (please check
# logs)"} to every request — including a GET, which their own source rejects with
# 405 — because one line each read
#   const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SECRET_KEY")!
# The Edge Runtime injects SUPABASE_SERVICE_ROLE_KEY and exposes no secret called
# SUPABASE_SECRET_KEY, so createClient() threw `supabaseKey is required.` while the
# module was still evaluating. No handler ran, so there was no status the response
# could explain, no JSON body, and no console.error line — the logs the platform
# points you at stay empty. Every behaviour assertion in this repository is about
# the handler, and a module-scope throw leaves the handler never called.
#
# `!` on an environment read asserts that the variable is certainly set, which is
# only knowable from the deployed project, so this pass asks the project: it reads
# the names `supabase secrets list` reports (Supabase includes the runtime-injected
# ones in that list) and rejects any assertion naming something else. Without a
# readable project the same finding is a warning, never a green tick.
SECRETS_TXT=$(mktemp /tmp/agmx-secrets-XXXXXX.txt)
DENO_ENV_OUT=$(mktemp /tmp/agmx-denoenv-XXXXXX.txt)
: > "$SECRETS_TXT"
if command -v supabase >/dev/null 2>&1 && [ -f supabase/.temp/project-ref ] \
   && [ "${AGMX_SKIP_NET:-0}" != "1" ]; then
  NO_COLOR=1 supabase secrets list --project-ref "$(cat supabase/.temp/project-ref)" 2>/dev/null \
    | tr '│' '|' > "$SECRETS_TXT" || true
fi
python3 - "$DENO_ENV_OUT" "$SECRETS_TXT" <<'PY'
import pathlib, re, sys

out = open(sys.argv[1], "w")
def emit(kind, text):
    out.write("%s\t%s\n" % (kind, " ".join(str(text).split())))

live = set()
for line in pathlib.Path(sys.argv[2]).read_text(errors="replace").splitlines():
    m = re.match(r"^ *([A-Z][A-Z0-9_]+) *\|", line)
    if m and m.group(1) != "NAME":
        live.add(m.group(1))

# Names the Edge Runtime gives every function without being told. Recorded here as
# the fallback for an unreadable project, and taken from what this project's own
# `secrets list` reports — Supabase's documentation lists SUPABASE_SECRET_KEY for
# the management API, which is not the same thing as the function's environment.
INJECTED = {"SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_DB_URL", "SUPABASE_JWKS", "SUPABASE_PUBLISHABLE_KEYS",
            "SUPABASE_SECRET_KEYS"}
allowed = INJECTED | live

files = sorted(pathlib.Path("supabase/functions").rglob("*.ts"))
QUOTE = "[\"']"
ASSERTION = re.compile("Deno\\.env\\.get\\(\\s*" + QUOTE + "([A-Z][A-Z0-9_]+)" + QUOTE +
                       "\\s*\\)\\s*!")
offenders, checked = [], 0
for f in files:
    src = f.read_text(errors="replace").replace("\r", "")
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = "\n".join(re.sub(r"//.*$", "", l) for l in src.split("\n"))
    for m in ASSERTION.finditer(src):
        checked += 1
        if m.group(1) not in allowed:
            offenders.append("%s reads %s" % (f, m.group(1)))

if offenders:
    detail = ", ".join(sorted(set(offenders)))
    if live:
        emit("BAD", "Edge Function(s) assert an environment variable the linked project does not "
                    "expose: %s — createClient()/a required value then throws while the module is "
                    "loading, and the runtime answers 500 WORKER_ERROR to every request with no "
                    "handler and no log line" % detail)
    else:
        emit("WARN", "%s is asserted with `!` but the project's secret list could not be read to "
                     "confirm it exists — run `supabase link`, or read it as a risk that the "
                     "function throws at module scope" % detail)
elif checked:
    emit("OK", "%d `Deno.env.get(...)!` assertion(s) in supabase/functions checked against the "
               "%d name(s) the Edge Runtime exposes%s"
         % (checked, len(allowed),
            "" if live else " (fallback list: the project's own secrets were not read)"))
else:
    emit("WARN", "no `Deno.env.get(...)!` assertion found in %d .ts file(s) — either every one is "
                 "gone or this scan stopped matching; confirm by hand before trusting the line"
         % len(files))
out.close()
sys.exit(0)
PY
DENOENV_RC=$?
while IFS=$'\t' read -r kind text; do
  [ -n "${kind:-}" ] || continue
  case "$kind" in
    BAD)  bad "$text";;
    WARN) warn "$text";;
    OK)   ok "$text";;
    *)    bad "pass 28 emitted an unrecognised result line: $kind";;
  esac
done < "$DENO_ENV_OUT"
rm -f "$DENO_ENV_OUT" "$SECRETS_TXT"
[ "$DENOENV_RC" -eq 0 ] || bad "pass 28 could not complete (python exit $DENOENV_RC)"

# ----------------------------------------------------------------
printf '\n\033[1m%s\033[0m\n' "───────────────────────────────────────"

if [ "$FAIL" -gt 0 ]; then
  printf '\033[31m✗\033[0m  %d passed · %d warning(s) · \033[31m%d failed\033[0m\n' "$PASS" "$WARN" "$FAIL"
  exit 1
else
  printf '\033[32m✓ all checks passed\033[0m  (%d passed · %d warning(s))\n' "$PASS" "$WARN"
  exit 0
fi
