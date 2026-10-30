"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const createPayment = require("../api/hitpay/create-payment");
const webhook = require("../api/hitpay/webhook");
const { verify } = require("../api/hitpay/_signature");

Object.assign(process.env, {
  PB_URL: "https://pb.example.test", PB_ADMIN_EMAIL: "admin@example.test",
  PB_ADMIN_PASSWORD: "mock-password", HITPAY_API_KEY: "mock-api-key",
  HITPAY_SALT: "mock-endpoint-salt", HITPAY_API_BASE_URL: "https://api.sandbox.hit-pay.com",
  HITPAY_WEBHOOK_URL: "https://agmx.example.test/api/hitpay/webhook",
});

const id = "9ef68e2e-3569-4f69-9f68-04c7e4bb007c";
const checkout = `https://securecheckout.sandbox.hit-pay.com/payment-request/@test/${id}/checkout`;
const invoice = { id: "invoice1", organizationId: "org1", number: "INV-1", amount: 19.99, status: "unpaid" };
const payment = { id: "payment123456789", organizationId: "org1", invoiceId: "invoice1",
  method: "card", reference: "hitpay", amount: 19.99, status: "pending", gatewayRef: "" };
let calls = [];
let previous = [];
let invoicePatchFails = false;
let providerResponse = () => ({ id, reference_number: payment.id, amount: "19.99", currency: "myr",
  status: "pending", url: checkout, allow_repeated_payments: false });
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
global.fetch = async (url, opts = {}) => {
  calls.push({ url, opts });
  if (url.endsWith("/auth-refresh")) return json({ record: { id: "user1", organizationId: "org1", role: "admin" } });
  if (url.endsWith("/_superusers/auth-with-password")) return json({ token: "admin-token" });
  if (url.endsWith("/invoices/records/invoice1")) {
    if (opts.method === "PATCH") {
      if (invoicePatchFails) return json({ error: "retry" }, 500);
      Object.assign(invoice, JSON.parse(opts.body));
    }
    return json(invoice);
  }
  if (url.includes("/payments/records?")) return json({ items: previous, totalItems: previous.length });
  if (url.endsWith("/payments/records/payment123456789")) {
    if (opts.method === "PATCH") Object.assign(payment, JSON.parse(opts.body));
    return json(payment);
  }
  if (url.includes("/payments/records/")) return json({}, 404);
  if (url.endsWith("/payments/records") && opts.method === "POST") return json(payment);
  if (url.endsWith("/v1/payment-requests")) return json(providerResponse());
  throw Error(`Unexpected mock fetch: ${url}`);
};

async function invoke(handler, body, headers = {}, method = "POST") {
  const res = { setHeader() {}, end(value) { this.data = JSON.parse(value); } };
  const req = { method, headers: { "content-type": "application/json", ...headers }, body };
  await handler(req, res);
  return res;
}
function signed(data, overrides = {}) {
  const body = Buffer.from(JSON.stringify(data));
  return { body, headers: { "hitpay-signature": createHmac("sha256", process.env.HITPAY_SALT).update(body).digest("hex"),
    "hitpay-event-object": "payment_request", "hitpay-event-type": data.status, ...overrides } };
}
const event = (status = "completed") => ({ id, reference_number: payment.id, amount: "19.99",
  currency: "myr", status });

