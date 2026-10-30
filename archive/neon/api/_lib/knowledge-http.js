"use strict";

const { HttpError, exactFields, userContext, send } = require("../billplz/_shared");

const MAX_BODY = 600 * 1024;

async function jsonBody(req) {
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "Expected application/json");
  let value = req.body;
  if (value === undefined) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, "Request body too large");
      parts.push(chunk);
    }
    value = Buffer.concat(parts).toString("utf8");
  }
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > MAX_BODY) throw new HttpError(413, "Request body too large");
    try { value = JSON.parse(value); } catch (_) { throw new HttpError(400, "Invalid JSON"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_BODY) {
    throw new HttpError(400, "Expected a JSON object");
  }
  return value;
}

function fail(res, error) {
  const status = error instanceof HttpError ? error.status :
    (error instanceof TypeError || error instanceof RangeError ? 400 : 502);
  send(res, status, { error: status === 502 ? "Knowledge service unavailable" : error.message });
}

async function staff(req) {
  const user = await userContext(req);
  const orgId = typeof user.organizationId === "string" ? user.organizationId.trim() : "";
  if (!orgId) throw new HttpError(403, "Organization context required");
  return { user, orgId };
}

module.exports = { HttpError, jsonBody, exactFields, staff, send, fail };
