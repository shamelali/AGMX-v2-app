"""Commercial PocketBase schema/rule safety without a running server."""
import copy
import json
import unittest

import pb_migrate


class CommercialSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.collections = json.loads(pb_migrate.COLLECTIONS_FILE.read_text())
        cls.by_name = {col["name"]: col for col in cls.collections}

    def test_public_assessment_is_unbound_but_not_publicly_readable(self):
        col = self.by_name["agm_assessments"]
        fields = {field["name"]: field for field in col["schema"]}
        self.assertFalse(fields["organizationId"].get("required", False))
        self.assertEqual(fields["organizationId"]["collectionId"], "organizations")
        self.assertEqual(fields["complexityScore"]["max"], 100)
        self.assertEqual(fields["complexityScore"]["min"], 0)
        self.assertEqual(fields["answers"]["type"], "json")
        self.assertEqual(col["createRule"],
                         "(organizationId = '' && @request.auth.id = '') || "
                         "(organizationId = @request.auth.organizationId && "
                         "(@request.auth.role = 'admin' || @request.auth.role = 'secretary'))")
        for key in ("listRule", "viewRule"):
            with self.subTest(rule=key):
                self.assertEqual(col[key],
                                 "organizationId = @request.auth.organizationId || "
                                 "(@request.auth.role = 'admin' && organizationId = '')")
        self.assertEqual(col["updateRule"],
                         "(@request.auth.role = 'admin' && "
                         "(organizationId = @request.auth.organizationId || organizationId = '')) || "
                         "(@request.auth.role = 'secretary' && "
                         "organizationId = @request.auth.organizationId)")
        self.assertEqual(col["deleteRule"],
                         "@request.auth.role = 'admin' && "
                         "(organizationId = @request.auth.organizationId || organizationId = '')")

    def test_quotes_require_tenant_and_staff_role_and_valid_schema(self):
        col = self.by_name["quotes"]
        fields = {field["name"]: field for field in col["schema"]}
        self.assertTrue(fields["organizationId"]["required"])
        self.assertEqual(fields["organizationId"]["collectionId"], "organizations")
        self.assertEqual(fields["assessmentId"]["collectionId"], "agm_assessments")
        self.assertTrue(fields["number"]["unique"])
        for field in ("subtotal", "tax", "total"):
            with self.subTest(field=field):
                self.assertTrue(fields[field]["required"])
                self.assertEqual(fields[field]["min"], 0)
        self.assertEqual(fields["items"]["type"], "json")
        tenant = "organizationId = @request.auth.organizationId"
        for key in ("listRule", "viewRule"):
            self.assertEqual(col[key], tenant)
        for key in ("createRule", "updateRule"):
            with self.subTest(rule=key):
                self.assertEqual(col[key], tenant + " && "
                                 "(@request.auth.role = 'admin' || @request.auth.role = 'secretary')")
        self.assertEqual(col["deleteRule"], tenant + " && (@request.auth.role = 'admin')")

    def test_validator_rejects_public_quote_write_and_broken_assessment_relation(self):
        for replacement in ("", "@request.auth.role = 'admin'"):
            with self.subTest(rule=replacement):
                cols = copy.deepcopy(self.collections)
                next(col for col in cols if col["name"] == "quotes")["createRule"] = replacement
                self.assertTrue(any("quotes.createRule" in problem
                                    for problem in pb_migrate.validate(cols)))
        cols = copy.deepcopy(self.collections)
        quote = next(col for col in cols if col["name"] == "quotes")
        next(field for field in quote["schema"] if field["name"] == "assessmentId")["collectionId"] = "missing"
        self.assertTrue(any("quotes.assessmentId" in problem
                            for problem in pb_migrate.validate(cols)))


if __name__ == "__main__":
    unittest.main()
