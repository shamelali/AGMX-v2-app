-- ============================================================
-- AGMX V2 — Sprint 12: Minutes (manual Phase 1)
-- Draft -> editorial review -> verification -> approved -> locked.
-- Human verification mandatory before final; locked minutes are
-- append-only (no UPDATE/DELETE).
-- ============================================================

-- ------------------------------------------------------------
-- Minutes: the AGM record, versioned and locked
-- ------------------------------------------------------------
create table if not exists public.minutes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  title           text not null default 'Minit Mesyuarat Agung Tahunan',
  status          text not null default 'draft',      -- draft | editorial_review | verification | approved | locked
  drafted_by      uuid,
  drafted_at      timestamptz,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  verified_by     uuid,
  verified_at     timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  locked_at       timestamptz,
  locked_by       uuid,
  content         text not null default '',
  created_at      timestamptz not null default now(),
  unique (agm_id)
);

comment on table public.minutes is 'AGM minutes record with lifecycle: draft -> editorial_review -> verification -> approved -> locked.';
comment on column public.minutes.status is 'draft | editorial_review | verification | approved | locked';
comment on column public.minutes.content is 'Minutes content (plain text, no HTML)';

create index if not exists idx_minutes_agm on public.minutes(agm_id);

-- ------------------------------------------------------------
-- Minute versions: append-only version history
-- ------------------------------------------------------------
create table if not exists public.minute_versions (
  id         uuid primary key default gen_random_uuid(),
  minutes_id uuid not null references public.minutes(id) on delete cascade,
  version    int not null,
  content    text not null default '',
  edited_by  uuid,
  edited_at  timestamptz not null default now()
);

comment on table public.minute_versions is 'Append-only version history of minutes content.';

create index if not exists idx_minute_versions_minutes on public.minute_versions(minutes_id);

-- ------------------------------------------------------------
-- RLS on minutes tables
-- ------------------------------------------------------------
alter table public.minutes enable row level security;
alter table public.minute_versions enable row level security;

drop policy if exists minutes_org on public.minutes;
create policy minutes_org on public.minutes for all using (organization_id = public.current_org_id());

drop policy if exists minute_versions_org on public.minute_versions;
create policy minute_versions_org on public.minute_versions for all using (
  exists (
    select 1 from public.minutes m
    where m.id = public.minute_versions.minutes_id
      and m.organization_id = public.current_org_id()
  )
);

-- ------------------------------------------------------------
-- Trigger: locked minutes are append-only (no UPDATE/DELETE once locked)
-- ------------------------------------------------------------
create or replace function public.minutes_protect_locked()
returns trigger language plpgsql as $$
begin
  if old.locked_at is not null then
    raise exception 'Locked minutes cannot be updated or deleted';
  end if;
  return new;
end $$;

drop trigger if exists minutes_append_only on public.minutes;
create trigger minutes_append_only
  before update or delete on public.minutes
  for each row execute function public.minutes_protect_locked();

drop trigger if exists minute_versions_append_only on public.minute_versions;
create trigger minute_versions_append_only
  before update or delete on public.minute_versions
  for each row execute function public.raise_append_only();

-- ------------------------------------------------------------
-- RPC: minutes_create — create a draft minutes record
-- ------------------------------------------------------------
create or replace function public.minutes_create(
  p_agm_id       uuid,
  p_title        text,
  p_content      text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_id   uuid;
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

  insert into public.minutes
    (organization_id, agm_id, title, status, drafted_by, drafted_at, content, created_at)
  values
    (p_operator_org, p_agm_id, coalesce(p_title, 'Minit Mesyuarat Agung Tahunan'),
     'draft', p_actor, now(), coalesce(p_content, ''), now())
  returning id into v_id;

  insert into public.minute_versions (minutes_id, version, content, edited_by, edited_at)
  values (v_id, 1, coalesce(p_content, ''), p_actor, now());

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.created', 'minutes', v_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'title', coalesce(p_title, 'Minit Mesyuarat Agung Tahunan'), 'status', 'draft')
  );

  return jsonb_build_object(
    'minutes_id', v_id,
    'agm_id', p_agm_id,
    'status', 'draft',
    'version', 1
  );
