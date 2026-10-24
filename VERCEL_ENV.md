# AGMX-v2 — Vercel Environment Variables (Production)

## ⚠️ Critical: Secrets Management

| Variable | Value | Environment | Notes |
|----------|-------|-------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lcrfsqocqavczgnzpadq.supabase.co` | All | **Publishable** - safe for browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | (from Supabase → Settings → API → Publishable key) | All | **NEW: Use publishable key, not anon** |
| `SUPABASE_SECRET_KEY` | (from Supabase → Settings → API → Secret key) | **Production only** | **Server-only! Never NEXT_PUBLIC_** |
| `NVIDIA_NIM_API_KEY` | `nvapi-...` | **NOT in Vercel!** | **⚠️ Edge Function secret only** |
| `LLM_PROVIDER` | `nvidia` | All | Safe for browser |
| `NEXT_PUBLIC_LLM_PROVIDER` | `nvidia` | All | Safe for browser |
| `NEXT_PUBLIC_NVIDIA_NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` | All | Safe for browser |
| `NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_MODEL` | `nvidia/nv-embedqa-e5-v5` | All | Safe for browser |
| `NEXT_PUBLIC_NVIDIA_NIM_CHAT_MODEL` | `meta/llama-3.1-70b-instruct` | All | Safe for browser |
| `NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_DIMS` | `1024` | All | Safe for browser |
| `NEXT_PUBLIC_APP_URL` | `https://agmx-v2-app.vercel.app` | All | Safe for browser |

---

## 🔐 Supabase Edge Function Secrets (NOT Vercel)

**Set in Supabase Dashboard → Edge Functions → Secrets:**

```
NVIDIA_NIM_API_KEY=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
LLM_PROVIDER=nvidia
```

**Never put `NVIDIA_NIM_API_KEY` in Vercel or `NEXT_PUBLIC_` variables!**

---

## 🔑 Supabase API Key Migration

### Old (Deprecated)
| Key | Use |
|-----|-----|
| `anon` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ❌ Deprecated |
| `service_role` / `SUPABASE_SERVICE_ROLE_KEY` | ❌ Deprecated |

### New (Required)
| Key | Use | Location |
|-----|-----|----------|
| **Publishable Key** | Browser access | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| **Secret Key** | Server/Edge Functions | `SUPABASE_SECRET_KEY` (Production only) |

**Get new keys:** Supabase Dashboard → Settings → API → "Project API keys" → Generate new publishable/secret keys

---

## 📋 Vercel Deployment Checklist

### Before Deploy
- [ ] Supabase schema applied (`schema_final.sql` + `knowledge_final.sql`)
- [ ] pgvector extension enabled
- [ ] Realtime configured (exclude `votes`, include `attendance`, `quorum_snapshots`, `motions`, `questions`)
- [ ] Edge Functions deployed with secrets
- [ ] New publishable/secret keys generated

### Vercel Env Vars
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `SUPABASE_SECRET_KEY` (Production only)
- [ ] `NEXT_PUBLIC_LLM_PROVIDER` = `nvidia`
- [ ] `NEXT_PUBLIC_NVIDIA_NIM_BASE_URL` = `https://integrate.api.nvidia.com/v1`
- [ ] `NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_MODEL` = `nvidia/nv-embedqa-e5-v5`
- [ ] `NEXT_PUBLIC_NVIDIA_NIM_CHAT_MODEL` = `meta/llama-3.1-70b-instruct`
- [ ] `NEXT_PUBLIC_NVIDIA_NIM_EMBEDDING_DIMS` = `1024`
- [ ] `NEXT_PUBLIC_APP_URL` = `https://agmx-v2-app.vercel.app`

### Supabase Edge Function Secrets
- [ ] `NVIDIA_NIM_API_KEY`
- [ ] `LLM_PROVIDER` = `nvidia`

---

## 🚀 Deploy Commands

```bash
# 1. Apply schema in Supabase SQL Editor (in order):
#    1. CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "vector";
#    2. Paste supabase/schema_final.sql
#    3. Paste supabase/knowledge_final.sql

# 2. Configure Realtime (Supabase Dashboard → Database → Replication):
#    - EXCLUDE votes from supabase_realtime publication
#    - INCLUDE: attendance, quorum_snapshots, motions, questions

# 3. Deploy Edge Functions (Supabase Dashboard → Edge Functions):
#    - money-flow (with secrets)
#    - knowledge-query
#    - knowledge-ingest

# 4. Deploy to Vercel:
cd /media/shamelali/Data/1-Projects/AGMX-v2
vercel --prod --scope=duta-integra
# OR use Vercel Dashboard: Import shamelali/AGMX-v2-app → Add env vars → Deploy
```

---

## ✅ Security Verification

| Check | Status |
|-------|--------|
| `NVIDIA_NIM_API_KEY` only in Supabase Edge Function secrets | ☐ |
| `SUPABASE_SECRET_KEY` only in Vercel Production env | ☐ |
| Publishable key used (not anon) | ☐ |
| `votes` excluded from Realtime publication | ☐ |
| Column-level protection on `profiles.role`/`organization_id` | ☐ |
| `votes` SELECT policy = `false` (ballot secrecy) | ☐ |
| `knowledge_search` execute revoked from PUBLIC/anon | ☐ |

---

## 📁 Final SQL Files

| File | Purpose |
|------|---------|
| `supabase/schema_final.sql` | Core schema with column protections, Realtime config, minimal grants |
| `supabase/knowledge_final.sql` | Knowledge store with secure function, no PUBLIC execute |

Run in Supabase SQL Editor **in order**:
1. `CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "vector";`
2. Paste `supabase/schema_final.sql`
3. Paste `supabase/knowledge_final.sql`
4. Run Realtime config: `ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.votes; ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance, public.quorum_snapshots, public.motions, public.questions;`