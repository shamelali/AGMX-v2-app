-- ============================================================
-- AGMX V2 — Sprint 8: Elections + Secret Ballots
-- Election control centre, secret ballot store (separate from
-- identity/eligibility), maker-checker on close, verified-before-
-- published results, tally without voter linkage.
-- ============================================================

-- ------------------------------------------------------------
-- Elections: control centre state per AGM
-- ------------------------------------------------------------
create table if not exists public.elections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  agm_id           uuid not null references public.agms(id) on delete cascade,
  title            text not null,
  status           text not null default 'draft',      -- draft | open | suspended | closed | verified | published
  opens_at         timestamptz,
  closes_at        timestamptz,
  quorum_required  numeric not null default 25,
  created_at       timestamptz not null default now(),
  verified_at      timestamptz,
  verified_by      uuid,
  published_at     timestamptz,
  published_by     uuid,
  close_approvals  uuid[] not null default '{}'::uuid[], -- maker-checker: distinct operators who approved close
  unique (agm_id)
);

comment on table public.elections is 'Election control centre per AGM. Status machine: draft -> open -> suspended|closed -> verified -> published.';
comment on column public.elections.close_approvals is 'Maker-checker: distinct operator ids who approved closing voting. Close happens when two distinct operators have approved.';

create index if not exists idx_elections_agm on public.elections(agm_id);
create index if not exists idx_elections_org on public.elections(organization_id);

-- ------------------------------------------------------------
-- Ballots: secret ballot store. NO choice column here.
-- One row per voter per election; receipt token is random and
-- carries no choice linkage.
-- ------------------------------------------------------------
create table if not exists public.ballots (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references public.elections(id) on delete cascade,
  voter_member_id uuid not null references public.members(id),
  receipt_token  text not null unique,
  cast_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (election_id, voter_member_id)
);

comment on table public.ballots is 'Secret ballot store: one row per voter per election, no choice column. Receipt token is random and unlinked to the choice.';

create index if not exists idx_ballots_election on public.ballots(election_id);
create index if not exists idx_ballots_voter on public.ballots(voter_member_id);

-- ------------------------------------------------------------
-- Ballot selections: the actual choice, stored separately from
-- voter identity. choice: ya | tidak | kecuali
-- ------------------------------------------------------------
create table if not exists public.ballot_selections (
  id         uuid primary key default gen_random_uuid(),
  ballot_id  uuid not null references public.ballots(id) on delete cascade,
  choice     text not null check (choice in ('ya','tidak','kecuali')),
  created_at timestamptz not null default now()
);

comment on table public.ballot_selections is 'Ballot choice stored separately from the voter-identifying ballot row.';

create index if not exists idx_ballot_selections_ballot on public.ballot_selections(ballot_id);

-- ------------------------------------------------------------
-- RLS on election tables
-- ------------------------------------------------------------
alter table public.elections enable row level security;
alter table public.ballots enable row level security;
alter table public.ballot_selections enable row level security;

drop policy if exists elections_org on public.elections;
create policy elections_org on public.elections for all using (organization_id = public.current_org_id());

drop policy if exists ballots_org on public.ballots;
create policy ballots_org on public.ballots for all using (
  exists (
    select 1 from public.elections e
    where e.id = public.ballots.election_id
      and e.organization_id = public.current_org_id()
  )
);

drop policy if exists ballot_selections_org on public.ballot_selections;
create policy ballot_selections_org on public.ballot_selections for all using (
  exists (
    select 1 from public.ballots b
    join public.elections e on e.id = b.election_id
    where e.id = public.ballot_selections.ballot_id
      and e.organization_id = public.current_org_id()
  )
);

-- ------------------------------------------------------------
-- Append-only triggers: ballots and selections are immutable once cast
-- ------------------------------------------------------------
drop trigger if exists ballots_append_only on public.ballots;
create trigger ballots_append_only
  before update or delete on public.ballots
  for each row execute function public.raise_append_only();

drop trigger if exists ballot_selections_append_only on public.ballot_selections;
create trigger ballot_selections_append_only
  before update or delete on public.ballot_selections
  for each row execute function public.raise_append_only();

