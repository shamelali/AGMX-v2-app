# AGMX-v2-app — Deployment Guide (Supabase-First, Free Trial)

## 🎯 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Vercel (Hobby) — Static + Edge Functions                       │
│  ├── index.html, app.html, assessment.html, checkout.html      │
│  ├── styles.css, app.js, api.js                                 │
│  └── api/config.js → reads from Vercel env vars                │
├─────────────────────────────────────────────────────────────────┤
│  Supabase (Free Tier + $100 credits) — Primary Backend          │
│  ├── Auth (email/phone/OAuth)                                   │
│  ├── Postgres (500MB) — schema_final.sql + RLS                 │
│  ├── Realtime — attendance, quorum_snapshots, motions          │
│  ├── Storage (1GB) — documents, minutes                        │
│  ├── Edge Functions — governance, money-flow, knowledge-*      │
│  └── pgvector — AI Copilot RAG                                  │
├─────────────────────────────────────────────────────────────────┤
│  LLM Provider (Choose ONE)                                      │
│  ├── OpenAI — text-embedding-3-large + gpt-4o-mini             │
│  └── NVIDIA NIM — nv-embedqa-e5-v5 + llama-3.1-70b-instruct   │
├─────────────────────────────────────────────────────────────────┤
│  Billplz / HitPay (Sandbox) — Payment Gateways                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites

| Service | Account | Free Tier |
|---------|---------|-----------|
| GitHub | ✅ Required | Unlimited public repos |
| Vercel | ✅ Required | Hobby (unlimited personal) |
| Supabase | ✅ Required | 500MB DB + $100 credits |
| **LLM Provider** (choose one) | | |
| OpenAI | Optional | Pay-as-you-go (~$5-10/mo) |
| **NVIDIA NIM** | Optional | **Free tier available** (build.nvidia.com) |
| Billplz | Optional | Sandbox free |
| HitPay | Optional | Sandbox free |

---

## 🚀 Quick Deploy (30 minutes)

### 1. Fork & Clone
```bash
git clone https://github.com/shamelali/AGMX-v2-app.git
cd AGMX-v2-app
```

### 2. Supabase Project
1. Go to https://supabase.com/dashboard/new
2. Create project: `agmx-v2` (Singapore region)
3. **Save credentials**: Project URL, anon key, service_role key

### 3. Database Schema
Two supported paths. They install the same SQL; do not mix them on one project
without reading the note below.

**A. Supabase CLI (preferred)** — `supabase/migrations/` is the source of truth:
```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push          # applies migrations/0001…0010 in filename order
```

**B. Dashboard SQL editor** — paste `supabase/schema_final.sql` as one script.
It is **generated** from `supabase/migrations/*.sql` by
`python3 tools/build_schema_bundle.py`; never hand-edit it, and `tools/check.sh`
fails the repo if the bundle has not been regenerated after a migration changes.
One paste now creates the core schema, the pgvector knowledge store, the plan
seeds, the privilege revokes, the `search_path` pins, the billing RPCs and the
governance RPCs.

Both paths are rerun-safe: every statement is `if not exists`, `or replace`, a
`drop … if exists` guard, or wrapped in an exception handler. Re-pasting after a
failed run will not abort on `42710 duplicate_table`.

> **Realtime:** no dashboard step needed — the bundle ends by managing
> `supabase_realtime` itself (attendance, quorum_snapshots, motions, questions)
> and removing `votes`, because a realtime feed of a ballot and a secret ballot
> cannot both exist.

> **After CLI + paste both used:** `supabase db push` records migrations in
> `supabase_migrations.schema_migrations`. Pasting the bundle afterwards is still
> safe (everything is guarded), but the CLI will then think a migration is
> unapplied — check the live function list rather than the CLI's diff if the two
> disagree.

