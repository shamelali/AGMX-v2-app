-- ============================================================
-- AGMX V2 — Speaker queue + question moderation
-- Floor control for AGM Control / AGMX LIVE (Sprint 10-11 reuse).
-- ============================================================

-- ------------------------------------------------------------
-- Speaker queue: one active entry per member per AGM
-- ------------------------------------------------------------
create table if not exists public.speaker_queue (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  unique (agm_id, member_id)
);

comment on table public.speaker_queue is 'Live speaker queue for an AGM floor. One active entry per member.';
create index if not exists idx_speaker_queue_agm on public.speaker_queue(agm_id);
create index if not exists idx_speaker_queue_member on public.speaker_queue(member_id);

-- ------------------------------------------------------------
-- Questions: member questions during an AGM, moderated
-- Original record preserved; no DELETE.
-- ------------------------------------------------------------
create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id       uuid not null references public.agms(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  member_no    text not null,
  name         text not null,
  text         text not null default '',
  status       text not null default 'submitted', -- submitted | answered | dismissed
  answered_by  uuid,
  answered_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.questions is 'Member questions during an AGM, moderated by the presiding officer. Original record preserved; no delete.';
create index if not exists idx_questions_agm on public.questions(agm_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.speaker_queue enable row level security;
alter table public.questions enable row level security;

drop policy if exists speaker_queue_org on public.speaker_queue;
create policy speaker_queue_org on public.speaker_queue for all using (
  exists (
    select 1 from public.agms a
    where a.id = public.speaker_queue.agm_id
      and a.organization_id = public.current_org_id()
  )
);

drop policy if exists questions_org on public.questions;
create policy questions_org on public.questions for all using (
  exists (
    select 1 from public.agms a
    where a.id = public.questions.agm_id
      and a.organization_id = public.current_org_id()
  )
);

-- ------------------------------------------------------------
-- GRANTS
-- ------------------------------------------------------------
grant select on public.speaker_queue, public.questions to authenticated;

-- ------------------------------------------------------------
-- RPC: speaker_join — enqueue a member (one active entry per member)
-- ------------------------------------------------------------
create or replace function public.speaker_join(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_id      uuid;
  v_joined  timestamptz;
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

  -- Retire any existing active entry for this member, then enqueue
  update public.speaker_queue
     set left_at = now()
   where agm_id = p_agm_id
     and member_id = p_member_id
     and left_at is null;

  insert into public.speaker_queue (organization_id, agm_id, member_id)
  values (p_operator_org, p_agm_id, p_member_id)
  returning id, joined_at into v_id, v_joined;

  perform public.log_audit(
    p_operator_org, p_actor, 'speaker_queue.joined', 'speaker_queue', v_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'member_id', p_member_id)
  );

  return jsonb_build_object(
    'queued', true,
    'speaker_id', v_id,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'joined_at', v_joined
  );
end;
$$;

revoke execute on function public.speaker_join(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.speaker_join(uuid, uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: speaker_leave — retire a member's active queue entry
-- ------------------------------------------------------------
create or replace function public.speaker_leave(
  p_agm_id       uuid,
  p_member_id    uuid,
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

  select organization_id into v_org from public.agms where id = p_agm_id;
  if not found then
    return jsonb_build_object('error', 'AGM not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  update public.speaker_queue
     set left_at = now()
   where agm_id = p_agm_id
     and member_id = p_member_id
     and left_at is null;

  perform public.log_audit(
    p_operator_org, p_actor, 'speaker_queue.left', 'speaker_queue', p_agm_id::text,
    jsonb_build_object('member_id', p_member_id)
  );

  return jsonb_build_object(
    'left', true,
    'agm_id', p_agm_id,
    'member_id', p_member_id
  );
end;
$$;

revoke execute on function public.speaker_leave(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.speaker_leave(uuid, uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: question_submit — a member asks a question
-- ------------------------------------------------------------
create or replace function public.question_submit(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_text         text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_id    uuid;
  v_no    text;
  v_name  text;
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

  select member_no, name into v_no, v_name
  from public.members where id = p_member_id and organization_id = p_operator_org;
  if not found then
    return jsonb_build_object('error', 'Member not found in this organisation');
  end if;

  insert into public.questions
    (organization_id, agm_id, member_id, member_no, name, text, status)
  values
    (p_operator_org, p_agm_id, p_member_id, v_no, v_name, coalesce(p_text, ''), 'submitted')
  returning id into v_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'question.submitted', 'question', v_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'member_id', p_member_id)
  );

  return jsonb_build_object(
    'question_id', v_id,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'status', 'submitted'
  );
end;
$$;

revoke execute on function public.question_submit(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.question_submit(uuid, uuid, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: question_answer — presiding officer marks a question answered
-- ------------------------------------------------------------
create or replace function public.question_answer(
  p_question_id  uuid,
  p_answered_by  uuid,
  p_operator_org uuid
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

  select q.organization_id, q.agm_id, q.status
  into v_org, v_agm_id, v_status
  from public.questions q where id = p_question_id;

  if not found then
    return jsonb_build_object('error', 'Question not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'answered' then
    return jsonb_build_object('answered', false, 'question_id', p_question_id, 'status', 'answered');
  end if;

  update public.questions
     set status = 'answered', answered_by = p_answered_by, answered_at = now()
   where id = p_question_id;

  perform public.log_audit(
    p_operator_org, p_answered_by, 'question.answered', 'question', p_question_id::text,
    jsonb_build_object('agm_id', v_agm_id)
  );

  return jsonb_build_object(
    'question_id', p_question_id,
    'agm_id', v_agm_id,
    'status', 'answered'
  );
end;
$$;

revoke execute on function public.question_answer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.question_answer(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: question_dismiss — presiding officer dismisses a question
-- ------------------------------------------------------------
create or replace function public.question_dismiss(
  p_question_id  uuid,
  p_operator_org uuid
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

  select q.organization_id, q.agm_id, q.status
  into v_org, v_agm_id, v_status
  from public.questions q where id = p_question_id;

  if not found then
    return jsonb_build_object('error', 'Question not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'dismissed' then
    return jsonb_build_object('dismissed', false, 'question_id', p_question_id, 'status', 'dismissed');
  end if;

  update public.questions
     set status = 'dismissed'
   where id = p_question_id;

  perform public.log_audit(
    p_operator_org, null, 'question.dismissed', 'question', p_question_id::text,
    jsonb_build_object('agm_id', v_agm_id)
  );

  return jsonb_build_object(
    'question_id', p_question_id,
    'agm_id', v_agm_id,
    'status', 'dismissed'
  );
end;
$$;

revoke execute on function public.question_dismiss(uuid, uuid) from public, anon, authenticated;
grant execute on function public.question_dismiss(uuid, uuid) to service_role;
