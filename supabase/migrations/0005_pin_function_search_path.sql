-- Database linter findings 0011 (function_search_path_mutable) and 0028
-- (anon_security_definer_function_executable) on project lcrfsqocqavczgnzpadq.
--
-- current_org_id() is the hinge of tenant isolation: 36 row level security
-- policies compare organization_id against it. It is SECURITY DEFINER, so it
-- runs as its owner rather than as the caller, and it was created without a
-- function-level search_path. A DEFINER function that resolves names through a
-- mutable path can be made to touch a different object than its text shows, so
-- the path is pinned here to a list containing only schemas the function body
-- actually names. Every body below was read first: each is either qualified
-- (public.profiles, auth.uid, public.rate_limit) or uses only pg_catalog
-- builtins, so this cannot change what any of them do.
--
-- apply: supabase db push --project-ref lcrfsqocqavczgnzpadq

alter function public.current_org_id()
  set search_path to 'public', 'pg_catalog';
alter function public.knowledge_search(public.vector, integer, numeric)
  set search_path to 'public', 'pg_catalog';
alter function public.check_rate_limit(text, integer, interval)
  set search_path to 'public', 'pg_catalog';
alter function public.generate_ref(text)
  set search_path to 'public', 'pg_catalog';
alter function public.raise_append_only()
  set search_path to 'public', 'pg_catalog';
alter function public.profiles_protect_privileged_columns()
  set search_path to 'public', 'pg_catalog';

-- PUBLIC (and therefore anon) holds EXECUTE on current_org_id() only because
-- functions are granted to PUBLIC by default. An anonymous caller gets NULL
-- from it -- auth.uid() is NULL before authenticating -- so there is no data
-- exposure, but the tenant check should not be part of the unauthenticated API
-- surface at all.
--
-- The explicit grants come first on purpose: revoking from PUBLIC afterwards
-- leaves these two intact, so there is no point in the migration where the
-- policies stop working.
grant execute on function public.current_org_id() to authenticated, service_role;
revoke execute on function public.current_org_id() from public, anon;

-- rls_auto_enable() is also reported as anon-executable and left alone: it is a
-- Supabase-managed event trigger function, Postgres refuses direct calls to
-- event trigger functions, and it already pins its own search_path.
