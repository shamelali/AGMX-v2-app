# AGMX Founding 100 Pricing-Validation Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an honest operating playbook for validating AGMX pricing and unit economics with up to 100 qualified paid cooperatives.

**Architecture:** Add one validation playbook under `specs/prd-v2`, define the cohort and event contract, and add a structural checker. The playbook records how evidence must be collected; it contains no customer results and does not activate the campaign.

**Tech Stack:** Markdown, Node.js 22+, future Postgres commercial events and existing lead/subscription tables.

**Spec:** `AGMX_BUSINESS_MODEL_MASTER_v1.0.pdf` §§7, 16–19, 22–28; `specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md`; `AGMX_V2_PLAN.md` §1 metrics.

## Global Constraints

- Founding 100 capacity is the first 100 qualified paid cooperatives, or the approved campaign end, whichever comes first.
- A lead, reservation, quote, invoice, promise, or failed payment is not a paid Founding member.
- The historical campaign window ends 31 December 2026. If launched later, the offer requires reapproval and cannot be described as the original 2026 window.
- The counter must derive from qualified paid records; no fabricated scarcity or manual marketing count.
- Q4 2026 access and the 2027 paid period are separate facts.
- Prices, allowances, referral rates, partner rates, and price-protection terms remain subject to approval.
- Renewal intent is a survey signal, not renewal revenue.
- Renewal rate uses only cohorts whose renewal window has matured.
- Unknown outcomes remain null/unknown; missing instrumentation is not zero.
- No production campaign is activated by this plan.
- All events minimize personal data and never store gateway secrets or bearer tokens.

---

## File Structure

- Create `specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md` — cohort, offer, research, event, metric, dashboard, and governance playbook.
- Modify `AGMX_V2_PLAN.md` — link the playbook from immediate next actions and label validation as not started.
- Modify `README.md` — add a short evidence-status note near the commercial target section.
- Create `tools/check_founding100_program.mjs` — validates required program sections, requirement IDs, events, and metrics.
- Create `tools/test_founding100_program.mjs` — proves incomplete programs are rejected.
- Modify `package.json` — add `check:founding100-program`.
- Modify `tools/CHECKS.md` — document the command and its limits.

### Task 1: Create the Founding 100 validation playbook

**Files:**
- Create: `specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md`

**Interfaces:**
- Consumes: commercial requirements `COM-001`–`COM-028`.
- Produces: requirement IDs `F100-001`–`F100-020`, event contract, metric definitions, and decision rules.

- [ ] **Step 1: Write the header and status**

```markdown
# AGMX Founding 100 Pricing-Validation Playbook

Status: DRAFT OPERATING PLAYBOOK — no customer outcomes recorded; campaign not activated.
Purpose: Validate willingness to pay, onboarding effort, service cost, usage cost, and retention signals before publishing final AGMX pricing.
Authority: Business Model Master v1.0 §7 and Commercial Requirements Addendum.
```

- [ ] **Step 2: Define cohort and offer requirements**

```markdown
## Cohort and offer requirements
- F100-001 A qualified cooperative has a verified cooperative identity, an eligible billing member count, accepted commercial/legal terms, and an authorized signatory.
- F100-002 A paid Founding member has a cleared first payment and an activated 2027 subscription period; reservations and invoices alone do not count.
- F100-003 Capacity is enforced atomically at 100 qualified paid cooperatives; expired reservations release capacity and waitlist records never count as members.
- F100-004 The published counter is derived from paid Founding records and displays the observation timestamp.
- F100-005 Q4 2026 access, if approved, ends 31 December 2026 and does not replace the paid 2027 period.
- F100-006 Founding benefits, price protection, allowances, support boundaries, refund terms, and eligibility are versioned and accepted before payment.
- F100-007 A launch after 31 December 2026 requires a newly approved campaign window and copy.
```

- [ ] **Step 3: Define research and experiment requirements**

