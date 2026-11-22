/* ============================================================
   AGMX — Landing enhancement layer
   ------------------------------------------------------------
   Progressive enhancement for index.html. Loaded with `defer`, so
   the DOM is parsed before this runs.

   Rules this file keeps:
   - It never changes text content, only classes, CSS custom properties
     and one element's text (the counters), which is restored to the
     exact original string when the count-up finishes.
   - It never moves an element that carries an id, so no reference in
     the page's own scripts breaks. The only node it relocates is the
     hero nav, which is moved to the document body so it can be sticky
     for the whole page; if that fails, the page still renders.
   - Every animated behaviour is skipped when the visitor asks for
     reduced motion, and every observer is optional: a browser without
     IntersectionObserver gets the static page, not a blank one.

   The marker class `lp-js` on <html> is what unlocks the hidden
   starting state in landing.css. It is added before any node is
   touched, so a script that throws leaves the page fully visible.
   ============================================================ */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var finePointer = !!(window.matchMedia &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches);

  root.classList.add("lp-js");

  /* ------------------------------------------------------------
     1. Promote the hero nav to a page-level sticky bar
     ------------------------------------------------------------
     In the markup the nav sits inside .hero > .container, which
     bounds a sticky element to the hero. Moving it to <body> — and
     leaving it after the skip link, so keyboard order still starts
     with "skip to main content" — lets one header serve the whole
     document. */
  var nav = document.querySelector(".nav-top");
  if (nav && nav.parentNode && nav.parentNode !== document.body) {
    var skipLink = document.querySelector("body > .skip-link");
    try {
      if (skipLink && skipLink.parentNode === document.body) {
        skipLink.after(nav);
      } else {
        document.body.insertBefore(nav, document.body.firstChild);
      }
    } catch (err) {
      /* A failed move is cosmetic only: the nav stays where the
         markup put it and the page reads the same. */
    }
  }

  /* ------------------------------------------------------------
     2. Scroll state: stuck header, progress, scroll-spy
     ------------------------------------------------------------ */
  var progressBar = document.createElement("div");
  progressBar.className = "lp-progress";
  progressBar.setAttribute("aria-hidden", "true");
  document.body.appendChild(progressBar);

  var sections = Array.prototype.slice.call(
    document.querySelectorAll("main section[id]")
  );
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('.nav-link[href^="#"]')
  );
  var linkById = {};
  navLinks.forEach(function (link) {
    linkById[link.getAttribute("href").slice(1)] = link;
  });

  var ticking = false;

  function updateScrollState() {
    ticking = false;

    var y = window.scrollY || window.pageYOffset || 0;
    var viewport = window.innerHeight || 0;

    if (nav) nav.classList.toggle("lp-nav-stuck", y > 8);

    var scrollable = (root.scrollHeight || 0) - viewport;
    var progress = scrollable > 0 ? y / scrollable : 0;
    progress = Math.min(1, Math.max(0, progress));
    progressBar.style.setProperty("--lp-progress", progress.toFixed(4));

    /* Scroll-spy: the section owning the line just under the header
       wins, so the marker tracks what the reader is looking at rather
       than what scrolled past. */
    var activeId = null;
    var probe = y + viewport * 0.35;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].offsetTop <= probe) activeId = sections[i].id;
    }
    if (scrollable > 0 && y >= scrollable - 2 && sections.length) {
      activeId = sections[sections.length - 1].id;
    }
    navLinks.forEach(function (link) {
      link.classList.toggle("lp-active", link.getAttribute("href").slice(1) === activeId);
    });
  }

  function requestScrollUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateScrollState);
  }

  window.addEventListener("scroll", requestScrollUpdate, { passive: true });
  window.addEventListener("resize", requestScrollUpdate);

  /* ------------------------------------------------------------
     3. Scroll reveal
     ------------------------------------------------------------ */
  var revealSelector = [
    ".section-header",
    ".availability-card",
    ".stage-card",
    ".trust-row",
    ".compliance-card",
    ".resource-card",
    ".pricing-card",
    ".faq-item",
    ".cta-card",
    ".scoping-block",
    ".footer-grid > *"
  ].join(",");

  var revealTargets = Array.prototype.slice.call(
    document.querySelectorAll(revealSelector)
  );

  if (!reduceMotion && revealTargets.length &&
      "IntersectionObserver" in window) {
    var groups = [];
    revealTargets.forEach(function (el) {
      var parent = el.parentNode;
      if (!parent) return;
      if (groups.indexOf(parent) === -1) groups.push(parent);
      el.style.setProperty("--lp-i", Array.prototype.indexOf.call(parent.children, el));
      el.classList.add("lp-reveal");
    });
    groups.forEach(function (parent) { parent.classList.add("lp-stagger"); });

    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("lp-visible");
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });

    revealTargets.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      /* Anything already on screen is shown at once — the reveal is a
         scroll effect, not a loading gate. */
      if (rect.top < (window.innerHeight || 0) && rect.bottom > 0) {
        el.classList.add("lp-visible");
      } else {
        revealObserver.observe(el);
      }
    });
  }

  /* ------------------------------------------------------------
     4. Count-up on the sample AGM record
     ------------------------------------------------------------
     The final value is the exact original string, restored when the
     animation ends, so the numbers on the page are the numbers in the
     markup — never a rounded approximation. */
  function groupDigits(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function animateCount(el, target, original) {
    var duration = 1100;
    var start = null;

    function step(timestamp) {
      if (start === null) start = timestamp;
      var elapsed = timestamp - start;
      var ratio = Math.min(1, elapsed / duration);
      var eased = 1 - Math.pow(1 - ratio, 3);
      el.textContent = groupDigits(Math.round(target * eased));
      if (ratio < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = original;
      }
    }

    window.requestAnimationFrame(step);
  }

  var counters = Array.prototype.slice.call(
    document.querySelectorAll(".record-stats dd, .record-tally span")
  ).filter(function (el) {
    return /^\d[\d,]*$/.test((el.textContent || "").trim());
  });

  if (!reduceMotion && counters.length) {
    counters.forEach(function (el) {
      var original = el.textContent.trim();
      el.classList.add("lp-count");
      el.setAttribute("data-lp-final", original);
    });

    var recordCard = document.querySelector(".record-card");
    var startCounters = function () {
      counters.forEach(function (el) {
        var target = parseInt(el.getAttribute("data-lp-final").replace(/,/g, ""), 10);
        if (!isNaN(target)) animateCount(el, target, el.getAttribute("data-lp-final"));
      });
    };

    if (recordCard && "IntersectionObserver" in window) {
      var countObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          countObserver.unobserve(entry.target);
          startCounters();
        });
      }, { threshold: 0.2 });
      countObserver.observe(recordCard);
    } else {
      startCounters();
    }
  }

  /* ------------------------------------------------------------
     5. Cursor spotlight on the sample record
     ------------------------------------------------------------ */
  if (finePointer) {
    var spotlight = document.querySelector(".record-card");
    if (spotlight) {
      spotlight.addEventListener("pointermove", function (event) {
        var rect = spotlight.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        spotlight.style.setProperty(
          "--lp-mx",
          (((event.clientX - rect.left) / rect.width) * 100).toFixed(2) + "%"
        );
        spotlight.style.setProperty(
          "--lp-my",
          (((event.clientY - rect.top) / rect.height) * 100).toFixed(2) + "%"
        );
      });
    }
  }

  /* First paint of the scroll-dependent chrome. */
  updateScrollState();
})();

