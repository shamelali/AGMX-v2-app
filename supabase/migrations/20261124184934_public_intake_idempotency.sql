alter table public.agm_assessments
  add column if not exists submission_id uuid,
  add column if not exists submission_hash text;

create unique index if not exists agm_assessments_submission_id_unique
  on public.agm_assessments (submission_id)
  where submission_id is not null;

alter table public.agm_assessments
  drop constraint if exists agm_assessments_submission_hash_format;

alter table public.agm_assessments
  add constraint agm_assessments_submission_hash_format
  check (submission_hash is null or submission_hash ~ '^[a-f0-9]{64}$');

drop policy if exists assessments_lead_insert on public.agm_assessments;
drop policy if exists assessments_update on public.agm_assessments;

revoke insert, update, delete on public.agm_assessments from anon, authenticated;

revoke all on function public.check_rate_limit(text, integer, interval) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, interval) to service_role;
