# AGMX v2.0 — Sprint 8 Spec: Voting Refactor

Source: AGMX Master PRD v2.0 (GOV-05, GOV-08, §3 gap table E-Voting, §5 stage 10, §9 Security, §11 Election Committee).

## Objective
Secret ballot voting with integrity, one entitlement → one accepted ballot, results locked/verified before publication.

## E-Voting (keep + harden, §3 gap table)
- Pishakan Resolution Voting dan ALK Election
- Secret ballot, receipt, dual control, scrutineer report

## Election Control Centre (Control requirement)
- Eligible voters, ballots issued/cast, rejected attempts, time remaining and verification

## Security boundaries (§10)
- Separate identity/eligibility service from secret ballot store.
- Ballot receipt must not encode candidate/choice.
- Open/close/suspend voting with maker-checker approval for critical actions.
- Results are not published until authorised verification step is complete.
- Electoral Roll immutable snapshot when election opens.

## Roles (§11)
- Election Committee: configure/operate election, verify tally, publish authorised result.
- Technical Operator: AV/LIVE/system health; no governance decision rights.
- Scrutineer/Observer: Read-only audit/election process view.

## Acceptance criteria (this sprint)
- [ ] One entitlement → one accepted ballot (idempotent, duplicate prevention).
- [ ] Secret ballot receipt does not encode candidate/choice.
- [ ] Ballot receipt proves acceptance without revealing secret vote choice.
- [ ] Voting can be opened/closed/suspended with maker-checker approval for critical actions.
- [ ] Election Control Centre shows eligible voters, ballots issued/cast, rejected attempts, time remaining.
- [ ] Results locked/verified before publication (stage 10 gate).
- [ ] Scrutineer report generated.
- [ ] Electoral Roll immutable when election opens.
