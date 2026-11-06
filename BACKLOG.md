# AGMX — Backlog

Auto-populated from AGMX_V2_PLAN.md (revenue roadmap, sprints, acceptance tests).

## Product Line 1: AGMX Managed AGM (One-off per AGM)

| ID | Title | Price | State | Notes |
|----|-------|-------|-------|-------|
| AGMX-01 | Essential package | RM1,500 / AGM | Build now | score < 35 |
| AGMX-02 | Professional package | RM3,500 / AGM | Build now | score 35–64, recommended default |
| AGMX-03 | Enterprise package | RM7,500+ / AGM | Build now | score ≥ 65 or ≥ 2,000 members |

## Product Line 2: AGMX Governance OS (Annual SaaS)

| ID | Title | Price/Month | State | Members |
|----|-------|-------------|-------|---------|
| OS-01 | Essential tier | RM600 | After #1 | < 300 members |
| OS-02 | Professional tier | RM800 | After #1 | < 1,000 members |
| OS-03 | Enterprise tier | RM1,000 | After #1 | < 2,000 members |
| OS-04 | Federation tier | RM1,250 | After #1 | 2,000+ members |

> Sprints 1–5+ shipped. The states below are what `tools/check.sh` can prove
> offline; anything that needs the live project says so.

## Sprint 1 — Get Paid

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP1-01 | AGM Assessment → Quote | Frontend + scoring | Done — `tools/test_assessment_scoring.js` |
| SP1-02 | Vercel fix | Static routing + security headers | Done — `check.sh` §3, deployed |
| SP1-03 | Payment backend | money-flow Edge Function on HitPay | Done — `tools/test_money_flow.mjs`, `tools/test_money_flow_auth.mjs` |

## Sprint 2 — Money

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP2-01 | Lead → Assessment → Quote → Invoice → Payment | Supabase RPCs | Done — §24 drives it end to end on real Postgres |
| SP2-02 | Scheduled AGM creation | `agm-schedule.html` | Done |

## Sprint 3 — Recurring

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP3-01 | Subscriptions + billing | Annual plans | Done — `tools/test_subscription_client.js`, migrations 0006 |

## Sprint 4 — Governance OS

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP4-01 | Meetings, resolutions, compliance, documents, actions, audit | Beyond AGM day | Done — plpgsql enforcement, exercised by §24/§25 |
| SP4-02 | Apply the governance SQL fixes to production | re-apply `0007`→`0010` as SQL | Done 2026-11-05 — `db push` could not have done it: the versions were already recorded while `0007`/`0008` had been edited in place, so production still ran the pre-fix bodies. Verified by `prosrc` hash against the bundle |

## Sprint 5+ — Partner & Federation

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP5-01 | Partner portal | `partner-portal.html` | Done — real Supabase data |
| SP5-02 | Federation organizations | `federation-dashboard.html` | Done for the roll-up view; consolidated multi-co-op reporting is still planned |

## Sprint 6 — Prove it

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP6-01 | §9 acceptance journey as a repository check | `tools/test_agm_journey.mjs` | Done — `check.sh` §24, 120 assertions |
| SP6-02 | Deploy bundle rerun-safety | `tools/test_bundle_replay.mjs` | Done — `check.sh` §25 |
| SP6-03 | The live project still runs this tree's SQL | `tools/test_production_drift.mjs` | Done — `check.sh` §26: 22 function bodies by `prosrc` hash, recorded migration versions against the files that describe them. Exists because §24/§25 read files and so agreed with themselves while production ran the pre-fix `cast_vote` and `log_audit` |
| SP6-04 | The live ballot path is the repaired one | `tools/test_production_ballot_path.mjs` | Done — `check.sh` §27: 12 read-only assertions against the linked project, `votes`/`audit_events` counted before and after to prove the probe wrote nothing. A ballot actually recorded still needs a branch, and branching needs the Pro plan |

## Immediate Next Actions (unchecked)

- [ ] Clear the GitHub Actions billing lock — CI deploys nothing until it does, so
      production moves only by `vercel --prod --scope=shamel-projects`
- [ ] Custom domain — owner's hostname, Vercel + DNS, then rewrite §19/§23
- [ ] White-label co-op portal — the schema arrived as `0010`
      (`organizations.logo_url`, `primary_color`), but no page reads either column
      and no policy says who may set one, so the scope decision is still open
- [ ] Set a provider key on both platforms to turn the knowledge room on:
      `NVIDIA_NIM_API_KEY` (or `NGC_API_KEY`) with `LLM_PROVIDER=nvidia`, or
      `OPENAI_API_KEY` with `LLM_PROVIDER=openai`. `/api/config` publishes
      `knowledgeRagEnabled:false` until one exists, and `/api/health` reports the
      same absence by the same names
- [ ] Set the `DEPLOY.md` secrets in the Supabase project

## Deployment Smoke-Test Matrix

| URL | Expect | State |
|-----|--------|-------|
| `/`, `/index.html`, `/app.html` | 200 real files | Verify |
| `/styles.css`, `/app.js`, `/data.js` | 200 real files | Verify |
| `/sw.js`, `/manifest.json` | 200 real files | Verify |
| `/robots.txt`, `/sitemap.xml` | 200 real files | Verify |
| `/assets/*` | 200 real files | Verify |
| `/app`, unknown SPA route | index.html fallback | Verify |

## Credentials to Rotate (Security)

> Billplz is retired; the product is on HitPay, so these two are closed as
> not-applicable rather than pending. The keys that matter now are `HITPAY_*` and
> `DEEPSEEK_API_KEY` in the Supabase project (see `DEPLOY.md`).

---

*Source: AGMX_V2_PLAN.md, REPO_AND_VERCEL_STATUS.md*