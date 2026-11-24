import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validatePhase1Contract(process.cwd());
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("Phase 1 release contract is structurally valid.");
}
