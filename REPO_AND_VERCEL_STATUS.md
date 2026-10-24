# AGMX — Repo & Vercel Project Status

*Rewritten 2026-10-17 from the working tree + live production checks
(`agmx-project.vercel.app` frontend, `agmx-pb.fly.dev` backend).*

> The previous version of this file was compiled 2026-10-16 and went stale
> within a day: it named the wrong Vercel team, listed PR #6 as unmerged, and
> described the backend as undeployed. Before that, the 2026-10-01 version had
> drifted badly — file sizes several times off, `vercel.json` still flagged as
> broken, Supabase still listed as the backend, and a claim of "62 live
> assertions green" that could not be reproduced. See §7 and §8.

---

## 1. GitHub repository — `shamelali/AGMX`

| | |
|---|---|
| Remote | `https://github.com/shamelali/AGMX.git` |
| Default branch | `main` |
| `main` head | `a2e19b8` — *fix(deploy): unblock Vercel, wire prod config, contain a leaked key* |

Local: `main`, `feat/sprint2-money-flow`,
`feat/sprint2-money-flow-recovered` (local-only).
Remote-only: `feat/revenue-ready-mvp`, `fix/vercel-static-routing`,
`fix/vercel-static-all-files`, `arena/01a00379-agmx`, `arena/01a0703f-agmx`.

A GitHub integration on the Vercel project auto-deploys every push to `main`.

### Pull requests — all resolved

| # | Title | Branch | State | Note |
|---|---|---|---|---|
| **6** | `feat(sprint2): money flow on PocketBase — quote, invoice, payment, leads` | `feat/sprint2-money-flow` | **merged** | 21 files, +4123/−81. Full recovery + PocketBase 0.40 port + UI wiring + regression guards |
| 5 | `feat: Sprint 2 money flow — quote → invoice → payment → operator inbox` | `arena/01a0703f-agmx` | **closed** | Superseded by #6 — see §6 |
| 4 | Enterprise UI/UX overhaul | `arena/01a00379-agmx` | merged | |
| 3 | remove legacy builds array | `fix/vercel-static-all-files` | merged | |
| 2 | V2 revenue engine | `feat/revenue-ready-mvp` | merged | |
| 1 | serve static assets before SPA fallback | `fix/vercel-static-routing` | merged | |

### Tracked files

117 total, of which 66 are `assets/`, `images/` and `design-system/`.
Sizes below are the real on-disk byte counts rounded to K — an earlier version
of this table understated several of them by 3× (see §8):

```
index.html        24K   Landing page
app.html / app.js 3.4K/8K SPA shell + router (13 views)
styles.css        53K   Design system, 3 themes + Senior Mode
data.js           12K   Mock KOPEMAJU dataset (demo mode only)

assessment.html   17K   12-question AGM assessment
assessment.js     13K   Scoring + commerce handoff
checkout.html     17K   Quote → invoice → payment → receipt
checkout.js       16K
leads.html/js    9K/10K Operator inbox, metrics, CSV, backend switch

api.js            28K   window.AGMX_COMMERCE: LocalAdapter ↔ PocketBaseAdapter
login.js          11K   Google OAuth2 / OTP / demo
pocketbase-client.js 81K Dependency-free PB SDK (recovered superset — was 26K)
config.example.js  1K   Copy to config.js (gitignored)

pb_hooks/money_flow.lib.js 51K Server-side pricing, numbering, audit chain
pb_hooks/money_flow.pb.js  2.6K Route registration
pocketbase/collections.json 58K 31 app collections
pocketbase/seed.json        7K Plans + Akta/GP14/UUK compliance rules

tools/check.sh              24K 12 validation passes
tools/pb_migrate.py         27K Creates/updates collections on a running instance
tools/harden_rules.py        8K Tenancy hardening pass
tools/test_money_flow.mjs   11K 61 assertions, no dependencies
tools/test_money_flow_pb.mjs 17K 62 assertions, live
tools/test_money_flow_adapter.mjs 8K 23 assertions, live via api.js

Dockerfile + fly.toml       Backend deploy (Fly.io, region sin)
api/config.js               Vercel function: window.AGMX_CONFIG from env vars
```

---

## 2. Vercel project — `agmx-project` (team `duta-integra`)

- Production: <https://agmx-project.vercel.app/>
- Dashboard: <https://vercel.com/duta-integra/agmx-project>
- Project ID `prj_CuN5AMrRNT6cUshJtmz6qMheQLSM`, org `team_09zaVvx6W9qqXeaJ1Zx6cfGS`
- Platform: Vercel static (`@vercel/static`)

> ⚠️ The project lives in the **hobby** team `duta-integra`. An older draft of
> this file named `shamelalis-projects` (pro) — that account is **suspended**
> ("add a valid payment method"). Never scope CLI commands to it; always pass
> `--scope duta-integra --non-interactive`.

