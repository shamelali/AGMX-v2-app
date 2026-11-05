-- ============================================================
-- AGMX V2 — Sprint 7: White-Label Co-op Portal
-- Adds branding fields to organizations table:
--   logo_url   — co-op logo image URL (optional)
--   primary_color — co-op primary brand color (default #2563EB)
-- ============================================================

-- ------------------------------------------------------------
-- Add branding columns to organizations
-- ------------------------------------------------------------
alter table public.organizations
  add column if not exists logo_url text,
  add column if not exists primary_color text not null default '#2563EB';

-- ------------------------------------------------------------
-- Comment for documentation
-- ------------------------------------------------------------
comment on column public.organizations.logo_url is 'Cooperative logo image URL for white-label portal';
comment on column public.organizations.primary_color is 'Co-op primary brand color (hex) for white-label portal';
