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
--   0001_schema.sql  (845 lines)
--   0002_knowledge.sql  (154 lines)
--   0003_plans_seed.sql  (17 lines)
--   0004_revoke_non_dml_privileges.sql  (7 lines)
--   0005_pin_function_search_path.sql  (43 lines)
--   0006_subscriptions_billing.sql  (413 lines)
--   0007_governance_rpc.sql  (535 lines)
--   0008_governance_bugfixes.sql  (157 lines)
--   0009_audit_all_stages.sql  (25 lines)
--   0010_white_label_branding.sql  (25 lines)
--   0011_knowledge_embedding_halfvec2048.sql  (109 lines)
--   0012_documents_bucket.sql  (64 lines)
--   0013_documents_bucket_write_policies.sql  (83 lines)
--   0014_atomic_settlement.sql  (148 lines)
--   0015_agm_lifecycle.sql  (172 lines)
--   0016_members_electoral_roll.sql  (242 lines)
--   0017_notice_pack_comms.sql  (683 lines)
--   0018_federation_member_read.sql  (17 lines)
--   0019_registration_presence.sql  (196 lines)
--   0020_elections_ballots.sql  (676 lines)
--   0021_nominations_candidates.sql  (261 lines)
--   0022_minutes.sql  (452 lines)
--   0023_evidence_incidents.sql  (336 lines)
--   0024_speaker_queue_questions.sql  (349 lines)
--   20261113083423_auto_provision_user.sql  (50 lines)
--   20261113140833_white_label_storage.sql  (119 lines)
--   20261119151200_restrict_ballot_writes.sql  (6 lines)
--   20261122021312_secure_auth_user_provisioning.sql  (61 lines)
--   20261124184934_public_intake_idempotency.sql  (22 lines)
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
  select $1 || '-' || to_hex(extract(epoch from now())::bigint) || '-' || upper(substring(md5(random()::text) from 1 for 6));
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
-- AGMX V2 — Sprint 3: Subscription Billing (DutaGovern)
-- Annual SaaS plans with recurring invoices and payment schedules
-- ============================================================

-- ------------------------------------------------------------
-- EXTEND PLANS TABLE with monthly/annual pricing
-- ------------------------------------------------------------
alter table public.plans
  add column if not exists billing_cycle text check (billing_cycle in ('monthly', 'annual', 'oneoff')),
  add column if not exists is_subscription boolean not null default false;

