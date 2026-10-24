#!/usr/bin/env node
/* ============================================================
   AGMX — Money-flow tests against a LIVE PocketBase (Sprint 2)

   Exercises pb_hooks/money_flow.pb.js (+ money_flow.lib.js) over HTTP:
   public lead capture with server-side scoring, token-gated access,
   server-priced quotes, acceptance, NET-14 invoices, simulated and
   pending payments, double-payment guard, operator-only inbox with
   real metrics, payment confirmation, and SHA-256 audit-chain
   verification against node:crypto.

   ⚠ DESTRUCTIVE: wipes agm_assessments / quotes / invoices / payments /
     audit_events at startup so every run is deterministic. Point it at a
     dev instance only — never at production data.

   Prerequisites (see pocketbase/README.md):
     1. PocketBase v0.22.x serving with the repo's pb_hooks loaded:
          AGMX_ALLOW_SIMULATED_PAYMENTS=1 ./pocketbase serve \
            --hooksDir=$PWD/pb_hooks
     2. Schema applied:  python3 tools/pb_migrate.py --url … --email … --password …
     3. Run:
          node tools/test_money_flow_pb.mjs --url http://127.0.0.1:8090 \
            --email admin@agmx.test --password <superuser-password>

   No dependencies beyond Node ≥ 18 (fetch + crypto).
   ============================================================ */
import crypto from "node:crypto";

/* ---------- args ---------- */
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const BASE = arg("url", "http://127.0.0.1:8090").replace(/\/+$/, "");
const ADMIN_EMAIL = arg("email", "admin@agmx.test");
const ADMIN_PASSWORD = arg("password", "");
if (!ADMIN_PASSWORD) {
  console.error("Usage: node tools/test_money_flow_pb.mjs --url URL --email ADMIN --password PASS");
  process.exit(2);
}

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

/* ---------- http helpers ---------- */
async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error("PocketBase tidak dapat dihubungi (" + BASE + "): " + e.message);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  return { status: res.status, data };
}
const post = (p, b, t) => req("POST", p, b, t);
const get = (p, t) => req("GET", p, null, t);

/* admin auth — v0.23+ first, v0.22 fallback (same order as pb_migrate.py) */
async function adminAuth(email, password) {
  for (const p of [
    "/api/collections/_superusers/auth-with-password",
    "/api/admins/auth-with-password",
    "/api/collections/_admins/auth-with-password",
  ]) {
    const r = await post(p, { identity: email, password });
    if (r.status === 200 && r.data && r.data.token) return r.data.token;
  }
  throw new Error("Admin auth failed — wrong --email/--password or unmigrated instance?");
}

console.log("\nAGMX Money Flow — LIVE PocketBase (" + BASE + ")\n=============================================\n");

/* ---------- wipe money-flow data for a deterministic run ---------- */
async function wipe(adminToken) {
  for (const name of ["audit_events", "payments", "invoices", "quotes", "agm_assessments"]) {
    for (;;) {
      const page = await get(`/api/collections/${name}/records?perPage=200`, adminToken);
      const items = (page.data && page.data.items) || [];
      if (!items.length) break;
      for (const it of items) {
        await req("DELETE", `/api/collections/${name}/records/${it.id}`, null, adminToken);
      }
    }
  }
}

/* ---------- 0. health + admin ---------- */
const health = await get("/api/health");
ok(health.status === 200, "PocketBase is healthy");
const admin = await adminAuth(ADMIN_EMAIL, ADMIN_PASSWORD);
ok(!!admin, "superuser authenticated");
await wipe(admin);
ok(true, "money-flow collections wiped (deterministic run)");

