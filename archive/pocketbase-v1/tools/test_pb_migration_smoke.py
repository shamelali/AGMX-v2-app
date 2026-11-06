"""Offline smoke test for the tracked PocketBase migration chain.

This intentionally uses the repository's PocketBase binary and a temporary
data directory. It does not require a server, credentials, network, or a
developer's existing pb_data directory.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("POCKETBASE_BIN", ROOT / "bin" / "pocketbase"))
MIGRATIONS = ROOT / "pb_migrations"
DOMAIN_MIGRATION = MIGRATIONS / "1791052983_added_domain_pack_fields.js"


class PocketBaseMigrationSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not BINARY.is_file():
            raise unittest.SkipTest(f"PocketBase binary not found: {BINARY}")
        if not os.access(BINARY, os.X_OK):
            raise unittest.SkipTest(f"PocketBase binary is not executable: {BINARY}")
        cls.tempdir = tempfile.TemporaryDirectory(prefix="agmx-pb-migration-")
        cls.data_dir = Path(cls.tempdir.name)
        result = subprocess.run(
            [str(BINARY), "migrate", "--dir", str(cls.data_dir),
             "--migrationsDir", str(MIGRATIONS)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            cls.tempdir.cleanup()
            raise AssertionError(
                "PocketBase migration chain failed:\n"
                + result.stdout + result.stderr
            )
        cls.output = result.stdout
        cls.database = sqlite3.connect(cls.data_dir / "data.db")

    @classmethod
    def tearDownClass(cls):
        database = getattr(cls, "database", None)
        if database is not None:
            database.close()
        tempdir = getattr(cls, "tempdir", None)
        if tempdir is not None:
            tempdir.cleanup()

    def test_domain_pack_migration_applied(self):
        self.assertIn("Applied 1791052983_added_domain_pack_fields.js", self.output)
        expected = {
            "organizations": {"domainPackId", "domainPackVersion", "entityVariant", "ruleProfileId"},
            "compliance_rules": {"domainPackId", "domainPackVersion", "ruleProfileId"},
            "compliance_checks": {"domainPackId", "domainPackVersion", "ruleProfileId"},
        }
        for collection, names in expected.items():
            with self.subTest(collection=collection):
                row = self.database.execute(
                    "select fields from _collections where name = ?", (collection,)
                ).fetchone()
                self.assertIsNotNone(row, collection)
                fields = {field["name"]: field for field in json.loads(row[0])}
                self.assertTrue(names <= fields.keys())
                # PocketBase 0.40 TextField does not persist defaultValue;
                # defaults therefore belong to the application boundary.
                self.assertTrue(all("defaultValue" not in fields[name] for name in names))

    def test_existing_row_backfill_statements_remain_in_migration(self):
        source = DOMAIN_MIGRATION.read_text()
        for field, value in (
            ("domainPackId", "cooperative"),
            ("domainPackVersion", "1.0"),
            ("entityVariant", "cooperative"),
            ("ruleProfileId", "cooperative.my.v1"),
        ):
            with self.subTest(field=field):
                self.assertIn(
                    f"SET {field} = '{value}' WHERE {field} IS NULL OR {field} = ''",
                    source,
                )


if __name__ == "__main__":
    unittest.main()
