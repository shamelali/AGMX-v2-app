/* ============================================================
   AGMX — Money Flow route registration (PocketBase v0.22 JSVM)
   ------------------------------------------------------------
   Thin, self-contained handlers only: the v0.22 JSVM re-evaluates
   each handler in a pooled runtime with NO access to file scope,
   so every implementation lives in money_flow.lib.js and is pulled
   in via require(__hooks + "/money_flow.lib.js") (cached per pool
   runtime). Do not add file-level helpers here — they are invisible
   to the handlers.
   ============================================================ */
/* global routerAdd, __hooks */

routerAdd("POST", "/api/agmx/assessment", function (c) {
  return require(__hooks + "/money_flow.lib.js").submitAssessment(c);
});

routerAdd("GET", "/api/agmx/lead", function (c) {
  return require(__hooks + "/money_flow.lib.js").getLead(c);
});

routerAdd("POST", "/api/agmx/quote", function (c) {
  return require(__hooks + "/money_flow.lib.js").createQuote(c);
});

routerAdd("GET", "/api/agmx/quote", function (c) {
  return require(__hooks + "/money_flow.lib.js").getQuote(c);
});

routerAdd("POST", "/api/agmx/quote/accept", function (c) {
  return require(__hooks + "/money_flow.lib.js").acceptQuote(c);
});

routerAdd("POST", "/api/agmx/invoice", function (c) {
  return require(__hooks + "/money_flow.lib.js").createInvoice(c);
});

routerAdd("GET", "/api/agmx/invoice", function (c) {
  return require(__hooks + "/money_flow.lib.js").getInvoice(c);
});

routerAdd("POST", "/api/agmx/payment", function (c) {
  return require(__hooks + "/money_flow.lib.js").createPayment(c);
});

routerAdd("POST", "/api/agmx/payment/confirm", function (c) {
  return require(__hooks + "/money_flow.lib.js").confirmPayment(c);
});

/* Billplz hosted-payment link. The browser only ever sees the returned
   URL — the API key is read from the environment inside the hook. */
routerAdd("POST", "/api/agmx/payment/link", function (c) {
  return require(__hooks + "/money_flow.lib.js").createPaymentLink(c);
});

/* Billplz webhook. Verifies x_signature before settling anything. */
routerAdd("POST", "/api/agmx/payment/callback", function (c) {
  return require(__hooks + "/money_flow.lib.js").paymentCallback(c);
});

routerAdd("POST", "/api/agmx/lead/stage", function (c) {
  return require(__hooks + "/money_flow.lib.js").updateStage(c);
});

routerAdd("GET", "/api/agmx/deals", function (c) {
  return require(__hooks + "/money_flow.lib.js").listDeals(c);
});

routerAdd("GET", "/api/agmx/audit", function (c) {
  return require(__hooks + "/money_flow.lib.js").getAudit(c);
});

