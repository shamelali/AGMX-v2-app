"use strict";

const { ask } = require("../_lib/knowledge-core");
const { jsonBody, exactFields, staff, send, fail } = require("../_lib/knowledge-http");

module.exports = async function query(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed" });
    }
    const { orgId } = await staff(req);
    const input = await jsonBody(req);
    exactFields(input, ["query"], ["query"]);
    if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 2000) {
      return send(res, 400, { error: "query must contain 1 to 2000 characters" });
    }
    const result = await ask(orgId, input.query);
    return send(res, 200, result);
  } catch (error) {
    return fail(res, error);
  }
};
