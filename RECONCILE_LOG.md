# AGMX reconciliation log

- base (content head): `/media/shamelali/Data/1-Projects/AGMX-merged-alt`
- graft source: `/media/shamelali/Data/1-Projects/AGMX-merged`
- generated: local time on the machine that ran this

## Counts

| item | n |
|---|---:|
| files from base | 266 |
| files grafted from merged | 0 |
| shared & identical (no action) | 209 |
| shared & different (needs review) | 50 |
| history | full .git copied from AGMX-merged |

## Files needing review

**The tree currently contains the ALT copy of every file below**, because alt is the base and grafts never overwrite it. Where the verdict says `take alt`, the file is already correct. Where it says `MANUAL`, decide whether alt is right before committing.

| file | merged | alt | in tree now | verdict | why |
|---|---:|---:|---|---|---|
| `.env.example` | 3,848 | 3,759 | alt | MANUAL | code: needs a human read |
| `.env.local` | 1,300 | 1,300 | alt | MANUAL | code: needs a human read |
| `.github/workflows/deploy.yml` | 6,849 | 6,655 | alt | MANUAL | code: needs a human read |
| `AGMX_V2_PLAN.md` | 15,618 | 13,627 | alt | take merged | doc: larger copy is usually the later revision |
| `BACKLOG.md` | 7,345 | 5,605 | alt | take merged | doc: larger copy is usually the later revision |
| `DEPLOY.md` | 25,234 | 23,549 | alt | take merged | doc: larger copy is usually the later revision |
| `README.md` | 14,583 | 14,126 | alt | take merged | doc: larger copy is usually the later revision |
| `TODO.md` | 9,477 | 9,460 | alt | take merged | doc: larger copy is usually the later revision |
| `VERCEL_ENV.md` | 5,720 | 5,734 | alt | take alt | doc: larger copy is usually the later revision |
| `api.js` | 31,074 | 64,983 | alt | MANUAL | code: needs a human read |
| `api/config.js` | 5,743 | 5,750 | alt | MANUAL | code: needs a human read |
| `app-shell.css` | 14,788 | 17,514 | alt | MANUAL | code: needs a human read |
| `app.html` | 3,076 | 3,067 | alt | MANUAL | code: needs a human read |
| `app.js` | 5,513 | 7,776 | alt | MANUAL | code: needs a human read |
| `archive/README.md` | 2,578 | 1,724 | alt | take merged | doc: larger copy is usually the later revision |
| `archive/pocketbase-v1/pocketbase-client.js` | 83,176 | 83,150 | alt | MANUAL | code: needs a human read |
| `archive/pocketbase-v1/pocketbase/README.md` | 10,105 | 10,084 | alt | take merged | doc: larger copy is usually the later revision |
| `archive/pocketbase-v1/tools/pb_migrate.py` | 29,726 | 29,700 | alt | MANUAL | code: needs a human read |
| `archive/pocketbase-v1/tools/test_money_flow_pb.mjs` | 17,834 | 17,821 | alt | MANUAL | code: needs a human read |
| `checkout.js` | 14,752 | 35,780 | alt | MANUAL | code: needs a human read |
| `config.example.js` | 3,128 | 3,122 | alt | MANUAL | code: needs a human read |
| `copilot.js` | 9,490 | 13,435 | alt | MANUAL | code: needs a human read |
| `data.js` | 9,847 | 12,006 | alt | MANUAL | code: needs a human read |
| `domain-packs.js` | 6,048 | 9,251 | alt | MANUAL | code: needs a human read |
| `index.html` | 65,326 | 65,324 | alt | MANUAL | code: needs a human read |
| `leads.js` | 7,562 | 11,906 | alt | MANUAL | code: needs a human read |
| `live-meeting.js` | 13,945 | 22,507 | alt | MANUAL | code: needs a human read |
| `login.js` | 8,054 | 12,183 | alt | MANUAL | code: needs a human read |
| `package-lock.json` | 44,654 | 9,367 | alt | take alt | lockfile: alt resolved later deps; do not hand-merge |
| `package.json` | 494 | 380 | alt | MANUAL | code: needs a human read |
| `robots.txt` | 85 | 92 | alt | take alt | doc: larger copy is usually the later revision |
| `runtime-diagnostics.js` | 5,141 | 8,144 | alt | MANUAL | code: needs a human read |
| `scripts/set-supabase-secrets.sh` | 7,528 | 7,542 | alt | MANUAL | code: needs a human read |
| `scripts/smoke-test.sh` | 1,318 | 1,332 | alt | MANUAL | code: needs a human read |
| `sitemap.xml` | 747 | 782 | alt | MANUAL | code: needs a human read |
| `styles.css` | 51,452 | 71,734 | alt | MANUAL | code: needs a human read |
| `supabase-client.js` | 10,865 | 19,178 | alt | MANUAL | code: needs a human read |
| `supabase/.temp/cli-latest` | 6 | 6 | alt | MANUAL | code: needs a human read |
| `supabase/.temp/linked-project.json` | 128 | 157 | alt | MANUAL | code: needs a human read |
| `supabase/.temp/storage-migration` | 38 | 29 | alt | MANUAL | code: needs a human read |
| `supabase/.temp/storage-version` | 7 | 8 | alt | MANUAL | code: needs a human read |
| `supabase/config.toml` | 18,078 | 17,088 | alt | MANUAL | code: needs a human read |
| `supabase/functions/money-flow/index.ts` | 54,053 | 54,060 | alt | MANUAL | code: needs a human read |
| `supabase/schema_final.sql` | 111,107 | 105,560 | alt | MANUAL | code: needs a human read |
| `sw.js` | 12,892 | 12,881 | alt | MANUAL | code: needs a human read |
| `theme.js` | 1,550 | 3,266 | alt | MANUAL | both sides edited after the Nov 5 copy — diff before choosing |
| `tools/CHECKS.md` | 34,207 | 34,194 | alt | take merged | doc: larger copy is usually the later revision |
| `tools/check.sh` | 133,614 | 132,476 | alt | MANUAL | code: needs a human read |
| `tools/test_money_flow_auth.mjs` | 16,169 | 15,991 | alt | MANUAL | code: needs a human read |
| `vercel.json` | 3,409 | 2,769 | alt | MANUAL | code: needs a human read |

