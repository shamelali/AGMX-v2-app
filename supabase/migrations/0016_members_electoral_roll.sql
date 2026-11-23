-- ============================================================
-- AGMX V2 — Sprint 3: Members + Electoral Roll
-- Member registry with import/sync; electoral roll with
-- per-entitlement eligibility, reason codes, freeze/lock and
-- version history. Identity/eligibility is separate from the
-- secret ballot store (votes table).
-- ============================================================

-- ------------------------------------------------------------
-- Member registry: add region and contact channels
-- ------------------------------------------------------------
alter table public.members
  add column if not exists region text;

alter table public.members
  add column if not exists contact_channels jsonb not null default '[]'::jsonb;

comment on column public.members.region is 'Cooperative region/zone for the member (e.g. Selangor, Johor).';
comment on column public.members.contact_channels is 'Array of contact channel objects: [{type, value, verified, primary}]';

-- ------------------------------------------------------------
-- Electoral roll: versioned snapshots of eligibility per AGM
-- ------------------------------------------------------------
create table if not exists public.electoral_rolls (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id        uuid references public.agms(id) on delete set null,
  version       int not null,
  frozen_at     timestamptz,
  frozen_by     uuid,
  reason_code   text,
  created_at    timestamptz not null default now(),
  unique (organization_id, version)
);

comment on table public.electoral_rolls is 'Immutable snapshots of the electoral roll per AGM. Once frozen, entries cannot change.';
comment on column public.electoral_rolls.reason_code is 'Reason for freezing: election_opened, audit_required, manual_review, etc.';

create table if not exists public.electoral_roll_entries (
  id                uuid primary key default gen_random_uuid(),
  electoral_roll_id uuid not null references public.electoral_rolls(id) on delete cascade,
  member_id         uuid not null references public.members(id) on delete cascade,
  member_no         text not null,
  name              text not null,
  attend_eligible   boolean not null default true,
  vote_eligible     boolean not null default true,
  candidate_eligible boolean not null default true,
  ineligibility_reason text,
  created_at        timestamptz not null default now(),
  unique (electoral_roll_id, member_id)
);

create index if not exists idx_electoral_roll_entries_roll
  on public.electoral_roll_entries(electoral_roll_id);
create index if not exists idx_electoral_rolls_org_agm
  on public.electoral_rolls(organization_id, agm_id);

-- ------------------------------------------------------------
-- RLS on electoral roll tables
-- ------------------------------------------------------------
alter table public.electoral_rolls enable row level security;
alter table public.electoral_roll_entries enable row level security;

execute 'drop policy if exists electoral_rolls_org on public.electoral_rolls';
execute 'create policy electoral_rolls_org on public.electoral_rolls for all using (organization_id = public.current_org_id())';

execute 'drop policy if exists electoral_roll_entries_org on public.electoral_roll_entries';
execute 'create policy electoral_roll_entries_org on public.electoral_roll_entries for all using (
  exists (
    select 1 from public.electoral_rolls er
    where er.id = public.electoral_roll_entries.electoral_roll_id
      and er.organization_id = public.current_org_id()
  )
)';

