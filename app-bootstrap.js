/* ============================================================
   AGMX — Authenticated application bootstrap
   ------------------------------------------------------------
   Authenticated Dashboard, Members, and admin distribution reporting.
   This file intentionally does not invent live mutations for views
   that are not wired to the PocketBase API yet.
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
    "Live PocketBase data": "Data PocketBase langsung",
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
  let loadSequence = 0;
   const ROUTES = {
     dashboard: "#/dashboard",
     members: "#/members",
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
     return ["members", "distribution"].includes(route) ? route : "dashboard";
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

  function sourceBadge(source) {
    const badge = node("span", `agmx-source-badge${source === "demo" ? " is-demo" : ""}`);
    badge.textContent = source === "demo" ? "Demo data · simulated" : "Live PocketBase data";
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
    const logout = node("button", "agmx-shell-button", appText("Log out"));
    logout.type = "button";
    logout.addEventListener("click", onLogout);
    append(userGroup, [userCopy, avatar, language, logout]);
    append(header, [brand, userGroup]);
    return header;
  }

   function buildNav(data) {
     const nav = node("aside", "agmx-shell-nav");
     const group = node("div", "");
     const links = [
       node("p", "agmx-nav-section-label", "Workspace"),
       navLink("dashboard", "▦", "Dashboard"),
       navLink("members", "♙", "Members"),
     ];
     if (isAdmin(data)) links.push(navLink("distribution", "⇄", "Partners & Federation"));
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
     else renderDashboard(content);
    root.querySelectorAll(".agmx-nav-link").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.route === route);
      if (link.dataset.route === route) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    setStatus("ready", { route, source: session.source, error: null });
  }

  function renderShell(data, source) {
    session = { data: data || {}, source };
    setStatus("ready", { route: routeFromHash(), source, error: null });
    root.replaceChildren(buildShell(session.data, source));
    renderRoute();
  }

  async function loadLiveDashboard() {
    const sequence = ++loadSequence;
    setStatus("loading", { route: routeFromHash(), source: "pocketbase", error: null });
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
      renderShell(data, "pocketbase");
    } catch (error) {
      if (sequence !== loadSequence) return;
      renderLogin(`Live data could not be loaded. ${errorMessage(error, "Please try again or use the explicit demo option.")}`);
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
    button.textContent = "Logging out…";
    setStatus("loading", { route: routeFromHash(), source: session && session.source, error: null });
    try {
      if (!window.AGMX_API || typeof window.AGMX_API.logout !== "function") {
        throw new Error("AGMX API is unavailable.");
      }
      await window.AGMX_API.logout();
      renderLogin();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Log out";
      renderLogin(`Logout could not be completed. ${errorMessage(error, "Please try again.")}`);
    }
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
      if (restored && window.AGMX_API.isAuthenticated()) {
        await loadLiveDashboard();
      } else {
        renderLogin();
      }
    } catch (error) {
      // Never substitute demo data for a failed restore; demo is opt-in via login.
      renderLogin(`Authentication could not be restored. ${errorMessage(error, "Please sign in again.")}`);
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
