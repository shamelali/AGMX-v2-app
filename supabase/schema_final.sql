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