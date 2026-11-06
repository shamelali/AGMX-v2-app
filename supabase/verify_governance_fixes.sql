-- ============================================================
-- AGMX — pre/post check for the governance SQL fixes
--
-- What it proves: that production's installed functions are the ones this
-- repository now holds, i.e. that a ballot can be cast, an AGM audit row is
-- actually written, and a prospect's own record is not rejected.
--
-- How to run: paste into the Supabase dashboard SQL editor against project
-- jchfalaibabmszewemat, BEFORE applying 0007/0008/0009 (to see what is broken)
-- and again AFTER (to see it fixed). Every statement here is a SELECT, except
-- the functional probe, which runs inside a transaction that always ROLLBACKs,
-- so it leaves no row, no motion and no audit entry behind.
--
-- Order of application, if applying by hand rather than `supabase db push`:
--   0007_governance_rpc.sql   then   0008_governance_bugfixes.sql
-- 0008 redefines cast_vote and record_resolution on top of 0007; running them
--  the other way leaves the broken 0007 bodies installed.
--   0009_audit_all_stages.sql  (relaxes audit_events.organization_id)
-- 0009 without 0007 is the worst combination: the constraint stops rejecting
--  prospect rows while log_audit() still silently drops everything, so the
--  audit table looks writable and still records nothing.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 0009 — a prospect's audit row must be storable
-- ------------------------------------------------------------
select
  organization_id_is_nullable = 'YES' as pass,
  'audit_events.organization_id is_nullable = ' || organization_id_is_nullable as detail
from (
  select is_nullable as organization_id_is_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'audit_events'
     and column_name = 'organization_id'
) c;

-- ------------------------------------------------------------
-- 2. 0007/0008 — the aggregate that does not exist
--
-- max(boolean) is not a Postgres aggregate, and plpgsql does not compile a body
-- at CREATE FUNCTION, so this text in pg_proc means every ballot returns 500 on
-- the first call while the deploy that installed it reported success. Zero rows
-- is the pass condition.
-- ------------------------------------------------------------
select p.proname,
       pg_get_function_identity_arguments(p.oid) as signature,
       'still contains max(satisfied) — cast_vote will 500' as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosrc like '%max(satisfied)%';

-- ------------------------------------------------------------
-- 3. 0007/0008 — the quorum guard must fail CLOSED, not open
--
-- The old guard was `select coalesce(max(satisfied), false) into v_satisfied`,
-- which reads as "default to false" but is not: SELECT INTO that matches no row
-- overwrites the target with NULL, so an AGM with no attendance snapshot had
-- v_satisfied NULL, the `if not v_satisfied` test evaluated to NULL — not TRUE —
-- and the guard did not fire: an unquorate meeting accepted ballots. Reading the
-- newest snapshot explicitly and coalescing inside the test keeps it closed.
-- ------------------------------------------------------------
select p.proname,
       (p.prosrc like '%order by captured_at desc%')
         and (p.prosrc like '%not coalesce(v_satisfied%') as pass,
       'quorum guard reads the latest snapshot and fails closed' as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'cast_vote';

-- ------------------------------------------------------------
-- 4. 0007 — log_audit must be able to start a chain
--
-- Two bugs, one symptom. `coalesce(hash, '0')` sat *inside* a SELECT INTO, so on
-- an organization's first event — where no row matches — v_prev was NULL; and
-- `organization_id = p_org` matches nothing when p_org IS NULL, which is how both
-- audit writers record a prospect. A NULL v_prev hashes to a NULL v_hash, the
-- NOT NULL unique column rejects it, and log_audit's own `exception when others`
-- swallowed the violation into a warning. So no governance audit event was ever
-- written, for any tenant, behind HTTP 200s. Both patterns must be present.
-- ------------------------------------------------------------
select p.proname,
       (p.prosrc like '%is not distinct from p_org%')
         and (p.prosrc like '%repeat(''0'', 64)%') as pass,
       'chain head is coalesced outside the row read, and NULL tenants match' as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'log_audit';

