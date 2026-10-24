# AGMX V2 — Revenue-Ready Cooperative Governance OS

**Status: PLAN (active)** · Branch: `feat/revenue-ready-mvp` · Updated 2026-08-12

---

## 1. Strategy in one sentence

> **Turn the AGM prototype into a revenue engine: a Malaysian cooperative pays AGMX, runs a compliant AGM, and converts into an annual governance subscription.**

North-star metric: **Paid AGMs Successfully Completed**.
Secondary: assessment→paid conversion · AGM completion rate · annual-sub conversion · revenue per cooperative · retention · partner-sourced co-ops.

## 2. Product lines (build in this order)

| # | Product | Revenue model | State |
|---|---|---|---|
| 1 | **AGMX Managed AGM** | One-off per AGM (RM1,500 / 3,500 / 7,500+) | 🟢 build now |
| 2 | **AGMX Governance OS** | Annual SaaS (RM600–1,250/mo) | 🔵 after #1 |
| 3 | **Compliance & Audit OS** | Retention/expansion | 🟣 later |
| 4 | **Federation / Partner Platform** | Enterprise (RM50k–300k+/yr) | ⚫ later |

## 3. The revenue workflow

```text
LEAD (public website)
  → AGM Assessment (free, 12 questions)   ← assessment.html (built)
  → Complexity Score (0–100)              ← assessment.js (built)
  → Package recommendation + Quote        ← built
  → Payment (invoice)                     → pending backend
  → AGM Setup → Members → Notice → Registration → Quorum
  → AGM Live → Voting → Motions → Resolutions
  → Minutes → Actions → Compliance Report → Audit Vault
  → Annual Subscription conversion
```

Sales wedge: *"Bila AGM koperasi anda akan datang?"* — not "would you like to subscribe?"

## 4. Commercial packages (current)

### AGM Service (one-off)
| Package | Price | Threshold |
|---|---|---|
| Essential | RM1,500 / AGM | score < 35 |
| **Professional** (recommended default) | RM3,500 / AGM | 35–64 |
| Enterprise | RM7,500+ / AGM | ≥ 65 or ≥ 2,000 members |

### Governance OS (annual, after AGM)
| Tier | RM/month | Members |
|---|---|---|
| Essential | 600 | < 300 |
| Professional | 800 | < 1,000 |
| Enterprise | 1,000 | < 2,000 |
| Federation | 1,250 | 2,000+ |

## 5. Architecture

**Rule: keep the UI, replace the fake data.**

```text
Static SPA (app.js + styles.css + data.js)
   ↓ replace window.MC_DATA with
Supabase / PostgreSQL
   ↓
API (REST / RLS)
   ↓
Existing 13-view UI
```

- **Tenancy boundary = `organization_id`** on every business table.
- **Append-only** tables: `votes`, `audit_events` (no UPDATE/DELETE).
- **Demo data (`data.js`) is NOT production** — new records come from the DB only.
- No framework, no build step — the SPA stays as-is; new pages (assessment, quote) are plain HTML+JS using `styles.css`.

## 6. Production DB (foundation committed)

`supabase/schema.sql` — 30+ tables across:

```text
identity/tenancy   organizations, profiles, organization_members
commercial         plans, subscriptions, agm_assessments, quotes, quote_items, invoices, payments
members            members, member_status_history
agm                agms, agm_settings, agenda_items, agm_notices, notice_recipients, attendance, quorum_snapshots
governance         motions, votes, resolutions, questions, actions
compliance         compliance_rules, compliance_checks, compliance_findings
evidence           documents, audit_events
distribution       partners, partner_organizations, federations, federation_organizations
```

Plus RLS enablement on all tables and a `current_org_id()` helper (policy examples included).

## 7. Sprints

| Sprint | Focus | Deliverable |
|---|---|---|
| **1 (NOW)** | **Get paid** | AGM Assessment → Quote (frontend ✅) · Vercel fix ✅ · payment backend ⏳ |
| 2 | Money | Lead → Assessment → Quote → Invoice → Payment → Scheduled AGM (Supabase RPCs + minimal API) |
| 3 | Recurring | Subscriptions + billing (annual plans) |
| 4 | Governance OS | Meetings, resolutions, compliance, documents, actions, audit beyond AGM day |
| 5+ | Partner & Federation | Partner portal, federation roll-up dashboard |

## 8. Red-team note (credibility)

Separate **Implemented / Simulated / Planned** in all external comms:
- **Implemented:** UI flows, assessment engine, demo voting.
- **Simulated (prototype only):** AES-256 guarantees, immutable hash chain, AI RAG over 1,247 docs, compliance auto-audit — currently client-side mock.
- **Planned:** server-side enforcement, real encryption at rest, real RAG, real audit chain.

Never present simulated capabilities as production guarantees to cooperatives, auditors, or institutional partners.

## 9. Acceptance test (definition of done for MVP)

> **A real Malaysian cooperative submits an AGM assessment, receives a package recommendation + quote, pays AGMX, creates its AGM, imports members, establishes quorum, runs live voting, produces resolutions/minutes, and retains an auditable record.**

## 10. Immediate next actions

- [x] Fix `vercel.json` (filesystem handler) — branch `fix/vercel-static-routing`
- [x] Add `robots.txt` + `sitemap.xml`
- [x] Build `assessment.html` + `assessment.js` (Assessment → Score → Package → Quote → Lead demo)
- [x] Write `supabase/schema.sql`
- [ ] Deploy the Vercel fix to production
- [ ] Run production smoke-test matrix (see below)
- [ ] Freeze current UI as V1 baseline
- [ ] Stand up Supabase project + apply schema + RLS policies
- [ ] Assessment → quote → invoice → payment (Sprint 2)

### Deployment smoke-test matrix
| URL | Expect |
|---|---|
| `/`, `/index.html`, `/app.html` | 200 real files |
| `/styles.css`, `/app.js`, `/data.js` | 200 real files |
| `/sw.js`, `/manifest.json` | 200 real files |
| `/robots.txt`, `/sitemap.xml` | 200 real files |
| `/assets/*` | 200 real files |
| `/app`, unknown SPA route | index.html fallback |
