# AGMX — Repository Checks

`tools/check.sh` runs twenty-three validation passes over the repo. No
dependencies beyond `node` and `python3`; `deno` is optional and pass 16 reports
a warning instead of a tick when it is absent.

```bash
./tools/check.sh              # full run (includes live host probe)
AGMX_SKIP_NET=1 ./tools/check.sh   # skip network probe — for CI/hooks/offline
```

Exit code is non-zero on the first failing pass, so it works as a pre-commit
hook and as a CI step.

## Install as a pre-commit hook

```bash
ln -sf ../../tools/hooks/pre-commit .git/hooks/pre-commit
```

`tools/hooks/pre-commit` is tracked, so the wrapper is versioned and only the
symlink lives in `.git/`. It sets `AGMX_SKIP_NET=1` — the live-host probe is a
CI concern, and a commit path that reaches the network fails on a train.
Remove it with `rm .git/hooks/pre-commit`.

## What each pass covers

| # | Pass | Guards against |
|---|---|---|
| 1 | JavaScript syntax | Typos that blank out `app.js` / `login.js` at runtime |
| 2 | JSON + XML validity | Malformed `vercel.json` / `manifest.json` breaking deploys |
| 3 | Vercel routing + security-header invariants | A legacy `routes` array silently disabling the whole `headers` block (so CSP/X-Frame-Options/HSTS were configured but never sent — found while wiring the live backend); an SPA catch-all moved into `beforeFiles`, the modern shape of the old "every asset resolves to `index.html`" bug; a missing `/sw.js` `Cache-Control` |
| 4 | HTML asset references | `<script src>` / `<link href>` pointing at files that don't exist (covers `checkout.html` + `leads.html` too; `config.js` is exempt — optional per-deployment, `onerror`-guarded) |
| 5 | Live host probe | Absolute URLs referencing a Vercel alias that isn't serving (social cards + `robots.txt` pointed at a 404 domain). Hosts appearing **only** in the CSP `connect-src` allow-list (e.g. a PocketBase origin not yet deployed) warn instead of failing |
| 6 | PocketBase schema integrity | Dangling relations, tenancy gaps on business tables, `votes`/`audit_events` losing append-only protection, and `required` on a `number`/`bool` (see below) |
| 7 | Service worker | Two halves. **Manifest**: missing files in `PRECACHE`, runtime scripts absent from it, and **a precached file edited without bumping `const CACHE`** — precached files are served cache-first and the browser only re-installs when `sw.js` changes byte-for-byte, so an un-bumped edit leaves every installed client on the old copy and the deploy appears to do nothing. **Policy** (`tools/test_service_worker_policy.mjs`): loads `sw.js` as written into a stub worker scope and drives the real fetch handler, asserting `/api/*` is never intercepted or stored, non-GET is left alone, unprefixed pages (terms, privacy, marketing) are network-first because they change without a `CACHE` bump, an HTML body is never stored under a `.js`/`.css`/`.json` URL, and offline still falls back. The handler used to answer every same-origin GET cache-first, which pinned `/api/config.js` — a `Cache-Control: no-store` the Cache API never reads — at the copy reporting `demoMode:true`, so `api.js` bound the browser-local adapter and payments were written to `localStorage` behind a "DIBAYAR ✓" receipt that no later deploy could reach |
| 8 | Secrets hygiene | Credential patterns in tracked files; `config.js` being committed; a missing or unanchored `/config.js` entry in `.vercelignore`. `vercel deploy` uploads the working tree and does **not** read `.gitignore`, so a gitignored `config.js` holding a live Billplz key was served publicly at `/config.js` for ~15 min on 2026-10-17 |
| 9 | Money-flow harnesses | Four credential-free suites, each one crossing a boundary no browser check can see. `tools/test_money_flow.mjs` drives the local adapter (quote → invoice → payment) so pricing regressions block the commit. `tools/test_money_flow_auth.mjs` loads `supabase/functions/money-flow/index.ts` as written and drives the real handler — that function queries with the service-role key, so RLS separates nothing there and every tenant boundary is application code. `tools/test_subscription_client.js` drives the real Supabase adapter against stubs shaped like the deployed responses; it is the only check that crossed the boundary, and it is what caught Sprint 3 shipping four client paths the function never served (`POST /subscription`, an invoice by `subscriptionId`, events as a path segment, a flat envelope). `tools/test_assessment_scoring.js` asserts the assessment page's score bands, member-cap lifts and annual-plan boundaries against the rate card the page actually loads — it had been failing for a while, unwired into this suite, with no card installed so every price assertion compared against `null`. The retired PocketBase suite (`test_money_flow_pb.mjs`) went with that backend |
| 10 | PocketBase JSVM API compatibility | `archive/pocketbase-v1/pb_hooks/` (archived reference layer) calling APIs that PocketBase 0.23 renamed or removed (`$app.dao()`, `.saveRecord()`, `$apis.*`, `c.queryParam()`, `.getId()`, `Collection.schema`). These parse cleanly and only fail at request time inside the server, so without this pass a 0.22-era hook merges and breaks every money-flow route at the first call. Comments are stripped before scanning, so the port notes in the source don't trip it |
| 11 | Client/server endpoint consistency | A client path under `/api/agmx/` with no matching `routerAdd` registration in the archived `archive/pocketbase-v1/pb_hooks/`. `api.js` reaches the server by prefixing `/api/agmx` onto a relative path, so the check resolves that mapping. Other `/api/...` paths are PocketBase's native collections API and always exist, so they are allowed |
| 12 | Route handlers are exported by their module | A `require(__hooks + "/X.js").fn(c)` dispatch whose `fn` is absent from `X.js`'s `module.exports`. `require()` succeeds and the route registers, so pass 11 is satisfied and the tests pass — the handler simply never runs and the client gets a bare "Something went wrong" 400 with no stack. This shipped with the Billplz gateway: `/payment/link` and `/payment/callback` were both registered but unexported, so every gateway call failed until the live smoke test caught it |
| 13 | Webhook signing keys | A gateway's **Secret key used as its webhook-signing key**. Billplz keeps two separate credentials (`BILLPLZ_API_KEY` for Basic Auth, `BILLPLZ_X_SIGNATURE` for HMAC) and states plainly they are not interchangeable. Verifying with the Secret key rejects *every* genuine callback while looking correct in every negative test — a wrong-but-consistent key still 403s a forged request — so it survives until a real payment. Shipped once, 2026-10-18. The check traces the argument at each signing **call site** (see below) |
| 14 | Runtime config flags are opt-IN | A flag that defaults to ON. `api/config.js` had `flag = (v) => v !== 'false'`, and no deployment ever set the variables, so production served `demoMode: true`. `api.js:1578` binds the Supabase adapter only when `demoMode === false`, so the live site ran the **browser-local** adapter: every quote, invoice and payment was written to `localStorage` and `checkout.js` printed a "DIBAYAR ✓" receipt for money that existed nowhere. Three halves. (a) A static grep over **both** emitters (`api/config.js`, `functions/config.js.js`) for `!== 'false'` or the older `=== 'true' \|\| true`, comments excluded so this row cannot trip it — fixing one port and leaving the other fail-open just moves the bug. (b) A behavioural run that loads each handler with a controlled environment and asserts unset ⇒ `demoMode/knowledgeRagEnabled/realtimeEnabled` false, `mode:"local"` with no Supabase URL and `mode:"supabase"` with one, `demoMode:true` beating a configured URL, `paymentsMode:"bank_transfer"` with no gateway keys and `"all"` with them, and that an explicit `NEXT_PUBLIC_PAYMENTS_MODE` can narrow but never widen. (c) It also compares the Cloudflare port against the Vercel one, because both feed the same `window.AGMX_CONFIG` to the same adapter choice. **The default was flipped on purpose**: an unset flag is now OFF, so a deployment that forgets to configure a backend looks absent instead of pretending to work. On a Node too old to load the ESM file the behavioural half reports `!` warning, never a green tick |
| 15 | Supabase RPC names and arguments exist in SQL | A `.rpc("name")` whose function no `supabase/migrations/*.sql` creates, or whose **named arguments** no declared signature accepts. PostgREST resolves both at request time, so nothing in TypeScript or the browser binds a call to the schema, and a wrong name or key is invisible until a live call returns `PGRST202` — which the money-flow handlers then *fail closed* on, so `money-flow` answers 429 or 500 instead of processing. Found on first run: `process_payment_webhook` (called by `supabase/functions/money-flow/index.ts`, now defined in `schema_final.sql`) and `run_compliance_checks` (called by `supabase-client.js` for an engine that actually lives in `pocketbase-client.js:853` — the dead call is gone). The argument check independently reproduced a subtler one: `knowledge-query/index.ts:75` passes `p_org_id`, which only the archived `supabase/archive/knowledge_schema.sql` declares — `knowledge_final.sql:100` (now `migrations/0002_knowledge.sql`) hardcoded `current_org_id()` instead, so every RAG query fails on the documented path. It **warns** rather than fails because the live project's applied schema is not knowable locally, and because the fix is a design choice: that function authenticates with the service-role key, for which `current_org_id()` returns NULL, so simply dropping `p_org_id` would empty every result |
| 16 | Edge Functions type-check | `supabase/functions/**/*.ts` compiled at all. Nothing in the repo ever type-checked them, and `money-flow/index.ts` — the highest-stakes file in the project — carried four duplicate declarations: `auditLog` defined twice (203, 257), `checkRateLimit` twice (234, 288), and `p_txn_id` twice in one RPC argument object (`TS1117`). Each pair was byte-identical, so deleting the second copy is a no-op; had they differed, the last declaration would have silently won. Only errors located in **repo files** count: the three functions still import `serve` from `deno.land/std@0.168.0`, whose Deno-1-era types never type-check under Deno 2, and `esm.sh/@supabase/auth-js` adds `.d.ts` noise — asserting on those would require a runtime this repo does not control. `NO_COLOR` is load-bearing (see below) |
| 17 | Insert payloads match the deployed table columns | A `.from("t").insert({...})` whose table or key PostgREST will not find. Like `.rpc()`, the payload is resolved at request time and TypeScript cannot see it; one stale key rejects the whole row with a 400 (`42703`), on a path whose handler usually has an error branch that turns it into a 5xx. Selects are out of scope — embedded joins (`plans(id)`) would make every one a false positive. Scope is the generated `supabase/schema_final.sql` the deploy docs apply — pass 21 proves it equals `supabase/migrations/*.sql`; a table that only `archive/` defines is reported, not accepted. Found on first run: `money-flow/index.ts:283` inserted `recommended_plan_id` while all three schema files declared `recommended_plan` (uuid FK), which broke public assessment submission against the documented schema. The code was the outlier, so it was renamed to the schema's column; the metrics select dropped the column entirely rather than renaming it, since nothing read it. The warning it also found (`_shared/webhook.ts:71` inserting into an undefined `webhook_events`) was removed with that dead file |
| 18 | Commit author identity | A HEAD commit or a local `git config user.email` that is a placeholder (`*@example.com`, `*@localhost`, empty). Vercel attributes a git-checkout deploy to the last commit's author and blocks the deploy when that address is not a team member — the block message names neither the email nor the reason, and one bad commit fails every deploy after it. In CI only the checked-out commit is judged, because the runner's own identity is not the one that ships |
| 19 | One canonical host | A page pointing at a deployment that still answers 200 but is not this product. Pass 5 can only prove a referenced host is *alive*, so a retired alias passes it: `agmx-project` v39 and the v16 PocketBase-era build both serve, and share-preview tags once led a prospect to the old brochure. Every vercel.app host in `index.html` must equal the single host `sitemap.xml` declares, and exactly one `rel="canonical"` must point at it. That host is what pass 23 then probes |
| 20 | Governance view harness | `tools/test_governance_ui.js` drives the real `governance-ui.js` against a DOM stub that **throws on `innerHTML`**, so an AGM Hall view that widens a role gate, renames a payload key the `governance` function reads, or renders a value as markup fails here instead of in a meeting. The gate matters: a control shown to the wrong participant is a ballot someone should not have had |
| 21 | SQL deploy bundle is generated, complete and rerun-safe | The drift that made the documented deploy install a different product. `DEPLOY.md`, `deploy.sh` and `VERCEL_ENV.md` all send an operator to one SQL file, and while that file was hand-maintained it lost 15 of the 23 RPCs — a fresh deploy got the AGM Hall UI with nothing behind it and every write answered `PGRST202`. `supabase/schema_final.sql` is now **generated** by `tools/build_schema_bundle.py` from `supabase/migrations/*.sql`, and this pass runs the generator's own `--check` (byte equality, and every `create policy` preceded by a `drop policy if exists` so the "rerun-safe" header is a fact), asserts each migration function survives into the bundle, refuses any doc that presents the retired `knowledge_final.sql` as current, checks `DEPLOY.md` deploys all four functions and names every `Deno.env` key the functions actually read (`SUPABASE_SERVICE_ROLE_KEY` for money-flow/governance, `SUPABASE_SECRET_KEY` for knowledge-*), and requires `supabase/config.toml` to declare `verify_jwt` per function — `money-flow` false, because a gateway webhook carries no Supabase JWT and verification would 401 it before the signature check ever ran |
| 22 | Rate card, i18n keys and error states cannot drift apart | Six rules, each one a bug this repo actually shipped. (a) `price-list.js` must mirror the `public.plans` seed rows exactly — four price books once disagreed by up to 15x, and a plan advertised that `money-flow` rejects with "Invalid plan" is a quote nobody can buy. (b) No `RM` amount may be written into a public surface unless it is a price on the card (comments are stripped first, so prose that *describes* the old bug does not trip it). (c) Every page loading `api.js` must also load `price-list.js` — `leads.html` did not, so `RATE_CARD` was null and an operator triaged a RM3,500 job as "professional_agm · RM0". (d) A `var MAP` key containing markup can never match a text node, and a key left behind when its sentence was edited is dead weight hiding the fact the new sentence has no key at all. (e) PocketBase may only be named as retired. (f) No `catch` in `governance-ui.js` may paint a result (`textContent`, `agmx-empty`, `statusPill`) without mentioning the error, and `renderError`/`statusFailure` must stay defined **and** called — a failed statutory read drawing "None recorded yet" is an all-clear the meeting record cannot support |
| 23 | The deployed surface and the published numbers | The two things every other pass is blind to, because they are true of the tree and false of the world. **(a) Published counts:** `index.html` asserted RLS on "all 50 tables in the application schema"; the migrations install 40, so the extra ten were hand-made tables in one production database that `supabase db push` does not produce. Every table/policy count on the landing page (English *and* Malay) must equal the count the generated bundle really installs, so a marketing number moves only when the schema moves. **(b) The live site:** `https://$CANON_HOST/api/config.js` and `/sw.js` are fetched and judged — `demoMode:false`, `mode:"supabase"`, a non-empty `supabaseUrl`, and the deployed worker's `sw.js` compared against this repo's. Byte-identical means the copy `tools/test_service_worker_policy.mjs` validated is the copy installed clients are running; the same `CACHE` number on different bytes fails, because then the version no longer identifies a build; a `sw.js` response with no `const CACHE` is the SPA catch-all handing out HTML as JavaScript, which an installed worker will store under the `.js` URL. Findings are hard failures when production already claims this version, and one warning when it lags (`v31` on the wire against `v40` in the tree) so the suite stays honest about what is *deployed* without blocking a commit that has not been released yet. `AGMX_SKIP_NET=1` — which the pre-commit hook sets — **warns** that the deployed surface was not verified rather than passing silently |

