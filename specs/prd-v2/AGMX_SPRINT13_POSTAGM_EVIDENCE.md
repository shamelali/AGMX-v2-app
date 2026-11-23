# AGMX v2.0 — Sprint 13 Spec: Post-AGM + Evidence Vault

Source: AGMX Master PRD v2.0 (GOV-14, GOV-15, §5 stage 12, §13 Core Data Model, §17 Phase 1).

## Objective
Post-AGM organisation meeting, statutory/reporting tasks, deadlines, evidence and completion; Evidence Vault immutable evidence package after closure.

## Post-AGM (GOV-14)
- Board organisation meeting
- Statutory/reporting tasks
- Deadlines, evidence and completion

## Evidence Vault (GOV-15)
- Notice, roll, attendance, documents, nominations, ballots/tallies, minutes, incidents, audit logs
- Exportable AGM Evidence Package after closure (Acceptance §19)

## State machine (§13)
Resolution: Open → In Progress → Completed / Overdue / Superseded
Minutes: AI Draft → Editorial Review → Verification → Approved → Locked

## Roles (§11)
- Board: review/approve configured governance items.
- Minute Verification Committee: review and verify minutes.

## Acceptance criteria (this sprint)
- [ ] Post-AGM board organisation meeting tracked with statutory/reporting tasks.
- [ ] Deadlines, evidence and completion recorded per task.
- [ ] Evidence Vault contains notice, roll, attendance, documents, nominations, ballots/tallies, minutes, incidents, audit logs.
- [ ] System can export a coherent AGM Evidence Package after closure.
- [ ] Evidence package immutable after closure.
- [ ] Resolution tracker follows Open → In Progress → Completed/Overdue/Superseded.
