/* ============================================================
   AGMX — evidence-ui.js view harness
   ------------------------------------------------------------
   Credential-free, offline. Runs the real evidence-ui.js against a
   minimal DOM stub and a stubbed governance API, asserting that:
     * role gates in the view match the Edge Function's contract,
     * register / package / incident payloads use the field names
       the function reads,
     * every rendered value goes out as text, never as HTML,
     * a refused evidence read degrades to an empty register instead
       of fabricating rows,
     * demo workspaces are not part of this view (no demo branch here).
   Usage: node tools/test_evidence_ui.js
   ============================================================ */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "evidence-ui.js"), "utf8");

const { El, makeDocument } = require("./dom_stub.js");

function harness(api, options) {
  const document = makeDocument();
  const container = new El("div");
  container.className = "agmx-shell-content";
  const store = new Map(Object.entries(options.localStorage || {}));
  const logs = [];
  const sandboxConsole = { error: (...parts) => logs.push(parts.join(" ")), log: () => {}, warn: () => {} };
  const window = {
    location: { search: options.search || "?lang=en", href: "https://app.test/app.html", origin: "https://app.test" },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    document,
    console: sandboxConsole,
    AGMX_EVIDENCE: null,
  };
  const context = vm.createContext({ window, document, URLSearchParams, Number, Math, JSON, Date, Set, Object, Array, String, Promise, Error, console: sandboxConsole, navigator: {} });
  vm.runInContext(SOURCE, context, { filename: "evidence-ui.js" });
  const view = window.AGMX_EVIDENCE;
  const ctx = {
    data: { cooperative: { name: "Koperasi Uji" }, currentUser: { name: "Penguji", role: options.role }, agm: options.agm || {} },
    source: options.source || "supabase",
    isAdmin: options.role === "admin" || options.role === "secretary",
    api,
    reload: () => { ctx.reloadCalls++; return Promise.resolve(); },
    reloadCalls: 0,
  };
  return { view, ctx, container, logs };
}

function stubApi(overrides) {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push({ name, args });
    const impl = overrides[name];
    if (!impl) return Promise.resolve({});
    try { return Promise.resolve(impl(...args)); } catch (error) { return Promise.reject(error); }
  };
  const api = {
    evidence: record("evidence"),
    evidencePackages: record("evidencePackages"),
    incidents: record("incidents"),
    registerEvidence: record("registerEvidence"),
    evidencePackage: record("evidencePackage"),
    recordIncident: record("recordIncident"),
  };
  return { api, calls };
}

const AGM = { id: "agm-1", title: "AGM Ke-45", status: "live" };
const NO_AGM = { id: null };

const EVIDENCE_ITEM = {
  id: "ev-1", category: "Minutes", filename: "agm-minutes.pdf",
  storagePath: "/storage/ev/agm-minutes.pdf", sha256: "sha256:4e7af2c1", sizeBytes: 12345,
  created_at: "2026-12-01T11:00:00Z",
};
const PACKAGE_ITEM = {
  id: "pk-1", action: "export", exportPath: "/packages/agm-minutes.zip",
  sha256: "sha256:9f33d8e1", created_at: "2026-12-01T11:05:00Z",
};

