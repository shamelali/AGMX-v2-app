/* ============================================================
   AGMX — Member registration & presence (Sprint 7)
   ------------------------------------------------------------
   RSVP and check-in for the current AGM. Every write goes through
   the governance Edge Function; the view renders what it returns
   and never invents registrations or attendance.
   Values are always inserted via textContent — no HTML strings.
   ============================================================ */

(function (window, document) {
  "use strict";

  const I18N = {
    "Member Registration": "Daftaran Ahli",
    "RSVP and check-in for the current AGM": "RSVP dan daftar kehadiran untuk AGM semasa",
    "Current AGM": "AGM Semasa",
    "Status": "Status",
    "Present": "Hadir",
    "Registered": "Daftar",
    "No current AGM": "Tiada AGM semasa",
    "An administrator needs to create the AGM before members can register.":
      "Pentadbir perlu mencipta AGM sebelum ahli boleh mendaftar.",
    "My RSVP": "RSVP saya",
    "Member": "Ahli",
    "RSVP status": "Status RSVP",
    "RSVP": "RSVP",
    "Attending": "Hadir",
    "Apology": "Maaf",
    "Not attending": "Tidak hadir",
    "Channel": "Saluran",
    "Portal": "Portal",
    "Physical": "Fizikal",
    "Online": "Dalam talian",
    "Hybrid": "Hibrid",
    "Save RSVP": "Simpan RSVP",
    "Check me in": "Daftarkan kehadiran saya",
    "Checked in": "Didaftar hadir",
    "Check in a member": "Daftarkan kehadiran ahli",
    "Member ID": "ID ahli",
    "Method": "Kaedah",
    "Portal check-in": "Semak masuk portal",
    "Kiosk check-in": "Semak masuk kerusi",
    "Check in": "Daftar kehadiran",
    "Registrations": "Pendaftaran",
    "No registrations yet.": "Belum ada pendaftaran.",
    "Registered at": "Didaftar pada",
    "You are not on the member roster for this organization.":
      "Anda tidak ada dalam senarai ahli organisasi ini.",
    "Registration is unavailable on demo data — sign in to a live organization to RSVP.":
      "Pendaftaran tidak tersedia pada data demo — log masuk ke organisasi sebenar untuk RSVP.",
    "Could not load": "Gagal memuatkan",
    "This section could not be read. It is not empty — the server did not answer.":
      "Bahagian ini tidak dapat dibaca. Ia bukan kosong — pelayan tidak menjawab.",
    "Technical detail": "Butiran teknikal",
    "Retry": "Cuba semula",
    "Could not save. The server response is in the browser console.":
      "Tidak dapat disimpan. Respons pelayan ada dalam konsol pelayar.",
    "Running…": "Sedang berjalan…",
    "Recorded, but the view could not be refreshed. Reload before acting again.":
      "Telah direkodkan, tetapi paparan tidak dapat dimuatkan. Muat semula sebelum bertindak lagi.",
    "Live Supabase data": "Data Supabase langsung",
    "Demo data · simulated": "Data demo · simulasi",
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

  function select(id, options) {
    const el = node("select", "input select");
    el.id = id;
    el.name = id;
    options.forEach((option) => {
      const o = document.createElement("option");
      o.value = option.value;
      o.textContent = t(option.label);
      el.appendChild(o);
    });
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

  function table(headers, rows) {
    const wrap = node("div", "agmx-table-wrap");
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
    wrap.appendChild(el);
    return wrap;
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
    if (detail && window.console && console.error) console.error("[registration-ui]", detail);
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

  function statusFailure(status, error) {
    logDetail(error);
    status.textContent = t("Could not save. The server response is in the browser console.");
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

  async function renderRegistration(container, ctx) {
    const api = ctx.api;
    const data = ctx.data || {};
    const agm = data.agm || {};
    const members = Array.isArray(data.members) ? data.members : [];
    const user = data.currentUser || {};
    const me = currentMember(data);

    if (!agm.id) {
      container.replaceChildren(heading("Member Registration",
        t("An administrator needs to create the AGM before members can register."), ctx));
      return;
    }

    loading(container);

    let registrations = [];
    let registrationsError = null;
    try {
      const payload = await api.registrations(agm.id);
      registrations = Array.isArray(payload) ? payload
        : (payload && Array.isArray(payload.registrations) ? payload.registrations : []);
    } catch (error) {
      registrationsError = error;
    }

    container.replaceChildren();
    container.appendChild(heading("Member Registration", "RSVP and check-in for the current AGM", ctx));

    const myReg = me && registrations.find((r) => String(r.memberId || r.member_id) === String(me.id));

    const statusCard = card("Current AGM", "", [
      node("dl", "agmx-detail-list", [
        detailRow("Meeting", text(agm.title, "No current AGM")),
        detailRow("Status", statusPill(enumLabel(agm.status || "planned"), agm.status === "live" ? "ok" : "muted")),
        detailRow("Present", `${text(agm.quorumPresent)} / ${text(agm.quorumRequired)}`),
        detailRow("Registered", formatNumber(registrations.length)),
      ]),
    ]);
    container.appendChild(statusCard);

    if (!me) {
      container.appendChild(card(t("My RSVP"), t("You are not on the member roster for this organization."), []));
      if (registrationsError) {
        container.appendChild(card("Could not load", "", readFailure(registrationsError, () => renderRegistration(container, ctx))));
      } else {
        container.appendChild(card("Registrations", t("No registrations yet."), []));
      }
      return;
    }

    // ---- My RSVP ----
    const statusSelect = select("agmx-reg-status", [
      { value: "rsvp", label: "RSVP" },
      { value: "attending", label: "Attending" },
      { value: "apology", label: "Apology" },
      { value: "not_attending", label: "Not attending" },
    ]);
    if (myReg) statusSelect.value = myReg.status || "rsvp";
    const channelSelect = select("agmx-reg-channel", [
      { value: "portal", label: "Portal" },
      { value: "physical", label: "Physical" },
      { value: "online", label: "Online" },
      { value: "hybrid", label: "Hybrid" },
    ]);
    if (myReg) channelSelect.value = myReg.channel || "portal";

    const rsvpStatus = node("p", "agmx-reg-status");
    const saveBtn = button("Save RSVP", "btn btn-primary btn-sm", async (e) => {
      await runAction(e, ctx, async () => {
        await api.register(agm.id, me.id, statusSelect.value, channelSelect.value);
      }, () => renderRegistration(container, ctx));
    });

    const rsvpCard = card("My RSVP", "", [
      node("dl", "agmx-detail-list", [
        detailRow("Member", text(me.name, "Unnamed member")),
        detailRow("RSVP status", myReg ? enumLabel(myReg.status) : "—"),
        detailRow("Channel", myReg ? enumLabel(myReg.channel) : "—"),
        detailRow("Registered at", myReg ? fmtDateTime(myReg.createdAt || myReg.registeredAt) : "—"),
      ]),
      node("div", "agmx-gov-controls", [
        field("RSVP status", statusSelect),
        field("Channel", channelSelect),
        saveBtn,
        rsvpStatus,
      ]),
    ]);
    container.appendChild(rsvpCard);

    // ---- Check in ----
    const checkInControls = node("div", "agmx-gov-controls");
    const checkInBtn = button("Check me in", "btn btn-secondary btn-sm", async (e) => {
      await runAction(e, ctx, async () => {
        await api.presence(agm.id, me.id, "portal", "physical");
      }, () => renderRegistration(container, ctx));
    });
    append(checkInControls, [checkInBtn]);

    if (ctx.isAdmin) {
      const memberInput = input("agmx-checkin-member", "text", "Member ID");
      const methodSelect = select("agmx-checkin-method", [
        { value: "portal", label: "Portal check-in" },
        { value: "kiosk", label: "Kiosk check-in" },
      ]);
      const channelSelect2 = select("agmx-checkin-channel", [
        { value: "physical", label: "Physical" },
        { value: "online", label: "Online" },
        { value: "hybrid", label: "Hybrid" },
      ]);
      const checkInMemberBtn = button("Check in", "btn btn-secondary btn-sm", async (e) => {
        await runAction(e, ctx, async () => {
          await api.presence(agm.id, memberInput.value, methodSelect.value, channelSelect2.value);
        }, () => renderRegistration(container, ctx));
      });
      append(checkInControls, [
        field("Member ID", memberInput),
        field("Method", methodSelect),
        field("Channel", channelSelect2),
        checkInMemberBtn,
      ]);
    }

    container.appendChild(card("Check in", "", checkInControls));

    // ---- Registrations table ----
    const tableCard = card("Registrations", registrations.length ? "" : "No registrations yet.", [
      registrations.length
        ? table(
          ["Member", "RSVP status", "Channel", "Registered at"],
          registrations.map((r) => [
            text(r.memberName || r.name),
            enumLabel(r.status),
            enumLabel(r.channel),
            fmtDateTime(r.createdAt || r.registeredAt),
          ])
        )
        : node("p", "agmx-empty", t("No registrations yet.")),
    ]);
    container.appendChild(tableCard);

    if (registrationsError) {
      container.appendChild(card("Could not load", "", readFailure(registrationsError, () => renderRegistration(container, ctx))));
    }
  }

  window.AGMX_REGISTRATION = {
    routes: ["registration"],
    renderRegistration,
  };
})(window, document);
