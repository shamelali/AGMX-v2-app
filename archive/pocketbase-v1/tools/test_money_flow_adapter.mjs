#!/usr/bin/env node
/* ============================================================
   AGMX — Money-flow ADAPTER tests against a LIVE PocketBase

   Complements tools/test_money_flow_pb.mjs (raw HTTP endpoints):
   this suite drives the real PocketBaseAdapter inside api.js — the
   exact code path the browser pages use — against the pb_hooks
   money-flow routes: config resolution, status chip, prospect flow
   with setLeadContext token, operator session via the pb_token key
   (the one pocketbase-client.js writes), normalised shapes, metrics,
   audit feed and stage updates.

   ⚠ DESTRUCTIVE: wipes money-flow collections first. Dev instances only.

   Usage:
     node tools/test_money_flow_adapter.mjs            # repo root implicit
   Prereqs: same as tools/test_money_flow_pb.mjs (migrated instance,
   superuser admin@agmx.test or adjust below, hooks running with
   AGMX_ALLOW_SIMULATED_PAYMENTS=1).
   ============================================================ */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const BASE = "http://127.0.0.1:8090";
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
mem.set("agmx_backend_cfg", JSON.stringify({ mode: "pocketbase", url: BASE }));

let passed = 0, failed = 0;
const ok = (c, l) => { c ? (passed++, console.log("  ✓ " + l)) : (failed++, console.error("  ✗ " + l)); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), l + (JSON.stringify(a) !== JSON.stringify(b) ? ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})` : ""));

const post = async (p, b, t) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: t } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const get = async (p, t) => {
  const r = await fetch(BASE + p, { headers: t ? { Authorization: t } : {} });
  return { status: r.status, data: await r.json().catch(() => null) };
};

console.log("\nAGMX — PocketBaseAdapter (api.js) ↔ live hooks\n==============================================\n");

// admin token + wipe money-flow rows for determinism
// PocketBase renamed the admin collection: v0.22 used /api/admins, v0.23+
// uses /api/collections/_superusers. Try each so the suite runs on both.
async function adminAuth() {
  const body = { identity: "admin@agmx.test", password: "agmx-test-12345" };
  for (const p of [
    "/api/collections/_superusers/auth-with-password",
    "/api/admins/auth-with-password",
    "/api/collections/_admins/auth-with-password",
  ]) {
    const r = await post(p, body);
    const token = r.data && r.data.token;
    if (r.status === 200 && token) return token;
  }
  throw new Error("admin auth failed — pass a reachable PocketBase with --url");
}
const admin = await adminAuth();
for (const name of ["audit_events", "payments", "invoices", "quotes", "agm_assessments"]) {
  for (;;) {
    const page = await get(`/api/collections/${name}/records?perPage=200`, admin);
    const items = page.data.items || [];
    if (!items.length) break;
    for (const it of items) await fetch(`${BASE}/api/collections/${name}/records/${it.id}`, { method: "DELETE", headers: { Authorization: admin } });
  }
}

const API = require(process.argv[2] || path.join(here, "..", "api.js"));

// --- adapter in pocketbase mode ---
const st = await API.status();
eq(st.mode, "pocketbase", "status().mode = pocketbase");
ok(st.ok && st.label === "PocketBase Live", "status() healthy → " + st.label);

// --- prospect flow, adapter-driven ---
const lead = await API.submitAssessment({
  coopName: "Koperasi Adapter Berhad", coopReg: "KPM-1/2026", state: "Perak",
  members: 950, agmDate: "2026-12-01", mode: "hybrid", attendance: 300,
  candidates: 5, motions: 8, process: "mixed", managed: true,
  score: 10, pkgKey: "essential", pkgPrice: 1,       // tampered — server recomputes
  contactName: "Cik Adapter", contactPhone: "011-1112222", contactEmail: "a@a.my",
});
ok(/^LD-\d{4}$/.test(lead.id), "submitAssessment → " + lead.id);
eq(lead.score, 67, "server-recomputed score = 67 (950→15, hybrid→12, ratio .316→10, cand 5→8, motions 8→6, mixed→6, managed→10)");
ok(!!lead.checkoutToken, "checkoutToken issued");
API.setLeadContext(lead.id, lead.checkoutToken);

const deal0 = await API.getDeal(lead.id);
eq(deal0.lead.id, lead.id, "getDeal returns the lead");
eq(deal0.quote, null, "no quote yet");

const quote = await API.createQuote({ leadRef: lead.id, packageKey: lead.pkgKey, addons: ["translate"] });
ok(/^QT-\d{4}-\d{3}$/.test(quote.number), "adapter createQuote → " + quote.number);
eq(quote.currency, "MYR", "currency MYR");

const accepted = await API.acceptQuote(quote.number);
eq(accepted.status, "accepted", "adapter acceptQuote → accepted");

const invoice = await API.createInvoice(quote.number);
ok(/^INV-\d{4}-\d{3}$/.test(invoice.number), "adapter createInvoice → " + invoice.number);
eq(invoice.status, "unpaid", "invoice unpaid");

// --- anonymous cannot see operator inbox ---
let threw = false;
try { await API.listDeals(); } catch (e) { threw = /log masuk/i.test(e.message); }
ok(threw, "listDeals without operator session throws a helpful BM error");

// --- operator session ---
const orgR = await get('/api/collections/organizations/records?filter=' + encodeURIComponent('slug="agmx-ops"'), admin);
const orgId = orgR.data.items[0].id;
const opEmail = "adapter-op-" + Date.now().toString(36) + "@agmx.test";
await post("/api/collections/users/records", { email: opEmail, password: "adapter-pass-123", passwordConfirm: "adapter-pass-123", role: "secretary", organizationId: orgId, name: "Op Adapter" }, admin);
const opR = await post("/api/collections/users/auth-with-password", { identity: opEmail, password: "adapter-pass-123" });
mem.set("pb_token", opR.data.token);   // same key pocketbase-client.js uses

const deals = await API.listDeals();
eq(deals.length, 1, "operator listDeals → 1 deal");
eq(deals[0].lead.stage, "Sebut Harga Diterima", "stage derived from accepted quote");
const m = await API.metrics();
eq(m.leads, 1, "metrics.leads = 1");
eq(m.quoted, 1, "metrics.quoted = 1");
ok(m.pipelineValue > 0, "metrics.pipelineValue computed server-side (" + m.pipelineValue + ")");

// --- payment through the adapter (simulated fpx) ---
const pay = await API.payInvoice(invoice.number, { method: "fpx" });
eq(pay.status, "succeeded", "fpx settled (AGMX_ALLOW_SIMULATED_PAYMENTS=1)");
eq(pay.methodLabel, "FPX (Perbankan Dalam Talian)", "methodLabel normalised");
const m2 = await API.metrics();
eq(m2.collectedValue, invoice.amount, "collected = invoice amount (" + invoice.amount + ")");

// --- audit through the adapter ---
const events = await API.audit(lead.id);
const names = events.map((e) => e.event).reverse();
eq(names, ["assessment.submitted", "quote.created", "quote.accepted", "invoice.created", "payment.succeeded"], "adapter audit() returns the chain");

// --- stage update through the adapter ---
await API.updateLeadStage(lead.id, "Dihubungi").catch(() => {});
const st2 = await API.updateLeadStage(lead.id, "AGM Dijadualkan");
eq(st2.stage, "AGM Dijadualkan", "updateLeadStage → AGM Dijadualkan");

console.log("\n------------------------------");
console.log("Passed: " + passed + " · Failed: " + failed);
process.exit(failed ? 1 : 0);
