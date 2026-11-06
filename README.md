# AGMX — Cooperative Governance Operating System

AGMX runs the Annual General Meeting (AGM) of a Malaysian cooperative: a free
assessment that scores complexity and recommends a package, the commercial flow
around it (quote → invoice → payment → subscription), and the meeting itself
(member roster, check-in, quorum, motions, voting, resolutions, follow-up
actions, statutory checks and an audit chain).

Backend: Supabase — Postgres with row-level security, Auth, and Deno Edge
Functions (`money-flow`, `governance`). Hosting: Vercel. No build step: the app
is static HTML/JS served as it is.

> **Branch check before trusting a deploy.** The Vercel production branch and the
> branch holding the deployed tree had drifted apart: the live site served files
> that existed only on the `sync-from-origin`/`master` line, while `main` sat 51
> commits behind. A push to `main` therefore changed nothing customers saw. See
> the *Production branch* note in [`DEPLOY.md`](DEPLOY.md) before deploying.

- Deploy and operate: [`DEPLOY.md`](DEPLOY.md)
- Verify: `npm test` (runs `tools/check.sh`)
- Marketing copy: [`index.html`](index.html) — its numbers are re-measured against
  the running project and dated at the bottom of that page.

## Read this before quoting AGMX to anyone

Three states are used in this file and on the landing page, and they are never
mixed:

- **Live** — a real server path exists on the deployed project and the client
  reaches it.
- **Built, not reachable** — the code is here and the offline harnesses cover it,
  but nothing in the deployed app gets to it, or it is blocked by a server-side
  defect named below.
- **Planned** — there is no code path. A planned capability is priced and written
  up as planned; it is never described as included.

Nothing in this repository may claim a capability by showing a screen for it.

### Feature states, with the file that proves it

| Capability | State | Evidence |
|---|---|---|
| Assessment → score → package recommendation | Live | `assessment.js`; `money-flow` `/quote` re-prices from `public.plans` and ignores whatever total the browser sent |
| Quote → invoice → payment → receipt | Live, **bank transfer only** | `money-flow` RPCs + `0006_subscriptions_billing.sql`. FPX / card / Billplz pills stay hidden until gateway keys exist (`api/config.js` derives `paymentsMode` from key presence) |
| Rate card | Single source | `price-list.js` mirrors `public.plans`; the landing page, assessment and checkout all read it |
| Auth: Google, email + password, reset link | Live | `supabase-client.js:72-109`; recovery completes in-app (`app-bootstrap.js`) |
| Organisation isolation | Live | `current_org_id()` used by RLS across the schema (`0001_schema.sql`) |
| Member roster (read, eligibility, attendance views) | Live | `supabase-client.js:142-149`, rendered by `app-bootstrap.js:656-676` |
| Member CSV **import** | Planned | export exists for the lead pipeline only (`leads.js:147-171`); there is no file input or parser |
| AGM hall: start/close, check-in, quorum, motions, vote, resolutions | Live with named gaps | `governance-ui.js` → `governance` Edge Function → `0007_governance_rpc.sql`. Gaps: a failed quorum does **not** block a vote (`0007:191-216`) and the passed-or-failed test ignores abstentions and the motion type (`0007:314`) |
| Ballot casting | Live, **not secret** | `cast_vote` (`0007:225-262`). No WebCrypto/AES anywhere; ballots are plaintext rows. `votes_read using (false)` hides them from reads, but see *Open defects* #2 |
| Audit chain | Written, **never verified** | `log_audit` SHA-256 chaining in Postgres (`0007:11-41`) and in `money-flow` for commercial events. No code recomputes a link, and ballots do not enter the chain — so do not claim immutability |
| Statutory checks | Three of four rules evaluate | `run_compliance_checks` (`0007:362+`): `sec17_notice`, `gp14_quorum`, `gp14b_motions`. `akta1993_immutable` returns **not evaluated**; the loop no longer defaults to a pass |
| Follow-up actions | Live, manual | created by an operator (`governance-ui.js:757-771`); nothing derives tasks from passed motions |
| Document register | Live, metadata only | `register_document` (`0007:448-470`) stores a typed path and an optional hand-typed sha256. **There is no upload** — no `storage.from()` in this repo |
| Subscription + recurring invoices + payment schedule | Built, **not reachable** | the screens, the client contract (`tools/test_subscription_client.js`) and the RPCs exist, but `create_subscription_from_quote` requires `plans.is_subscription`, and every `*_agm` plan row is `false` — so a subscription started from an AGM quote cannot complete |
| AI copilot (chairman, secretary/minutes, compliance, question organiser) | Planned | `copilot.js` is loaded by **no** page and calls `api.canQueryKnowledge` / `api.queryKnowledge`, which `supabase-client.js` does not define. No speech-to-text exists |
| RAG knowledge room | Deployed, **off** | `knowledge-query` / `knowledge-ingest` are deployed and load; a non-POST answers 405 with the provider they select. No provider key exists on either platform, so `/api/config` publishes `knowledgeRagEnabled:false` — the flag needs the opt-in **and** a key this platform can see |
| Federation / multi-org roll-up, distribution portal | Built, not reachable | tables and RLS exist; `AGMX_API.loadDistributionPortal` is never defined, so the route always renders "Distribution data unavailable" (`app-bootstrap.js:518-526, 741-743`) |
| SSO, custom domain, public API | Planned | marketing text only |
| 5 hall layouts, speaker queue, video, live captions, "panic button" | Planned | no code; the landing page says so plainly |
| Tamil / Chinese / Indonesian interfaces, AI auto-translate | Planned | two dictionaries exist (BM, EN); the other languages appear only in `data.js` fixtures |
| Senior mode, high contrast | CSS only, no control | `.senior-mode` / `.high-contrast` exist (`styles.css:860-886`) and `theme.js:69-70` reads localStorage keys **nothing writes**; the header offers the dark toggle only |
| Digital Vault view, "98/100 governance gauge", Zero Trust matrix (MFA, passkey, device binding, geo blocking, anti-bot, fraud) | Planned | `score: 98` and `aktaChips` are `data.js:148-157` fixtures that no view renders; MFA/passkeys/geo/fraud appear nowhere in `.js`, `.html`, `.ts`, `.css` or `.sql` |
| `domain-packs.js` | Orphaned | a client-side metadata registry for 7 packs, loaded by no page, with no server counterpart; its own docstring says it makes no legal determinations |

