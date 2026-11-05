#!/usr/bin/env bash
# ============================================================
# AGMX-v2-app — Deploy to Vercel (Duta Integra Team)
# ============================================================
# Run from AGMX-v2-app directory:
#   chmod +x deploy.sh && ./deploy.sh
# ============================================================

set -euo pipefail

# --- Config ---
# "duta-integra" was here for months, and it is not a team this credential has:
# `vercel team ls` returns only shamel-projects, so every deploy.sh run either
# failed the scope check or pointed at a project the account does not own, while
# agmx-v2-app kept serving from shamel-projects.
TEAM_SLUG="shamel-projects"
GITHUB_ORG="shamelali"
GITHUB_REPO="AGMX-v2-app"

# The project name is read from the link file instead of hardcoded: a stale name
# here points the deploy at a project the team does not have, and the project that
# is actually linked keeps serving. `vercel link` writes this file.
if [ ! -f .vercel/project.json ]; then
  echo "[ERROR] .vercel/project.json is missing. Run: vercel link --scope=${TEAM_SLUG}" >&2
  exit 1
fi
PROJECT_NAME="$(node -p 'require("./.vercel/project.json").projectName')"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*"; }

# --- Pre-flight checks ---
check_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "$1 not found. Install it first."; exit 1; }
}

log "Checking dependencies..."
check_cmd git
check_cmd vercel
check_cmd supabase

# --- 1. Git Setup ---
log "Setting up Git repo..."
if [ ! -d .git ]; then
  git init
  git branch -M main
fi

# Check remote
if git remote get-url origin 2>/dev/null | grep -q "AGMX-v2-app"; then
  log "Remote already points to AGMX-v2-app"
else
  warn "Remote points to different repo. Updating..."
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/${GITHUB_ORG}/${GITHUB_REPO}.git"
fi

# Add all files
git add -A
git status --short

# Commit if there are changes
if ! git diff --cached --quiet; then
  log "Committing changes..."
  git commit -m "chore: Supabase-first deployment config

- Add Supabase Edge Functions (money-flow, knowledge-query, knowledge-ingest)
- Add pgvector knowledge schema
- Update vercel.json for Supabase + OpenAI + Billplz/HitPay
- Update config.example.js for new architecture"
else
  log "No changes to commit"
fi

# Push to GitHub — the branch this checkout is on, not a hardcoded one: the repo's
# refs live under master, and pushing a branch that does not exist fails here.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
log "Pushing ${BRANCH} to GitHub..."
git push -u origin "${BRANCH}" || {
  warn "Push failed. Create the repo first: https://github.com/new"
  warn "Repo name: ${GITHUB_REPO}, Owner: ${GITHUB_ORG}"
  exit 1
}

# --- 2. Vercel Project ---
log "Checking Vercel project..."
if vercel project ls --scope="${TEAM_SLUG}" 2>/dev/null | grep -q "${PROJECT_NAME}"; then
  log "Vercel project exists, linking..."
  vercel link --project="${PROJECT_NAME}" --scope="${TEAM_SLUG}" --yes
else
  log "Creating new Vercel project..."
  vercel link --project="${PROJECT_NAME}" --scope="${TEAM_SLUG}" --yes
fi

# --- 3. Environment Variables ---
log "Setting Vercel environment variables..."
log "You'll need to add these in Vercel Dashboard → Settings → Environment Variables:"
cat <<EOF