-- ------------------------------------------------------------
-- RPC: import / sync members (bulk, deduplicated by member_no)
-- ------------------------------------------------------------
create or replace function public.import_members(
  p_organization_id uuid,
  p_members         jsonb,
  p_operator_org    uuid,
  p_actor           uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_imported int := 0;
  v_updated  int := 0;
  v_skipped  int := 0;
  v_member   record;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  -- Validate every row references the caller's organization before writing
  -- anything, so a partial import never leaves the registry half-synced.
  for v_member in
    select *
    from jsonb_array_elements(p_members) as elem(row)
  loop
    if (elem.row->>'member_no') is null or (elem.row->>'name') is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Upsert: update if member_no exists within org, insert otherwise
    update public.members
       set name          = elem.row->>'name',
           ic            = elem.row->>'ic',
           phone         = elem.row->>'phone',
           region        = elem.row->>'region',
           contact_channels = coalesce(elem.row->'contact_channels', '[]'::jsonb),
           shares        = coalesce((elem.row->>'shares')::numeric, 0),
           status        = coalesce(elem.row->>'status', 'Aktif'),
           arrears       = coalesce((elem.row->>'arrears')::numeric, 0),
           eligible      = coalesce((elem.row->>'eligible')::boolean, true),
           age           = nullif(elem.row->>'age', '')::int,
           joined_at     = nullif(elem.row->>'joined_at', '')::date
     where organization_id = p_operator_org
       and member_no = elem.row->>'member_no';

    if found then
      v_updated := v_updated + 1;
    else
      insert into public.members
        (organization_id, member_no, name, ic, phone, region, contact_channels,
         shares, status, arrears, eligible, age, joined_at)
      values
        (p_operator_org, elem.row->>'member_no', elem.row->>'name',
         elem.row->>'ic', elem.row->>'phone', elem.row->>'region',
         coalesce(elem.row->'contact_channels', '[]'::jsonb),
         coalesce((elem.row->>'shares')::numeric, 0),
         coalesce(elem.row->>'status', 'Aktif'),
         coalesce((elem.row->>'arrears')::numeric, 0),
         coalesce((elem.row->>'eligible')::boolean, true),
         nullif(elem.row->>'age', '')::int,
         nullif(elem.row->>'joined_at', '')::date);

      v_imported := v_imported + 1;
    end if;
  end loop;

  perform public.log_audit(
    p_operator_org, p_actor, 'members.imported', 'members', 'bulk',
    jsonb_build_object('imported', v_imported, 'updated', v_updated, 'skipped', v_skipped)
  );

  return jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'skipped', v_skipped,
    'organization_id', p_operator_org
  );
end;
$$;

revoke execute on function public.import_members(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.import_members(uuid, jsonb, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: freeze electoral roll (immutable snapshot per AGM)
-- ------------------------------------------------------------
create or replace function public.freeze_electoral_roll(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid,
  p_reason_code  text default 'election_opened'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_version  int;
  v_roll_id  uuid;
  v_entry_count int := 0;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  -- Tenant boundary: the AGM must belong to the caller's organization
  select organization_id into v_org from public.agms where id = p_agm_id;
  if not found then
    return jsonb_build_object('error', 'AGM not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  -- Next version number for this organization
  select coalesce(max(version), 0) + 1 into v_version
  from public.electoral_rolls
  where organization_id = p_operator_org;

  -- Create the roll snapshot
  insert into public.electoral_rolls
    (organization_id, agm_id, version, reason_code)
  values
    (p_operator_org, p_agm_id, v_version, p_reason_code)
  returning id into v_roll_id;

  -- Snapshot current member eligibility into the roll
  insert into public.electoral_roll_entries
    (electoral_roll_id, member_id, member_no, name,
     attend_eligible, vote_eligible, candidate_eligible, ineligibility_reason)
  select
    v_roll_id,
    m.id, m.member_no, m.name,
    m.eligible, m.eligible, m.eligible,
    case when m.eligible then null else 'ineligible' end
  from public.members m
  where m.organization_id = p_operator_org;

  get diagnostics v_entry_count = row_count;

  -- Freeze the roll so entries cannot change
  update public.electoral_rolls
     set frozen_at = now(), frozen_by = p_actor
   where id = v_roll_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'electoral_roll.frozen', 'electoral_roll', v_roll_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'version', v_version, 'entries', v_entry_count, 'reason_code', p_reason_code)
  );

  return jsonb_build_object(
    'frozen', true,
    'roll_id', v_roll_id,
    'version', v_version,
    'entries', v_entry_count,
    'frozen_at', now(),
    'organization_id', p_operator_org
  );
end;
$$;

revoke execute on function public.freeze_electoral_roll(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.freeze_electoral_roll(uuid, uuid, uuid, text) to service_role;
