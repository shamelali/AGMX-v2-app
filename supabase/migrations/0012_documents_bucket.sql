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
