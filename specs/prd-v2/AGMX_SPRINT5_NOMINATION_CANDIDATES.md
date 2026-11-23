# AGMX v2.0 — Sprint 5 Spec: Nomination + Candidates

Source: AGMX Master PRD v2.0 (GOV-09, GOV-10, §3 gap table).

## Objective
Nomination lifecycle from notice to committee decision and publication before election; uniform candidate profiles with declaration and publication window, no ranking/recommendation.

## Nomination (GOV-09)
- Notice, open/close, application
- Proposer/seconder where configured
- Eligibility, committee review
- Nomination workflow per configured UUK (Hub requirement)

## Candidate Management (GOV-10)
- Uniform candidate profiles
- Declaration
- Publication window
- No ranking/recommendation
- Candidate gallery with equal presentation template (Hub requirement)

## Security boundary (§10)
- Candidate list becomes immutable snapshot when election opens.
- AI Nomination Assistant: document completeness and eligibility cues — cannot approve/reject candidate (§12).

## Roles (§11)
- Nomination Committee: review nomination eligibility and approve/reject with reason.
- Candidate: own nomination/profile only.
- Member/Delegate: participation and eligible voting.

## Acceptance criteria (this sprint)
- [ ] Nomination runs from notice to committee decision and publication before election.
- [ ] Candidate can submit application with proposer/seconder where configured.
- [ ] Committee can approve/reject nomination eligibility with reason.
- [ ] Candidate profiles are uniform with declaration and publication window.
- [ ] No ranking/recommendation of candidates.
- [ ] Candidate list becomes immutable snapshot when election opens.
- [ ] Candidate gallery publishes with equal presentation template.
