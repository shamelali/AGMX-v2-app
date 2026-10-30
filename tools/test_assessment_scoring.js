/* Assessment scoring and commercial threshold regressions, without a browser. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assessment.js"), "utf8");
const context = { document: { addEventListener() {} }, window: {} };
// Expose lexical bindings only in this VM test; production remains an IIFE.
assert.match(source, /\}\)\(\);\s*$/);
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
  globalThis.assessmentRules = { computeScore, pickAgmPackage, pickAnnualPlan };
})();`), context);
const { computeScore, pickAgmPackage, pickAnnualPlan } = context.assessmentRules;

function score(overrides = {}) {
  return computeScore({
    members: 299, mode: "physical", attendance: 0.29,
    candidates: 0, motions: 0, process: "digital", managed: false,
    ...overrides,
  });
}

const minimum = score();
assert.strictEqual(minimum.total, 24);
assert.strictEqual(minimum.factors.length, 7);
assert.strictEqual(minimum.factors.reduce((sum, factor) => sum + factor.points, 0), minimum.total);
assert.strictEqual(minimum.factors.reduce((sum, factor) => sum + factor.max, 0), 100);
assert.strictEqual(score({ members: 300 }).total, 34);
assert.strictEqual(score({ members: 1000 }).total, 41);
assert.strictEqual(score({ members: 2000 }).total, 49);
assert.strictEqual(score({ attendance: 0.3 }).total, 29);
assert.strictEqual(score({ attendance: 0.5 }).total, 29);
assert.strictEqual(score({ attendance: 0.5001 }).total, 35);
assert.strictEqual(score({ candidates: 1, motions: 6 }).total, 29);
assert.strictEqual(score({ candidates: 4, motions: 16 }).total, 37);

const maximum = score({ members: 2000, mode: "hybrid", attendance: 0.6,
  candidates: 8, motions: 16, process: "manual", managed: true });
assert.strictEqual(maximum.total, 100);
assert.deepStrictEqual(Array.from(maximum.factors, ({ points, max }) => [points, max]),
  [[30, 30], [12, 12], [16, 16], [12, 12], [10, 10], [10, 10], [10, 10]]);

for (const [points, members, key, price] of [
  [34, 299, "essential", 1500], [35, 299, "professional", 3500],
  [64, 1999, "professional", 3500], [65, 1999, "enterprise", 7500],
  [24, 1999, "essential", 1500], [24, 2000, "enterprise", 7500],
]) {
  const pkg = pickAgmPackage(points, members);
  assert.strictEqual(pkg.key, key, `score ${points}, members ${members}`);
  assert.strictEqual(pkg.price, price, `score ${points}, members ${members}`);
}

for (const [members, plan, monthly] of [
  [299, "Governance Essential", 600], [300, "Governance Professional", 800],
  [999, "Governance Professional", 800], [1000, "Governance Enterprise", 1000],
  [1999, "Governance Enterprise", 1000], [2000, "Governance Federation", 1250],
]) {
  const selected = pickAnnualPlan(members);
  assert.strictEqual(selected.name, plan, `annual plan at ${members} members`);
  assert.strictEqual(selected.monthly, monthly, `monthly price at ${members} members`);
}

console.log("assessment scoring/package boundaries: passed");
