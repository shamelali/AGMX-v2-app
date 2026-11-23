# AGMX v2.0 — Sprint 14 Spec: Hardening

Source: AGMX Master PRD v2.0 (§15 Non-Functional Requirements, §17 Phase 1/2 gates, Acceptance §19, Marketing §20).

## Objective
Load, security, accessibility, DR, audit and production claims review before Phase 1/2 release gates.

## Non-functional requirements (§15)
- Multi-tenant data isolation; least-privilege RBAC
- Responsive mobile-first hub; desktop-first Control/Governance
- WCAG accessibility: AGAG-oriented keyboard navigation, contrast, scalable text, captions and screen-reader semantics
- Auditability: append-only event history for critical governance actions
- Resilience: reconnect, retry/idempotency, backup channel and graceful degradation video → audio → text
- Privacy: minimise identity exposure, encrypted sensitive data, retention policies and expiry/delete governance rules as legally applicable
- Observability: system health, incident logs, alerting and post-event diagnostics
- Versioning: UUK/rules, AGM Pack, electoral roll and candidate list snapshots

## Release gates
- Phase 1 gate: One physical AGM managed end-to-end with auditable records (§17).
- Phase 2 gate: Hybrid/online AGM operates without leaving AGMX; tested failure/reconnect paths (§17).

## Acceptance criteria (this sprint)
- [ ] Load, security, accessibility, DR verified.
- [ ] Audit and production claims review passed (Marketing §20: no unbacked claims re AES/hash-chain, AI accuracy, compliance score, SLA, testimonials, production counts).
- [ ] Multi-tenant data isolation with least-privilege RBAC.
- [ ] WCAG accessibility compliance.
- [ ] Append-only event history for critical governance actions.
- [ ] Encrypted sensitive data; retention and expiry/delete governance rules legally applicable.
- [ ] Graceful degradation video → audio → text.
