/* ============================================================
   AGMX — app-bootstrap.js failure-state harness
   ------------------------------------------------------------
   Credential-free, offline. Drives the real bootstrap code against a
   stubbed AGMX_API and asserts the two facts stay two screens:

     * signed out            → the login card (and its demo option)
     * signed in, read failed → an error state, never the login card

   The second case used to render the login card with a demo button, which
   invites an authenticated operator to keep working on another
   organization's simulated data. Also asserts a sign-out in another tab
   takes the rendered workspace with it.
   Usage: node tools/test_bootstrap_failure_states.js
   ============================================================ */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { El, makeDocument, makeCustomEvent } = require("./dom_stub.js");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "app-bootstrap.js"), "utf8");

const DASHBOARD = {
  cooperative: { name: "Koperasi Uji", pbId: "org-1", members: 40, status: "Aktif" },
  currentUser: { name: "Penguji", email: "penguji@example.test", role: "admin", memberNo: "A-001" },
  members: [],
  agm: null,
  stats: {},
};

function harness(options) {
  const app = new El("div");
  app.id = "app";
  const logs = [];
  const sandboxConsole = {
    error: (...parts) => logs.push(parts.join(" ")),
    log: () => {},
    warn: () => {},
  };
  const document = makeDocument({ app });
  const CustomEvent = makeCustomEvent();
  const store = new Map([["agmx-lang", options.lang || "en"]]);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  const events = [];

  const api = {
    init: () => Promise.resolve(options.restored !== false),
    isAuthenticated: () => {
      if (options.isAuthenticatedThrows) return Promise.reject(new Error(options.isAuthenticatedThrows));
      return Promise.resolve(!!options.signedIn);
    },
    loadDashboard: () => {
      events.push("loadDashboard");
      if (options.dashboardError) return Promise.reject(new Error(options.dashboardError));
      return Promise.resolve(Object.assign({}, DASHBOARD, options.dashboard || {}));
    },
    logout: () => { events.push("logout"); return options.logoutError ? Promise.reject(new Error(options.logoutError)) : Promise.resolve(); },
    onAuthStateChange: (callback) => {
      api._authCallback = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    loadDistributionPortal: () => Promise.resolve({}),
  };
  if (options.withoutAuthListener) delete api.onAuthStateChange;

  const login = {
    render: (root) => {
      events.push("login-render");
      const demo = new El("button");
      demo.className = "btn btn-ghost";
      demo.textContent = "Continue with the demo workspace";
      const view = new El("div");
      view.className = "agmx-login-view";
      view.replaceChildren(new El("h1"), demo);
      view.firstChild.textContent = "Sign in to AGMX";
      root.replaceChildren(view);
    },
  };

  const window = {
    location: { hash: "#/dashboard", search: "", href: "https://app.test/app.html", origin: "https://app.test" },
    history: { pushState() {}, replaceState() {} },
    localStorage,
    document,
    console: sandboxConsole,
    AGMX_API: api,
    AGMX_LOGIN: login,
    AGMX_GOVERNANCE: null,
    AGMX_THEME: null,
    MC_DATA: null,
    addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); },
    dispatchEvent: (event) => { (windowListeners[event.type] || []).forEach((fn) => fn(event)); return true; },
  };
  const windowListeners = {};

  const context = vm.createContext({
    window, document, localStorage, URLSearchParams, URL, Number, Math, JSON, Date, Set, Map, Object, Array, String,
    Promise, Error, RegExp, Boolean, console: sandboxConsole, CustomEvent, navigator: {},
    setTimeout, clearTimeout,
  });
  vm.runInContext(SOURCE, context, { filename: "app-bootstrap.js" });

  // app-bootstrap waits for DOMContentLoaded before it touches #app.
  document.dispatchEvent({ type: "DOMContentLoaded" });

  const settle = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  };

  return { app, api, logs, events, window, document, settle, windowListeners };
}

