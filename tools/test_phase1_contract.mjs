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
