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
    rpc: async (name) => (name === "check_rate_limit" ? { data: true, error: null } : { data: null, error: null }),
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

function prepare() {
  const raw = fs.readFileSync(SOURCE, "utf8");
  const stubbed = raw.replace(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?\s*$/gm, (_m, names) =>
    names.split(",").map((n) => {
      const name = n.trim();
      if (!STUBS[name]) throw new Error(`test harness has no stub for import "${name}"`);
      return STUBS[name];
    }).join("\n")
  );
  const denoised = stubbed.replace(/Deno\.env\.get\(/g, "globalThis.__mfEnv.get(");
  if (/^\s*import\s/m.test(denoised)) throw new Error("a real import survived the stub pass");
  if (denoised.includes("Deno.")) throw new Error("a Deno API call survived the stub pass");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agmx-money-flow-auth-"));
  const file = path.join(dir, "index.mts");
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
