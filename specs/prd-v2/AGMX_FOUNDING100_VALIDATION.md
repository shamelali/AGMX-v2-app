# AGMX Founding 100 Pricing-Validation Playbook

Status: DRAFT OPERATING PLAYBOOK — no customer outcomes recorded; campaign not activated.
Purpose: Validate willingness to pay, onboarding effort, service cost, usage cost, and retention signals before publishing final AGMX pricing.
Authority: Business Model Master v1.0 §7 and Commercial Requirements Addendum.

## Current results

No paid Founding cooperative, interview result, price decision, renewal outcome, or contribution-margin result is recorded in this repository. The program starts only after the approval gates in this playbook are met.

## Cohort and offer requirements

- F100-001 A qualified cooperative has a verified cooperative identity, an eligible billing member count, accepted commercial/legal terms, and an authorized signatory.
- F100-002 A paid Founding member has a cleared first payment and an activated 2027 subscription period; reservations and invoices alone do not count.
- F100-003 Capacity is enforced atomically at 100 qualified paid cooperatives; expired reservations release capacity and waitlist records never count as members.
- F100-004 The published counter is derived from paid Founding records and displays the observation timestamp.
- F100-005 Q4 2026 access, if approved, ends 31 December 2026 and does not replace the paid 2027 period.
- F100-006 Founding benefits, price protection, allowances, support boundaries, refund terms, and eligibility are versioned and accepted before payment.
- F100-007 A launch after 31 December 2026 requires a newly approved campaign window and copy.

## Research and experiment requirements

- F100-008 Discovery interviews use a fixed guide covering current AGM cost, governance pain, buying process, budget owner, alternatives, price reaction, and purchase conditions.
- F100-009 Interview statements are tagged as stated intent and never reported as paid conversion or willingness-to-pay proof.
- F100-010 Live offer tests use only approved price cells and server-issued previews; every exposure records offer version and plan version.
- F100-011 The primary validation outcome is settled payment plus activation; quote acceptance and invoice issuance are intermediate outcomes.
- F100-012 The program records lost reasons, abandoned reservations, failed payments, refunds, and cancellations rather than dropping them from the funnel.

## Discovery interview guide

Ask every qualified participant the same core questions and record the answer source and date.

1. How is the cooperative's AGM prepared and run today?
2. What does the current process cost in fees, staff time, and rework?
3. Which governance records are hardest to produce or verify?
4. Who approves the budget and who signs the contract?
5. What alternatives are used today?
6. What would prevent purchase?
7. What price range would be considered, and why?
8. Which plan capability is essential versus optional?
9. What onboarding effort is acceptable?
10. What evidence would justify renewal?

Record price reactions as stated intent. Do not infer a paid conversion rate from interviews.

## Live offer experiment

- Use only price cells approved in the campaign configuration.
- Record offer version, plan version, eligibility result, reservation, quote, invoice, payment, and activation.
- Keep the Founding discount separate from the regular-price comparison.
- Report all outcomes, including abandoned reservations, failed payments, refunds, and cancellations.
- Do not change public copy or price displays without a versioned approval record.

## Cost and decision requirements

- F100-013 Onboarding time is recorded per cooperative and split into AGMX operator time and customer time.
- F100-014 Support effort, LIVE/AI/communication/storage usage, payment fees, referral credits, and partner commissions are measured from real records.
- F100-015 Contribution margin is calculated per mature paid cohort using the commercial addendum formula.
- F100-016 Provisional management thresholds are approved before recruitment: at least 20 discovery interviews, at least 10 paid Founding cooperatives for an initial signal, median onboarding at or below 6 hours, first-30-day support at or below 2 hours per cooperative, contribution margin below 40 percent as a stop condition, and payment failure above 10 percent as a stop condition.
- F100-017 Price changes require a decision record citing paid conversion, realized ARR, contribution margin, support/onboarding effort, and lost reasons.
- F100-018 Actual renewal is reported only after the renewal window matures; renewal intent remains a separate survey metric.

### Provisional decision thresholds

| Signal | Threshold | Action |
|---|---:|---|
| Discovery interviews | Fewer than 20 | Continue research; do not claim price validation. |
| Paid Founding cooperatives | Fewer than 10 | Treat results as an initial signal only. |
| Median onboarding time | Above 6 hours after 10 paid cooperatives | Pause acquisition and fix onboarding. |
| First-30-day support time | Above 2 hours per cooperative | Pause acquisition and review service scope. |
| Payment failure rate | Above 10 percent in a mature cohort | Pause and diagnose checkout/payment failures. |
| Contribution margin | Below 40 percent in a mature cohort | Pause and reprice or reduce cost-to-serve. |
| Published counter mismatch | Any mismatch | Stop campaign copy until reconciled. |
| Security or unsupported claim | Any occurrence | Stop campaign and investigate. |

