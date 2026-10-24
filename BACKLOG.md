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

## Sprint 1 (NOW) — Get Paid

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP1-01 | AGM Assessment → Quote | Frontend ✅ | Done |
| SP1-02 | Vercel fix | ✅ | Done |
| SP1-03 | Payment backend | ⏳ | Pending Supabase RPCs |
| SP1-04 | Deploy Vercel fix to production | ⏳ | Immediate next action |
| SP1-05 | Run production smoke-test matrix | ⏳ | Immediate next action |
| SP1-06 | Freeze current UI as V1 baseline | ⏳ | Immediate next action |

## Sprint 2 — Money

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP2-01 | Lead → Assessment → Quote → Invoice → Payment | Supabase RPCs + minimal API | Planned |
| SP2-02 | Scheduled AGM creation | Minimal API | Planned |

## Sprint 3 — Recurring

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP3-01 | Subscriptions + billing | Annual plans | Planned |

## Sprint 4 — Governance OS

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP4-01 | Meetings, resolutions, compliance, documents, actions, audit | Beyond AGM day | Planned |

## Sprint 5+ — Partner & Federation

| ID | Title | Deliverable | State |
|----|-------|-------------|-------|
| SP5-01 | Partner portal | Federation roll-up dashboard | Planned |
| SP5-02 | Federation organizations | Multi-cooperative federation | Planned |

## Immediate Next Actions (unchecked)

- [ ] Deploy the Vercel fix to production
- [ ] Run production smoke-test matrix
- [ ] Freeze current UI as V1 baseline
- [ ] Stand up Supabase project + apply schema + RLS policies
- [ ] Assessment → quote → invoice → payment (Sprint 2)

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

- [ ] Billplz API key — was publicly served ~15 min on 2026-10-17
- [ ] Billplz portal password (`lindan95`) — was pasted in plaintext

---

*Source: AGMX_V2_PLAN.md, REPO_AND_VERCEL_STATUS.md*