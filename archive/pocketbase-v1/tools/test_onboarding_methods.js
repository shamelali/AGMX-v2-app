/* Credential-free tests for the authenticated non-payment onboarding slice. */
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

function harness(user) {
  const store = new Map();
  const state = {
    organizations: [{
      id: "org-1",
      name: "Test Cooperative",
      slug: "test-cooperative",
      domainPackId: "cooperative",
      domainPackVersion: "1.0",
      entityVariant: "cooperative",
      ruleProfileId: "cooperative.my.v1",
      settings: {},
    }],
    agms: [],
    members: [],
  };
  const calls = [];
  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode: false } },
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    fetch: async (url, options) => {
      const request = {
        method: options.method || "GET",
        url,
        path: new URL(url).pathname,
        options,
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      calls.push(request);
      const match = request.path.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/);
      if (!match) return response({ message: "Unknown endpoint" }, 404);
      const [, collection, id] = match;

      if (request.method === "GET" && id && collection === "organizations") {
        const record = state.organizations.find((item) => item.id === id);
        return record ? response(record) : response({ message: "Not found" }, 404);
      }
      if (request.method === "GET" && !id && (collection === "agms" || collection === "members")) {
        const records = state[collection];
        return response({ items: records, totalItems: records.length });
      }
      if (request.method === "POST" && collection === "agms") {
        const record = { id: `agm-${state.agms.length + 1}`, ...request.body };
        state.agms.push(record);
        return response(record);
      }
      if (request.method === "POST" && collection === "members") {
        const record = { id: `member-${state.members.length + 1}`, ...request.body };
        state.members.push(record);
        return response(record);
      }
      return response({ message: "Unsupported test request" }, 400);
    },
    URL,
    URLSearchParams,
    isFormData: () => false,
    EventSource: function EventSource() {},
    console,
  };
  vm.runInNewContext(packsSource, context, { filename: "domain-packs.js" });
  vm.runInNewContext(source, context);
  if (user) context.window.AGMX_PB._saveAuth("test-token", user);
  return { api: context.window.AGMX_API, calls, state };
}

const staff = { id: "admin-1", organizationId: "org-1", role: "admin", name: "Admin" };

async function testAuthorizationAndTenancy() {
  for (const user of [null,
    { id: "member-1", organizationId: "org-1", role: "member" },
    { id: "admin-2", role: "admin" }]) {
    const h = harness(user);
    for (const method of ["createScheduledAGM", "bulkImportMembers", "getOnboardingStatus"]) {
      const args = method === "createScheduledAGM"
        ? { organizationId: "org-1", title: "AGM", edition: 1, scheduledAt: "2027-06-01", mode: "hybrid" }
        : method === "bulkImportMembers"
          ? { organizationId: "org-1", members: [{ memberNo: "M-1", name: "Ali" }] }
          : { organizationId: "org-1" };
      await assert.rejects(h.api[method](args), /diperlukan|dibenarkan/);
    }
    assert.strictEqual(h.calls.length, 0, "authorization must fail before any request");
  }

  const h = harness(staff);
  await assert.rejects(
    h.api.createScheduledAGM({ organizationId: "org-2", title: "AGM", edition: 1, scheduledAt: "2027-06-01" }),
    /bukan milik/
  );
  await assert.rejects(
    h.api.bulkImportMembers({ organizationId: "org-2", members: [{ memberNo: "M-1", name: "Ali" }] }),
    /bukan milik/
  );
  assert.strictEqual(h.calls.length, 0, "cross-tenant input must not reach PocketBase");
}

async function testValidationIsPreflighted() {
  const h = harness(staff);
  await assert.rejects(
    h.api.createScheduledAGM({ title: "", edition: 0, scheduledAt: "not-a-date" }),
    /Tajuk AGM/
  );
  await assert.rejects(
    h.api.bulkImportMembers({ members: [
      { memberNo: "M-1", name: "Ali" },
      { memberNo: "M-1", name: "Siti" },
    ] }),
    /berganda/
  );
  await assert.rejects(
    h.api.bulkImportMembers({ members: [{ memberNo: "M-2", name: "", shares: -1 }] }),
    /Nama ahli/
  );
  assert.strictEqual(h.calls.length, 0, "invalid batches must not write partial records");
}

async function testSuccessfulSequencingAndStatus() {
  const h = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary", name: "Secretary" });
  const agm = await h.api.createScheduledAGM({
    title: "AGM Tahunan 2027", edition: 3, fiscalYear: "2026/2027",
    scheduledAt: "2027-06-01", venue: "Dewan Koperasi", mode: "hybrid",
    quorumPct: 30, noticeDays: 21,
  });
  assert.strictEqual(agm.organizationId, "org-1");
  assert.strictEqual(agm.status, "planned");
  assert.strictEqual(agm.noticeDays, 21);
  assert.strictEqual(agm.settings.domainPackId, "cooperative");
  assert.strictEqual(agm.settings.ruleProfileId, "cooperative.my.v1");
  assert.strictEqual(agm.settings.quorumMode, "configured");
  assert.strictEqual(agm.settings.votingMode, "configured");
  assert.strictEqual(h.calls[0].method, "GET");
  assert.strictEqual(h.calls[0].path, "/api/collections/organizations/records/org-1");
  assert.strictEqual(h.calls[1].method, "POST");
  assert.strictEqual(h.calls[1].path, "/api/collections/agms/records");

  const imported = await h.api.bulkImportMembers({ members: [
    { memberNo: "M-1", name: "Ali", shares: 10 },
    { memberNo: "M-2", name: "Siti", eligible: false },
  ] });
  assert.strictEqual(imported.imported, 2);
  assert.deepStrictEqual(h.state.members.map((member) => member.memberNo), ["M-1", "M-2"]);
  assert.strictEqual(h.state.members[0].organizationId, "org-1");
  assert.strictEqual(h.calls.filter((call) => call.method === "POST").length, 3,
    "AGM then each member must be written in sequence");
  assert.strictEqual(h.calls[2].method, "GET", "member import must preflight existing numbers");
  assert.strictEqual(h.calls[3].method, "POST");
  assert.strictEqual(h.calls[4].method, "POST");

  const status = await h.api.getOnboardingStatus({ agmId: agm.id });
  assert.strictEqual(status.status, "ready");
  assert.strictEqual(status.ready, true);
  assert.strictEqual(status.agm.id, agm.id);
  assert.strictEqual(status.members.total, 2);
  assert.strictEqual(status.members.eligible, 1);
  assert.strictEqual(status.members.imported, 2);
  assert.strictEqual(status.steps.agmCreated, true);
  assert.strictEqual(status.steps.membersImported, true);
}

async function testExistingMemberConflictDoesNotWrite() {
  const h = harness(staff);
  h.state.members.push({ id: "existing", organizationId: "org-1", memberNo: "M-1", eligible: true });
  await assert.rejects(
    h.api.bulkImportMembers({ members: [{ memberNo: "M-1", name: "Updated" }] }),
    /sudah wujud/
  );
  assert.strictEqual(h.calls.filter((call) => call.method === "POST").length, 0);
}

async function run() {
  await testAuthorizationAndTenancy();
  await testValidationIsPreflighted();
  await testSuccessfulSequencingAndStatus();
  await testExistingMemberConflictDoesNotWrite();
  console.log("onboarding methods: authorization, tenancy, validation, sequencing, and status passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
