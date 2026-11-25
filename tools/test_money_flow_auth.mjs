#!/usr/bin/env node
/* ============================================================
   AGMX — money-flow tenant isolation tests

   Loads supabase/functions/money-flow/index.ts as written and drives its
   real request handler against a stubbed service-role client. The function
   queries with the service-role key, so RLS separates nothing there: every
   tenant boundary is one of these application guards. That makes the guards
   the thing worth testing, and a guard that is skipped when `profile` is
   null (a signed-in user with no profiles row) used to answer 200 with
   another cooperative's quote, invoice or lead.

   Each route is asserted twice, once denied and once allowed, so a check
   that has been deleted — or one that can never fire — fails this file.

   Usage:  node tools/test_money_flow_auth.mjs
           AGMX_MF_SOURCE=/path/to/other.ts node tools/test_money_flow_auth.mjs
   ============================================================ */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.AGMX_MF_SOURCE
  ? path.resolve(process.env.AGMX_MF_SOURCE)
  : path.join(here, "..", "supabase", "functions", "money-flow", "index.ts");

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); }
  else { failed++; console.error("  ✗ " + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} → ${expected ? expected : actual}` +
    (actual === expected ? "" : ` (expected ${expected})`));
}

/* ---------- fixtures: two cooperatives and an unclaimed lead ---------- */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const TOKEN_B = "aaaaaaaa-0000-4000-8000-000000000001";
const TOKEN_A = "bbbbbbbb-0000-4000-8000-000000000002";

function seedTables() {
  return {
    profiles: [
      { id: "u-a", organization_id: ORG_A, role: "admin" },
      { id: "u-b", organization_id: ORG_B, role: "admin" },
      // u-ghost signs in with a valid JWT but holds no profiles row.
    ],
    organizations: [
      { id: ORG_A, slug: "coop-ld-1000" },
      { id: ORG_B, slug: "coop-ld-2000" },
    ],
    plans: [{ id: "p-1", code: "professional_agm", name: "Professional AGM", price_oneoff: 3500 }],
    agm_assessments: [
      { id: "a1", organization_id: ORG_A, reference: "LD-1000", token: TOKEN_A, status: "submitted", contact_name: "Aina", coop_name: "Koperasi Aina Bhd", created_at: "2026-10-01T00:00:00Z" },
      { id: "b1", organization_id: ORG_B, reference: "LD-2000", token: TOKEN_B, status: "submitted", contact_name: "Bella", coop_name: "Koperasi Bella Bhd", created_at: "2026-10-02T00:00:00Z" },
      { id: "c1", organization_id: null, reference: "LD-3000", token: "cccccccc-0000-4000-8000-000000000003", status: "lead", coop_name: "Koperasi Baru Bhd", created_at: "2026-10-03T00:00:00Z" },
    ],
    quotes: [
      { id: "qa", number: "QT-A", organization_id: ORG_A, assessment_id: "a1", status: "accepted", total: 3780, tax: 280, subtotal: 3500, valid_until: "2026-12-01" },
      { id: "qb", number: "QT-B", organization_id: ORG_B, assessment_id: "b1", status: "accepted", total: 3780, tax: 280, subtotal: 3500, valid_until: "2026-12-01" },
    ],
    quote_items: [],
    invoices: [
      { id: "ia", number: "INV-A", organization_id: ORG_A, quote_id: "qa", status: "unpaid", amount: 3780 },
      { id: "ib", number: "INV-B", organization_id: ORG_B, quote_id: "qb", status: "unpaid", amount: 3780 },
    ],
    payments: [
      { id: "pa", organization_id: ORG_A, invoice_id: "ia", status: "pending", method: "fpx", amount: 3780, reference: "PAY-A" },
      { id: "pb", organization_id: ORG_B, invoice_id: "ib", status: "pending", method: "fpx", amount: 3780, reference: "PAY-B" },
    ],
    audit_events: [
      { id: "e1", organization_id: ORG_A, action: "quote.accepted", entity_type: "quote", entity_id: "qa", occurred_at: "2026-10-05T00:00:00Z", payload: {}, hash: "h1", prev_hash: null },
      { id: "e2", organization_id: ORG_B, action: "quote.accepted", entity_type: "quote", entity_id: "qb", occurred_at: "2026-10-06T00:00:00Z", payload: {}, hash: "h2", prev_hash: null },
    ],
  };
}

/* ---------- stub service-role client (no network) ---------- */
function makeClient(tables) {
  const writes = [];
  function query(table) {
    const state = { table, filters: [], ors: [], mode: "select", body: null, limitN: null };
    const rows = () => tables[table] || [];
    const matches = () => {
      let out = rows().filter((row) => state.filters.every(([col, val]) => row[col] === val));
      if (state.ors.length) {
        out = out.filter((row) => state.ors.some((or) => or(row)));
      }
      return out;
    };
    const builder = {
      select() { return builder; },
      eq(col, val) { state.filters.push([col, val]); return builder; },
      in(col, vals) { state.filters.push([col, (v) => vals.includes(v)]); return builder; },
      or(expr) {
        state.ors.push((row) => expr.split(",").some((clause) => {
          const [col, op, val] = clause.split(".");
          if (op === "eq") return String(row[col]) === val;
          if (op === "is" && val === "null") return row[col] === null || row[col] === undefined;
          return false;
        }));
        return builder;
      },
      order() { return builder; },
      limit(n) { state.limitN = n; return builder; },
      insert(body) { state.mode = "insert"; state.body = body; return builder; },
      update(body) { state.mode = "update"; state.body = body; return builder; },
      async single() { return resolve("one"); },
      async maybeSingle() { return resolve("one-or-none"); },
      then(onFulfilled, onRejected) { return resolve("many").then(onFulfilled, onRejected); },
    };
    async function resolve(shape) {
      const one = shape !== "many";
      if (state.mode === "insert") {
        const row = { id: `new-${table}-${rows().length + 1}`, ...state.body };
        rows().push(row);
        writes.push({ table, op: "insert", row });
        return { data: row, error: null };
      }
      if (state.mode === "update") {
        const hit = matches();
        hit.forEach((row) => Object.assign(row, state.body));
        writes.push({ table, op: "update", count: hit.length });
        return { data: one ? hit[0] ?? null : hit, error: null };
      }
      const found = matches();
      const slice = state.limitN === null ? found : found.slice(0, state.limitN);
      if (!slice.length) {
        return shape === "one"
          ? { data: null, error: { message: "no rows" } }
          : { data: one ? null : [], error: null };
      }
      return { data: one ? slice[0] : slice, error: null };
    }
    return builder;
  }
  return {
    writes,
    tables,
    from: (table) => query(table),
    rpc: async (name, args) => {
      if (name === "check_rate_limit") return { data: true, error: null };
      if (name === "atomic_settlement") {
        const id = args?.p_payment_id;
        const org = args?.p_operator_org;
        const row = (tables.payments || []).find((p) => p.id === id);
        if (!row) return { data: { error: "Payment not found" }, error: null };
        /* The RPC's tenant boundary: the payment's own organisation must
           match the operator's. Emulating it here is what lets the suite
           prove the boundary still holds now that settlement runs in
           Postgres rather than in the Edge Function. */
        if (row.organization_id !== org) return { data: { error: "Forbidden", code: "FORBIDDEN" }, error: null };
        if (row.status === "succeeded") {
          return { data: { already_settled: true, payment_id: row.id, status: row.status }, error: null };
        }
        row.status = "succeeded";
        row.paid_at = new Date().toISOString();
        const inv = (tables.invoices || []).find((i) => i.id === row.invoice_id);
        if (inv) { inv.status = "paid"; inv.paid_at = row.paid_at; }
        writes.push({ table: "payments", op: "rpc:atomic_settlement", row });
        return { data: { settled: true, payment_id: row.id, status: "succeeded" }, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getUser: async (token) => {
        if (!token || !token.startsWith("jwt-")) return { data: { user: null }, error: { message: "invalid token" } };
        const id = token.slice(4);
        return { data: { user: { id, email: `${id}@coop.test` } }, error: null };
      },
    },
  };
}

/* ---------- load the function under test ---------- */
const STUBS = {
  serve: 'const serve = (h) => { globalThis.__mfHandler = h };',
  createClient: 'const createClient = (url, key) => globalThis.__mfClient;',
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

  // Advance `i` past a type starting at the current position; nothing is
  // emitted. A terminator at the starting depth stops the scan. When
  // `allowTypeLiteralBrace` is set, a `{` at the starting depth is consumed
  // as part of a type literal instead of stopping the scan.
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

    // `as Type` cast — drop `as ` and the type, keep the expression.
    if (ch === "a" && source.slice(i, i + 3) === "as " &&
        (prev === null || prev === "ident" || prev === "number" || prev === ")" || prev === "}" || prev === "]" || prev === ">" || prev === "." || prev === " ")) {
      i += 3;
      while (i < n && source[i] === " ") i++;
      scanType([")", ",", "]", "}", ";", "\n", "="]);
      prev = "ident";
      pendingParam = false;
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
  const stubbed = raw.replace(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?\s*$/gm, (_m, names) =>
    names.split(",").map((n) => {
      const name = n.trim();
      if (!STUBS[name]) throw new Error(`test harness has no stub for import "${name}"`);
      return STUBS[name];
    }).join("\n")
  );
  const typed = stripTsTypes(stripTsDeclarations(stubbed));
  const denoised = typed.replace(/Deno\.env\.get\(/g, "globalThis.__mfEnv.get(").replace(/\)!/g, ")");
  if (/^\s*import\s/m.test(denoised)) throw new Error("a real import survived the stub pass");
  if (denoised.includes("Deno.")) throw new Error("a Deno API call survived the stub pass");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agmx-money-flow-auth-"));
  const file = path.join(dir, "index.js");
  fs.writeFileSync(file, denoised);
  return file;
}

globalThis.__mfEnv = new Map([
  ["SUPABASE_URL", "https://db.test"],
  ["SUPABASE_SERVICE_ROLE_KEY", "service-role"],
  ["APP_URL", "https://app.test"],
  ["BILLPLZ_API_KEY", ""],
  ["BILLPLZ_COLLECTION_ID", ""],
  ["HITPAY_API_KEY", ""],
  ["HITPAY_SALT", ""],
  ["BILLPLZ_X_SIGNATURE", ""],
]);

const client = makeClient(seedTables());
globalThis.__mfClient = client;
globalThis.crypto = webcrypto;
await import(pathToFileURL(prepare()).href);
const handler = globalThis.__mfHandler;
if (typeof handler !== "function") throw new Error("serve() handler was never registered");

// Synthetic host, matching SUPABASE_URL above: the handler reads only the path
// and the payment-confirm link it builds is never fetched, so no real project
// ref belongs in a test that runs offline.
const BASE = "https://db.test/functions/v1/money-flow";
async function call(route, { method = "POST", as, query = "", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (as) headers.Authorization = `Bearer ${as}`;
  const res = await handler(new Request(`${BASE}${route}${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }));
  let json = null;
  try { json = await res.json(); } catch { /* error bodies we do not read */ }
  return { status: res.status, json };
}

