/* Credential-free tests for provider-neutral commercial PocketBase methods. */
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
    json: async () => body,
  };
}

function harness(user, config = {}, billResponse = response({ error: "Payment service is not configured" }, 503),
  hitpayResponse = response({ error: "Payment service is not configured" }, 503)) {
  const store = new Map();
  const state = {
    quote: {
      id: "quote-1", organizationId: "org-1", total: 1250,
      items: [{ name: "AGM", quantity: 1, unitPrice: 1250, total: 1250 }],
    },
    invoices: [],
    payments: [],
  };
  const calls = [];

  const context = {
    window: { AGMX_CONFIG: { url: "http://pb.test", demoMode: false, ...config } },
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    fetch: async (url, options) => {
    const request = {
        method: options.method || "GET",
        url,
        path: new URL(url, "https://app.test").pathname,
        options,
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      calls.push(request);

      if (request.path === "/api/billplz/create-bill") return billResponse;
      if (request.path === "/api/hitpay/create-payment") return hitpayResponse;

      const match = request.path.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/);
      if (!match) return response({ message: "Unknown endpoint" }, 404);
      const [, collection, id] = match;

      if (collection === "quotes" && request.method === "GET") {
        return id === state.quote.id ? response(state.quote) : response({ message: "Not found" }, 404);
      }
      if (collection === "invoices" && request.method === "GET") {
        if (id) {
          const invoice = state.invoices.find((item) => item.id === id);
          return invoice ? response(invoice) : response({ message: "Not found" }, 404);
        }
        return response({ items: state.invoices });
      }
      if (collection === "invoices" && request.method === "POST") {
        const invoice = { id: `invoice-${state.invoices.length + 1}`, ...request.body };
        state.invoices.push(invoice);
        return response(invoice);
      }
      if (collection === "invoices" && request.method === "PATCH") {
        const invoice = state.invoices.find((item) => item.id === id);
        if (!invoice) return response({ message: "Not found" }, 404);
        Object.assign(invoice, request.body);
        return response(invoice);
      }
      if (collection === "payments" && request.method === "GET") {
        const payment = state.payments.find((item) => item.id === id);
        return payment ? response(payment) : response({ message: "Not found" }, 404);
      }
      if (collection === "payments" && request.method === "POST") {
        const payment = { id: `payment-${state.payments.length + 1}`, ...request.body };
        state.payments.push(payment);
        return response(payment);
      }
      if (collection === "payments" && request.method === "PATCH") {
        const payment = state.payments.find((item) => item.id === id);
        if (!payment) return response({ message: "Not found" }, 404);
        Object.assign(payment, request.body);
        return response(payment);
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

function bodyOf(call) {
  return call.body;
}

async function testAuthorization() {
  for (const method of ["createInvoiceFromQuote", "createPayment", "confirmPayment"]) {
    const args = {
      createInvoiceFromQuote: { quoteId: "quote-1" },
      createPayment: { invoiceId: "invoice-1", method: "card", amount: 1 },
      confirmPayment: { paymentId: "payment-1" },
    }[method];

    for (const user of [null, { id: "member-1", organizationId: "org-1", role: "member" },
      { id: "admin-1", role: "admin" }]) {
      const h = harness(user);
      await assert.rejects(h.api[method](args), /admin atau setiausaha/,
        `${method} must require an organization admin or secretary`);
      assert.strictEqual(h.calls.length, 0, `${method} must reject unauthorized input before fetch`);
    }
  }

  const wrongQuoteOrg = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary" });
  wrongQuoteOrg.state.quote.organizationId = "org-2";
  await assert.rejects(wrongQuoteOrg.api.createInvoiceFromQuote({ quoteId: "quote-1" }), /tidak ditemui/);
  assert.strictEqual(wrongQuoteOrg.calls.filter((call) => call.method === "POST").length, 0);

  const wrongInvoiceOrg = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary" });
  wrongInvoiceOrg.state.invoices.push({ id: "invoice-1", organizationId: "org-2", amount: 100 });
  await assert.rejects(wrongInvoiceOrg.api.createPayment({ invoiceId: "invoice-1", method: "card", amount: 50 }), /tidak ditemui/);
  assert.strictEqual(wrongInvoiceOrg.calls.filter((call) => call.method === "POST").length, 0);

  const wrongPaymentOrg = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary" });
  wrongPaymentOrg.state.payments.push({ id: "payment-1", organizationId: "org-2", invoiceId: "invoice-1", status: "pending" });
  await assert.rejects(wrongPaymentOrg.api.confirmPayment({ paymentId: "payment-1" }), /tidak ditemui/);
  assert.strictEqual(wrongPaymentOrg.calls.filter((call) => call.method === "PATCH").length, 0);
}

async function testInvoiceCreationIsIdempotent() {
  const h = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary" });
  const first = await h.api.createInvoiceFromQuote({ quoteId: "quote-1", dueDays: 21 });

  assert.strictEqual(first.id, "invoice-1");
  assert.strictEqual(first.organizationId, "org-1");
  assert.strictEqual(first.quoteId, "quote-1");
  assert.strictEqual(first.amount, 1250);
  assert.strictEqual(first.status, "unpaid");
  assert.match(first.number, /^INV-\d{8}-[A-Z0-9]+$/);
  assert.match(first.dueAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(JSON.stringify(first.items), JSON.stringify(h.state.quote.items));
  assert.strictEqual(h.calls.filter((call) => call.method === "POST").length, 1);

  const second = await h.api.createInvoiceFromQuote({ quoteId: "quote-1", dueDays: 1 });
  assert.strictEqual(second.id, first.id, "repeating invoice creation returns the existing invoice");
  assert.strictEqual(h.state.invoices.length, 1, "repeating invoice creation does not duplicate records");
  assert.strictEqual(h.calls.filter((call) => call.method === "POST").length, 1,
    "idempotent invoice creation does not issue a second POST");
}

async function testPaymentValidation() {
  const h = harness({ id: "admin-1", organizationId: "org-1", role: "admin" });
  h.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 100 });

  for (const amount of [0, -1, 101, "not-a-number", NaN]) {
    await assert.rejects(
      h.api.createPayment({ invoiceId: "invoice-1", method: "card", amount }),
      /Jumlah bayaran tidak sah/,
      `payment amount ${String(amount)} must be rejected`
    );
  }
  await assert.rejects(
    h.api.createPayment({ invoiceId: "invoice-1", method: "cash", amount: 50 }),
    /Kaedah bayaran tidak disokong/
  );
  assert.strictEqual(h.calls.filter((call) => call.method === "POST").length, 0,
    "invalid payment input must not create a payment");

  const payment = await h.api.createPayment({
    invoiceId: "invoice-1", method: "bank_transfer", amount: 50, reference: "REF-123",
  });
  assert.strictEqual(payment.status, "pending");
  assert.strictEqual(payment.demo, true);
  assert.strictEqual(payment.paymentMode, "demo");
  assert.strictEqual(payment.amount, 50);
  assert.strictEqual(payment.method, "bank_transfer");
  assert.deepStrictEqual(bodyOf(h.calls.at(-1)), {
    organizationId: "org-1", invoiceId: "invoice-1", method: "bank_transfer",
    reference: "REF-123", amount: 50, status: "pending",
  });
}

async function testPaymentConfirmationUpdatesInvoice() {
  const h = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary" });
  h.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 100, status: "unpaid" });
  h.state.payments.push({ id: "payment-1", organizationId: "org-1", invoiceId: "invoice-1", amount: 100, status: "pending" });

  const result = await h.api.confirmPayment({
    paymentId: "payment-1", gatewayRef: "gateway-xyz", receiptUrl: "https://receipts.test/r-1",
  });
  assert.strictEqual(result.payment.status, "succeeded");
  assert.strictEqual(result.demo, true);
  assert.strictEqual(result.payment.paymentMode, "demo");
  assert.strictEqual(result.payment.gatewayRef, "gateway-xyz");
  assert.strictEqual(result.payment.receiptUrl, "https://receipts.test/r-1");
  assert.match(result.payment.paidAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(result.invoice.id, "invoice-1");
  assert.strictEqual(result.invoice.status, "paid");
  assert.match(result.invoice.paidAt, /^\d{4}-\d{2}-\d{2}T/);

  const patches = h.calls.filter((call) => call.method === "PATCH");
  assert.strictEqual(patches.length, 2, "confirmation updates both payment and invoice");
  assert.strictEqual(patches[0].path, "/api/collections/payments/records/payment-1");
  assert.strictEqual(patches[0].body.status, "succeeded");
  assert.strictEqual(patches[1].path, "/api/collections/invoices/records/invoice-1");
  assert.strictEqual(patches[1].body.status, "paid");
}

async function testBillplzRequestAndFallback() {
  const user = { id: "admin-1", organizationId: "org-1", role: "admin", name: "admin-1", email: "admin@example.test" };
  const bill = harness(user, { paymentDemo: true }, response({
    paymentId: "payment-1", billId: "bill-123", url: "https://www.billplz.com/bills/bill-123",
    apiKey: "SHOULD_NOT_BE_RETURNED",
  }, 201));
  bill.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 100, status: "unpaid" });
  bill.state.payments.push({ id: "payment-1", invoiceId: "invoice-1", organizationId: "org-1", status: "pending" });
  const real = await bill.api.requestBillplzBill({ invoiceId: "invoice-1", amount: 1,
    organizationId: "org-2", apiKey: "SHOULD_NOT_BE_SENT" });
  assert.strictEqual(real.billId, "bill-123");
  assert.strictEqual(real.billUrl, "https://www.billplz.com/bills/bill-123");
  assert.strictEqual(real.linkId, real.billId);
  assert.strictEqual(real.linkUrl, real.billUrl);
  assert.strictEqual(real.payment.status, "pending");
  assert.strictEqual(real.paymentMode, "billplz");
  assert.strictEqual(JSON.stringify(real).includes("SHOULD_NOT_BE_RETURNED"), false);
  assert.strictEqual(bill.calls.length, 3);
  assert.strictEqual(bill.calls[1].url, "/api/billplz/create-bill");
  assert.strictEqual(bill.calls[0].method, "GET");
  assert.strictEqual(bill.calls[1].method, "POST");
  assert.deepStrictEqual(bill.calls[1].body, {
    invoiceId: "invoice-1", amountSen: 10000, name: "admin-1", email: "admin@example.test",
    description: "AGMX invoice invoice-1",
  });
  assert.strictEqual(bill.calls[1].options.headers.Authorization, "Bearer test-token");
  assert.strictEqual(JSON.stringify(bill.calls[1]).includes("SHOULD_NOT_BE_SENT"), false);

  const demo = harness(user);
  demo.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 100, status: "unpaid" });
  const fallback = await demo.api.requestBillplzBill({ invoiceId: "invoice-1" });
  assert.strictEqual(fallback.demo, true);
  assert.strictEqual(fallback.payment.status, "pending");
  assert.strictEqual(fallback.billUrl, null);
  assert.strictEqual(demo.calls.filter((call) => call.method === "POST").length, 2);

  const disabled = harness(user, { paymentDemo: false });
  disabled.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 100, status: "unpaid" });
  await assert.rejects(disabled.api.requestBillplzBill({ invoiceId: "invoice-1" }), /belum dikonfigurasi/);
  assert.strictEqual(disabled.calls.length, 2);

  const wrongTenant = harness(user);
  wrongTenant.state.invoices.push({ id: "invoice-1", organizationId: "org-2", amount: 100, status: "unpaid" });
  await assert.rejects(wrongTenant.api.requestBillplzBill({ invoiceId: "invoice-1" }), /tidak ditemui/);
  assert.strictEqual(wrongTenant.calls.filter((call) => call.method === "POST").length, 0);
  for (const invalid of [null, { id: "member-1", organizationId: "org-1", role: "member" },
    { id: "admin-1", role: "admin" }]) {
    const h = harness(invalid);
    await assert.rejects(h.api.requestBillplzBill({ invoiceId: "invoice-1" }), /admin atau setiausaha/);
    assert.strictEqual(h.calls.length, 0);
  }
  const broken = harness(user, {}, response({ error: "Payment intent was not stored", debug: "SECRET" }, 502));
  broken.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 100, status: "unpaid" });
  await assert.rejects(broken.api.requestBillplzBill({ invoiceId: "invoice-1" }), /Niat bayaran/);
  assert.strictEqual(broken.calls.length, 2, "do not attempt demo after a bill may have been created");
}

