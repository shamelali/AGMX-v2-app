/* ============================================================
   AGMX — Commerce API Layer (Sprint 2 · Money Flow)
   Lead → Assessment → Quote → Invoice → Payment → AGM scheduled

   One async interface, three adapters:
     * LocalAdapter      — localStorage persistence (demo mode, default)
     * SupabaseAdapter   — live backend: supabase/functions/money-flow
                           (Edge Function enforces numbering, pricing,
                           double-pay guard, webhook settlement and the
                           audit hash chain server-side)
     * PocketBaseAdapter — legacy adapter for the archived v1 money-flow
                           hooks (archive/pocketbase-v1/); no current
                           deployment selects it.

   Global name: window.AGMX_COMMERCE
   (window.AGMX_API is owned by supabase-client.js — the dashboard
   query layer. The two must not collide.)

   Configuration (first match wins):
     1. window.AGMX_CONFIG = { mode: "supabase", supabaseUrl, supabaseAnonKey }
        — or { supabaseUrl, demoMode: false } which implies supabase mode
     2. window.AGMX_CONFIG = { mode: "pocketbase", url }
        — or { url, demoMode: false } which implies pocketbase mode
     3. localStorage "agmx_backend_cfg"  (set from leads.html → Tetapan Backend)
     4. default: { mode: "local" }

   Operator auth: SupabaseAdapter uses the session JWT from
   supabase-client.js (window.supabase); PocketBaseAdapter reuses the
   token stored by pocketbase-client.js (localStorage "pb_token").
   Operator-only calls (deals, metrics, stage changes, payment
   confirmation) throw a clear error when no operator is logged in —
   they never fail silently.

   Prospect auth: checkout links carry an unguessable token
   (?ref=LD-0007&t=…) minted at assessment submission; the server
   compares it against agm_assessments.token before exposing or
   mutating that lead's documents.

   Browser:  <script src="api.js"></script>   →  window.AGMX_COMMERCE
   Node:     const AGMX_COMMERCE = require("./api.js")   (tools/test_money_flow.mjs)

   NOTE (red-team honesty): in local mode nothing leaves the browser and
   the payment gateway is simulated. In Supabase mode fpx/card create a
   hosted gateway bill and settle via the signed webhook; bank transfers
   stay pending until an operator verifies them. In PocketBase mode the
   same rules applied to the archived hook.
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
    subscriptions: "agmx_subscriptions_v1",
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

  /* Demo subscription plans (mirrors server-side plans table for local mode) */
  function _seedSubscriptionPlans() {
    const key = KEYS.subscriptions + "_plans";
    if (!store.getItem(key)) {
      const plans = [
        { key: "essential_agm", name: "AGMX Essential AGM", annualPrice: 7200, monthly: 600, description: "Sedia untuk AGM tahunan: notis, agenda, minutes, undian, rekod kehadiran" },
        { key: "professional_agm", name: "AGMX Professional AGM", annualPrice: 9600, monthly: 800, description: "Essential + pengurusan matlamat, risiko, polisi, laporan lembaga, aliran kerja kelulusan" },
        { key: "enterprise_agm", name: "AGMX Enterprise AGM", annualPrice: 12000, monthly: 1000, description: "Professional + SSO, audit log, API, domain tersuai, sokongan keutamaan, SLA" },
        { key: "federation_agm", name: "AGMX Federation AGM", annualPrice: 15000, monthly: 1250, description: "Enterprise + multi-koperasi, konsolidasi laporan, kawalan akses terpusat, pengurus berdedikasi" },
      ];
      store.setItem(key, JSON.stringify(plans));
    }
  }
  _seedSubscriptionPlans();

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

    /* ----- subscriptions (demo — persists in this browser only) ----- */
    async createSubscription(input) {
      const { leadRef, planKey, billingCycle } = input || {};
      if (!leadRef) throw new Error("Rujukan lead diperlukan.");
      if (!planKey) throw new Error("Pakej langganan diperlukan.");
      if (billingCycle !== "annual") throw new Error("Hanya kitaran bil tahunan disokong.");

      const leads = readArr(KEYS.leads);
      const lead = leads.find((l) => l.id === leadRef);
      if (!lead) throw new Error("Lead tidak dijumpai: " + leadRef);

      const plans = readArr(KEYS.subscriptions + "_plans") || [];
      const plan = plans.find((p) => p.key === planKey);
      if (!plan) throw new Error("Pakej tidak dijumpai: " + planKey);

      const subs = readArr(KEYS.subscriptions);
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      const periodStart = today();
      const periodEnd = addDays(365);

      const sub = {
        id: nextRef("SUB-", subs),
        number: nextDocNumber("SUB-", subs),
        leadRef: lead.id,
        planKey,
        planName: plan.name,
        billingCycle: "annual",
        status: "trialing",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        trialEndsAt: trialEnd.toISOString().slice(0, 10),
        autoRenew: true,
        cancelledAt: null,
        createdAt: nowIso(),
      };
      subs.unshift(sub);
      writeArr(KEYS.subscriptions, subs);

      lead.subscriptionId = sub.number;
      writeArr(KEYS.leads, leads);

      this._audit("subscription.created", "subscription", sub.number, {
        lead: lead.id, plan: planKey, billingCycle: "annual", trialEndsAt: sub.trialEndsAt,
      });
      return sub;
    },

    async getSubscription(id) {
      return readArr(KEYS.subscriptions).find((s) => s.number === id || s.id === id) || null;
    },

    async cancelSubscription(id) {
      const subs = readArr(KEYS.subscriptions);
      const sub = subs.find((s) => s.number === id || s.id === id);
      if (!sub) throw new Error("Langganan tidak dijumpai: " + id);
      if (sub.status === "cancelled") return sub;

      sub.status = "cancelled";
      sub.cancelledAt = nowIso();
      sub.autoRenew = false;
      writeArr(KEYS.subscriptions, subs);

      const leads = readArr(KEYS.leads);
      const lead = leads.find((l) => l.id === sub.leadRef);
      if (lead) { lead.subscriptionId = null; writeArr(KEYS.leads, leads); }

      this._audit("subscription.cancelled", "subscription", sub.number, {
        lead: sub.leadRef, plan: sub.planKey,
      }, sub.leadRef);
      return sub;
    },

    async generateRecurringInvoice(subId) {
      const subs = readArr(KEYS.subscriptions);
      const sub = subs.find((s) => s.number === subId || s.id === subId);
      if (!sub) throw new Error("Langganan tidak dijumpai: " + subId);

      const plans = readArr(KEYS.subscriptions + "_plans") || [];
      const plan = plans.find((p) => p.key === sub.planKey);
      if (!plan) throw new Error("Pakej tidak dijumpai: " + sub.planKey);

      const invoices = readArr(KEYS.invoices);
      const invoice = {
        id: nextRef("INV-", invoices),
        number: nextDocNumber("INV-", invoices),
        leadRef: sub.leadRef,
        amount: plan.annualPrice || plan.price,
        currency: "MYR",
        status: "unpaid",
        issuedAt: today(),
        dueAt: addDays(INVOICE_DUE_DAYS),
        paidAt: null,
        subscriptionId: sub.number,
        recurring: true,
      };
      invoices.unshift(invoice);
      writeArr(KEYS.invoices, invoices);

      /* also add to subscription's recurring invoices list */
      if (!sub.recurringInvoices) sub.recurringInvoices = [];
      sub.recurringInvoices.unshift({
        id: invoice.id,
        number: invoice.number,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
        amount: invoice.amount,
        status: "unpaid",
      });
      writeArr(KEYS.subscriptions, subs);

      this._audit("subscription.invoice_generated", "subscription", sub.number, {
        lead: sub.leadRef, invoice: invoice.number, amount: invoice.amount,
      }, sub.leadRef);
      return invoice;
    },

    async getSubscriptionEvents(subId) {
      const all = readArr(KEYS.audit);
      return all.filter((e) => e.entityType === "subscription" && e.entityId === subId)
        .sort((a, b) => (a.seq < b.seq ? 1 : -1));
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

    /* ----- subscriptions ----- */
    async createSubscription(input) {
      const out = await this._req("POST", "/subscription" + this._qs({}), {
        ref: input.leadRef || this._ctx.ref,
        planKey: input.planKey,
        billingCycle: input.billingCycle || "annual",
      });
      return out.subscription;
    },

    async getSubscription(id) {
      const out = await this._req("GET", "/subscription" + this._qs({ number: id }));
      return out.subscription;
    },

    async cancelSubscription(id) {
      const out = await this._req("POST", "/subscription/cancel" + this._qs({}), { subscriptionId: id });
      return out.subscription;
    },

    async generateRecurringInvoice(subId) {
      const out = await this._req("POST", "/subscription/invoice" + this._qs({}), { subscriptionId: subId });
      return out.invoice;
    },

    async getSubscriptionEvents(subId) {
      const out = await this._req("GET", "/subscription/events" + this._qs({ number: subId }));
      return out.events || [];
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
     SUPABASE ADAPTER (live backend — supabase/functions/money-flow)
     Every commercial invariant (numbering, pricing from the plans
     table, double-pay guard, webhook settlement, audit hash chain)
     lives in the Edge Function / Postgres, so this adapter is a
     thin, trust-free transport — same contract as the other two.

     Auth model:
       * POST /assessment is public (prospect lead submission).
       * Prospect pages authenticate with the checkout token minted at
         assessment time (?ref=LD-xxxx&t=…), forwarded as query params
         on every call. The Edge Function verifies it against
         agm_assessments.token before exposing or mutating that lead.
       * Operator-only calls (deals, metrics, manual confirmation)
         use the Supabase session JWT set up by supabase-client.js
         (window.supabase); the Edge Function enforces role
         admin/secretary server-side.
     ============================================================ */
  const SUPABASE_PLAN_CODES = {
    essential: "essential_agm",
    professional: "professional_agm",
    enterprise: "enterprise_agm",
    essential_agm: "essential_agm",
    professional_agm: "professional_agm",
    enterprise_agm: "enterprise_agm",
  };

  const SUPABASE_PLAN_NAMES = {
    essential_agm: "AGMX Essential AGM",
    professional_agm: "AGMX Professional AGM",
    enterprise_agm: "AGMX Enterprise AGM",
  };

  /* Display copy of the server-side plan rate card (plans.price_oneoff).
     The Edge Function re-prices every quote — these values only drive
     the fresh-quote preview before the server responds. */
  const SUPABASE_PLAN_PRICES = {
    essential_agm: 1500,
    professional_agm: 3500,
    enterprise_agm: 7500,
  };

  /* Adapter pipeline stage (BM) ↔ agm_assessments.status code */
  const STATUS_TO_STAGE = {
    lead: "Assessment Diterima",
    contacted: "Dihubungi",
    quoted: "Sebut Harga Dihantar",
    accepted: "Sebut Harga Diterima",
    invoiced: "Sebut Harga Diterima",
    paid: "Dibayar",
    won: "Dibayar",
    scheduled: "AGM Dijadualkan",
    lost: "Assessment Diterima",
  };
  const STAGE_TO_STATUS = {
    "Assessment Diterima": "lead",
    "Dihubungi": "contacted",
    "Sebut Harga Dihantar": "quoted",
    "Sebut Harga Diterima": "accepted",
    "Dibayar": "paid",
    "AGM Dijadualkan": "scheduled",
  };

  const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
  const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);

  function planCodeFor(packageKey, score) {
    const mapped = SUPABASE_PLAN_CODES[String(packageKey || "")];
    if (mapped) return mapped;
    const s = Number(score) || 0;
    return s <= 34 ? "essential_agm" : s <= 64 ? "professional_agm" : "enterprise_agm";
  }

  function mapSupabaseLead(row) {
    const quotes = row.quotes || [];
    const invoices = row.invoices || [];
    const payments = row.payments || [];
    const quote = quotes[0] || null;
    const invoice = invoices[0] || null;
    const payment = payments[0] || null;
    const score = num(row.complexity_score);
    const planCode = planCodeFor(null, score);
    return {
      id: row.reference,
      reference: row.reference,
      uuid: row.id,
      checkoutToken: row.token,
      createdAt: row.created_at,
      stage: STATUS_TO_STAGE[row.status] || STAGES[0],
      status: row.status,
      coopName: row.coop_name || "",
      coopReg: row.coop_reg || "",
      state: row.state || "",
      members: num(row.members),
      agmDate: row.agm_date || "",
      mode: row.mode || "",
      attendance: num(row.expected_attendance),
      candidates: num(row.candidates),
      motions: num(row.motions),
      process: row.current_process || "manual",
      managed: !!row.needs_managed,
      score,
      pkgKey: planCode,
      pkgName: SUPABASE_PLAN_NAMES[planCode] || planCode,
      pkgPrice: quote ? num(quote.total) : SUPABASE_PLAN_PRICES[planCode] || 0,
      quote: quote ? num(quote.total) : 0,
      contactName: row.contact_name || "",
      contactPhone: row.contact_phone || "",
      contactEmail: row.contact_email || "",
      quoteId: quote ? quote.number : null,
      invoiceId: invoice ? invoice.number : null,
      paymentId: payment ? payment.id : null,
    };
  }

  function mapSupabaseQuote(row) {
    const total = num(row.total);
    /* GET /lead joins only (id, number, status, total, valid_until);
       subtotal/tax/items may be absent — derive a consistent split. */
    const subtotal = row.subtotal != null ? num(row.subtotal) : round2(total / (1 + TAX_RATE));
    const tax = row.tax != null ? num(row.tax) : round2(total - subtotal);
    const leadRef = row.agm_assessments ? row.agm_assessments.reference : (row.leadRef || null);
    const items = (row.quote_items || []).map((it) => ({
      description: it.description,
      qty: num(it.quantity) || 1,
      unitPrice: num(it.unit_price),
      lineTotal: num(it.line_total),
    }));
    if (!items.length) {
      items.push({ description: row.description || "AGMX AGM service", qty: 1, unitPrice: subtotal, lineTotal: subtotal });
    }
    const accepted = row.status === "accepted" || row.status === "invoiced";
    return {
      id: row.id,
      number: row.number,
      leadRef,
      items,
      subtotal,
      tax,
      taxRate: TAX_RATE,
      total,
      currency: "MYR",
      status: accepted ? "accepted" : row.status,
      validUntil: row.valid_until || null,
      createdAt: row.created_at,
      acceptedAt: accepted ? row.created_at : null,
    };
  }

  function mapSupabaseInvoice(row) {
    return {
      id: row.id,
      number: row.number,
      quoteId: row.quote_id,
      leadRef: row.lead_ref || null,
      amount: num(row.amount),
      currency: "MYR",
      status: row.status,
      issuedAt: row.issued_at,
      dueAt: row.due_at,
      paidAt: isoOrNull(row.paid_at),
    };
  }

  function mapSupabasePayment(row) {
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      leadRef: row.lead_ref || null,
      method: row.method,
      methodLabel: PAYMENT_METHODS[row.method] || row.method,
      reference: row.reference || "",
      amount: num(row.amount),
      currency: "MYR",
      status: row.status,
      paidAt: isoOrNull(row.paid_at),
      createdAt: row.created_at,
    };
  }

  const SupabaseAdapter = {
    mode: "supabase",
    url: "",
    anonKey: "",

    /* prospect context for token-gated calls (set from checkout.html ?ref&t) */
    _ctx: { ref: null, token: null },

    setLeadContext(ref, token) {
      this._ctx = { ref: ref || null, token: token || null };
    },

    /* Operator JWT from the Supabase session (supabase-client.js exposes
       window.supabase). Empty for anonymous prospects. */
    async _jwt() {
      try {
        const sb = (typeof window !== "undefined") && (window.supabase || window.AGMX_SUPABASE);
        if (sb && sb.auth && sb.auth.getSession) {
          const { data } = await sb.auth.getSession();
          return (data && data.session && data.session.access_token) || "";
        }
      } catch (e) { /* ignore */ }
      return "";
    },

    _qs(params) {
      const p = Object.assign({}, params || {});
      if (this._ctx.token && p.t === undefined) p.t = this._ctx.token;
      if (this._ctx.ref && p.ref === undefined) p.ref = this._ctx.ref;
      const q = Object.keys(p)
        .filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== "")
        .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(p[k]))
        .join("&");
      return q ? "?" + q : "";
    },

    async _req(method, path, body, opts) {
      const o = opts || {};
      const base = this.url.replace(/\/+$/, "") + "/functions/v1/money-flow";
      const url = base + path + this._qs(o.query);
      const headers = { "Content-Type": "application/json" };
      if (this.anonKey) headers["apikey"] = this.anonKey;
      if (!o.public) {
        const jwt = await this._jwt();
        if (jwt) headers["Authorization"] = "Bearer " + jwt;
      }
      let res;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new Error("Supabase tidak dapat dihubungi (" + this.url + ").");
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = { error: text.slice(0, 200) }; }
      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || ("HTTP " + res.status);
        throw new Error(msg);
      }
      return data;
    },

    async status() {
      if (!this.url) return { mode: "supabase", ok: false, label: "Supabase (tidak dikonfigurasi)" };
      try {
        const res = await fetch(this.url.replace(/\/+$/, "") + "/functions/v1/money-flow/assessment", {
          method: "OPTIONS",
        });
        return {
          mode: "supabase",
          ok: res.ok,
          label: res.ok ? "Supabase Live" : "Supabase (tidak sihat)",
        };
      } catch (e) {
        return { mode: "supabase", ok: false, label: "Supabase (tidak dapat dihubungi)" };
      }
    },

    /* ----- leads ----- */
    async submitAssessment(p) {
      const payload = {
        coopName: p.coopName || "",
        coopReg: p.coopReg || undefined,
        state: p.state || undefined,
        members: Number(p.members) || 0,
        agmDate: p.agmDate || undefined,
        mode: p.mode || "hybrid",
        expectedAttendance: Number(p.attendance) || undefined,
        candidates: Number(p.candidates) || 0,
        motions: Number(p.motions) || 0,
        currentProcess: p.process || "manual",
        needsManaged: typeof p.managed === "boolean" ? p.managed : true,
        contactName: p.contactName || "",
        contactPhone: p.contactPhone || "",
        contactEmail: p.contactEmail || undefined,
      };
      const out = await this._req("POST", "/assessment", payload, { public: true });
      /* Assessment responses mint the checkout context; remember it so the
         same page can continue to the quote without re-entering the link. */
      this.setLeadContext(out.reference, out.token);
      const planCode = out.recommendedPlan || planCodeFor(p.pkgKey, out.complexityScore);
      return {
        id: out.reference,
        reference: out.reference,
        uuid: out.assessmentId,
        checkoutToken: out.token,
        createdAt: nowIso(),
        stage: STAGES[0],
        status: "lead",
        coopName: p.coopName || "",
        coopReg: p.coopReg || "",
        state: p.state || "",
        members: Number(p.members) || 0,
        agmDate: p.agmDate || "",
        mode: p.mode || "hybrid",
        attendance: Number(p.attendance) || 0,
        candidates: Number(p.candidates) || 0,
        motions: Number(p.motions) || 0,
        process: p.process || "manual",
        managed: !!p.managed,
        score: out.complexityScore,
        pkgKey: planCode,
        pkgName: SUPABASE_PLAN_NAMES[planCode] || p.pkgName || "",
        pkgPrice: Number(p.pkgPrice) || SUPABASE_PLAN_PRICES[planCode] || 0,
        quote: Number(p.pkgPrice) || 0,
        contactName: p.contactName || "",
        contactPhone: p.contactPhone || "",
        contactEmail: p.contactEmail || "",
        quoteId: null,
        invoiceId: null,
        paymentId: null,
        quoteUrl: out.quoteUrl,
      };
    },

    async listAssessments() {
      /* Operator-only view — prospects hold no JWT and get an empty list,
         not a data leak. */
      const jwt = await this._jwt();
      if (!jwt) return [];
      const out = await this._req("GET", "/deals");
      return (out.deals || []).map(mapSupabaseLead);
    },

    async getAssessment(ref) {
      const row = await this._leadRow(ref);
      return row ? mapSupabaseLead(row) : null;
    },

    async _leadRow(ref) {
      const r = ref || this._ctx.ref;
      if (!r) throw new Error("Rujukan lead diperlukan.");
      return await this._req("GET", "/lead/" + encodeURIComponent(r), null, { query: { ref: r } });
    },

    async getDeal(ref) {
      const row = await this._leadRow(ref);
      if (!row) return null;
      const lead = mapSupabaseLead(row);
      const quoteRow = (row.quotes || [])[0] || null;
      const invoiceRow = (row.invoices || [])[0] || null;
      const paymentRow = (row.payments || [])[0] || null;
      const quote = quoteRow ? mapSupabaseQuote(quoteRow) : null;
      const invoice = invoiceRow ? mapSupabaseInvoice(invoiceRow) : null;
      const payment = paymentRow ? mapSupabasePayment(paymentRow) : null;
      if (quote) quote.leadRef = lead.id;
      if (invoice) invoice.leadRef = lead.id;
      if (payment) payment.leadRef = lead.id;
      return {
        lead, quote, invoice, payment,
        quoteTotal: quote ? quote.total : 0,
        paidTotal: payment && payment.status === "succeeded" ? payment.amount : 0,
      };
    },

    async updateLeadStage(ref, stage) {
      await this._requireOperator();
      const status = STAGE_TO_STATUS[stage] || stage;
      await this._req("POST", "/lead/stage", { ref, stage: status });
      return await this.getAssessment(ref);
    },

    /* ----- quotes ----- */
    async createQuote(input) {
      const leadRef = input.leadRef || this._ctx.ref;
      const lead = await this.getAssessment(leadRef);
      if (!lead) throw new Error("Lead tidak dijumpai: " + leadRef);

      /* Server re-prices from the plans collection; client items/addons are
         display-only in this mode. */
      const planCode = planCodeFor(input.packageKey || lead.pkgKey, lead.score);
      const out = await this._req("POST", "/quote", {
        assessmentId: lead.uuid,
        planCode,
        validDays: QUOTE_VALID_DAYS,
      });

      const total = num(out.total);
      const subtotal = round2(total / (1 + TAX_RATE));
      const description = lead.pkgName || SUPABASE_PLAN_NAMES[planCode] || planCode;
      return {
        id: out.quoteId,
        uuid: out.quoteId,
        number: out.number,
        leadRef: lead.id,
        items: [{ description, qty: 1, unitPrice: subtotal, lineTotal: subtotal }],
        subtotal,
        tax: round2(total - subtotal),
        taxRate: TAX_RATE,
        total,
        currency: "MYR",
        status: "sent",
        validUntil: out.validUntil,
        checkoutUrl: out.checkoutUrl,
        createdAt: nowIso(),
        acceptedAt: null,
      };
    },

    async getQuote(id) {
      const row = await this._req("GET", "/quote/" + encodeURIComponent(id));
      return row ? mapSupabaseQuote(row) : null;
    },

    async acceptQuote(id) {
      const quote = await this.getQuote(id);
      if (!quote) throw new Error("Sebut harga tidak dijumpai: " + id);
      if (quote.status === "accepted") return quote;
      const out = await this._req("POST", "/quote/accept", { quoteId: quote.id });
      return Object.assign({}, quote, {
        status: out.status || "accepted",
        acceptedAt: quote.acceptedAt || nowIso(),
      });
    },

    /* ----- invoices ----- */
    async createInvoice(quoteId) {
      const quote = await this.getQuote(quoteId);
      if (!quote) throw new Error("Sebut harga tidak dijumpai: " + quoteId);
      const out = await this._req("POST", "/invoice", { quoteId: quote.id });
      return {
        id: out.invoiceId,
        number: out.number,
        quoteId: quote.number,
        leadRef: quote.leadRef,
        amount: num(out.amount),
        currency: "MYR",
        status: "unpaid",
        issuedAt: today(),
        dueAt: out.dueAt,
        paidAt: null,
      };
    },

    async getInvoice(id) {
      const row = await this._req("GET", "/invoice/" + encodeURIComponent(id));
      return row ? mapSupabaseInvoice(row) : null;
    },

    /* ----- payments -----
       fpx / card create a hosted gateway bill (Billplz / HitPay) and return
       redirectUrl — the browser is handed to the gateway and the payment is
       settled by the signed webhook (POST /payment/confirm).
       bank_transfer stays pending until an operator confirms it. */
    async payInvoice(invoiceId, opts) {
      const o = opts || {};
      const method = o.method || "fpx";
      if (!PAYMENT_METHODS[method]) throw new Error("Kaedah pembayaran tidak sah: " + method);

      const invoice = await this.getInvoice(invoiceId);
      if (!invoice) throw new Error("Invois tidak dijumpai: " + invoiceId);
      if (invoice.status === "paid") throw new Error("Invois sudah dibayar.");

      const out = await this._req("POST", "/payment/intent", {
        invoiceId: invoice.id,
        method,
        reference: o.reference || undefined,
      });

      return {
        id: out.paymentId,
        invoiceId: invoice.number,
        leadRef: invoice.leadRef,
        method,
        methodLabel: PAYMENT_METHODS[method],
        reference: out.gatewayRef || "",
        amount: invoice.amount,
        currency: "MYR",
        status: "pending",
        paidAt: null,
        createdAt: nowIso(),
        redirectUrl: method === "bank_transfer" ? null : (out.paymentUrl || null),
      };
    },

    async confirmPayment(paymentId) {
      await this._requireOperator();
      const out = await this._req("POST", "/payment/manual-confirm", { paymentId });
      return out.payment ? mapSupabasePayment(out.payment) : null;
    },

    /* Hosted gateway (Billplz) link for the FPX flow. The API key never
       reaches the client — it is read from Edge Function secrets. */
    async createPaymentLink(invoiceNumber) {
      const invoice = await this.getInvoice(invoiceNumber);
      if (!invoice) throw new Error("Invois tidak dijumpai: " + invoiceNumber);
      const out = await this._req("POST", "/payment/intent", {
        invoiceId: invoice.id,
        method: "fpx",
      });
      return {
        url: out.paymentUrl,
        paymentId: out.paymentId,
        gatewayRef: out.gatewayRef,
        method: out.method,
      };
    },

    /* ----- subscriptions ----- */
    async createSubscription(input) {
      const leadRef = input.leadRef || this._ctx.ref;
      if (!leadRef) throw new Error("Rujukan lead diperlukan.");
      const lead = await this.getAssessment(leadRef);
      if (!lead) throw new Error("Lead tidak dijumpai: " + leadRef);

      const out = await this._req("POST", "/subscription", {
        assessmentId: lead.uuid,
        planCode: input.planKey,
        billingCycle: input.billingCycle || "annual",
      });
      return {
        id: out.subscriptionId,
        number: out.number,
        leadRef: lead.id,
        planKey: input.planKey,
        planName: out.planName,
        billingCycle: "annual",
        status: out.status,
        currentPeriodStart: out.currentPeriodStart,
        currentPeriodEnd: out.currentPeriodEnd,
        trialEndsAt: out.trialEndsAt,
        autoRenew: out.autoRenew,
        cancelledAt: out.cancelledAt,
        createdAt: out.createdAt,
      };
    },

    async getSubscription(id) {
      const out = await this._req("GET", "/subscription/" + encodeURIComponent(id));
      if (!out) return null;
      return {
        id: out.id,
        number: out.number,
        leadRef: out.leadRef,
        planKey: out.planKey,
        planName: out.planName,
        billingCycle: out.billingCycle,
        status: out.status,
        currentPeriodStart: out.currentPeriodStart,
        currentPeriodEnd: out.currentPeriodEnd,
        trialEndsAt: out.trialEndsAt,
        autoRenew: out.autoRenew,
        cancelledAt: out.cancelledAt,
        createdAt: out.createdAt,
        recurringInvoices: (out.recurringInvoices || []).map((ri) => ({
          id: ri.id,
          number: ri.number,
          issuedAt: ri.issuedAt,
          dueAt: ri.dueAt,
          amount: num(ri.amount),
          status: ri.status,
        })),
        paymentSchedules: (out.paymentSchedules || []).map((ps) => ({
          invoiceNumber: ps.invoiceNumber,
          scheduledAt: ps.scheduledAt,
          amount: num(ps.amount),
          status: ps.status,
        })),
      };
    },

    async cancelSubscription(id) {
      const out = await this._req("POST", "/subscription/cancel", { subscriptionId: id });
      return {
        id: out.id,
        number: out.number,
        leadRef: out.leadRef,
        planKey: out.planKey,
        planName: out.planName,
        billingCycle: out.billingCycle,
        status: out.status,
        currentPeriodStart: out.currentPeriodStart,
        currentPeriodEnd: out.currentPeriodEnd,
        trialEndsAt: out.trialEndsAt,
        autoRenew: out.autoRenew,
        cancelledAt: out.cancelledAt,
        createdAt: out.createdAt,
      };
    },

    async generateRecurringInvoice(subId) {
      const out = await this._req("POST", "/subscription/invoice", { subscriptionId: subId });
      return {
        id: out.invoiceId,
        number: out.number,
        leadRef: out.leadRef,
        amount: num(out.amount),
        currency: "MYR",
        status: "unpaid",
        issuedAt: out.issuedAt,
        dueAt: out.dueAt,
        paidAt: null,
        subscriptionId: subId,
        recurring: true,
      };
    },

    async getSubscriptionEvents(subId) {
      const out = await this._req("GET", "/subscription/events/" + encodeURIComponent(subId));
      return Array.isArray(out) ? out : (out.events || []);
    },

    async listPayments(leadRef) {
      if (!leadRef) return [];
      const deal = await this.getDeal(leadRef);
      return deal && deal.payment ? [deal.payment] : [];
    },

    /* ----- operator aggregates ----- */
    async listDeals() {
      await this._requireOperator();
      const out = await this._req("GET", "/deals");
      return (out.deals || []).map((row) => {
        const lead = mapSupabaseLead(row);
        const quoteRow = (row.quotes || [])[0] || null;
        const invoiceRow = (row.invoices || [])[0] || null;
        const paymentRow = (row.payments || [])[0] || null;
        const quote = quoteRow ? mapSupabaseQuote(quoteRow) : null;
        const invoice = invoiceRow ? mapSupabaseInvoice(invoiceRow) : null;
        const payment = paymentRow ? mapSupabasePayment(paymentRow) : null;
        if (quote) quote.leadRef = lead.id;
        if (invoice) invoice.leadRef = lead.id;
        if (payment) payment.leadRef = lead.id;
        return {
          lead, quote, invoice, payment,
          quoteTotal: quote ? quote.total : 0,
          paidTotal: payment && payment.status === "succeeded" ? payment.amount : 0,
        };
      });
    },

    async metrics() {
      await this._requireOperator();
      const m = await this._req("GET", "/metrics");
      const paidInvoices = (m.invoicesByStatus && m.invoicesByStatus.paid) || 0;
      return {
        leads: m.totalLeads || 0,
        quoted: m.totalQuotes || 0,
        paid: paidInvoices,
        pipelineValue: round2(num(m.pipelineValue)),
        collectedValue: round2(num(m.revenueCollected)),
        quoteRate: m.totalLeads ? Math.round((m.totalQuotes / m.totalLeads) * 100) : 0,
        closeRate: m.totalQuotes ? Math.round((paidInvoices / m.totalQuotes) * 100) : 0,
      };
    },

    async audit(leadRef) {
      const jwt = await this._jwt();
      if (!leadRef && !jwt) return [];
      const out = await this._req("GET", "/audit", null, { query: { ref: leadRef || "" } });
      return Array.isArray(out) ? out : (out.events || []);
    },

    async _requireOperator() {
      const jwt = await this._jwt();
      if (!jwt) {
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
      if (c.mode === "supabase" && c.supabaseUrl) {
        return { mode: "supabase", url: c.supabaseUrl, anonKey: c.supabaseAnonKey || "" };
      }
      if (c.mode === "pocketbase" && c.url) return { mode: "pocketbase", url: c.url };
      /* Supabase-first production deployments: config.js carries the
         Supabase project and demoMode:false. */
      if (c.supabaseUrl && c.demoMode === false) {
        return { mode: "supabase", url: c.supabaseUrl, anonKey: c.supabaseAnonKey || "" };
      }
      /* production PocketBase deployments set demoMode:false in config.js */
      if (c.url && c.demoMode === false) return { mode: "pocketbase", url: c.url };
    }
    try {
      const raw = store.getItem(KEYS.cfg);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg && cfg.mode === "supabase" && cfg.url) return cfg;
        if (cfg && cfg.mode === "pocketbase" && cfg.url) return cfg;
      }
    } catch (e) { /* ignore malformed config */ }
    return { mode: "local" };
  }

  const cfg = readCfg();
  let adapter;
  if (cfg.mode === "supabase") {
    SupabaseAdapter.url = cfg.url;
    SupabaseAdapter.anonKey = cfg.anonKey || "";
    adapter = SupabaseAdapter;
  } else if (cfg.mode === "pocketbase") {
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
    /* subscriptions (Sprint 3 · Governance OS) */
    createSubscription: (input) => adapter.createSubscription(input),
    getSubscription: (id) => adapter.getSubscription(id),
    cancelSubscription: (id) => adapter.cancelSubscription(id),
    generateRecurringInvoice: (subId) => adapter.generateRecurringInvoice(subId),
    getSubscriptionEvents: (subId) => adapter.getSubscriptionEvents(subId),
    /* switch backend at runtime (leads.html settings dialog) */
    configure(next) {
      if (next && next.mode === "supabase" && next.url) {
        store.setItem(KEYS.cfg, JSON.stringify({ mode: "supabase", url: next.url, anonKey: next.anonKey || "" }));
      } else if (next && next.mode === "pocketbase" && next.url) {
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
