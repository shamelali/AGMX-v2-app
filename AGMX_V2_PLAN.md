# AGMX V2 — Revenue-Ready Cooperative Governance OS

**Status: DELIVERED through Sprint 5+; production live** · Branch: `master` · Updated 2026-11-05

> **What changed since the 2026-08-12 plan.** §1–§4 (strategy, product lines,
> revenue workflow, packages) still describe the product and are unchanged.
> §5–§7 and §10 described a plan; they now describe a shipped system, so they
> have been rewritten against the tree — with §8's rule intact: a capability is
> listed where a check can point at it.

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

**Rule: keep the UI, replace the fake data.** — done; the SPA now talks to Supabase
through one adapter.

```text
Static SPA (app.js + styles.css + governance-ui.js)
   ↓ window.MC_DATA replaced by
api.js  ← /api/config.js decides the adapter; demoMode:false selects Supabase
   ↓
Supabase on Vercel
   ├─ Postgres  supabase/schema_final.sql (RLS + RPCs + triggers)
   ├─ Edge Functions  money-flow · governance · knowledge-ingest · knowledge-query
   └─ Storage  documents
```

- `pocketbase-client.js` and the Fly.io container are **retired**; naming
  PocketBase as a live option fails `tools/check.sh` §22.
- The client never throws: a PostgREST error arrives as `{data, error}` with the
  SQLSTATE in `error.code`, which is what §24's harness reproduces.

- **Tenancy boundary = `organization_id`** on every business table.
- **Append-only** tables: `votes`, `audit_events` (no UPDATE/DELETE).
- **Demo data (`data.js`) is NOT production** — new records come from the DB only.
- No framework, no build step — the SPA stays as-is; new pages (assessment, quote) are plain HTML+JS using `styles.css`.

## 6. Production DB (deployed)

> **Backend decision (2026-10-30): Supabase is canonical.** The PocketBase v1
> layer and the Neon GraphRAG experiment are archived under `archive/` as
> reference only; Supabase is the only deployed backend path.

`supabase/schema_final.sql` is **generated** from `supabase/migrations/*.sql` by
`tools/build_schema_bundle.py` — nine migrations, 37 public tables, 44 RLS
policies, 23 functions. It is the file `DEPLOY.md` and `supabase/deploy.sh` tell
an operator to paste, so `tools/check.sh` §21 refuses a bundle that has drifted
from its migrations, §24 boots it on real embedded Postgres, and §25 applies it
twice to prove the rerun-safe claim in its own header.

| Domain | Tables |
|---|---|
| identity/tenancy | organizations, profiles, organization_members, members, member_status_history |
| commercial | plans, subscriptions, agm_assessments, quotes, quote_items, invoices, payments |
| agm | agms, agm_settings, agenda_items, agm_notices, notice_recipients, attendance, quorum_snapshots |
| governance | motions, votes, resolutions, questions, actions |
| compliance/evidence | compliance_rules, compliance_checks, compliance_findings, documents, audit_events |
| distribution | partners, partner_organizations, federations, federation_organizations |

Invariants, all of them executed by §24/§25 rather than asserted in prose:

- **Tenancy boundary = `organization_id`** on every business table; `votes` and
  `audit_events` are append-only (`raise_append_only()` triggers).
- **`audit_events` is hash-chained per organization** (`log_audit()` in SQL,
  `auditLog()` in the money-flow function, SHA-256 both ways), and
  `organization_id` is nullable so a prospect's own record survives (§0009).
- **Demo data (`data.js`) is NOT production** — new records come from the DB only.
- No framework, no build step — the SPA stays as-is; assessment, quote, AGM
  scheduling, member management, subscription, partner and federation pages are
  plain HTML+JS on `styles.css` against the real project.

## 7. Sprints

| Sprint | Focus | Deliverable | State |
|---|---|---|---|
| **1** | **Get paid** | AGM Assessment → Quote (frontend) · Vercel routing fix · payment backend | ✅ shipped — `money-flow` deploys quote/invoice/payment on HitPay |
| **2** | Money | Lead → Assessment → Quote → Invoice → Payment → Scheduled AGM | ✅ shipped — `agm-schedule.html`, `member-management.html` on real data |
| **3** | Recurring | Subscriptions + billing (annual plans) | ✅ shipped — `subscription-management.html`; RPCs `create_subscription_from_quote`, `process_subscription_renewal`, `cancel_subscription`, `generate_invoice_from_recurring` |
| **4** | Governance OS | Meetings, resolutions, compliance, documents, actions, audit beyond AGM day | ✅ shipped — `#/agm`, `#/governance`; server-side quorum, voting windows, thresholds, hash-chained audit |
| **5+** | Partner & Federation | Partner portal, federation roll-up dashboard | ✅ shipped — `partner-portal.html`, `federation-dashboard.html` |
| **6** | Prove it | §9's acceptance journey as a repository check | ✅ shipped — `tools/check.sh` §24 (120 assertions on real Postgres) and §25 (bundle replay + audit trail) |

