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
