"use strict";

const store = require("../_lib/knowledge-store");
const { jsonBody, exactFields, staff, send, fail } = require("../_lib/knowledge-http");

module.exports = async function ingest(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed" });
    }
    const { orgId } = await staff(req);
    const input = await jsonBody(req);
    exactFields(input, ["orgId", "title", "pages"], ["title", "pages"]);
    if (input.orgId !== undefined && input.orgId !== orgId) {
      return send(res, 403, { error: "Organization access denied" });
    }
    const result = await store.enqueue(orgId, input);
    if (!result) return send(res, 403, { error: "Organization is not active" });
    return send(res, 202, result);
  } catch (error) {
    return fail(res, error);
  }
};
