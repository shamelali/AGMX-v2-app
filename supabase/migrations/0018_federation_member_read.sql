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
