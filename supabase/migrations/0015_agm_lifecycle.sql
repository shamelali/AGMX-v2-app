-- ============================================================
-- AGMX V2 — Sprint 2: AGM lifecycle (stage machine + audit)
-- ============================================================

-- Status doubles as the 9-stage machine:
--   planned(Draft) → configuring → published → registration_open → ready → live → closed → post_agm → archived
-- 'minuted' is a legacy value kept for meetings created before the stage machine.
alter table public.agms add constraint if not exists agms_stage_check
  check (status in ('planned','configuring','published','registration_open','ready','live','closed','post_agm','archived','minuted'));

-- ------------------------------------------------------------
-- RPC: create an AGM in Draft stage.
-- Seeds the standard agenda and records an 'agm.created' AuditEvent.
-- The caller (governance Edge Function) supplies the operator's org
-- as p_operator_org and the signed-in actor as p_actor.
-- ------------------------------------------------------------
create or replace function public.create_agm(
  p_title         text,
  p_edition       int,
  p_fiscal_year   text,
  p_scheduled_at  timestamptz,
  p_venue         text,
  p_mode          text,
  p_quorum_pct    numeric,
  p_notice_days   int,
  p_operator_org  uuid,
  p_actor         uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_agm public.agms%rowtype;
begin
  insert into public.agms
    (organization_id, title, edition, fiscal_year, scheduled_at, venue, mode,
     quorum_pct, notice_days, status, settings)
  values
    (p_operator_org, p_title, p_edition, p_fiscal_year, p_scheduled_at, p_venue, p_mode,
     coalesce(p_quorum_pct, 25), coalesce(p_notice_days, 21), 'planned', '{}'::jsonb)
  returning * into v_agm;

  -- Standard cooperative AGM order of business (matches the UI's seed).
  insert into public.agenda_items (agm_id, organization_id, code, title, type, duration_min, sort_order)
  select v_agm.id, v_agm.organization_id, s.code, s.title, s.type, s.duration_min, s.sort_order
  from (values
    ('AG-01','Pengerusian & Ucapan Alu-aluan','opening',10,1),
    ('AG-02','Pengesahan Kuorum & Notis Mesyuarat','compliance',5,2),
    ('AG-03','Pengesahan Minit AGM Lepasan','resolution',10,3),
    ('AG-04','Pembentangan Penyata Kewangan','financial',25,4),
    ('AG-05','Laporan Tahunan & Pencapaian','report',20,5),
    ('AG-06','Pembahagian Dividen & Lebih Surplus','resolution',30,6),
    ('AG-07','Pilihan Raya Lembaga Pengarah','election',45,7),
    ('AG-08','Usul-Usul Ahli','motions',30,8),
    ('AG-09','Hal-Hal Lain & Penutup','closing',10,9)
  ) as s(code, title, type, duration_min, sort_order);

  perform public.log_audit(
    p_operator_org, p_actor, 'agm.created', 'agm', v_agm.id::text,
    jsonb_build_object('stage', 'draft', 'title', p_title, 'edition', p_edition)
  );

  return jsonb_build_object(
    'agm', jsonb_build_object(
      'id', v_agm.id, 'title', v_agm.title, 'edition', v_agm.edition,
      'fiscal_year', v_agm.fiscal_year, 'scheduled_at', v_agm.scheduled_at,
      'venue', v_agm.venue, 'mode', v_agm.mode, 'quorum_pct', v_agm.quorum_pct,
      'notice_days', v_agm.notice_days, 'status', v_agm.status, 'settings', null
    )
  );
end;
$$;

revoke execute on function public.create_agm(text, int, text, timestamptz, text, text, numeric, int, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_agm(text, int, text, timestamptz, text, text, numeric, int, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: advance an AGM exactly one stage forward.
-- Each gate is enforced server-side; every transition emits an
-- 'agm.stage.advanced' AuditEvent chained to the previous one.
-- Already at the target stage is a no-op (idempotent retry).
-- ------------------------------------------------------------
create or replace function public.advance_agm_stage(
  p_agm_id       uuid,
  p_to_stage     text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_agm public.agms%rowtype;
  v_from text;
begin
  select * into v_agm from public.agms where id = p_agm_id for update;
  if not found then
    raise exception 'advance_agm_stage: agm % not found', p_agm_id;
  end if;
  if v_agm.organization_id <> p_operator_org then
    raise exception 'advance_agm_stage: agm % is not in organization %', p_agm_id, p_operator_org;
  end if;

  v_from := v_agm.status;
  if v_from = p_to_stage then
    return jsonb_build_object(
      'agm', jsonb_build_object('id', v_agm.id, 'status', v_agm.status),
      'advanced', false, 'from', v_from, 'to', p_to_stage
    );
  end if;

  if v_from = 'planned' and p_to_stage = 'configuring' then
    if v_agm.title is null or v_agm.scheduled_at is null then
      raise exception 'advance_agm_stage: title and date are required before configuring';
    end if;
  elsif v_from = 'configuring' and p_to_stage = 'published' then
    if v_agm.mode not in ('physical','hybrid','online') or v_agm.venue is null then
      raise exception 'advance_agm_stage: mode and venue are required before publishing';
    end if;
  elsif v_from = 'published' and p_to_stage = 'registration_open' then
    if not exists (select 1 from public.agm_notices where agm_id = p_agm_id) then
      raise exception 'advance_agm_stage: meeting notices must be sent before registration opens';
    end if;
  elsif v_from = 'registration_open' and p_to_stage = 'ready' then
    if not exists (select 1 from public.members where organization_id = p_operator_org and eligible) then
      raise exception 'advance_agm_stage: the electoral roll is empty';
    end if;
  elsif v_from = 'ready' and p_to_stage = 'live' then
    if not exists (select 1 from public.quorum_snapshots where agm_id = p_agm_id and satisfied = true order by captured_at desc limit 1) then
      raise exception 'advance_agm_stage: quorum must be established before the meeting opens';
    end if;
  elsif v_from = 'live' and p_to_stage = 'closed' then
    if not exists (select 1 from public.resolutions where agm_id = p_agm_id) then
      raise exception 'advance_agm_stage: at least one resolution must be recorded before closing';
    end if;
  elsif v_from = 'closed' and p_to_stage = 'post_agm' then
    if not exists (select 1 from public.documents where agm_id = p_agm_id) then
      raise exception 'advance_agm_stage: minutes must be filed before post-AGM';
    end if;
  elsif v_from = 'post_agm' and p_to_stage = 'archived' then
    if exists (select 1 from public.actions where agm_id = p_agm_id and status in ('terbuka','open')) then
      raise exception 'advance_agm_stage: open actions must be settled before archiving';
    end if;
  else
    raise exception 'advance_agm_stage: cannot advance from % to %', v_from, p_to_stage;
  end if;

  update public.agms set status = p_to_stage where id = p_agm_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'agm.stage.advanced', 'agm', p_agm_id::text,
    jsonb_build_object('from', v_from, 'to', p_to_stage)
  );

  return jsonb_build_object(
    'agm', jsonb_build_object('id', v_agm.id, 'status', p_to_stage),
    'advanced', true, 'from', v_from, 'to', p_to_stage
  );
end;
$$;

revoke execute on function public.advance_agm_stage(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.advance_agm_stage(uuid, text, uuid, uuid) to service_role;
