/* Assessment scoring and commercial threshold regressions, without a browser. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assessment.js"), "utf8");
// The page reads prices and member caps off window.AGMX_PRICE_LIST, so this
// harness has to install the same card a browser loads. Without it RATE_CARD is
// null, every price asserts against null, and the boundaries pass by accident.
const RATE_CARD = require(path.join(__dirname, "..", "price-list.js"));
const context = { document: { addEventListener() {} }, window: { AGMX_PRICE_LIST: RATE_CARD } };
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

// Expectations name plan keys, never prices: a test that re-types RM1,500 is a
// fourth price book, and this repo has already burned down three.
const service = (key) => RATE_CARD.services().find((p) => p.key === key);

for (const [points, members, key] of [
  [34, 299, "essential"], [35, 299, "professional"],      // money-flow's 34/35 edge
  [64, 1999, "professional"], [65, 1999, "enterprise"],   // and its 64/65 edge
  [24, service("essential").memberCap, "essential"],
  [24, service("essential").memberCap + 1, "professional"],
  [24, service("professional").memberCap, "professional"],
  [24, service("professional").memberCap + 1, "enterprise"],
  [100, 300, "enterprise"],                               // caps lift, never demote
]) {
  const pkg = pickAgmPackage(points, members);
  assert.strictEqual(pkg.key, key, `score ${points}, members ${members}`);
  assert.strictEqual(pkg.price, service(key).oneoff, `price of ${key} comes from the card`);
}

for (const [members, code] of [
  [299, "governance_os_essential"], [300, "governance_os_professional"],
  [999, "governance_os_professional"], [1000, "governance_os_enterprise"],
  [1999, "governance_os_enterprise"], [2000, "governance_os_federation"],
  [50000, "governance_os_federation"],
]) {
  const selected = pickAnnualPlan(members);
  const plan = RATE_CARD.byCode(code);
  assert.strictEqual(selected.code, code, `annual plan at ${members} members`);
  assert.strictEqual(selected.monthly, plan.monthly, `monthly at ${members} members`);
}

console.log("assessment scoring/package boundaries: passed");
