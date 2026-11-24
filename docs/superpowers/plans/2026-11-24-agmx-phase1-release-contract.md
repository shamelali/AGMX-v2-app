# AGMX Phase 1 Release Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 1 launch scope unambiguous and ensure the repository can distinguish a written requirement from verified release evidence.

**Architecture:** Add one authoritative Phase 1 release contract under `specs/prd-v2`, reconcile the existing roadmap and sprint specs against it, and add a small Node-based contract check. The contract describes the target gate; it does not assert that the current implementation passes it.

**Tech Stack:** Markdown, Node.js 22+, existing vanilla JavaScript/Postgres test tooling.

**Spec:** `AGMX_MASTER_PRD_v2.0_GAP_ANALYSIS.pdf` §§17–19; `specs/prd-v2/AGMX_SPRINT2_AGM_WORKSPACE_LIFECYCLE.md`; `specs/prd-v2/AGMX_SPRINT14_HARDENING.md`.

## Global Constraints

- Phase 1 release gate: “One physical AGM managed end-to-end with auditable records.”
- Phase 1 is physical-only. Hybrid/online chamber operation is Phase 2.
- AI transcription and AI-assisted minutes are Phase 2. Phase 1 minutes require manual drafting and human verification.
- Advanced evidence packages, white-label, integrations, multi-cooperative scale, full DR, advanced analytics/AI, and SLA readiness are Phase 3.
- A minimum immutable evidence export is Phase 1 because the release gate requires auditable records.
- `organization_id` remains the tenant boundary. Service-role handlers must validate tenant and role independently of RLS.
- Critical governance events remain append-only. No unchecked acceptance box is release evidence.
- `supabase/migrations/*.sql` is schema truth; `supabase/schema_final.sql` is generated and must not be hand-edited.
- Tests must not write to production or require live credentials.
- Public claims must distinguish Live, Built but not reachable, and Planned.

---

## File Structure

- Create `specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md` — authoritative scope, gates, exclusions, and evidence rules.
- Modify `AGMX_V2_PLAN.md` — replace the ambiguous MVP sentence with a link to the release contract and a current-evidence warning.
- Modify `specs/prd-v2/AGMX_SPRINT12_MINUTES_AI.md` — separate Phase 1 manual minutes from Phase 2 AI minutes.
- Modify `specs/prd-v2/AGMX_SPRINT13_POSTAGM_EVIDENCE.md` — separate the Phase 1 minimum export from Phase 3 advanced evidence packages.
- Modify `specs/prd-v2/AGMX_SPRINT14_HARDENING.md` — separate Phase 1 security/accessibility/restore evidence from Phase 2/3 resilience, DR, and SLA work.
- Create `tools/check_phase1_contract.mjs` — validates the contract's structure and referenced files.
- Create `tools/test_phase1_contract.mjs` — proves the checker rejects a broken contract.
- Modify `package.json` — add `check:phase1-contract`.
- Modify `tools/CHECKS.md` — document the new command and its limits.

### Task 1: Create the authoritative Phase 1 release contract

**Files:**
- Create: `specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md`

**Interfaces:**
- Consumes: PRD §§17–19 and Sprint 2–8, 12–14 requirements.
- Produces: gate IDs `G1`–`G9`, phase labels, and evidence rules referenced by the roadmap and checker.

- [ ] **Step 1: Write the contract with these exact sections**

```markdown
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

## Evidence rules
- A requirement is complete only when a named automated test or reviewed manual evidence record passes.
- Skipped or unavailable required evidence is a failure, not a warning.
- No Phase 2/3 capability may be sold as included in Phase 1.
- No AI output may finalise minutes or make a governance/legal decision.
```

- [ ] **Step 2: Add a gap register beneath the contract**

List each current gap with its gate ID and evidence path: physical fixture absent; lifecycle gates weaker than spec; nominations/candidates absent; readiness/quorum-before-convene absent; maker-checker/result verification/scrutineer receipt absent; manual minute verification/lock absent; evidence export absent; strict NFR evidence absent. Do not mark any gap complete.

- [ ] **Step 3: Verify the contract manually**

Run: `rg -n "Status: NOT READY|G1|G9|Excluded from Phase 1|Evidence rules" specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md`
Expected: all required markers are present.

### Task 2: Reconcile the roadmap and phase-conflicting sprint specs

**Files:**
- Modify: `AGMX_V2_PLAN.md:163-173`
- Modify: `specs/prd-v2/AGMX_SPRINT12_MINUTES_AI.md:5-37`
- Modify: `specs/prd-v2/AGMX_SPRINT13_POSTAGM_EVIDENCE.md:5-31`
- Modify: `specs/prd-v2/AGMX_SPRINT14_HARDENING.md:18-29`

**Interfaces:**
- Consumes: `AGMX_PHASE1_RELEASE_CONTRACT.md`.
- Produces: one consistent phase boundary across planning documents.

- [ ] **Step 1: Replace `AGMX_V2_PLAN.md` §9 with this release-contract wording**

```markdown
## 9. Phase 1 release contract

The Phase 1 release gate is defined in
[`specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md`](specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md):
one physical AGM managed end-to-end with auditable records.

The existing `tools/test_agm_journey.mjs` is useful regression evidence, but it
uses a hybrid fixture and does not yet prove every Phase 1 gate. The release
contract therefore remains **NOT READY** until gates G1–G9 have named, passing
evidence. Do not describe the current journey as proof of Phase 1 completion.
```

- [ ] **Step 2: Add phase labels to Sprint 12**

