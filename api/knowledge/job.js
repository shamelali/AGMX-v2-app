"use strict";

const store = require("../_lib/knowledge-store");
const { staff, send, fail } = require("../_lib/knowledge-http");

module.exports = async function job(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return send(res, 405, { error: "Method not allowed" });
    }
    const { orgId } = await staff(req);
    const id = req.query && req.query.id;
    const result = await store.job(orgId, id);
    if (!result) return send(res, 404, { error: "Knowledge job not found" });
    return send(res, 200, {
      id: result.id,
      title: result.title,
      status: result.status,
      attempts: result.attempts,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      completedAt: result.completedAt,
    });
  } catch (error) {
    return fail(res, error);
  }
};
