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

## ✅ Sprint 6 — Prove it (Complete)

- [x] 🧪 **Full e2e test: assessment → payment → AGM scheduled → meeting run →
      minutes produced** — `tools/test_agm_journey.mjs` boots
      `supabase/schema_final.sql` on embedded real Postgres and drives the actual
      `money-flow` and `governance` handlers: 120 assertions, no credentials, no
      network, wired as `tools/check.sh` §24. §25 (`tools/test_bundle_replay.mjs`)
      then applies the same bundle twice and proves it is rerun-safe.
- [x] 🐞 **Six governance-SQL defects found by those two checks** — `cast_vote`
      called `max(boolean)` (every ballot would 500), its quorum guard read
      `coalesce(...) INTO` a variable (an AGM with no attendance failed *open*),
      two RPCs used undeclared plpgsql variables, `record_resolution` assigned
      jsonb into a `uuid`, `audit_events.organization_id NOT NULL` silently
      dropped a prospect's own record, and `log_audit()`'s chain head read meant
      **no governance audit event was ever written**. Fixed in `0007`/`0008`/`0009`.

## 📋 Remaining

- [ ] 🔴 **Apply migrations 0007–0009 to production** (`supabase db push --project-ref
      jchfalaibabmszewemat`). The fixes are proven offline only — **no remote
      project has been touched**, so production still cannot record a vote or an
      AGM audit event. Operator action; it carries real money and an audited
      record, so it is not automated here.
- [ ] 🌐 Custom domain configuration for agmx-v2.vercel.app — needs the owner's
      hostname plus Vercel and DNS actions, then `check.sh` §19 (canonical host is
      derived from `sitemap.xml`) and §23 (live probes assume `*.vercel.app`) both
      change.
- [ ] 🎨 White-label co-op portal configuration — **unbuilt**: no branding or theme
      column exists in the schema, so this is a scope decision first (which fields,
      which pages, who may upload a logo, and what a co-op's own domain does to
      §19/§23).

---

*Source: AGMX_V2_PLAN.md §10 Immediate next actions, §12 Deployment smoke-test matrix*