(async function main() {
  const findBtn = (container, label) =>
    container.findAllByClass("btn").find((b) => b.textContent.includes(label)) || null;
  const argsOf = (calls, name) => calls.filter((c) => c.name === name).map((c) => c.args);

  /* ---- 1. the view registers its route ---- */
  {
    const { view } = harness(stubApi({}).api, { role: "member", agm: AGM });
    assert.deepStrictEqual(Array.from(view.routes), ["evidence"]);
    assert.strictEqual(typeof view.renderEvidence, "function");
  }

  /* ---- 2. no AGM: nobody sees the evidence machinery ---- */
  {
    const { api, calls } = stubApi({});
    const { view, ctx, container } = harness(api, { role: "admin", agm: NO_AGM });
    await view.renderEvidence(container, ctx);
    assert.ok(container.findText("AGM Evidence"), "no-AGM heading missing");
    assert.ok(container.findText("An administrator needs to create the AGM before evidence can be registered."),
      "no-AGM guidance missing");
    assert.strictEqual(container.findById("agmx-ev-category"), null, "register form shown with no AGM");
    assert.strictEqual(container.findById("agmx-inc-desc"), null, "incident form shown with no AGM");
    assert.strictEqual(calls.length, 0, "no AGM means no evidence read");
  }

  /* ---- 3. an operator registers evidence; payload matches the function ---- */
  {
    const { api, calls } = stubApi({ registerEvidence: () => ({ id: "ev-2" }) });
    const { view, ctx, container } = harness(api, { role: "secretary", agm: AGM });
    await view.renderEvidence(container, ctx);

    assert.ok(container.findById("agmx-ev-category"), "register form missing for operator");
    assert.ok(container.findById("agmx-ev-hash"), "register form missing its hash field");
    const save = findBtn(container, "Save");
    assert.ok(save, "register form has no Save button");

    await save.click();
    assert.deepStrictEqual(argsOf(calls, "registerEvidence"), [["agm-1", "", "", "", "application/octet-stream", null, null]],
      "empty form still reaches the function as-is (no client-side gate)");

    // A successful write rerenders: re-query the fresh form and its Save button.
    const category = container.findById("agmx-ev-category");
    const filename = container.findById("agmx-ev-filename");
    const path = container.findById("agmx-ev-path");
    const mime = container.findById("agmx-ev-mime");
    const size = container.findById("agmx-ev-size");
    const hash = container.findById("agmx-ev-hash");
    assert.ok(category && filename && path && mime && size && hash, "form not re-rendered after the write");
    category.value = "Minutes";
    filename.value = "agm-minutes <img src=x onerror=alert(1)>.pdf";
    path.value = "/storage/ev/agm-minutes.pdf";
    mime.value = "application/pdf";
    size.value = "12345";
    hash.value = "sha256:4e7af2c1d0e3f4a5";
    await findBtn(container, "Save").click();
    const registerCalls = calls.filter((c) => c.name === "registerEvidence");
    assert.strictEqual(registerCalls.length, 2, "registerEvidence called the wrong number of times");
    assert.deepStrictEqual(registerCalls[1].args,
      ["agm-1", "Minutes", "agm-minutes <img src=x onerror=alert(1)>.pdf", "/storage/ev/agm-minutes.pdf",
        "application/pdf", 12345, "sha256:4e7af2c1d0e3f4a5"],
      "payload drifted from the Edge Function contract");
    assert.strictEqual(container.all().filter((n) => n.tagName === "IMG").length, 0,
      "markup was turned into elements instead of text");
  }

  /* ---- 4. the evidence list shows Export / Verify to operators only ---- */
  {
    const { api, calls } = stubApi({ evidence: () => [EVIDENCE_ITEM], evidencePackages: () => [PACKAGE_ITEM] });
    const { view, ctx, container } = harness(api, { role: "admin", agm: AGM });
    await view.renderEvidence(container, ctx);

    assert.ok(container.findText("agm-minutes.pdf"), "evidence row not rendered");
    assert.ok(container.findText("12,345"), "size not formatted");
    assert.ok(container.findText("sha256:4e7af2c1"), "hash not rendered");
    assert.ok(container.findText("/packages/agm-minutes.zip"), "package row not rendered");
    assert.ok(findBtn(container, "Export"), "evidence row lost its Export control");
    assert.ok(findBtn(container, "Verify package"), "evidence row lost its Verify control");
    assert.ok(argsOf(calls, "evidence").length > 0, "evidence not read");

    await findBtn(container, "Export").click();
    assert.deepStrictEqual(argsOf(calls, "evidencePackage"),
      [["agm-1", "export", "/storage/ev/agm-minutes.pdf", "sha256:4e7af2c1"]],
      "export payload drifted from the Edge Function contract");

    await findBtn(container, "Verify package").click();
    assert.deepStrictEqual(argsOf(calls, "evidencePackage"),
      [["agm-1", "export", "/storage/ev/agm-minutes.pdf", "sha256:4e7af2c1"],
       ["agm-1", "verify", "/storage/ev/agm-minutes.pdf", "sha256:4e7af2c1"]],
      "verify payload drifted from the Edge Function contract");
  }

  /* ---- 5. a member sees evidence but no operator controls ---- */
  {
    const { api } = stubApi({ evidence: () => [EVIDENCE_ITEM] });
    const { view, ctx, container } = harness(api, { role: "member", agm: AGM });
    await view.renderEvidence(container, ctx);

    assert.ok(container.findText("agm-minutes.pdf"), "member denied the evidence list");
    assert.ok(!findBtn(container, "Export"), "member saw the Export control");
    assert.ok(!findBtn(container, "Verify package"), "member saw the Verify control");
    assert.strictEqual(container.findById("agmx-ev-category"), null, "member saw the register form");
    assert.strictEqual(container.findById("agmx-inc-desc"), null, "member saw the incident form");
    assert.strictEqual(container.findById("agmx-inc-res"), null, "member saw the incident form");
  }

  /* ---- 6. an operator records an incident; refs split on commas ---- */
  {
    const { api, calls } = stubApi({ recordIncident: () => ({ id: "inc-1" }) });
    const { view, ctx, container } = harness(api, { role: "secretary", agm: AGM });
    await view.renderEvidence(container, ctx);

    const actor = container.findById("agmx-inc-actor");
    const desc = container.findById("agmx-inc-desc");
    const refs = container.findById("agmx-inc-refs");
    const res = container.findById("agmx-inc-res");
    assert.ok(actor && desc && refs && res, "incident form missing fields");
    const saveBtns = container.findAllByClass("btn").filter((b) => b.textContent === "Save");
    assert.strictEqual(saveBtns.length, 2, "expected register and incident Save buttons");

    actor.value = "Penguji";
    desc.value = "Sebutan sakit gagal <b>dicoba</b>";
    refs.value = "ev-1, ev-2,   ev-3 ";
    res.value = "Disediakan semula.";
    await saveBtns[1].click();
    const incidentCalls = calls.filter((c) => c.name === "recordIncident");
    assert.strictEqual(incidentCalls.length, 1, "recordIncident called the wrong number of times");
    assert.strictEqual(incidentCalls[0].args[0], "agm-1", "incident recorded for the wrong AGM");
    assert.strictEqual(incidentCalls[0].args[2], "Penguji", "actor not sent");
    assert.strictEqual(incidentCalls[0].args[3], "Sebutan sakit gagal <b>dicoba</b>", "description drifted");
    assert.strictEqual(Array.isArray(incidentCalls[0].args[4]), true, "refs not sent as an array");
    assert.strictEqual(JSON.stringify(incidentCalls[0].args[4]), JSON.stringify(["ev-1", "ev-2", "ev-3"]),
      "refs not split on commas");
    assert.strictEqual(incidentCalls[0].args[5], "Disediakan semula.", "resolution not sent");
    assert.strictEqual(container.all().filter((n) => n.tagName === "IMG").length, 0,
      "markup was turned into elements instead of text");
  }

  /* ---- 7. a rejected write is a refusal, never silence ---- */
  {
    const { api, calls } = stubApi({ registerEvidence: () => { throw new Error("insert violates row-level security (42501)"); } });
    const { view, ctx, container, logs } = harness(api, { role: "admin", agm: AGM });
    await view.renderEvidence(container, ctx);
    await findBtn(container, "Save").click();
    assert.deepStrictEqual(argsOf(calls, "registerEvidence"), [["agm-1", "", "", "", "application/octet-stream", null, null]],
      "registerEvidence not called with the empty form");

    const notice = container.findByClass("agmx-gov-notice");
    assert.ok(notice, "no error notice rendered");
    assert.ok(notice.className.includes("is-error"), "notice is not styled as an error");
    assert.strictEqual(notice.textContent,
      "Could not complete this action. The server response is in the browser console.");
    assert.strictEqual(notice.getAttribute("role"), "alert");
    assert.ok(logs.some((line) => line.includes("42501")), "the refusal was not logged");
    const btn = findBtn(container, "Save");
    assert.ok(btn && !btn.disabled, "button did not recover after rejection");
  }

  /* ---- 8. a refused evidence read degrades to an empty register ---- */
  {
    const { api, calls } = stubApi({ evidence: () => { throw new Error("relation \"evidence\" is not permitted by row-level security (42501)"); } });
    const { view, ctx, container } = harness(api, { role: "admin", agm: AGM });
    await view.renderEvidence(container, ctx);

    assert.ok(container.findText("No evidence yet."), "empty state missing after refused read");
    assert.ok(!container.findText("This section could not be read"),
      "refused read rendered a refusal instead of degrading");
    assert.ok(argsOf(calls, "evidencePackages").length > 0, "evidence packages not read after the evidence read failed");
    assert.ok(argsOf(calls, "incidents").length > 0, "incidents not read after the evidence read failed");
  }

  /* ---- 9. Malay rendering ---- */
  {
    const { api } = stubApi({ evidence: () => [] });
    const { view, ctx, container } = harness(api, { role: "member", agm: AGM, search: "?lang=ms" });
    await view.renderEvidence(container, ctx);
    assert.ok(container.findText("Bukti AGM"), "title not translated");
    assert.ok(container.findText("Vault bukti bagi AGM semasa"), "subtitle not translated");
  }

  console.log("evidence-ui view harness: all assertions passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
