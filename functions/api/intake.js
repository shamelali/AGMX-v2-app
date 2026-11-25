const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
const PROXY_TIMEOUT_MS = 30_000;

function configured(env) {
  if (!env?.INTAKE_WORKER_URL || !env?.INTAKE_PROXY_SECRET) return false;
  try {
    const url = new URL(env.INTAKE_WORKER_URL);
    return url.protocol === "https:" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function error(code, message, status) {
  return json({ ok: false, error: { code, message } }, status);
}

async function readLimited(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isSafeInteger(declared) && declared >= 0 && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
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
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function proxyIntake(request, env, { fetchImpl = globalThis.fetch } = {}) {
  if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  if (String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return error("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", 415);
  }
  if (!configured(env)) return error("INTAKE_NOT_CONFIGURED", "Public intake is not configured", 503);
  let body;
  try {
    body = await readLimited(request);
  } catch {
    body = null;
  }
  if (body === null) return error("PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB", 413);
  const clientIp = String(request.headers.get("cf-connecting-ip") || "").trim();
  const origin = String(request.headers.get("origin") || "").trim();
  try {
    return await fetchWorker(env, fetchImpl, body, clientIp, origin);
  } catch {
    return error("INTAKE_UNAVAILABLE", "Public intake is temporarily unavailable", 502);
  }
}

export async function onRequestPost(context) {
  return proxyIntake(context.request, context.env);
}