### Deploy pipeline — was broken ~2 weeks, now fixed

`vercel.json` carried `"buildId"` / `"buildTimestamp"`. Those are Next.js
build artifacts, not config properties; Vercel's tightened schema rejects them
outright, so **every production deploy from 2026-10-16 onward errored** — the
site sat on the 2026-10-13 tree and `/assessment`, `/checkout`, `/leads` all
404ed. Removed in `a2e19b8`; first successful deploy since: `dpl_rHsTjm3nL9G`.

Pushes to `main` deploy via the GitHub integration.

### Routing — migrated from `routes` to `rewrites`

Two distinct generations of the same bug:

1. **2026-09 (fixed `2197ef0`)** — a catch-all with no
   `{ "handle": "filesystem" }` before it, so every asset resolved to
   `index.html`.
2. **2026-10-17 (fixed `a2e19b8`)** — the surviving legacy `routes` array made
   Vercel **ignore the top-level `headers` block entirely**. CSP,
   `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy` were in
   the file and reached no browser; only the platform-level HSTS appeared.

Now expressed as `rewrites`: `/config.js → /api/config.js` first, extensionless
page routes (`/assessment`, `/checkout`, `/leads`, `/app`, `/404`), SPA
catch-all `/(.*) → /index.html` **last**. `check.sh` pass 3 rejects any legacy
`routes` array and enforces the catch-all position.

Verified live 2026-10-17 — all headers present, `/sw.js` carries
`Cache-Control: no-cache` + `Service-Worker-Allowed: /`:

```
content-security-policy: ... connect-src 'self' https://agmx-pb.fly.dev http://127.0.0.1:8090 ...
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000; includeSubDomains; preload
```

### Production config — env-driven

The HTML loads `<script src="config.js">`; the real file is gitignored
(`check.sh` pass 8 forbids tracking it), so on Vercel the route answers from
`api/config.js`, a function reading `AGMX_PB_URL`, `AGMX_GOOGLE_CLIENT_ID`,
`AGMX_DEMO_MODE`, `AGMX_PAYMENT_DEMO`. `Cache-Control: no-store`, since a
cached copy would pin a stale backend host across deploys.

Live values confirmed:

```js
window.AGMX_CONFIG = { url: "https://agmx-pb.fly.dev", googleClientId: "",
  appName: "AGMX", demoMode: false, paymentDemo: false }
```

Local dev is unaffected — `python3 -m http.server` has no route table, so it
serves the gitignored `./config.js` from disk.

> **Credential incident, contained.** `vercel deploy` uploads the working tree
> and does **not** read `.gitignore`, so a local `config.js` holding a live
> Billplz API key was deployed and served publicly at `/config.js` for ~15 min
> on 2026-10-17. Array-form rewrites also run *after* the filesystem lookup, so
> that file shadowed `/api/config.js`. Fixed with a root-anchored
> `/config.js` entry in `.vercelignore`. The key was never committed — git
> history is clean — but **it still needs rotating in the Billplz portal.**

### Pages live

`/`, `/assessment`, `/checkout`, `/leads`, `/app` all return 200.

---

## 3. Backend — PocketBase 0.40.4