## Backend

Supabase is the only backend. `supabase/migrations/0001…0007` is the source of
truth; `supabase/schema_final.sql` is **generated** from it by
`tools/build_schema_bundle.py` and is the one file `DEPLOY.md` tells an operator
to paste. `supabase/config.toml` declares `verify_jwt` per Edge Function.

Until this changed the bundle was kept by hand and carried 8 of the 23 functions,
so a deployment built strictly from the docs had an AGM Hall with no RPCs behind
it. `tools/check.sh` pass 21 now compares the bundle to the migrations, checks
that every `create policy` is rerun-guarded, and checks that every `Deno.env.get`
name the functions read appears in `DEPLOY.md`.

- `money-flow` — quotes, invoices, payments, subscriptions, pipeline. Deployed,
  `verify_jwt = false` (it authenticates prospects by their assessment token).
- `governance` — running a meeting. Deployed, `verify_jwt = true`.
- `knowledge-query`, `knowledge-ingest` — deployed. They select the provider
  named by `LLM_PROVIDER` and report readiness on a non-POST; with no provider
  key a real query answers `503 LLM_NOT_CONFIGURED` and names the missing
  variable instead of failing at import.
- `/api/config.js` and `/api/health` on Vercel are read-only: they expose the
  publishable key, the mode the deployment declared, and a probe result.

Feature flags in `api/config.js` are **opt-IN**: an unset variable reads as off.
They used to be opt-out (`v !== 'false'`), and because every deployment was created
without setting them, production reported `demoMode: true` and the app wrote quotes
and payments into the visitor's `localStorage` while printing a paid receipt.

The PocketBase v1 layer and the Neon GraphRAG experiment are archived under
`archive/`, reference only — `archive/README.md`. PocketBase is retired; the
checkout page no longer offers to point the workspace at one.

## Open defects that need a decision

These are known, deliberate, and not fixed here because each one mutates the live
database or a deployed Edge Function.

1. **No `profiles` row on signup.** `handle_new_user` does not exist, so a brand-new
   user authenticates and then fails on the profile read. Nothing in the documented
   deploy creates one.
2. **`votes_insert` validates only `organization_id`** (`0001:676-677`), so any member
   of an organisation can insert a ballot for another voter through raw PostgREST with
   the published publishable key, and `votes_read using (false)` means nobody sees it.
   Tighten to `auth.uid() = member_id`.
3. **Broad `authenticated` INSERT/UPDATE grants** on `motions`, `resolutions`,
   `attendance`, `quorum_snapshots`, `agms`, `audit_events` (`0001:831-834`) sit
   beside RPCs that already do the job. Drop them in favour of the RPCs.
4. **`check_rate_limit` is SECURITY DEFINER and not revoked from `anon`**
   (`0001:707-708`); with `p_window = '100 years'` the table empties itself.
