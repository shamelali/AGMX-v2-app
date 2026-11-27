/* ============================================================
   AGMX — minutes-ui.js view harness
   ------------------------------------------------------------
   Credential-free, offline. Runs the real minutes-ui.js against a
   minimal DOM stub and a stubbed governance API, asserting that:
     * role gates in the view match the Edge Function's contract,
     * payloads are sent with the field names the function reads,
     * every rendered value goes out as text, never as HTML,
     * a refused minutes read is drawn as a refusal, never as silence,
     * demo workspaces are not part of this view (no demo branch here).
   Usage: node tools/test_minutes_ui.js
   ============================================================ */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "minutes-ui.js"), "utf8");

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
    AGMX_MINUTES: null,
  };
  const context = vm.createContext({ window, document, URLSearchParams, Number, Math, JSON, Date, Set, Object, Array, String, Promise, Error, console: sandboxConsole, navigator: {} });
  vm.runInContext(SOURCE, context, { filename: "minutes-ui.js" });
  const view = window.AGMX_MINUTES;
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
    minutes: record("minutes"),
    createMinutes: record("createMinutes"),
    editMinutes: record("editMinutes"),
    submitReviewMinutes: record("submitReviewMinutes"),
    verifyMinutes: record("verifyMinutes"),
    approveMinutes: record("approveMinutes"),
    lockMinutes: record("lockMinutes"),
  };
  return { api, calls };
}

const AGM = { id: "agm-1", title: "AGM Ke-45", status: "live" };
const NO_AGM = { id: null };

const MINUTE = { id: "mn-1", title: "Minit pertama", content: "Isi minit pembukaan", status: "draft", created_at: "2026-12-01T11:00:00Z" };

