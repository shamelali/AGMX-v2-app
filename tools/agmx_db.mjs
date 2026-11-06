/* ============================================================
   AGMX — real-schema test harness

   Two jobs:

   1. bootDatabase() runs supabase/schema_final.sql — the exact file DEPLOY.md
      and deploy.sh tell an operator to paste into the Supabase dashboard —
      against PGlite, an embedded build of real Postgres. Every table,
      constraint, trigger, RLS policy and RPC in the deploy bundle is
      therefore actually executed instead of merely grep'd.

   2. makeRestClient() hands the Edge Functions a PostgREST-shaped client
      (`from().select().eq().single()`, `rpc()`, `auth.getUser()`) whose
      queries are compiled against the live catalog: embeds are resolved by
      real foreign keys, cardinality by real unique indexes, RPC arguments by
      real pg_proc signatures.

      Why this matters: the governance invariants — quorum arithmetic, the
      voting window, the double-vote guard, ballot thresholds, the hash-chained
      audit log — exist only inside SQL that no test in this repository had
      ever run. An in-memory stub can assert that a handler called `.rpc()`.
      Only Postgres can assert what the RPC decided.

   Known limits, stated rather than hidden:
     * `0002_knowledge.sql` and `create extension vector` are skipped: PGlite
       cannot represent pgvector's `vector(1024)` typmod, so the knowledge
       store is not exercised here (see archive/neon/tools/test_knowledge_store.js).
     * RLS is not enforced: both functions connect with the service-role key,
       which has BYPASSRLS in production too. The application-layer tenant
       guards those functions rely on are covered by test_money_flow_auth.mjs.

   Usage (from a test, not directly):
     const { db, rest } = await bootDatabase().then(b => ({ db: b.db, rest: makeRestClient(b.db) }))
   ============================================================ */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUNDLE = join(ROOT, "supabase", "schema_final.sql");

export const UNSUPPORTED_SECTIONS = new Set(["0002_knowledge.sql"]);
/* Everything pgvector touches: the extension, and the aggregate/function
   signatures that name the public.vector type. PGlite has no pgvector, and its
   catalog cannot declare a type whose typmod_in is missing, so `vector(1024)`
   is not expressible — the knowledge store is therefore not exercised here. */
export const UNSUPPORTED_STATEMENTS = [
  /^create\s+extension\s+(?:if\s+not\s+exists\s+)?"?(vector|pg_trgm|citext|uuid-ossp)"?/i,
  /\bpublic\.vector\b/i,
];

/* Supabase objects the bundle assumes already exist. */
const PRELUDE = `
set search_path = public, extensions, pg_temp;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
-- Supabase ships a supabase_realtime publication; 0001_schema.sql alters it
-- and only one of its two guarded blocks tolerates a missing publication.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  role text not null default 'authenticated',
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- PostgREST passes the JWT to the database as a GUC; the harness sets the same
-- two facts directly, so auth.uid()/auth.role() behave as they do in production.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('agmx.uid', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('agmx.role', true), ''), 'anon')
$$;
`;

/* ---------- SQL text utilities ---------- */

