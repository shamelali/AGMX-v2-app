# AGMX v2.0 — Sprints 7–14 Design Doc

Source: PRD v2.0 sprint specs §§7–10, 12–14; Phase 1 Release Contract (G1–G9); Security Model & RBAC.
Status: written for autonomous implementation (user authorized "proceed recommended autonomously").

## 1. Scope and phase boundaries

| Sprint | Focus | Phase | Build now |
|--------|-------|-------|-----------|
| 7 | Registration + Presence + Quorum | 1 | yes |
| 8 | Voting Refactor — elections, secret ballots, maker-checker | 1 | yes |
| 9 | AGMX Hub — participant workspace | 1 | yes |
| 10 | AGMX Control — Mission Control, operator console | 1 | yes |
| 11 | AGMX LIVE — self-hosted WebRTC chamber | 2 | no (deferred; routes reserved) |
| 12 | Minutes — manual draft/review/verify/approve/lock | 1 | yes (manual only; AI is Phase 2) |
| 13 | Post-AGM + Evidence Vault — minimum immutable export | 1 | yes |
| 14 | Hardening — WCAG, load, retention, DR, claims | 1/2 | yes (checks + claims audit) |

Phase 1 gate = one physical AGM managed end-to-end with auditable records (G1–G9).
Sprint 11 (WebRTC) is Phase 2: reserve routes and shell screens, do not implement media.

## 2. Existing patterns to follow (do not invent new ones)

- **DB**: `supabase/migrations/*.sql` is the source of truth; `supabase/schema_final.sql` is regenerated with `tools/build_schema_bundle.py`. Every table gets RLS; every mutating RPC is `security definer`, granted only to `service_role`, revoked from `public/anon/authenticated`; every statement rerun-safe (`if not exists`, `or replace`, `drop policy if exists` first).
- **Edge Function**: `supabase/functions/governance/index.ts` — `authContext(req)` resolves org + role; handlers return JSON via `ok()`/`err()`; tenant boundary checked server-side by comparing `organization_id` with `ctx.profile.organization_id`; RPCs invoked with the service-role client.
- **Client**: `supabase-client.js` — `AGMX_API.governance` proxy POSTs to `/functions/v1/governance<path>` with Bearer + apikey; new proxy methods follow the existing `e => e("/path", body)` shape; `db.*` direct Supabase reads stay where RLS permits.
- **Views**: `app-bootstrap.js` hash router — `ROUTES` map, `routeFromHash()` allowlist, `buildNav()` role-gated links, `renderRoute()` dispatch to view modules registered on `window.AGMX_*` (e.g. `window.AGMX_GOVERNANCE` with `routes: [...]` and render functions).
- **View modules** (e.g. `governance-ui.js`): `node()`/`append()` DOM only — no `innerHTML`; `t()` i18n via local map; `submitWrite(status, work, rerender)` and `runAction(event, ctx, work, rerender)` patterns; demo source shows disabled-state banner, never fake writes.
- **Security**: secret ballot store is separate from identity/eligibility; one entitlement → one accepted ballot (`votes`/`ballots` unique constraint); ballot receipt must not encode choice; results unpublished until authorised verification; append-only tables get `raise_append_only()` triggers; audit via `log_audit()` hash chain.

## 3. Data model — migrations 0019–0023

### 0019_registration_presence.sql
- `public.registrations(id, organization_id, agm_id, member_id, status, channel, acknowledged_at, created_at)` — RSVP/registration per member per AGM; `unique(agm_id, member_id)`.
- `public.presence_events(id, agm_id, member_id, method, channel, checked_in_at, created_at)` — timestamped check-in events (append-only trigger).
- RLS org-scoped; direct reads via RLS for members of the org; mutations through Edge Function RPCs `register_member(agm_id, member_id, status, channel)` and `check_in_member(agm_id, member_id, method)`.
- Quorum read: `quorum_snapshots` exists (Sprint 5); registration counts feed the readiness gate before Convene.

