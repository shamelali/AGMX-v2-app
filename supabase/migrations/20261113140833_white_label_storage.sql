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
    drop policy if exists coop_logos_admin_insert on storage.objects;
    create policy coop_logos_admin_insert
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'coop-logos'
      and split_part(name, '/', 1) = auth.uid()::text
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
      and split_part(name, '/', 1) = auth.uid()::text
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
      and split_part(name, '/', 1) = auth.uid()::text
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
-- Comment: coop-logos bucket stores co-op branding logos at <user-id>/logo.<ext>
