/* ============================================================
   AGMX — Governance OS views (Sprint 4)
   ------------------------------------------------------------
   AGM Hall (#/agm) and Compliance & Audit (#/governance).
   Every write goes through the governance Edge Function, which
   enforces quorum, voting windows, ballot secrecy and the audit
   chain server-side; this view only renders what it returns.
   Values are always inserted via textContent — no HTML strings.
   ============================================================ */

(function (window, document) {
  "use strict";

  const CHOICES = ["ya", "tidak", "kecuali"];
  const VOTABLE = ["sedang diundi", "voting", "open"];

  const I18N = {
    "AGM Hall": "Dewan AGM",
    "Run the meeting: quorum, motions, voting and resolutions": "Jalankan mesyuarat: kuorum, usul, pengundian dan resolusi",
    "Compliance & Audit": "Pematuhan & Audit",
    "Statutory checks, follow-up actions and the immutable audit chain": "Semakan statutori, tindakan susulan dan rantaian audit tidak boleh ubah",
    "No AGM yet": "Belum ada AGM",
    "Create the first AGM to open the hall.": "Buka AGM pertama untuk memulakan mesyuarat.",
    "Create AGM": "Cipta AGM",
    "AGM title": "Tajuk AGM",
    "Edition": "Edisi",
    "Fiscal year": "Tahun kewangan",
    "Date and time": "Tarikh & masa",
    "Venue": "Tempat",
    "Mode": "Mod",
    "Quorum %": "Kuorum %",
    "Notice days": "Hari notis",
    "Start AGM": "Mula AGM",
    "Close AGM": "Tutup AGM",
    "Running…": "Sedang berjalan…",
    "Check me in": "Daftarkan kehadiran saya",
    "Check in a member": "Daftarkan kehadiran ahli",
    "Quorum": "Kuorum",
    "present": "hadir",
    "required": "diperlukan",
    "Agenda": "Agenda",
    "Motions": "Usul",
    "New motion": "Usul baharu",
    "Motion title": "Tajuk usul",
    "Action title": "Tajuk tindakan",
    "Type": "Jenis",
    "Proposer": "Pencadang",
    "Seconder": "Penyokong",
    "Create motion": "Cipta usul",
    "Open voting": "Buka pengundian",
    "Record resolution": "Rekod resolusi",
    "Vote": "Undi",
    "Your vote has been recorded for this motion.": "Undian anda untuk usul ini telah direkodkan.",
    "Resolutions": "Resolusi",
    "Passed": "Lulus",
    "Failed": "Gagal",
    "Actions": "Tindakan",
    "New action": "Tindakan baharu",
    "Compliance checks": "Semakan pematuhan",
    "Run compliance checks": "Jalankan semakan pematuhan",
    "Open findings": "Penemuan terbuka",
    "Audit trail": "Rantaian audit",
    "Registered documents": "Dokumen berdaftar",
    "Register document": "Daftar dokumen",
    "This workspace is running on simulated demo data, so the governance controls are disabled. Sign in to a live organization to run a meeting.":
      "Ruang kerja ini menggunakan data demo yang disimulasikan, jadi kawalan tadbir urus dimatikan. Log masuk ke organisasi sebenar untuk menjalankan mesyuarat.",
    "Demo data · simulated": "Data demo · simulasi",
    "Live Supabase data": "Data Supabase langsung",
    "Loading…": "Memuatkan…",
    "Retry": "Cuba semula",
    "Could not load": "Gagal memuatkan",
    "Operator access required": "Akses pentadbir diperlukan",
    "Refresh": "Muat semula",
    "Filename": "Nama fail",
    "None recorded yet": "Belum ada rekod",
    "This section could not be read. It is not empty — the server did not answer.":
      "Bahagian ini tidak dapat dibaca. Ia bukan kosong — pelayan tidak menjawab.",
    "Technical detail": "Butiran teknikal",
    "Could not save. The server response is in the browser console.":
      "Tidak dapat disimpan. Respons pelayan ada dalam konsol pelayar.",
    "Attendance unknown": "Kehadiran tidak diketahui",
    "Operator check-in is unavailable because the member roster could not be read.":
      "Daftar kehadiran pengendali tidak tersedia kerana senarai ahli tidak dapat dibaca.",
    "Could not complete this action. The server response is in the browser console.":
      "Tindakan ini tidak dapat diselesaikan. Respons pelayan ada dalam konsol pelayar.",
    "Recorded, but the view could not be refreshed. Reload before acting again.":
      "Telah direkodkan, tetapi paparan tidak dapat dimuat semula. Muat semula sebelum bertindak lagi.",
    "Ordinary": "Biasa",
    "Special": "Khas",
    "Election": "Pilihan raya",
    "Financial": "Kewangan",
    "Minutes": "Minit",
    "Notice": "Notis",
    "Financial statement": "Penyata kewangan",
    "Report": "Laporan",
    "Other": "Lain-lain",
    "Physical": "Fizikal",
    "Online": "Dalam talian",
    "Hybrid": "Hibrid",
    // Ballot and record statuses arrive from the schema in mixed vocabularies —
    // "sedang diundi", "voting", "live", "selesai" — so a Malay meeting showed
    // English rows next to Malay rows. enumLabel() uppercases after lookup, so
    // only the English-valued columns need an entry here.
    "live": "LANGSUNG",
    "planned": "DIJADWALKAN",
    "closed": "DITUTUP",
    "voting": "SEDANG DIUNDI",
    "open": "TERBUKA",
    "sedang diundi": "SEDANG DIUNDI",
    "Meeting": "Mesyuarat",
    "Current AGM": "AGM Semasa",
    "Present": "Hadir",
    "Absent": "Tidak hadir",
    "Member": "Ahli",
    "Name": "Nama",
    "Attendance": "Kehadiran",
    "Standard cooperative AGM order of business": "Susunan mesyuarat koperasi yang piawai",
    "Item": "Perkara",
    "Title": "Tajuk",
    "Duration": "Tempoh",
    "Motions require a proposer and a seconder (GP 14B)": "Usul memerlukan pencadang dan penyokong (GP 14B)",
    "Minutes of record": "Minit rekod",
    "Motion": "Usul",
    "Result": "Keputusan",
    "Minuted at": "Diminutkan pada",
    "Remediation items raised by the checks": "Item pemulihan yang dibangkitkan oleh semakan",
    "Rule": "Peraturan",
    "Reference": "Rujukan",
    "Detail": "Butiran",
    "Checked at": "Disemak pada",
    "Severity": "Tahap keterukan",
    "Requirement": "Persyaratan",
    "Hash-chained; each row links to the hash before it": "Bercantai hash; setiap baris merujuk hash sebelumnya",
    "When": "Bila",
    "Event": "Peristiwa",
    "Entity": "Entiti",
    "Actor": "Pelaku",
    "Prev": "Sebelumnya",
    "AGM-linked": "Berkait AGM",
    "Standalone": "Berdiri sendiri",
    "PIC": "Penanggungjawab",
    "Due": "Tarikh akhir",
    "Source": "Sumber",
    "Due date": "Tarikh akhir",
    "Follow-ups agreed at the meeting": "Tindakan susulan yang dipersetujui dalam mesyuarat",
    "Category": "Kategori",
    "Size": "Saiz",
    "Registered": "Didaftar",
    "Storage path": "Laluan storan",
    "sha256 (optional)": "sha256 (pilihan)",
    "Document vault": "Peti dokumen",
    "Evidence is registered by hash — stored files are never rewritten":
      "Bukti didaftarkan mengikut hash — fail yang disimpan tidak ditulis semula",
    "No meeting is scheduled for this organization": "Tiada mesyuarat dijadualkan untuk organisasi ini",
    "An administrator or secretary needs to create the AGM before the hall opens.":
      "Pentadbir atau setiausaha perlu mencipta AGM sebelum dewan dibuka.",
    "The agenda is seeded from the standard cooperative order of business":
      "Agenda diterbitkan daripada susunan mesyuarat koperasi yang piawai",
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

  // Schema enums arrive in whichever language the migration author happened to
  // write — "sedang diundi" beside "voting", "live" beside "selesai". Translate
  // first, then uppercase, so one meeting speaks one language.
  function enumLabel(value) {
    if (value === undefined || value === null || value === "") return "—";
    return t(String(value)).toUpperCase();
  }

  function enumWord(value) {
    if (value === undefined || value === null || value === "") return "—";
    const raw = String(value);
    return t(raw.charAt(0).toUpperCase() + raw.slice(1));
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (Array.isArray(value)) {
      value.forEach((child) => child && element.appendChild(child));
    } else if (value && typeof value.nodeType === "number") {
      element.appendChild(value);
    } else if (value !== undefined && value !== null) {
      element.textContent = t(String(value));
    }
    return element;
  }

  function append(parent, children) {
    children.forEach((child) => child && parent.appendChild(child));
    return parent;
  }

  function text(value, fallback) {
    return value === undefined || value === null || value === "" ? (fallback || "—") : String(value);
  }

  function fmtDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
  }

  function fmtDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-MY", { dateStyle: "medium" });
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

  /* The pill used to render either green (no class) or amber (is-warning), so a
     statutory check that FAILED was drawn on the same green background as one
     that passed. An unbacked all-clear in an AGM record is the failure mode that
     reaches a regulator, so every state gets its own colour and an unknown value
     can no longer default to "looks fine". */
  const PILL_TONES = { ok: " is-ok", warn: " is-warning", bad: " is-danger", muted: " is-muted" };
  function statusPill(value, tone) {
    return node("span", `agmx-status-pill${PILL_TONES[tone] || " is-muted"}`, value);
  }

  /* run_compliance_checks stores these codes; the words are Malay, so in an
     English meeting they used to print as raw schema values. */
  const COMPLIANCE_RESULT = {
    lulus: { en: "Pass", ms: "LULUS", tone: "ok" },
    amaran: { en: "Warning", ms: "AMARAN", tone: "warn" },
    gagal: { en: "Fail", ms: "GAGAL", tone: "bad" },
    belum_disemak: { en: "Not evaluated", ms: "BELUM DISEMAK", tone: "muted" },
  };
  function complianceResult(value) {
    const hit = COMPLIANCE_RESULT[String(value)];
    if (hit) return { label: lang === "ms" ? hit.ms : hit.en, tone: hit.tone };
    return { label: enumLabel(value), tone: "muted" };
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

  function renderError(container, ctx, error, retry) {
    container.replaceChildren();
    container.appendChild(heading("Could not load", "", ctx));
    container.appendChild(card("Could not load", "", readFailure(error, retry)));
  }

  // The server's own words stay out of the meeting room but never disappear:
  // the console keeps them for whoever is called to fix this.
  function logDetail(error) {
    const detail = error && error.message ? String(error.message) : String(error || "");
    if (detail && window.console && console.error) console.error("[governance-ui]", detail);
    return detail;
  }

  // A failed read and an empty read are different facts, and only one of them
  // is safe to write into minutes. Before this, a refused roster read drew
  // "0 hadir / 0", a refused audit read drew "None recorded yet", and the
  // operator check-in picker simply vanished — each of them an assertion the
  // server never made, and each of them greener than the truth.
  function readFailure(error, retry) {
    const detail = logDetail(error);
    const alert = node("div", "agmx-gov-notice is-error",
      "This section could not be read. It is not empty — the server did not answer.");
    alert.setAttribute("role", "alert");
    const blocks = [alert];
    if (detail) {
      const disclosure = node("details", "");
      disclosure.appendChild(node("summary", "", "Technical detail"));
      const pre = node("pre", "agmx-gov-error-detail");
      pre.textContent = detail;
      disclosure.appendChild(pre);
      blocks.push(disclosure);
    }
    if (retry) {
      blocks.push(node("div", "agmx-gov-controls", [button("Retry", "btn btn-secondary btn-sm", retry)]));
    }
    return blocks;
  }

  function failedSection(title, subtitle, error, retry) {
    return card(title, subtitle, readFailure(error, retry));
  }

  // A form status line is one element, so the server text used to go straight
  // into it — PostgREST and Edge Function messages, in English, in a Malay
  // meeting, and often naming a table or a policy to someone who cannot act on
  // either. Say what the operator can do; keep the response where they can read it.
  function statusFailure(status, error) {
    logDetail(error);
    status.textContent = t("Could not save. The server response is in the browser console.");
  }

  // "The write failed" and "the write landed but the view would not refresh"
  // cannot share one message: the second one tells an operator to press the
  // button again, and a duplicated motion or registered document is worse than
  // a stale screen.
  async function submitWrite(status, work, rerender) {
    try {
      await work();
    } catch (error) {
      statusFailure(status, error);
      return false;
    }
    if (rerender) {
      try {
        await rerender();
      } catch (error) {
        logDetail(error);
        status.textContent = t("Recorded, but the view could not be refreshed. Reload before acting again.");
      }
    }
    return true;
  }

  /* ---- View 1: AGM Hall ---- */

  async function renderAgmHall(container, ctx) {
    if (ctx.source === "demo") return renderDemoBlocked(container, ctx, t("AGM Hall"));
    loading(container);
    let payload;
    try {
      payload = await ctx.api.current();
    } catch (error) {
      return renderError(container, ctx, error, () => renderAgmHall(container, ctx));
    }
    container.replaceChildren();
    container.appendChild(heading("AGM Hall", "Run the meeting: quorum, motions, voting and resolutions", ctx));

    if (!payload.agm) {
      container.appendChild(createAgmCard(ctx));
      return;
    }

    const agm = payload.agm;
    let roster = { members: [], attendance: [], quorum: null, error: null };
    try {
      const loaded = await ctx.api.roster(agm.id);
      roster = {
        members: (loaded && loaded.members) || [],
        attendance: (loaded && loaded.attendance) || [],
        quorum: (loaded && loaded.quorum) || null,
        error: null,
      };
    } catch (error) {
      // The hall still renders — the agenda, the motions and the vote buttons
      // do not need the roster — but the quorum card says what it could not
      // read instead of counting zero members.
      roster = { members: [], attendance: [], quorum: null, error };
    }

    const voted = new Set();
    const rerender = () => renderAgmHall(container, ctx);
    container.appendChild(agmStatusCard(ctx, agm, payload, rerender));
    container.appendChild(quorumCard(ctx, agm, roster, rerender));
    container.appendChild(agendaCard(payload.agenda));
    container.appendChild(motionsCard(ctx, agm, payload.motions, roster, voted, rerender));
    container.appendChild(resolutionsCard(payload.resolutions));
  }

  function agmStatusCard(ctx, agm, payload, rerender) {
    const tone = agm.status === "live" ? "ok" : "muted";
    const controls = node("div", "agmx-gov-controls");
    if (ctx.isAdmin) {
      if (agm.status === "planned") {
        controls.appendChild(button("Start AGM", "btn btn-primary btn-sm", async (e) => {
          await runAction(e, ctx, () => ctx.api.startAgm(agm.id), rerender);
        }));
      }
      if (agm.status === "live") {
        controls.appendChild(button("Close AGM", "btn btn-danger btn-sm", async (e) => {
          await runAction(e, ctx, () => ctx.api.closeAgm(agm.id), rerender);
        }));
      }
    }
    const list = node("dl", "agmx-detail-list", [
      detailRow("Meeting", text(agm.title)),
      detailRow("Status", statusPill(enumLabel(agm.status || "planned"), tone)),
      detailRow("Date and time", fmtDateTime(agm.scheduled_at)),
      detailRow("Venue", text(agm.venue)),
      detailRow("Mode", enumWord(agm.mode)),
      detailRow("Motions", String((payload.motions || []).length)),
      detailRow("Resolutions", String((payload.resolutions || []).length)),
    ]);
    return card(text(agm.title, "Current AGM"), `Edition ${text(agm.edition)}${agm.fiscal_year ? " · FY " + agm.fiscal_year : ""}`, [list, controls]);
  }

  function detailRow(label, value) {
    const row = node("div", "agmx-detail-row");
    const cell = node("dd", "");
    if (value && value.nodeType === 1) cell.appendChild(value);
    else cell.textContent = String(value);
    return append(row, [node("dt", "", label), cell]);
  }

  function quorumCard(ctx, agm, roster, rerender) {
    const required = Number(agm.quorum_pct || 25);
    const actions = node("div", "agmx-gov-controls");
    if (agm.status === "live") {
      // Self check-in is a write about the signed-in member; it does not need
      // the roster, so a failed roster read must not take it away.
      actions.appendChild(button("Check me in", "btn btn-primary btn-sm", async (e) => {
        await runAction(e, ctx, () => ctx.api.checkIn(agm.id, null, "digital"), rerender);
      }));
    }

    if (roster.error) {
      const blocks = readFailure(roster.error, rerender);
      blocks.push(actions);
      if (ctx.isAdmin && agm.status === "live") {
        // The control stays visible and disabled: hiding it leaves the secretary
        // hunting for a button that is there in every other meeting.
        const operatorCheckIn = button("Check in a member", "btn btn-secondary btn-sm", () => {});
        operatorCheckIn.disabled = true;
        actions.appendChild(operatorCheckIn);
        blocks.push(node("p", "agmx-empty",
          "Operator check-in is unavailable because the member roster could not be read."));
      }
      return card("Quorum", `${t("Quorum")} ${required}% · ${t("Attendance unknown")}`, blocks);
    }

    const quorum = roster.quorum;
    const present = quorum ? Number(quorum.present) : (roster.attendance || []).length;
    const total = quorum ? Number(quorum.total_members) : (roster.members || []).length;
    const pct = quorum ? Number(quorum.pct) : (total ? (present / total) * 100 : 0);
    const satisfied = pct >= required;

    const bar = node("div", "agmx-progress");
    const fill = node("span", "");
    fill.style.width = `${Math.min(100, Math.round(pct))}%`;
    fill.style.background = satisfied ? "#16a34a" : "#f59e0b";
    bar.appendChild(fill);

    const summary = node("p", "agmx-gov-quorum-summary",
      `${present} ${t("present")} / ${total} · ${pct.toFixed(1)}% (${required}% ${t("required")})`);
    summary.setAttribute("role", "status");

    if (agm.status === "live" && ctx.isAdmin && (roster.members || []).length) {
      const choices = [{ value: "", label: t("Check in a member") }].concat(
        roster.members.map((m) => ({ value: m.id, label: `${m.member_no} · ${m.name}` }))
      );
      const picker = select("agmx-checkin-member", choices);
      const wrap = node("div", "agmx-gov-inline", [
        picker,
        button("Check in a member", "btn btn-secondary btn-sm", async (e) => {
          if (!picker.value) return;
          await runAction(e, ctx, () => ctx.api.checkIn(agm.id, picker.value, "operator"), rerender);
        }),
      ]);
      actions.appendChild(wrap);
    }
    const presentIds = new Set((roster.attendance || []).map((a) => a.member_id));
    const rows = (roster.members || []).map((m) => [
      m.member_no,
      m.name,
      m.status,
      statusPill(presentIds.has(m.id) ? "Present" : "Absent", presentIds.has(m.id) ? "ok" : "warn"),
    ]);
    return append(card("Quorum", `${t("Quorum")} ${required}%`, [summary, bar, actions]),
      [rows.length ? table(["Member", "Name", "Status", "Attendance"], rows) : node("p", "agmx-empty", t("None recorded yet"))]);
  }

  function agendaCard(agenda) {
    if (!(agenda || []).length) return node("div", "");
    const rows = agenda.map((item) => [
      item.code,
      item.title,
      item.type,
      `${item.duration_min} min`,
      item.status,
    ]);
    return card("Agenda", "Standard cooperative AGM order of business", [table(["Item", "Title", "Type", "Duration", "Status"], rows)]);
  }

  function motionsCard(ctx, agm, motions, roster, voted, rerender) {
    const members = (roster && roster.members) || [];
    const blocks = (motions || []).map((motion) => motionBlock(ctx, agm, motion, members, voted, rerender));
    const create = ctx.isAdmin ? createMotionCard(ctx, agm, members, roster && roster.error, rerender) : null;
    const wrap = node("div", "agmx-gov-motions");
    wrap.append(...blocks, create || document.createComment(""));
    return wrap;
  }

  function motionBlock(ctx, agm, motion, members, voted, rerender) {
    const actions = node("div", "agmx-gov-controls");
    const votable = VOTABLE.includes(motion.status) && agm.status === "live";
    const ballot = [];
    if (votable) {
      CHOICES.forEach((choice) => {
        const btn = button(choice === "ya" ? "Ya" : choice === "tidak" ? "Tidak" : "Kecuali",
          `btn btn-sm ${choice === "ya" ? "btn-success" : choice === "tidak" ? "btn-danger" : "btn-secondary"}`,
          async (e) => {
            const done = await runAction(e, ctx, () => ctx.api.vote(motion.id, choice));
            if (!done) return;
            voted.add(motion.id);
            ballot.forEach((b) => { b.disabled = true; });
            notice(cardOf(actions), "Your vote has been recorded for this motion.");
          });
        ballot.push(btn);
        actions.appendChild(btn);
      });
      if (voted.has(motion.id)) ballot.forEach((b) => { b.disabled = true; });
    }
    if (ctx.isAdmin) {
      if (["draf", "menunggu"].includes(motion.status) && agm.status === "live") {
        actions.appendChild(button("Open voting", "btn btn-primary btn-sm", async (e) => {
          await runAction(e, ctx, () => ctx.api.openVoting(motion.id), rerender);
        }));
      }
      if (VOTABLE.includes(motion.status)) {
        actions.appendChild(button("Record resolution", "btn btn-secondary btn-sm", async (e) => {
          await runAction(e, ctx, () => ctx.api.recordResolution(motion.id), rerender);
        }));
      }
    }
    const named = (ref) => {
      if (!ref) return "—";
      if (typeof ref === "object") return ref.name ? `${ref.name}${ref.member_no ? ` (${ref.member_no})` : ""}` : "—";
      const m = (members || []).find((x) => x.id === ref);
      return m ? `${m.name} (${m.member_no})` : "—";
    };
    const body = node("div", "agmx-gov-motion-body", [
      node("h3", "", `${motion.code} · ${motion.title}`),
      node("p", "agmx-gov-motion-meta",
        `${t("Type")}: ${enumWord(motion.type)} · ${t("Proposer")}: ${named(motion.proposer)} · ${t("Seconder")}: ${named(motion.seconder)}`),
      statusPill(enumLabel(motion.status || "draf"), votable ? "ok" : "warn"),
    ]);
    return node("div", "agmx-gov-motion agmx-card", [body, actions]);
  }

  function cardOf(element) {
    return element.closest(".agmx-gov-motion") || element.parentElement;
  }

  function createMotionCard(ctx, agm, members, unreadable, rerender) {
    const title = input("agmx-motion-title", "text", "Motion title");
    const type = select("agmx-motion-type", [
      { value: "biasa", label: "Ordinary" },
      { value: "khas", label: "Special" },
      { value: "election", label: "Election" },
      { value: "financial", label: "Financial" },
    ]);
    const opts = [{ value: "", label: "—" }].concat(members.map((m) => ({ value: m.id, label: `${m.member_no} · ${m.name}` })));
    const proposer = select("agmx-motion-proposer", opts);
    const seconder = select("agmx-motion-seconder", opts);
    const status = node("p", "agmx-gov-status");
    status.setAttribute("role", "status");
    const submit = button("Create motion", "btn btn-primary btn-sm", async () => {
      if (!title.value.trim()) {
        status.textContent = `${t("Motion title")} —`;
        return;
      }
      submit.disabled = true;
      const done = await submitWrite(status, () => ctx.api.createMotion({
        agmId: agm.id,
        title: title.value.trim(),
        type: type.value,
        proposerId: proposer.value || null,
        seconderId: seconder.value || null,
      }), rerender);
      if (!done) submit.disabled = false;
    });
    // The picker going from forty names to one blank option is otherwise
    // invisible, and the secretary cannot tell an empty roster from a
    // permission problem from a broken page.
    const rosterNote = unreadable
      ? node("div", "", readFailure(unreadable, rerender))
      : null;
    return card("New motion", "Motions require a proposer and a seconder (GP 14B)", [
      rosterNote,
      field("Motion title", title),
      node("div", "agmx-gov-form-row", [field("Type", type), field("Proposer", proposer), field("Seconder", seconder)]),
      node("div", "agmx-gov-controls", [submit]),
      status,
    ]);
  }

  function resolutionsCard(resolutions) {
    if (!(resolutions || []).length) return node("div", "");
    const rows = resolutions.map((r) => [
      r.title,
      statusPill(r.passed ? "Passed" : "Failed", r.passed ? "ok" : "warn"),
      r.votes_ya,
      r.votes_tidak,
      r.votes_kecuali,
      fmtDateTime(r.minuted_at),
    ]);
    return card("Resolutions", "Minutes of record", [table(["Motion", "Result", "Ya", "Tidak", "Kecuali", "Minuted at"], rows)]);
  }

  /* ---- View 2: Compliance & Audit ---- */

  async function renderGovernanceRegister(container, ctx) {
    if (ctx.source === "demo") return renderDemoBlocked(container, ctx, t("Compliance & Audit"));
    loading(container);
    let current;
    try {
      current = await ctx.api.current();
    } catch (error) {
      return renderError(container, ctx, error, () => renderGovernanceRegister(container, ctx));
    }
    container.replaceChildren();
    container.appendChild(heading("Compliance & Audit", "Statutory checks, follow-up actions and the immutable audit chain", ctx));

    const agmId = current.agm ? current.agm.id : null;
    const retry = () => renderGovernanceRegister(container, ctx);
    // The empty shape keeps the render code branch-free; the error key is what
    // tells an empty audit trail apart from an unreadable one.
    const load = (promise, empty) => promise.catch((error) => Object.assign({ error }, empty));
    const [actions, compliance, audit] = await Promise.all([
      load(ctx.api.actions(), { actions: [] }),
      agmId ? load(ctx.api.compliance(agmId), { checks: [], findings: [] }) : Promise.resolve({ checks: [], findings: [] }),
      agmId ? load(ctx.api.audit(agmId), { events: [] }) : Promise.resolve({ events: [] }),
    ]);

    if (ctx.isAdmin && agmId) {
      const runBtn = button("Run compliance checks", "btn btn-primary btn-sm", async (e) => {
        await runAction(e, ctx, () => ctx.api.runCompliance(agmId), retry);
      });
      container.appendChild(node("div", "agmx-gov-controls", [runBtn]));
    }

    if (compliance.error) {
      container.appendChild(failedSection("Compliance checks", "Akta Koperasi 1993 · Peraturan-Peraturan Koperasi", compliance.error, retry));
      container.appendChild(failedSection("Open findings", "Remediation items raised by the checks", compliance.error, retry));
    } else {
      const checkRows = (compliance.checks || []).map((c) => {
        const res = complianceResult(c.result);
        return [
          c.rule ? c.rule.code : c.rule_id,
          c.rule ? c.rule.act : "—",
          statusPill(res.label, res.tone),
          JSON.stringify(c.details || {}),
          fmtDateTime(c.checked_at),
        ];
      });
      container.appendChild(card("Compliance checks", "Akta Koperasi 1993 · Peraturan-Peraturan Koperasi",
        [checkRows.length ? table(["Rule", "Reference", "Result", "Detail", "Checked at"], checkRows) : node("p", "agmx-empty", t("None recorded yet"))]));

      const findingRows = (compliance.findings || []).map((f) => [
        enumLabel(f.severity),
        f.message,
        statusPill(enumLabel(f.status || "terbuka"), "warn"),
      ]);
      container.appendChild(card("Open findings", "Remediation items raised by the checks",
        [findingRows.length ? table(["Severity", "Requirement", "Status"], findingRows) : node("p", "agmx-empty", t("None recorded yet"))]));
    }

    container.appendChild(actionsCard(ctx, current.agm, actions, retry));
    container.appendChild(await documentsCard(ctx, current.agm, retry));

    const auditRows = (audit.events || []).map((e) => [
      fmtDateTime(e.occurred_at),
      e.action,
      `${e.entity_type} · ${e.entity_id}`,
      text(e.actor_name),
      (e.hash || "").slice(0, 12),
      (e.prev_hash || "").slice(0, 12),
    ]);
    container.appendChild(audit.error
      ? failedSection("Audit trail", "Hash-chained; each row links to the hash before it", audit.error, retry)
      : card("Audit trail", "Hash-chained; each row links to the hash before it",
        [auditRows.length ? table(["When", "Event", "Entity", "Actor", "Hash", "Prev"], auditRows) : node("p", "agmx-empty", t("None recorded yet"))]));
  }

  function actionsCard(ctx, agm, result, rerender) {
    const actions = (result && result.actions) || [];
    const rows = actions.map((a) => [
      a.title,
      a.pic && a.pic.name ? `${a.pic.name} (${a.pic.member_no})` : "—",
      fmtDate(a.due_date),
      statusPill(enumLabel(a.status || "terbuka"), a.status === "selesai" ? "ok" : "warn"),
      text(a.agm_id ? "AGM-linked" : "Standalone"),
    ]);
    // A failed read is shown as a failed read; the create form stays, because
    // logging a follow-up does not depend on having listed the old ones.
    const blocks = [result && result.error
      ? node("div", "", readFailure(result.error, rerender))
      : rows.length ? table(["Action", "PIC", "Due", "Status", "Source"], rows) : node("p", "agmx-empty", t("None recorded yet"))];
    if (ctx.isAdmin) {
      const title = input("agmx-action-title", "text", "Action title");
      const due = input("agmx-action-due", "date");
      const status = node("p", "agmx-gov-status");
      status.setAttribute("role", "status");
      const submit = button("New action", "btn btn-secondary btn-sm", async () => {
        if (!title.value.trim()) { status.textContent = `${t("Action title")} —`; return; }
        submit.disabled = true;
        const done = await submitWrite(status, () => ctx.api.createAction({
          title: title.value.trim(), dueDate: due.value || null, agmId: agm ? agm.id : null,
        }), rerender);
        if (!done) submit.disabled = false;
      });
      blocks.push(node("div", "agmx-gov-form-row", [field("Action", title), field("Due date", due), submit, status]));
    }
    return card("Actions", "Follow-ups agreed at the meeting", blocks);
  }

  async function documentsCard(ctx, agm, rerender) {
    const host = node("div", "");
    let documents = [];
    let unreadable = null;
    try {
      const loaded = await ctx.api.documents();
      documents = (loaded && loaded.documents) || [];
    } catch (error) {
      // The register form still works — registering a document is a write —
      // but "no documents" is not what just happened.
      unreadable = error;
    }

    const rows = documents.map((d) => [
      d.category,
      d.filename,
      text(d.mime),
      d.size_bytes ? `${Math.round(Number(d.size_bytes) / 1024)} KB` : "—",
      (d.sha256 || "").slice(0, 16) || "—",
      fmtDateTime(d.created_at),
    ]);

    const blocks = [unreadable
      ? node("div", "", readFailure(unreadable, rerender))
      : rows.length
      ? table(["Category", "Filename", "MIME", "Size", "SHA-256", "Registered"], rows)
      : node("p", "agmx-empty", t("None recorded yet"))];

    if (ctx.isAdmin) {
      const filename = input("agmx-doc-filename", "text", "e.g. agm-minutes-2026.pdf");
      const path = input("agmx-doc-path", "text", "Storage path");
      const sha = input("agmx-doc-sha", "text", "sha256 (optional)");
      const category = select("agmx-doc-category", [
        { value: "minutes", label: "Minutes" },
        { value: "notice", label: "Notice" },
        { value: "financial", label: "Financial statement" },
        { value: "report", label: "Report" },
        { value: "other", label: "Other" },
      ]);
      const status = node("p", "agmx-gov-status");
      status.setAttribute("role", "status");
      const submit = button("Register document", "btn btn-secondary btn-sm", async () => {
        if (!filename.value.trim() || !path.value.trim()) {
          status.textContent = t("Filename") + " / storage path —";
          return;
        }
        submit.disabled = true;
        const done = await submitWrite(status, () => ctx.api.registerDocument({
          agmId: agm ? agm.id : null,
          category: category.value,
          filename: filename.value.trim(),
          mime: "application/octet-stream",
          storagePath: path.value.trim(),
          sha256: sha.value.trim() || null,
        }), rerender);
        if (!done) submit.disabled = false;
      });
      blocks.push(node("div", "agmx-gov-form-row", [
        field("Category", category), field("Filename", filename), field("Storage path", path), field("SHA-256", sha),
      ]));
      blocks.push(node("div", "agmx-gov-controls", [submit, status]));
    }

    host.appendChild(card("Document vault", "Evidence is registered by hash — stored files are never rewritten", blocks));
    return host;
  }

  /* ---- AGM creation ---- */

  function createAgmCard(ctx) {
    if (!ctx.isAdmin) {
      return card("No AGM yet", "No meeting is scheduled for this organization", [
        node("p", "agmx-empty", "An administrator or secretary needs to create the AGM before the hall opens."),
      ]);
    }
    const title = input("agmx-agm-title", "text", "AGM title");
    const edition = input("agmx-agm-edition", "number", "45");
    edition.min = 1;
    const fiscal = input("agmx-agm-fiscal", "text", "2026");
    const when = input("agmx-agm-when", "datetime-local");
    const venue = input("agmx-agm-venue", "text", "Venue");
    const quorum = input("agmx-agm-quorum", "number", "25");
    const notice = input("agmx-agm-notice", "number", "21");
    const mode = select("agmx-agm-mode", [
      { value: "physical", label: "Physical" },
      { value: "online", label: "Online" },
      { value: "hybrid", label: "Hybrid" },
    ]);
    const status = node("p", "agmx-gov-status");
    status.setAttribute("role", "status");
    const submit = button("Create AGM", "btn btn-primary", async () => {
      if (!title.value.trim() || !when.value) {
        status.textContent = `${t("AGM title")} / ${t("Date and time")} —`;
        return;
      }
      submit.disabled = true;
      submit.textContent = t("Running…");
      try {
        await ctx.api.createAgm({
          title: title.value.trim(),
          edition: Number(edition.value || 1),
          fiscalYear: fiscal.value || null,
          scheduledAt: new Date(when.value).toISOString(),
          venue: venue.value || null,
          mode: mode.value,
          quorumPct: Number(quorum.value || 25),
          noticeDays: Number(notice.value || 21),
        });
        await ctx.reload();
      } catch (error) {
        statusFailure(status, error);
        submit.disabled = false;
        submit.textContent = t("Create AGM");
      }
    });
    return append(card("Create AGM", "The agenda is seeded from the standard cooperative order of business", [
      node("div", "agmx-gov-form-row", [field("AGM title", title), field("Edition", edition), field("Fiscal year", fiscal)]),
      node("div", "agmx-gov-form-row", [field("Date and time", when), field("Venue", venue), field("Mode", mode)]),
      node("div", "agmx-gov-form-row", [field("Quorum %", quorum), field("Notice days", notice)]),
      node("div", "agmx-gov-controls", [submit]),
      status,
    ]), []);
  }

  function renderDemoBlocked(container, ctx, title) {
    container.replaceChildren();
    container.appendChild(heading(title, "", ctx));
    const banner = node("div", "agmx-demo-banner",
      "This workspace is running on simulated demo data, so the governance controls are disabled. Sign in to a live organization to run a meeting.");
    banner.setAttribute("role", "status");
    container.appendChild(banner);
  }

  async function runAction(event, ctx, work, rerender) {
    const buttonEl = event.currentTarget;
    const original = buttonEl.textContent;
    const host = () => buttonEl.closest(".agmx-card") || buttonEl.parentElement;
    buttonEl.disabled = true;
    buttonEl.textContent = t("Running…");
    try {
      await work();
    } catch (error) {
      logDetail(error);
      notice(host(), t("Could not complete this action. The server response is in the browser console."), "error");
      buttonEl.disabled = false;
      buttonEl.textContent = original;
      return false;
    }
    // The write landed. A refresh that then fails is not a failed action: the
    // ballot is recorded, and reporting it as an error invites the member to
    // vote a second time.
    buttonEl.textContent = original;
    if (rerender) {
      try {
        await rerender();
      } catch (error) {
        logDetail(error);
        notice(host(), t("Recorded, but the view could not be refreshed. Reload before acting again."), "error");
      }
    }
    return true;
  }

  window.AGMX_GOVERNANCE = {
    routes: ["agm", "governance"],
    renderAgmHall,
    renderGovernanceRegister,
  };
})(window, document);