-- ------------------------------------------------------------
-- 5. 0008 — record_resolution's duplicate branch must assign to its own type
--
-- It once selected a jsonb row into v_res_id uuid: a numeric or character value
-- cannot be assigned to a uuid, so the branch raised 22P02 the moment a motion
-- was resolved twice. v_existing jsonb is what the fix declares.
-- ------------------------------------------------------------
select p.proname,
       (p.prosrc like '%v_existing%') as pass,
       'duplicate-resolution branch reads into a jsonb variable' as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_resolution';

-- ------------------------------------------------------------
-- 6. functional probe — does log_audit actually write?
--
-- Checks 1-5 read text. This one runs the function. It is wrapped in a
-- transaction that ROLLBACKs, so the throwaway organization, its audit row and
-- the pre-tenant row all disappear. Run it as the dashboard role (postgres);
-- service_role would also work, anon would not.
-- ------------------------------------------------------------
begin;

insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-0000ffff0001', 'VERIFY ONLY — ROLLED BACK',
        'verify-only-rolled-back');

-- an organization's FIRST event: the case that used to hash NULL
select public.log_audit('00000000-0000-0000-0000-0000ffff0001'::uuid, null,
                        'verify.first_event', 'verify', 'probe-1',
                        jsonb_build_object('probe', 1));
-- a SECOND event: must chain from the first, not restart
select public.log_audit('00000000-0000-0000-0000-0000ffff0001'::uuid, null,
                        'verify.second_event', 'verify', 'probe-2',
                        jsonb_build_object('probe', 2));
-- a PROSPECT event: no organization at all (needs 0009 as well as 0007)
select public.log_audit(null, null, 'verify.prospect', 'agm_assessment', 'probe-3',
                        jsonb_build_object('probe', 3));

select
  written_tenant = 2 and written_prospect >= 1 as pass,
  'tenant rows ' || written_tenant || ', pre-tenant rows ' || written_prospect
    || ' — expected 2 and >=1; 0 means log_audit is still a silent no-op' as detail
from (
  select
    (select count(*) from public.audit_events
      where organization_id = '00000000-0000-0000-0000-0000ffff0001'::uuid) as written_tenant,
    (select count(*) from public.audit_events
      where organization_id is null and action = 'verify.prospect') as written_prospect
) s;

-- the chain must be linked, not two independent heads
select
  heads = 1 as pass,
  'chain heads (prev_hash = 64 zeros) = ' || heads || ', expected exactly 1' as detail
from (
  select count(*) as heads from public.audit_events
   where organization_id = '00000000-0000-0000-0000-0000ffff0001'::uuid
     and prev_hash = repeat('0', 64)
) h;

select
  linked = 1 as pass,
  'events chained to a hash this log actually holds = ' || linked || ', expected 1' as detail
from (
  select count(*) as linked from public.audit_events c
   where c.organization_id = '00000000-0000-0000-0000-0000ffff0001'::uuid
     and c.prev_hash is not null and c.prev_hash <> repeat('0', 64)
     and exists (select 1 from public.audit_events p
                  where p.hash = c.prev_hash
                    and p.organization_id = c.organization_id)
) l;

rollback;

-- ------------------------------------------------------------
-- 7. append-only guard must still be armed after the re-paste
-- ------------------------------------------------------------
select tg.tgname,
       tg.tgenabled = 'O' as pass,
       c.relname || ' trigger enabled = ' || tg.tgenabled::text as detail
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not tg.tgisinternal
   and tg.tgname in ('audit_append_only', 'votes_append_only',
                     'profiles_protect_privileged')
 order by tg.tgname;

-- ------------------------------------------------------------
-- 8. and the probe above really rolled everything back
--
-- Run AFTER the rollback. If these are not 0, the probe's transaction was not
-- rolled back and the throwaway organization has to be removed by hand.
-- ------------------------------------------------------------
select
  tenants = 0 and prospects = 0 as pass,
  'leftover verify organizations ' || tenants || ', leftover verify.prospect rows '
    || prospects || ' — both must be 0' as detail
from (
  select
    (select count(*) from public.organizations
      where slug = 'verify-only-rolled-back') as tenants,
    (select count(*) from public.audit_events
      where action in ('verify.first_event', 'verify.second_event', 'verify.prospect')) as prospects
) s;