/* ---------- 1. operator user (users.role + users.organizationId) ---------- */
/* Ensure the users auth collection carries the AGMX role/tenancy fields
   (GOOGLE_AUTH_SETUP.md binds them per auth record), then create/refresh
   an operator user tied to the AGMX money-flow org. */
{
  const colRes = await get("/api/collections/users", admin);
  const users = colRes.data;
  /* PocketBase 0.23 renamed Collection.schema -> Collection.fields, and the
     collections API only accepts `fields` on write. Reading `.schema` on
     0.40 yields undefined, which made this block send an empty patch that
     the server accepted with 200 while silently adding nothing. */
  const FIELD_KEY = users.fields ? "fields" : "schema";
  const have = (users[FIELD_KEY] || []).map((f) => f.name);
  if (!have.includes("role") || !have.includes("organizationId")) {
    const orgsCol = await get("/api/collections/organizations", admin);
    const fields = (users[FIELD_KEY] || []).slice();
    if (!have.includes("role")) fields.push({ name: "role", type: "text" });
    if (!have.includes("organizationId")) {
      /* PocketBase 0.40 reads relation properties flat (collectionId/maxSelect
         as siblings of `type`). Nesting them under `options` validates the
         field as present but leaves options.collectionId blank, so the server
         rejects the whole collection with "collectionId: Cannot be blank." */
      fields.push({
        name: "organizationId", type: "relation",
        collectionId: orgsCol.data.id, cascadeDelete: false,
        minSelect: 0, maxSelect: 1,
      });
    }
    const patched = await req("PATCH", "/api/collections/users", { [FIELD_KEY]: fields }, admin);
    ok(patched.status === 200, "users collection extended with role + organizationId");
    /* 0.40 answers 200 even for an ignored unknown key — verify, don't trust. */
    const after = await get("/api/collections/users", admin);
    const afterFields = (after.data[FIELD_KEY] || []).map((f) => f.name);
    ok(afterFields.includes("role") && afterFields.includes("organizationId"),
      "users collection actually carries role + organizationId");
  } else {
    ok(true, "users collection already has role + organizationId");
  }
}

/* trigger operator-org auto-creation via one public submission */
const seedLead = await post("/api/agmx/assessment", {
  assessment: {
    coopName: "Koperasi Bootstrap", members: 100, mode: "physical",
    attendance: 40, candidates: 2, motions: 3, process: "manual", managed: false,
    contactName: "Setup", contactPhone: "010-0000000",
  },
});
ok(seedLead.status === 200 && /^LD-\d{4}$/.test(seedLead.data.lead.id),
  "public assessment accepted → " + (seedLead.data.lead && seedLead.data.lead.id));
ok(!!seedLead.data.lead.checkoutToken, "checkout token issued once at submission");

const orgsRes = await get('/api/collections/organizations/records?filter=' +
  encodeURIComponent('slug="agmx-ops"'), admin);
const opOrg = orgsRes.data.items[0];
ok(!!opOrg, "operator org auto-created by the hook (agmx-ops)");

const OP_EMAIL = "operator-" + Date.now().toString(36) + "@agmx.test";
const OP_PASSWORD = "op-test-" + Date.now().toString(36);
const mkUser = await post("/api/collections/users/records", {
  email: OP_EMAIL, password: OP_PASSWORD, passwordConfirm: OP_PASSWORD,
  role: "admin", organizationId: opOrg.id, name: "Operator Ujian",
}, admin);
ok(mkUser.status === 200, "operator user created (role=admin, org=agmx-ops)");

const opAuth = await post("/api/collections/users/auth-with-password",
  { identity: OP_EMAIL, password: OP_PASSWORD });
const opToken = opAuth.data && opAuth.data.token;
ok(!!opToken, "operator authenticated via users collection");

/* ---------- 2. server-side scoring beats tampered input ---------- */
let lead;
{
  const r = await post("/api/agmx/assessment", {
    assessment: {
      coopName: "Koperasi Ujian Berhad", coopReg: "KPM-999/2026", state: "Selangor",
      members: 1284, agmDate: "2026-11-14", mode: "hybrid",
      attendance: 403, candidates: 8, motions: 12, process: "mixed", managed: true,
      /* client lies about score + package — server must recompute */
      score: 1, pkgKey: "essential", pkgName: "Cheap Plan", pkgPrice: 1,
      contactName: "Pn. Aishah Rahman", contactPhone: "012-3456789",
      contactEmail: "aishah@ujian.my",
    },
  });
  eq(r.status, 200, "assessment submission → 200");
  lead = r.data.lead;
  eq(lead.score, 78, "server recomputed complexity score = 78 (client sent 1)");
  eq(lead.pkgKey, "enterprise", "server-derived package = enterprise (score ≥ 65)");
  eq(lead.pkgPrice, 7500, "package price from plans collection = 7500 (client sent 1)");
  eq(lead.stage, "Assessment Diterima", "initial stage = Assessment Diterima");
  ok(/^LD-\d{4}$/.test(lead.id), "lead reference format LD-xxxx → " + lead.id);
}
const T = lead.checkoutToken;

/* ---------- 3. token gating ---------- */
{
  const wrong = await get("/api/agmx/lead?ref=" + lead.id + "&t=nope");
  eq(wrong.status, 403, "wrong checkout token → 403");
  const none = await get("/api/agmx/lead?ref=" + lead.id);
  eq(none.status, 403, "missing token (anonymous) → 403");
  const right = await get("/api/agmx/lead?ref=" + lead.id + "&t=" + T);
  eq(right.status, 200, "valid token → 200");
  eq(right.data.deal.lead.coopName, "Koperasi Ujian Berhad", "lead payload served to token holder");
  const opView = await get("/api/agmx/lead?ref=" + lead.id, opToken);
  eq(opView.status, 200, "operator may view any lead without token");
}

