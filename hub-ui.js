/* ============================================================
   AGMX — Hub participant workspace (Sprint 9)
   ------------------------------------------------------------
   Central live-AGM workspace for members: speaker queue and
   questions. Every write goes through the governance Edge
   Function; values are always inserted via textContent.
   ============================================================ */

(function (window, document) {
  "use strict";

  const I18N = {
    "AGM Hub": "Pusat AGM",
    "Participant workspace for the current AGM": "Ruang kerja peserta bagi AGM semasa",
    "No current AGM": "Tiada AGM semasa",
    "An administrator needs to create the AGM before the hub is available.":
      "Pentadbir perlu mencipta AGM sebelum pusat boleh digunakan.",
    "Speaker queue": "Antara pembicara",
    "Join queue": "Sertai antara",
    "Leave queue": "Keluar antara",
    "Your position": "Posisi anda",
    "Not in queue": "Tidak dalam antara",
    "Questions": "Soalan",
    "Ask a question": "Tanya soalan",
    "Question": "Soalan",
    "Asked by": "Ditanya oleh",
    "Asked at": "Ditanya pada",
    "Answer": "Jawapan",
    "Answered": "Diberi jawapan",
    "Dismiss": "Buang",
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
    "No speakers in queue.": "Tiada pembicara dalam antara.",
    "No questions yet.": "Belum ada soalan.",
    "Your question": "Soalan anda",
    "Type your question…": "Ketik soalan anda…",
    "Submit": "Hantar",
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
    if (detail && window.console && console.error) console.error("[hub-ui]", detail);
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

  function memberName(member) {
    return text(member && (member.name || member.full_name), "Unnamed member");
  }

  function speakerRow(entry, me, api, agmId, isAdmin, ctx, rerender) {
    const name = memberName(entry.member || entry);
    const tr = node("tr", "");
    append(tr, [
      node("td", "", text(entry.position, "—")),
      node("td", "", name),
      node("td", "", fmtDateTime(entry.joined_at || entry.created_at)),
    ]);
    const actions = node("td", "");
    if (me && String(entry.member_id || entry.id) === String(me.id)) {
      actions.appendChild(button(t("Leave queue"), "btn btn-secondary btn-sm", (e) =>
        runAction(e, ctx, () => api.speakerLeave(agmId, me.id), rerender)));
    } else if (isAdmin) {
      actions.appendChild(button(t("Dismiss"), "btn btn-secondary btn-sm", (e) =>
        runAction(e, ctx, () => api.speakerLeave(agmId, entry.member_id || entry.id), rerender)));
    }
    tr.appendChild(actions);
    return tr;
  }

  async function renderHub(container, ctx) {
    const api = ctx.api;
    const data = ctx.data || {};
    const agm = data.agm || {};
    const me = currentMember(data);
    const isAdmin = !!ctx.isAdmin;

    ctxBound = ctx;

    if (!agm.id) {
      container.replaceChildren(heading("AGM Hub",
        t("An administrator needs to create the AGM before the hub is available."), ctx));
      return;
    }

    loading(container);

    let speakers = [];
    let questions = [];
    let loadError = null;
    try {
      const [spRes, qRes] = await Promise.all([
        api.speakerQueue(agm.id).catch(() => ({})),
        api.questions(agm.id).catch(() => ({})),
      ]);
      speakers = Array.isArray(spRes) ? spRes : (spRes && Array.isArray(spRes.speakers) ? spRes.speakers : []);
      questions = Array.isArray(qRes) ? qRes : (qRes && Array.isArray(qRes.questions) ? qRes.questions : []);
    } catch (error) {
      loadError = error;
    }

    container.replaceChildren();
    container.appendChild(heading("AGM Hub", t("Participant workspace for the current AGM"), ctx));

    if (loadError) {
      container.appendChild(card("Could not load", "", readFailure(loadError, () => renderHub(container, ctx))));
      return;
    }

    // Speaker queue card
    const speakerTableBody = node("tbody", "");
    speakers.forEach((entry, idx) => {
      speakerTableBody.appendChild(speakerRow(entry, me, api, agm.id, isAdmin, ctx, () => renderHub(container, ctx)));
    });

    const joinBtn = button(t("Join queue"), "btn btn-primary btn-sm", (e) =>
      runAction(e, ctx, () => api.speakerJoin(agm.id), () => renderHub(container, ctx)));
    const leaveBtn = button(t("Leave queue"), "btn btn-secondary btn-sm", (e) =>
      runAction(e, ctx, () => api.speakerLeave(agm.id, me.id), () => renderHub(container, ctx)));

    const speakerControls = node("div", "agmx-gov-controls",
      me ? [leaveBtn] : [joinBtn]);

    const speakerStatus = node("p", "agmx-reg-status",
      t("Your position") + ": " +
      (me && me.queuePosition !== undefined && me.queuePosition !== null
        ? enumLabel(me.queuePosition) : t("Not in queue")));

    const speakerTable = node("table", "agmx-members-table agmx-report-table", [
      node("thead", "", node("tr", "", [
        node("th", "", "#"), node("th", "", t("Member")),
        node("th", "", t("Joined at")), node("th", "", "")
      ])),
      speakerTableBody,
    ]);

    container.appendChild(card(t("Speaker queue"), "", [
      speakerControls,
      speakerStatus,
      speakerTable,
      speakers.length ? null : node("p", "agmx-empty", t("No speakers in queue.")),
    ].filter(Boolean)));

    // Questions card
    const qInput = input("agmx-hub-question", "text", t("Type your question…"));
    const qSubmit = button(t("Submit"), "btn btn-primary btn-sm", (e) =>
      runAction(e, ctx, async () => {
        await api.submitQuestion(agm.id, qInput.value);
        qInput.value = "";
      }, () => renderHub(container, ctx)));

    const qTableBody = node("tbody", "");
    questions.forEach((q) => {
      const row = node("tr", "");
      const status = q.answered_by ? t("Answered") : t("Open");
      append(row, [
        node("td", "", text(q.text)),
        node("td", "", memberName(q.member || q)),
        node("td", "", fmtDateTime(q.created_at || q.asked_at)),
        node("td", "", statusPill(status, q.answered_by ? "ok" : "muted")),
      ]);
      const actions = node("td", "");
      if (isAdmin) {
        if (!q.answered_by) {
          actions.appendChild(button(t("Answer"), "btn btn-primary btn-sm", (ev) => {
            const ans = window.prompt(t("Answer"));
            if (ans) {
              runAction(ev, ctx, () => api.answerQuestion(q.id, ans), () => renderHub(container, ctx));
            }
          }));
          actions.appendChild(button(t("Dismiss"), "btn btn-secondary btn-sm", (ev) =>
            runAction(ev, ctx, () => api.dismissQuestion(q.id), () => renderHub(container, ctx))));
        }
      }
      row.appendChild(actions);
      qTableBody.appendChild(row);
    });

    container.appendChild(card(t("Questions"), "", [
      node("div", "agmx-gov-controls", [
        field(t("Your question"), qInput),
        qSubmit,
      ]),
      node("table", "agmx-members-table agmx-report-table", [
        node("thead", "", node("tr", "", [
          node("th", "", t("Question")), node("th", "", t("Asked by")),
          node("th", "", t("Asked at")), node("th", "", t("Status")), node("th", "", "")
        ])),
        qTableBody,
      ]),
      questions.length ? null : node("p", "agmx-empty", t("No questions yet.")),
    ].filter(Boolean)));
  }

  window.AGMX_HUB = {
    routes: ["hub"],
    renderHub,
  };
})(window, document);
