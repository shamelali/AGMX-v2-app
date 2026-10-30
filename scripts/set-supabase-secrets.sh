#!/usr/bin/env bash
#
# AGMX — Set Supabase secrets for the money-flow Edge Function (Sprint 2)
#
# Prerequisites (blocked until you provide credentials):
#   1. Billplz dashboard login -> rotate Secret key (BILLPLZ_API_KEY) AND
#      generate/copy the X Signature key (BILLPLZ_X_SIGNATURE).
#      These are TWO separate credentials and must NOT be interchanged
#      (the API key was wrongly used for signature verification until 2026-10-18).
#   2. A Supabase project created on supabase.com -> get SUPABASE_URL and
#      SUPABASE_SECRET_KEY (service-role key) from the dashboard > Settings > API.
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

echo "==> AGMX: Setting Supabase secrets for money-flow Edge Function"
echo

# ---------------------------------------------------------------------------
# Billplz credentials (from the Billplz dashboard, AFTER you regain login)
# ---------------------------------------------------------------------------
read -r -p "Enter BILLPLZ_API_KEY (Secret key, HTTP Basic Auth): " BILLPLZ_API_KEY
read -r -s -p "Enter BILLPLZ_X_SIGNATURE (X Signature key, HMAC for callbacks): " BILLPLZ_X_SIGNATURE
echo
read -r -p "Enter BILLPLZ_COLLECTION_ID: " BILLPLZ_COLLECTION_ID

# ---------------------------------------------------------------------------
# Supabase project credentials (from supabase.com dashboard > Settings > API)
# ---------------------------------------------------------------------------
read -r -p "Enter SUPABASE_URL: " SUPABASE_URL
read -r -s -p "Enter SUPABASE_SECRET_KEY (service_role key): " SUPABASE_SECRET_KEY
echo
read -r -p "Enter APP_URL [https://agmx-v2-app.vercel.app]: " APP_URL
APP_URL="${APP_URL:-https://agmx-v2-app.vercel.app}"

echo
echo "==> Writing secrets to Supabase..."

supabase secrets set \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SECRET_KEY="$SUPABASE_SECRET_KEY" \
  BILLPLZ_API_KEY="$BILLPLZ_API_KEY" \
  BILLPLZ_X_SIGNATURE="$BILLPLZ_X_SIGNATURE" \
  BILLPLZ_COLLECTION_ID="$BILLPLZ_COLLECTION_ID" \
  APP_URL="$APP_URL"

echo
echo "==> Done. Deploy the Edge Function with:"
echo "    supabase functions deploy money-flow"
echo
echo "==> Then register this webhook URL as BILLPLZ_CALLBACK_URL in Billplz:"
echo "    ${SUPABASE_URL}/functions/v1/money-flow/payment/confirm"
echo
echo "==> And this redirect URL (where Billplz sends the payer after payment):"
echo "    ${APP_URL}/checkout.html"
echo
echo "==> Apply the Supabase schema (payment tables + RLS + process_payment_webhook RPC):"
echo "    supabase db push   (uses supabase/schema_final.sql)"
echo