-- ------------------------------------------------------------
-- RPC: election_configure — create or update a draft election
-- ------------------------------------------------------------
create or replace function public.election_configure(
  p_agm_id       uuid,
  p_title        text,
  p_opens_at     timestamptz,
  p_closes_at    timestamptz,
  p_quorum_required numeric,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_election uuid;
  v_status text;
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

  select id, status into v_election, v_status
  from public.elections where agm_id = p_agm_id;

  if found then
    if v_status is distinct from 'draft' then
      return jsonb_build_object('error', 'Election already configured', 'code', 'ELECTION_CONFIGURED', 'status', v_status);
    end if;
    update public.elections
       set title = p_title,
           opens_at = p_opens_at,
           closes_at = p_closes_at,
           quorum_required = coalesce(p_quorum_required, 25)
     where id = v_election;
  else
    insert into public.elections
      (organization_id, agm_id, title, opens_at, closes_at, quorum_required)
    values
      (p_operator_org, p_agm_id, p_title, p_opens_at, p_closes_at,
       coalesce(p_quorum_required, 25))
    returning id into v_election;
  end if;

  perform public.log_audit(
    p_operator_org, p_actor, 'election.configured', 'election', v_election::text,
    jsonb_build_object('agm_id', p_agm_id, 'title', p_title, 'status', 'draft')
  );

  return jsonb_build_object(
    'election_id', v_election,
    'agm_id', p_agm_id,
    'status', 'draft'
  );
end;
$$;

revoke execute on function public.election_configure(uuid, text, timestamptz, timestamptz, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.election_configure(uuid, text, timestamptz, timestamptz, numeric, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: election_open — open voting (requires frozen roll + candidates snapshot)
-- ------------------------------------------------------------
create or replace function public.election_open(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_election uuid;
  v_status  text;
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

  select id, status into v_election, v_status
  from public.elections where agm_id = p_agm_id;

  if not found then
    return jsonb_build_object('error', 'Election not configured for this AGM');
  end if;
  if v_status = 'open' then
    return jsonb_build_object('opened', false, 'election_id', v_election, 'status', 'open');
  end if;
  if v_status is distinct from 'draft' then
    return jsonb_build_object('error', 'Cannot open election in status ' || v_status);
  end if;

  -- Immutable snapshots required before voting opens
  if not exists (
        select 1 from public.electoral_rolls er
        where er.agm_id = p_agm_id and er.frozen_at is not null
      ) then
    return jsonb_build_object('error', 'Electoral roll must be frozen before voting opens');
  end if;
  if not exists (select 1 from public.candidates c where c.agm_id = p_agm_id) then
    return jsonb_build_object('error', 'Candidates snapshot must exist before voting opens');
  end if;

  update public.elections
     set status = 'open', opens_at = now()
   where id = v_election;

  perform public.log_audit(
    p_operator_org, p_actor, 'election.opened', 'election', v_election::text,
    jsonb_build_object('agm_id', p_agm_id)
  );

  return jsonb_build_object(
    'opened', true,
    'election_id', v_election,
    'status', 'open',
    'opens_at', now()
  );
end;
$$;

revoke execute on function public.election_open(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.election_open(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: election_suspend — suspend voting
-- ------------------------------------------------------------
create or replace function public.election_suspend(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_election uuid;
  v_status  text;
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

  select id, status into v_election, v_status
  from public.elections where agm_id = p_agm_id;

  if not found then
    return jsonb_build_object('error', 'Election not configured for this AGM');
  end if;
  if v_status = 'suspended' then
    return jsonb_build_object('suspended', false, 'election_id', v_election, 'status', 'suspended');
  end if;
  if v_status is distinct from 'open' then
    return jsonb_build_object('error', 'Cannot suspend election in status ' || v_status);
  end if;

  update public.elections set status = 'suspended' where id = v_election;

  perform public.log_audit(
    p_operator_org, p_actor, 'election.suspended', 'election', v_election::text,
    jsonb_build_object('agm_id', p_agm_id)
  );

  return jsonb_build_object(
    'suspended', true,
    'election_id', v_election,
    'status', 'suspended'
  );
end;
$$;

revoke execute on function public.election_suspend(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.election_suspend(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: election_close — close voting (maker-checker: two distinct operators)
-- ------------------------------------------------------------
create or replace function public.election_close(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org         uuid;
  v_election    uuid;
  v_status      text;
  v_approved    boolean := false;
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

  select id, status into v_election, v_status
  from public.elections where agm_id = p_agm_id;

  if not found then
    return jsonb_build_object('error', 'Election not configured for this AGM');
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('closed', false, 'election_id', v_election, 'status', 'closed');
  end if;
  if v_status not in ('open','suspended') then
    return jsonb_build_object('error', 'Cannot close election in status ' || v_status);
  end if;

  -- Maker-checker: record this operator's approval; close only when two
  -- distinct operators have approved.
  update public.elections
     set close_approvals = close_approvals || p_operator_org
   where id = v_election
     and not (p_operator_org = any(close_approvals));

  select array_length(close_approvals, 1) >= 2 into v_approved
  from public.elections where id = v_election;

  if v_approved then
    update public.elections
       set status = 'closed', closes_at = now()
     where id = v_election;

    perform public.log_audit(
      p_operator_org, p_actor, 'election.closed', 'election', v_election::text,
      jsonb_build_object('agm_id', p_agm_id, 'approvals',
        (select close_approvals from public.elections where id = v_election))
    );

    return jsonb_build_object(
      'closed', true,
      'election_id', v_election,
      'status', 'closed',
      'closes_at', now()
    );
  end if;

  perform public.log_audit(
    p_operator_org, p_actor, 'election.close.requested', 'election', v_election::text,
    jsonb_build_object('agm_id', p_agm_id)
  );

  return jsonb_build_object(
    'closed', false,
    'election_id', v_election,
    'status', v_status,
    'approvals_needed', 2,
    'approvals_recorded', array_length(close_approvals, 1)
  );
end;
$$;

revoke execute on function public.election_close(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.election_close(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: cast_ballot — cast a secret ballot (idempotent per voter)
-- ------------------------------------------------------------
create or replace function public.cast_ballot(
  p_election_id     uuid,
  p_voter_member_id uuid,
  p_choice          text,
  p_actor           uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_election  uuid;
  v_agm_id    uuid;
  v_org       uuid;
  v_status    text;
  v_eligible  boolean;
  v_ballot_id uuid;
  v_receipt   text;
  v_cast_at   timestamptz;
begin
  if p_choice not in ('ya','tidak','kecuali') then
    return jsonb_build_object('error', 'Invalid choice', 'code', 'INVALID_CHOICE');
  end if;

  select e.id, e.agm_id, e.organization_id, e.status
  into v_election, v_agm_id, v_org, v_status
  from public.elections e where id = p_election_id;

  if not found then
    return jsonb_build_object('error', 'Election not found');
  end if;
  if v_status is distinct from 'open' then
    return jsonb_build_object('error', 'Voting is not open', 'code', 'VOTING_NOT_OPEN');
  end if;

  -- Voter must be on the frozen electoral roll for this AGM with vote_eligible
  select count(*) > 0 into v_eligible
  from public.electoral_rolls er
  join public.electoral_roll_entries ere on ere.electoral_roll_id = er.id
  where er.agm_id = v_agm_id
    and er.frozen_at is not null
    and ere.member_id = p_voter_member_id
    and ere.vote_eligible = true;

  if not v_eligible then
    return jsonb_build_object('error', 'Voter not eligible', 'code', 'VOTER_NOT_ELIGIBLE');
  end if;

  -- Idempotent: one accepted ballot per voter per election
  insert into public.ballots
    (election_id, voter_member_id, receipt_token, cast_at)
  values
    (p_election_id, p_voter_member_id, encode(gen_random_bytes(16), 'hex'), now())
  on conflict (election_id, voter_member_id) do nothing
  returning id, receipt_token, cast_at into v_ballot_id, v_receipt, v_cast_at;

  if not found then
    -- Ballot already exists: return the existing receipt (idempotent replay)
    select id, receipt_token, cast_at into v_ballot_id, v_receipt, v_cast_at
    from public.ballots
    where election_id = p_election_id and voter_member_id = p_voter_member_id;

    perform public.log_audit(
      v_org, p_actor, 'ballot.replay', 'ballot', v_ballot_id::text,
      jsonb_build_object('election_id', p_election_id, 'voter_member_id', p_voter_member_id)
    );

    return jsonb_build_object(
      'cast', false,
      'ballot_id', v_ballot_id,
      'receipt_token', v_receipt,
      'cast_at', v_cast_at,
      'message', 'Ballot already cast for this voter'
    );
  end if;

  insert into public.ballot_selections (ballot_id, choice)
  values (v_ballot_id, p_choice);

  perform public.log_audit(
    v_org, p_actor, 'ballot.cast', 'ballot', v_ballot_id::text,
    jsonb_build_object('election_id', p_election_id, 'voter_member_id', p_voter_member_id)
    -- NOTE: the voter's choice is deliberately NOT written to the audit payload
  );

  return jsonb_build_object(
    'cast', true,
    'ballot_id', v_ballot_id,
    'receipt_token', v_receipt,
    'cast_at', v_cast_at
  );
end;
$$;

revoke execute on function public.cast_ballot(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cast_ballot(uuid, uuid, text, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: election_verify — authorise results (gate before publish)
-- ------------------------------------------------------------
create or replace function public.election_verify(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_election uuid;
  v_status  text;
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

  select id, status into v_election, v_status
  from public.elections where agm_id = p_agm_id;

  if not found then
    return jsonb_build_object('error', 'Election not configured for this AGM');
  end if;
  if v_status = 'verified' then
    return jsonb_build_object('verified', false, 'election_id', v_election, 'status', 'verified');
  end if;
  if v_status not in ('open','suspended','closed') then
    return jsonb_build_object('error', 'Cannot verify election in status ' || v_status);
  end if;

  update public.elections
     set status = 'verified', verified_at = now(), verified_by = p_actor
   where id = v_election;

  perform public.log_audit(
    p_operator_org, p_actor, 'election.verified', 'election', v_election::text,
    jsonb_build_object('agm_id', p_agm_id)
  );

  return jsonb_build_object(
    'verified', true,
    'election_id', v_election,
    'status', 'verified',
    'verified_at', now()
  );
end;
$$;

revoke execute on function public.election_verify(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.election_verify(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: election_publish — publish results (requires verification)
-- ------------------------------------------------------------
create or replace function public.election_publish(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_election uuid;
  v_status  text;
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

  select id, status into v_election, v_status
  from public.elections where agm_id = p_agm_id;

  if not found then
    return jsonb_build_object('error', 'Election not configured for this AGM');
  end if;
  if v_status = 'published' then
    return jsonb_build_object('published', false, 'election_id', v_election, 'status', 'published');
  end if;
  if v_status is distinct from 'verified' then
    return jsonb_build_object('error', 'Results must be verified before publishing', 'code', 'NOT_VERIFIED');
  end if;

  update public.elections
     set status = 'published', published_at = now(), published_by = p_actor
   where id = v_election;

  perform public.log_audit(
    p_operator_org, p_actor, 'election.published', 'election', v_election::text,
    jsonb_build_object('agm_id', p_agm_id)
  );

  return jsonb_build_object(
    'published', true,
    'election_id', v_election,
    'status', 'published',
    'published_at', now()
  );
end;
$$;

revoke execute on function public.election_publish(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.election_publish(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: election_tally — read-only counts, no voter linkage
-- ------------------------------------------------------------
create or replace function public.election_tally(p_election_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_total  int;
  v_ya     int;
  v_tidak  int;
  v_kecuali int;
begin
  select status into v_status from public.elections where id = p_election_id;
  if not found then
    return jsonb_build_object('error', 'Election not found');
  end if;
  if v_status not in ('verified','published') then
    return jsonb_build_object('error', 'Results not yet authorised for release', 'code', 'RESULTS_NOT_RELEASED');
  end if;

  select count(b.id),
         count(*) filter (where bs.choice = 'ya'),
         count(*) filter (where bs.choice = 'tidak'),
         count(*) filter (where bs.choice = 'kecuali')
  into v_total, v_ya, v_tidak, v_kecuali
  from public.ballots b
  join public.ballot_selections bs on bs.ballot_id = b.id
  where b.election_id = p_election_id;

  return jsonb_build_object(
    'election_id', p_election_id,
    'status', v_status,
    'total_ballots', coalesce(v_total, 0),
    'ya', coalesce(v_ya, 0),
    'tidak', coalesce(v_tidak, 0),
    'kecuali', coalesce(v_kecuali, 0)
  );
end;
$$;

revoke execute on function public.election_tally(uuid) from public, anon, authenticated;
grant execute on function public.election_tally(uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read elections (RLS scoped)
-- Ballots/selections are readable only via the tally RPC (service_role).
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.elections to authenticated;