### 0020_elections_ballots.sql
- `public.elections(id, organization_id, agm_id, title, status, opens_at, closes_at, quorum_required, created_at, verified_at, verified_by, published_at, published_by)` — election control centre state.
- `public.ballots(id, election_id, voter_member_id, receipt_token, cast_at, created_at)` — SECRET ballot store: no choice column, one row per voter (`unique(election_id, voter_member_id)`), receipt token is random and unlinked to choice.
- `public.ballot_selections(id, ballot_id, choice, created_at)` — selections stored separately; choice values `ya/tidak/kecuali`; no foreign key to voter-identifying data exposed in receipts.
- RPCs (security definer, service_role only): `election_configure`, `election_open(agm_id)`, `election_suspend(agm_id)`, `election_close(agm_id)` (maker-checker: requires two distinct operator calls / approval marker), `cast_ballot(election_id, choice)` (binds voter from session, idempotent), `election_verify(agm_id, actor)`, `election_publish(agm_id, actor)` (gate: verified only), `election_tally(election_id)` (read-only, returns counts without voter linkage).
- `cast_ballot` enforces: voter on frozen electoral roll with `vote_eligible`, election status open, one ballot per voter (idempotent — returns existing ballot if already cast).
- Immutable snapshots: election opens only if `electoral_rolls.frozen_at` is not null for the AGM and a `candidates` snapshot exists.

### 0021_nominations_candidates.sql
- `public.nominations(id, organization_id, agm_id, member_id, position, statement, status, reviewed_by, reviewed_at, review_reason, created_at)` — status: submitted/reviewing/approved/rejected.
- `public.candidates(id, organization_id, agm_id, nomination_id, member_id, member_no, name, snapshot_at)` — immutable snapshot when election opens (`unique(agm_id, member_id)`).
- RPCs: `nomination_submit`, `nomination_review(approve/reject + reason)`, `candidates_snapshot(agm_id)` (called at election open).

### 0022_minutes.sql
- `public.minutes(id, organization_id, agm_id, title, status, drafted_by, drafted_at, reviewed_by, reviewed_at, verified_by, verified_at, approved_by, approved_at, locked_at, locked_by, content, created_at)` — status: draft/editorial_review/verification/approved/locked.
- `public.minute_versions(id, minutes_id, version, content, edited_by, edited_at)` — append-only version history.
- Human verification mandatory: `status` cannot move past `verification` without a `verified_by`/`verified_at` row; lock requires `approved_by`; locked rows protected by append-only trigger (no UPDATE/DELETE).
- RPCs: `minutes_create`, `minutes_edit` (draft only), `minutes_submit_review`, `minutes_verify`, `minutes_approve`, `minutes_lock`.

### 0023_evidence_incidents.sql
- `public.evidence_items(id, organization_id, agm_id, category, filename, storage_path, mime, size_bytes, sha256, registered_by, created_at)` — hash-registered evidence (notice, roll, attendance, documents, nominations, ballots/tallies, minutes, incidents, audit logs).
- `public.evidence_packages(id, organization_id, agm_id, status, exported_at, exported_by, export_path, sha256, closed_at)` — immutable after closure (`status`: collecting/exported/closed).
- `public.incidents(id, organization_id, agm_id, occurred_at, actor, description, evidence_refs, resolution, created_at)` — incident register (append-only trigger).
- RPCs: `evidence_register`, `evidence_package_create`, `evidence_package_close`, `incident_record`.
- Append-only triggers on `evidence_items`, `evidence_packages`, `incidents` (modeled on `raise_append_only()`).

## 4. Edge Function handlers (governance/index.ts)

