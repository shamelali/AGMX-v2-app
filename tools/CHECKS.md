# AGMX — Repository Checks

`tools/check.sh` runs fourteen validation passes over the repo. No dependencies
beyond `node` and `python3`.

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
| 7 | Service worker precache | Missing files in `PRECACHE`, and runtime scripts absent from it; **a precached file edited without bumping `const CACHE`**. The fetch handler is cache-first and the browser only re-installs when `sw.js` changes byte-for-byte, so an un-bumped edit leaves every installed client on the old copy indefinitely — the deploy goes out and nothing visibly changes |
| 8 | Secrets hygiene | Credential patterns in tracked files; `config.js` being committed; a missing or unanchored `/config.js` entry in `.vercelignore`. `vercel deploy` uploads the working tree and does **not** read `.gitignore`, so a gitignored `config.js` holding a live Billplz key was served publicly at `/config.js` for ~15 min on 2026-10-17 |
| 9 | Money-flow test suite | Runs `tools/test_money_flow.mjs` (local adapter, zero dependencies) so quote/invoice/payment regressions block the commit. The **live** PocketBase suite (`tools/test_money_flow_pb.mjs`, 63 assertions incl. audit-chain recomputation) needs a running instance — run it manually per `pocketbase/README.md` |
| 10 | PocketBase JSVM API compatibility | `pb_hooks/` calling APIs that PocketBase 0.23 renamed or removed (`$app.dao()`, `.saveRecord()`, `$apis.*`, `c.queryParam()`, `.getId()`, `Collection.schema`). These parse cleanly and only fail at request time inside the server, so without this pass a 0.22-era hook merges and breaks every money-flow route at the first call. Comments are stripped before scanning, so the port notes in the source don't trip it |
| 11 | Client/server endpoint consistency | A client path under `/api/agmx/` with no matching `routerAdd` registration in `pb_hooks/`. `api.js` reaches the server by prefixing `/api/agmx` onto a relative path, so the check resolves that mapping. Other `/api/...` paths are PocketBase's native collections API and always exist, so they are allowed |
| 12 | Route handlers are exported by their module | A `require(__hooks + "/X.js").fn(c)` dispatch whose `fn` is absent from `X.js`'s `module.exports`. `require()` succeeds and the route registers, so pass 11 is satisfied and the tests pass — the handler simply never runs and the client gets a bare "Something went wrong" 400 with no stack. This shipped with the Billplz gateway: `/payment/link` and `/payment/callback` were both registered but unexported, so every gateway call failed until the live smoke test caught it |
| 13 | Webhook signing keys | A gateway's **Secret key used as its webhook-signing key**. Billplz keeps two separate credentials (`BILLPLZ_API_KEY` for Basic Auth, `BILLPLZ_X_SIGNATURE` for HMAC) and states plainly they are not interchangeable. Verifying with the Secret key rejects *every* genuine callback while looking correct in every negative test — a wrong-but-consistent key still 403s a forged request — so it survives until a real payment. Shipped once, 2026-10-18. The check traces the argument at each signing **call site** (see below) |
| 14 | Runtime config flags are env-driven | `process.env.X === 'true' \|\| true` in `api/config.js` — always true, so `NEXT_PUBLIC_DEMO_MODE=false` still served `demoMode: true` and demo mode could not be turned off by any setting. Two independent halves: a static grep for the dead pattern (comments excluded, so this very row cannot trip it) and a **behavioural** run that loads the handler, asserts `"false"` disables and unset stays ON. Unset defaults to ON deliberately: that is what every deployment already serves, so the fix restores control without flipping production. On a Node too old to load the ESM file the behavioural half reports `!` warning, never a green tick |

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
- **Pass 1 also parses `pb_hooks/*.pb.js` / `*.lib.js`** — `node --check`
  only parses (the JSVM globals like `routerAdd`/`$app` are runtime-injected
  by PocketBase), which is exactly the guarantee we want pre-commit.

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
