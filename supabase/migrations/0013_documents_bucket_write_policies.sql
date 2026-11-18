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
