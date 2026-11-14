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
  /* Fail closed: if /api/config.js never arrived, or arrived without a
     paymentsMode, "all" would unhide FPX/card/Billplz pills that nothing can
     settle and print a receipt for a payment no gateway has seen. */
  const PAY_MODE = String((window.AGMX_CONFIG && window.AGMX_CONFIG.paymentsMode) || "bank_transfer").toLowerCase();

  /* Optional add-ons. These three lines came from the PocketBase hook's rate
     card (archive/pocketbase-v1/pb_hooks/money_flow.lib.js:52), and money-flow
     has no equivalent: it prices a quote from one plans row and ignores the
     addon keys this page sends. So on a live order a ticked add-on is a request
     the team prices by hand, never a line on the invoice — which is why no
     price is printed next to it. The keys still travel, because the lead keeps
     them for whoever takes the call. */
  const LIVE_BACKEND = !!(API && API.mode === "supabase");
  const ADDONS = [
    { key: "facilitator", label: T("Fasilitator AGM Tambahan", "Additional AGM Facilitator"), desc: T("1 fasilitator berpengalaman untuk dewan besar / kawalan kehadiran", "1 experienced facilitator for the hall / attendance control"), price: 800 },
    { key: "translate", label: T("Penterjemahan Simultan BM ⇄ EN", "Simultaneous BM ⇄ EN Interpretation"), desc: T("Terjemahan langsung semasa AGM untuk ahli pelbagai bahasa", "Live interpretation during the AGM for multilingual members"), price: 1200 },
    { key: "printpack", label: T("Pek Mesyuarat Dicetak & Dihantar", "Printed & Delivered Meeting Pack"), desc: T("Pek mesyuarat fizikal dicetak dan dihantar ke dewan AGM", "Physical meeting packs printed and delivered to the AGM hall"), price: 600 },
  ];

  /* Governance OS subscriptions — prices and names read from price-list.js,
     which mirrors the plans rows money-flow bills from. Descriptions stay
     here, and say what is running rather than what the tier promises. */
  const RATE_CARD = window.AGMX_PRICE_LIST || null;
  const SUB_PLAN_COPY = {
    governance_os_essential: T("Sedia untuk AGM tahunan: notis, agenda, minit, rekod kehadiran dan peti dokumen", "Ready for an annual AGM: notice, agenda, minutes, attendance records and the document vault"),
    governance_os_professional: T("Essential + laporan lanjut, sokongan keutamaan, dan muat naik data berpandu", "Essential + advanced reporting, priority support and guided data load"),
    governance_os_enterprise: T("Professional + parameter kuorum/notis/ambang setiap koperasi, kontak pelaksanaan dinamakan. SSO, API dan domain tersuai belum disediakan.", "Professional + per-cooperative quorum, notice and threshold parameters, a named implementation contact. SSO, API and a custom domain are not delivered yet."),
    governance_os_federation: T("Enterprise + struktur berbilang koperasi. Papan pemuka konsolidasi dan pengebilan gabungan masih dalam reka bentuk — diskop dahulu.", "Enterprise + a multi-cooperative structure. The roll-up dashboard and consolidated billing are still being designed — scoped first."),
  };
  const SUB_PLANS = (RATE_CARD ? RATE_CARD.subscriptions() : []).map((p) => ({
    key: p.key,
    code: p.code,
    name: T(p.name.replace("Governance OS ", ""), p.name.replace("Governance OS ", "")),
    monthly: p.monthly,
    annual: p.annual,
    description: SUB_PLAN_COPY[p.code] || p.name,
  }));

  const state = {
    lead: null,
    quote: null,
    invoice: null,
    payment: null,
    subscription: null,
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
      ["sub-card", 5], ["sub-detail-card", 5.5],
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
    /* money-flow prices a quote from a single plans row and ignores both the
       items array and the addon keys this page sends, so a live preview that
       added them would show a total that quietly drops when the server
       answers. The keys still travel as a request; they are not a line here. */
    const extras = LIVE_BACKEND ? [] : selectedAddons().map((a) => lineItem(a.label, a.price));
    const items = [
      lineItem(state.lead.pkgName + T(" — perkhidmatan AGM sekali gus", " — one-off AGM service"), state.lead.pkgPrice),
    ].concat(extras);
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
         <span><strong style="font-size:13.5px">${a.label}</strong> · <strong style="color:var(--c-primary)">${
           LIVE_BACKEND ? T("dibincang dengan kami", "arranged with us") : "+" + RM(a.price)
         }</strong>
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
    if (PAY_MODE === "bank_transfer") {
      /* Gateway (FPX/card/Billplz) keys are not configured yet: show only
         the manual transfer option instead of a dead payment button. */
      document.querySelectorAll(".pay-pill").forEach((label) => {
        const input = label.querySelector('input[name="paymethod"]');
        if (input && input.value !== "bank_transfer") label.classList.add("hidden");
      });
      const bank = document.querySelector('input[name="paymethod"][value="bank_transfer"]');
      if (bank) bank.checked = true;
    }
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
          /* PAY_MODE is derived from gateway key presence, so a non-transfer method
             here means the pills were unhidden without a working gateway. Refuse
             rather than print a receipt for a payment no gateway has seen. */
          if (PAY_MODE !== "all") {
            throw new Error(T(
              "kaedah ini belum tersedia pada deployment ini — tiada kunci gerbang pembayaran dikonfigurasi",
              "this method is not available on this deployment — no payment gateway key is configured"));
          }
          $("processing-sub").textContent =
            method === "fpx"
              ? T("Mod demo — menunggu pengesahan ", "Demo mode — awaiting confirmation from ") + $("fpx-bank").value + "…"
              : T("Mod demo — tiada 3-D Secure sebenar berlaku…", "Demo mode — no real 3-D Secure exchange is happening…");
          setStep(3.5);
          await new Promise((r) => setTimeout(r, 600)); /* simulated hand-off beat, demo only */
        }
        state.payment = await API.payInvoice(state.invoice.number, { method });
        /* Supabase mode hands the payer to the hosted gateway (Billplz /
           HitPay); the signed webhook settles the invoice and the return
           URL brings the prospect back to this page with ?ref=&t=. */
        if (state.payment.redirectUrl) {
          sessionStorage.setItem("agmx_pending_invoice", state.invoice.number);
          window.location.href = state.payment.redirectUrl;
          return;
        }
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

    /* Sprint 2: after payment, offer to create the AGM. Store the lead in
       sessionStorage so agm-schedule.html can pre-fill the form. */
    const rActions = $("r-actions");
    if (rActions && !rActions.querySelector("#r-create-agm")) {
      const btn = document.createElement("button");
      btn.id = "r-create-agm";
      btn.type = "button";
      btn.textContent = T("Cipta AGM Sekarang →", "Create AGM Now →");
      btn.className = "btn btn-primary";
      btn.onclick = async () => {
        try {
          sessionStorage.setItem("agmx_lead_for_agm", JSON.stringify(state.lead));
          location.href = "/agm-schedule.html";
        } catch (e) {
          showToast(T("Ralat: ", "Error: ") + e.message);
        }
      };
      rActions.appendChild(btn);
    }
  }

  /* ---------- STEP 5 · SUBSCRIPTION (Governance OS) ---------- */
  function renderSubscriptionBuilder() {
    /* Determine if the accepted quote is for a subscription plan.
       The lead's pkgKey will indicate the plan (essential_agm, professional_agm, etc.)
       If it's a subscription plan, we show the subscription step. */
    const lead = state.lead;
    const isSubscriptionPlan = lead.pkgKey && lead.pkgKey.endsWith("_agm");
    
    if (!isSubscriptionPlan) {
      /* Not a subscription plan — skip to receipt */
      setStep(4);
      return;
    }

    $("sub-title").textContent = T("Langganan Governance OS", "Governance OS Subscription");
    infoGrid($("sub-info"), [
      [T("Rujukan Penilaian", "Assessment Reference"), lead.id],
      [T("Koperasi", "Cooperative"), lead.coopName],
      [T("Pakej Disarankan", "Recommended Package"), lead.pkgName],
      [T("Skor Kerumitan", "Complexity Score"), lead.score + "/100"],
      [T("Ahli", "Members"), Number(lead.members).toLocaleString("ms-MY")],
    ]);

    /* Find the matching subscription plan. price-list.js is a static sibling
       file, so an absent catalog means the page was served a truncated bundle —
       saying so beats rendering a plan list with nothing in it. */
    const planKey = String(lead.pkgKey || "").replace("_agm", "");
    const plan = SUB_PLANS.find((p) => p.key === planKey) || SUB_PLANS[0] || null;

    /* Render plan cards */
    $("sub-plan-list").innerHTML = plan ? SUB_PLANS.map((p) => {
      const isSelected = p.key === plan.key;
      return `<label class="addon${isSelected ? " on" : ""}" data-sub-plan="${p.key}" style="cursor:pointer">
        <input type="radio" name="sub-plan" value="${p.key}" ${isSelected ? "checked" : ""} style="margin-top:3px;accent-color:var(--c-primary);width:16px;height:16px">
        <span>
          <strong style="font-size:14px">${p.name}</strong> · <strong style="color:var(--c-primary);font-size:15px">RM${p.annual.toLocaleString("ms-MY")}${T("/tahun", "/yr")}</strong>
          <div style="font-size:12px;color:var(--c-text-2);margin-top:4px">${p.description}</div>
          <div style="font-size:11px;color:var(--c-text-3);margin-top:4px">${T("RM", "RM")}${p.monthly}${T("/bulan (bil tahunan)", "/mo (billed annually)")}</div>
        </span>
      </label>`;
    }).join("") : `<p class="muted">${T("Kad harga langganan tidak dimuatkan. Muat semula halaman ini sebelum meneruskan — kami tidak akan mengagak harganya.", "The subscription rate card did not load. Reload this page before continuing — we will not guess at its prices.")}</p>`;

    /* Pre-select the recommended plan */
    const selectedPlan = plan;
    renderSelectedPlan(selectedPlan);

    /* Add click handlers for plan selection */
    document.querySelectorAll('[data-sub-plan]').forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.subPlan;
        const p = SUB_PLANS.find((pl) => pl.key === key);
        if (p) {
          document.querySelectorAll('[data-sub-plan]').forEach((c) => c.classList.remove("on"));
          card.classList.add("on");
          card.querySelector('input[name="sub-plan"]').checked = true;
          renderSelectedPlan(p);
        }
      });
    });

    /* Set up create subscription button */
    $("sub-create").onclick = async () => {
      const btn = $("sub-create");
      btn.disabled = true;
      btn.textContent = T("Memproses…", "Processing…");
      try {
        const picker = document.querySelector('input[name="sub-plan"]:checked');
        /* The plan actually billed is the one the accepted quote carries; the
           picker only chooses a plan on the demo backend, where no quote exists. */
        state.subscription = await API.createSubscription({
          quoteRef: state.quote && state.quote.id ? state.quote.id : null,
          leadRef: lead.id,
          planKey: picker ? picker.value + "_agm" : null,
          billingCycle: "annual",
        });
        showToast(T("Langganan ", "Subscription ") + state.subscription.number + T(" dicipta.", " created."));
        await renderSubscriptionDetail();
        setStep(5.5);
      } catch (e) {
        showToast(T("Ralat: ", "Error: ") + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = T("Buat Langganan →", "Create Subscription →");
      }
    };
  }

  function renderSelectedPlan(plan) {
    if (!plan) {
      $("sub-selected-wrap").classList.add("hidden");
      $("sub-billing").classList.add("hidden");
      return;
    }
    $("sub-selected-wrap").classList.remove("hidden");
    $("sub-selected-detail").innerHTML = `
      <strong style="font-size:15px">${plan.name}</strong> — RM${plan.annual.toLocaleString("ms-MY")}${T("/tahun", "/yr")}
      <div style="font-size:12px;color:var(--c-text-2);margin-top:4px">${plan.description}</div>
    `;
    $("sub-billing").classList.remove("hidden");
    infoGrid($("sub-billing-info"), [
      [T("Kitaran Bil", "Billing Cycle"), T("Tahunan — 12 bulan dari tarikh mula", "Annual — 12 months from the start date")],
      [T("Harga Tahunan", "Annual Price"), `RM${plan.annual.toLocaleString("ms-MY")}`],
      [T("Invois Pertama", "First Invoice"), T("Dijadwalkan pada hari langganan dicipta", "Scheduled the day the subscription is created")],
      [T("Pembaharuan Automatik", "Auto Renewal"), T("Ya — tahun kedua bermula sehari selepas tempoh pertama tamat", "Yes — the second year starts the day the first period ends")],
      [T("Cukai 8%", "Tax 8%"), T("Dikenakan pada setiap invois", "Applied on each invoice")],
    ]);
    /* The RPC writes trial_ends_at as start + 14 days and schedules the first
       annual invoice for now() in the same statement, so there is no
       un-invoiced fortnight to cancel into. */
    $("sub-trial").textContent = T("Rekod langganan menyimpan tarikh tamat percubaan 14 hari, tetapi invois tahunan pertama sudah dijadwalkan pada hari ia dicipta — jadi tiada tempoh tanpa invois. Membatalkan dalam tempoh ini menghentikan pembaharuan tahun berikutnya, bukan invois yang telah diterbitkan.", "The subscription record stores a 14-day trial end, but the first annual invoice is scheduled the day it is created — there is no un-invoiced period. Cancelling inside it stops next year's renewal, not an invoice already issued.");
  }

  async function renderSubscriptionDetail() {
    if (!state.subscription) return;
    const sub = state.subscription;

    $("sd-title").textContent = T("Butiran Langganan", "Subscription Details");
    infoGrid($("sd-info"), [
      [T("No. Langganan", "Subscription No."), sub.number],
      [T("Pakej", "Package"), sub.planName || sub.planKey],
      [T("Status", "Status"), sub.status],
      [T("Kitaran Bil", "Billing Cycle"), sub.billingCycle],
      [T("Mula", "Starts"), sub.currentPeriodStart ? new Date(sub.currentPeriodStart).toLocaleDateString("ms-MY") : "—"],
      [T("Tamat Tempoh", "Period Ends"), sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString("ms-MY") : "—"],
      [T("Percubaan Tamat", "Trial Ends"), sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString("ms-MY") : T("Tiada", "None")],
      [T("Pembaharuan Automatik", "Auto Renew"), sub.autoRenew ? T("Ya", "Yes") : T("Tidak", "No")],
    ]);

    /* Render recurring invoices */
    if (sub.recurringInvoices && sub.recurringInvoices.length) {
      const tbody = $("sd-recurring-invoices").querySelector("tbody");
      tbody.innerHTML = sub.recurringInvoices.map((ri) => `
        <tr>
          <td>${escapeHtml(ri.number)}</td>
          <td class="num">${ri.issuedAt ? new Date(ri.issuedAt).toLocaleDateString("ms-MY") : "—"}</td>
          <td class="num">${ri.dueAt ? new Date(ri.dueAt).toLocaleDateString("ms-MY") : "—"}</td>
          <td class="num">${RM(ri.amount)}</td>
          <td><span class="badge" style="background:var(--c-${ri.status === "paid" ? "success" : ri.status === "pending" ? "warning" : "text"}-100);color:var(--c-${ri.status === "paid" ? "success" : ri.status === "pending" ? "warning" : "text"}-700)}">${ri.status}</span></td>
        </tr>
      `).join("");
    } else {
      $("sd-recurring-invoices").querySelector("tbody").innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--c-text-3);padding:20px">${T("Tiada bil bertolak ansur lagi.", "No recurring invoices yet.")}</td></tr>`;
    }

    /* Render payment schedules */
    if (sub.paymentSchedules && sub.paymentSchedules.length) {
      const tbody = $("sd-payment-schedules").querySelector("tbody");
      tbody.innerHTML = sub.paymentSchedules.map((ps) => `
        <tr>
          <td>${escapeHtml(ps.invoiceNumber || "—")}</td>
          <td class="num">${ps.scheduledAt ? new Date(ps.scheduledAt).toLocaleDateString("ms-MY") : "—"}</td>
          <td class="num">${RM(ps.amount)}</td>
          <td><span class="badge" style="background:var(--c-${ps.status === "paid" ? "success" : ps.status === "pending" ? "warning" : "text"}-100);color:var(--c-${ps.status === "paid" ? "success" : ps.status === "pending" ? "warning" : "text"}-700)}">${ps.status}</span></td>
        </tr>
      `).join("");
    } else {
      $("sd-payment-schedules").querySelector("tbody").innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--c-text-3);padding:20px">${T("Tiada jadual pembayaran lagi.", "No payment schedules yet.")}</td></tr>`;
    }

    /* Cancel subscription */
    $("sd-cancel").onclick = async () => {
      if (!confirm(T("Batalkan langganan ini? Akses kekal sehingga tamat tempoh bil semasa.", "Cancel this subscription? Access remains until end of current billing period."))) return;
      const btn = $("sd-cancel");
      btn.disabled = true;
      btn.textContent = T("Membatalkan…", "Cancelling…");
      try {
        state.subscription = await API.cancelSubscription(sub.id);
        showToast(T("Langganan dibatalkan.", "Subscription cancelled."));
        await renderSubscriptionDetail();
      } catch (e) {
        showToast(T("Ralat: ", "Error: ") + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = T("Batalkan Langganan", "Cancel Subscription");
      }
    };

    /* Generate recurring invoice now */
    $("sd-renew").onclick = async () => {
      const btn = $("sd-renew");
      btn.disabled = true;
      btn.textContent = T("Menterbitkan…", "Generating…");
      try {
        const inv = await API.generateRecurringInvoice(sub.id);
        showToast(T("Bil ", "Invoice ") + inv.number + T(" diterbitkan.", " generated."));
        state.subscription = await API.getSubscription(sub.id);
        await renderSubscriptionDetail();
      } catch (e) {
        showToast(T("Ralat: ", "Error: ") + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = T("Terbitkan Bil Sekarang", "Generate Invoice Now");
      }
    };
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
    "subscription.created": T("Langganan dicipta", "Subscription created"),
    "subscription.cancelled": T("Langganan dibatalkan", "Subscription cancelled"),
    "subscription.invoice_generated": T("Bil bertolak ansur diterbitkan", "Recurring invoice generated"),
    "recurring_invoice.generated": T("Bil bertolak ansur diterbitkan", "Recurring invoice generated"),
    "subscription.renewed": T("Langganan diperbaharui", "Subscription renewed"),
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
       settled by the webhook. getDeal() is token-gated per lead, so this
       works for prospects without an operator session. */
    const pendingInvoice = sessionStorage.getItem("agmx_pending_invoice");
    const pendingPayment = sessionStorage.getItem("agmx_pending_payment");
    if (pendingInvoice || pendingPayment) {
      sessionStorage.removeItem("agmx_pending_invoice");
      sessionStorage.removeItem("agmx_pending_payment");
      try {
        const deal = ref ? await API.getDeal(ref) : null;
        if (deal && deal.payment) {
          state.lead = deal.lead;
          state.quote = deal.quote;
          state.invoice = deal.invoice;
          state.payment = deal.payment;
          renderQuoteBuilder();
          await renderReceipt();
          setStep(4);
          showToast(deal.payment.status === "succeeded"
            ? T("Pembayaran berjaya dirakam.", "Payment recorded successfully.")
            : T("Pembayaran sedang disahkan oleh gerbang.", "Payment is being confirmed by the gateway."));
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
