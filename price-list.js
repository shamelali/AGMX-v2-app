/* ============================================================
   AGMX — published rate card
   ------------------------------------------------------------
   The only place a price appears in browser code. Every number here
   mirrors public.plans, which is seeded by
   supabase/migrations/0003_plans_seed.sql and
   supabase/migrations/0006_subscriptions_billing.sql, and which the
   money-flow Edge Function reads when it prices a quote
   (plans.price_oneoff) and when it raises a recurring invoice
   (plans.price_annual). money-flow re-prices every order from that
   table and ignores whatever the page sent, so a literal in a page
   that disagrees with it is a price the cooperative cannot actually
   buy — the four books this file replaced disagreed by up to 15x.
   Change a price in the database, then update this file;
   tools/check.sh refuses a page that quotes a number found only in
   the page.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AGMX_PRICE_LIST = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Mirrors public.plans as read on 3 November 2026. */
  const PLANS = [
    {
      code: "governance_os_essential", key: "essential", type: "governance_os",
      name: "Governance OS Essential", memberCap: 300, monthly: 600, annual: 7200, oneoff: null,
    },
    {
      code: "governance_os_professional", key: "professional", type: "governance_os",
      name: "Governance OS Professional", memberCap: 1000, monthly: 800, annual: 9600, oneoff: null,
    },
    {
      code: "governance_os_enterprise", key: "enterprise", type: "governance_os",
      name: "Governance OS Enterprise", memberCap: 2000, monthly: 1000, annual: 12000, oneoff: null,
    },
    {
      code: "governance_os_federation", key: "federation", type: "governance_os",
      name: "Governance OS Federation", memberCap: 10000, monthly: 1250, annual: 15000, oneoff: null,
    },
    {
      code: "essential_agm", key: "essential", type: "agm_service",
      name: "AGMX Essential AGM", memberCap: 500, monthly: null, annual: null, oneoff: 1500,
    },
    {
      code: "professional_agm", key: "professional", type: "agm_service",
      name: "AGMX Professional AGM", memberCap: 2000, monthly: null, annual: null, oneoff: 3500,
    },
    {
      code: "enterprise_agm", key: "enterprise", type: "agm_service",
      name: "AGMX Enterprise AGM", memberCap: 5000, monthly: null, annual: null, oneoff: 7500,
    },
  ];

  /* money-flow's recommendPlan() complexity bands, verbatim, so the
     assessment page's "recommended package" is the server's answer rather
     than a second opinion computed in the browser. The page additionally
     lifts the band when the member count exceeds the package's own cap —
     recommendPlan() ignores member counts, so a quote can come back one tier
     below that recommendation. The server only ever recommends a one-off AGM
     package — nothing recommends a Governance OS subscription, which is why
     the subscription step cannot be reached from a live quote yet. */
  function planCodeByScore(score) {
    const s = Number(score) || 0;
    return s <= 34 ? "essential_agm" : s <= 64 ? "professional_agm" : "enterprise_agm";
  }

  const byCode = (code) => PLANS.find((p) => p.code === code) || null;
  const subscriptions = () => PLANS.filter((p) => p.type === "governance_os");
  const services = () => PLANS.filter((p) => p.type === "agm_service");

  return {
    currency: "MYR",
    taxRate: 0.08,
    verifiedOn: "2026-11-03",
    plans: PLANS,
    byCode,
    subscriptions,
    services,
    planCodeByScore,
    rm: (value) => "RM" + Number(value).toLocaleString("en-MY"),
  };
}));
