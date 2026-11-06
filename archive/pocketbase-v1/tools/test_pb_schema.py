"""Credential-free regressions for PocketBase rules and vote indexes."""
import contextlib
import copy
import io
import json
import pathlib
import re
import sqlite3
import tempfile
import unittest
from unittest import mock

import harden_rules
import pb_migrate


DOMAIN_PACK_MIGRATION = (pb_migrate.ROOT / "pb_migrations" /
                         "1791052983_added_domain_pack_fields.js")
COLLECTION_SHELLS_MIGRATION = (pb_migrate.ROOT / "pb_migrations" /
                               "1791052980_created_collection_shells.js")
DOMAIN_PACK_COLLECTIONS = {
    "organizations",
    "compliance_rules",
    "compliance_checks",
}
DOMAIN_PACK_FIELD_NAMES = {
    "domainPackId",
    "domainPackVersion",
    "entityVariant",
    "ruleProfileId",
}
DOMAIN_PACK_FIELD_KEYS = ("name", "type", "max", "required", "defaultValue")


def _domain_pack_fields_from_migration():
    """Read the added fields from the migration without executing PocketBase."""
    source = DOMAIN_PACK_MIGRATION.read_text()
    shell_source = COLLECTION_SHELLS_MIGRATION.read_text()
    collection_names = dict(re.findall(
        r'\["(pbc_[^"]+)",\s*"([^"]+)"\]', shell_source
    ))
    declarations = list(re.finditer(
        r'const\s+\w+\s*=\s*app\.findCollectionByNameOrId\("([^"]+)"\)',
        source,
    ))
    fields = {}
    for match in re.finditer(r"new (?:Field|TextField)\(\s*(\{[^{}]*\})\s*\)", source):
        declaration = next(
            (item for item in reversed(declarations) if item.start() < match.start()),
            None,
        )
        if declaration is None:
            raise AssertionError("domain-pack field has no collection declaration")
        collection = collection_names.get(declaration.group(1))
        if collection is None:
            raise AssertionError(
                f"domain-pack migration references unknown collection id "
                f"{declaration.group(1)}"
            )
        field = json.loads(match.group(1))
        fields.setdefault(collection, []).append(field)
    return fields


def _field_signature(field):
    return {
        key: field.get(key, False) if key == "required" else field.get(key)
        for key in DOMAIN_PACK_FIELD_KEYS
    }


