# AGMX Commercial Requirements Addendum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authoritative commercial requirements to the tracked PRD without changing live prices or pretending that draft business-model assumptions are approved terms.

**Architecture:** Create a commercial requirements addendum under `specs/prd-v2`, separate current implementation from target behavior, and add a structural checker. Billing implementation remains a later engineering effort; this plan makes the required contracts, state machines, security boundaries, and metrics explicit.

**Tech Stack:** Markdown, Node.js 22+, existing Postgres/Deno/vanilla-JavaScript architecture.

**Spec:** `AGMX_BUSINESS_MODEL_MASTER_v1.0.pdf` §§4–16 and §§19–27; `AGMX_MASTER_PRD_v2.0_GAP_ANALYSIS.pdf` §§13–20; current commercial code in `supabase/migrations/0006_subscriptions_billing.sql` and `supabase/functions/money-flow/index.ts`.

## Global Constraints

- Current DutaGovern prices and rolling annual subscriptions remain unchanged until a separate approved migration and release.
- Small/Growth/Enterprise are commercial tiers. Phase 1/2/3 are delivery phases.
- Target subscription year is 1 January–31 December in `Asia/Kuala_Lumpur`.
- Founding 100 is a capacity-limited commercial campaign, not a fabricated scarcity claim.
- A reservation, quote, invoice, or promise is not a paid Founding member.
- Server-side calculation is authoritative. Clients never submit trusted totals, eligibility, discounts, or commission rates.
- Every accepted commercial term is snapshotted: plan version, price, currency, tax rule, promotion, allowances, renewal policy, and legal terms version.
- Referral credits are non-cash ledger entries. Partner commissions are separate from referral credits.
- Refunds and chargebacks reverse the related credit or commission.
- Legacy rolling subscriptions must remain readable and enforceable; do not silently convert them to calendar-year periods.
- Mid-year subscription activation is denied until an approved proration policy exists.
- Financial mutations require service-only transactional RPCs or handlers with explicit tenant, role, and object-ownership checks.
- No production data or credentials are required for tests.

---

## File Structure

- Create `specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md` — target commercial product requirements and state machines.
- Modify `AGMX_V2_PLAN.md` — label current packages as legacy/current and link the target addendum.
- Modify `README.md` — add a short current-versus-target commercial note near the feature-state table.
- Create `tools/check_commercial_requirements.mjs` — validates required requirement IDs, sections, and state names.
- Create `tools/test_commercial_requirements.mjs` — proves malformed commercial requirements are rejected.
- Modify `package.json` — add `check:commercial-requirements`.
- Modify `tools/CHECKS.md` — document the command and its limits.

### Task 1: Create the commercial requirements addendum

**Files:**
- Create: `specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md`

**Interfaces:**
- Consumes: Business Model Master commercial rules and current schema/API behavior.
- Produces: requirement IDs `COM-001`–`COM-028`, target state machines, metric definitions, and approval boundaries.

- [ ] **Step 1: Write the document header and authority rules**

```markdown
# AGMX Commercial Requirements Addendum

Status: TARGET REQUIREMENTS — not all behavior is implemented.
Authority: AGMX Business Model Master v1.0 commercial rules, subject to the approval boundaries below.
Current implementation: legacy DutaGovern rolling annual plans in `price-list.js` and migration `0006_subscriptions_billing.sql`.

## Approval boundaries
- Final regular and founding prices are not approved by this document.
- LIVE/AI allowances, mid-year proration, payment provider fees, partner rates, and the professional-services price book require separate approval.
- Until approved, production keeps its current price book and denies new calendar-year/founding activation.
```

- [ ] **Step 2: Add the plan and pricing requirements**

Include these exact IDs and acceptance statements:

