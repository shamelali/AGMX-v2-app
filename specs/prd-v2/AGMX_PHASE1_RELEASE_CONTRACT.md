# AGMX Phase 1 Release Contract

Status: NOT READY — requirements are defined; release evidence is incomplete.
Source: AGMX Master PRD v2.0 §§17–19.
Release gate: One physical AGM managed end-to-end with auditable records.

## Included in Phase 1

- Cooperative and AGM setup, rules, committees, and physical mode.
- Member registry, separate attendance/voting/candidate eligibility, and frozen electoral roll.
- Notice, AGM Pack, delivery evidence, motions, nominations, candidates, registration, readiness, quorum, basic secret voting, verified results, manual minutes, resolutions, follow-up actions, and a minimum immutable evidence export.
- Tenant isolation, least-privilege RBAC, append-only critical audit, accessibility verification, backup/restore evidence, and production-claims review.

## Excluded from Phase 1

- Phase 2: hybrid/online chamber, live presence, speaker queue, Q&A, recording/transcription, AI minutes, and reconnect/failure-path certification.
- Phase 3: advanced evidence packages, white-label, integrations, multi-cooperative scale, full DR, advanced analytics/AI, and operational SLA readiness.

## Release gates

| ID | Gate | Required evidence |
|---|---|---|
| G1 | Physical lifecycle | A physical fixture advances all 12 stages; invalid transitions fail; each transition is audited. |
| G2 | Registry and roll | Import, independent eligibility, freeze/version, and mutation rejection are tested. |
| G3 | Notice and pack | Deadline, delivery, acknowledgement, version replacement, and access history are tested. |
| G4 | Nominations and candidates | Application, reasoned review, publication, candidate ballot, and immutable snapshot are tested. |
| G5 | Registration and readiness | RSVP, identity, rehearsal, and quorum-before-convene are tested. |
| G6 | Motions and voting | Classification, receipt, duplicate prevention, maker-checker, verified publication, and scrutineer report are tested. |
| G7 | Minutes and resolutions | Manual draft, human verification, approval, lock, and resolution states are tested. |
| G8 | Post-AGM evidence | Required artifact classes, export, closure immutability, and task tracking are tested. |
| G9 | Security and NFR | Role matrix, tenant isolation, append-only/tamper tests, accessibility, load, retention, and restore evidence pass. |

## Current gap register

| Gate | Current evidence | Gap blocking readiness |
|---|---|---|
| G1 | `tools/test_agm_journey.mjs` runs a hybrid fixture and jumps planned → live → closed. | No physical fixture exercises all 12 stages and rejects invalid transitions. |
| G2 | Member fixtures are inserted directly; voting reads live eligibility. | No import path, independent eligibility reasons, or complete freeze/version rejection test. |
| G3 | UI tests check payload shape; notice “send” records rows. | No provider-backed delivery/acknowledgement evidence or complete pack-version history test. |
| G4 | No nomination/candidate journey assertions. | Application, reasoned review, publication, candidate ballot, and immutable snapshot are missing. |
| G5 | Meeting starts before attendance/quorum; voting alone is quorum-gated. | RSVP/readiness evidence and quorum-before-convene enforcement are missing. |
| G6 | Duplicate ballot and threshold paths are tested. | Choice-free receipt, maker-checker, authorised result verification, and scrutineer report are missing. |
| G7 | A document is registered and one action is created. | Manual minute verification/approval/lock and full resolution-state tests are missing. |
| G8 | Audit/document reads and append-only triggers are tested. | Coherent evidence export, closure immutability, and full artifact-class checks are missing. |
| G9 | Partial tenant, audit, and ballot-privilege checks exist. | Full role matrix, accessibility, load, retention, restore, and strict non-skipped evidence are incomplete. |

## Evidence rules

- A requirement is complete only when a named automated test or reviewed manual evidence record passes.
- Skipped or unavailable required evidence is a failure, not a warning.
- No Phase 2/3 capability may be sold as included in Phase 1.
- No AI output may finalise minutes or make a governance/legal decision.
- The existing hybrid journey remains regression evidence, not proof that Phase 1 is ready.
- Release readiness requires gates G1–G9 to have named, passing evidence and a reviewed claims audit.
