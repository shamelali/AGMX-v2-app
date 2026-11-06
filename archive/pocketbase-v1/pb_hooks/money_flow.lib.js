/* ============================================================
   AGMX — Money Flow hooks (Sprint 2, PocketBase v0.22 JSVM)
   ------------------------------------------------------------
   Server-side home of the quote → invoice → payment flow that
   PR #5 prototyped as Supabase RPCs. Every commercial invariant
   lives HERE, not in the browser:

     * pricing is recomputed from the `plans` collection + the
       rate card below — client-sent prices are ignored
     * document numbers (LD-/QT-/INV-) are minted server-side,
       so two browsers can never collide
     * double-payment guard runs inside a transaction
     * audit_events are appended with a SHA-256 hash chain
       (same material format as pocketbase-client.js appendAudit)

   Access model
     * POST /api/agmx/assessment            — public lead capture
     * money-flow reads/writes for one lead — gated by an unguessable
       checkout token (?t=…) minted at submission, OR operator auth
     * /deals, /audit (all), /lead/stage, /payment/confirm
                                            — operator only
       (users.role = admin|secretary of the AGMX operator org)

   Environment (PB process env)
     AGMX_OPERATOR_ORG              slug or id of the org that owns the
                                    money flow (default: "agmx-ops",
                                    auto-created on first use)
     AGMX_ALLOW_SIMULATED_PAYMENTS  "1" lets fpx/card settle instantly
                                    (demo instances ONLY — default is
                                    pending until /payment/confirm,
                                    which is also the gateway-webhook
                                    landing zone in production)

   Client surface: PocketBaseAdapter in /api.js

   IMPORTANT (PocketBase v0.22 JSVM): route handlers are re-evaluated
   per request in a pooled runtime and CANNOT see file-level scope of
   the .pb.js file. All logic therefore lives in this module and is
   pulled in with require(__hooks + "/money_flow.lib.js") — the
   .pb.js file only registers thin, self-contained handlers.
   ============================================================ */
/* global $app, $apis, $security, $os, Record, DateTime, BadRequestError, NotFoundError, ForbiddenError, routerAdd */

/* ---------- constants ---------- */

var SST_RATE = 8;                 // % — mirrors api.js TAX_RATE (0.08)
var QUOTE_VALID_DAYS = 30;
var INVOICE_DUE_DAYS = 14;

/* Rate card — add-ons are NOT in the plans collection; this table is the
   single server-side source of truth. Mirror in checkout.js is display-only. */
var ADDONS = {
  facilitator: { label: "Fasilitator AGM Tambahan", price: 800 },
  translate:   { label: "Penterjemahan Simultan BM ⇄ EN", price: 1200 },
  printpack:   { label: "Pek Mesyuarat Dicetak & Dihantar", price: 600 },
};

/* assessment pkgKey → plans.code (seed.json) */
var PKG_CODES = {
  essential: "essential_agm",
  professional: "professional_agm",
  enterprise: "enterprise_agm",
};
var PKG_FALLBACK = {
  essential_agm: { name: "AGMX Essential AGM", price: 1500 },
  professional_agm: { name: "AGMX Professional AGM", price: 3500 },
  enterprise_agm: { name: "AGMX Enterprise AGM", price: 7500 },
};

/* BM pipeline label ↔ agm_assessments.status */
var STATUS_TO_STAGE = {
  lead: "Assessment Diterima",
  contacted: "Dihubungi",
  quoted: "Sebut Harga Dihantar",
  won: "Dibayar",
  scheduled: "AGM Dijadualkan",
  lost: "Ditutup",
};
/* manual (operator) stage moves only — document-driven stages
   (Sebut Harga Diterima / Dibayar) are derived, never set directly */
var STAGE_TO_STATUS = {
  "Dihubungi": "contacted",
  "AGM Dijadualkan": "scheduled",
  "Ditutup": "lost",
  "Assessment Diterima": "lead",
};

var PAYMENT_METHODS = { fpx: 1, card: 1, bank_transfer: 1, billplz: 1 };
var METHOD_LABELS = {
  fpx: "FPX (Perbankan Dalam Talian)",
  card: "Kad Kredit / Debit",
  bank_transfer: "Pemindahan Bank (Manual)",
  billplz: "Billplz (FPX / Kad / E-Wallet)",
};

/* ---------- tiny helpers ---------- */

function env(name, dflt) {
  try {
    var v = $os.getenv(name);
    return v === "" || v === null || v === undefined ? dflt : v;
  } catch (e) {
    return dflt;
  }
}

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

/* UTC "YYYY-MM-DD HH:mm:ss" — the format PB parses for date fields */
function pbDateStr(d) { return d.toISOString().slice(0, 19).replace("T", " "); }
function pbNow() { return pbDateStr(new Date()); }
function pbAddDays(days) {
  var d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  return pbDateStr(d);
}
/* read a date field defensively (DateTime.String()/ISO both start YYYY-MM-DD HH:mm:ss) */
function dateOf(rec, field) {
  var v = rec.get(field);
  if (!v) return null;
  var s = String(v);
  if (!s || s.indexOf("0001-01-01") === 0) return null;
  return s.slice(0, 19);
}
function isoOf(rec, field) {
  var s = dateOf(rec, field);
  return s ? s.replace(" ", "T") + "Z" : null;
}
function jsDate(pbStr) { return pbStr ? new Date(pbStr.replace(" ", "T") + "Z") : null; }

/* ---------- SHA-256 (pure JS — goja has no WebCrypto) ----------
   Chain material format matches pocketbase-client.js appendAudit():
   prevHash|occurredAt|action|entityType|entityId|JSON(payload)       */
