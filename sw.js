// Bumped to v25: theme.js owns theme state (dark mode, senior mode, high
// contrast) and every page loads it in <head>; [data-agmx-theme-toggle]
// buttons switch dark mode, and styles.css keys its dark rules on html.dark
// instead of prefers-color-scheme so the choice is honoured on every page.
//
// Bumped to v24: supabase-client.js no longer aborts module evaluation when
// Supabase is unconfigured (it used to leave window.AGMX_API undefined, so the
// login view threw "Cannot read properties of undefined (reading
// 'loginWithGoogle')"); login.js reports the missing-config and Supabase
// { error } responses instead. SMS OTP login is gone, replaced by
// email + password (signInWithPassword) with an emailed reset link.
//
// Bumped to v23: the PocketBase layer is archived — pocketbase-client.js is
// no longer shipped or precached; Supabase is the only backend client.
//
// Bumped to v9: login.js now accesses AGMX_API lazily (api()) because
// supabase-client.js is a deferred module that loads after login.js.
// Without this, window.AGMX_API was captured as undefined and the login
// view (demo button, OTP, Google auth) never worked.
//
// ANY edit to a file listed in PRECACHE requires a bump here. The fetch
// handler below is cache-first, and the browser only re-installs the worker
// when sw.js itself changes byte-for-byte — so editing a precached file
// without bumping this string leaves every installed client serving the old
// copy indefinitely. tools/check.sh pass 7 enforces this.
//
// Bumped to v8: runtime-diagnostics.js relabelled "Neon health" → "Backend
// health" (the probe reads PocketBase /api/health; "Neon" was a leftover from
// the Supabase era).
//
// Bumped to v7: merges the authenticated bootstrap shell (v6, deployed but
// never committed) with the Sprint 2 money-flow pages (v5). Both sets are
// required — the shell is what populates #app, the money flow is the revenue
// path. config.* is deliberately never precached: it varies per environment,
// and a cached copy would pin a stale Google client ID or PocketBase URL.
// Bumped to v27: password recovery now completes in-app — supabase-client.js
// listens for PASSWORD_RECOVERY and app-bootstrap.js renders the new-password
// form. Without this bump an installed client keeps the old pair and a reset
// link drops the user into the dashboard with no way to set a password.
//
// Bumped to v26: /callback.html added — it is the Supabase redirect target for
// Google sign-in and password reset, and forwards the URL credentials to /app.
// Bumped to v28: index.html is rewritten around verifiable capability statuses
// (data-en attribute i18n, trust centre, stage deliverables, scoped enterprise
// pricing, FAQ) and styles.css gains the components it renders. Both are
// precached, so an installed browser would keep serving the unsubstantiated
// brochure indefinitely without this bump.
// Bumped to v29: styles.css drops the rules left over from the brochure it
// replaced — the fake dashboard preview, the old trust bar, the old feature and
// how-it-works grids. None were referenced by any page or script, and the
// rendered page is pixel-identical, but an installed client would otherwise
// keep fetching the fatter stylesheet.
// Bumped to v30: index.html's share-preview tags pointed at agmx-v2-app.vercel.app,
// a retired deployment still serving the old brochure, so a link pasted into
// WhatsApp or LinkedIn previewed the page the trust centre replaced. The canonical
// link was missing entirely, with three hostnames answering for one product.
// Bumped to v31: four trust-centre rows claimed more than the running system
// does — "BM/EN end to end, including inside the workspace" against a 20-entry
// dictionary that leaves every load and error string English; "34 tables … 36
// policies" against the 47 tables and 44 policies live today; "a chain you can
// verify from the earliest event" against a hash whose timestamp salt is never
// stored and no verification routine published; and a subprocessor list that
// named a host no longer serving this product. index.html is precached, so an
// installed browser had to be forced to re-fetch it or it kept asserting the
// old numbers.
//
// Bumped to v32: index.html pricing subtitle and two plan descriptions removed
// the "founding cooperative price" and "includes Q4 2026 access at no charge"
// phrasing, which implied a scarcity incentive and a benefit that cannot be
// contractually substantiated. index.html is precached.
const CACHE = "agmx-v32";
const PRECACHE = [
  "/",
  "/index.html",
  "/app.html",
  "/theme.js",
  "/app.js",
  "/app-bootstrap.js",
  "/app-shell.css",
  "/runtime-diagnostics.js",
  "/styles.css",
  "/data.js",
  "/assessment.html",
  "/assessment.js",
  "/checkout.html",
  "/checkout.js",
  "/leads.html",
  "/leads.js",
  "/api.js",
  "/supabase-client.js",
  "/login.js",
  "/callback.html",
  "/404.html",
  "/offline.html",
  "/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.url.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match("/offline.html")))
    );
  }
});
