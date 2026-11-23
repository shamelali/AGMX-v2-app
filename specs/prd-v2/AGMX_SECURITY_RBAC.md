# AGMX v2.0 — Security Model & RBAC (PRD §10, §11, §15)

Source: AGMX Master PRD v2.0.

## Voting & Election Security Model (§10)
- Separate identity/eligibility service from secret ballot store.
- One entitlement → one accepted ballot, with idempotency and duplicate prevention.
- Ballot receipt must not encode candidate/choice.
- Open/close/reopen/suspend agenda actions require role permission and produce immutable audit events.
- Candidate list and electoral roll become immutable snapshots when election opens.
- Results are not published until authorised verification step is complete.
- Exportable Election Integrity Report for committee/scrutineer.
- Cryptographic/security claims must be validated by implementation and security review before marketing.

## Non-functional security (§15)
- Multi-tenant data isolation; least-privilege RBAC.
- Privacy: minimise identity exposure, encrypted sensitive data, retention policies and expiry/delete governance rules as legally applicable.
- Auditability: append-only event history for critical governance actions.
- Resilience: reconnect, retry/idempotency, backup channel and graceful degradation (video → audio → text).

## Roles & key permissions (§11)
| Role | Key permissions |
|---|---|
| Super Admin | Tenant/system configuration; no automatic access to secret vote choices |
| Cooperative Admin | Manage cooperative configuration and users |
| AGM Secretariat | Create AGM, notices, documents, registration, minutes workflow |
| Board | Review/approve configured governance items |
| Nomination Committee | Review nomination eligibility, approve/reject with reason |
| Election Committee | Configure/operate election, verify tally, publish authorised result |
| Minute Verification Committee | Review and verify minutes |
| Chairman | Agenda, speakers, procedural controls, request/open votes subject to permissions |
| Technical Operator | AV/LIVE/system health; no governance decision rights |
| Scrutineer/Observer | Read-only audit/election process view |
| Candidate | Own nomination/profile only |
| Member/Delegate | Hub access, participation and eligible voting |

## AI Governance hard boundaries (§12)
- AI AGM Planner: timeline, readiness, checklist — cannot mark legal compliance complete without evidence.
- AI Compliance Officer: retrieve applicable rule and flag risk — cannot issue final legal determination.
- AI Nomination Assistant: document completeness and eligibility cues — cannot approve/reject candidate.
- AI Chairman: agenda/time/speaker procedural assistance — cannot silence/remove participant autonomously.
- AI Secretary: transcription and draft minutes — cannot finalise minutes.
- AI Question Manager: cluster duplicate questions — cannot suppress governance record.

## Acceptance criteria
- [ ] Role-based access enforced per matrix above.
- [ ] Secret ballot store is cryptographically separated from identity/eligibility service.
- [ ] One entitlement → one accepted ballot (idempotent, duplicate prevention).
- [ ] Election opens only with immutable snapshots of candidate list and electoral roll.
- [ ] Results unpublished until authorised verification complete.
- [ ] Audit events immutable and append-only for critical governance actions.
