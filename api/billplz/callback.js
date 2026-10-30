"use strict";

const s = require("./_shared");
const { verify } = require("./_signature");

module.exports = async function callback(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return s.send(res, 405, { error: "Method not allowed" });
  }
  try {
    const fields = await s.body(req, "application/x-www-form-urlencoded");
    if (!verify(fields, s.required("BILLPLZ_X_SIGNATURE_KEY"))) throw new s.HttpError(401, "Invalid signature");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(fields.id) ||
        fields.collection_id !== s.required("BILLPLZ_COLLECTION_ID") ||
        !/^[1-9]\d*$/.test(fields.amount) || !/^\d+$/.test(fields.paid_amount) ||
        !Number.isSafeInteger(Number(fields.amount)) || !Number.isSafeInteger(Number(fields.paid_amount)) ||
        !["true", "false"].includes(fields.paid) || !["due", "paid", "deleted"].includes(fields.state) ||
        (fields.paid === "true") !== (fields.state === "paid")) {
      throw new s.HttpError(400, "Invalid callback fields");
    }
    const admin = await s.pbAdmin();
    const filter = encodeURIComponent(`gatewayRef = "${fields.id}"`);
    const matches = await s.request(`${admin.base}/api/collections/payments/records?filter=${filter}&perPage=2`, {
      headers: { Authorization: admin.token },
    });
    if (!matches || !Array.isArray(matches.items) || matches.items.length !== 1 || matches.totalItems !== 1) {
      throw new s.HttpError(404, "Payment not found");
    }
    const payment = matches.items[0];
    if (!s.recordId(payment.invoiceId) || !payment.organizationId || payment.method !== "fpx" ||
        fields.amount !== String(s.ringgitToSen(payment.amount))) throw new s.HttpError(409, "Payment mismatch");
    const invoice = await s.pb(admin, "invoices", payment.invoiceId);
    if (!invoice || invoice.organizationId !== payment.organizationId ||
        fields.amount !== String(s.ringgitToSen(invoice.amount))) throw new s.HttpError(409, "Invoice mismatch");
    if (fields.paid === "true") {
      if (fields.paid_amount !== fields.amount || !fields.paid_at || Number.isNaN(Date.parse(fields.paid_at))) {
        throw new s.HttpError(400, "Invalid settlement details");
      }
      if (!["pending", "succeeded"].includes(payment.status) ||
          !["unpaid", "overdue", "paid"].includes(invoice.status) ||
          (invoice.status === "paid" && payment.status !== "succeeded")) {
        throw new s.HttpError(409, "Payment state conflict");
      }
      const paidAt = new Date(fields.paid_at).toISOString();
      if (payment.status !== "succeeded") {
        await s.pb(admin, "payments", payment.id, "PATCH", { status: "succeeded", paidAt });
      }
      if (invoice.status !== "paid") {
        await s.pb(admin, "invoices", invoice.id, "PATCH", { status: "paid", paidAt });
      }
    } else if (fields.state === "deleted" && payment.status === "pending") {
      await s.pb(admin, "payments", payment.id, "PATCH", { status: "failed" });
    }
    // A failed payment attempt leaves the Bill in "due"; keep the payment
    // pending, as a later attempt on the same Bill can still settle it.
    s.send(res, 200, { ok: true });
  } catch (error) { s.fail(res, error); }
};
