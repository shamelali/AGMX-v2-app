# AGMX — Cooperative Governance Operating System

> A complete SaaS web app prototype for **AGMX**, the Cooperative AGM Operating System built per the 10-volume master PRD.

## 🎯 What is AGMX?

AGMX is an enterprise SaaS platform that digitises Malaysian cooperative (koperasi) governance, especially the **Annual General Meeting (AGM)**. It replaces manual/hybrid paper-based processes with:

- **Compliance-by-Design** (Akta Koperasi 1993 · GP14 · GP14B · UUK)
- **AI Governance Copilot** (multi-agent RAG over financial docs)
- **E-Voting** with AES-256 encryption + immutable hash chain
- **Senior Friendly Mode** (60-80px buttons, One Screen One Action)
- **Multi-tenant SaaS** (Starter → Enterprise → Platinum → Unlimited)

## 📂 Files

```
AGMX/
├── index.html          # Public marketing landing page (entry point)
├── app.html            # SPA application shell
├── styles.css          # Full design system (light + dark + high-contrast)
├── app.js              # SPA router + 13 view renderers + interactions
├── data.js             # Mock cooperative data (demo mode fallback)
│
├── assessment.html/js  # Free 12-question AGM assessment → score → package
├── checkout.html/js    # Quote → invoice → payment → receipt
├── leads.html/js       # Operator inbox: metrics, CSV, backend switch
├── api.js              # window.AGMX_COMMERCE — LocalAdapter ↔ PocketBaseAdapter
├── login.js            # Google OAuth2 / SMS OTP / passkey / demo
├── pocketbase-client.js # Dependency-free PocketBase SDK + query layer
├── config.example.js   # Copy to config.js (gitignored, per-deployment)
│
├── pb_hooks/           # Server-side money flow (PocketBase JSVM)
├── pocketbase/         # collections.json (31) + seed.json + README
├── tools/              # check.sh, pb_migrate.py, harden_rules.py, test suites
├── sw.js               # Service worker (offline + precache)
├── vercel.json         # Vercel deployment config
├── assets/ images/     # Static assets
└── README.md           # This file
```

## 🧪 Tests

```bash
node tools/test_money_flow.mjs      # 61 assertions — local adapter, zero deps
bash tools/check.sh                 # 10 passes / 25 checks (AGMX_SKIP_NET=1 offline)

# Live suites need a running PocketBase 0.40.4 — they WIPE money-flow
# collections first, so never point them at production.
node tools/test_money_flow_pb.mjs      --url http://127.0.0.1:8090 --email … --password …  # 63
node tools/test_money_flow_adapter.mjs                                                    # 23
```

See `pocketbase/README.md` to stand one up, and `tools/CHECKS.md` for what
each check pass covers.

## 🚀 How to run

Open `index.html` for the marketing landing page, or `app.html` for the SPA application, in any modern browser — no build step required.

For best experience use Chrome/Edge/Safari (latest).

## 🗺️ App Sections

| # | Section | What it does |
|---|---------|-------------|
| 1 | **Login (One Click Join)** | SMS/WhatsApp OTP + Passkey, role picker (Secretary / Chairman / Member) |
| 2 | **Dashboard** | Live greeting, KPIs, quorum gauge, agenda, financial RAG summary, meeting pack |
| 3 | **Members** | Bulk list with eligibility filters (Layak / Tunggakan / Proksi), CSV import/export |
| 4 | **AGM Live Hall** | Virtual hall with 5 layouts (Town Hall, Conference, Presentation, Discussion, Voting), speaker queue, panic button |
| 5 | **E-Voting** | Smart Candidate Gallery (adaptive grid), vote basket, A-Z filter, live timer |
| 6 | **Motions & Resolusi** | Motion chain (Proposer → Seconder → Discuss → Vote), live tally, AI minute writer |
| 7 | **AI Copilot** | 4 agents (Chairman / Secretary / Compliance / Organizer), RAG citations, action tracker |
| 8 | **Compliance SKM** | 98/100 governance gauge, BRule engine, Akta/GP14 matrix |
| 9 | **Digital Vault** | Immutable hash chain visual, audit log, Zero Trust security matrix |
| 10 | **Settings** | Senior Mode toggle, theme (default / high-contrast / dark), language, billing |

## 🎨 Design System Highlights

Built strictly from the **Volume 5 UI/UX specification**:

- **One Screen, One Action** — every view shows only the primary task
- **Senior Friendly** — body font 15px (18px in Senior Mode), buttons 9-14px padding (XL: 18px/64px tall)
- **Color palette** — Malaysian-inspired primary blue `#0B5394` + accent gold `#D4A017`
- **3 themes** — Default / High Contrast / Dark (cycle via header button)
- **2 languages minimum** — Bahasa Melayu primary + English visible labels
- **One Click Join** — login via OTP, no passwords for elderly members
- **Panic Button** — in AGM hall: "Saya Perlukan Bantuan" calls admin within 30s

## 🤖 AI Features Implemented

| Agent | Capabilities |
|-------|--------------|
| **AI Chairman & Moderator** | Procedural reminders ("Pencadang missing", "Voting 2 min left") |
| **AI Secretary & Minute Writer** | Real-time speech-to-text draft of Minit Mesyuarat |
| **AI Compliance & Legal** | Cross-checks resolutions against Akta/GP14/UUK, auto-flags violations |
| **AI Question Organizer** | Groups 12 duplicate "Dividen" questions into 1 consolidated item |
| **AI Action Tracker** | Converts passed motions into PIC+DueDate tasks |
| **RAG Knowledge Room** | Indexes 1,247 docs; answers "Berapakah dividen TK 2024?" with citation |

## 🛡️ Security & Compliance

- Immutable Hash Chain visualisation (7,891 blocks)
- AES-256 + TLS 1.3 indicators
- Zero Trust matrix (MFA, Passkey, Device Binding, Geo Blocking, Anti-Bot, Fraud Detection)
- BRule-001 → BRule-005 enforcement examples visible throughout

## 🌏 Localisation

All labels are in Bahasa Melayu with key English terms inline. AI auto-translate indicator (BM → EN / TA / 中文 / ID) shown in settings.

---

**Built as a demo of the AGMX vision documented across the 10-volume PRD.**
