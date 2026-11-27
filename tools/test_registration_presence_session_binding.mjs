#!/usr/bin/env node
/* ============================================================
   AGMX — registration & presence session-binding test

   /registration and /presence must bind memberId to the session-linked
   member (resolved from organization_members via the caller's JWT):

     * a non-operator that omits memberId is bound to its own member row;
     * a non-operator that injects someone else's memberId in the body is
       ignored and still bound to its own session member;
     * an operator may pass memberId in the body and it is honoured;
     * a member login with no organization_members link is refused (403).

   Driven through supabase/functions/governance/index.ts as written (only its
   three imports and Deno.env are stubbed) against real Postgres via PGlite.

   Nothing touches the network.

   Usage:  node tools/test_registration_presence_session_binding.mjs
   ============================================================ */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { bootDatabase, makeRestClient, seedUser } from "./agmx_db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = {
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

/* ---------- 2. load the governance Edge Function as written ---------- */
section("2. Edge Function source");
const STUBS = {
  serve: "const serve = (h) => { globalThis.__agmxHandler = h };",
  createClient: "const createClient = (url, key) => globalThis.__agmxRest;",
  corsHeaders: 'const corsHeaders = { "Access-Control-Allow-Origin": "*" };',
};
globalThis.__agmxRest = rest;
globalThis.__agmxEnv = new Map([
  ["SUPABASE_URL", ORIGIN],
  ["SUPABASE_SERVICE_ROLE_KEY", "service-role-key"],
]);

if (!globalThis.crypto) globalThis.crypto = webcrypto;

/* ---------- TypeScript erasure ---------- */
// The Edge Function source is .ts: interfaces, parameter/return type
// annotations and `as` casts do not parse under bare Node, so erase them
// before the temp file is imported. Types are compile-time only.
function stripTsDeclarations(source) {
  const out = [];
  let pos = 0;
  const DECL = /^\s*(interface|enum|type)\b/gm;
  while (pos < source.length) {
    DECL.lastIndex = pos;
    const m = DECL.exec(source);
    if (!m) { out.push(source.slice(pos)); break; }
    out.push(source.slice(pos, m.index));
    const kind = m[1];
    let j = m.index + m[0].length;
    if (kind === "type") {
      const semi = source.indexOf(";", j);
      j = semi === -1 ? source.length : semi + 1;
    } else {
      const brace = source.indexOf("{", j);
      if (brace === -1) {
        j = source.length;
      } else {
        let depth = 0, k = brace;
        while (k < source.length) {
          const ch = source[k];
          if (ch === "{") depth += 1;
          else if (ch === "}") { depth -= 1; if (depth === 0) { k += 1; break; } }
          else if (ch === "/" && source[k + 1] === "/") {
            const nl = source.indexOf("\n", k + 1);
            k = nl === -1 ? source.length : nl;
          } else if (ch === "/" && source[k + 1] === "*") {
            const close = source.indexOf("*/", k + 2);
            k = close === -1 ? source.length : close + 2;
          } else if (ch === '"' || ch === "'" || ch === "`") {
            const end = source.indexOf(ch, k + 1);
            k = end === -1 ? source.length : end + 1;
          }
          k += 1;
        }
        j = k;
      }
    }
    pos = j;
    if (source[pos] === "\n") pos += 1;
  }
  return out.join("");
}

function typeArgEnd(source, i, n) {
  let depth = 1, k = i + 1, hasComma = false;
  while (k < n) {
    const c2 = source[k];
    if (c2 === "<") depth++;
    else if (c2 === ">") { depth--; if (depth === 0) break; }
    else if (c2 === ",") hasComma = true;
    else if (!/[a-zA-Z0-9_$.\[\]?|& \t]/.test(c2)) return -1;
    k++;
  }
  if (depth !== 0) return -1;
  if (!hasComma) {
    let m = k + 1;
    while (m < n && source[m] === " ") m++;
    const next = source[m];
    if (next !== undefined && next !== "(" && next !== "." && next !== "," && next !== ";" && next !== ")" && next !== "]" && next !== "}") return -1;
  }
  return k + 1;
}