(async function main() {
  /* ---- 1. signed out: the login card is the right screen ---- */
  {
    const h = harness({ signedIn: false });
    await h.settle();
    assert.ok(h.app.findByClass("agmx-login-view"), "a signed-out visitor was not shown the login card");
    assert.ok(h.events.includes("login-render"), "the login view was never rendered");
  }

  /* ---- 2. signed in, read refused: never the login card ---- */
  {
    const h = harness({
      signedIn: true,
      dashboardError: 'could not find a profile for authenticated user "user-1"',
    });
    await h.settle();
    assert.ok(!h.app.findByClass("agmx-login-view"),
      "an authenticated member whose read failed was bounced to the login card");
    assert.ok(!h.app.findText("Continue with the demo workspace"),
      "the demo workspace was offered to a signed-in operator");
    assert.ok(h.app.findText("Workspace could not be loaded"), "no failure heading was rendered");
    assert.ok(h.app.findText("Nothing here has been replaced with sample data"),
      "the failure screen does not say what it refused to substitute");
    const retry = h.app.all().find((n) => n.tagName === "BUTTON" && n.textContent === "Retry");
    assert.ok(retry, "the failure screen offers no retry");
    assert.ok(h.app.findByClass("agmx-boot-error-detail"), "the server response is nowhere to be read");
    assert.ok(h.app.findText("could not find a profile"), "the technical detail lost the server response");
    assert.ok(h.logs.some((line) => line.includes("could not find a profile")), "the refusal was not logged");
    assert.strictEqual(h.window.AGMX_BOOTSTRAP.status, "error", "the runtime status hook still claims loading");
  }

  /* ---- 3. the documented "Profile not found" signup reaches the same screen ---- */
  {
    const h = harness({ signedIn: true, dashboardError: "Profile not found" });
    await h.settle();
    assert.ok(h.app.findText("Workspace could not be loaded"),
      "a signup with no profile row was not shown the failure screen");
    assert.ok(h.app.findByClass("agmx-boot-error"), "the failure screen lost its own class");
    assert.ok(!h.app.findByClass("agmx-login-view"), "a signed-in member with no profile was bounced to login");
  }

  /* ---- 4. a workspace that does load keeps its chrome, and a sign-out clears it ---- */
  {
    const h = harness({ signedIn: true });
    await h.settle();
    assert.ok(!h.app.findByClass("agmx-boot-error"), "a successful load drew the failure screen");
    assert.ok(h.app.findByClass("agmx-shell-header"), "the workspace chrome was not rendered");
    assert.strictEqual(typeof h.api._authCallback, "function", "no auth-state listener was registered");

    h.api._authCallback("SIGNED_OUT", null);
    await h.settle();
    assert.ok(h.app.findByClass("agmx-login-view"),
      "a sign-out in another tab left the previous member's workspace on screen");
  }

  /* ---- 5. a failed sign-out does not claim the user left ---- */
  {
    const h = harness({ signedIn: true, logoutError: "network unreachable" });
    await h.settle();
    const signOut = h.app.all().find((n) => n.tagName === "BUTTON" && n.textContent === "Log out");
    assert.ok(signOut, "the shell has no sign-out control");
    await signOut.click();
    await h.settle();
    assert.ok(!h.app.findByClass("agmx-login-view"),
      "a failed logout rendered the login card as if the session had ended");
    assert.ok(h.app.findByClass("agmx-boot-notice"), "the failed logout said nothing");
    assert.ok(h.app.findText("You are still signed in"), "the notice does not say the user is still signed in");
    assert.ok(h.logs.some((line) => line.includes("network unreachable")), "the logout failure was not logged");
  }

  /* ---- 6. the failure screen speaks Malay in a Malay meeting ---- */
  {
    const h = harness({ signedIn: true, dashboardError: "permission denied", lang: "ms" });
    await h.settle();
    assert.ok(h.app.findText("Ruang kerja tidak dapat dimuatkan"), "the failure heading stayed English");
    assert.ok(h.app.findText("Tiada apa-apa di sini digantikan"), "the reassurance stayed English");
    assert.ok(h.app.findText("Butiran teknikal"), "the technical disclosure stayed English");
    assert.ok(!h.app.findText("Workspace could not be loaded"), "untranslated failure copy leaked into the meeting");
  }

  console.log("app-bootstrap failure-state harness: all assertions passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