| | |
|---|---|
| Supported version | **0.40.4** (enforced by `check.sh` pass 10) |
| **Production** | **<https://agmx-pb.fly.dev>** — Fly.io app `agmx-pb`, region `sin`, 1 GB volume |
| Local dev | `http://127.0.0.1:8090` (binary in `bin/`, started with `--dev`) |
| Collections | **37** total: 5 system + 31 from `pocketbase/collections.json` + `users` (PocketBase's default auth collection, created on first boot) |
| Money-flow collections | `agm_assessments`, `quotes`, `invoices`, `payments`, `audit_events`, `organizations` |

Fly.io was chosen because the backend is a **Go binary** — Vercel, Cloudflare
Workers, Neon and Supabase Functions all run runtimes, not binaries. Deploy:
`Dockerfile` (29 MB image) + `fly.toml`; `flyctl` at `~/.fly/bin/flyctl`.

Fly secrets set: `BILLPLZ_API_KEY`, `BILLPLZ_COLLECTION_ID`,
`BILLPLZ_CALLBACK_URL=https://agmx-pb.fly.dev/api/agmx/payment/callback`.
Superuser: `admin@agmx-project.vercel.app` (password in
`/tmp/opencode/pb_prod_pw.txt`).

### Why `pb_migrations/` is not shipped

PocketBase writes migration files as `TIMESTAMP_name.up.sql`, and the
timestamp has **one-second resolution**. Two collections changed in the same
second sort *alphabetically within that timestamp*, so a fresh boot replays
them out of dependency order and dies on "relation collection doesn't exist".
They are a generated artifact, not source — gitignored, and
`tools/pb_migrate.py` is the source of truth instead: it reads
`pocketbase/collections.json`, topologically sorts by relation + rule
dependencies, and creates everything against a *running* instance.

Tenancy is enforced in `collections.json` access rules: every business table
is org-scoped, and `votes` / `audit_events` are append-only
(`updateRule`/`deleteRule` empty).

> `main` shipped `tools/harden_rules.py` (`8b35c5f`) but never ran it against
> the committed `collections.json`, so write rules stayed role-only and any
> admin of any cooperative could write into another's tables. Now fixed.

---

## 4. Verification

| Suite | Assertions | Needs | Destructive? |
|---|---|---|---|
| `tools/check.sh` | **33 checks / 12 passes** | nothing | no |
| `tools/test_money_flow.mjs` | **61** | nothing (localStorage adapter) | no |
| `tools/test_money_flow_pb.mjs` | **62** | running PocketBase 0.40.4 | **yes** — wipes money-flow tables |
| `tools/test_money_flow_adapter.mjs` | **23** | running PocketBase 0.40.4 | **yes** — wipes money-flow tables |

**146 assertions total, all green as of 2026-10-17**, including the SHA-256
hash chain walking GENESIS→tip with every hash recomputing, and the
double-payment guard.

> ⚠️ **Run the two live suites sequentially, never concurrently.** Both target
> `127.0.0.1:8090` by default and both `wipe()` the same money-flow tables, so
> parallel runs delete each other's fixtures mid-test — observed as 6 + 5
> spurious failures that vanish when re-run one at a time.
>
> ⚠️ **Never point either live suite at production.** They authenticate as
> superuser and truncate `quotes` / `invoices` / `payments` / `audit_events`.
> Production needs its own non-destructive smoke tests.

The flow was also walked end-to-end in Chrome against a live instance:

```
index → assessment → checkout → QT-2026-002 → INV-2026-002
      → FPX payment PAY-rcn4hmms2syslc6 → receipt RM8,100.00
```

---

## 5. Next steps

- [x] Merge PR #6, close PR #5 (§6)
- [x] Deploy production PocketBase → Fly.io, `demoMode: false`
- [x] Deploy merged `main` to Vercel; `/assessment`, `/checkout`, `/leads` → 200
- [x] Licensed payment gateway → **Billplz wired** (`680c9ac`, `d5fdfb5`, `1ac609c`): `POST /api/agmx/payment/link` creates a hosted bill, `POST /api/agmx/payment/callback` verifies `x_signature` and settles in one transaction. Credentials in Fly secrets, sourced from `~/.secrets/dv2.env`.
- [ ] **Rotate the Billplz portal password.** It was pasted in chat in
      plaintext (`lindan95`) and must be treated as compromised. Separately,
      the API key was publicly served for ~15 min (§2) and should be rotated too.
- [ ] **Real Billplz round-trip.** Bill create → webhook → settlement is
      verified only to the extent that a bad request is *correctly rejected*
      (empty body → 403 "Tandatangan webhook tiada."; bad signature → 403
      "Tandatangan webhook tidak sah."; unknown invoice → 404). A genuine
      FPX payment has not been taken, so HMAC-verification against a **live**
      callback is still unproven.
- [ ] Google OAuth — no client ID exists anywhere (only the doc placeholder
      `1234567890-abc.apps.googleusercontent.com`), so `googleClientId` is
      empty and the Google login path is inert. Create a client or drop the button.
- [x] Fix the "Neon health" mislabel in `runtime-diagnostics.js:89` → now
      "Backend health" (leftover from the Supabase/Neon era; the probe reads
      the PocketBase `/api/health`). No other stale "Neon" references remain.
- [ ] Decide whether local browser dev should point at the live backend;
      `config.js` currently defaults to `http://127.0.0.1:8090` with the demo
      flags on.
- [ ] EN toggle for `checkout.html` / `leads.html`
- [ ] AGM scheduling handoff once a lead reaches `Dibayar`
- [ ] Tag `v1.0.0-ui-freeze`

---

## 6. PR #5 vs PR #6 — resolved

PR #5 (`arena/01a0703f-agmx`, opened 2026-09-05) covered the same Sprint 2
money flow and was **superseded**: #6 contained everything #5 had, plus the
PocketBase 0.40 port (the hooks in #5 cannot run on the version `main`
targets), the tenancy fix, the UI wiring that made the flow reachable, and the
regression guards.

**#6 merged, #5 closed** on 2026-10-17. Nothing in `main` depended on
`arena/01a0703f-agmx`.

---

## 7. Production-only code (recovered)

At one point the deployment served ~123 KB that was not in git at all.
Nothing in the repository ever wrote into `<main id="app">`, so cloning and
deploying it produced a **blank SPA** — production only worked because of
files that lived solely on the server.

All four have been recovered and are now in the repo:

| File | Size | Purpose |
|---|---|---|
| `app-shell.css` | 12,556 B | Styling for the authenticated shell |
| `app-bootstrap.js` | 24,418 B | Populates `#app`; mounts dashboard / members / distribution |
| `runtime-diagnostics.js` | 8,280 B | Opt-in dev panel (`?diagnostics=1` or `config.devTools`) |
| `pocketbase-client.js` | 90,585 B at recovery → **83,150 B** now | Superset of the previously committed 26 KB client |

The committed client was verified to be an exact prefix of the deployed one,
so recovery was additive: **0 methods lost, 111 gained.** Among the gains is
BillPlz payment-gateway integration — the Sprint 3 "licensed gateway" work,
which was also only ever on the server.

`sw.js` is at `agmx-v7`: production's `v6` precached the shell files while
the repo's `v5` precached the money-flow files, so each held half the set.

Repo and production now match byte-for-byte on every SPA file except `sw.js`,
which intentionally carries both precache sets.

---

## 8. Corrections to the previous version of this file

**Corrections to the 2026-10-16 version** (it went stale within a day):

- **Wrong Vercel team.** It named `shamelalis-projects` (pro, suspended for
  non-payment). The project is in `duta-integra` (hobby). Any CLI command
  scoped to the pro team fails.
- **PR #6 listed as an open draft, PR #5 as open.** #6 merged, #5 closed.
- **"Not yet deployed" was true for ~12 more hours, then became false.** The
  Sprint-2 pages are live, and the backend is deployed on Fly.io.
- **It did not mention that `vercel.json` carried `buildId`/`buildTimestamp`**,
  which had failed *every* production deploy since 2026-10-16 — the doc was
  written against a tree that could not deploy at all. See §2.
- **It did not mention the credential exposure.** A gitignored `config.js`
  holding a live Billplz API key was served publicly for ~15 min on
  2026-10-17, because `vercel deploy` uploads the working tree and ignores
  `.gitignore`. See §2.

**Corrections to the 2026-10-01 version:**

- **File sizes were wrong.** It listed `app.js` at 174 KB (actual 8 KB),
  `styles.css` at 72 KB (actual 53 KB), `index.html` at 53 KB (actual 24 KB).
- **`vercel.json` was still marked "⚠️ routing bug".** Fixed in `2197ef0` —
  and then reintroduced in a new form twice more; see §2.
- **Supabase was still listed as the next backend step.** Replaced by
  PocketBase in `19b502f`; `supabase/schema.sql` is retained for reference only.
- **"61 local + 62 live assertions green against PocketBase v0.22.21" is
  unverified.** The live suite posts `candidates: 0, motions: 0,
  managed: false`, and the schema at that time marked those fields
  `required: true` — which PocketBase reads as *non-zero*, so the write was
  rejected with `Cannot be blank.` That failure is version-independent, so
  the claim could not have held against any PocketBase build. It could not be
  reproduced against 0.22.21 directly (no admin account can be created there
  without a bcrypt tool), so treat it as unproven rather than disproven.
  Current verified figure (2026-10-17, re-run against 0.40.4):
  **61 local + 62 live + 23 adapter = 146**. (The 2026-10-16 revision of this
  file said "63 live" — re-running gives 62.)
- **`required` on `number`/`bool` fields was the root cause**, and 21 such
  fields were relaxed in `3f7f991` (*check(schema): guard the zero-value and
  0.22-API bug classes*) — verified as exactly 21 `"required": true` removals
  against `pocketbase/collections.json`. Zero remain.
  `check.sh` pass 6 now rejects the pattern.
- **"Sprint 2" was listed as a future step** while also being described as
  complete and verified above. It is now genuinely implemented *and* deployed;
  what remains is a real end-to-end Billplz payment (§5).
- **The enterprise image pack was "6/10 generated".** All 10 are present.
- **The §1 file-size table understated several files by up to 3×.** It listed
  `pocketbase-client.js` at 26 KB (actual **81 KB** — the 26 KB figure was the
  pre-recovery committed prefix, not the file), `tools/check.sh` at 16 KB
  (actual 24 KB, grew with passes 3/8), `pb_hooks/money_flow.lib.js` at 43 KB
  (actual 51 KB) and `checkout.js` at 15 KB (actual 16 KB). The table now
  carries real `du -b` figures.
- **Collection count was "31".** That is the count of app collections in
  `collections.json`; a running instance shows 37 (31 + `users` + 5 system).