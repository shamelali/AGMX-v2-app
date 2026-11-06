/* ============================================================
   AGMX — Login View (Google Auth + email/password + demo mode)
   ------------------------------------------------------------
   Loaded by app.html; supabase-client.js is a deferred module.
   Exposes window.AGMX_LOGIN.render(container)
   ============================================================ */

(function () {
  "use strict";

  // Lazy API access: supabase-client.js is a deferred module, so
  // window.AGMX_API may not be set when this IIFE runs. Access at call time.
  function api() {
    if (!window.AGMX_API) throw new Error(t("errNoClient"));
    return window.AGMX_API;
  }

  // Supabase methods resolve to { data, error } instead of rejecting, so the
  // error has to be turned into a throw for the catch blocks below to show it.
  async function unwrap(promise) {
    const res = await promise;
    if (res && res.error) throw new Error(res.error.message || String(res.error));
    return res;
  }

  const T = {
    BM: {
      title: "Log masuk untuk mentadbir",
      tagline: "Sistem Operasi Tadbir Urus Koperasi",
      google: "Teruskan dengan Google",
      googleHint: "Paling cepat untuk ahli komite",
      divider: "atau",
      email: "E-mel",
      emailBtn: "Teruskan dengan e-mel",
      password: "Kata laluan",
      signIn: "Log masuk",
      forgot: "Lupa kata laluan?",
      resetSent: "Pautan set semula telah dihantar ke",
      invalidCredentials: "E-mel atau kata laluan tidak sah",
      demo: "Demo — masuk tanpa akaun",
      demoHint: "Guna data simulasi KOPEMAJU",
      checking: "Memeriksa status…",
      errNoPB: "Backend tidak dijangkau",
      errNoClient: "Klien backend belum dimuat — pastikan supabaseUrl dan supabaseAnonKey ditetapkan dalam config.js",
      rolePick: "Pilih Peranan Anda",
      member: "Ahli",
      secretary: "Setiausaha",
      chairman: "Pengerusi",
      treasurer: "Bendahari",
      back: "Kembali",
    },
    EN: {
      title: "Sign in to administer",
      tagline: "Cooperative Governance Operating System",
      google: "Continue with Google",
      googleHint: "Fastest for committee members",
      divider: "or",
      email: "Email",
      emailBtn: "Continue with email",
      password: "Password",
      signIn: "Sign in",
      forgot: "Forgot password?",
      resetSent: "A reset link has been sent to",
      invalidCredentials: "Invalid email or password",
      demo: "Demo — sign in without an account",
      demoHint: "Uses simulated KOPEMAJU data",
      checking: "Checking status…",
      errNoPB: "Backend unreachable",
      errNoClient: "Backend client not loaded — set supabaseUrl and supabaseAnonKey in config.js",
      rolePick: "Choose Your Role",
      member: "Member",
      secretary: "Secretary",
      chairman: "Chairman",
      treasurer: "Treasurer",
      back: "Back",
    },
  };

  let lang = "BM";
  try {
    const q = new URLSearchParams(location.search).get("lang");
    const pref = (q === "en" || q === "ms") ? q : (localStorage.getItem("agmx-lang") || "");
    lang = pref === "en" ? "EN" : "BM";
  } catch (_) { /* default BM */ }
  const t = (k) => (lang === "EN" ? T.EN : T.BM)[k];

  let state = {
    step: "choose", // choose | email | role
    roles: ["member", "secretary", "chairman", "treasurer"],
  };

  // ---- render ----
  function render(root) {
    const cls = "login-view agmx-login";
    root.innerHTML = "";

    const card = document.createElement("div");
    card.className = cls;

    // Header
    const head = document.createElement("div");
    head.className = "login-head";
    head.innerHTML = `
      <div class="login-logo" aria-hidden="true">AG</div>
      <h1 class="login-title">${t("tagline")}</h1>
      <p class="login-sub">${t("title")}</p>
    `;

    // Body depends on step
    const body = document.createElement("div");
    body.className = "login-body";
    renderStep(body);

    // Status line lives outside the steps so every step can report into it.
    const status = document.createElement("p");
    status.className = "login-status";
    status.setAttribute("role", "status");
    status.id = "login-status";

    card.append(head, body, status);

    // Language toggle — shared preference with the rest of the site
    const langBtn = document.createElement("button");
    langBtn.type = "button";
    langBtn.className = "btn btn-ghost btn-sm login-lang";
    langBtn.style.cssText = "min-width:44px;font-weight:800;";
    langBtn.textContent = lang === "BM" ? "EN" : "BM";
    langBtn.setAttribute("aria-label", lang === "BM" ? "Switch to English" : "Tukar ke Bahasa Melayu");
    langBtn.addEventListener("click", () => {
      const next = lang === "BM" ? "en" : "ms";
      try { localStorage.setItem("agmx-lang", next); } catch (_) {}
      const u = new URL(location.href);
      if (next === "en") u.searchParams.set("lang", "en"); else u.searchParams.delete("lang");
      location.href = u.toString();
    });
    const langRow = document.createElement("div");
    langRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding:0 4px;";
    const themeBtn = document.createElement("button");
    themeBtn.type = "button";
    themeBtn.className = "btn btn-ghost btn-sm";
    themeBtn.setAttribute("data-agmx-theme-toggle", "");
    themeBtn.style.cssText = "min-width:84px;font-weight:700;";
    langRow.append(themeBtn, langBtn);
    card.insertBefore(langRow, body);
    root.appendChild(card);
    if (window.AGMX_THEME) window.AGMX_THEME.sync();

    // Focus the first input for keyboard users
    const first = card.querySelector("input, button");
    if (first) first.focus();
  }

  function renderStep(body) {
    body.innerHTML = "";
    switch (state.step) {
      case "email":
        return renderEmailForm(body);
      case "role":
        return renderRolePick(body);
      default:
        return renderChoose(body);
    }
  }

  function rerender() {
    const root = document.querySelector(".login-view")?.parentElement;
    root && render(root);
  }

  // ---- step: choose method ----
  function renderChoose(body) {
    const wrap = document.createElement("div");
    wrap.className = "login-methods";

    // Google
    const g = document.createElement("button");
    g.className = "btn btn-google btn-lg btn-block";
    g.type = "button";
    g.innerHTML = `
      <svg class="google-g" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/>
        <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"/>
        <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 6.68 9.14 4.75 12 4.75Z"/>
      </svg>
      <span>${t("google")}</span>
    `;
    g.addEventListener("click", onGoogle);
    wrap.appendChild(g);

    const hint = document.createElement("p");
    hint.className = "login-hint";
    hint.textContent = t("googleHint");
    wrap.appendChild(hint);

    // Divider
    const div = document.createElement("div");
    div.className = "login-divider";
    div.innerHTML = `<span>${t("divider")}</span>`;
    wrap.appendChild(div);

    // Email + password
    const e = document.createElement("button");
    e.className = "btn btn-outline btn-lg btn-block";
    e.type = "button";
    e.textContent = t("emailBtn");
    e.addEventListener("click", () => {
      state.step = "email";
      rerender();
    });
    wrap.appendChild(e);

    // Demo
    if (window.AGMX_API?.config?.demoMode) {
      const d = document.createElement("button");
      d.className = "btn btn-ghost btn-block login-demo";
      d.type = "button";
      d.innerHTML = `<span>${t("demo")}</span><small>${t("demoHint")}</small>`;
      d.addEventListener("click", () => {
        window.AGMX_LOGIN.onSuccess?.({ demo: true });
      });
      wrap.appendChild(d);
    }

    body.appendChild(wrap);
  }

  // ---- step: email + password ----
  function renderEmailForm(body) {
    const form = document.createElement("form");
    form.className = "login-form";
    form.innerHTML = `
      <label class="field">
        <span class="field-label">${t("email")}</span>
        <input class="input input-lg" type="email" name="email"
               autocomplete="email" inputmode="email" placeholder="setiausaha@koperasi.my" required>
      </label>
      <label class="field">
        <span class="field-label">${t("password")}</span>
        <input class="input input-lg" type="password" name="password"
               autocomplete="current-password" required>
      </label>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${t("signIn")}</button>
      <button class="btn btn-ghost btn-block" type="button" data-forgot>${t("forgot")}</button>
      <button class="btn btn-ghost btn-block" type="button" data-back>${t("back")}</button>
    `;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.elements.email.value.trim();
      const status = document.getElementById("login-status");
      try {
        const res = await unwrap(api().loginWithEmail(email, form.elements.password.value));
        if (!res?.data?.session) throw new Error(t("invalidCredentials"));
        state.step = "role";
        window.AGMX_LOGIN.lastAuth = res;
        rerender();
      } catch (err) {
        if (status) {
          status.textContent = err.message || t("invalidCredentials");
          status.classList.add("is-error");
        }
      }
    });

    const forgot = form.querySelector("[data-forgot]");
    forgot.addEventListener("click", async () => {
      const email = form.elements.email.value.trim();
      const status = document.getElementById("login-status");
      forgot.disabled = true;
      try {
        await unwrap(api().requestPasswordReset(email));
        if (status) {
          status.textContent = `${t("resetSent")} ${email}`;
          status.classList.remove("is-error");
        }
      } catch (err) {
        if (status) {
          status.textContent = err.message || t("errNoPB");
          status.classList.add("is-error");
        }
      } finally {
        forgot.disabled = false;
      }
    });

    form.querySelector("[data-back]").addEventListener("click", () => {
      state.step = "choose";
      rerender();
    });

    body.appendChild(form);
  }

  // ---- step: role picker ----
  function renderRolePick(body) {
    const wrap = document.createElement("div");
    wrap.className = "login-roles";
    const h = document.createElement("p");
    h.className = "login-sent";
    h.textContent = t("rolePick");
    wrap.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "role-grid";
    state.roles.forEach((r) => {
      const b = document.createElement("button");
      b.className = "role-card";
      b.type = "button";
      b.textContent = t(r);
      b.addEventListener("click", () => {
        window.AGMX_LOGIN.onSuccess?.({ role: r, auth: window.AGMX_LOGIN.lastAuth });
      });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    body.appendChild(wrap);
  }

  // ---- handlers ----
  async function onGoogle() {
    const status = document.getElementById("login-status");
    if (status) {
      status.textContent = t("checking");
      status.classList.remove("is-error");
    }
    try {
      await api().loginWithGoogle();
      // signInWithOAuth navigates away; nothing after this runs in the
      // normal flow.
    } catch (err) {
      if (status) {
        status.textContent = err.message || t("errNoPB");
        status.classList.add("is-error");
      }
    }
  }

  // ---- expose ----
  window.AGMX_LOGIN = {
    render,
    setLang(l) {
      lang = l;
    },
    onSuccess: null, // set by app.js
    lastAuth: null,
  };
})();