/* ---------- 4. server-priced quote ---------- */
let quote;
{
  const r = await post("/api/agmx/quote?t=" + T, {
    ref: lead.id, packageKey: "enterprise", addons: ["facilitator"],
    /* client-proposed items must be ignored entirely */
    items: [{ description: "hack", qty: 1, unitPrice: 1 }],
  });
  eq(r.status, 200, "quote creation → 200");
  quote = r.data.quote;
  ok(/^QT-\d{4}-\d{3}$/.test(quote.number), "server-minted number QT-YYYY-NNN → " + quote.number);
  eq(quote.subtotal, 8300, "subtotal = 7500 (plans) + 800 (rate card), client items ignored");
  eq(quote.tax, 664, "SST 8% = 664.00");
  eq(quote.total, 8964, "total = 8964.00");
  eq(quote.status, "sent", "self-serve quote status = sent");

  const bad = await post("/api/agmx/quote?t=" + T, { ref: lead.id, addons: ["gold_plated"] });
  ok(bad.status >= 400, "unknown add-on rejected");
  const again = await post("/api/agmx/quote?t=" + T, { ref: lead.id });
  eq(again.data.quote.number, quote.number, "quote creation is idempotent (one live quote per lead)");
}

/* ---------- 5. accept → invoice (NET 14) ---------- */
let invoice;
{
  const a = await post("/api/agmx/quote/accept?t=" + T, { ref: lead.id, number: quote.number });
  eq(a.status, 200, "accept → 200");
  eq(a.data.quote.status, "accepted", "quote status = accepted");

  const before = await post("/api/agmx/invoice?t=" + T, { ref: "LD-0000", quoteNumber: "QT-1999-001" });
  ok(before.status >= 400, "invoice for unknown quote rejected");

  const r = await post("/api/agmx/invoice?t=" + T, { ref: lead.id, quoteNumber: quote.number });
  eq(r.status, 200, "invoice creation → 200");
  invoice = r.data.invoice;
  ok(/^INV-\d{4}-\d{3}$/.test(invoice.number), "server-minted number INV-YYYY-NNN → " + invoice.number);
  eq(invoice.amount, 8964, "invoice amount = quote total");
  eq(invoice.status, "unpaid", "invoice starts unpaid");
  const days = Math.round((new Date(invoice.dueAt) - new Date(invoice.issuedAt)) / 864e5);
  eq(days, 14, "payment terms = NET 14 days");
}

/* ---------- 6. payment: simulated fpx + double-pay guard ---------- */
{
  const r = await post("/api/agmx/payment?t=" + T, {
    ref: lead.id, invoiceNumber: invoice.number, method: "fpx",
  });
  eq(r.status, 200, "fpx payment → 200");
  eq(r.data.payment.status, "succeeded",
    "fpx settles instantly ONLY because AGMX_ALLOW_SIMULATED_PAYMENTS=1");
  eq(r.data.invoice.status, "paid", "invoice marked paid");

  const twice = await post("/api/agmx/payment?t=" + T, {
    ref: lead.id, invoiceNumber: invoice.number, method: "card",
  });
  eq(twice.status, 400, "double payment rejected server-side (400)");
}

/* ---------- 7. bank transfer stays pending until operator confirms ---------- */
let lead2, invoice2, pendingPay;
{
  const r = await post("/api/agmx/assessment", {
    assessment: {
      coopName: "Koperasi Kedua Berhad", state: "Johor", members: 250,
      mode: "physical", attendance: 80, candidates: 0, motions: 0,
      process: "manual", managed: false,
      contactName: "En. Tan", contactPhone: "019-8887777",
    },
  });
  lead2 = r.data.lead;
  const T2 = lead2.checkoutToken;
  const q2 = (await post("/api/agmx/quote?t=" + T2, { ref: lead2.id })).data.quote;
  eq(q2.total, 3780, "lead2 priced from server-derived package (3500 + SST = 3780)");
  await post("/api/agmx/quote/accept?t=" + T2, { ref: lead2.id, number: q2.number });
  invoice2 = (await post("/api/agmx/invoice?t=" + T2, { ref: lead2.id, quoteNumber: q2.number })).data.invoice;

  const p = await post("/api/agmx/payment?t=" + T2, {
    ref: lead2.id, invoiceNumber: invoice2.number, method: "bank_transfer",
  });
  eq(p.status, 200, "bank transfer recorded → 200");
  eq(p.data.payment.status, "pending", "bank transfer → pending verification");
  eq(p.data.invoice.status, "unpaid", "invoice stays unpaid until verified");
  pendingPay = p.data.payment;

  /* anonymous cannot see the operator inbox */
  const anon = await get("/api/agmx/deals");
  eq(anon.status, 403, "GET /deals anonymous → 403");
}