5. **Quorum gates nothing and the threshold rule is wrong** (see the table above).
   `start_agm`'s bare `update agm_settings` (`0007:64`) can silently invalidate every
   ballot in flight.
6. **`handleActionCreate` (`governance/index.ts:420-435`) has no ownership check.**
7. **Subscriptions cannot start from an AGM quote** (see the table above).
8. **`api/billplz/*` and `api/hitpay/*` on Vercel still write to PocketBase**
   (`api/billplz/_shared.js:117`, `api/hitpay/_shared.js:119` — the default URL is
   `http://127.0.0.1:8090`). Adding gateway keys does **not** make these routes work;
   the working path is `money-flow/payment/intent`.
9. **`money-flow` defaults to sandbox endpoints** (`BILLPLZ_API_URL` → billplz-sandbox,
   `HITPAY_API_URL` → api.sandbox.hit-pay.com). With production keys but unset URLs it
   would send a real payer to a sandbox bill.

## How to run

Open `index.html` (marketing) or `app.html` (the application) in any modern browser —
no build step. Local development needs `config.js` (copy `config.example.js`); a
deployment without Supabase configuration runs on the `LocalAdapter` demo and says so
in the UI.

## Tests

```bash
npm test                            # tools/check.sh, offline (AGMX_SKIP_NET=1)
node tools/test_money_flow.mjs      # money-flow contract against the local adapter
node tools/test_subscription_client.js  # checkout client vs the 0006 RPCs
node tools/test_domain_packs.js     # the orphaned registry still parses and resolves
```

`tools/CHECKS.md` lists what each pass in `check.sh` covers. The live PocketBase
suites moved to `archive/pocketbase-v1/tools/` — they wipe money-flow collections
first, so never point them at production.

## Agent connectors

`.mcp.json` is tracked and deliberately holds no credentials:

| Server | What it is | Still needed |
|---|---|---|
| `playwright` | `npx @playwright/mcp@latest` driving local chromium — the only way to actually render `app.html` and the AGM Hall, which the 23 static passes cannot do | nothing; works offline |
| `vercel` | `https://mcp.vercel.com` — deployment status, env vars, logs for `agmx-v2-app` | one-time OAuth consent in the CLI |

Supabase (project `lcrfsqocqavczgnzpadq`) is connected from the developer's own
CLI config, not this file, so the access token never enters the repository.
Checklist for anything else that needs a key — `SUPABASE_SECRET_KEY`, Billplz,
HitPay — is in `VERCEL_ENV.md`.

## Files

```
AGMX/
├── index.html          # marketing landing page (facts measured against the project)
├── app.html            # authenticated application shell
├── assessment.html/js  # free AGM assessment → score → package → quote
├── checkout.html/js    # quote → invoice → payment → receipt → subscription
├── leads.html/js       # operator inbox: metrics, CSV export, backend status
├── price-list.js       # the single rate card, mirroring public.plans
├── api.js              # window.AGMX_COMMERCE — local / Supabase adapters
├── supabase-client.js  # auth, data, realtime, Edge Function calls
├── governance-ui.js    # hall, roster, compliance, audit, actions, documents
├── app-bootstrap.js    # signed-in workspace assembly
├── copilot.js          # AI copilot — loaded by no page (see feature states)
├── domain-packs.js     # client metadata registry — loaded by no page
├── data.js             # mock cooperative fixtures (demo fallback only)
├── styles.css / app-shell.css / app.js / theme.js / login.js / callback.html
├── api/                # Vercel Functions: config, health, billplz, hitpay
├── supabase/           # migrations/ (truth), schema_final.sql (generated),
│                       #   config.toml, functions/governance|money-flow|knowledge-*
├── archive/            # superseded PocketBase v1 and Neon layers (reference only)
├── tools/              # check.sh + harnesses + CHECKS.md
├── sw.js               # service worker (see the cache-name rule inside it)
├── vercel.json         # routing, CSP, security headers
└── DEPLOY.md           # operator path, written against the migration set
```

## Design system

- Malaysian-inspired palette: primary blue `#0B5394`, accent gold `#D4A017`.
- `styles.css` carries light / dark / high-contrast token sets; dark mode has a
  header toggle, and high contrast and senior mode are styles without a control yet.
- Large targets and one primary action per view, aimed at members aged 50+ reading a
  phone screen in a hall.
- Two languages: Bahasa Melayu first, English alongside. Both are wired through the
  page translators; free-text names and raw server detail are deliberately not
  rewritten.

---

**Facts in this file describe the repository and the running project as at
3 November 2026.** Anything labelled Live here was read out of the code or the
project's own schema, not inferred from a screen.
