import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("assessment page loads Turnstile and exposes a widget target", () => {
  const html = read("assessment.html");
  assert.match(html, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
  assert.match(html, /id="turnstile-widget"/);
  assert.match(html, /id="turnstile-error"/);
});

test("assessment submit path uses the protected same-origin intake endpoint", () => {
  const js = read("assessment.js");
  assert.match(js, /fetch\(["']\/api\/intake["']/);
  assert.match(js, /submissionId/);
  assert.match(js, /turnstileToken/);
  assert.doesNotMatch(js, /API\.submitAssessment\(lead\)/);
});

test("missing Turnstile token reports a visible, user-facing error", () => {
  const js = read("assessment.js");
  const reset = js.match(/function resetTurnstile\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.doesNotMatch(reset, /setTurnstileError\(""\)/);
  assert.match(
    js,
    /if \(!turnstileToken\) \{[\s\S]*?const message = T\("Sila lengkapkan pengesahan bot\.", "Please complete bot verification\."\);\s*setTurnstileError\(message\);\s*throw new Error\(message\);/
  );
});

test("both deployment CSPs allow the Turnstile script and challenge frame", () => {
  for (const file of ["vercel.json", "_headers"]) {
    const text = read(file);
    assert.match(text, /https:\/\/challenges\.cloudflare\.com/);
    assert.match(text, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  }
});

test("runtime config exposes only the public intake flag and Turnstile site key", () => {
  for (const file of ["api/config.js", "functions/config.js.js"]) {
    const text = read(file);
    assert.match(text, /publicIntakeEnabled/);
    assert.match(text, /turnstileSiteKey/);
    assert.doesNotMatch(text, /TURNSTILE_SECRET_KEY/);
    assert.doesNotMatch(text, /INTAKE_PROXY_SECRET/);
    assert.doesNotMatch(text, /INTAKE_INTERNAL_KEY/);
  }
});
