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
│  ├── Edge Functions — money-flow, knowledge-query, ingest      │
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
In Supabase SQL Editor, run in order:
```sql
-- 1. Core schema (from supabase/schema_final.sql)
-- Copy-paste entire file

-- 2. Knowledge schema (from supabase/knowledge_final.sql)
-- Copy-paste entire file

-- 3. Realtime
-- No dashboard step needed: schema_final.sql ends by managing
-- supabase_realtime itself (attendance, quorum_snapshots, motions,
-- questions) and removes `votes`, because a realtime feed of a ballot and
-- a secret ballot cannot both exist.
```

`schema.sql` / `knowledge_schema.sql` are the earlier pair and are **not** a
valid install for a new project: RLS is enabled on all 33 tables with zero
policies, so every read returns no rows, and they contain neither
`check_rate_limit` nor `process_payment_webhook`, so all three Edge Functions
fail closed on the first request. `tools/check.sh` pass 15 reports any RPC that
exists in only one of the two pairs.

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
```bash
# Install Supabase CLI
npm install -g supabase

# Login & link
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Deploy functions
supabase functions deploy money-flow --no-verify-jwt   # gateway webhooks (Billplz/HitPay) cannot send a Supabase JWT
supabase functions deploy knowledge-query
supabase functions deploy knowledge-ingest

# Set secrets (server-only)
supabase secrets set OPENAI_API_KEY=sk-...              # If using OpenAI
supabase secrets set NVIDIA_NIM_API_KEY=nvapi-...       # If using NVIDIA NIM
supabase secrets set LLM_PROVIDER=nvidia                # If using NVIDIA NIM
supabase secrets set BILLPLZ_API_KEY=...
supabase secrets set BILLPLZ_COLLECTION_ID=...
supabase secrets set BILLPLZ_X_SIGNATURE=...            # X Signature key (NOT the API Secret Key)
supabase secrets set HITPAY_API_KEY=...
supabase secrets set HITPAY_SALT=...                    # Per-webhook salt (Dashboard → Developers → Webhooks)
supabase secrets set HITPAY_API_URL=https://api.sandbox.hit-pay.com   # Production: https://api.hit-pay.com
```

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
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Server-only
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
NEXT_PUBLIC_APP_URL=https://agmx-v2-app.vercel.app
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_KNOWLEDGE_RAG=true
NEXT_PUBLIC_REALTIME=true
```

### 7. Deploy
```bash
vercel --prod --scope=duta-integra
```

---

## 🧪 Test the Flow

1. **Landing**: https://agmx-v2-app.vercel.app
2. **Assessment**: https://agmx-v2-app.vercel.app/assessment
   - Answer 12 questions → Get complexity score → Recommended plan
3. **Leads** (operator): https://agmx-v2-app.vercel.app/leads
   - Sign in with Supabase Auth (create user in Dashboard)
   - See assessment lead, generate quote
4. **Checkout**: https://agmx-v2-app.vercel.app/checkout
   - Quote → Invoice → Payment (Billplz/HitPay sandbox)
5. **AI Copilot**: https://agmx-v2-app.vercel.app/app → "AI Copilot" tab
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
│   ├── schema_final.sql        # Core schema + RLS + RPCs (apply this one)
│   ├── knowledge_final.sql     # pgvector knowledge store (apply this one)
│   ├── schema.sql              # superseded: RLS with no policies, no RPCs
│   ├── schema_fixed.sql        # superseded intermediate
│   ├── knowledge_schema.sql    # superseded: 4-arg knowledge_search, grants to anon
│   ├── knowledge_fixed.sql     # superseded intermediate
│   └── functions/
│       ├── money-flow/         # Assessment → Quote → Invoice → Payment
│       ├── knowledge-query/    # AI Copilot RAG queries
│       └── knowledge-ingest/   # Document indexing pipeline
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