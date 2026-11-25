const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
const PROXY_TIMEOUT_MS = 30_000;

function getHeader(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const key = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.status(status);
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(body);
}

function errorBody(code, message) {
  return JSON.stringify({ ok: false, error: { code, message } });
}

function configured(env) {
  if (!env?.INTAKE_WORKER_URL || !env?.INTAKE_PROXY_SECRET) return false;
  try {
    const url = new URL(env.INTAKE_WORKER_URL);
    return url.protocol === "https:" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function readLimited(req) {
  const declared = Number(getHeader(req.headers, "content-length"));
  if (Number.isSafeInteger(declared) && declared >= 0 && declared > MAX_BODY_BYTES) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    size += bytes.byteLength;
    if (size > MAX_BODY_BYTES) return null;
    text += decoder.decode(bytes, { stream: true });
  }
  return text + decoder.decode();
}

async function readLimitedResponse(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("oversized upstream response");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchWorker(env, fetchImpl, body, clientIp, origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetchImpl(env.INTAKE_WORKER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agmx-intake-proxy-secret": env.INTAKE_PROXY_SECRET,
        ...(origin ? { origin } : {}),
        ...(clientIp ? { "x-agmx-client-ip": clientIp } : {}),
      },
      body,
      signal: controller.signal,
    });
    const text = await readLimitedResponse(upstream);
    return { status: upstream.status, text, contentType: upstream.headers.get("content-type") || "application/json" };
  } finally {
    clearTimeout(timer);
  }
}

export async function proxyIntake(req, res, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (req.method !== "POST") {
    send(res, 405, errorBody("METHOD_NOT_ALLOWED", "Method not allowed"));
    return;
  }
  if (String(getHeader(req.headers, "content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    send(res, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json"));
    return;
  }
  if (!configured(env)) {
    send(res, 503, errorBody("INTAKE_NOT_CONFIGURED", "Public intake is not configured"));
    return;
  }
  let body;
  try {
    body = await readLimited(req);
  } catch {
    body = null;
  }
  if (body === null) {
    send(res, 413, errorBody("PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB"));
    return;
  }
  const clientIp = String(getHeader(req.headers, "x-vercel-forwarded-for") || "").split(",", 1)[0].trim();
  const origin = String(getHeader(req.headers, "origin") || "").trim();
  try {
    const upstream = await fetchWorker(env, fetchImpl, body, clientIp, origin);
    send(res, upstream.status, upstream.text, upstream.contentType);
  } catch {
    send(res, 502, errorBody("INTAKE_UNAVAILABLE", "Public intake is temporarily unavailable"));
  }
}

export default async function handler(req, res) {
  return proxyIntake(req, res);
}
