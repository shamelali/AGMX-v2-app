#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "..", "supabase", "functions", "money-flow", "index.ts");
const SUBMISSION_ID = "1df1f7d4-94b2-4f36-a90d-bfcca2f5d201";
const INTERNAL_KEY = "intake-internal-test-key";

const tables = {
  plans: [
    { id: "11111111-1111-4111-8111-111111111111", code: "essential_agm" },
    { id: "22222222-2222-4222-8222-222222222222", code: "professional_agm" },
    { id: "33333333-3333-4333-8333-333333333333", code: "enterprise_agm" },
  ],
  agm_assessments: [],
  audit_events: [],
};

function makeClient() {
  const writes = [];
  const rpcCalls = [];
  function query(table) {
    const state = { table, filters: [], mode: "select", body: null, limitN: null };
    const rows = () => tables[table] || [];
    const matches = () => rows().filter((row) => state.filters.every(([key, value]) => row[key] === value));
    const builder = {
      select() { return builder; },
      eq(key, value) { state.filters.push([key, value]); return builder; },
      order() { return builder; },
      limit(value) { state.limitN = value; return builder; },
      insert(body) { state.mode = "insert"; state.body = body; return builder; },
      async single() { return resolve("one"); },
      async maybeSingle() { return resolve("one-or-none"); },
      then(onFulfilled, onRejected) { return Promise.resolve(resolve("many")).then(onFulfilled, onRejected); },
    };
    function resolve(shape) {
      if (state.mode === "insert") {
        if (state.body.submission_id && rows().some((row) => row.submission_id === state.body.submission_id)) {
          return { data: null, error: { code: "23505", message: "duplicate submission_id" } };
        }
        if (globalThis.__intakeInsertError) return globalThis.__intakeInsertError;
        const row = {
          id: `assessment-${rows().length + 1}`,
          created_at: new Date().toISOString(),
          ...state.body,
        };
        rows().push(row);
        writes.push({ table, op: "insert", row });
        return { data: row, error: null };
      }
      const found = matches();
      const slice = state.limitN === null ? found : found.slice(0, state.limitN);
      if (!slice.length) {
        return shape === "one"
          ? { data: null, error: { message: "no rows" } }
          : { data: shape === "one-or-none" ? null : [], error: null };
      }
      return { data: shape === "many" ? slice : slice[0], error: null };
    }
    return builder;
  }
  return {
    writes,
    from: query,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "check_rate_limit") return { data: globalThis.__intakeRateLimited ? false : true, error: null };
      return { data: null, error: null };
    },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
}

const STUBS = {
  serve: "const serve = (handler) => { globalThis.__intakeHandler = handler };",
  createClient: "const createClient = () => globalThis.__intakeClient;",
  corsHeaders: 'const corsHeaders = { "Access-Control-Allow-Origin": "*" };',
};

