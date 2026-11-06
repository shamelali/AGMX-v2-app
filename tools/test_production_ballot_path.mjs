#!/usr/bin/env node
// ============================================================
// Read-only proof of the ballot path on the live project.
// ------------------------------------------------------------
// Supabase branching needs the Pro plan, so this cannot run the journey on a copy
// of production. What it does instead is prove three things about the live database
// without writing a single row:
//
//   1. The repaired bodies are the ones the repository vouches for, read as text
//      rather than inferred from a version number — pass 26 hashes them, this says
//      what the hash is standing for.
//   2. The engine genuinely has no max(boolean), so the text production was running
//      was fatal here, not merely untidy. Every ballot in a live AGM would have
//      raised, and the quorum guard around it failed open.
//   3. cast_vote executes and returns its first guard. plpgsql compiles each
//      statement when it reaches it, so a function that dies on an undeclared
//      variable never has to reach that line to fail — this reaches it.
//
// The call in (3) is write-free by construction: the function's first statement is
// `select * into v_motion from motions where id = p_motion_id`, and a random uuid
// matches nothing, so it returns {'error':'Motion not found'} before any insert.
// votes and audit_events are counted before and after to prove that, because
// audit_events is append-only by trigger and a row written in error could not be
// taken back afterwards.
//
// Exit 0 = proven, 1 = contradicted, 2 = the project could not be read.
// ============================================================
import { execFileSync } from 'node:child_process';

function query(sqlText) {
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--output-format', 'json', sqlText],
    { encoding: 'utf8', timeout: 240_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const start = out.indexOf('[');
  if (start === -1) throw new Error('no JSON in supabase db query output');
  return JSON.parse(out.slice(start));
}

const CENSUS = 'select (select count(*) from public.votes) as votes, '
  + '(select count(*) from public.audit_events) as audit_events';

const ASSERTIONS = `
with live as (
  select p.proname as name, p.prosrc as src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('cast_vote', 'log_audit', 'record_resolution')
),
env as (
  select current_setting('server_version_num')::int as vnum,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'auth' and p.proname = 'uid') as auth_uid,
    (select extversion from pg_extension where extname = 'vector') as vector_ver,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pg_catalog' and p.proname = 'max'
        and p.proargtypes::regtype[] @> array['boolean'::regtype]) as max_bool
)
select jsonb_build_object(
  'server_version_num', (select vnum from env),
  'auth_uid_defined',   (select auth_uid > 0 from env),
  'vector_installed',   (select vector_ver is not null from env),
  'engine_lacks_max_of_boolean', (select max_bool = 0 from env),
  'cast_vote_reads_latest_snapshot', (select src ~ 'order by captured_at desc' from live where name = 'cast_vote'),
  -- Match the expression, not the word: the fix left a comment naming max(boolean),
  -- and prose about a defect is not the defect.
  'cast_vote_lacks_defective_guard', (select src ~ 'coalesce\\(max\\(satisfied\\), false\\)' is false from live where name = 'cast_vote'),
  'cast_vote_coalesces_after_into',  (select src ~ 'coalesce\\(v_satisfied, false\\)' from live where name = 'cast_vote'),
  'log_audit_matches_null_org',      (select src ~ 'is not distinct from' from live where name = 'log_audit'),
  'log_audit_seeds_chain_head',      (select src ~ 'repeat\\(''0'', 64\\)' from live where name = 'log_audit'),
  'record_resolution_uses_jsonb_var',(select src ~ 'v_existing jsonb' from live where name = 'record_resolution')
) as report`;

const EXPECTED_TRUE = ['auth_uid_defined', 'vector_installed', 'engine_lacks_max_of_boolean',
  'cast_vote_reads_latest_snapshot', 'cast_vote_lacks_defective_guard',
  'cast_vote_coalesces_after_into', 'log_audit_matches_null_org',
  'log_audit_seeds_chain_head', 'record_resolution_uses_jsonb_var'];

let before, report, guard, after;
try {
  before = query(CENSUS)[0];
  report = query(ASSERTIONS)[0].report;
  guard = query("select public.cast_vote(gen_random_uuid(), gen_random_uuid(), 'yea') as r")[0].r;
  after = query(CENSUS)[0];
} catch (e) {
  console.log(`could not read the linked project: ${String(e.message ?? e).split('\n')[0]}`);
  process.exit(2);
}

// The driver hands back jsonb either parsed or as text, depending on the column.
if (typeof guard === 'string') {
  try { guard = JSON.parse(guard); } catch { /* the check below reports what came back */ }
}

const failures = [];
for (const key of EXPECTED_TRUE) {
  if (report[key] !== true) failures.push(`${key} is ${JSON.stringify(report[key])} on the live project`);
}
if (guard?.error !== 'Motion not found') {
  failures.push(`cast_vote with an unknown motion returned ${JSON.stringify(guard)} — expected the first guard`);
}
for (const table of ['votes', 'audit_events']) {
  if (String(before[table]) !== String(after[table])) {
    failures.push(`${table} moved from ${before[table]} to ${after[table]} — the probe wrote to production`);
  }
}

console.log(`  live Postgres ${report.server_version_num}, pgvector ${report.vector_installed ? 'installed' : 'ABSENT'}, `
  + `votes ${before.votes}, audit_events ${before.audit_events} (unchanged by this probe)`);
for (const f of failures) console.log(`  FAIL    ${f}`);
console.log(`${EXPECTED_TRUE.length + 3} assertions about the live ballot path, `
  + `${failures.length} failure(s): the repaired SQL is what production runs and cast_vote executes write-free`);
process.exit(failures.length ? 1 : 0);
