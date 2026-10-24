/* ============================================================
   AGMX — Commerce API Layer (Sprint 2 · Money Flow)
   Lead → Assessment → Quote → Invoice → Payment → AGM scheduled

   One async interface, two adapters:
     * LocalAdapter      — localStorage persistence (demo mode, default)
     * PocketBaseAdapter — calls the server-side money-flow routes in
                           pb_hooks/money_flow.pb.js (see pocketbase/README.md).
                           All commercial invariants — document numbering,
                           pricing, double-payment guard, audit chain — are
                           enforced SERVER-SIDE in the hook, never here.

   Global name: window.AGMX_COMMERCE
   (window.AGMX_API is owned by pocketbase-client.js — the dashboard
   query layer. The two must not collide.)

   Configuration (first match wins):
     1. window.AGMX_CONFIG = { mode: "pocketbase", url }   (config.js)
        — or { url, demoMode: false } which implies pocketbase mode
     2. localStorage "agmx_backend_cfg"  (set from leads.html → Tetapan Backend)
     3. default: { mode: "local" }

   Operator auth: PocketBaseAdapter reuses the session token stored by
   pocketbase-client.js (localStorage "pb_token"). Operator-only calls
   (deals, metrics, stage changes, payment confirmation) throw a clear
   error when no operator is logged in — they never fail silently.

   Prospect auth: checkout links carry an unguessable token
   (?ref=LD-0007&t=…) minted at assessment submission; the hook compares
   it before exposing or mutating that lead's documents.

   Browser:  <script src="api.js"></script>   →  window.AGMX_COMMERCE
   Node:     const AGMX_COMMERCE = require("./api.js")   (tools/test_money_flow.mjs)

   NOTE (red-team honesty): in local mode nothing leaves the browser and
   the payment gateway is simulated. In PocketBase mode fpx/card payments
   are recorded as PENDING unless the server runs with
   AGMX_ALLOW_SIMULATED_PAYMENTS=1 (demo instances only); production
   confirmation is the gateway webhook → POST /api/agmx/payment/confirm.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AGMX_COMMERCE = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  /* ---------- storage shim (browser localStorage / node memory) ---------- */
  const store = (function () {
    if (typeof localStorage !== "undefined" && localStorage !== null) return localStorage;
    const mem = new Map(); // node (tests) — per-process only
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
    };
  })();

  const KEYS = {
    leads: "agmx_leads_v1",      // shared with assessment.js (demo continuity)
    quotes: "agmx_quotes_v1",
    invoices: "agmx_invoices_v1",
    payments: "agmx_payments_v1",
    audit: "agmx_audit_v1",
    cfg: "agmx_backend_cfg",
  };

  const TAX_RATE = 0.08;          // SST 8% on services — shown separately on the invoice
  const QUOTE_VALID_DAYS = 30;    // quote valid for 30 days
  const INVOICE_DUE_DAYS = 14;    // payment terms: net 14 days

  /* Sales pipeline stages (BM — matches assessment.html pipeline chips) */
  const STAGES = [
    "Assessment Diterima",
    "Dihubungi",
    "Sebut Harga Dihantar",
    "Sebut Harga Diterima",
    "Dibayar",
    "AGM Dijadualkan",
  ];

  const PAYMENT_METHODS = {
    fpx: "FPX (Perbankan Dalam Talian)",
    card: "Kad Kredit / Debit",
    bank_transfer: "Pemindahan Bank (Manual)",
  };

  /* ---------- helpers ---------- */
  const readArr = (k) => { try { return JSON.parse(store.getItem(k)) || []; } catch (e) { return []; } };
  const writeArr = (k, v) => store.setItem(k, JSON.stringify(v));
  /* monotonic sequence: keeps same-millisecond audit events in order */
  let _seq = (function () {
    const log = readArr(KEYS.audit);
    return log.reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0);
  })();
  const pad = (n, w) => String(n).padStart(w, "0");
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const RM = (n) =>
    "RM" + Number(n).toLocaleString("ms-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const nowIso = () => new Date().toISOString();

  /* Unclassified random token (checkout links ?t=…). Browser crypto when
     available; Math.random fallback is fine for the local demo only. */
  function randToken(len) {
    const n = len || 24;
    try {
      const c = (typeof crypto !== "undefined") ? crypto : null;
      if (c && c.getRandomValues) {
        const b = new Uint8Array(n);
        c.getRandomValues(b);
        return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, n);
      }
    } catch (e) { /* fall through */ }
    let s = "";
    while (s.length < n) s += Math.random().toString(16).slice(2);
    return s.slice(0, n);
  }

  /* CSV cell escaper — RFC4180 quoting PLUS formula-injection guard.
     A cell starting with = + - @ (or tab/CR) executes as a formula in
     Excel/Sheets when the CSV is opened, so prefix it with a single quote. */
  function csvEscape(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* Next human reference in a list, e.g. nextRef("LD-", leads) → LD-0007
     DEMO ONLY — in PocketBase mode document numbers are minted server-side
     (pb_hooks/money_flow.pb.js) so two browsers can never collide. */
  function nextRef(prefix, list) {
    let max = 0;
    for (const it of list) {
      const m = /(\d+)$/.exec(String(it.id || it.number || ""));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return prefix + pad(max + 1, 4);
  }

  /* Year-scoped document number, e.g. QT-2026-003 */
  function nextDocNumber(prefix, list) {
    const yr = new Date().getFullYear();
    let max = 0;
    for (const it of list) {
      const m = new RegExp("^" + prefix + yr + "-(\\d+)$").exec(String(it.number || ""));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return prefix + yr + "-" + pad(max + 1, 3);
  }

  /* ============================================================
     LOCAL ADAPTER (demo — persists in this browser only)
     ============================================================ */
  const LocalAdapter = {

    /* ----- diagnostics ----- */
    async status() {
      return { mode: "local", ok: true, label: "Demo Tempatan (localStorage)" };
    },

    /* ----- leads / assessments ----- */
    async submitAssessment(p) {
      const leads = readArr(KEYS.leads);
      const lead = {
        /* identity */
        id: nextRef("LD-", leads),
        checkoutToken: randToken(24),   /* same semantics as the PB hook */
        createdAt: nowIso(),
        stage: STAGES[0],
        /* cooperative profile */
        coopName: p.coopName || "",
        coopReg: p.coopReg || "",
        state: p.state || "",
        members: Number(p.members) || 0,
        agmDate: p.agmDate || "",
        mode: p.mode || "hybrid",
        attendance: Number(p.attendance) || 0,
        candidates: Number(p.candidates) || 0,
        motions: Number(p.motions) || 0,
        process: p.process || "mixed",
        managed: !!p.managed,
        /* scoring outcome */
        score: Number(p.score) || 0,
        factors: p.factors || [],
        pkgKey: p.pkgKey || "",
        pkgName: p.pkgName || "",
        pkgPrice: Number(p.pkgPrice) || 0,
        quote: Number(p.pkgPrice) || Number(p.quote) || 0,   /* legacy field used by assessment.js table */
        /* contact */
        contactName: p.contactName || "",
        contactPhone: p.contactPhone || "",
        contactEmail: p.contactEmail || "",
        /* linked commercial docs (filled in by the money flow) */
        quoteId: null,
        invoiceId: null,
        paymentId: null,
      };
      leads.unshift(lead);
      writeArr(KEYS.leads, leads);
      this._audit("assessment.submitted", "lead", lead.id, {
        coop: lead.coopName, score: lead.score, package: lead.pkgName,
      });
      return lead;
    },

    async listAssessments() {
      return readArr(KEYS.leads).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    async getAssessment(ref) {
      return readArr(KEYS.leads).find((l) => l.id === ref) || null;
    },

    /* Full deal (lead + commercial docs) for one reference — used by
       checkout.html to resume exactly where the prospect left off. */
    async getDeal(ref) {
      const lead = await this.getAssessment(ref);
      if (!lead) return null;
      const quote = readArr(KEYS.quotes).find((q) => q.leadRef === lead.id) || null;
      const invoice = readArr(KEYS.invoices).find((i) => i.leadRef === lead.id) || null;
      const payment = readArr(KEYS.payments).find((p) => p.leadRef === lead.id) || null;
      return {
        lead, quote, invoice, payment,
        quoteTotal: quote ? quote.total : 0,
        paidTotal: payment && payment.status === "succeeded" ? payment.amount : 0,
      };
    },

    async updateLeadStage(ref, stage) {
      const leads = readArr(KEYS.leads);
      const lead = leads.find((l) => l.id === ref);
      if (!lead) throw new Error("Lead tidak dijumpai: " + ref);
      const from = lead.stage;
      lead.stage = stage;
      writeArr(KEYS.leads, leads);
      this._audit("lead.stage_changed", "lead", ref, { from, to: stage });
      return lead;
    },

    /* ----- quotes ----- */
    async createQuote(input) {
      /* input: { leadRef, items: [{ description, qty, unitPrice }] } */
      const leads = readArr(KEYS.leads);
      const lead = leads.find((l) => l.id === input.leadRef);
      if (!lead) throw new Error("Lead tidak dijumpai: " + input.leadRef);

      const quotes = readArr(KEYS.quotes);
      const items = (input.items || []).map((it) => {
        const qty = Math.max(1, Number(it.qty) || 1);
        const unitPrice = round2(it.unitPrice);
        return {
          description: it.description,
          qty,
          unitPrice,
          lineTotal: round2(qty * unitPrice),
        };
      });
      if (!items.length) throw new Error("Sebut harga mesti ada sekurang-kurangnya satu item.");

      const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));
      const tax = round2(subtotal * TAX_RATE);
      const total = round2(subtotal + tax);

      const quote = {
        id: nextDocNumber("QT-", quotes),   /* id === number (QT-YYYY-NNN) */
        number: nextDocNumber("QT-", quotes),
        leadRef: lead.id,
        items,
        subtotal, tax, taxRate: TAX_RATE, total,
        currency: "MYR",
        status: "sent",                 // self-serve flow: visible to the lead immediately
        validUntil: addDays(QUOTE_VALID_DAYS),
        createdAt: nowIso(),
        acceptedAt: null,
      };
      quote.id = quote.number;
      quotes.unshift(quote);
      writeArr(KEYS.quotes, quotes);

      lead.quoteId = quote.number;
      lead.stage = STAGES[2];          // "Sebut Harga Dihantar"
      writeArr(KEYS.leads, leads);

      this._audit("quote.created", "quote", quote.number, {
        lead: lead.id, total, items: items.length,
      });
      return quote;
    },

    async getQuote(id) {
      return readArr(KEYS.quotes).find((q) => q.number === id || q.id === id) || null;
    },

    async acceptQuote(id) {
      const quotes = readArr(KEYS.quotes);
      const quote = quotes.find((q) => q.number === id || q.id === id);
      if (!quote) throw new Error("Sebut harga tidak dijumpai: " + id);
      if (quote.status === "accepted") return quote;
      quote.status = "accepted";
      quote.acceptedAt = nowIso();
      writeArr(KEYS.quotes, quotes);

      const leads = readArr(KEYS.leads);
      const lead = leads.find((l) => l.id === quote.leadRef);
      if (lead) { lead.stage = STAGES[3]; writeArr(KEYS.leads, leads); } // "Sebut Harga Diterima"

      this._audit("quote.accepted", "quote", quote.number, { lead: quote.leadRef, total: quote.total });
      return quote;
    },

    /* ----- invoices ----- */
    async createInvoice(quoteId) {
      const quote = await this.getQuote(quoteId);
      if (!quote) throw new Error("Sebut harga tidak dijumpai: " + quoteId);

      const invoices = readArr(KEYS.invoices);
      const invoice = {
        id: nextRef("INV-", invoices),
        number: nextDocNumber("INV-", invoices),
        quoteId: quote.number,
        leadRef: quote.leadRef,
        amount: quote.total,
        currency: "MYR",
        status: "unpaid",
        issuedAt: today(),
        dueAt: addDays(INVOICE_DUE_DAYS),
        paidAt: null,
      };
      invoices.unshift(invoice);
      writeArr(KEYS.invoices, invoices);

      const leads = readArr(KEYS.leads);
      const lead = leads.find((l) => l.id === quote.leadRef);
      if (lead) { lead.invoiceId = invoice.number; writeArr(KEYS.leads, leads); }

      this._audit("invoice.created", "invoice", invoice.number, {
        quote: quote.number, amount: invoice.amount, due: invoice.dueAt,
      }, quote.leadRef);
      return invoice;
    },

    async getInvoice(id) {
      return readArr(KEYS.invoices).find((i) => i.number === id || i.id === id) || null;
    },

    /* ----- payments -----
       method: fpx | card | bank_transfer
         * fpx / card           → simulated gateway, succeeds instantly (demo)
         * bank_transfer        → status "pending" until an operator verifies
                                  (LocalAdapter.confirmPayment / PB hook)
    */
    async payInvoice(invoiceId, opts) {
      const opts2 = opts || {};
      const invoices = readArr(KEYS.invoices);
      const invoice = invoices.find((i) => i.number === invoiceId || i.id === invoiceId);
      if (!invoice) throw new Error("Invois tidak dijumpai: " + invoiceId);
      if (invoice.status === "paid") throw new Error("Invois sudah dibayar.");

      const method = opts2.method || "fpx";
      if (!PAYMENT_METHODS[method]) throw new Error("Kaedah pembayaran tidak sah: " + method);
      const pending = method === "bank_transfer";
      const reference =
        opts2.reference ||
        (pending
          ? "TRF-" + Date.now().toString(36).toUpperCase()
          : method.toUpperCase() + Date.now().toString(36).toUpperCase());

      const payments = readArr(KEYS.payments);
      const payment = {
        id: nextRef("PAY-", payments),
        invoiceId: invoice.number,
        leadRef: invoice.leadRef,
        method,
        methodLabel: PAYMENT_METHODS[method],
        reference,
        amount: Number(opts2.amount) || invoice.amount,
        currency: "MYR",
        status: pending ? "pending" : "succeeded",
        paidAt: pending ? null : nowIso(),
        createdAt: nowIso(),
      };
      payments.unshift(payment);
      writeArr(KEYS.payments, payments);

      if (!pending) {
        invoice.status = "paid";
        invoice.paidAt = payment.paidAt;
        writeArr(KEYS.invoices, invoices);

        const leads = readArr(KEYS.leads);
        const lead = leads.find((l) => l.id === invoice.leadRef);
        if (lead) {
          lead.paymentId = payment.id;
          lead.stage = STAGES[4];      // "Dibayar"
          writeArr(KEYS.leads, leads);
        }
      }

      this._audit(pending ? "payment.pending_verification" : "payment.succeeded", "payment", payment.id, {
        invoice: invoice.number, method, reference, amount: payment.amount,
      }, invoice.leadRef);
      return payment;
    },

    /* Operator verifies a pending (bank-transfer) payment. */
    async confirmPayment(paymentId) {
      const payments = readArr(KEYS.payments);
      const payment = payments.find((p) => p.id === paymentId);
      if (!payment) throw new Error("Pembayaran tidak dijumpai: " + paymentId);
      if (payment.status !== "pending") return payment;
      payment.status = "succeeded";
      payment.paidAt = nowIso();
      writeArr(KEYS.payments, payments);

      const invoices = readArr(KEYS.invoices);
      const invoice = invoices.find((i) => i.number === payment.invoiceId);
      if (invoice) {
        invoice.status = "paid";
        invoice.paidAt = payment.paidAt;
        writeArr(KEYS.invoices, invoices);
      }
      const leads = readArr(KEYS.leads);
      const lead = leads.find((l) => l.id === payment.leadRef);
      if (lead) { lead.paymentId = payment.id; lead.stage = STAGES[4]; writeArr(KEYS.leads, leads); }

      this._audit("payment.succeeded", "payment", payment.id, {
        invoice: payment.invoiceId, method: payment.method,
        reference: payment.reference, amount: payment.amount, confirmedBy: "operator",
      }, payment.leadRef);
      return payment;
    },

    async listPayments(leadRef) {
      const all = readArr(KEYS.payments);
      return leadRef ? all.filter((p) => p.leadRef === leadRef) : all;
    },

    /* ----- aggregate view for the operator inbox ----- */
    async listDeals() {
      const leads = await this.listAssessments();
      const quotes = readArr(KEYS.quotes);
      const invoices = readArr(KEYS.invoices);
      const payments = readArr(KEYS.payments);
      return leads.map((l) => {
        const quote = quotes.find((q) => q.leadRef === l.id) || null;
        const invoice = invoices.find((i) => i.leadRef === l.id) || null;
        const payment = payments.find((p) => p.leadRef === l.id) || null;
        return {
          lead: l, quote, invoice, payment,
          quoteTotal: quote ? quote.total : 0,
          paidTotal: payment && payment.status === "succeeded" ? payment.amount : 0,
        };
      });
    },

    async metrics() {
      const deals = await this.listDeals();
      const leads = deals.length;
      const quoted = deals.filter((d) => d.quote).length;
      const paid = deals.filter((d) => d.paidTotal > 0).length;
      return {
        leads,
        quoted,
        paid,
        pipelineValue: round2(deals.reduce((s, d) => s + (d.quote ? d.quoteTotal : d.pkgPrice), 0)),
        collectedValue: round2(deals.reduce((s, d) => s + d.paidTotal, 0)),
        quoteRate: leads ? Math.round((quoted / leads) * 100) : 0,
        closeRate: quoted ? Math.round((paid / quoted) * 100) : 0,
      };
    },

    /* ----- audit trail ----- */
    async audit(leadRef) {
      const all = readArr(KEYS.audit);
      return (leadRef ? all.filter((e) => e.leadRef === leadRef) : all)
        .sort((a, b) => (a.seq < b.seq ? 1 : -1));
    },

    _audit(event, entityType, entityId, detail, leadRef) {
      const log = readArr(KEYS.audit);
      const entry = {
        id: "EVT-" + pad(log.length + 1, 5),
        seq: ++_seq,
        ts: nowIso(),
        event,
        entityType,
        entityId,
        leadRef: leadRef || (detail && detail.lead) || (entityType === "lead" ? entityId : null),
        detail: detail || {},
      };
      log.unshift(entry);
      writeArr(KEYS.audit, log);
      return entry;
    },
  };

  /* ============================================================
     POCKETBASE ADAPTER (production path)
     Talks to pb_hooks/money_flow.pb.js — every commercial invariant
     (numbering, pricing, double-pay guard, audit hash-chain) lives in
     the hook, so this adapter is a thin, trust-free transport.
     ============================================================ */
  const PocketBaseAdapter = {
    mode: "pocketbase",
    url: "",

    /* prospect context for token-gated calls (set from checkout.html ?ref&t) */
    _ctx: { ref: null, token: null },

    setLeadContext(ref, token) {
      this._ctx = { ref: ref || null, token: token || null };
    },

    /* operator session token — minted by login.js / pocketbase-client.js */
    _authToken() {
      try {
        if (typeof window !== "undefined" && window.AGMX_PB && window.AGMX_PB.authToken) {
          return window.AGMX_PB.authToken;
        }
        return store.getItem("pb_token") || "";
      } catch (e) { return ""; }
    },

    async _req(method, path, body, opts) {
      const o = opts || {};
      const url = this.url.replace(/\/+$/, "") + "/api/agmx" + path;
      const headers = { "Content-Type": "application/json" };
      const auth = this._authToken();
      if (auth) headers["Authorization"] = auth;
      let res;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new Error("PocketBase tidak dapat dihubungi (" + this.url + ").");
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text.slice(0, 200) }; }
      if (!res.ok) {
        const msg = (data && (data.message || data.error)) || ("HTTP " + res.status);
        throw new Error(msg);
      }
      return data;
    },

    /* query string with prospect token + operator-independent params */
    _qs(params) {
      const p = Object.assign({}, params || {});
      if (this._ctx.token && p.t === undefined) p.t = this._ctx.token;
      const q = Object.keys(p)
        .filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== "")
        .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(p[k]))
        .join("&");
      return q ? "?" + q : "";
    },

    async status() {
      if (!this.url) return { mode: "pocketbase", ok: false, label: "PocketBase (tidak dikonfigurasi)" };
      try {
        const res = await fetch(this.url.replace(/\/+$/, "") + "/api/health");
        return {
          mode: "pocketbase",
          ok: res.ok,
          label: res.ok ? "PocketBase Live" : "PocketBase (tidak sihat)",
        };
      } catch (e) {
        return { mode: "pocketbase", ok: false, label: "PocketBase (tidak dapat dihubungi)" };
      }
    },

    /* ----- leads ----- */
    async submitAssessment(p) {
      const out = await this._req("POST", "/assessment", { assessment: p });
      return out.lead;
    },

    async listAssessments() {
      /* Operator-only view (other people's contact details are PII —
         anonymous visitors get an empty list, not a data leak). */
      if (!this._authToken()) return [];
      const out = await this._req("GET", "/deals");
      return out.deals.map((d) => d.lead);
    },

    async getAssessment(ref) {
      const deal = await this.getDeal(ref);
      return deal ? deal.lead : null;
    },

    async getDeal(ref) {
      const r = ref || this._ctx.ref;
      if (!r) throw new Error("Rujukan lead diperlukan.");
      const out = await this._req("GET", "/lead" + this._qs({ ref: r }));
      return out.deal;
    },

    async updateLeadStage(ref, stage) {
      const out = await this._req("POST", "/lead/stage", { ref, stage });
      return out.lead;
    },

    /* ----- quotes ----- */
    async createQuote(input) {
      /* Server re-prices from the plans collection + rate card; the
         client-proposed items are ignored (tamper-proof totals). */
      const out = await this._req("POST", "/quote" + this._qs({}), {
        ref: input.leadRef || this._ctx.ref,
        packageKey: input.packageKey || null,
        addons: input.addons || [],
      });
      return out.quote;
    },

    async getQuote(id) {
      const out = await this._req("GET", "/quote" + this._qs({ number: id }));
      return out.quote;
    },

    async acceptQuote(id) {
      const out = await this._req("POST", "/quote/accept" + this._qs({}), { number: id });
      return out.quote;
    },

    /* ----- invoices ----- */
    async createInvoice(quoteId) {
      const out = await this._req("POST", "/invoice" + this._qs({}), { quoteNumber: quoteId });
      return out.invoice;
    },

    async getInvoice(id) {
      const out = await this._req("GET", "/invoice" + this._qs({ number: id }));
      return out.invoice;
    },

    /* ----- payments ----- */
    async payInvoice(invoiceId, opts) {
      const o = opts || {};
      const out = await this._req("POST", "/payment" + this._qs({}), {
        invoiceNumber: invoiceId,
        method: o.method || "fpx",
        reference: o.reference || null,
      });
      return out.payment;
    },

    async confirmPayment(paymentId) {
      const out = await this._req("POST", "/payment/confirm" + this._qs({}), { paymentId });
      return out.payment;
    },

    /* Billplz hosted-payment link. The server creates the bill and returns a
       URL; the browser is redirected there. The API key never reaches the
       client — it is read from the environment inside the hook. */
    async createPaymentLink(invoiceNumber) {
      const out = await this._req("POST", "/payment/link" + this._qs({}), { invoiceNumber });
      return out;
    },

    async listPayments(leadRef) {
      const deal = leadRef ? await this.getDeal(leadRef) : null;
      return deal && deal.payment ? [deal.payment] : [];
    },

    /* ----- operator aggregates ----- */
    async listDeals() {
      this._requireOperator();
      const out = await this._req("GET", "/deals");
      return out.deals;
    },

    async metrics() {
      this._requireOperator();
      const out = await this._req("GET", "/deals");
      return out.metrics;   /* computed server-side — no more hardcoded zeros */
    },

    async audit(leadRef) {
      if (!leadRef && !this._authToken()) return [];
      const out = await this._req("GET", "/audit" + this._qs({ ref: leadRef || "" }));
      return out.events;
    },

    _requireOperator() {
      if (!this._authToken()) {
        throw new Error("Perlu log masuk sebagai operator (admin/setiausaha) di app.html.");
      }
    },
  };

  /* ============================================================
     Boot: resolve configuration and pick the adapter
     ============================================================ */
  function readCfg() {
    if (typeof window !== "undefined" && window.AGMX_CONFIG) {
      const c = window.AGMX_CONFIG;
      if (c.mode === "pocketbase" && c.url) return { mode: "pocketbase", url: c.url };
      /* production deployments set demoMode:false in config.js */
      if (c.url && c.demoMode === false) return { mode: "pocketbase", url: c.url };
      if (c.mode === "supabase") {
        /* the project moved from Supabase to PocketBase (commit 19b502f) —
           drop stale config instead of silently pretending it works */
        try { store.removeItem(KEYS.cfg); } catch (e) { /* ignore */ }
      }
    }
    try {
      const raw = store.getItem(KEYS.cfg);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg && cfg.mode === "pocketbase" && cfg.url) return cfg;
        if (cfg && cfg.mode === "supabase") store.removeItem(KEYS.cfg); // stale
      }
    } catch (e) { /* ignore malformed config */ }
    return { mode: "local" };
  }

  const cfg = readCfg();
  let adapter;
  if (cfg.mode === "pocketbase") {
    PocketBaseAdapter.url = cfg.url;
    adapter = PocketBaseAdapter;
  } else {
    adapter = LocalAdapter;
  }

  /* Public surface (bound so callers can pass methods around freely) */
  const api = {
    adapter,
    TAX_RATE,
    QUOTE_VALID_DAYS,
    INVOICE_DUE_DAYS,
    STAGES,
    PAYMENT_METHODS,
    RM, pad, round2, randToken, csvEscape,
    status: () => adapter.status(),
    setLeadContext: (ref, token) => (adapter.setLeadContext ? adapter.setLeadContext(ref, token) : undefined),
    submitAssessment: (p) => adapter.submitAssessment(p),
    listAssessments: () => adapter.listAssessments(),
    getAssessment: (ref) => adapter.getAssessment(ref),
    getDeal: (ref) => adapter.getDeal(ref),
    updateLeadStage: (ref, stage) => adapter.updateLeadStage(ref, stage),
    createQuote: (input) => adapter.createQuote(input),
    getQuote: (id) => adapter.getQuote(id),
    acceptQuote: (id) => adapter.acceptQuote(id),
    createInvoice: (quoteId) => adapter.createInvoice(quoteId),
    getInvoice: (id) => adapter.getInvoice(id),
    payInvoice: (id, opts) => adapter.payInvoice(id, opts),
    confirmPayment: (id) => adapter.confirmPayment(id),
    listPayments: (ref) => adapter.listPayments(ref),
    listDeals: () => adapter.listDeals(),
    metrics: () => adapter.metrics(),
    audit: (ref) => adapter.audit(ref),
    /* switch backend at runtime (leads.html settings dialog) */
    configure(next) {
      if (next && next.mode === "pocketbase" && next.url) {
        store.setItem(KEYS.cfg, JSON.stringify({ mode: "pocketbase", url: next.url }));
      } else {
        store.removeItem(KEYS.cfg);
      }
    },

    /* Forward an AGMX lead to Duta Integra's /api/send-email Pages Function
       so it lands in Brevo + KV alongside website enquiries. Fail-open: never
       breaks the AGMX flow if Duta Integra's API is unreachable or unconfigured. */
    forwardLeadToDutaIntegra: async (lead) => {
      const url = (typeof window !== "undefined" && window.AGMX_CONFIG
        && window.AGMX_CONFIG.dutaIntegraApiUrl) || "";
      if (!url) return { ok: false, reason: "not configured" };
      try {
        const res = await fetch(url, {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
            "Origin": window.location.origin,
          },
          body: JSON.stringify({
            name: lead.contactName || "",
            email: lead.contactEmail || "",
            company: lead.coopName || "",
            phone: lead.contactPhone || "",
            service: "AGMX Cooperative Governance",
            message: "AGM Assessment — complexity score " + (lead.score || 0) + "/100. " +
              "Recommended: " + (lead.pkgName || "") + ". Members: " + (lead.members || 0) + ". " +
              "Mode: " + (lead.mode || "") + ". State: " + (lead.state || "") + ".",
            consent: true,
            source: "agmx-assessment",
            page: window.location.href,
          }),
        });
        return { ok: res.ok, status: res.status };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  };

  return api;
});