## 8. Red-team note (credibility)

Separate **Implemented / Simulated / Planned** in all external comms, and cite the
check that backs each claim:

- **Implemented — and executed by a repository check, not by a demo:** the
  assessment → quote → invoice → payment path (`tools/test_money_flow.mjs`,
  `tools/test_money_flow_auth.mjs`, §24); server-side AGM governance — attendance,
  quorum snapshots, the voting window, ballot choices, resolution thresholds,
  resolutions, actions and compliance runs as plpgsql (§24, §25); the
  hash-chained, append-only audit log for both writers (§24, §25); tenant
  isolation by `organization_id` at the application layer, which is the layer that
  matters because both functions query with a `BYPASSRLS` role
  (`tools/test_money_flow_auth.mjs`); RLS policies installed on every business
  table (§21 counts them from the generated bundle).
- **Simulated (prototype only) — say so out loud when selling it:** AES-256
  at-rest guarantees; the knowledge store / AI RAG over the Act + SOP corpus
  (`0002_knowledge.sql` needs pgvector, which no local check can boot — see
  `archive/neon/tools/test_knowledge_store.js`); the demo data in `data.js`.
- **Planned (not built):** real encryption at rest with a documented key process;
  audited third-party evidence for the chain; federation-level consolidated
  reporting beyond the current roll-up dashboard; the co-op's own branding on the
  portal (§10).

Never present simulated capabilities as production guarantees to cooperatives,
auditors, or institutional partners. Two rules follow from that and are enforced,
not just stated: a number printed on the landing page must be a number the
documented bundle installs (§23), and a failed statutory read must render as a
failure rather than an all-clear (§22f).

## 9. Acceptance test (definition of done for MVP)

> **A real Malaysian cooperative submits an AGM assessment, receives a package recommendation + quote, pays AGMX, creates its AGM, imports members, establishes quorum, runs live voting, produces resolutions/minutes, and retains an auditable record.**

This sentence is now a repository check. `tools/test_agm_journey.mjs` boots the
generated deploy bundle on embedded Postgres and drives the real `money-flow` and
`governance` handlers from the public assessment through a signed HitPay webhook
to minutes, resolutions, actions, a compliance run and the audit chain — 120
assertions, no credentials, no network, run as `tools/check.sh` §24. §25 then
applies the same bundle twice to one database and compares the catalog, which is
what a re-paste after a partial deploy actually does.

## 10. Immediate next actions

Done since the 2026-08-12 plan:

- [x] Deploy the Vercel fix to production — `https://agmx-v2.vercel.app`, one
      canonical host enforced by §19 and probed live by §23
- [x] Run production smoke-test matrix — 22/22
- [x] Freeze current UI as V1 baseline — `fcacb64`
- [x] Stand up Supabase project + apply schema + RLS policies — `jchfalaibabmszewemat`
- [x] Assessment → quote → invoice → payment (Sprint 2), and Sprints 3, 4, 5+
- [x] §9's acceptance journey as an offline check (§24, §25)

Open, in order:

- [ ] **Apply the governance SQL fixes to the production project.** Migration
      `0009_audit_all_stages.sql` and the corrected `0007`/`0008` (undeclared
      plpgsql variables, `max(boolean)`, a quorum guard that failed *open*, a
      jsonb-into-uuid assignment, `log_audit()`'s chain head) exist in this tree
      and are proven by §24/§25 — but **no remote project has been touched**.
      Until `supabase db push` runs against `jchfalaibabmszewemat`, production
      still 500s on every ballot. This is an operator action with real money on
      it, so it is deliberately not automated here.
- [ ] Custom domain for `agmx-v2.vercel.app` → `www.agmx.my`. Needs the owner's hostname plus Vercel and DNS actions, and then two checks rewritten: §19 derives the canonical host from `sitemap.xml`, and §23's live probes assume a `*.vercel.app` shape.
- [ ] White-label co-op portal. Unbuilt: there is no branding or theme column
      anywhere in the schema, so this is a scope decision (which fields, which
      pages, who uploads the logo, what a co-op's own domain does to §19/§23)
      before it is a task.
- [ ] Production secrets: `MIGRATION_PASSWORD`, `SERVICE_ROLE_KEY`,
      `DATABASE_URL`, `HITPAY_*` and `DEEPSEEK_API_KEY` are listed in `DEPLOY.md`
      and must be set in the Supabase project, not in this repository.

### Deployment smoke-test matrix
| URL | Expect |
|---|---|
| `/`, `/index.html`, `/app.html` | 200 real files |
| `/styles.css`, `/app.js`, `/data.js` | 200 real files |
| `/sw.js`, `/manifest.json` | 200 real files |
| `/robots.txt`, `/sitemap.xml` | 200 real files |
| `/assets/*` | 200 real files |
| `/app`, unknown SPA route | index.html fallback |
