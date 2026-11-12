-- ============================================================
-- AGMX Auth Hook: Send Email
-- ============================================================
-- Intercepts all Supabase Auth emails (signup confirmations,
-- password resets, magic links, email changes).
--
-- Current behaviour: returns the event unchanged, so emails flow
-- through Supabase's default provider (2 emails/hour limit on
-- the free tier).
--
-- To route through a custom SMTP provider (SendGrid, AWS SES,
-- Resend, Mailgun, ...), replace this Postgres function with an
-- HTTP Edge Function hook instead — Postgres functions cannot make
-- outbound HTTP calls, which an SMTP API requires.
--
-- Configure in supabase/config.toml:
--   [auth.hook.send_email]
--   enabled = true
--   uri = "pg-functions://postgres/public/send_email_hook"
--
-- Deploy with: supabase migration new (versioned) then
--              supabase db push --project-ref jchfalaibabmszewemt
-- ============================================================

create or replace function public.send_email_hook(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  recipient text;
  subject text;
begin
  -- Extract fields from the hook event for logging / inspection.
  -- The event JSON contains keys such as:
  --   email (recipient), subject, body (HTML), instance_id, event_id
  recipient := coalesce(event->>'email', '');
  subject   := coalesce(event->>'subject', '');

  -- Scaffold: return the event unchanged so the email is sent
  -- by Supabase's default provider. No outbound SMTP call here.
  return event;

exception
  when others then
    -- On any error, return the event unchanged so the email still
    -- goes out rather than blocking the user's signup / reset flow.
    return event;
end;
$$;

-- Grant Supabase Auth permission to execute the hook.
-- Wrapped in exception handlers because supabase_auth_admin does not
-- exist in embedded test Postgres (used by pass 24); it exists in
-- real Supabase projects.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.send_email_hook(jsonb) to supabase_auth_admin;
    grant usage on schema public to supabase_auth_admin;
    revoke execute on function public.send_email_hook(jsonb) from authenticated, anon, public;
  end if;
end $$;

comment on function public.send_email_hook(jsonb) is
  'AGMX Send Email Auth Hook — scaffolds auth email interception. Route through custom SMTP via HTTP Edge Function hook instead.';