/* ---------- 8. operator inbox: real metrics, confirmation ---------- */
{
  const deals = await get("/api/agmx/deals", opToken);
  eq(deals.status, 200, "operator GET /deals → 200");
  const m = deals.data.metrics;
  eq(m.leads, 3, "metrics: 3 leads (bootstrap + 2 test)");
  eq(m.quoted, 2, "metrics: 2 quoted");
  eq(m.paid, 1, "metrics: 1 paid (fpx)");
  eq(m.collectedValue, 8964, "metrics: collected = 8964.00 (server-computed, not zeros)");

  const conf = await post("/api/agmx/payment/confirm", { paymentId: pendingPay.pbId }, opToken);
  eq(conf.status, 200, "operator confirms pending transfer → 200");
  eq(conf.data.payment.status, "succeeded", "payment now succeeded");

  const after = await get("/api/agmx/deals", opToken);
  eq(after.data.metrics.paid, 2, "metrics: 2 paid after confirmation");
  eq(after.data.metrics.collectedValue, 12744, "metrics: collected = 8964 + 3780 = 12744.00");

  /* outsider operator (different org) must not reach the inbox */
  const stageNoAuth = await post("/api/agmx/lead/stage", { ref: seedLead.data.lead.id, stage: "Dihubungi" });
  eq(stageNoAuth.status, 403, "stage change without operator auth → 403");
  const stage = await post("/api/agmx/lead/stage", { ref: seedLead.data.lead.id, stage: "Dihubungi" }, opToken);
  eq(stage.status, 200, "operator stage change → 200");
  eq(stage.data.lead.stage, "Dihubungi", "stage persisted");
  const docStage = await post("/api/agmx/lead/stage", { ref: seedLead.data.lead.id, stage: "Dibayar" }, opToken);
  eq(docStage.status, 400, "document-driven stage cannot be forced manually");
}

/* ---------- 9. audit trail + SHA-256 chain verification ---------- */
{
  const r = await get("/api/agmx/audit?ref=" + lead.id + "&t=" + T);
  eq(r.status, 200, "token holder reads own audit trail");
  const events = r.data.events.map((e) => e.event);
  const seq = events.slice().reverse();
  const expected = ["assessment.submitted", "quote.created", "quote.accepted", "invoice.created", "payment.succeeded"];
  eq(seq.filter((e) => expected.includes(e)), expected,
    "audit trail records the full sequence for the lead");

  /* recompute the hash chain straight from the stored records.
     Walk the prevHash links (occurredAt is second-precision, so storage
     order alone is not reliable); every row must be consumed exactly
     once — a broken/edited link orphans the rest of the chain. */
  const raw = await get("/api/collections/audit_events/records?perPage=200", admin);
  const rows = raw.data.items;
  ok(rows.length >= 9, "audit_events stored server-side (" + rows.length + " rows)");
  const byPrev = new Map();
  for (const ev of rows) {
    if (byPrev.has(ev.prevHash)) { byPrev.set(ev.prevHash, null); } // ambiguous → fail below
    else byPrev.set(ev.prevHash, ev);
  }
  let chainOk = true, walked = 0, prevHash = "GENESIS";
  while (true) {
    const ev = byPrev.get(prevHash);
    if (!ev) break;
    const occurredAt = String(ev.occurredAt).slice(0, 19);   // as hashed by the hook
    const material = [prevHash, occurredAt, ev.action, ev.entityType, ev.entityId,
      JSON.stringify(ev.payload || {})].join("|");
    const want = crypto.createHash("sha256").update(material, "utf8").digest("hex");
    if (ev.hash !== want) { chainOk = false; break; }
    prevHash = ev.hash;
    walked++;
  }
  ok(chainOk && walked === rows.length,
    "hash chain walks GENESIS→tip over all " + rows.length + " events, every hash recomputes (tamper-evident)");
}

/* ---------- result ---------- */
console.log("\n------------------------------");
console.log("Passed: " + passed + " · Failed: " + failed);
if (failed > 0) { console.error("LIVE MONEY-FLOW TESTS FAILED\n"); process.exit(1); }
console.log("All live money-flow tests passed ✓\n");
