-- ============================================================
-- AGMX V2 — Sprint 4: Governance OS bug fixes
-- Fixes two server-side gaps identified on 2026-11-05:
--
-- 1. cast_vote: a failed quorum must block all voting
--    (previously votes could be cast when quorum was not satisfied)
--
-- 2. record_resolution: abstention-aware and motion-type-aware
--    passing thresholds
--    - financial: 2/3 supermajority of valid votes (ya + tidak)
--    - election: plurality (ya > tidak AND ya > kecuali)
--    - ordinary / resolution: simple majority of valid votes
--    (previously v_ya > v_tidak ignored abstentions and motion type)
-- ============================================================

-- ------------------------------------------------------------
-- Fix 1: quorum guard in cast_vote
-- ------------------------------------------------------------
create or replace function public.cast_vote(
  p_motion_id uuid,
  p_voter_id uuid,
  p_choice text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_motion public.motions%rowtype;
  v_agm public.agms%rowtype;
  v_settings public.agm_settings%rowtype;
  v_satisfied boolean;
begin
  select * into v_motion from public.motions where id = p_motion_id;
  if not found then return jsonb_build_object('error', 'Motion not found'); end if;

  select * into v_agm from public.agms where id = v_motion.agm_id;
  if v_agm.id is null then return jsonb_build_object('error', 'AGM not found'); end if;

  -- must be live
  if v_agm.status <> 'live' then return jsonb_build_object('error', 'Voting window closed'); end if;

  -- voting window
  select * into v_settings from public.agm_settings where agm_id = v_motion.agm_id;
  if v_settings.voting_opens_at is null then return jsonb_build_object('error', 'Voting not open'); end if;
  if v_settings.voting_closes_at is not null and v_settings.voting_closes_at < now() then
    return jsonb_build_object('error', 'Voting window closed');
  end if;

  -- eligibility: active + eligible member
  if not exists (select 1 from public.members where id = p_voter_id and eligible = true and organization_id = v_motion.organization_id) then
    return jsonb_build_object('error', 'Member not eligible');
  end if;

  -- quorum guard: a failed quorum blocks all voting
  select coalesce(max(satisfied), false) into v_satisfied from public.quorum_snapshots where agm_id = v_motion.agm_id;
  if not v_satisfied then
    return jsonb_build_object('error', 'Quorum not satisfied — voting blocked');
  end if;

  -- double-vote guard (unique constraint on motion_id, voter_id)
  begin
    insert into public.votes (organization_id, agm_id, motion_id, voter_id, choice)
    values (v_motion.organization_id, v_motion.agm_id, p_motion_id, p_voter_id, p_choice);
  exception when unique_violation then
    return jsonb_build_object('error', 'Vote already cast');
  end;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.cast_vote(uuid, uuid, text) from public, anon;
grant execute on function public.cast_vote(uuid, uuid, text) to service_role;

-- ------------------------------------------------------------
-- Fix 2: abstention-aware, motion-type-aware passing threshold
-- ------------------------------------------------------------
create or replace function public.record_resolution(
  p_motion_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_motion public.motions%rowtype;
  v_agm_status text;
  v_ya int;
  v_tidak int;
  v_kecuali int;
  v_valid int;
  v_passed boolean;
  v_res_id uuid;
begin
  select m.* into v_motion from public.motions m where m.id = p_motion_id for update;
  if v_motion.id is null then return jsonb_build_object('error', 'Motion not found'); end if;
  if v_motion.status not in ('sedang diundi', 'voting', 'open') then
    return jsonb_build_object('error', 'Motion is not in voting state');
  end if;

  -- resolutions are minutes of record: one per motion, and only once the
  -- meeting has actually been held
  if exists (select 1 from public.resolutions where motion_id = p_motion_id) then
    select jsonb_build_object('id', id, 'passed', passed, 'ya', votes_ya, 'tidak', votes_tidak,
      'kecuali', votes_kecuali, 'duplicate', true)
    into v_res_id from public.resolutions where motion_id = p_motion_id order by minuted_at limit 1;
    return v_res_id;
  end if;

  select status into v_agm_status from public.agms where id = v_motion.agm_id;
  if v_agm_status = 'planned' then
    return jsonb_build_object('error', 'AGM has not been held');
  end if;

  select
    coalesce(sum(case when choice = 'ya' then 1 else 0 end), 0),
    coalesce(sum(case when choice = 'tidak' then 1 else 0 end), 0),
    coalesce(sum(case when choice in ('kecuali','abstain','ecualy') then 1 else 0 end), 0)
  into v_ya, v_tidak, v_kecuali
    from public.votes where motion_id = p_motion_id;

  -- valid votes exclude abstentions (kecuali) from the denominator
  v_valid := v_ya + v_tidak;

  -- motion-type-specific passing thresholds, abstention-aware
  if v_motion.type = 'financial' then
    -- 2/3 supermajority of valid votes
    v_passed := v_valid > 0 and v_ya * 3 >= 2 * v_valid;
  elsif v_motion.type = 'election' then
    -- plurality: yes must exceed both no and abstain
    v_passed := v_ya > v_tidak and v_ya > v_kecuali;
  else
    -- ordinary / resolution: simple majority of valid votes
    v_passed := v_valid > 0 and v_ya > v_tidak;
  end if;

  insert into public.resolutions (agm_id, organization_id, motion_id, title, passed, votes_ya, votes_tidak, votes_kecuali, minuted_at)
  values (v_motion.agm_id, v_motion.organization_id, v_motion.id, v_motion.title, v_passed, v_ya, v_tidak, v_kecuali, now())
  returning id into v_res_id;

  update public.motions set status = case when v_passed then 'lulus' else 'gagal' end where id = p_motion_id;

  perform public.log_audit(v_motion.organization_id, auth.uid(), 'resolution.recorded', 'resolution', v_res_id::text,
    jsonb_build_object('motionId', p_motion_id, 'passed', v_passed, 'ya', v_ya, 'tidak', v_tidak));

  return jsonb_build_object('id', v_res_id, 'passed', v_passed, 'ya', v_ya, 'tidak', v_tidak, 'kecuali', v_kecuali);
end;
$$;

revoke execute on function public.record_resolution(uuid) from public, anon;
grant execute on function public.record_resolution(uuid) to service_role;