```markdown
## Plan, price, and term requirements
- COM-001 Plan versions are immutable after use; a changed price creates a new version.
- COM-002 A server pricing preview returns plan version, subtotal, discounts, tax rule, total, currency, allowances, and term dates.
- COM-003 Quotes, invoices, subscription periods, and renewals store immutable commercial-term snapshots.
- COM-004 New calendar-year subscriptions run 1 January–31 December in `Asia/Kuala_Lumpur`.
- COM-005 Founding 100 has configurable capacity, window, eligibility, and an atomic reservation cap of 100 qualified paid cooperatives.
- COM-006 Qualified Founding 100 purchases made during the approved Q4 2026 window receive access through 31 December 2026 and a paid 2027 period.
- COM-007 Three-year price protection applies only while the subscription remains continuous and only after approved legal terms are accepted.
- COM-008 Expired subscriptions enter a defined grace/read-only state; governance history remains accessible according to retention policy.
- COM-009 Renewal moves due → invoice issued → payment settled → activated; a period is never activated before settlement.
- COM-010 Mid-year activation is rejected unless an approved proration policy is configured.
- COM-011 Promotions have versioned eligibility, windows, discount type/value, usage cap, and stacking rules.
- COM-012 Browser price cards are display-only; checkout renders the server preview and cannot override it.
```

- [ ] **Step 3: Add referral, partner, usage, and settlement requirements**

```markdown
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
```

- [ ] **Step 4: Add data, audit, UI, and metrics requirements**

```markdown
## Data, audit, UI, and metrics requirements
- COM-025 Commercial facts are durable records; audit logs are not the sole source for revenue or cohort reporting.
- COM-026 Commercial events include event/idempotency IDs, timestamps, actor/source, organization, cohort, offer, snapshot, period, amount, currency, outcome, and reason.
- COM-027 Legacy rolling subscriptions remain readable and enforceable; migration to calendar-year terms requires explicit customer consent or renewal.
- COM-028 Pricing-validation reports preserve unknown/null outcomes and define denominators and observation windows before displaying rates.
```

- [ ] **Step 5: Add target state machines**

```markdown
## Target state machines

Subscription: pending_payment → active → past_due → grace → read_only → expired; cancellation may move active/past_due/grace → cancelled at period end.
Subscription period: scheduled → invoice_issued → paid → activated; unpaid periods may become overdue/cancelled.
Founding reservation: held → qualified → paid; held → expired/released; qualified → lost with reason.
Promotion: draft → active → paused → expired; active → archived.
Referral: clicked → registered → qualified → subscribed → payment_cleared → reward_approved → credited; any pre-credit state may become rejected/reversed with reason.
Credit: held → available → redeemed; held/available → reversed/expired.
Commission: pending → hold → approved → available → paid; pending/hold/approved/available → reversed.
```

- [ ] **Step 6: Add metric definitions and decision rules**

Define at least:

- `founding_reservation_to_paid = paid qualified founding cooperatives / matured qualified reservations`
- `quote_to_paid = settled quotes / issued quotes in the same mature cohort`
- `realized_arr = sum of settled subscription period amounts excluding tax, credits, and one-off services`
- `contribution_margin = subscription + add-ons + referral credits + partner commissions − LIVE − AI − communication − storage − direct support`
- `onboarding_hours = summed operator and customer onboarding time per activated cooperative`
- `renewal_rate = renewed mature periods / periods whose renewal window closed`
- `renewal_intent = survey signal only; never label it actual renewal`

Add decision rules: do not publish final prices from interview intent alone; require settled transactions and observed costs; do not compute renewal rate for cohorts whose renewal window has not matured.

- [ ] **Step 7: Verify requirement coverage**

Run: `rg -n "COM-0(0[1-9]|1[0-9]|2[0-8])" specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md`
Expected: every ID `COM-001` through `COM-028` appears exactly once as a requirement heading or bullet.

### Task 2: Separate current commercial behavior from target requirements

**Files:**
- Modify: `AGMX_V2_PLAN.md:45-60`
- Modify: `README.md:39-65`

**Interfaces:**
- Consumes: `AGMX_COMMERCIAL_REQUIREMENTS.md`.
- Produces: documentation that cannot be read as approval to change live prices.

- [ ] **Step 1: Add this note above `AGMX_V2_PLAN.md` §4**

```markdown
> **Commercial status:** the packages below describe the currently deployed legacy offer. The target calendar-year, Founding 100, referral-credit, partner-commission, and versioned-pricing requirements are defined in [`specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md`](specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md). Final prices and campaign terms remain unapproved; do not change production pricing from this plan alone.
```

