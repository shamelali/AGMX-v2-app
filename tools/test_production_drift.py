#!/usr/bin/env python3
"""Does the linked Supabase project still run the SQL in this repository?

Node-free port of tools/test_production_drift.mjs. The .mjs version shells
out to `supabase db query --linked`, which needs a database password this
sandbox does not have; the Management API accepts the same access token the
CLI already stores, so the same comparison can be made from the API.

Why the comparison exists: `supabase db push` compares *version numbers*, not
content. It records that a version ran and then skips that file forever, so
editing a migration after its first apply is invisible — the CLI reports it
applied while the database keeps the older text.

Run:  python3 tools/test_production_drift.py
      python3 tools/test_production_drift.py --bundle=path/to/other.sql
Exits 1 on drift, 2 when the project could not be read at all.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

CREATE_RE = re.compile(
    r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)",
    re.I,
)
DOLLAR_RE = re.compile(r"\$([A-Za-z_0-9]*)\$")
PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "jchfalaibabmszewemat")
TOKEN_PATH = os.path.expanduser("~/.supabase/access-token")


def md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def bundle_functions(sql):
    """Map function name -> dollar-quoted body. Last definition wins,
    mirroring what `create or replace` leaves in the catalog."""
    bodies = {}
    at = 0
    while at < len(sql):
        match = CREATE_RE.search(sql, at)
        if not match:
            break
        name = match.group(1)
        header_end = match.end()
        opener = DOLLAR_RE.search(sql, header_end)
        if not opener:
            at = header_end
            continue
        start = opener.end()
        close_tag = opener.group(0)
        end = sql.find(close_tag, start)
        if end == -1:
            break
        bodies[name] = sql[start:end]
        at = end + len(close_tag)
    return bodies


def query(sql_text):
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    body = json.dumps({"query": sql_text}).encode()
    request = urllib.request.Request(
        url,
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", default="supabase/schema_final.sql")
    args = parser.parse_args()

    with open(args.bundle, encoding="utf-8") as handle:
        bodies = bundle_functions(handle.read())
    if len(bodies) < 20:
        print(
            f"only parsed {len(bodies)} function definitions from {args.bundle} "
            "— the extractor is broken, not the database"
        )
        return 1

    try:
        rows = query(
            "select p.proname as name, md5(p.prosrc) as hash "
            "from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
            "where n.nspname = 'public'"
        )
        recorded = [
            row["version"]
            for row in query(
                "select version from supabase_migrations.schema_migrations order by version"
            )
        ]
    except (OSError, urllib.error.URLError, KeyError, ValueError) as exc:
        print(f"could not read the linked project: {str(exc).splitlines()[0]}")
        return 2

    live = {}
    for row in rows:
        live.setdefault(row["name"], set()).add(row["hash"])

    migrations_dir = os.path.join("supabase", "migrations")
    # The version is the filename up to its first underscore:
    # "20261113140833_white_label_storage.sql" is version 20261113140833.
    # Truncating to four characters turned every timestamped migration into a
    # version the project had "applied with no file", which is how two real
    # migrations were reported missing while both were on disk.
    local_files = {
        name.split("_")[0]
        for name in os.listdir(migrations_dir)
        if name.endswith(".sql")
    }

    bad = []
    notes = []
    for name, body in sorted(bodies.items()):
        hashes = live.get(name)
        if not hashes:
            bad.append(f"{name} is defined by {args.bundle} and does not exist in the project")
            continue
        if md5(body) not in hashes:
            bad.append(f"{name} does not match the bundle (production md5 {', '.join(sorted(hashes))})")
    for version in recorded:
        if version not in local_files:
            bad.append(f"version {version} is applied to the project with no file in supabase/migrations/")
    for version in sorted(local_files):
        if version not in recorded:
            notes.append(
                f"version {version} exists locally but is not recorded on the project "
                "(a pending db push, or applied as SQL without recording it)"
            )

    for item in bad:
        print(f"  DRIFT   {item}")
    for item in notes:
        print(f"  note    {item}")
    print(
        f"{len(bodies)} bundle-defined functions compared by body hash against the linked project, "
        f"{len(recorded)} recorded migration versions compared to {len(local_files)} files: "
        f"{len(bad)} drift(s), {len(notes)} note(s)"
    )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
