#!/usr/bin/env python3
"""Read-only proof of the ballot path on the live project.

Node-free port of tools/test_production_ballot_path.mjs, reading the same
live catalog through the Management API.

Supabase branching needs the Pro plan, so the journey cannot be replayed on
a copy of production. What this does instead is prove three things about the
live database without writing a single row:

  1. The repaired bodies are the ones the repository vouches for, read as
     text rather than inferred from a version number — pass 26 hashes them,
     this says what the hash is standing for.
  2. The engine genuinely has no max(boolean), so the text production was
     running was fatal here, not merely untidy. Every ballot in a live AGM
     would have raised, and the quorum guard around it failed open.
  3. cast_vote executes and returns its first guard. plpgsql compiles each
     statement when it reaches it, so a function that dies on an undeclared
     variable never has to reach that line to fail — this reaches it.

The call in (3) is write-free by construction: the function's first statement
is `select * into v_motion from motions where id = p_motion_id`, and a random
uuid matches nothing, so it returns {'error':'Motion not found'} before any
insert. votes and audit_events are counted before and after to prove that,
because audit_events is append-only by trigger and a row written in error
could not be taken back afterwards.

Exit 0 = proven, 1 = contradicted, 2 = the project could not be read.
"""
import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "jchfalaibabmszewemat")
TOKEN_PATH = os.path.expanduser("~/.supabase/access-token")
URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

CENSUS = (
    "select (select count(*) from public.votes) as votes, "
    "(select count(*) from public.audit_events) as audit_events"
)

ASSERTIONS = """
with live as (
  select p.proname as name, p.prosrc as src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('cast_vote', 'log_audit', 'record_resolution')
),
env as (
  select current_setting('server_version_num')::int as vnum,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'auth' and p.proname = 'uid') as auth_uid,
    (select extversion from pg_extension where extname = 'vector') as vector_ver,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pg_catalog' and p.proname = 'max'
        and p.proargtypes::regtype[] @> array['boolean'::regtype]) as max_bool
)
select jsonb_build_object(
  'server_version_num', (select vnum from env),
  'auth_uid_defined',   (select auth_uid > 0 from env),
  'vector_installed',   (select vector_ver is not null from env),
  'engine_lacks_max_of_boolean', (select max_bool = 0 from env),
  'cast_vote_reads_latest_snapshot', (select src ~ 'order by captured_at desc' from live where name = 'cast_vote'),
  -- Match the expression, not the word: the fix left a comment naming max(boolean),
  -- and prose about a defect is not the defect.
  'cast_vote_lacks_defective_guard', (select src ~ 'coalesce\\(max\\(satisfied\\), false\\)' is false from live where name = 'cast_vote'),
  'cast_vote_coalesces_after_into',  (select src ~ 'coalesce\\(v_satisfied, false\\)' from live where name = 'cast_vote'),
  'log_audit_matches_null_org',      (select src ~ 'is not distinct from' from live where name = 'log_audit'),
  'log_audit_seeds_chain_head',      (select src ~ 'repeat\\(''0'', 64\\)' from live where name = 'log_audit'),
  'record_resolution_uses_jsonb_var',(select src ~ 'v_existing jsonb' from live where name = 'record_resolution')
) as report
"""

EXPECTED_TRUE = [
    "auth_uid_defined",
    "vector_installed",
    "engine_lacks_max_of_boolean",
    "cast_vote_reads_latest_snapshot",
    "cast_vote_lacks_defective_guard",
    "cast_vote_coalesces_after_into",
    "log_audit_matches_null_org",
    "log_audit_seeds_chain_head",
    "record_resolution_uses_jsonb_var",
]


def query(sql_text):
    body = json.dumps({"query": sql_text}).encode()
    request = urllib.request.Request(
        URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {open(TOKEN_PATH).read().strip()}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode())


def main():
    try:
        before = query(CENSUS)[0]
        report = query(ASSERTIONS)[0]["report"]
        guard = query(
            "select public.cast_vote(gen_random_uuid(), gen_random_uuid(), 'yea') as r"
        )[0]["r"]
        after = query(CENSUS)[0]
    except (OSError, urllib.error.URLError, KeyError, ValueError, IndexError) as exc:
        print(f"could not read the linked project: {str(exc).splitlines()[0]}")
        return 2

    if isinstance(guard, str):
        try:
            guard = json.loads(guard)
        except json.JSONDecodeError:
            pass

    failures = []
    for key in EXPECTED_TRUE:
        if report.get(key) is not True:
            failures.append(f"{key} is {json.dumps(report.get(key))} on the live project")
    if not isinstance(guard, dict) or guard.get("error") != "Motion not found":
        failures.append(
            f"cast_vote with an unknown motion returned {json.dumps(guard)} "
            "— expected the first guard"
        )
    for table in ("votes", "audit_events"):
        if str(before[table]) != str(after[table]):
            failures.append(
                f"{table} moved from {before[table]} to {after[table]} — the probe wrote to production"
            )

    print(
        f"  live Postgres {report.get('server_version_num')}, "
        f"pgvector {'installed' if report.get('vector_installed') else 'ABSENT'}, "
        f"votes {before['votes']}, audit_events {before['audit_events']} "
        "(unchanged by this probe)"
    )
    for failure in failures:
        print(f"  FAIL    {failure}")
    print(
        f"{len(EXPECTED_TRUE) + 3} assertions about the live ballot path, "
        f"{len(failures)} failure(s): the repaired SQL is what production runs "
        "and cast_vote executes write-free"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