const JWT_A = "jwt-u-a";      // admin of ORG_A, profile row present
const JWT_GHOST = "jwt-u-ghost"; // valid JWT, no profiles row
const PROSPECT_B = `?ref=LD-2000&t=${TOKEN_B}`;

console.log(`\nAGMX Money Flow — tenant isolation\nsource: ${path.relative(path.join(here, ".."), SOURCE)}\n===============================\n`);

/* ---------- 1. no profiles row must not skip the tenant comparison ---------- */
console.log("-- signed-in user with no profiles row: every tenant boundary holds");
{
  const cases = [
    ["POST /quote", await call("/quote", { as: JWT_GHOST, body: { assessmentId: "b1", planCode: "professional_agm" } })],
    ["POST /quote/accept", await call("/quote/accept", { as: JWT_GHOST, body: { quoteId: "qb" } })],
    ["POST /invoice", await call("/invoice", { as: JWT_GHOST, body: { quoteId: "qb" } })],
    ["POST /payment/intent", await call("/payment/intent", { as: JWT_GHOST, body: { invoiceId: "ib", method: "transfer" } })],
    ["GET /quote/:id", await call("/quote/qb", { method: "GET", as: JWT_GHOST })],
    ["GET /invoice/:id", await call("/invoice/ib", { method: "GET", as: JWT_GHOST })],
    ["GET /lead/:id", await call("/lead/b1", { method: "GET", as: JWT_GHOST })],
    ["GET /audit?ref=", await call("/audit", { method: "GET", as: JWT_GHOST, query: "?ref=LD-2000" })],
    ["GET /deals", await call("/deals", { method: "GET", as: JWT_GHOST })],
    ["GET /metrics", await call("/metrics", { method: "GET", as: JWT_GHOST })],
  ];
  for (const [label, res] of cases) {
    eq(res.status, 403, `${label} as a profile-less user is refused`);
  }
  const leaked = client.writes.filter((w) => w.op === "insert" && w.row.organization_id === ORG_B);
  ok(leaked.length === 0, "no row was written against the other cooperative's organisation");
}