/* A visitor can rehearse the quorum decision without sending a ballot. */
(function () {
  const slider = document.querySelector("#hall-attendance");
  if (!slider) return;
  const map = document.querySelector(".seat-map");
  const state = document.querySelector("#hall-state");
  const ballot = document.querySelector("#hall-ballot");
  const choices = document.querySelector("#hall-choices");
  const result = document.querySelector("#hall-result");
  const reset = document.querySelector("#hall-reset");
  const en = document.documentElement.lang === "en";
  const seats = [];
  for (const [row, count] of [8, 12, 17, 23].entries()) {
    const radius = 18 + row * 10;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * (0.06 + 0.88 * i / (count - 1));
      const seat = document.createElement("i");
      seat.style.left = (50 + radius * Math.cos(angle)) + "%";
      seat.style.top = (100 - 1.94 * radius * Math.sin(angle)) + "%";
      map.appendChild(seat);
      seats.push(seat);
    }
  }
  function renderAttendance() {
    const count = Number(slider.value);
    document.querySelector("#hall-count").textContent = count;
    seats.forEach((seat, i) => seat.classList.toggle("occupied", i < count));
    ballot.disabled = count < 30;
    state.textContent = count >= 30
      ? (en ? "Quorum reached" : "Kuorum tercapai")
      : (en ? (30 - count) + " more needed" : "Perlu " + (30 - count) + " lagi");
  }
  slider.addEventListener("input", renderAttendance);
  ballot.addEventListener("click", () => {
    if (Number(slider.value) < 30) return;
    slider.disabled = true;
    ballot.hidden = true;
    choices.hidden = false;
    reset.hidden = false;
    choices.querySelector("button").focus();
  });
  choices.addEventListener("click", event => {
    const choice = event.target.closest("button");
    if (!choice || choices.hidden) return;
    result.textContent = (en ? "Your sample vote: " : "Undi contoh anda: ") + choice.textContent;
    choices.hidden = true;
    reset.focus();
  });
  reset.addEventListener("click", () => {
    slider.disabled = false;
    slider.value = "36";
    choices.hidden = reset.hidden = true;
    ballot.hidden = false;
    result.textContent = "";
    renderAttendance();
    slider.focus();
  });
  renderAttendance();
})();