New endpoints under `/functions/v1/governance`:
- `POST /registration` — `{agmId, memberId, status, channel}` → `register_member`
- `POST /presence` — `{agmId, memberId?, method}` → `check_in_member` (self check-in allowed; operator can check in others)
- `GET /agm/:id/registrations` — registration list + quorum/readiness counts
- `POST /elections` — `{agmId, title, opensAt, closesAt, ...}` → `election_configure`
- `POST /elections/open` — `{agmId}` → `election_open` (checks frozen roll + candidates snapshot)
- `POST /elections/suspend` — `{agmId}` → `election_suspend`
- `POST /elections/close` — `{agmId}` → `election_close` (maker-checker approval)
- `POST /ballot` — `{electionId, choice}` → `cast_ballot`
- `GET /elections/:id/tally` — counts only
- `POST /elections/verify` — `{agmId}` → `election_verify`
- `POST /elections/publish` — `{agmId}` → `election_publish`
- `POST /nominations` — `{agmId, memberId, position, statement}` → `nomination_submit`
- `POST /nominations/review` — `{nominationId, approved, reason}` → `nomination_review`
- `GET /agm/:id/candidates` — snapshot list
- `POST /minutes` — `{agmId, title, content}` → `minutes_create`
- `POST /minutes/:id/edit` — draft edit → new `minute_versions` row
- `POST /minutes/:id/submit-review` → `minutes_submit_review`
- `POST /minutes/:id/verify` → `minutes_verify`
- `POST /minutes/:id/approve` → `minutes_approve`
- `POST /minutes/:id/lock` → `minutes_lock`
- `POST /evidence` — register evidence item → `evidence_register`
- `POST /evidence-package` — create/close package → `evidence_package_create` / `evidence_package_close`
- `POST /incidents` — record incident → `incident_record`
- `GET /agm/:id/system-health` — connection/recording/voting/database/backup state (Control requirement)
- `POST /emergency` — `{type: technical_recess|pause_agm|suspend_voting|adjourn_agm}` → audit + stage effect
- `GET /agm/:id/speaker-queue`, `POST /speaker-queue` — raise hand / speaker queue (Control requirement; persisted for Sprint 11 reuse)
- `GET /agm/:id/questions`, `POST /questions` — question moderation (original audit record preserved; no delete)

Auth: `isOperator` (admin/secretary/administrator) for control mutations; members may register, check in themselves, cast ballots, submit nominations, view own data.

## 5. Client API extensions (supabase-client.js)

Extend `AGMX_API.governance` with: `registrations(agmId)`, `registerMember(...)`, `checkInMember(...)`, `presence(agmId)`, `elections(agmId)`, `configureElection(...)`, `openElection(agmId)`, `suspendElection(agmId)`, `closeElection(agmId)`, `castBallot(electionId, choice)`, `tally(electionId)`, `verifyElection(agmId)`, `publishElection(agmId)`, `nominations(agmId)`, `submitNomination(...)`, `reviewNomination(...)`, `candidates(agmId)`, `minutes(agmId)`, `createMinutes(...)`, `editMinutes(...)`, `submitMinutesReview(...)`, `verifyMinutes(...)`, `approveMinutes(...)`, `lockMinutes(...)`, `evidence(agmId)`, `registerEvidence(...)`, `evidencePackages(agmId)`, `closeEvidencePackage(...)`, `incidents(agmId)`, `recordIncident(...)`, `systemHealth(agmId)`, `emergency(...)`, `speakerQueue(agmId)`, `joinSpeakerQueue(...)`, `questions(agmId)`, `moderateQuestion(...)`.

Plus top-level groups mirroring existing shape where helpful: `AGMX_API.registration`, `AGMX_API.elections`, `AGMX_API.minutes`, `AGMX_API.evidence`.

## 6. Bootstrap routing (app-bootstrap.js)

