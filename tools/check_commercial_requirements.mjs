import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validateCommercialRequirements(process.cwd());
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("Commercial requirements are structurally valid.");
}