(() => {
  "use strict";
  const en = document.documentElement.lang === "en";
  const roles = {
    member: ["Daftar hadir dan undi usul","Check in and cast your ballot","Buka dewan AGM untuk mendaftar kehadiran, menyemak usul yang sedang dibahas dan mengundi jika layak.","Open the AGM hall to check in, review the motion on the floor and vote if eligible.","Buka dewan ahli →","Open member hall →","/app.html#/agm","/assets/05-voting.png","Paparan undian contoh","Sample ballot view"],
    secretary: ["Sediakan rekod mesyuarat","Prepare meeting records","Cari keputusan terdahulu dalam fail anda. Jana templat notis, agenda atau minit yang boleh disunting.","Find previous decisions in your files. Generate editable notices, agendas or minutes.","Buka meja dokumen →","Open document desk →","/document-desk.html","/assets/09-vault.png","Paparan peti rekod contoh","Sample records vault"],
    chair: ["Beri giliran kepada ahli","Give members the floor","Urus giliran berucap, panggil ahli dan kongsikan sari kata. Cuba kawalan pengerusi dalam raptai dahulu.","Manage speaker requests, call members and share captions. Try the chair controls in rehearsal.","Cuba kawalan pengerusi →","Try chair controls →","/live-meeting.html?demo=1","/assets/04-hall.png","Paparan dewan AGM contoh","Sample AGM hall"],
  };
  const config = window.AGMX_CONFIG;
  const hasWorkspace = config && !config.demoMode && config.supabaseUrl && config.supabaseAnonKey;
  if (hasWorkspace) {
    const hall = document.getElementById("hero-hall");
    hall.href = "/app.html#/agm";
    hall.textContent = en ? "Enter the AGM hall →" : "Masuk ke dewan AGM →";
  } else {
    roles.member = [
      "Cuba pengalaman ahli","Rehearse as a member",
      "Daftar hadir, capai kuorum dan undi usul menggunakan rekod contoh dalam raptai berpandu.",
      "Check in, reach quorum and vote on sample motions in the guided rehearsal.",
      "Cuba sebagai ahli →","Try the member rehearsal →","/demo/guided-demo.html",
      "/assets/05-voting.png","Paparan undian contoh","Sample ballot view"
    ];
  }
  const buttons = document.querySelectorAll("[data-role]");
  function selectRole(button) {
    const role = roles[button.dataset.role];
    const link = document.querySelector("#role-cta");
    const screen = document.querySelector("#role-screen");
    document.querySelector("#role-title").textContent = role[en ? 1 : 0];
    document.querySelector("#role-body").textContent = role[en ? 3 : 2];
    link.textContent = role[en ? 5 : 4];
    link.href = role[6];
    screen.src = role[7];
    screen.alt = role[en ? 9 : 8];
    buttons.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
  }
  buttons.forEach(button => button.addEventListener("click", () => selectRole(button)));
  selectRole(document.querySelector('[data-role="member"]'));
  const menu=document.querySelector("#mobile-menu"), links=document.querySelector("#main-links");
  function closeMenu(){menu.setAttribute("aria-expanded","false");links.classList.remove("is-open");}
  menu.addEventListener("click",()=>{const open=menu.getAttribute("aria-expanded")==="false";menu.setAttribute("aria-expanded",String(open));links.classList.toggle("is-open",open);});
  links.addEventListener("click",closeMenu);
  document.addEventListener("keydown",e=>{if(e.key==="Escape" && links.classList.contains("is-open")){closeMenu();menu.focus();}});
  document.addEventListener("click",e=>{if(!menu.contains(e.target)&&!links.contains(e.target))closeMenu();});
  const catalog=window.AGMX_PRICE_LIST, grid=document.querySelector("#pricing-grid");
  const switches=document.querySelectorAll("[data-price-mode]");
  function showPrices(mode){
    const subs=mode==="subscription";
    const plans=subs?catalog.subscriptions():catalog.services();
    grid.replaceChildren(...plans.map(plan=>{
      const card=document.createElement("article");card.className="rate-card";
      const title=document.createElement("h3");title.textContent=plan.name;
      const cost=document.createElement("strong");cost.textContent=catalog.rm(subs?plan.annual:plan.oneoff);
      const unit=document.createElement("small");unit.textContent=subs?(en?"per year":"setahun"):(en?"per AGM":"setiap AGM");
      const band=document.createElement("p");band.textContent=(en?"Up to ":"Sehingga ")+plan.memberCap.toLocaleString("en-MY")+(en?" members":" ahli");
      const link=document.createElement("a");link.href="/assessment.html";link.textContent=en?"Assess fit →":"Semak kesesuaian →";
      card.append(title,cost,unit,band,link);return card;
    }));
    switches.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.priceMode===mode)));
  }
  if(catalog&&grid){switches.forEach(b=>b.onclick=()=>showPrices(b.dataset.priceMode));showPrices("service");}
})();
