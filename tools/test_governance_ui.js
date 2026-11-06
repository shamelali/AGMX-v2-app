/* ============================================================
   AGMX — governance-ui.js view harness
   ------------------------------------------------------------
   Credential-free, offline. Runs the Governance OS views against a
   minimal DOM stub and a stubbed governance API, asserting that:
     * role gates in the view match the Edge Function's contract,
     * payloads are sent with the field names the function reads,
     * every rendered value goes out as text, never as HTML,
     * demo workspaces never reach the live API,
     * a refused read is drawn as a refusal, never as an empty register.
   Usage: node tools/test_governance_ui.js
   ============================================================ */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "governance-ui.js"), "utf8");

const { El, makeDocument } = require("./dom_stub.js");


function harness(api, options) {
  const document = makeDocument();
  const container = new El("div");
  container.className = "agmx-shell-content";
  const store = new Map(Object.entries(options.localStorage || {}));
  // The views keep the server's own words out of the meeting room and put them
  // in the console, so the harness has to read the console to see them.
  const logs = [];
  const sandboxConsole = { error: (...parts) => logs.push(parts.join(" ")), log: () => {}, warn: () => {} };
  const window = {
    // English by default so the assertions read against source strings;
    // the Malay build is asserted separately.
    location: { search: options.search || "?lang=en", href: "https://app.test/app.html", origin: "https://app.test" },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    document,
    console: sandboxConsole,
    AGMX_GOVERNANCE: null,
  };
  const context = vm.createContext({ window, document, URLSearchParams, Number, Math, JSON, Date, Set, Object, Array, String, Promise, Error, console: sandboxConsole, navigator: {} });
  vm.runInContext(SOURCE, context, { filename: "governance-ui.js" });
  const view = window.AGMX_GOVERNANCE;
  const ctx = {
    data: { cooperative: { name: "Koperasi Uji" }, currentUser: { name: "Penguji", role: options.role } },
    source: options.source || "supabase",
    isAdmin: options.role === "admin" || options.role === "secretary",
    api,
    reload: () => { ctx.reloadCalls++; return Promise.resolve(); },
    reloadCalls: 0,
  };
  return { view, ctx, container, logs };
}

const AGM_LIVE = {
  id: "agm-1", title: "AGM Ke-45", edition: 45, fiscal_year: "2026", status: "live",
  scheduled_at: "2026-12-01T09:00:00Z", venue: "Dewan Seri Jaya", mode: "hybrid", quorum_pct: 25, notice_days: 21,
};
const AGM_PLANNED = { ...AGM_LIVE, status: "planned" };

