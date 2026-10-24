/* ============================================================
   AGMX — Lead Inbox (Operator view, Sprint 2)
   Lists every assessment with its commercial documents,
   pipeline metrics, CSV export and backend switching.

   Demo honesty: reads from AGMX_COMMERCE (localStorage by default).
   Production: PocketBase — /api/agmx/deals is operator-only
   (users.role admin|secretary of the AGMX operator org); metrics
   are computed server-side in pb_hooks/money_flow.pb.js.
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

  const STAGE_CLASS = {
    "Assessment Diterima": "",
    "Dihubungi": "",
    "Sebut Harga Dihantar": "gold",
    "Sebut Harga Diterima": "warning",
    "Dibayar": "success",
    "AGM Dijadualkan": "success",
  };

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  const RM = (n) => API.RM(n);
  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3600);
  }
  const dt = (iso) => (iso ? new Date(iso).toLocaleDateString("ms-MY", { day: "2-digit", month: "short" }) : "—");

  let DEALS = [];
  let EVENTS = [];

  /* ---------- rendering ---------- */
  function renderMetrics(m) {
    $("m-leads").textContent = m.leads;
    $("m-pipeline").textContent = RM(m.pipelineValue);
    $("m-collected").textContent = RM(m.collectedValue);
    $("m-close").textContent = m.closeRate + "%";
  }

  function invoiceBadge(inv, pay) {
    if (!inv) return '<span class="badge" style="background:var(--c-divider);color:var(--c-text-2)">—</span>';
    if (pay && pay.status === "succeeded") return '<span class="badge success">' + T("Dibayar", "Paid") + '</span>';
    if (pay && pay.status === "pending") return '<span class="badge warning">' + T("Pengesahan", "Verifying") + '</span>';
    if (inv.status === "unpaid") return '<span class="badge danger">' + T("Belum Bayar", "Unpaid") + '</span>';
    return '<span class="badge">' + escapeHtml(inv.status) + "</span>";
  }

  function renderDeals(filter) {
    const q = (filter || "").toLowerCase();
    const rows = DEALS.filter((d) => {
      if (!q) return true;
      const l = d.lead;
      return [l.id, l.coopName, l.state, l.contactName, l.contactPhone, l.pkgName]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });

    if (!rows.length) {
      $("deals-wrap").innerHTML =
        '<p style="font-size:13.5px;color:var(--c-text-3);padding:14px 4px">' + T("Tiada penilaian", "No assessments") +
        (q ? T(" yang sepadan dengan carian", " matching your search") : T(" lagi", " yet")) +
        T(". Mulakan di ", ". Start at ") + '<a href="assessment.html">assessment.html</a>.</p>';
      return;
    }

    $("deals-wrap").innerHTML =
      '<table class="deals-table"><thead><tr>' +
      "<th>" + T("Rujukan", "Reference") + "</th><th>" + T("Koperasi", "Cooperative") + "</th><th>" + T("Ahli", "Members") + "</th><th>" + T("Skor", "Score") + "</th><th>" + T("Pakej", "Package") + "</th>" +
      '<th class="num">' + T("Nilai", "Value") + '</th><th>' + T("Tahap", "Stage") + '</th><th>' + T("Dokumen", "Documents") + '</th><th>' + T("Invois", "Invoice") + '</th><th></th>' +
      "</tr></thead><tbody>" +
      rows.map((d) => {
        const l = d.lead;
        const value = d.quote ? d.quote.total : l.pkgPrice || 0;
        const docs = [];
        if (d.quote) docs.push("QT " + d.quote.number + (d.quote.status === "accepted" ? " ✓" : ""));
        if (d.invoice) docs.push("INV " + d.invoice.number);
        if (d.payment) docs.push(d.payment.id);
        return (
          "<tr>" +
          '<td><strong>' + escapeHtml(l.id) + "</strong><div class=\"cell-sub\">" + dt(l.createdAt) + "</div></td>" +
          "<td><strong>" + escapeHtml(l.coopName) + "</strong><div class=\"cell-sub\">" +
            escapeHtml(l.state || "—") + (l.coopReg ? " · " + escapeHtml(l.coopReg) : "") + "</div></td>" +
          '<td class="num">' + Number(l.members || 0).toLocaleString("ms-MY") + "</td>" +
          '<td><span class="badge ' + (l.score >= 65 ? "danger" : l.score >= 35 ? "warning" : "success") + '">' + l.score + "</span></td>" +
          "<td>" + escapeHtml(l.pkgName || "—") + "</td>" +
          '<td class="num"><strong>' + RM(value) + "</strong>" +
            (d.quote ? '<div class="cell-sub">' + T("termasuk SST", "incl. tax") + '</div>' : '<div class="cell-sub">' + T("anggaran", "estimate") + '</div>') + "</td>" +
          '<td><span class="badge ' + (STAGE_CLASS[l.stage] || "") + '">' + escapeHtml(l.stage) + "</span></td>" +
          '<td style="font-size:12px;line-height:1.8">' + (docs.length ? docs.map(escapeHtml).join("<br>") : '<span style="color:var(--c-text-3)">—</span>') + "</td>" +
          "<td>" + invoiceBadge(d.invoice, d.payment) + "</td>" +
          '<td style="white-space:nowrap">' +
            '<a class="btn btn-primary btn-sm" href="checkout.html?ref=' + encodeURIComponent(l.id) + '">' +
              (d.invoice && d.invoice.status === "paid" ? T("Lihat", "View") : T("Proses", "Process")) + " →</a> " +
            (l.stage === "Assessment Diterima"
              ? '<button class="btn btn-ghost btn-sm" data-contact="' + escapeHtml(l.id) + '">' + T("Tanda Dihubungi", "Mark Contacted") + '</button>'
              : "") +
            (d.payment && d.payment.status === "pending"
              ? ' <button class="btn btn-ghost btn-sm" data-confirm="' + escapeHtml(d.payment.id) + '" title="' + T("Sahkan pemindahan bank", "Verify bank transfer") + '">' + T("Sahkan Bayaran", "Confirm Payment") + '</button>'
              : "") +
          "</td>" +
          "</tr>"
        );
      }).join("") +
      "</tbody></table>";
  }

  const EVENT_LABELS = {
    "assessment.submitted": T("Penilaian dihantar", "Assessment submitted"),
    "quote.created": T("Sebut harga diterbitkan", "Quote issued"),
    "quote.accepted": T("Sebut harga diterima", "Quote accepted"),
    "invoice.created": T("Invois diterbitkan", "Invoice issued"),
    "payment.succeeded": T("Pembayaran berjaya", "Payment succeeded"),
    "payment.pending_verification": T("Pemindahan menunggu pengesahan", "Transfer awaiting verification"),
    "lead.stage_changed": T("Peringkat dikemas kini", "Stage updated"),
  };

  function renderAudit() {
    $("audit-list").innerHTML = EVENTS.length
      ? EVENTS.slice(0, 60).map((e) =>
          '<div class="audit-item"><span class="t">' + new Date(e.ts).toLocaleString("ms-MY") + "</span>" +
          "<span><strong>" + (EVENT_LABELS[e.event] || escapeHtml(e.event)) + "</strong>" +
          '<span style="color:var(--c-text-3)"> · ' + escapeHtml(e.entityType) + " " + escapeHtml(e.entityId) +
          (e.detail && e.detail.amount ? " · " + RM(e.detail.amount) : "") + "</span></span></div>"
        ).join("")
      : '<p style="font-size:13px;color:var(--c-text-3)">' + T("Tiada aktiviti lagi.", "No activity yet.") + '</p>';
  }

  /* ---------- CSV export ---------- */
  function exportCsv() {
    const head = [T("Rujukan", "Reference"), T("Tarikh", "Date"), T("Koperasi", "Cooperative"), "NoPendaftaran", T("Negeri", "State"), T("Ahli", "Members"), T("Skor", "Score"),
      T("Pakej", "Package"), T("Nilai", "Value"), T("Tahap", "Stage"), "SebutHarga", "Invois", "StatusInvois", T("Resit", "Receipt"), "PIC", T("Telefon", "Phone"), T("Emel", "Email")];
    /* RFC4180 quoting + formula-injection guard (=, +, -, @, tab, CR
       prefixes are neutralised) — implemented in api.js so it is testable */
    const esc = API.csvEscape;
    const lines = [head.map(esc).join(",")];
    for (const d of DEALS) {
      const l = d.lead;
      lines.push([
        l.id, l.createdAt, l.coopName, l.coopReg, l.state, l.members, l.score,
        l.pkgName, d.quote ? d.quote.total : l.pkgPrice, l.stage,
        d.quote ? d.quote.number : "", d.invoice ? d.invoice.number : "",
        d.invoice ? d.invoice.status : "", d.payment ? d.payment.id : "",
        l.contactName, l.contactPhone, l.contactEmail,
      ].map(esc).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "agmx-leads-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(T("CSV dieksport (", "CSV exported (") + DEALS.length + T(" baris).", " rows)."));
  }

  /* ---------- backend chip / settings ---------- */
  function fillBackendDialog() {
    const cfgRaw = localStorage.getItem("agmx_backend_cfg");
    try {
      const cfg = cfgRaw ? JSON.parse(cfgRaw) : null;
      $("pb-url").value = (cfg && cfg.mode === "pocketbase" && cfg.url) || "";
    } catch (e) { /* ignore */ }
  }

  async function loadAll() {
    try {
      DEALS = await API.listDeals();
      EVENTS = await API.audit();
      const m = await API.metrics();
      renderMetrics(m);
      renderDeals($("search").value);
      renderAudit();
    } catch (e) {
      showToast(T("Ralat memuatkan data: ", "Error loading data: ") + e.message);
    }
  }

  /* ---------- boot ---------- */
  async function boot() {
    if (!API) { showToast(T("api.js gagal dimuatkan.", "api.js failed to load.")); return; }

    try {
      const st = await API.status();
      $("backend-label").textContent = st.label;
      $("backend-chip").classList.toggle("live", !!st.ok);
    } catch (e) { /* non-fatal */ }

    $("search").addEventListener("input", (e) => renderDeals(e.target.value));
    $("btn-refresh").addEventListener("click", loadAll);
    $("btn-export").addEventListener("click", exportCsv);

    /* stage + payment actions (delegated) */
    $("deals-wrap").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-contact], button[data-confirm]");
      if (!btn) return;
      try {
        if (btn.dataset.contact) {
          await API.updateLeadStage(btn.dataset.contact, "Dihubungi");
          showToast(btn.dataset.contact + T(" ditanda sebagai Dihubungi.", " marked as Contacted."));
        } else {
          await API.confirmPayment(btn.dataset.confirm);
          showToast(T("Pembayaran ", "Payment ") + btn.dataset.confirm + T(" disahkan — invois ditandai dibayar.", " verified — invoice marked paid."));
        }
        loadAll();
      } catch (err) {
        showToast(T("Ralat: ", "Error: ") + err.message);
      }
    });

    /* backend settings dialog */
    const dlg = $("backend-dialog");
    $("backend-chip").addEventListener("click", () => { fillBackendDialog(); dlg.showModal(); });
    $("pb-save").addEventListener("click", () => {
      const url = $("pb-url").value.trim();
      if (url) {
        API.configure({ mode: "pocketbase", url });
        showToast(T("Backend PocketBase dikonfigurasi. Memuat semula…", "PocketBase backend configured. Reloading…"));
      } else {
        showToast(T("URL PocketBase diperlukan (contoh: http://127.0.0.1:8090).", "PocketBase URL is required (e.g. http://127.0.0.1:8090)."));
        return;
      }
      setTimeout(() => location.reload(), 700);
    });
    $("pb-clear").addEventListener("click", () => {
      API.configure(null);
      showToast(T("Kembali ke demo tempatan. Memuat semula…", "Back to local demo. Reloading…"));
      setTimeout(() => location.reload(), 700);
    });

    await loadAll();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