-- Seed DutaGovern subscription plans (annual billing)
insert into public.plans (code, name, type, price_monthly, price_annual, price_oneoff, max_members, billing_cycle, is_subscription, features)
values
  ('dutagovern_essential', 'DutaGovern Essential', 'dutagovern', 600, 7200, 0, 300, 'annual', true,
   '["Up to 300 members","Meetings & resolutions","Document vault","Compliance calendar","Basic audit trail","Email support"]'::jsonb),
  ('dutagovern_professional', 'DutaGovern Professional', 'dutagovern', 800, 9600, 0, 1000, 'annual', true,
   '["Up to 1,000 members","All Essential features","AI Compliance agent","Advanced reporting","Priority support","API access"]'::jsonb),
  ('dutagovern_enterprise', 'DutaGovern Enterprise', 'dutagovern', 1000, 12000, 0, 2000, 'annual', true,
   '["Up to 2,000 members","All Professional features","AI Copilot (6 agents)","GP14/GP14B/UUK automation","Dedicated CSM","SSO / SAML","Custom integrations"]'::jsonb),
  ('dutagovern_federation', 'DutaGovern Federation', 'dutagovern', 1250, 15000, 0, 10000, 'annual', true,
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
-- RPC: Create subscription from accepted quote (for DutaGovern plans)
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
  -- Get quote
  select * into v_quote from public.quotes
  where id = p_quote_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Quote not found';
  end if;

  -- Get plan
  select p.* into v_plan from public.plans p
  join public.quote_items qi on qi.quote_id = p_quote_id
  where p.id = qi.plan_id
  limit 1;

  if not found then
    raise exception 'Plan missing';
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
-- AGMX V2 — Sprint 4: DutaGovern (AGM lifecycle RPCs)
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
  /* A SELECT INTO that matches no row leaves the target NULL — the coalesce
     written inside it never runs. `organization_id = p_org` also matches nothing
     when p_org IS NULL, which is how both audit writers record a prospect. So
     the first event of every organization, and every pre-tenant event, hashed
     NULL against a NOT NULL column — and the exception block below swallowed the
     violation. log_audit() therefore wrote nothing at all, permanently: an
     organization's chain could never start, so no later event could ever find a
     head to chain from. Reading the head as a scalar subquery and coalescing
     outside it gives one row every time, and '0'-repeat-64 seeds the chain. */
  select coalesce((select hash from public.audit_events
                    where organization_id is not distinct from p_org
                    order by occurred_at desc limit 1),
                  repeat('0', 64)) into v_prev;

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
  -- The latest snapshot decides. max(boolean) does not exist in Postgres, and
  -- coalesce(...) into a variable is overwritten with NULL when the query finds
  -- no rows, so an AGM with no attendance would have failed open and let anyone
  -- vote. Reading the row and coalescing in the test keeps it closed.
  select satisfied into v_satisfied
    from public.quorum_snapshots
    where agm_id = v_motion.agm_id
    order by captured_at desc
    limit 1;
  if not coalesce(v_satisfied, false) then
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


-- ============================================================
-- 0008_governance_bugfixes.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 4: DutaGovern bug fixes
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
  -- The latest snapshot decides. max(boolean) does not exist in Postgres, and
  -- coalesce(...) into a variable is overwritten with NULL when the query finds
  -- no rows, so an AGM with no attendance would have failed open and let anyone
  -- vote. Reading the row and coalescing in the test keeps it closed.
  select satisfied into v_satisfied
    from public.quorum_snapshots
    where agm_id = v_motion.agm_id
    order by captured_at desc
    limit 1;
  if not coalesce(v_satisfied, false) then
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
  v_existing jsonb;
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


-- ============================================================
-- 0009_audit_all_stages.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 4: keep the audit record of a lead
--
-- audit_events.organization_id was declared NOT NULL, while both writers of
-- audit rows map the pre-organization zero UUID to NULL: log_audit() in SQL,
-- and auditLog() in the money-flow Edge Function, whose comment states the
-- assumption outright. The two disagree, so every event raised before a
-- cooperative had an organization row — assessment.submitted above all — was
-- rejected by the constraint. Nothing surfaced it, because audit failures are
-- caught so they cannot fail the business operation, and the client only
-- console.error's them.
--
-- A lead's assessment and quote are the first records a cooperative makes, and
-- Akta Koperasi 1993 immutability is asserted over this table, so a stage that
-- silently produces no record is the wrong default. Dropping NOT NULL aligns
-- the schema with the code that was always meant to write it.
--
-- Prospect rows stay invisible to every tenant: the RLS policies compare
-- organization_id against current_org_id(), and NULL matches nothing. Only the
-- service-role writers can insert them, which is unchanged.
--
-- apply: supabase db push --project-ref <ref>
-- ============================================================

alter table public.audit_events alter column organization_id drop not null;


-- ============================================================
-- 0010_white_label_branding.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 7: White-Label Co-op Portal
-- Adds branding fields to organizations table:
--   logo_url   — co-op logo image URL (optional)
--   primary_color — co-op primary brand color (default #2563EB)
-- ============================================================
--
-- This was applied to production as version 0010 before any file for it
-- existed here. The DDL below is read back from the live
-- supabase_migrations.schema_migrations row and checked against
-- information_schema.columns, so the generated bundle keeps describing the
-- database the Edge Functions actually talk to rather than a younger one.

-- ------------------------------------------------------------
-- Add branding columns to organizations
-- ------------------------------------------------------------
alter table public.organizations
  add column if not exists logo_url text,
  add column if not exists primary_color text not null default '#2563EB';

-- ------------------------------------------------------------
-- Comment for documentation
-- ------------------------------------------------------------
comment on column public.organizations.logo_url is 'Cooperative logo image URL for white-label portal';
comment on column public.organizations.primary_color is 'Co-op primary brand color (hex) for white-label portal';


-- ============================================================
-- 0011_knowledge_embedding_halfvec2048.sql
-- ============================================================
-- ============================================================
-- 0011 — Knowledge embeddings move to halfvec(2048)
-- ------------------------------------------------------------
-- This version was applied to the linked project before its file
-- existed in this repository, so the migration history named a
-- version no file here could describe. It is reconstructed from the
-- live catalog: knowledge_chunks.embedding is halfvec(2048), the
-- similarity index is HNSW over halfvec_cosine_ops, and
-- knowledge_search() takes an unbounded vector and casts it to the
-- stored halfvec dimension inside the function.
--
-- Why halfvec: a half-precision vector stores two bytes per
-- dimension, so 2048 dimensions fit the space a 1024-dimension
-- float4 vector used to occupy, and the index fits in memory at
-- the member counts a cooperative reaches. The embedding provider
-- returns 2048-dimension vectors, so the previous vector(1024)
-- column could not hold them at all.
--
-- Rerun-safe: every statement is `if exists` / `or replace` / a
-- drop before a create.
-- ============================================================

-- ------------------------------------------------------------
-- The column itself
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_namespace where nspname = 'extensions'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'knowledge_chunks'
      and column_name = 'embedding'
  ) then
    execute 'alter table public.knowledge_chunks '
         || 'alter column embedding type halfvec(2048) '
         || 'using embedding::halfvec(2048)';
  end if;
end $$;

-- ------------------------------------------------------------
-- The index: ivfflat over float4 is replaced by HNSW over
-- half-precision cosine distance
-- ------------------------------------------------------------
drop index if exists public.idx_knowledge_chunks_embedding;
create index if not exists idx_knowledge_chunks_embedding
  on public.knowledge_chunks using hnsw (embedding halfvec_cosine_ops);

-- ------------------------------------------------------------
-- knowledge_search()
-- ------------------------------------------------------------
-- The old signature took vector(1024). It is dropped rather than
-- replaced, because a bounded vector(1024) and an unbounded vector
-- are different argument types: `create or replace` cannot change
-- a function's argument types, and leaving the old signature in
-- place would keep a function that casts 2048-dimension input
-- into 1024 dimensions and silently truncates it.
--
-- The body below is the text the live catalog stores, byte for
-- byte, so the generated bundle hashes the same as production.
-- ------------------------------------------------------------
drop function if exists public.knowledge_search(vector(1024), int, numeric);

create or replace function public.knowledge_search(
  p_query_embedding vector,
  p_limit integer default 10,
  p_threshold numeric default 0.65
)
returns table(
  chunk_id uuid,
  document_id uuid,
  title text,
  content text,
  page integer,
  similarity numeric,
  assertions jsonb
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select
    kc.id as chunk_id,
    kc.document_id,
    kc.title,
    kc.content,
    kc.page,
    1 - (kc.embedding <=> p_query_embedding::halfvec(2048)) as similarity,
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'subject', ka.subject, 'predicate', ka.predicate, 'object', ka.object,
          'quote', ka.quote, 'confidence', ka.confidence
        )
      ), '[]'::jsonb)
      from public.knowledge_assertions ka
      where ka.chunk_id = kc.id
    ) as assertions
  from public.knowledge_chunks kc
  where kc.organization_id = public.current_org_id()
    and kc.embedding is not null
    and 1 - (kc.embedding <=> p_query_embedding::halfvec(2048)) >= p_threshold
  order by kc.embedding <=> p_query_embedding::halfvec(2048)
  limit p_limit;
$function$;

revoke execute on function public.knowledge_search(vector, integer, numeric) from public, anon;
grant execute on function public.knowledge_search(vector, integer, numeric) to authenticated;


