const MAX_BODY_BYTES = 16 * 1024;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND_URL = "https://api.resend.com/emails";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set([
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Melaka", "Negeri Sembilan",
  "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu",
]);
const TOP_LEVEL_FIELDS = new Set(["submissionId", "turnstileToken", "assessment"]);
const ASSESSMENT_FIELDS = new Set([
  "coopName", "coopReg", "state", "members", "agmDate", "mode", "expectedAttendance",
  "candidates", "motions", "currentProcess", "needsManaged", "contactName", "contactPhone", "contactEmail",
]);
const REQUIRED_ENV = [
  "INTAKE_PROXY_SECRET", "TURNSTILE_SECRET_KEY", "INTAKE_INTERNAL_KEY", "SUPABASE_FUNCTION_URL",
  "RESEND_API_KEY", "SMTP_FROM", "INTAKE_EMAIL_TO", "TURNSTILE_EXPECTED_HOSTNAME",
  "TURNSTILE_EXPECTED_ACTION", "INTAKE_ALLOWED_ORIGIN",
];

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function errorResponse(status, code, message, fields) {
  return jsonResponse({ ok: false, error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

function log(logger, level, event, details = {}) {
  const target = logger && typeof logger[level] === "function" ? logger[level] : console[level];
  target(JSON.stringify({ event, ...details }));
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(bytes);
}

async function secretMatches(provided, expected) {
  if (!provided || !expected) return false;
  const [actualHash, expectedHash] = await Promise.all([digest(provided), digest(expected)]);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(actualHash, expectedHash);
  }
  let difference = 0;
  for (let index = 0; index < actualHash.byteLength; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index];
  }
  return difference === 0;
}

function validConfiguration(env) {
  if (!env || REQUIRED_ENV.some((name) => !String(env[name] || "").trim())) return false;
  try {
    const url = new URL(env.SUPABASE_FUNCTION_URL);
    const origin = new URL(env.INTAKE_ALLOWED_ORIGIN);
    return url.protocol === "https:" && !url.search && !url.hash && origin.protocol === "https:";
  } catch {
    return false;
  }
}

async function readBody(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("invalid content-length");
    if (length > MAX_BODY_BYTES) return { tooLarge: true };
  }
  if (!request.body) return { tooLarge: false, text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { tooLarge: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return { tooLarge: false, text };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownFields(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function stringField(source, key, max, fields, { required = true } = {}) {
  const value = source[key];
  if (value === undefined || value === null || value === "") {
    if (required) fields[key] = "Required";
    return null;
  }
  if (typeof value !== "string") {
    fields[key] = "Must be text";
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed && required) {
    fields[key] = "Required";
    return null;
  }
  if (trimmed.length > max) {
    fields[key] = `Must be at most ${max} characters`;
    return null;
  }
  return trimmed || null;
}

function integerField(source, key, min, max, fields, { required = true } = {}) {
  const value = source[key];
  if (value === undefined || value === null || value === "") {
    if (required) fields[key] = "Required";
    return null;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    fields[key] = `Must be an integer from ${min} to ${max}`;
    return null;
  }
  return value;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validatePayload(payload) {
  const fields = {};
  if (!isObject(payload)) return { fields: { _form: "Must be an object" } };
  for (const key of unknownFields(payload, TOP_LEVEL_FIELDS)) fields[key] = "Unknown field";

  const submissionId = typeof payload.submissionId === "string" ? payload.submissionId.toLowerCase() : "";
  if (!UUID_V4.test(submissionId)) fields.submissionId = "Must be a UUID v4";
  const turnstileToken = stringField(payload, "turnstileToken", 2048, fields);
  if (!isObject(payload.assessment)) {
    fields.assessment = "Must be an object";
    return { fields };
  }

  const source = payload.assessment;
  for (const key of unknownFields(source, ASSESSMENT_FIELDS)) fields[key] = "Unknown field";
  const coopName = stringField(source, "coopName", 200, fields);
  const coopReg = stringField(source, "coopReg", 100, fields, { required: false });
  const state = stringField(source, "state", 100, fields);
  if (state && !STATES.has(state)) fields.state = "Unsupported state";
  const members = integerField(source, "members", 1, 1_000_000, fields);
  const expectedAttendance = integerField(source, "expectedAttendance", 1, 1_000_000, fields);
  if (members !== null && expectedAttendance !== null && expectedAttendance > members) {
    fields.expectedAttendance = "Must not exceed members";
  }
  const candidates = integerField(source, "candidates", 0, 10_000, fields);
  const motions = integerField(source, "motions", 0, 10_000, fields);
  const agmDate = stringField(source, "agmDate", 10, fields, { required: false });
  if (agmDate && !validDate(agmDate)) fields.agmDate = "Must be a valid YYYY-MM-DD date";

  const mode = stringField(source, "mode", 20, fields);
  if (mode && !["physical", "online", "hybrid"].includes(mode)) fields.mode = "Unsupported AGM mode";
  const currentProcess = stringField(source, "currentProcess", 20, fields);
  if (currentProcess && !["manual", "mixed", "digital"].includes(currentProcess)) {
    fields.currentProcess = "Unsupported process";
  }
  if (typeof source.needsManaged !== "boolean") fields.needsManaged = "Must be true or false";
  const contactName = stringField(source, "contactName", 200, fields);
  const contactPhone = stringField(source, "contactPhone", 32, fields);
  if (contactPhone) {
    const normalized = contactPhone.replace(/[\s()-]/g, "");
    if (!/^\+?\d{8,15}$/.test(normalized)) fields.contactPhone = "Must be a valid phone number";
  }
  const contactEmail = stringField(source, "contactEmail", 254, fields, { required: false });
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) fields.contactEmail = "Must be a valid email";

  if (Object.keys(fields).length) return { fields };
  return {
    fields,
    value: {
      submissionId,
      turnstileToken,
      assessment: {
        coopName,
        coopReg,
        state,
        members,
        agmDate,
        mode,
        expectedAttendance,
        candidates,
        motions,
        currentProcess,
        needsManaged: source.needsManaged,
        contactName,
        contactPhone: contactPhone.replace(/[\s()-]/g, ""),
        contactEmail,
      },
    },
  };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyTurnstile(token, env, request, fetchImpl) {
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const clientIp = request.headers.get("x-agmx-client-ip");
  if (clientIp) body.set("remoteip", clientIp);
  const response = await fetchWithTimeout(fetchImpl, TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, 5000);
  if (!response.ok) throw new Error("turnstile unavailable");
  const result = await response.json();
  return result?.success === true
    && result?.hostname === env.TURNSTILE_EXPECTED_HOSTNAME
    && result?.action === env.TURNSTILE_EXPECTED_ACTION;
}

async function persistAssessment(value, env, fetchImpl, clientIp) {
  const assessment = {
    ...value.assessment,
    currentProcess: value.assessment.currentProcess === "mixed" ? "partial" : value.assessment.currentProcess,
  };
  return fetchWithTimeout(fetchImpl, env.SUPABASE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agmx-intake-key": env.INTAKE_INTERNAL_KEY,
      ...(clientIp ? { "x-agmx-client-ip": clientIp } : {}),
    },
    body: JSON.stringify({ submissionId: value.submissionId, assessment }),
  }, 10_000);
}

function validPersistenceResult(result) {
  return isObject(result)
    && result.ok === true
    && typeof result.submissionId === "string"
    && typeof result.assessmentId === "string"
    && typeof result.reference === "string"
    && typeof result.token === "string"
    && Number.isInteger(result.complexityScore)
    && typeof result.recommendedPlan === "string"
    && typeof result.quoteUrl === "string"
    && typeof result.replayed === "boolean";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function notification(assessment, result, env) {
  const subject = `New AGMX assessment: ${result.reference.replace(/[\r\n]/g, "")}`;
  const text = [
    "New AGMX assessment received",
    `Reference: ${result.reference}`,
    `Cooperative: ${assessment.coopName}`,
    `Registration: ${assessment.coopReg || "-"}`,
    `State: ${assessment.state}`,
    `Members: ${assessment.members}`,
    `Expected attendance: ${assessment.expectedAttendance}`,
    `AGM mode: ${assessment.mode}`,
    `Contact: ${assessment.contactName}`,
    `Phone: ${assessment.contactPhone}`,
    `Email: ${assessment.contactEmail || "-"}`,
    `Complexity score: ${result.complexityScore}`,
    `Recommended plan: ${result.recommendedPlan}`,
  ].join("\n");
  const rows = [
    ["Reference", result.reference],
    ["Cooperative", assessment.coopName],
    ["Registration", assessment.coopReg || "-"],
    ["State", assessment.state],
    ["Members", assessment.members],
    ["Expected attendance", assessment.expectedAttendance],
    ["AGM mode", assessment.mode],
    ["Contact", assessment.contactName],
    ["Phone", assessment.contactPhone],
    ["Email", assessment.contactEmail || "-"],
    ["Complexity score", result.complexityScore],
    ["Recommended plan", result.recommendedPlan],
  ].map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  const html = `<h1>New AGMX assessment</h1><table>${rows}</table>`;
  return { subject, text, html };
}

async function sendNotification(assessment, result, env, fetchImpl) {
  const mail = notification(assessment, result, env);
  const response = await fetchWithTimeout(fetchImpl, RESEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `agmx-intake-${result.submissionId}`,
    },
    body: JSON.stringify({
      from: env.SMTP_FROM,
      to: env.INTAKE_EMAIL_TO.split(",").map((value) => value.trim()).filter(Boolean),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  }, 8000);
  return response.ok;
}

export async function handleIntake(request, env, _ctx, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const logger = dependencies.logger || console;
  const path = new URL(request.url).pathname;
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  if (path !== "/api/intake") {
    return errorResponse(404, "NOT_FOUND", "Not found");
  }
  if (!validConfiguration(env)) {
    log(logger, "error", "intake_not_configured");
    return errorResponse(503, "INTAKE_NOT_CONFIGURED", "Public intake is not configured");
  }
  const contentType = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  if (request.headers.get("origin") !== new URL(env.INTAKE_ALLOWED_ORIGIN).origin) {
    return errorResponse(403, "ORIGIN_REJECTED", "Origin is not allowed");
  }
  if (!(await secretMatches(request.headers.get("x-agmx-intake-proxy-secret"), env.INTAKE_PROXY_SECRET))) {
    return errorResponse(403, "PROXY_REJECTED", "Proxy credential is not valid");
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return errorResponse(400, "INVALID_BODY", "Invalid request body");
  }
  if (body.tooLarge) return errorResponse(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB");

  let payload;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const validated = validatePayload(payload);
  if (!validated.value) {
    return errorResponse(400, "INVALID_INPUT", "Invalid submission", validated.fields);
  }
  const value = validated.value;

  let turnstileOk;
  try {
    turnstileOk = await verifyTurnstile(value.turnstileToken, env, request, fetchImpl);
  } catch {
    log(logger, "error", "turnstile_unavailable", { submissionId: value.submissionId });
    return errorResponse(502, "TURNSTILE_UNAVAILABLE", "Bot verification is temporarily unavailable");
  }
  if (!turnstileOk) {
    log(logger, "info", "turnstile_rejected", { submissionId: value.submissionId });
    return errorResponse(403, "TURNSTILE_REJECTED", "Bot verification failed");
  }

  let upstream;
  try {
    upstream = await persistAssessment(
      value,
      env,
      fetchImpl,
      request.headers.get("x-agmx-client-ip")
    );
  } catch {
    log(logger, "error", "intake_persistence_unavailable", { submissionId: value.submissionId });
    return errorResponse(502, "PERSISTENCE_UNAVAILABLE", "Assessment service is temporarily unavailable");
  }
  if (upstream.status === 409) {
    return errorResponse(409, "SUBMISSION_CONFLICT", "Submission id was already used with different content");
  }
  if (upstream.status === 429) {
    return errorResponse(429, "RATE_LIMITED", "Too many submissions; please try again later");
  }
  if (upstream.status !== 200 && upstream.status !== 201) {
    log(logger, "error", "intake_persistence_rejected", { submissionId: value.submissionId, status: upstream.status });
    return errorResponse(502, "PERSISTENCE_UNAVAILABLE", "Assessment service is temporarily unavailable");
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    result = null;
  }
  if (!validPersistenceResult(result)) {
    log(logger, "error", "intake_persistence_invalid", { submissionId: value.submissionId });
    return errorResponse(502, "PERSISTENCE_UNAVAILABLE", "Assessment service returned an invalid response");
  }

  let emailStatus = "failed";
  try {
    emailStatus = await sendNotification(value.assessment, result, env, fetchImpl) ? "queued" : "failed";
  } catch {
    emailStatus = "failed";
  }
  if (emailStatus === "failed") {
    log(logger, "warn", "intake_notification_failed", { submissionId: value.submissionId, reference: result.reference });
  }

  return jsonResponse({
    ok: true,
    submissionId: result.submissionId,
    assessmentId: result.assessmentId,
    reference: result.reference,
    token: result.token,
    complexityScore: result.complexityScore,
    recommendedPlan: result.recommendedPlan,
    quoteUrl: result.quoteUrl,
    replayed: result.replayed,
    email: { status: emailStatus },
  }, result.replayed ? 200 : 201);
}

export default {
  fetch(request, env, ctx) {
    return handleIntake(request, env, ctx);
  },
};
