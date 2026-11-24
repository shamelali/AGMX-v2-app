# AGMX Commercial Requirements Addendum

Status: TARGET REQUIREMENTS — not all behavior is implemented.
Authority: AGMX Business Model Master v1.0 commercial rules, subject to the approval boundaries below.
Current implementation: legacy DutaGovern rolling annual plans in `price-list.js` and migration `0006_subscriptions_billing.sql`.

## Approval boundaries

- Final regular and founding prices are not approved by this document.
- LIVE/AI allowances, mid-year proration, payment provider fees, partner rates, and the professional-services price book require separate approval.
- Until approved, production keeps its current price book and denies new calendar-year/founding activation.
- Small/Growth/Enterprise are commercial tiers. Phase 1/2/3 are delivery phases and must not be used interchangeably.

## Plan, price, and term requirements

- COM-001 Plan versions are immutable after use; a changed price creates a new version.
- COM-002 A server pricing preview returns plan version, subtotal, discounts, tax rule, total, currency, allowances, and term dates.
- COM-003 Quotes, invoices, subscription periods, and renewals store immutable commercial-term snapshots.
- COM-004 New calendar-year subscriptions run 1 January–31 December in `Asia/Kuala_Lumpur`.
- COM-005 Founding 100 has configurable capacity, window, eligibility, and an atomic reservation cap of 100; the paid-member count is derived separately from settled activations.
- COM-006 Qualified Founding 100 purchases made during the approved Q4 2026 window receive access through 31 December 2026 and a paid 2027 period.
- COM-007 Three-year price protection applies only while the subscription remains continuous and only after approved legal terms are accepted.
- COM-008 Expired subscriptions enter a defined grace/read-only state; governance history remains accessible according to retention policy.
- COM-009 Renewal moves due → invoice issued → payment settled → activated; a period is never activated before settlement.
- COM-010 Mid-year activation is rejected unless an approved proration policy is configured.
- COM-011 Promotions have versioned eligibility, windows, discount type/value, usage cap, and stacking rules.
- COM-012 Browser price cards are display-only; checkout renders the server preview and cannot override it.

## Referral, partner, usage, and settlement requirements

- COM-013 Referral attribution uses a unique cooperative code/link and a 60-day window with manual dispute review.
- COM-014 Referral qualification follows clicked → registered → qualified → subscribed → payment cleared → reward approved.
- COM-015 Referrer and new-cooperative benefits are versioned non-cash credits; default draft values are 10% and 5% pending approval.
- COM-016 An append-only credit ledger records held, available, redeemed, reversed, and expired entries with idempotency keys.
- COM-017 Partner tiers store active-paid-cooperative counts, new-subscription rate, renewal rate, and effective dates.
- COM-018 Each attributed cooperative has at most one Partner of Record; partners receive only commercial information needed for attribution and commissions.
- COM-019 Commission lifecycle is pending → hold → approved → available → paid, with reversal linked to refunds or invalidated attribution.
- COM-020 Usage allowances and overage rules are snapshotted per subscription period and metered from real domain events.
- COM-021 Additional meetings, LIVE, AI, communications, storage, and professional services are separate add-ons or allowances, never hidden in the base plan.
- COM-022 Payment provider, tax rule, currency, and fee treatment are configuration, not hard-coded client or RPC constants.
- COM-023 Refunds and chargebacks reverse the related invoice, credit, and commission exactly once.
- COM-024 Every financial mutation validates tenant, role, object ownership, and idempotency before writing.

## Data, audit, UI, and metrics requirements

- COM-025 Commercial facts are durable records; audit logs are not the sole source for revenue or cohort reporting.
- COM-026 Commercial events include event/idempotency IDs, timestamps, actor/source, organization, cohort, offer, snapshot, period, amount, currency, outcome, and reason.
- COM-027 Legacy rolling subscriptions remain readable and enforceable; migration to calendar-year terms requires explicit customer consent or renewal.
- COM-028 Pricing-validation reports preserve unknown/null outcomes and define denominators and observation windows before displaying rates.

## Target state machines

Subscription: pending_payment → active → past_due → grace → read_only → expired; cancellation may move active/past_due/grace → cancelled at period end.

Subscription period: scheduled → invoice_issued → paid → activated; unpaid periods may become overdue/cancelled.

Founding reservation: held → qualified → paid; held → expired/released; qualified → lost with reason.

Promotion: draft → active → paused → expired; active → archived.

Referral: clicked → registered → qualified → subscribed → payment_cleared → reward_approved → credited; any pre-credit state may become rejected/reversed with reason.

Credit: held → available → redeemed; held/available → reversed/expired.

Commission: pending → hold → approved → available → paid; pending/hold/approved/available → reversed.

## Metric definitions and decision rules

- `founding_reservation_to_paid = paid qualified founding cooperatives / matured qualified reservations`
- `quote_to_paid = settled quotes / issued quotes in the same mature cohort`
- `realized_arr = sum of settled subscription period amounts excluding tax, credits, and one-off services`
- `contribution_margin = subscription + add-ons + referral credits + partner commissions − LIVE − AI − communication − storage − direct support`
- `onboarding_hours = summed operator and customer onboarding time per activated cooperative`
- `renewal_rate = renewed mature periods / periods whose renewal window closed`
- `renewal_intent = survey signal only; never label it actual renewal`

Do not publish final prices from interview intent alone. Require settled transactions and observed costs. Do not compute renewal rate for cohorts whose renewal window has not matured. Do not convert missing instrumentation into zero.

## Current implementation gaps

- Plan prices are mutable catalog rows, not immutable versions.
- Quotes use one-off pricing; subscription creation and renewal use current annual prices and hard-coded tax.
- Subscriptions use rolling anniversary periods and activate before payment.
- No promotion, founding reservation, referral-credit, commission-lifecycle, commercial-snapshot, or usage-meter entity exists.
- Browser pricing is duplicated and the subscription-management UI is incomplete.
- Financial tables permit broad same-organization DML; service-only transactional boundaries are required.

## Security and compatibility requirements

- Money-flow runs with service-role credentials, so every handler and RPC must validate tenant, role, and object ownership independently of RLS.
- Revoke browser financial writes where a transactional RPC or service-only handler is the correct boundary.
- Founding reservations, credit redemption, commission approval, and renewal require locking, uniqueness, and idempotency.
- Never accept client-calculated totals, eligibility, discounts, or commission percentages.
- Prospect reference tokens are bearer credentials and must not appear in logs or exports.
- Legacy rolling subscriptions remain valid until renewed or explicitly migrated with consent.