(async function main() {
  const findBtn = (container, label) =>
    container.findAllByClass("btn").find((b) => b.textContent.includes(label)) || null;
  const argsOf = (calls, name) => calls.filter((c) => c.name === name).map((c) => c.args);

  /* ---- 1. the view registers its route ---- */
  {
    const { view } = harness(stubApi({}).api, { role: "member", agm: AGM });
    assert.deepStrictEqual(Array.from(view.routes), ["minutes"]);
    assert.strictEqual(typeof view.renderMinutes, "function");
  }

  /* ---- 2. no AGM: nobody sees the minutes machinery ---- */
  {
    const { api, calls } = stubApi({});
    const { view, ctx, container } = harness(api, { role: "admin", agm: NO_AGM });
    await view.renderMinutes(container, ctx);
    assert.ok(container.findText("AGM Minutes"), "no-AGM heading missing");
    assert.ok(container.findText("An administrator needs to create the AGM before minutes can be written."),
      "no-AGM guidance missing");
    assert.strictEqual(container.findById("agmx-minutes-title"), null, "create form shown with no AGM");
    assert.strictEqual(calls.length, 0, "no AGM means no minutes read");
  }

  /* ---- 3. operator creates a minute; payload keys match the function ---- */
  {
    const { api, calls } = stubApi({ minutes: () => [], createMinutes: () => ({ id: "mn-2" }) });
    const { view, ctx, container } = harness(api, { role: "secretary", agm: AGM });
    await view.renderMinutes(container, ctx);

    const title = container.findById("agmx-minutes-title");
    const content = container.findById("agmx-minutes-content");
    assert.ok(title && content, "operator create-minutes form missing fields");
    const save = findBtn(container, "Save");
    assert.ok(save, "create form has no Save button");

    await save.click();
    assert.deepStrictEqual(argsOf(calls, "createMinutes"), [["agm-1", "", ""]],
      "empty form still reaches the function as-is (no client-side gate)");

    // A successful write rerenders: re-query the fresh form and its Save button.
    const title2 = container.findById("agmx-minutes-title");
    const content2 = container.findById("agmx-minutes-content");
    assert.ok(title2 && content2, "form not re-rendered after the write");
    title2.value = "Minit pembukaan";
    content2.value = "Tanda tangan <img src=x onerror=alert(1)>";
    await findBtn(container, "Save").click();
    const createdCalls = calls.filter((c) => c.name === "createMinutes");
    assert.strictEqual(createdCalls.length, 2, "createMinutes called the wrong number of times");
    assert.deepStrictEqual(createdCalls[1].args, ["agm-1", "Minit pembukaan", "Tanda tangan <img src=x onerror=alert(1)>"],
      "payload drifted from the Edge Function contract");
    assert.strictEqual(container.all().filter((n) => n.tagName === "IMG").length, 0,
      "markup was turned into elements instead of text");
    assert.strictEqual(argsOf(calls, "minutes")[0][0], "agm-1", "minutes read for the wrong AGM");
  }

  /* ---- 4. minutes list: draft minute shows operator workflow buttons ---- */
  {
    const { api, calls } = stubApi({ minutes: () => [MINUTE] });
    const { view, ctx, container } = harness(api, { role: "admin", agm: AGM });
    await view.renderMinutes(container, ctx);

    assert.ok(container.findText("Minit pertama"), "minute title not rendered");
    assert.ok(container.findText("DRAFT"), "status not rendered");
    assert.ok(container.findText("Created at"), "created-at row missing");
    assert.ok(findBtn(container, "Edit"), "draft minute lost its Edit control");
    assert.ok(findBtn(container, "Submit for review"), "draft minute lost its submit control");
    assert.ok(argsOf(calls, "minutes").some((a) => a[0] === "agm-1"), "minutes not read for this AGM");
  }

  /* ---- 5. a member sees minutes but no operator controls ---- */
  {
    const { api } = stubApi({ minutes: () => [MINUTE] });
    const { view, ctx, container } = harness(api, { role: "member", agm: AGM });
    await view.renderMinutes(container, ctx);

    assert.ok(container.findText("Minit pertama"), "member denied the minutes list");
    assert.ok(!findBtn(container, "Edit"), "member saw the Edit control");
    assert.ok(!findBtn(container, "Submit for review"), "member saw the submit control");
    assert.ok(!findBtn(container, "Verify"), "member saw the verify control");
    assert.ok(!findBtn(container, "Approve"), "member saw the approve control");
    assert.ok(!findBtn(container, "Lock"), "member saw the lock control");
    assert.strictEqual(container.findById("agmx-minutes-title"), null, "member saw the create form");
  }

  /* ---- 6. workflow transitions follow status ---- */
  {
    const submit = async (status, fnName, label) => {
      const { api, calls } = stubApi({ minutes: () => [{ ...MINUTE, status }] });
      const { view, ctx, container } = harness(api, { role: "admin", agm: AGM });
      await view.renderMinutes(container, ctx);
      return { view, ctx, container, api, calls, run: () => findBtn(container, label).click() };
    };

    const s1 = await submit("draft", "submitReviewMinutes", "Submit for review");
    await s1.run();
    assert.deepStrictEqual(argsOf(s1.calls, "submitReviewMinutes"), [["mn-1"]]);

    const s2 = await submit("review", "verifyMinutes", "Verify");
    await s2.run();
    assert.deepStrictEqual(argsOf(s2.calls, "verifyMinutes"), [["mn-1"]]);

    const s3 = await submit("verified", "approveMinutes", "Approve");
    await s3.run();
    assert.deepStrictEqual(argsOf(s3.calls, "approveMinutes"), [["mn-1"]]);

    const s4 = await submit("approved", "lockMinutes", "Lock");
    await s4.run();
    assert.deepStrictEqual(argsOf(s4.calls, "lockMinutes"), [["mn-1"]]);

  }

  /* ---- 7. Edit flow: card becomes the form, then the edit lands ---- */
  {
    const { api, calls } = stubApi({ minutes: () => [MINUTE], editMinutes: () => ({ ok: true }) });
    const { view, ctx, container } = harness(api, { role: "secretary", agm: AGM });
    await view.renderMinutes(container, ctx);

    await findBtn(container, "Edit").click();
    assert.ok(container.findText("Edit minutes"), "edit form heading missing");
    assert.ok(!findBtn(container, "Edit"), "card still shown after Edit");
    assert.ok(!findBtn(container, "Submit for review"), "card still shown after Edit");
    const textareas = container.all().filter((n) => n.tagName === "TEXTAREA");
    assert.strictEqual(textareas.length, 2, "expected create form and edit form textareas");
    assert.strictEqual(textareas[1].value, "Isi minit pembukaan", "form not pre-filled");

    textareas[1].value = "Isi minit <b>direvisi</b>";
    const saveBtns = container.findAllByClass("btn").filter((b) => b.textContent === "Save");
    assert.strictEqual(saveBtns.length, 2, "expected two Save buttons");
    await saveBtns[1].click();
    assert.deepStrictEqual(argsOf(calls, "editMinutes"), [["mn-1", "Isi minit <b>direvisi</b>"]],
      "edit payload drifted or markup was mangled");
  }

  /* ---- 8. a rejected write is a refusal, never silence ---- */
  {
    const { api } = stubApi({
      minutes: () => [MINUTE],
      submitReviewMinutes: () => { throw new Error("minute is locked"); },
    });
    const { view, ctx, container, logs } = harness(api, { role: "admin", agm: AGM });
    await view.renderMinutes(container, ctx);
    await findBtn(container, "Submit for review").click();

    const notice = container.findByClass("agmx-gov-notice");
    assert.ok(notice, "no error notice rendered");
    assert.ok(notice.className.includes("is-error"), "notice is not styled as an error");
    assert.strictEqual(notice.textContent,
      "Could not complete this action. The server response is in the browser console.");
    assert.strictEqual(notice.getAttribute("role"), "alert");
    assert.ok(logs.some((line) => line.includes("minute is locked")), "the refusal was not logged");
    const btn = findBtn(container, "Submit for review");
    assert.ok(btn && !btn.disabled, "button stayed disabled after rejection");
  }

  /* ---- 9. a refused minutes read is a refusal, not an empty register ---- */
  {
    const { api } = stubApi({ minutes: () => { throw new Error("relation \"minutes\" is not permitted by row-level security (42501)"); } });
    const { view, ctx, container, logs } = harness(api, { role: "admin", agm: AGM });
    await view.renderMinutes(container, ctx);

    assert.ok(container.findText("This section could not be read. It is not empty — the server did not answer."),
      "refusal notice missing");
    assert.ok(!container.findText("No minutes yet."), "refusal rendered as an empty register");
    assert.ok(findBtn(container, "Retry"), "no retry on the failed read");
    assert.ok(logs.some((line) => line.includes("42501")), "refusal not logged");
  }

  /* ---- 10. Malay rendering ---- */
  {
    const { api } = stubApi({ minutes: () => [] });
    const { view, ctx, container } = harness(api, { role: "member", agm: AGM, search: "?lang=ms" });
    await view.renderMinutes(container, ctx);
    assert.ok(container.findText("Minit AGM"), "title not translated");
    assert.ok(container.findText("Minit bagi AGM semasa"), "subtitle not translated");
  }

  console.log("minutes-ui view harness: all assertions passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