function stripTsDeclarations(source) {
  // Erases top-level TypeScript interface/enum/type declarations so the
  // .ts source parses as plain JavaScript. Types are compile-time only.
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

// Removes TypeScript type annotations (parameter types, return types, `as`
// casts, type predicates) so the source parses as plain JavaScript. Only
// strips at brace depth 0, so object-literal values and ternary `? :` inside
// function bodies are never touched. Types are compile-time only.
function stripTsTypes(source) {
  const out = [];
  let i = 0, n = source.length;
  let paren = 0, brace = 0, bracket = 0, angle = 0;
  let objDepth = 0;
  let inStr = null, inLine = false, inBlock = false;
  let prev = null; // null | 'ident' | 'number' | ')' | '?' | ',' | '(' | '{' | '}' | '[' | ']' | '.' | '>' | '='
  let pendingParam = false;
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
      // A closing delimiter at the scan's starting depth closes something
      // opened before scanType began — never swallow it; return so the main
      // loop decrements its counter and emits it, keeping paren/brace in sync.
      if (ch === ")") { if (paren > start.paren) paren--; else return; i++; continue; }
      if (ch === "}") { if (brace > start.brace) brace--; else return; i++; continue; }
      if (ch === "[") { bracket++; i++; continue; }
      if (ch === "]") { if (bracket > start.bracket) bracket--; else return; i++; continue; }
      if (ch === "<") { angle++; i++; continue; }
      if (ch === ">") { if (angle > start.angle) angle--; i++; continue; }
      i++;
    }
  }

  // True when the `{` at source[i] opens an object literal rather than a
  // statement block (if/while/function body).
  function isObjectBrace() {
    let k = i - 1;
    while (k >= 0 && source[k] === " ") k--;
    if (k < 0) return true;
    const p = source[k];
    if (p === ">" && source[k - 1] === "=") return false; // `=> {` is a body
    if (p === "(" || p === "=" || p === "," || p === "{") return true;
    if (p === ":") return true;
    if (/[a-zA-Z_$]/.test(p)) {
      const word = source.slice(Math.max(0, k - 7), k + 1);
      return /\b(?:return|const|let|var)\s*$/.test(word);
    }
    return false;
  }

  // True when the `{` at source[i] starts a type literal like `{ a?: string }`.
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
    if (ch === "(") { paren++; out.push(ch); prev = "("; pendingParam = false; i++; continue; }
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
    if (ch === "<") { angle++; out.push(ch); prev = "<"; i++; continue; }
    if (ch === ">") { angle--; out.push(ch); prev = ">"; i++; continue; }

    // Optional parameter `x?: Type` — drop `?` and the type annotation.
    // (Ternary `? ... :` keeps distance between them, so it is untouched.)
    if (ch === "?" && (prev === "ident" || prev === "number" || prev === ")" || prev === "]" || prev === "}")) {
      let k = i + 1;
      while (k < n && source[k] === " ") k++;
      if (k < n && source[k] === ":") {
        i = k + 1;
        while (i < n && source[i] === " ") i++;
        scanType([")", ",", "=", "\n"]);
        prev = "ident";
        pendingParam = false;
        continue;
      }
    }

    if (ch === "a" && source.slice(i, i + 3) === "as " &&
        (prev === null || prev === "ident" || prev === "number" || prev === ")" || prev === "}" || prev === "]" || prev === ">" || prev === "." || prev === " ")) {
      i += 3;
      while (i < n && source[i] === " ") i++;
      scanType([")", ",", "]", "}", ";", "\n", "="]);
      prev = "ident";
      continue;
    }

    // `:` type annotation — parameter, return, or variable type.
    if (ch === ":") {
      i++;
      while (i < n && source[i] === " ") i++;
      if (prev === "?") { out.push(":"); prev = ":"; pendingParam = false; continue; } // ternary inside an expression
      if (prev === ")") {
        // Return type: strip until the body `{`, consuming type-literal braces.
        scanType(["{", "="], true);
        prev = "ident";
        pendingParam = false;
        continue;
      }
      if (pendingParam) {
        scanType([")", ","]);
        prev = "ident";
        pendingParam = false;
        continue;
      }
      if (objDepth === 0 && (prev === "ident" || prev === "number")) {
        // Variable type annotation: stop at initializer or separator.
        scanType(["=", ",", ";", "\n"]);
        prev = "ident";
        continue;
      }
      out.push(":");
      prev = ":";
      continue;
    }

    // Postfix non-null assertion `x!` — TypeScript only, drop it.
    // Only strip when `!` follows a complete expression; prefix logical NOT (`!x`)
    // must never be stripped (e.g. `!expected` in `!provided || !expected`).
    if (ch === "!" &&
        (prev === "ident" || prev === "number" || prev === ")" || prev === "]" || prev === "}") &&
        source[i + 1] !== "=") {
      i++; continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_$]/.test(source[j])) j++;
      pendingParam = (paren > 0 && objDepth === 0 && (prev === "(" || prev === ","));
      out.push(source.slice(i, j));
      prev = "ident";
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) { prev = "number"; pendingParam = false; out.push(ch); i++; continue; }
    if (ch === ",") { prev = ","; pendingParam = false; out.push(ch); i++; continue; }
    if (ch === ".") { prev = "."; out.push(ch); i++; continue; }
    if (ch === "=") { prev = "="; pendingParam = false; out.push(ch); i++; continue; }
    if (ch === ";") { prev = ";"; pendingParam = false; out.push(ch); i++; continue; }
    out.push(ch);
    prev = ch;
    i++;
  }
  return out.join("");
}

function prepare() {
  const raw = fs.readFileSync(SOURCE, "utf8");
  const stubbed = raw.replace(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?\s*$/gm, (_match, names) =>
    names.split(",").map((name) => {
      const ident = name.trim();
      if (!STUBS[ident]) throw new Error(`missing test stub for ${ident}`);
      return STUBS[ident];
    }).join("\n"));
  const typed = stripTsTypes(stripTsDeclarations(stubbed));
  const denoised = typed.replace(/Deno\.env\.get\(/g, "globalThis.__intakeEnv.get(").replace(/\)!/g, ")");
  if (/^\s*import\s/m.test(denoised)) throw new Error("a real import survived the test harness");
  if (denoised.includes("Deno.")) throw new Error("a Deno API survived the test harness");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agmx-intake-edge-"));
  const file = path.join(dir, "index.js");
  fs.writeFileSync(file, denoised);
  return file;
}