> **`db push` compares version numbers, not content.** A recorded version means the
> CLI skips that file forever, so editing a migration *after* it has been pushed
> cannot be repaired by pushing again. This is exactly how production came to run
> the pre-fix bodies of `cast_vote`, `log_audit` and `record_resolution` while
> `supabase migration list` reported 0007–0009 applied: both `0007` and `0008` were
> corrected in place after their first apply. Re-apply the SQL to converge —
> `supabase db query --linked -f supabase/migrations/0007_governance_rpc.sql`, then
> `0008`, `0009`, `0010` — every definition is `create or replace`, so order is the
> only thing that matters. Then prove it by body rather than by the CLI — that is
> what `tools/check.sh` pass 26 does, comparing md5 over
> `select proname, md5(prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`
> against the same hash taken over each body in `schema_final.sql`, and comparing the
> versions recorded in `supabase_migrations.schema_migrations` to the files that
> describe them. Pass 27 goes one step further and calls the live `cast_vote` with an
> unknown motion id: its first statement selects that motion and returns when no row
> matches, so the call proves the live function is the repaired one without writing
> anything — `votes` and `audit_events` are counted before and after to show that,
> because an append-only audit row written in error could not be taken back.

> **A migration applied outside `supabase/migrations/` is invisible to every check
> in this repository.** Version `0010` (`white_label_branding`, adding
> `organizations.logo_url` and `primary_color`) sat in production for a day with no
> file here, while `TODO.md` asserted no branding column existed anywhere.
> `check.sh` compares the generated bundle to `migrations/*.sql`, so it can only
> detect a schema the repository already describes; reading `schema_migrations`
> against the linked project is the only thing that finds one.

`schema.sql` / `knowledge_schema.sql` are the earlier pair and are **not** a
valid install for a new project: RLS is enabled on all 33 tables with zero
policies, so every read returns no rows, and they contain neither
`check_rate_limit` nor `process_payment_webhook`, so all three Edge Functions
fail closed on the first request. `tools/check.sh` pass 15 reports any RPC that
is not in the bundle the docs above apply.

### 4. LLM Provider Setup (Choose ONE)

#### Option A: OpenAI (Default)
```bash
# Get API key from https://platform.openai.com/api-keys
export OPENAI_API_KEY=sk-...
```

#### Option B: NVIDIA NIM (Recommended for Cost/Performance)
```bash
# 1. Get NGC API Key from https://build.nvidia.com/ → My API Keys
# 2. Or self-host NIM: https://docs.nvidia.com/nim/
export NVIDIA_NIM_API_KEY=nvapi-...  # NGC API Key
export LLM_PROVIDER=nvidia
```

**NVIDIA NIM Model Options (Free Tier on build.nvidia.com):**
| Model | Use Case | Dims |
|-------|----------|------|
| `nvidia/nv-embedqa-e5-v5` | Embeddings | 1024 |
| `meta/llama-3.1-70b-instruct` | Chat | — |
| `nvidia/nemotron-3-ultra` | Chat (reasoning) | — |
| `google/gemma-2-9b-it` | Chat (lightweight) | — |

**Self-hosted NIM** (for production):
```bash
# Set your self-hosted NIM endpoint
export NVIDIA_NIM_BASE_URL=https://your-nim-endpoint.com/v1
```

### 5. Edge Functions
`supabase/config.toml` is committed and already declares `verify_jwt` per
function, so the flag no longer has to be carried on the command line. If you
deploy without a linked project the CLI cannot resolve `[project_id]` — run
`supabase link` first.

```bash
# Install Supabase CLI
npm install -g supabase

# Login & link
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Deploy every function the app calls.
# `governance` was missing from this list, which is why a fresh deployment had
# the AGM Hall UI and none of its RPCs: every write answered PGRST202.
supabase functions deploy governance
supabase functions deploy money-flow
# The knowledge store is not reachable from the browser today:
# supabase-client.js exposes knowledge.query/ingest, no UI code calls either,
# and knowledgeRagEnabled stays false until a provider key exists (flags below).
supabase functions deploy knowledge-query
supabase functions deploy knowledge-ingest
```

