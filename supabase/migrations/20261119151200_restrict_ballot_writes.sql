-- Ballots must pass through the governance Edge Function, which resolves the
-- voter from the session before invoking cast_vote with the service role.
drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes as restrictive for insert with check (false);
revoke insert on table public.votes from public, anon, authenticated;
revoke execute on function public.cast_vote(uuid, uuid, text) from public, anon, authenticated;