const IDENT = /^[A-Za-z_][A-Za-z_0-9]*$/;
function q(name) {
  if (typeof name !== "string" || !IDENT.test(name)) {
    throw new Error(`not a Postgres identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

function clip(text, n = 160) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
}

/* Split on `;` at the top level only: dollar-quoted bodies, string literals,
   quoted identifiers and comments all legitimately contain semicolons. */
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let dollarTag = null;
  let quote = null;
  let inLine = false;
  let inBlock = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLine) {
      buf += ch;
      if (ch === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") { inBlock = false; buf += ch + next; i += 2; continue; }
      buf += ch; i++; continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { buf += dollarTag; i += dollarTag.length; dollarTag = null; continue; }
      buf += ch; i++; continue;
    }
    if (quote) {
      if (ch === quote) {
        if (next === quote) { buf += ch + next; i += 2; continue; }
        quote = null;
      }
      buf += ch; i++; continue;
    }
    if (ch === "-" && next === "-") { inLine = true; buf += ch; i++; continue; }
    if (ch === "/" && next === "*") { inBlock = true; buf += ch + next; i += 2; continue; }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; i++; continue; }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (tag) { dollarTag = tag[0]; buf += dollarTag; i += dollarTag.length; continue; }
    }
    if (ch === ";") { out.push(buf); buf = ""; i++; continue; }
    buf += ch; i++;
  }

  if (dollarTag) throw new Error(`unterminated dollar quote: ${dollarTag}`);
  if (quote) throw new Error(`unterminated ${quote === "'" ? "string" : "identifier"} literal`);
  if (buf.trim()) out.push(buf);

  return out.map((s) => s.trim()).filter((s) => stripComments(s).length > 0);
}

/* The generated bundle marks each source file with a banner comment. Splitting
   on it lets a failure name the migration it came from. */
export function splitSections(text) {
  const banner = /^-- (\d{4}_[A-Za-z0-9_]+\.sql)$/gm;
  const marks = [];
  const seen = new Set();
  let m;
  while ((m = banner.exec(text))) {
    if (seen.has(m[1])) throw new Error(`bundle has a duplicate section banner: ${m[1]}`);
    seen.add(m[1]);
    marks.push({ name: m[1], start: m.index + m[0].length });
  }
  if (marks.length < 2) throw new Error(`found ${marks.length} migration banner(s) in the bundle; refusing to boot an unrecognised file`);

  const sections = [{ name: "<bundle preamble>", text: text.slice(0, marks[0].start) }];
  marks.forEach((mark, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].start - 0 : text.length;
    sections.push({ name: mark.name, text: text.slice(mark.start, end) });
  });
  // Each section's text still carries its own closing banner line; strip the
  // next banner's decoration off the tail by trimming trailing comment rules.
  return sections;
}

/* ---------- boot ---------- */

function claimsOf(text) {
  const claims = { tables: new Set(), functions: new Set(), policies: new Set() };
  for (const m of text.matchAll(/create table if not exists public\.([a-z_][a-z_0-9]*)/gims)) {
    claims.tables.add(m[1]);
  }
  for (const m of text.matchAll(/create or replace function public\.([a-z_][a-z_0-9]*)/gims)) {
    claims.functions.add(m[1]);
  }
  for (const m of text.matchAll(/create policy ([a-z_][a-z_0-9]*) on (?:table )?public\./gims)) {
    claims.policies.add(m[1]);
  }
  return claims;
}

async function reconcile(db, claims) {
  const missing = [];
  const tables = new Set(
    (await db.query("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename),
  );
  const funcs = new Set(
    (await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).rows.map((r) => r.proname),
  );
  const policies = new Set(
    (await db.query("select polname from pg_policy")).rows.map((r) => r.polname),
  );
  for (const t of claims.tables) if (!tables.has(t)) missing.push(`table public.${t}`);
  for (const f of claims.functions) if (!funcs.has(f)) missing.push(`function public.${f}()`);
  for (const p of claims.policies) if (!policies.has(p)) missing.push(`policy ${p}`);
  if (missing.length) {
    throw new Error(
      `the bundle text claims ${missing.length} object(s) the database does not have:\n  ${missing.join("\n  ")}`,
    );
  }
}

export async function bootDatabase({ log = null } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRELUDE);
  const applied = await applyBundle(db, { log });
  await reconcile(db, applied.claims);
  return { db, ...applied };
}

/* The bundle, applied to an already-booted database. Split out because the file
   a deploy pastes once is the same file an operator pastes twice after a partial
   run, and only a second application proves that: `drop policy if exists` and
   `create table if not exists` are claims until something re-runs them. */
export async function applyBundle(db, { log = null } = {}) {
  const text = readFileSync(BUNDLE, "utf8");
  const sections = splitSections(text);
  const claims = { tables: new Set(), functions: new Set(), policies: new Set() };
  const stats = { statements: 0, skippedSections: [], skippedStatements: [] };

  for (const section of sections) {
    if (UNSUPPORTED_SECTIONS.has(section.name)) {
      stats.skippedSections.push(section.name);
      if (log) log(`  skipped ${section.name} (pgvector cannot be emulated on PGlite)`);
      continue;
    }
    /* Only objects this section will actually create: claiming the skipped
       knowledge-store tables would demand things PGlite cannot have. */
    const sectionClaims = claimsOf(section.text);
    for (const key of Object.keys(claims)) {
      for (const name of sectionClaims[key]) claims[key].add(name);
    }
    for (const stmt of splitStatements(section.text)) {
      if (UNSUPPORTED_STATEMENTS.some((pattern) => pattern.test(stmt))) {
        stats.skippedStatements.push(clip(stmt));
        if (log) log(`  skipped ${clip(stmt, 70)} (pgvector is not available to PGlite)`);
        continue;
      }
      try {
        await db.exec(stmt);
        stats.statements++;
      } catch (err) {
        throw new Error(
          `${section.name}: statement failed\n  ${clip(stmt)}\n  ${err.message}\n\n` +
          "This is the file DEPLOY.md and deploy.sh tell an operator to paste into the " +
          "Supabase dashboard, so this failure is what a production deploy would hit.",
        );
      }
    }
  }

  stats.claims = { tables: claims.tables.size, functions: claims.functions.size, policies: claims.policies.size };
  return { stats, claims, sections: sections.map((s) => s.name) };
}

/* ---------- catalog ---------- */

async function loadTable(db, table) {
  const cols = await db.query(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [table],
  );
  if (!cols.rows.length) return null;

  const fks = await db.query(
    `select con.conname,
            child.relname as child_table,
            parent.relname as parent_table,
            array(select a.attname from unnest(con.conkey) with ordinality u(n, ord)
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.n::int order by u.ord) as child_cols,
            array(select a.attname from unnest(con.confkey) with ordinality u(n, ord)
                   join pg_attribute a on a.attrelid = con.confrelid and a.attnum = u.n::int order by u.ord) as parent_cols,
            exists (select 1 from pg_index idx
                      where idx.indrelid = con.conrelid and idx.indisunique
                        and idx.indkey::int[] <@ con.conkey::int[]
                        and con.conkey::int[] <@ idx.indkey::int[]) as child_unique
       from pg_constraint con
       join pg_class child on child.oid = con.conrelid
       join pg_class parent on parent.oid = con.confrelid
       join pg_namespace n on n.oid = child.relnamespace
      where con.contype = 'f' and n.nspname = 'public'`,
  );

  const pk = await db.query(
    `select array(select a.attname from unnest(c.conkey) with ordinality u(n, ord)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.n::int order by u.ord) as cols
       from pg_constraint c
       join pg_class rel on rel.oid = c.conrelid
       join pg_namespace n on n.oid = rel.relnamespace
      where c.contype = 'p' and n.nspname = 'public' and rel.relname = $1`,
    [table],
  );

  return {
    table,
    byName: Object.fromEntries(cols.rows.map((c) => [c.name, c])),
    columns: cols.rows,
    pk: pk.rows[0]?.cols ?? [],
    outgoing: fks.rows.filter((r) => r.child_table === table),
    incoming: fks.rows.filter((r) => r.parent_table === table),
  };
}

/* ---------- select spec parsing ---------- */

function splitTop(text, sep) {
  const parts = [];
  let buf = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if (ch === quote) {
        if (text[i + 1] === quote) { buf += text[++i]; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth < 0) throw new Error(`unbalanced ')' in select spec: ${text}`);
    }
    if (ch === sep && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (depth !== 0) throw new Error(`unbalanced '(' in select spec: ${text}`);
  parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const EMBED = /^(?:(?<alias>[A-Za-z_]\w*)\s*:\s*)?(?<table>[A-Za-z_]\w*)(?:\s*!\s*(?<fk>[A-Za-z_]\w*))?\s*\((?<inner>.*)\)$/s;

function parseSelect(spec) {
  return splitTop(spec, ",").map((item) => {
    if (item === "*") return { kind: "star" };
    const m = EMBED.exec(item);
    if (m && m.groups.table) {
      return {
        kind: "embed",
        name: m.groups.table,
        alias: m.groups.alias || m.groups.table,
        fk: m.groups.fk || null,
        items: parseSelect(m.groups.inner),
      };
    }
    if (!IDENT.test(item)) throw new Error(`unsupported select item: ${JSON.stringify(item)}`);
    return { kind: "col", name: item };
  });
}

/* ---------- PostgREST-shaped client ---------- */

const FILTERS = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
  like: "like", ilike: "ilike", is: "is",
};

function filterValue(op, raw) {
  if (op === "is") {
    if (raw === "null") return { sql: "is null", params: [] };
    if (raw === "true" || raw === "false") return { sql: "is ?", params: [raw === "true"] };
    throw new Error(`unsupported is() filter value: ${raw}`);
  }
  const value = (op === "like" || op === "ilike") ? raw.replace(/\*/g, "%") : raw;
  return { sql: `${FILTERS[op]} ?`, params: [coerceLiteral(value)] };
}

function coerceLiteral(text) {
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

/* Number `?` placeholders as $1..$n, skipping quoted text. Throws when the
   placeholder count disagrees with the parameter list — a silent mismatch here
   would change which value binds to which column. */
function number(sql, params) {
  let out = "";
  let i = 0;
  let n = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '"' || ch === "'") {
      out += ch;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) { out += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "?") { n++; out += `$${n}`; i++; continue; }
    out += ch;
    i++;
  }
  if (n !== params.length) {
    throw new Error(`compiled SQL has ${n} placeholder(s) but ${params.length} parameter(s): ${clip(sql)}`);
  }
  return out;
}

function bind(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

export function makeRestClient(db) {
  const cache = new Map();
  const tokens = new Map();
  const executed = { queries: 0, rpcs: 0, embeds: 0 };

  async function info(table) {
    if (!cache.has(table)) {
      const loaded = await loadTable(db, table);
      if (!loaded) throw new Error(`relation public.${table} does not exist in the deploy bundle`);
      cache.set(table, loaded);
    }
    return cache.get(table);
  }

  function resolveEmbed(root, spec) {
    // Case A: the root row holds the FK, so one root maps to one target row.
    let candidates = root.outgoing.filter((f) => f.parent_table === spec.name);
    if (spec.fk) candidates = candidates.filter((f) => f.conname === spec.fk);
    if (candidates.length > 1) {
      throw new Error(`embed "${spec.alias}:${spec.name}(…)" on ${root.table} matches ${candidates.length} foreign keys; name one with !constraint`);
    }
    if (candidates.length === 1) {
      const f = candidates[0];
      return { table: spec.name, localCols: f.child_cols, remoteCols: f.parent_cols, many: false };
    }

    // Case B: the target holds the FK back at the root. To-many unless a unique
    // index proves at most one child exists.
    let inbound = root.incoming.filter((f) => f.child_table === spec.name);
    if (spec.fk) inbound = inbound.filter((f) => f.conname === spec.fk);
    if (inbound.length > 1) {
      throw new Error(`embed "${spec.alias}:${spec.name}(…)" on ${root.table} matches ${inbound.length} reverse foreign keys; name one with !constraint`);
    }
    if (inbound.length === 1) {
      const f = inbound[0];
      return { table: spec.name, localCols: f.parent_cols, remoteCols: f.child_cols, many: !f.child_unique };
    }
    throw new Error(`embed "${spec.alias}:${spec.name}(…)" has no foreign key between ${root.table} and ${spec.name} — PostgREST would reject this too`);
  }

  async function projection(root, items, alias) {
    const bits = [];
    for (const spec of items) {
      if (spec.kind === "star") { bits.push(`${alias}.*`); continue; }
      if (spec.kind === "col") { bits.push(`${alias}.${q(spec.name)}`); continue; }
      executed.embeds++;
      const link = resolveEmbed(root, spec);
      const remote = await info(link.table);
      const inner = await projection(remote, spec.items, "agmx_e");
      const corr = link.remoteCols
        .map((rc, i) => `agmx_e.${q(rc)} = ${alias}.${q(link.localCols[i])}`)
        .join(" and ");
      const sub = `(select ${inner} from public.${q(link.table)} agmx_e where ${corr})`;
      bits.push(link.many
        ? `coalesce((select jsonb_agg(to_jsonb(agmx_row)) from ${sub} agmx_row), '[]'::jsonb) as ${q(spec.alias)}`
        : `coalesce((select to_jsonb(agmx_row) from ${sub} agmx_row limit 1), 'null'::jsonb) as ${q(spec.alias)}`);
    }
    return bits.join(", ");
  }

  async function selectSql(root, items, { filters, orderList, limitCount }) {
    const proj = await projection(root, items, "agmx_t");
    const params = filters.flatMap((f) => f.params);
    let sql = `select ${proj} from public.${q(root.table)} agmx_t`;
    if (filters.length) sql += " where " + filters.map((f) => f.sql).join(" and ");
    if (orderList.length) sql += " order by " + orderList.join(", ");
    if (limitCount !== null && limitCount !== undefined) {
      if (!Number.isInteger(Number(limitCount))) throw new Error("limit must be an integer");
      sql += ` limit ${Number(limitCount)}`;
    }
    return { sql: `select to_jsonb(agmx_r) as "row" from (${sql}) agmx_r`, params };
  }

  async function runQuery(sql, params) {
    if (process.env.AGMX_TRACE_SQL) console.error("  [sql] " + clip(sql, 400));
    return db.query(sql, params);
  }

  class Builder {
    constructor(table, verb) {
      this.table = table;
      this.verb = verb;
      this.hint = null;
      this.row = null;
      this.patch = null;
      this.filters = [];
      this.orderList = [];
      this.limitCount = null;
      this.shapeKind = "list";
    }

    /* supabase-js: from(t).select(cols) for reads, from(t).insert(r).select(cols)
       for writes. `hint` is the read shape either way; when a write never asks
       for one, PostgREST returns an empty body, so `data` stays null. */
    select(spec = "*") { this.hint = spec; return this; }
    insert(row) { this.verb = "insert"; this.row = row; return this; }
    update(patch) { this.verb = "update"; this.patch = patch; return this; }

    #predicate(sql, params) { this.filters.push({ sql, params }); return this; }

    eq(col, val) { return this.#predicate(`agmx_t.${q(col)} = ?`, [bind(val)]); }
    neq(col, val) { return this.#predicate(`agmx_t.${q(col)} <> ?`, [bind(val)]); }
    gt(col, val) { return this.#predicate(`agmx_t.${q(col)} > ?`, [bind(val)]); }
    gte(col, val) { return this.#predicate(`agmx_t.${q(col)} >= ?`, [bind(val)]); }
    lt(col, val) { return this.#predicate(`agmx_t.${q(col)} < ?`, [bind(val)]); }
    lte(col, val) { return this.#predicate(`agmx_t.${q(col)} <= ?`, [bind(val)]); }
    like(col, val) { return this.#predicate(`agmx_t.${q(col)} like ?`, [String(val).replace(/\*/g, "%")]); }
    ilike(col, val) { return this.#predicate(`agmx_t.${q(col)} ilike ?`, [String(val).replace(/\*/g, "%")]); }

    in(col, values) {
      if (!Array.isArray(values)) throw new Error(`in(${col}) needs an array`);
      if (!values.length) return this.#predicate("false", []);
      return this.#predicate(`agmx_t.${q(col)} in (${values.map(() => "?").join(", ")})`, values.map(bind));
    }

    filter(col, op, val) {
      if (!(op in FILTERS)) throw new Error(`unsupported filter operator: ${op}`);
      const f = filterValue(op, String(val));
      return this.#predicate(`agmx_t.${q(col)} ${f.sql}`, f.params);
    }

    /* PostgREST's `or=` grammar: `col.op.val,col.op.val`, optionally wrapped. */
    or(expression) {
      const terms = splitTop(expression.replace(/^\(/, "").replace(/\)$/, ""), ",");
      const clauses = [];
      const params = [];
      for (const term of terms) {
        const parts = term.split(".");
        if (parts.length < 3) throw new Error(`cannot parse or() term: ${term}`);
        const [col, op, ...rest] = parts;
        if (!(op in FILTERS)) throw new Error(`unsupported or() operator: ${op}`);
        const f = filterValue(op, rest.join("."));
        clauses.push(`agmx_t.${q(col)} ${f.sql}`);
        params.push(...f.params);
      }
      return this.#predicate(`(${clauses.join(" or ")})`, params);
    }

    order(col, { ascending = true, nullsFirst = null } = {}) {
      this.orderList.push(`agmx_t.${q(col)} ${ascending ? "asc" : "desc"}${
        nullsFirst === null ? "" : nullsFirst ? " nulls first" : " nulls last"}`);
      return this;
    }

    limit(n) { this.limitCount = n; return this; }
    single() { this.shapeKind = "single"; return this; }
    maybeSingle() { this.shapeKind = "maybe"; return this; }

    then(resolve, reject) { return this.run().then(resolve, reject); }

    async run() {
      const root = await info(this.table);

      if (this.verb === "select") {
        const compiled = await selectSql(root, parseSelect(this.hint ?? "*"), this);
        const params = compiled.params;
        let res;
        try {
          res = await runQuery(number(compiled.sql, params), params);
          executed.queries++;
        } catch (err) { return { data: null, error: toError(err) }; }
        return shape(this.shapeKind, res.rows.map((r) => r.row));
      }

      const pkReturn = root.pk.map(q).join(", ");
      let written;
      try {
        if (this.verb === "insert") {
          const rows = Array.isArray(this.row) ? this.row : [this.row];
          if (!rows.length) return { data: null, error: null };
          const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
          cols.forEach(q);
          const params = rows.flatMap((r) => cols.map((c) => bind(r[c])));
          const values = rows.map((r) => `(${cols.map((c) => (c in r ? "?" : "default")).join(", ")})`);
          const sql = number(
            `insert into public.${q(root.table)} (${cols.map(q).join(", ")}) values ${values.join(", ")} returning ${pkReturn}`,
            params,
          );
          written = await runQuery(sql, params);
        } else {
          const keys = Object.keys(this.patch ?? {});
          keys.forEach(q);
          if (!this.filters.length) {
            throw new Error("refusing to UPDATE every row: no filter was given, and supabase-js rejects this too");
          }
          const params = [...keys.map((k) => bind(this.patch[k])), ...this.filters.flatMap((f) => f.params)];
          const sql = number(
            `update public.${q(root.table)} agmx_t set ${keys.map((k) => `${q(k)} = ?`).join(", ")} where ${
              this.filters.map((f) => f.sql).join(" and ")} returning ${pkReturn}`,
            params,
          );
          written = await runQuery(sql, params);
        }
        executed.queries++;
      } catch (err) { return { data: null, error: toError(err) }; }

      if (this.hint === null) return { data: null, error: null };
      return this.#readBack(root, written.rows);
    }

    /* PostgREST never puts embeds in a RETURNING clause — it re-queries the
       row after writing it, so the response carries the same shape a GET
       would. This does the same, by primary key. */
    async #readBack(root, pkRows) {
      const spec = parseSelect(this.hint);
      const out = [];
      for (const pk of pkRows) {
        const compiled = await selectSql(root, spec, {
          filters: [{ sql: root.pk.map((c) => `agmx_t.${q(c)} = ?`).join(" and "), params: root.pk.map((c) => bind(pk[c])) }],
          orderList: [],
          limitCount: 1,
        });
        const params = compiled.params;
        const res = await runQuery(number(compiled.sql, params), params);
        executed.queries++;
        if (res.rows.length) out.push(res.rows[0].row);
      }
      return shape(this.shapeKind, out);
    }
  }

  function shape(kind, rows) {
    if (kind === "single") {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : {
            data: null,
            code: "PGRST116",
            error: {
              message: rows.length
                ? "JSON object requested, multiple (or no) rows returned (PGRST116)"
                : "JSON requested return value `null` as the portion of the result set was empty (PGRST116)",
              code: "PGRST116",
            },
          };
    }
    if (kind === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  function toError(err) {
    const code = err.code ?? (typeof err.getFields === "function" ? err.getFields?.().sqlState : undefined);
    return {
      message: err.message,
      code: typeof code === "string" ? code : undefined,
      details: err.detail ?? undefined,
      hint: err.hint ?? undefined,
    };
  }

  async function rpc(name, args = {}) {
    const fn = await db.query(
      `select p.oid, p.proargnames, p.proretset, t.typname, n.nspname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_type t on t.oid = p.prorettype
        where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    if (!fn.rows.length) {
      return { data: null, error: { message: `Could not find the function public.${name} in the schema cache (PGRST202)`, code: "PGRST202" } };
    }
    if (fn.rows.length > 1) {
      return { data: null, error: { message: `Function public.${name} is overloaded; PostgREST needs an exact signature (PGRST209)`, code: "PGRST209" } };
    }
    const [signature] = fn.rows;
    if (signature.proretset) {
      throw new Error(`RPC ${name} returns a set, which this harness does not emulate`);
    }
    const declared = signature.proargnames ?? [];
    const given = Object.keys(args);
    const unknown = given.filter((k) => !declared.includes(k));
    if (unknown.length) {
      return {
        data: null,
        error: {
          message: `Could not find the function public.${name}(${unknown.join(", ")}) in the schema cache (PGRST202)`,
          code: "PGRST202",
          hint: `declared parameters: ${declared.join(", ")}`,
        },
      };
    }
    const params = [];
    const named = declared.map((p) => {
      if (!(p in args)) return `${q(p)} => null`;
      params.push(bind(args[p]));
      return `${q(p)} => ?`;
    }).join(", ");
    const sql = number(`select to_jsonb(public.${q(name)}(${named})) as "row"`, params);
    let res;
    try { res = await db.query(sql, params); executed.rpcs++; }
    catch (err) { return { data: null, error: toError(err) }; }
    return { data: res.rows[0]?.row ?? null, error: null };
  }

  const client = {
    from(table) {
      if (!IDENT.test(table)) throw new Error(`bad table name: ${table}`);
      return new Builder(table, "select");
    },
    rpc,
    executed,
    /* The harness has no JWT verifier. registerActor() mints an opaque token
       that getUser() maps back to an auth.users id, and binding the id to the
       session GUC is what makes auth.uid() answer inside an RPC. */
    registerActor({ id, email = `${id}@coop.test`, role = "authenticated" }) {
      const token = `jwt-${id}`;
      tokens.set(token, { id, email, role });
      return token;
    },
    auth: {
      async getUser(token) {
        const actor = token ? tokens.get(token) : undefined;
        if (!actor) {
          await db.exec("select set_config('agmx.uid', '', false), set_config('agmx.role', 'anon', false)");
          return { data: { user: null }, error: { message: "invalid token" } };
        }
        await db.query("select set_config('agmx.uid', $1, false), set_config('agmx.role', $2, false)", [actor.id, actor.role]);
        return {
          data: { user: { id: actor.id, email: actor.email, app_metadata: { role: actor.role }, user_metadata: {} } },
          error: null,
        };
      },
    },
  };

  return client;
}

/* ---------- fixtures ---------- */

export async function seedUser(db, { id, email, role = "authenticated", appRole = null }) {
  await db.query(
    `insert into auth.users (id, email, role, raw_app_meta_data)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [id, email, role, JSON.stringify(appRole ? { role: appRole } : {})],
  );
  return id;
}
