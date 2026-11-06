/* ============================================================
   AGMX — subscription client contract harness
   ------------------------------------------------------------
   Sprint 3 shipped api.js subscription methods written against a
   contract money-flow never served (POST /subscription, an invoice
   by subscriptionId, events as a path segment, a flat response
   envelope). Every one of those calls 404s or reads undefined, and
   nothing failed because no test crossed the boundary.

   This harness loads api.js as written and drives its real Supabase
   adapter against stubbed responses shaped exactly like the deployed
   function's, so a renamed route, a moved parameter or a re-wrapped
   envelope fails here instead of in front of a cooperative.
   Usage: node tools/test_subscription_client.js
   ============================================================ */
"use strict";

const assert = require("assert");
const path = require("path");

/* api.js binds its backend at module load: configure() only persists the
   choice, and the browser picks it up on the next page load. So the harness
   owns the storage shim the module reads, and re-requires per backend rather
   than expecting a runtime switch that does not exist. */
const MODULE = path.join(__dirname, "..", "api.js");
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
function loadCommerce(cfg) {
  if (cfg) store.set("agmx_backend_cfg", JSON.stringify(cfg));
  else store.delete("agmx_backend_cfg");
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

const FN = "https://sb.test/functions/v1/money-flow";
/* the adapter builds FN + "/subscription/create"; keys drop the prefix so a
   stub reads as the route the Edge Function actually matches. */
const FN_PATH = new URL(FN).pathname;

/* Rows exactly as PostgREST returns them for the deployed handlers. */
const SUB_ROW = {
  id: "6f1d2c3b-aaaa-4bbb-8ccc-ddddeeeeff01",
  organization_id: "493f88ad-9577-4a8b-9887-c9c240f560bd",
  plan_id: "plan-uuid-1",
  status: "active",
  billing_cycle: "annual",
  auto_renew: true,
  current_period_start: "2026-11-03",
  current_period_end: "2027-11-02",
  trial_ends_at: "2026-11-17T00:00:00Z",
  cancelled_at: null,
  created_at: "2026-11-03T02:00:00Z",
  plan: { code: "professional_agm", name: "Professional AGM", price_annual: 9600 },
};
const RI_GENERATED = {
  id: "ri-generated-1", subscription_id: SUB_ROW.id, organization_id: SUB_ROW.organization_id,
  plan_id: "plan-uuid-1", amount: 8888.88, tax: 658.44, total: 9547.32,
  period_start: "2026-11-03", period_end: "2027-11-02", status: "scheduled",
  scheduled_for: "2026-11-03", generated_at: "2026-11-03T02:05:00Z",
  invoice_id: "invoice-uuid-1", created_at: "2026-11-03T02:00:00Z",
};
const RI_PENDING = {
  id: "ri-pending-2", subscription_id: SUB_ROW.id, organization_id: SUB_ROW.organization_id,
  plan_id: "plan-uuid-1", amount: 8888.88, tax: 658.44, total: 9547.32,
  period_start: "2027-11-03", period_end: "2028-11-02", status: "scheduled",
  scheduled_for: "2027-11-03", generated_at: null, invoice_id: null,
  created_at: "2026-11-03T02:00:00Z",
};
const PS_ROW = {
  id: "ps-1", subscription_id: SUB_ROW.id, organization_id: SUB_ROW.organization_id,
  recurring_invoice_id: RI_GENERATED.id, amount: 9547.32, method: "fpx",
  gateway_reference: "BP-99", scheduled_for: "2026-11-05", status: "pending",
  processed_at: null, payment_id: null, retry_count: 0, last_error: null,
  created_at: "2026-11-03T02:05:00Z",
};
const INVOICE_ROW = {
  id: "invoice-uuid-1", organization_id: SUB_ROW.organization_id, quote_id: "quote-uuid-1",
  number: "INV-2026-0007", status: "unpaid", issued_at: "2026-11-03", due_at: "2026-11-17",
  amount: 9547.32, paid_at: null,
};
const QUOTE_ROW = {
  id: "quote-uuid-1", organization_id: SUB_ROW.organization_id, assessment_id: "asmt-uuid-1",
  number: "Q-2026-0007", status: "accepted", valid_until: "2026-12-03",
  subtotal: 8888.88, tax: 658.44, total: 9547.32, created_at: "2026-11-01T00:00:00Z",
};
const LEAD_ROW = {
  id: "asmt-uuid-1", reference: "AGMX-TEST-1", token: "t0ken", status: "quoted",
  coop_name: "Koperasi Uji", coop_reg: "1234", state: "Selangor", members: 120,
  complexity_score: 55, quotes: [QUOTE_ROW], invoices: [INVOICE_ROW], payments: [],
};
const EVENT_ROW = {
  id: "ev-1", subscription_id: SUB_ROW.id, organization_id: SUB_ROW.organization_id,
  event_type: "subscription.renewal_due", payload: { days: 30 }, processed: false,
  processed_at: null, created_at: "2026-11-03T03:00:00Z",
};

function stub(responses) {
  const requests = [];
  global.fetch = async (url, options) => {
    const parsed = new URL(url);
    const method = (options && options.method) || "GET";
    const key = method + " " + parsed.pathname.replace(FN_PATH, "")
      + (parsed.search ? "?" + parsed.searchParams.toString() : "");
    const record = { key, method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), url };
    if (options && options.body) record.body = JSON.parse(options.body);
    requests.push(record);
    const find = Object.keys(responses).find((k) => k === key);
    if (!find) throw new Error(`stub has no response for ${key} — the client asked for a route the function does not serve`);
    const value = responses[find];
    return { ok: true, status: value.status || 200, async text() { return JSON.stringify(value.body); } };
  };
  return requests;
}