## Event contract

Required fields: event_id, event_name, occurred_at, received_at, actor_type, actor_id, organization_id, cohort_id, offer_version_id, reservation_id, quote_id, invoice_id, payment_id, subscription_period_id, amount_minor, currency, outcome, reason_code, source, instrumentation_version.

Required events: offer_viewed, eligibility_checked, reservation_held, reservation_qualified, reservation_expired, quote_issued, quote_accepted, invoice_issued, payment_attempted, payment_settled, payment_failed, subscription_activated, onboarding_started, onboarding_completed, support_ticket_opened, support_ticket_closed, usage_recorded, renewal_due, renewal_attempted, renewal_settled, cancelled, refunded.

Rules:

- Event IDs are idempotent.
- Timestamps use ISO 8601 with offset and the reporting calendar uses `Asia/Kuala_Lumpur`.
- Amounts are integer minor units with an explicit currency.
- Outcome and reason code are explicit.
- Missing values remain null.
- Late events retain both occurred and received timestamps.
- No event stores card data, gateway secrets, or bearer tokens.
- Personal data is minimized and access is role-restricted.

## Metrics and dashboard requirements

- F100-019 Reports define numerator, denominator, cohort, observation window, maturity rule, and instrumentation status before displaying a rate.
- F100-020 Dashboards distinguish not_instrumented, no_data, partial_data, and complete_data; they never convert missing instrumentation into a zero result.

Required metrics:

| Metric | Definition |
|---|---|
| `qualified_reservations` | Reservations that passed eligibility and have not expired. |
| `paid_founding_cooperatives` | Qualified cooperatives with settled first payment and activated 2027 period. |
| `reservation_to_paid` | Paid Founding cooperatives divided by matured qualified reservations. |
| `quote_to_paid` | Settled quotes divided by issued quotes in the same mature cohort. |
| `realized_arr` | Settled subscription-period amounts excluding tax, credits, and one-off services. |
| `average_selling_price` | Realized subscription revenue divided by paid Founding cooperatives. |
| `onboarding_hours` | Operator plus customer onboarding time per activated cooperative. |
| `support_hours` | Support time in the first 30 days per activated cooperative. |
| `usage_cost` | LIVE, AI, communication, storage, and payment costs from real records. |
| `payment_failure_rate` | Failed payment attempts divided by mature payment attempts. |
| `contribution_margin` | Subscription plus add-ons plus referral credits plus partner commissions minus LIVE, AI, communication, storage, direct support, and payment costs. |
| `cancellation_rate` | Cancelled mature paid cooperatives divided by mature paid cooperatives. |
| `renewal_intent` | Survey signal only; never label it actual renewal. |
| `actual_renewal_rate` | Renewed mature periods divided by periods whose renewal window closed. |

## Governance and stop conditions

A weekly review includes product, finance, sales, and support owners. The review examines funnel outcomes, realized price, onboarding/support effort, usage cost, contribution margin, data quality, and claims compliance.

Pause the campaign for:

- any security incident;
- any unsupported public claim;
- payment failure above 10 percent in a mature cohort;
- contribution margin below 40 percent in a mature cohort;
- median onboarding above 6 hours after 10 paid cooperatives;
- any mismatch between the published counter and paid records.

Every pause or restart decision records date, owner, evidence, action, and next review date.

## Approval gates before activation

1. Approve final price cells, allowances, referral/partner rates, refund terms, and price-protection wording.
2. Approve the campaign window; reapprove if launching after 31 December 2026.
3. Implement server-authoritative eligibility, reservation capacity, pricing preview, payment settlement, and activation.
4. Implement the event contract and prove dashboard instrumentation status.
5. Approve legal terms and public claims.
6. Run a sandbox end-to-end test with no production customer data.
7. Record named owners for weekly review and stop/restart decisions.

## Decision record template

Each pricing or campaign decision records:

- decision date and owner;
- cohort and observation window;
- evidence links and instrumentation status;
- paid conversion and realized ARR;
- onboarding/support effort;
- usage cost and contribution margin;
- lost reasons and refunds;
- renewal maturity and actual renewal rate, if available;
- decision, rationale, and next review date.
