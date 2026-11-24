/* ============================================================
   AGMX — Evidence vault screen (Sprint 13)
   ------------------------------------------------------------
   Evidence register: list items, register new evidence, create
   evidence packages (export), record incidents. Every write goes
   through the governance Edge Function; values via textContent.
   ============================================================ */

const I18N = {
    "AGM Evidence": "Bukti AGM",
    "Evidence vault for the current AGM": "Vault bukti bagi AGM semasa",
    "No current AGM": "Tiada AGM semasa",
    "An administrator needs to create the AGM before evidence can be registered.":
      "Pentadbir perlu mencipta AGM sebelum bukti boleh didaftarkan.",
    "Register evidence": "Daftarkan bukti",
    "Category": "Kategori",
    "Filename": "Nama fail",
    "Storage path": "Lokoran simpanan",
    "MIME type": "Jenis MIME",
    "Size (bytes):": "Saiz (bait)",
    "SHA-256": "SHA-256",
    "Save": "Simpan",
    "Evidence": "Bukti",
    "Status": "Status",
    "Size": "Saiz",
    "Hash": "Hash",
    "Registered at": "Didaftarkan pada",
    "Actions": "Tindakan",
    "Export": "Eksport",
    "Verify package": "Verifikasi starter",
    "No evidence yet.": "Belum ada bukti.",
    "No packages yet.": "Belum ada starter bukti.",
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
    "Enter evidence category…": "Masukkan kategori bukti…",
    "Enter filename…": "Masukkan nama fail…",
    "Enter storage path…": "Masukkan lokoran simpanan…",
    "Enter SHA-256 hash…": "Masukkan hash SHA-256…",
    "Record incident": "Rekod insiden",
    "Incident": "Insiden",
    "Occurred at": "Berlaku pada",
    "Actor": "Pemain",
    "Description": "Huraian",
    "Resolution": "Penyelesaian",
    "No incidents yet.": "Belum ada insiden.",
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

  function fmtDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
  }

  function formatNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-MY") : text(value);
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

  function field(labelText, input) {
    const wrap = node("div", "agmx-field");
    const label = node("label", "agmx-field-label", labelText);
    label.htmlFor = input.id;
    append(wrap, [label, input]);
    return wrap;
  }

  function input(id, type, placeholder) {
    const el = node("input", "input");
    el.id = id;
    el.name = id;
    el.type = type;
    if (placeholder) el.placeholder = t(placeholder);
    return el;
  }

  function textarea(id, placeholder) {
    const el = node("textarea", "input");
    el.id = id;
    el.name = id;
    if (placeholder) el.placeholder = t(placeholder);
    el.style.width = "100%";
    el.style.minHeight = "100px";
    return el;
  }

  const PILL_TONES = { ok: " is-ok", warn: " is-warning", bad: " is-danger", muted: " is-muted" };
  function statusPill(value, tone) {
    return node("span", `agmx-status-pill${PILL_TONES[tone] || " is-muted"}`, value);
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
    if (detail && window.console && console.error) console.error("[evidence-ui]", detail);
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

  function currentMember(data) {
    const user = data && data.currentUser;
    const members = Array.isArray(data && data.members) ? data.members : [];
    if (!user || !members.length) return null;
    const email = String(user.email || "").toLowerCase();
    return members.find((member) => String(member.id) === String(user.memberId)
      || String(member.email || "").toLowerCase() === email) || null;
  }

  // ------------------------------------------------------------
  // Register evidence form
  // ------------------------------------------------------------
  function evidenceForm(api, agmId, ctx, rerender) {
    const categoryInput = input("agmx-ev-category", "text", t("Enter evidence category…"));
    const filenameInput = input("agmx-ev-filename", "text", t("Enter filename…"));
    const pathInput = input("agmx-ev-path", "text", t("Enter storage path…"));
    const mimeInput = input("agmx-ev-mime", "text", t("application/octet-stream"));
    mimeInput.value = "application/octet-stream";
    const sizeInput = input("agmx-ev-size", "number", t("Size (bytes)"));
    sizeInput.min = "0";
    const hashInput = input("agmx-ev-hash", "text", t("Enter SHA-256 hash…"));

    const saveBtn = button(t("Save"), "btn btn-primary btn-sm", (e) =>
      runAction(e, ctx, async () => {
        await api.registerEvidence(
          agmId,
          categoryInput.value,
          filenameInput.value,
          pathInput.value,
          mimeInput.value,
          sizeInput.value ? Number(sizeInput.value) : null,
          hashInput.value || null
        );
      }, rerender));

    return card(t("Register evidence"), "", [
      field(t("Category"), categoryInput),
      field(t("Filename"), filenameInput),
      field(t("Storage path"), pathInput),
      field(t("MIME type"), mimeInput),
      field(t("Size (bytes):"), sizeInput),
      field(t("SHA-256"), hashInput),
      node("div", "agmx-gov-controls", [saveBtn]),
    ]);
  }

  // ------------------------------------------------------------
  // Evidence list table
  // ------------------------------------------------------------
  function evidenceTable(evidence, api, agmId, ctx, rerender) {
    const tbody = node("tbody", "");
    evidence.forEach((item) => {
      const tr = node("tr", "");
      append(tr, [
        node("td", "", text(item.category)),
        node("td", "", text(item.filename)),
        node("td", "", formatNumber(item.sizeBytes)),
        node("td", "", text(item.sha256, "—")),
        node("td", "", fmtDateTime(item.created_at || item.registered_at)),
      ]);
      const actions = node("td", "");
      actions.appendChild(button(t("Export"), "btn btn-secondary btn-sm", (ev) =>
        runAction(ev, ctx, () => api.evidencePackage(agmId, "export", item.storagePath, item.sha256 || null), rerender)));
      actions.appendChild(button(t("Verify package"), "btn btn-secondary btn-sm", (ev) =>
        runAction(ev, ctx, () => api.evidencePackage(agmId, "verify", item.storagePath, item.sha256 || null), rerender)));
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    return node("table", "agmx-members-table agmx-report-table", [
      node("thead", "", node("tr", "", [
        node("th", "", t("Category")),
        node("th", "", t("Filename")),
        node("th", "", t("Size")),
        node("th", "", t("Hash")),
        node("th", "", t("Registered at")),
        node("th", "", t("Actions")),
      ])),
      tbody,
    ]);
  }

  // ------------------------------------------------------------
  // Packages list
  // ------------------------------------------------------------
  function packagesTable(packages) {
    const tbody = node("tbody", "");
    packages.forEach((pkg) => {
      const tr = node("tr", "");
      append(tr, [
        node("td", "", text(pkg.action)),
        node("td", "", text(pkg.exportPath)),
        node("td", "", text(pkg.sha256, "—")),
        node("td", "", fmtDateTime(pkg.created_at)),
      ]);
      tbody.appendChild(tr);
    });
    return node("table", "agmx-members-table agmx-report-table", [
      node("thead", "", node("tr", "", [
        node("th", "", t("Action")),
        node("th", "", t("Storage path")),
        node("th", "", t("Hash")),
        node("th", "", t("Created at")),
      ])),
      tbody,
    ]);
  }

  // ------------------------------------------------------------
  // Incident form
  // ------------------------------------------------------------
  function incidentForm(api, agmId, ctx, rerender) {
    const occurredInput = input("agmx-inc-occurred", "datetime-local", t("Occurred at"));
    occurredInput.value = new Date().toISOString().slice(0, 16);
    const actorInput = input("agmx-inc-actor", "text", t("Actor"));
    const descInput = textarea("agmx-inc-desc", t("Description"));
    const refsInput = input("agmx-inc-refs", "text", t("Evidence refs (comma separated)"));
    const resInput = textarea("agmx-inc-res", t("Resolution"));

    const saveBtn = button(t("Save"), "btn btn-primary btn-sm", (e) =>
      runAction(e, ctx, async () => {
        const refs = refsInput.value.split(",").map(s => s.trim()).filter(Boolean);
        await api.recordIncident(
          agmId,
          occurredInput.value,
          actorInput.value,
          descInput.value,
          refs,
          resInput.value || null
        );
      }, rerender));

    return card(t("Record incident"), "", [
      field(t("Occurred at"), occurredInput),
      field(t("Actor"), actorInput),
      field(t("Description"), descInput),
      field(t("Evidence refs (comma separated)"), refsInput),
      field(t("Resolution"), resInput),
      node("div", "agmx-gov-controls", [saveBtn]),
    ]);
  }

  // ------------------------------------------------------------
  // Entry point
  // ------------------------------------------------------------
  async function renderEvidence(container, ctx) {
    const api = ctx.api;
    const data = ctx.data || {};
    const agm = data.agm || {};
    const isAdmin = !!ctx.isAdmin;

    if (!agm.id) {
      container.replaceChildren(heading("AGM Evidence",
        t("An administrator needs to create the AGM before evidence can be registered."), ctx));
      return;
    }

    loading(container);

    let evidence = [];
    let packages = [];
    let incidents = [];
    let loadError = null;
    try {
      const [eRes, pRes, iRes] = await Promise.all([
        api.evidence().catch(() => ({})),
        api.evidencePackages().catch(() => ({})),
        api.incidents().catch(() => ({})),
      ]);
      evidence = Array.isArray(eRes) ? eRes : (eRes && Array.isArray(eRes.evidence) ? eRes.evidence : []);
      packages = Array.isArray(pRes) ? pRes : (pRes && Array.isArray(pRes.packages) ? pRes.packages : []);
      incidents = Array.isArray(iRes) ? iRes : (iRes && Array.isArray(iRes.incidents) ? iRes.incidents : []);
    } catch (error) {
      loadError = error;
    }

    container.replaceChildren();
    container.appendChild(heading("AGM Evidence", t("Evidence vault for the current AGM"), ctx));

    if (loadError) {
      container.appendChild(card("Could not load", "", readFailure(loadError, () => renderEvidence(container, ctx))));
      return;
    }

    // Register form (operator only)
    if (isAdmin) {
      container.appendChild(evidenceForm(api, agm.id, ctx, () => renderEvidence(container, ctx)));
    }

    // Evidence list
    container.appendChild(card(t("Evidence"), "", [
      evidence.length ? evidenceTable(evidence, api, agm.id, ctx, () => renderEvidence(container, ctx))
        : node("p", "agmx-empty", t("No evidence yet.")),
    ]));

    // Packages
    container.appendChild(card(t("Evidence packages"), "", [
      packages.length ? packagesTable(packages) : node("p", "agmx-empty", t("No packages yet.")),
    ]));

    // Incidents (operator only)
    if (isAdmin) {
      container.appendChild(card(t("Incidents"), "", [
        incidentForm(api, agm.id, ctx, () => renderEvidence(container, ctx)),
        incidents.length ? (
          (() => {
            const tbody = node("tbody", "");
            incidents.forEach((inc) => {
              const tr = node("tr", "");
              append(tr, [
                node("td", "", fmtDateTime(inc.occurred_at)),
                node("td", "", text(inc.actor)),
                node("td", "", text(inc.description)),
                node("td", "", text(inc.resolution, "—")),
              ]);
              tbody.appendChild(tr);
            });
            return node("table", "agmx-members-table agmx-report-table", [
              node("thead", "", node("tr", "", [
                node("th", "", t("Occurred at")),
                node("th", "", t("Actor")),
                node("th", "", t("Description")),
                node("th", "", t("Resolution")),
              ])),
              tbody,
            ]);
          })()
        ) : node("p", "agmx-empty", t("No incidents yet.")),
    ]));
  }
  }

  window.AGMX_EVIDENCE = {
    routes: ["evidence"],
    renderEvidence,
  };