```markdown
## Research and experiment requirements
- F100-008 Discovery interviews use a fixed guide covering current AGM cost, governance pain, buying process, budget owner, alternatives, price reaction, and purchase conditions.
- F100-009 Interview statements are tagged as stated intent and never reported as paid conversion or willingness-to-pay proof.
- F100-010 Live offer tests use only approved price cells and server-issued previews; every exposure records offer version and plan version.
- F100-011 The primary validation outcome is settled payment plus activation; quote acceptance and invoice issuance are intermediate outcomes.
- F100-012 The program records lost reasons, abandoned reservations, failed payments, refunds, and cancellations rather than dropping them from the funnel.
```

- [ ] **Step 4: Define cost and decision requirements**

```markdown
## Cost and decision requirements
- F100-013 Onboarding time is recorded per cooperative and split into AGMX operator time and customer time.
- F100-014 Support effort, LIVE/AI/communication/storage usage, payment fees, referral credits, and partner commissions are measured from real records.
- F100-015 Contribution margin is calculated per mature paid cohort using the commercial addendum formula.
- F100-016 Provisional management thresholds are approved before recruitment: at least 20 discovery interviews, at least 10 paid Founding cooperatives for an initial signal, median onboarding at or below 6 hours, first-30-day support at or below 2 hours per cooperative, contribution margin below 40 percent as a stop condition, and payment failure above 10 percent as a stop condition.
- F100-017 Price changes require a decision record citing paid conversion, realized ARR, contribution margin, support/onboarding effort, and lost reasons.
- F100-018 Actual renewal is reported only after the renewal window matures; renewal intent remains a separate survey metric.
```

- [ ] **Step 5: Define the event contract**

```markdown
## Event contract

Required fields: event_id, event_name, occurred_at, received_at, actor_type, actor_id, organization_id, cohort_id, offer_version_id, reservation_id, quote_id, invoice_id, payment_id, subscription_period_id, amount_minor, currency, outcome, reason_code, source, instrumentation_version.

Required events: offer_viewed, eligibility_checked, reservation_held, reservation_qualified, reservation_expired, quote_issued, quote_accepted, invoice_issued, payment_attempted, payment_settled, payment_failed, subscription_activated, onboarding_started, onboarding_completed, support_ticket_opened, support_ticket_closed, usage_recorded, renewal_due, renewal_attempted, renewal_settled, cancelled, refunded.

Rules: event IDs are idempotent; timestamps use ISO 8601 with offset; amounts are integer minor units; outcome and reason_code are explicit; missing values remain null; late events retain occurred_at and received_at; no event stores card data, gateway secrets, or bearer tokens.
```

- [ ] **Step 6: Define metrics and dashboard requirements**

```markdown
## Metrics and dashboard requirements
- F100-019 Reports define numerator, denominator, cohort, observation window, maturity rule, and instrumentation status before displaying a rate.
- F100-020 Dashboards distinguish not_instrumented, no_data, partial_data, and complete_data; they never convert missing instrumentation into a zero result.

Required metrics: qualified_reservations, paid_founding_cooperatives, reservation_to_paid, quote_to_paid, realized_arr, average_selling_price, onboarding_hours, support_hours, usage_cost, payment_failure_rate, contribution_margin, cancellation_rate, renewal_intent, actual_renewal_rate.
```

- [ ] **Step 7: Add governance and stop conditions**

Define a weekly review with product, finance, sales, and support owners. Stop or pause the campaign for a security incident, unsupported public claim, payment failure above 10 percent in a mature cohort, contribution margin below 40 percent in a mature cohort, onboarding median above 6 hours after 10 paid cooperatives, or any mismatch between the published counter and paid records. Every stop/restart decision is recorded with date, owner, evidence, and action.

- [ ] **Step 8: Verify program coverage**

Run: `rg -n "F100-0(0[1-9]|1[0-9]|20)|offer_viewed|payment_settled|not_instrumented|actual_renewal_rate" specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md`
Expected: all requirement IDs and required markers appear.

### Task 2: Link the playbook without activating the campaign

**Files:**
- Modify: `AGMX_V2_PLAN.md:175-240`
- Modify: `README.md`

**Interfaces:**
- Consumes: `AGMX_FOUNDING100_VALIDATION.md`.
- Produces: visible evidence status and ownership entry point.

- [ ] **Step 1: Add this item to `AGMX_V2_PLAN.md` immediate next actions**

