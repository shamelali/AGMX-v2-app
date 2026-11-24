-- ============================================================
-- AGMX V2 — Sprint 8: Nominations + Candidates
-- Nomination applications reviewed by operators; immutable
-- candidate snapshot taken when the election opens.
-- ============================================================

-- ------------------------------------------------------------
-- Nominations: member applications for election positions
-- ------------------------------------------------------------
create table if not exists public.nominations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  position        text not null,
  statement       text not null default '',
  status          text not null default 'submitted', -- submitted | reviewing | approved | rejected
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_reason   text,
  created_at      timestamptz not null default now()
);

comment on table public.nominations is 'Nomination applications for AGM election positions.';
comment on column public.nominations.status is 'submitted | reviewing | approved | rejected';

create index if not exists idx_nominations_agm on public.nominations(agm_id);
create index if not exists idx_nominations_member on public.nominations(member_id);

-- ------------------------------------------------------------
-- Candidates: immutable snapshot of approved nominations
-- taken when the election opens (unique per AGM + member)
-- ------------------------------------------------------------
create table if not exists public.candidates (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id       uuid not null references public.agms(id) on delete cascade,
  nomination_id uuid not null references public.nominations(id) on delete cascade,
  member_id    uuid not null references public.members(id),
  member_no    text not null,
  name         text not null,
  snapshot_at  timestamptz not null default now(),
  unique (agm_id, member_id)
);

comment on table public.candidates is 'Immutable candidate snapshot taken when an election opens.';

create index if not exists idx_candidates_agm on public.candidates(agm_id);

-- ------------------------------------------------------------
-- RLS on nomination tables
-- ------------------------------------------------------------
alter table public.nominations enable row level security;
alter table public.candidates enable row level security;

execute 'drop policy if exists nominations_org on public.nominations';
execute 'create policy nominations_org on public.nominations for all using (organization_id = public.current_org_id())';

execute 'drop policy if exists candidates_org on public.candidates';
execute 'create policy candidates_org on public.candidates for all using (organization_id = public.current_org_id())';

-- ------------------------------------------------------------
-- RPC: nomination_submit — a member applies for a position
-- ------------------------------------------------------------
create or replace function public.nomination_submit(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_position     text,
  p_statement    text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_nomination uuid;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select organization_id into v_org from public.agms where id = p_agm_id;
  if not found then
    return jsonb_build_object('error', 'AGM not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  if not exists (select 1 from public.members where id = p_member_id and organization_id = p_operator_org) then
    return jsonb_build_object('error', 'Member not found in this organisation');
  end if;

  -- Member must be eligible to stand as a candidate on the current roll
  if not exists (
        select 1 from public.electoral_rolls er
        join public.electoral_roll_entries ere on ere.electoral_roll_id = er.id
        where er.agm_id = p_agm_id
          and er.frozen_at is not null
          and ere.member_id = p_member_id
          and ere.candidate_eligible = true
      ) then
    return jsonb_build_object('error', 'Member not eligible to stand as candidate', 'code', 'NOT_CANDIDATE_ELIGIBLE');
  end if;

  insert into public.nominations
    (organization_id, agm_id, member_id, position, statement, status)
  values
    (p_operator_org, p_agm_id, p_member_id, p_position, coalesce(p_statement, ''), 'submitted')
  returning id into v_nomination;

  perform public.log_audit(
    p_operator_org, p_actor, 'nomination.submitted', 'nomination', v_nomination::text,
    jsonb_build_object('agm_id', p_agm_id, 'member_id', p_member_id, 'position', p_position)
  );

  return jsonb_build_object(
    'nomination_id', v_nomination,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'position', p_position,
    'status', 'submitted'
  );
end;
$$;

revoke execute on function public.nomination_submit(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.nomination_submit(uuid, uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: nomination_review — operator approves or rejects a nomination
-- ------------------------------------------------------------
create or replace function public.nomination_review(
  p_nomination_id uuid,
  p_approved      boolean,
  p_reason        text,
  p_operator_org  uuid,
  p_actor         uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_nomination uuid;
  v_status text;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select n.organization_id, n.agm_id, n.id, n.status
  into v_org, v_agm_id, v_nomination, v_status
  from public.nominations n where id = p_nomination_id;

  if not found then
    return jsonb_build_object('error', 'Nomination not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  update public.nominations
     set status = case when p_approved then 'approved' else 'rejected' end,
         reviewed_by = p_actor,
         reviewed_at = now(),
         review_reason = p_reason
   where id = v_nomination;

  perform public.log_audit(
    p_operator_org, p_actor, 'nomination.reviewed', 'nomination', v_nomination::text,
    jsonb_build_object('agm_id', v_agm_id, 'approved', p_approved, 'reason', p_reason)
  );

  return jsonb_build_object(
    'nomination_id', v_nomination,
    'agm_id', v_agm_id,
    'status', case when p_approved then 'approved' else 'rejected' end,
    'reviewed_at', now()
  );
end;
$$;

revoke execute on function public.nomination_review(uuid, boolean, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.nomination_review(uuid, boolean, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: candidates_snapshot — snapshot approved nominations as candidates
-- Called when the election opens. Idempotent: returns existing rows
-- if a snapshot already exists for this AGM.
-- ------------------------------------------------------------
create or replace function public.candidates_snapshot(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_count int;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select organization_id into v_org from public.agms where id = p_agm_id;
  if not found then
    return jsonb_build_object('error', 'AGM not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  -- Idempotent: if a snapshot already exists for this AGM, return it
  select count(*) into v_count from public.candidates where agm_id = p_agm_id;
  if v_count > 0 then
    return jsonb_build_object(
      'snapshot', false,
      'agm_id', p_agm_id,
      'candidates', v_count
    );
  end if;

  insert into public.candidates
    (organization_id, agm_id, nomination_id, member_id, member_no, name, snapshot_at)
  select
    n.organization_id, n.agm_id, n.id, n.member_id,
    m.member_no, m.name, now()
  from public.nominations n
  join public.members m on m.id = n.member_id
  where n.agm_id = p_agm_id
    and n.status = 'approved';

  get diagnostics v_count = row_count;

  perform public.log_audit(
    p_operator_org, p_actor, 'candidates.snapshot', 'candidates', p_agm_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'candidates', v_count)
  );

  return jsonb_build_object(
    'snapshot', true,
    'agm_id', p_agm_id,
    'candidates', v_count
  );
end;
$$;

revoke execute on function public.candidates_snapshot(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.candidates_snapshot(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read nomination tables (RLS scoped)
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.nominations, public.candidates to authenticated;
