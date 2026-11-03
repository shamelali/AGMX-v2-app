#!/usr/bin/env bash
#
# AGMX — Set Supabase secrets for the Edge Functions
#
# Every name here is the exact string a function reads through Deno.env.get().
# The previous version of this script set SUPABASE_SECRET_KEY only, which
# money-flow never reads — it asks for SUPABASE_SERVICE_ROLE_KEY and dies at
# boot on `Deno.env.get(...)!` when that is undefined. Setting a name and
# believing the function is configured is how a gateway goes live while every
# request 500s.
#
#   governance      → SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#   money-flow      → SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#                     BILLPLZ_API_KEY, BILLPLZ_COLLECTION_ID, BILLPLZ_X_SIGNATURE,
#                     BILLPLZ_API_URL, HITPAY_API_KEY, HITPAY_SALT,
#                     HITPAY_API_URL, APP_URL
#   knowledge-*     → SUPABASE_URL, SUPABASE_SECRET_KEY (+ LLM_* in _shared/llm.ts)
#
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are also injected by the Edge
# Runtime. They are written explicitly here because a key rotation is not
# observable from the dashboard, and a stale value pinned as a secret fails
# loudly rather than silently.
#
# Prerequisites (blocked until you provide credentials):
#   1. Billplz dashboard login -> rotate Secret key (BILLPLZ_API_KEY) AND
#      generate/copy the X Signature key (BILLPLZ_X_SIGNATURE).
#      These are TWO separate credentials and must NOT be interchanged
#      (the API key was wrongly used for signature verification until 2026-10-18).
#   2. A Supabase project created on supabase.com -> get SUPABASE_URL and the
#      service-role key from the dashboard > Settings > API.
#   3. If a gateway key was ever pasted into a chat, an issue, or a committed
#      file: rotate it at the provider first. This script cannot un-leak it.
#
# Usage:
#   chmod +x scripts/set-supabase-secrets.sh
#   ./scripts/set-supabase-secrets.sh
#
# Requires the Supabase CLI: https://supabase.com/docs/guides/cli
#   npm install -g supabase
#   supabase login
#   supabase link --project-ref <PROJECT_REF>
#

set -euo pipefail

echo "==> AGMX: Setting Supabase secrets for the Edge Functions"
echo

# ---------------------------------------------------------------------------
# Billplz credentials (from the Billplz dashboard, AFTER you regain login)
# ---------------------------------------------------------------------------
read -r -p "Enter BILLPLZ_API_KEY (Secret key, HTTP Basic Auth; blank to skip Billplz): " BILLPLZ_API_KEY
BILLPLZ_X_SIGNATURE=""
BILLPLZ_COLLECTION_ID=""
if [ -n "$BILLPLZ_API_KEY" ]; then
  read -r -s -p "Enter BILLPLZ_X_SIGNATURE (X Signature key, HMAC for callbacks): " BILLPLZ_X_SIGNATURE
  echo
  read -r -p "Enter BILLPLZ_COLLECTION_ID: " BILLPLZ_COLLECTION_ID
fi
# Production or sandbox, spelled out. money-flow defaults to
# https://www.billplz-sandbox.com when this is unset, so real keys with no URL
# here create sandbox bills: the payer is charged nothing and the webhook never
# reaches production.
read -r -p "Enter BILLPLZ_API_URL [https://www.billplz.com]: " BILLPLZ_API_URL
BILLPLZ_API_URL="${BILLPLZ_API_URL:-https://www.billplz.com}"

# ---------------------------------------------------------------------------
# HitPay — leave blank to keep bank transfer only
# ---------------------------------------------------------------------------
read -r -p "Enter HITPAY_API_KEY (blank to skip HitPay): " HITPAY_API_KEY
HITPAY_SALT=""
HITPAY_API_URL="https://api.hit-pay.com"
if [ -n "$HITPAY_API_KEY" ]; then
  # Dashboard → Developers → Webhooks → your endpoint → Signing salt.
  read -r -s -p "Enter HITPAY_SALT (per-webhook signing salt): " HITPAY_SALT
  echo
  read -r -p "Enter HITPAY_API_URL [https://api.hit-pay.com]: " HITPAY_API_URL
  HITPAY_API_URL="${HITPAY_API_URL:-https://api.hit-pay.com}"
fi

if [ -z "$BILLPLZ_API_KEY" ] && [ -z "$HITPAY_API_KEY" ]; then
  echo "    No gateway keys: leaving payments in bank-transfer mode. /api/config.js"
  echo "    derives paymentsMode from key presence, so nothing has to be unset here."
