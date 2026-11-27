/* Credential-free tests for subscription and post-AGM governance primitives. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

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
  const calls = [];
  const state = {
    subscriptions: [{
      id: "sub-1", organizationId: "org-1", planId: "plan-1", status: "trialing",
      billingCycle: "annual", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2026-01-15",
    }],
    actions: [],
    resolutions: [],
    documents: [],
    audit_events: [
      { id: "audit-old", organizationId: "org-1", hash: "hash-old", occurredAt: "2026-01-01T00:00:00Z" },
      { id: "audit-new", organizationId: "org-1", hash: "hash-new", occurredAt: "2026-01-02T00:00:00Z" },
    ],
  };

  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode: false }, crypto: webcrypto },
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
        body: typeof options.body === "string" ? JSON.parse(options.body) : undefined,
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
        return response({ items: records.slice().sort((a, b) =>
          String(b.occurredAt || b.created || "").localeCompare(String(a.occurredAt || a.created || ""))) });
      }
      if (request.method === "POST") {
        const record = { id: `${collection}-${records.length + 1}`, ...request.body };
        records.push(record);
        return response(record);
      }
      if (request.method === "PATCH") {
        const record = records.find((item) => item.id === id);
        if (!record) return response({ message: "Not found" }, 404);
        Object.assign(record, request.body);
        return response(record);
      }
      return response({ message: "Unsupported test request" }, 400);
    },
    URL,
    URLSearchParams,
    TextEncoder,
    EventSource: function EventSource() {},
    console,
  };

  vm.runInNewContext(source, context);
  if (user) context.window.AGMX_PB._saveAuth("test-token", user);
  return { api: context.window.AGMX_API, calls, state };
}

async function testSubscriptionAuthorizationAndTransitions() {
  for (const user of [null, { id: "member-1", organizationId: "org-1", role: "member" },
    { id: "secretary-1", organizationId: "org-1", role: "secretary" },
    { id: "admin-2", organizationId: "org-2", role: "admin" }]) {
    const h = harness(user);
    await assert.rejects(
      h.api.startSubscription({ organizationId: "org-1", planId: "plan-1" }),
      /diperlukan|tidak dibenarkan|tidak sepadan|Rekod bukan/
    );
    assert.strictEqual(h.calls.length, 0, "start must reject before a cross-org or unauthorized fetch");
  }

  const h = harness({ id: "admin-1", organizationId: "org-1", role: "admin" });
  const started = await h.api.startTrialSubscription({
    organizationId: "org-1", planId: "plan-1", billingCycle: "monthly", trialDays: 7,
  });
  assert.strictEqual(started.status, "trialing");
  assert.strictEqual(started.organizationId, "org-1");
  assert.strictEqual(started.billingCycle, "monthly");

  const activated = await h.api.transitionSubscription({ subscriptionId: "sub-1", status: "active" });
  assert.strictEqual(activated.status, "active");
  const renewed = await h.api.renewSubscription({
    subscriptionId: "sub-1", currentPeriodStart: "2026-02-01", currentPeriodEnd: "2027-01-31",
  });
  assert.strictEqual(renewed.status, "active");
  assert.strictEqual(renewed.renewalDate, "2027-01-31");
  const canceled = await h.api.cancelSubscription({ subscriptionId: "sub-1" });
  assert.strictEqual(canceled.status, "canceled");
  await assert.rejects(
    h.api.transitionSubscription({ subscriptionId: "sub-1", status: "active" }),
    /Peralihan langganan tidak sah/
  );
  assert.strictEqual(
    h.calls.filter((call) => call.method === "PATCH" && call.path.endsWith("/sub-1")).length,
    3,
    "activation, renewal, and cancellation each update the lifecycle record"
  );
}

async function testGovernanceAuthorizationAndRecords() {
  const member = harness({ id: "member-1", organizationId: "org-1", role: "member" });
  await assert.rejects(member.api.createAction({ organizationId: "org-1", title: "Close follow-up" }), /tidak dibenarkan/);
  assert.strictEqual(member.calls.length, 0);

  const secretary = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary", name: "Secretary" });
  const action = await secretary.api.createAction({
    organizationId: "org-1", agmId: "agm-1", title: "File minutes", status: "terbuka",
  });
  assert.strictEqual(action.organizationId, "org-1");
  assert.strictEqual(action.title, "File minutes");
  const resolution = await secretary.api.createResolution({
    organizationId: "org-1", agmId: "agm-1", title: "Approve minutes", passed: true, votesYa: 8,
  });
  assert.strictEqual(resolution.passed, true);
  assert.strictEqual(resolution.votesYa, 8);
  const document = await secretary.api.createDocument({
    organizationId: "org-1", agmId: "agm-1", category: "minutes", filename: "minutes.pdf", file: "file-token",
  });
  assert.strictEqual(document.uploadedBy, "secretary-1");

  const wrongOrg = harness({ id: "secretary-2", organizationId: "org-2", role: "secretary" });
  await assert.rejects(
    wrongOrg.api.createResolution({ organizationId: "org-1", agmId: "agm-1", title: "No cross-org write" }),
    /Rekod bukan milik organisasi/
  );
  assert.strictEqual(wrongOrg.calls.length, 0);
}

async function testAuditChainUsesLatestEventAndLocksPayload() {
  const h = harness({ id: "admin-1", organizationId: "org-1", role: "admin", name: "Admin" });
  const event = await h.api.appendAudit("org-1", {
    action: "resolution.created", entityType: "resolutions", entityId: "resolution-1",
    payload: { detail: "minutes approved" },
  });
  assert.strictEqual(event.organizationId, "org-1");
  assert.strictEqual(event.prevHash, "hash-new");
  assert.strictEqual(event.actorId, "admin-1");
  assert.strictEqual(event.action, "resolution.created");
  await assert.rejects(
    h.api.appendAudit("org-2", { action: "x", entityType: "x", entityId: "x" }),
    /Rekod bukan milik organisasi/
  );
}

async function run() {
  await testSubscriptionAuthorizationAndTransitions();
  await testGovernanceAuthorizationAndRecords();
  await testAuditChainUsesLatestEventAndLocksPayload();
  console.log("governance PocketBase methods: authorization, lifecycle transitions, records, and audit chaining passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