Add to `ROUTES`: `registration: "#/registration"`, `voting: "#/voting"`, `hub: "#/hub"`, `control: "#/control"`, `live: "#/live"`, `minutes: "#/minutes"`, `evidence: "#/evidence"`.
Extend `routeFromHash()` allowlist accordingly.
Extend `buildNav()`:
- Member/Delegate: Hub, Registration, Voting (when eligible).
- Operator/Chairman: Control, Registration, Voting, Elections.
- `isOperator()` already exists; add `isMember()` helper (role member/delegate or not admin).
Extend `renderRoute()` dispatch to new view modules: `window.AGMX_REGISTRATION`, `window.AGMX_VOTING`, `window.AGMX_HUB`, `window.AGMX_CONTROL`, `window.AGMX_LIVE`, `window.AGMX_MINUTES`, `window.AGMX_EVIDENCE`, each with `routes: [...]` and render functions.

All new pages are standalone HTML+JS on `styles.css` (assessment/quote pattern), loaded directly by route hrefs when not in the shell, or rendered inside the shell when routed via hash.

## 7. Screens (one module per sprint)

### Sprint 7 — registration.html + registration-ui.js
RSVP form, notice acknowledgement, registration status, check-in button (self), quorum banner (live counts: physical/online/total present, threshold, status). Demo: disabled banner, no fake writes.

### Sprint 8 — elections.html + elections-ui.js
Election Control Centre: eligible voters, ballots issued/cast, rejected attempts, time remaining; open/suspend/close voting (operator, maker-checker on close); tally after verification only; scrutineer report view; ballot casting screen for eligible members (receipt without choice).

### Sprint 9 — hub.html + hub-ui.js
Participant workspace: single identity, My AGM dashboard, RSVP, AGM Pack viewer link, motion tracking, nomination application, candidate gallery, personal voting centre (eligible ballots only), ballot receipt, results/minutes where authorised. Senior/accessibility mode + low-bandwidth mode (WCAG §15).

### Sprint 10 — control.html + control-ui.js
Mission Control: live counts + quorum status, agenda controller (start/complete/pause items + events), speaker queue + mic pause/control, question moderation (preserve audit record), AV/broadcast console (cameras, presenter, screen share, stream state — status only in Phase 1; media in Sprint 11), system health (connection, recording, voting, database, backup), emergency controls (Technical Recess, Pause AGM, Suspend Voting, Adjourn AGM), incident register (timestamp, actor, description, evidence, resolution).

### Sprint 11 — live.html + live-ui.js (Phase 2)
Shell only: route + nav link + disabled notice. WebRTC chamber deferred to Phase 2 gate.

### Sprint 12 — minutes.html + minutes-ui.js (Phase 1 manual)
Minutes flow: AI draft → editorial review → verification → approved → locked; human verification mandatory before final; version history; AI hard boundaries (AI Secretary cannot finalise, etc. — UI enforces human actor for verify/approve/lock).

### Sprint 13 — evidence.html + evidence-ui.js
Evidence Vault: item register by category (notice, roll, attendance, documents, nominations, ballots/tallies, minutes, incidents, audit logs); export AGM Evidence Package after closure; immutability after closure; post-AGM task tracking with deadlines.

## 8. Verification (check.sh extensions)

New passes:
- Registration + quorum-before-convene: invalid stage transition rejected, quorum gate enforced.
- Ballot secrecy: receipt has no choice linkage; one entitlement → one ballot; duplicate cast idempotent.
- Maker-checker: close/verify/publish require authorised actor; results unpublished until verification.
- Minutes lock: human verification required; locked minutes immutable.
- Evidence package: coherent export, closure immutability, artifact classes.
- Role matrix: RBAC enforcement per AGMX_SECURITY_RBAC.md.
- Existing passes 1–22, 23–30 keep running; schema bundle regenerated (pass 21).

## 9. Security boundaries (non-negotiable)

- Ballot store (`ballots`/`ballot_selections`) never joins to voter identity in any response; receipt token is random.
- `votes` (motions) and new `ballots` (elections) remain append-only.
- Maker-checker for open/close/suspend voting and result publication.
- Results unpublished until `election_verify` succeeds.
- Electoral roll + candidates immutable snapshots when election opens.
- No `innerHTML` anywhere in new view modules; all remote text via `textContent`.