const SUBSCRIPTION_DETAIL = {
  subscription: SUB_ROW,
  recurringInvoices: [RI_GENERATED, RI_PENDING],
  paymentSchedules: [PS_ROW],
};

function supabaseInstance() {
  return loadCommerce({ mode: "supabase", url: "https://sb.test", anonKey: "anon-key" });
}

(async function main() {
  const AGMX_COMMERCE = supabaseInstance();
  assert.strictEqual(AGMX_COMMERCE.adapter.mode, "supabase", "the adapter bound at load is not Supabase");

  /* ---- 1. create hits POST /subscription/create with an accepted quote id ---- */
  {
    const requests = stub({
      "GET /quote/quote-uuid-1": { body: QUOTE_ROW },
      "POST /subscription/create": { status: 201, body: { subscription: SUB_ROW } },
    });
    const sub = await AGMX_COMMERCE.createSubscription({ quoteRef: "quote-uuid-1", planKey: "essential_agm" });

    const post = requests.find((r) => r.method === "POST");
    assert.strictEqual(post.key, "POST /subscription/create", "create must not call POST /subscription");
    assert.strictEqual(post.body.quoteId, "quote-uuid-1", "the function takes a quote id, not an assessment id");
    assert.strictEqual(post.body.planCode, undefined, "the browser must not pick the billed plan");
    assert.strictEqual(post.body.startDate, undefined);

    /* the record lookup has no sequential number, so the reference is the id */
    assert.strictEqual(sub.id, SUB_ROW.id);
    assert.strictEqual(sub.number, "SUB-" + SUB_ROW.id.slice(0, 8).toUpperCase());
    assert.strictEqual(sub.planKey, "professional_agm");
    assert.strictEqual(sub.planName, "Professional AGM");
    assert.strictEqual(sub.status, "active");
    assert.strictEqual(sub.billingCycle, "annual");
    assert.strictEqual(sub.autoRenew, true);
    assert.strictEqual(sub.trialEndsAt, "2026-11-17T00:00:00.000Z");
    assert.strictEqual(sub.cancelledAt, null);
  }

  /* ---- 2. an unaccepted quote is refused before any write is attempted ---- */
  {
    const requests = stub({ "GET /quote/quote-uuid-1": { body: Object.assign({}, QUOTE_ROW, { status: "sent" }) } });
    await assert.rejects(
      () => AGMX_COMMERCE.createSubscription({ quoteRef: "quote-uuid-1" }),
      /diterima/,
      "an accepted quote should be required, in the shopper's language"
    );
    assert.strictEqual(requests.filter((r) => r.method === "POST").length, 0, "a write was attempted on a sent quote");
  }

  /* ---- 3. a lead reference resolves the quote the deal already holds ---- */
  {
    const requests = stub({
      "GET /lead/AGMX-TEST-1?ref=AGMX-TEST-1": { body: LEAD_ROW },
      "POST /subscription/create": { status: 201, body: { subscription: SUB_ROW } },
    });
    await AGMX_COMMERCE.createSubscription({ leadRef: "AGMX-TEST-1" });
    assert.ok(requests.some((r) => r.key.startsWith("GET /lead/")), "the lead lookup never ran");
    assert.strictEqual(requests.find((r) => r.method === "POST").body.quoteId, QUOTE_ROW.id);
  }

  /* ---- 4. the detail envelope is unwrapped, and invoice numbers resolved ---- */
  {
    const requests = stub({
      ["GET /subscription/" + SUB_ROW.id]: { body: SUBSCRIPTION_DETAIL },
      "GET /invoice/invoice-uuid-1": { body: INVOICE_ROW },
    });
    const sub = await AGMX_COMMERCE.getSubscription(SUB_ROW.id);

    assert.strictEqual(sub.status, "active", "the subscription row was read from the wrong key");
    assert.strictEqual(sub.recurringInvoices.length, 2);
    const [generated, pending] = sub.recurringInvoices;
    assert.strictEqual(generated.number, "INV-2026-0007", "a generated invoice must show its real number");
    assert.strictEqual(generated.issuedAt, "2026-11-03");
    assert.strictEqual(generated.dueAt, "2026-11-17");
    assert.strictEqual(generated.status, "unpaid");
    assert.strictEqual(generated.amount, 9547.32);
    assert.strictEqual(pending.number, "—", "an ungenerated period has no invoice number to invent");
    assert.strictEqual(pending.generated, false);
    assert.strictEqual(pending.dueAt, "2027-11-03", "an ungenerated period falls back to its schedule date");
    assert.strictEqual(sub.paymentSchedules[0].invoiceNumber, "INV-2026-0007");
    assert.strictEqual(sub.paymentSchedules[0].scheduledAt, "2026-11-05");
    /* one invoice read per generated period; the pending one has nothing to fetch */
    assert.strictEqual(requests.filter((r) => r.key.startsWith("GET /invoice/")).length, 1);
  }

  /* ---- 5. cancel re-reads the record instead of trusting a bare status ---- */
  {
    const requests = stub({
      "POST /subscription/cancel": { body: { status: "cancelled" } },
      ["GET /subscription/" + SUB_ROW.id]: {
        body: Object.assign({}, SUBSCRIPTION_DETAIL, {
          subscription: Object.assign({}, SUB_ROW, { status: "cancelled", auto_renew: false, cancelled_at: "2026-11-04T01:02:03Z" }),
        }),
      },
    });
    const sub = await AGMX_COMMERCE.cancelSubscription(SUB_ROW.id);
    assert.strictEqual(requests.find((r) => r.method === "POST").body.subscriptionId, SUB_ROW.id);
    assert.strictEqual(sub.status, "cancelled");
    assert.strictEqual(sub.autoRenew, false);
    assert.strictEqual(sub.cancelledAt, "2026-11-04T01:02:03.000Z");
  }

  /* ---- 6. invoice generation targets a recurring invoice, not a subscription ---- */
  {
    const requests = stub({
      ["GET /subscription/" + SUB_ROW.id]: { body: SUBSCRIPTION_DETAIL },
      "POST /subscription/recurring-invoice/generate": { body: { invoice: INVOICE_ROW } },
    });
    const invoice = await AGMX_COMMERCE.generateRecurringInvoice(SUB_ROW.id);
    const post = requests.find((r) => r.method === "POST");
    assert.strictEqual(post.key, "POST /subscription/recurring-invoice/generate");
    assert.strictEqual(post.body.recurringInvoiceId, RI_PENDING.id,
      "the next ungenerated period must be the one billed");
    assert.strictEqual(invoice.number, "INV-2026-0007");
    assert.strictEqual(invoice.amount, 9547.32);
    assert.strictEqual(invoice.subscriptionId, SUB_ROW.id);
    assert.strictEqual(invoice.recurring, true);
  }

  /* ---- 7. nothing left to bill is said out loud, not silently skipped ---- */
  {
    const requests = stub({
      ["GET /subscription/" + SUB_ROW.id]: {
        body: Object.assign({}, SUBSCRIPTION_DETAIL, { recurringInvoices: [RI_GENERATED] }),
      },
    });
    await assert.rejects(() => AGMX_COMMERCE.generateRecurringInvoice(SUB_ROW.id), /belum diterbitkan/);
    assert.strictEqual(requests.filter((r) => r.method === "POST").length, 0);
  }

  /* ---- 8. events are keyed by a query parameter, not a path segment ---- */
  {
    const requests = stub({
      ["GET /subscription/events?subscription_id=" + SUB_ROW.id]: { body: { events: [EVENT_ROW] } },
    });
    const events = await AGMX_COMMERCE.getSubscriptionEvents(SUB_ROW.id);
    assert.strictEqual(requests[0].path, FN_PATH + "/subscription/events", "events must not take an id path segment");
    assert.strictEqual(requests[0].query.subscription_id, SUB_ROW.id);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "subscription.renewal_due");
    assert.strictEqual(events[0].processed, false);
    assert.strictEqual(events[0].payload.days, 30);
  }

  /* ---- 9. the retired PocketBase backend refuses instead of 404ing ---- */
  {
    const requests = stub({});
    const POCKETBASE = loadCommerce({ mode: "pocketbase", url: "https://pb.test" });
    assert.strictEqual(POCKETBASE.adapter.mode, "pocketbase");
    for (const call of [
      () => POCKETBASE.createSubscription({ leadRef: "AGMX-TEST-1" }),
      () => POCKETBASE.getSubscription("sub-1"),
      () => POCKETBASE.cancelSubscription("sub-1"),
      () => POCKETBASE.generateRecurringInvoice("sub-1"),
      () => POCKETBASE.getSubscriptionEvents("sub-1"),
    ]) {
      await assert.rejects(call, /Supabase/, "the PocketBase adapter must name the backend it needs");
    }
    assert.strictEqual(requests.length, 0, "a retired backend was called anyway");
  }

  /* ---- 10. the demo backend still keeps subscriptions in this browser ---- */
  {
    /* No backend config stored → the localStorage adapter, which is what an
       unconfigured assessment link gets. checkout.js depends on this path
       still working when money-flow is not reachable. */
    store.set("agmx_leads_v1", JSON.stringify([{ id: "AGMX-TEST-1", coopName: "Koperasi Uji" }]));
    store.set("agmx_subscriptions_v1_plans", JSON.stringify([
      { key: "professional_agm", name: "Professional AGM", price_annual: 9600 },
    ]));
    const requests = stub({});
    const DEMO = loadCommerce(null);
    assert.strictEqual((await DEMO.status()).mode, "local", "an unconfigured browser must fall back to demo");
    const created = await DEMO.createSubscription({ leadRef: "AGMX-TEST-1", planKey: "professional_agm", billingCycle: "annual" });
    assert.ok(created && created.number, "demo subscriptions stopped working");
    assert.strictEqual(requests.length, 0, "demo mode reached the network");
  }

  console.log("subscription client contract: all assertions passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
