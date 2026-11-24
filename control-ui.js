/* ============================================================
   AGMX — Control / Mission Control (Sprint 10)
   ------------------------------------------------------------
   Organizer dashboard for the current AGM: status & stage,
   quorum, system health, compliance findings, incidents,
   communications log, and admin stage controls. Every write
   goes through the governance Edge Function; values are always
   inserted via textContent.
   ============================================================ */

(function (window, document) {
  "use strict";

  const I18N = {
    "AGM Control": "Kawalan AGM",
    "Mission control for the current AGM": "Kawalan misyen bagi AGM semasa",
    "No current AGM": "Tiada AGM semasa",
    "An administrator needs to create the AGM before control is available.":
      "Pentadbir perlu mencipta AGM sebelum kawalan boleh digunakan.",
    "AGM status": "Status AGM",
    "Stage": "Tahap",
    "Quorum": "Kuorum",
    "Members": "Ahli",
    "Present": "Hadir",
    "System health": "Kesihatan sistem",
    "Compliance": "Patuhan",
    "Findings": "Dapatan",
    "Incidents": "Insiden",
    "Communications": "Komunikasi",
    "Admin controls": "Kawalan pentadbir",
    "Start AGM": "Mula AGM",
    "Close AGM": "Tutup AGM",
    "Advance stage": "Kemudi tahap",
    "Run compliance": "Jalankan patuhan",
    "Running…": "Sedang berjalan…",
    "Could not load": "Gagal memuatkan",
    "This section could not be read. It is not empty — the server did not answer.":
      "Bahagian ini tidak dapat dibaca. Ia bukan kosong — pelayan tidak menjawab.",
    "Technical detail": "Butiran teknikal",
    "Retry": "Cuba semula",
    "Could not complete this action. The server response is in the browser console.":
      "Tidak dapat menyelesaikan tindakan ini. Respons pelayan ada dalam konsol pelayar.",
    "Recorded, but the view could not be refreshed. Reload before acting again.":
      "Telah direkodkan, tetapi paparan tidak dapat dimuatkan. Muat semula sebelum bertindak lagi.",
    "Live Supabase data": "Data Supabase langsung",
    "Demo data · simulated": "Data demo · simulasi",
    "None": "Tiada",
    "OK": "Baik",
    "Degraded": "Terdegradasi",
    "Down": "Runtuh",
    "Severity": "Keparahan",
    "High": "Tinggi",
    "Medium": "Sederhana",
    "Low": "Rendah",
    "Critical": "Kritis",
    "No incidents recorded.": "Tiada insiden direkodkan.",
    "No communications yet.": "Belum ada komunikasi.",
    "No compliance findings.": "Tiada dapatan patuhan.",
    "Created at": "Dicipta pada",
    "Actor": "Pelaku",
    "Description": "Deskripsi",
    "Resolution": "Resolusi",
    "Sent at": "Dihantar pada",
    "Recipient": "Penerima",
    "Channel": "Saluran",
  };

  const lang = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (q === "en") return "en";
      if (q === "ms") return "ms";
      return window.localStorage.getItem("agmx-lang") === "en" ? "en" : "ms";
    } catch (_) { return "ms"; }
  })();

  function t(value) {
    if (lang !== "ms") return String(value);
    return I18N[value] || String(value);
  }

  function enumLabel(value) {
    if (value === undefined || value === null || value === "") return "—";
    return t(String(value)).toUpperCase();
  }

  function text(value, fallback) {
    return value === undefined || value === null || value === "" ? (fallback || "—") : String(value);
  }

  function formatNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-MY") : text(value);
  }

  function fmtDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (Array.isArray(value)) {
      value.forEach((child) => { if (child) element.appendChild(child); });
    } else if (value && typeof value.nodeType === "number") {
      element.appendChild(value);
    } else if (value !== undefined && value !== null) {
      element.textContent = t(String(value));
    }
    return element;
  }

  function append(parent, children) {
    children.forEach((child) => { if (child) parent.appendChild(child); });
    return parent;
  }

  function card(title, subtitle, children) {
    const heading = node("div", "agmx-card-heading");
    const copy = node("div", "");
    append(copy, [node("h2", "", title), subtitle ? node("p", "", subtitle) : null]);
    heading.appendChild(copy);
    return append(node("section", "agmx-card"), [heading].concat(children));
  }

  function button(label, className, onClick) {
    const el = node("button", className || "btn btn-secondary btn-sm", label);
    el.type = "button";
    el.addEventListener("click", onClick);
    return el;
  }

  function detailRow(label, value) {
    const row = node("div", "agmx-detail-row");
    append(row, [node("dt", "", label), node("dd", "", text(value))]);
    return row;
  }

  function heading(title, subtitle, ctx) {
    const el = node("div", "agmx-page-heading");
    const copy = node("div", "");
    append(copy, [node("h1", "", title), node("p", "", subtitle)]);
    el.append(node("div", "", copy), sourceBadge(ctx.source));
    return el;
  }

  function sourceBadge(source) {
    const badge = node("span", `agmx-source-badge${source === "demo" ? " is-demo" : ""}`);
    badge.textContent = t(source === "demo" ? "Demo data · simulated" : "Live Supabase data");
    return badge;
  }

  function notice(container, message, tone) {
    const el = node("div", `agmx-gov-notice${tone === "error" ? " is-error" : ""}`, message);
    el.setAttribute("role", tone === "error" ? "alert" : "status");
    container.prepend(el);
    return el;
  }

  function loading(container) {
    container.replaceChildren(node("div", "agmx-gov-loading", t("Loading…")));
  }

  function logDetail(error) {
    const detail = error && error.message ? String(error.message) : String(error || "");
    if (detail && window.console && console.error) console.error("[control-ui]", detail);
    return detail;
  }

  function readFailure(error, retry) {
    const detail = logDetail(error);
    const alert = node("div", "agmx-gov-notice is-error",
      t("This section could not be read. It is not empty — the server did not answer."));
    alert.setAttribute("role", "alert");
    const blocks = [alert];
    if (detail) {
      const disclosure = node("details", "");
      disclosure.appendChild(node("summary", "", t("Technical detail")));
      const pre = node("pre", "agmx-gov-error-detail");
      pre.textContent = detail;
      disclosure.appendChild(pre);
      blocks.push(disclosure);
    }
    if (retry) {
      blocks.push(node("div", "agmx-gov-controls", [button(t("Retry"), "btn btn-secondary btn-sm", retry)]));
    }
    return blocks;
  }

  async function runAction(event, ctx, work, rerender) {
    const buttonEl = event.currentTarget;
    const original = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = t("Running…");
    try {
      await work();
    } catch (error) {
      logDetail(error);
      notice(buttonEl.closest(".agmx-card") || buttonEl.parentElement,
        t("Could not complete this action. The server response is in the browser console."), "error");
      buttonEl.disabled = false;
      buttonEl.textContent = original;
      return false;
    }
    buttonEl.textContent = original;
    if (rerender) {
      try {
        await rerender();
      } catch (error) {
        logDetail(error);
        notice(buttonEl.closest(".agmx-card") || buttonEl.parentElement,
          t("Recorded, but the view could not be refreshed. Reload before acting again."), "error");
      }
    }
    return true;
  }

  function severityPill(severity) {
    const s = String(severity || "").toLowerCase();
    let tone = "muted";
    let label = t("None");
    if (s === "critical") { tone = "bad"; label = t("Critical"); }
    else if (s === "high") { tone = "warn"; label = t("High"); }
    else if (s === "medium") { tone = "warn"; label = t("Medium"); }
    else if (s === "low") { tone = "ok"; label = t("Low"); }
    return statusPill(label, tone);
  }

  const PILL_TONES = { ok: " is-ok", warn: " is-warning", bad: " is-danger", muted: " is-muted" };
  function statusPill(value, tone) {
    return node("span", `agmx-status-pill${PILL_TONES[tone] || " is-muted"}`, value);
  }

  function healthPill(status) {
    const s = String(status || "").toLowerCase();
    let tone = "muted";
    let label = t("OK");
    if (s === "degraded" || s === "warning") { tone = "warn"; label = t("Degraded"); }
    else if (s === "down" || s === "critical" || s === "error") { tone = "bad"; label = t("Down"); }
    return statusPill(label, tone);
  }

  function statRow(label, value) {
    return node("tr", "", [
      node("td", "", label),
      node("td", "", text(value)),
    ]);
  }

  function simpleTable(headers, rows) {
    const el = node("table", "agmx-members-table agmx-report-table");
    el.appendChild(node("caption", "sr-only", headers.join(", ")));
    const head = node("thead", "");
    const headRow = node("tr", "");
    headers.forEach((h) => headRow.appendChild(node("th", "", h)));
    head.appendChild(headRow);
    const body = node("tbody", "");
    rows.forEach((cells) => {
      const tr = node("tr", "");
      cells.forEach((cell) => {
        const td = node("td", "");
        if (cell && cell.nodeType === 1) td.appendChild(cell);
        else if (cell !== undefined && cell !== null) td.textContent = String(cell);
        else td.textContent = "—";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    append(el, [head, body]);
    return el;
  }

  // ------------------------------------------------------------
  // Widgets
  // ------------------------------------------------------------
  function statusWidget(agm, isAdmin, api, rerender) {
    const controls = [];
    if (isAdmin) {
      const st = String(agm.status || "planned");
      if (st === "planned" || st === "configured") {
        controls.push(button(t("Start AGM"), "btn btn-primary btn-sm", (e) =>
          runAction(e, { ...ctxBound, api }, () => api.startAgm(agm.id), rerender)));
      }
      if (st === "live") {
        controls.push(button(t("Close AGM"), "btn btn-secondary btn-sm", (e) =>
          runAction(e, { ...ctxBound, api }, () => api.closeAgm(agm.id), rerender)));
        controls.push(button(t("Run compliance"), "btn btn-secondary btn-sm", (e) =>
          runAction(e, { ...ctxBound, api }, () => api.runCompliance(agm.id), rerender)));
      }
      controls.push(button(t("Advance stage"), "btn btn-secondary btn-sm", (e) => {
        const to = window.prompt(t("Advance stage"), "live");
        if (to) {
          runAction(e, { ...ctxBound, api }, () => api.advanceStage(agm.id, to), rerender);
        }
      }));
    }

    const present = Number(agm.quorumPresent || 0);
    const required = Number(agm.quorumRequired || 0);
    const pct = required > 0 ? Math.round((present / required) * 100) : 0;

    return card(t("AGM status"), "", [
      node("dl", "agmx-detail-list", [
        detailRow(t("Meeting"), text(agm.title)),
        detailRow(t("Status"), statusPill(enumLabel(agm.status),
          agm.status === "live" ? "ok" : agm.status === "closed" ? "muted" : "muted")),
        detailRow(t("Stage"), enumLabel(agm.stage || agm.status)),
        detailRow(t("Quorum"), `${present} / ${required} (${pct} %)`),
      ]),
      controls.length ? node("div", "agmx-gov-controls", controls)
        : node("p", "agmx-empty", t("None")),
    ]);
  }

  function healthWidget(health) {
    const checks = Array.isArray(health && health.checks) ? health.checks : [];
    const overall = health && health.overall ? health.overall : "ok";
    const rows = checks.map((c) => node("tr", "", [
      node("td", "", text(c.name || c.check || c.service)),
      node("td", "", healthPill(c.status || c.ok !== false ? "ok" : "down")),
      node("td", "", text(c.latency_ms !== undefined ? c.latency_ms + " ms" : c.latency)),
    ]));
    return card(t("System health"), "", [
      node("dl", "agmx-detail-list", [
        detailRow(t("Overall"), healthPill(overall)),
      ]),
      checks.length ? simpleTable([t("Check"), t("Status"), t("Latency")], rows)
        : node("p", "agmx-empty", t("None")),
    ]);
  }

  function complianceWidget(findings, isAdmin, api, agmId, rerender) {
    const items = Array.isArray(findings) ? findings : [];
    const rows = items.map((f) => {
      const rule = f && f.check && f.check.rule ? f.check.rule : {};
      return node("tr", "", [
        node("td", "", text(rule.name || f.check_name || f.title)),
        node("td", "", severityPill(f.severity || f.severity_level)),
        node("td", "", text(f.status || f.result)),
        node("td", "", fmtDateTime(f.created_at || f.checked_at)),
      ]);
    });
    const extra = isAdmin ? [
      button(t("Run compliance"), "btn btn-primary btn-sm", (e) =>
        runAction(e, { ...ctxBound, api }, () => api.runCompliance(agmId), rerender)),
    ] : [];
    return card(t("Compliance"), t("Findings"), [
      node("div", "agmx-gov-controls", extra),
      items.length ? simpleTable([t("Rule"), t("Severity"), t("Status"), t("Created at")], rows)
        : node("p", "agmx-empty", t("No compliance findings.")),
    ]);
  }

  function incidentsWidget(incidents) {
    const items = Array.isArray(incidents) ? incidents : [];
    const rows = items.map((inc) => node("tr", "", [
      node("td", "", text(inc.actor || inc.created_by || inc.member_name)),
      node("td", "", text(inc.description)),
      node("td", "", fmtDateTime(inc.occurred_at || inc.created_at)),
      node("td", "", text(inc.resolution || "—")),
    ]));
    return card(t("Incidents"), "", [
      items.length ? simpleTable([t("Actor"), t("Description"), t("Created at"), t("Resolution")], rows)
        : node("p", "agmx-empty", t("No incidents recorded.")),
    ]);
  }

  function communicationsWidget(comms) {
    const items = Array.isArray(comms) ? comms : [];
    const rows = items.map((c) => node("tr", "", [
      node("td", "", text(c.recipient || c.member_name || c.to)),
      node("td", "", text(c.channel)),
      node("td", "", fmtDateTime(c.sent_at || c.created_at)),
    ]));
    return card(t("Communications"), "", [
      items.length ? simpleTable([t("Recipient"), t("Channel"), t("Sent at")], rows)
        : node("p", "agmx-empty", t("No communications yet.")),
    ]);
  }

  let ctxBound = null;

  async function renderControl(container, ctx) {
    const api = ctx.api;
    const data = ctx.data || {};
    const agm = data.agm || {};
    const isAdmin = !!ctx.isAdmin;

    ctxBound = ctx;

    if (!agm.id) {
      container.replaceChildren(heading("AGM Control",
        t("An administrator needs to create the AGM before control is available."), ctx));
      return;
    }

    loading(container);

    let agmData = agm;
    let health = null;
    let compliance = [];
    let incidents = [];
    let communications = [];
    let loadError = null;

    try {
      const cur = await api.current();
      if (cur && cur.agm) agmData = cur.agm;
      else if (cur && cur.id) agmData = cur;
    } catch (_) { /* keep existing agm data */ }

    try {
      const h = await api.systemHealth(agm.id);
      health = h && h.health ? h.health : (h && h.ok !== undefined ? h : null);
    } catch (_) { health = null; }

    try {
      const c = await api.compliance(agm.id);
      compliance = Array.isArray(c) ? c : (c && Array.isArray(c.findings) ? c.findings : []);
    } catch (_) { compliance = []; }

    try {
      const inc = await api.incidents();
      incidents = Array.isArray(inc) ? inc : (inc && Array.isArray(inc.incidents) ? inc.incidents : []);
    } catch (_) { incidents = []; }

    try {
      const cm = await api.communicationLog();
      communications = Array.isArray(cm) ? cm : (cm && Array.isArray(cm.communications) ? cm.communications : []);
    } catch (_) { communications = []; }

    container.replaceChildren();
    container.appendChild(heading("AGM Control", t("Mission control for the current AGM"), ctx));

    if (loadError) {
      container.appendChild(card("Could not load", "", readFailure(loadError, () => renderControl(container, ctx))));
      return;
    }

    container.appendChild(statusWidget(agmData, isAdmin, api, () => renderControl(container, ctx)));
    container.appendChild(healthWidget(health));
    container.appendChild(complianceWidget(compliance, isAdmin, api, agm.id, () => renderControl(container, ctx)));
    container.appendChild(incidentsWidget(incidents));
    container.appendChild(communicationsWidget(communications));
  }

  window.AGMX_CONTROL = {
    routes: ["control"],
    renderControl,
  };
})(window, document);
