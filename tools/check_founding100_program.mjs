import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validateFounding100Program(process.cwd());
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("Founding 100 program is structurally valid.");
}
