# AGMX v2.0 — Sprint 3 Spec: Members + Electoral Roll

Source: AGMX Master PRD v2.0 (GOV-04, GOV-05, §10 Security, §11 Roles).

## Objective
Member Registry and Electoral Roll with separate identity/eligibility from the secret ballot store.

## Member Registry (GOV-04)
- Import/sync members
- Fields: identity, membership date, region, status, contact channels
- Multi-tenant data isolation, least-privilege RBAC

## Electoral Roll (GOV-05)
- Attend / Vote / Candidate eligibility tracked separately
- Reason codes for eligibility decisions
- Freeze/lock capability
- Version history of the roll

## Security boundary (§10)
- Separate identity/eligibility service from secret ballot store.
- One entitlement → one accepted ballot, with idempotency and duplicate prevention.
- Ballot receipt must not encode candidate/choice.
- Candidate list and electoral roll become immutable snapshots when election opens.

## Roles & permissions relevant (§11)
- Super Admin: tenant/system configuration; no automatic access to secret vote choices.
- Cooperative Admin: manage cooperative configuration and users.
- Board: review/approve configured governance items.
- Nomination Committee: review nomination eligibility and approve/reject with reason.
- Election Committee: configure/operate election, verify tally, publish authorised result.
- Minute Verification Committee: review and verify minutes.
- Chairman: agenda, speakers, procedural controls; votes subject to permissions.
- Technical Operator: AV/LIVE/system health; no governance decision rights.
- Scrutineer/Observer: Read-only audit/election process view.
- Candidate: own nomination/profile only.
- Member/Delegate: hub access, participation and eligible voting.

## Acceptance criteria (this sprint)
- [ ] Members can be imported/synced with identity, membership date, region, status, contact channels.
- [ ] Electoral roll tracks Attend/Vote/Candidate eligibility separately with reason codes.
- [ ] Roll can be frozen/locked with version history.
- [ ] Identity/eligibility service is separate from secret ballot store.
- [ ] One entitlement maps to exactly one accepted ballot (idempotent, duplicate prevention).
- [ ] Roll becomes immutable snapshot when election opens.