globalThis.__intakeEnv = new Map([
  ["SUPABASE_URL", "https://project.supabase.co"],
  ["SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key"],
  ["INTAKE_INTERNAL_KEY", INTERNAL_KEY],
  ["APP_URL", "https://www.agmx.my"],
  ["BILLPLZ_API_KEY", ""],
  ["BILLPLZ_COLLECTION_ID", ""],
  ["BILLPLZ_X_SIGNATURE", ""],
  ["HITPAY_API_KEY", ""],
  ["HITPAY_SALT", ""],
]);
globalThis.__intakeClient = makeClient();
globalThis.__intakeInsertError = null;
globalThis.__intakeRateLimited = false;
if (!globalThis.crypto) globalThis.crypto = webcrypto;
await import(pathToFileURL(prepare()).href);
const handler = globalThis.__intakeHandler;
assert.equal(typeof handler, "function", "money-flow registered a request handler");

function assessment(overrides = {}) {
  return {
    coopName: "Koperasi Pekerja Maju Berhad",
    coopReg: "KPM-142/2010",
    state: "Selangor",
    members: 1284,
    agmDate: "2026-12-01",
    mode: "hybrid",
    expectedAttendance: 403,
    candidates: 8,
    motions: 12,
    currentProcess: "mixed",
    needsManaged: true,
    contactName: "Pn. Aishah Rahman",
    contactPhone: "+60123456789",
    contactEmail: "aishah@kopemaju.my",
    ...overrides,
  };
}

async function call(body, { key = INTERNAL_KEY } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" };
  if (key !== null) headers["x-agmx-intake-key"] = key;
  const response = await handler(new Request("https://project.supabase.co/functions/v1/money-flow/assessment", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
  return { status: response.status, json: await response.json() };
}

let passed = 0;
function check(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("\nAGMX public intake — Supabase boundary\n================================");

const unauthorized = await call({ submissionId: SUBMISSION_ID, assessment: assessment() }, { key: null });
check(unauthorized.status === 401, "direct unauthenticated assessment calls are refused");
check(tables.agm_assessments.length === 0, "the refused call wrote no assessment");

const missingId = await call({ assessment: assessment() });
check(missingId.status === 400, "an internal call without submissionId is refused");
check(tables.agm_assessments.length === 0, "the missing-id call wrote no assessment");

const first = await call({ submissionId: SUBMISSION_ID, assessment: assessment() });
check(first.status === 201, "a valid internal submission creates a lead");
check(first.json.reference?.startsWith("LD-") === true, "the response keeps the checkout lead reference");
check(typeof first.json.token === "string" && first.json.token.length > 0, "the response keeps the checkout bearer token");
check(first.json.replayed === false, "a new submission is not marked as a replay");
const stored = tables.agm_assessments[0];
check(stored?.submission_id === SUBMISSION_ID, "submissionId is persisted as the authoritative idempotency key");
check(stored?.current_process === "partial", "mixed process is translated for the existing server scorer");
check(stored?.organization_id === null || stored?.organization_id === undefined, "the public lead remains unclaimed");
check(/^[a-f0-9]{64}$/.test(stored?.submission_hash || ""), "a canonical payload hash is persisted");

const replay = await call({ submissionId: SUBMISSION_ID, assessment: assessment() });
check(replay.status === 200, "an exact replay returns 200");
check(replay.json.assessmentId === first.json.assessmentId, "the replay returns the original assessment id");
check(replay.json.token === first.json.token, "the replay returns the original checkout token");
check(replay.json.replayed === true, "the replay is explicit to the Worker");
check(tables.agm_assessments.length === 1, "the replay did not create a second lead");

const conflict = await call({
  submissionId: SUBMISSION_ID,
  assessment: assessment({ contactName: "Different Person" }),
});
check(conflict.status === 409, "reusing submissionId with different content returns 409");
check(conflict.json.error?.code === "SUBMISSION_CONFLICT", "the conflict uses a stable machine code");
check(tables.agm_assessments.length === 1, "the conflict did not overwrite the original lead");

globalThis.__intakeRateLimited = true;
const limited = await call({
  submissionId: "2df1f7d4-94b2-4f36-a90d-bfcca2f5d201",
  assessment: assessment(),
});
check(limited.status === 429, "the internal boundary keeps fail-closed rate limiting");
globalThis.__intakeRateLimited = false;

globalThis.__intakeInsertError = { data: null, error: { message: "raw database detail with secret material" } };
const failed = await call({
  submissionId: "3df1f7d4-94b2-4f36-a90d-bfcca2f5d201",
  assessment: assessment(),
});
check(failed.status === 500, "a persistence failure returns 500");
check(JSON.stringify(failed.json).includes("raw database detail") === false, "raw database errors are not returned");

console.log(`\n${passed} passed, 0 failed\n`);