-- ============================================================
-- 0012_documents_bucket.sql
-- ============================================================
-- ============================================================
-- 0012 — The private documents bucket
-- ------------------------------------------------------------
-- Knowledge documents (the PDFs and minutes a cooperative files
-- against an AGM) live in a private Supabase Storage bucket. The
-- bucket is private: `public = false` means the object URL is not
-- a capability, every read is a policy decision.
--
-- This version was applied to the linked project before its file
-- existed in this repository. The file here is reconstructed from
-- the live catalog: the bucket that is actually there is private,
-- capped at 50 MB, and accepts PDF, plain text, Markdown, Word 97
-- and Word 2007 documents.
--
-- Object layout: every object is stored under its organisation's
-- folder, <organization_id>/<file>. The read policy below reads the
-- first path segment as a uuid and compares it with the signed-in
-- user's organisation, so one cooperative cannot read another's
-- documents even if it learns an object id.
--
-- The guard is the repository's storage pattern: PGlite, which the
-- bundle replay test uses, has no storage schema, so the block does
-- nothing there instead of aborting the replay.
--
-- Rerun-safe: on conflict do nothing, and every policy is dropped
-- before it is created.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'documents',
      'documents',
      false,
      52428800,                                  -- 50 MB
      ARRAY[
        'application/pdf',
        'text/plain',
        'text/markdown',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ]
    )
    on conflict (id) do nothing;

    -- Read: the object's folder must be the signed-in user's
    -- organisation. A user with no organisation sees nothing.
    drop policy if exists documents_read_own_org on storage.objects;
    create policy documents_read_own_org
    on storage.objects
    for select
    to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1]::uuid in (
        select p.organization_id
        from public.profiles p
        where p.id = auth.uid()
      )
    );
  end if;
end $$;


-- ============================================================
-- 0013_documents_bucket_write_policies.sql
-- ============================================================
-- ============================================================
-- 0013 — Write access to the private documents bucket
-- ------------------------------------------------------------
-- 0012 created the bucket and made it readable by the owning
-- organisation. It could not be written to by anyone but the
-- service role: the knowledge-ingest function reads with the
-- service role, so ingestion worked, but an operator could not
-- upload the document in the first place, and the knowledge store
-- could only ever be filled by hand.
--
-- These three policies close that: an authenticated member of a
-- cooperative may write, replace and remove objects inside that
-- cooperative's own folder and nowhere else. The predicate is the
-- same one the read policy uses, so a tenant boundary is enforced
-- by the database rather than by the client that calls it.
--
-- The object path must start with the organisation id:
-- <organization_id>/<file>. A path that does not parse as a uuid
-- fails the cast and is rejected.
--
-- The guard is the repository's storage pattern: PGlite, which the
-- bundle replay test uses, has no storage schema.
--
-- Rerun-safe: every policy is dropped before it is created.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    -- Upload
    drop policy if exists documents_insert_own_org on storage.objects;
    create policy documents_insert_own_org
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'documents'
      and (storage.foldername(name))[1]::uuid in (
        select p.organization_id
        from public.profiles p
        where p.id = auth.uid()
      )
    );

    -- Replace an existing object in place
    drop policy if exists documents_update_own_org on storage.objects;
    create policy documents_update_own_org
    on storage.objects
    for update
    to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1]::uuid in (
        select p.organization_id
        from public.profiles p
        where p.id = auth.uid()
      )
    )
    with check (
      bucket_id = 'documents'
      and (storage.foldername(name))[1]::uuid in (
        select p.organization_id
        from public.profiles p
        where p.id = auth.uid()
      )
    );

    -- Remove an object
    drop policy if exists documents_delete_own_org on storage.objects;
    create policy documents_delete_own_org
    on storage.objects
    for delete
    to authenticated
    using (
      bucket_id = 'documents'
      and (storage.foldername(name))[1]::uuid in (
        select p.organization_id
        from public.profiles p
        where p.id = auth.uid()
      )
    );
  end if;
end $$;


-- ============================================================
-- 0014_atomic_settlement.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 5: Atomic Payment Settlement
-- Ensures payment, invoice and assessment state transitions
-- occur in a single transaction with idempotency and explicit
-- tenant authorization.
--
-- Why a function and not three Edge Function updates:
-- handlePaymentManualConfirm used to update payments, then
-- invoices, then agm_assessments as three separate statements.
-- A failure between them left a payment marked paid while its
-- invoice stayed unpaid — a state no reconciliation could read.
-- One function makes the three writes all-or-nothing.
--
-- Why the operator's organisation is a parameter and not
-- inferred: the Edge Function connects with the service-role
-- key, which bypasses row-level security and carries no
-- auth.uid(). The caller's organisation is therefore supplied
-- by the Edge Function, which has already resolved it from the
-- signed-in user's profiles row, and is compared here against
-- the payment's own organisation. A settlement that names
-- another cooperative's payment is refused.
-- ============================================================

