-- ============================================================
-- AGMX V2 — Sprint 4: Notices, AGM Pack versions, Communications
-- Notice lifecycle: draft -> scheduled -> delivered -> acknowledged
-- Document versions: controlled replacement keeps every version
-- Communications: per-member delivery, open and acknowledgement audit
-- ============================================================

-- ------------------------------------------------------------
-- Notice lifecycle extensions on agm_notices
-- ------------------------------------------------------------
alter table public.agm_notices
  add column if not exists status text not null default 'draft';

alter table public.agm_notices
  add column if not exists scheduled_at timestamptz;

alter table public.agm_notices
  add column if not exists source text;

alter table public.agm_notices
  add column if not exists due_at timestamptz;

alter table public.agm_notices
  add column if not exists ack_required boolean not null default false;

alter table public.agm_notices
  add column if not exists subject text;

alter table public.agm_notices
  add column if not exists body text;

alter table public.agm_notices
  add column if not exists evidence jsonb not null default '{}'::jsonb;

comment on column public.agm_notices.status is 'Notice lifecycle: draft, scheduled, delivered, acknowledged';
comment on column public.agm_notices.source is 'What triggered the notice: agenda, motion, resolution, manual';
comment on column public.agm_notices.due_at is 'Auto-calculated response or delivery deadline';
comment on column public.agm_notices.evidence is 'Delivery evidence: channel, delivered at, recipient count, provider message ids';

create index if not exists idx_agm_notices_org on public.agm_notices(organization_id);
create index if not exists idx_agm_notices_agm on public.agm_notices(agm_id);

-- ------------------------------------------------------------
-- Notice recipients: delivery + open + acknowledgement audit
-- ------------------------------------------------------------
alter table public.notice_recipients
  add column if not exists delivery_status text not null default 'sent';

alter table public.notice_recipients
  add column if not exists acknowledged_at timestamptz;

alter table public.notice_recipients
  add column if not exists ack_channel text;

alter table public.notice_recipients
  add column if not exists provider_message_id text;

alter table public.notice_recipients
  add column if not exists provider_response jsonb not null default '{}'::jsonb;

create index if not exists idx_notice_recipients_notice on public.notice_recipients(notice_id);
create index if not exists idx_notice_recipients_member on public.notice_recipients(member_id);

-- ------------------------------------------------------------
-- Document versions: every replacement is a new version, never
-- an overwrite of the previous one
-- ------------------------------------------------------------
create table if not exists public.document_versions (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version        int not null,
  filename       text not null,
  mime           text,
  size_bytes     bigint,
  storage_path   text not null,
  sha256         text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  unique (document_id, version)
);

comment on table public.document_versions is 'Immutable version history for AGM Pack documents. Replacement writes a new version; the previous row is never overwritten.';
comment on column public.document_versions.version is 'Version number within the document, starting at 1.';

-- ------------------------------------------------------------
-- Document access history: who viewed or downloaded a pack
-- document, and when
-- ------------------------------------------------------------
create table if not exists public.document_access (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id      uuid references public.members(id) on delete set null,
  action         text not null default 'view',
  accessed_at    timestamptz not null default now(),
  ip             text
);

comment on table public.document_access is 'Access history for AGM Pack documents: view/download events per member.';

create index if not exists idx_document_versions_doc on public.document_versions(document_id);
create index if not exists idx_document_access_doc on public.document_access(document_id);
create index if not exists idx_document_access_at on public.document_access(accessed_at);

