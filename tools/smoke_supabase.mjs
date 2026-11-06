#!/usr/bin/env node
/* ============================================================
   AGMX — Live smoke test for the Supabase money-flow Edge Function

   Walks the prospect checkout path end-to-end against a deployed
   instance using only the publishable/anon key:
     assessment → lead poll → quote → quote fetch → accept →
     invoice → invoice fetch → bank-transfer intent → deal resume → audit

   Also asserts unauthenticated access is rejected.

   Never calls a gateway: only bank_transfer (operator-confirmed) is
   exercised, so no Billplz/HitPay secrets are required.

   Usage:
     SUPABASE_URL=https://xxx.supabase.co \
     SUPABASE_ANON_KEY=eyJ... \
       node tools/smoke_supabase.mjs [--cleanup --project-ref REF]

   --cleanup (optional) deletes every row this run created, via the
   Management API. Needs SUPABASE_ACCESS_TOKEN in the environment.
   ============================================================ */

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const URL_BASE = (argVal("--url") || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = argVal("--anon") || process.env.SUPABASE_ANON_KEY || "";
const CLEANUP = args.includes("--cleanup");
const PROJECT_REF = argVal("--project-ref") || (URL_BASE.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";

if (!URL_BASE || !ANON) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
  process.exit(2);
}

const FN = URL_BASE + "/functions/v1/money-flow";
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); }
  else { failed++; console.error("  ✗ " + label); }
}
function eq(a, b, label) {
  const good = JSON.stringify(a) === JSON.stringify(b);
  if (!good) console.error("      expected:", JSON.stringify(b), "\n      actual:  ", JSON.stringify(a));
  ok(good, label);
}

function qs(params) {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
    .join("&");
  return q ? "?" + q : "";
}

