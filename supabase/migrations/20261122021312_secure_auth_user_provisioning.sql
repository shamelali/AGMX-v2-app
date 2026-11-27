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
