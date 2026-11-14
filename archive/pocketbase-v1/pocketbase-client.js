// ============================================================
// AGMX — PocketBase Client + Google Auth
// ------------------------------------------------------------
// Replaces window.MC_DATA (data.js) with live PocketBase data.
//
// Load order in HTML:
//   1. pocketbase-client.js  (defines window.AGMX_API)
//   2. data.js               (mock fallback — used only if PB unavailable)
//
// Usage:
//   const api = window.AGMX_API;
//   await api.init();                       // restore session
//   await api.loginWithGoogle();            // Google OAuth2
//   const data = await api.loadDashboard(); // → MC_DATA-shaped object
// ============================================================

(function () {
  "use strict";

  // ---- Configuration -------------------------------------------
  // Load from /config.js (gitignored) or fall back to defaults.
  const CONFIG = Object.assign(
    {
      // Local dev
      url: "http://127.0.0.1:8090",
      // Production (set in /config.js)
      // url: "https://pb.agmx-project.vercel.app",
      googleClientId: "",
      appName: "AGMX",
      demoMode: true, // allows explicitly labelled local demo fallback if PocketBase is unreachable
      paymentDemo: true, // payment intents/confirmation are demonstrative until a gateway is connected
      backend: "pocketbase-bridge",
      healthUrl: "/api/health",
      requestTimeoutMs: 10000,
    },
    window.AGMX_CONFIG || {}
  );

  const COLLECTIONS = {
    organizations: "organizations",
    members: "members",
    agms: "agms",
    agmSettings: "agm_settings",
    agenda: "agenda_items",
    candidates: "candidates",
    motions: "motions",
    votes: "votes",
    resolutions: "resolutions",
    attendance: "attendance",
    quorum: "quorum_snapshots",
    notices: "agm_notices",
    noticeRecipients: "notice_recipients",
    questions: "questions",
    actions: "actions",
    complianceRules: "compliance_rules",
    complianceChecks: "compliance_checks",
    complianceFindings: "compliance_findings",
    documents: "documents",
    auditEvents: "audit_events",
    statusHistory: "member_status_history",
    plans: "plans",
    subscriptions: "subscriptions",
    assessments: "agm_assessments",
    quotes: "quotes",
    invoices: "invoices",
    payments: "payments",
    partners: "partners",
    partnerOrgs: "partner_organizations",
    federations: "federations",
    federationOrgs: "federation_organizations",
  };

  const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled"];
  const SUBSCRIPTION_TRANSITIONS = {
    trialing: ["trialing", "active", "canceled"],
    active: ["active", "past_due", "canceled"],
    past_due: ["active", "canceled"],
    canceled: ["canceled"],
  };
  const BILLING_CYCLES = ["monthly", "annual"];
  const GOVERNANCE_ROLES = ["admin", "secretary", "chairman", "treasurer", "board"];
  const DOCUMENT_CATEGORIES = ["notice", "minutes", "financial", "motion", "resolution", "attendance", "other"];
  const COMPLIANCE_RESULTS = ["lulus", "amaran", "gagal"];
  const COMPLIANCE_SEVERITIES = ["info", "warning", "critical"];
  const COMPLIANCE_FINDING_STATUSES = ["terbuka", "dalam-progress", "selesai"];
  // ---- Minimal PocketBase SDK (no npm needed) ------------------
  // Implements the subset of the PocketBase JS SDK that AGMX needs:
  //   authWithOAuth2, authWithPassword, requestOTP / verifyOTP,
  //   collection().getFullList/getFirstListItem/create/update,
  //   subscribe (SSE realtime)
  class PB {
    constructor(baseUrl) {
      this.baseUrl = baseUrl.replace(/\/$/, "");
      this.authToken = localStorage.getItem("pb_token") || "";
      this.authRecord = null;
      try {
        const raw = localStorage.getItem("pb_auth");
        if (raw) this.authRecord = JSON.parse(raw);
      } catch (_) {
        /* ignore */
      }
      this._listeners = {};
    }

    // ---- internal helpers ----
    _headers(extra, anonymous = false) {
      const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
      if (this.authToken && !anonymous) h["Authorization"] = this.authToken;
      return h;
    }

    _saveAuth(token, record) {
      this.authToken = token || "";
      this.authRecord = record || null;
      if (token) localStorage.setItem("pb_token", token);
      else localStorage.removeItem("pb_token");
      if (record) localStorage.setItem("pb_auth", JSON.stringify(record));
      else localStorage.removeItem("pb_auth");
    }

    async _request(path, options = {}) {
      const url = this.baseUrl + path;
      const multipart = isFormData(options.body);
      const timeoutMs = Number(CONFIG.requestTimeoutMs);
      const controller = typeof AbortController === "function" && timeoutMs > 0
        ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const res = await fetch(url, {
          method: options.method || "GET",
          headers: multipart ? Object.assign({}, options.headers || {}, this.authToken && !options.anonymous
            ? { Authorization: this.authToken } : {}) : this._headers(options.headers, options.anonymous),
          body: options.body ? (multipart ? options.body : JSON.stringify(options.body)) : undefined,
          signal: controller ? controller.signal : undefined,
        });
        const text = await res.text();
        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_) {
          data = { raw: text };
        }
        if (!res.ok) {
          const err = new Error(
            (data && (data.message || data.data)) || "HTTP " + res.status
          );
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      } catch (error) {
        if (error && error.name === "AbortError") {
          const timeoutError = new Error("PocketBase request timed out.");
          timeoutError.code = "AGMX_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    // ---- auth ----
    /**
     * Google OAuth2. PocketBase must have the Google provider enabled and
     * `clientId` configured in Settings → Auth (see GOOGLE_AUTH_SETUP.md).
     * Returns { token, record }.
     */
    async authWithGoogle() {
      const provider = "google";
      const redirect = location.origin + location.pathname;

      // 1) Ask PocketBase for the OAuth2 authorization URL.
      const cfg = await this._request(
        `/api/collections/${COLLECTIONS.users || "_pb_users_auth_"}/auth-methods`
      ).catch(() => null);

      // Fall back to the standard endpoint name.
      const endpoint =
        cfg && cfg.google ? "/api/collections/_pb_users_auth_/auth-methods" : null;

      // Build the URL manually (stable across PocketBase versions).
      const authUrl =
        `${this.baseUrl}/api/collections/_pb_users_auth_/auth-methods` +
        `?provider=${provider}&redirect=${encodeURIComponent(redirect)}`;

      // 2) Redirect the browser to Google consent screen.
      const res = await fetch(authUrl, { method: "GET" });
      if (!res.ok) {
        throw new Error(
          "Google auth is not configured on the PocketBase server. " +
            "See GOOGLE_AUTH_SETUP.md."
        );
      }
      const data = await res.json();
      location.href = data.authURL;

      // Unreachable in the main document flow; used when PocketBase is
      // embedded in an iframe / popup flow.
      return new Promise((resolve, reject) => {
        window.addEventListener("message", async (ev) => {
          try {
            const payload = JSON.parse(ev.data);
            if (!payload || !payload.token) return;
            this._saveAuth(payload.token, payload.record);
            resolve({ token: payload.token, record: payload.record });
          } catch (e) {
            reject(e);
          }
        });
        void endpoint;
      });
    }

    /** Standard email+password login (fallback / staff accounts). */
    async authWithPassword(email, password) {
      const data = await this._request(
        "/api/collections/_pb_users_auth_/auth-with-password",
        { method: "POST", body: { identity: email, password } }
      );
      this._saveAuth(data.token, data.record);
      return data;
    }

    /** Email OTP (PocketBase v0.23+) — used for One Click Join. */
    async requestEmailOTP(email) {
      return this._request(
        "/api/collections/_pb_users_auth_/request-otp",
        { method: "POST", body: { email } }
      );
    }

    async verifyEmailOTP(email, token) {
      const data = await this._request(
        "/api/collections/_pb_users_auth_/auth-with-otp",
        { method: "POST", body: { email, token } }
      );
      this._saveAuth(data.token, data.record);
      return data;
    }

    /** SMS OTP for members without email (pocketbase-plugin-otp-sms). */
    async requestSMSOTP(phone) {
      return this._request(
        "/api/collections/_pb_users_auth_/request-sms-otp",
        { method: "POST", body: { phone } }
      );
    }

    async verifySMSOTP(phone, token) {
      const data = await this._request(
        "/api/collections/_pb_users_auth_/auth-with-sms-otp",
        { method: "POST", body: { phone, token } }
      );
      this._saveAuth(data.token, data.record);
      return data;
    }

    async logout() {
      try {
        await this._request("/api/collections/_pb_users_auth_/auth-refresh", {
          method: "DELETE",
        });
      } catch (_) {
        /* ignore */
      }
      this._saveAuth("", null);
    }

    get isValid() {
      return !!this.authToken;
    }

    get currentUser() {
      return this.authRecord;
    }

    // ---- collections ----
    collection(name) {
      const self = this;
      return {
        name,

        async getFullList({ filter, sort, fields, limit = 1000, expand } = {}) {
          const qs = new URLSearchParams();
          if (filter) qs.set("filter", filter);
          if (sort) qs.set("sort", sort);
          if (fields) qs.set("fields", fields);
          if (expand) qs.set("expand", expand);
          qs.set("perPage", String(Math.min(limit, 2000)));
          return self._request(
            `/api/collections/${name}/records?` + qs.toString()
          );
        },

        async getList(opts = {}) {
          const qs = new URLSearchParams();
          if (opts.filter) qs.set("filter", opts.filter);
          if (opts.sort) qs.set("sort", opts.sort);
          if (opts.page) qs.set("page", String(opts.page));
          qs.set("perPage", String(opts.perPage || 50));
          return self._request(
            `/api/collections/${name}/records?` + qs.toString()
          );
        },

        async getFirstListItem(filter) {
          const list = await this.getFullList({ filter, limit: 1 });
          return list.items[0];
        },

        async getOne(id, expand) {
          const qs = expand ? "?expand=" + expand : "";
          return self._request(
            `/api/collections/${name}/records/${id}${qs}`
          );
        },

        async create(body, query = {}, options = {}) {
          const qs = new URLSearchParams(query).toString();
          const requestBody = options.multipart ? makeFormData(body) : body;
          return self._request(
            `/api/collections/${name}/records${qs ? "?" + qs : ""}`,
            { method: "POST", body: requestBody, anonymous: options.anonymous }
          );
        },

        async update(id, body, options = {}) {
          const requestBody = options.multipart ? makeFormData(body) : body;
          return self._request(`/api/collections/${name}/records/${id}`, {
            method: "PATCH",
            body: requestBody,
          });
        },

        async remove(id) {
          return self._request(`/api/collections/${name}/records/${id}`, {
            method: "DELETE",
          });
        },

        /** Realtime SSE subscription. Returns unsubscribe fn. */
        subscribe(topic, callback) {
          return self._subscribe(name, topic, callback);
        },
      };
    }

    // ---- realtime (SSE) ----
    _subscribe(collection, topic, callback) {
      const url =
        `${this.baseUrl}/api/realtime` +
        `?topics=${encodeURIComponent(collection + "/" + topic)}` +
        (this.authToken ? `&auth=${encodeURIComponent(this.authToken)}` : "");

      const es = new EventSource(url);
      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          callback(payload);
        } catch (_) {
          /* ignore malformed frames */
        }
      };
      es.onerror = () => {
        /* EventSource auto-reconnects */
      };
      return () => es.close();
    }
  }

  // ---- AGMX API layer -------------------------------------------
  const pb = new PB(CONFIG.url);

  /** Resolve the auth record's organizationId + role + memberId. */
  function authContext() {
    const u = pb.currentUser;
    if (!u) return null;
    const meta = u.organizationId || (u.meta && u.meta.organizationId) || null;
    return {
      userId: u.id,
      email: u.email,
      name: u.name,
      organizationId: meta,
      role: (u.meta && u.meta.role) || u.role || "member",
      memberId: (u.meta && u.meta.memberId) || null,
    };
  }

  /** Map a PocketBase members record → the shape data.js uses. */
  function mapMember(rec) {
    const r = rec;
    return {
      id: r.memberNo,
      pbId: r.id,
      name: r.name,
      ic: r.ic || "",
      phone: r.phone || "",
      shares: r.shares || 0,
      status: r.status || "Aktif",
      arrears: r.arrears || 0,
      eligible: !!r.eligible,
      age: r.age || null,
      proxy: r.proxyOf || null,
      attended: !!r.attended,
      joined: r.joinedAt || "",
    };
  }

  /** Map a PocketBase motions record → data.js shape. */
  function mapMotion(rec) {
    const r = rec;
    return {
      id: r.code,
      pbId: r.id,
      title: r.title,
      proposer: r.proposerId || "-",
      seconder: r.seconderId || null,
      status: (r.status || "draf").toUpperCase(),
      type: r.type || "lain",
      proposedAt: r.proposedAt || "-",
      secondedAt: r.secondedAt || null,
      discussion: Array.isArray(r.discussion) ? r.discussion : [],
      votes: r.votes || { ya: 0, tidak: 0, abstain: 0 },
    };
  }

  /** Map agenda_items → data.js shape. */
  function mapAgenda(rec) {
    const r = rec;
    return {
      id: r.code,
      title: r.title,
      type: (r.type || "").replace(/^./, (c) => c.toUpperCase()),
      duration: r.durationMin || 10,
      status: r.status || "menunggu",
      presenter: r.presenter || "",
      sortOrder: r.sortOrder || 0,
    };
  }

  /** Map candidates → data.js shape. */
  function mapCandidate(rec) {
    const r = rec;
    const initials = (r.name || "")
      .replace(/^(Pn\.|En\.|Cik|Pn |En |Cik )\s*/i, "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
    const colors = ["#0B5394", "#7B1FA2", "#10B981", "#F59E0B", "#E91E63", "#2196F3", "#9C27B0", "#FF5722"];
    return {
      id: r.code,
      pbId: r.id,
      name: r.name,
      age: r.age || null,
      position: r.position || "Ahli Lembaga",
      votes: 0,
      manifesto: r.manifesto || "",
      photo: initials,
      color: colors[(r.sortOrder || 0) % colors.length],
      zone: r.zone || "",
    };
  }

  const api = {
    pb,
    config: CONFIG,
    COLLECTIONS,

    /** Restore a saved session. Safe to call on every page load. */
    async init() {
      if (!pb.isValid) return null;
      try {
        const record = await pb
          .collection("_pb_users_auth_")
          .getOne(pb.authRecord.id);
        pb._saveAuth(pb.authToken, record);
        return record;
      } catch (_) {
        pb._saveAuth("", null);
        return null;
      }
    },

    authContext,
    isAuthenticated() {
      return pb.isValid;
    },

    // ---- auth ----
    loginWithGoogle: () => pb.authWithGoogle(),
    loginWithPassword: (email, pw) => pb.authWithPassword(email, pw),
    requestEmailOTP: (email) => pb.requestEmailOTP(email),
    verifyEmailOTP: (email, token) => pb.verifyEmailOTP(email, token),
    requestSMSOTP: (phone) => pb.requestSMSOTP(phone),
    verifySMSOTP: (phone, token) => pb.verifySMSOTP(phone, token),
    logout: () => pb.logout(),

    // ---- queries ----
    async loadOrganization(orgId) {
      const rec = await pb.collection(COLLECTIONS.organizations).getOne(orgId);
      return {
        id: rec.registrationNo || rec.slug,
        pbId: rec.id,
        name: rec.name,
        shortName: rec.shortName || rec.name,
        registrationNo: rec.registrationNo || "",
        state: rec.state || "",
        zone: rec.zone || "",
        members: 0, // filled by loadMembers count
        quorumPct: (rec.settings && rec.settings.quorumPct) || 25,
        quorumRequired: 0,
        uukRef: (rec.settings && rec.settings.uukRef) || "",
        logoText: (rec.shortName || rec.name || "").slice(0, 2).toUpperCase(),
        logoColor: "#0B5394",
        founded: rec.founded || "",
        plan: rec.plan || "starter",
        renewalDate: rec.settings && rec.settings.renewalDate,
        settings: rec.settings || {},
      };
    },

    async loadMembers(orgId) {
      const list = await pb
        .collection(COLLECTIONS.members)
        .getFullList({
          filter: `organizationId = "${orgId}"`,
          sort: "memberNo",
        });
      return list.items.map(mapMember);
    },

    async loadCurrentAGM(orgId) {
      const rec = await pb.collection(COLLECTIONS.agms).getFirstListItem(
        `organizationId = "${orgId}" && (status = "live" || status = "open" || status = "notice" || status = "closed" || status = "minuted")`
      );
      if (!rec) return null;
      const quorum = await pb.collection(COLLECTIONS.quorum).getFirstListItem(
        `agmId = "${rec.id}"`,
      );
      const att = await pb
        .collection(COLLECTIONS.attendance)
        .getFullList({ filter: `agmId = "${rec.id}"` });

      return {
        id: rec.id,
        code: `AGM-${rec.edition}`,
        pbId: rec.id,
        title: rec.title,
        edition: `AGM Ke-${rec.edition}${rec.fiscalYear ? " (Tahun Kewangan " + rec.fiscalYear + ")" : ""}`,
        date: rec.scheduledAt,
        time: "",
        venue: rec.venue || "",
        mode: rec.mode || "hybrid",
        status: (rec.status || "").toUpperCase(),
        startedAt: rec.startedAt || "",
        elapsed: "",
        quorumPct: quorum ? Number(quorum.pct) : 0,
        quorumRequired: quorum
          ? Math.ceil((quorum.totalMembers * Number(rec.quorumPct)) / 100)
          : 0,
        quorumPresent: att.items.length,
        totalMembers: quorum ? quorum.totalMembers : 0,
        lateNoticeDays: rec.noticeDays || 21,
        noticesSent: 0,
        noticesRead: 0,
        noticesOpened: 0,
      };
    },

    async loadAgenda(agmId) {
      const list = await pb
        .collection(COLLECTIONS.agenda)
        .getFullList({ filter: `agmId = "${agmId}"`, sort: "sortOrder" });
      return list.items.map(mapAgenda);
    },

    async loadCandidates(agmId) {
      const list = await pb
        .collection(COLLECTIONS.candidates)
        .getFullList({ filter: `agmId = "${agmId}"`, sort: "sortOrder" });
      return list.items.map(mapCandidate);
    },

    async loadMotions(agmId) {
      const list = await pb
        .collection(COLLECTIONS.motions)
        .getFullList({ filter: `agmId = "${agmId}"`, sort: "code" });

      // Attach tallies.
      const motions = list.items.map(mapMotion);
      await Promise.all(
        motions.map(async (m) => {
          const votes = await pb
            .collection(COLLECTIONS.votes)
            .getFullList({ filter: `motionId = "${m.pbId}"` });
          m.votes = tally(votes.items);
        })
      );
      return motions;
    },

    async loadQuestions(agmId) {
      const list = await pb
        .collection(COLLECTIONS.questions)
        .getFullList({ filter: `agmId = "${agmId}"`, sort: "-upvotes" });
      return list.items.map((q) => ({
        id: q.id.slice(0, 8),
        from: q.askerId || "-",
        text: q.text,
        category: q.category || "",
        upvotes: q.upvotes || 0,
        status: q.status || "baru",
        grouped: q.groupedCount || 1,
      }));
    },

    async loadActions(orgId) {
      const list = await pb
        .collection(COLLECTIONS.actions)
        .getFullList({ filter: `organizationId = "${orgId}"` });
      return list.items.map((a) => ({
        id: a.id.slice(0, 8),
        title: a.title,
        pic: a.picRole || a.picId || "-",
        due: a.dueDate || "",
        status: a.status || "terbuka",
        fromMotion: a.resolutionId || "",
      }));
    },

    async loadAuditLog(orgId, limit = 200) {
      const list = await pb
        .collection(COLLECTIONS.auditEvents)
        .getFullList({
          filter: `organizationId = "${orgId}"`,
          sort: "-occurredAt",
          limit,
        });
      return list.items.map((e) => ({
        ts: e.occurredAt,
        actor: e.actorName || e.actorId || "-",
        action: e.action,
        detail: (e.payload && e.payload.detail) || e.action,
        hash: e.hash ? e.hash.slice(0, 8) + "…" : "",
        ip: e.payload && e.payload.ip ? e.payload.ip : "—",
        sig: e.hash ? "✓" : "",
      }));
    },

    // ---- subscription lifecycle (non-payment) ------------------
    async listSubscriptions(organizationId) {
      const ctx = requireOrganizationRole(organizationId, ["admin", "secretary"]);
      const list = await pb.collection(COLLECTIONS.subscriptions).getFullList({
        filter: `organizationId = "${ctx.organizationId}"`,
        sort: "-created",
      });
      return list.items || [];
    },

    async getSubscription(subscriptionId) {
      const ctx = requireCommercialAdmin();
      const subscription = await pb.collection(COLLECTIONS.subscriptions).getOne(subscriptionId);
      assertSameOrganization(subscription, ctx);
      return subscription;
    },

    /** Start a subscription record. This only changes lifecycle data; it never charges. */
    async startSubscription({
      organizationId,
      planId,
      billingCycle = "annual",
      trial = false,
      trialDays = 14,
      currentPeriodStart,
      currentPeriodEnd,
    } = {}) {
      const ctx = requireOrganizationRole(organizationId, ["admin"]);
      if (!planId) throw new Error("planId diperlukan untuk langganan.");
      if (!BILLING_CYCLES.includes(billingCycle)) {
        throw new Error("Kitar bil langganan tidak sah.");
      }
      const days = Number(trialDays);
      if (trial && (!Number.isInteger(days) || days < 0 || days > 365)) {
        throw new Error("Tempoh percubaan tidak sah.");
      }
      const start = currentPeriodStart || dateOnlyNow();
      const end = currentPeriodEnd || dateOnlyFromNow(trial ? days : cycleDays(billingCycle));
      const status = trial ? "trialing" : "active";
      return pb.collection(COLLECTIONS.subscriptions).create({
        organizationId: ctx.organizationId,
        planId,
        status,
        billingCycle,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        renewalDate: end,
      });
    },

    async startTrialSubscription(options = {}) {
      return api.startSubscription(Object.assign({}, options, { trial: true }));
    },

    // Short alias for callers that model trial as the primary operation.
    async trialSubscription(options = {}) {
      return api.startTrialSubscription(options);
    },

    async transitionSubscription({ subscriptionId, status } = {}) {
      const ctx = requireCommercialAdmin();
      if (!subscriptionId) throw new Error("subscriptionId diperlukan.");
      if (!SUBSCRIPTION_STATUSES.includes(status)) {
        throw new Error("Status langganan tidak sah.");
      }
      const current = await pb.collection(COLLECTIONS.subscriptions).getOne(subscriptionId);
      assertSameOrganization(current, ctx);
      assertSubscriptionTransition(current.status, status);
      return pb.collection(COLLECTIONS.subscriptions).update(subscriptionId, { status });
    },

    async transitionSubscriptionStatus(options = {}) {
      return api.transitionSubscription(options);
    },

    async renewSubscription({ subscriptionId, currentPeriodStart, currentPeriodEnd } = {}) {
      const ctx = requireCommercialAdmin();
      if (!subscriptionId) throw new Error("subscriptionId diperlukan.");
      const current = await pb.collection(COLLECTIONS.subscriptions).getOne(subscriptionId);
      assertSameOrganization(current, ctx);
      assertSubscriptionTransition(current.status, "active");
      const start = currentPeriodStart || dateOnlyNow();
      const end = currentPeriodEnd || dateOnlyFromNow(cycleDays(current.billingCycle || "annual"));
      return pb.collection(COLLECTIONS.subscriptions).update(subscriptionId, {
        status: "active",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        renewalDate: end,
      });
    },

    async cancelSubscription({ subscriptionId } = {}) {
      return api.transitionSubscription({ subscriptionId, status: "canceled" });
    },

    // ---- post-AGM governance records ----------------------------
    async createAction({ organizationId, orgId, agmId = "", resolutionId = "", title,
      picId = "", picRole = "", dueDate = "", status = "terbuka" } = {}) {
      const ctx = requireGovernanceRole(organizationId || orgId);
      if (!title) throw new Error("Tajuk tindakan diperlukan.");
      if (!["terbuka", "dalam tindakan", "selesai", "lewat"].includes(status)) {
        throw new Error("Status tindakan tidak sah.");
      }
      return pb.collection(COLLECTIONS.actions).create({
        organizationId: ctx.organizationId,
        agmId,
        resolutionId,
        title,
        picId,
        picRole,
        dueDate,
        status,
      });
    },

    async updateAction({ actionId, id, title, agmId, resolutionId, picId, picRole,
      dueDate, status } = {}) {
      const ctx = requireGovernanceRole();
      const recordId = actionId || id;
      if (!recordId) throw new Error("actionId diperlukan.");
      const current = await pb.collection(COLLECTIONS.actions).getOne(recordId);
      assertSameOrganization(current, ctx);
      const patch = definedFields({ title, agmId, resolutionId, picId, picRole, dueDate, status });
      if (patch.status && !["terbuka", "dalam tindakan", "selesai", "lewat"].includes(patch.status)) {
        throw new Error("Status tindakan tidak sah.");
      }
      if (!Object.keys(patch).length) throw new Error("Tiada perubahan tindakan.");
      return pb.collection(COLLECTIONS.actions).update(recordId, patch);
    },

    async createResolution({ organizationId, orgId, agmId, motionId = "", title, passed = false,
      votesYa = 0, votesTidak = 0, votesKecuali = 0, minutedAt = "", documentId = "" } = {}) {
      const ctx = requireGovernanceRole(organizationId || orgId);
      if (!agmId || !title) throw new Error("AGM dan tajuk resolusi diperlukan.");
      return pb.collection(COLLECTIONS.resolutions).create({
        organizationId: ctx.organizationId,
        agmId,
        motionId,
        title,
        passed: !!passed,
        votesYa: nonNegativeNumber(votesYa, "votesYa"),
        votesTidak: nonNegativeNumber(votesTidak, "votesTidak"),
        votesKecuali: nonNegativeNumber(votesKecuali, "votesKecuali"),
        minutedAt,
        documentId,
      });
    },

    async updateResolution({ resolutionId, id, title, passed, votesYa, votesTidak,
      votesKecuali, minutedAt, documentId } = {}) {
      const ctx = requireGovernanceRole();
      const recordId = resolutionId || id;
      if (!recordId) throw new Error("resolutionId diperlukan.");
      const current = await pb.collection(COLLECTIONS.resolutions).getOne(recordId);
      assertSameOrganization(current, ctx);
      const patch = definedFields({ title, passed, minutedAt, documentId });
      for (const [name, value] of Object.entries({ votesYa, votesTidak, votesKecuali })) {
        if (value !== undefined) patch[name] = nonNegativeNumber(value, name);
      }
      if (!Object.keys(patch).length) throw new Error("Tiada perubahan resolusi.");
      return pb.collection(COLLECTIONS.resolutions).update(recordId, patch);
    },

    /** Store evidence metadata and a file; File/Blob values use PocketBase multipart. */
    async createDocument({ organizationId, orgId, agmId = "", category, filename, file,
      mime = "", sizeBytes, sha256 = "" } = {}) {
      const ctx = requireGovernanceRole(organizationId || orgId);
      validateDocument(category, filename, file);
      const body = {
        organizationId: ctx.organizationId,
        agmId,
        category,
        filename,
        file,
        mime,
        sizeBytes: sizeBytes === undefined ? undefined : nonNegativeNumber(sizeBytes, "sizeBytes"),
        sha256,
        uploadedBy: ctx.userId,
      };
      return createDocumentRecord(body);
    },

    async updateDocument({ documentId, id, category, filename, file, mime, sizeBytes, sha256 } = {}) {
      const ctx = requireGovernanceRole();
      const recordId = documentId || id;
      if (!recordId) throw new Error("documentId diperlukan.");
      const current = await pb.collection(COLLECTIONS.documents).getOne(recordId);
      assertSameOrganization(current, ctx);
      if (category !== undefined && !DOCUMENT_CATEGORIES.includes(category)) {
        throw new Error("Kategori dokumen tidak sah.");
      }
      if (filename !== undefined && !filename) throw new Error("Nama fail diperlukan.");
      const patch = definedFields({ category, filename, file, mime, sha256 });
      if (sizeBytes !== undefined) patch.sizeBytes = nonNegativeNumber(sizeBytes, "sizeBytes");
      if (!Object.keys(patch).length) throw new Error("Tiada perubahan dokumen.");
      return updateDocumentRecord(recordId, patch);
    },

    /**
     * Run every global compliance rule for one AGM. Rules are seed/configuration
     * records and are deliberately never copied into the tenant. A check is
     * upserted by (organizationId, agmId, ruleId), making repeated runs safe.
     */
    async runComplianceChecks({ organizationId, orgId, agmId, results, checks, checkedAt } = {}) {
      const ctx = requireComplianceRole(organizationId || orgId);
      if (!agmId) throw new Error("agmId diperlukan.");
      await getOrganizationAGM(agmId, ctx);

      const rules = uniqueComplianceRules(recordsFromList(await pb
        .collection(COLLECTIONS.complianceRules)
        .getFullList({ sort: "code" })));
      const existing = recordsFromList(await pb
        .collection(COLLECTIONS.complianceChecks)
        .getFullList({
          filter: `organizationId = "${escapeFilterValue(ctx.organizationId)}" && agmId = "${escapeFilterValue(agmId)}"`,
          expand: "ruleId",
        }));
      const inputByRule = complianceInputsByRule(results || checks);
      const timestamp = checkedAt || new Date().toISOString();
      if (Number.isNaN(Date.parse(timestamp))) throw new Error("checkedAt tidak sah.");

      const persisted = [];
      for (const rule of rules) {
        const input = inputByRule.get(rule.id) || inputByRule.get(rule.code) ||
          inputByRule.get(rule.checkType) || {};
        const result = input.result || rule.defaultResult || "amaran";
        validateComplianceResult(result);
        const details = input.details === undefined
          ? { note: "Semakan memerlukan pengesahan operasi." }
          : input.details;
        if (details !== null && (typeof details !== "object" || Array.isArray(details))) {
          throw new Error("details semakan mesti objek JSON.");
        }
        const current = existing.find((record) => record.ruleId === rule.id);
        const patch = { result, details, checkedAt: timestamp };
        const record = current
          ? await pb.collection(COLLECTIONS.complianceChecks).update(current.id, patch)
          : await pb.collection(COLLECTIONS.complianceChecks).create({
            organizationId: ctx.organizationId,
            agmId,
            ruleId: rule.id,
            ...patch,
          });
        persisted.push(record);
      }

      return api.getComplianceReport({ organizationId: ctx.organizationId, agmId });
    },

    async createComplianceFinding({ organizationId, orgId, checkId = "", severity,
      message, status = "terbuka", resolvedAt } = {}) {
      const ctx = requireComplianceRole(organizationId || orgId);
      const payload = validateComplianceFinding({ severity, message, status, resolvedAt });
      if (checkId) {
        const check = await pb.collection(COLLECTIONS.complianceChecks).getOne(checkId);
        assertSameOrganization(check, ctx);
        payload.checkId = check.id;
      }
      return pb.collection(COLLECTIONS.complianceFindings).create({
        organizationId: ctx.organizationId,
        ...payload,
      });
    },

    async updateComplianceFinding({ organizationId, findingId, id, checkId,
      severity, message, status, resolvedAt } = {}) {
      const ctx = requireComplianceRole(organizationId);
      const recordId = findingId || id;
      if (!recordId) throw new Error("findingId diperlukan.");
      const current = await pb.collection(COLLECTIONS.complianceFindings).getOne(recordId);
      assertSameOrganization(current, ctx);
      const patch = definedFields({ severity, message, status, resolvedAt });
      if (severity !== undefined && !COMPLIANCE_SEVERITIES.includes(severity)) {
        throw new Error("Severity dapatan tidak sah.");
      }
      if (message !== undefined && (!String(message).trim() || String(message).length > 1000)) {
        throw new Error("Mesej dapatan tidak sah.");
      }
      if (status !== undefined && !COMPLIANCE_FINDING_STATUSES.includes(status)) {
        throw new Error("Status dapatan tidak sah.");
      }
      if (checkId !== undefined) {
        if (checkId) {
          const check = await pb.collection(COLLECTIONS.complianceChecks).getOne(checkId);
          assertSameOrganization(check, ctx);
          patch.checkId = check.id;
        } else {
          patch.checkId = "";
        }
      }
      if (patch.status === "selesai" && patch.resolvedAt === undefined && !current.resolvedAt) {
        patch.resolvedAt = new Date().toISOString();
      } else if (patch.status && patch.status !== "selesai" && patch.resolvedAt === undefined) {
        patch.resolvedAt = "";
      }
      if (!Object.keys(patch).length) throw new Error("Tiada perubahan dapatan.");
      return pb.collection(COLLECTIONS.complianceFindings).update(recordId, patch);
    },

    /** Return one stable shape for API consumers and the dashboard. */
    async getComplianceReport({ organizationId, orgId, agmId } = {}) {
      const ctx = requireComplianceRole(organizationId || orgId);
      if (!agmId) throw new Error("agmId diperlukan.");
      await getOrganizationAGM(agmId, ctx);
      return buildComplianceReport(ctx.organizationId, agmId);
    },

    // Short aliases used by integrations that name the operation as a check.
    runComplianceCheck(options = {}) {
      return api.runComplianceChecks(options);
    },
    addComplianceFinding(options = {}) {
      return api.createComplianceFinding(options);
    },
    editComplianceFinding(options = {}) {
      return api.updateComplianceFinding(options);
    },

    async loadCompliance(orgId, agmId) {
      const report = await buildComplianceReport(orgId, agmId);
      return {
        ...report,
        aktaChips: report.checks.map((check) => ({
          id: check.code || check.ruleId || check.id,
          label: check.label || "",
          status: (check.result || "").toUpperCase(),
          evidence: (check.details && (check.details.evidence || check.details.note)) || "",
        })),
      };
    },

    // ---- mutations ----
    async castVote({ orgId, agmId, motionId, choice }) {
      const ctx = authContext();
      if (!ctx || !ctx.memberId) throw new Error("Not authorised to vote");

      // Append-only: the collection has updateRule/deleteRule = "" so a
      // vote can never be changed or removed once cast.
      const vote = await pb.collection(COLLECTIONS.votes).create({
        organizationId: orgId,
        agmId,
        motionId,
        voterId: ctx.memberId,
        choice,
        castAt: new Date().toISOString(),
      });

      // Write the chained audit event.
      await api.appendAudit(orgId, {
        action: "vote.cast",
        entityType: "votes",
        entityId: vote.id,
        payload: { choice, motionId },
      });

      return vote;
    },

    async checkIn({ orgId, agmId, memberId, method = "qr" }) {
      const rec = await pb.collection(COLLECTIONS.attendance).create({
        organizationId: orgId,
        agmId,
        memberId,
        method,
        checkInAt: new Date().toISOString(),
      });
      await api.refreshQuorum(orgId, agmId);
      return rec;
    },

    async refreshQuorum(orgId, agmId) {
      const [members, att, agm] = await Promise.all([
        pb
          .collection(COLLECTIONS.members)
          .getFullList({ filter: `organizationId = "${orgId}"`, limit: 1, fields: "id" }),
        pb.collection(COLLECTIONS.attendance).getFullList({ filter: `agmId = "${agmId}"` }),
        pb.collection(COLLECTIONS.agms).getOne(agmId),
      ]);
      const total = members.totalItems || att.items.length;
      const present = att.items.length;
      const pct = total ? Number(((present / total) * 100).toFixed(2)) : 0;

      return pb.collection(COLLECTIONS.quorum).create({
        organizationId: orgId,
        agmId,
        totalMembers: total,
        present,
        pct,
        satisfied: pct >= Number(agm.quorumPct || 25),
        capturedAt: new Date().toISOString(),
      });
    },

    /**
     * Append an audit event with a chained SHA-256 hash.
     * prev_hash = hash of the previous event for this org, so the chain is
     * tamper-evident (the same guarantee the prototype UI renders).
     */
    async appendAudit(orgId, { action, entityType, entityId, payload }) {
      const ctx = requireOrganizationContext(orgId);
      if (!action || !entityType || !entityId) {
        throw new Error("Audit action, entityType dan entityId diperlukan.");
      }
      const previous = await pb
        .collection(COLLECTIONS.auditEvents)
        .getFullList({
          filter: `organizationId = "${ctx.organizationId}"`,
          sort: "-occurredAt",
          limit: 1,
        });
      const prev = previous && previous.items && previous.items[0];

      const prevHash = prev ? prev.hash : "GENESIS";
      const occurredAt = new Date().toISOString();
      const material = `${prevHash}|${occurredAt}|${action}|${entityType}|${entityId}|${JSON.stringify(payload || {})}`;

      const hash = await sha256Hex(material);

      return pb.collection(COLLECTIONS.auditEvents).create({
        organizationId: ctx.organizationId,
        actorId: ctx ? ctx.userId : undefined,
        actorName: ctx ? ctx.name : undefined,
        action,
        entityType,
        entityId,
        payload: payload || {},
        prevHash,
        hash,
        occurredAt,
      });
    },

    /**
     * Create the scheduled AGM used by the first organisation onboarding step.
     * The organisation is always taken from the authenticated user's tenant;
     * a supplied organisationId is only accepted when it matches that tenant.
     */
    async createScheduledAGM({
      organizationId,
      title,
      edition,
      fiscalYear = "",
      scheduledAt,
      venue = "",
      mode = "hybrid",
      quorumPct = 25,
      noticeDays = 21,
      settings = {},
    } = {}) {
      const ctx = requireOrganizationRole(organizationId, ["admin", "secretary"]);
      const payload = validateScheduledAGM({
        organizationId: ctx.organizationId,
        title,
        edition,
        fiscalYear,
        scheduledAt,
        venue,
        mode,
        quorumPct,
        noticeDays,
        settings,
      });

      const agm = await pb.collection(COLLECTIONS.agms).create(payload);
      if (!agm || !agm.id) throw new Error("AGM tidak dikembalikan oleh PocketBase.");
      return agm;
    },

    /**
     * Validate the complete import before writing anything, then create rows
     * in input order. This prevents malformed rows and duplicate member
     * numbers from leaving a partially imported batch.
     */
    async bulkImportMembers({ organizationId, members } = {}) {
      const ctx = requireOrganizationRole(organizationId, ["admin", "secretary"]);
      if (!Array.isArray(members) || members.length === 0) {
        throw new Error("Senarai ahli diperlukan untuk import.");
      }

      const payloads = members.map((member, index) =>
        validateImportedMember(member, ctx.organizationId, index)
      );
      const memberNos = new Set();
      for (const payload of payloads) {
        if (memberNos.has(payload.memberNo)) {
          throw new Error(`Nombor ahli berganda dalam import: ${payload.memberNo}`);
        }
        memberNos.add(payload.memberNo);
      }

      const existing = await pb.collection(COLLECTIONS.members).getFullList({
        filter: `organizationId = "${escapeFilterValue(ctx.organizationId)}"`,
        fields: "memberNo",
      });
      const existingNos = new Set((existing && existing.items ? existing.items : [])
        .map((record) => record.memberNo));
      const conflict = payloads.find((payload) => existingNos.has(payload.memberNo));
      if (conflict) {
        throw new Error(`Nombor ahli sudah wujud: ${conflict.memberNo}`);
      }

      const created = [];
      for (const payload of payloads) {
        const record = await pb.collection(COLLECTIONS.members).create(payload);
        if (!record || !record.id) {
          throw new Error(`Rekod ahli tidak dikembalikan untuk ${payload.memberNo}.`);
        }
        created.push(record);
      }

      return {
        organizationId: ctx.organizationId,
        imported: created.length,
        total: payloads.length,
        members: created,
        items: created,
      };
    },

    /** Return the current non-archived AGM and member import progress. */
    async getOnboardingStatus({ organizationId, agmId } = {}) {
      const ctx = requireOrganizationRole(organizationId, ["admin", "secretary"]);
      const [agmList, memberList] = await Promise.all([
        pb.collection(COLLECTIONS.agms).getFullList({
          filter: `organizationId = "${escapeFilterValue(ctx.organizationId)}"`,
          sort: "-scheduledAt",
        }),
        pb.collection(COLLECTIONS.members).getFullList({
          filter: `organizationId = "${escapeFilterValue(ctx.organizationId)}"`,
          fields: "id,eligible",
        }),
      ]);

      const agms = agmList && agmList.items ? agmList.items : [];
      const agm = agmId
        ? agms.find((record) => record.id === agmId) || null
        : agms.find((record) => record.status !== "archived") || null;
      const totalMembers = memberList && Number.isFinite(memberList.totalItems)
        ? memberList.totalItems
        : (memberList && memberList.items ? memberList.items.length : 0);
      const eligibleMembers = (memberList && memberList.items ? memberList.items : [])
        .filter((member) => member.eligible !== false).length;
      const ready = !!agm && totalMembers > 0;

      return {
        organizationId: ctx.organizationId,
        status: ready ? "ready" : (agm ? "members_pending" : "agm_pending"),
        ready,
        onboardingComplete: ready,
        agmId: agm ? agm.id : null,
        agmCreated: !!agm,
        memberCount: totalMembers,
        agm,
        members: {
          total: totalMembers,
          eligible: eligibleMembers,
          imported: totalMembers,
        },
        steps: {
          agmCreated: !!agm,
          membersImported: totalMembers > 0,
        },
      };
    },

    // ---- partner and federation distribution ---------------------
    /** Create a partner owned by the authenticated organization. */
    async createPartner(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.organizationId, ["admin"]);
      const payload = validatePartner({
        organizationId: ctx.organizationId,
        name: input.name,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        commissionPct: input.commissionPct,
        status: input.status,
      });
      return pb.collection(COLLECTIONS.partners).create(payload);
    },

    /** List only partners owned by the authenticated organization. */
    async listPartners(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.organizationId, ["admin"]);
      const list = await pb.collection(COLLECTIONS.partners).getFullList({
        filter: `organizationId = "${escapeFilterValue(ctx.organizationId)}"`,
        sort: "name",
      });
      return list && Array.isArray(list.items) ? list.items : [];
    },

    /** Link an organization to a partner in the same tenant. */
    async linkPartnerOrganization(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.tenantOrganizationId || input.ownerOrgId, ["admin"]);
      if (!input.partnerId) throw new Error("partnerId diperlukan.");
      const targetOrganizationId = input.linkedOrganizationId || input.organizationId;
      if (!targetOrganizationId) throw new Error("organizationId diperlukan.");
      if (targetOrganizationId !== ctx.organizationId) {
        throw new Error("Organisasi pautan mesti berada dalam tenant akaun ini.");
      }

      const partner = await pb.collection(COLLECTIONS.partners).getOne(input.partnerId);
      assertSameOrganization(partner, ctx);
      const referredAt = input.referredAt || new Date().toISOString();
      if (Number.isNaN(Date.parse(referredAt))) throw new Error("Tarikh rujukan tidak sah.");
      const commissionEarned = nonNegativeNumber(
        input.commissionEarned === undefined ? 0 : input.commissionEarned,
        "commissionEarned"
      );
      const contractValue = input.contractValue === undefined
        ? undefined : nonNegativeNumber(input.contractValue, "contractValue");

      return pb.collection(COLLECTIONS.partnerOrgs).create(definedFields({
        partnerId: input.partnerId,
        organizationId: targetOrganizationId,
        referredAt,
        commissionEarned,
        contractValue,
      }));
    },

    async listPartnerOrganizations(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.organizationId, ["admin"]);
      const filter = input.partnerId
        ? `partnerId = "${escapeFilterValue(input.partnerId)}" && organizationId = "${escapeFilterValue(ctx.organizationId)}"`
        : `organizationId = "${escapeFilterValue(ctx.organizationId)}"`;
      const list = await pb.collection(COLLECTIONS.partnerOrgs).getFullList({ filter });
      return list && Array.isArray(list.items) ? list.items : [];
    },

    /** Create a federation owned by the authenticated organization. */
    async createFederation(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.organizationId, ["admin"]);
      const payload = validateFederation({
        ownerOrgId: ctx.organizationId,
        name: input.name,
        registrationNo: input.registrationNo,
        memberCount: input.memberCount,
      });
      return pb.collection(COLLECTIONS.federations).create(payload);
    },

    /** List only federations owned by the authenticated organization. */
    async listFederations(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.organizationId, ["admin"]);
      const list = await pb.collection(COLLECTIONS.federations).getFullList({
        filter: `ownerOrgId = "${escapeFilterValue(ctx.organizationId)}"`,
        sort: "name",
      });
      return list && Array.isArray(list.items) ? list.items : [];
    },

    /**
     * Add a member organization to an owned federation. The denormalized
     * ownerOrgId is always written from auth context, never caller input.
     */
    async linkFederationOrganization(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.tenantOrganizationId || input.ownerOrgId, ["admin"]);
      if (!input.federationId) throw new Error("federationId diperlukan.");
      const targetOrganizationId = input.linkedOrganizationId || input.memberOrganizationId || input.organizationId;
      if (!targetOrganizationId) throw new Error("organizationId diperlukan.");

      const federation = await pb.collection(COLLECTIONS.federations).getOne(input.federationId);
      assertFederationOwner(federation, ctx);
      const joinedAt = input.joinedAt || new Date().toISOString();
      if (Number.isNaN(Date.parse(joinedAt))) throw new Error("Tarikh penyertaan tidak sah.");
      const contributionPct = input.contributionPct === undefined
        ? 0 : Number(input.contributionPct);
      if (!Number.isFinite(contributionPct) || contributionPct < 0 || contributionPct > 100) {
        throw new Error("Peratus sumbangan tidak sah.");
      }

      return pb.collection(COLLECTIONS.federationOrgs).create({
        federationId: input.federationId,
        organizationId: targetOrganizationId,
        joinedAt,
        contributionPct,
        ownerOrgId: ctx.organizationId,
      });
    },

    async listFederationOrganizations(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.organizationId, ["admin"]);
      if (!input.federationId) throw new Error("federationId diperlukan.");
      const federation = await pb.collection(COLLECTIONS.federations).getOne(input.federationId);
      assertFederationOwner(federation, ctx);
      const list = await pb.collection(COLLECTIONS.federationOrgs).getFullList({
        filter: `federationId = "${escapeFilterValue(input.federationId)}"`,
        sort: "joinedAt",
      });
      return list && Array.isArray(list.items) ? list.items : [];
    },

    /** Aggregate linked organization, member, AGM/status, and compliance data. */
    async getFederationRollup(options = {}) {
      const input = normalizeOptions(options);
      const ctx = requireOrganizationRole(input.organizationId, ["admin"]);
      if (!input.federationId) throw new Error("federationId diperlukan.");
      const federation = await pb.collection(COLLECTIONS.federations).getOne(input.federationId);
      assertFederationOwner(federation, ctx);
      const links = await api.listFederationOrganizations({
        organizationId: ctx.organizationId,
        federationId: input.federationId,
      });

      const organizationRollups = await Promise.all(links.map(async (link) => {
        const organizationId = link.organizationId;
        const [members, agms, checks, findings] = await Promise.all([
          pb.collection(COLLECTIONS.members).getFullList({
            filter: `organizationId = "${escapeFilterValue(organizationId)}"`,
            fields: "id",
          }),
          pb.collection(COLLECTIONS.agms).getFullList({
            filter: `organizationId = "${escapeFilterValue(organizationId)}"`,
            fields: "id,status",
          }),
          pb.collection(COLLECTIONS.complianceChecks).getFullList({
            filter: `organizationId = "${escapeFilterValue(organizationId)}"`,
            fields: "id,result",
          }),
          pb.collection(COLLECTIONS.complianceFindings).getFullList({
            filter: `organizationId = "${escapeFilterValue(organizationId)}"`,
            fields: "id,status",
          }),
        ]);
        const agmItems = recordsFromList(agms);
        const checkItems = recordsFromList(checks);
        const findingItems = recordsFromList(findings);
        return {
          organizationId,
          memberCount: countFromList(members),
          agmCount: agmItems.length,
          agmStatusCounts: countBy(agmItems, "status"),
          complianceCounts: countBy(checkItems, "result", "total"),
          complianceFindingCounts: countBy(findingItems, "status", "total"),
        };
      }));

      const agmStatusCounts = sumCountMaps(organizationRollups.map((row) => row.agmStatusCounts));
      const complianceCounts = sumCountMaps(organizationRollups.map((row) => row.complianceCounts));
      const complianceFindingCounts = sumCountMaps(
        organizationRollups.map((row) => row.complianceFindingCounts)
      );
      const memberTotal = organizationRollups.reduce((sum, row) => sum + row.memberCount, 0);
      const agmCount = organizationRollups.reduce((sum, row) => sum + row.agmCount, 0);

      return {
        federationId: federation.id,
        federation,
        organizationCount: organizationRollups.length,
        organizationIds: organizationRollups.map((row) => row.organizationId),
        organizations: organizationRollups,
        memberTotal,
        totalMembers: memberTotal,
        agmCount,
        totalAgms: agmCount,
        agmStatusCounts,
        complianceCounts,
        complianceFindingCounts,
      };
    },

    /**
     * Load the admin-only distribution workspace in one stable shape. A
     * federation report can be unavailable when the PocketBase deployment
     * intentionally limits cross-organization child-record reads; retaining
     * the federation metadata lets the portal show that state without
     * replacing it with fabricated counts.
     */
    async loadDistributionPortal(organizationId) {
      const ctx = requireOrganizationRole(organizationId, ["admin"]);
      const [partners, partnerOrganizations, federations] = await Promise.all([
        api.listPartners({ organizationId: ctx.organizationId }),
        api.listPartnerOrganizations({ organizationId: ctx.organizationId }),
        api.listFederations({ organizationId: ctx.organizationId }),
      ]);
      const federationReports = await Promise.all(federations.map(async (federation) => {
        try {
          return await api.getFederationRollup({
            organizationId: ctx.organizationId,
            federationId: federation.id,
          });
        } catch (_) {
          return {
            federationId: federation.id,
            federation,
            unavailable: true,
            organizations: [],
            organizationCount: 0,
            memberTotal: 0,
            agmCount: 0,
            agmStatusCounts: {},
            complianceCounts: {},
            complianceFindingCounts: {},
          };
        }
      }));
      return {
        organizationId: ctx.organizationId,
        partners,
        partnerOrganizations,
        federations: federationReports,
      };
    },

    // Descriptive aliases for callers that use "summary" terminology.
    getFederationSummary(options = {}) {
      return api.getFederationRollup(options);
    },
    getFederationRollupSummary(options = {}) {
      return api.getFederationRollup(options);
    },
    linkOrganizationToPartner(options = {}) {
      return api.linkPartnerOrganization(options);
    },
    linkOrganizationToFederation(options = {}) {
      return api.linkFederationOrganization(options);
    },

    /**
     * Persist a public assessment and, where the signed-in account has the
     * organisation permissions required by the quotes collection, its draft
     * quote. Public assessments intentionally use an empty organizationId:
     * that is the unauthenticated path allowed by the collection rule.
     */
    async submitAssessment({ data, score, pkg }) {
      const ctx = authContext();
      const organizationId = ctx && ctx.organizationId ? ctx.organizationId : "";

      // An authenticated user without an organisation cannot use the public
      // assessment rule (it explicitly requires an empty auth id).
      if (pb.isValid && !organizationId) {
        throw new Error("Akaun PocketBase tidak dipautkan kepada organisasi.");
      }

      const assessment = await pb.collection(COLLECTIONS.assessments).create({
        organizationId,
        coopName: data.coopName,
        coopReg: data.coopReg,
        state: data.state,
        members: data.members,
        agmDate: data.agmDate || "",
        mode: data.mode,
        expectedAttendance: data.attendance,
        candidates: data.candidates,
        motions: data.motions,
        currentProcess: data.process === "mixed" ? "partial" : data.process,
        needsManaged: !!data.managed,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail,
        answers: {
          // Contact details are already stored in the dedicated fields.
          // Avoid duplicating personal information in the free-form JSON.
          members: data.members,
          mode: data.mode,
          attendance: data.attendance,
          candidates: data.candidates,
          motions: data.motions,
          process: data.process,
          managed: data.managed,
          score: score.total,
          factors: score.factors,
          recommendedPackage: pkg.key,
        },
        complexityScore: score.total,
        status: "lead",
      }, {}, { anonymous: !organizationId });

      if (!assessment || !assessment.id) {
        throw new Error("PocketBase tidak mengembalikan rujukan penilaian.");
      }

      // quotes.create is tenant- and role-protected in the schema. A public
      // assessment is still useful server-side, but cannot create a quote.
      const canCreateQuote = !!organizationId &&
        ctx && (ctx.role === "admin" || ctx.role === "secretary");
      if (!canCreateQuote) {
        return {
          assessment,
          quote: null,
          quoteStatus: "not-available",
          authenticated: !!ctx,
        };
      }

      try {
        const quote = await pb.collection(COLLECTIONS.quotes).create({
          organizationId,
          assessmentId: assessment.id,
          number: makeQuoteNumber(),
          status: "draft",
          validUntil: dateOnlyFromNow(30),
          subtotal: pkg.price,
          tax: 0,
          sstRate: 8,
          total: pkg.price,
          notes: `Anggaran automatik daripada ${pkg.name}. Penilaian ${assessment.id}.`,
          items: [{
            name: `${pkg.name} — AGM`,
            quantity: 1,
            unitPrice: pkg.price,
            total: pkg.price,
          }],
        });
        return { assessment, quote, quoteStatus: "created", authenticated: true };
      } catch (error) {
        return {
          assessment,
          quote: null,
          quoteStatus: "failed",
          quoteError: error,
          authenticated: true,
        };
      }
    },

    /** Create the first invoice for an accepted/draft quote. */
    async createInvoiceFromQuote({ quoteId, dueDays = 14 }) {
      const ctx = requireCommercialStaff();
      const quote = await pb.collection(COLLECTIONS.quotes).getOne(quoteId);
      if (!quote || quote.organizationId !== ctx.organizationId) {
        throw new Error("Sebut harga tidak ditemui dalam organisasi ini.");
      }
      if (!Number.isFinite(Number(quote.total)) || Number(quote.total) < 0) {
        throw new Error("Jumlah sebut harga tidak sah.");
      }

      const existing = await pb.collection(COLLECTIONS.invoices).getFullList({
        filter: `quoteId = "${quoteId}"`, limit: 1,
      });
      if (existing && existing.items && existing.items.length) return existing.items[0];

      const invoice = await pb.collection(COLLECTIONS.invoices).create({
        organizationId: ctx.organizationId,
        quoteId,
        number: makeInvoiceNumber(),
        status: "unpaid",
        issuedAt: new Date().toISOString(),
        dueAt: dateOnlyFromNow(Number.isInteger(dueDays) && dueDays >= 0 ? dueDays : 14),
        amount: Number(quote.total),
        items: quote.items || [],
      });
      if (!invoice || !invoice.id) throw new Error("Invois tidak dikembalikan oleh PocketBase.");
      return invoice;
    },

    /** Record a payment intent without pretending a gateway succeeded. */
    async createPayment({ invoiceId, method, amount, reference = "" }) {
      if (!CONFIG.paymentDemo) {
        throw new Error("Gerbang bayaran sebenar belum dikonfigurasi; aktifkan paymentDemo untuk aliran demo.");
      }
      const ctx = requireCommercialStaff();
      const invoice = await pb.collection(COLLECTIONS.invoices).getOne(invoiceId);
      if (!invoice || invoice.organizationId !== ctx.organizationId) {
        throw new Error("Invois tidak ditemui dalam organisasi ini.");
      }
      const paidAmount = Number(amount);
      if (!Number.isFinite(paidAmount) || paidAmount <= 0 || paidAmount > Number(invoice.amount)) {
        throw new Error("Jumlah bayaran tidak sah.");
      }
      const allowed = ["fpx", "card", "bank_transfer", "manual", "google_pay"];
      if (!allowed.includes(method)) throw new Error("Kaedah bayaran tidak disokong.");

      const payment = await pb.collection(COLLECTIONS.payments).create({
        organizationId: ctx.organizationId,
        invoiceId,
        method,
        reference: String(reference || "").slice(0, 100),
        amount: paidAmount,
        status: "pending",
      });
      if (!payment || !payment.id) throw new Error("Bayaran tidak dikembalikan oleh PocketBase.");
      return Object.assign({}, payment, { demo: true, paymentMode: "demo" });
    },

    // ---- realtime ----
    subscribeVotes(agmId, cb) {
      return pb
        .collection(COLLECTIONS.votes)
        .subscribe(agmId, cb);
    },
    subscribeAttendance(agmId, cb) {
      return pb
        .collection(COLLECTIONS.attendance)
        .subscribe(agmId, cb);
    },
    subscribeMotions(agmId, cb) {
      return pb
        .collection(COLLECTIONS.motions)
        .subscribe(agmId, cb);
    },

    // ---- composite loaders (data.js-shaped output) ----
    async loadDashboard() {
      const ctx = authContext();
      if (!ctx || !ctx.organizationId) throw new Error("No organization bound");

      const orgId = ctx.organizationId;
      const [organization, agm] = await Promise.all([
        api.loadOrganization(orgId),
        api.loadCurrentAGM(orgId),
      ]);

      const [members, actions, auditLog] = await Promise.all([
        api.loadMembers(orgId),
        api.loadActions(orgId),
        api.loadAuditLog(orgId),
      ]);
      const [agenda, candidates, motions, questions, compliance] = agm
        ? await Promise.all([
          api.loadAgenda(agm.pbId),
          api.loadCandidates(agm.pbId),
          api.loadMotions(agm.pbId),
          api.loadQuestions(agm.pbId),
          api.loadCompliance(orgId, agm.pbId),
        ])
        : [[], [], [], [], {
          organizationId: orgId,
          agmId: "",
          score: 0,
          counts: { total: 0, lulus: 0, amaran: 0, gagal: 0 },
          checkCounts: { total: 0, lulus: 0, amaran: 0, gagal: 0 },
          findingCounts: { total: 0, terbuka: 0, "dalam-progress": 0, selesai: 0 },
          openFindings: [],
          openFindingCount: 0,
          checks: [],
          findings: [],
          aktaChips: [],
        }];

      organization.members = (agm && agm.totalMembers) || members.length;
      organization.quorumRequired = agm ? agm.quorumRequired : 0;

      return {
        cooperative: organization,
        currentUser: {
          id: ctx.memberId || ctx.userId,
          name: ctx.name,
          role: ctx.role,
          avatar: (ctx.name || "?").slice(0, 2).toUpperCase(),
          language: "BM",
        },
        members,
        agm,
        agenda,
        candidates,
        motions,
        questions,
        actions,
        auditLog,
        compliance,
        health: {
          activeSessions: agm ? agm.quorumPresent : 0,
          wsLatency: 0,
          bandwidth: 0,
        },
        financialSummary: (organization.settings &&
          organization.settings.financialSummary) || {
          revenue: "—",
          netProfit: "—",
          dividend: "—",
          totalAssets: "—",
          totalLiabilities: "—",
          yoyProfit: "—",
        },
        languages: ["Bahasa Melayu", "English"],
        source: "pocketbase",
      };
    },
  };

  // ---- helpers ----
  function tally(votes) {
    const t = { ya: 0, tidak: 0, abstain: 0, total: votes.length };
    votes.forEach((v) => {
      if (v.choice === "ya") t.ya++;
      else if (v.choice === "tidak") t.tidak++;
      else t.abstain++;
    });
    return t;
  }

  function makeQuoteNumber() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `AGMX-${stamp}-${suffix}`;
  }

  function makeInvoiceNumber() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `INV-${stamp}-${suffix}`;
  }

  function requireCommercialStaff() {
    const ctx = authContext();
    if (!ctx || !ctx.organizationId || (ctx.role !== "admin" && ctx.role !== "secretary")) {
      throw new Error("Akaun admin atau setiausaha organisasi diperlukan.");
    }
    return ctx;
  }

  function requireOrganizationContext(organizationId) {
    const ctx = authContext();
    if (!ctx || !ctx.organizationId) {
      throw new Error("Akaun PocketBase yang dipautkan kepada organisasi diperlukan.");
    }
    if (organizationId && ctx.organizationId !== organizationId) {
      throw new Error("Rekod bukan milik organisasi akaun ini.");
    }
    return ctx;
  }

  function requireOrganizationRole(organizationId, roles) {
    const ctx = requireOrganizationContext(organizationId);
    if (roles && !roles.includes(ctx.role)) {
      throw new Error("Peranan tidak dibenarkan untuk operasi organisasi ini.");
    }
    return ctx;
  }

  function requireCommercialAdmin() {
    return requireOrganizationRole(undefined, ["admin"]);
  }

  function requireGovernanceRole(organizationId) {
    return requireOrganizationRole(organizationId, GOVERNANCE_ROLES);
  }

  function requireComplianceRole(organizationId) {
    const ctx = requireOrganizationContext(organizationId);
    // Match the PocketBase collection rules while keeping the check explicit
    // in the client: a member may read some governance data but cannot mutate
    // compliance records or run an organisation-wide check.
    if (ctx.role === "member") {
      throw new Error("Peranan ahli tidak dibenarkan untuk operasi pematuhan.");
    }
    return ctx;
  }

  function normalizeOptions(options) {
    return typeof options === "string" ? { organizationId: options } : (options || {});
  }

  function assertSameOrganization(record, ctx) {
    if (!record || !record.id || record.organizationId !== ctx.organizationId) {
      throw new Error("Rekod tidak ditemui dalam organisasi ini.");
    }
  }

  function assertFederationOwner(record, ctx) {
    if (!record || !record.id || record.ownerOrgId !== ctx.organizationId) {
      throw new Error("Federasi tidak ditemui dalam organisasi ini.");
    }
  }

  async function getOrganizationAGM(agmId, ctx) {
    const agm = await pb.collection(COLLECTIONS.agms).getOne(agmId);
    assertSameOrganization(agm, ctx);
    return agm;
  }

  function validateComplianceResult(result) {
    if (!COMPLIANCE_RESULTS.includes(result)) {
      throw new Error("Keputusan pematuhan tidak sah.");
    }
  }

  function complianceInputsByRule(input) {
    const map = new Map();
    if (Array.isArray(input)) {
      input.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const key = item.ruleId || item.ruleCode || item.code || item.checkType;
        if (key) map.set(String(key), item);
      });
      return map;
    }
    if (input && typeof input === "object") {
      Object.entries(input).forEach(([key, value]) => {
        map.set(String(key), typeof value === "string" ? { result: value } : (value || {}));
      });
    }
    return map;
  }

  function uniqueComplianceRules(rules) {
    const seen = new Set();
    return rules.filter((rule) => {
      const key = rule && (rule.id || rule.code);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function validateComplianceFinding({ severity, message, status, resolvedAt }) {
    if (!COMPLIANCE_SEVERITIES.includes(severity)) {
      throw new Error("Severity dapatan tidak sah.");
    }
    const text = String(message || "").trim();
    if (!text || text.length > 1000) throw new Error("Mesej dapatan tidak sah.");
    if (!COMPLIANCE_FINDING_STATUSES.includes(status)) {
      throw new Error("Status dapatan tidak sah.");
    }
    if (resolvedAt !== undefined && resolvedAt !== "" && Number.isNaN(Date.parse(resolvedAt))) {
      throw new Error("Tarikh penyelesaian dapatan tidak sah.");
    }
    return { severity, message: text, status, resolvedAt: resolvedAt || "" };
  }

  async function buildComplianceReport(organizationId, agmId) {
    const [rulesResponse, checksResponse, findingsResponse] = await Promise.all([
      pb.collection(COLLECTIONS.complianceRules).getFullList({ sort: "code" }),
      pb.collection(COLLECTIONS.complianceChecks).getFullList({
        filter: `organizationId = "${escapeFilterValue(organizationId)}" && agmId = "${escapeFilterValue(agmId)}"`,
        expand: "ruleId",
        sort: "checkedAt",
      }),
      pb.collection(COLLECTIONS.complianceFindings).getFullList({
        filter: `organizationId = "${escapeFilterValue(organizationId)}"`,
        sort: "status",
      }),
    ]);
    const rules = uniqueComplianceRules(recordsFromList(rulesResponse));
    const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
    const checks = recordsFromList(checksResponse).map((record) => {
      const expanded = record.expand && record.expand.ruleId;
      const rule = expanded || ruleById.get(record.ruleId) || {};
      return {
        id: record.id,
        organizationId: record.organizationId,
        agmId: record.agmId,
        ruleId: record.ruleId,
        code: rule.code || record.ruleId,
        act: rule.act || "",
        label: rule.label || "",
        description: rule.description || "",
        severity: rule.severity || "info",
        checkType: rule.checkType || "",
        result: record.result,
        details: record.details || {},
        checkedAt: record.checkedAt,
      };
    });
    const checkIds = new Set(checks.map((check) => check.id));
    const findings = recordsFromList(findingsResponse)
      // Findings are reportable for an AGM only through its compliance check;
      // the existing schema intentionally leaves checkId optional for future
      // organisation-level findings.
      .filter((finding) => finding.checkId && checkIds.has(finding.checkId))
      .map((finding) => ({
        id: finding.id,
        organizationId: finding.organizationId,
        checkId: finding.checkId || "",
        severity: finding.severity,
        message: finding.message,
        status: finding.status,
        resolvedAt: finding.resolvedAt || "",
      }));
    const counts = { total: checks.length, lulus: 0, amaran: 0, gagal: 0 };
    checks.forEach((check) => {
      if (Object.prototype.hasOwnProperty.call(counts, check.result)) counts[check.result] += 1;
    });
    const findingCounts = { total: findings.length, terbuka: 0, "dalam-progress": 0, selesai: 0 };
    findings.forEach((finding) => {
      if (Object.prototype.hasOwnProperty.call(findingCounts, finding.status)) {
        findingCounts[finding.status] += 1;
      }
    });
    const openFindings = findings.filter((finding) => finding.status !== "selesai");
    return {
      organizationId,
      agmId,
      score: counts.total
        ? Math.round(((counts.lulus + (counts.amaran * 0.5)) / counts.total) * 100)
        : 0,
      counts,
      checkCounts: counts,
      findingCounts,
      openFindings,
      openFindingCount: openFindings.length,
      checks,
      findings,
    };
  }

  function validatePartner(input) {
    const name = String(input.name || "").trim();
    const contactName = String(input.contactName || "").trim();
    const contactEmail = String(input.contactEmail || "").trim();
    const contactPhone = String(input.contactPhone || "").trim();
    if (!name || name.length > 200) throw new Error("Nama rakan kongsi tidak sah.");
    if (!contactName || contactName.length > 200) {
      throw new Error("Nama hubungan rakan kongsi tidak sah.");
    }
    if (!/^\S+@\S+\.\S+$/.test(contactEmail) || contactEmail.length > 200) {
      throw new Error("Emel rakan kongsi tidak sah.");
    }
    if (contactPhone.length > 30) throw new Error("Telefon rakan kongsi melebihi had.");
    const commissionPct = input.commissionPct === undefined ? 10 : Number(input.commissionPct);
    if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
      throw new Error("Peratus komisen tidak sah.");
    }
    const status = input.status === undefined ? "active" : String(input.status);
    if (!["active", "inactive", "suspended"].includes(status)) {
      throw new Error("Status rakan kongsi tidak sah.");
    }
    return {
      organizationId: input.organizationId,
      name,
      contactName,
      contactEmail,
      contactPhone,
      commissionPct,
      status,
    };
  }

  function validateFederation(input) {
    const name = String(input.name || "").trim();
    const registrationNo = String(input.registrationNo || "").trim();
    const memberCount = input.memberCount === undefined ? 0 : Number(input.memberCount);
    if (!name || name.length > 200) throw new Error("Nama federasi tidak sah.");
    if (registrationNo.length > 50) throw new Error("Nombor pendaftaran federasi melebihi had.");
    if (!Number.isFinite(memberCount) || memberCount < 0) {
      throw new Error("Jumlah ahli federasi tidak sah.");
    }
    return {
      name,
      ownerOrgId: input.ownerOrgId,
      registrationNo,
      memberCount,
    };
  }

  function recordsFromList(list) {
    if (Array.isArray(list)) return list;
    return list && Array.isArray(list.items) ? list.items : [];
  }

  function countFromList(list) {
    if (list && Number.isFinite(Number(list.totalItems))) return Number(list.totalItems);
    return recordsFromList(list).length;
  }

  function countBy(records, field, totalKey) {
    const counts = {};
    records.forEach((record) => {
      const key = record && record[field] ? String(record[field]) : "unknown";
      counts[key] = (counts[key] || 0) + 1;
    });
    if (totalKey) counts.total = records.length;
    return counts;
  }

  function sumCountMaps(maps) {
    return maps.reduce((total, counts) => {
      Object.keys(counts || {}).forEach((key) => {
        total[key] = (total[key] || 0) + Number(counts[key] || 0);
      });
      return total;
    }, {});
  }

  function assertSubscriptionTransition(from, to) {
    const allowed = SUBSCRIPTION_TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
      throw new Error(`Peralihan langganan tidak sah: ${from || "unknown"} → ${to}.`);
    }
  }

  function cycleDays(billingCycle) {
    return billingCycle === "monthly" ? 30 : 365;
  }

  function dateOnlyNow() {
    return new Date().toISOString().slice(0, 10);
  }

  function definedFields(fields) {
    return Object.keys(fields).reduce((out, key) => {
      if (fields[key] !== undefined) out[key] = fields[key];
      return out;
    }, {});
  }

  function nonNegativeNumber(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`${field} mesti nombor tidak negatif.`);
    }
    return number;
  }

  function validateDocument(category, filename, file) {
    if (!DOCUMENT_CATEGORIES.includes(category)) throw new Error("Kategori dokumen tidak sah.");
    if (!filename) throw new Error("Nama fail diperlukan.");
    if (file === undefined || file === null || file === "") throw new Error("Fail diperlukan.");
  }

  function isBinaryUpload(value) {
    return typeof Blob === "function" && value instanceof Blob;
  }

  function isFormData(value) {
    return typeof FormData === "function" && value instanceof FormData;
  }

  function makeFormData(body) {
    if (typeof FormData !== "function") throw new Error("Muat naik fail memerlukan FormData.");
    const form = new FormData();
    Object.keys(body).forEach((key) => {
      const value = body[key];
      if (value === undefined || value === null) return;
      if (typeof value === "object" && !isBinaryUpload(value)) {
        form.append(key, JSON.stringify(value));
      } else {
        form.append(key, value);
      }
    });
    return form;
  }

  function createDocumentRecord(body) {
    return pb.collection(COLLECTIONS.documents).create(
      body,
      {},
      { multipart: isBinaryUpload(body.file) }
    );
  }

  function updateDocumentRecord(id, body) {
    return pb.collection(COLLECTIONS.documents).update(
      id,
      body,
      { multipart: isBinaryUpload(body.file) }
    );
  }

  function validateScheduledAGM(input) {
    const title = String(input.title || "").trim();
    if (!title || title.length > 300) throw new Error("Tajuk AGM tidak sah.");

    const edition = Number(input.edition);
    if (!Number.isSafeInteger(edition) || edition < 1) {
      throw new Error("Edisi AGM mesti nombor bulat positif.");
    }

    const scheduledAt = String(input.scheduledAt || "").trim();
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
      throw new Error("Tarikh AGM tidak sah.");
    }

    const mode = String(input.mode || "");
    if (!["physical", "online", "hybrid"].includes(mode)) {
      throw new Error("Mod AGM tidak disokong.");
    }

    const quorumPct = Number(input.quorumPct);
    if (!Number.isFinite(quorumPct) || quorumPct < 0 || quorumPct > 100) {
      throw new Error("Peratus kuorum tidak sah.");
    }
    const noticeDays = Number(input.noticeDays);
    if (!Number.isSafeInteger(noticeDays) || noticeDays < 0) {
      throw new Error("Hari notis mesti nombor bulat tidak negatif.");
    }

    const fiscalYear = String(input.fiscalYear || "").trim();
    const venue = String(input.venue || "").trim();
    if (fiscalYear.length > 20 || venue.length > 300) {
      throw new Error("Maklumat AGM melebihi had medan.");
    }
    if (!input.settings || typeof input.settings !== "object" || Array.isArray(input.settings)) {
      throw new Error("Tetapan AGM mesti objek JSON.");
    }

    return {
      organizationId: input.organizationId,
      title,
      edition,
      fiscalYear,
      scheduledAt,
      venue,
      mode,
      status: "planned",
      quorumPct,
      noticeDays,
      settings: input.settings,
    };
  }

  function validateImportedMember(member, organizationId, index) {
    if (!member || typeof member !== "object" || Array.isArray(member)) {
      throw new Error(`Rekod ahli pada baris ${index + 1} tidak sah.`);
    }
    const memberNo = String(member.memberNo || "").trim();
    const name = String(member.name || "").trim();
    if (!memberNo || memberNo.length > 30) {
      throw new Error(`Nombor ahli pada baris ${index + 1} tidak sah.`);
    }
    if (!name || name.length > 200) {
      throw new Error(`Nama ahli pada baris ${index + 1} tidak sah.`);
    }

    const email = String(member.email || "").trim();
    if (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200)) {
      throw new Error(`Emel ahli pada baris ${index + 1} tidak sah.`);
    }
    const ic = String(member.ic || "").trim();
    const phone = String(member.phone || "").trim();
    if (ic.length > 20 || phone.length > 20) {
      throw new Error(`Maklumat hubungan pada baris ${index + 1} melebihi had.`);
    }

    const shares = member.shares === undefined ? 0 : Number(member.shares);
    const arrears = member.arrears === undefined ? 0 : Number(member.arrears);
    if (!Number.isFinite(shares) || shares < 0 || !Number.isFinite(arrears) || arrears < 0) {
      throw new Error(`Nilai saham atau tunggakan pada baris ${index + 1} tidak sah.`);
    }
    const age = member.age === undefined || member.age === null || member.age === ""
      ? undefined : Number(member.age);
    if (age !== undefined && (!Number.isSafeInteger(age) || age < 0 || age > 150)) {
      throw new Error(`Umur ahli pada baris ${index + 1} tidak sah.`);
    }
    const status = member.status === undefined ? "Aktif" : String(member.status);
    if (!["Aktif", "Tunggakan", "Berehat", "Keluar"].includes(status)) {
      throw new Error(`Status ahli pada baris ${index + 1} tidak sah.`);
    }
    const joinedAt = member.joinedAt === undefined ? "" : String(member.joinedAt).trim();
    if (joinedAt && Number.isNaN(Date.parse(joinedAt))) {
      throw new Error(`Tarikh keahlian pada baris ${index + 1} tidak sah.`);
    }

    const payload = {
      organizationId,
      memberNo,
      name,
      ic,
      phone,
      email,
      shares,
      status,
      arrears,
      eligible: member.eligible === undefined ? true : Boolean(member.eligible),
    };
    if (age !== undefined) payload.age = age;
    if (joinedAt) payload.joinedAt = joinedAt;
    if (member.proxyOf) payload.proxyOf = String(member.proxyOf);
    if (member.userId) payload.userId = String(member.userId);
    return payload;
  }

  function escapeFilterValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function dateOnlyFromNow(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  async function sha256Hex(str) {
    if (window.crypto && window.crypto.subtle) {
      const buf = await window.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(str)
      );
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    // Non-secure context fallback (http on a LAN) — not cryptographically
    // strong; production must run behind HTTPS.
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return "weak-" + (h >>> 0).toString(16);
  }

  // ---- expose ----
  window.AGMX_API = api;
  window.AGMX_PB = pb;
})();
