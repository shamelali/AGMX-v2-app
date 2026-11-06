/* ============================================================
   AGMX — Theme bootstrap (dark mode + senior mode + high contrast)
   ------------------------------------------------------------
   Load in <head> so the stored preference is applied before paint.
   Any element with [data-agmx-theme-toggle] becomes a dark-mode
   switch; window.AGMX_THEME exposes get/set/toggle.
   ============================================================ */

(function () {
  "use strict";

  var root = document.documentElement;

  function read(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  // No stored choice means the OS preference wins.
  function resolve() {
    var stored = read("theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function apply(theme) {
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-theme", theme);
  }

  var LABELS = {
    BM: { dark: "Gelap", light: "Cerah" },
    EN: { dark: "Dark", light: "Light" },
  };

  // Same preference order as the rest of the site: ?lang= beats storage.
  function labels() {
    var pref = read("agmx-lang");
    try {
      var q = new URLSearchParams(window.location.search).get("lang");
      if (q === "en" || q === "ms") pref = q;
    } catch (_) { /* storage only */ }
    return pref === "en" ? LABELS.EN : LABELS.BM;
  }

  // The button offers the mode you would switch to, so it stays in sync with
  // every other control on the page after a toggle.
  function sync() {
    var dark = root.getAttribute("data-theme") === "dark";
    var words = labels();
    var target = dark ? words.light : words.dark;
    var buttons = document.querySelectorAll("[data-agmx-theme-toggle]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].textContent = (dark ? "☀️ " : "🌙 ") + target;
      buttons[i].setAttribute("aria-pressed", dark ? "true" : "false");
      buttons[i].setAttribute("aria-label", target);
      buttons[i].setAttribute("title", target);
    }
  }

  function set(theme) {
    apply(theme === "dark" ? "dark" : "light");
    try { localStorage.setItem("theme", root.getAttribute("data-theme")); } catch (_) {}
    sync();
  }

  apply(resolve());
  root.classList.toggle("senior-mode", read("seniorMode") === "true");
  root.classList.toggle("high-contrast", read("highContrast") === "true");

  window.AGMX_THEME = {
    get: function () { return root.getAttribute("data-theme"); },
    set: set,
    toggle: function () { set(root.getAttribute("data-theme") === "dark" ? "light" : "dark"); },
    // Buttons built after page load (the app shell renders once the dashboard
    // data arrives) need a label refresh.
    sync: sync,
  };

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest
      ? event.target.closest("[data-agmx-theme-toggle]")
      : null;
    if (!button) return;
    event.preventDefault();
    window.AGMX_THEME.toggle();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sync);
  } else {
    sync();
  }
})();