-- ------------------------------------------------------------
-- RPC: atomic payment settlement (operator-supervised)
-- ------------------------------------------------------------
create or replace function public.atomic_settlement(
  p_payment_id   uuid,
  p_operator_org uuid,
  p_actor        uuid,
  p_paid_at      timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment   public.payments%rowtype;
  v_invoice   public.invoices%rowtype;
  v_org       uuid;
  v_paid_at   timestamptz := coalesce(p_paid_at, now());
  v_assessment_id uuid;
begin
  -- The operator must be identified. A null organisation would match
  -- nothing below, but saying so beats a silent no-op.
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('error', 'Payment not found');
  end if;

  -- Tenant boundary. The payment carries its own organisation; the
  -- caller carries theirs. They must be the same row.
  if v_payment.organization_id is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  v_org := v_payment.organization_id;

  -- Idempotency: a repeated confirmation returns the settled state
  -- instead of writing again, so a retried request cannot double-settle.
  if v_payment.status = 'succeeded' then
    return jsonb_build_object(
      'already_settled', true,
      'payment_id', v_payment.id,
      'status', v_payment.status,
      'paid_at', v_payment.paid_at,
      'invoice_id', v_payment.invoice_id,
      'organization_id', v_org
    );
  end if;

  select * into v_invoice from public.invoices where id = v_payment.invoice_id for update;
  if not found then
    return jsonb_build_object('error', 'Invoice not found for payment');
  end if;

  -- The invoice must belong to the same cooperative as the payment.
  -- A payment row alone is not enough: an operator must not be able to
  -- settle an invoice they do not own by naming its payment.
  if v_invoice.organization_id is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  -- 1. payment
  update public.payments
     set status = 'succeeded', paid_at = v_paid_at
   where id = p_payment_id;

  -- 2. invoice
  update public.invoices
     set status = 'paid', paid_at = v_paid_at
   where id = v_payment.invoice_id;

  -- 3. assessment, reached through the invoice's quote. agm_assessments
  --    has no paid_at column, so only its status moves.
  if v_invoice.quote_id is not null then
    select assessment_id into v_assessment_id
      from public.quotes where id = v_invoice.quote_id;
    if v_assessment_id is not null then
      update public.agm_assessments
         set status = 'paid'
       where id = v_assessment_id;
    end if;
  end if;

  perform public.log_audit(
    v_org,
    p_actor,
    'payment.succeeded',
    'payment',
    p_payment_id::text,
    jsonb_build_object(
      'invoiceId', v_invoice.id,
      'method', v_payment.method,
      'amount', v_payment.amount,
      'reference', v_payment.reference,
      'confirmedBy', 'operator'
    )
  );

  return jsonb_build_object(
    'settled', true,
    'payment_id', p_payment_id,
    'status', 'succeeded',
    'paid_at', v_paid_at,
    'invoice_id', v_invoice.id,
    'organization_id', v_org,
    'amount', v_payment.amount,
    'method', v_payment.method
  );
end;
$$;

/* The Edge Function calls this with the service role after isAdminOrSecretary
   has passed, and the RPC itself only checks the organization — it never
   checks the caller's role. So the role check has to live in the grant, or
   any member of a cooperative could settle their own co-op's payment by
   calling /rest/v1/rpc/atomic_settlement directly with their own
   organization_id, bypassing the handler's operator gate and naming whoever
   they liked as p_actor in the audit trail. Supabase's default privileges
   leave EXECUTE with every login role (see 0004_revoke_non_dml_privileges.sql
   for the same posture on tables), so authenticated must be revoked too —
   public and anon alone leave the hole open. Matches
   20261119151200_restrict_ballot_writes.sql. */
revoke execute on function public.atomic_settlement(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.atomic_settlement(uuid, uuid, uuid, timestamptz) to service_role;


-- ============================================================
-- 0015_agm_lifecycle.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 2: AGM lifecycle (stage machine + audit)
-- ============================================================

-- Status doubles as the 9-stage machine:
--   planned(Draft) → configuring → published → registration_open → ready → live → closed → post_agm → archived
-- 'minuted' is a legacy value kept for meetings created before the stage machine.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'agms_stage_check'
       and conrelid = 'public.agms'::regclass
  ) then
    alter table public.agms add constraint agms_stage_check
      check (status in ('planned','configuring','published','registration_open','ready','live','closed','post_agm','archived','minuted'));
  end if;
end $$;

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


-- ============================================================
-- 0016_members_electoral_roll.sql
-- ============================================================
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

drop policy if exists electoral_rolls_org on public.electoral_rolls;
create policy electoral_rolls_org on public.electoral_rolls for all using (organization_id = public.current_org_id());

drop policy if exists electoral_roll_entries_org on public.electoral_roll_entries;
create policy electoral_roll_entries_org on public.electoral_roll_entries for all using (
  exists (
    select 1 from public.electoral_rolls er
    where er.id = public.electoral_roll_entries.electoral_roll_id
      and er.organization_id = public.current_org_id()
  )
);

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


-- ============================================================
-- 0017_notice_pack_comms.sql
-- ============================================================
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
  p_due_at       timestamptz default null,
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
  v_member   uuid;
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
    'status', case when v_all then 'acknowledged' else 'delivered' end
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
  p_ip            text default null
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
  p_subject         text,
  p_body            text,
  p_type            text default 'notice',
  p_channel         text default 'email',
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


-- ============================================================
-- 0018_federation_member_read.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 5: Partner & Federation roll-up
-- Federation read access for member organisations
-- ============================================================

-- ------------------------------------------------------------
-- Federations: member organisations can read federations they belong to
-- (owner_org_id isolation already covers owners; this adds member read)
-- ------------------------------------------------------------
do $$
begin
  execute 'drop policy if exists feds_member_read on public.federations';
  execute 'create policy feds_member_read on public.federations for select using (
    id in (select federation_id from public.federation_organizations
           where organization_id = public.current_org_id())
  )';
end $$;


-- ============================================================
-- 0019_registration_presence.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 7: Registration + Presence + Quorum
-- Member RSVP per AGM, operator-assisted check-in, append-only
-- presence events. Registration counts feed the readiness gate
-- before Convene (ready -> live).
-- ============================================================

-- ------------------------------------------------------------
-- Registrations: one RSVP per member per AGM
-- ------------------------------------------------------------
create table if not exists public.registrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  status          text not null default 'rsvp',         -- rsvp | attending | not_attending | acknowledged
  channel         text not null default 'portal',        -- portal | notice | sms | email
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (agm_id, member_id)
);

comment on table public.registrations is 'Member registration/RSVP per AGM. One row per member per AGM.';
comment on column public.registrations.status is 'rsvp | attending | not_attending | acknowledged';
comment on column public.registrations.channel is 'How the registration was received: portal | notice | sms | email';

create index if not exists idx_registrations_agm on public.registrations(agm_id);
create index if not exists idx_registrations_member on public.registrations(member_id);