-- ------------------------------------------------------------
-- Communications: notices, reminders and updates sent to members
-- ------------------------------------------------------------
create table if not exists public.communications (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id        uuid references public.agms(id) on delete set null,
  type          text not null default 'notice',
  channel       text not null default 'email',
  subject       text,
  body          text not null,
  status        text not null default 'draft',
  sent_at       timestamptz,
  sent_by       uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

comment on table public.communications is 'Outbound communications: notices, reminders and updates sent to members.';
comment on column public.communications.type is 'notice, reminder or update';
comment on column public.communications.channel is 'email, sms, whatsapp or portal';
comment on column public.communications.status is 'draft, sent or failed';

-- ------------------------------------------------------------
-- Communication log: per-member sent, delivered, opened,
-- failed, bounced, acknowledged
-- ------------------------------------------------------------
create table if not exists public.communication_log (
  id                uuid primary key default gen_random_uuid(),
  communication_id  uuid not null references public.communications(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  member_id         uuid not null references public.members(id) on delete cascade,
  channel           text not null,
  status            text not null,
  provider_message_id text,
  provider_response jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null default now()
);

comment on table public.communication_log is 'Per-member communication audit: sent, delivered, opened, failed, bounced, acknowledged.';

create index if not exists idx_communications_org on public.communications(organization_id);
create index if not exists idx_communications_agm on public.communications(agm_id);
create index if not exists idx_communication_log_org on public.communication_log(organization_id);
create index if not exists idx_communication_log_comm on public.communication_log(communication_id);
create index if not exists idx_communication_log_member on public.communication_log(member_id);
create index if not exists idx_communication_log_at on public.communication_log(occurred_at);

-- ------------------------------------------------------------
-- RLS: every new table is org-scoped, matching the rest of the
-- schema. Policies are rerun-safe (drop if exists first).
-- ------------------------------------------------------------
alter table public.document_versions enable row level security;
alter table public.document_access enable row level security;
alter table public.communications enable row level security;
alter table public.communication_log enable row level security;

do $$
begin
  execute 'drop policy if exists document_versions_org on public.document_versions';
  execute 'create policy document_versions_org on public.document_versions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  execute 'drop policy if exists document_access_org on public.document_access';
  execute 'create policy document_access_org on public.document_access for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  execute 'drop policy if exists communications_org on public.communications';
  execute 'create policy communications_org on public.communications for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  execute 'drop policy if exists communication_log_org on public.communication_log';
  execute 'create policy communication_log_org on public.communication_log for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
end $$;

-- ------------------------------------------------------------
-- RPC: compose a notice (draft)
-- ------------------------------------------------------------
create or replace function public.compose_notice(
  p_agm_id       uuid,
  p_organization_id uuid,
  p_actor        uuid,
  p_channel      text,
  p_subject      text,
  p_body         text,
  p_source       text default 'manual',
  p_due_at       timestamptz,
  p_ack_required boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_notice_id uuid;
begin
  if p_organization_id is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  if not exists (select 1 from public.agms where id = p_agm_id and organization_id = p_organization_id) then
    return jsonb_build_object('error', 'AGM not found');
  end if;

  insert into public.agm_notices
    (organization_id, agm_id, channel, subject, body, source, due_at, ack_required, status, sent_at)
  values
    (p_organization_id, p_agm_id, p_channel, p_subject, p_body, p_source, p_due_at, p_ack_required, 'draft', null)
  returning id into v_notice_id;

  perform public.log_audit(
    p_organization_id, p_actor, 'notice.composed', 'agm_notices', v_notice_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'channel', p_channel, 'source', p_source, 'ack_required', p_ack_required)
  );

  return jsonb_build_object('notice_id', v_notice_id, 'status', 'draft');
end;
$$;

revoke execute on function public.compose_notice(uuid, uuid, uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.compose_notice(uuid, uuid, uuid, text, text, text, text, timestamptz, boolean) to service_role;

-- ------------------------------------------------------------
-- RPC: schedule a drafted notice
-- ------------------------------------------------------------
create or replace function public.schedule_notice(
  p_notice_id     uuid,
  p_operator_org  uuid,
  p_actor         uuid
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

  select organization_id into v_org from public.agm_notices where id = p_notice_id;
  if not found then
    return jsonb_build_object('error', 'Notice not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  update public.agm_notices
     set status = 'scheduled', scheduled_at = now()
   where id = p_notice_id
     and organization_id = p_operator_org
     and status = 'draft';

  if not found then
    return jsonb_build_object('error', 'Notice is not in draft state');
  end if;

  perform public.log_audit(
    p_operator_org, p_actor, 'notice.scheduled', 'agm_notices', p_notice_id::text,
    jsonb_build_object('scheduled_at', now())
  );

  return jsonb_build_object('notice_id', p_notice_id, 'status', 'scheduled');
end;
$$;

revoke execute on function public.schedule_notice(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.schedule_notice(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: deliver a notice. One recipient row per member, plus a
-- communication log entry per member so delivery is auditable
-- end to end. Idempotent: a delivered notice is not re-delivered.
-- ------------------------------------------------------------
create or replace function public.deliver_notice(
  p_notice_id     uuid,
  p_operator_org  uuid,
  p_actor         uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_agm_id   uuid;
  v_channel  text;
  v_subject  text;
  v_body     text;
  v_comm_id  uuid;
  v_count    int;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select organization_id, agm_id, channel, subject, body into v_org, v_agm_id, v_channel, v_subject, v_body
  from public.agm_notices where id = p_notice_id;
  if not found then
    return jsonb_build_object('error', 'Notice not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  if (select status from public.agm_notices where id = p_notice_id) = 'delivered' then
    select count(*) into v_count from public.notice_recipients where notice_id = p_notice_id;
    return jsonb_build_object('notice_id', p_notice_id, 'status', 'delivered', 'recipient_count', v_count);
  end if;

  insert into public.communications
    (organization_id, agm_id, type, channel, subject, body, status, sent_at, sent_by)
  values
    (p_operator_org, v_agm_id, 'notice', v_channel, v_subject, v_body, 'sent', now(), p_actor)
  returning id into v_comm_id;

  for v_member in
    select id from public.members where organization_id = p_operator_org
  loop
    insert into public.notice_recipients
      (notice_id, member_id, organization_id, delivery_status)
    values
      (p_notice_id, v_member.id, p_operator_org, 'sent')
    on conflict (notice_id, member_id) do nothing;

    insert into public.communication_log
      (communication_id, organization_id, member_id, channel, status, provider_message_id, provider_response)
    values
      (v_comm_id, p_operator_org, v_member.id, v_channel, 'sent', null, '{}'::jsonb);
  end loop;

  select count(*) into v_count from public.notice_recipients where notice_id = p_notice_id;

  update public.agm_notices
     set status = 'delivered', sent_at = now(), recipient_count = v_count,
         evidence = jsonb_build_object('channel', v_channel, 'delivered_at', now(), 'recipient_count', v_count)
   where id = p_notice_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'notice.delivered', 'agm_notices', p_notice_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'recipient_count', v_count, 'channel', v_channel)
  );

  return jsonb_build_object('notice_id', p_notice_id, 'status', 'delivered', 'recipient_count', v_count);
end;
$$;

revoke execute on function public.deliver_notice(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.deliver_notice(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: acknowledge a notice receipt. Members acknowledge their
-- own receipt; operators may acknowledge any receipt in the org.
-- When every recipient has acknowledged, the notice flips to
-- acknowledged.
-- ------------------------------------------------------------
create or replace function public.acknowledge_notice(
  p_notice_id     uuid,
  p_member_id     uuid,
  p_operator_org  uuid,
  p_actor         uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org    uuid;
  v_all    boolean;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select organization_id into v_org from public.agm_notices where id = p_notice_id;
  if not found then
    return jsonb_build_object('error', 'Notice not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  update public.notice_recipients
     set acknowledged_at = now(), delivery_status = 'acknowledged'
   where notice_id = p_notice_id
     and member_id = p_member_id
     and organization_id = p_operator_org;

  select count(*) = count(acknowledged_at) and count(*) > 0 into v_all
  from public.notice_recipients
  where notice_id = p_notice_id;

  if v_all then
    update public.agm_notices
       set status = 'acknowledged'
     where id = p_notice_id
       and status = 'delivered';
  end if;

  perform public.log_audit(
    p_operator_org, p_actor, 'notice.acknowledged', 'agm_notices', p_notice_id::text,
    jsonb_build_object('member_id', p_member_id, 'all_acknowledged', v_all)
  );

  return jsonb_build_object(
    'notice_id', p_notice_id,
    'member_id', p_member_id,
    'all_acknowledged', v_all,
    'status', v_all ? 'acknowledged' : 'delivered'
  );
end;
$$;

revoke execute on function public.acknowledge_notice(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.acknowledge_notice(uuid, uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: register a pack document, version 1
-- ------------------------------------------------------------
create or replace function public.register_pack_document(
  p_agm_id        uuid,
  p_operator_org  uuid,
  p_actor         uuid,
  p_category      text,
  p_filename      text,
  p_mime          text,
  p_size_bytes    bigint,
  p_storage_path  text,
  p_sha256        text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_document_id uuid;
  v_org         uuid;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  if p_agm_id is not null then
    select organization_id into v_org from public.agms where id = p_agm_id;
    if not found then
      return jsonb_build_object('error', 'AGM not found');
    end if;
    if v_org is distinct from p_operator_org then
      return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
    end if;
  else
    v_org := p_operator_org;
  end if;

  insert into public.documents
    (organization_id, agm_id, category, filename, mime, size_bytes, storage_path, sha256)
  values
    (v_org, p_agm_id, p_category, p_filename, p_mime, p_size_bytes, p_storage_path, p_sha256)
  returning id into v_document_id;

  insert into public.document_versions
    (document_id, organization_id, version, filename, mime, size_bytes, storage_path, sha256, created_by)
  values
    (v_document_id, v_org, 1, p_filename, p_mime, p_size_bytes, p_storage_path, p_sha256, p_actor);

  perform public.log_audit(
    v_org, p_actor, 'pack.document.registered', 'documents', v_document_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'category', p_category, 'filename', p_filename, 'version', 1)
  );

  return jsonb_build_object('document_id', v_document_id, 'version', 1);
end;
$$;

revoke execute on function public.register_pack_document(uuid, uuid, uuid, text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.register_pack_document(uuid, uuid, uuid, text, text, text, bigint, text, text) to service_role;

-- ------------------------------------------------------------
-- RPC: replace a pack document — a new version row, current
-- document row updated; previous version is never overwritten
-- ------------------------------------------------------------
create or replace function public.replace_pack_document(
  p_document_id   uuid,
  p_operator_org  uuid,
  p_actor         uuid,
  p_filename      text,
  p_mime          text,
  p_size_bytes    bigint,
  p_storage_path  text,
  p_sha256        text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_version int;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select organization_id into v_org from public.documents where id = p_document_id;
  if not found then
    return jsonb_build_object('error', 'Document not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.document_versions
  where document_id = p_document_id;

  update public.documents
     set filename = p_filename,
         mime = p_mime,
         size_bytes = p_size_bytes,
         storage_path = p_storage_path,
         sha256 = p_sha256
   where id = p_document_id;

  insert into public.document_versions
    (document_id, organization_id, version, filename, mime, size_bytes, storage_path, sha256, created_by)
  values
    (p_document_id, v_org, v_version, p_filename, p_mime, p_size_bytes, p_storage_path, p_sha256, p_actor);

  perform public.log_audit(
    v_org, p_actor, 'pack.document.replaced', 'documents', p_document_id::text,
    jsonb_build_object('version', v_version, 'filename', p_filename)
  );

  return jsonb_build_object('document_id', p_document_id, 'version', v_version);
end;
$$;

revoke execute on function public.replace_pack_document(uuid, uuid, uuid, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.replace_pack_document(uuid, uuid, uuid, text, text, bigint, text, text) to service_role;

-- ------------------------------------------------------------
-- RPC: log a document access event (view / download)
-- ------------------------------------------------------------
create or replace function public.log_document_access(
  p_document_id   uuid,
  p_operator_org  uuid,
  p_member_id     uuid,
  p_action        text default 'view',
  p_ip            text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_access_id uuid;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  insert into public.document_access
    (document_id, organization_id, member_id, action, ip)
  values
    (p_document_id, p_operator_org, p_member_id, p_action, p_ip)
  returning id into v_access_id;

  return jsonb_build_object('access_id', v_access_id);
end;
$$;

revoke execute on function public.log_document_access(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_document_access(uuid, uuid, uuid, text, text) to service_role;

-- ------------------------------------------------------------
-- RPC: send a communication to members (no provider call here —
-- the send-email-hook handles transport; this records the audit)
-- Empty member list means every member of the organization.
-- ------------------------------------------------------------
create or replace function public.send_communication(
  p_organization_id uuid,
  p_actor           uuid,
  p_agm_id          uuid,
  p_type            text default 'notice',
  p_channel         text default 'email',
  p_subject         text,
  p_body            text,
  p_member_ids      uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_comm_id   uuid;
  v_count     int := 0;
  v_member    record;
begin
  if p_organization_id is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  if p_agm_id is not null then
    if not exists (select 1 from public.agms where id = p_agm_id and organization_id = p_organization_id) then
      return jsonb_build_object('error', 'AGM not found');
    end if;
  end if;

  insert into public.communications
    (organization_id, agm_id, type, channel, subject, body, status, sent_at, sent_by)
  values
    (p_organization_id, p_agm_id, p_type, p_channel, p_subject, p_body, 'sent', now(), p_actor)
  returning id into v_comm_id;

  for v_member in
    select member_id
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as member_id
  loop
    if not exists (select 1 from public.members where id = v_member.member_id and organization_id = p_organization_id) then
      continue;
    end if;

    insert into public.communication_log
      (communication_id, organization_id, member_id, channel, status, provider_response)
    values
      (v_comm_id, p_organization_id, v_member.member_id, p_channel, 'sent', '{}'::jsonb);

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    for v_member in
      select id from public.members where organization_id = p_organization_id
    loop
      insert into public.communication_log
        (communication_id, organization_id, member_id, channel, status, provider_response)
      values
        (v_comm_id, p_organization_id, v_member.id, p_channel, 'sent', '{}'::jsonb);

      v_count := v_count + 1;
    end loop;
  end if;

  perform public.log_audit(
    p_organization_id, p_actor, 'communication.sent', 'communications', v_comm_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'type', p_type, 'channel', p_channel, 'recipient_count', v_count)
  );

  return jsonb_build_object('communication_id', v_comm_id, 'recipient_count', v_count);
end;
$$;

revoke execute on function public.send_communication(uuid, uuid, uuid, text, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.send_communication(uuid, uuid, uuid, text, text, text, text, uuid[]) to service_role;

-- ------------------------------------------------------------
-- RPC: record a delivery outcome (webhook target, e.g. bounced,
-- opened) for a communication recipient
-- ------------------------------------------------------------
create or replace function public.record_delivery(
  p_communication_id uuid,
  p_member_id        uuid,
  p_channel          text,
  p_status           text,
  p_provider_message_id text default null,
  p_provider_response  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_log_id uuid;
begin
  insert into public.communication_log
    (communication_id, organization_id, member_id, channel, status, provider_message_id, provider_response)
  values
    (p_communication_id,
     (select organization_id from public.communications where id = p_communication_id),
     p_member_id, p_channel, p_status, p_provider_message_id, p_provider_response)
  returning id into v_log_id;

  return jsonb_build_object('log_id', v_log_id);
end;
$$;

revoke execute on function public.record_delivery(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_delivery(uuid, uuid, text, text, text, jsonb) to service_role;
