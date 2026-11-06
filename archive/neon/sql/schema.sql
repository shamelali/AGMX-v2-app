-- AGMX Neon foundation
--
-- Neon is the server-side transactional store. Authentication and tenant
-- authorization are enforced in Vercel functions during the PocketBase ->
-- Neon migration; the browser never receives DATABASE_URL.
--
-- Run this file against a Neon database before enabling DATABASE_URL.

create extension if not exists pgcrypto;

create table if not exists organizations (
  id              text primary key,
  slug            text not null unique,
  name            text not null,
  registration_no text,
  state           text,
  plan            text not null default 'starter',
  status          text not null default 'active',
  domain_pack_id  text not null default 'cooperative',
  domain_pack_version text not null default '1.0',
  entity_variant   text not null default 'cooperative',
  rule_profile_id  text not null default 'cooperative.my.v1',
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status in ('active', 'trial', 'suspended'))
);

create table if not exists app_users (
  id                 text primary key,
  organization_id    text references organizations(id) on delete set null,
  email              text unique,
  name               text not null,
  role               text not null default 'member',
  external_auth      text,
  created_at         timestamptz not null default now(),
  check (role in ('admin', 'secretary', 'chairman', 'treasurer', 'board', 'member'))
);

create table if not exists agm_assessments (
  id                    text primary key default ('assess_' || replace(gen_random_uuid()::text, '-', '')),
  organization_id       text references organizations(id) on delete set null,
  coop_name             text not null,
  coop_reg              text,
  state                 text,
  members               integer not null check (members >= 1),
  agm_date              date,
  mode                  text not null check (mode in ('physical', 'online', 'hybrid')),
  expected_attendance   integer check (expected_attendance is null or expected_attendance >= 0),
  candidates            integer not null default 0 check (candidates >= 0),
  motions               integer not null default 0 check (motions >= 0),
  current_process       text not null default 'manual',
  needs_managed         boolean not null default false,
  contact_name          text not null,
  contact_phone         text not null,
  contact_email         text,
  complexity_score      integer not null check (complexity_score between 0 and 100),
  recommended_package   text,
  status                text not null default 'lead',
  answers               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create table if not exists quotes (
  id              text primary key default ('quote_' || replace(gen_random_uuid()::text, '-', '')),
  organization_id text references organizations(id) on delete cascade,
  assessment_id   text not null references agm_assessments(id) on delete restrict,
  number          text not null unique,
  status          text not null default 'draft',
  valid_until     date,
  subtotal        numeric(12, 2) not null check (subtotal >= 0),
  tax             numeric(12, 2) not null default 0 check (tax >= 0),
  total           numeric(12, 2) not null check (total >= 0),
  items           jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists invoices (
  id              text primary key default ('inv_' || replace(gen_random_uuid()::text, '-', '')),
  organization_id text references organizations(id) on delete cascade,
  quote_id        text references quotes(id) on delete set null,
  number          text not null unique,
  status          text not null default 'unpaid',
  issued_at       timestamptz not null default now(),
  due_at          timestamptz,
  amount          numeric(12, 2) not null check (amount > 0),
  paid_at         timestamptz
);

create table if not exists payments (
  id              text primary key default ('pay_' || replace(gen_random_uuid()::text, '-', '')),
  organization_id text references organizations(id) on delete cascade,
  invoice_id      text not null references invoices(id) on delete cascade,
  method          text not null,
  reference       text,
  gateway_ref     text,
  amount          numeric(12, 2) not null check (amount > 0),
  status          text not null default 'pending',
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_organizations_domain_pack
  on organizations (domain_pack_id, domain_pack_version, rule_profile_id);
create index if not exists idx_app_users_org on app_users (organization_id);
create index if not exists idx_assessments_status_created on agm_assessments (status, created_at desc);
create index if not exists idx_quotes_org_status on quotes (organization_id, status);
create index if not exists idx_invoices_org_status on invoices (organization_id, status);
create index if not exists idx_payments_invoice_status on payments (invoice_id, status);
create unique index if not exists idx_payments_gateway_ref
  on payments (gateway_ref) where gateway_ref is not null;