/* ---------- 2. an operator of one coop cannot reach another's rows ---------- */
console.log("\n-- admin of coop A asking for coop B's records");
{
  eq((await call("/quote/qb", { method: "GET", as: JWT_A })).status, 403, "GET /quote/QT-B refused");
  eq((await call("/invoice/ib", { method: "GET", as: JWT_A })).status, 403, "GET /invoice/INV-B refused");
  eq((await call("/quote/accept", { as: JWT_A, body: { quoteId: "qb" } })).status, 403, "POST /quote/accept for B refused");
  eq((await call("/invoice", { as: JWT_A, body: { quoteId: "qb" } })).status, 403, "POST /invoice on B's quote refused");
  eq((await call("/payment/intent", { as: JWT_A, body: { invoiceId: "ib", method: "transfer" } })).status, 403, "POST /payment/intent on B's invoice refused");
  eq((await call("/payment/manual-confirm", { as: JWT_A, body: { paymentId: "pb" } })).status, 403, "POST /payment/manual-confirm on B's payment refused");
  eq((await call("/lead/b1", { method: "GET", as: JWT_A })).status, 403, "GET /lead/b1 refused");
  eq((await call("/audit", { method: "GET", as: JWT_A, query: "?ref=LD-2000" })).status, 403, "GET /audit?ref=LD-2000 refused");
  const stage = await call("/lead/stage", { as: JWT_A, body: { ref: "LD-2000", stage: "quoted" } });
  eq(stage.status, 403, "POST /lead/stage on B's lead refused");
  const b1 = client.tables.agm_assessments.find((r) => r.id === "b1");
  eq(b1.status, "submitted", "and B's lead kept its stage");
}