**JWT verification** (declared in `supabase/config.toml`, confirm with
`supabase functions list`):

| Function | `verify_jwt` | Why |
| --- | --- | --- |
| `money-flow` | **false** | Billplz/HitPay webhooks post with the gateway's signature header and no Supabase JWT. Verification on = 401 before the handler runs, so the payment settles at the gateway and stays UNPAID here. Authenticity is the signature check inside the function. |
| `governance` | **true** | Resolves the tenant from the caller's JWT; unverified calls could name any `organization_id`. |
| `knowledge-query` / `knowledge-ingest` | **true** | Run as the caller so RLS scopes retrieval and ingest to one organisation. |

Secrets — each name below is the exact string `Deno.env.get()` reads in that
function's source. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_ANON_KEY` are provided by the Edge Runtime on every project; set them
explicitly only if a function logs that they are undefined.

```bash
# governance + money-flow (server-only tenant writes)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...   # already provided by the runtime; pin it if you rotate keys
supabase secrets set APP_URL=https://your-production-host   # money-flow builds receipt/return URLs from it

# knowledge-query + knowledge-ingest read SUPABASE_SECRET_KEY and fall back to
# the runtime's SUPABASE_SERVICE_ROLE_KEY. The Edge Runtime injects only the
# latter, so a function that reads the former alone throws at import and every
# request answers 500 WORKER_ERROR with no handler and no log line.
supabase secrets set SUPABASE_SECRET_KEY=eyJ...

# knowledge-query also reads SUPABASE_ANON_KEY, to build a client that carries
# the caller's JWT — knowledge_search derives the tenant from auth.uid(), so a
# service-role client would return zero rows. The runtime injects this one.

# Billplz — leave unset and /api/config.js reports paymentsMode: bank_transfer
supabase secrets set BILLPLZ_API_KEY=...
supabase secrets set BILLPLZ_COLLECTION_ID=...
supabase secrets set BILLPLZ_X_SIGNATURE=...            # X Signature key (NOT the API Secret Key)
supabase secrets set BILLPLZ_API_URL=https://www.billplz.com   # Production; defaults to https://www.billplz-sandbox.com

# HitPay
supabase secrets set HITPAY_API_KEY=...
supabase secrets set HITPAY_SALT=...                    # Per-webhook salt (Dashboard → Developers → Webhooks)
supabase secrets set HITPAY_API_URL=https://api.hit-pay.com   # Defaults to https://api.sandbox.hit-pay.com

# LLM (only needed by knowledge-*; see _shared/llm.ts)
supabase secrets set LLM_PROVIDER=nvidia                # or openai
supabase secrets set OPENAI_API_KEY=sk-...              # If using OpenAI
supabase secrets set NVIDIA_NIM_API_KEY=nvapi-...       # If using NVIDIA NIM (NGC_API_KEY is an accepted alias)
supabase secrets set OPENAI_CHAT_MODEL=gpt-4o-mini
supabase secrets set OPENAI_EMBEDDING_MODEL=text-embedding-3-large
```

> **Model names must match on both sides.** `_shared/llm.ts` reads
> `OPENAI_CHAT_MODEL` / `OPENAI_EMBEDDING_MODEL` / `NVIDIA_NIM_*` (no
> `NEXT_PUBLIC_` prefix — these are server-only), while the browser reads
> `NEXT_PUBLIC_OPENAI_CHAT_MODEL` etc. from `/api/config.js`. Embeddings are
> stored as fixed-width vectors, so if the server ingests with a different model
> than the browser claims, `knowledge_chunks` keeps vectors that the query path
> cannot compare meaningfully — wrong answers, no error. Keep the two sets equal,
> and re-ingest after changing either.

