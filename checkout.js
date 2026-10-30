/* ============================================================
   AGMX — Checkout / Money Flow (Sprint 2)
   Quote → Invoice → Payment → Receipt, driven by AGMX_COMMERCE.

   Demo honesty: in local mode the payment gateway is simulated
   client-side. In PocketBase mode every commercial invariant
   (pricing, numbering, double-pay guard, audit chain) is enforced
   server-side in pb_hooks/money_flow.pb.js — this page is a thin
   renderer over the API.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Language (BM default; shared key) ---------- */
  const LANG = (() => {
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q === "en" || q === "ms") return q;
      return localStorage.getItem("agmx-lang") === "en" ? "en" : "ms";
    } catch (_) { return "ms"; }
  })();
  const T = (ms, en) => (LANG === "en" ? en : ms);

  const API = window.AGMX_COMMERCE;
  const $ = (id) => document.getElementById(id);

  /* Optional add-ons — DISPLAY COPY of the server-side rate card
     (pb_hooks/money_flow.pb.js ADDONS). The hook re-prices every
     quote, so tampering here changes nothing but this screen. */
  const ADDONS = [
    { key: "facilitator", label: T("Fasilitator AGM Tambahan", "Additional AGM Facilitator"), desc: T("1 fasilitator berpengalaman untuk dewan besar / kawalan kehadiran", "1 experienced facilitator for the hall / attendance control"), price: 800 },
    { key: "translate", label: T("Penterjemahan Simultan BM ⇄ EN", "Simultaneous BM ⇄ EN Interpretation"), desc: T("Terjemahan langsung semasa AGM untuk ahli pelbagai bahasa", "Live interpretation during the AGM for multilingual members"), price: 1200 },
    { key: "printpack", label: T("Pek Mesyuarat Dicetak & Dihantar", "Printed & Delivered Meeting Pack"), desc: T("Pek mesyuarat fizikal dicetak dan dihantar ke dewan AGM", "Physical meeting packs printed and delivered to the AGM hall"), price: 600 },
  ];

  const state = {
    lead: null,
    quote: null,
    invoice: null,
    payment: null,
    step: 1,
    paymentBound: false,
  };

  /* ---------- helpers ---------- */
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  const RM = (n) => API.RM(n);
  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 4200);
  }
  const qs = new URLSearchParams(location.search);
  const ref = qs.get("ref");
  const checkoutToken = qs.get("t");   // unguessable token minted at assessment
  if (API && API.setLeadContext) API.setLeadContext(ref, checkoutToken);

  function setStep(n) {
    state.step = n;
    document.querySelectorAll("#stepper .step").forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle("active", s === n);
      el.classList.toggle("done", s < n);
    });
    for (const [card, step] of [
      ["quote-card", 1], ["invoice-card", 2], ["pay-card", 3],
      ["processing-card", 3.5], ["receipt-card", 4],
    ]) {
      $(card).classList.toggle("hidden", step !== n);
    }
    $("audit-card").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function infoGrid(el, pairs) {
    el.innerHTML = pairs.map(([k, v]) =>
      `<div class="info-cell"><div class="k">${k}</div><div class="v">${escapeHtml(v)}</div></div>`).join("");
  }

  function itemRows(tbody, tfoot, items, totals) {
    tbody.innerHTML = items.map((it) =>
      `<tr><td>${escapeHtml(it.description)}</td>
       <td class="num">${it.qty}</td>
       <td class="num">${RM(it.unitPrice)}</td>
       <td class="num"><strong>${RM(Number.isFinite(it.lineTotal) ? it.lineTotal : it.qty * it.unitPrice)}</strong></td></tr>`).join("");
    tfoot.innerHTML =
      `<tr><td colspan="3" class="num" style="color:var(--c-text-2)">${T("Subtotal", "Subtotal")}</td><td class="num">${RM(totals.subtotal)}</td></tr>
       <tr><td colspan="3" class="num" style="color:var(--c-text-2)">${T("SST 8%", "Tax 8%")}</td><td class="num">${RM(totals.tax)}</td></tr>
       <tr class="grand"><td colspan="3" class="num">${T("Jumlah (MYR)", "Total (MYR)")}</td><td class="num">${RM(totals.total)}</td></tr>`;
  }

  /* ---------- STEP 1 · QUOTE ---------- */
  function selectedAddons() {
    return ADDONS.filter((a) => {
      const cb = document.querySelector('input[data-addon="' + a.key + '"]');
      return cb && cb.checked;
    });
  }

  /* Every item needs `lineTotal`: itemRows() renders that column directly.
     The PocketBase hook builds items with it, but these client-side draft
     items did not, which rendered "RMNaN" in the line-total column while
     subtotal/SST stayed correct (they are summed from qty * unitPrice). */
  const lineItem = (description, unitPrice) => ({
    description, qty: 1, unitPrice,
    lineTotal: API.round2(unitPrice),
  });

  function computeTotals() {
    const items = [
      lineItem(state.lead.pkgName + T(" — perkhidmatan AGM sekali gus", " — one-off AGM service"), state.lead.pkgPrice),
    ].concat(selectedAddons().map((a) => lineItem(a.label, a.price)));
    const subtotal = API.round2(items.reduce((s, it) => s + it.lineTotal, 0));
    const tax = API.round2(subtotal * API.TAX_RATE);
    return { items, subtotal, tax, total: API.round2(subtotal + tax) };
  }

  function renderQuoteBuilder() {
    const lead = state.lead;
    $("q-title").textContent = T("Sebut Harga — ", "Quote — ") + lead.coopName;
    infoGrid($("q-info"), [
      [T("Rujukan Penilaian", "Assessment Reference"), lead.id],
      [T("Pakej Disarankan", "Recommended Package"), lead.pkgName],
      [T("Skor Kerumitan", "Complexity Score"), lead.score + "/100"],
      [T("Ahli", "Members"), Number(lead.members).toLocaleString("ms-MY")],
      [T("Negeri", "State"), lead.state || "—"],
      [T("AGM", "AGM"), lead.agmDate || T("Akan ditetapkan", "To be set")],
    ]);

    /* if a quote already exists, lock the add-on picker (items are frozen) */
    const locked = !!state.quote;
    $("addon-list").innerHTML = ADDONS.map((a) =>
      `<label class="addon${locked ? "" : ""}" data-addon-card="${a.key}">
         <input type="checkbox" data-addon="${a.key}" ${locked ? "disabled" : ""}>
         <span><strong style="font-size:13.5px">${a.label}</strong> · <strong style="color:var(--c-primary)">+${RM(a.price)}</strong>
         <div style="font-size:12px;color:var(--c-text-2);margin-top:2px">${a.desc}</div></span>
       </label>`).join("");
    if (locked) {
      $("q-sub").textContent = T("Sebut harga telah diterbitkan. Semak butiran dan teruskan.", "The quote has been issued. Review the details and continue.");
      $("q-continue").textContent = T("Terima Sebut Harga & Teruskan →", "Accept Quote & Continue →");
    }

    const refresh = () => {
      if (locked) {
        /* show the frozen quote items */
        itemRows($("q-items").querySelector("tbody"), $("q-items").querySelector("tfoot"),
          state.quote.items, state.quote);
      } else {
        const t = computeTotals();
        document.querySelectorAll(".addon").forEach((card) => {
          const key = card.dataset.addonCard;
          card.classList.toggle("on", !!document.querySelector(`input[data-addon="${key}"]`).checked);
        });
        itemRows($("q-items").querySelector("tbody"), $("q-items").querySelector("tfoot"), t.items, t);
      }
      $("q-valid").textContent = locked && state.quote.validUntil
        ? T("Sah sehingga ", "Valid until ") + new Date(state.quote.validUntil).toLocaleDateString("ms-MY")
        : T("Sah sehingga ", "Valid until ") + new Date(Date.now() + API.QUOTE_VALID_DAYS * 864e5).toLocaleDateString("ms-MY");
    };
    document.querySelectorAll('input[data-addon]').forEach((cb) => cb.addEventListener("change", refresh));
    refresh();
  }

  /* Create the quote if missing, accept it, then move to the invoice step */
  async function proceedFromQuote() {
    const btn = $("q-continue");
    btn.disabled = true;
    btn.textContent = T("Memproses…", "Processing…");
    try {
      if (!state.quote) {
        const t = computeTotals();
        state.quote = await API.createQuote({
          leadRef: state.lead.id,
          /* local demo prices from these items; PocketBase mode sends
             packageKey/addons and the hook re-prices server-side */
          packageKey: state.lead.pkgKey || null,
          addons: selectedAddons().map((a) => a.key),
          items: t.items.map((it) => ({ description: it.description, qty: it.qty, unitPrice: it.unitPrice })),
        });
        showToast(T("Sebut harga ", "Quote ") + state.quote.number + T(" diterbitkan.", " issued."));
      }
      if (state.quote.status !== "accepted") {
        state.quote = await API.acceptQuote(state.quote.number);
      }
      await renderInvoice();
      setStep(2);
    } catch (e) {
      showToast(T("Ralat: ", "Error: ") + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = state.quote && state.quote.status === "accepted"
        ? T("Sebut Harga Diterima ✓", "Quote Accepted ✓")
        : T("Terbitkan & Terima Sebut Harga →", "Issue & Accept Quote →");
    }
  }

  /* ---------- STEP 2 · INVOICE ---------- */
  async function renderInvoice() {
    if (!state.invoice && state.quote) state.invoice = await API.createInvoice(state.quote.number);
    const inv = state.invoice, q = state.quote;
    $("inv-title").textContent = T("Invois ", "Invoice ") + inv.number;
    infoGrid($("inv-info"), [
      [T("No. Invois", "Invoice No."), inv.number],
      [T("No. Sebut Harga", "Quote No."), q.number],
      [T("Rujukan", "Reference"), state.lead.id],
      [T("Koperasi", "Cooperative"), state.lead.coopName],
      [T("Diterbitkan", "Issued"), new Date(inv.issuedAt).toLocaleDateString("ms-MY")],
      [T("Tamat Tempoh", "Due"), new Date(inv.dueAt).toLocaleDateString("ms-MY")],
    ]);
    itemRows($("inv-items").querySelector("tbody"), $("inv-items").querySelector("tfoot"), q.items, q);
    $("pay-amount").textContent = RM(inv.amount);
    renderAudit();
  }

  /* ---------- STEP 3 · PAYMENT ---------- */
  function initPaymentControls() {
    if (state.paymentBound) return;
    state.paymentBound = true;

    const update = () => {
      const m = document.querySelector('input[name="paymethod"]:checked').value;
      $("fpx-banks").classList.toggle("hidden", m !== "fpx");
      $("bank-details").classList.toggle("hidden", m !== "bank_transfer");
      $("pay-submit").textContent = m === "bank_transfer"
        ? T("Saya Sudah Buat Pemindahan →", "I Have Made the Transfer →")
        : T("Bayar ", "Pay ") + (state.invoice ? RM(state.invoice.amount) : "");
    };
    document.querySelectorAll('input[name="paymethod"]').forEach((r) => r.addEventListener("change", update));
    $("bank-ref").textContent = "AGMX-" + (state.invoice ? state.invoice.number : "") + "-" + state.lead.id;
    update();

    $("pay-submit").addEventListener("click", async () => {
      const method = document.querySelector('input[name="paymethod"]:checked').value;
      const btn = $("pay-submit");
      btn.disabled = true;
      try {
        if (method === "billplz") {
          /* Hosted gateway: create a bill, then hand the payer to it. The
             API key never reaches the client — it is read from the environment
             inside the hook. The payment settles via the webhook below. */
          setStep(3.5);
          $("processing-sub").textContent = T("Membuka gerbang pembayaran Billplz…", "Opening the Billplz payment gateway…");
          const link = await API.createPaymentLink(state.invoice.number);
          sessionStorage.setItem("agmx_pending_payment", link.paymentId || "");
          sessionStorage.setItem("agmx_pending_invoice", state.invoice.number);
          window.location.href = link.url;
          return;
        }
        if (method !== "bank_transfer") {
          $("processing-sub").textContent =
            method === "fpx"
              ? T("Menunggu pengesahan ", "Awaiting confirmation from ") + $("fpx-bank").value + "…"
              : T("Menunggu pengesahan 3-D Secure bank anda…", "Awaiting your bank's 3-D Secure confirmation…");
          setStep(3.5);
          await new Promise((r) => setTimeout(r, 2200)); /* simulated gateway latency */
        }
        state.payment = await API.payInvoice(state.invoice.number, { method });
        await renderReceipt();
        setStep(4);
        showToast(T("Pembayaran berjaya dirakam.", "Payment recorded successfully."));
      } catch (e) {
        showToast(T("Ralat: ", "Error: ") + e.message);
        setStep(3);
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- STEP 4 · RECEIPT ---------- */
  async function renderReceipt() {
    const p = state.payment, inv = state.invoice;
    const pending = p.status === "pending";
    $("r-sub").textContent = pending
      ? T("Pemindahan bank anda menunggu pengesahan pasukan AGMX (1 hari bekerja).",
          "Your bank transfer is awaiting AGMX team verification (1 business day).")
      : T("Terima kasih! AGM koperasi anda kini dijadualkan untuk persediaan.",
          "Thank you! Your cooperative's AGM is now scheduled for preparation.");
    const stamp = document.querySelector(".stamp");
    stamp.innerHTML = pending ? T("MENUNGGU<br>PENGESAHAN", "PENDING<br>VERIFICATION") : T("DIBAYAR<br>✓", "PAID<br>✓");
    stamp.style.borderColor = pending ? "var(--c-warning)" : "var(--c-success)";
    stamp.style.color = pending ? "#92400E" : "#047857";
    infoGrid($("r-info"), [
      [T("No. Resit", "Receipt No."), p.id],
      [T("No. Invois", "Invoice No."), inv.number],
      [T("Kaedah", "Method"), p.methodLabel],
      [T("Rujukan Gateway", "Gateway Reference"), p.reference],
      [T("Jumlah", "Amount"), RM(p.amount)],
      [T("Dibayar Pada", "Paid At"), p.paidAt ? new Date(p.paidAt).toLocaleString("ms-MY") : "—"],
    ]);
    $("r-contact").textContent = state.lead.contactName + " (" + state.lead.contactPhone + ")";
    renderAudit();
  }

  /* ---------- AUDIT TRAIL ---------- */
  const EVENT_LABELS = {
    "assessment.submitted": T("Penilaian dihantar", "Assessment submitted"),
    "quote.created": T("Sebut harga diterbitkan", "Quote issued"),
    "quote.accepted": T("Sebut harga diterima", "Quote accepted"),
    "invoice.created": T("Invois diterbitkan", "Invoice issued"),
    "payment.succeeded": T("Pembayaran berjaya", "Payment succeeded"),
    "payment.pending_verification": T("Pemindahan menunggu pengesahan", "Transfer awaiting verification"),
    "lead.stage_changed": T("Peringkat dikemas kini", "Stage updated"),
  };

  async function renderAudit() {
    const events = await API.audit(state.lead.id);
    $("audit-list").innerHTML = events.length
      ? events.map((e) =>
          `<div class="audit-item">
             <span class="t">${new Date(e.ts).toLocaleString("ms-MY")}</span>
             <span><strong>${EVENT_LABELS[e.event] || e.event}</strong>
             <span style="color:var(--c-text-3)"> · ${escapeHtml(e.entityType)} ${escapeHtml(e.entityId)}</span></span>
           </div>`).join("")
      : `<p style="font-size:13px;color:var(--c-text-3)">${T("Tiada rekod lagi untuk rujukan ini.", "No records yet for this reference.")}</p>`;
  }

  /* ---------- BOOT ---------- */
  async function boot() {
    if (!API) { showToast(T("api.js gagal dimuatkan.", "api.js failed to load.")); return; }

    /* backend chip */
    try {
      const st = await API.status();
      $("backend-label").textContent = st.label;
      $("backend-chip").classList.toggle("live", !!st.ok);
    } catch (e) { /* non-fatal */ }

    /* static listeners (idempotent handlers check state before acting) */
    $("q-continue").addEventListener("click", proceedFromQuote);
    $("inv-pay").addEventListener("click", () => setStep(3));
    $("inv-print").addEventListener("click", () => window.print());
    $("r-print").addEventListener("click", () => window.print());

    /* returning from a hosted gateway (Billplz): the payment may already be
       settled by the webhook, so poll once before showing the invoice */
    const pendingId = sessionStorage.getItem("agmx_pending_payment");
    if (pendingId) {
      sessionStorage.removeItem("agmx_pending_payment");
      try {
        const deals = await API.listDeals();
        const paid = (deals || []).find(d => d.payment && d.payment.status === "succeeded");
        if (paid) {
          state.payment = paid.payment;
          state.invoice = paid.invoice;
          await renderReceipt();
          setStep(4);
          showToast(T("Pembayaran berjaya dirakam.", "Payment recorded successfully."));
          return;
        }
      } catch (e) { /* fall through to normal flow */ }
    }

    /* resolve lead: ?ref=LD-xxxx (+token) → else latest assessment (demo) */
    try {
      state.lead = ref ? await API.getAssessment(ref) : (await API.listAssessments())[0] || null;
    } catch (e) {
      showToast(T("Ralat: ", "Error: ") + e.message);
      $("empty-card").classList.remove("hidden");
      return;
    }

    if (!state.lead) {
      $("empty-card").classList.remove("hidden");
      return;
    }

    /* resume an existing deal if commercial documents already exist —
       getDeal() is token-gated per lead, so prospects never see (or
       need) the operator-wide listDeals() feed */
    let deal = null;
    try {
      deal = await API.getDeal(state.lead.id);
    } catch (e) {
      deal = null; /* fresh deal or transient error — start at step 1 */
    }

    if (deal && deal.payment) {
      state.quote = deal.quote; state.invoice = deal.invoice; state.payment = deal.payment;
      renderQuoteBuilder();
      await renderReceipt();
      setStep(4);
      return;
    }
    if (deal && deal.invoice) {
      state.quote = deal.quote; state.invoice = deal.invoice;
      renderQuoteBuilder();
      await renderInvoice();
      initPaymentControls();
      setStep(3);
      return;
    }
    if (deal && deal.quote) {
      state.quote = deal.quote;
      renderQuoteBuilder();
      initPaymentControls();
      if (state.quote.status === "accepted") {
        await renderInvoice();
        setStep(2);
      } else {
        setStep(1);
      }
      return;
    }

    /* fresh deal */
    renderQuoteBuilder();
    initPaymentControls();
    setStep(1);
    renderAudit();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