Per-file unified diffs are in `_reconcile_diffs/` (from = merged, to = alt).

39 file(s) genuinely need your judgement: `.env.example`, `.env.local`, `.github/workflows/deploy.yml`, `api.js`, `api/config.js`, `app-shell.css`, `app.html`, `app.js`, `archive/pocketbase-v1/pocketbase-client.js`, `archive/pocketbase-v1/tools/pb_migrate.py`, `archive/pocketbase-v1/tools/test_money_flow_pb.mjs`, `checkout.js`, `config.example.js`, `copilot.js`, `data.js`, `domain-packs.js`, `index.html`, `leads.js`, `live-meeting.js`, `login.js`, `package.json`, `runtime-diagnostics.js`, `scripts/set-supabase-secrets.sh`, `scripts/smoke-test.sh`, `sitemap.xml`, `styles.css`, `supabase-client.js`, `supabase/.temp/cli-latest`, `supabase/.temp/linked-project.json`, `supabase/.temp/storage-migration`, `supabase/.temp/storage-version`, `supabase/config.toml`, `supabase/functions/money-flow/index.ts`, `supabase/schema_final.sql`, `sw.js`, `theme.js`, `tools/check.sh`, `tools/test_money_flow_auth.mjs`, `vercel.json`

## Next steps

1. `cd` into this tree and run `git status` — the drift should now be visible.
2. Review `_reconcile_diffs/` and resolve each MANUAL file.
3. Re-provision machine-local config (`.dev.vars`, `config.js`) and rotate any secrets.
4. `npm install` — `node_modules/` was intentionally not copied.
5. Commit the reconciliation, then archive the two source trees.
