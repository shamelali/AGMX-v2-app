# Archive — superseded documents

**These files describe systems that no longer run.** They are kept for design
history and for the reasoning behind decisions, not as instructions. For what
is true today, read `DEPLOY.md` (operations), `README.md` (the product and its
feature states), and `tools/CHECKS.md` (what `tools/check.sh` enforces).

Each file opens with a banner saying what superseded it and when.

| File | Described | Superseded by |
|---|---|---|
| `REPO_AND_VERCEL_STATUS.md` | The tree on 2026-10-17, when the money-flow backend was PocketBase on Fly.io | Supabase Edge Functions + Postgres; see `DEPLOY.md` |
| `NEON_BACKEND.md` | A Neon + Vercel Functions backend direction (2026-10-30) | Supabase; the code it describes is in `archive/neon/` |
| `GOOGLE_AUTH_SETUP.md` | Google OAuth configured against PocketBase | Supabase Auth → Sign In / Providers → Google. §1 (creating the OAuth client in Google Cloud) is still how the client ID is obtained |

These are deliberately outside the repository root so the operator-facing
document set is only the files that describe the running system. Nothing here
is read by `tools/check.sh`, and `.vercelignore` / `.wrignore` exclude `*.md`,
so no archived document reaches the deployed site.
