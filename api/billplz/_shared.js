"use strict";

const MAX_BODY = 16 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new HttpError(503, "Payment service is not configured");
  return value.trim();
}

function baseUrl(name, fallback) {
  const url = new URL((process.env[name] || fallback).replace(/\/+$/, "") + "/");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new HttpError(503, "Payment service URL must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) throw new HttpError(503, "Invalid service URL");
  return url.href.replace(/\/$/, "");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function body(req, type) {
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== type) throw new HttpError(415, `Expected ${type}`);
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
  if (typeof value === "string" && Buffer.byteLength(value) > MAX_BODY) throw new HttpError(413, "Request body too large");
  if (type === "application/json") {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { throw new HttpError(400, "Invalid JSON"); }
    }
    if (!isObject(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_BODY) throw new HttpError(400, "Expected a JSON object");
    return value;
  }
  if (isObject(value)) {
    const fields = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string") throw new HttpError(400, "Invalid callback field");
      fields[key] = item;
    }
    return fields;
  }
  if (typeof value !== "string") throw new HttpError(400, "Expected form-encoded body");
  const fields = Object.create(null);
  for (const [key, item] of new URLSearchParams(value)) {
    if (Object.hasOwn(fields, key)) throw new HttpError(400, "Duplicate callback field");
    fields[key] = item;
  }
  return fields;
}

function exactFields(value, allowed, requiredFields) {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key)) ||
    requiredFields.some(key => !Object.hasOwn(value, key))) throw new HttpError(400, "Invalid request fields");
}

function text(value, max, name) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return value.trim();
}

function sen(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new HttpError(400, "amountSen must be a positive integer");
  return value;
}

function ringgitToSen(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new HttpError(409, "Invalid invoice amount");
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || Math.abs(value * 100 - cents) > 1e-7) {
    throw new HttpError(409, "Invoice amount must be in whole sen");
  }
  return cents;
}

function recordId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_]{1,40}$/.test(value);
}

async function request(url, options) {
  const timeoutMs = Number(process.env.PAYMENT_REQUEST_TIMEOUT_MS || 15000);
  const controller = typeof AbortController === "function" && timeoutMs > 0
    ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...(options || {}), signal: controller ? controller.signal : undefined });
    let data;
    try { data = await res.json(); } catch { throw new HttpError(502, "Invalid upstream response"); }
    if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, "Upstream request failed");
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") throw new HttpError(504, "Payment provider timed out");
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function pbUrl() { return baseUrl("PB_URL", "http://127.0.0.1:8090"); }

async function pbAdmin() {
  const base = pbUrl();
  const auth = await request(`${base}/api/collections/_superusers/auth-with-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: required("PB_ADMIN_EMAIL"), password: required("PB_ADMIN_PASSWORD") }),
  });
  if (!auth || !auth.token) throw new HttpError(502, "PocketBase authentication failed");
  return { base, token: auth.token };
}

async function pb(admin, collection, id, method = "GET", data) {
  const path = `${admin.base}/api/collections/${collection}/records${id ? `/${encodeURIComponent(id)}` : ""}`;
  return request(path, { method, headers: { Authorization: admin.token, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}

async function userContext(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/^Bearer [^\s]+$/.test(authorization)) throw new HttpError(401, "Authentication required");
  const res = await fetch(`${pbUrl()}/api/collections/_pb_users_auth_/auth-refresh`, {
    method: "POST", headers: { Authorization: authorization.slice(7) },
  });
  if (!res.ok) throw new HttpError(401, "Authentication required");
  const auth = await res.json();
  const record = auth && auth.record;
  if (!record || !record.organizationId || !["admin", "secretary"].includes(record.role)) {
    throw new HttpError(403, "Organization staff required");
  }
  return record;
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function fail(res, error) {
  send(res, error instanceof HttpError ? error.status : 502,
    { error: error instanceof HttpError ? error.message : "Payment service unavailable" });
}

module.exports = { HttpError, required, baseUrl, body, exactFields, text, sen, ringgitToSen,
  recordId, request, pbAdmin, pb, userContext, send, fail };
