/* ============================================================
   AGMX — Authenticated application bootstrap
   ------------------------------------------------------------
   Authenticated Dashboard, Members, and admin distribution reporting.
   This file intentionally does not invent live mutations for views
   that are not wired to the Supabase API yet.
   ============================================================ */

(function (window, document) {
  "use strict";

  const hook = (window.AGMX_BOOTSTRAP = window.AGMX_BOOTSTRAP || {});

  const APP_I18N = {
    "Loading AGMX": "Memuatkan AGMX",
    "Restoring your authenticated workspace…": "Memulihkan ruang kerja anda…",
    "AGMX login unavailable": "Log masuk AGMX tidak tersedia",
    "The login view could not be loaded.": "Paparan log masuk tidak dapat dimuatkan.",
    "Dashboard": "Papan Pemuka",
    "Your cooperative workspace": "Ruang kerja koperasi anda",
    "Members": "Ahli",
    "AGM Hall": "Dewan AGM",
    "Compliance & Audit": "Pematuhan & Audit",
    "Registered in this organization": "Berdaftar dalam organisasi ini",
    "Quorum": "Kuorum",
    "present": "hadir",
    "Current AGM": "AGM Semasa",
    "Members & Organization": "Ahli & Organisasi",
    "Partners & Federation": "Rakan Kongsi & Persekutuan",
    "Workspace": "Ruang Kerja",
    "Admin workspace": "Ruang kerja pentadbir",
    "Organization workspace": "Ruang kerja organisasi",
    "Distribution reporting is available for organization administrators.": "Laporan pengedaran tersedia untuk pentadbir organisasi.",
    "Dashboard and Members are available for this role.": "Papan Pemuka dan Ahli tersedia untuk peranan ini.",
    "Authenticated user": "Pengguna disahkan",
    "Member": "Ahli",
    "Log out": "Log Keluar",
    "Live Supabase data": "Data Supabase langsung",
    "Demo data · simulated": "Data demo · simulasi",
    "Organization": "Organisasi",
    "No members found.": "Tiada ahli ditemui.",
    "Search members": "Cari ahli",
    "Name": "Nama",
    "Email": "E-mel",
    "Phone": "Telefon",
    "Status": "Status",
    "Actions": "Tindakan",
    "Refresh": "Muat semula",
    "Retry": "Cuba semula",
    "Could not load data.": "Data tidak dapat dimuatkan.",
    "Back": "Kembali",
    "View details": "Lihat butiran",
    "Set a new password": "Tetapkan kata laluan baharu",
    "Your reset link has been verified.": "Pautan set semula anda telah disahkan.",
    "New password": "Kata laluan baharu",
    "Confirm new password": "Sahkan kata laluan baharu",
    "Save password": "Simpan kata laluan",
    "Saving…": "Menyimpan…",
    "The two passwords do not match.": "Kedua-dua kata laluan tidak sama.",
    "Could not update the password.": "Kata laluan tidak dapat dikemas kini.",
    "AGMX API is unavailable.": "API AGMX tidak tersedia.",
    "Workspace could not be loaded": "Ruang kerja tidak dapat dimuatkan",
    "You are signed in, but the server did not return your organization's data. Nothing here has been replaced with sample data.":
      "Anda telah log masuk, tetapi pelayan tidak mengembalikan data organisasi anda. Tiada apa-apa di sini digantikan dengan data contoh.",
    "Technical detail": "Butiran teknikal",
    "Logging out…": "Sedang log keluar…",
    "Could not update the password. The server response is in the browser console.":
      "Kata laluan tidak dapat dikemas kini. Respons pelayan ada dalam konsol pelayar.",
    "Authentication could not be restored. Sign in again to open your workspace.":
      "Pengesahan tidak dapat dipulihkan. Log masuk semula untuk membuka ruang kerja anda.",
    "Your session has ended. Sign in to open your workspace.":
      "Sesi anda telah berakhir. Log masuk untuk membuka ruang kerja anda.",
    "Could not sign you out. You are still signed in — the server response is in the browser console.":
      "Anda tidak dapat dikeluarkan. Anda masih log masuk — respons pelayan ada dalam konsol pelayar.",
    "Logout could not be completed. Sign in again to open your workspace.":
      "Log keluar tidak dapat diselesaikan. Log masuk semula untuk membuka ruang kerja anda.",
  };
  const APP_LANG = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (q === "en") return "en";
      if (q === "ms") return "ms";
      return localStorage.getItem("agmx-lang") === "en" ? "en" : "ms";
    } catch (_) { return "ms"; }
  })();
  function appText(value) {
    const text = String(value);
    if (APP_LANG !== "ms") return text;
    return APP_I18N[text] || text;
  }

  let session = null;
  let root = null;
  let routeListenerBound = false;
  let authListenerBound = false;
  let loadSequence = 0;
   const ROUTES = {
     dashboard: "#/dashboard",
     members: "#/members",
     agm: "#/agm",
     agmSchedule: "#/agm-schedule",
     governance: "#/governance",
     subscription: "#/subscription",
     partner: "#/partner",
     federation: "#/federation",
     distribution: "#/distribution",
   };

  function setStatus(status, details) {
    Object.assign(hook, {
      status,
      updatedAt: new Date().toISOString(),
      ...(details || {}),
    });
    window.dispatchEvent(new CustomEvent("agmx:runtime-status", { detail: { ...hook } }));
  }

  setStatus("idle", { route: null, source: null, error: null });

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (Array.isArray(value)) {
      value.forEach((child) => {
        if (child) element.appendChild(child);
      });
    } else if (value && typeof value.nodeType === "number") {
      element.appendChild(value);
    } else if (value !== undefined && value !== null) {
      element.textContent = appText(value);
    }
    return element;
  }

  function navLabel(key) {
    const labels = {
      agmSchedule: { BM: "Jadual AGM", EN: "AGM Schedule" },
      subscription: { BM: "Langganan", EN: "Subscription" },
      partner: { BM: "Mitra", EN: "Partner" },
      federation: { BM: "Federasi", EN: "Federation" },
    };
    const lang = (window.state && window.state.lang) || "BM";
    return labels[key]?.[lang] || labels[key]?.BM || key;
  }

  function valueOf(value, fallback) {
    return value === undefined || value === null || value === "" ? (fallback || "—") : String(value);
  }

  function numberOf(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : (fallback || 0);
  }

  function formatNumber(value) {
    return numberOf(value).toLocaleString("en-MY");
  }

  function errorMessage(error, fallback) {
    return error && error.message ? String(error.message) : fallback;
  }

   function routeFromHash() {
     const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];
     return ["members", "agm", "agmSchedule", "governance", "subscription", "partner", "federation", "distribution"].includes(route) ? route : "dashboard";
   }

  function routeHref(route) {
    return ROUTES[route] || ROUTES.dashboard;
  }

  function renderLoading(message) {
    if (!root) return;
    root.replaceChildren(
      node("div", "agmx-boot-loading", node("div", "agmx-boot-state", [
        node("div", "agmx-boot-spinner"),
        node("h1", "", "Loading AGMX"),
        node("p", "", message || "Restoring your authenticated workspace…"),
      ]))
    );
  }

  // Append children without HTML string insertion, including for all remote values.
  function append(parent, children) {
    children.forEach((child) => {
      if (child) parent.appendChild(child);
    });
    return parent;
  }

  // Shell-level alerts stay inside the existing workspace rather than replacing
  // it, because "the action failed" is not "you left the organization".
  function notice(message) {
    if (!root) return null;
    const el = node("div", "agmx-boot-notice is-error", message);
    el.setAttribute("role", "alert");
    root.prepend(el);
    return el;
  }

  function renderLogin(message) {
    session = null;
    setStatus(message ? "error" : "login", {
      route: null,
      source: null,
      error: message ? String(message) : null,
    });

    if (!root) return;
    if (window.AGMX_LOGIN && typeof window.AGMX_LOGIN.render === "function") {
      window.AGMX_LOGIN.render(root);
      if (message) {
        const notice = node("div", "agmx-boot-login-error", message);
        notice.setAttribute("role", "alert");
        root.insertBefore(notice, root.firstChild);
      }
      return;
    }

    const state = node("div", "agmx-boot-error");
    append(state, [node("div", "agmx-boot-state", [
      node("h1", "", "AGMX login unavailable"),
      node("p", "", message || "The login view could not be loaded."),
    ])]);
    root.replaceChildren(state);
  }

  // A login card carries the demo workspace button. Offering it to someone who
  // is already signed in — because a read was refused, not because their
  // session ended — is how a fabricated organization walks into a live meeting,
  // so the two cases get two different screens.
  async function isAuthenticated() {
    if (!window.AGMX_API || typeof window.AGMX_API.isAuthenticated !== "function") return false;
    try {
      return !!(await window.AGMX_API.isAuthenticated());
    } catch (_) {
      return false;
    }
  }

  function renderReadFailure(error) {
    if (!root) return;
    const detail = error && error.message ? String(error.message) : String(error || "");
    if (detail && window.console && console.error) console.error("[app-bootstrap]", detail);
    setStatus("error", { route: routeFromHash(), source: "supabase", error: detail || null });

    const retry = node("button", "btn btn-primary", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => loadLiveDashboard());

    const signOut = node("button", "btn btn-secondary", "Log out");
    signOut.type = "button";
    signOut.addEventListener("click", () => {
      signOut.disabled = true;
      Promise.resolve(window.AGMX_API && window.AGMX_API.logout ? window.AGMX_API.logout() : null)
        .then(renderLogin)
        .catch(() => {
          signOut.disabled = false;
          renderLogin(appText("Logout could not be completed. Sign in again to open your workspace."));
        });
    });

    const blocks = [
      node("h1", "", "Workspace could not be loaded"),
      node("p", "", "You are signed in, but the server did not return your organization's data. Nothing here has been replaced with sample data."),
    ];
    if (detail) {
      const disclosure = node("details", "");
      disclosure.appendChild(node("summary", "", "Technical detail"));
      const pre = node("pre", "agmx-boot-error-detail");
      pre.textContent = detail;
      disclosure.appendChild(pre);
      blocks.push(disclosure);
    }
    blocks.push(node("div", "agmx-boot-actions", [retry, signOut]));

    const state = node("div", "agmx-boot-error");
    append(state, [node("div", "agmx-boot-state", blocks)]);
    root.replaceChildren(state);
  }

  function sourceBadge(source) {
    const badge = node("span", `agmx-source-badge${source === "demo" ? " is-demo" : ""}`);
    badge.textContent = appText(source === "demo" ? "Demo data · simulated" : "Live Supabase data");
    return badge;
  }

  function buildHeader(data) {
    const cooperative = data.cooperative || {};
    const user = data.currentUser || {};
    const header = node("header", "agmx-shell-header");
    const brand = node("div", "agmx-brand");
    append(brand, [
      node("span", "agmx-brand-mark", "AG"),
      node("span", "agmx-brand-name", "AGMX"),
      node("span", "agmx-brand-context", valueOf(cooperative.shortName || cooperative.name, "Governance OS")),
    ]);

    const userGroup = node("div", "agmx-header-user");
    const userCopy = node("div", "agmx-user-copy");
    append(userCopy, [
      node("span", "agmx-user-name", valueOf(user.name, "Authenticated user")),
      node("span", "agmx-user-role", valueOf(user.role, "Member")),
    ]);
    const avatar = node("span", "agmx-avatar", valueOf(user.avatar, valueOf(user.name, "?").slice(0, 2).toUpperCase()));
    const language = node("button", "agmx-shell-button agmx-lang-switch", APP_LANG === "ms" ? "EN" : "BM");
    language.type = "button";
    language.setAttribute("aria-label", APP_LANG === "ms" ? "Switch to English" : "Tukar ke Bahasa Melayu");
    language.addEventListener("click", () => {
      const next = APP_LANG === "ms" ? "en" : "ms";
      try { localStorage.setItem("agmx-lang", next); } catch (_) {}
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.location.href = url.toString();
    });
    const theme = node("button", "agmx-shell-button agmx-theme-toggle", "Tema");
    theme.type = "button";
    theme.setAttribute("data-agmx-theme-toggle", "");
    const logout = node("button", "agmx-shell-button", appText("Log out"));
    logout.type = "button";
    logout.addEventListener("click", onLogout);
    append(userGroup, [userCopy, avatar, theme, language, logout]);
    append(header, [brand, userGroup]);
    if (window.AGMX_THEME) window.AGMX_THEME.sync();
    return header;
  }

   function buildNav(data) {
     const nav = node("aside", "agmx-shell-nav");
     const group = node("div", "");
     const links = [
       node("p", "agmx-nav-section-label", "Workspace"),
       navLink("dashboard", "▦", "Dashboard"),
       navLink("agm", "◉", "AGM Hall"),
       navLink("agmSchedule", "📅", "Jadual AGM"),
       navLink("subscription", "💳", "Langganan"),
       navLink("members", "♙", "Members"),
     ];
     if (isAdmin(data)) {
       links.push(navLink("partner", "🤝", "Partner"));
       links.push(navLink("federation", "🏢", "Federation"));
       links.push(navLink("distribution", "⇄", "Partners & Federation"));
     }
     append(group, links);
     const note = node("div", "agmx-nav-note");
     append(note, [
       node("strong", "", isAdmin(data) ? "Admin workspace" : "Organization workspace"),
       node("span", "", isAdmin(data)
         ? "Distribution reporting is available for organization administrators."
         : "Dashboard and Members are available for this role."),
     ]);
     append(nav, [group, note]);
     return nav;
   }

   function isAdmin(data) {
     const role = String((data && data.currentUser && data.currentUser.role) || "").toLowerCase();
     return role === "admin" || role.includes("administrator");
   }

   // Mirrors the governance Edge Function: admin and secretary may run a
   // meeting; the server enforces it regardless of what this view renders.
   function isOperator(data) {
     const role = String((data && data.currentUser && data.currentUser.role) || "").toLowerCase();
     return isAdmin(data) || role === "secretary" || role.includes("administrator");
   }

  function navLink(route, icon, label) {
    const link = node("a", "agmx-nav-link");
    link.href = routeHref(route);
    link.dataset.route = route;
    append(link, [node("span", "agmx-nav-icon", icon), node("span", "", label)]);
    return link;
  }

  function buildShell(data, source) {
    const shell = node("div", "agmx-shell");
    shell.dataset.source = source;
    append(shell, [
      buildHeader(data),
       buildNav(data),
      node("main", "agmx-shell-main", node("div", "agmx-shell-content")),
    ]);
    return shell;
  }

  function detailRow(label, value) {
    const row = node("div", "agmx-detail-row");
    append(row, [node("dt", "", label), node("dd", "", valueOf(value))]);
    return row;
  }

  function cardHeading(title, subtitle) {
    const heading = node("div", "agmx-card-heading");
    const copy = node("div", "");
    append(copy, [node("h2", "", title), subtitle ? node("p", "", subtitle) : null]);
    heading.appendChild(copy);
    return heading;
  }

  function renderDashboard(content) {
    const data = session.data;
    const cooperative = data.cooperative || {};
    const agm = data.agm || {};
    const source = session.source;
    const heading = node("div", "agmx-page-heading");
    const title = node("div", "");
    append(title, [
      node("h1", "", "Dashboard"),
      node("p", "", valueOf(cooperative.name, "Your cooperative workspace")),
    ]);
    heading.append(node("div", "", title), sourceBadge(source));

    const metrics = node("section", "agmx-metrics");
    const quorum = numberOf(agm.quorumPct, numberOf(cooperative.quorumPct));
    append(metrics, [
      metric("Members", formatNumber(cooperative.members || (data.members || []).length), "Registered in this organization"),
      metric("Quorum", `${quorum.toFixed(1)}%`, `${formatNumber(agm.quorumPresent)} present`),
      metric("Current AGM", valueOf(agm.status, "Not available"), valueOf(agm.title, "No current AGM")),
      metric("Plan", valueOf(cooperative.plan, "—"), "Organization subscription"),
    ]);

    const grid = node("div", "agmx-grid-two");
    const agmCard = node("section", "agmx-card");
    append(agmCard, [
      cardHeading("Current AGM", "Read-only status from the authenticated workspace"),
      node("dl", "agmx-detail-list", [
        detailRow("Meeting", valueOf(agm.title)),
        detailRow("Date and time", [valueOf(agm.date), valueOf(agm.time)].filter(Boolean).join(" · ") || "—"),
        detailRow("Venue", valueOf(agm.venue)),
        detailRow("Quorum", `${formatNumber(agm.quorumPresent)} / ${formatNumber(agm.totalMembers || cooperative.members)}`),
      ]),
    ]);
    const orgCard = node("section", "agmx-card");
    append(orgCard, [
      cardHeading("Organization", "Authenticated tenant context"),
      node("dl", "agmx-detail-list", [
        detailRow("Organization", valueOf(cooperative.name)),
        detailRow("Registration", valueOf(cooperative.registrationNo)),
        detailRow("State / zone", [cooperative.state, cooperative.zone].filter(Boolean).join(" · ") || "—"),
        detailRow("Role", valueOf((data.currentUser || {}).role, "Member")),
      ]),
    ]);
    append(grid, [agmCard, orgCard]);

    append(content, [heading]);
    if (source === "demo") {
      const banner = node("div", "agmx-demo-banner");
      append(banner, [
        node("strong", "", "Demo mode: "),
        node("span", "", "these cooperative, AGM, and member values are simulated and are not live records."),
      ]);
      banner.setAttribute("role", "status");
      content.appendChild(banner);
    }
    append(content, [metrics, grid]);
  }

  function metric(label, value, detail) {
    const card = node("article", "agmx-card");
    append(card, [node("span", "agmx-metric-label", label), node("strong", "agmx-metric-value", value), node("span", "agmx-metric-detail", detail)]);
    return card;
  }

   function renderMembers(content) {
    const data = session.data;
    const members = Array.isArray(data.members) ? data.members : [];
    const heading = node("div", "agmx-page-heading");
    const title = node("div", "");
    append(title, [node("h1", "", "Members"), node("p", "", "Members available to this authenticated organization")]);
    heading.append(node("div", "", title), sourceBadge(session.source));
    content.appendChild(heading);

    if (session.source === "demo") {
      const banner = node("div", "agmx-demo-banner", "Demo mode: this member list is simulated and is not a live directory.");
      banner.setAttribute("role", "status");
      content.appendChild(banner);
    }

    const card = node("section", "agmx-card");
    const toolbar = node("div", "agmx-member-toolbar");
    append(toolbar, [
      node("strong", "", "Member directory"),
      node("span", "agmx-member-count", `${formatNumber(members.length)} record${members.length === 1 ? "" : "s"}`),
    ]);
    card.appendChild(toolbar);

    if (!members.length) {
      card.appendChild(node("p", "agmx-empty", "No member records are available for this organization."));
      content.appendChild(card);
      return;
    }

    const wrap = node("div", "agmx-table-wrap");
    const table = node("table", "agmx-members-table");
    table.appendChild(node("caption", "sr-only", "Members in the authenticated organization"));
    const head = node("thead", "");
    const headRow = node("tr", "");
    ["Member ID", "Name", "Status", "Shares", "Eligibility"].forEach((label) => headRow.appendChild(node("th", "", label)));
    head.appendChild(headRow);
    const body = node("tbody", "");
    members.forEach((member) => body.appendChild(memberRow(member)));
    append(table, [head, body]);
    wrap.appendChild(table);
    card.appendChild(wrap);
     content.appendChild(card);
   }

   function renderDistribution(content) {
     const data = session.data || {};
     const distribution = data.distribution;
     const heading = node("div", "agmx-page-heading");
     const title = node("div", "");
     append(title, [
       node("h1", "", "Partners & Federation"),
       node("p", "", "Tenant-scoped referral records and federation reporting"),
     ]);
     heading.append(node("div", "", title), sourceBadge(session.source));
     content.appendChild(heading);

     if (session.source === "demo") {
       const banner = node("div", "agmx-demo-banner",
         "Demo mode: partner and federation records are not included in the simulated workspace.");
       banner.setAttribute("role", "status");
       content.appendChild(banner);
     }

     if (!isAdmin(data)) {
       const card = node("section", "agmx-card");
       append(card, [
         cardHeading("Administrator access required", "Distribution records are restricted to the organization admin."),
         node("p", "agmx-empty", "Ask an organization administrator to review partners or federation reporting."),
       ]);
       content.appendChild(card);
       return;
     }

     if (!distribution) {
       const card = node("section", "agmx-card");
       append(card, [
         cardHeading("Distribution data unavailable", "The live portal could not load its tenant-scoped records."),
         node("p", "agmx-empty", valueOf(data.distributionError, "Try refreshing the page or contact support.")),
       ]);
       content.appendChild(card);
       return;
     }

     const partners = Array.isArray(distribution.partners) ? distribution.partners : [];
     const partnerLinks = Array.isArray(distribution.partnerOrganizations)
       ? distribution.partnerOrganizations : [];
     const federations = Array.isArray(distribution.federations) ? distribution.federations : [];
     const linkedOrganizations = federations.reduce(
       (total, report) => total + numberOf(report.organizationCount), 0
     );
     const memberTotal = federations.reduce(
       (total, report) => total + numberOf(report.memberTotal), 0
     );

     const metrics = node("section", "agmx-metrics");
     append(metrics, [
       metric("Partners", formatNumber(partners.length), "Admin-owned referral records"),
       metric("Partner links", formatNumber(partnerLinks.length), "Tenant-scoped organization links"),
       metric("Federations", formatNumber(federations.length), "Federations owned by this organization"),
       metric("Federation members", formatNumber(memberTotal), `${formatNumber(linkedOrganizations)} linked organizations`),
     ]);
     content.appendChild(metrics);

     const grid = node("div", "agmx-grid-two agmx-distribution-grid");
     grid.appendChild(renderPartnerCard(partners, partnerLinks));
     grid.appendChild(renderFederationCard(federations));
     content.appendChild(grid);

     const reports = federations.filter((report) => Array.isArray(report.organizations)
       && report.organizations.length);
     if (reports.length) {
       const card = node("section", "agmx-card agmx-distribution-detail");
       append(card, [
         cardHeading("Federation organization detail", "Aggregated records returned for each linked organization"),
         distributionOrganizationTable(reports),
       ]);
       content.appendChild(card);
     }
   }

   function renderAgmSchedule(content) {
     location.href = '/agm-schedule.html';
   }

   function renderSubscription(content) {
     location.href = '/subscription-management.html';
   }

   function renderPartner(content) {
     location.href = '/partner-portal.html';
   }

   function renderFederation(content) {
     location.href = '/federation-dashboard.html';
   }

   function renderPartnerCard(partners, links) {
     const card = node("section", "agmx-card");
     append(card, [
       cardHeading("Partner network", "Referral and commission tracking"),
       partners.length ? distributionTable(
         ["Partner", "Status", "Commission", "Linked"],
         partners.map((partner) => [
           valueOf(partner.name),
           statusPill(valueOf(partner.status, "active")),
           `${numberOf(partner.commissionPct).toFixed(1)}%`,
           formatNumber(links.filter((link) => link.partnerId === partner.id).length),
         ])
       ) : node("p", "agmx-empty", "No partner records have been created."),
     ]);
     return card;
   }

   function renderFederationCard(federations) {
     const card = node("section", "agmx-card");
     append(card, [
       cardHeading("Federation reporting", "Roll-up coverage across linked organizations"),
       federations.length ? distributionTable(
         ["Federation", "Linked", "Members", "AGMs", "Compliance"],
         federations.map((report) => {
           const counts = report.complianceCounts || {};
           const total = numberOf(counts.total);
           const score = total
             ? Math.round(((numberOf(counts.lulus) + numberOf(counts.amaran) * 0.5) / total) * 100)
             : 0;
           return [
             valueOf(report.federation && report.federation.name),
             report.unavailable ? "—" : formatNumber(report.organizationCount),
             report.unavailable ? "—" : formatNumber(report.memberTotal),
             report.unavailable ? "—" : formatNumber(report.agmCount),
             report.unavailable ? statusPill("Unavailable", true) : `${score}%`,
           ];
         })
       ) : node("p", "agmx-empty", "No federation records have been created."),
     ]);
     return card;
   }

   function distributionOrganizationTable(reports) {
     const rows = [];
     reports.forEach((report) => {
       (report.organizations || []).forEach((organization) => {
         const counts = organization.complianceCounts || {};
         const total = numberOf(counts.total);
         const score = total
           ? Math.round(((numberOf(counts.lulus) + numberOf(counts.amaran) * 0.5) / total) * 100)
           : 0;
         rows.push([
           valueOf(report.federation && report.federation.name),
           valueOf(organization.organizationId),
           formatNumber(organization.memberCount),
           formatNumber(organization.agmCount),
           `${score}%`,
         ]);
       });
     });
     return distributionTable(["Federation", "Organization ID", "Members", "AGMs", "Compliance"], rows);
   }

   function distributionTable(headers, rows) {
     const wrap = node("div", "agmx-table-wrap");
     const table = node("table", "agmx-members-table agmx-report-table");
     table.appendChild(node("caption", "sr-only", headers.join(", ")));
     const head = node("thead", "");
     const headRow = node("tr", "");
     headers.forEach((header) => headRow.appendChild(node("th", "", header)));
     head.appendChild(headRow);
     const body = node("tbody", "");
     rows.forEach((row) => {
       const tr = node("tr", "");
       row.forEach((value) => {
         const td = node("td", "");
         if (typeof value === "string" || typeof value === "number") td.textContent = String(value);
         else if (value) td.appendChild(value);
         tr.appendChild(td);
       });
       body.appendChild(tr);
     });
     append(table, [head, body]);
     wrap.appendChild(table);
     return wrap;
   }

   function statusPill(value, warning) {
     return node("span", `agmx-status-pill${warning ? " is-warning" : ""}`, value);
   }

  function memberRow(member) {
    const row = node("tr", "");
    const status = valueOf(member.status, "—");
    const statusPill = node("span", `agmx-status-pill${/tunggakan|arrears|inactive/i.test(status) ? " is-warning" : ""}`, status);
    const eligibility = node("span", `agmx-eligibility${member.eligible ? "" : " is-no"}`, member.eligible ? "Eligible" : "Not eligible");
    const name = node("span", "agmx-member-name", valueOf(member.name, "Unnamed member"));
    const cells = [
      valueOf(member.id, "—"),
      name,
      statusPill,
      formatNumber(member.shares),
      eligibility,
    ];
    cells.forEach((cell) => {
      const td = node("td", "");
      if (typeof cell === "string") td.textContent = cell;
      else td.appendChild(cell);
      row.appendChild(td);
    });
    return row;
  }

  function renderRoute() {
    if (!session || !root) return;
    const route = routeFromHash();
    if (window.location.hash !== routeHref(route)) {
      window.history.replaceState(null, "", routeHref(route));
    }
    const content = root.querySelector(".agmx-shell-content");
    if (!content) return;
    content.replaceChildren();
     if (route === "members") renderMembers(content);
     else if (route === "distribution") renderDistribution(content);
     else if (route === "agm" || route === "governance") renderGovernance(content, route);
     else if (route === "agmSchedule") renderAgmSchedule(content);
     else if (route === "subscription") renderSubscription(content);
     else if (route === "partner") renderPartner(content);
     else if (route === "federation") renderFederation(content);
     else renderDashboard(content);
    root.querySelectorAll(".agmx-nav-link").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.route === route);
      if (link.dataset.route === route) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    setStatus("ready", { route, source: session.source, error: null });
  }

  function renderGovernance(content, route) {
    const view = window.AGMX_GOVERNANCE;
    if (!view || typeof view.renderAgmHall !== "function") {
      content.replaceChildren(node("div", "agmx-card", node("p", "agmx-empty", "AGMX API is unavailable.")));
      return;
    }
    const data = session.data || {};
    const ctx = {
      data,
      source: session.source,
      isAdmin: isOperator(data),
      api: (window.AGMX_API || {}).governance,
      reload: loadLiveDashboard,
    };
    if (!ctx.api) {
      content.replaceChildren(node("div", "agmx-card", node("p", "agmx-empty", "AGMX API is unavailable.")));
      return;
    }
    const render = route === "agm" ? view.renderAgmHall : view.renderGovernanceRegister;
    Promise.resolve(render(content, ctx)).catch((error) => {
      content.replaceChildren(node("div", "agmx-card", node("p", "agmx-empty", errorMessage(error, "Could not load."))));
    });
  }

  function renderShell(data, source) {
    session = { data: data || {}, source };
    setStatus("ready", { route: routeFromHash(), source, error: null });
    root.replaceChildren(buildShell(session.data, source));
    renderRoute();
  }

  async function loadLiveDashboard() {
    const sequence = ++loadSequence;
    setStatus("loading", { route: routeFromHash(), source: "supabase", error: null });
    renderLoading("Loading live organization data…");
    try {
      if (!window.AGMX_API || typeof window.AGMX_API.loadDashboard !== "function") {
        throw new Error("AGMX API is unavailable.");
      }
      const data = await window.AGMX_API.loadDashboard();
      if (sequence !== loadSequence) return;
      if (!data || !data.cooperative) throw new Error("The live workspace returned no organization data.");
      if (isAdmin(data) && typeof window.AGMX_API.loadDistributionPortal === "function") {
        try {
          data.distribution = await window.AGMX_API.loadDistributionPortal(data.cooperative.pbId);
        } catch (error) {
          data.distributionError = errorMessage(error, "Distribution records could not be loaded.");
        }
      }
      renderShell(data, "supabase");
    } catch (error) {
      if (sequence !== loadSequence) return;
      const signedIn = await isAuthenticated();
      if (sequence !== loadSequence) return;
      if (signedIn) renderReadFailure(error);
      else renderLogin(appText("Your session has ended. Sign in to open your workspace."));
    }
  }

  async function onLoginSuccess(result) {
    if (result && result.demo === true) {
      if (!window.MC_DATA) {
        renderLogin("Demo data is unavailable. Please use a live sign-in method.");
        return;
      }
      setStatus("loading", { route: routeFromHash(), source: "demo", error: null });
      renderLoading("Preparing the explicitly selected demo workspace…");
      renderShell(window.MC_DATA, "demo");
      return;
    }
    await loadLiveDashboard();
  }

  async function onLogout(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = appText("Logging out…");
    setStatus("loading", { route: routeFromHash(), source: session && session.source, error: null });
    try {
      if (!window.AGMX_API || typeof window.AGMX_API.logout !== "function") {
        throw new Error("AGMX API is unavailable.");
      }
      await window.AGMX_API.logout();
      renderLogin();
    } catch (error) {
      button.disabled = false;
      button.textContent = appText("Log out");
      const detail = errorMessage(error, "");
      if (detail && window.console && console.error) console.error("[app-bootstrap]", detail);
      // A failed sign-out usually leaves the session live, and the login card is
      // the screen that offers the demo workspace — so ask the server before
      // changing the view rather than claiming a logout that did not happen.
      if (await isAuthenticated()) {
        setStatus("ready", { route: routeFromHash(), source: session && session.source, error: detail || null });
        notice("Could not sign you out. You are still signed in — the server response is in the browser console.");
      } else {
        renderLogin();
      }
    }
  }

  // A reset link leaves the visitor holding a session that can only change
  // their own password, so this view is the only thing worth showing.
  function renderPasswordRecovery() {
    if (!root) return;
    setStatus("login", { route: null, source: null, error: null });

    const heading = node("div", "login-head");
    append(heading, [
      node("h1", "login-title", "Set a new password"),
      node("p", "login-sub", "Your reset link has been verified."),
    ]);

    function passwordField(id, label) {
      const field = node("div", "field");
      const caption = node("label", "field-label", label);
      caption.htmlFor = id;
      const input = node("input", "input");
      input.id = id;
      input.name = id;
      input.type = "password";
      input.autocomplete = "new-password";
      input.required = true;
      input.minLength = 8;
      append(field, [caption, input]);
      return input;
    }

    const password = passwordField("agmx-new-password", "New password");
    const confirm = passwordField("agmx-new-password-confirm", "Confirm new password");
    const status = node("p", "login-status");
    status.setAttribute("role", "alert");
    const submit = node("button", "btn btn-primary btn-block", "Save password");
    submit.type = "submit";

    const form = document.createElement("form");
    form.className = "login-form";
    append(form, [password.parentNode, confirm.parentNode, status, submit]);

    const card = node("div", "login-view agmx-login");
    card.append(heading, form);
    root.replaceChildren(card);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "";
      if (password.value !== confirm.value) {
        status.textContent = appText("The two passwords do not match.");
        return;
      }
      submit.disabled = true;
      submit.textContent = appText("Saving…");
      try {
        if (!window.AGMX_API || typeof window.AGMX_API.updatePassword !== "function") {
          throw new Error("AGMX API is unavailable.");
        }
        const result = await window.AGMX_API.updatePassword(password.value);
        if (result && result.error) throw new Error(result.error.message);
        await loadLiveDashboard();
      } catch (error) {
        submit.disabled = false;
        submit.textContent = appText("Save password");
        const detail = errorMessage(error, "");
        if (detail && window.console && console.error) console.error("[app-bootstrap]", detail);
        status.textContent = appText("Could not update the password. The server response is in the browser console.");
      }
    });

    password.focus();
  }

  async function bootstrap() {
    root = document.getElementById("app");
    if (!root) return;
    if (window.AGMX_LOGIN) window.AGMX_LOGIN.onSuccess = onLoginSuccess;
    setStatus("loading", { route: null, source: null, error: null });
    renderLoading("Restoring your authenticated workspace…");

    try {
      if (!window.AGMX_API || typeof window.AGMX_API.init !== "function") {
        throw new Error("AGMX API is unavailable.");
      }
      const restored = await window.AGMX_API.init();

      // Sign-out can happen without this tab being involved: another tab, a
      // revoked token, an expired session. The rendered workspace belongs to
      // that identity, so it goes with it — otherwise a meeting-room browser
      // keeps an AGM on screen after the secretary has signed out, and the
      // next mutation answers with a raw 401.
      if (!authListenerBound && typeof window.AGMX_API.onAuthStateChange === "function") {
        authListenerBound = true;
        window.AGMX_API.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT" && session) renderLogin();
        });
      }

      if (restored && window.AGMX_API.isPasswordRecovery && window.AGMX_API.isPasswordRecovery()) {
        renderPasswordRecovery();
      } else if (restored && await window.AGMX_API.isAuthenticated()) {
        await loadLiveDashboard();
      } else {
        renderLogin();
      }
    } catch (error) {
      // Never substitute demo data for a failed restore; demo is opt-in via login.
      const detail = errorMessage(error, "");
      if (detail && window.console && console.error) console.error("[app-bootstrap]", detail);
      renderLogin(appText("Authentication could not be restored. Sign in again to open your workspace."));
    }
  }

  if (!routeListenerBound) {
    window.addEventListener("hashchange", renderRoute);
    routeListenerBound = true;
  }
  document.addEventListener("DOMContentLoaded", function () {
    // Keep the API call on DOMContentLoaded so #app and the login view exist.
    void bootstrap();
  });
})(window, document);
