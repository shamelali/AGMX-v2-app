#!/usr/bin/env node
// ============================================================
// Does the linked Supabase project still run the SQL in this repository?
// ------------------------------------------------------------
// `supabase db push` compares *version numbers*. It records that a version ran and
// then skips that file forever, so editing a migration after its first apply is
// invisible: the CLI reports it applied while the database keeps the older text.
// That is how production came to run `cast_vote` with `max(boolean)` — an aggregate
// Postgres does not have, so every ballot errored — and `log_audit()` reading its
// chain head through a no-row `SELECT INTO`, which wrote no audit event at all,
// while `supabase migration list` showed 0007-0009 applied and three status docs
// asserted no remote project had been touched.
//
// Pass 21/24/25 read files, so none of them can see this: they agree with
// themselves. This pass reads the live catalog instead — md5 over pg_proc.prosrc,
// compared to the same hash of each body in the generated bundle, plus the versions
// recorded in supabase_migrations.schema_migrations compared to the files that
// describe them. Version 0010 (white_label_branding) sat in production for a day
// with no file here; nothing in this suite could have noticed.
//
// Run:  node tools/test_production_drift.mjs
//       node tools/test_production_drift.mjs --bundle=path/to/other.sql   (tests)
// Exits 1 on drift. Needs a `supabase link`ed, authenticated project; the caller
// decides whether that is available (tools/check.sh warns and skips when not).
// ============================================================
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const bundleArg = args.find((a) => a.startsWith('--bundle='));
const BUNDLE = bundleArg ? bundleArg.slice('--bundle='.length) : 'supabase/schema_final.sql';

const CREATE_RE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)/i;
const md5 = (s) => createHash('md5').update(s).digest('hex');

// A function's body is the first dollar-quoted block after its name. The argument
// list cannot be skipped by matching balanced parentheses: `vector(1024)` nests, and
// a regex that eats it silently drops knowledge_search from the comparison.
function bundleFunctions(sql) {
  const bodies = new Map();
  let at = 0;
  while (at < sql.length) {
    const m = sql.slice(at).match(CREATE_RE);
    if (!m) break;
    const name = m[1];
    const headerEnd = at + m.index + m[0].length;
    const open = sql.slice(headerEnd).match(/\$([A-Za-z_0-9]*)\$/);
    if (!open) { at = headerEnd; continue; }
    const start = headerEnd + open.index + open[0].length;
    const closeTag = open[0];
    const end = sql.indexOf(closeTag, start);
    if (end === -1) break;
    // Last definition wins, mirroring what `create or replace` leaves in the catalog.
    bodies.set(name, sql.slice(start, end));
    at = end + closeTag.length;
  }
  return bodies;
}

function query(sqlText) {
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--output-format', 'json', sqlText],
    { encoding: 'utf8', timeout: 240_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const start = out.indexOf('[');
  if (start === -1) throw new Error('no JSON in supabase db query output');
  return JSON.parse(out.slice(start));
}

const bodies = bundleFunctions(readFileSync(BUNDLE, 'utf8'));
if (bodies.size < 20) {
  console.error(`only parsed ${bodies.size} function definitions from ${BUNDLE} — the extractor is broken, not the database`);
  process.exit(1);
}

// Exits 2 when the project could not be read at all — unauthenticated, offline,
// or linked to a paused compute. Drift is a failure; absence of evidence is not,
// or every pre-commit hook without credentials would go red for the wrong reason.
let rows, recorded;
try {
  rows = query('select p.proname as name, md5(p.prosrc) as hash '
    + 'from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = \'public\'');
  recorded = query('select version from supabase_migrations.schema_migrations order by version')
    .map((r) => r.version);
} catch (e) {
  console.log(`could not read the linked project: ${String(e.message ?? e).split('\n')[0]}`);
  process.exit(2);
}
const live = new Map();
for (const r of rows) {
  if (!live.has(r.name)) live.set(r.name, new Set());
  live.get(r.name).add(r.hash);
}

const localFiles = new Set(readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.slice(0, 4)));

const bad = [];
const warn = [];
for (const [name, body] of [...bodies].sort()) {
  const hashes = live.get(name);
  if (!hashes) { bad.push(`${name} is defined by ${BUNDLE} and does not exist in the project`); continue; }
  if (!hashes.has(md5(body))) {
    bad.push(`${name} does not match the bundle (production md5 ${[...hashes].join(', ')})`);
  }
}
for (const v of recorded) if (!localFiles.has(v)) bad.push(`version ${v} is applied to the project with no file in supabase/migrations/`);
for (const v of [...localFiles].sort()) if (!recorded.includes(v)) warn.push(`version ${v} exists locally but is not recorded on the project (a pending db push, or applied as SQL without recording it)`);

for (const b of bad) console.log(`  DRIFT   ${b}`);
for (const w of warn) console.log(`  note    ${w}`);
console.log(`${bodies.size} bundle-defined functions compared by body hash against the linked project, `
  + `${recorded.length} recorded migration versions compared to ${localFiles.size} files: `
  + `${bad.length} drift(s), ${warn.length} note(s)`);
process.exit(bad.length ? 1 : 0);
