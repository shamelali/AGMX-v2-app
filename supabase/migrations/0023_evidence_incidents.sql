-- ============================================================
-- AGMX V2 — Sprint 13: Evidence Vault + Incident Register
-- Hash-registered evidence items, immutable export packages,
-- incident register. Append-only after registration/closure.
-- ============================================================

-- ------------------------------------------------------------
-- Evidence items: hash-registered evidence per AGM
-- ------------------------------------------------------------
create table if not exists public.evidence_items (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id        uuid not null references public.agms(id) on delete cascade,
  category      text not null,                         -- notice | roll | attendance | documents | nominations | ballots | minutes | incidents | audit_logs
  filename      text not null,
  storage_path  text not null,
  mime          text not null,
  size_bytes    bigint,
  sha256        text not null,
  registered_by uuid,
  created_at    timestamptz not null default now()
);

comment on table public.evidence_items is 'Evidence register: hash-registered artifacts per AGM (notice, roll, attendance, documents, nominations, ballots/tallies, minutes, incidents, audit logs).';
comment on column public.evidence_items.sha256 is 'SHA-256 of the stored artifact, registered at ingest time.';

create index if not exists idx_evidence_items_agm on public.evidence_items(agm_id);
create index if not exists idx_evidence_items_category on public.evidence_items(agm_id, category);

-- ------------------------------------------------------------
-- Evidence packages: export package, immutable after closure
-- ------------------------------------------------------------
create table if not exists public.evidence_packages (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id       uuid not null references public.agms(id) on delete cascade,
  status       text not null default 'collecting',     -- collecting | exported | closed
  exported_at  timestamptz,
  exported_by  uuid,
  export_path  text,
  sha256       text,
  closed_at    timestamptz,
  unique (agm_id)
);

comment on table public.evidence_packages is 'AGM Evidence Package export; immutable after closure (status closed).';
comment on column public.evidence_packages.status is 'collecting | exported | closed';

create index if not exists idx_evidence_packages_agm on public.evidence_packages(agm_id);

-- ------------------------------------------------------------
-- Incidents: incident register (append-only)
-- ------------------------------------------------------------
create table if not exists public.incidents (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id         uuid not null references public.agms(id) on delete cascade,
  occurred_at    timestamptz not null default now(),
  actor          text not null,
  description    text not null,
  evidence_refs  text[],
  resolution     text,
  created_at     timestamptz not null default now()
);

comment on table public.incidents is 'Incident register for AGM operations. Append-only: never updated or deleted.';

create index if not exists idx_incidents_agm on public.incidents(agm_id);

-- ------------------------------------------------------------
-- RLS on evidence tables
-- ------------------------------------------------------------
alter table public.evidence_items enable row level security;
alter table public.evidence_packages enable row level security;
alter table public.incidents enable row level security;

drop policy if exists evidence_items_org on public.evidence_items;
create policy evidence_items_org on public.evidence_items for all using (organization_id = public.current_org_id());

drop policy if exists evidence_packages_org on public.evidence_packages;
create policy evidence_packages_org on public.evidence_packages for all using (organization_id = public.current_org_id());

drop policy if exists incidents_org on public.incidents;
create policy incidents_org on public.incidents for all using (organization_id = public.current_org_id());

-- ------------------------------------------------------------
-- Append-only triggers: evidence items and incidents are immutable;
-- evidence packages can only be closed once (no changes after closed_at)
-- ------------------------------------------------------------
drop trigger if exists evidence_items_append_only on public.evidence_items;
create trigger evidence_items_append_only
  before update or delete on public.evidence_items
  for each row execute function public.raise_append_only();

create or replace function public.evidence_packages_protect_closed()
returns trigger language plpgsql as $$
begin
  if old.closed_at is not null then
    raise exception 'Closed evidence package cannot be updated or deleted';
  end if;
  return new;
end $$;

drop trigger if exists evidence_packages_append_only on public.evidence_packages;
create trigger evidence_packages_append_only
  before update or delete on public.evidence_packages
  for each row execute function public.evidence_packages_protect_closed();

drop trigger if exists incidents_append_only on public.incidents;
create trigger incidents_append_only
  before update or delete on public.incidents
  for each row execute function public.raise_append_only();