/* ---------- 3. the same calls succeed for the owning tenant ---------- */
console.log("\n-- the owning cooperative still gets its own data");
{
  eq((await call("/quote/qa", { method: "GET", as: JWT_A })).status, 200, "GET /quote/QT-A served");
  eq((await call("/invoice/ia", { method: "GET", as: JWT_A })).status, 200, "GET /invoice/INV-A served");
  eq((await call("/lead/a1", { method: "GET", as: JWT_A })).status, 200, "GET /lead/a1 served");
  eq((await call("/audit", { method: "GET", as: JWT_A, query: "?ref=LD-1000" })).status, 200, "GET /audit?ref=LD-1000 served");
  eq((await call("/deals", { method: "GET", as: JWT_A })).status, 200, "GET /deals served");
  eq((await call("/lead/c1", { method: "GET", as: JWT_A })).status, 200, "GET /lead/c1 (unclaimed lead) still served");
  eq((await call("/quote", { as: JWT_A, body: { assessmentId: "a1", planCode: "professional_agm" } })).status, 201, "POST /quote on own assessment served");
  eq((await call("/quote", { as: JWT_A, body: { assessmentId: "c1", planCode: "professional_agm" } })).status, 201, "POST /quote on an unclaimed lead served");
  /* Settlement is a tenant boundary too: the owning cooperative may settle
     its own payment, a repeated confirmation is idempotent rather than an
     error, and the payment and invoice move together. */
  const settle = await call("/payment/manual-confirm", { as: JWT_A, body: { paymentId: "pa" } });
  eq(settle.status, 200, "POST /payment/manual-confirm on own payment settles");
  eq(client.tables.payments.find((p) => p.id === "pa").status, "succeeded", "own payment marked succeeded");
  eq(client.tables.invoices.find((i) => i.id === "ia").status, "paid", "own invoice marked paid");
  const settleAgain = await call("/payment/manual-confirm", { as: JWT_A, body: { paymentId: "pa" } });
  eq(settleAgain.status, 200, "a repeated confirmation is idempotent, not an error");
  eq(client.writes.filter((w) => w.op === "rpc:atomic_settlement").length, 1, "the repeat did not write a second settlement");
}

/* ---------- 4. prospects keep their own flow ---------- */
console.log("\n-- checkout token holder keeps working");
{
  eq((await call("/quote/qb", { method: "GET", query: PROSPECT_B })).status, 200, "GET /quote/QT-B with its own token served");
  eq((await call("/invoice/ib", { method: "GET", query: PROSPECT_B })).status, 200, "GET /invoice/INV-B with its own token served");
  eq((await call("/quote/accept", { query: PROSPECT_B, body: { quoteId: "qb" } })).status, 200, "POST /quote/accept as the prospect served");
  eq((await call("/audit", { method: "GET", query: `?ref=LD-2000&t=${TOKEN_B}` })).status, 200, "GET /audit for its own ref served");
  eq((await call("/quote/qa", { method: "GET", query: PROSPECT_B })).status, 403, "GET /quote/QT-A (other coop) refused");
  /* A token that does not belong to the ref it is paired with never becomes a
     prospect at all, so the surface reports unauthenticated rather than a
     tenant mismatch — either way nothing is served. */
  eq((await call("/audit", { method: "GET", query: `?ref=LD-1000&t=${TOKEN_B}` })).status, 401, "GET /audit for another coop's ref refused");
  eq((await call("/quote/qa", { method: "GET", query: `?ref=LD-2000&t=wrong-token` })).status, 401, "an unknown token is unauthenticated");
}

/* ---------- 5. anonymous ---------- */
console.log("\n-- no credential at all");
{
  for (const route of ["/quote/qb", "/invoice/ib", "/lead/a1", "/audit"]) {
    eq((await call(route, { method: "GET" })).status, 401, `GET ${route} anonymous is unauthenticated`);
  }
  /* The operator surfaces ask for a profile holding an organisation, so they
     refuse rather than report unauthenticated. */
  for (const route of ["/deals", "/metrics"]) {
    eq((await call(route, { method: "GET" })).status, 403, `GET ${route} anonymous is refused`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