function stripTsTypes(source) {
  const out = [];
  let i = 0, n = source.length;
  let paren = 0, brace = 0, bracket = 0, angle = 0;
  let objDepth = 0;
  let inStr = null, inLine = false, inBlock = false;
  let prev = null;
  let pendingParam = false;
  let ternaryDepth = 0;
  const ctxStack = [];

  function scanType(termSet, allowTypeLiteralBrace) {
    const start = { paren, brace, bracket, angle };
    while (i < n) {
      const ch = source[i];
      if (inLine) { if (ch === "\n") inLine = false; i++; continue; }
      if (inBlock) { if (ch === "*" && source[i + 1] === "/") { inBlock = false; i += 2; continue; } i++; continue; }
      if (inStr) { if (ch === "\\") { i += 2; continue; } if (ch === inStr) inStr = null; i++; continue; }
      if (ch === "/" && !inStr && i + 1 < n && source[i + 1] === "/") { inLine = true; i += 2; continue; }
      if (ch === "/" && !inStr && i + 1 < n && source[i + 1] === "*") { inBlock = true; i += 2; continue; }
      if (ch === "{") {
        if (brace === start.brace && allowTypeLiteralBrace && !looksLikeTypeMember()) return;
        brace++; i++; continue;
      }
      if (paren === start.paren && brace === start.brace && bracket === start.bracket && angle === start.angle && termSet.indexOf(ch) !== -1) return;
      if (ch === "(") { paren++; i++; continue; }
      if (ch === ")") { if (paren > start.paren) paren--; else return; i++; continue; }
      if (ch === "[") { bracket++; i++; continue; }
      if (ch === "]") { if (bracket > start.bracket) bracket--; else return; i++; continue; }
      if (ch === "<") { angle++; i++; continue; }
      if (ch === ">") { if (angle > start.angle) angle--; i++; continue; }
      i++;
    }
  }

  function isObjectBrace() {
    let k = i - 1;
    while (k >= 0 && /\s/.test(source[k])) k--;
    if (k < 0) return true;
    const p = source[k];
    if (p === ">" && source[k - 1] === "=") return false;
    if (p === "(" || p === "=" || p === "," || p === "{" || p === "[" || p === ":") return true;
    if (/[a-zA-Z_$]/.test(p)) {
      const word = source.slice(Math.max(0, k - 7), k + 1);
      return /\b(?:return|const|let|var)\s*$/.test(word);
    }
    return false;
  }

  function looksLikeTypeMember() {
    let j = i + 1;
    while (j < n && source[j] === " ") j++;
    if (j >= n) return false;
    const c = source[j];
    if (c === "}" || c === "[" || c === '"' || c === "'" || c === "`") return true;
    if (/[a-zA-Z_$]/.test(c)) {
      let k = j;
      while (k < n && /[a-zA-Z0-9_$]/.test(source[k])) k++;
      while (k < n && source[k] === " ") k++;
      return k < n && (source[k] === ":" || source[k] === "?");
    }
    return false;
  }

  while (i < n) {
    const ch = source[i];
    if (!inStr && !inLine && !inBlock && ch === "/" && i + 1 < n && source[i + 1] === "/") { inLine = true; out.push("/"); out.push("/"); i += 2; continue; }
    if (!inStr && !inLine && !inBlock && ch === "/" && i + 1 < n && source[i + 1] === "*") { inBlock = true; out.push("/"); out.push("*"); i += 2; continue; }
    if (inLine) { out.push(ch); if (ch === "\n") inLine = false; i++; continue; }
    if (inBlock) {
      if (ch === "*" && i + 1 < n && source[i + 1] === "/") { out.push("*"); out.push("/"); inBlock = false; i += 2; continue; }
      out.push(ch); i++; continue;
    }
    if (!inStr && (ch === '"' || ch === "'" || ch === "`")) { inStr = ch; out.push(ch); i++; continue; }
    if (inStr) { out.push(ch); if (ch === "\\") { out.push(source[i + 1] || ""); i += 2; continue; } if (ch === inStr) inStr = null; i++; continue; }
    if (ch === "(") {
      paren++; out.push(ch); prev = "(";
      let m = i + 1;
      while (m < n && source[m] === " ") m++;
      pendingParam = /[a-zA-Z_$]/.test(source[m] || "");
      i++; continue;
    }
    if (ch === ")") { paren--; out.push(ch); prev = ")"; pendingParam = false; i++; continue; }
    if (ch === "{") {
      brace++;
      const kind = isObjectBrace();
      ctxStack.push(kind ? "obj" : "blk");
      if (kind) objDepth++;
      out.push(ch); prev = "{"; pendingParam = false; i++; continue;
    }
    if (ch === "}") {
      brace--;
      if (ctxStack.pop() === "obj") objDepth--;
      out.push(ch); prev = "}"; pendingParam = false; i++; continue;
    }
    if (ch === "[") { bracket++; out.push(ch); prev = "["; pendingParam = false; i++; continue; }
    if (ch === "]") { bracket--; out.push(ch); prev = "]"; pendingParam = false; i++; continue; }
    if (ch === "<") {
      const end = prev === "ident" ? typeArgEnd(source, i, n) : -1;
      if (end !== -1) { i = end; continue; }
      angle++; out.push(ch); prev = "<"; i++; continue;
    }
    if (ch === ">") { angle--; out.push(ch); prev = ">"; i++; continue; }

    if (ch === "?") {
      let k = i + 1;
      while (k < n && source[k] === " ") k++;
      const nxt = source[k];
      if (nxt === ":" && prev === "ident") {
        i = k + 1;
        while (i < n && source[i] === " ") i++;
        scanType([")", ",", "=", "\n"]);
        prev = "ident";
        pendingParam = false;
        continue;
      }
      if (nxt === "?") { out.push("??"); prev = "?"; i += 2; continue; }
      if (nxt === ".") { out.push(ch); prev = "?"; i++; continue; }
      ternaryDepth++;
      out.push(ch); prev = "?"; i++; continue;
    }

    if (ch === "a" && source.slice(i, i + 3) === "as " &&
        (prev === null || prev === "ident" || prev === "number" || prev === ")" || prev === "}" || prev === "]" || prev === ">" || prev === "." || prev === " ")) {
      i += 3;
      while (i < n && source[i] === " ") i++;
      scanType([")", ",", "]", "}", ";", "\n", "="]);
      prev = "ident";
      continue;
    }

    if (ch === ":") {
      i++;
      while (i < n && source[i] === " ") i++;
      if (ternaryDepth > 0) { ternaryDepth--; out.push(":"); prev = ":"; continue; }
      if (prev === "?") { out.push(":"); prev = ":"; pendingParam = false; continue; }
      if (prev === ")") {
        scanType(["{", "="], true);
        prev = "ident";
        pendingParam = false;
        continue;
      }
      if (pendingParam) {
        scanType([")", ",", "="]);
        prev = "ident";
        pendingParam = false;
        continue;
      }
      if (objDepth === 0 && (prev === "ident" || prev === "number")) {
        scanType(["=", ",", ";", "\n"]);
        prev = "ident";
        continue;
      }
      out.push(":");
      prev = ":";
      continue;
    }

    if (ch === "!" &&
        (prev === "ident" || prev === "number" || prev === ")" || prev === "]" || prev === "}") &&
        source[i + 1] !== "=") {
      i++; continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_$]/.test(source[j])) j++;
      out.push(source.slice(i, j));
      prev = "ident";
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) { prev = "number"; pendingParam = false; out.push(ch); i++; continue; }
    if (ch === ",") { prev = ","; pendingParam = paren > 0 && objDepth === 0; out.push(ch); i++; continue; }
    if (ch === ".") { prev = "."; out.push(ch); i++; continue; }
    if (ch === "=") { prev = "="; pendingParam = false; out.push(ch); i++; continue; }
    if (ch === ";") { prev = ";"; pendingParam = false; out.push(ch); i++; continue; }
    out.push(ch);
    prev = ch;
    i++;
  }
  return out.join("");
}

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
  const typed = stripTsTypes(stripTsDeclarations(stubbed));
  const js = typed.replace(/Deno\.env\.get\(/g, "globalThis.__agmxEnv.get(").replace(/\)!/g, ")");
  if (/^\s*import\s/m.test(js)) throw new Error(`${name}: a real import survived the stub pass`);
  if (js.includes("Deno.")) throw new Error(`${name}: a Deno API call survived the stub pass`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agmx-binding-"));
  const file = path.join(dir, `${name}.js`);
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
ok(loaded.join() === "governance", `loaded governance handler from source`);

/* ---------- 3. gateway stub: no test may reach the network ---------- */
const gatewayCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (!target.startsWith("https://api.hitpay.test/")) {
    throw new Error(`binding test refused a network call to ${target}`);
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

/* ---------- 4. seed one cooperative, its members, and linked logins ---------- */
section("3. Seed cooperative, members and linked logins");
const { data: org } = await rest.from("organizations").insert({ slug: "coop-session", name: "Koperasi Session Bhd" }).select("id").single();
const orgId = org.id;
const roster = [
  { member_no: "SSN-001", name: "Ahli Satu", eligible: true, status: "Aktif" },
  { member_no: "SSN-002", name: "Ahli Dua", eligible: true, status: "Aktif" },
  { member_no: "SSN-003", name: "Ahli Tiga", eligible: true, status: "Aktif" },
  { member_no: "SSN-004", name: "Ahli Empat", eligible: true, status: "Aktif" },
  { member_no: "SSN-005", name: "Ahli Lima", eligible: true, status: "Aktif" },
  { member_no: "SSN-006", name: "Ahli Enam", eligible: true, status: "Aktif" },
  { member_no: "SSN-007", name: "Ahli Tujuh", eligible: true, status: "Aktif" },
  { member_no: "SSN-008", name: "Ahli Lapan", eligible: true, status: "Aktif" },
];
await rest.from("members").insert(roster.map((m) => ({ ...m, organization_id: orgId })));
const { data: memberRows } = await rest.from("members").select("id").eq("organization_id", orgId).order("member_no");
const M = memberRows.map((r) => r.id);
eq(M.length, 8, "eight members seeded");

const { data: resigned } = await rest.from("members").insert({
  organization_id: orgId, member_no: "SSN-009", name: "Ahli Berhenti", eligible: false, status: "Beku",
}).select("id").single();

const voters = [];
for (const idx of [0, 1, 2]) {
  const id = USER.member[idx];
  await seedUser(db, { id });
  await rest.from("profiles").insert({ id, organization_id: orgId, full_name: `Ahli ${idx + 1}`, role: "member" });
  await rest.from("organization_members").insert({ organization_id: orgId, user_id: id, member_id: M[idx], role: "member" });
  voters.push(rest.registerActor({ id }));
}

/* The operator holds a login in this org too (session-linked member M[3]). */
await seedUser(db, { id: USER.operator });
await rest.from("profiles").insert({ id: USER.operator, organization_id: orgId, full_name: "Nurul Hidayah", role: "secretary" });
await rest.from("organization_members").insert({ organization_id: orgId, user_id: USER.operator, member_id: M[3], role: "secretary" });
const OP = rest.registerActor({ id: USER.operator });

/* A login with a profile in this org but no organization_members link: it has
   a session, but no member to bind to. */
const UNLINKED_ID = "55555555-5555-4555-8555-555555555555";
await seedUser(db, { id: UNLINKED_ID });
await rest.from("profiles").insert({ id: UNLINKED_ID, organization_id: orgId, full_name: "Ahli Tanpa Pautan", role: "member" });
const UNLINKED = rest.registerActor({ id: UNLINKED_ID });

/* ---------- 5. schedule an AGM ---------- */
section("4. Schedule an AGM");
const created = await call("governance", "/agm", {
  as: OP,
  body: {
    title: "AGM Ujian Session-Binding", edition: 1, fiscalYear: "2026",
    scheduledAt: "2026-12-15T09:00:00+08:00", venue: "Dewan Ujian", mode: "physical",
    quorumPct: 25, noticeDays: 21,
  },
});
eq(created.status, 201, "AGM created by the operator");
const agmId = created.json.agm.id;

/* ---------- 6. /registration session binding ---------- */
section("5. /registration binds to the session-linked member");

const regOp = await call("governance", "/registration", { as: OP, body: { agmId, memberId: M[0], status: "rsvp" } });
eq(regOp.status, 200, "operator may register a member by body memberId");
eq(regOp.json.registered, true, "operator registration is accepted");
eq(regOp.json.member_id, M[0], "operator registration records the body's member");

const regSelf = await call("governance", "/registration", { as: voters[0], body: { agmId } });
eq(regSelf.status, 200, "member without body memberId is bound to the session's own member");
eq(regSelf.json.member_id, M[0], "registration records the session-linked member, not an injected one");

const regInjected = await call("governance", "/registration", { as: voters[0], body: { agmId, memberId: M[1] } });
eq(regInjected.status, 200, "an injected memberId is ignored for a non-operator");
eq(regInjected.json.member_id, M[0], "registration records the session-linked member M[0], not the injected M[1]");

const regUnlinked = await call("governance", "/registration", { as: UNLINKED, body: { agmId, memberId: M[0] } });
eq(regUnlinked.status, 403, "a member login with no organization_members link is refused");
eq(regUnlinked.json.error, "No member record linked to your account", "unlinked login gets the link error");

const noAgm = await call("governance", "/registration", { as: OP, body: { memberId: M[0] } });
eq(noAgm.status, 400, "missing agmId is rejected");

const { data: regRows } = await rest.from("registrations").select("member_id").eq("agm_id", agmId).order("member_id");
eq(regRows.length, 1, "registrations holds exactly one row for this member+AGM (upserted, not duplicated)");
eq(regRows[0].member_id, M[0], "the stored registration is the session-bound member M[0]");

/* ---------- 7. /presence session binding ---------- */
section("6. /presence binds to the session-linked member");

const presOp = await call("governance", "/presence", { as: OP, body: { agmId, memberId: M[0], method: "digital" } });
eq(presOp.status, 200, "operator may check in a member by body memberId");
eq(presOp.json.checked_in, true, "operator presence is accepted");
eq(presOp.json.member_id, M[0], "operator check-in records the body's member");

const presSelf = await call("governance", "/presence", { as: voters[1], body: { agmId } });
eq(presSelf.status, 200, "member without body memberId checks in as the session's own member");
eq(presSelf.json.member_id, M[1], "check-in records the session-linked member");

const presInjected = await call("governance", "/presence", { as: voters[1], body: { agmId, memberId: M[2] } });
eq(presInjected.status, 200, "an injected memberId is ignored for a non-operator at check-in");
eq(presInjected.json.member_id, M[1], "check-in records the session-linked member M[1], not the injected M[2]");

const presUnlinked = await call("governance", "/presence", { as: UNLINKED, body: { agmId, memberId: M[0] } });
eq(presUnlinked.status, 403, "an unlinked member login cannot check in");
eq(presUnlinked.json.error, "No member record linked to your account", "unlinked login gets the link error");

const { data: presRows } = await rest.from("presence_events").select("member_id").eq("agm_id", agmId);
eq(presRows.length, 3, "three check-in events were written");
ok(!presRows.some((r) => r.member_id === M[2]), "the injected member M[2] never has a presence event");

/* ---------- 8. report ---------- */
section("7. Report");
globalThis.fetch = realFetch;
console.log(`\n${passed} assertions passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  FAILED: " + f);
  process.exit(1);
}
await db.close();