### Why pass 13 reads call sites, not the HMAC call

`$security.hs256(s, secret)` always names its own second parameter, so
inspecting that expression can only ever report the word `secret`. The
credential is chosen where the wrapper is *called* — `billplzSignature(body,
cfg.key)` — and that is what must be checked. Pass 13 therefore finds every
function whose 2nd parameter reaches `hs256`'s secret slot, then resolves the
2nd argument at each call site against the `env()` bindings in scope
(including one level of helper indirection, so `sigKey =
billplzSignatureKey()` resolves to `BILLPLZ_X_SIGNATURE`).

Two traps this design had to clear, both caught only by fault-injection — the
clean tree passed while the bug was live, which is the failure mode worth
remembering:

- **A fixed-size body window.** The first draft scanned 600 characters past the
  function header. `billplzSignature`'s own comment block is longer than that, so
  the `hs256` call was never reached, no wrapper was registered, and the check
  reported `0 HMAC call(s)` with a green tick. Replaced with brace matching.
- **Silently vacuous passes.** A file that computes HMACs but yields no wrapper
  now fails loudly. A check that inspects nothing must not report success.

### Why pass 6 rejects `required` on numbers and bools

PocketBase does not implement `required` as "must be present":

| Type | What `required` actually enforces |
|---|---|
| `number` | **non-zero** |
| `bool` | **always `true`** |

