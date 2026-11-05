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
//
// Bumped to v34: Sprint 4 Governance OS — the AGM Hall and Compliance & Audit
// views (governance-ui.js) join the precache, and app.html/app-shell.css/
// supabase-client.js/app-bootstrap.js changed with them.
//
// Bumped to v35: styles.css and app-shell.css now carry the glassmorphism they
// have advertised in their header comment since the design system was written —
// translucent chrome over an ambient mesh, with opaque fallbacks for browsers
// without backdrop-filter, prefers-reduced-transparency, senior mode and print.
// Both files are precached, so an installed browser keeps the old flat surfaces
// until this number moves.
//
// Bumped to v36: the fetch handler stopped caching the runtime. It cached every
// same-origin response, cache-first, so /api/config.js — which sets its own
// Cache-Control: no-store, a header the Cache API ignores — was frozen at
// whatever it said the first time a visitor loaded the site. That deployment
// reported demoMode:true, api.js bound the browser-local adapter, and the
// checkout "paid" into localStorage; a later fix could not reach the client
// because the worker kept serving the pinned copy. /api/health has the same
// problem in a worse direction: a 503 is not ok, so it is never stored, and the
// last healthy 200 is served forever after an outage. /api/* is now network-only.
// Pages that are not precached (terms, privacy, the marketing pages) are now
// network-first too — they change without a CACHE bump, which is exactly how
// v31 and v32 got left behind. And no response is ever stored for a .js/.css/.json
// path if the body came back text/html: vercel.json rewrites unmatched paths to
// index.html, so one typo'd asset used to be cached as JavaScript that parses as
// HTML and survives the deploy that fixes it.
// Bumped to v37: price-list.js is precached and shipped — it is now the only
// place a price appears in browser code. The landing page, assessment,
// checkout and api.js each carried their own book of numbers, and none of
// them matched public.plans, which is the table money-flow re-prices a quote
// and a recurring invoice from: the landing page sold a 1,000-member
// cooperative "RM 2,999/year" while the catalog bills RM 9,600. An installed
// client keeping the old copy would keep quoting prices nothing can invoice.
// Bumped to v38: two classes of stale client are dangerous here, so both move.
// (1) checkout.html, leads.html and assessment.html no longer promise payment
// rails this deployment cannot run and no longer offer a PocketBase switch —
// /api/config.js dropped pocketbaseUrl, the FPX/card/Billplz pills that claimed
// instant confirmation are hidden until gateway keys exist, and the lead inbox
// now reports backend status instead of inviting an operator to point the
// workspace at a retired backend. (2) governance-ui.js and app-shell.css change
// how a compliance result is coloured: the status pill used to be green unless
// it was amber, so a FAILED statutory rule was drawn on the same green as a
// pass. An installed copy doing that is an all-clear the meeting record cannot
// support, which is exactly the failure mode that reaches a regulator.
// Bumped to v39: assessment.html and leads.html are precached and both changed.
// (1) The assessment page's demo pipeline card still told a visitor that
// "PocketBase mode is enabled from the Lead Inbox" — a control v38 deleted. The
// sentence now says what happens to a submission (browser storage in demo,
// agm_assessments under a configured Supabase backend), and the four MAP keys
// whose text nodes no longer exist went with it, so the English page cannot mix
// a translated half-sentence with an untranslated fragment. (2) leads.html loaded
// api.js without price-list.js, so RATE_CARD was null and every inbox row fell
// back to the raw plan code and a zero amount — an operator triaging leads saw
// "professional_agm · RM0" for a RM3,500 job. The rate card now loads first.
// Bumped to v40: three precached files moved, all around one recommendation.
// (1) assessment.js no longer computes its own complexity bands. It takes the
// band from price-list.js — money-flow's recommendPlan() verbatim — and then
// lifts it only when the member count exceeds the package's own seeded cap.
// The old copy disagreed with the server at 34/35 and sold a 1,999-member AGM
// on a 500-member package, so an installed client kept quoting a package the
// quote endpoint would not price. (2) price-list.js documents that split, and
// its comment now states the one thing it had claimed but not delivered.
// (3) index.html is the published number: it asserted RLS on "all 50 tables in
// the application schema" while the migrations install 40, so the extra ten
// were hand-made tables in one production database that a fresh deploy of the
// documented bundle does not produce. check.sh §23 now compares every
// table/policy count on the landing page against the generated bundle, and
// §9 runs the assessment boundary harness that had been failing, unwired, with
// no rate card installed.
// Bumped to v41: index.html and app.html now name the host this deployment
// actually answers on. Both are precached, so an installed browser would have
// kept handing out share tags for agmx-project.vercel.app — a retired project
// that still serves 200, with demoMode:true behind it. The same bump carries
// the config route: /config.js rewrote to /api/config.js, and with
// outputDirectory "." the function's own source is published at that path, so
// visitors received "export default" as a classic <script>, never got
// window.AGMX_CONFIG, and ran the entire site against no backend at all.
const CACHE = "agmx-v43";
const PRECACHE = [
  "/",
  "/index.html",
  "/app.html",
  "/theme.js",
  "/app.js",
  "/app-bootstrap.js",
  "/governance-ui.js",
  "/app-shell.css",
  "/runtime-diagnostics.js",
  "/styles.css",
  "/data.js",
  "/price-list.js",
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

const PRECACHED = new Set(PRECACHE);

// vercel.json rewrites anything it does not recognise to index.html, so a
// missing asset answers 200 with an HTML body. Storing that under the asset's
// URL hands the browser a script that parses as markup, and it keeps being
// handed out after the deploy that adds the file.
function mislabelled(pathname, contentType) {
  return String(contentType || "").toLowerCase().includes("text/html")
    && /\.(?:js|mjs|css|json)$/.test(pathname);
}

function fromNetwork(req) {
  return fetch(req).then((res) => {
    const path = new URL(req.url).pathname;
    if (res.ok && !mislabelled(path, res.headers.get("content-type"))) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
}

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
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  // Runtime truth: which backend this build talks to, whether that backend is
  // up, and what a gateway callback reported. Versioned by the server, not by
  // this file, so a cached answer is always the wrong answer.
  if (url.pathname.startsWith("/api/")) return;

  // The app shell is versioned by CACHE: cache-first is correct, and the only
  // way a stale copy is served is an edit without a bump — which check.sh §7
  // fails the commit for.
  if (PRECACHED.has(url.pathname)) {
    e.respondWith(caches.match(req).then((cached) => cached || fromNetwork(req)));
    return;
  }

  e.respondWith(
    fromNetwork(req)
      .catch(() => caches.match(req))
      .then((res) => res || caches.match("/offline.html"))
  );
});
