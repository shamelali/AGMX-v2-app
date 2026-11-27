/* ============================================================
   AGMX — Minutes screen (Sprint 12)
   ------------------------------------------------------------
   AGM minutes lifecycle: create, edit, submit review, verify,
   approve, lock. Every write goes through the governance Edge
   Function; values are always inserted via textContent.
   ============================================================ */

(function (window, document) {
  "use strict";

  const I18N = {
    "AGM Minutes": "Minit AGM",
    "Minutes for the current AGM": "Minit bagi AGM semasa",
    "No current AGM": "Tiada AGM semasa",
    "An administrator needs to create the AGM before minutes can be written.":
      "Pentadbir perlu mencipta AGM sebelum minit boleh ditulis.",
    "Create minutes": "Cipta minit",
    "Title": "Tajuk",
    "Content": "Kandungan",
    "Save": "Simpan",
    "Minutes": "Minit",
    "Status": "Status",
    "Draft": "Rancangan",
    "Review": "Ulasan",
    "Verified": "Diverifikasi",
    "Approved": "Lulus",
    "Locked": "Dikunci",
    "Created at": "Dicipta pada",
    "Actions": "Tindakan",
    "Edit": "Sunting",
    "Submit for review": "Hantar untuk ulasan",
    "Verify": "Verifikasi",
    "Approve": "Luluskan",
    "Lock": "Kunci",
    "No minutes yet.": "Belum ada minit.",
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
    "Enter minutes content…": "Masukkan kandungan minit…",
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
    el.style.minHeight = "120px";
    return el;
  }

  const PILL_TONES = { ok: " is-ok", warn: " is-warning", bad: " is-danger", muted: " is-muted" };
  function statusPill(value, tone) {
    return node("span", `agmx-status-pill${PILL_TONES[tone] || " is-muted"}`, value);
  }

  function pillTone(status) {
    if (status === "draft") return "muted";
    if (status === "review") return "warn";
    if (status === "verified" || status === "approved") return "ok";
    if (status === "locked") return "bad";
    return "muted";
  }

  function detailRow(label, value) {
    const row = node("div", "agmx-detail-row");
    append(row, [node("dt", "", label), node("dd", "", value)]);
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
    if (detail && window.console && console.error) console.error("[minutes-ui]", detail);
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
  // Create / edit form
  // ------------------------------------------------------------
  function minutesForm(api, agmId, minute, ctx, rerender) {
    const titleInput = input("agmx-minutes-title", "text", t("Title"));
    const contentText = textarea("agmx-minutes-content", t("Enter minutes content…"));
    if (minute) {
      titleInput.value = minute.title || "";
      contentText.value = minute.content || "";
    }

    const saveBtn = button(t("Save"), "btn btn-primary btn-sm", (e) =>
      runAction(e, ctx, async () => {
        if (minute) {
          await api.editMinutes(minute.id, contentText.value);
        } else {
          await api.createMinutes(agmId, titleInput.value, contentText.value);
        }
      }, rerender));

    return card(minute ? t("Edit minutes") : t("Create minutes"), "", [
      field(t("Title"), titleInput),
      field(t("Content"), contentText),
      node("div", "agmx-gov-controls", [saveBtn]),
    ]);
  }

  // ------------------------------------------------------------
  // Minute row with status + workflow actions
  // ------------------------------------------------------------
  function minuteCard(minute, agmId, api, isAdmin, ctx, rerender) {
    const isOperator = isAdmin;
    const status = minute.status || "draft";
    const children = [
      node("dl", "agmx-detail-list", [
        detailRow(t("Status"), statusPill(enumLabel(status), pillTone(status))),
        detailRow(t("Created at"), fmtDateTime(minute.created_at)),
      ]),
    ];

    const actions = node("div", "agmx-gov-controls");

    // Content preview (collapsible)
    if (minute.content) {
      const preview = node("details", "");
      preview.appendChild(node("summary", "", t("Content")));
      const pre = node("pre", "agmx-minutes-preview");
      pre.textContent = minute.content;
      preview.appendChild(pre);
      children.push(preview);
    }

    if (isOperator) {
      if (status === "draft") {
        actions.appendChild(button(t("Edit"), "btn btn-secondary btn-sm", (e) => {
          // Inline replace this card with the edit form
          const form = minutesForm(api, agmId, minute, ctx, rerender);
          minuteCardElement.replaceWith(form);
        }));
        actions.appendChild(button(t("Submit for review"), "btn btn-primary btn-sm", (e) =>
          runAction(e, ctx, () => api.submitReviewMinutes(minute.id), rerender)));
      } else if (status === "review") {
        actions.appendChild(button(t("Verify"), "btn btn-primary btn-sm", (e) =>
          runAction(e, ctx, () => api.verifyMinutes(minute.id), rerender)));
      } else if (status === "verified") {
        actions.appendChild(button(t("Approve"), "btn btn-primary btn-sm", (e) =>
          runAction(e, ctx, () => api.approveMinutes(minute.id), rerender)));
      } else if (status === "approved") {
        actions.appendChild(button(t("Lock"), "btn btn-secondary btn-sm", (e) =>
          runAction(e, ctx, () => api.lockMinutes(minute.id), rerender)));
      }
    }

    if (actions.children.length) children.push(actions);
    else children.push(node("p", "agmx-empty", t("No further actions.")));

    const minuteCardElement = card(minute.title || t("Untitled minutes"), "", children);
    return minuteCardElement;
  }

  // ------------------------------------------------------------
  // Entry point
  // ------------------------------------------------------------
  async function renderMinutes(container, ctx) {
    const api = ctx.api;
    const data = ctx.data || {};
    const agm = data.agm || {};
    const isAdmin = !!ctx.isAdmin;

    if (!agm.id) {
      container.replaceChildren(heading("AGM Minutes",
        t("An administrator needs to create the AGM before minutes can be written."), ctx));
      return;
    }

    loading(container);

    let minutes = [];
    let loadError = null;
    try {
      const payload = await api.minutes(agm.id);
      minutes = Array.isArray(payload) ? payload
        : (payload && Array.isArray(payload.minutes) ? payload.minutes : []);
    } catch (error) {
      loadError = error;
    }

    container.replaceChildren();
    container.appendChild(heading("AGM Minutes", t("Minutes for the current AGM"), ctx));

    if (loadError) {
      container.appendChild(card("Could not load", "", readFailure(loadError, () => renderMinutes(container, ctx))));
      return;
    }

    // Create form (operator only)
    if (isAdmin) {
      container.appendChild(minutesForm(api, agm.id, null, ctx, () => renderMinutes(container, ctx)));
    }

    // Minutes list
    if (minutes.length === 0) {
      container.appendChild(card(t("No minutes yet."), "", []));
      return;
    }

    minutes.forEach((minute) => {
      container.appendChild(minuteCard(minute, agm.id, api, isAdmin, ctx, () => renderMinutes(container, ctx)));
    });
  }

  window.AGMX_MINUTES = {
    routes: ["minutes"],
    renderMinutes,
  };
})(window, document);