async function testProviderNeutralLinks() {
  const user = { id: "secretary-1", organizationId: "org-1", role: "secretary",
    name: "Secretary", email: "staff@example.test" };
  const bill = harness(user, {}, response({ paymentId: "payment-1", billId: "bill-1",
    url: "https://billplz.test/bills/bill-1" }, 201));
  bill.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 25.50, status: "unpaid" });
  bill.state.payments.push({ id: "payment-1", invoiceId: "invoice-1", organizationId: "org-1", status: "pending" });
  const billLink = await bill.api.requestPaymentLink({ provider: "billplz", invoiceId: "invoice-1" });
  assert.strictEqual(billLink.linkId, "bill-1");
  assert.strictEqual(billLink.billId, "bill-1");
  assert.strictEqual(billLink.paymentMode, "billplz");
  assert.strictEqual(bill.calls[1].url, "/api/billplz/create-bill");
  assert.deepStrictEqual(bill.calls[1].body, { invoiceId: "invoice-1", amountSen: 2550,
    name: "Secretary", email: "staff@example.test", description: "AGMX invoice invoice-1" });

  const configured = harness({ id: "secretary-1", organizationId: "org-1", role: "secretary" },
    { paymentDemo: true }, undefined, response({
    paymentId: "payment-1", requestId: "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
    url: "https://securecheckout.sandbox.hit-pay.com/payment-request/@test/9ef68e2e-3569-4f69-9f68-04c7e4bb007c/checkout",
    apiKey: "SERVER_SECRET_MUST_NOT_LEAK",
  }, 201));
  configured.state.invoices.push({ id: "invoice1", organizationId: "org-1", amount: 25.50, status: "overdue" });
  configured.state.payments.push({ id: "payment-1", invoiceId: "invoice1",
    organizationId: "org-1", status: "pending" });
  const result = await configured.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice1",
    name: "Buyer", email: "buyer@example.test", description: "Invoice 1",
    apiKey: "CALLER_SECRET_MUST_NOT_LEAK", callbackUrl: "https://evil.test" });
  assert.strictEqual(result.linkId, "9ef68e2e-3569-4f69-9f68-04c7e4bb007c");
  assert.strictEqual(result.requestId, result.linkId);
  assert.strictEqual(result.linkUrl, "https://securecheckout.sandbox.hit-pay.com/payment-request/@test/9ef68e2e-3569-4f69-9f68-04c7e4bb007c/checkout");
  assert.strictEqual(result.paymentMode, "hitpay");
  assert.strictEqual(result.demo, false);
  assert.strictEqual(JSON.stringify(result).includes("SERVER_SECRET_MUST_NOT_LEAK"), false);
  assert.strictEqual(JSON.stringify(configured.calls).includes("CALLER_SECRET_MUST_NOT_LEAK"), false);
  assert.strictEqual(configured.calls[1].url, "/api/hitpay/create-payment");
  assert.strictEqual(configured.calls[1].options.headers.Authorization, "Bearer test-token");
  assert.deepStrictEqual(configured.calls[1].body, { invoiceId: "invoice1" });

  const demo = harness(user);
  demo.state.invoices.push({ id: "invoice1", organizationId: "org-1", amount: 25.50, status: "unpaid" });
  const fallback = await demo.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice1" });
  assert.strictEqual(fallback.demo, true);
  assert.strictEqual(fallback.linkUrl, null);
  assert.strictEqual(fallback.paymentMode, "demo");
  assert.strictEqual(fallback.payment.method, "card");
  assert.strictEqual(fallback.requestId, null);
  assert.strictEqual(demo.calls.filter(call => call.method === "POST").length, 2);

  for (const invalid of [undefined, "unknown", "__proto__", "billplz/../hitpay"]) {
    const h = harness(user);
    await assert.rejects(h.api.requestPaymentLink({ provider: invalid, invoiceId: "invoice-1" }), /Penyedia bayaran/);
    assert.strictEqual(h.calls.length, 0);
  }
  for (const unauthorized of [null, { id: "member", organizationId: "org-1", role: "member" }]) {
    const h = harness(unauthorized);
    await assert.rejects(h.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice-1" }), /admin atau setiausaha/);
    assert.strictEqual(h.calls.length, 0);
  }
  for (const invoice of [
    { organizationId: "org-2", amount: 10, status: "unpaid" },
    { organizationId: "org-1", amount: 10, status: "paid" },
    { organizationId: "org-1", amount: 0.001, status: "unpaid" },
  ]) {
    const h = harness(user);
    h.state.invoices.push({ id: "invoice-1", ...invoice });
    await assert.rejects(h.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice-1" }), /tidak ditemui|tidak layak/);
    assert.strictEqual(h.calls.filter(call => call.method === "POST").length, 0);
  }
  const disabled = harness(user, { paymentDemo: false });
  disabled.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 10, status: "unpaid" });
  await assert.rejects(disabled.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice-1" }), /belum dikonfigurasi/);
  assert.strictEqual(disabled.calls.filter(call => call.method === "POST").length, 1);

  const error = harness(user, {}, undefined, response({ error: "SECRET_GATEWAY_KEY" }, 502));
  error.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 10, status: "unpaid" });
  await assert.rejects(error.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice-1" }),
    err => !err.message.includes("SECRET_GATEWAY_KEY") && /Permintaan bayaran gagal/.test(err.message));
  assert.strictEqual(error.calls.filter(call => call.method === "POST").length, 1);

  const wrongShape = harness(user, {}, undefined, response({ paymentId: "payment-1",
    paymentLinkId: "legacy-id", url: "https://securecheckout.hit-pay.com/checkout" }, 201));
  wrongShape.state.invoices.push({ id: "invoice1", organizationId: "org-1", amount: 10, status: "unpaid" });
  await assert.rejects(wrongShape.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice1" }),
    /Respons pautan bayaran tidak lengkap/);
  assert.strictEqual(wrongShape.calls.length, 2, "wrong response shape must not trigger a demo retry");

  const unsafe = harness(user, {}, undefined, response({ paymentId: "payment-1",
    requestId: "hitpay-1", url: "https://secret:token@hitpay.test/pay" }, 201));
  unsafe.state.invoices.push({ id: "invoice-1", organizationId: "org-1", amount: 10, status: "unpaid" });
  await assert.rejects(unsafe.api.requestPaymentLink({ provider: "hitpay", invoiceId: "invoice-1" }),
    /Respons pautan bayaran tidak lengkap/);
  assert.strictEqual(unsafe.calls.length, 2, "unsafe link must not be returned or retried as demo");
}

async function run() {
  await testAuthorization();
  await testInvoiceCreationIsIdempotent();
  await testPaymentValidation();
  await testPaymentConfirmationUpdatesInvoice();
  await testBillplzRequestAndFallback();
  await testProviderNeutralLinks();
  console.log("commercial PocketBase methods: authorization, idempotency, validation, and confirmation passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
