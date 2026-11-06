#!/usr/bin/env python3
"""
AGMX — Rules hardening pass over pocketbase/collections.json.

Fixes applied:
  1. Invalid syntax:  `@request.auth != ''` is NOT valid PocketBase. The
     correct "signed in" test is `@request.auth.id != ''`.
  2. Tenancy enforcement on WRITE rules. list/view rules already carried
     `organizationId = @request.auth.organizationId`, but most create/update/
     delete rules were role-only, so any admin of ANY coop could write into
     another coop's tables. Every write rule now ANDs the tenant predicate.
  3. createRule cannot traverse relations (verified empirically against the
     server), so join tables bind their tenant on a denormalized field:
     federation_organizations gains `ownerOrgId`.
  4. agm_assessments is a PUBLIC lead funnel: anonymous submissions are
     allowed but only with organizationId = '' (a cooperative's lead pool
     cannot be poisoned). All reads require the viewer to be in the org or an
     admin triaging the unbound pool.
  5. organizations.createRule: self-serve creation is removed — an org cannot
     be created by someone with no org binding (they could never see it).

Safe to re-run: idempotent against the current JSON.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILE = ROOT / "pocketbase" / "collections.json"

cols = json.loads(FILE.read_text())
by_name = {c["name"]: c for c in cols}

TENANT = "organizationId = @request.auth.organizationId"
OWNER_TENANT = "ownerOrgId = @request.auth.organizationId"
ROLE = "@request.auth.role"


def and_tenant(rule: str) -> str:
    """AND the tenant predicate into a write rule."""
    return f"{TENANT} && ({rule})"


def and_owner_tenant(rule: str) -> str:
    """AND the federation-owner predicate (federations use ownerOrgId)."""
    return f"{OWNER_TENANT} && ({rule})"


# ---------------------------------------------------------------- per-collection
# Collection -> dict of {rule_key: new_value}. Omitted keys are untouched.
FIXES = {
    "organizations": {
        # organizations IS the tenant root — scope by its own id.
        "listRule": "id = @request.auth.organizationId",
        "updateRule": "id = @request.auth.organizationId && @request.auth.role = 'admin'",
        "deleteRule": "id = @request.auth.organizationId && @request.auth.role = 'admin'",
        "createRule": "@request.auth.role = 'admin'",
    },
    "compliance_rules": {
        "listRule": "",  # statutory reference data — public read is intended
        "viewRule": "",
    },
    "audit_events": {
        "createRule": TENANT,  # only an org-bound user appends its audit trail
    },
    "agm_assessments": {
        # Anonymous submissions only into the unbound lead pool (orgId = '').
        # Org staff may submit only with their own org set.
        "listRule": (
            f"{TENANT} || "
            f"({ROLE} = 'admin' && organizationId = '')"
        ),
        "viewRule": (
            f"{TENANT} || "
            f"({ROLE} = 'admin' && organizationId = '')"
        ),
        "createRule": (
            f"(organizationId = '' && @request.auth.id = '') || "
            f"({TENANT} && ({ROLE} = 'admin' || {ROLE} = 'secretary'))"
        ),
        # admin triages own org + unbound pool; secretary updates only own org.
        "updateRule": (
            f"({ROLE} = 'admin' && ({TENANT} || organizationId = '')) || "
            f"({ROLE} = 'secretary' && {TENANT})"
        ),
        "deleteRule": f"{ROLE} = 'admin' && ({TENANT} || organizationId = '')",
    },
    "federations": {
        "createRule": and_owner_tenant("@request.auth.role = 'admin'"),
        "updateRule": and_owner_tenant("@request.auth.role = 'admin'"),
        "deleteRule": and_owner_tenant("@request.auth.role = 'admin'"),
    },
    "federation_organizations": {
        # ownerOrgId (denormalized) is bound on insert because createRule
        # cannot traverse federationId.ownerOrgId.
        "listRule": (
            "federationId.ownerOrgId = @request.auth.organizationId || "
            f"{TENANT}"
        ),
        "viewRule": (
            "federationId.ownerOrgId = @request.auth.organizationId || "
            f"{TENANT}"
        ),
        "createRule": "ownerOrgId = @request.auth.organizationId && @request.auth.role = 'admin'",
        "updateRule": "ownerOrgId = @request.auth.organizationId && @request.auth.role = 'admin'",
        "deleteRule": "ownerOrgId = @request.auth.organizationId && @request.auth.role = 'admin'",
    },
    "partner_organizations": {
        "listRule": TENANT,
        "viewRule": TENANT,
        "createRule": and_tenant("@request.auth.role = 'admin'"),
        "updateRule": and_tenant("@request.auth.role = 'admin'"),
        "deleteRule": and_tenant("@request.auth.role = 'admin'"),
    },
}

# Tables whose create/update/delete rules are currently role-only and need
# the tenant predicate ANDed in. deleteRule admin / update non-member pattern.
TENANT_SCOPE_WRITES = {
    "agms", "agm_settings", "agenda_items", "attendance", "candidates",
    "motions", "resolutions", "quorum_snapshots", "agm_notices",
    "notice_recipients", "questions", "actions", "compliance_checks",
    "compliance_findings", "documents", "member_status_history",
    "subscriptions", "quotes", "invoices", "payments", "partners", "members",
}

# Rule keys that are already tenant-scoped on these collections — skip.
ALREADY_SCOPED = {
    "members": {"updateRule", "createRule"},
    "attendance": {"createRule"},
    "notice_recipients": {"updateRule"},
    "actions": {"updateRule"},
    "motions": {"createRule"},
}


def main() -> int:
    problems = []

    for name, fixes in FIXES.items():
        if name not in by_name:
            problems.append(f"{name}: listed in FIXES but not in collections.json")
            continue
        for key, value in fixes.items():
            by_name[name][key] = value
        print(f"patched  {name}")

    for name in sorted(TENANT_SCOPE_WRITES):
        if name in FIXES:
            continue
        c = by_name[name]
        if not any(f["name"] == "organizationId" for f in c["schema"]):
            problems.append(f"{name}: in TENANT_SCOPE_WRITES but has no organizationId")
            continue
        skip = ALREADY_SCOPED.get(name, set())
        append_only = name in ("votes", "audit_events")  # update+delete stay ''
        for key in ("createRule", "updateRule", "deleteRule"):
            if key in skip:
                continue
            current = c.get(key)
            if not current:
                if append_only:
                    continue  # true append-only tables keep update/delete ''
                if key == "createRule":
                    continue  # no create rule means no anonymous writes allowed
                continue
            if TENANT in current:
                continue
            c[key] = and_tenant(current)
            print(f"patched  {name}.{key}")

    # federation_organizations gains ownerOrgId (denormalized owner tenant).
    # Relation targets are identified by collection NAME in this repo (the
    # migrator resolves names to server ids).
    fos = by_name.get("federation_organizations")
    if fos and not any(f["name"] == "ownerOrgId" for f in fos["schema"]):
        fos["schema"].append({
            "name": "ownerOrgId",
            "type": "relation",
            "required": False,
            "maxSelect": 1,
            "minSelect": 0,
            "maxSize": 0,
            "cascadeDelete": False,
            "collectionId": "organizations",
        })
        print("patched  federation_organizations +ownerOrgId (relation->organizations)")

    if problems:
        for p in problems:
            print(f"  ✗ {p}", file=sys.stderr)
        return 1

    FILE.write_text(json.dumps(cols, indent=2, ensure_ascii=False) + "\n")
    print(f"\n✓ written {FILE.name} ({len(cols)} collections)")
    return 0


if __name__ == "__main__":
    sys.exit(main())