(async () => {
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, {}, "GET")).statusCode, 405);
  for (const input of [{}, { invoiceId: "bad-id" }, { invoiceId: "invoice1", amount: 1 }]) {
    calls = [];
    assert.equal((await invoke(createPayment, input)).statusCode, 400);
    assert.equal(calls.length, 0);
  }
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "" })).statusCode, 401);
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "Bearer mock-user", "content-type": "text/plain" })).statusCode, 415);
  invoice.organizationId = "org2";
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "Bearer mock-user" })).statusCode, 404);
  invoice.organizationId = "org1";
  previous = [{ status: "pending" }];
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "Bearer mock-user" })).statusCode, 409);
  previous = [];
  process.env.HITPAY_CURRENCY = "myr";
  calls = [];
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "Bearer mock-user" })).statusCode, 503);
  assert.equal(calls.some(c => c.url.endsWith("/v1/payment-requests")), false);
  process.env.HITPAY_CURRENCY = "SGD";
  providerResponse = () => ({ id, reference_number: payment.id, amount: "19.99", currency: "sgd",
    status: "pending", url: checkout, allow_repeated_payments: false });
  calls = [];
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "Bearer mock-user" })).statusCode, 201);
  assert.equal(JSON.parse(calls.find(c => c.url.endsWith("/v1/payment-requests")).opts.body).currency, "SGD");
  delete process.env.HITPAY_CURRENCY;
  payment.gatewayRef = "";
  providerResponse = () => ({ id, reference_number: payment.id, amount: "19.99", currency: "myr",
    status: "pending", url: checkout, allow_repeated_payments: false });
  calls = [];
  const created = await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "Bearer mock-user" });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.data, { paymentId: payment.id, requestId: id, url: checkout });
  assert.equal(payment.gatewayRef, id);
  const upstream = calls.find(c => c.url.endsWith("/v1/payment-requests"));
  assert.equal(upstream.opts.headers["X-BUSINESS-API-KEY"], "mock-api-key");
  assert.deepEqual(JSON.parse(upstream.opts.body), { amount: 19.99, currency: "MYR", reference_number: payment.id,
    purpose: "Invoice INV-1", payment_methods: ["card"], allow_repeated_payments: "false" });
  assert.equal(Object.hasOwn(JSON.parse(upstream.opts.body), "webhook"), false);

  providerResponse = () => ({ id, reference_number: payment.id, amount: "19.99", currency: "MYR", status: "pending",
    url: "https://evil.test/checkout", allow_repeated_payments: false });
  payment.gatewayRef = "";
  assert.equal((await invoke(createPayment, { invoiceId: "invoice1" }, { authorization: "Bearer mock-user" })).statusCode, 502);
  assert.equal(payment.gatewayRef, "");
  payment.gatewayRef = id;

  const good = signed(event());
  assert.equal(verify(good.body, good.headers["hitpay-signature"], process.env.HITPAY_SALT), true);
  assert.equal(verify(Buffer.from(JSON.stringify(event()) + " "), good.headers["hitpay-signature"], process.env.HITPAY_SALT), false);
  assert.equal(verify(good.body, "xyz", process.env.HITPAY_SALT), false);
  calls = [];
  assert.equal((await invoke(webhook, good.body, { ...good.headers, "hitpay-signature": "0".repeat(64) })).statusCode, 401);
  assert.equal(calls.length, 0);
  assert.equal((await invoke(webhook, JSON.parse(good.body), good.headers)).statusCode, 400);
  assert.equal((await invoke(webhook, good.body, { ...good.headers, "hitpay-event-object": "charge" })).statusCode, 400);
  assert.equal((await invoke(webhook, good.body, { ...good.headers, "hitpay-event-type": "failed" })).statusCode, 400);
  const badAmount = signed({ ...event(), amount: "0.01" });
  assert.equal((await invoke(webhook, badAmount.body, badAmount.headers)).statusCode, 409);
  const fractional = signed({ ...event(), amount: "19.999" });
  assert.equal((await invoke(webhook, fractional.body, fractional.headers)).statusCode, 409);
  const badCurrency = signed({ ...event(), currency: "sgd" });
  assert.equal((await invoke(webhook, badCurrency.body, badCurrency.headers)).statusCode, 400);
  const repeated = signed({ ...event(), allow_repeated_payments: true });
  assert.equal((await invoke(webhook, repeated.body, repeated.headers)).statusCode, 409);
  const badRef = signed({ ...event(), reference_number: "anotherpayment" });
  assert.equal((await invoke(webhook, badRef.body, badRef.headers)).statusCode, 404);
  const duplicateId = payment.gatewayRef;
  payment.gatewayRef = "";
  assert.equal((await invoke(webhook, good.body, good.headers)).statusCode, 409);
  payment.gatewayRef = duplicateId;
  invoice.organizationId = "org2";
  assert.equal((await invoke(webhook, good.body, good.headers)).statusCode, 409);
  invoice.organizationId = "org1";
  calls = [];
  invoicePatchFails = true;
  assert.equal((await invoke(webhook, good.body, good.headers)).statusCode, 502);
  assert.equal(payment.status, "succeeded");
  assert.equal(invoice.status, "unpaid");
  invoicePatchFails = false;
  calls = [];
  assert.equal((await invoke(webhook, good.body, good.headers)).statusCode, 200);
  assert.equal(payment.status, "succeeded");
  assert.equal(invoice.status, "paid");
  assert.ok(payment.paidAt && invoice.paidAt);
  assert.equal(calls.filter(c => c.opts.method === "PATCH").length, 1);
  calls = [];
  assert.equal((await invoke(webhook, good.body, good.headers)).statusCode, 200);
  assert.equal(calls.filter(c => c.opts.method === "PATCH").length, 0);

  const failed = signed(event("failed"));
  assert.equal((await invoke(webhook, failed.body, failed.headers)).statusCode, 409);
  invoice.status = "unpaid";
  payment.status = "pending";
  calls = [];
  assert.equal((await invoke(webhook, failed.body, failed.headers)).statusCode, 200);
  assert.equal(payment.status, "failed");
  assert.equal(invoice.status, "unpaid");
  calls = [];
  assert.equal((await invoke(webhook, failed.body, failed.headers)).statusCode, 200);
  assert.equal(calls.filter(c => c.opts.method === "PATCH").length, 0);
  assert.equal((await invoke(webhook, good.body, good.headers)).statusCode, 409);
  console.log("HitPay endpoint tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
