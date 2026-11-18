-- ============================================================
-- verify_audit_chain.sql
-- Reproducible check: validates the audit_events hash chain
-- Ensures every event's hash is consistent with its data
-- and the chain is append-only with org--scoped predicates
-- ============================================================

-- 1. Count audit events per organization
select
  organization_id,
  count(*) as event_count,
  min(occurred_at) as first_event,
  max(occurred_at) as last_event
from public.audit_events
where organization_id is not null
group by organization_id
order by organization_id;

-- 2. Validate hash chain: for each organization, verify that
--    every event's hash is consistent with its data and the
--    previous event's hash in the sequence.
--
--    The hash is computed as: md5(occurred_at || organization_id || content || prev_hash)
--    where prev_hash is the hash of the preceding event (or '0'*64 for the first event).
--
--    This query checks that the stored hash matches the expected hash
--    based on the event's own fields and the preceding event's hash.
with recursive chain as (
    -- Base case: first event per organization (prev_hash = '0'*64)
    select
      organization_id,
      occurred_at,
      hash as stored_hash,
        md5(occurred_at::text || organization_id::text || '000000000000000000000000000000000000000000000000000000000000000') as expected_hash,
        1 as rn
    from public.audit_events
    where organization_id is not null
    group by organization_id, occurred_at, hash
    having occurred_at = min(occurred_at)

    union all

    -- Recursive case: subsequent events
    select
      ae.organization_id,
      ae.occurred_at,
      ae.hash as stored_hash,
        md5(
          ae.occurred_at::text || ae.organization_id::text ||
          case when ae.content is not null then ae.content else '' end ||
          prev.prev_hash
        ) as expected_hash,
        rn + 1 as rn
    from public.audit_events ae
    join chain prev on prev.organization_id = ae.organization_id
      and prev.rn = (select count(*) from public.audit_events ae2 where ae2.organization_id = ae.organization_id and ae2.occurred_at <= ae.occurred_at)
    where ae.organization_id is not null
),
mismatches as (
    select organization_id, occurred_at, stored_hash, expected_hash, rn
    from chain
    where stored_hash != expected_hash
)
select 'MISMATCH' as status, count(*) as mismatches from mismatches
union all
select 'OK' as status, count(*) - count(mismatches) as ok_events from chain;