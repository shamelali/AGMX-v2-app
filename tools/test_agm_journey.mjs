#!/usr/bin/env node
/* ============================================================
   AGMX — end-to-end MVP journey test

   The acceptance test AGMX_V2_PLAN.md §9 asks for:

     assessment → payment → AGM scheduled → meeting run → minutes produced

   is driven here through the files that actually ship:

     * supabase/schema_final.sql  (the deploy bundle) runs on real Postgres,
       via tools/agmx_db.mjs, before anything else happens.
     * supabase/functions/money-flow/index.ts and
       supabase/functions/governance/index.ts are loaded as written — the only
       substitution is their three imports and Deno.env — and are driven with
       real Request objects through the handler they pass to serve().
     * Every read and write those handlers make compiles to SQL against the
       live catalog, so the quorum maths, voting windows, ballot secrecy,
       resolution thresholds, idempotency lock and audit chain are decided by
       the plpgsql that a cooperative's real meeting would run.

   Nothing touches the network: the HitPay call is served by a local stub that
   records the request payload so it can be asserted, and the webhook is signed
   with a test salt and verified by the function's own HMAC check.

   Usage:  node tools/test_agm_journey.mjs
           AGMX_TRACE_SQL=1 node tools/test_agm_journey.mjs   (print compiled SQL)
   ============================================================ */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootDatabase, makeRestClient, seedUser } from "./agmx_db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = {
  "money-flow": path.join(here, "..", "supabase", "functions", "money-flow", "index.ts"),
  governance: path.join(here, "..", "supabase", "functions", "governance", "index.ts"),
};

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); }
  else { failures.push(label); console.error("  ✗ " + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function section(title) { console.log(`\n${title}`); }

const TAX = 0.08;
const HITPAY_SALT = "journey-test-salt";
const ORIGIN = "https://agmx.test";

/* auth.users.id is a uuid, and profiles/organization_members key off it, so
   every actor here needs a real one — unlike an in-memory stub. */
const USER = {
  operator: "11111111-1111-4111-8111-111111111111",
  member: [
    "22222222-2222-4222-8222-222222222221",
    "22222222-2222-4222-8222-222222222222",
    "22222222-2222-4222-8222-222222222223",
  ],
  resigned: "33333333-3333-4333-8333-333333333333",
  rival: "44444444-4444-4444-8444-444444444444",
};

/* ---------- 1. boot the real deploy bundle ---------- */
section("1. Deploy bundle");
const { db, stats } = await bootDatabase();
const rest = makeRestClient(db);
ok(stats.statements > 150, `bundle executed ${stats.statements} statements on real Postgres`);
ok(stats.claims.tables > 30 && stats.claims.policies > 30,
  `every claimed object exists (${stats.claims.tables} tables, ${stats.claims.functions} functions, ${stats.claims.policies} policies)`);
ok(stats.skippedSections.join() === "0002_knowledge.sql",
  "only the pgvector knowledge section is unavailable to PGlite");

/* ---------- 2. load both Edge Functions as written ---------- */
section("2. Edge Function sources");
const STUBS = {
  serve: "const serve = (h) => { globalThis.__agmxHandler = h };",
  createClient: "const createClient = (url, key) => globalThis.__agmxRest;",
  corsHeaders: 'const corsHeaders = { "Access-Control-Allow-Origin": "*" };',
};
globalThis.__agmxRest = rest;
globalThis.__agmxEnv = new Map([
  ["SUPABASE_URL", ORIGIN],
  ["SUPABASE_SERVICE_ROLE_KEY", "service-role-key"],
  ["APP_URL", "https://app.test"],
  ["BILLPLZ_API_KEY", ""],
  ["BILLPLZ_COLLECTION_ID", ""],
  ["BILLPLZ_API_URL", "https://billplz.test"],
  ["BILLPLZ_X_SIGNATURE", ""],
  ["HITPAY_API_KEY", "hp-key"],
  ["HITPAY_API_URL", "https://api.hitpay.test"],
  ["HITPAY_SALT", HITPAY_SALT],
]);

const handlers = {};
function load(name) {
  const raw = fs.readFileSync(SOURCES[name], "utf8");
  const stubbed = raw.replace(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?\s*$/gm, (_m, names) =>
    names.split(",").map((n) => {
      const ident = n.trim();
      if (!STUBS[ident]) throw new Error(`${name}: harness has no stub for import "${ident}"`);
      return STUBS[ident];
    }).join("\n"),
  );
  const js = stubbed.replace(/Deno\.env\.get\(/g, "globalThis.__agmxEnv.get(");
  if (/^\s*import\s/m.test(js)) throw new Error(`${name}: a real import survived the stub pass`);
  if (js.includes("Deno.")) throw new Error(`${name}: a Deno API call survived the stub pass`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agmx-journey-"));
  const file = path.join(dir, `${name}.mts`);
  fs.writeFileSync(file, js);
  return file;
}

const loaded = [];
for (const name of Object.keys(SOURCES)) {
  globalThis.__agmxHandler = undefined;
  await import(pathToFileURL(load(name)).href);
  if (typeof globalThis.__agmxHandler !== "function") throw new Error(`${name}: serve() handler was never registered`);
  handlers[name] = globalThis.__agmxHandler;
  loaded.push(name);
}
ok(loaded.join() === "money-flow,governance", `loaded both handlers from source: ${loaded.join(", ")}`);

/* ---------- 3. gateway stub: no test may reach the network ---------- */
const gatewayCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (!target.startsWith("https://api.hitpay.test/")) {
    throw new Error(`journey test refused a network call to ${target}`);
  }
  const form = Object.fromEntries(new URLSearchParams(init.body));
  gatewayCalls.push({ url: target, headers: init.headers, form });
  return new Response(JSON.stringify({ id: `hp_${form.reference_number}`, url: `https://pay.hitpay.test/${form.reference_number}` }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

async function call(name, route, { method = "POST", as, query = "", body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (as) h.Authorization = `Bearer ${as}`;
  let payload;
  if (raw !== undefined) { payload = raw; h["Content-Type"] = "application/json"; }
  else if (body !== undefined) { payload = JSON.stringify(body); h["Content-Type"] = "application/json"; }
  const res = await handlers[name](new Request(`${ORIGIN}/functions/v1/${name}${route}${query}`, { method, headers: h, body: payload }));
  let json = null;
  try { json = await res.json(); } catch { /* bodies we do not read */ }
  return { status: res.status, json };
}

async function sign(body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(HITPAY_SALT), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- 4. the prospect pays ---------- */
section("3. Assessment → quote → invoice → payment (money-flow)");
const assessment = await call("money-flow", "/assessment", {
  body: {
    coopName: "Koperasi Jaya Sentosa Bhd", coopReg: "PLRT-0123456", state: "Selangor",
    members: 320, agmDate: "2026-12-15", mode: "hybrid", expectedAttendance: 60,
    candidates: 5, motions: 4, currentProcess: "manual", needsManaged: true,
    contactName: "Aina binti Yusof", contactPhone: "0123456789", contactEmail: "aina@koperasi.example",
  },
});
eq(assessment.status, 201, "POST /assessment returns 201");
const lead = assessment.json;
ok(/^LD-/.test(lead.reference), `lead reference issued: ${lead.reference}`);
const { data: stored } = await rest.from("agm_assessments").select("*, quotes(id)").eq("id", lead.assessmentId).single();
eq(stored.status, "lead", "assessment row persists with status lead");
eq(stored.organization_id, null, "an unclaimed lead has no organization yet");
eq(stored.complexity_score, lead.complexityScore, "complexity score is what the handler reported");

const PROSPECT = `?ref=${encodeURIComponent(lead.reference)}&t=${encodeURIComponent(lead.token)}`;
const quoted = await call("money-flow", "/quote", { query: PROSPECT, body: { planCode: lead.recommendedPlan } });
eq(quoted.status, 201, "prospect POST /quote with its own token returns 201");
const { data: plan } = await rest.from("plans").select("*").eq("code", lead.recommendedPlan).single();
const subtotal = plan.price_oneoff;
const tax = Math.round(subtotal * TAX * 100) / 100;
eq(quoted.json.total, subtotal + tax, `quote total is RM${subtotal} + ${TAX * 100}% SST = RM${subtotal + tax}`);
eq(quoted.json.number.startsWith("QT-"), true, `quote number issued: ${quoted.json.number}`);

const orgId = (await rest.from("agm_assessments").select("organization_id").eq("id", lead.assessmentId).single()).data.organization_id;
ok(orgId && orgId !== null, "quoting the lead created and claimed its organization");
const { data: orgRow } = await rest.from("organizations").select("id, name, slug, registration_no").eq("id", orgId).single();
eq(orgRow.name, "Koperasi Jaya Sentosa Bhd", "organization carries the cooperative's name");
const items = await rest.from("quote_items").select("*").eq("quote_id", quoted.json.quoteId);
eq(items.data.length, 1, "one quote line item written");

eq((await call("money-flow", "/quote/accept", { query: PROSPECT, body: { quoteId: quoted.json.quoteId } })).status, 200, "prospect accepts the quote");
const invoiced = await call("money-flow", "/invoice", { query: PROSPECT, body: { quoteId: quoted.json.quoteId } });
eq(invoiced.status, 201, "POST /invoice returns 201");
eq(invoiced.json.amount, subtotal + tax, "invoice bills the quoted total");
const invoiceId = invoiced.json.invoiceId;
eq((await rest.from("agm_assessments").select("status").eq("id", lead.assessmentId).single()).data.status, "invoiced", "lead advanced to invoiced");

const intent = await call("money-flow", "/payment/intent", { query: PROSPECT, body: { invoiceId, method: "card" } });
eq(intent.status, 200, "POST /payment/intent returns a checkout URL");
eq(gatewayCalls.length, 1, "exactly one HitPay payment-request was created");
eq(gatewayCalls[0].form.amount, (subtotal + tax).toFixed(2), "HitPay was asked for the invoice amount in RM");
eq(gatewayCalls[0].form.currency, "MYR", "HitPay charge is denominated in MYR");
eq(gatewayCalls[0].form.reference_number, invoiceId, "HitPay carries the invoice id as its reference");
ok(intent.json.paymentUrl.includes("pay.hitpay.test"), "the gateway URL is handed back to the checkout page");

const webhook = { reference_number: invoiceId, id: `hp_${invoiceId}`, status: "completed", payments: [{ id: "txn_777" }] };
const webhookBody = JSON.stringify(webhook);

const forged = await call("money-flow", "/payment/confirm", {
  query: "?gateway=hitpay", raw: webhookBody, headers: { "hitpay-signature": "f".repeat(64) },
});
eq(forged.status, 403, "a webhook with a forged signature is refused");
eq((await rest.from("invoices").select("status").eq("id", invoiceId).single()).data.status, "unpaid", "the forged webhook paid nothing");

const paid = await call("money-flow", "/payment/confirm", {
  query: "?gateway=hitpay", raw: webhookBody, headers: { "hitpay-signature": await sign(webhookBody) },
});
eq(paid.status, 200, "a correctly signed HitPay webhook is accepted");
eq(paid.json.status, "succeeded", "the webhook reports the payment as succeeded");
const { data: invoiceRow } = await rest.from("invoices").select("status, paid_at").eq("id", invoiceId).single();
eq(invoiceRow.status, "paid", "invoice marked paid by the RPC");
ok(invoiceRow.paid_at !== null, "invoice records when it was paid");
eq((await rest.from("agm_assessments").select("status").eq("id", lead.assessmentId).single()).data.status, "won", "the deal is won");
const { data: succeeded } = await rest.from("payments").select("status, gateway, txn_id, amount").eq("invoice_id", invoiceId).eq("status", "succeeded");
eq(succeeded.length, 1, "one succeeded payment row");
eq(succeeded[0].txn_id, "txn_777", "the gateway transaction id is stored");

const replay = await call("money-flow", "/payment/confirm", {
  query: "?gateway=hitpay", raw: webhookBody, headers: { "hitpay-signature": await sign(webhookBody) },
});
eq(replay.json.status, "duplicate", "replaying the same webhook is idempotent");
eq((await rest.from("payments").select("id").eq("invoice_id", invoiceId).eq("status", "succeeded")).data.length, 1,
  "the replay did not charge the invoice twice");

/* ---------- 5. the meeting is scheduled and run ---------- */
section("4. AGM scheduled → meeting run (governance)");
await seedUser(db, { id: USER.operator, email: "setiausaha@koperasi.example" });
await rest.from("profiles").insert({ id: USER.operator, organization_id: orgId, full_name: "Nurul Hidayah", role: "secretary" });
const OP = rest.registerActor({ id: USER.operator });

const roster = [];
for (let i = 1; i <= 8; i++) {
  roster.push({ member_no: `ANG-00${i}`, name: `Ahli ${i}`, ic: `90010${i}-10-500${i}`, eligible: true, shares: 100 * i });
}
await rest.from("members").insert(roster.map((m) => ({ ...m, organization_id: orgId })));
const { data: memberRows } = await rest.from("members").select("id, member_no").eq("organization_id", orgId).order("member_no");
const M = memberRows.map((r) => r.id);
/* A 9th member has resigned: still a member, but not eligible to vote. */
const { data: resigned } = await rest.from("members").insert({
  organization_id: orgId, member_no: "ANG-009", name: "Ahli Berhenti", eligible: false, status: "Beku",
}).select("id").single();

/* three members hold logins, so votes are bound to their session */
const voters = [];
for (const idx of [0, 1, 2]) {
  const id = USER.member[idx];
  await seedUser(db, { id });
  await rest.from("profiles").insert({ id, organization_id: orgId, full_name: `Ahli ${idx + 1}`, role: "member" });
  await rest.from("organization_members").insert({ organization_id: orgId, user_id: id, member_id: M[idx], role: "member" });
  voters.push(rest.registerActor({ id }));
}
await seedUser(db, { id: USER.resigned });
const { data: ghostLink } = await rest.from("organization_members").insert({
  organization_id: orgId, user_id: USER.resigned, member_id: resigned.id, role: "member",
}).select("member_id").single();
await rest.from("profiles").insert({ id: USER.resigned, organization_id: orgId, full_name: "Ahli Berhenti", role: "member" });
const GHOST = rest.registerActor({ id: USER.resigned });
eq(ghostLink.member_id, resigned.id, "the ineligible member is linked to a login");

const created = await call("governance", "/agm", {
  as: OP,
  body: {
    title: "AGM Tahunan ke-12", edition: 12, fiscalYear: "2026", scheduledAt: "2026-12-15T09:00:00+08:00",
    venue: "Dewan Serbaguna, Shah Alam", mode: "hybrid", quorumPct: 25, noticeDays: 21,
  },
});
eq(created.status, 201, "secretary schedules the AGM");
const agmId = created.json.agm.id;
eq(created.json.agm.status, "planned", "the AGM starts as planned");
eq(created.json.agm.settings, null, "no voting window exists before the meeting opens");
const agenda = (await rest.from("agenda_items").select("code, title").eq("agm_id", agmId).order("sort_order")).data;
eq(agenda.length, 9, "the statutory Malaysian agenda is seeded (AG-01…AG-09)");
eq(agenda[6].code, "AG-07", "AG-07 is the board election item");

eq((await call("governance", "/agm", { as: GHOST, body: { title: "AGM haram", edition: 1, scheduledAt: "2027-01-01T09:00:00+08:00" } })).status, 403,
  "an ordinary member cannot schedule an AGM");

const raised = await call("governance", "/motion", { as: OP, body: { agmId, title: "Pembentangan penyata kewangan 2026", type: "biasa", proposerId: M[0], seconderId: M[1] } });
eq(raised.status, 200, "motion raised");
eq(raised.json.code, "M-001", "motions are numbered M-001, M-002, … in the AGM");
eq(raised.json.status, "draf", "a new motion starts as a draft, not open for voting");
const motionA = raised.json;
const motionB = (await call("governance", "/motion", { as: OP, body: { agmId, title: "Bahagi lebih surplus sebagai dividen", type: "financial", proposerId: M[1], seconderId: M[2] } })).json;
const motionC = (await call("governance", "/motion", { as: OP, body: { agmId, title: "Pilihan raya 2 ahli lembaga", type: "election", proposerId: M[0] } })).json;

eq((await call("governance", "/motion/open-voting", { as: OP, body: { motionId: motionA.id } })).json.error, "AGM is not live",
  "voting cannot open while the AGM is only planned");
eq((await call("governance", "/vote", { as: voters[0], body: { motionId: motionA.id, choice: "ya" } })).json.error, "Voting window closed",
  "no ballot is accepted before the meeting starts");

eq((await call("governance", "/agm/start", { as: OP, body: { agmId } })).status, 200, "secretary opens the meeting");
const { data: settings } = await rest.from("agm_settings").select("voting_opens_at, voting_closes_at").eq("agm_id", agmId).single();
ok(settings.voting_opens_at !== null && settings.voting_closes_at === null, "the voting window is open and not yet closed");

eq((await call("governance", "/motion/open-voting", { as: OP, body: { motionId: motionA.id } })).json.status, "sedang diundi", "M-001 is put to the house");
eq((await call("governance", "/vote", { as: voters[0], body: { motionId: motionA.id, choice: "ya" } })).json.error, "Quorum not satisfied — voting blocked",
  "an AGM without quorum cannot vote");

const first = await call("governance", "/attendance", { as: OP, body: { agmId, memberId: M[0], method: "digital" } });
eq(first.json.satisfied, false, `1 of 8 eligible members is ${first.json.pct}% — below the 25% quorum`);
eq((await call("governance", "/vote", { as: voters[0], body: { motionId: motionA.id, choice: "ya" } })).json.error, "Quorum not satisfied — voting blocked",
  "the vote is still blocked one member short");

/* A member checking in sends no memberId: the handler resolves the login's own
   member row. Passing someone else's id in the body must not move the tally. */
const self = await call("governance", "/attendance", { as: voters[1], body: { agmId, memberId: M[5], method: "digital" } });
eq(self.json.present, 2, "the second member checked himself in, and an injected memberId was ignored");
eq(self.json.satisfied, true, `2 of 8 eligible members is ${self.json.pct}% — quorum satisfied`);
eq((await rest.from("attendance").select("id").eq("agm_id", agmId)).data.length, 2, "two attendance rows, and the body's member was not added");

const tally = { [motionA.id]: ["ya", "ya", "tidak"], [motionB.id]: ["ya", "ya", "tidak"], [motionC.id]: ["ya", "tidak", "kecuali"] };
async function castVotes(motionId) {
  for (let i = 0; i < 3; i++) {
    const res = await call("governance", "/vote", { as: voters[i], body: { motionId, choice: tally[motionId][i] } });
    eq(res.status, 200, `ballot ${i + 1} on ${motionId.slice(0, 8)} cast as ${tally[motionId][i]}`);
  }
}
await call("governance", "/motion/open-voting", { as: OP, body: { motionId: motionB.id } });
await call("governance", "/motion/open-voting", { as: OP, body: { motionId: motionC.id } });
await castVotes(motionA.id);
await castVotes(motionB.id);
await castVotes(motionC.id);

eq((await call("governance", "/vote", { as: voters[0], body: { motionId: motionA.id, choice: "tidak" } })).json.error, "Vote already cast",
  "a second ballot from the same member is refused");
eq((await call("governance", "/vote", { as: GHOST, body: { motionId: motionA.id, choice: "ya" } })).json.error, "Member not eligible",
  "a suspended member cannot vote");
eq((await call("governance", "/vote", { as: voters[0], body: { motionId: motionA.id, choice: "mungkin" } })).status, 400,
  "a choice outside ya/tidak/kecuali is refused");

/* ---------- 6. resolutions, minutes, compliance ---------- */
section("5. Resolutions, minutes and compliance");
const resA = (await call("governance", "/resolution", { as: OP, body: { motionId: motionA.id } })).json;
eq([resA.ya, resA.tidak, resA.kecuali, resA.passed].join(":"), "2:1:0:true", "an ordinary motion passes on a simple majority");
const resAgain = (await call("governance", "/resolution", { as: OP, body: { motionId: motionA.id } })).json;
eq(resAgain.error, "Motion is not in voting state", "minuting a motion twice is refused once it has been decided");
eq((await rest.from("resolutions").select("id").eq("motion_id", motionA.id)).data.length, 1,
  "and the AGM still holds exactly one resolution for it");

const resB = (await call("governance", "/resolution", { as: OP, body: { motionId: motionB.id } })).json;
eq([resB.ya, resB.tidak, resB.passed].join(":"), "2:1:true", "a financial motion at exactly two-thirds passes");
const resC = (await call("governance", "/resolution", { as: OP, body: { motionId: motionC.id } })).json;
eq([resC.ya, resC.tidak, resC.kecuali, resC.passed].join(":"), "1:1:1:false", "an election with equal ya and tidak fails, abstention counted");
eq((await rest.from("motions").select("status").eq("id", motionC.id).single()).data.status, "gagal", "the failed motion is recorded as gagal");

const doc = await call("governance", "/document", {
  as: OP,
  body: { agmId, category: "minutes", filename: "minit-agm-12.pdf", mime: "application/pdf", sizeBytes: 182_340, storagePath: "agm/minit-agm-12.pdf", sha256: "a".repeat(64) },
});
eq(doc.status, 200, "the signed minutes are filed in the document vault");
const action = await call("governance", "/action", { as: OP, body: { title: "Failkan penyata kewangan yang diluluskan", picId: M[1], dueDate: "2027-01-31", agmId, resolutionId: resA.id } });
eq(action.status, 200, "a follow-up action is created from the resolution");

const compliance = await call("governance", "/compliance/run", { as: OP, body: { agmId } });
eq(compliance.status, 200, "compliance checks run against Akta Koperasi 1993 rules");
const { data: checks } = await rest.from("compliance_checks").select("*, rule:compliance_rules(code, severity)").eq("agm_id", agmId).order("checked_at", { ascending: false });
const byRule = Object.fromEntries(checks.map((c) => [c.rule.code, c.result]));
eq(checks.length, 4, "four statutory rules evaluated");
eq(byRule.sec17_notice, "lulus", "21 days' notice satisfies s.17");
eq(byRule.gp14_quorum, "lulus", "quorum present satisfies GP 14");
eq(byRule.gp14b_motions, "amaran", "the motion raised without a seconder is flagged, not passed");
eq(byRule.akta1993_immutable, "belum_disemak", "record immutability reports itself as not evaluated rather than green");

eq((await call("governance", "/agm/close", { as: OP, body: { agmId } })).json.status, "closed", "the meeting is closed");
eq((await call("governance", "/vote", { as: voters[0], body: { motionId: motionA.id, choice: "ya" } })).json.error, "Voting window closed",
  "no ballot is accepted after the chair closes the meeting");
eq((await call("governance", "/agm/start", { as: OP, body: { agmId } })).json.error, "AGM already started or closed",
  "a closed AGM cannot be reopened");

/* ---------- 7. what the portal can now read back ---------- */
section("6. Read-back through the client contract");
const current = await call("governance", "/agm/current", { as: OP, method: "GET" });
eq(current.status, 200, "GET /agm/current serves the meeting");
eq(current.json.agm.status, "closed", "the read-back AGM is closed");
eq(current.json.agenda.length, 9, "the agenda is served in order");
eq(current.json.motions.length, 3, "three motions are served");
const motionByCode = Object.fromEntries(current.json.motions.map((m) => [m.code, m]));
eq(motionByCode["M-001"].proposer.name, "Ahli 1", "the proposer embed resolves through motions_proposer_id_fkey");
eq(motionByCode["M-003"].seconder, null, "a motion with no seconder reads back as null, not as the proposer");
eq(current.json.resolutions.length, 3, "three resolutions are minuted");
eq((await call("governance", `/agm/${agmId}/roster`, { as: OP, method: "GET" })).json.quorum.satisfied, true, "GET /roster reports the satisfied quorum snapshot");
eq((await call("governance", `/agm/${agmId}/resolutions`, { as: OP, method: "GET" })).json.resolutions.length, 3, "GET /resolutions serves the minutes of record");
const listChecks = (await call("governance", `/agm/${agmId}/compliance`, { as: OP, method: "GET" })).json;
eq(listChecks.checks.length, 4, "GET /compliance keeps one latest check per rule");
ok(listChecks.findings.length >= 1, `the missing seconder left ${listChecks.findings.length} open finding`);
const actionsList = (await call("governance", "/actions", { as: OP, method: "GET" })).json.actions;
eq(actionsList[0].pic.name, "Ahli 2", "GET /actions embeds the member responsible");
eq((await call("governance", "/documents", { as: OP, method: "GET" })).json.documents.length, 1, "GET /documents lists the filed minutes");

/* ---------- 8. the records cannot be rewritten ---------- */
section("7. Append-only and tenant boundaries");
const oneVote = (await rest.from("votes").select("id").eq("agm_id", agmId).limit(1).maybeSingle()).data;
const tamperVote = await rest.from("votes").update({ choice: "tidak" }).eq("id", oneVote.id).select("id");
ok(tamperVote.error && /Append-only/.test(tamperVote.error.message), "changing a cast ballot is refused by the trigger");
const audit = (await call("governance", `/agm/${agmId}/audit`, { as: OP, method: "GET" })).json.events;
ok(audit.length >= 12, `${audit.length} audit events recorded across the journey`);
const actions = [...new Set(audit.map((e) => e.action))];
for (const expected of ["quote.created", "invoice.created", "agm.started", "motion.created", "resolution.recorded", "compliance.run", "agm.closed"]) {
  ok(actions.includes(expected), `audit trail contains ${expected}`);
}
/* The lead's own event predates any organization, so the tenant-scoped view
   above cannot show it — NULL organization_id matches no cooperative. It must
   still be on the record; before 0009_audit_all_stages it was rejected by a
   NOT NULL constraint and dropped in silence. */
const preOrg = await rest.from("audit_events").select("action").filter("organization_id", "is", "null");
ok((preOrg.data || []).some((e) => e.action === "assessment.submitted"),
  "assessment.submitted is written while the lead still has no organization");
const sameOrg = audit.filter((e) => e.organization_id === orgId).slice().reverse();
const hashes = new Set(sameOrg.map((e) => e.hash));
eq(hashes.size, sameOrg.length, "no two audit events share a hash");
const heads = sameOrg.filter((e) => e.prev_hash === null || e.prev_hash === "0".repeat(64));
eq(heads.length, 1, "the organization's audit log has exactly one chain head");
ok(sameOrg.filter((e) => e.prev_hash !== null && e.prev_hash !== "0".repeat(64)).every((e) => hashes.has(e.prev_hash)),
  "every later event links to a hash the log actually holds");
const tamperAudit = await rest.from("audit_events").update({ action: "agm.started" }).eq("id", sameOrg[1].id).select("id");
ok(tamperAudit.error && /Append-only/.test(tamperAudit.error.message), "rewriting an audit event is refused by the trigger");

/* A second cooperative, with its own secretary, must not see the first one's AGM. */
const orgB = (await rest.from("organizations").insert({ slug: "coop-rival", name: "Koperasi Rival Bhd" }).select("id").single()).data;
await seedUser(db, { id: USER.rival });
await rest.from("profiles").insert({ id: USER.rival, organization_id: orgB.id, full_name: "Lawan", role: "admin" });
const RIVAL = rest.registerActor({ id: USER.rival });
eq((await call("governance", `/agm/${agmId}/roster`, { as: RIVAL, method: "GET" })).status, 404, "another cooperative's secretary cannot read the roster");
eq((await call("governance", "/vote", { as: RIVAL, body: { motionId: motionA.id, choice: "ya" } })).json.error,
  "No member record linked to your account", "and has no member record with which to vote in it");
eq((await call("governance", "/agm/close", { as: RIVAL, body: { agmId } })).status, 404, "or close it");

/* ---------- 9. the harness is not asserting nothing ---------- */
section("8. Harness integrity");
ok(rest.executed.queries > 40, `${rest.executed.queries} SQL queries were compiled and run against Postgres`);
ok(rest.executed.rpcs > 12, `${rest.executed.rpcs} plpgsql RPC calls were executed`);
ok(rest.executed.embeds > 5, `${rest.executed.embeds} PostgREST embeds were resolved from live foreign keys`);
let escapeAttempted = false;
try { await globalThis.fetch("https://example.test/anything"); } catch { escapeAttempted = true; }
ok(escapeAttempted, "the fetch stub refuses any URL that is not the HitPay API, so nothing can leave this process");

globalThis.fetch = realFetch;
console.log(`\n${passed} assertions passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  FAILED: " + f);
  process.exit(1);
}
await db.close();