function sha256Hex(msg) {
  function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
  var K = sha256Hex.K;
  if (!K) {
    K = sha256Hex.K = [];
    var primes = [
      2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
      73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151,
      157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233,
      239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311,
    ];
    for (var pi = 0; pi < 64; pi++) {
      K[pi] = (Math.pow(primes[pi], 1 / 3) * 4294967296) | 0;
    }
  }
  var H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  var bytes = [];
  for (var ci = 0; ci < msg.length; ci++) {
    var c = msg.charCodeAt(ci);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0);
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  var w = new Array(64);
  for (var off = 0; off < bytes.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      w[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) |
             (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
    }
    for (t = 16; t < 64; t++) {
      var s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (t = 0; t < 64; t++) {
      var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var tmp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      var maj = (a & b) ^ (a & cc) ^ (b & cc);
      var tmp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + tmp1) | 0;
      d = cc; cc = b; b = a; a = (tmp1 + tmp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = "";
  for (var hi = 0; hi < 8; hi++) {
    out += ("00000000" + (H[hi] >>> 0).toString(16)).slice(-8);
  }
  return out;
}

/* ---------- scoring model (mirror of assessment.js FACTORS) ----------
   Recomputed here so the client cannot inflate/deflate its own score
   to land in a cheaper package. */
function computeScore(a) {
  var members = Number(a.members) || 0;
  var ratio = members > 0 ? (Number(a.attendance) || 0) / members : 0;
  var factors = [];
  var total = 0;
  function add(label, max, pts) { factors.push({ key: label, label: label, max: max, points: pts }); total += pts; }
  add("members", 30, members < 300 ? 5 : members < 1000 ? 15 : members < 2000 ? 22 : 30);
  add("mode", 12, ({ physical: 4, online: 9, hybrid: 12 })[a.mode] || 4);
  add("attendance", 16, ratio < 0.3 ? 5 : ratio <= 0.5 ? 10 : 16);
  add("candidates", 12, (Number(a.candidates) || 0) < 1 ? 2 : a.candidates <= 3 ? 4 : a.candidates <= 7 ? 8 : 12);
  add("motions", 10, (Number(a.motions) || 0) <= 5 ? 3 : a.motions <= 15 ? 6 : 10);
  add("process", 10, ({ digital: 3, mixed: 6, manual: 10 })[a.process] || 6);
  add("managed", 10, a.managed ? 10 : 2);
  return { total: Math.min(100, total), factors: factors };
}

function packageForScore(score) {
  if (score <= 34) return "essential";
  if (score <= 64) return "professional";
  return "enterprise";
}

/* ---------- record helpers ---------- */
//
// Ported from PocketBase 0.22 to 0.40. Four APIs changed in 0.23:
//
//   0.22                                   0.40
//   ------------------------------------  --------------------------------
//   $app.dao()                            $app            (DAO flattened)
//   dao.saveRecord(rec)                    dao.save(rec)
//   $apis.requestInfo(c).data / .body      c.requestInfo().body
//   c.queryParam("ref")                    c.requestInfo().query.ref
//   Collection.schema                      Collection.fields
//
// findCollectionByNameOrId, findRecordsByFilter, findFirstRecordByFilter,
// findRecordById and runInTransaction kept their names and signatures.

function col(dao, name) { return dao.findCollectionByNameOrId(name); }

function hasField(collection, name) {
  try {
    /* PocketBase 0.23 renamed Collection.schema to Collection.fields. In 0.40
       `fields` is a plain array whose entries expose `.name`; some builds hand
       back a named Go slice instead, which needs getFieldByName(). Both shapes
       are handled. There is deliberately no Collection.schema fallback: the
       rest of this file is 0.40-only ($app.save, c.requestInfo(), Record.id),
       so a pre-0.23 fallback here could never actually be reached. */
    var s = collection.fields;
    if (!s) return false;
    if (typeof s.getFieldByName === "function") return !!s.getFieldByName(name);
    if (typeof s.length === "number") {
      for (var i = 0; i < s.length; i++) {
        if (s[i] && String(s[i].name) === name) return true;
      }
    }
  } catch (e) { /* fall through */ }
  return false;
}

/* newest matching record — findFirstRecordByFilter has NO sort parameter
   in v0.22, so sorted lookups go through findRecordsByFilter */
function findLatest(dao, collection, filter, sort, params) {
  try {
    var rows = dao.findRecordsByFilter(collection, filter, sort, 1, 0, params);
    return rows && rows.length ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

function findPlan(dao, code) {
  try {
    return dao.findFirstRecordByFilter("plans", "code={:code}", { code: code });
  } catch (e) {
    return null;
  }
}

/* The AGMX operator organisation owns every money-flow record (tenancy).
   Resolved from AGMX_OPERATOR_ORG (slug or id), default slug "agmx-ops",
   auto-created once so a fresh demo instance works out of the box. */
function ensureOperatorOrg(dao) {
  var key = env("AGMX_OPERATOR_ORG", "agmx-ops");
  var org = null;
  try { org = dao.findRecordById("organizations", key); } catch (e) { org = null; }
  if (!org) {
    try { org = dao.findFirstRecordByFilter("organizations", "slug={:s}", { s: key }); } catch (e) { org = null; }
  }
  if (org) return org;
  var rec = new Record(col(dao, "organizations"));
  rec.set("name", "AGMX Operations");
  rec.set("shortName", "AGMX");
  rec.set("slug", "agmx-ops");
  rec.set("type", "partner");
  rec.set("status", "active");
  rec.set("plan", "unlimited");
  rec.set("founded", String(new Date().getFullYear()));
  dao.save(rec);
  return rec;
}

/* Tamper-evident audit append — same chain material as
   pocketbase-client.js appendAudit() so both writers verify. */
function appendAudit(dao, orgId, actor, action, entityType, entityId, payload, leadRef) {
  var prev = findLatest(dao, "audit_events", "organizationId={:o}", "-occurredAt", { o: orgId });
  var prevHash = prev ? String(prev.get("hash") || "GENESIS") : "GENESIS";
  /* second precision, stored EXACTLY as hashed so the chain is
     recomputable from the record (pbNow → "YYYY-MM-DD HH:mm:ss" UTC) */
  var occurredAt = pbNow();
  var pl = payload || {};
  if (leadRef && !pl.lead) pl.lead = leadRef;
  var material = prevHash + "|" + occurredAt + "|" + action + "|" + entityType + "|" + entityId + "|" + JSON.stringify(pl);
  var rec = new Record(col(dao, "audit_events"));
  rec.set("organizationId", orgId);
  if (actor) {
    rec.set("actorId", actor.id || "");
    rec.set("actorName", actor.name || "");
  }
  rec.set("action", action);
  rec.set("entityType", entityType);
  rec.set("entityId", entityId);
  rec.set("payload", JSON.stringify(pl));
  rec.set("prevHash", prevHash);
  rec.set("hash", sha256Hex(material));
  rec.set("occurredAt", occurredAt);
  dao.save(rec);
  return rec;
}

/* Next sequential document number, collision-safe via the unique index:
   retry a few times if a concurrent writer won the race. */
function mintNumber(dao, collection, field, prefix, width, yearly) {
  var yr = yearly ? String(new Date().getFullYear()) + "-" : "";
  for (var attempt = 0; attempt < 5; attempt++) {
    var max = 0;
    var last = findLatest(dao, collection, field + ' ~ {:p}', "-" + field, { p: prefix + yr });
    if (last) {
      var m = /(\d+)$/.exec(String(last.get(field) || ""));
      if (m) max = parseInt(m[1], 10);
    }
    return prefix + yr + pad(max + 1 + attempt, width);
  }
  return prefix + yr + pad(Date.now() % 10000, width);
}

/* ---------- auth helpers ---------- */

function operatorOf(c, moneyOrgId) {
  var info = null;
  try { info = c.requestInfo(); } catch (e) { return null; }
  /* PocketBase 0.40 RequestInfo: { body, query, headers, auth, method, ... } */
  var auth = info && (info.auth || info.authRecord);
  if (!auth) return null;
  var role = "";
  var orgId = "";
  try { role = String(auth.getString("role") || ""); } catch (e) { role = ""; }
  try { orgId = String(auth.getString("organizationId") || ""); } catch (e) { orgId = ""; }
  if (role !== "admin" && role !== "secretary") return null;
  if (moneyOrgId && orgId && orgId !== moneyOrgId && env("AGMX_ANY_ORG_STAFF", "") !== "1") return null;
  var name = "";
  try { name = String(auth.getString("name") || auth.getString("email") || ""); } catch (e) { name = ""; }
  return { id: auth.id, role: role, orgId: orgId, name: name };
}

function bodyOf(c) {
  try {
    /* PocketBase 0.40: the parsed JSON body hangs off the event's
       RequestInfo. In 0.22 this was `$apis.requestInfo(c)` and the body
       was sometimes `.data`; both are gone. RequestInfo.body is the only
       correct accessor now, and c.requestInfo() caches per request. */
    return c.requestInfo().body || {};
  } catch (e) { return {}; }
}

/* PocketBase 0.40 removed Event.queryParam(); query string values are
   exposed as a plain dict on RequestInfo.query. */
function qp(c, name) {
  try {
    var v = c.requestInfo().query[name];
    return v === undefined || v === null ? "" : String(v);
  } catch (e) { return ""; }
}

/* Locate an assessment by public reference and enforce access:
   operator auth OR the unguessable checkout token. */
function authedLead(c, dao, org, ref, token) {
  if (!ref) throw new BadRequestError("Rujukan lead diperlukan (ref).");
  var rec = null;
  try {
    rec = dao.findFirstRecordByFilter("agm_assessments", "reference={:r}", { r: String(ref) });
  } catch (e) { rec = null; }
  if (!rec) throw new NotFoundError("Lead tidak dijumpai: " + ref);
  var op = operatorOf(c, org.id);
  if (op) return { rec: rec, operator: op };
  var stored = "";
  try { stored = String(rec.getString("token") || ""); } catch (e) { stored = ""; }
  if (!stored || String(token || "") !== stored) {
    throw new ForbiddenError("Pautan tidak sah — buka pautan checkout dari keputusan penilaian anda.");
  }
  return { rec: rec, operator: null };
}

/* ---------- normalisers (PB record → api.js local shape) ---------- */

function normLead(rec, quote, invoice, payment) {
  var answers = {};
  try { answers = JSON.parse(String(rec.get("answers") || "{}")) || {}; } catch (e) { answers = {}; }
  var status = String(rec.getString("status") || "lead");
  var stage = STATUS_TO_STAGE[status] || STATUS_TO_STAGE.lead;
  /* derive the document-driven stages (mirrors LocalAdapter) — but never
     talk an explicitly-scheduled or closed lead back down the pipeline */
  if (status !== "scheduled" && status !== "lost") {
    if (payment && String(payment.getString("status")) === "succeeded") stage = "Dibayar";
    else if (quote && String(quote.getString("status")) === "accepted") stage = "Sebut Harga Diterima";
  }
  var processRev = { digital: "digital", partial: "mixed", manual: "manual" };
  return {
    id: String(rec.getString("reference") || rec.id),
    uuid: rec.id,
    createdAt: isoOf(rec, "createdAt"),
    stage: stage,
    status: status,
    coopName: rec.getString("coopName") || "",
    coopReg: rec.getString("coopReg") || "",
    state: rec.getString("state") || "",
    members: rec.getInt("members") || 0,
    agmDate: isoOf(rec, "agmDate") ? String(dateOf(rec, "agmDate")).slice(0, 10) : "",
    mode: rec.getString("mode") || "hybrid",
    attendance: Number(answers.attendance || rec.getInt("expectedAttendance") || 0),
    candidates: rec.getInt("candidates") || 0,
    motions: rec.getInt("motions") || 0,
    process: processRev[rec.getString("currentProcess")] || "mixed",
    managed: !!rec.getBool("needsManaged"),
    score: rec.getInt("complexityScore") || 0,
    factors: answers.factors || [],
    pkgKey: answers.pkgKey || "",
    pkgName: answers.pkgName || "",
    pkgPrice: Number(answers.pkgPrice || 0),
    quote: Number(answers.pkgPrice || 0),
    contactName: rec.getString("contactName") || "",
    contactPhone: rec.getString("contactPhone") || "",
    contactEmail: rec.getString("contactEmail") || "",
    quoteId: quote ? quote.getString("number") : null,
    invoiceId: invoice ? invoice.getString("number") : null,
    paymentId: payment ? "PAY-" + payment.id : null,
  };
}

function normQuote(rec, leadRef) {
  var items = [];
  try { items = JSON.parse(String(rec.get("items") || "[]")) || []; } catch (e) { items = []; }
  return {
    id: rec.getString("number"),
    number: rec.getString("number"),
    leadRef: leadRef || null,
    items: items,
    subtotal: round2(rec.getFloat("subtotal")),
    tax: round2(rec.getFloat("tax")),
    taxRate: SST_RATE / 100,
    total: round2(rec.getFloat("total")),
    currency: "MYR",
    status: rec.getString("status"),
    validUntil: isoOf(rec, "validUntil"),
    createdAt: isoOf(rec, "createdAt"),
    acceptedAt: isoOf(rec, "acceptedAt"),
  };
}

function normInvoice(rec, quoteNumber, leadRef) {
  return {
    id: rec.getString("number"),
    number: rec.getString("number"),
    quoteId: quoteNumber || null,
    leadRef: leadRef || null,
    amount: round2(rec.getFloat("amount")),
    currency: "MYR",
    status: rec.getString("status"),
    issuedAt: isoOf(rec, "issuedAt"),
    dueAt: isoOf(rec, "dueAt"),
    paidAt: isoOf(rec, "paidAt"),
  };
}

function normPayment(rec, invoiceNumber, leadRef) {
  var method = rec.getString("method");
  return {
    id: "PAY-" + rec.id,
    pbId: rec.id,
    invoiceId: invoiceNumber || null,
    leadRef: leadRef || null,
    method: method,
    methodLabel: METHOD_LABELS[method] || method,
    reference: rec.getString("reference") || "",
    amount: round2(rec.getFloat("amount")),
    currency: "MYR",
    status: rec.getString("status"),
    paidAt: isoOf(rec, "paidAt"),
    createdAt: isoOf(rec, "createdAt"),
  };
}

/* join the commercial documents for one assessment */
function docsFor(dao, assessmentId) {
  var quote = findLatest(dao, "quotes", "assessmentId={:a}", "-createdAt", { a: assessmentId });
  var invoice = quote ? findLatest(dao, "invoices", "quoteId={:q}", "-createdAt", { q: quote.id }) : null;
  var payment = invoice ? findLatest(dao, "payments", "invoiceId={:i}", "-createdAt", { i: invoice.id }) : null;
  /* prefer a succeeded payment over older pending attempts */
  if (invoice && payment && payment.getString("status") !== "succeeded") {
    var okPay = findLatest(dao, "payments", 'invoiceId={:i} && status="succeeded"', "-createdAt", { i: invoice.id });
    if (okPay) payment = okPay;
  }
  return { quote: quote, invoice: invoice, payment: payment };
}

function eventShape(rec, seq) {
  var pl = {};
  try { pl = JSON.parse(String(rec.get("payload") || "{}")) || {}; } catch (e) { pl = {}; }
  return {
    id: "EVT-" + pad(seq, 5),
    seq: seq,
    ts: isoOf(rec, "occurredAt"),
    event: rec.getString("action"),
    entityType: rec.getString("entityType"),
    entityId: rec.getString("entityId"),
    leadRef: pl.lead || null,
    detail: pl,
  };
}

/* ============================================================
   ROUTES
   ============================================================ */

/* ---------- POST /api/agmx/assessment — public lead capture ---------- */

/* ============================================================
   ROUTE IMPLEMENTATIONS
   ============================================================ */

/* POST /api/agmx/assessment */
function submitAssessment(c) {
  var dao = $app;
  var a = (bodyOf(c).assessment) || {};

  /* required fields */
  if (!a.coopName || !a.contactName || !a.contactPhone) {
    throw new BadRequestError("Nama koperasi, nama dan telefon kenalan diperlukan.");
  }
  if (!(Number(a.members) > 0)) throw new BadRequestError("Bilangan ahli tidak sah.");
  var MODES = { physical: 1, online: 1, hybrid: 1 };
  if (!MODES[a.mode]) a.mode = "hybrid";
  var PROCESS = { digital: "digital", mixed: "partial", manual: "manual", partial: "partial" };
  var currentProcess = PROCESS[a.process] || "manual";

  /* schema drift guard — fields added for the money flow must exist
     (PocketBase 0.40: Collection.fields, not Collection.schema) */
  var assessmentsCol = col(dao, "agm_assessments");
  if (!hasField(assessmentsCol, "reference") || !hasField(assessmentsCol, "token")) {
    throw new BadRequestError("Skema lapuk: jalankan tools/pb_migrate.py (agm_assessments.reference/token tiada).");
  }

  var org = ensureOperatorOrg(dao);
  var score = computeScore(a);                       // server-side, tamper-proof
  var pkgKey = packageForScore(score.total);
  var planCode = PKG_CODES[pkgKey];
  var plan = findPlan(dao, planCode);
  var pkgName = plan ? plan.getString("name") : PKG_FALLBACK[planCode].name;
  var pkgPrice = plan ? round2(plan.getFloat("priceOneoff")) : PKG_FALLBACK[planCode].price;

  var out = {};
  dao.runInTransaction(function (tx) {
    var ref = mintNumber(tx, "agm_assessments", "reference", "LD-", 4, false);
    var token = $security.randomString(24);
    var rec = new Record(assessmentsCol);
    rec.set("createdAt", pbNow());   /* agm_assessments: orders "latest" lookups */
    rec.set("organizationId", org.id);
    rec.set("reference", ref);
    rec.set("token", token);
    rec.set("coopName", String(a.coopName).slice(0, 200));
    rec.set("coopReg", String(a.coopReg || "").slice(0, 100));
    rec.set("state", String(a.state || "").slice(0, 100));
    rec.set("members", Number(a.members) || 0);
    if (a.agmDate) rec.set("agmDate", String(a.agmDate).slice(0, 19).replace("T", " "));
    rec.set("mode", a.mode);
    rec.set("expectedAttendance", Number(a.attendance) || 0);
    rec.set("candidates", Number(a.candidates) || 0);
    rec.set("motions", Number(a.motions) || 0);
    rec.set("currentProcess", currentProcess);
    rec.set("needsManaged", !!a.managed);
    rec.set("contactName", String(a.contactName).slice(0, 200));
    rec.set("contactPhone", String(a.contactPhone).slice(0, 50));
    rec.set("contactEmail", String(a.contactEmail || "").slice(0, 200));
    rec.set("complexityScore", score.total);
    if (plan) rec.set("recommendedPlanId", plan.id);
    rec.set("status", "lead");
    rec.set("answers", JSON.stringify({
      score: score.total, factors: score.factors, attendance: Number(a.attendance) || 0,
      pkgKey: pkgKey, pkgName: pkgName, pkgPrice: pkgPrice,
      clientScore: Number(a.score) || null,   // kept for drift monitoring only
    }));
    tx.save(rec);
    appendAudit(tx, org.id, null, "assessment.submitted", "lead", ref,
      { coop: rec.getString("coopName"), score: score.total, package: pkgName }, ref);
    var docs = { quote: null, invoice: null, payment: null };
    out.lead = normLead(rec, docs.quote, docs.invoice, docs.payment);
    out.lead.checkoutToken = token;   // returned ONCE — hidden field, never served again
  });
  return c.json(200, out);
}

/* GET /api/agmx/lead */
function getLead(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var ref = qp(c, "ref");
  var token = qp(c, "t");
  var access = authedLead(c, dao, org, ref, token);
  var docs = docsFor(dao, access.rec.id);
  var lead = normLead(access.rec, docs.quote, docs.invoice, docs.payment);
  var deal = {
    lead: lead,
    quote: docs.quote ? normQuote(docs.quote, lead.id) : null,
    invoice: docs.invoice ? normInvoice(docs.invoice, docs.quote ? docs.quote.getString("number") : null, lead.id) : null,
    payment: docs.payment ? normPayment(docs.payment, docs.invoice ? docs.invoice.getString("number") : null, lead.id) : null,
    quoteTotal: docs.quote ? round2(docs.quote.getFloat("total")) : 0,
    paidTotal: docs.payment && docs.payment.getString("status") === "succeeded"
      ? round2(docs.payment.getFloat("amount")) : 0,
  };
  return c.json(200, { deal: deal });
}

/* POST /api/agmx/quote */
function createQuote(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var body = bodyOf(c);
  var ref = body.ref || qp(c, "ref");
  var token = body.t || qp(c, "t");
  var access = authedLead(c, dao, org, ref, token);
  var assessment = access.rec;

  /* fail fast on garbage input — before the idempotency short-circuit,
     so a bad add-on never hides behind an existing quote */
  var addons = body.addons || [];
  for (var ai = 0; ai < addons.length; ai++) {
    if (!ADDONS[addons[ai]]) throw new BadRequestError("Add-on tidak dikenali: " + addons[ai]);
  }

  var out = {};
  dao.runInTransaction(function (tx) {
    /* idempotent: one live quote per assessment */
    var existing = findLatest(tx, "quotes", "assessmentId={:a}", "-createdAt", { a: assessment.id });
    if (existing) {
      out.quote = normQuote(existing, assessment.getString("reference"));
      return;
    }

    var answers = {};
    try { answers = JSON.parse(String(assessment.get("answers") || "{}")) || {}; } catch (e) { answers = {}; }
    var pkgKey = PKG_CODES[body.packageKey] ? body.packageKey : (answers.pkgKey || packageForScore(assessment.getInt("complexityScore")));
    var planCode = PKG_CODES[pkgKey] || "professional_agm";
    var plan = findPlan(tx, planCode);
    var pkgName = plan ? plan.getString("name") : PKG_FALLBACK[planCode].name;
    var pkgPrice = plan ? round2(plan.getFloat("priceOneoff")) : PKG_FALLBACK[planCode].price;

    var items = [{
      description: pkgName + " — perkhidmatan AGM sekali gus",
      qty: 1, unitPrice: pkgPrice, lineTotal: pkgPrice,
    }];
    for (var i = 0; i < addons.length; i++) {
      var ad = ADDONS[addons[i]];   /* validated above */
      items.push({ description: ad.label, qty: 1, unitPrice: ad.price, lineTotal: ad.price });
    }
    var subtotal = round2(items.reduce(function (s, it) { return s + it.lineTotal; }, 0));
    var tax = round2(subtotal * (SST_RATE / 100));
    var total = round2(subtotal + tax);

    var rec = new Record(col(tx, "quotes"));
    rec.set("createdAt", pbNow());   /* quotes: orders "latest" lookups */
    rec.set("organizationId", org.id);
    rec.set("assessmentId", assessment.id);
    rec.set("number", mintNumber(tx, "quotes", "number", "QT-", 3, true));
    rec.set("status", "sent");
    rec.set("sentAt", pbNow());
    rec.set("validUntil", pbAddDays(QUOTE_VALID_DAYS));
    rec.set("subtotal", subtotal);
    rec.set("tax", tax);
    rec.set("sstRate", SST_RATE);
    rec.set("total", total);
    rec.set("items", JSON.stringify(items));
    rec.set("notes", "Diterbitkan sendiri (checkout) — harga dikira di pelayan.");
    tx.save(rec);

    var st = assessment.getString("status");
    if (st === "lead" || st === "contacted") {
      assessment.set("status", "quoted");
      tx.save(assessment);
    }
    appendAudit(tx, org.id, access.operator, "quote.created", "quote", rec.getString("number"),
      { lead: assessment.getString("reference"), total: total, items: items.length },
      assessment.getString("reference"));
    out.quote = normQuote(rec, assessment.getString("reference"));
  });
  return c.json(200, out);
}

/* GET /api/agmx/quote */
function getQuote(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var number = qp(c, "number");
  var quote = null;
  try { quote = dao.findFirstRecordByFilter("quotes", "number={:n}", { n: number }); } catch (e) { quote = null; }
  if (!quote) throw new NotFoundError("Sebut harga tidak dijumpai: " + number);
  var assessment = null;
  try { assessment = dao.findRecordById("agm_assessments", quote.getString("assessmentId")); } catch (e) { assessment = null; }
  if (assessment) {
    authedLead(c, dao, org, assessment.getString("reference"), qp(c, "t"));
  } else {
    if (!operatorOf(c, org.id)) throw new ForbiddenError("Operator sahaja.");
  }
  return c.json(200, { quote: normQuote(quote, assessment ? assessment.getString("reference") : null) });
}

/* POST /api/agmx/quote/accept */
function acceptQuote(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var body = bodyOf(c);
  var out = {};
  dao.runInTransaction(function (tx) {
    var quote = null;
    try { quote = tx.findFirstRecordByFilter("quotes", "number={:n}", { n: body.number }); } catch (e) { quote = null; }
    if (!quote) throw new NotFoundError("Sebut harga tidak dijumpai: " + body.number);
    var assessment = tx.findRecordById("agm_assessments", quote.getString("assessmentId"));
    var access = authedLead(c, tx, org, assessment.getString("reference"), body.t || qp(c, "t"));

    if (quote.getString("status") === "accepted") {
      out.quote = normQuote(quote, assessment.getString("reference"));
      return;
    }
    var vu = jsDate(dateOf(quote, "validUntil"));
    if (vu && vu < new Date()) {
      quote.set("status", "expired");
      tx.save(quote);
      throw new BadRequestError("Sebut harga telah tamat tempoh — minta sebut harga baharu.");
    }
    quote.set("status", "accepted");
    quote.set("acceptedAt", pbNow());
    tx.save(quote);
    appendAudit(tx, org.id, access.operator, "quote.accepted", "quote", quote.getString("number"),
      { lead: assessment.getString("reference"), total: round2(quote.getFloat("total")) },
      assessment.getString("reference"));
    out.quote = normQuote(quote, assessment.getString("reference"));
  });
  return c.json(200, out);
}

/* POST /api/agmx/invoice */
function createInvoice(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var body = bodyOf(c);
  var out = {};
  dao.runInTransaction(function (tx) {
    var quote = null;
    try { quote = tx.findFirstRecordByFilter("quotes", "number={:n}", { n: body.quoteNumber }); } catch (e) { quote = null; }
    if (!quote) throw new NotFoundError("Sebut harga tidak dijumpai: " + body.quoteNumber);
    var assessment = tx.findRecordById("agm_assessments", quote.getString("assessmentId"));
    var access = authedLead(c, tx, org, assessment.getString("reference"), body.t || qp(c, "t"));

    var existing = findLatest(tx, "invoices", "quoteId={:q}", "-createdAt", { q: quote.id });
    if (existing) {
      out.invoice = normInvoice(existing, quote.getString("number"), assessment.getString("reference"));
      return;
    }
    if (quote.getString("status") !== "accepted") {
      throw new BadRequestError("Sebut harga mesti diterima sebelum invois diterbitkan.");
    }
    var rec = new Record(col(tx, "invoices"));
    rec.set("createdAt", pbNow());   /* invoices: orders "latest" lookups */
    rec.set("organizationId", org.id);
    rec.set("quoteId", quote.id);
    rec.set("number", mintNumber(tx, "invoices", "number", "INV-", 3, true));
    rec.set("status", "unpaid");
    rec.set("issuedAt", pbNow());
    rec.set("dueAt", pbAddDays(INVOICE_DUE_DAYS));   // NET 14
    rec.set("amount", round2(quote.getFloat("total")));
    rec.set("items", String(quote.get("items") || "[]"));
    tx.save(rec);
    appendAudit(tx, org.id, access.operator, "invoice.created", "invoice", rec.getString("number"),
      { quote: quote.getString("number"), amount: round2(quote.getFloat("total")), due: dateOf(rec, "dueAt") },
      assessment.getString("reference"));
    out.invoice = normInvoice(rec, quote.getString("number"), assessment.getString("reference"));
  });
  return c.json(200, out);
}

/* GET /api/agmx/invoice */
function getInvoice(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var invoice = null;
  try { invoice = dao.findFirstRecordByFilter("invoices", "number={:n}", { n: qp(c, "number") }); } catch (e) { invoice = null; }
  if (!invoice) throw new NotFoundError("Invois tidak dijumpai.");
  var quote = null;
  try { quote = dao.findRecordById("quotes", invoice.getString("quoteId")); } catch (e) { quote = null; }
  var assessment = null;
  if (quote) { try { assessment = dao.findRecordById("agm_assessments", quote.getString("assessmentId")); } catch (e) { assessment = null; } }
  if (assessment) authedLead(c, dao, org, assessment.getString("reference"), qp(c, "t"));
  else if (!operatorOf(c, org.id)) throw new ForbiddenError("Operator sahaja.");
  return c.json(200, {
    invoice: normInvoice(invoice, quote ? quote.getString("number") : null,
      assessment ? assessment.getString("reference") : null),
  });
}

/* POST /api/agmx/payment */
function createPayment(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var body = bodyOf(c);
  if (!PAYMENT_METHODS[body.method]) throw new BadRequestError("Kaedah pembayaran tidak sah: " + body.method);

  var out = {};
  dao.runInTransaction(function (tx) {
    var invoice = null;
    try { invoice = tx.findFirstRecordByFilter("invoices", "number={:n}", { n: body.invoiceNumber }); } catch (e) { invoice = null; }
    if (!invoice) throw new NotFoundError("Invois tidak dijumpai: " + body.invoiceNumber);
    var quote = tx.findRecordById("quotes", invoice.getString("quoteId"));
    var assessment = tx.findRecordById("agm_assessments", quote.getString("assessmentId"));
    var access = authedLead(c, tx, org, assessment.getString("reference"), body.t || qp(c, "t"));

    if (invoice.getString("status") === "paid") throw new BadRequestError("Invois sudah dibayar.");
    var already = null;
    try {
      already = tx.findFirstRecordByFilter("payments", 'invoiceId={:i} && status="succeeded"', { i: invoice.id });
    } catch (e) { already = null; }
    if (already) throw new BadRequestError("Invois sudah dibayar (rekod " + already.id + ").");

    var method = body.method;
    var reference = method === "bank_transfer" && body.reference
      ? String(body.reference).slice(0, 100)
      : (method === "bank_transfer" ? "TRF-" : method.toUpperCase()) + Date.now().toString(36).toUpperCase();

    var simulated = env("AGMX_ALLOW_SIMULATED_PAYMENTS", "") === "1" && method !== "bank_transfer";

    var rec = new Record(col(tx, "payments"));
    rec.set("createdAt", pbNow());   /* payments: orders "latest" lookups */
    rec.set("organizationId", org.id);
    rec.set("invoiceId", invoice.id);
    rec.set("method", method);
    rec.set("reference", reference);
    rec.set("amount", round2(invoice.getFloat("amount")));
    rec.set("status", simulated ? "succeeded" : "pending");
    if (simulated) {
      rec.set("paidAt", pbNow());
      rec.set("gatewayRef", "SIM-" + $security.randomString(10).toUpperCase());
    }
    tx.save(rec);

    if (simulated) {
      invoice.set("status", "paid");
      invoice.set("paidAt", pbNow());
      tx.save(invoice);
      var st = assessment.getString("status");
      if (st !== "scheduled" && st !== "lost") {
        assessment.set("status", "won");
        tx.save(assessment);
      }
    }
    appendAudit(tx, org.id, access.operator,
      simulated ? "payment.succeeded" : "payment.pending_verification",
      "payment", rec.id,
      { invoice: invoice.getString("number"), method: method, reference: reference,
        amount: round2(invoice.getFloat("amount")), simulated: simulated },
      assessment.getString("reference"));

    out.payment = normPayment(rec, invoice.getString("number"), assessment.getString("reference"));
    out.invoice = normInvoice(invoice, quote.getString("number"), assessment.getString("reference"));
  });
  return c.json(200, out);
}

/* POST /api/agmx/payment/confirm */
function confirmPayment(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var op = operatorOf(c, org.id);
  if (!op) throw new ForbiddenError("Operator sahaja (admin/setiausaha).");
  var body = bodyOf(c);

  var out = {};
  dao.runInTransaction(function (tx) {
    var payment = null;
    try { payment = tx.findRecordById("payments", String(body.paymentId || "").replace(/^PAY-/, "")); } catch (e) { payment = null; }
    if (!payment) throw new NotFoundError("Pembayaran tidak dijumpai.");
    if (payment.getString("status") === "succeeded") {
      var inv0 = tx.findRecordById("invoices", payment.getString("invoiceId"));
      out.payment = normPayment(payment, inv0.getString("number"), null);
      return;
    }
    payment.set("status", "succeeded");
    payment.set("paidAt", pbNow());
    tx.save(payment);

    var invoice = tx.findRecordById("invoices", payment.getString("invoiceId"));
    invoice.set("status", "paid");
    invoice.set("paidAt", pbNow());
    tx.save(invoice);

    var quote = tx.findRecordById("quotes", invoice.getString("quoteId"));
    var assessment = tx.findRecordById("agm_assessments", quote.getString("assessmentId"));
    var st = assessment.getString("status");
    if (st !== "scheduled" && st !== "lost") {
      assessment.set("status", "won");
      tx.save(assessment);
    }
    appendAudit(tx, org.id, op, "payment.succeeded", "payment", payment.id,
      { invoice: invoice.getString("number"), method: payment.getString("method"),
        reference: payment.getString("reference"), amount: round2(payment.getFloat("amount")),
        confirmedBy: op.name || op.id },
      assessment.getString("reference"));
    out.payment = normPayment(payment, invoice.getString("number"), assessment.getString("reference"));
    out.invoice = normInvoice(invoice, quote.getString("number"), assessment.getString("reference"));
  });
  return c.json(200, out);
}

/* ============================================================
   BILLPLZ PAYMENT GATEWAY (server-side only)
   ------------------------------------------------------------
   The API key never leaves the server: it is read from the
   BILLPLZ_API_KEY environment variable and used only inside these
   hooks. The browser only ever sees a hosted payment URL.

   Configuration (environment variables on the PB instance):
     BILLPLZ_API_KEY          X-Signature key from the Billplz dashboard
     BILLPLZ_COLLECTION_ID    Collection that receives the bills
     BILLPLZ_CALLBACK_URL    Webhook target (must be publicly reachable)
     BILLPLZ_REDIRECT_URL    Where Billplz sends the payer after payment
   ============================================================ */

var BILLPLZ_API = "https://www.billplz.com/api/v3";

function billplzConfig() {
  var key = env("BILLPLZ_API_KEY", "");
  var collectionId = env("BILLPLZ_COLLECTION_ID", "");
  if (!key || !collectionId) return null;
  return { key: key, collectionId: collectionId };
}

/* Billplz keeps TWO separate credentials and is explicit that they must not be
   used interchangeably (support.billplz.com/guide/authentication):

     Secret key      - BILLPLZ_API_KEY.       HTTP Basic Auth on every API request.
     X Signature key - BILLPLZ_X_SIGNATURE.   HMAC key for callback verification.

   Verifying callbacks with the Secret key (what this hook did until
   2026-10-18) rejects every genuine callback: Billplz signs with the X
   Signature key, so the computed HMAC never matches. Invisible in negative
   testing, because a wrong-but-consistent key still 403s a forged request.
   It only surfaces against a real payment.

   No fallback to the Secret key: a silent downgrade would reintroduce exactly
   the bug. Callers fail closed when this is unset. */
function billplzSignatureKey() {
  return env("BILLPLZ_X_SIGNATURE", "");
}

/* Billplz X-Signature: HMAC-SHA256 over the POST params, each key+value
   concatenated with no separator, sorted and joined with '|' (see the
   algorithm note inside billplzSignature below). */
function billplzSignature(params, secret) {
  /* Documented Billplz X-Signature scheme:
       1. drop x_signature
       2. sort remaining keys ascending, case-insensitive
       3. concatenate each key with its value — NO '=' separator
       4. join the pairs with '|'
       5. HMAC-SHA256 with the X-Signature key
     e.g. amount100|collection_idyhx5t1pp|emaila@abc.com|...
     (An earlier version used '=' and '&', which verifies nothing.)

     `secret` must be the X Signature key, not the Secret key. See
     billplzSignatureKey() above — passing cfg.key here is the exact bug.

     $security.hs256 returns lowercase hex, which matches Billplz's own
     reference implementations (PHP hash_hmac defaults to hex). Encoding
     matters as much as the key: base64 output would never compare equal. */
  var keys = Object.keys(params).filter(function (k) { return k !== "x_signature"; }).sort();
  var s = keys.map(function (k) { return k + params[k]; }).join("|");
  return $security.hs256(s, secret);
}

/* Minimal base64 (Basic auth header). goja has no Buffer/atob. */
function base64Encode(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  var bytes = [];
  for (var j = 0; j < str.length; j++) bytes.push(str.charCodeAt(j) & 0xff);
  var i = 0;
  while (i < bytes.length) {
    var b0 = bytes[i++];
    var b1 = i < bytes.length ? bytes[i++] : NaN;
    var b2 = i < bytes.length ? bytes[i++] : NaN;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (isNaN(b1) ? 0 : b1 >> 4)];
    out += isNaN(b1) ? "=" : chars[((b1 & 15) << 2) | (isNaN(b2) ? 0 : b2 >> 6)];
    out += isNaN(b2) ? "=" : chars[b2 & 63];
  }
  return out;
}

/* POST /api/agmx/payment/link — create a hosted Billplz bill for an invoice. */
function createPaymentLink(c) {
  var cfg = billplzConfig();
  if (!cfg) throw new ForbiddenError("Gerbang Billplz belum dikonfigurasi.");
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var body = bodyOf(c);

  var invoice = null;
  try { invoice = dao.findFirstRecordByFilter("invoices", "number={:n}", { n: body.invoiceNumber }); }
  catch (e) { invoice = null; }
  if (!invoice || invoice.getString("organizationId") !== org.id)
    throw new NotFoundError("Invois tidak dijumpai dalam organisasi ini.");
  if (invoice.getString("status") === "paid") throw new BadRequestError("Invois sudah dibayar.");

  var quote = dao.findRecordById("quotes", invoice.getString("quoteId"));
  var assessment = dao.findRecordById("agm_assessments", quote.getString("assessmentId"));
  var access = authedLead(c, dao, org, assessment.getString("reference"),
    body.t || qp(c, "t"));

  var amountSen = Math.round(invoice.getFloat("amount") * 100);
  if (!Number.isSafeInteger(amountSen) || amountSen < 1)
    throw new BadRequestError("Jumlah invois tidak sah.");

  var email = String(assessment.getString("contactEmail") || "").trim();
  var name = String(assessment.getString("contactName") || "AGMX").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestError("Emel kenalan diperlukan.");

  /* Reuse a pending bill rather than minting a second one for the same invoice. */
  var existing = null;
  try {
    existing = dao.findFirstRecordByFilter(
      "payments", 'invoiceId={:i} && status="pending" && method="billplz"', { i: invoice.id });
  } catch (e) { existing = null; }

  if (existing) {
    return c.json(200, { url: existing.getString("gatewayRef"), paymentId: existing.id,
      billId: existing.getString("reference"), reused: true });
  }

  var payload = {
    collection_id: cfg.collectionId,
    email: email,
    name: name,
    amount: amountSen,
    description: "AGMX invoice " + invoice.getString("number"),
  };
  var callbackUrl = env("BILLPLZ_CALLBACK_URL", "");
  var redirectUrl = env("BILLPLZ_REDIRECT_URL", "");
  if (callbackUrl) payload.callback_url = callbackUrl;
  if (redirectUrl) payload.redirect_url = redirectUrl;

  var res = $http.send({
    method: "POST",
    url: BILLPLZ_API + "/bills",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + base64Encode(cfg.key + ":"),
    },
    body: JSON.stringify(payload),
    timeout: 15,
  });

  if (res.statusCode !== 200) throw new Error("Bil tidak dapat dibuat. Cuba semula kemudian.");

  var data = res.json;
  if (!data || !data.id || !data.url) throw new Error("Respons Billplz tidak lengkap.");

  var rec = new Record(col(dao, "payments"));
  rec.set("organizationId", org.id);
  rec.set("invoiceId", invoice.id);
  rec.set("method", "billplz");
  rec.set("reference", data.id);
  rec.set("gatewayRef", data.url);
  rec.set("amount", round2(invoice.getFloat("amount")));
  rec.set("status", "pending");
  dao.save(rec);

  appendAudit(dao, org.id, access.operator, "payment.link_created", "payment", rec.id,
    { invoice: invoice.getString("number"), billId: data.id, amount: round2(invoice.getFloat("amount")) },
    assessment.getString("reference"));

  return c.json(200, { url: data.url, paymentId: rec.id, billId: data.id });
}

/* POST /api/agmx/payment/callback — Billplz webhook. Verifies the signature,
   then settles the payment inside the same transaction that pays the invoice. */
function paymentCallback(c) {
  var cfg = billplzConfig();
  if (!cfg) throw new ForbiddenError("Gerbang Billplz belum dikonfigurasi.");

  var body = bodyOf(c);
  var sig = String(body.x_signature || "");
  if (!sig) throw new ForbiddenError("Tandatangan webhook tiada.");

  /* Fail closed. Without the X Signature key we cannot verify authenticity, so
     we must not settle. Falling back to the Secret key would look like a pass
     in every negative test while rejecting all real payments. */
  var sigKey = billplzSignatureKey();
  if (!sigKey) throw new ForbiddenError("Kunci X Signature Billplz belum diset (BILLPLZ_X_SIGNATURE).");

  if (!$security.equal(sig, billplzSignature(body, sigKey)))
    throw new ForbiddenError("Tandatangan webhook tidak sah.");

  var billId = String(body.id || "");
  if (!billId) throw new BadRequestError("ID bil tiada.");

  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var payment = null;
  try { payment = dao.findFirstRecordByFilter("payments", "reference={:r}", { r: billId }); }
  catch (e) { payment = null; }
  if (!payment) throw new NotFoundError("Bayaran tidak dijumpai.");

  /* Idempotent: a settled payment settles nothing twice. */
  if (payment.getString("status") === "succeeded")
    return c.json(200, { ok: true, duplicate: true });

  var paid = String(body.paid || "") === "true";
  var state = String(body.state || "");
  if (!paid && state !== "paid" && state !== "completed")
    return c.json(200, { ok: true, settled: false });

  dao.runInTransaction(function (tx) {
    var p = tx.findRecordById("payments", payment.id);
    p.set("status", "succeeded");
    p.set("paidAt", pbNow());
    p.set("gatewayRef", String(body.transaction_id || billId).slice(0, 200));
    tx.save(p);
    var inv = tx.findRecordById("invoices", p.getString("invoiceId"));
    inv.set("status", "paid");
    inv.set("paidAt", pbNow());
    tx.save(inv);
    var q = tx.findRecordById("quotes", inv.getString("quoteId"));
    var a = tx.findRecordById("agm_assessments", q.getString("assessmentId"));
    var st = a.getString("status");
    if (st !== "scheduled" && st !== "lost") { a.set("status", "won"); tx.save(a); }
    appendAudit(tx, org.id, null, "payment.succeeded", "payment", p.id,
      { invoice: inv.getString("number"), gateway: "billplz", billId: billId },
      a.getString("reference"));
  });

  return c.json(200, { ok: true, settled: true });
}

/* POST /api/agmx/lead/stage */
function updateStage(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var op = operatorOf(c, org.id);
  if (!op) throw new ForbiddenError("Operator sahaja (admin/setiausaha).");
  var body = bodyOf(c);
  var status = STAGE_TO_STATUS[body.stage];
  if (!status) {
    throw new BadRequestError("Peringkat ini dikemas kini oleh aliran dokumen, bukan manual: " + body.stage);
  }

  var out = {};
  dao.runInTransaction(function (tx) {
    var rec = null;
    try { rec = tx.findFirstRecordByFilter("agm_assessments", "reference={:r}", { r: body.ref }); } catch (e) { rec = null; }
    if (!rec) throw new NotFoundError("Lead tidak dijumpai: " + body.ref);
    var from = rec.getString("status");
    rec.set("status", status);
    tx.save(rec);
    appendAudit(tx, org.id, op, "lead.stage_changed", "lead", rec.getString("reference"),
      { from: STATUS_TO_STAGE[from] || from, to: body.stage }, rec.getString("reference"));
    var docs = docsFor(tx, rec.id);
    out.lead = normLead(rec, docs.quote, docs.invoice, docs.payment);
  });
  return c.json(200, out);
}

/* GET /api/agmx/deals */
function listDeals(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var op = operatorOf(c, org.id);
  if (!op) throw new ForbiddenError("Operator sahaja (admin/setiausaha) — log masuk di app.html.");

  var assessments = [];
  try {
    assessments = dao.findRecordsByFilter(
      "agm_assessments", "organizationId={:o}", "-createdAt", 500, 0, { o: org.id });
  } catch (e) { assessments = []; }

  var deals = [];
  var quoted = 0, paid = 0, pipeline = 0, collected = 0;
  for (var i = 0; i < assessments.length; i++) {
    var a = assessments[i];
    var docs = docsFor(dao, a.id);
    var lead = normLead(a, docs.quote, docs.invoice, docs.payment);
    var quoteTotal = docs.quote ? round2(docs.quote.getFloat("total")) : 0;
    var paidTotal = docs.payment && docs.payment.getString("status") === "succeeded"
      ? round2(docs.payment.getFloat("amount")) : 0;
    deals.push({
      lead: lead,
      quote: docs.quote ? normQuote(docs.quote, lead.id) : null,
      invoice: docs.invoice ? normInvoice(docs.invoice, docs.quote ? docs.quote.getString("number") : null, lead.id) : null,
      payment: docs.payment ? normPayment(docs.payment, docs.invoice ? docs.invoice.getString("number") : null, lead.id) : null,
      quoteTotal: quoteTotal,
      paidTotal: paidTotal,
    });
    if (docs.quote) quoted++;
    if (paidTotal > 0) paid++;
    pipeline += docs.quote ? quoteTotal : (lead.pkgPrice || 0);
    collected += paidTotal;
  }
  /* metrics computed server-side (the SupabaseAdapter in PR #5 returned
     hardcoded zeros here — that bug class is gone) */
  var leads = deals.length;
  return c.json(200, {
    deals: deals,
    metrics: {
      leads: leads,
      quoted: quoted,
      paid: paid,
      pipelineValue: round2(pipeline),
      collectedValue: round2(collected),
      quoteRate: leads ? Math.round((quoted / leads) * 100) : 0,
      closeRate: quoted ? Math.round((paid / quoted) * 100) : 0,
    },
  });
}

/* GET /api/agmx/audit */
function getAudit(c) {
  var dao = $app;
  var org = ensureOperatorOrg(dao);
  var ref = qp(c, "ref");
  var token = qp(c, "t");
  var op = operatorOf(c, org.id);

  if (ref) authedLead(c, dao, org, ref, token);      // token OR operator
  else if (!op) throw new ForbiddenError("Operator sahaja.");

  var rows = [];
  try {
    if (ref) {
      rows = dao.findRecordsByFilter(
        "audit_events", 'organizationId={:o} && payload.lead={:r}',
        "-occurredAt", 200, 0, { o: org.id, r: ref });
    } else {
      rows = dao.findRecordsByFilter(
        "audit_events", "organizationId={:o}", "-occurredAt", 200, 0, { o: org.id });
    }
  } catch (e) { rows = []; }

  var events = [];
  for (var i = 0; i < rows.length; i++) events.push(eventShape(rows[i], rows.length - i));
  return c.json(200, { events: events });
}

module.exports = {
  submitAssessment: submitAssessment,
  getLead: getLead,
  createQuote: createQuote,
  getQuote: getQuote,
  acceptQuote: acceptQuote,
  createInvoice: createInvoice,
  getInvoice: getInvoice,
  createPayment: createPayment,
  confirmPayment: confirmPayment,
  /* Billplz gateway — money_flow.pb.js routes call these via require(). */
  createPaymentLink: createPaymentLink,
  paymentCallback: paymentCallback,
  updateStage: updateStage,
  listDeals: listDeals,
  getAudit: getAudit,
};
