-- ============================================================
-- AGMX V2 — Production Database Schema (Supabase / PostgreSQL)
-- ============================================================
-- GENERATED FILE — DO NOT EDIT.
-- Source of truth: supabase/migrations/*.sql, concatenated in filename
-- order. Regenerate with:
--     python3 tools/build_schema_bundle.py
-- tools/check.sh runs it with --check and fails if this file is stale.
--
-- Apply either with `supabase db push` (which runs migrations/ itself) or
-- by pasting this whole file into the Supabase dashboard SQL editor. Both
-- are rerun-safe: every statement here is `if not exists`, `or replace`,
-- `drop ... if exists` first, or guarded by an exception handler.
--
-- Sources:
--   0001_schema.sql  (871 lines)
--   0002_knowledge.sql  (154 lines)
--   0003_plans_seed.sql  (17 lines)
--   0004_revoke_non_dml_privileges.sql  (7 lines)
--   0005_pin_function_search_path.sql  (45 lines)
--   0006_subscriptions_billing.sql  (405 lines)
--   0007_governance_rpc.sql  (497 lines)
-- ============================================================


-- ============================================================
-- 0001_schema.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Production Database Schema (Supabase / PostgreSQL)
-- Fixed: table ordering, RLS policies, append-only, security, rerun-safe
-- Column-level protections, Realtime vote secrecy, minimal grants
-- Trigger order fixed, GRANT INSERT on votes added
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ------------------------------------------------------------
-- HELPER FUNCTIONS
-- ------------------------------------------------------------
create or replace function public.generate_ref(prefix text)
returns text language sql volatile as $$
  select $1 || '-' || to_base36(extract(epoch from now())::bigint) || '-' || upper(substring(md5(random()::text) from 1 for 6));
$$;

create or replace function public.to_base36(n bigint)
returns text language sql immutable as $$
  select case
    when n = 0 then '0'
    else (
      select string_agg(
        chr(c + case when c < 10 then 48 else 55 end),
        ''
        order by pos desc
      )
      from (
        select
          mod(
            div(n::numeric, power(36::numeric, p::numeric)),
            36::numeric
          )::int as c,
          p as pos
        from generate_series(
          0,
          floor(log(n::numeric) / log(36::numeric))::int
        ) as p
      ) as digits
    )
  end;
$$;

-- ------------------------------------------------------------
-- COLUMN PROTECTION TRIGGER FUNCTION (defined early, trigger created after table)
-- ------------------------------------------------------------
create or replace function public.profiles_protect_privileged_columns()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role then
    raise exception 'Cannot update role column';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Cannot update organization_id column';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- IDENTITY & TENANCY
-- ------------------------------------------------------------
create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  type          text not null default 'cooperative',
  registration_no text,
  state         text,
  zone          text,
  plan          text not null default 'starter',
  status        text not null default 'active',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name       text not null,
  role            text not null default 'member',
  phone           text,
  language        text not null default 'BM',
  senior_mode     boolean not null default false,
  theme           text not null default 'default',
  created_at      timestamptz not null default now()
);

-- Trigger to protect privileged columns (created AFTER profiles table exists)
drop trigger if exists profiles_protect_privileged on public.profiles;
create trigger profiles_protect_privileged
before update on public.profiles
for each row execute function public.profiles_protect_privileged_columns();

create table if not exists public.members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_no       text not null,
  name            text not null,
  ic              text,
  phone           text,
  shares          numeric(14,2) not null default 0,
  status          text not null default 'Aktif',
  arrears         numeric(14,2) not null default 0,
  eligible        boolean not null default true,
  age             int,
  joined_at       date,
  proxy_of        uuid references public.members(id),
  unique (organization_id, member_no)
);

create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete cascade,
  member_id       uuid references public.members(id) on delete cascade,
  role            text not null default 'member',
  permissions     text[] not null default '{}',
  unique (organization_id, user_id)
);

-- ------------------------------------------------------------
-- COMMERCIAL
-- ------------------------------------------------------------
create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  type        text not null,
  price_monthly numeric(12,2),
  price_annual  numeric(12,2),
  price_oneoff  numeric(12,2),
  max_members int,
  features    jsonb not null default '[]'::jsonb
);

create table if not exists public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id         uuid not null references public.plans(id),
  status          text not null default 'trialing',
  current_period_start timestamptz,
  current_period_end   timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.agm_assessments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  coop_name       text not null,
  coop_reg        text,
  state           text,
  members         int not null,
  agm_date        date,
  mode            text not null,
  expected_attendance int,
  candidates      int not null default 0,
  motions         int not null default 0,
  current_process text not null default 'manual',
  needs_managed   boolean not null default true,
  contact_name    text not null,
  contact_phone   text not null,
  contact_email   text,
  complexity_score int not null,
  recommended_plan uuid references public.plans(id),
  status          text not null default 'lead',
  reference       text unique not null default public.generate_ref('LD'),
  token           text not null default gen_random_uuid()::text,
  created_at      timestamptz not null default now()
);

create table if not exists public.quotes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id   uuid references public.agm_assessments(id),
  number          text unique not null,
  status          text not null default 'draft',
  valid_until     date,
  subtotal        numeric(12,2) not null,
  tax             numeric(12,2) not null default 0,
  total           numeric(12,2) not null,
  created_at      timestamptz not null default now()
);

create table if not exists public.quote_items (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references public.quotes(id) on delete cascade,
  plan_id    uuid references public.plans(id),
  description text not null,
  quantity   int not null default 1,
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null
);

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id        uuid references public.quotes(id),
  number          text unique not null,
  status          text not null default 'unpaid',
  issued_at       date not null default current_date,
  due_at          date,
  amount          numeric(12,2) not null,
  paid_at         timestamptz
);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  method          text not null,
  reference       text,
  amount          numeric(12,2) not null,
  status          text not null default 'pending',
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- COOPERATIVE MEMBERS
-- ------------------------------------------------------------
create table if not exists public.member_status_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  from_status     text,
  to_status       text not null,
  changed_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- AGM
-- ------------------------------------------------------------
create table if not exists public.agms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null,
  edition         int not null,
  fiscal_year     text,
  scheduled_at    timestamptz not null,
  venue           text,
  mode            text not null default 'hybrid',
  status          text not null default 'planned',
  quorum_pct      numeric(5,2) not null,
  notice_days     int not null default 21,
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists public.agm_settings (
  agm_id          uuid primary key references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  allow_proxy     boolean not null default true,
  allow_online    boolean not null default true,
  voting_opens_at timestamptz,
  voting_closes_at timestamptz,
  min_seconder    int not null default 1
);

create table if not exists public.agenda_items (
  id              uuid primary key default gen_random_uuid(),
  agm_id          uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  title           text not null,
  type            text not null,
  duration_min    int not null default 10,
  presenter       text,
  sort_order      int not null default 0,
  status          text not null default 'menunggu'
);

create table if not exists public.agm_notices (
  id              uuid primary key default gen_random_uuid(),
  agm_id          uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  channel         text not null,
  recipient_count int not null default 0,
  read_count      int not null default 0
);

create table if not exists public.notice_recipients (
  id              uuid primary key default gen_random_uuid(),
  notice_id       uuid not null references public.agm_notices(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivered_at    timestamptz,
  opened_at       timestamptz,
  unique (notice_id, member_id)
);

create table if not exists public.attendance (
  id              uuid primary key default gen_random_uuid(),
  agm_id          uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  check_in_at     timestamptz not null default now(),
  method          text not null,
  unique (agm_id, member_id)
);

create table if not exists public.quorum_snapshots (
  id              uuid primary key default gen_random_uuid(),
  agm_id          uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  total_members   int not null,
  present         int not null,
  pct             numeric(5,2) not null,
  satisfied       boolean not null,
  captured_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- GOVERNANCE
-- ------------------------------------------------------------
create table if not exists public.motions (
  id              uuid primary key default gen_random_uuid(),
  agm_id          uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  title           text not null,
  type            text not null,
  proposer_id     uuid references public.members(id),
  seconder_id     uuid references public.members(id),
  status          text not null default 'draf',
  discussion      jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

-- audit_events BEFORE votes (for FK)
create table if not exists public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references auth.users(id),
  actor_name      text,
  action          text not null,
  entity_type     text not null,
  entity_id       text not null,
  payload         jsonb not null default '{}'::jsonb,
  prev_hash       text,
  hash            text not null unique,
  occurred_at     timestamptz not null default now()
);

create table if not exists public.votes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  motion_id       uuid not null references public.motions(id) on delete cascade,
  voter_id        uuid not null references public.members(id) on delete cascade,
  choice          text not null,
  cast_at         timestamptz not null default now(),
  audit_event_id  uuid references public.audit_events(id),
  unique (motion_id, voter_id)
);

create table if not exists public.resolutions (
  id              uuid primary key default gen_random_uuid(),
  agm_id          uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  motion_id       uuid references public.motions(id),
  title           text not null,
  passed          boolean not null,
  votes_ya        int not null default 0,
  votes_tidak     int not null default 0,
  votes_kecuali   int not null default 0,
  minuted_at      timestamptz
);

create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  agm_id          uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asker_id        uuid references public.members(id),
  text            text not null,
  dedupe_group    text,
  status          text not null default 'baru',
  answered_at     timestamptz
);

create table if not exists public.actions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid references public.agms(id),
  resolution_id   uuid references public.resolutions(id),
  title           text not null,
  pic_id          uuid references public.members(id),
  due_date        date,
  status          text not null default 'terbuka',
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- COMPLIANCE
-- ------------------------------------------------------------
create table if not exists public.compliance_rules (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  act         text not null,
  description text not null,
  severity    text not null default 'info'
);

create table if not exists public.compliance_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid references public.agms(id),
  rule_id         uuid not null references public.compliance_rules(id),
  result          text not null,
  details         jsonb not null default '{}'::jsonb,
  checked_at      timestamptz not null default now()
);

create table if not exists public.compliance_findings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  check_id        uuid references public.compliance_checks(id),
  severity        text not null,
  message         text not null,
  status          text not null default 'terbuka',
  resolved_at     timestamptz
);

-- ------------------------------------------------------------
-- EVIDENCE / AUDIT VAULT
-- ------------------------------------------------------------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid references public.agms(id),
  category        text not null,
  filename        text not null,
  mime            text not null,
  size_bytes      bigint,
  storage_path    text not null,
  sha256          text,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- DISTRIBUTION: PARTNERS & FEDERATIONS
-- ------------------------------------------------------------
create table if not exists public.partners (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_name    text not null,
  contact_email   text not null,
  commission_pct  numeric(5,2) not null default 10.00,
  status          text not null default 'active'
);

create table if not exists public.partner_organizations (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  referred_at     timestamptz not null default now(),
  commission_earned numeric(12,2) not null default 0
);

create table if not exists public.federations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  owner_org_id    uuid not null references public.organizations(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create table if not exists public.federation_organizations (
  id              uuid primary key default gen_random_uuid(),
  federation_id   uuid not null references public.federations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  unique (federation_id, organization_id)
);

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
create index if not exists idx_org_slug on public.organizations(slug);
create index if not exists idx_members_org on public.members(organization_id);
create index if not exists idx_members_eligible on public.members(organization_id, eligible);
create index if not exists idx_agms_org on public.agms(organization_id, status);
create index if not exists idx_motions_agm on public.motions(agm_id);
create index if not exists idx_votes_motion on public.votes(motion_id);
create index if not exists idx_attendance_agm on public.attendance(agm_id);
create index if not exists idx_audit_org on public.audit_events(organization_id, occurred_at desc);
create index if not exists idx_assessments_status on public.agm_assessments(status);
create index if not exists idx_leads_created on public.agm_assessments(created_at desc);
create index if not exists idx_notice_recips_org on public.notice_recipients(organization_id);

-- ------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.profiles             enable row level security;
alter table public.organization_members enable row level security;
alter table public.plans                enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.agm_assessments      enable row level security;
alter table public.quotes               enable row level security;
alter table public.quote_items          enable row level security;
alter table public.invoices             enable row level security;
alter table public.payments             enable row level security;
alter table public.members              enable row level security;
alter table public.member_status_history enable row level security;
alter table public.agms                 enable row level security;
alter table public.agm_settings         enable row level security;
alter table public.agenda_items         enable row level security;
alter table public.agm_notices          enable row level security;
alter table public.notice_recipients    enable row level security;
alter table public.attendance           enable row level security;
alter table public.quorum_snapshots     enable row level security;
alter table public.motions              enable row level security;
alter table public.votes                enable row level security;
alter table public.resolutions          enable row level security;
alter table public.questions            enable row level security;
alter table public.actions              enable row level security;
alter table public.compliance_rules     enable row level security;
alter table public.compliance_checks    enable row level security;
alter table public.compliance_findings  enable row level security;
alter table public.documents            enable row level security;
alter table public.audit_events         enable row level security;
alter table public.partners             enable row level security;
alter table public.partner_organizations enable row level security;
alter table public.federations          enable row level security;
alter table public.federation_organizations enable row level security;

-- ------------------------------------------------------------
-- HELPER: current_org_id
-- ------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid language sql stable security definer as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- RLS POLICIES (rerun-safe with DROP IF EXISTS)
-- ------------------------------------------------------------
do $$
begin
  -- profiles: read own; update only name/phone/language/theme/senior_mode (trigger blocks role/org)
  execute 'drop policy if exists profiles_read_own on public.profiles';
  execute 'create policy profiles_read_own on public.profiles for select using (id = auth.uid())';
  execute 'drop policy if exists profiles_update_own on public.profiles';
  execute 'create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid())';

  -- organizations: members see their org
  execute 'drop policy if exists orgs_read_own on public.organizations';
  execute 'create policy orgs_read_own on public.organizations for select using (id = public.current_org_id())';

  -- organization_members: read for org members; write only for admin/secretary
  execute 'drop policy if exists org_members_read on public.organization_members';
  execute 'create policy org_members_read on public.organization_members for select using (organization_id = public.current_org_id())';
  execute 'drop policy if exists org_members_write on public.organization_members';
  execute 'create policy org_members_write on public.organization_members for insert with check (
    organization_id = public.current_org_id() and
    exists (select 1 from public.profiles where id = auth.uid() and role in (''admin'',''secretary''))
  )';
  execute 'drop policy if exists org_members_update on public.organization_members';
  execute 'create policy org_members_update on public.organization_members for update using (
    organization_id = public.current_org_id() and
    exists (select 1 from public.profiles where id = auth.uid() and role in (''admin'',''secretary''))
  ) with check (organization_id = public.current_org_id())';

  -- plans: read-only for all authenticated
  execute 'drop policy if exists plans_read on public.plans';
  execute 'create policy plans_read on public.plans for select using (true)';

  -- subscriptions: org isolation
  execute 'drop policy if exists subs_org on public.subscriptions';
  execute 'create policy subs_org on public.subscriptions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- agm_assessments: public insert only (lead submission); reads/updates only for org members after conversion
  execute 'drop policy if exists assessments_lead_insert on public.agm_assessments';
  execute 'create policy assessments_lead_insert on public.agm_assessments for insert with check (organization_id is null)';
  execute 'drop policy if exists assessments_read on public.agm_assessments';
  execute 'create policy assessments_read on public.agm_assessments for select using (
    organization_id = public.current_org_id() or
    (organization_id is null and exists (select 1 from public.profiles where id = auth.uid() and role in (''admin'',''secretary'')))
  )';
  execute 'drop policy if exists assessments_update on public.agm_assessments';
  execute 'create policy assessments_update on public.agm_assessments for update using (
    organization_id = public.current_org_id() or
    (organization_id is null and exists (select 1 from public.profiles where id = auth.uid() and role in (''admin'',''secretary'')))
  ) with check (organization_id = public.current_org_id() or organization_id is null)';

  -- quotes, quote_items, invoices, payments: org isolation
  execute 'drop policy if exists quotes_org on public.quotes';
  execute 'create policy quotes_org on public.quotes for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists quote_items_org on public.quote_items';
  execute 'create policy quote_items_org on public.quote_items for all using (
    quote_id in (select id from public.quotes where organization_id = public.current_org_id())
  ) with check (
    quote_id in (select id from public.quotes where organization_id = public.current_org_id())
  )';
  execute 'drop policy if exists invoices_org on public.invoices';
  execute 'create policy invoices_org on public.invoices for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists payments_org on public.payments';
  execute 'create policy payments_org on public.payments for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- members: org isolation
  execute 'drop policy if exists members_org on public.members';
  execute 'create policy members_org on public.members for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- member_status_history: org isolation
  execute 'drop policy if exists msh_org on public.member_status_history';
  execute 'create policy msh_org on public.member_status_history for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- agms, agm_settings, agenda_items, agm_notices: org isolation
  execute 'drop policy if exists agms_org on public.agms';
  execute 'create policy agms_org on public.agms for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists agm_settings_org on public.agm_settings';
  execute 'create policy agm_settings_org on public.agm_settings for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists agenda_org on public.agenda_items';
  execute 'create policy agenda_org on public.agenda_items for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists notices_org on public.agm_notices';
  execute 'create policy notices_org on public.agm_notices for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- notice_recipients: org isolation via denormalized organization_id
  execute 'drop policy if exists notice_recips_org on public.notice_recipients';
  execute 'create policy notice_recips_org on public.notice_recipients for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- attendance, quorum_snapshots: org isolation
  execute 'drop policy if exists attendance_org on public.attendance';
  execute 'create policy attendance_org on public.attendance for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists quorum_org on public.quorum_snapshots';
  execute 'create policy quorum_org on public.quorum_snapshots for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- motions, resolutions, questions, actions: org isolation
  execute 'drop policy if exists motions_org on public.motions';
  execute 'create policy motions_org on public.motions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists resolutions_org on public.resolutions';
  execute 'create policy resolutions_org on public.resolutions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists questions_org on public.questions';
  execute 'create policy questions_org on public.questions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists actions_org on public.actions';
  execute 'create policy actions_org on public.actions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- compliance: org isolation
  execute 'drop policy if exists comp_rules_read on public.compliance_rules';
  execute 'create policy comp_rules_read on public.compliance_rules for select using (true)';
  execute 'drop policy if exists comp_checks_org on public.compliance_checks';
  execute 'create policy comp_checks_org on public.compliance_checks for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists comp_findings_org on public.compliance_findings';
  execute 'create policy comp_findings_org on public.compliance_findings for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- documents: org isolation
  execute 'drop policy if exists docs_org on public.documents';
  execute 'create policy docs_org on public.documents for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- audit_events: org isolation, append-only
  execute 'drop policy if exists audit_read on public.audit_events';
  execute 'create policy audit_read on public.audit_events for select using (organization_id = public.current_org_id())';
  execute 'drop policy if exists audit_insert on public.audit_events';
  execute 'create policy audit_insert on public.audit_events for insert with check (organization_id = public.current_org_id())';

  -- partners, partner_organizations: org isolation
  execute 'drop policy if exists partners_org on public.partners';
  execute 'create policy partners_org on public.partners for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
  execute 'drop policy if exists partner_orgs_org on public.partner_organizations';
  execute 'create policy partner_orgs_org on public.partner_organizations for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- federations: owner org isolation
  execute 'drop policy if exists feds_org on public.federations';
  execute 'create policy feds_org on public.federations for all using (owner_org_id = public.current_org_id()) with check (owner_org_id = public.current_org_id())';
  execute 'drop policy if exists fed_orgs_org on public.federation_organizations';
  execute 'create policy fed_orgs_org on public.federation_organizations for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  -- votes: org isolation, append-only, ballot secrecy (no SELECT)
  execute 'drop policy if exists votes_read on public.votes';
  execute 'create policy votes_read on public.votes for select using (false)';  -- No direct reads
  execute 'drop policy if exists votes_insert on public.votes';
  execute 'create policy votes_insert on public.votes for insert with check (organization_id = public.current_org_id())';
end $$;

-- ------------------------------------------------------------
-- RATE LIMITING TABLE & RPC
-- ------------------------------------------------------------
create table if not exists public.rate_limit (
  ip text primary key,
  request_count int not null default 1,
  window_start timestamptz not null default now()
);

create index if not exists idx_rate_limit_window on public.rate_limit (window_start);

alter table public.rate_limit enable row level security;

drop policy if exists rate_limit_service_only on public.rate_limit;

create policy rate_limit_service_only on public.rate_limit
  for all using (auth.role() = 'service_role');

create or replace function public.check_rate_limit(
  p_ip text,
  p_limit int default 60,
  p_window interval default '1 minute'
)
returns boolean language plpgsql security definer as $$
declare
  v_count int;
  v_window_start timestamptz;
begin
  -- Clean old entries
  delete from public.rate_limit
  where window_start < now() - p_window;

  -- Upsert counter
  insert into public.rate_limit (ip, request_count, window_start)
  values (p_ip, 1, now())
  on conflict (ip) do update set
    request_count = rate_limit.request_count + 1
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

-- ------------------------------------------------------------
-- PAYMENT WEBHOOK RPC
-- ------------------------------------------------------------
-- supabase/functions/money-flow/index.ts verifies the gateway signature and
-- then calls this; nothing else writes a payment. Mirrors the live PocketBase
-- confirmPayment() in pb_hooks/money_flow.lib.js: payment -> succeeded,
-- invoice -> paid, assessment -> won.
alter table public.payments add column if not exists gateway text;
alter table public.payments add column if not exists txn_id  text;

create or replace function public.process_payment_webhook(
  p_invoice_id  uuid,
  p_method      text,
  p_gateway_ref text,
  p_txn_id      text,
  p_status      text,
  p_paid_at     timestamptz,
  p_gateway     text
)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
begin
  -- Locking the invoice serialises two webhooks arriving for the same bill,
  -- which is what makes the re-charge-on-retry race impossible. A unique
  -- index on (invoice_id, reference) would be stricter but cannot be added to
  -- a payments table that already holds duplicate rows.
  select * into v_invoice from public.invoices
     where id = p_invoice_id for update;
  if not found then
    raise exception 'process_payment_webhook: invoice % not found', p_invoice_id;
  end if;

  select * into v_payment from public.payments
     where invoice_id = p_invoice_id
       and coalesce(reference, '') = coalesce(p_gateway_ref, '')
     order by created_at desc
     limit 1;

  if found and v_payment.status = 'succeeded' then
    return 'duplicate';
  end if;

  if found then
    update public.payments
       set status = p_status, paid_at = p_paid_at,
           gateway = p_gateway, txn_id = p_txn_id
     where id = v_payment.id;
  else
    insert into public.payments
      (invoice_id, organization_id, method, reference, amount, status, paid_at, gateway, txn_id)
    values
      (p_invoice_id, v_invoice.organization_id, p_method, p_gateway_ref,
       v_invoice.amount, p_status, p_paid_at, p_gateway, p_txn_id);
  end if;

  -- A failed callback must not un-pay an invoice that already settled.
  if p_status = 'succeeded' then
    update public.invoices set status = 'paid', paid_at = p_paid_at
      where id = p_invoice_id and status <> 'paid';

    update public.agm_assessments set status = 'won'
      where id = (select q.assessment_id from public.quotes q
                    where q.id = v_invoice.quote_id)
        and status not in ('scheduled', 'lost');
  end if;

  return p_status;
end;
$$;

revoke execute on function public.process_payment_webhook(uuid, text, text, text, text, timestamptz, text)
  from public, anon;
grant execute on function public.process_payment_webhook(uuid, text, text, text, text, timestamptz, text)
  to service_role;

-- ------------------------------------------------------------
-- APPEND-ONLY TRIGGERS
-- ------------------------------------------------------------
create or replace function public.raise_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Append-only table: updates and deletes are not allowed';
end $$;

drop trigger if exists votes_append_only on public.votes;
create trigger votes_append_only
before update or delete on public.votes
for each row execute function public.raise_append_only();

drop trigger if exists audit_append_only on public.audit_events;
create trigger audit_append_only
before update or delete on public.audit_events
for each row execute function public.raise_append_only();

-- ------------------------------------------------------------
-- GRANT PERMISSIONS (minimal, scoped)
-- ------------------------------------------------------------
revoke all on schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

-- Read access for authenticated users
grant select on all tables in schema public to authenticated;

-- Insert/update for specific tables (RLS enforces tenant isolation)
grant insert, update on public.agm_assessments to authenticated;
grant insert, update on public.quotes, public.quote_items, public.invoices, public.payments to authenticated;
grant insert, update on public.members, public.agms, public.agenda_items, public.agm_notices to authenticated;
grant insert, update on public.attendance, public.quorum_snapshots, public.motions, public.resolutions to authenticated;
grant insert, update on public.questions, public.actions, public.compliance_checks, public.compliance_findings to authenticated;
grant insert, update on public.documents, public.audit_events to authenticated;
grant insert, update on public.partners, public.partner_organizations, public.federations, public.federation_organizations to authenticated;
grant insert, update on public.organization_members to authenticated;
grant insert, update on public.profiles to authenticated;

-- votes: INSERT needed for authenticated clients to vote directly
grant insert on public.votes to authenticated;

-- rate_limit: no client access (service_role only via RPC)
-- grant select, insert on public.rate_limit to authenticated; -- NOT GRANTED

-- Service role gets everything
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- ------------------------------------------------------------
-- REALTIME: EXCLUDE votes FROM PUBLICATION (ballot secrecy)
-- ------------------------------------------------------------
-- Idempotent: safe to run multiple times
DO $$
BEGIN
  -- Remove votes from realtime (ballot secrecy) - safe if not present
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.votes;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    -- Table not in publication, continue
  END;

  -- Add realtime tables (safe if already present)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance, public.quorum_snapshots, public.motions, public.questions;
  EXCEPTION WHEN duplicate_table OR duplicate_object THEN
    -- Tables already in publication, continue
  END;
END $$;


-- ============================================================
-- 0002_knowledge.sql
-- ============================================================
-- ============================================================
-- AGMX Knowledge Store — pgvector Schema (Supabase)
-- Fixed: secure function, rerun-safe policies, proper grants
-- No PUBLIC execute, VECTOR(1024) matches NVIDIA NIM nv-embedqa-e5-v5
-- ============================================================

create extension if not exists "vector";

-- ------------------------------------------------------------
-- KNOWLEDGE JOBS
-- ------------------------------------------------------------
create table if not exists public.knowledge_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete set null,
  status          text not null default 'pending',
  source_type     text not null,
  source_path     text,
  total_chunks    int default 0,
  processed_chunks int default 0,
  error_message   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_jobs_org on public.knowledge_jobs(organization_id);
create index if not exists idx_knowledge_jobs_status on public.knowledge_jobs(status);

-- ------------------------------------------------------------
-- KNOWLEDGE CHUNKS
-- ------------------------------------------------------------
create table if not exists public.knowledge_chunks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  job_id          uuid references public.knowledge_jobs(id) on delete set null,
  chunk_index     int not null,
  title           text,
  content         text not null,
  page            int,
  token_count     int,
  embedding       vector(1024),
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_chunks_org on public.knowledge_chunks(organization_id);
create index if not exists idx_knowledge_chunks_doc on public.knowledge_chunks(document_id);
create index if not exists idx_knowledge_chunks_embedding 
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ------------------------------------------------------------
-- KNOWLEDGE ASSERTIONS
-- ------------------------------------------------------------
create table if not exists public.knowledge_assertions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  chunk_id        uuid not null references public.knowledge_chunks(id) on delete cascade,
  subject         text not null,
  predicate       text not null,
  object          text not null,
  quote           text,
  confidence      numeric(3,2) default 0.9,
  created_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_assertions_org on public.knowledge_assertions(organization_id);
create index if not exists idx_knowledge_assertions_chunk on public.knowledge_assertions(chunk_id);
create index if not exists idx_knowledge_assertions_subject on public.knowledge_assertions(subject);
create index if not exists idx_knowledge_assertions_predicate on public.knowledge_assertions(predicate);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.knowledge_jobs      enable row level security;
alter table public.knowledge_chunks    enable row level security;
alter table public.knowledge_assertions enable row level security;

do $$
begin
  execute 'drop policy if exists kj_org on public.knowledge_jobs';
  execute 'create policy kj_org on public.knowledge_jobs for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  execute 'drop policy if exists kc_org on public.knowledge_chunks';
  execute 'create policy kc_org on public.knowledge_chunks for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';

  execute 'drop policy if exists ka_org on public.knowledge_assertions';
  execute 'create policy ka_org on public.knowledge_assertions for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
end $$;

-- ------------------------------------------------------------
-- SECURE VECTOR SEARCH FUNCTION
-- ------------------------------------------------------------
-- Verifies caller belongs to the organization they're querying
-- Returns only chunks/assertions from caller's organization
create or replace function public.knowledge_search(
  p_query_embedding vector(1024),
  p_limit int default 10,
  p_threshold numeric default 0.65
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  content text,
  page int,
  similarity numeric,
  assertions jsonb
) language sql stable security definer as $$
  select 
    kc.id as chunk_id,
    kc.document_id,
    kc.title,
    kc.content,
    kc.page,
    1 - (kc.embedding <=> p_query_embedding) as similarity,
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'subject', ka.subject,
          'predicate', ka.predicate,
          'object', ka.object,
          'quote', ka.quote,
          'confidence', ka.confidence
        )
      ), '[]'::jsonb)
      from public.knowledge_assertions ka
      where ka.chunk_id = kc.id
    ) as assertions
  from public.knowledge_chunks kc
  where kc.organization_id = public.current_org_id()  -- Enforce caller's org
    and kc.embedding is not null
    and 1 - (kc.embedding <=> p_query_embedding) >= p_threshold
  order by kc.embedding <=> p_query_embedding
  limit p_limit;
$$;

-- ------------------------------------------------------------
-- GRANT PERMISSIONS (explicit, no PUBLIC execute)
-- ------------------------------------------------------------
revoke execute on function public.knowledge_search(vector(1024), int, numeric) from public, anon;
grant execute on function public.knowledge_search(vector(1024), int, numeric) to authenticated;
grant all on public.knowledge_jobs to authenticated, service_role;
grant all on public.knowledge_chunks to authenticated, service_role;
grant all on public.knowledge_assertions to authenticated, service_role;

-- ------------------------------------------------------------
-- REALTIME: DO NOT ADD knowledge tables to supabase_realtime
-- Knowledge data is not realtime-sensitive
-- ------------------------------------------------------------


-- ============================================================
-- 0003_plans_seed.sql
-- ============================================================
-- Seed the three AGM service plans. money-flow's POST /quote looks up
-- plans.code and fails with "Invalid plan" when missing.

insert into public.plans (code, name, type, price_oneoff, max_members, features)
values
  ('essential_agm', 'AGMX Essential AGM', 'agm_service', 1500, 500,
   '["Up to 500 members","1 AGM session","Basic e-voting","Digital minutes","Audit trail"]'::jsonb),
  ('professional_agm', 'AGMX Professional AGM', 'agm_service', 3500, 2000,
   '["Up to 2,000 members","Hybrid / online AGM","Full e-voting + hash chain","AI secretary (minutes)","Senior mode","Digital meeting pack","AGM facilitator"]'::jsonb),
  ('enterprise_agm', 'AGMX Enterprise AGM', 'agm_service', 7500, 5000,
   '["5,000+ members","All Professional features","Full AI copilot (4 agents)","GP14/GP14B/UUK compliance","Dedicated project manager","SKM audit report"]'::jsonb)
on conflict (code) do update
  set name = excluded.name,
      type = excluded.type,
      price_oneoff = excluded.price_oneoff,
      max_members = excluded.max_members,
      features = excluded.features;


-- ============================================================
-- 0004_revoke_non_dml_privileges.sql
-- ============================================================
-- Supabase's ALTER DEFAULT PRIVILEGES grants anon and authenticated TRUNCATE and
-- REFERENCES on every table created in public. TRUNCATE is not evaluated against
-- row level security, so a role holding it can empty a tenant's table regardless
-- of its policies. PostgREST exposes no TRUNCATE verb today; this closes the gap
-- rather than depending on that.

revoke truncate, references on all tables in schema public from anon, authenticated;


-- ============================================================
-- 0005_pin_function_search_path.sql
-- ============================================================
-- Database linter findings 0011 (function_search_path_mutable) and 0028
-- (anon_security_definer_function_executable) on project lcrfsqocqavczgnzpadq.
--
-- current_org_id() is the hinge of tenant isolation: 36 row level security
-- policies compare organization_id against it. It is SECURITY DEFINER, so it
-- runs as its owner rather than as the caller, and it was created without a
-- function-level search_path. A DEFINER function that resolves names through a
-- mutable path can be made to touch a different object than its text shows, so
-- the path is pinned here to a list containing only schemas the function body
-- actually names. Every body below was read first: each is either qualified
-- (public.profiles, auth.uid, public.rate_limit) or uses only pg_catalog
-- builtins, so this cannot change what any of them do.
--
-- apply: supabase db push --project-ref lcrfsqocqavczgnzpadq

alter function public.current_org_id()
  set search_path to 'public', 'pg_catalog';
alter function public.knowledge_search(public.vector, integer, numeric)
  set search_path to 'public', 'pg_catalog';
alter function public.check_rate_limit(text, integer, interval)
  set search_path to 'public', 'pg_catalog';
alter function public.generate_ref(text)
  set search_path to 'public', 'pg_catalog';
alter function public.to_base36(bigint)
  set search_path to 'public', 'pg_catalog';
alter function public.raise_append_only()
  set search_path to 'public', 'pg_catalog';
alter function public.profiles_protect_privileged_columns()
  set search_path to 'public', 'pg_catalog';

-- PUBLIC (and therefore anon) holds EXECUTE on current_org_id() only because
-- functions are granted to PUBLIC by default. An anonymous caller gets NULL
-- from it -- auth.uid() is NULL before authenticating -- so there is no data
-- exposure, but the tenant check should not be part of the unauthenticated API
-- surface at all.
--
-- The explicit grants come first on purpose: revoking from PUBLIC afterwards
-- leaves these two intact, so there is no point in the migration where the
-- policies stop working.
grant execute on function public.current_org_id() to authenticated, service_role;
revoke execute on function public.current_org_id() from public, anon;

-- rls_auto_enable() is also reported as anon-executable and left alone: it is a
-- Supabase-managed event trigger function, Postgres refuses direct calls to
-- event trigger functions, and it already pins its own search_path.


-- ============================================================
-- 0006_subscriptions_billing.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 3: Subscription Billing (Governance OS)
-- Annual SaaS plans with recurring invoices and payment schedules
-- ============================================================

-- ------------------------------------------------------------
-- EXTEND PLANS TABLE with monthly/annual pricing
-- ------------------------------------------------------------
alter table public.plans
  add column if not exists billing_cycle text check (billing_cycle in ('monthly', 'annual', 'oneoff')),
  add column if not exists is_subscription boolean not null default false;

-- Seed Governance OS subscription plans (annual billing)
insert into public.plans (code, name, type, price_monthly, price_annual, price_oneoff, max_members, billing_cycle, is_subscription, features)
values
  ('governance_os_essential', 'Governance OS Essential', 'governance_os', 600, 7200, 0, 300, 'annual', true,
   '["Up to 300 members","Meetings & resolutions","Document vault","Compliance calendar","Basic audit trail","Email support"]'::jsonb),
  ('governance_os_professional', 'Governance OS Professional', 'governance_os', 800, 9600, 0, 1000, 'annual', true,
   '["Up to 1,000 members","All Essential features","AI Compliance agent","Advanced reporting","Priority support","API access"]'::jsonb),
  ('governance_os_enterprise', 'Governance OS Enterprise', 'governance_os', 1000, 12000, 0, 2000, 'annual', true,
   '["Up to 2,000 members","All Professional features","AI Copilot (6 agents)","GP14/GP14B/UUK automation","Dedicated CSM","SSO / SAML","Custom integrations"]'::jsonb),
  ('governance_os_federation', 'Governance OS Federation', 'governance_os', 1250, 15000, 0, 10000, 'annual', true,
   '["10,000+ members across federation","All Enterprise features","Federation roll-up dashboard","Multi-cooperative management","Consolidated billing","Custom SLA"]'::jsonb)
on conflict (code) do update
  set name = excluded.name,
      type = excluded.type,
      price_monthly = excluded.price_monthly,
      price_annual = excluded.price_annual,
      price_oneoff = excluded.price_oneoff,
      max_members = excluded.max_members,
      billing_cycle = excluded.billing_cycle,
      is_subscription = excluded.is_subscription,
      features = excluded.features;

-- ------------------------------------------------------------
-- EXTEND SUBSCRIPTIONS TABLE for recurring billing
-- ------------------------------------------------------------
alter table public.subscriptions
  add column if not exists billing_cycle text check (billing_cycle in ('monthly', 'annual')) not null default 'annual',
  add column if not exists auto_renew boolean not null default true,
  add column if not exists cancelled_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Add unique constraint: one active subscription per organization
create unique index if not exists subscriptions_one_active_per_org
  on public.subscriptions (organization_id)
  where status in ('trialing', 'active', 'past_due');

-- ------------------------------------------------------------
-- RECURRING INVOICES TABLE
-- ------------------------------------------------------------
create table if not exists public.recurring_invoices (
  id                    uuid primary key default gen_random_uuid(),
  subscription_id       uuid not null references public.subscriptions(id) on delete cascade,
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  plan_id               uuid not null references public.plans(id),
  amount                numeric(12,2) not null,
  tax                   numeric(12,2) not null default 0,
  total                 numeric(12,2) not null,
  period_start          date not null,
  period_end            date not null,
  status                text not null default 'scheduled',
  scheduled_for         timestamptz not null,
  generated_at          timestamptz,
  invoice_id            uuid references public.invoices(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_recurring_invoices_sub on public.recurring_invoices(subscription_id);
create index if not exists idx_recurring_invoices_org on public.recurring_invoices(organization_id);
create index if not exists idx_recurring_invoices_due on public.recurring_invoices(scheduled_for) where status = 'scheduled';

alter table public.recurring_invoices enable row level security;

do $$
begin
  execute 'drop policy if exists recurring_inv_org on public.recurring_invoices';
  execute 'create policy recurring_inv_org on public.recurring_invoices for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
end $$;

-- ------------------------------------------------------------
-- PAYMENT SCHEDULES TABLE (tracks upcoming recurring payments)
-- ------------------------------------------------------------
create table if not exists public.payment_schedules (
  id                    uuid primary key default gen_random_uuid(),
  subscription_id       uuid not null references public.subscriptions(id) on delete cascade,
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  recurring_invoice_id  uuid references public.recurring_invoices(id) on delete set null,
  amount                numeric(12,2) not null,
  method                text not null,
  gateway_reference     text,
  scheduled_for         timestamptz not null,
  status                text not null default 'pending',
  processed_at          timestamptz,
  payment_id            uuid references public.payments(id) on delete set null,
  retry_count           int not null default 0,
  last_error            text,
  created_at            timestamptz not null default now()
);

create index if not exists idx_payment_schedules_sub on public.payment_schedules(subscription_id);
create index if not exists idx_payment_schedules_due on public.payment_schedules(scheduled_for) where status = 'pending';

alter table public.payment_schedules enable row level security;

do $$
begin
  execute 'drop policy if exists pay_sched_org on public.payment_schedules';
  execute 'create policy pay_sched_org on public.payment_schedules for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
end $$;

-- ------------------------------------------------------------
-- SUBSCRIPTION WEBHOOK EVENTS TABLE (audit trail for subscription events)
-- ------------------------------------------------------------
create table if not exists public.subscription_events (
  id                    uuid primary key default gen_random_uuid(),
  subscription_id       uuid not null references public.subscriptions(id) on delete cascade,
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  event_type            text not null,
  payload               jsonb not null default '{}'::jsonb,
  processed             boolean not null default false,
  processed_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_sub_events_sub on public.subscription_events(subscription_id);
create index if not exists idx_sub_events_unprocessed on public.subscription_events(processed) where not processed;

alter table public.subscription_events enable row level security;

do $$
begin
  execute 'drop policy if exists sub_events_org on public.subscription_events';
  execute 'create policy sub_events_org on public.subscription_events for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())';
end $$;

-- ------------------------------------------------------------
-- RPC: Create subscription from accepted quote (for Governance OS plans)
-- ------------------------------------------------------------
create or replace function public.create_subscription_from_quote(
  p_quote_id uuid,
  p_organization_id uuid,
  p_start_date date default current_date
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_plan public.plans%rowtype;
  v_sub public.subscriptions%rowtype;
  v_period_end date;
begin
  -- Get quote with plan
  select q.*, p.* into v_quote, v_plan
  from public.quotes q
  join public.plans p on p.id = (select plan_id from public.quote_items where quote_id = q.id limit 1)
  where q.id = p_quote_id and q.organization_id = p_organization_id;

  if not found then
    raise exception 'Quote not found or plan missing';
  end if;

  if not v_plan.is_subscription then
    raise exception 'Plan is not a subscription plan';
  end if;

  if v_quote.status <> 'accepted' then
    raise exception 'Quote must be accepted first';
  end if;

  -- Calculate period end (annual)
  v_period_end := p_start_date + interval '1 year' - interval '1 day';

  -- Create subscription
  insert into public.subscriptions (
    organization_id, plan_id, status, billing_cycle,
    current_period_start, current_period_end, trial_ends_at
  ) values (
    p_organization_id, v_plan.id, 'active', 'annual',
    p_start_date, v_period_end, p_start_date + interval '14 days'
  ) returning * into v_sub;

  -- Create first recurring invoice (immediate)
  insert into public.recurring_invoices (
    subscription_id, organization_id, plan_id,
    amount, tax, total, period_start, period_end,
    status, scheduled_for
  ) values (
    v_sub.id, p_organization_id, v_plan.id,
    v_plan.price_annual,
    round(v_plan.price_annual * 0.08, 2),
    v_plan.price_annual + round(v_plan.price_annual * 0.08, 2),
    p_start_date, v_period_end,
    'scheduled', now()
  );

  -- Log event
  insert into public.subscription_events (subscription_id, organization_id, event_type, payload)
  values (v_sub.id, p_organization_id, 'created', jsonb_build_object('quote_id', p_quote_id, 'plan_code', v_plan.code));

  return v_sub.id;
end;
$$;

revoke execute on function public.create_subscription_from_quote(uuid, uuid, date) from public, anon;
grant execute on function public.create_subscription_from_quote(uuid, uuid, date) to service_role;

-- ------------------------------------------------------------
-- RPC: Process subscription renewal (called by cron/scheduler)
-- ------------------------------------------------------------
create or replace function public.process_subscription_renewal(
  p_subscription_id uuid
)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_new_period_start date;
  v_new_period_end date;
  v_recurring_inv public.recurring_invoices%rowtype;
begin
  -- Lock subscription
  select * into v_sub from public.subscriptions
  where id = p_subscription_id for update;

  if not found then
    return 'not_found';
  end if;

  if v_sub.status not in ('active', 'past_due') then
    return 'not_renewable';
  end if;

  if not v_sub.auto_renew then
    return 'auto_renew_disabled';
  end if;

  -- Get plan
  select * into v_plan from public.plans where id = v_sub.plan_id;
  if not found then
    return 'plan_not_found';
  end if;

  -- Calculate new period
  v_new_period_start := v_sub.current_period_end + interval '1 day';
  v_new_period_end := v_new_period_start + interval '1 year' - interval '1 day';

  -- Create recurring invoice for new period
  insert into public.recurring_invoices (
    subscription_id, organization_id, plan_id,
    amount, tax, total, period_start, period_end,
    status, scheduled_for
  ) values (
    v_sub.id, v_sub.organization_id, v_plan.id,
    v_plan.price_annual,
    round(v_plan.price_annual * 0.08, 2),
    v_plan.price_annual + round(v_plan.price_annual * 0.08, 2),
    v_new_period_start, v_new_period_end,
    'scheduled', now()
  ) returning * into v_recurring_inv;

  -- Update subscription period
  update public.subscriptions
  set current_period_start = v_new_period_start,
      current_period_end = v_new_period_end,
      status = 'active'
  where id = p_subscription_id;

  -- Log event
  insert into public.subscription_events (subscription_id, organization_id, event_type, payload)
  values (v_sub.id, v_sub.organization_id, 'renewed', jsonb_build_object(
    'new_period_start', v_new_period_start,
    'new_period_end', v_new_period_end,
    'recurring_invoice_id', v_recurring_inv.id
  ));

  return 'renewed';
end;
$$;

revoke execute on function public.process_subscription_renewal(uuid) from public, anon;
grant execute on function public.process_subscription_renewal(uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: Cancel subscription
-- ------------------------------------------------------------
create or replace function public.cancel_subscription(
  p_subscription_id uuid,
  p_immediate boolean default false
)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  select * into v_sub from public.subscriptions
  where id = p_subscription_id for update;

  if not found then
    return 'not_found';
  end if;

  if v_sub.status in ('cancelled', 'expired') then
    return 'already_cancelled';
  end if;

  if p_immediate then
    update public.subscriptions
    set status = 'cancelled', cancelled_at = now(), auto_renew = false
    where id = p_subscription_id;

    -- Cancel pending recurring invoices
    update public.recurring_invoices
    set status = 'cancelled'
    where subscription_id = p_subscription_id and status = 'scheduled';

    -- Cancel pending payment schedules
    update public.payment_schedules
    set status = 'cancelled'
    where subscription_id = p_subscription_id and status = 'pending';
  else
    update public.subscriptions
    set auto_renew = false, cancelled_at = now()
    where id = p_subscription_id;
  end if;

  insert into public.subscription_events (subscription_id, organization_id, event_type, payload)
  values (v_sub.id, v_sub.organization_id, 'cancelled', jsonb_build_object('immediate', p_immediate));

  return 'cancelled';
end;
$$;

revoke execute on function public.cancel_subscription(uuid, boolean) from public, anon;
grant execute on function public.cancel_subscription(uuid, boolean) to service_role;

-- ------------------------------------------------------------
-- RPC: Generate invoice from recurring invoice (manual or scheduled)
-- ------------------------------------------------------------
create or replace function public.generate_invoice_from_recurring(
  p_recurring_invoice_id uuid
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ri public.recurring_invoices%rowtype;
  v_inv public.invoices%rowtype;
  v_due_date date;
begin
  select * into v_ri from public.recurring_invoices
  where id = p_recurring_invoice_id for update;

  if not found then
    raise exception 'Recurring invoice not found';
  end if;

  if v_ri.status <> 'scheduled' then
    raise exception 'Recurring invoice not in scheduled state';
  end if;

  v_due_date := v_ri.period_end + interval '14 days';

  insert into public.invoices (
    organization_id, number, status, issued_at, due_at, amount
  ) values (
    v_ri.organization_id,
    public.generate_ref('INV'),
    'unpaid',
    current_date,
    v_due_date,
    v_ri.total
  ) returning * into v_inv;

  update public.recurring_invoices
  set status = 'generated', generated_at = now(), invoice_id = v_inv.id
  where id = p_recurring_invoice_id;

  insert into public.subscription_events (subscription_id, organization_id, event_type, payload)
  select subscription_id, organization_id, 'invoice_generated', jsonb_build_object(
    'recurring_invoice_id', p_recurring_invoice_id,
    'invoice_id', v_inv.id
  ) from public.recurring_invoices where id = p_recurring_invoice_id;

  return v_inv.id;
end;
$$;

revoke execute on function public.generate_invoice_from_recurring(uuid) from public, anon;
grant execute on function public.generate_invoice_from_recurring(uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS
-- ------------------------------------------------------------
grant select, insert, update on public.recurring_invoices to authenticated;
grant select, insert, update on public.payment_schedules to authenticated;
grant select, insert on public.subscription_events to authenticated;
grant all on public.recurring_invoices to service_role;
grant all on public.payment_schedules to service_role;
grant all on public.subscription_events to service_role;


-- ============================================================
-- 0007_governance_rpc.sql
-- ============================================================
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

  v_passed := v_ya > v_tidak;

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