function stubApi(overrides) {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push({ name, args });
    const impl = overrides[name];
    if (!impl) return Promise.resolve({});
    // A real adapter answers a refused read with a rejected promise, never a
    // synchronous throw, so the stub must not either.
    try {
      return Promise.resolve(impl(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const api = {
    current: record("current"), roster: record("roster"), actions: record("actions"),
    documents: record("documents"), compliance: record("compliance"), audit: record("audit"),
    createAgm: record("createAgm"), startAgm: record("startAgm"), closeAgm: record("closeAgm"),
    checkIn: record("checkIn"), createMotion: record("createMotion"), openVoting: record("openVoting"),
    vote: record("vote"), recordResolution: record("recordResolution"), createAction: record("createAction"),
    runCompliance: record("runCompliance"), registerDocument: record("registerDocument"),
  };
  return { api, calls };
}

const ROSTER = {
  members: [
    { id: "m-1", member_no: "A-001", name: "Siti Aminah", status: "Aktif", eligible: true },
    { id: "m-2", member_no: "A-002", name: "Ahmad Faizal", status: "Aktif", eligible: true },
  ],
  attendance: [{ member_id: "m-1", check_in_at: "2026-12-01T09:04:00Z", method: "digital" }],
  quorum: { total_members: 2, present: 1, pct: 50, satisfied: true },
};

(async function main() {
  // Views re-render after every write, so buttons are always looked up fresh
  // from the live container rather than from a stale reference.
  const findBtn = (container, label) =>
    container.findAllByClass("btn").find((b) => b.textContent.includes(label)) || null;
  const argsOf = (calls, name) => calls.filter((c) => c.name === name).map((c) => c.args);

  /* ---- 1. both views register ---- */
  {
    const { view } = harness(stubApi({}).api, { role: "admin" });
    // the view builds its arrays inside the vm realm, so compare values
    assert.deepStrictEqual(Array.from(view.routes), ["agm", "governance"]);
    assert.strictEqual(typeof view.renderAgmHall, "function");
    assert.strictEqual(typeof view.renderGovernanceRegister, "function");
  }

  /* ---- 2. a member with no AGM sees no creation form ---- */
  {
    const { api, calls } = stubApi({ current: () => ({ agm: null, agenda: [], motions: [], resolutions: [] }) });
    const { view, ctx, container } = harness(api, { role: "member" });
    await view.renderAgmHall(container, ctx);
    assert.ok(container.findText("No AGM yet"), "empty state missing");
    assert.strictEqual(container.findById("agmx-agm-title"), null, "member was shown the create-AGM form");
    assert.ok(calls.some((c) => c.name === "current"));
  }

  /* ---- 3. an operator with no AGM can create one; payload keys match the function ---- */
  {
    const { api, calls } = stubApi({ current: () => ({ agm: null }) });
    const { view, ctx, container } = harness(api, { role: "secretary" });
    await view.renderAgmHall(container, ctx);
    const title = container.findById("agmx-agm-title");
    const when = container.findById("agmx-agm-when");
    assert.ok(title && when, "operator create-AGM form missing fields");

    const submit = findBtn(container, "Create AGM");
    assert.ok(submit, "operator create-AGM form has no submit button");
    await submit.click();
    assert.ok(!calls.some((c) => c.name === "createAgm"), "created an AGM with an empty title");
    assert.ok(submit.disabled === false, "submit stayed locked after validation");

    title.value = "AGM Ke-46";
    when.value = "2027-03-01T09:00";
    container.findById("agmx-agm-edition").value = "46";
    container.findById("agmx-agm-fiscal").value = "2027";
    container.findById("agmx-agm-quorum").value = "25";
    container.findById("agmx-agm-notice").value = "21";
    await submit.click();
    const created = calls.find((c) => c.name === "createAgm");
    assert.ok(created, "createAgm never called");
    assert.deepStrictEqual(Object.keys(created.args[0]).sort(),
      ["edition", "fiscalYear", "mode", "noticeDays", "quorumPct", "scheduledAt", "title", "venue"],
      "payload keys drifted from the Edge Function contract");
    assert.strictEqual(created.args[0].edition, 46);
    assert.ok(created.args[0].scheduledAt.endsWith("Z"), "scheduledAt must serialize as UTC");
    assert.strictEqual(ctx.reloadCalls, 1, "view should reload after creating an AGM");
  }

  /* ---- 4. a live meeting: quorum, agenda, motions and resolutions render ---- */
  {
    const motions = [
      { id: "mo-1", code: "M-001", title: "Luluskan penyata kewangan", type: "khas", status: "sedang diundi", proposer: { id: "m-1", name: "Siti Aminah", member_no: "A-001" }, seconder: { id: "m-2", name: "Ahmad Faizal", member_no: "A-002" } },
      { id: "mo-2", code: "M-002", title: "Bahagikan dividen 5%", type: "biasa", status: "draf", proposer: null, seconder: null },
    ];
    const { api, calls } = stubApi({
      current: () => ({ agm: AGM_LIVE, agenda: [{ code: "AG-04", title: "Penyata Kewangan", type: "financial", duration_min: 25, status: "menunggu" }], motions, resolutions: [{ id: "r-1", title: "M-001", passed: true, votes_ya: 12, votes_tidak: 3, votes_kecuali: 1, minuted_at: "2026-12-01T10:00:00Z" }] }),
      roster: () => ROSTER,
    });
    const { view, ctx, container } = harness(api, { role: "member" });
    await view.renderAgmHall(container, ctx);

    assert.ok(container.findText("50.0%"), "quorum percentage not rendered");
    assert.ok(container.findText("Siti Aminah"), "proposer name not rendered");
    assert.strictEqual(container.findAllByClass("agmx-gov-motion").length, 2, "motion blocks missing");
    assert.ok(container.findText("Penyata Kewangan"), "agenda not rendered");
    assert.ok(container.findText("Passed"), "resolution result not rendered");
    const cells = container.all().filter((n) => n.tagName === "TD").map((n) => n.textContent.trim());
    assert.ok(cells.includes("12") && cells.includes("3"), "resolution tally not rendered");

    const voteButtons = container.findAllByClass("btn").filter((b) => ["Ya", "Tidak", "Kecuali"].includes(b.textContent));
    assert.strictEqual(voteButtons.length, 3, "member should see exactly one ballot per votable motion");
    assert.ok(!findBtn(container, "Open voting"), "member was given the operator's open-voting control");
    assert.ok(!findBtn(container, "Record resolution"), "member was given the operator's resolution control");
    assert.strictEqual(container.findById("agmx-motion-title"), null, "member was given the motion form");

    await voteButtons[0].click();
    assert.deepStrictEqual(argsOf(calls, "vote"), [["mo-1", "ya"]]);
    assert.ok(voteButtons[0].disabled, "ballot stayed live after voting");
    assert.ok(voteButtons[1].disabled && voteButtons[2].disabled, "ballot siblings stayed live");
    assert.ok(container.findText("Your vote has been recorded"), "no confirmation shown after voting");
  }

  /* ---- 5. operator controls follow motion state; nothing silently no-ops ---- */
  {
    const { api, calls } = stubApi({
      current: () => ({ agm: AGM_LIVE, agenda: [], motions: [{ id: "mo-2", code: "M-002", title: "Usul draf", type: "biasa", status: "draf" }], resolutions: [] }),
      roster: () => ROSTER,
    });
    const { view, ctx, container } = harness(api, { role: "admin" });
    await view.renderAgmHall(container, ctx);

    assert.ok(findBtn(container, "Open voting"), "operator lost the open-voting control");
    assert.ok(findBtn(container, "Close AGM"), "operator lost the close control");
    assert.ok(!findBtn(container, "Start AGM"), "start shown on a live AGM");
    assert.ok(!container.findAllByClass("btn").some((b) => b.textContent === "Ya"), "a draf motion offered a ballot");

    await findBtn(container, "Open voting").click();
    assert.deepStrictEqual(argsOf(calls, "openVoting"), [["mo-2"]]);
    assert.strictEqual(calls.filter((c) => c.name === "current").length, 2, "view did not re-read after mutating");

    const motionTitle = container.findById("agmx-motion-title");
    assert.ok(motionTitle, "motion form missing");
    container.findById("agmx-motion-proposer").value = "m-1";
    container.findById("agmx-motion-seconder").value = "m-2";
    await findBtn(container, "Create motion").click();
    assert.ok(!calls.some((c) => c.name === "createMotion"), "empty motion title was submitted");
    motionTitle.value = "Usul baru <img src=x onerror=alert(1)>";
    await findBtn(container, "Create motion").click();
    const sent = calls.find((c) => c.name === "createMotion").args[0];
    assert.strictEqual(sent.title, "Usul baru <img src=x onerror=alert(1)>", "form value was mangled");
    assert.deepStrictEqual(Object.keys(sent).sort(), ["agmId", "proposerId", "seconderId", "title", "type"]);
  }

  /* ---- 6. a rejected write names the operator's next move, and the server's
          own words go to the console instead of the minutes ---- */
  {
    const { api } = stubApi({
      current: () => ({ agm: AGM_LIVE, agenda: [], motions: [{ id: "mo-1", code: "M-001", title: "Usul", type: "biasa", status: "sedang diundi" }], resolutions: [] }),
      roster: () => ROSTER,
      vote: () => { throw new Error("Vote already cast"); },
    });
    const { view, ctx, container, logs } = harness(api, { role: "member" });
    await view.renderAgmHall(container, ctx);
    const yes = container.findAllByClass("btn").find((b) => b.textContent === "Ya");
    await yes.click();
    const notice = container.findByClass("agmx-gov-notice");
    assert.ok(notice, "no error notice rendered");
    assert.ok(notice.className.includes("is-error"), "error notice is not styled as an error");
    assert.strictEqual(notice.textContent,
      "Could not complete this action. The server response is in the browser console.");
    assert.ok(logs.some((line) => line.includes("Vote already cast")),
      "the server response was dropped instead of logged");
    assert.strictEqual(notice.getAttribute("role"), "alert");
    assert.strictEqual(yes.disabled, false, "button stayed disabled after a rejected vote");
  }

  /* ---- 7. planned AGM: start, self check-in, operator check-in ---- */
  {
    const { api, calls } = stubApi({ current: () => ({ agm: AGM_PLANNED, agenda: [], motions: [], resolutions: [] }), roster: () => ROSTER });
    const { view, ctx, container } = harness(api, { role: "admin" });
    await view.renderAgmHall(container, ctx);
    assert.ok(findBtn(container, "Start AGM"), "start control missing");
    assert.ok(!container.findText("Check me in"), "attendance open before the meeting starts");
    await findBtn(container, "Start AGM").click();
    assert.deepStrictEqual(argsOf(calls, "startAgm"), [["agm-1"]]);

    // now live: check-in paths
    const { api: api2, calls: calls2 } = stubApi({ current: () => ({ agm: AGM_LIVE, agenda: [], motions: [], resolutions: [] }), roster: () => ROSTER });
    const member = harness(api2, { role: "member" });
    await member.view.renderAgmHall(member.container, member.ctx);
    await findBtn(member.container, "Check me in").click();
    assert.deepStrictEqual(argsOf(calls2, "checkIn"), [["agm-1", null, "digital"]]);
    assert.strictEqual(member.container.findById("agmx-checkin-member"), null, "member got the operator check-in picker");

    const operator = harness(api2, { role: "admin" });
    await operator.view.renderAgmHall(operator.container, operator.ctx);
    operator.container.findById("agmx-checkin-member").value = "m-2";
    await findBtn(operator.container, "Check in a member").click();
    const inbound = calls2.filter((c) => c.name === "checkIn").map((c) => c.args);
    assert.ok(inbound.some((a) => a[1] === "m-2" && a[2] === "operator"), "operator check-in payload wrong");
  }

  /* ---- 8. compliance & audit register ---- */
  {
    const { api, calls } = stubApi({
      current: () => ({ agm: AGM_LIVE, agenda: [], motions: [], resolutions: [] }),
      actions: () => ({ actions: [{ id: "a-1", title: "Terbitkan minit", due_date: "2026-12-15", status: "terbuka", agm_id: "agm-1", pic: { name: "Siti Aminah", member_no: "A-001" } }] }),
      documents: () => ({ documents: [{ id: "d-1", category: "minutes", filename: "agm-minutes-fy2026.pdf", mime: "application/pdf", size_bytes: 204800, sha256: "9f2c1a0b", created_at: "2026-12-01T11:00:00Z" }] }),
      compliance: () => ({ checks: [{ id: "c-1", rule_id: "rule-1", rule: { code: "gp14_quorum", act: "GP 14" }, result: "lulus", details: { pct: 66.7 }, checked_at: "2026-12-01T11:30:00Z" } ], findings: [{ id: "f-1", severity: "warning", message: "Usul tanpa penyokong", status: "terbuka" }] }),
      audit: () => ({ events: [{ id: "e-1", action: "agm.started", entity_type: "agm", entity_id: "agm-1", actor_name: "Penguji", hash: "abcdef1234567890", prev_hash: "0".repeat(64), occurred_at: "2026-12-01T09:00:00Z" }] }),
    });
    const { view, ctx, container } = harness(api, { role: "admin" });
    await view.renderGovernanceRegister(container, ctx);
    assert.ok(container.findText("gp14_quorum"), "compliance rule not rendered");
    assert.ok(container.findText("Usul tanpa penyokong"), "open finding not rendered");
    assert.ok(container.findText("agm-minutes-fy2026.pdf"), "document vault not rendered");
    assert.ok(container.findText("200 KB"), "document size not rendered");
    assert.ok(container.findText("abcdef1234567890".slice(0, 12)), "audit hash prefix not rendered");
    assert.ok(container.findText("Prev"), "audit chain column missing");
    assert.ok(findBtn(container, "Run compliance checks"), "operator lost the compliance trigger");

    await findBtn(container, "Run compliance checks").click();
    assert.deepStrictEqual(argsOf(calls, "runCompliance"), [["agm-1"]]);

    const docFilename = container.findById("agmx-doc-filename");
    const docPath = container.findById("agmx-doc-path");
    docFilename.value = "notis-agm.pdf";
    docPath.value = "vault/notis-agm.pdf";
    await findBtn(container, "Register document").click();
    const doc = calls.find((c) => c.name === "registerDocument").args[0];
    assert.deepStrictEqual(Object.keys(doc).sort(), ["agmId", "category", "filename", "mime", "sha256", "storagePath"]);
    assert.strictEqual(doc.storagePath, "vault/notis-agm.pdf");
    assert.strictEqual(doc.agmId, "agm-1");

    const memberView = harness(api, { role: "member" });
    await memberView.view.renderGovernanceRegister(memberView.container, memberView.ctx);
    assert.ok(!findBtn(memberView.container, "Register document"),
      "member was offered the document registration form");
  }

  /* ---- 9. demo workspaces never reach the API ---- */
  {
    const { api, calls } = stubApi({});
    const { view, ctx, container } = harness(api, { role: "admin", source: "demo" });
    await view.renderAgmHall(container, ctx);
    await view.renderGovernanceRegister(container, ctx);
    assert.strictEqual(calls.length, 0, "demo mode called the live governance API");
    assert.ok(container.findByClass("agmx-demo-banner"), "no demo banner rendered");
  }

  /* ---- 10. language switch renders Malay labels ---- */
  {
    const { api } = stubApi({ current: () => ({ agm: null }) });
    const { view, ctx, container } = harness(api, { role: "member", search: "?lang=ms" });
    await view.renderAgmHall(container, ctx);
    assert.ok(container.findText("Dewan AGM"), "title not translated");
    assert.ok(container.findText("Belum ada AGM"), "empty state not translated");
  }

  /* ---- 11. a refused roster read is drawn as a refusal, never as an empty hall ---- */
  {
    const { api } = stubApi({
      current: () => ({ agm: AGM_LIVE, agenda: [], motions: [], resolutions: [] }),
      roster: () => { throw new Error("relation \"members\" is not permitted by row-level security (42501)"); },
    });
    const { view, ctx, container, logs } = harness(api, { role: "admin" });
    await view.renderAgmHall(container, ctx);

    assert.ok(!container.findText("0 present / 0"),
      "a refused roster read was rendered as a counted quorum of zero");
    assert.ok(container.findText("This section could not be read. It is not empty — the server did not answer."),
      "the quorum card did not say the read failed");
    assert.ok(container.findText("Attendance unknown"), "the quorum subtitle still claims a headcount");
    assert.ok(container.findText("Operator check-in is unavailable because the member roster could not be read."),
      "the vanished operator picker was left unexplained");
    assert.ok(findBtn(container, "Retry"), "the failed section offers no retry");
    assert.ok(findBtn(container, "Check me in"),
      "self check-in was removed although it does not need the roster");
    const operatorCheckIn = findBtn(container, "Check in a member");
    assert.ok(operatorCheckIn && operatorCheckIn.disabled,
      "the operator picker was hidden rather than shown disabled");
    assert.ok(container.findByClass("agmx-gov-error-detail"),
      "the server response is not available for whoever must fix it");
    assert.ok(logs.some((line) => line.includes("42501")), "the refusal was not logged");
    assert.ok(!container.findByClass("agmx-gov-quorum-summary"),
      "a headcount summary was drawn from a read that never answered");
  }

  /* ---- 12. a refused register read is not "None recorded yet" ---- */
  {
    const failing = (message) => () => { throw new Error(message); };
    const { api } = stubApi({
      current: () => ({ agm: AGM_LIVE }),
      actions: failing("actions_read denied"),
      compliance: failing("compliance_read denied"),
      audit: failing("audit_read denied"),
      documents: failing("documents_read denied"),
    });
    const { view, ctx, container } = harness(api, { role: "admin" });
    await view.renderGovernanceRegister(container, ctx);

    const failures = container.findAllByClass("agmx-gov-notice").filter((n) => n.className.includes("is-error"));
    assert.ok(failures.length >= 4,
      `expected a failure notice per unreadable section, saw ${failures.length}`);
    assert.ok(!container.findText("None recorded yet"),
      "a refused read was reported to the minutes as an empty register");
    // Writing does not depend on having read the old rows, so the forms stay.
    assert.ok(findBtn(container, "New action"), "the action form disappeared with the action list");
    assert.ok(container.findById("agmx-doc-filename"), "the document form disappeared with the document list");
  }

  /* ---- 13. a write that lands is never reported as a failure ---- */
  {
    let documentsReads = 0;
    const { api, calls } = stubApi({
      current: () => ({ agm: AGM_LIVE }),
      documents: () => {
        documentsReads += 1;
        if (documentsReads === 1) return { documents: [] };
        return { documents: [{ id: "d-1", category: "minutes", filename: "notis.pdf", mime: "application/pdf", size_bytes: 1024, sha256: "ab", created_at: "2026-12-01T11:00:00Z" }] };
      },
      registerDocument: () => ({ ok: true }),
    });
    const { view, ctx, container } = harness(api, { role: "admin" });
    await view.renderGovernanceRegister(container, ctx);
    container.findById("agmx-doc-filename").value = "notis.pdf";
    container.findById("agmx-doc-path").value = "vault/notis.pdf";
    await findBtn(container, "Register document").click();
    assert.strictEqual(calls.filter((c) => c.name === "registerDocument").length, 1,
      "the registration never reached the server");
    const statuses = container.findAllByClass("agmx-gov-status");
    assert.ok(!statuses.some((s) => s.textContent.includes("Could not save")),
      "a registered document was reported as a failed save");
  }

  /* ---- 14. the failure copy is Malay in a Malay meeting ---- */
  {
    const { api } = stubApi({
      current: () => ({ agm: AGM_LIVE, agenda: [], motions: [], resolutions: [] }),
      roster: () => { throw new Error("permission denied for table members"); },
    });
    const { view, ctx, container } = harness(api, { role: "admin", search: "?lang=ms" });
    await view.renderAgmHall(container, ctx);
    assert.ok(container.findText("Bahagian ini tidak dapat dibaca"), "the failure notice stayed English");
    assert.ok(container.findText("Kehadiran tidak diketahui"), "the quorum subtitle stayed English");
    assert.ok(container.findText("Cuba semula"), "the retry control stayed English");
    assert.ok(!container.findText("This section could not be read"), "untranslated failure copy leaked into the hall");
  }

  /* ---- 15. a rejected form write keeps Postgres's sentences out of the room ---- */
  {
    const { api } = stubApi({
      current: () => ({ agm: AGM_LIVE, agenda: [], motions: [], resolutions: [] }),
      roster: () => ROSTER,
      createMotion: () => { throw new Error('new row violates row-level security policy for table "motions"'); },
    });
    const { view, ctx, container, logs } = harness(api, { role: "admin" });
    await view.renderAgmHall(container, ctx);
    container.findById("agmx-motion-title").value = "Usul dividen";
    await findBtn(container, "Create motion").click();
    const status = container.findByClass("agmx-gov-status");
    assert.ok(status, "the motion form has no status line");
    assert.strictEqual(status.textContent,
      "Could not save. The server response is in the browser console.");
    assert.ok(!status.textContent.includes("row-level security"),
      "raw policy text was surfaced to the secretary");
    assert.ok(logs.some((line) => line.includes("row-level security")), "the refusal was not logged");
  }

  console.log("governance-ui view harness: all assertions passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
