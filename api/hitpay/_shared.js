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

function serviceUrl(name, fallback) {
  let url;
  try { url = new URL(process.env[name] || fallback); } catch { throw new HttpError(503, "Invalid service URL"); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash) throw new HttpError(503, "Invalid service URL");
  return url.href.replace(/\/+$/, "");
}

function webhookUrl() {
  let url;
  try { url = new URL(required("HITPAY_WEBHOOK_URL")); } catch { throw new HttpError(503, "Invalid webhook URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith("/api/hitpay/webhook")) throw new HttpError(503, "Invalid webhook URL");
  return url.href;
}

function currency() {
  const value = (process.env.HITPAY_CURRENCY || "MYR").trim();
  if (!/^[A-Z]{3}$/.test(value)) throw new HttpError(503, "Invalid payment currency");
  return value;
}

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

async function rawBody(req) {
  if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Expected application/json");
  }
  // Vercel may parse req.body before the function executes. req.rawBody must
  // be provided by the runtime in that case; reconstructing JSON breaks HMAC.
  let value = req.rawBody;
  if (value === undefined && (Buffer.isBuffer(req.body) || typeof req.body === "string")) value = req.body;
  if (value === undefined && req.body !== undefined) throw new HttpError(400, "Raw webhook body unavailable");
  if (value === undefined) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, "Request body too large");
      chunks.push(chunk);
    }
    value = Buffer.concat(chunks);
  }
  if (typeof value === "string") value = Buffer.from(value, "utf8");
  if (!Buffer.isBuffer(value)) throw new HttpError(400, "Raw webhook body unavailable");
  if (value.length > MAX_BODY) throw new HttpError(413, "Request body too large");
  return value;
}

function json(raw) {
  let data;
  try { data = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON"); }
  if (!object(data)) throw new HttpError(400, "Expected JSON object");
  return data;
}

function inputBody(req) {
  if (req.body === undefined) return rawBody(req).then(json);
  if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Expected application/json");
  }
  if (object(req.body)) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw new HttpError(413, "Request body too large");
    return req.body;
  }
  return rawBody(req).then(json);
}

function recordId(value) { return typeof value === "string" && /^[a-zA-Z0-9_]{1,40}$/.test(value); }

function cents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new HttpError(409, "Invalid invoice amount");
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || Math.abs(value * 100 - result) > 1e-7) throw new HttpError(409, "Invoice amount must use whole cents");
  return result;
}

function gatewayAmount(value) {
  if (typeof value !== "string" && typeof value !== "number") throw new HttpError(409, "Invalid gateway amount");
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(value))) throw new HttpError(409, "Invalid gateway amount");
  return cents(Number(value));
}

async function request(url, options) {
  // Match the Billplz client: the webhook and create-payment paths issue
  // several sequential PocketBase calls, so each one needs its own deadline
  // rather than holding the function until the platform kills it.
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

function pbUrl() { return serviceUrl("PB_URL", "http://127.0.0.1:8090"); }

async function pbAdmin() {
  const base = pbUrl();
  const auth = await request(`${base}/api/collections/_superusers/auth-with-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: required("PB_ADMIN_EMAIL"), password: required("PB_ADMIN_PASSWORD") }),
  });
  if (!auth || !auth.token) throw new HttpError(502, "PocketBase authentication failed");
  return { base, token: auth.token };
}

function pb(admin, collection, id, method = "GET", data) {
  return request(`${admin.base}/api/collections/${collection}/records${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method, headers: { Authorization: admin.token, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

async function userContext(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/^Bearer [^\s]+$/.test(authorization)) throw new HttpError(401, "Authentication required");
  const res = await fetch(`${pbUrl()}/api/collections/_pb_users_auth_/auth-refresh`, {
    method: "POST", headers: { Authorization: authorization.slice(7) },
  });
  if (!res.ok) throw new HttpError(401, "Authentication required");
  const auth = await res.json();
  const user = auth && auth.record;
  if (!user || !recordId(user.organizationId) || !["admin", "secretary"].includes(user.role)) {
    throw new HttpError(403, "Organization staff required");
  }
  return user;
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

module.exports = { HttpError, required, serviceUrl, webhookUrl, currency, object, rawBody, json,
  inputBody, recordId, cents, gatewayAmount, request, pbAdmin, pb, userContext, send, fail };
