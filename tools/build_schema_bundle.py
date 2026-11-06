#!/usr/bin/env python3
"""Generate supabase/schema_final.sql from supabase/migrations/*.sql.

The deploy docs (DEPLOY.md, deploy.sh, VERCEL_ENV.md) tell an operator without the
Supabase CLI to paste one SQL file into the dashboard SQL editor. That file was
maintained by hand and drifted: it carried the 8 functions of 0001 + 0002 while
migrations/0003-0007 added 15 more, so every governance and billing RPC answered
PGRST202 on a fresh deploy that followed the documentation.

migrations/ is now the only source of truth. Run `--check` (tools/check.sh does)
to fail when the bundle has not been regenerated.
"""

import re
import sys
import pathlib

MIGRATIONS = pathlib.Path("supabase/migrations")
BUNDLE = pathlib.Path("supabase/schema_final.sql")

GUARD = re.compile(r"drop\s+policy\s+if\s+exists\s+([A-Za-z0-9_]+)\s+on\s+([A-Za-z0-9_.]+)", re.I)
CREATE = re.compile(r"create\s+policy\s+([A-Za-z0-9_]+)\s+on\s+([A-Za-z0-9_.]+)", re.I)


def sources():
    if not MIGRATIONS.is_dir():
        sys.exit(f"error: {MIGRATIONS} not found — run from the repo root")
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        sys.exit(f"error: no .sql files in {MIGRATIONS}")
    return files


def assert_rerun_safe(path: pathlib.Path):
    """Every `create policy` needs a `drop policy if exists` for the same name earlier.

    The bundle header promises re-pasting is safe. Postgres has no
    `CREATE POLICY IF NOT EXISTS`, so an unguarded policy aborts the second paste
    with 42710 — and because a paste runs as one transaction, everything after it,
    including the grants, is rolled back.
    """
    text = path.read_text()
    guarded = {(m.group(1), m.group(2)) for m in GUARD.finditer(text)}
    for m in CREATE.finditer(text):
        if (m.group(1), m.group(2)) not in guarded:
            line = text[: m.start()].count("\n") + 1
            sys.exit(
                f"error: {path}:{line} `create policy {m.group(1)} on {m.group(2)}` "
                "has no earlier `drop policy if exists` — the bundle is not rerun-safe"
            )


def render(files):
    parts = [
        "-- ============================================================",
        "-- AGMX V2 — Production Database Schema (Supabase / PostgreSQL)",
        "-- ============================================================",
        "-- GENERATED FILE — DO NOT EDIT.",
        "-- Source of truth: supabase/migrations/*.sql, concatenated in filename",
        "-- order. Regenerate with:",
        "--     python3 tools/build_schema_bundle.py",
        "-- tools/check.sh runs it with --check and fails if this file is stale.",
        "--",
        "-- Apply either with `supabase db push` (which runs migrations/ itself) or",
        "-- by pasting this whole file into the Supabase dashboard SQL editor. Both",
        "-- are rerun-safe: every statement here is `if not exists`, `or replace`,",
        "-- `drop ... if exists` first, or guarded by an exception handler.",
        "--",
        "-- Sources:",
    ]
    for f in files:
        n = len(f.read_text().splitlines())
        parts.append(f"--   {f.name}  ({n} lines)")
    parts.append("-- ============================================================")

    for f in files:
        body = f.read_text().rstrip("\n")
        parts += [
            "",
            "",
            "-- ============================================================",
            f"-- {f.name}",
            "-- ============================================================",
            body,
        ]
    return "\n".join(parts) + "\n"


def main():
    check = "--check" in sys.argv[1:]
    files = sources()
    for f in files:
        assert_rerun_safe(f)
    want = render(files)

    if check:
        have = BUNDLE.read_text() if BUNDLE.exists() else ""
        if have == want:
            print(f"{BUNDLE} is up to date with {len(files)} migrations")
            return
        print(f"STALE: {BUNDLE} does not match {MIGRATIONS}/*.sql")
        import difflib

        diff = list(difflib.unified_diff(have.splitlines(), want.splitlines(),
                                         "current", "generated", lineterm="", n=1))
        for line in diff[:40]:
            print("  " + line)
        print(f"  ... {max(0, len(diff) - 40)} more diff lines")
        print("  Fix: python3 tools/build_schema_bundle.py")
        sys.exit(1)

    BUNDLE.write_text(want)
    print(f"wrote {BUNDLE}: {len(want.splitlines())} lines from "
          f"{', '.join(f.name for f in files)}")


if __name__ == "__main__":
    main()