Required — only the names api/*.js actually reads; SUPABASE_SERVICE_ROLE_KEY and
OPENAI_API_KEY belong to the Edge Function in step 5, and setting them here does
nothing:
  NEXT_PUBLIC_SUPABASE_URL          (from Supabase project)
  NEXT_PUBLIC_SUPABASE_ANON_KEY     (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  BILLPLZ_API_KEY                   (from Billplz sandbox)
  BILLPLZ_COLLECTION_ID             (from Billplz sandbox)
  HITPAY_API_KEY                    (from HitPay)
  HITPAY_SALT                       (from HitPay)
  NEXT_PUBLIC_APP_URL               https://${PROJECT_NAME}.vercel.app

Optional — feature flags, all opt-IN (unset reads as off):
  NEXT_PUBLIC_REALTIME=true         Supabase Realtime only; the retired
                                    PocketBase SSE host is not supported.
  NEXT_PUBLIC_KNOWLEDGE_RAG=true    only meaningful once knowledge-query and
                                    knowledge-ingest are deployed.
  NEXT_PUBLIC_PAYMENTS_MODE=all     only with real gateway keys AND the
                                    production BILLPLZ_API_URL/HITPAY_API_URL.
                                    Unset, /api/config.js derives it itself.

Never set in production:
  NEXT_PUBLIC_DEMO_MODE=true        with it on, api.js binds the localStorage
                                    adapter — quotes and "payments" are written
                                    to the visitor's browser and nothing reaches
                                    Supabase while the page prints a receipt.
                                    Unset reads as off; that is the default.

EOF

# --- 4. Supabase Setup ---
log "Supabase setup required:"
# Quoted delimiter: this block contains a literal `votes`. Unquoted, the shell
# would run command substitution on it and the operator would read a sentence
# with the table name silently deleted.
cat <<'EOF'
1. Create Supabase project: https://supabase.com/dashboard/new
   - Name: agmx-v2
   - Region: Southeast Asia (Singapore)
   - Save credentials

2. Apply the schema. supabase/migrations/ is the source of truth and
   supabase/schema_final.sql is GENERATED from it (tools/build_schema_bundle.py),
   so either path installs the same 23 functions and 41 policies:

   a) CLI:       supabase link --project-ref <ref> && supabase db push
   b) Dashboard: paste the whole of supabase/schema_final.sql into the SQL editor

   Regenerate the bundle after editing a migration; tools/check.sh fails the repo
   when it is stale. Do NOT use schema.sql / knowledge_schema.sql for a new
   project: they enable RLS with zero policies, so every anon/authenticated read
   returns no rows, and neither check_rate_limit nor process_payment_webhook is
   defined there, so all three Edge Functions fail closed.

3. Realtime: the bundle already manages the publication at the end of 0001
   (attendance, quorum_snapshots, motions, questions) and removes
   `votes` from it deliberately — a realtime feed would stream ballots.

4. Deploy Edge Functions — governance is the one this script used to omit, which
   left the AGM Hall with an interface and no RPCs behind it:
   supabase functions deploy governance       --project-ref <ref>
   supabase functions deploy money-flow       --project-ref <ref>
   supabase functions deploy knowledge-query  --project-ref <ref>   # optional
   supabase functions deploy knowledge-ingest --project-ref <ref>   # optional
   verify_jwt is declared in supabase/config.toml — money-flow false so a gateway
   webhook is not rejected before its signature check, the rest true.

5. Set Edge Function secrets — each name is the exact string Deno.env.get() reads:
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... --project-ref <ref>  # governance + money-flow
   supabase secrets set APP_URL=https://<your-host> --project-ref <ref>    # money-flow return URLs
   supabase secrets set SUPABASE_SECRET_KEY=... --project-ref <ref>        # knowledge-*; NOT SUPABASE_ANON_KEY
   supabase secrets set OPENAI_API_KEY=sk-... --project-ref <ref>          # or NVIDIA_NIM_API_KEY
   supabase secrets set BILLPLZ_API_KEY=... --project-ref <ref>
   supabase secrets set BILLPLZ_COLLECTION_ID=... --project-ref <ref>
   supabase secrets set BILLPLZ_API_URL=https://www.billplz.com --project-ref <ref>
   supabase secrets set HITPAY_API_KEY=... --project-ref <ref>
   supabase secrets set HITPAY_SALT=... --project-ref <ref>
   supabase secrets set HITPAY_API_URL=https://api.hit-pay.com --project-ref <ref>
   Both *_API_URL values default to the SANDBOX hosts. Real keys with a sandbox
   URL bill test money, and the webhook never reaches the production function.

EOF

# --- 5. Deploy ---
# Vercel attributes a deploy made from a git checkout to the latest commit's author
# and Blocks it when that email is not on the team, naming neither the address nor
# the reason. Ask before uploading — a Blocked deploy still costs the whole upload —
# using the same token the vercel CLI is about to use, from its own credential file.
author=$(git log -1 --format='%ae')
log "Deploy will be attributed to commit author: $author"
cli_token=$(node -p 'try{require(process.env.HOME+"/.local/share/com.vercel.cli/auth.json").token}catch(e){""}')
AGMX_AUTHOR="$author" VERCEL_ORG_ID="$(node -p 'require("./.vercel/project.json").orgId')" \
  VERCEL_TOKEN="$cli_token" python3 tools/check_deploy_author.py || {
  err "Aborted before upload — Vercel would have Blocked this deploy."
  exit 1
}
log "Deploying to Vercel..."
vercel --prod --scope="${TEAM_SLUG}" || {
  err "Vercel deploy failed. Check logs."
  exit 1
}

log "✅ Deployment complete!"
log "🌐 Live at: https://${PROJECT_NAME}.vercel.app"
log ""
log "Next steps:"
log "1. Add env vars in Vercel Dashboard"
log "2. Run Supabase schema migrations"
log "3. Deploy Supabase Edge Functions"
log "4. Test: assessment → quote → invoice → payment"