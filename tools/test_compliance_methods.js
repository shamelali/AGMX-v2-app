/* Credential-free tests for tenant-safe PocketBase compliance operations. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "pocketbase-client.js"), "utf8");
const packsSource = fs.readFileSync(path.join(__dirname, "..", "domain-packs.js"), "utf8");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function harness(user, organization = {}) {
  const store = new Map();
  const calls = [];
  const state = {
    agms: [{ id: "agm-1", organizationId: "org-1", title: "15th AGM" }],
    organizations: [{
      id: "org-1",
      name: "Test Organization",
      slug: "test-organization",
      domainPackId: "cooperative",
      domainPackVersion: "1.0",
      entityVariant: "cooperative",
      ruleProfileId: "cooperative.my.v1",
      ...organization,
    }],
    compliance_rules: [
      { id: "rule-1", code: "AKTA-S17", label: "Notice", act: "akta1993", severity: "critical", checkType: "notice_days", domainPackId: "cooperative", domainPackVersion: "1.0", ruleProfileId: "cooperative.my.v1" },
      { id: "rule-2", code: "GP14", label: "Quorum", act: "gp14", severity: "critical", checkType: "quorum", domainPackId: "cooperative", domainPackVersion: "1.0", ruleProfileId: "cooperative.my.v1" },
      { id: "rule-resident-1", code: "RA-NOTICE", label: "Neighbourhood notice", act: "uuk", severity: "warning", checkType: "notice_days", domainPackId: "resident-association", domainPackVersion: "1.0", ruleProfileId: "resident-association.my.v1" },
    ],
    compliance_checks: [],
    compliance_findings: [],
  };

  function filtered(collection, query) {
    let rows = state[collection] || [];
    const filter = query.get("filter") || "";
    const org = filter.match(/organizationId = "([^\"]+)"/);
    const agm = filter.match(/agmId = "([^\"]+)"/);
    if (org) rows = rows.filter((row) => row.organizationId === org[1]);
    if (agm) rows = rows.filter((row) => row.agmId === agm[1]);
    return rows;
  }

  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode: false } },
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      const request = {
        method: options.method || "GET",
        path: parsed.pathname,
        options,
        body: typeof options.body === "string" ? JSON.parse(options.body) : undefined,
      };
      calls.push(request);
      const match = request.path.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/);
      if (!match) return response({ message: "Unknown endpoint" }, 404);
      const [, collection, id] = match;
      const rows = state[collection] || [];
      if (request.method === "GET") {
        if (id) {
          const row = rows.find((item) => item.id === id);
          return row ? response(row) : response({ message: "Not found" }, 404);
        }
        return response({ items: filtered(collection, parsed.searchParams), totalItems: rows.length });
      }
      if (request.method === "POST") {
        const row = { id: `${collection}-${rows.length + 1}`, ...request.body };
        rows.push(row);
        return response(row);
      }
      if (request.method === "PATCH") {
        const row = rows.find((item) => item.id === id);
        if (!row) return response({ message: "Not found" }, 404);
        Object.assign(row, request.body);
        return response(row);
      }
      return response({ message: "Unsupported test request" }, 400);
    },
    URL,
    URLSearchParams,
    EventSource: function EventSource() {},
    console,
  };
  vm.runInNewContext(source, context);
  // app.html loads domain-packs.js before pocketbase-client.js, so the
  // registry must be present for resolution to follow the real code path.
  vm.runInNewContext(packsSource, context, { filename: "domain-packs.js" });
  if (user) context.window.AGMX_PB._saveAuth("test-token", user);
  return { api: context.window.AGMX_API, calls, state };
}

async function testAuthorization() {
  for (const user of [null, { id: "member-1", organizationId: "org-1", role: "member" }]) {
    const h = harness(user);
    await assert.rejects(
      h.api.runComplianceChecks({ organizationId: "org-1", agmId: "agm-1" }),
      /diperlukan|tidak dibenarkan|pematuhan/
    );
    await assert.rejects(
      h.api.createComplianceFinding({ organizationId: "org-1", severity: "warning", message: "No" }),
      /diperlukan|tidak dibenarkan|pematuhan/
    );
    assert.strictEqual(h.calls.length, 0, "unauthorized compliance methods must fail before fetch");
  }

  const crossTenant = harness({ id: "secretary-2", organizationId: "org-2", role: "secretary" });
  await assert.rejects(
    crossTenant.api.runComplianceChecks({ organizationId: "org-1", agmId: "agm-1" }),
    /bukan milik/
  );
  assert.strictEqual(crossTenant.calls.length, 0);
}

async function testIdempotentChecksAndReport() {
  const h = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary" });
  const first = await h.api.runComplianceChecks({
    organizationId: "org-1",
    agmId: "agm-1",
    results: { "AKTA-S17": "lulus", GP14: { result: "gagal", details: { evidence: "No quorum" } } },
    checkedAt: "2026-10-09T00:00:00.000Z",
  });
  assert.strictEqual(h.state.compliance_checks.length, 2);
  assert.strictEqual(JSON.stringify(first.counts), JSON.stringify({ total: 2, lulus: 1, amaran: 0, gagal: 1 }));
  assert.strictEqual(first.score, 50);
  assert.strictEqual(first.checks[1].details.evidence, "No quorum");
  assert.strictEqual(h.state.compliance_rules.length, 3, "running checks never creates rule records");

  const second = await h.api.runComplianceChecks({
    organizationId: "org-1",
    agmId: "agm-1",
    results: { "AKTA-S17": "amaran", GP14: "lulus" },
  });
  assert.strictEqual(h.state.compliance_checks.length, 2, "rerun updates checks instead of duplicating them");
  assert.strictEqual(JSON.stringify(second.counts), JSON.stringify({ total: 2, lulus: 1, amaran: 1, gagal: 0 }));
  assert.strictEqual(second.score, 75);
}

async function testSafeFindings() {
  const h = harness({ id: "admin-1", organizationId: "org-1", role: "admin" });
  await h.api.runComplianceChecks({ organizationId: "org-1", agmId: "agm-1", results: { "AKTA-S17": "gagal", GP14: "lulus" } });
  const finding = await h.api.createComplianceFinding({
    organizationId: "org-1", checkId: "compliance_checks-1", severity: "critical", message: "Notice was late",
  });
  assert.strictEqual(finding.organizationId, "org-1");
  const updated = await h.api.updateComplianceFinding({
    organizationId: "org-1", findingId: finding.id, status: "selesai", message: "Evidence uploaded",
  });
  assert.strictEqual(updated.status, "selesai");
  assert.ok(updated.resolvedAt);

  const report = await h.api.getComplianceReport({ organizationId: "org-1", agmId: "agm-1" });
  assert.strictEqual(report.findingCounts.total, 1);
  assert.strictEqual(report.openFindings.length, 0);
  await assert.rejects(
    h.api.updateComplianceFinding({ organizationId: "org-2", findingId: finding.id, status: "terbuka" }),
    /bukan milik/
  );
}

async function testPackScopedRulesAndSnapshot() {
  const h = harness(
    { id: "secretary-ra", organizationId: "org-1", role: "secretary" },
    {
      domainPackId: "resident-association",
      domainPackVersion: "1.0",
      entityVariant: "neighbourhood",
      ruleProfileId: "resident-association.my.v1",
    }
  );
  const report = await h.api.runComplianceChecks({
    organizationId: "org-1",
    agmId: "agm-1",
    results: { "RA-NOTICE": "lulus", "AKTA-S17": "gagal" },
  });
  assert.strictEqual(h.state.compliance_checks.length, 1, "only active pack rules are persisted");
  assert.strictEqual(h.state.compliance_checks[0].ruleId, "rule-resident-1");
  assert.strictEqual(h.state.compliance_checks[0].domainPackId, "resident-association");
  assert.strictEqual(report.domainPackId, "resident-association");
  assert.strictEqual(report.ruleProfileId, "resident-association.my.v1");
  assert.strictEqual(report.checks[0].code, "RA-NOTICE");
}

/**
 * Regression: an organization whose domainPackId was changed in the PocketBase
 * admin UI still carries the cooperative create-time defaults for the other
 * three columns, because defaultValue only applies on create. The mapping must
 * derive the variant and rule profile from the selected pack instead of
 * asserting the cooperative ones, or resolution throws and the dashboard and
 * compliance report both fail to load.
 */
