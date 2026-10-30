# AGMX — PocketBase Backend

Replaces Supabase. Single Go binary, SQLite, built-in auth + realtime + file
storage, self-hostable for data sovereignty.

---

## Files

| File | Purpose |
|---|---|
| `collections.json` | 31 collection definitions (schema + RLS rules + indexes) |
| `seed.json` | Commercial plans + compliance rules (Akta 1993 / GP14 / UUK / BRule) |
| `../pocketbase-client.js` | Dependency-free PocketBase SDK + AGMX query layer |
| `../login.js` | Login view: Google OAuth2, SMS OTP, role picker, demo mode |
| `../api.js` | Commerce API layer (`window.AGMX_COMMERCE`): LocalAdapter ↔ PocketBaseAdapter |
| `../pb_hooks/money_flow.pb.js` | Route registration for the Sprint 2 money flow (thin handlers) |
| `../pb_hooks/money_flow.lib.js` | Money-flow logic: pricing, numbering, guards, audit chain |
| `../tools/pb_migrate.py` | Creates collections against a running instance, then seeds |
| `../GOOGLE_AUTH_SETUP.md` | Google Cloud Console + PocketBase provider config |

---

## Quick start

```bash
# 1. Get PocketBase — 0.40.4 is the supported version.
#    The hooks and tools in this repo are 0.40-only; see "Version support" below.
mkdir -p bin
wget https://github.com/pocketbase/pocketbase/releases/download/v0.40.4/pocketbase_0.40.4_linux_amd64.zip
unzip pocketbase_0.40.4_linux_amd64.zip pocketbase -d bin/ && chmod +x bin/pocketbase
./bin/pocketbase --version

# 2. Start it from the repo root so ./pb_hooks is picked up
AGMX_ALLOW_SIMULATED_PAYMENTS=1 ./bin/pocketbase serve --http=127.0.0.1:8090
#    running the binary from elsewhere? pass --hooksDir=/path/to/AGMX/pb_hooks

# 3. Create the superuser (0.40 has no installer account)
./bin/pocketbase superuser upsert admin@agmx.test '<password>' --dir pb_data

# 4. Create collections + seed data
python3 tools/pb_migrate.py --url http://127.0.0.1:8090 \
  --email admin@agmx.test --password '<password>' --dir pb_data

# 5. Configure Google OAuth2 — see GOOGLE_AUTH_SETUP.md

# 6. Point the client at it
cp config.example.js config.js   # then edit url + googleClientId

# 7. Serve the app
python3 -m http.server 8091
# open http://localhost:8091/app.html
```

Admin UI: <http://127.0.0.1:8090/_/>

---

## Version support

**PocketBase 0.40.4 is the only supported version.** `tools/check.sh` pass 10
enforces this: it scans `pb_hooks/` for the APIs 0.23 renamed or removed
(`$app.dao()`, `.saveRecord()`, `$apis.*`, `c.queryParam()`, `.getId()`,
`Collection.schema`) and fails the build if any reappear.

The Sprint 2 money flow was originally written against 0.22 and had never
been run on 0.40, so it broke in eight places the first time it was booted
against the version `main` targets. Porting them is what made the live suite
pass. Anything older than 0.23 will not work.

---

## Re-running the migration

`pb_migrate.py` is safe to re-run and is **additive**:

| Step | Behaviour on an existing instance |
|---|---|
| Collections | Created only if missing |
| **Fields** | **Declared fields missing from the live schema are added** |
| Rules | Re-synced from `collections.json` (no data loss) |
| Indexes | Applied after creation |
| Fields only on the server | Reported, never removed — removal is destructive |

Field drift used to be silent: `create_collections()` skipped any collection
that already existed, so editing `collections.json` printed no error and
changed nothing on the server. Adding an explicit field to an existing
collection now reports it.

If you need a clean slate, `--recreate` drops and rebuilds every AGMX
collection. It also detaches `users.organizationId` first, because
PocketBase refuses to drop a collection that another one still references.

> **Adding a field to an existing collection previously required
> `--recreate`.** That is no longer true.

---

## Tenancy model

`organizationId` on every business collection is the tenancy boundary.
Collection rules enforce isolation in the database, not in JavaScript:

```
listRule:   organizationId = @request.auth.organizationId
createRule: organizationId = @request.auth.organizationId
```

`organizationId` and `role` live on the **auth record** (set in the admin UI
per user) so PocketBase exposes them as `@request.auth.*`.

### Append-only tables

`votes` and `audit_events` have `updateRule: ""` and `deleteRule: ""` — once a
vote is cast or an audit event written, no client can change or remove it.

### Tamper-evident audit chain

`pocketbase-client.js → appendAudit()` computes
`sha256(prev_hash | occurred_at | action | entity_type | entity_id | payload)`
and stores it. Every event links to its predecessor, so altering any historical
record breaks every hash after it.

> Requires HTTPS. On an `http://` origin the WebCrypto API is unavailable and
> the client falls back to a **non-cryptographic** hash, which is logged as
> `weak-<n>`.

---

## Money flow (Sprint 2) — `pb_hooks/money_flow.*`

Server-side home of quote → invoice → payment. Every commercial invariant
lives in the hook, never in the browser: complexity score recomputed from raw
answers, prices taken from the `plans` collection + the rate card in
`money_flow.lib.js`, document numbers (LD-/QT-/INV-) minted centrally,
double payments rejected inside a transaction, and every step appended to the
SHA-256-chained `audit_events` (same chain format as `pocketbase-client.js`).

