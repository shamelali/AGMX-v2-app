# AGMX v2.0 — Sprint 2 Spec: AGM Workspace + Lifecycle

Source: AGMX Master PRD v2.0 (§2, §5, GOV-01, §17 Phase 1).

## Objective
Create an AGM workspace and drive it through the 12-stage end-to-end lifecycle, with gates per stage. Phase 1 gate: "One physical AGM can be managed end-to-end with auditable records."

## Entities (Core Data Model §13)
Tenant/Cooperative, AGM, AGMMode, Venue, User, Member, Membership, RuleSource, RuleVersion, ComplianceTask, Notice, DeliveryEvent, Document, DocumentVersion, Registration, AttendanceSession, PresenceEvent, MotionEvent, Nomination, CandidateDeclaration, Resolution, ActionItem, MinuteDraft, MinuteVerification, AuditEvent, EvidencePackage.

## AGM Workspace (GOV-01)
Fields:
- tenant / cooperative (multi-tenant, least-privilege RBAC)
- status (Draft, Configuring, Published, Registration Open, Ready, Live, Closed, Post-AGM, Archived)
- owner (AGM owner)
- mode: Physical | Hybrid | Online
- date/time, venue, financial year
- lifecycle progress (current stage index 1–12)

Acceptance: A cooperative can create an AGM in Physical, Hybrid, or Online mode without changing product (Acceptance Criterion §19).

## 12-Stage Lifecycle (PRD §5)
| Stage | System outcome | Gate |
|---|---|---|
| 1. Create | AGM Workspace created | AGM owner + basic metadata |
| 2. Configure | Mode, venue, UUK/rules, committees | Rules confirmed |
| 3. Electoral Roll | Eligible attendees/voters/candidates | Roll locked/versioned |
| 4. Nomination | ALK nomination lifecycle | Candidate list approved |
| 5. Notice & AGM Pack | Notice delivery + documents | Delivery evidence |
| 6. Motions | Submission/classification/scheduling | Motion register ready |
| 7. Registration | RSVP, identity, attendance preparation | Participant ready |
| 8. Readiness | Compliance + technical rehearsal | Readiness score/gate |
| 9. Convene | Check-in, quorum, chairperson control | Quorum established |
| 10. Deliberate & Vote | Agenda, Q&A, motions, resolutions, ALK election | Votes locked/verified |
| 11. Close & Record | Minutes, results, evidence | Human verification |
| 12. Follow-up | SKM/reporting deadlines + action tracker | AGM archived only when obligations tracked |

## State machine transitions (PRD §14)
AGM: Draft → Configuring → Published → Registration Open → Ready → Live → Closed → Post-AGM → Archived.

## Rules
- Lifecycle advances only when the current stage's gate conditions are met.
- Every state transition emits an AuditEvent (immutable audit trail).
- Mode (Physical/Hybrid/Online) cannot be changed after Registration Open without maker-checker approval.

## Acceptance criteria (this sprint)
- [ ] AGM can be created in Physical/Hybrid/Online mode.
- [ ] Lifecycle advances stage-by-stage with enforced gates.
- [ ] Each stage transition is recorded as an AuditEvent.
- [ ] AGM workspace shows status, owner, mode, date/time, venue, financial year, lifecycle progress.
