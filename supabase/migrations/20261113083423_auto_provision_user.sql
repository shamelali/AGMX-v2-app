-- Auto-provision organization + profile when a new user signs up.
-- Without this, auth.users rows have no matching profiles row, so
-- AGMX_API.loadDashboard() fails with "Profile not found" and the
-- landing page never loads after sign-in.
--
-- Rerun-safe: every statement is create or replace / insert ... on conflict
-- / drop trigger if exists.

create or replace function public.auto_provision_user_on_signup()
returns trigger language plpgsql as $$
declare
  v_org_id uuid;
  v_email_prefix text;
begin
  v_email_prefix := coalesce(lower(split_part(new.email, '@', 1)), 'u' || substr(new.id::text, 1, 8));

  -- Create a default organization for the new user
  insert into public.organizations (slug, name, type, plan, status, settings)
  values (v_email_prefix || '-' || substr(gen_random_uuid()::text, 1, 8),
          coalesce(split_part(new.email, '@', 1), 'User ' || substr(new.id::text, 1, 8)) || 's Organization',
          'cooperative',
          'starter',
          'active',
          '{}'::jsonb)
  returning id into v_org_id;

  -- Link the user to the organization as a member (profile is created separately)
  insert into public.organization_members (organization_id, user_id, member_id, role, permissions)
  values (v_org_id, new.id, null, 'admin', '{}'::text[])
  on conflict (organization_id, user_id) do nothing;

  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.auto_provision_user_on_signup();
