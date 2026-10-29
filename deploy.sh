#!/usr/bin/env bash
# ============================================================
# AGMX-v2-app — Deploy to Vercel (Duta Integra Team)
# ============================================================
# Run from AGMX-v2-app directory:
#   chmod +x deploy.sh && ./deploy.sh
# ============================================================

set -euo pipefail

# --- Config ---
TEAM_SLUG="duta-integra"
PROJECT_NAME="agmx-v2-app"
GITHUB_ORG="shamelali"
GITHUB_REPO="AGMX-v2-app"

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

# Push to GitHub
log "Pushing to GitHub..."
git push -u origin main || {
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

Required:
  NEXT_PUBLIC_SUPABASE_URL          (from Supabase project)
  NEXT_PUBLIC_SUPABASE_ANON_KEY     (from Supabase project)
  SUPABASE_SERVICE_ROLE_KEY         (from Supabase project - server only)
  OPENAI_API_KEY                    (from OpenAI - server only)
  BILLPLZ_API_KEY                   (from Billplz sandbox - server only)
  BILLPLZ_COLLECTION_ID             (from Billplz sandbox - server only)
  HITPAY_API_KEY                    (from HitPay - server only)
  HITPAY_SALT                       (from HitPay - server only)
  NEXT_PUBLIC_APP_URL               https://${PROJECT_NAME}.vercel.app

Optional (if using PocketBase for realtime):
  POCKETBASE_URL                    https://agmx-pb.fly.dev

EOF

# --- 4. Supabase Setup ---
log "Supabase setup required:"
cat <<EOF
1. Create Supabase project: https://supabase.com/dashboard/new
   - Name: agmx-v2
   - Region: Southeast Asia (Singapore)
   - Save credentials

2. Run in Supabase SQL Editor (in order):
   a) supabase/schema_final.sql     (core schema + RLS + RPCs)
   b) supabase/knowledge_final.sql  (pgvector knowledge store)

   Do NOT use schema.sql / knowledge_schema.sql for a new project: they
   enable RLS with zero policies, so every anon/authenticated read returns
   no rows, and neither check_rate_limit nor process_payment_webhook is
   defined there, so all three Edge Functions fail closed.

3. Realtime: schema_final.sql already manages the publication at the end of
   the file (attendance, quorum_snapshots, motions, questions) and removes
   `votes` from it deliberately — a realtime feed would stream ballots.

4. Deploy Edge Functions:
   supabase functions deploy money-flow --project-ref <ref>
   supabase functions deploy knowledge-query --project-ref <ref>
   supabase functions deploy knowledge-ingest --project-ref <ref>

5. Set Edge Function secrets:
   supabase secrets set OPENAI_API_KEY=sk-... --project-ref <ref>
   supabase secrets set BILLPLZ_API_KEY=... --project-ref <ref>
   supabase secrets set BILLPLZ_COLLECTION_ID=... --project-ref <ref>
   supabase secrets set HITPAY_API_KEY=... --project-ref <ref>
   supabase secrets set HITPAY_SALT=... --project-ref <ref>

EOF

# --- 5. Deploy ---
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