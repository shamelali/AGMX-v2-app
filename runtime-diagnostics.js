/* AGMX runtime diagnostics: opt-in developer controls, safe for production. */
(function (window, document) {
  "use strict";

  const config = window.AGMX_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const enabled = config.devTools === true || params.get("diagnostics") === "1";
  const state = {
    checkedAt: null,
    backend: null,
    error: null,
  };

  function safeUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return "invalid URL";
    }
  }

  function bootstrapState() {
    const value = window.AGMX_BOOTSTRAP || {};
    return {
      status: value.status || "unknown",
      source: value.source || "—",
      route: value.route || "—",
      updatedAt: value.updatedAt || "—",
      error: value.error || "—",
    };
  }

  function snapshot() {
    const api = window.AGMX_API;
    const record = api && api.pb && api.pb.currentUser;
    return {
      browser: navigator.onLine === false ? "offline" : "online",
      secureContext: window.isSecureContext ? "yes" : "no",
      origin: window.location.origin,
      backendMode: config.backend || "pocketbase-bridge",
      pocketbaseUrl: safeUrl((api && api.config && api.config.url) || "http://127.0.0.1:8090"),
      auth: api && typeof api.isAuthenticated === "function" && api.isAuthenticated()
        ? `authenticated${record && record.id ? ` · ${record.id}` : ""}`
        : "signed out",
      serviceWorker: "serviceWorker" in navigator
        ? (navigator.serviceWorker.controller ? "controlled" : "registered/no controller")
        : "unsupported",
      bootstrap: bootstrapState(),
      backend: state.backend,
      error: state.error,
    };
  }

  function value(value) {
    if (value === null || value === undefined || value === "") return "—";
    return String(value);
  }

  function addRow(container, label, text, status) {
    const row = document.createElement("div");
    row.className = "agmx-runtime-row";
    const name = document.createElement("span");
    name.className = "agmx-runtime-label";
    name.textContent = label;
    const result = document.createElement("span");
    result.className = `agmx-runtime-value${status ? ` is-${status}` : ""}`;
    result.textContent = value(text);
    row.append(name, result);
    container.appendChild(row);
  }

  function setButton(button, text, disabled) {
    button.textContent = text;
    button.disabled = Boolean(disabled);
  }

  function render() {
    if (!enabled) return;
    const panel = document.getElementById("agmx-runtime-panel");
    const body = document.getElementById("agmx-runtime-body");
    if (!panel || !body) return;
    const data = snapshot();
    body.replaceChildren();

    const bootstrap = data.bootstrap || {};
    addRow(body, "Browser", data.browser, data.browser === "online" ? "ok" : "bad");
    addRow(body, "Backend mode", data.backendMode);
    addRow(body, "Backend health", data.backend ? `${data.backend.httpStatus || "—"} · ${data.backend.ok ? "ready" : "degraded"}` : "not checked", data.backend && data.backend.ok ? "ok" : data.backend ? "bad" : "warn");
    addRow(body, "PocketBase bridge", `${data.pocketbaseUrl} · ${data.auth}`);
    addRow(body, "Bootstrap", `${bootstrap.status} · ${bootstrap.source}`);
    addRow(body, "Route", bootstrap.route);
    addRow(body, "Service worker", data.serviceWorker);
    addRow(body, "Last check", data.backend ? `${data.backend.latencyMs}ms · ${data.backend.checkedAt}` : "—");
    if (data.backend && data.backend.error) addRow(body, "Health detail", data.backend.error, "bad");
    if (data.error) addRow(body, "Runtime error", data.error, "bad");

    const checked = document.getElementById("agmx-runtime-checked");
    if (checked) checked.textContent = state.checkedAt ? `Checked ${state.checkedAt}` : "Not checked";
  }

  async function checkBackend() {
    const checkButton = document.getElementById("agmx-runtime-check");
    setButton(checkButton, "Checking…", true);
    state.error = null;
    const started = performance.now();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || 10000) : null;
    try {
      const response = await fetch(config.healthUrl || "/api/health", {
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      });
      let payload = null;
      try { payload = await response.json(); } catch (_) { /* non-JSON response */ }
      state.backend = {
        ok: response.ok && (!payload || payload.ok !== false),
        httpStatus: response.status,
        latencyMs: Math.round(performance.now() - started),
        checkedAt: new Date().toISOString(),
        error: payload && payload.checks && payload.checks.database && payload.checks.database.error
          ? payload.checks.database.error
          : (payload && payload.error) || null,
      };
    } catch (error) {
      state.backend = {
        ok: false,
        httpStatus: 0,
        latencyMs: Math.round(performance.now() - started),
        checkedAt: new Date().toISOString(),
        error: error && error.name === "AbortError" ? "Health check timed out" : "Health endpoint unreachable",
      };
    } finally {
      if (timer) clearTimeout(timer);
      state.checkedAt = new Date().toISOString();
      setButton(checkButton, "Check now", false);
      render();
    }
  }

  async function clearSession() {
    const api = window.AGMX_API;
    if (api && typeof api.logout === "function") {
      try { await api.logout(); } catch (_) { /* local cleanup below */ }
    }
    try {
      localStorage.removeItem("pb_token");
      localStorage.removeItem("pb_auth");
    } catch (_) { /* storage can be disabled */ }
    window.location.reload();
  }

  function createPanel() {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "agmx-runtime-trigger";
    trigger.textContent = "Runtime";
    trigger.setAttribute("aria-controls", "agmx-runtime-panel");
    trigger.setAttribute("aria-expanded", "false");

    const panel = document.createElement("aside");
    panel.id = "agmx-runtime-panel";
    panel.className = "agmx-runtime-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "AGMX runtime diagnostics");
    panel.innerHTML = `
      <div class="agmx-runtime-heading">
        <div><strong>Runtime diagnostics</strong><span id="agmx-runtime-checked">Not checked</span></div>
        <button type="button" class="agmx-runtime-close" aria-label="Close diagnostics">×</button>
      </div>
      <div id="agmx-runtime-body" class="agmx-runtime-body" aria-live="polite"></div>
      <div class="agmx-runtime-actions">
        <button type="button" id="agmx-runtime-check" class="agmx-runtime-action is-primary">Check now</button>
        <button type="button" id="agmx-runtime-clear" class="agmx-runtime-action">Clear session</button>
      </div>`;
    document.body.append(trigger, panel);

    const close = panel.querySelector(".agmx-runtime-close");
    const toggle = (open) => {
      panel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        render();
        void checkBackend();
      }
    };
    trigger.addEventListener("click", () => toggle(panel.hidden));
    close.addEventListener("click", () => toggle(false));
    panel.querySelector("#agmx-runtime-check").addEventListener("click", () => void checkBackend());
    panel.querySelector("#agmx-runtime-clear").addEventListener("click", () => void clearSession());
    render();
  }

  window.AGMX_DIAGNOSTICS = {
    enabled,
    snapshot,
    checkBackend,
    open() {
      const trigger = document.querySelector(".agmx-runtime-trigger");
      if (trigger) trigger.click();
    },
  };

  if (!enabled) return;
  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  window.addEventListener("agmx:runtime-status", render);
  document.addEventListener("DOMContentLoaded", () => {
    createPanel();
    void checkBackend();
  });
})(window, document);