- [ ] **Step 2: Add this note after the README feature-state table**

```markdown
### Commercial target versus current implementation

The live rate card and rolling annual subscriptions are the current implementation. Calendar-year subscriptions, Founding 100 reservations, versioned commercial terms, referral credits, partner commission lifecycles, and usage allowances are target requirements in [`specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md`](specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md). They must not be described as live until server, database, UI, and tests implement the corresponding requirement IDs.
```

- [ ] **Step 3: Verify no price or implementation claim changed**

Run: `git diff -- price-list.js supabase/migrations/0006_subscriptions_billing.sql index.html checkout.html`
Expected: no diff.

### Task 3: Add a commercial-requirements checker and regression test

**Files:**
- Create: `tools/check_commercial_requirements.mjs`
- Create: `tools/test_commercial_requirements.mjs`
- Modify: `package.json:8-11`

**Interfaces:**
- Consumes: commercial addendum Markdown.
- Produces: `validateCommercialRequirements(root)` returning `{ ok, errors }`.

- [ ] **Step 1: Write the failing checker test**

```js
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCommercialRequirements } from "./check_commercial_requirements.mjs";

const root = mkdtempSync(join(tmpdir(), "agmx-commercial-"));
try {
  mkdirSync(join(root, "specs/prd-v2"), { recursive: true });
  writeFileSync(join(root, "specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md"), "# broken\n");
  assert.equal(validateCommercialRequirements(root).ok, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node tools/test_commercial_requirements.mjs`
Expected: FAIL because the checker does not exist.

- [ ] **Step 3: Implement the checker**

```js
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function validateCommercialRequirements(root) {
  const errors = [];
  const path = join(root, "specs/prd-v2/AGMX_COMMERCIAL_REQUIREMENTS.md");
  if (!existsSync(path)) return { ok: false, errors: ["missing commercial requirements"] };
  const text = readFileSync(path, "utf8");
  for (const heading of [
    "Status: TARGET REQUIREMENTS",
    "## Approval boundaries",
    "## Target state machines",
    "## Metric definitions and decision rules",
  ]) {
    if (!text.includes(heading)) errors.push(`missing ${heading}`);
  }
  for (let i = 1; i <= 28; i += 1) {
    const id = `COM-${String(i).padStart(3, "0")}`;
    const count = text.split(id).length - 1;
    if (count !== 1) errors.push(`${id} must appear exactly once`);
  }
  for (const state of ["pending_payment", "invoice_issued", "payment_cleared", "reward_approved", "reversed", "expired"]) {
    if (!text.includes(state)) errors.push(`missing state ${state}`);
  }
  for (const metric of ["founding_reservation_to_paid", "realized_arr", "contribution_margin", "renewal_rate", "renewal_intent"]) {
    if (!text.includes(metric)) errors.push(`missing metric ${metric}`);
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = validateCommercialRequirements(process.cwd());
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("Commercial requirements are structurally valid.");
}
```

- [ ] **Step 4: Run the checker test and verify it passes**

Run: `node tools/test_commercial_requirements.mjs`
Expected: PASS.

- [ ] **Step 5: Add the package script**

```json
"check:commercial-requirements": "node tools/check_commercial_requirements.mjs"
```

- [ ] **Step 6: Run the repository check**

Run: `npm run check:commercial-requirements`
Expected: PASS with `Commercial requirements are structurally valid.`

### Task 4: Document limits and verify

**Files:**
- Modify: `tools/CHECKS.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a documented structural check that is not mistaken for billing implementation.

- [ ] **Step 1: Add this note to `tools/CHECKS.md`**

```markdown
## Commercial requirements check

`npm run check:commercial-requirements` validates the target commercial addendum's structure, requirement IDs, states, and metrics. It does not change prices, migrate subscriptions, or prove that billing behavior is implemented.
```

- [ ] **Step 2: Run verification**

```bash
npm run check:commercial-requirements
node tools/test_commercial_requirements.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 3: Self-review**

Confirm every Business Model Master commercial theme has a requirement or an explicit approval boundary; no draft price is presented as approved; no current implementation is mislabeled as target behavior.