class PocketBaseSchemaTests(unittest.TestCase):
    def setUp(self):
        self.collections = json.loads(pb_migrate.COLLECTIONS_FILE.read_text())
        self.by_name = {c["name"]: c for c in self.collections}
        self.seed = json.loads((pb_migrate.COLLECTIONS_FILE.parent / "seed.json").read_text())

    def test_repository_schema_validates(self):
        self.assertEqual(pb_migrate.validate(self.collections), [])

    def test_append_only_requires_explicit_null(self):
        for name in ("votes", "audit_events"):
            for key in ("updateRule", "deleteRule"):
                for value in ("", harden_rules.TENANT, "missing"):
                    with self.subTest(name=name, key=key, value=value):
                        cols = copy.deepcopy(self.collections)
                        col = next(c for c in cols if c["name"] == name)
                        if value == "missing":
                            del col[key]
                        else:
                            col[key] = value
                        self.assertTrue(any(
                            f"{name}.{key} must be null" in problem
                            for problem in pb_migrate.validate(cols)
                        ))

    def test_candidate_index_requires_partial_uniqueness(self):
        votes = self.by_name["votes"]
        for replacement in (
            None,
            pb_migrate.CANDIDATE_VOTER_INDEX.split(" WHERE ")[0],
            pb_migrate.CANDIDATE_VOTER_INDEX.replace("UNIQUE ", ""),
            pb_migrate.CANDIDATE_VOTER_INDEX.replace("!=", "="),
        ):
            with self.subTest(index=replacement):
                votes["indexes"] = [i for i in votes["indexes"]
                                    if "idx_votes_candidate_voter" not in i]
                if replacement is not None:
                    votes["indexes"].append(replacement)
                self.assertTrue(any(
                    "unique candidate/voter index" in problem
                    for problem in pb_migrate.validate(self.collections)
                ))

    def test_vote_index_behaviour(self):
        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE votes (motionId TEXT NOT NULL, "
                       "voterId TEXT NOT NULL, candidateId TEXT NOT NULL DEFAULT '', "
                       "agmId TEXT, choice TEXT)")
            for index in self.by_name["votes"]["indexes"]:
                db.execute(index)

            def cast(motion, voter, candidate=""):
                db.execute("INSERT INTO votes (motionId, voterId, candidateId) "
                           "VALUES (?, ?, ?)", (motion, voter, candidate))

            # A voter can vote on multiple motions without a candidate.
            cast("motion-a", "voter-a")
            cast("motion-b", "voter-a")
            with self.assertRaises(sqlite3.IntegrityError):
                cast("motion-a", "voter-a")
            # Candidate uniqueness still applies across different motions.
            cast("motion-c", "voter-a", "candidate-a")
            with self.assertRaises(sqlite3.IntegrityError):
                cast("motion-d", "voter-a", "candidate-a")
            cast("motion-d", "voter-a", "candidate-b")
            cast("motion-c", "voter-b", "candidate-a")
            self.assertEqual(db.execute("SELECT count(*) FROM votes").fetchone()[0], 5)

    def test_hardener_repairs_regressions_idempotently(self):
        for name in ("votes", "audit_events"):
            self.by_name[name]["updateRule"] = ""
            self.by_name[name]["deleteRule"] = ""
        votes = self.by_name["votes"]
        votes["indexes"] = [i.split(" WHERE ")[0] for i in votes["indexes"]]
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "collections.json"
            path.write_text(json.dumps(self.collections))
            with mock.patch.object(harden_rules, "FILE", path), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(harden_rules.main(), 0)
                first = path.read_text()
                self.assertEqual(pb_migrate.validate(json.loads(first)), [])
                self.assertEqual(harden_rules.main(), 0)
                self.assertEqual(path.read_text(), first)
                # Missing candidate index is restored as well.
                cols = json.loads(first)
                vote_col = next(c for c in cols if c["name"] == "votes")
                vote_col["indexes"] = [i for i in vote_col["indexes"]
                                       if "idx_votes_candidate_voter" not in i]
                path.write_text(json.dumps(cols))
                self.assertEqual(harden_rules.main(), 0)
                self.assertEqual(path.read_text(), first)

    def test_existing_rules_preserve_locked_and_public_semantics(self):
        for name in ("votes", "audit_events", "compliance_rules"):
            col = copy.deepcopy(self.by_name[name])
            # A missing rule must default to locked, never public.
            del col["viewRule"]
            with self.subTest(name=name), \
                    mock.patch.object(pb_migrate, "request", return_value=(200, {})) as request, \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(pb_migrate.update_existing_rules(
                    "http://example.invalid", None, [col], {name: "synthetic-id"}
                ), ([name], []))
                patch = request.call_args.args[3]
                self.assertIsNone(patch["viewRule"])
                if name == "compliance_rules":
                    self.assertEqual(patch["listRule"], "")
                else:
                    self.assertIsNone(patch["updateRule"])
                    self.assertIsNone(patch["deleteRule"])

    def test_domain_pack_fields_are_persistent_and_compatible(self):
        organizations = self.by_name["organizations"]
        organization_fields = {field["name"]: field for field in organizations["schema"]}
        for name in (
            "domainPackId",
            "domainPackVersion",
            "entityVariant",
            "ruleProfileId",
        ):
            with self.subTest(collection="organizations", field=name):
                self.assertNotIn("defaultValue", organization_fields[name])

        for collection_name in ("compliance_rules", "compliance_checks"):
            fields = {field["name"]: field for field in self.by_name[collection_name]["schema"]}
            with self.subTest(collection=collection_name):
                for name in ("domainPackId", "domainPackVersion", "ruleProfileId"):
                    self.assertNotIn("defaultValue", fields[name])

        for rule in self.seed["compliance_rules"]:
            with self.subTest(seed_rule=rule["code"]):
                self.assertEqual(rule["domainPackId"], "cooperative")
                self.assertEqual(rule["domainPackVersion"], "1.0")
                self.assertEqual(rule["ruleProfileId"], "cooperative.my.v1")

    def test_domain_pack_migration_matches_collections_schema(self):
        source = DOMAIN_PACK_MIGRATION.read_text()
        self.assertEqual(source.count("new TextField("), 10)
        self.assertNotIn("new Field(", source)
        migration_fields = _domain_pack_fields_from_migration()
        self.assertEqual(set(migration_fields), DOMAIN_PACK_COLLECTIONS)

        for collection_name in sorted(DOMAIN_PACK_COLLECTIONS):
            with self.subTest(collection=collection_name):
                migration_by_name = {
                    field["name"]: _field_signature(field)
                    for field in migration_fields[collection_name]
                }
                self.assertEqual(
                    len(migration_fields[collection_name]),
                    len(migration_by_name),
                    f"duplicate domain-pack field in {collection_name} migration",
                )
                schema_by_name = {
                    field["name"]: _field_signature(field)
                    for field in self.by_name[collection_name]["schema"]
                    if field["name"] in DOMAIN_PACK_FIELD_NAMES
                }
                self.assertEqual(schema_by_name, migration_by_name)

    def test_create_payload_preserves_null_rules_and_partial_index(self):
        ids = {name: f"synthetic-{name}" for name in self.by_name}
        for name in ("votes", "audit_events"):
            with self.subTest(name=name):
                payload = pb_migrate.rewrite_relations(self.by_name[name], ids)
                payload = json.loads(json.dumps(payload))
                self.assertIsNone(payload["updateRule"])
                self.assertIsNone(payload["deleteRule"])
                if name == "votes":
                    self.assertIn(pb_migrate.CANDIDATE_VOTER_INDEX, payload["indexes"])


if __name__ == "__main__":
    unittest.main()
