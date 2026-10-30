"use strict";

const s = require("./_shared");

module.exports = async function createPayment(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return s.send(res, 405, { error: "Method not allowed" });
  }
  try {
    const input = await s.inputBody(req);
    if (Object.keys(input).length !== 1 || !s.recordId(input.invoiceId)) {
      throw new s.HttpError(400, "Invalid invoiceId");
    }
    const user = await s.userContext(req);
    const admin = await s.pbAdmin();
    const invoice = await s.pb(admin, "invoices", input.invoiceId);
    if (!invoice || invoice.organizationId !== user.organizationId) throw new s.HttpError(404, "Invoice not found");
    if (!["unpaid", "overdue"].includes(invoice.status)) throw new s.HttpError(409, "Invoice is not payable");
    const amount = s.cents(invoice.amount);
    if (amount < 30 || amount > 99999999999) throw new s.HttpError(409, "Invoice amount is outside HitPay limits");

    const base = s.serviceUrl("HITPAY_API_BASE_URL", "https://api.hit-pay.com");
    s.webhookUrl(); // Ensure the dashboard event endpoint is configured before issuing requests.
    s.required("HITPAY_SALT");
    const key = s.required("HITPAY_API_KEY");
    const currency = s.currency();

    // Block a new checkout when *any* gateway already has an outstanding or
    // succeeded payment for this invoice. Uncertain orphaned requests need review.
    const filter = encodeURIComponent(`invoiceId = "${invoice.id}"`);
    const existing = await s.request(`${admin.base}/api/collections/payments/records?filter=${filter}&perPage=100`, {
      headers: { Authorization: admin.token },
    });
    if (!existing || !Array.isArray(existing.items) || !Number.isSafeInteger(existing.totalItems) ||
        existing.totalItems > 100 || existing.items.some(p => ["pending", "succeeded"].includes(p.status))) {
      throw new s.HttpError(409, "An existing payment must be reconciled first");
    }

    // PocketBase's current method enum has no HitPay option. Limit the hosted
    // checkout to cards so the recorded payment method remains accurate.
    const payment = await s.pb(admin, "payments", null, "POST", {
      organizationId: user.organizationId, invoiceId: invoice.id, method: "card",
      amount: amount / 100, status: "pending", reference: "hitpay",
    });
    if (!payment || !s.recordId(payment.id)) throw new s.HttpError(502, "Payment intent was not stored");
    const created = await s.request(`${base}/v1/payment-requests`, {
      method: "POST", headers: { "X-BUSINESS-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amount / 100, currency, reference_number: payment.id,
        purpose: `Invoice ${invoice.number || invoice.id}`, payment_methods: ["card"],
        allow_repeated_payments: "false" }),
    });
    if (!created || typeof created.id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(created.id) ||
        created.reference_number !== payment.id || created.status !== "pending" ||
        typeof created.currency !== "string" || created.currency.toUpperCase() !== currency ||
        (created.allow_repeated_payments !== undefined && created.allow_repeated_payments !== false) ||
        typeof created.url !== "string") {
      throw new s.HttpError(502, "Invalid HitPay payment request response");
    }
    let responseAmount;
    try { responseAmount = s.gatewayAmount(created.amount); } catch { throw new s.HttpError(502, "Invalid HitPay payment request response"); }
    if (responseAmount !== amount) throw new s.HttpError(502, "Invalid HitPay payment request response");
    let checkout;
    try { checkout = new URL(created.url); } catch { throw new s.HttpError(502, "Invalid checkout URL"); }
    const expectedHost = new URL(base).hostname === "api.sandbox.hit-pay.com"
      ? "securecheckout.sandbox.hit-pay.com" : "securecheckout.hit-pay.com";
    if (checkout.protocol !== "https:" || checkout.hostname !== expectedHost || checkout.username ||
        checkout.password || !checkout.pathname.includes(created.id)) throw new s.HttpError(502, "Invalid checkout URL");
    await s.pb(admin, "payments", payment.id, "PATCH", { gatewayRef: created.id });
    s.send(res, 201, { paymentId: payment.id, requestId: created.id, url: created.url });
  } catch (error) { s.fail(res, error); }
};