> **v0.22 JSVM quirk:** route handlers are re-evaluated per request in a
> pooled runtime and cannot see `.pb.js` file scope — all logic therefore
> lives in `money_flow.lib.js`, pulled in via
> `require(__hooks + "/money_flow.lib.js")`. Keep handlers thin.

| Route | Access | Purpose |
|---|---|---|
| `POST /api/agmx/assessment` | public | lead capture; returns `LD-xxxx` + one-time `checkoutToken` |
| `GET /api/agmx/lead?ref&t` | token or operator | the lead's deal (quote/invoice/payment state) |
| `POST /api/agmx/quote` | token or operator | server-priced quote (`packageKey`, `addons[]`; client items ignored) |
| `POST /api/agmx/quote/accept` | token or operator | accept before `validUntil`, else quote expires |
| `POST /api/agmx/invoice` | token or operator | NET-14 invoice from an accepted quote |
| `POST /api/agmx/payment` | token or operator | record payment; `pending` unless simulated (see env) |
| `POST /api/agmx/payment/confirm` | operator | verify bank transfers — production gateway webhooks land here |
| `POST /api/agmx/lead/stage` | operator | manual stage moves (document-driven stages rejected) |
| `GET /api/agmx/deals` | operator | inbox join + **server-computed** pipeline metrics |
| `GET /api/agmx/audit?ref&t` | token (own lead) or operator (all) | audit trail feed |

**Access model.** Prospects hold an unguessable `checkoutToken`
(`?ref=LD-0007&t=…`) minted at submission and stored in a `hidden` field —
enumerating `LD-xxxx` alone leaks nothing. Operators are `users` records with
`role` `admin`/`secretary` bound to the money-flow org.

**Environment.**

| Var | Default | Meaning |
|---|---|---|
| `AGMX_OPERATOR_ORG` | `agmx-ops` | slug/id of the org owning all money-flow records (auto-created once) |
| `AGMX_ALLOW_SIMULATED_PAYMENTS` | _(unset)_ | `1` lets fpx/card settle instantly — **demo instances only** |
| `AGMX_ANY_ORG_STAFF` | _(unset)_ | `1` lets admin/secretary of *any* org run the inbox (single-operator setups) |

Without the simulate flag every payment lands as `pending` until
`POST /api/agmx/payment/confirm` — the same endpoint a licensed gateway
webhook should call (authenticate the webhook with a shared secret header
before trusting it).

**Schema additions (this sprint).** `agm_assessments.reference` (unique,
`LD-xxxx`), `agm_assessments.token` (hidden checkout token), and the
`scheduled` status value. Fresh instances get them via `pb_migrate.py`;
for an existing instance re-run the migration (pass 2 PATCHes schemas) or add
the fields in the Admin UI.

**Tests.**

```bash
node tools/test_money_flow.mjs       # local adapter — 61 assertions
node tools/test_money_flow_pb.mjs \
  --url http://127.0.0.1:8090 \
  --email admin@agmx.test --password …   # live hooks — 63 assertions
node tools/test_money_flow_adapter.mjs    # live, through api.js — 23 assertions
# ⚠ the live suites WIPE money-flow collections first — dev instances only
```

---

## Collections

| Group | Collections |
|---|---|
| Identity | `organizations` |
| Members | `members`, `member_status_history` |
| AGM | `agms`, `agm_settings`, `agenda_items`, `candidates`, `agm_notices`, `notice_recipients`, `attendance`, `quorum_snapshots` |
| Governance | `motions`, `votes`, `resolutions`, `questions`, `actions` |
| Compliance | `compliance_rules`, `compliance_checks`, `compliance_findings` |
| Evidence | `documents`, `audit_events` |
| Commercial | `plans`, `subscriptions`, `agm_assessments`, `quotes`, `invoices`, `payments` |
| Distribution | `partners`, `partner_organizations`, `federations`, `federation_organizations` |

Plus the built-in `_pb_users_auth_` collection for accounts.

---

## Demo mode

`config.example.js` ships `demoMode: true`. When PocketBase is unreachable the
app falls back to `data.js` (the KOPEMAJU mock dataset) so the demo keeps
working. **Set `demoMode: false` in production** so a database outage surfaces
as an error rather than silently showing fabricated data.

---

## Deployment

PocketBase is a single binary — deploy it anywhere:

```bash
# Docker (mount pb_hooks so the money-flow routes load)
docker run -d -p 8090:8090 \
  -v /srv/agmx-pb/pb_data:/pb/pb_data \
  -v /srv/agmx/AGMX/pb_hooks:/pb/pb_hooks \
  -e PB_ADMIN_EMAIL=... -e PB_ADMIN_PASSWORD=... \
  -e AGMX_OPERATOR_ORG=agmx-ops \
  pocketbase/pocketbase:latest

# systemd on a VPS (run from the repo root, or pass --hooksDir)
./pocketbase serve --http=127.0.0.1:8090 --dir /srv/agmx-pb/pb_data \
  --hooksDir /srv/agmx/AGMX/pb_hooks
```

Put it behind a reverse proxy with TLS. Back up by copying `pb_data/`.

**Data sovereignty:** self-hosting in Malaysia keeps cooperative member records
under local control — relevant for SKM-facing deployments.
