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
| SP4-02 | Apply the governance SQL fixes to production | `supabase db push` | **Open — operator action; no remote project has been touched** |

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

## Immediate Next Actions (unchecked)

- [ ] Apply migrations 0007–0009 to project `jchfalaibabmszewemat` (SP4-02)
- [ ] Custom domain — owner's hostname, Vercel + DNS, then rewrite §19/§23
- [ ] White-label co-op portal — needs a scope decision; no branding/theme fields exist in the schema
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