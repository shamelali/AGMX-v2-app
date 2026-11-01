-- Supabase's ALTER DEFAULT PRIVILEGES grants anon and authenticated TRUNCATE and
-- REFERENCES on every table created in public. TRUNCATE is not evaluated against
-- row level security, so a role holding it can empty a tenant's table regardless
-- of its policies. PostgREST exposes no TRUNCATE verb today; this closes the gap
-- rather than depending on that.

revoke truncate, references on all tables in schema public from anon, authenticated;