So `required` cannot express "must be provided", and it silently rejects
legitimate zero values — `arrears: 0`, `votesYa: 0`, `eligible: false`,
`tax: 0`. Every such write fails with `Cannot be blank.`, which reads like a
data problem rather than a schema problem.

This shipped once: ten money-flow fields were affected and only surfaced when
the hooks were finally run against a live 0.40 server. Use
`required: false` and validate real ranges in the app.

## Design notes

- **`config.*` is deliberately never precached** — it varies per environment, and a
  cached copy would pin a stale Google client ID or PocketBase URL.
- **Pass 5 needs outbound network.** CI sets `AGMX_SKIP_NET=1` and reports it as a
  warning rather than silently passing.
- **Pass 6 treats `federations` correctly** — it uses `ownerOrgId`, not
  `organizationId`, because a federation *is* the tenant.
- **Pass 1 also parses the archived `archive/pocketbase-v1/pb_hooks/*.pb.js` / `*.lib.js`** — `node --check`
  only parses (the JSVM globals like `routerAdd`/`$app` are runtime-injected
  by PocketBase), which is exactly the guarantee we want pre-commit.
- **Colour defeats counting.** Passes 15–17 tally their findings by
  grepping the output of a subprocess, and both `python3` and `deno` emit ANSI
  even when stdout is redirected to a file. `^  ✗` never matches
  `  \e[31m✗`, and `at file://` never matches `at \e[36mfile://` — in each case
  the failure *printed* while the tally stayed at zero, so the run ended
  `✓ all checks passed`. Pass 15's helper emits tab-separated `BAD`/`WARN`/`OK`
  kinds and lets bash render the glyph; pass 16 runs `deno` under `NO_COLOR=1`.
  Any new pass that counts subprocess output must do the same.

## GitHub Actions

`.github/workflows/deploy.yml` calls this script from its "Run check.sh" step,
so local and CI run identical checks. Editing that file needs a token carrying
the **`workflow` scope**; the `gh` CLI now has it, and pushes can go through
its credential helper without touching stored git config:

```bash
git -c credential.helper='!gh auth git-credential' push origin main
```

Do not put a PAT in the remote URL — it is written to `.git/config` in
plaintext and leaks into any log, bundle or copy of that file. Use SSH or the
helper above.

Actions is currently blocked account-wide by a billing lock: runs are created,
jobs are listed, and every job then fails with zero steps allocated. That is
invisible in the repo and looks like a broken workflow, so the pre-commit hook
above is the working gate until billing is resolved.