async function req(method, path, body, params) {
  const res = await fetch(FN + path + qs(params), {
    method,
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\nAGMX Supabase smoke test\n========================\n  target: " + URL_BASE + "\n");

/* ---------- 1. public assessment ---------- */
console.log("1. Assessment (public)");
const assessment = await req("POST", "/assessment", {
  coopName: "SMOKE TEST — jangan hubungi",
  coopReg: "SMOKE-" + Date.now(),
  state: "Selangor",
  members: 120,
  mode: "hybrid",
  expectedAttendance: 80,
  candidates: 2,
  motions: 3,
  currentProcess: "partial",
  needsManaged: true,
  contactName: "Smoke Test",
  contactPhone: "0120000000",
  contactEmail: "smoke@example.com",
});
ok(assessment.status === 201, "POST /assessment → 201 (got " + assessment.status + ")");
const a = assessment.data || {};
ok(/^LD-/.test(a.reference || ""), "reference is LD-xxxx: " + a.reference);
ok(!!a.token, "checkout token minted");
ok(typeof a.complexityScore === "number", "complexityScore is numeric: " + a.complexityScore);
ok(["essential_agm", "professional_agm", "enterprise_agm"].includes(a.recommendedPlan),
  "recommendedPlan is a seeded plan code: " + a.recommendedPlan);

const ctx = { ref: a.reference, t: a.token };
let quoteId = null, invoiceId = null, paymentId = null;

/* ---------- 2. auth gate ---------- */
console.log("\n2. Auth gating");
{
  const r = await req("GET", "/lead/" + encodeURIComponent(ctx.ref), null, { ref: ctx.ref });
  ok(!r.ok && [401, 403].includes(r.status), "GET /lead without token → 401/403 (got " + r.status + ")");
  const r2 = await req("POST", "/quote", { assessmentId: a.assessmentId, planCode: a.recommendedPlan });
  ok(!r2.ok && [401, 403].includes(r2.status), "POST /quote without token → 401/403 (got " + r2.status + ")");
  const r3 = await req("GET", "/lead/" + encodeURIComponent(ctx.ref), null, { ref: ctx.ref, t: "deadbeef" });
  ok(!r3.ok, "GET /lead with wrong token rejected (got " + r3.status + ")");
}

/* ---------- 3. prospect reads own lead ---------- */
console.log("\n3. Lead read (prospect token)");
{
  const r = await req("GET", "/lead/" + encodeURIComponent(ctx.ref), null, ctx);
  ok(r.status === 200, "GET /lead → 200 (got " + r.status + ")");
  eq(r.data && r.data.status, "lead", "status starts at 'lead'");
  ok(Array.isArray(r.data && r.data.quotes), "lead embeds quotes[]");
  ok(Array.isArray(r.data && r.data.invoices), "lead embeds invoices[] (flattened)");
  ok(Array.isArray(r.data && r.data.payments), "lead embeds payments[] (flattened)");
}

/* ---------- 4. quote ---------- */
console.log("\n4. Quote");
let quoteTotal = 0;
{
  const r = await req("POST", "/quote", {
    assessmentId: a.assessmentId,
    planCode: a.recommendedPlan,
    validDays: 30,
  }, ctx);
  ok(r.status === 201, "POST /quote → 201 (got " + r.status + ")");
  quoteId = r.data && r.data.quoteId;
  quoteTotal = (r.data && r.data.total) || 0;
  ok(!!quoteId, "quoteId returned");
  ok(/^QT-/.test((r.data && r.data.number) || ""), "number is QT-xxxx: " + (r.data && r.data.number));
  ok(quoteTotal > 0, "total > 0: " + quoteTotal);
}

/* ---------- 5. quote fetch by number ---------- */
let quoteNumber = "";
{
  const lead = await req("GET", "/lead/" + encodeURIComponent(ctx.ref), null, ctx);
  quoteNumber = (lead.data && lead.data.quotes && lead.data.quotes[0] && lead.data.quotes[0].number) || "";
  ok(!!quoteNumber, "lead exposes quote number");
  const r = await req("GET", "/quote/" + encodeURIComponent(quoteNumber), null, ctx);
  ok(r.status === 200 && r.data && r.data.id === quoteId, "GET /quote/:number resolves the quote");
}

/* ---------- 6. accept (idempotent) ---------- */
console.log("\n5. Quote acceptance");
{
  const r = await req("POST", "/quote/accept", { quoteId }, ctx);
  ok(r.status === 200 && r.data && r.data.status === "accepted", "POST /quote/accept → accepted");
  const again = await req("POST", "/quote/accept", { quoteId }, ctx);
  ok(again.status === 200, "accept is idempotent (got " + again.status + ")");
}

/* ---------- 7. invoice ---------- */
console.log("\n6. Invoice");
let invoiceNumber = "";
{
  const r = await req("POST", "/invoice", { quoteId }, ctx);
  ok(r.status === 201, "POST /invoice → 201 (got " + r.status + ")");
  invoiceId = r.data && r.data.invoiceId;
  invoiceNumber = (r.data && r.data.number) || "";
  ok(/^INV-/.test(invoiceNumber), "number is INV-xxxx: " + invoiceNumber);
  eq(Number(r.data && r.data.amount), Number(quoteTotal), "invoice amount equals quote total");
}
{
  const r = await req("GET", "/invoice/" + encodeURIComponent(invoiceNumber || invoiceId), null, ctx);
  ok(r.status === 200 && r.data && r.data.id === invoiceId, "GET /invoice/:number resolves the invoice");
}

/* ---------- 8. bank-transfer intent ---------- */
console.log("\n7. Payment intent (bank transfer)");
{
  const r = await req("POST", "/payment/intent", { invoiceId, method: "bank_transfer" }, ctx);
  ok(r.status === 200, "POST /payment/intent → 200 (got " + r.status + ")");
  paymentId = r.data && r.data.paymentId;
  ok(!!paymentId, "paymentId returned");
  ok(String((r.data && r.data.paymentUrl) || "").includes("method=bank_transfer"), "paymentUrl points back to checkout");
}

/* ---------- 9. deal resume (checkout return path) ---------- */
console.log("\n8. Deal resume");
{
  const r = await req("GET", "/lead/" + encodeURIComponent(ctx.ref), null, ctx);
  const q = r.data && r.data.quotes && r.data.quotes[0];
  const i = r.data && r.data.invoices && r.data.invoices[0];
  const p = r.data && r.data.payments && r.data.payments[0];
  eq(r.data && r.data.status, "invoiced", "assessment status = invoiced");
  eq(q && q.status, "invoiced", "quote status = invoiced");
  eq(i && i.status, "unpaid", "invoice status = unpaid");
  eq(p && p.status, "pending", "payment status = pending");
}

/* ---------- 10. audit trail ---------- */
console.log("\n9. Audit trail");
{
  const r = await req("GET", "/audit", null, ctx);
  ok(r.status === 200 && Array.isArray(r.data), "GET /audit → array (got " + r.status + ")");
  const events = Array.isArray(r.data) ? r.data : [];
  ok(events.length >= 4, "audit recorded the flow (" + events.length + " events)");
  ok(events.every((e) => e.event && e.entityType), "events carry action + entityType");
}

/* ---------- results ---------- */
console.log("\n------------------------------");
console.log("Passed: " + passed + " · Failed: " + failed);
if (failed) {
  console.error("SMOKE TEST FAILED");
  process.exit(1);
}
console.log("Smoke test passed ✓  (lead " + ctx.ref + " left in the pipeline)");

/* ---------- optional cleanup ---------- */
if (CLEANUP) {
  if (!ACCESS_TOKEN || !PROJECT_REF) {
    console.error("--cleanup needs SUPABASE_ACCESS_TOKEN and a resolvable project ref.");
    process.exit(2);
  }
  const sql = `WITH d_pay AS (
      DELETE FROM public.payments WHERE invoice_id IN (
        SELECT i.id FROM public.invoices i
        JOIN public.quotes q ON q.id = i.quote_id
        WHERE q.assessment_id = '${a.assessmentId}'
      ) RETURNING id
    ), d_inv AS (
      DELETE FROM public.invoices WHERE quote_id IN (
        SELECT id FROM public.quotes WHERE assessment_id = '${a.assessmentId}'
      ) RETURNING id
    ), d_q AS (
      DELETE FROM public.quotes WHERE assessment_id = '${a.assessmentId}' RETURNING id
    ), d_a AS (
      DELETE FROM public.agm_assessments WHERE id = '${a.assessmentId}' RETURNING id
    ) SELECT (SELECT count(*) FROM d_pay) AS payments,
             (SELECT count(*) FROM d_inv) AS invoices,
             (SELECT count(*) FROM d_q) AS quotes,
             (SELECT count(*) FROM d_a) AS assessments;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + ACCESS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const out = await res.text();
  if (res.ok) console.log("Cleanup: " + out);
  else console.error("Cleanup failed (" + res.status + "): " + out);
}
