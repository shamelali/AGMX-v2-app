/* ============================================================
   AGMX — Login View (Google Auth + OTP + demo mode)
   ------------------------------------------------------------
   Loaded by app.html after pocketbase-client.js.
   Exposes window.AGMX_LOGIN.render(container)
   ============================================================ */

(function () {
  "use strict";

  // Lazy API access: supabase-client.js is a deferred module, so
  // window.AGMX_API may not be set when this IIFE runs. Access at call time.
  function api() {
    return window.AGMX_API;
  }

  const T = {
    BM: {
      title: "Log masuk untuk mentadbir",
      tagline: "Sistem Operasi Tadbir Urus Koperasi",
      google: "Teruskan dengan Google",
      googleHint: "Paling cepat untuk ahli komite",
      divider: "atau",
      otp: "Masukkan e-mail anda",
      phone: "Nombor telefon",
      sendOtp: "Hantar kod OTP",
      otpSent: "Kod 6 digit telah dihantar ke",
      verify: "Sahkan kod",
      resend: "Hantar semula",
      expires: "Kod tamat dalam",
      demo: "Demo — masuk tanpa akaun",
      demoHint: "Guna data simulasi KOPEMAJU",
      invalidCode: "Kod tidak sah",
      checking: "Memeriksa status…",
      errNoPB: "PocketBase tidak dijangkau",
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
      otp: "Sign in with OTP",
      phone: "Phone number",
      sendOtp: "Send OTP code",
      otpSent: "A 6-digit code was sent to",
      verify: "Verify code",
      resend: "Resend",
      expires: "Code expires in",
      demo: "Demo — sign in without an account",
      demoHint: "Uses simulated KOPEMAJU data",
      invalidCode: "Invalid code",
      checking: "Checking status…",
      errNoPB: "PocketBase unreachable",
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
    step: "choose", // choose | otp-request | otp-verify | role
    phone: "",
    otp: "",
    expiresIn: 180,
    timer: null,
    roles: ["member", "secretary", "chairman", "treasurer"],
  };

  // ---- render ----
  function render(root) {
    stopTimer();
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

    card.append(head, body);

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
    langRow.style.cssText = "display:flex;justify-content:flex-end;padding:0 4px;";
    langRow.appendChild(langBtn);
    card.insertBefore(langRow, body);
    root.appendChild(card);

    // Focus the first input for keyboard users
    const first = card.querySelector("input, button");
    if (first) first.focus();
  }

  function renderStep(body) {
    body.innerHTML = "";
    switch (state.step) {
      case "otp-request":
        return renderOTPRequest(body);
      case "otp-verify":
        return renderOTPVerify(body);
      case "role":
        return renderRolePick(body);
      default:
        return renderChoose(body);
    }
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

    // OTP
    const o = document.createElement("button");
    o.className = "btn btn-outline btn-lg btn-block";
    o.type = "button";
    o.textContent = t("otp");
    o.addEventListener("click", () => {
      state.step = "otp-request";
      const root = document.querySelector(".login-view")?.parentElement;
      root && render(root);
    });
    wrap.appendChild(o);

    // Demo
    if (api()?.config?.demoMode) {
      const d = document.createElement("button");
      d.className = "btn btn-ghost btn-block login-demo";
      d.type = "button";
      d.innerHTML = `<span>${t("demo")}</span><small>${t("demoHint")}</small>`;
      d.addEventListener("click", () => {
        window.AGMX_LOGIN.onSuccess?.({ demo: true });
      });
      wrap.appendChild(d);
    }

    // Status line
    const status = document.createElement("p");
    status.className = "login-status";
    status.setAttribute("role", "status");
    status.id = "login-status";
    wrap.appendChild(status);

    body.appendChild(wrap);
  }

  // ---- step: request OTP ----
  function renderOTPRequest(body) {
    const form = document.createElement("form");
    form.className = "login-form";
    form.innerHTML = `
      <label class="field">
        <span class="field-label">${t("phone")}</span>
        <input class="input input-lg" type="tel" name="phone"
               inputmode="tel" autocomplete="tel" placeholder="+60 12-345 6789"
               pattern="[0-9+ -]{8,20}" required>
      </label>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${t("sendOtp")}</button>
      <button class="btn btn-ghost btn-block" type="button" data-back>${t("back")}</button>
    `;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const phone = form.phone.value.trim();
      state.phone = phone;
      const status = document.getElementById("login-status");
      try {
        if (!api()) throw new Error("client not loaded");
        await api().requestSMSOTP(phone);
        state.step = "otp-verify";
        startTimer();
        const root = document.querySelector(".login-view")?.parentElement;
        root && render(root);
      } catch (err) {
        if (status) {
          status.textContent = err.message || t("errNoPB");
          status.classList.add("is-error");
        }
      }
    });

    form.querySelector("[data-back]").addEventListener("click", () => {
      state.step = "choose";
      const root = document.querySelector(".login-view")?.parentElement;
      root && render(root);
    });

    body.appendChild(form);
  }

  // ---- step: verify OTP ----
  function renderOTPVerify(body) {
    const form = document.createElement("form");
    form.className = "login-form";
    form.innerHTML = `
      <p class="login-sent">${t("otpSent")} <strong>${escapeHtml(state.phone)}</strong></p>
      <label class="field">
        <span class="field-label">OTP</span>
        <input class="input input-lg otp-input" type="text" name="otp"
               inputmode="numeric" autocomplete="one-time-code" maxlength="6"
               pattern="[0-9]{6}" placeholder="000000" required>
      </label>
      <p class="login-timer">${t("expires")} <strong id="otp-timer">03:00</strong></p>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${t("verify")}</button>
      <button class="btn btn-ghost btn-block" type="button" data-resend>${t("resend")}</button>
    `;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const otp = form.otp.value.trim();
      const status = document.getElementById("login-status");
      try {
        const res = await api().verifySMSOTP(state.phone, otp);
        state.step = "role";
        stopTimer();
        const root = document.querySelector(".login-view")?.parentElement;
        root && render(root);
        window.AGMX_LOGIN.lastAuth = res;
      } catch (err) {
        if (status) {
          status.textContent = err.message || t("invalidCode");
          status.classList.add("is-error");
        }
      }
    });

    form.querySelector("[data-resend]").addEventListener("click", async () => {
      try {
        await api().requestSMSOTP(state.phone);
        startTimer();
      } catch (_) {
        /* surfaced on next submit */
      }
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

  // ---- timer ----
  function startTimer() {
    stopTimer();
    state.timer = setInterval(() => {
      state.expiresIn -= 1;
      const el = document.getElementById("otp-timer");
      if (!el) return stopTimer();
      const m = String(Math.floor(state.expiresIn / 60)).padStart(2, "0");
      const s = String(state.expiresIn % 60).padStart(2, "0");
      el.textContent = `${m}:${s}`;
      if (state.expiresIn <= 0) stopTimer();
    }, 1000);
  }

  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
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
      // PocketBase redirects the browser; nothing after this runs in the
      // normal flow.
    } catch (err) {
      if (status) {
        status.textContent = err.message || t("errNoPB");
        status.classList.add("is-error");
      }
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
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
