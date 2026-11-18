# AGMX / DutaGovern — handoff for OpenCode

**Date:** 2026-11-18 · **Repo:** `shamelali/AGMX-v2-app` · **Branch:** `main` · **Base commit:** `74f84e1`

---

## 0. Answer to "x-home project details"

**There is no project called `x-home`.** I checked both accounts exhaustively:

- **Vercel** (`ShamelProjects`, team `team_m2krzoPIIIbZjcFL8jcS9Ddq`, hobby plan): search
  `"x-home"` → 0, `"home"` → 0, `"x"` → 0. Nothing on page 1 or page 2 of the project list.
- **Supabase** (org `xxilkgsibsmddtyetvmy`): exactly one project, `AGMX`
  (`jchfalaibabmszewemat`).
- **Workspace + repo:** no file, directory or reference matching `x-home` / `xhome`.

If it is a local folder, a separate account, or a name you meant loosely, say which and I will
pull it. Do not treat the absence as an error in your setup — it may simply live elsewhere.

Adjacent things that do exist, in case one is what you meant: Vercel projects `agmx-v2-app`,
`just-apac`, `just-apac-main`, `solucis`, `leish_v2-main`, `dutaintegraweb-new`; domains
`agmx.my`, `justapacvercel.app`.

---

## 1. What this work is

A marketing site + working assessment funnel for AGMX (AGM governance for Malaysian
co-operatives and JMBs), plus a guided product demo. The product tier was renamed
**Governance OS → DutaGovern** at your instruction.

## 2. Current repo state

```
7be9748  Finish removing data.js from the tooling and config      ← uncommitted upstream
7336cad  Rename Governance OS to DutaGovern, remove the simulated workspace
dd174ba  knowledge: create the documents bucket, refuse formats we cannot parse
4c3ef48  knowledge: real input_type, live-tested models, halfvec(2048), honest health
74f84e1  Report knowledge readiness from the function, and index Obsidian  ← origin/main
```

**No git remote in this sandbox.** Four commits are ready in
`/home/user/agmx-dutagovern-series.patch` (1,584 lines):

```bash
cd /media/shamelali/Data/1-Projects/AGMX-v2-app
git pull
git am ~/agmx-dutagovern-series.patch
git push origin main
```

The patch was verified to apply onto `74f84e1` in a clean worktree and land all four commits.

Suite on this tree: **74 passed / 0 failed / 6 warnings** (Node ≥22 required — `package.json`
declares `engines: node >=22`, and two `.mts` tests fail on Node 20. That failure is an
environment artifact, not a tenant bug.)

## 3. Deliverables in `/home/user` (not yet merged into the repo)

| File | What it is | State |
|---|---|---|
| `landing-preview.html` | Landing page, light + dark hero, 9 sections in your stated order, BM/EN | ready to become `index.html` |
| `assessment-preview.html` | 7-question assessment, server-parity scoring, live submission | ready to become `assessment.html` |
| `assessment-preview.test.mjs` | jsdom driver, 26 assertions | passing |
| `demo/guided-demo.html` | Interactive 6-step guided demo, no account needed | ready to ship at `/demo/` |
| `demo/guided-demo.test.mjs` | jsdom driver, 27 assertions | passing |

Run the tests with Node 22 and `jsdom` installed in `_repo`:

```bash
cd /home/user/_repo && npm install --no-save jsdom
node ../assessment-preview.test.mjs
node ../demo/guided-demo.test.mjs
```

## 4. Things that were already fixed — do not redo them

1. **`data.js` deleted.** It presented a fictional co-op with 1,284 members and a 98 compliance
   score in production UI. Its script tag, precache entry, minify input and config comment are
   all gone; the demo sign-in now fails with an explicit message instead of silently rendering
   a different shell.
2. **Governance OS → DutaGovern**, including plan codes `governance_os_*` → `dutagovern_*`.
   Applied live to `public.plans` via migration `0013`; seeds in `0006` updated so the browser
   rate card and SQL agree. A repo test cross-checks those two lists — if you change one, change
   the other or the suite fails on purpose.
3. **`documents` storage bucket created** (migration `0012`), with an org-scoped read policy.
   It never existed, so `knowledge-ingest` could never have worked.
4. **PDF/DOCX now refused** with `415 UNSUPPORTED_MEDIA_TYPE` instead of being decoded as text.

## 5. Live infrastructure facts

- **Supabase:** ref `jchfalaibabmszewemat`, region `ap-southeast-1`, Postgres 17.11,
  pgvector 0.8.2. Migrations applied through `0013`.
- **Edge functions deployed:** `knowledge-query`, `knowledge-ingest`, `money-flow`, `governance`.
- **Vercel:** project `agmx-v2-app` (`prj_II3SS3w4X1KKiqrKi7jwGuxcSnlo`), framework `container`,
  hobby plan, `agmx.my` attached with vercel-dns nameservers.
