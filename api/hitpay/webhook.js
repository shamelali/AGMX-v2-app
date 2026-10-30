"use strict";

const s = require("./_shared");
const { verify } = require("./_signature");

module.exports = async function webhook(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return s.send(res, 405, { error: "Method not allowed" });
  }
  try {
    const raw = await s.rawBody(req);
    if (!verify(raw, req.headers["hitpay-signature"], s.required("HITPAY_SALT"))) {
      throw new s.HttpError(401, "Invalid signature");
    }
    const eventObject = req.headers["hitpay-event-object"];
    const eventType = req.headers["hitpay-event-type"];
    if (eventObject !== "payment_request" || !["completed", "failed"].includes(eventType)) {
      throw new s.HttpError(400, "Unsupported event");
    }
    const data = s.json(raw);
    if (typeof data.id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(data.id) ||
        !s.recordId(data.reference_number) ||
        typeof data.currency !== "string" || data.currency.toUpperCase() !== s.currency() ||
        data.status !== eventType) throw new s.HttpError(400, "Invalid event fields");
    const amount = s.gatewayAmount(data.amount);
    if (data.allow_repeated_payments !== undefined && data.allow_repeated_payments !== false) {
      throw new s.HttpError(409, "Repeated payment request not supported");
    }

    const admin = await s.pbAdmin();
    // The immutable, signed local reference must resolve to the assigned
    // request ID. An unassigned reference is retried after creation completes.
    const payment = await s.pb(admin, "payments", data.reference_number);
    if (!payment || payment.id !== data.reference_number || payment.reference !== "hitpay" || payment.method !== "card" ||
        payment.gatewayRef !== data.id || !s.recordId(payment.invoiceId) ||
        !s.recordId(payment.organizationId) || s.cents(payment.amount) !== amount) {
      throw new s.HttpError(409, "Payment mismatch");
    }
    const invoice = await s.pb(admin, "invoices", payment.invoiceId);
    if (!invoice || invoice.organizationId !== payment.organizationId || s.cents(invoice.amount) !== amount) {
      throw new s.HttpError(409, "Invoice mismatch");
    }
    if (eventType === "completed") {
      if (!["pending", "succeeded"].includes(payment.status) ||
          !["unpaid", "overdue", "paid"].includes(invoice.status) ||
          (invoice.status === "paid" && payment.status !== "succeeded")) {
        throw new s.HttpError(409, "Payment state conflict");
      }
      const paidAt = payment.paidAt || new Date().toISOString();
      if (payment.status !== "succeeded") {
        await s.pb(admin, "payments", payment.id, "PATCH", { status: "succeeded", paidAt });
      }
      if (invoice.status !== "paid") {
        await s.pb(admin, "invoices", invoice.id, "PATCH", { status: "paid", paidAt });
      }
    } else {
      if (payment.status === "pending" && ["unpaid", "overdue"].includes(invoice.status)) {
        await s.pb(admin, "payments", payment.id, "PATCH", { status: "failed" });
      } else if (payment.status !== "failed" || !["unpaid", "overdue"].includes(invoice.status)) {
        throw new s.HttpError(409, "Payment state conflict");
      }
    }
    s.send(res, 200, { ok: true });
  } catch (error) { s.fail(res, error); }
};