async function testPartiallyConfiguredPackResolves() {
  const h = harness(
    { id: "secretary-partial", organizationId: "org-1", role: "secretary" },
    {
      domainPackId: "resident-association",
      domainPackVersion: "1.0",
      entityVariant: "",
      ruleProfileId: "",
    }
  );
  const report = await h.api.runComplianceChecks({
    organizationId: "org-1",
    agmId: "agm-1",
    results: { "RA-NOTICE": "lulus" },
  });
  assert.strictEqual(report.domainPackId, "resident-association");
  assert.strictEqual(report.ruleProfileId, "resident-association.my.v1");
  assert.strictEqual(h.state.compliance_checks.length, 1);
  assert.strictEqual(h.state.compliance_checks[0].domainPackId, "resident-association");
}

/**
 * A pack switch must not rewrite a completed AGM's score or drop its findings:
 * checks are evaluated against the rule they reference and keep the profile
 * they were recorded under, with the mixed-profile case surfaced.
 */
async function testHistoricalChecksSurvivePackSwitch() {
  const h = harness(
    { id: "secretary-coop", organizationId: "org-1", role: "secretary" },
    { domainPackId: "cooperative", entityVariant: "cooperative", ruleProfileId: "cooperative.my.v1" }
  );
  const cooperativeReport = await h.api.runComplianceChecks({
    organizationId: "org-1",
    agmId: "agm-1",
    results: { "AKTA-S17": "lulus", GP14: "gagal" },
  });
  assert.strictEqual(cooperativeReport.score, 50);

  // Same organization and same AGM, now on the resident-association pack, with
  // the cooperative checks already on record.
  const switched = harness(
    { id: "secretary-coop", organizationId: "org-1", role: "secretary" },
    {
      domainPackId: "resident-association",
      domainPackVersion: "1.0",
      entityVariant: "neighbourhood",
      ruleProfileId: "resident-association.my.v1",
    }
  );
  switched.state.compliance_checks = h.state.compliance_checks.map((record) => ({ ...record }));
  const finding = await switched.api.createComplianceFinding({
    organizationId: "org-1",
    checkId: switched.state.compliance_checks[0].id,
    severity: "warning",
    message: "Notis terlalu singkat",
  });
  await switched.api.runComplianceChecks({
    organizationId: "org-1",
    agmId: "agm-1",
    results: { "RA-NOTICE": "lulus" },
  });

  const report = await switched.api.getComplianceReport({ organizationId: "org-1", agmId: "agm-1" });
  assert.strictEqual(report.checks.length, 3, "cooperative checks are not dropped after a pack switch");
  assert.strictEqual(report.findings.length, 1, "findings on earlier checks are not silently dropped");
  assert.strictEqual(report.findings[0].id, finding.id);
  const byCode = new Map(report.checks.map((check) => [check.code, check]));
  assert.strictEqual(byCode.get("AKTA-S17").domainPackId, "cooperative");
  assert.strictEqual(byCode.get("AKTA-S17").activeProfile, false);
  assert.strictEqual(byCode.get("RA-NOTICE").domainPackId, "resident-association");
  assert.strictEqual(byCode.get("RA-NOTICE").activeProfile, true);
  assert.strictEqual(report.mixedProfiles, true, "a mid-cycle pack switch is surfaced, not hidden");
  assert.strictEqual(report.profiles.length, 2);
  assert.strictEqual(report.domainPackId, "resident-association", "report header reports the active pack");
}

async function run() {
  await testAuthorization();
  await testIdempotentChecksAndReport();
  await testSafeFindings();
  await testPackScopedRulesAndSnapshot();
  await testPartiallyConfiguredPackResolves();
  await testHistoricalChecksSurvivePackSwitch();
  console.log("compliance methods: authorization, idempotent checks, findings, normalized report, and pack resolution passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