- **`/api/config`** live: `demoMode:false`, `mode:"supabase"`, `knowledgeRagEnabled:true`.
- **Identity rows:** 1 organisation, 1 profile, 0 members, 0 AGMs, 0 assessments.
- **`plans`** now carries `dutagovern_essential/professional/enterprise/federation`
  (RM600/800/1,000/1,250 per month) and one-off `essential_agm/professional_agm/enterprise_agm`
  (RM1,500/3,500/7,500).

## 6. The one thing worth reading twice

`assessment.js` and `money-flow`'s `computeComplexityScore()` used **different scoring
formulas**. A sweep of 3,240 answer combinations found **828 package disagreements (25.6%)**, in
both directions — a visitor could be shown RM3,500 and have RM1,500 stored against their lead.
Two further mismatches: the page sent `currentProcess:"mixed"` where the server tests for
`"partial"`, and the server scores a 7th factor (`needsManaged`) the page never asked about.

`assessment-preview.html` mirrors the server verbatim and answers the 7th question. Re-swept
across 7,128 combinations: **0 score mismatches, 0 package disagreements**, and a live
`POST /functions/v1/money-flow/assessment` returned `201` with `complexityScore:81`,
`recommendedPlan:"enterprise_agm"` — exactly what the page displays. The test lead was deleted
immediately after.

**If you rewrite either scorer, re-run that sweep.** The two must not drift again.

## 7. Suggested next steps, in order

1. **Merge the previews into the repo.** `landing-preview.html` → `index.html` (keep the
   schema-count line the suite asserts, currently "53 policies"), `assessment-preview.html` →
   `assessment.html`. Bump `sw.js` cache (`CACHE` = `agmx-www-agmx-my-v11`, line 149) and
   regenerate `supabase/schema_final.sql`
   (`python3 tools/build_schema_bundle.py`) or the suite fails.
2. **Check the checkout handoff.** The old `assessment.html` wrote a lead record to
   `localStorage` that `checkout.js` may read. `assessment-preview.html` does not write it —
   diff that shape before swapping or the checkout page may lose its context. **Unverified.**
3. **`/assessment.html#sandbox`** is linked from the demo and the assessment but does not exist.
   It is the Phase-2 sandbox request form.
4. **Sandbox (Phase 2)** needs a seeded demo tenant + role switching in Supabase. The
   `domain-packs.js` registry and the RLS policies give you the structure; the `strata` pack
   still has `noticeDays:null, quorumMode:"configured"` (versus `cooperative` at `21`), so the
   JMB 14-day statutory notice is not encoded at all.
5. **The ingest path has one unexercised link**: storage download → extraction → chunking →
   real embeddings. It needs a file in the `documents` bucket. Everything on either side is
   verified; `documents` currently has 0 rows.

## 8. Standing constraints from the user

- Do **not** invent file paths. `~/agmx-live` never existed.
  `/media/shamelali/Data/1-Projects/AGMX-merged` is the **wrong** tree for deploying;
  `AGMX-v2-app` is canonical. `AGMX-merged` commit `3c78db9` must not be deployed.
- Deliverables are **runnable scripts and written analysis**; never write to or delete the
  user's source trees. Scripts must not print file contents or unmasked credentials.
- **Never present a test fixture as real legal text.** The AGM fixture is labelled
  `TEST FIXTURE, NOT LEGAL TEXT` in-file; keep that label if it is ever promoted.
- Verify with evidence, never assert. Every number in this handoff came from a command.
- Vercel hobby + live HitPay payments is a suspension risk. `main` auto-deploys with no
  preview gate.

## 9. Traps already hit (do not repeat)

- `supabase functions deploy` needs `--remote=<ref> --yes` on CLI 3.x; `--project-ref` is
  deprecated and a non-TTY run without `--yes` silently deploys nothing.
- Storage migrations must be wrapped in
  `do $$ ... if exists (select 1 from pg_namespace where nspname='storage')` or PGlite aborts
  the whole deploy bundle.
- `0011` cannot run under PGlite (alters a column on a table `0002` creates, and `0002` is
  skipped for pgvector). It is listed in `UNSUPPORTED_SECTIONS` in `tools/agmx_db.mjs`;
  both replay tests assert that exact skip list.
- `knowledge-ingest` uses **2-space** top-level indentation — patches keyed on 4 spaces silently
  no-op.
- `domain-packs.js` is minified in place by `tools/minify-assets.mjs`, so editing it means
  editing already-minified output. Change source, not the shipped artifact, or you will lose
  the next build.
- `/tmp` does not persist between sessions; Node 22 and the Supabase CLI must be re-fetched:
  ```bash
  curl -sL https://nodejs.org/dist/v22.23.5/node-v22.23.5-linux-x64.tar.xz | tar -xJ
  curl -sL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz
  ```
