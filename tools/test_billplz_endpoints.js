"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const createBill = require("../api/billplz/create-bill");
const callback = require("../api/billplz/callback");
const { signatureSource, verify } = require("../api/billplz/_signature");

Object.assign(process.env, {
  PB_URL: "https://pb.example.test", PB_ADMIN_EMAIL: "admin@example.test",
  PB_ADMIN_PASSWORD: "mock-password", BILLPLZ_API_KEY: "mock-key",
  BILLPLZ_COLLECTION_ID: "collection-1", BILLPLZ_X_SIGNATURE_KEY: "mock-signature-key",
  BILLPLZ_API_BASE_URL: "https://www.billplz-sandbox.com/api",
  BILLPLZ_CALLBACK_URL: "https://agmx.example.test/api/billplz/callback",
});

const invoice = { id: "invoice1", organizationId: "org1", amount: 19.99, status: "unpaid" };
const payment = { id: "payment123456789", organizationId: "org1", invoiceId: "invoice1", method: "fpx",
  amount: 19.99, status: "pending", gatewayRef: "bill1" };
let calls = [];
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
global.fetch = async (url, opts = {}) => {
  calls.push({ url, opts });
  if (url.endsWith("/auth-refresh")) {
    return json({ record: { id: "user1", organizationId: "org1", role: "admin" } });
  }
  if (url.endsWith("/_superusers/auth-with-password")) return json({ token: "admin-token" });
  if (url.endsWith("/invoices/records/invoice1")) {
    if (opts.method === "PATCH") { Object.assign(invoice, JSON.parse(opts.body)); }
    return json(invoice);
  }
  if (url.includes("/payments/records?") && url.includes("invoiceId")) return json({ items: [], totalItems: 0 });
  if (url.includes("/payments/records?") && url.includes("gatewayRef")) return json({ items: [payment], totalItems: 1 });
  if (url.endsWith("/payments/records") && opts.method === "POST") return json(payment);
  if (url.endsWith("/payments/records/payment123456789") && opts.method === "PATCH") {
    Object.assign(payment, JSON.parse(opts.body)); return json(payment);
  }
  if (url.endsWith("/v3/bills")) return json({ id: "bill1", collection_id: "collection-1",
    amount: 1999, url: "https://www.billplz-sandbox.com/bills/bill1" });
  throw Error(`Unexpected mock fetch: ${url}`);
};

async function invoke(handler, data, contentType, auth = "Bearer mock-user") {
  const res = { setHeader() {}, end(value) { this.data = JSON.parse(value); } };
  await handler({ method: "POST", headers: { "content-type": contentType, authorization: auth }, body: data }, res);
  return res;
}

(async () => {
  const input = { invoiceId: "invoice1", amountSen: 1999, name: "Tester", email: "tester@example.test", description: "Invoice" };
  for (const amount of [0, 1.1, "1999", -1, 2000]) {
    calls = [];
    const result = await invoke(createBill, { ...input, amountSen: amount }, "application/json");
    assert.equal(result.statusCode, amount === 2000 ? 409 : 400);
    assert.equal(calls.some(c => c.url.endsWith("/v3/bills")), false);
  }
  assert.equal((await invoke(createBill, "{", "application/json")).statusCode, 400);
  assert.equal((await invoke(createBill, input, "text/plain")).statusCode, 415);
  assert.equal((await invoke(createBill, input, "application/json", "")).statusCode, 401);
  calls = [];
  const created = await invoke(createBill, input, "application/json");
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.data, { paymentId: "payment123456789", billId: "bill1", url: "https://www.billplz-sandbox.com/bills/bill1" });
  const billCall = calls.find(c => c.url.endsWith("/v3/bills"));
  assert.equal(billCall.opts.headers.Authorization, `Basic ${Buffer.from("mock-key:").toString("base64")}`);
  assert.deepEqual(JSON.parse(billCall.opts.body), { collection_id: "collection-1", amount: 1999,
    name: "Tester", email: "tester@example.test", description: "Invoice",
    callback_url: "https://agmx.example.test/api/billplz/callback",
    reference_1_label: "Payment ID", reference_1: "payment123456789" });
  const unsigned = { paid: "true", id: "bill1", collection_id: "collection-1", state: "paid",
    amount: "1999", paid_amount: "1999", paid_at: "2026-10-09 12:00:00 +0800", mobile: "",
    transaction_id: "transaction1" };
  assert.equal(signatureSource(unsigned), "amount1999|collection_idcollection-1|idbill1|mobile|paid_amount1999|paid_at2026-10-09 12:00:00 +0800|paidtrue|statepaid|transaction_idtransaction1");
  const signed = { ...unsigned, x_signature: createHmac("sha256", "mock-signature-key")
    .update(signatureSource(unsigned)).digest("hex") };
  assert.equal(verify(signed, "mock-signature-key"), true);
  assert.equal(verify({ ...signed, amount: "1" }, "mock-signature-key"), false);
  let cryptoCalls = 0;
  assert.equal(verify(signed, "mock-signature-key", {
    createHmac(algorithm, key) {
      assert.equal(algorithm, "sha256"); assert.equal(key, "mock-signature-key");
      return { update(source) { assert.equal(source, signatureSource(unsigned));
        return { digest() { return Buffer.from(signed.x_signature, "hex"); } }; } };
    },
    timingSafeEqual(a, b) { cryptoCalls++; return a.equals(b); },
  }), true);
  assert.equal(cryptoCalls, 1);
  calls = [];
  const invalid = await invoke(callback, new URLSearchParams({ ...signed, amount: "1" }).toString(), "application/x-www-form-urlencoded");
  assert.equal(invalid.statusCode, 401);
  assert.equal(calls.length, 0);
  const invalidDuplicate = await invoke(callback, new URLSearchParams({ ...signed }).toString() + "&amount=1999", "application/x-www-form-urlencoded");
  assert.equal(invalidDuplicate.statusCode, 400);
  const done = await invoke(callback, new URLSearchParams(signed).toString(), "application/x-www-form-urlencoded");
  assert.equal(done.statusCode, 200);
  assert.equal(payment.status, "succeeded");
  assert.equal(invoice.status, "paid");
  calls = [];
  assert.equal((await invoke(callback, new URLSearchParams(signed).toString(), "application/x-www-form-urlencoded")).statusCode, 200);
  assert.equal(calls.filter(c => c.opts.method === "PATCH").length, 0);
  console.log("Billplz endpoint tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
