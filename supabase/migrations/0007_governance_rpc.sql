-- ============================================================
-- AGMX V2 — Sprint 4: Governance OS (AGM lifecycle RPCs)
-- Server-side enforcement of AGM workflow: start/close, attendance,
-- quorum snapshots, motions, votes, resolutions, compliance, actions,
-- documents and audit chain.
-- ============================================================

-- ------------------------------------------------------------
-- HELPER: append a hash-chained audit event
-- ------------------------------------------------------------
create or replace function public.log_audit(
  p_org uuid,
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev text;
  v_hash text;
begin
  select coalesce(hash, '0'::text) into v_prev
    from public.audit_events
    where organization_id = p_org
    order by occurred_at desc limit 1;

  -- pgcrypto lives in the `extensions` schema on Supabase, and this function
  -- pins search_path to public, so digest() must be qualified.
  v_hash := encode(extensions.digest(v_prev || p_action || p_entity_id || p_payload::text || now()::text, 'sha256'), 'hex');

  insert into public.audit_events
    (organization_id, actor_id, actor_name, action, entity_type, entity_id, payload, prev_hash, hash)
  values
    (p_org, p_actor, (select full_name from public.profiles where id = p_actor), p_action, p_entity_type, p_entity_id, p_payload, v_prev, v_hash);
exception when others then
  -- never fail the calling operation because of an audit hiccup, but say so
  raise warning 'log_audit failed for %/%: %', p_action, p_entity_id, sqlerrm;
end;
$$;

revoke execute on function public.log_audit(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.log_audit(uuid, uuid, text, text, text, jsonb) to service_role;

-- ------------------------------------------------------------
-- RPC: start an AGM
-- ------------------------------------------------------------
create or replace function public.start_agm(
  p_agm_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agm public.agms%rowtype;
begin
  select * into v_agm from public.agms where id = p_agm_id for update;
  if not found then return jsonb_build_object('error', 'AGM not found'); end if;
  if v_agm.status <> 'planned' then return jsonb_build_object('error', 'AGM already started or closed'); end if;

  update public.agms set status = 'live' where id = p_agm_id;

  -- open voting window on settings if present
  update public.agm_settings set voting_opens_at = now() where agm_id = p_agm_id;

  perform public.log_audit(v_agm.organization_id, auth.uid(), 'agm.started', 'agm', p_agm_id::text, jsonb_build_object('title', v_agm.title));

  return jsonb_build_object('id', v_agm.id, 'status', 'live');
end;
$$;

revoke execute on function public.start_agm(uuid) from public, anon;
grant execute on function public.start_agm(uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: close an AGM (generates resolutions from passed motions)
-- ------------------------------------------------------------
create or replace function public.close_agm(
  p_agm_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agm public.agms%rowtype;
begin
  select * into v_agm from public.agms where id = p_agm_id for update;
  if not found then return jsonb_build_object('error', 'AGM not found'); end if;
  if v_agm.status <> 'live' then return jsonb_build_object('error', 'AGM is not live'); end if;

  update public.agms set status = 'closed' where id = p_agm_id;

  -- Freeze voting window
  update public.agm_settings set voting_closes_at = now() where agm_id = p_agm_id;

  perform public.log_audit(v_agm.organization_id, auth.uid(), 'agm.closed', 'agm', p_agm_id::text, jsonb_build_object('title', v_agm.title));

  return jsonb_build_object('id', v_agm.id, 'status', 'closed');
end;
$$;

revoke execute on function public.close_agm(uuid) from public, anon;
grant execute on function public.close_agm(uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: record attendance (idempotent) + quorum snapshot
-- ------------------------------------------------------------
create or replace function public.record_attendance(
  p_agm_id uuid,
  p_member_id uuid,
  p_method text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_total int;
  v_present int;
  v_quorum_pct numeric;
  v_pct numeric;
  v_satisfied boolean;
begin
  select organization_id, quorum_pct into v_org, v_quorum_pct from public.agms where id = p_agm_id;
  if v_org is null then return jsonb_build_object('error', 'AGM not found'); end if;

  -- membership guard
  if not exists (select 1 from public.members where id = p_member_id and organization_id = v_org) then
    return jsonb_build_object('error', 'Member not found in this organization');
  end if;

  insert into public.attendance (agm_id, organization_id, member_id, check_in_at, method)
  values (p_agm_id, v_org, p_member_id, now(), p_method)
  on conflict (agm_id, member_id) do nothing;

  select count(*) into v_total from public.members where organization_id = v_org and eligible = true;
  select count(*) into v_present from public.attendance where agm_id = p_agm_id;

  v_pct := round((v_present::numeric / nullif(v_total, 0) * 100), 2);
  v_satisfied := v_pct >= v_quorum_pct;

  insert into public.quorum_snapshots (agm_id, organization_id, total_members, present, pct, satisfied, captured_at)
  values (p_agm_id, v_org, v_total, v_present, v_pct, v_satisfied, now());

  return jsonb_build_object('present', v_present, 'total', v_total, 'pct', v_pct, 'satisfied', v_satisfied);
end;
$$;

revoke execute on function public.record_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.record_attendance(uuid, uuid, text) to service_role;

-- ------------------------------------------------------------
-- RPC: create a motion
-- ------------------------------------------------------------
create or replace function public.create_motion(
  p_agm_id uuid,
  p_title text,
  p_type text,
  p_proposer_id uuid default null,
  p_seconder_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_code text;
  v_motion_id uuid;
begin
  select organization_id into v_org from public.agms where id = p_agm_id;
  if v_org is null then return jsonb_build_object('error', 'AGM not found'); end if;

  -- sequential code M-001, M-002...
  select 'M-' || lpad((count(*) + 1)::text, 3, '0') into v_code
    from public.motions where agm_id = p_agm_id;

  insert into public.motions (agm_id, organization_id, code, title, type, proposer_id, seconder_id, status)
  values (p_agm_id, v_org, v_code, p_title, p_type, p_proposer_id, p_seconder_id, 'draf')
  returning id into v_motion_id;

  perform public.log_audit(v_org, auth.uid(), 'motion.created', 'motion', v_motion_id::text,
    jsonb_build_object('agmId', p_agm_id, 'code', v_code, 'title', p_title));

  return jsonb_build_object('id', v_motion_id, 'code', v_code, 'status', 'draf');
end;
$$;

revoke execute on function public.create_motion(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_motion(uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: open a motion for voting (draf -> sedang diundi)
-- ------------------------------------------------------------
create or replace function public.open_motion_voting(
  p_motion_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_motion public.motions%rowtype;
  v_agm_status text;
begin
  select * into v_motion from public.motions where id = p_motion_id for update;
  if v_motion.id is null then return jsonb_build_object('error', 'Motion not found'); end if;
  if v_motion.status not in ('draf', 'menunggu') then
    return jsonb_build_object('error', 'Motion cannot be opened for voting from status ' || v_motion.status);
  end if;
  select status into v_agm_status from public.agms where id = v_motion.agm_id;
  if v_agm_status <> 'live' then
    return jsonb_build_object('error', 'AGM is not live');
  end if;
  update public.motions set status = 'sedang diundi' where id = p_motion_id;
  perform public.log_audit(v_motion.organization_id, auth.uid(), 'motion.voting_opened', 'motion', p_motion_id::text, jsonb_build_object('code', v_motion.code));
  return jsonb_build_object('id', p_motion_id, 'status', 'sedang diundi');
end;
$$;

revoke execute on function public.open_motion_voting(uuid) from public, anon;
grant execute on function public.open_motion_voting(uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: cast a vote (append-only; ballot secrecy)
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
-- RPC: tally votes and record resolution
-- ------------------------------------------------------------
create or replace function public.record_resolution(
  p_motion_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_motion public.motions%rowtype;
  v_existing jsonb;
  v_agm_status text;
  v_ya int;
  v_tidak int;
  v_kecuali int;
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
    into v_existing from public.resolutions where motion_id = p_motion_id order by minuted_at limit 1;
    return v_existing;
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

-- ------------------------------------------------------------
-- RPC: create an action (follow-up from a resolution)
-- ------------------------------------------------------------
create or replace function public.create_action(
  p_org uuid,
  p_title text,
  p_pic_id uuid default null,
  p_due_date date default null,
  p_agm_id uuid default null,
  p_resolution_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_org is null then return jsonb_build_object('error', 'Missing organization'); end if;
  insert into public.actions (organization_id, agm_id, resolution_id, title, pic_id, due_date, status)
  values (p_org, p_agm_id, p_resolution_id, p_title, p_pic_id, p_due_date, 'terbuka')
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

revoke execute on function public.create_action(uuid, text, uuid, date, uuid, uuid) from public, anon;
grant execute on function public.create_action(uuid, text, uuid, date, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: run compliance checks for an AGM (seed rules + result rows)
-- ------------------------------------------------------------
create or replace function public.run_compliance_checks(
  p_org uuid,
  p_agm_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule public.compliance_rules%rowtype;
  v_result text;
  v_details jsonb;
  v_check_id uuid;
  v_notice_days int;
  v_eligible int;
  v_present int;
  v_total int;
  v_quorum_pct numeric;
  v_satisfied boolean;
  v_findings int := 0;
  v_new int := 0;
  v_checks int := 0;
begin
  if p_org is null then return jsonb_build_object('error', 'Missing organization'); end if;

  select notice_days into v_notice_days from public.agms where id = p_agm_id;
  select quorum_pct into v_quorum_pct from public.agms where id = p_agm_id;
  select count(*) into v_total from public.members where organization_id = p_org and eligible = true;
  select count(*) into v_present from public.attendance where agm_id = p_agm_id;

  -- ensure GP rules exist (seed if missing)
  insert into public.compliance_rules (code, act, description, severity) values
    ('sec17_notice', 'Akta Koperasi 1993 s.17', 'Notis mesyuarat sekurang-kurangnya 15 hari sebelum AGM', 'warning'),
    ('gp14_quorum', 'GP 14', 'Kuorum kehadiran minimum (lazim 25%)', 'error'),
    ('gp14b_motions', 'GP 14B', 'Setiap usul memerlukan pencadang dan penyokong', 'warning'),
    ('akta1993_immutable', 'Akta 1993', 'Rekod digital tidak boleh dipadam atau diubah suai', 'error')
  on conflict (code) do nothing;

  for v_rule in select * from public.compliance_rules loop
    -- Fail closed. This loop used to start every rule at 'lulus', so a rule with
    -- no evaluating branch below was reported as a statutory pass on every run.
    -- A rule now reports 'belum_disemak' ("not evaluated") until a branch
    -- decides it, which means adding a rule to compliance_rules without writing
    -- its check can no longer manufacture a green light.
    v_result := 'belum_disemak';
    v_details := '{}'::jsonb;

    if v_rule.code = 'sec17_notice' then
      v_result := case when coalesce(v_notice_days,0) >= 15 then 'lulus' else 'amaran' end;
      v_details := jsonb_build_object('noticeDays', v_notice_days, 'threshold', 15);
    elsif v_rule.code = 'gp14_quorum' then
      v_satisfied := (v_present::numeric / nullif(v_total,0)) * 100 >= v_quorum_pct;
      v_result := case when v_satisfied then 'lulus' else 'gagal' end;
      v_details := jsonb_build_object('present', v_present, 'total', v_total, 'pct',
        round((v_present::numeric / nullif(v_total,0) * 100), 2), 'required', v_quorum_pct);
    elsif v_rule.code = 'gp14b_motions' then
      if exists (select 1 from public.motions where agm_id = p_agm_id and seconder_id is null) then
        v_result := 'amaran';
        v_details := jsonb_build_object('missingSeconder', true);
      else
        v_result := 'lulus';
        v_details := jsonb_build_object('motionsWithoutSeconder', 0);
      end if;
    elsif v_rule.code = 'akta1993_immutable' then
      -- Kept explicit even though it is now the loop default: this rule is
      -- seeded with severity 'error' and describes Akta 1993 record immutability.
      -- audit_events is append-only by policy, but no code verifies the hash
      -- chain or detects a deleted or rewritten row, so it must never report a
      -- pass. The UI shows "Not evaluated", not green.
      v_result := 'belum_disemak';
      v_details := jsonb_build_object(
        'reason', 'pengesahan rantaian hash dan pengesanan rekod terhapus belum dilaksanakan',
        'reasonEn', 'hash-chain verification and deleted-record detection are not implemented');
    end if;

    insert into public.compliance_checks (organization_id, agm_id, rule_id, result, details, checked_at)
    values (p_org, p_agm_id, v_rule.id, v_result, v_details, now())
    returning id into v_check_id;
    v_checks := v_checks + 1;

    if v_result in ('amaran','gagal') then
      -- one open finding per rule+AGM; reruns update the count, not the backlog
      insert into public.compliance_findings (organization_id, check_id, severity, message, status)
      select p_org, v_check_id, v_rule.severity, v_rule.description, 'terbuka'
      where not exists (
        select 1 from public.compliance_findings f
          join public.compliance_checks c on c.id = f.check_id
          where c.agm_id = p_agm_id and c.rule_id = v_rule.id and f.status = 'terbuka'
      );
      get diagnostics v_new = row_count;
      v_findings := v_findings + v_new;
    end if;
  end loop;

  perform public.log_audit(p_org, auth.uid(), 'compliance.run', 'agm', p_agm_id::text, jsonb_build_object('checks', v_checks, 'findings', v_findings));

  return jsonb_build_object('checks', v_checks, 'findings', v_findings);
end;
$$;

revoke execute on function public.run_compliance_checks(uuid, uuid) from public, anon;
grant execute on function public.run_compliance_checks(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: record a document in the audit vault
-- ------------------------------------------------------------
create or replace function public.register_document(
  p_org uuid,
  p_agm_id uuid,
  p_category text,
  p_filename text,
  p_mime text,
  p_size_bytes bigint,
  p_storage_path text,
  p_sha256 text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  insert into public.documents (organization_id, agm_id, category, filename, mime, size_bytes, storage_path, sha256)
  values (p_org, p_agm_id, p_category, p_filename, p_mime, p_size_bytes, p_storage_path, p_sha256)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

revoke execute on function public.register_document(uuid, uuid, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.register_document(uuid, uuid, text, text, text, bigint, text, text) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read governance tables (RLS scoped)
-- ------------------------------------------------------------
grant select on public.agms, public.agm_settings, public.agenda_items, public.attendance,
  public.quorum_snapshots, public.motions, public.resolutions, public.actions,
  public.compliance_rules, public.compliance_checks, public.compliance_findings,
  public.documents, public.audit_events to authenticated;
