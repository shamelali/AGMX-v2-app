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