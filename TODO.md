# AGMX — Todo (Immediate Next Actions)

> **⏱️ Timebox rule (Slow Burn, 10%).** AGMX gets **max 2 hours per week**,
> in one scheduled block — it does not touch DutaOS revenue hours. Work the
> list top-down; when the block ends, stop. No guilt, no spill-over.

## ✅ Completed — Production Live

- [x] 🔐 **Rotate Billplz API key + portal password** — N/A: using HitPay, not Billplz
- [x] 🔐 **Rotate NVIDIA NIM API key** — placeholder was scrubbed; real key set in Supabase secrets
- [x] 🚀 **Deploy the Vercel fix to production** — deployed at https://agmx-v2.vercel.app
- [x] 🧪 **Run production smoke-test matrix** — 22/22 passing
- [x] 📋 **Freeze current UI as V1 baseline** — committed `fcacb64`, pushed to `origin/master`

## 🏗️ Sprint 1 — Get Paid (Complete)

- [x] Stand up Supabase project + apply schema + RLS policies — `jchfalaibabmszewemat`
- [x] Assessment → Quote → Invoice → Payment backend — money-flow RPCs + HitPay
- [x] Deploy payment backend to production — all 4 Edge Functions ACTIVE

## 🏗️ Sprint 2 — Money (Complete)

- [x] Lead → Assessment → Quote → Invoice → Payment → Scheduled AGM
- [x] AGM scheduling page — `/agm-schedule.html`, wired from checkout receipt
- [x] Member management — `/member-management.html`, real Supabase data

## 🏗️ Sprint 3 — Recurring (Complete)

- [x] Subscriptions + billing (annual plans) — `/subscription-management.html`
- [x] Backend RPCs: create_subscription_from_quote, process_subscription_renewal, cancel_subscription, generate_invoice_from_recurring
- [x] HitPay gateway integration — `paymentsMode: all`

## 🏗️ Sprint 4 — Governance OS (Complete)

- [x] Meetings, resolutions, compliance, documents, actions, audit
- [x] Backend RPCs: start_agm, close_agm, create_motion, cast_vote, record_resolution, create_action, run_compliance, register_document
- [x] SPA views: AGM hall, governance register — `#/agm`, `#/governance`

## 🏗️ Sprint 5+ — Partner & Federation (Complete)

- [x] Partner portal — `/partner-portal.html`, real Supabase data
- [x] Federation roll-up dashboard — `/federation-dashboard.html`, real Supabase data

## 📋 Remaining (Optional)

- [ ] Full e2e test: assessment → payment → AGM scheduled → meeting run → minutes produced
- [ ] Custom domain configuration for agmx-v2.vercel.app
- [ ] White-label co-op portal configuration

---

*Source: AGMX_V2_PLAN.md §10 Immediate next actions, §12 Deployment smoke-test matrix*
