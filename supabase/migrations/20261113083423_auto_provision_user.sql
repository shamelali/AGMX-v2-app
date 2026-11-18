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