end;
$$;

revoke execute on function public.minutes_create(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_create(uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_edit — draft-only edit; appends a new version
-- ------------------------------------------------------------
create or replace function public.minutes_edit(
  p_minutes_id   uuid,
  p_content      text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_status text;
  v_version int;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status is distinct from 'draft' then
    return jsonb_build_object('error', 'Only draft minutes can be edited', 'code', 'NOT_DRAFT');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.minute_versions where minutes_id = p_minutes_id;

  insert into public.minute_versions (minutes_id, version, content, edited_by, edited_at)
  values (p_minutes_id, v_version, coalesce(p_content, ''), p_actor, now());

  update public.minutes
     set content = coalesce(p_content, '')
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.edited', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'version', v_version)
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', v_status,
    'version', v_version
  );
end;
$$;

revoke execute on function public.minutes_edit(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_edit(uuid, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_submit_review — draft -> editorial_review
-- ------------------------------------------------------------
create or replace function public.minutes_submit_review(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_status text;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status is distinct from 'draft' then
    return jsonb_build_object('error', 'Only draft minutes can be submitted for review', 'code', 'NOT_DRAFT');
  end if;

  update public.minutes set status = 'editorial_review' where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.submitted_review', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'editorial_review')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'editorial_review'
  );
end;
$$;

revoke execute on function public.minutes_submit_review(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_submit_review(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_verify — human verification (mandatory before final)
-- editorial_review -> verification, sets verified_by/verified_at
-- ------------------------------------------------------------
create or replace function public.minutes_verify(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_status text;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'verification' then
    return jsonb_build_object('verified', false, 'minutes_id', p_minutes_id, 'status', 'verification');
  end if;
  if v_status not in ('editorial_review', 'verification') then
    return jsonb_build_object('error', 'Cannot verify minutes in status ' || v_status, 'code', 'INVALID_TRANSITION');
  end if;

  update public.minutes
     set status = 'verification', verified_by = p_actor, verified_at = now()
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.verified', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'verification')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'verification',
    'verified_by', p_actor,
    'verified_at', now()
  );
end;
$$;

revoke execute on function public.minutes_verify(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_verify(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_approve — verification -> approved
-- Requires human verification (verified_by not null)
-- ------------------------------------------------------------
create or replace function public.minutes_approve(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_status text;
  v_verified_by uuid;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select m.organization_id, m.agm_id, m.status, m.verified_by
  into v_org, v_agm_id, v_status, v_verified_by
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'approved' then
    return jsonb_build_object('approved', false, 'minutes_id', p_minutes_id, 'status', 'approved');
  end if;
  if v_status is distinct from 'verification' then
    return jsonb_build_object('error', 'Minutes must be in verification before approval', 'code', 'INVALID_TRANSITION');
  end if;
  if v_verified_by is null then
    return jsonb_build_object('error', 'Human verification required before approval', 'code', 'NOT_VERIFIED');
  end if;

  update public.minutes
     set status = 'approved', approved_by = p_actor, approved_at = now()
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.approved', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'approved')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'approved',
    'approved_by', p_actor,
    'approved_at', now()
  );
end;
$$;

revoke execute on function public.minutes_approve(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_approve(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_lock — approved -> locked (append-only thereafter)
-- ------------------------------------------------------------
create or replace function public.minutes_lock(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_status text;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'locked' then
    return jsonb_build_object('locked', false, 'minutes_id', p_minutes_id, 'status', 'locked');
  end if;
  if v_status is distinct from 'approved' then
    return jsonb_build_object('error', 'Minutes must be approved before locking', 'code', 'INVALID_TRANSITION');
  end if;

  update public.minutes
     set status = 'locked', locked_at = now(), locked_by = p_actor
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.locked', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'locked')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'locked',
    'locked_by', p_actor,
    'locked_at', now()
  );
end;
$$;

revoke execute on function public.minutes_lock(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_lock(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read minutes tables (RLS scoped)
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.minutes, public.minute_versions to authenticated;
