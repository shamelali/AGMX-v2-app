#!/usr/bin/env node
/* ============================================================
   AGMX — is the documented deploy bundle rerun-safe on a real database?

   DEPLOY.md and deploy.sh both hand an operator supabase/schema_final.sql to
   paste into the Supabase SQL editor. Re-pasting it is the normal recovery path
   after a partial run, and the bundle's own header promises it is rerunnable.
   Pass 21 checks that promise by pattern — every `create policy` preceded by a
   `drop policy if exists` — which is a grep, not a deploy. This is the deploy:
   the file is applied to embedded Postgres twice, and the catalog is compared
   before and after.

   It exists for the other half of a deploy, though: Postgres reports success for
   statements that changed nothing, so a bundle can look idempotent and still
   break. `alter table ... add constraint` without a guard, a `create trigger`
   whose `drop trigger if exists` was forgotten, or a seed row without
   `on conflict` each fail on paste two, in front of an operator, with the first
   cooperative's data already in the tables.

   And it runs the SQL audit writer, which the journey test never reaches —
   governance's RPCs `perform log_audit(...)`, while every audit row the journey
   test asserts was written by money-flow's client-side hash chain. That is where
   the suite found the worst defect it has ever found: log_audit's chain head read
   yielded NULL on an organization's first event, hashed NULL into a NOT NULL
   column, and was swallowed by its own exception handler, so the AGM-day audit
   trail was never written at all. See the comment at its call site below.

   No credentials, no network. Usage:  node tools/test_bundle_replay.mjs
   ============================================================ */
import { applyBundle, bootDatabase, makeRestClient, seedUser } from "./agmx_db.mjs";

const failures = [];
function check(cond, label) {
  if (!cond) failures.push(label);
  return cond;
}

/* ---------- 1. the first paste: what a new deployment gets ---------- */
const { db, stats: first } = await bootDatabase();
check(first.statements > 150,
  `first paste ran only ${first.statements} statements — the bundle was not applied in full`);
check(first.skippedSections.join() === "0002_knowledge.sql",
  `skipped sections were ${first.skippedSections.join()}, expected only the pgvector knowledge section`);

const rest = makeRestClient(db);

/* A cooperative, its secretary, and an AGM — enough state that "nothing
   changed on the second paste" is about real rows, not an empty schema. */
const secretary = crypto.randomUUID();
const org = (await rest.from("organizations")
  .insert({ name: "Koperasi Pasteran Test", slug: "koperasi-pasteran-test" }).select("id").single()).data;
await seedUser(db, { id: secretary, email: "setiausaha@pasteran.test" });
rest.registerActor({ id: secretary });
await rest.from("profiles").insert({ id: secretary, organization_id: org.id, full_name: "Setiausaha", role: "admin" });
const scheduledAgm = await rest.from("agms").insert({
  organization_id: org.id,
  title: "AGM Biasa 2026",
  edition: 42,
  fiscal_year: "FY2025",
  scheduled_at: new Date(Date.now() + 30 * 864e5).toISOString(),
  venue: "Balai Raya, Kuala Lumpur",
  quorum_pct: 25,
}).select("id").single();
check(!scheduledAgm.error && scheduledAgm.data, `agms insert failed: ${scheduledAgm.error?.message}`);
const agm = scheduledAgm.data;

/* The pre-tenant audit row, written by the SQL helper rather than by
   money-flow's client-side hash chain. Both audit writers map the zero UUID to
   NULL; only one of them is a single SQL statement a re-paste cannot break. */
const loggedRow = await rest.rpc("log_audit", {
  p_org: null, p_actor: null, p_action: "assessment.submitted",
  p_entity_type: "agm_assessment", p_entity_id: agm?.id ?? org.id, p_payload: { complexityScore: 41 },
});
check(!loggedRow.error, `log_audit rejected a pre-tenant row: ${loggedRow.error?.message}`);

/* Every governance RPC audits through log_audit(), so this is the only place in
   the suite that can prove the record a cooperative's AGM is supposed to leave
   behind. It failed on the first run: log_audit read the chain head with
   `select coalesce(hash, '0') into v_prev ... limit 1`, which leaves v_prev NULL
   when no row matches — so the first event of every organization hashed NULL
   into a NOT NULL column, and the `exception when others` block swallowed the
   violation. Because the chain could never start, no event ever did: AGM-day
   auditability was empty for every tenant, with a warning in the log and an
   HTTP 200 for the user. */
const started = await rest.rpc("start_agm", { p_agm_id: agm.id });
check(!started.error && !started.data?.error,
  `start_agm failed: ${started.error?.message || started.data?.error}`);
const chain = await rest.from("audit_events").select("action, prev_hash, hash, entity_id")
  .eq("organization_id", org.id).order("occurred_at", { ascending: true });
check((chain.data || []).length >= 1,
  `start_agm left no audit row for the organization (${(chain.data || []).length}) — the server-side trail is not being written`);
