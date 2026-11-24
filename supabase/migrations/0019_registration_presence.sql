-- ============================================================
-- AGMX V2 — Sprint 7: Registration + Presence + Quorum
-- Member RSVP per AGM, operator-assisted check-in, append-only
-- presence events. Registration counts feed the readiness gate
-- before Convene (ready -> live).
-- ============================================================

-- ------------------------------------------------------------
-- Registrations: one RSVP per member per AGM
-- ------------------------------------------------------------
create table if not exists public.registrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  status          text not null default 'rsvp',         -- rsvp | attending | not_attending | acknowledged
  channel         text not null default 'portal',        -- portal | notice | sms | email
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (agm_id, member_id)
);

comment on table public.registrations is 'Member registration/RSVP per AGM. One row per member per AGM.';
comment on column public.registrations.status is 'rsvp | attending | not_attending | acknowledged';
comment on column public.registrations.channel is 'How the registration was received: portal | notice | sms | email';

create index if not exists idx_registrations_agm on public.registrations(agm_id);
create index if not exists idx_registrations_member on public.registrations(member_id);

-- ------------------------------------------------------------
-- Presence events: append-only timestamped check-ins
-- ------------------------------------------------------------
create table if not exists public.presence_events (
  id            uuid primary key default gen_random_uuid(),
  agm_id        uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  method        text not null,                         -- kiosk | qr | portal | operator
  channel       text not null,                         -- physical | online
  checked_in_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.presence_events is 'Append-only log of member check-ins per AGM. Never updated or deleted.';
create index if not exists idx_presence_events_agm on public.presence_events(agm_id);
create index if not exists idx_presence_events_member on public.presence_events(member_id);

-- ------------------------------------------------------------
-- RLS on registration tables
-- ------------------------------------------------------------
alter table public.registrations enable row level security;
alter table public.presence_events enable row level security;

execute 'drop policy if exists registrations_org on public.registrations';
execute 'create policy registrations_org on public.registrations for all using (organization_id = public.current_org_id())';

execute 'drop policy if exists presence_events_org on public.presence_events';
execute 'create policy presence_events_org on public.presence_events for all using (organization_id = public.current_org_id())';

-- ------------------------------------------------------------
-- RPC: register_member — register/RSVP a member for an AGM
-- Idempotent: re-registering updates the existing row.
-- ------------------------------------------------------------
create or replace function public.register_member(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_status       text default 'rsvp',
  p_channel      text default 'portal',
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  -- Tenant boundary: AGM and member must belong to the caller's organization
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

  insert into public.registrations
    (organization_id, agm_id, member_id, status, channel, acknowledged_at)
  values
    (p_operator_org, p_agm_id, p_member_id, p_status, p_channel,
     case when p_status = 'acknowledged' then now() else null end)
  on conflict (agm_id, member_id) do update
    set status         = excluded.status,
        channel        = excluded.channel,
        acknowledged_at = case when excluded.status = 'acknowledged' then now()
                               else registrations.acknowledged_at end;

  perform public.log_audit(
    p_operator_org, p_actor, 'member.registered', 'registration', p_agm_id::text,
    jsonb_build_object('member_id', p_member_id, 'status', p_status, 'channel', p_channel)
  );

  return jsonb_build_object(
    'registered', true,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'status', p_status,
    'channel', p_channel
  );
end;
$$;

revoke execute on function public.register_member(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_member(uuid, uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: check_in_member — check a member in at an AGM
-- Self check-in (member checks themselves in) or operator check-in.
-- ------------------------------------------------------------
create or replace function public.check_in_member(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_method       text default 'portal',
  p_channel      text default 'physical',
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_event uuid;
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

  insert into public.presence_events
    (agm_id, organization_id, member_id, method, channel, checked_in_at)
  values
    (p_agm_id, v_org, p_member_id, p_method, p_channel, now())
  returning id into v_event;

  -- Mark the registration as attending (idempotent on the registration row)
  insert into public.registrations
    (organization_id, agm_id, member_id, status, channel)
  values
    (v_org, p_agm_id, p_member_id, 'attending', p_channel)
  on conflict (agm_id, member_id) do update
    set status  = 'attending',
        channel = coalesce(excluded.channel, registrations.channel);

  perform public.log_audit(
    p_operator_org, p_actor, 'member.checked_in', 'presence', v_event::text,
    jsonb_build_object('agm_id', p_agm_id, 'member_id', p_member_id, 'method', p_method, 'channel', p_channel)
  );

  return jsonb_build_object(
    'checked_in', true,
    'event_id', v_event,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'checked_in_at', now()
  );
end;
$$;

revoke execute on function public.check_in_member(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.check_in_member(uuid, uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read registration tables (RLS scoped)
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.registrations, public.presence_events to authenticated;