> **Sandbox by default.** `BILLPLZ_API_URL` and `HITPAY_API_URL` fall back to the
> sandbox hosts when unset. A deployment that sets real API keys but forgets the
> URL creates sandbox bills for real customers — the money does not move, and the
> webhook never returns to the production function. Deploying either gateway for
> real means setting both the key and the production URL.

> **Rotating a leaked key.** `api/billplz/_shared.js` and `api/hitpay/_shared.js`
> on Vercel still persist payment records to a retired PocketBase instance, so a
> webhook received there is recorded nowhere you would look. Until those routes
> are rewired to `money-flow`, treat any payment made through them as unrecorded.

### 6. Vercel Deployment
```bash
# Install Vercel CLI
npm install -g vercel

# Login & link to Duta Integra team
vercel login
vercel link --project=agmx-v2-app --scope=duta-integra --yes
```

**Add Environment Variables in Vercel Dashboard:**

**Required (Supabase):**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SECRET_KEY=eyJ...                 # Server-only; the name api/health.js reads
```

**LLM Provider (choose one):**
```
# Option A: OpenAI
OPENAI_API_KEY=sk-...                      # Server-only
NEXT_PUBLIC_LLM_PROVIDER=openai
NEXT_PUBLIC_OPENAI_EMBEDDING_MODEL=text-embedding-3-large
NEXT_PUBLIC_OPENAI_CHAT_MODEL=gpt-4o-mini

# Option B: NVIDIA NIM
NVIDIA_NIM_API_KEY=nvapi-...               # Server-only
NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_NIM_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
NVIDIA_NIM_CHAT_MODEL=meta/llama-3.1-70b-instruct
NVIDIA_NIM_EMBEDDING_DIMS=1024
LLM_PROVIDER=nvidia
NEXT_PUBLIC_LLM_PROVIDER=nvidia
NEXT_PUBLIC_NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
NEXT_PUBLIC_NVIDIA_NIM_CHAT_MODEL=meta/llama-3.1-70b-instruct
NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_DIMS=1024
```

**Payments (Optional):** *(set via `supabase secrets set` on Supabase — the gateway code runs in Edge Functions, not Vercel)*
```
BILLPLZ_API_KEY=...                        # Server-only (Supabase secret)
BILLPLZ_COLLECTION_ID=...                  # Server-only (Supabase secret)
BILLPLZ_X_SIGNATURE=...                    # Server-only — X Signature callback key, NOT the API Secret Key
HITPAY_API_KEY=...                         # Server-only (Supabase secret)
HITPAY_SALT=...                            # Server-only — per-webhook salt from Developers → Webhooks
HITPAY_API_URL=https://api.sandbox.hit-pay.com   # Production: https://api.hit-pay.com
```

**App Config:**
```
NEXT_PUBLIC_APP_URL=https://agmx-v2.vercel.app
```

Feature flags are opt-IN: leave them unset for a real deployment. `demoMode`,
`knowledgeRagEnabled` and `realtimeEnabled` all default to `false`. `knowledgeRagEnabled`
additionally requires a provider key this platform can see — `OPENAI_API_KEY`, or
`NVIDIA_NIM_API_KEY`/`NGC_API_KEY` for the provider `LLM_PROVIDER` names — so it
cannot be switched on by a flag alone. `api/config.js` publishes `mode:"supabase"`
as soon as
`NEXT_PUBLIC_SUPABASE_URL` is set with demo mode off — that is the only switch
`api.js` looks at when it chooses an adapter.

They used to default to ON. Because no deployment ever set them, production
served `demoMode:true`, `api.js` fell through to the browser-local adapter, and
checkout printed "DIBAYAR ✓" receipts for payments stored only in the visitor's
`localStorage`. Setting these to `true` reinstates that behaviour deliberately:

```
NEXT_PUBLIC_DEMO_MODE=true    # every write stays in this browser; demo only
NEXT_PUBLIC_KNOWLEDGE_RAG=true  # not a behaviour switch — it only changes what
                                # /api/config publishes. Nothing reads it; the
                                # RAG room is Planned (README), not gated here.