-- ------------------------------------------------------------
-- RPC: evidence_register — register a hash-registered evidence item
-- ------------------------------------------------------------
create or replace function public.evidence_register(
  p_agm_id       uuid,
  p_category     text,
  p_filename     text,
  p_storage_path text,
  p_mime         text,
  p_size_bytes   bigint,
  p_sha256       text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_id  uuid;
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

  insert into public.evidence_items
    (organization_id, agm_id, category, filename, storage_path, mime, size_bytes, sha256, registered_by, created_at)
  values
    (p_operator_org, p_agm_id, p_category, p_filename, p_storage_path, p_mime,
     p_size_bytes, p_sha256, p_actor, now())
  returning id into v_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'evidence.registered', 'evidence', v_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'category', p_category, 'filename', p_filename, 'sha256', p_sha256)
  );

  return jsonb_build_object(
    'id', v_id,
    'agm_id', p_agm_id,
    'category', p_category,
    'sha256', p_sha256
  );
end;
$$;

revoke execute on function public.evidence_register(uuid, text, text, text, text, bigint, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.evidence_register(uuid, text, text, text, text, bigint, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: evidence_package_create — create a collecting package for an AGM
-- ------------------------------------------------------------
create or replace function public.evidence_package_create(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_id  uuid;
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

  insert into public.evidence_packages
    (organization_id, agm_id, status)
  values
    (p_operator_org, p_agm_id, 'collecting')
  on conflict (agm_id) do update
    set status = case when evidence_packages.status = 'closed' then 'closed' else 'collecting' end
  returning id into v_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'evidence_package.created', 'evidence_package', v_id::text,
    jsonb_build_object('agm_id', p_agm_id)
  );

  return jsonb_build_object(
    'id', v_id,
    'agm_id', p_agm_id,
    'status', (select status from public.evidence_packages where id = v_id)
  );
end;
$$;

revoke execute on function public.evidence_package_create(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.evidence_package_create(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: evidence_package_close — close (export) a package; immutable thereafter
-- ------------------------------------------------------------
create or replace function public.evidence_package_close(
  p_agm_id       uuid,
  p_export_path  text,
  p_sha256       text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_id  uuid;
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

  select id into v_id from public.evidence_packages where agm_id = p_agm_id;
  if not found then
    return jsonb_build_object('error', 'Evidence package not found for this AGM');
  end if;

  update public.evidence_packages
     set status = 'closed', exported_at = now(), exported_by = p_actor,
         export_path = p_export_path, sha256 = p_sha256, closed_at = now()
   where id = v_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'evidence_package.closed', 'evidence_package', v_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'export_path', p_export_path, 'sha256', p_sha256)
  );

  return jsonb_build_object(
    'id', v_id,
    'agm_id', p_agm_id,
    'status', 'closed',
    'closed_at', now()
  );
end;
$$;

revoke execute on function public.evidence_package_close(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.evidence_package_close(uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: incident_record — record an incident (append-only)
-- ------------------------------------------------------------
create or replace function public.incident_record(
  p_agm_id       uuid,
  p_occurred_at  timestamptz,
  p_actor        text,
  p_description  text,
  p_evidence_refs text[],
  p_resolution   text,
  p_operator_org uuid,
  p_recorded_by  uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_id  uuid;
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

  insert into public.incidents
    (organization_id, agm_id, occurred_at, actor, description, evidence_refs, resolution, created_at)
  values
    (p_operator_org, p_agm_id, p_occurred_at, p_actor, p_description, p_evidence_refs, p_resolution, now())
  returning id into v_id;

  perform public.log_audit(
    p_operator_org, p_recorded_by, 'incident.recorded', 'incident', v_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'actor', p_actor, 'occurred_at', p_occurred_at)
  );

  return jsonb_build_object(
    'id', v_id,
    'agm_id', p_agm_id,
    'occurred_at', p_occurred_at
  );
end;
$$;

revoke execute on function public.incident_record(uuid, timestamptz, text, text, text[], text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.incident_record(uuid, timestamptz, text, text, text[], text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read evidence tables (RLS scoped)
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.evidence_items, public.evidence_packages, public.incidents to authenticated;
