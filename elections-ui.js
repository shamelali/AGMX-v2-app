/* ============================================================
   AGMX — Elections & secret ballot (Sprint 8)
   ------------------------------------------------------------
   One election per AGM. Voters cast Ya / Tidak / Kecuali
   through the governance Edge Function (cast_ballot RPC);
   choices are stored separately from voter identity and the
   view never invents ballots or results. Every write goes
   through api.*; values are always inserted via textContent.
   ============================================================ */

(function (window, document) {
  "use strict";

  const I18N = {
    "Elections": "Pilihraya",
    "Secret ballot for the current AGM": "Undi rahasia bagi AGM semasa",
    "No current AGM": "Tiada AGM semasa",
    "An administrator needs to create the AGM before elections can be configured.":
      "Pentadbir perlu mencipta AGM sebelum pilihraya boleh dikonfigura.",
    "No election configured": "Tiada pilihraya dikonfigura",
    "Belum ada pilihraya yang dikonfigura untuk AGM ini.": "Belum ada pilihraya yang dikonfigura untuk AGM ini.",
    "Election": "Pilihraya",
    "Meeting": "Mesyuarat",
    "Status": "Status",
    "Draft": "Rancangan",
    "Open": "Dibuka",
    "Suspended": "Dineda",
    "Closed": "Ditutup",
    "Verified": "Diverifikasi",
    "Published": "Diterbitkan",
    "Configure election": "Konfigura pilihraya",
    "Title": "Tajuk",
    "Opens at": "Dibuka pada",
    "Closes at": "Ditutup pada",
    "Quorum required (%)": "Kuorum diperlukan (%)",
    "Save": "Simpan",
    "Election control": "Kawalan pilihraya",
    "Open voting": "Buka undi",
    "Suspend voting": "Nenda undi",
    "Close voting": "Tutup undi",
    "Verify results": "Verifikasi keputusan",
    "Publish results": "Terbitkan keputusan",
    "No further actions.": "Tiada tindakan lanjutan.",
    "Your vote": "Undi anda",
    "Ya": "Ya",
    "Tidak": "Tidak",
    "Kecuali": "Kecuali",
    "Running…": "Sedang berjalan…",
    "Already voted": "Telah mengundi",
    "Receipt:": "Resit:",
    "Voting is not open.": "Undi belum dibuka.",
    "Voting has closed.": "Undi telah ditutup.",
    "Results": "Keputusan",
    "Total ballots": "Jumlah undian masuk",
    "For": "Undi Ya",
    "Against": "Undi Tidak",
    "Abstain": "Undi Kecuali",
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

  function pillTone(status) {
    if (status === "open") return "ok";
    if (status === "suspended") return "warn";
    if (status === "closed" || status === "muted") return "muted";
    if (status === "verified" || status === "published") return "ok";
    return "muted";
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
    if (detail && window.console && console.error) console.error("[elections-ui]", detail);
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
  // Configure form (draft elections only)
  // ------------------------------------------------------------
  function configureCard(api, agmId, election, ctx, rerender) {
    const titleInput = input("agmx-election-title", "text", t("Election title"));
    const opensInput = input("agmx-election-opens", "datetime-local", t("Opens at"));
    const closesInput = input("agmx-election-closes", "datetime-local", t("Closes at"));
    const quorumInput = input("agmx-election-quorum", "number", t("Quorum required (%)"));
    quorumInput.min = "0";
    quorumInput.max = "100";
    if (election) {
      titleInput.value = election.title || "";
      opensInput.value = election.opens_at ? String(election.opens_at).slice(0, 16) : "";
      closesInput.value = election.closes_at ? String(election.closes_at).slice(0, 16) : "";
      quorumInput.value = election.quorum_required !== null && election.quorum_required !== undefined
        ? String(election.quorum_required) : "";
    }

    const saveBtn = button(t("Save"), "btn btn-primary btn-sm", (e) =>
      runAction(e, ctx, async () => {
        await api.configureElection(
          agmId,
          titleInput.value,
          opensInput.value || null,
          closesInput.value || null,
          quorumInput.value ? Number(quorumInput.value) : null
        );
      }, rerender)
    );

    return card(t("Configure election"), "", [
      field(t("Title"), titleInput),
      field(t("Opens at"), opensInput),
      field(t("Closes at"), closesInput),
      field(t("Quorum required (%)"), quorumInput),
      node("div", "agmx-gov-controls", [saveBtn]),
    ]);
  }

  // ------------------------------------------------------------
  // Operator action cards by election status
  // ------------------------------------------------------------
  function adminCards(election, agmId, api, ctx, rerender) {
    const cards = [];
    if (election.status === "draft") {
      cards.push(configureCard(api, agmId, election, ctx, rerender));
      return cards;
    }

    const specs = {
      open: [[t("Suspend voting"), "suspendElection"], [t("Close voting"), "closeElection"]],
      suspended: [[t("Close voting"), "closeElection"]],
      closed: [[t("Verify results"), "verifyElection"]],
      verified: [[t("Publish results"), "publishElection"]],
    }[election.status] || [];

    const actions = specs.map(([label, method]) =>
      button(label, "btn btn-secondary btn-sm", (e) => runAction(e, ctx, () => api[method](agmId), rerender))
    );

    cards.push(card(t("Election control"), "", actions.length ? actions
      : [node("p", "agmx-empty", t("No further actions."))]));
    return cards;
  }

  // ------------------------------------------------------------
  // Results (verified / published only)
  // ------------------------------------------------------------
  function resultsBlock(tally) {
    const total = Number(tally.total_ballots || 0);
    const pct = (value) => total > 0 ? " (" + Math.round((Number(value || 0) / total) * 100) + "%)" : "";
    return card(t("Results"), "", [
      node("dl", "agmx-detail-list", [
        detailRow(t("Total ballots"), formatNumber(total)),
        detailRow(t("For"), String(tally.ya || 0) + pct(tally.ya)),
        detailRow(t("Against"), String(tally.tidak || 0) + pct(tally.tidak)),
        detailRow(t("Abstain"), String(tally.kecuali || 0) + pct(tally.kecuali)),
      ]),
    ]);
  }

  // ------------------------------------------------------------
  // Voter actions: cast a secret ballot
  // ------------------------------------------------------------
  const CHOICE_LABEL = { ya: "Ya", tidak: "Tidak", kecuali: "Kecuali" };

  function voteButton(choice, electionId, api, wrap) {
    const btn = button(t(CHOICE_LABEL[choice]), "btn btn-primary btn-sm", async (e) => {
      const b = e.currentTarget;
      const original = b.textContent;
      b.disabled = true;
      b.textContent = t("Running…");
      try {
        const result = await api.castBallot(electionId, choice);
        b.textContent = original;
        const receipt = result && result.receipt_token ? String(result.receipt_token) : "";
        wrap.replaceChildren(
          node("p", "", t("Your vote")),
          node("p", "agmx-reg-status", t("Already voted") + (receipt ? " — " + t("Receipt:") + " " + receipt : ""))
        );
      } catch (error) {
        logDetail(error);
        notice(wrap, t("Could not complete this action. The server response is in the browser console."), "error");
        b.disabled = false;
        b.textContent = original;
      }
    });
    return btn;
  }

  function voteSection(election, api) {
    const wrap = node("div", "agmx-gov-controls");
    append(wrap, [node("p", "", t("Your vote"))]);
    if (election.status === "open") {
      ["ya", "tidak", "kecuali"].forEach((choice) => wrap.appendChild(voteButton(choice, election.id, api, wrap)));
    } else {
      wrap.appendChild(node("p", "", election.status === "closed" ? t("Voting has closed.") : t("Voting is not open.")));
    }
    return wrap;
  }

  // ------------------------------------------------------------
  // Election card
  // ------------------------------------------------------------
  function electionCard(election, agm, api) {
    const children = [
      node("dl", "agmx-detail-list", [
        detailRow(t("Meeting"), text(agm.title)),
        detailRow(t("Status"), statusPill(enumLabel(election.status), pillTone(election.status))),
        detailRow(t("Opens at"), fmtDateTime(election.opens_at)),
        detailRow(t("Closes at"), fmtDateTime(election.closes_at)),
        detailRow(t("Quorum required (%)"), text(election.quorum_required, "25") + " %"),
      ]),
    ];
    children.push(voteSection(election, api));
    return card(election.title, t("Meeting") + ": " + text(agm.title), children);
  }

  // ------------------------------------------------------------
  // Entry point
  // ------------------------------------------------------------
  async function renderVoting(container, ctx) {
    const api = ctx.api;
    const data = ctx.data || {};
    const agm = data.agm || {};

    if (!agm.id) {
      container.replaceChildren(heading("Elections",
        t("An administrator needs to create the AGM before elections can be configured."), ctx));
      return;
    }

    loading(container);

    let elections = [];
    let electionsError = null;
    try {
      const payload = await api.elections();
      elections = Array.isArray(payload) ? payload
        : (payload && Array.isArray(payload.elections) ? payload.elections : []);
    } catch (error) {
      electionsError = error;
    }

    const mine = elections.filter((e) => String(e.agm_id) === String(agm.id));
    const election = mine[0];

    let tally = null;
    if (election && (election.status === "verified" || election.status === "published")) {
      try {
        const result = await api.tallyElection(election.id);
        tally = result && result.total_ballots !== undefined ? result : null;
      } catch (_) { tally = null; }
    }

    container.replaceChildren();
    container.appendChild(heading("Elections", t("Secret ballot for the current AGM"), ctx));

    if (electionsError) {
      container.appendChild(card("Could not load", "", readFailure(electionsError, () => renderVoting(container, ctx))));
      return;
    }

    if (!election) {
      container.appendChild(card(t("No election configured"), t("Belum ada pilihraya yang dikonfigura untuk AGM ini."), []));
      if (ctx.isAdmin) {
        container.appendChild(configureCard(api, agm.id, null, ctx, () => renderVoting(container, ctx)));
      }
      return;
    }

    container.appendChild(electionCard(election, agm, api));

    if (tally) container.appendChild(resultsBlock(tally));

    if (ctx.isAdmin) {
      adminCards(election, agm.id, api, ctx, () => renderVoting(container, ctx))
        .forEach((cardEl) => container.appendChild(cardEl));
    }
  }

  window.AGMX_VOTING = {
    routes: ["voting"],
    renderVoting,
  };
})(window, document);