fi

# ---------------------------------------------------------------------------
# Supabase project credentials (dashboard > Settings > API)
# ---------------------------------------------------------------------------
read -r -p "Enter SUPABASE_URL (https://<ref>.supabase.co): " SUPABASE_URL
read -r -s -p "Enter the service_role key: " SUPABASE_SERVICE_ROLE_KEY
echo
# knowledge-query and knowledge-ingest read the same service key under a
# different name (SUPABASE_SECRET_KEY). Left blank, those functions stay down.
read -r -s -p "Re-enter the same key for SUPABASE_SECRET_KEY (blank to skip knowledge-*): " SUPABASE_SECRET_KEY
echo
read -r -p "Enter APP_URL [https://agmx-v2-app-ecru.vercel.app]: " APP_URL
APP_URL="${APP_URL:-https://agmx-v2-app-ecru.vercel.app}"

# ---------------------------------------------------------------------------
# Write them
# ---------------------------------------------------------------------------
# Values go through a 0700 directory / 0600 file and --env-file rather than
# NAME=VALUE arguments: argv is readable by any process listing on the machine
# (`ps e`, /proc/<pid>/cmdline) and lands in shell history for the CLI's own
# invocation. `set -x` would print them too, so nothing here is echoed.
TMP_DIR=$(mktemp -d)
chmod 700 "$TMP_DIR"
ENV_FILE="$TMP_DIR/secrets.env"
chmod 600 "$ENV_FILE"
trap 'rm -rf "$TMP_DIR"' EXIT

{
  printf 'SUPABASE_URL=%s\n' "$SUPABASE_URL"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SUPABASE_SERVICE_ROLE_KEY"
  printf 'APP_URL=%s\n' "$APP_URL"
  [ -n "$SUPABASE_SECRET_KEY" ]   && printf 'SUPABASE_SECRET_KEY=%s\n' "$SUPABASE_SECRET_KEY"
  [ -n "$BILLPLZ_API_KEY" ]       && printf 'BILLPLZ_API_KEY=%s\n' "$BILLPLZ_API_KEY"
  [ -n "$BILLPLZ_API_KEY" ]       && printf 'BILLPLZ_API_URL=%s\n' "$BILLPLZ_API_URL"
  [ -n "$BILLPLZ_API_KEY" ]       && printf 'BILLPLZ_X_SIGNATURE=%s\n' "$BILLPLZ_X_SIGNATURE"
  [ -n "$BILLPLZ_API_KEY" ]       && printf 'BILLPLZ_COLLECTION_ID=%s\n' "$BILLPLZ_COLLECTION_ID"
  [ -n "$HITPAY_API_KEY" ]        && printf 'HITPAY_API_KEY=%s\n' "$HITPAY_API_KEY"
  [ -n "$HITPAY_API_KEY" ]        && printf 'HITPAY_API_URL=%s\n' "$HITPAY_API_URL"
  [ -n "$HITPAY_API_KEY" ]        && printf 'HITPAY_SALT=%s\n' "$HITPAY_SALT"
  true
} > "$ENV_FILE"

echo
echo "==> Writing $(grep -c '^[A-Z]' "$ENV_FILE") secret(s) to the linked project..."
supabase secrets set --env-file "$ENV_FILE"

echo
echo "==> Verify the names landed (values are not printed by this command):"
echo "    supabase secrets list"
echo
echo "==> Deploy the Edge Functions. verify_jwt is declared in supabase/config.toml:"
echo "    supabase functions deploy governance"
echo "    supabase functions deploy money-flow"
echo "    supabase functions deploy knowledge-query    # only if SUPABASE_SECRET_KEY was set"
echo "    supabase functions deploy knowledge-ingest   # only if SUPABASE_SECRET_KEY was set"
echo
echo "==> Register this as the Billplz callback URL (Billplz dashboard → collection):"
echo "    ${SUPABASE_URL}/functions/v1/money-flow/payment/confirm"
echo
echo "==> And this redirect URL (where Billplz sends the payer after payment):"
echo "    ${APP_URL}/checkout.html"
echo
echo "==> Apply the Supabase schema (payment tables + RLS + process_payment_webhook RPC):"
echo "    supabase db push            # applies supabase/migrations/0001…0007 in order"
echo "    # schema_final.sql is the generated single-file equivalent for the"
echo "    # dashboard SQL editor; never hand-edit it (tools/build_schema_bundle.py)."
echo
