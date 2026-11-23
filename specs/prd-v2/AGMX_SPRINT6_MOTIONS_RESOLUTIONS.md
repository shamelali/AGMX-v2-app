# AGMX v2.0 — Sprint 6 Spec: Motions + Resolution Register

Source: AGMX Master PRD v2.0 (GOV-08, GOV-13, §3 gap table, §17 Phase 1).

## Objective
Motion submission, classification, similarity detection, scheduling, debate, vote, convert to resolution; Resolution Register with unique ID, vote result, owner, due date, evidence, status.

## Motions (GOV-08)
- Submit, classify, detect similarity
- Schedule, debate, vote
- Convert to resolution

## Resolution Register (GOV-13)
- Unique resolution ID
- Vote result, owner, due date, evidence, status

## Entity relationships (Core Data Model §13)
MotionEvent, Resolution, ActionItem, MinuteDraft, AuditEvent.

## Roles (§11)
- Board: review/approve configured governance items.
- Election Committee: configure/operate election, verify tally.
- Technical Operator: no governance decision rights.

## Acceptance criteria (this sprint)
- [ ] Motion can be submitted, classified, and similarity-checked.
- [ ] Motion can be scheduled, debated, and voted.
- [ ] Passed motion creates a Resolution record (Acceptance §19).
- [ ] Resolution may create one or more Action Items (Acceptance §19).
- [ ] Resolution Register stores unique ID, vote result, owner, due date, evidence, status.
- [ ] Every motion/resolution transition emits an immutable AuditEvent.
