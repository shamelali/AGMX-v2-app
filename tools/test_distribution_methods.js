/* Credential-free tests for partner and federation PocketBase methods. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "pocketbase-client.js"), "utf8");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function harness(user) {
  const store = new Map();
  const state = {
    partners: [{
      id: "partner-1", organizationId: "org-1", name: "Koperasi Services",
      contactName: "Aina", contactEmail: "aina@example.test", commissionPct: 10, status: "active",
    }],
    partner_organizations: [],
    federations: [{ id: "fed-1", ownerOrgId: "org-1", name: "North Federation" }],
    federation_organizations: [
      { id: "fed-org-1", federationId: "fed-1", organizationId: "org-1", ownerOrgId: "org-1" },
      { id: "fed-org-2", federationId: "fed-1", organizationId: "org-2", ownerOrgId: "org-1" },
    ],
    members: [
      { id: "m-1", organizationId: "org-1" },
      { id: "m-2", organizationId: "org-1" },
      { id: "m-3", organizationId: "org-2" },
    ],
    agms: [
      { id: "a-1", organizationId: "org-1", status: "closed" },
      { id: "a-2", organizationId: "org-1", status: "planned" },
      { id: "a-3", organizationId: "org-2", status: "live" },
    ],
    compliance_checks: [
      { id: "c-1", organizationId: "org-1", result: "lulus" },
      { id: "c-2", organizationId: "org-1", result: "gagal" },
      { id: "c-3", organizationId: "org-2", result: "amaran" },
    ],
    compliance_findings: [
      { id: "f-1", organizationId: "org-1", status: "terbuka" },
      { id: "f-2", organizationId: "org-2", status: "selesai" },
    ],
  };
  const calls = [];

  function recordsFor(collection, query) {
    let records = state[collection] || [];
    const filter = query.get("filter") || "";
    const org = filter.match(/organizationId = "([^"]+)"/);
    const federation = filter.match(/federationId = "([^"]+)"/);
    if (org) records = records.filter((record) => record.organizationId === org[1]);
    if (federation) records = records.filter((record) => record.federationId === federation[1]);
    return records;
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
        url,
        path: parsed.pathname,
        options,
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      calls.push(request);
      const match = request.path.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/);
      if (!match) return response({ message: "Unknown endpoint" }, 404);
      const [, collection, id] = match;
      const records = state[collection] || [];

      if (request.method === "GET") {
        if (id) {
          const record = records.find((item) => item.id === id);
          return record ? response(record) : response({ message: "Not found" }, 404);
        }
        const items = recordsFor(collection, parsed.searchParams);
        return response({ items, totalItems: items.length });
      }
      if (request.method === "POST") {
        const record = { id: `${collection}-${records.length + 1}`, ...request.body };
        records.push(record);
        return response(record);
      }
      return response({ message: "Unsupported test request" }, 400);
    },
    URL,
    URLSearchParams,
    EventSource: function EventSource() {},
    console,
  };
  vm.runInNewContext(source, context);
  if (user) context.window.AGMX_PB._saveAuth("test-token", user);
  return { api: context.window.AGMX_API, calls, state };
}

async function testAuthorizationAndCrossTenantRejection() {
  for (const user of [null,
    { id: "member-1", organizationId: "org-1", role: "member" },
    { id: "admin-2", organizationId: "org-2", role: "admin" }]) {
    const h = harness(user);
    await assert.rejects(h.api.createPartner({ organizationId: "org-1", name: "P", contactName: "A", contactEmail: "a@example.test" }), /diperlukan|dibenarkan|bukan milik/);
    await assert.rejects(h.api.listPartners({ organizationId: "org-1" }), /diperlukan|dibenarkan|bukan milik/);
    await assert.rejects(h.api.createFederation({ organizationId: "org-1", name: "F" }), /diperlukan|dibenarkan|bukan milik/);
    await assert.rejects(h.api.listFederations({ organizationId: "org-1" }), /diperlukan|dibenarkan|bukan milik/);
    assert.strictEqual(h.calls.length, 0, "unauthorized distribution methods must fail before fetch");
  }

  const h = harness({ id: "admin-2", organizationId: "org-2", role: "admin" });
  await assert.rejects(
    h.api.createPartner({ organizationId: "org-1", name: "P", contactName: "A", contactEmail: "a@example.test" }),
    /bukan milik/
  );
  await assert.rejects(
    h.api.linkPartnerOrganization({ organizationId: "org-1", partnerId: "partner-1" }),
    /tenant akaun ini/
  );
  await assert.rejects(h.api.listFederationOrganizations({ organizationId: "org-2", federationId: "fed-1" }), /tidak ditemui/);
  assert.strictEqual(h.calls.filter((call) => call.method === "POST").length, 0,
    "cross-tenant federation access must never write");
}

async function testValidPartnerAndFederationLinks() {
  const h = harness({ id: "admin-1", organizationId: "org-1", role: "admin" });
  const partner = await h.api.createPartner({
    organizationId: "org-1", name: "New Partner", contactName: "Siti",
    contactEmail: "siti@example.test", commissionPct: 12.5,
  });
  assert.strictEqual(partner.organizationId, "org-1");
  assert.strictEqual(partner.commissionPct, 12.5);

  const partnerLink = await h.api.linkPartnerOrganization({
    organizationId: "org-1", partnerId: "partner-1", referredAt: "2026-09-01", contractValue: 2000,
  });
  assert.strictEqual(partnerLink.organizationId, "org-1");
  assert.strictEqual(partnerLink.contractValue, 2000);

  const federation = await h.api.createFederation({
    organizationId: "org-1", name: "New Federation", registrationNo: "FED-7",
  });
  assert.strictEqual(federation.ownerOrgId, "org-1");
  const federationLink = await h.api.linkFederationOrganization({
    organizationId: "org-1", federationId: "fed-1", linkedOrganizationId: "org-2",
    joinedAt: "2026-09-02", contributionPct: 25,
  });
  assert.strictEqual(federationLink.organizationId, "org-2");
  assert.strictEqual(federationLink.ownerOrgId, "org-1");
}

async function testFederationRollup() {
  const h = harness({ id: "admin-1", organizationId: "org-1", role: "admin" });
  const summary = await h.api.getFederationRollup({ organizationId: "org-1", federationId: "fed-1" });
  assert.strictEqual(summary.organizationCount, 2);
  assert.strictEqual(JSON.stringify(summary.organizationIds), JSON.stringify(["org-1", "org-2"]));
  assert.strictEqual(summary.memberTotal, 3);
  assert.strictEqual(summary.totalMembers, 3);
  assert.strictEqual(summary.agmCount, 3);
  assert.strictEqual(JSON.stringify(summary.agmStatusCounts), JSON.stringify({ closed: 1, planned: 1, live: 1 }));
  assert.strictEqual(JSON.stringify(summary.complianceCounts), JSON.stringify({ lulus: 1, gagal: 1, total: 3, amaran: 1 }));
  assert.strictEqual(JSON.stringify(summary.complianceFindingCounts), JSON.stringify({ terbuka: 1, total: 2, selesai: 1 }));
}

async function run() {
  await testAuthorizationAndCrossTenantRejection();
  await testValidPartnerAndFederationLinks();
  await testFederationRollup();
  console.log("distribution methods: authorization, tenant rejection, valid links, and federation roll-up passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
