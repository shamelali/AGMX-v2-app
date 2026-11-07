# AGMX — Todo (Immediate Next Actions)

> **⏱️ Timebox rule (Slow Burn, 10%).** AGMX gets **max 2 hours per week**,
> in one scheduled block — it does not touch DutaOS revenue hours. Work the
> list top-down; when the block ends, stop. No guilt, no spill-over.

## ✅ Completed — Production Live

- [x] 🔐 **Rotate Billplz API key + portal password** — N/A: using HitPay, not Billplz
- [x] 🔐 **Rotate NVIDIA NIM API key** — placeholder was scrubbed; real key set in Supabase secrets
- [x] 🚀 **Deploy the Vercel fix to production** — deployed at https://agmx-v2.vercel.app
- [x] 🧪 **Run production smoke-test matrix** — 22/22 passing
- [x] 📋 **Freeze current UI as V1 baseline** — committed `fcacb64`, pushed to `origin/main` (the branch was `master` then; it was deleted in favour of `main`)

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

## ✅ Closed 2026-11-05 — production caught up with this tree

- [x] 🔴 **Production was running the pre-fix governance SQL.** `0007`–`0009` are
      recorded in `supabase_migrations.schema_migrations`, so `supabase db push`
      called them applied and skipped them — but `0007` and `0008` had each been
      edited in place *after* their first apply. `pg_proc.prosrc` showed the truth:
      `cast_vote` still calling `max(boolean)` (every ballot errors), its quorum
      guard still `select coalesce(max(satisfied), false) into v_satisfied` (an AGM
      with no attendance fails **open**), `log_audit()` still reading the chain head
      with a no-row `SELECT INTO` — so `audit_events` held **0 rows** — and
      `record_resolution` assigning jsonb into a `uuid`. Re-applied
      `0007`→`0008`→`0009`→`0010` in order against `jchfalaibabmszewemat`; every
      definition is `create or replace` and every table held 0 rows, so nothing was
      at risk. All 22 bundle-defined functions now match `schema_final.sql` by body
      hash, and §24's journey is the proof the same text produces votes and a
      chained audit trail.
- [x] 📥 **`0010_white_label_branding.sql` captured from production.** It had been
      applied there a day earlier with no file in this tree, while this list
      asserted no branding column existed anywhere.
- [x] 🔗 **`supabase link` run** — §23 can now read the deployed `APP_URL` and
      confirms it digests to `agmx-v2.vercel.app`, so the receipt links
      money-flow generates point at this site.
- [x] 🚀 **`4b7422d` deployed to production** via `vercel --prod`. `/api/health`
      answers `payments {provider:"hitpay", can_charge:true, configured:true}`
      instead of calling a working HitPay integration an unconfigured Billplz;
      `HITPAY_API_KEY` and `HITPAY_SALT` are confirmed present as Production
      secrets.
- [x] 🩺 **`check.sh` §26 added** (`tools/test_production_drift.mjs`) — hashes
      `pg_proc.prosrc` against the generated bundle and reconciles the versions
      recorded in `supabase_migrations.schema_migrations` with the files that
      describe them. Passes 21/24/25 read files, so they agreed with each other the
      whole time. Proven to detect both failure modes: a mutated body is named, and
      hiding `0010` reports it as remote-only. An unlinked project warns
      instead of failing, so the pre-commit hook stays green without credentials.
- [x] 🩺 **`check.sh` §27 added** (`tools/test_production_ballot_path.mjs`) — the live
      ballot path, proven read-only. `cast_vote`'s first statement selects a motion by
      id and returns when none matches, so a random uuid exercises the production
      function without reaching an insert, and `votes`/`audit_events` are counted
      before and after to prove that (an append-only `audit_events` row written in
      error could never be taken back). It also reads the live bodies as text rather
      than trusting §26's hash: the defective `coalesce(max(satisfied), false) into`
      guard is gone, the fixed latest-snapshot read is there, `log_audit()` matches a
      NULL organization and seeds its own chain head, and this engine has no
      `max(boolean)` at all — so the text production ran was fatal there, not untidy.
      It paid for itself immediately by failing on its own first assertion: `max(`
      matched the fix's explanatory comment, so prose about a defect was being read as
      the defect. Suite: 80 passed · 3 warnings · 0 failed.

## 📋 Remaining

- [ ] 🏭 **GitHub Actions is locked for billing, so CI deploys nothing.** Every run
      on `master` fails in ~2s with *"The job was not started because your account
      is locked due to a billing issue."* Deploys are CLI-only until that clears.
      `deploy.sh` and `deploy.yml` both named team `duta-integra`, which this
      credential does not have (`vercel team ls` returns only `shamel-projects`,
      where `agmx-v2-app` lives) — corrected, but CI cannot run it yet.
      Side effect to expect: deploying from a linked worktree leaves
      `deployment.commit` **null**, because Vercel attaches VCS metadata only from a
      real `.git` directory. Deploy from the primary checkout when the live commit
      needs to be identifiable.
- [ ] ☁️ **Supabase branching needs the Pro plan** — create answers 402
      `entitlement_required` ("Branching is supported only on the Pro plan or above"),
      so §9's journey cannot be replayed against a copy of production, which is the
      only place `archive/docs/REPO_AND_VERCEL_STATUS.md` permits writing. §27 is the read-only
      substitute: it proves the live bodies and that `cast_vote` executes, but no
      check here has yet recorded a real ballot in a real-time-shaped database.
- [x] 🧠 RAG now advertises only what exists: `/api/config` publishes
      `knowledgeRagEnabled:false` because no provider key exists on this
      platform, and `/api/health` reports the same absence by the real variable
      names (`NVIDIA_NIM_API_KEY`/`NGC_API_KEY` for `LLM_PROVIDER=nvidia`).
      Both knowledge functions are deployed and load — a non-POST answers 405
      with the provider they select, and a query without a key answers
      `503 LLM_NOT_CONFIGURED` naming the missing variable. Remaining work is to
      set a provider key on both platforms, not to change the flag's meaning.
- [ ] 🌐 Custom domain configuration for agmx-v2.vercel.app — needs the owner's
      hostname plus Vercel and DNS actions, then `check.sh` §19 (canonical host is
      derived from `sitemap.xml`) and §23 (live probes assume `*.vercel.app`) both
      change.
- [ ] 🎨 White-label co-op portal — **the schema exists, the portal does not.**
      `0010` gives `organizations.logo_url` and `primary_color` (default `#2563EB`),
      but no page reads either column, nothing uploads a logo, and no policy says
      who may. Still a scope decision first (which fields, which pages, who uploads,
      and what a co-op's own domain does to §19/§23).

---

*Source: AGMX_V2_PLAN.md §10 Immediate next actions, §12 Deployment smoke-test matrix*
