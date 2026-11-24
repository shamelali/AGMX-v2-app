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