Add immediately after the objective:

```markdown
Phase boundary: Phase 1 implements manual minutes, editorial review, human verification, approval, and lock. AI transcription and AI-assisted drafting are Phase 2 and are not Phase 1 acceptance evidence.
```

- [ ] **Step 3: Add phase labels to Sprint 13**

Add immediately after the objective:

```markdown
Phase boundary: Phase 1 requires a minimum immutable evidence export sufficient for an auditable physical AGM. Advanced evidence packages and enterprise vault capabilities are Phase 3.
```

- [ ] **Step 4: Add phase labels to Sprint 14**

Replace the release-gate bullets with:

```markdown
## Release gates
- Phase 1: one physical AGM managed end-to-end with auditable records; security, accessibility, retention, backup/restore, and claims evidence must pass.
- Phase 2: hybrid/online AGM operates without leaving AGMX; reconnect and failure paths are tested.
- Phase 3: enterprise scale, full DR, advanced analytics/AI, white-label, integrations, and operational SLA readiness.
```

- [ ] **Step 5: Verify no document still equates the hybrid journey with Phase 1 completion**

Run: `rg -n "Phase 1|MVP|hybrid|AI draft|evidence package" AGMX_V2_PLAN.md specs/prd-v2/AGMX_SPRINT12_MINUTES_AI.md specs/prd-v2/AGMX_SPRINT13_POSTAGM_EVIDENCE.md specs/prd-v2/AGMX_SPRINT14_HARDENING.md`
Expected: phase boundaries are explicit and no sentence claims the current hybrid journey proves Phase 1 readiness.

### Task 3: Add a contract checker and regression test

**Files:**
- Create: `tools/check_phase1_contract.mjs`
- Create: `tools/test_phase1_contract.mjs`
- Modify: `package.json:8-11`

**Interfaces:**
- Consumes: contract Markdown and repository file paths.
- Produces: `validatePhase1Contract(root)` returning `{ ok, errors }`; CLI exits `0` when valid and `1` otherwise.

- [ ] **Step 1: Write the failing checker test**

```js
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePhase1Contract } from "./check_phase1_contract.mjs";

const root = mkdtempSync(join(tmpdir(), "agmx-phase1-"));
try {
  mkdirSync(join(root, "specs/prd-v2"), { recursive: true });
  writeFileSync(join(root, "specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md"), "# broken\n");
  assert.equal(validatePhase1Contract(root).ok, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node tools/test_phase1_contract.mjs`
Expected: FAIL because `check_phase1_contract.mjs` does not exist.

- [ ] **Step 3: Implement the checker**

```js
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function validatePhase1Contract(root) {
  const errors = [];
  const contractPath = join(root, "specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md");
  const required = [
    "Status: NOT READY",
    "## Included in Phase 1",
    "## Excluded from Phase 1",
    "## Release gates",
    "## Evidence rules",
    ...Array.from({ length: 9 }, (_, i) => `| G${i + 1} |`),
  ];
  if (!existsSync(contractPath)) {
    return { ok: false, errors: ["missing Phase 1 release contract"] };
  }
  const text = readFileSync(contractPath, "utf8");
  for (const marker of required) {
    if (!text.includes(marker)) errors.push(`contract missing ${marker}`);
  }
  for (const file of [
    "AGMX_V2_PLAN.md",
    "specs/prd-v2/AGMX_SPRINT12_MINUTES_AI.md",
    "specs/prd-v2/AGMX_SPRINT13_POSTAGM_EVIDENCE.md",
    "specs/prd-v2/AGMX_SPRINT14_HARDENING.md",
  ]) {
    if (!existsSync(join(root, file))) errors.push(`missing ${file}`);
  }
  const roadmap = existsSync(join(root, "AGMX_V2_PLAN.md"))
    ? readFileSync(join(root, "AGMX_V2_PLAN.md"), "utf8")
    : "";
  if (!roadmap.includes("specs/prd-v2/AGMX_PHASE1_RELEASE_CONTRACT.md")) {
    errors.push("roadmap does not link the Phase 1 release contract");
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = validatePhase1Contract(process.cwd());
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("Phase 1 release contract is structurally valid.");
}
```

- [ ] **Step 4: Run the checker test and verify it passes**

Run: `node tools/test_phase1_contract.mjs`
Expected: PASS.

- [ ] **Step 5: Add the package script**

```json
"check:phase1-contract": "node tools/check_phase1_contract.mjs"
```

- [ ] **Step 6: Run the repository contract check**

Run: `npm run check:phase1-contract`
Expected: PASS with `Phase 1 release contract is structurally valid.`

### Task 4: Document the checker's limits and verify the plan

**Files:**
- Modify: `tools/CHECKS.md`
- Modify: `AGMX_V2_PLAN.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: documented command and an explicit statement that structural validity is not release readiness.

- [ ] **Step 1: Add this note to `tools/CHECKS.md`**

```markdown
## Phase 1 contract check

`npm run check:phase1-contract` validates that the Phase 1 release contract,
phase boundaries, gate IDs, and roadmap link exist. It does not prove that
G1–G9 pass. Release readiness requires the named test and manual evidence for
every gate; skipped evidence remains a failure.
```

- [ ] **Step 2: Run all documentation checks**

```bash
npm run check:phase1-contract
node tools/test_phase1_contract.mjs
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 3: Self-review the plan**

Confirm G1–G9 each have a contract row, every phase conflict is resolved, no placeholder remains, and no sentence claims the current implementation is launch-ready.