check((chain.data || [])[0]?.prev_hash === "0".repeat(64),
  `the organization's chain head is ${(chain.data || [])[0]?.prev_hash}, not 64 zeros`);
check((chain.data || []).every((e) => e.hash), "an audit event was written without a hash");

/* ---------- 2. the catalog as the first paste left it ---------- */
async function fingerprint() {
  const { rows } = await db.query(`
    select
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p','v','m'))          as relations,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','auth'))                                   as functions,
      (select count(*)::int from pg_policies where schemaname = 'public')       as policies,
      (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal)                      as triggers,
      (select count(*)::int from pg_constraint k join pg_namespace n on n.oid = k.connamespace
        where n.nspname = 'public')                                             as constraints,
      (select count(*)::int from pg_indexes where schemaname = 'public')        as indexes`);
  return rows[0];
}
const before = await fingerprint();
check(before.relations > 30 && before.policies > 30 && before.triggers > 2,
  `the first paste left an unexpectedly thin catalog (${JSON.stringify(before)})`);

/* ---------- 3. the second paste ---------- */
const { stats: second } = await applyBundle(db);
check(second.statements === first.statements,
  `the second paste applied ${second.statements} statements against ${first.statements} on the first — a rerun must repeat the file, not trim it`);
check(second.skippedSections.join() === first.skippedSections.join()
  && second.skippedStatements.length === first.skippedStatements.length,
  "the second paste skipped a different set of pgvector statements than the first");

const after = await fingerprint();
const drift = Object.keys(before).filter((k) => before[k] !== after[k]);
check(drift.length === 0,
  `re-pasting the bundle changed the catalog: ${drift.map((k) => `${k} ${before[k]} -> ${after[k]}`).join(", ")}`);

/* ---------- 4. and the data is still there, still guarded ---------- */
const stillOrg = await rest.from("organizations").select("name, slug").eq("id", org.id).single();
check(!stillOrg.error && stillOrg.data?.slug === "koperasi-pasteran-test",
  `the cooperative registered before the re-paste is gone: ${stillOrg.error?.message || "row not found"}`);
const stillAgm = await rest.from("agms").select("id, title").eq("organization_id", org.id).single();
check(!stillAgm.error && stillAgm.data?.id === agm.id, "its AGM did not survive the re-paste");

const chainAfter = await rest.from("audit_events").select("id, hash")
  .eq("organization_id", org.id).order("occurred_at", { ascending: true });
check((chainAfter.data || []).length === (chain.data || []).length
  && (chainAfter.data || []).every((row, i) => row.hash === chain.data[i].hash),
  "the audit chain the first paste wrote was not the chain the second paste left behind");

const prospectEvents = await rest.from("audit_events").select("id, action")
  .filter("organization_id", "is", "null").eq("action", "assessment.submitted");
check(!prospectEvents.error && (prospectEvents.data || []).length === 1,
  `log_audit's pre-tenant row counts ${(prospectEvents.data || []).length} after re-pasting (${prospectEvents.error?.message || "read ok"}) — the NULL-organization record a prospect leaves is what 0009 exists to keep`);

/* The append-only guard is a trigger; a bundle that re-creates it without the
   drop fails the paste, and one that arms it twice would double-fire. Either way
   the audit record stops being provably immutable. */
if (prospectEvents.data?.length) {
  const tampered = await rest.from("audit_events").update({ action: "agm.started" })
    .eq("id", prospectEvents.data[0].id).select("id");
  check(tampered.error && /Append-only/.test(tampered.error.message),
    "after the second paste an audit event could be rewritten — the append-only trigger is no longer armed");
}

const seeded = await db.query(`select count(*)::int as n from public.plans`);
const codes = await db.query(`select count(distinct code)::int as n from public.plans`);
check(seeded.rows[0].n === codes.rows[0].n,
  `the plans seed duplicated on re-paste (${codes.rows[0].n} codes, ${seeded.rows[0].n} rows) — a rate card with two prices per plan is what the quote builder reads`);

const compliance = await rest.rpc("run_compliance_checks", { p_org: org.id, p_agm_id: agm.id });
check(!compliance.error, `run_compliance_checks failed after the second paste: ${compliance.error?.message}`);

/* ---------- 5. the run must not have been vacuous ---------- */
check(rest.executed.queries > 5 && rest.executed.rpcs > 1,
  `only ${rest.executed.queries} queries and ${rest.executed.rpcs} RPCs ran — this pass asserted almost nothing`);

const counts = Object.keys(after).map((k) => `${after[k]} ${k}`).join(", ");
console.log(`bundle-rerun: ${first.statements} statements applied twice, catalog unchanged (${counts})`);
if (failures.length) {
  for (const f of failures) console.error("  FAILED: " + f);
  console.error(`${failures.length} check(s) failed`);
  process.exitCode = 1;
}
await db.close();
