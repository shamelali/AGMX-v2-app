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

> `/api/config.js` prefers `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and still
> accepts the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` as a fallback.

---

## 🔐 Supabase Edge Function Secrets (NOT Vercel)

**Set in Supabase Dashboard → Edge Functions → Secrets:**

```
NVIDIA_NIM_API_KEY=nvapi-...   # set via Supabase secrets; never commit the real value
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
- [ ] Supabase schema applied (`supabase/schema_final.sql`, generated from `supabase/migrations/`)
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
# 1. Apply the schema — one paste, in the Supabase SQL editor:
#    Paste the whole of supabase/schema_final.sql
#    It is generated from supabase/migrations/*.sql (tools/build_schema_bundle.py)
#    and already creates pgcrypto + vector, the tables, RLS, the RPCs and the
#    plans seed. Regenerate it whenever a migration changes.

# 2. Realtime needs no dashboard step: the bundle ends by managing the
#    supabase_realtime publication itself (adds attendance, quorum_snapshots,
#    motions, questions; drops votes, because a realtime feed would stream ballots).

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

## 📁 SQL Files

| Path | Role |
|------|------|
| `supabase/migrations/*.sql` | **Source of truth.** 0001 core schema + RLS + realtime, 0002 pgvector knowledge store, 0003 plans seed, 0004 privilege revokes, 0005 `search_path` pins, 0006 subscriptions/billing RPCs, 0007 governance RPCs |
| `supabase/schema_final.sql` | Generated concatenation of the above, in filename order — the one file to paste. Never edit it; `tools/check.sh` fails the repo if it drifts |
| `supabase/archive/*.sql` | Superseded pair. RLS enabled with zero policies, so every read returns no rows — history only |

`supabase/knowledge_final.sql` used to be pasted second. It is deleted: `0002` is
inside the generated bundle now, and pasting two files that both `create or
replace` the same objects is how the pair fell out of step in the first place.

One paste in the Supabase SQL editor is the whole install; `supabase db push`
does the same from the CLI. Both are rerun-safe.