-- ------------------------------------------------------------
-- Presence events: append-only timestamped check-ins
-- ------------------------------------------------------------
create table if not exists public.presence_events (
  id            uuid primary key default gen_random_uuid(),
  agm_id        uuid not null references public.agms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  method        text not null,                         -- kiosk | qr | portal | operator
  channel       text not null,                         -- physical | online
  checked_in_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.presence_events is 'Append-only log of member check-ins per AGM. Never updated or deleted.';
create index if not exists idx_presence_events_agm on public.presence_events(agm_id);
create index if not exists idx_presence_events_member on public.presence_events(member_id);

-- ------------------------------------------------------------
-- RLS on registration tables
-- ------------------------------------------------------------
alter table public.registrations enable row level security;
alter table public.presence_events enable row level security;

drop policy if exists registrations_org on public.registrations;
create policy registrations_org on public.registrations for all using (organization_id = public.current_org_id());

drop policy if exists presence_events_org on public.presence_events;
create policy presence_events_org on public.presence_events for all using (organization_id = public.current_org_id());

-- ------------------------------------------------------------
-- RPC: register_member — register/RSVP a member for an AGM
-- Idempotent: re-registering updates the existing row.
-- ------------------------------------------------------------
create or replace function public.register_member(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_operator_org uuid,
  p_actor        uuid,
  p_status       text default 'rsvp',
  p_channel      text default 'portal'
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

  -- Tenant boundary: AGM and member must belong to the caller's organization
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

  insert into public.registrations
    (organization_id, agm_id, member_id, status, channel, acknowledged_at)
  values
    (p_operator_org, p_agm_id, p_member_id, p_status, p_channel,
     case when p_status = 'acknowledged' then now() else null end)
  on conflict (agm_id, member_id) do update
    set status         = excluded.status,
        channel        = excluded.channel,
        acknowledged_at = case when excluded.status = 'acknowledged' then now()
                               else registrations.acknowledged_at end;

  perform public.log_audit(
    p_operator_org, p_actor, 'member.registered', 'registration', p_agm_id::text,
    jsonb_build_object('member_id', p_member_id, 'status', p_status, 'channel', p_channel)
  );

  return jsonb_build_object(
    'registered', true,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'status', p_status,
    'channel', p_channel
  );
end;
$$;

revoke execute on function public.register_member(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_member(uuid, uuid, uuid, uuid, text, text) to service_role;

-- ------------------------------------------------------------
-- RPC: check_in_member — check a member in at an AGM
-- Self check-in (member checks themselves in) or operator check-in.
-- ------------------------------------------------------------
create or replace function public.check_in_member(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_operator_org uuid,
  p_actor        uuid,
  p_method       text default 'portal',
  p_channel      text default 'physical'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_event uuid;
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

  insert into public.presence_events
    (agm_id, organization_id, member_id, method, channel, checked_in_at)
  values
    (p_agm_id, v_org, p_member_id, p_method, p_channel, now())
  returning id into v_event;

  -- Mark the registration as attending (idempotent on the registration row)
  insert into public.registrations
    (organization_id, agm_id, member_id, status, channel)
  values
    (v_org, p_agm_id, p_member_id, 'attending', p_channel)
  on conflict (agm_id, member_id) do update
    set status  = 'attending',
        channel = coalesce(excluded.channel, registrations.channel);

  perform public.log_audit(
    p_operator_org, p_actor, 'member.checked_in', 'presence', v_event::text,
    jsonb_build_object('agm_id', p_agm_id, 'member_id', p_member_id, 'method', p_method, 'channel', p_channel)
  );

  return jsonb_build_object(
    'checked_in', true,
    'event_id', v_event,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'checked_in_at', now()
  );
end;
$$;

revoke execute on function public.check_in_member(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.check_in_member(uuid, uuid, uuid, uuid, text, text) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read registration tables (RLS scoped)
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.registrations, public.presence_events to authenticated;


-- ============================================================
-- 0020_elections_ballots.sql
-- ============================================================
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


-- ============================================================
-- 0021_nominations_candidates.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 8: Nominations + Candidates
-- Nomination applications reviewed by operators; immutable
-- candidate snapshot taken when the election opens.
-- ============================================================

-- ------------------------------------------------------------
-- Nominations: member applications for election positions
-- ------------------------------------------------------------
create table if not exists public.nominations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  position        text not null,
  statement       text not null default '',
  status          text not null default 'submitted', -- submitted | reviewing | approved | rejected
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_reason   text,
  created_at      timestamptz not null default now()
);

comment on table public.nominations is 'Nomination applications for AGM election positions.';
comment on column public.nominations.status is 'submitted | reviewing | approved | rejected';

create index if not exists idx_nominations_agm on public.nominations(agm_id);
create index if not exists idx_nominations_member on public.nominations(member_id);

-- ------------------------------------------------------------
-- Candidates: immutable snapshot of approved nominations
-- taken when the election opens (unique per AGM + member)
-- ------------------------------------------------------------
create table if not exists public.candidates (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id       uuid not null references public.agms(id) on delete cascade,
  nomination_id uuid not null references public.nominations(id) on delete cascade,
  member_id    uuid not null references public.members(id),
  member_no    text not null,
  name         text not null,
  snapshot_at  timestamptz not null default now(),
  unique (agm_id, member_id)
);

comment on table public.candidates is 'Immutable candidate snapshot taken when an election opens.';

create index if not exists idx_candidates_agm on public.candidates(agm_id);

-- ------------------------------------------------------------
-- RLS on nomination tables
-- ------------------------------------------------------------
alter table public.nominations enable row level security;
alter table public.candidates enable row level security;

drop policy if exists nominations_org on public.nominations;
create policy nominations_org on public.nominations for all using (organization_id = public.current_org_id());

drop policy if exists candidates_org on public.candidates;
create policy candidates_org on public.candidates for all using (organization_id = public.current_org_id());

-- ------------------------------------------------------------
-- RPC: nomination_submit — a member applies for a position
-- ------------------------------------------------------------
create or replace function public.nomination_submit(
  p_agm_id       uuid,
  p_member_id    uuid,
  p_position     text,
  p_statement    text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_nomination uuid;
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

  -- Member must be eligible to stand as a candidate on the current roll
  if not exists (
        select 1 from public.electoral_rolls er
        join public.electoral_roll_entries ere on ere.electoral_roll_id = er.id
        where er.agm_id = p_agm_id
          and er.frozen_at is not null
          and ere.member_id = p_member_id
          and ere.candidate_eligible = true
      ) then
    return jsonb_build_object('error', 'Member not eligible to stand as candidate', 'code', 'NOT_CANDIDATE_ELIGIBLE');
  end if;

  insert into public.nominations
    (organization_id, agm_id, member_id, position, statement, status)
  values
    (p_operator_org, p_agm_id, p_member_id, p_position, coalesce(p_statement, ''), 'submitted')
  returning id into v_nomination;

  perform public.log_audit(
    p_operator_org, p_actor, 'nomination.submitted', 'nomination', v_nomination::text,
    jsonb_build_object('agm_id', p_agm_id, 'member_id', p_member_id, 'position', p_position)
  );

  return jsonb_build_object(
    'nomination_id', v_nomination,
    'agm_id', p_agm_id,
    'member_id', p_member_id,
    'position', p_position,
    'status', 'submitted'
  );
end;
$$;

revoke execute on function public.nomination_submit(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.nomination_submit(uuid, uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: nomination_review — operator approves or rejects a nomination
-- ------------------------------------------------------------
create or replace function public.nomination_review(
  p_nomination_id uuid,
  p_approved      boolean,
  p_reason        text,
  p_operator_org  uuid,
  p_actor         uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_nomination uuid;
  v_status text;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select n.organization_id, n.agm_id, n.id, n.status
  into v_org, v_agm_id, v_nomination, v_status
  from public.nominations n where id = p_nomination_id;

  if not found then
    return jsonb_build_object('error', 'Nomination not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  update public.nominations
     set status = case when p_approved then 'approved' else 'rejected' end,
         reviewed_by = p_actor,
         reviewed_at = now(),
         review_reason = p_reason
   where id = v_nomination;

  perform public.log_audit(
    p_operator_org, p_actor, 'nomination.reviewed', 'nomination', v_nomination::text,
    jsonb_build_object('agm_id', v_agm_id, 'approved', p_approved, 'reason', p_reason)
  );

  return jsonb_build_object(
    'nomination_id', v_nomination,
    'agm_id', v_agm_id,
    'status', case when p_approved then 'approved' else 'rejected' end,
    'reviewed_at', now()
  );
end;
$$;

revoke execute on function public.nomination_review(uuid, boolean, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.nomination_review(uuid, boolean, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: candidates_snapshot — snapshot approved nominations as candidates
-- Called when the election opens. Idempotent: returns existing rows
-- if a snapshot already exists for this AGM.
-- ------------------------------------------------------------
create or replace function public.candidates_snapshot(
  p_agm_id       uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_count int;
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

  -- Idempotent: if a snapshot already exists for this AGM, return it
  select count(*) into v_count from public.candidates where agm_id = p_agm_id;
  if v_count > 0 then
    return jsonb_build_object(
      'snapshot', false,
      'agm_id', p_agm_id,
      'candidates', v_count
    );
  end if;

  insert into public.candidates
    (organization_id, agm_id, nomination_id, member_id, member_no, name, snapshot_at)
  select
    n.organization_id, n.agm_id, n.id, n.member_id,
    m.member_no, m.name, now()
  from public.nominations n
  join public.members m on m.id = n.member_id
  where n.agm_id = p_agm_id
    and n.status = 'approved';

  get diagnostics v_count = row_count;

  perform public.log_audit(
    p_operator_org, p_actor, 'candidates.snapshot', 'candidates', p_agm_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'candidates', v_count)
  );

  return jsonb_build_object(
    'snapshot', true,
    'agm_id', p_agm_id,
    'candidates', v_count
  );
end;
$$;

revoke execute on function public.candidates_snapshot(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.candidates_snapshot(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read nomination tables (RLS scoped)
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.nominations, public.candidates to authenticated;


-- ============================================================
-- 0022_minutes.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — Sprint 12: Minutes (manual Phase 1)
-- Draft -> editorial review -> verification -> approved -> locked.
-- Human verification mandatory before final; locked minutes are
-- append-only (no UPDATE/DELETE).
-- ============================================================

-- ------------------------------------------------------------
-- Minutes: the AGM record, versioned and locked
-- ------------------------------------------------------------
create table if not exists public.minutes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agm_id          uuid not null references public.agms(id) on delete cascade,
  title           text not null default 'Minit Mesyuarat Agung Tahunan',
  status          text not null default 'draft',      -- draft | editorial_review | verification | approved | locked
  drafted_by      uuid,
  drafted_at      timestamptz,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  verified_by     uuid,
  verified_at     timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  locked_at       timestamptz,
  locked_by       uuid,
  content         text not null default '',
  created_at      timestamptz not null default now(),
  unique (agm_id)
);

comment on table public.minutes is 'AGM minutes record with lifecycle: draft -> editorial_review -> verification -> approved -> locked.';
comment on column public.minutes.status is 'draft | editorial_review | verification | approved | locked';
comment on column public.minutes.content is 'Minutes content (plain text, no HTML)';

create index if not exists idx_minutes_agm on public.minutes(agm_id);

-- ------------------------------------------------------------
-- Minute versions: append-only version history
-- ------------------------------------------------------------
create table if not exists public.minute_versions (
  id         uuid primary key default gen_random_uuid(),
  minutes_id uuid not null references public.minutes(id) on delete cascade,
  version    int not null,
  content    text not null default '',
  edited_by  uuid,
  edited_at  timestamptz not null default now()
);

comment on table public.minute_versions is 'Append-only version history of minutes content.';

create index if not exists idx_minute_versions_minutes on public.minute_versions(minutes_id);

-- ------------------------------------------------------------
-- RLS on minutes tables
-- ------------------------------------------------------------
alter table public.minutes enable row level security;
alter table public.minute_versions enable row level security;

drop policy if exists minutes_org on public.minutes;
create policy minutes_org on public.minutes for all using (organization_id = public.current_org_id());

drop policy if exists minute_versions_org on public.minute_versions;
create policy minute_versions_org on public.minute_versions for all using (
  exists (
    select 1 from public.minutes m
    where m.id = public.minute_versions.minutes_id
      and m.organization_id = public.current_org_id()
  )
);

-- ------------------------------------------------------------
-- Trigger: locked minutes are append-only (no UPDATE/DELETE once locked)
-- ------------------------------------------------------------
create or replace function public.minutes_protect_locked()
returns trigger language plpgsql as $$
begin
  if old.locked_at is not null then
    raise exception 'Locked minutes cannot be updated or deleted';
  end if;
  return new;
end $$;

drop trigger if exists minutes_append_only on public.minutes;
create trigger minutes_append_only
  before update or delete on public.minutes
  for each row execute function public.minutes_protect_locked();

drop trigger if exists minute_versions_append_only on public.minute_versions;
create trigger minute_versions_append_only
  before update or delete on public.minute_versions
  for each row execute function public.raise_append_only();

-- ------------------------------------------------------------
-- RPC: minutes_create — create a draft minutes record
-- ------------------------------------------------------------
create or replace function public.minutes_create(
  p_agm_id       uuid,
  p_title        text,
  p_content      text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_id   uuid;
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

  insert into public.minutes
    (organization_id, agm_id, title, status, drafted_by, drafted_at, content, created_at)
  values
    (p_operator_org, p_agm_id, coalesce(p_title, 'Minit Mesyuarat Agung Tahunan'),
     'draft', p_actor, now(), coalesce(p_content, ''), now())
  returning id into v_id;

  insert into public.minute_versions (minutes_id, version, content, edited_by, edited_at)
  values (v_id, 1, coalesce(p_content, ''), p_actor, now());

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.created', 'minutes', v_id::text,
    jsonb_build_object('agm_id', p_agm_id, 'title', coalesce(p_title, 'Minit Mesyuarat Agung Tahunan'), 'status', 'draft')
  );

  return jsonb_build_object(
    'minutes_id', v_id,
    'agm_id', p_agm_id,
    'status', 'draft',
    'version', 1
  );
end;
$$;

revoke execute on function public.minutes_create(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_create(uuid, text, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_edit — draft-only edit; appends a new version
-- ------------------------------------------------------------
create or replace function public.minutes_edit(
  p_minutes_id   uuid,
  p_content      text,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_status text;
  v_version int;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status is distinct from 'draft' then
    return jsonb_build_object('error', 'Only draft minutes can be edited', 'code', 'NOT_DRAFT');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.minute_versions where minutes_id = p_minutes_id;

  insert into public.minute_versions (minutes_id, version, content, edited_by, edited_at)
  values (p_minutes_id, v_version, coalesce(p_content, ''), p_actor, now());

  update public.minutes
     set content = coalesce(p_content, '')
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.edited', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'version', v_version)
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', v_status,
    'version', v_version
  );
end;
$$;

revoke execute on function public.minutes_edit(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_edit(uuid, text, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_submit_review — draft -> editorial_review
-- ------------------------------------------------------------
create or replace function public.minutes_submit_review(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
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

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status is distinct from 'draft' then
    return jsonb_build_object('error', 'Only draft minutes can be submitted for review', 'code', 'NOT_DRAFT');
  end if;

  update public.minutes set status = 'editorial_review' where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.submitted_review', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'editorial_review')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'editorial_review'
  );
end;
$$;

revoke execute on function public.minutes_submit_review(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_submit_review(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_verify — human verification (mandatory before final)
-- editorial_review -> verification, sets verified_by/verified_at
-- ------------------------------------------------------------
create or replace function public.minutes_verify(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
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

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'verification' then
    return jsonb_build_object('verified', false, 'minutes_id', p_minutes_id, 'status', 'verification');
  end if;
  if v_status not in ('editorial_review', 'verification') then
    return jsonb_build_object('error', 'Cannot verify minutes in status ' || v_status, 'code', 'INVALID_TRANSITION');
  end if;

  update public.minutes
     set status = 'verification', verified_by = p_actor, verified_at = now()
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.verified', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'verification')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'verification',
    'verified_by', p_actor,
    'verified_at', now()
  );
end;
$$;

revoke execute on function public.minutes_verify(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_verify(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_approve — verification -> approved
-- Requires human verification (verified_by not null)
-- ------------------------------------------------------------
create or replace function public.minutes_approve(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_agm_id uuid;
  v_status text;
  v_verified_by uuid;
begin
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select m.organization_id, m.agm_id, m.status, m.verified_by
  into v_org, v_agm_id, v_status, v_verified_by
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'approved' then
    return jsonb_build_object('approved', false, 'minutes_id', p_minutes_id, 'status', 'approved');
  end if;
  if v_status is distinct from 'verification' then
    return jsonb_build_object('error', 'Minutes must be in verification before approval', 'code', 'INVALID_TRANSITION');
  end if;
  if v_verified_by is null then
    return jsonb_build_object('error', 'Human verification required before approval', 'code', 'NOT_VERIFIED');
  end if;

  update public.minutes
     set status = 'approved', approved_by = p_actor, approved_at = now()
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.approved', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'approved')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'approved',
    'approved_by', p_actor,
    'approved_at', now()
  );
end;
$$;

revoke execute on function public.minutes_approve(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_approve(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- RPC: minutes_lock — approved -> locked (append-only thereafter)
-- ------------------------------------------------------------
create or replace function public.minutes_lock(
  p_minutes_id   uuid,
  p_operator_org uuid,
  p_actor        uuid
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

  select m.organization_id, m.agm_id, m.status
  into v_org, v_agm_id, v_status
  from public.minutes m where id = p_minutes_id;

  if not found then
    return jsonb_build_object('error', 'Minutes not found');
  end if;
  if v_org is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;
  if v_status = 'locked' then
    return jsonb_build_object('locked', false, 'minutes_id', p_minutes_id, 'status', 'locked');
  end if;
  if v_status is distinct from 'approved' then
    return jsonb_build_object('error', 'Minutes must be approved before locking', 'code', 'INVALID_TRANSITION');
  end if;

  update public.minutes
     set status = 'locked', locked_at = now(), locked_by = p_actor
   where id = p_minutes_id;

  perform public.log_audit(
    p_operator_org, p_actor, 'minutes.locked', 'minutes', p_minutes_id::text,
    jsonb_build_object('agm_id', v_agm_id, 'from', v_status, 'to', 'locked')
  );

  return jsonb_build_object(
    'minutes_id', p_minutes_id,
    'agm_id', v_agm_id,
    'status', 'locked',
    'locked_by', p_actor,
    'locked_at', now()
  );
end;
$$;

revoke execute on function public.minutes_lock(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.minutes_lock(uuid, uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- GRANTS: authenticated users can read minutes tables (RLS scoped)
-- Mutations go through the security-definer RPCs above.
-- ------------------------------------------------------------
grant select on public.minutes, public.minute_versions to authenticated;


-- ============================================================
-- 0023_evidence_incidents.sql
-- ============================================================
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


-- ============================================================
-- 0024_speaker_queue_questions.sql
-- ============================================================
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


-- ============================================================
-- 20261113083423_auto_provision_user.sql
-- ============================================================
-- Auto-provision organization + profile when a new user signs up.
-- Without this, auth.users rows have no matching profiles row, so
-- AGMX_API.loadDashboard() fails with "Profile not found" and the
-- landing page never loads after sign-in.
--
-- The body below is the text the linked project runs, byte for byte:
-- the version that shipped from a branch which never landed in this
-- repository also creates the profiles row, and the file that was
-- here did not, so the repository described a trigger production
-- never ran.
--
-- Rerun-safe: every statement is create or replace / insert ... on conflict
-- / drop trigger if exists.

create or replace function public.auto_provision_user_on_signup()
returns trigger language plpgsql as $function$
declare
  v_org_id uuid;
  v_email_prefix text;
begin
  v_email_prefix := lower(split_part(new.email, '@', 1));

  -- Create a default organization for the new user
  insert into public.organizations (slug, name, type, plan, status, settings)
  values (v_email_prefix || '-' || substr(gen_random_uuid()::text, 1, 8),
          v_email_prefix || 's Organization',
          'cooperative',
          'starter',
          'active',
          '{}'::jsonb)
  returning id into v_org_id;

  -- Create the profile linked to the auth user
  insert into public.profiles (id, organization_id, full_name, role, phone, language, senior_mode, theme, created_at)
  values (new.id, v_org_id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          'member', new.raw_user_meta_data->>'phone', 'BM', false, 'default', now());

  -- Create the organization_members link (admin role)
  insert into public.organization_members (organization_id, user_id, member_id, role, permissions)
  values (v_org_id, new.id, null, 'admin', '{}'::text[])
  on conflict (organization_id, user_id) do nothing;

  return new;
end
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.auto_provision_user_on_signup();


-- ============================================================
-- 20261113140833_white_label_storage.sql
-- ============================================================
-- ============================================================
-- AGMX V2 — White-Label Storage Bucket
-- Creates a Supabase Storage bucket for co-op logo uploads
-- and RLS policies so only org admins can manage logos.
-- ============================================================

-- ------------------------------------------------------------
-- Storage bucket: co-op logos
-- Only applies when the storage extension is present (PGlite
-- does not ship storage, so guard with a DO block).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'coop-logos',
      'coop-logos',
      true,
      5242880,                                    -- 5 MB
      ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
    )
    on conflict (id) do nothing;

    -- Storage RLS policies (rerun-safe: drop + create)
    -- Admins can upload logos to their own organization's folder
    -- Path is <org-id>/logo.<ext>; policy checks the uploader's
    -- organization_id from public.profiles, not the raw user id.
    drop policy if exists coop_logos_admin_insert on storage.objects;
    create policy coop_logos_admin_insert
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'coop-logos'
      and split_part(name, '/', 1) = (
        select organization_id from public.profiles where id = auth.uid() limit 1
      )
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'admin'
      )
    );

    -- Admins can update/delete their own organization's logos
    drop policy if exists coop_logos_admin_update on storage.objects;
    create policy coop_logos_admin_update
    on storage.objects
    for update
    to authenticated
    using (
      bucket_id = 'coop-logos'
      and split_part(name, '/', 1) = (
        select organization_id from public.profiles where id = auth.uid() limit 1
      )
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'admin'
      )
    );

    drop policy if exists coop_logos_admin_delete on storage.objects;
    create policy coop_logos_admin_delete
    on storage.objects
    for delete
    to authenticated
    using (
      bucket_id = 'coop-logos'
      and split_part(name, '/', 1) = (
        select organization_id from public.profiles where id = auth.uid() limit 1
      )
      and exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role = 'admin'
      )
    );

    -- Anyone can read logos (public bucket)
    drop policy if exists coop_logos_public_select on storage.objects;
    create policy coop_logos_public_select
    on storage.objects
    for select
    to public
    using (bucket_id = 'coop-logos');
  end if;
end $$;

-- ------------------------------------------------------------
-- Organizations RLS: admins can update branding columns
-- ------------------------------------------------------------
drop policy if exists orgs_update_branding_admin on public.organizations;
create policy orgs_update_branding_admin
on public.organizations
for update
to authenticated
using (
  id = public.current_org_id()
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
)
with check (
  id = public.current_org_id()
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

-- ------------------------------------------------------------
-- Helper: upload path is <user-id>/logo.<ext>
-- ------------------------------------------------------------
-- Comment: coop-logos bucket stores co-op branding logos at <org-id>/logo.<ext>


-- ============================================================
-- 20261119151200_restrict_ballot_writes.sql
-- ============================================================
-- Ballots must pass through the governance Edge Function, which resolves the
-- voter from the session before invoking cast_vote with the service role.
drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes as restrictive for insert with check (false);
revoke insert on table public.votes from public, anon, authenticated;
revoke execute on function public.cast_vote(uuid, uuid, text) from public, anon, authenticated;


-- ============================================================
-- 20261122021312_secure_auth_user_provisioning.sql
-- ============================================================
-- The auth service inserts auth.users as supabase_auth_admin. The original
-- trigger function ran as that caller, which cannot insert into the tenant
-- tables, so OAuth signup rolled back with SQLSTATE 42501.
--
-- This function must be SECURITY DEFINER because it provisions records before
-- the new user has a session. Keep every object schema-qualified, pin the
-- search path, and revoke direct execution so the trigger is its only entry
-- point.

create or replace function public.auto_provision_user_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
  v_email_prefix text;
begin
  v_email_prefix := lower(split_part(new.email, '@', 1));

  insert into public.organizations (slug, name, type, plan, status, settings)
  values (
    v_email_prefix || '-' || substr(gen_random_uuid()::text, 1, 8),
    v_email_prefix || 's Organization',
    'cooperative',
    'starter',
    'active',
    '{}'::jsonb
  )
  returning id into v_org_id;

  insert into public.profiles (
    id, organization_id, full_name, role, phone, language,
    senior_mode, theme, created_at
  )
  values (
    new.id,
    v_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'member',
    new.raw_user_meta_data->>'phone',
    'BM',
    false,
    'default',
    now()
  );

  insert into public.organization_members (
    organization_id, user_id, member_id, role, permissions
  )
  values (v_org_id, new.id, null, 'admin', '{}'::text[])
  on conflict (organization_id, user_id) do nothing;

  return new;
end
$function$;

revoke all on function public.auto_provision_user_on_signup() from public;
revoke all on function public.auto_provision_user_on_signup() from anon;
revoke all on function public.auto_provision_user_on_signup() from authenticated;


-- ============================================================
-- 20261124184934_public_intake_idempotency.sql
-- ============================================================
alter table public.agm_assessments
  add column if not exists submission_id uuid,
  add column if not exists submission_hash text;

create unique index if not exists agm_assessments_submission_id_unique
  on public.agm_assessments (submission_id)
  where submission_id is not null;

alter table public.agm_assessments
  drop constraint if exists agm_assessments_submission_hash_format;

alter table public.agm_assessments
  add constraint agm_assessments_submission_hash_format
  check (submission_hash is null or submission_hash ~ '^[a-f0-9]{64}$');

drop policy if exists assessments_lead_insert on public.agm_assessments;
drop policy if exists assessments_update on public.agm_assessments;

revoke insert, update, delete on public.agm_assessments from anon, authenticated;

revoke all on function public.check_rate_limit(text, integer, interval) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, interval) to service_role;