NEXT_PUBLIC_REALTIME=true       # requires wss://*.supabase.co in the CSP
```

`NEXT_PUBLIC_PAYMENTS_MODE` is derived from the gateway keys, not from a default:
with `BILLPLZ_API_KEY`+`BILLPLZ_COLLECTION_ID` or `HITPAY_API_KEY` present the
checkout offers gateway methods, otherwise it offers manual bank transfer only.
Set it explicitly to narrow a deployment; asking for `all` without keys is
ignored. (Note the keys above are Supabase secrets for the Edge Function, and
separate Vercel env for the `api/billplz/*` and `api/hitpay/*` functions — the
config endpoint reads the Vercel copy, so set both or the checkout will offer a
method it cannot create.)

### 7. Deploy
```bash
vercel --prod --scope=duta-integra
```

If Vercel answers `● Blocked — the commit author doesn't have permission to create
deployments for this project`, it is reading the `user.email` of the local HEAD commit,
which is not a Vercel team member. Either commit as an address that belongs to a member,
or deploy a copy without `.git` so no author is attributed:

```bash
rsync -a --exclude .git --exclude .vercel --exclude node_modules --exclude archive \
  --exclude supabase --exclude tools --exclude bin --exclude design-system \
  --exclude package.json --exclude '*.lock' --exclude pnpm-lock.yaml \
  --exclude '/config.js' --exclude '.env*' --exclude '.dev.vars*' --exclude wrangler.jsonc \
  --exclude _headers --exclude _redirects --exclude _routes.json --exclude '*.md' \
  ./ /tmp/agmx-deploy/
mkdir -p /tmp/agmx-deploy/.vercel && cp .vercel/project.json /tmp/agmx-deploy/.vercel/
cd /tmp/agmx-deploy && vercel deploy --prod --yes --scope duta-integra
```

The local `config.js` is excluded on purpose — `/config.js` is served by the
`api/config.js` edge function from Vercel env instead. Keep the leading slash in that
pattern: a bare `config.js` also drops `api/config.js` and the app boots unconfigured.

---

## 🧪 Test the Flow

1. **Landing**: https://agmx-v2.vercel.app
2. **Assessment**: https://agmx-v2.vercel.app/assessment
   - Answer 12 questions → Get complexity score → Recommended plan
3. **Leads** (operator): https://agmx-v2.vercel.app/leads
   - Sign in with Supabase Auth (create user in Dashboard)
   - See assessment lead, generate quote
4. **Checkout**: https://agmx-v2.vercel.app/checkout
   - Quote → Invoice → Payment (Billplz/HitPay sandbox)
5. **AI Copilot**: https://agmx-v2.vercel.app/app → "AI Copilot" tab
   - Ask questions about indexed documents

---

## 🔧 Local Development

```bash
# 1. Copy config example
cp config.example.js config.local.js
# Edit config.local.js with your Supabase URL + anon key

# 2. Set LLM provider (in terminal)
export LLM_PROVIDER=nvidia
export NVIDIA_NIM_API_KEY=nvapi-...

# 3. Start local server
npx serve . -p 3000
# or
python3 -m http.server 3000

# 4. Open http://localhost:3000
```

For local Supabase:
```bash
supabase start  # Requires Docker
# Then use local credentials in config.local.js
```

---

## 💰 Cost Breakdown (Monthly)

| Service | Free Tier | Trial Credits | Est. Paid Cost |
|---------|-----------|---------------|----------------|
| Vercel | ✅ Hobby | — | $0 |
| Supabase | 500MB DB | $100 (6+ mo) | $25/mo Pro |
| **OpenAI** | — | — | ~$10/mo (demo) |
| **NVIDIA NIM** | ✅ Free tier on build.nvidia.com | — | **$0 for dev** / Self-hosted |
| Billplz/HitPay | Sandbox | — | Per transaction |
| **Total (OpenAI)** | **$0 for 6+ months** | | **~$35/mo after** |
| **Total (NVIDIA NIM)** | **$0** | | **~$25/mo (Supabase only)** |

> **NVIDIA NIM Advantage**: Free tier on build.nvidia.com includes generous rate limits for development. Self-hosted NIM on your own GPU = $0 API costs.

---

## 🔐 Security Checklist

- [ ] All secret keys in Vercel/Supabase env vars (not in code)
- [ ] RLS policies enabled on all tables **and** policies created (`schema_final.sql` does both; `schema.sql` enables RLS with no policies, which silently returns zero rows to every read)
- [ ] CSP headers configured (vercel.json includes NVIDIA NIM domain)
- [ ] HTTPS only (Vercel default)
- [ ] Billplz/HitPay webhook signatures verified
- [ ] Rate limiting on Edge Functions (add if needed)
- [ ] Every deploy CLI has an ignore file: `.vercelignore` for Vercel, `.wrignore` for `wrangler pages deploy`. Neither reads `.gitignore`, and `wrangler.jsonc` serves the repo root as assets, so `.env.local` / `pb_data/` / `/config.js` go public without it. `tools/check.sh` enforces both.

---

## 📁 Key Files

```
AGMX-v2-app/
├── supabase/
│   ├── config.toml             # CLI project config; declares verify_jwt per function
│   ├── migrations/             # 0001…0010 — the source of truth for the schema
│   ├── schema_final.sql        # GENERATED from migrations/ in order — paste this one, never edit
│   ├── archive/                # superseded schemas — history only, never apply
│   └── functions/
│       ├── governance/         # AGM Hall RPCs (attendance, motions, votes, resolutions, compliance)
│       ├── money-flow/         # Assessment → Quote → Invoice → Payment
│       ├── knowledge-query/    # AI Copilot RAG queries
│       └── knowledge-ingest/   # Document indexing pipeline
├── tools/build_schema_bundle.py # regenerates supabase/schema_final.sql
├── supabase/functions/_shared/llm.ts  # Unified LLM client (OpenAI + NVIDIA NIM)
├── vercel.json                 # Vercel config (rewrites, headers, CSP)
├── wrangler.jsonc              # Cloudflare Pages assets config
├── .vercelignore / .wrignore   # Deploy-CLI exclusion lists (neither reads .gitignore)
├── config.example.js           # Client config template
├── deploy.sh                   # Automated deployment script
├── .github/workflows/deploy.yml # CI/CD
└── DEPLOY.md                   # This file
```

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| `supabase functions deploy` fails | Check CLI version (`supabase --version`), ensure linked to correct project |
| Edge Function timeout | Increase timeout in function config, optimize queries |
| CORS errors | Check `corsHeaders` in functions, verify Vercel CSP `connect-src` |
| Realtime not working | Enable replication in Supabase Dashboard, check RLS policies |
| Payment webhook 404 | Ensure `APP_URL` in Supabase secrets matches Vercel deployment URL |
| **NVIDIA NIM 401 Unauthorized** | Verify `NVIDIA_NIM_API_KEY` is valid NGC API Key |
| **NVIDIA NIM 404 Model Not Found** | Check model name on build.nvidia.com; some models require access request |
| **Embedding dimension mismatch** | Ensure `NVIDIA_NIM_EMBEDDING_DIMS=1024` matches pgvector schema |

---

## 📞 Support

- **Duta Integra Team**: https://vercel.com/duta-integra
- **Supabase Dashboard**: https://supabase.com/dashboard/project/YOUR_REF
- **Vercel Project**: https://vercel.com/duta-integra/agmx-v2-app
- **NVIDIA NIM**: https://build.nvidia.com/