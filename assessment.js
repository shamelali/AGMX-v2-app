/* ============================================================
   AGMX — AGM Assessment Engine (Revenue Engine v1)
   Public: assessment.html
   Demo: pure client-side. Production target: POST to PocketBase
   (agm_assessments via pb_hooks/money_flow.pb.js — the hook
   recomputes the score server-side and returns the LD-xxxx
   reference + checkout token used by checkout.html).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Language (BM default; shared key with index/app) ---------- */
  const LANG = (() => {
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q === "en" || q === "ms") return q;
      return localStorage.getItem("agmx-lang") === "en" ? "en" : "ms";
    } catch (_) { return "ms"; }
  })();
  const T = (ms, en) => (LANG === "en" ? en : ms);

  /* ---------- Scoring model (max = 100) ---------- */
  const FACTORS = {
    members: { label: T("Saiz Ahli", "Member base"), max: 30, fn: (m) =>
      m < 300 ? 5 : m < 1000 ? 15 : m < 2000 ? 22 : 30 },
    mode: { label: T("Mode AGM", "AGM format"), max: 12, fn: (mode) =>
      ({ physical: 4, online: 9, hybrid: 12 })[mode] || 4 },
    attendance: { label: T("Jangkaan Kehadiran", "Expected attendance"), max: 16, fn: (ratio) =>
      ratio < 0.3 ? 5 : ratio <= 0.5 ? 10 : 16 },
    candidates: { label: T("Calon Lembaga", "Board candidates"), max: 12, fn: (c) =>
      c < 1 ? 2 : c <= 3 ? 4 : c <= 7 ? 8 : 12 },
    motions: { label: T("Usul / Resolusi", "Motions / resolutions"), max: 10, fn: (n) =>
      n <= 5 ? 3 : n <= 15 ? 6 : 10 },
    process: { label: T("Proses Semasa", "Current process"), max: 10, fn: (p) =>
      ({ digital: 3, mixed: 6, manual: 10 })[p] || 6 },
    managed: { label: T("AGM Terurus", "Managed AGM"), max: 10, fn: (y) => (y ? 10 : 2) },
  };

  /* ---------- Packages ---------- */
  const AGM_PACKAGES = [
    {
      key: "essential", name: "AGMX Essential AGM", price: 1500,
      blurb: T("Untuk koperasi kecil, AGM fizikal ringkas.", "For small cooperatives running a simple in-person AGM."),
      includes: [T("Sehingga 500 ahli", "Up to 500 members"), T("1 sesi AGM", "1 AGM session"), T("E-voting asas", "Basic e-voting"), T("Minit digital", "Digital minutes"), T("Jejak audit", "Audit trail")],
    },
    {
      key: "professional", name: "AGMX Professional AGM", price: 3500, recommended: true,
      blurb: T("Pakej paling popular — AGM terurus penuh.", "Most popular — fully managed AGM."),
      includes: [T("Sehingga 2,000 ahli", "Up to 2,000 members"), T("AGM Hibrid / Dalam Talian", "Hybrid / online AGM"), T("E-voting penuh + hash chain", "Full e-voting + hash chain"), T("AI Setiausaha (minit)", "AI secretary (minutes)"), T("Mod Warga Emas", "Senior mode"), T("Pek Mesyuarat Digital", "Digital meeting pack"), T("Fasilitator AGM", "AGM facilitator")],
    },
    {
      key: "enterprise", name: "AGMX Enterprise AGM", price: 7500,
      blurb: T("Koperasi besar / berisiko tinggi, keperluan khas.", "Large / high-risk cooperatives with special requirements."),
      includes: [T("Sehingga 5,000+ ahli", "5,000+ members"), T("Semua ciri Professional", "All Professional features"), T("AI Copilot penuh (4 ejen)", "Full AI copilot (4 agents)"), T("Pematuhan GP14/GP14B/UUK", "GP14/GP14B/UUK compliance"), T("Pengurus projek khusus", "Dedicated project manager"), T("Laporan audit SKM", "SKM audit report")],
    },
  ];

  const ANNUAL_PLANS = [
    { members: 300, name: "Governance Essential", monthly: 600 },
    { members: 1000, name: "Governance Professional", monthly: 800 },
    { members: 2000, name: "Governance Enterprise", monthly: 1000 },
    { members: Infinity, name: "Governance Federation", monthly: 1250 },
  ];

  const RM = (n) => "RM" + n.toLocaleString("ms-MY");

  /* ---------- Scoring ---------- */
  function computeScore(data) {
    const out = { total: 0, factors: [] };
    for (const key of Object.keys(FACTORS)) {
      const f = FACTORS[key];
      const points = f.fn(data[key]);
      out.total += points;
      out.factors.push({ label: f.label, points, max: f.max });
    }
    return out;
  }

  function pickAgmPackage(score, members) {
    // Member-count floor: 2,000+ members always Enterprise-tier minimum
    if (members >= 2000) return AGM_PACKAGES[2];
    if (score < 35) return AGM_PACKAGES[0];
    if (score < 65) return AGM_PACKAGES[1];
    return AGM_PACKAGES[2];
  }

  function pickAnnualPlan(members) {
    return ANNUAL_PLANS.find((p) => members < p.members);
  }

  function scoreBadge(score) {
    if (score < 35) return { text: T("Rendah — AGM ringkas", "Low — simple AGM"), cls: "success" };
    if (score < 65) return { text: T("Sederhana — AGM terurus disarankan", "Medium — managed AGM recommended"), cls: "warning" };
    return { text: T("Tinggi — AGM Enterprise", "High — Enterprise AGM"), cls: "danger" };
  }

  /* ---------- Render helpers ---------- */
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 4200);
  }

  /* ---------- Lead persistence (AGMX_COMMERCE: local demo ↔ PocketBase) ----------
     Uses api.js when present. Legacy fallback keeps the page working
     standalone (same localStorage key, same shape).
     Note: window.AGMX_API belongs to pocketbase-client.js (dashboard
     query layer) — the commerce facade deliberately uses its own name. */
  const API = window.AGMX_COMMERCE || null;
  const LEAD_KEY = "agmx_leads_v1";

  async function saveLead(lead) {
    if (API) {
      const stored = await API.submitAssessment(lead);
      renderBackendChip();
      return stored;
    }
    /* legacy path (no api.js) */
    const leads = loadLeads();
    lead.id = "LD-" + String(1000 + leads.length + 1).slice(1);
    lead.createdAt = new Date().toISOString();
    lead.stage = "Assessment Diterima";
    leads.unshift(lead);
    localStorage.setItem(LEAD_KEY, JSON.stringify(leads));
    return lead;
  }

  async function loadLeads() {
    if (API) return API.listAssessments();
    try { return JSON.parse(localStorage.getItem(LEAD_KEY)) || []; } catch { return []; }
  }

  async function renderBackendChip() {
    if (!API) return;
    try {
      const st = await API.status();
      const chip = document.getElementById("backend-chip");
      if (!chip) return;
      document.getElementById("backend-label").textContent = st.label;
      chip.classList.toggle("live", !!st.ok);
    } catch (e) { /* non-fatal */ }
  }

  function renderLeadTable() {
    loadLeads().then((leads) => {
      const wrap = $("lead-table-wrap");
      if (!leads.length) {
        wrap.innerHTML = `<p style="font-size:13px;color:var(--c-text-3)">${T("Tiada penilaian lagi. Isi borang di atas untuk melihat aliran jualan.", "No assessments yet. Fill in the form above to see the sales flow.")}</p>`;
        return;
      }
      const rows = leads.map((l) =>
        `<tr>
        <td><strong>${escapeHtml(l.coopName)}</strong><br><span style="color:var(--c-text-3);font-size:12px">${escapeHtml(l.coopReg || "—")} · ${escapeHtml(l.state)}</span></td>
        <td>${l.members.toLocaleString("ms-MY")} ${T("ahli", "members")}</td>
        <td><span class="badge ${l.score >= 65 ? "danger" : l.score >= 35 ? "warning" : "success"}">${l.score}/100</span></td>
        <td><span class="badge gold">${escapeHtml(l.pkgName)}</span></td>
        <td><strong>${RM(l.quote)}</strong></td>
        <td><span class="badge success">${escapeHtml(l.stage)}</span></td>
      </tr>`).join("");
      wrap.innerHTML =
        `<div style="overflow-x:auto"><table class="table">
        <thead><tr><th>${T("Koperasi","Cooperative")}</th><th>${T("Ahli","Members")}</th><th>${T("Skor","Score")}</th><th>${T("Pakej","Package")}</th><th>${T("Anggaran","Estimate")}</th><th>${T("Status","Status")}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    });
  }

  /* ---------- Main evaluation ---------- */
  async function evaluate(ev) {
    ev.preventDefault();

    const data = {
      coopName: $("coop-name").value.trim(),
      coopReg: $("coop-reg").value.trim(),
      state: $("coop-state").value,
      members: parseInt($("coop-members").value, 10),
      agmDate: $("agm-date").value,
      mode: document.querySelector('input[name="mode"]:checked').value,
      attendance: parseInt($("agm-attendance").value, 10),
      candidates: parseInt($("agm-candidates").value, 10) || 0,
      motions: parseInt($("agm-motions").value, 10) || 0,
      process: $("agm-process").value,
      managed: document.querySelector('input[name="managed"]:checked').value === "yes",
      contactName: $("contact-name").value.trim(),
      contactPhone: $("contact-phone").value.trim(),
      contactEmail: $("contact-email").value.trim(),
    };

    if (!data.coopName || !data.state || !data.members || !data.attendance ||
        !data.contactName || !data.contactPhone) {
      showToast(T("Sila lengkapkan semua ruangan bertanda *.", "Please complete all fields marked *."));
      return;
    }

    const score = computeScore({
      members: data.members,
      mode: data.mode,
      attendance: data.attendance / Math.max(1, data.members),
      candidates: data.candidates,
      motions: data.motions,
      process: data.process,
      managed: data.managed,
    });

    const pkg = pickAgmPackage(score.total, data.members);
    const annual = pickAnnualPlan(data.members);
    const badge = scoreBadge(score.total);

    /* --- fill result card --- */
    $("result-coop").textContent = data.coopName;
    $("result-summary").textContent =
      T(`${data.state} · ${data.members.toLocaleString("ms-MY")} ahli · AGM ${data.agmDate ? "pada " + data.agmDate : "akan datang"} · Mode: ${data.mode.charAt(0).toUpperCase() + data.mode.slice(1)}`,
      `${data.state} · ${data.members.toLocaleString("ms-MY")} members · AGM ${data.agmDate ? "on " + data.agmDate : "upcoming"} · Format: ${data.mode.charAt(0).toUpperCase() + data.mode.slice(1)}`);

    // Animate score ring
    const ring = $("score-ring");
    const num = $("score-num");
    const C = 2 * Math.PI * 62; // r=62
    ring.style.background = `conic-gradient(var(--c-primary) ${0}deg, var(--c-divider) 0deg)`;
    let cur = 0;
    const step = Math.max(1, Math.round(score.total / 30));
    const timer = setInterval(() => {
      cur = Math.min(score.total, cur + step);
      num.textContent = cur;
      const deg = (cur / 100) * 360;
      ring.style.background = `conic-gradient(var(--c-primary) ${deg}deg, var(--c-divider) ${deg}deg)`;
      if (cur >= score.total) clearInterval(timer);
    }, 24);

    const bl = $("score-label");
    bl.textContent = badge.text;
    bl.className = "badge " + badge.cls;

    // Factor breakdown
    $("factor-list").innerHTML = score.factors.map((f) =>
      `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
          <span>${f.label}</span><span style="font-weight:700;color:var(--c-primary)">${f.points}/${f.max}</span>
        </div>
        <div class="factor-bar"><i style="width:${Math.round((f.points / f.max) * 100)}%"></i></div>
      </div>`).join("");

    // Package cards
    $("pkg-list").innerHTML = AGM_PACKAGES.map((p) => {
      const rec = p.key === pkg.key;
      return `<div class="pkg-card ${rec ? "recommended" : ""}" style="${rec ? "" : "opacity:0.75"}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="font-size:14.5px">${p.name}</strong>
          ${rec ? `<span class="badge gold">${T("Disarankan", "Recommended")}</span>` : ""}
        </div>
        <div class="pkg-price">${RM(p.price)} <small>/ AGM</small></div>
        <div style="font-size:12.5px;color:var(--c-text-2);margin:6px 0 10px">${p.blurb}</div>
        <ul style="font-size:12.5px;color:var(--c-text-2);padding-left:16px;margin:0;line-height:1.9">
          ${p.includes.map((i) => `<li>${i}</li>`).join("")}
        </ul>
      </div>`;
    }).join("");

    // Quote
    $("quote-amount").textContent = RM(pkg.price);
    $("quote-annual").textContent =
      T(`+ Governance OS: ${annual.name} ${RM(annual.monthly)}/bulan (${RM(annual.monthly * 12)}/tahun) — bayaran selepas AGM`,
      `+ Governance OS: ${annual.name} ${RM(annual.monthly)}/mo (${RM(annual.monthly * 12)}/yr) — billed after the AGM`);

    // Reveal result
    $("result-card").classList.remove("result-hidden");
    $("result-card").scrollIntoView({ behavior: "smooth", block: "start" });

    // Store lead (AGMX_COMMERCE → local demo or PocketBase hook)
    let lead;
    try {
      lead = await saveLead({
      coopName: data.coopName, coopReg: data.coopReg, state: data.state,
      members: data.members, agmDate: data.agmDate, mode: data.mode,
      attendance: data.attendance, candidates: data.candidates, motions: data.motions,
      process: data.process, managed: data.managed,
      score: score.total, factors: score.factors,
      pkgKey: pkg.key, pkgName: pkg.name, pkgPrice: pkg.price, quote: pkg.price,
      contactName: data.contactName, contactPhone: data.contactPhone, contactEmail: data.contactEmail,
      });
    } catch (e) {
      showToast(T("Ralat menyimpan lead: ", "Error saving lead: ") + e.message);
      return;
    }

    /* Forward the same lead to Duta Integra's /api/send-email so it lands
       in Brevo + KV alongside website enquiries. Fail-open: a forward error
       never blocks the AGMX flow. */
    try {
      if (API && API.forwardLeadToDutaIntegra) {
        const fwd = await API.forwardLeadToDutaIntegra(lead);
        if (!fwd.ok) {
          showToast(T("Lead disimpan. Pameran Duta Integra ditangguhkan (", "Lead saved. Duta Integra forward postponed (") + (fwd.reason || fwd.error || T("tidak diketahui", "unknown")) + ").");
        }
      }
    } catch (e) {
      /* non-fatal — AGMX lead is already saved locally / in PocketBase */
    }

    $("lead-thanks").textContent =
      T(`Terima kasih, ${data.contactName}. Rujukan anda: ${lead.id} — kami akan hubungi ${data.contactPhone} dalam 24 jam bekerja.`,
      `Thank you, ${data.contactName}. Your reference: ${lead.id} — we will contact ${data.contactPhone} within 24 business hours.`);
    $("lead-summary").innerHTML = [
      [T("Rujukan", "Reference"), lead.id], [T("Koperasi", "Cooperative"), data.coopName], [T("Skor Kerumitan", "Complexity Score"), score.total + "/100"],
      [T("Pakej Disarankan", "Recommended Package"), pkg.name], [T("Anggaran AGM", "AGM Estimate"), RM(pkg.price)], ["PIC", data.contactName],
    ].map(([k, v]) =>
      `<div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:12px;padding:12px">
        <div style="font-size:11px;color:var(--c-text-3);text-transform:uppercase;letter-spacing:0.5px;font-weight:700">${k}</div>
        <div style="font-size:14px;font-weight:700;color:var(--c-text);margin-top:2px">${escapeHtml(v)}</div>
      </div>`).join("");

    /* self-serve path: continue straight to quote → invoice → payment.
       The checkout token makes the link unguessable — in PocketBase mode
       the money-flow hook refuses the lead without it. */
    const cta = document.getElementById("lead-cta");
    if (cta) {
      cta.href = "checkout.html?ref=" + encodeURIComponent(lead.id) +
        (lead.checkoutToken ? "&t=" + encodeURIComponent(lead.checkoutToken) : "");
      cta.classList.remove("result-hidden");
    }

    $("lead-card").classList.remove("result-hidden");
    renderLeadTable();
    showToast(T(`Penilaian disimpan · Rujukan ${lead.id} · Pakej disarankan: ${pkg.name}`, `Assessment saved · Ref ${lead.id} · Recommended: ${pkg.name}`));
  }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    $("assessment-form").addEventListener("submit", evaluate);
    renderBackendChip();
    renderLeadTable();
  });
})();
