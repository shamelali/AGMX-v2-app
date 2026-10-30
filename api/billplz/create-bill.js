"use strict";

const s = require("./_shared");

module.exports = async function createBill(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return s.send(res, 405, { error: "Method not allowed" });
  }
  try {
    const input = await s.body(req, "application/json");
    s.exactFields(input, ["invoiceId", "amountSen", "name", "email", "description"],
      ["invoiceId", "amountSen", "name", "email", "description"]);
    if (!s.recordId(input.invoiceId)) throw new s.HttpError(400, "Invalid invoiceId");
    const amountSen = s.sen(input.amountSen);
    const name = s.text(input.name, 255, "name");
    const email = s.text(input.email, 254, "email");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new s.HttpError(400, "Invalid email");
    const description = s.text(input.description, 200, "description");
    const user = await s.userContext(req);
    const admin = await s.pbAdmin();
    const invoice = await s.pb(admin, "invoices", input.invoiceId);
    if (!invoice || invoice.organizationId !== user.organizationId) throw new s.HttpError(404, "Invoice not found");
    if (invoice.status !== "unpaid" && invoice.status !== "overdue") throw new s.HttpError(409, "Invoice is not payable");
    if (s.ringgitToSen(invoice.amount) !== amountSen) throw new s.HttpError(409, "Amount does not match invoice");

    const base = s.baseUrl("BILLPLZ_API_BASE_URL", "https://www.billplz.com/api");
    const callbackUrl = s.required("BILLPLZ_CALLBACK_URL");
    const parsedCallback = new URL(callbackUrl);
    if (parsedCallback.protocol !== "https:" || parsedCallback.username || parsedCallback.password ||
        parsedCallback.hash || parsedCallback.search) throw new s.HttpError(503, "Invalid callback URL");
    const collectionId = s.required("BILLPLZ_COLLECTION_ID");
    s.required("BILLPLZ_X_SIGNATURE_KEY");
    const key = s.required("BILLPLZ_API_KEY");

    // Reuse the existing assigned bill; requests must never create a second
    // payable Billplz bill for an already invoiced, pending gateway payment.
    const filter = encodeURIComponent(`invoiceId = "${input.invoiceId}" && method = "fpx"`);
    const existing = await s.request(`${admin.base}/api/collections/payments/records?filter=${filter}&perPage=100`, {
      headers: { Authorization: admin.token },
    });
    if (!existing || !Array.isArray(existing.items) || existing.totalItems > 100) throw new s.HttpError(409, "Payment review required");
    if (existing.items.some(p => p.status === "succeeded" || p.status === "pending")) {
      throw new s.HttpError(409, "An existing payment must be reconciled first");
    }

    const payment = await s.pb(admin, "payments", null, "POST", {
      organizationId: user.organizationId, invoiceId: invoice.id, method: "fpx",
      amount: amountSen / 100, status: "pending", reference: "billplz",
    });
    if (!payment || !s.recordId(payment.id)) throw new s.HttpError(502, "Payment intent was not stored");
    const payload = {
      collection_id: collectionId, amount: amountSen, name, email, description,
      callback_url: callbackUrl, reference_1_label: "Payment ID", reference_1: payment.id,
    };
    const bill = await s.request(`${base}/v3/bills`, {
      method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!bill || typeof bill.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(bill.id) ||
        bill.collection_id !== collectionId || bill.amount !== amountSen || typeof bill.url !== "string" ||
        new URL(bill.url).protocol !== "https:" || new URL(bill.url).hostname !== new URL(base).hostname) {
      throw new s.HttpError(502, "Invalid Billplz bill response");
    }
    await s.pb(admin, "payments", payment.id, "PATCH", { gatewayRef: bill.id });
    s.send(res, 201, { paymentId: payment.id, billId: bill.id, url: bill.url });
  } catch (error) { s.fail(res, error); }
};