```markdown
- [ ] **Founding 100 pricing validation — playbook defined, not started.** Follow [`specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md`](specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md). No paid cohort, price decision, or renewal result may be claimed until the event contract and approval gates are operating.
```

- [ ] **Step 2: Add this note to the README commercial section**

```markdown
Founding 100 validation is defined in [`specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md`](specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md). The playbook is not evidence that the campaign has launched or that any cooperative has paid.
```

- [ ] **Step 3: Verify no campaign count or outcome was added**

Run: `rg -n "Founding 100|paid Founding|renewal" AGMX_V2_PLAN.md README.md specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md`
Expected: all references describe requirements, status, or metric definitions—not fabricated results.

### Task 3: Add a program checker and regression test

**Files:**
- Create: `tools/check_founding100_program.mjs`
- Create: `tools/test_founding100_program.mjs`
- Modify: `package.json:8-11`

**Interfaces:**
- Consumes: Founding 100 playbook Markdown.
- Produces: `validateFounding100Program(root)` returning `{ ok, errors }`.

- [ ] **Step 1: Write the failing checker test**

```js
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateFounding100Program } from "./check_founding100_program.mjs";

const root = mkdtempSync(join(tmpdir(), "agmx-founding100-"));
try {
  mkdirSync(join(root, "specs/prd-v2"), { recursive: true });
  writeFileSync(join(root, "specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md"), "# broken\n");
  assert.equal(validateFounding100Program(root).ok, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node tools/test_founding100_program.mjs`
Expected: FAIL because the checker does not exist.

- [ ] **Step 3: Implement the checker**

```js
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function validateFounding100Program(root) {
  const errors = [];
  const path = join(root, "specs/prd-v2/AGMX_FOUNDING100_VALIDATION.md");
  if (!existsSync(path)) return { ok: false, errors: ["missing Founding 100 playbook"] };
  const text = readFileSync(path, "utf8");
  for (const marker of [
    "Status: DRAFT OPERATING PLAYBOOK",
    "no customer outcomes recorded",
    "## Cohort and offer requirements",
    "## Research and experiment requirements",
    "## Cost and decision requirements",
    "## Event contract",
    "## Metrics and dashboard requirements",
    "not_instrumented",
    "actual_renewal_rate",
  ]) {
    if (!text.includes(marker)) errors.push(`missing ${marker}`);
  }
  for (let i = 1; i <= 20; i += 1) {
    const id = `F100-${String(i).padStart(3, "0")}`;
    const count = text.split(id).length - 1;
    if (count !== 1) errors.push(`${id} must appear exactly once`);
  }
  for (const event of ["offer_viewed", "reservation_held", "payment_settled", "subscription_activated", "renewal_settled", "refunded"]) {
    if (!text.includes(event)) errors.push(`missing event ${event}`);
  }
  if (text.includes("at or below 40 percent as a stop condition")) {
    errors.push("contribution-margin stop condition is inverted");
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = validateFounding100Program(process.cwd());
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("Founding 100 program is structurally valid.");
}
```

- [ ] **Step 4: Run the checker test and verify it passes**

Run: `node tools/test_founding100_program.mjs`
Expected: PASS.

- [ ] **Step 5: Add the package script**

```json
"check:founding100-program": "node tools/check_founding100_program.mjs"
```

- [ ] **Step 6: Run the repository check**

Run: `npm run check:founding100-program`
Expected: PASS with `Founding 100 program is structurally valid.`

### Task 4: Document limits and verify

**Files:**
- Modify: `tools/CHECKS.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a documented structural check and an explicit no-results statement.

- [ ] **Step 1: Add this note to `tools/CHECKS.md`**

```markdown
## Founding 100 program check

`npm run check:founding100-program` validates the playbook's structure, cohort rules, event contract, metrics, and requirement IDs. It does not start the campaign, create customer records, or prove any pricing or renewal outcome.
```

- [ ] **Step 2: Run verification**

```bash
npm run check:founding100-program
node tools/test_founding100_program.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 3: Self-review**

Confirm the playbook contains no invented customer counts or outcomes, all rates have denominators and maturity rules, the contribution-margin stop condition is correct, and campaign activation remains explicitly unapproved.
