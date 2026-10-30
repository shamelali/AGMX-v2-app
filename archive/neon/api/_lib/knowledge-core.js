"use strict";

const EDGE_TYPES = new Set([
  "PROPOSED_BY",
  "SECONDED_BY",
  "ADOPTED_AT",
  "ASSIGNS_TO",
  "GOVERNED_BY",
  "AMENDS",
  "SUPERSEDES",
  "REQUIRES",
  "MEMBER_OF",
]);
const MAX_CHUNKS = 24;
const MAX_ASSERTIONS = 60;
const MAX_CHUNK_TEXT = 2_500;
const MAX_ENTITY_LENGTH = 160;
const MAX_QUOTE_LENGTH = 1_200;

function validQuestion(value) {
  if (typeof value !== "string") throw new Error("query must be a string");
  const question = value.trim();
  if (!question || question.length > 2_000) {
    throw new Error("query must contain 1 to 2000 characters");
  }
  return question;
}

function validOrgId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new Error("orgId is invalid");
  }
  return value.trim();
}

function defaultStore() {
  try {
    // Load lazily so callers can use provider/store injection without requiring
    // a deployment-specific persistence adapter at module import time.
    return require("./knowledge-store");
  } catch (_) {
    throw new Error("Knowledge store is not configured");
  }
}

function sanitizeChunk(chunk) {
  if (!chunk || typeof chunk !== "object" || typeof chunk.id !== "string") return null;
  const id = chunk.id.trim();
  if (!id || id.length > 512 || typeof chunk.text !== "string" || !chunk.text.trim()) return null;
  return {
    id,
    documentId: typeof chunk.documentId === "string" ? chunk.documentId.slice(0, 512) : "",
    title: typeof chunk.title === "string" ? chunk.title.slice(0, 500) : "",
    page: Number.isFinite(Number(chunk.page)) ? Number(chunk.page) : null,
    text: chunk.text.slice(0, MAX_CHUNK_TEXT),
  };
}

function normalizeEntity(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function sanitizeEvidence(value) {
  const source = value && typeof value === "object" ? value : {};
  const chunks = [];
  const seen = new Set();
  for (const candidate of Array.isArray(source.chunks) ? source.chunks : []) {
    if (chunks.length >= MAX_CHUNKS) break;
    const chunk = sanitizeChunk(candidate);
    if (!chunk || seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    chunks.push(chunk);
  }
  const assertions = [];
  for (const candidate of Array.isArray(source.assertions) ? source.assertions : []) {
    if (assertions.length >= MAX_ASSERTIONS) break;
    if (!candidate || typeof candidate !== "object") continue;
    const chunkId = typeof candidate.chunkId === "string" ? candidate.chunkId.trim() : "";
    const chunk = chunks.find((item) => item.id === chunkId);
    const sourceEntity = normalizeEntity(candidate.source);
    const target = normalizeEntity(candidate.target);
    const type = typeof candidate.type === "string" ? candidate.type.trim().toUpperCase() : "";
    const quote = typeof candidate.quote === "string" ? candidate.quote : "";
    if (
      !chunk ||
      !sourceEntity ||
      !target ||
      sourceEntity.length > MAX_ENTITY_LENGTH ||
      target.length > MAX_ENTITY_LENGTH ||
      !EDGE_TYPES.has(type) ||
      !quote ||
      quote.length > MAX_QUOTE_LENGTH ||
      !chunk.text.includes(quote)
    ) {
      continue;
    }
    assertions.push({ source: sourceEntity, type, target, quote, chunkId });
  }
  return { chunks, assertions };
}

function safeClaims(result, evidence) {
  if (!result || typeof result !== "object" || !Array.isArray(result.claims)) {
    throw new Error("Knowledge generation returned invalid output");
  }
  const ids = new Set(evidence.chunks.map((chunk) => chunk.id));
  const claims = [];
  for (const claim of result.claims.slice(0, 30)) {
    if (!claim || typeof claim !== "object") continue;
    const text = typeof claim.text === "string" ? claim.text.trim() : "";
    const kind = claim.kind === "fact" || claim.kind === "inference" ? claim.kind : "";
    const citations = Array.isArray(claim.citations)
      ? [...new Set(claim.citations.filter((id) => typeof id === "string" && ids.has(id.trim())).map((id) => id.trim()))].slice(0, 12)
      : [];
    if (!text || text.length > 1_200 || !kind || !citations.length) continue;
    claims.push({ text, kind, citations });
  }
  const unknowns = Array.isArray(result.unknowns)
    ? result.unknowns
        .filter((unknown) => typeof unknown === "string")
        .map((unknown) => unknown.trim())
        .filter((unknown) => unknown && unknown.length <= 500)
        .slice(0, 20)
    : [];
  if (!claims.length) {
    return {
      answer: "Insufficient evidence to answer the question from the supplied sources.",
      claims: [],
      unknowns: unknowns.length ? unknowns : ["No citable claims were supported by the retrieved evidence."],
    };
  }
  return {
    answer: claims
      .map((claim) => `${claim.kind === "inference" ? "Inference" : "Fact"}: ${claim.text}`)
      .join("\n"),
    claims,
    unknowns,
  };
}

async function ask(orgId, query, options) {
  const organizationId = validOrgId(orgId);
  const question = validQuestion(query);
  const startedAt = Date.now();
  const config = options && typeof options === "object" ? options : {};
  const providers = config.providers || require("./knowledge-providers");
  const store = config.store || defaultStore();
  if (!providers || typeof providers.embed !== "function" || typeof providers.generate !== "function") {
    throw new Error("Knowledge providers are not configured");
  }
  if (!store || typeof store.semanticSearch !== "function" || typeof store.evidence !== "function") {
    throw new Error("Knowledge store is not configured");
  }

  const vector = await providers.embed(question, "query");
  const matches = await store.semanticSearch(organizationId, vector);
  const retrievalIds = [];
  const seenIds = new Set();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match || typeof match.id !== "string" || !match.id.trim() || seenIds.has(match.id.trim())) continue;
    if (typeof match.score !== "number" || !Number.isFinite(match.score)) continue;
    seenIds.add(match.id.trim());
    retrievalIds.push(match.id.trim());
    if (retrievalIds.length >= MAX_CHUNKS) break;
  }
  const storedEvidence = await store.evidence(organizationId, retrievalIds, question);
  // The server-side store authorizes every source against the organization.
  // Graph and lexical expansion may legitimately return additional chunk IDs.
  const evidence = sanitizeEvidence(storedEvidence);
  const retrievalMs = Date.now() - startedAt;
  if (!evidence.chunks.length) {
    return {
      answer: "Insufficient evidence to answer the question from the supplied sources.",
      claims: [],
      unknowns: ["No citable claims were supported by the retrieved evidence."],
      evidence,
      timings: { retrievalMs, totalMs: Date.now() - startedAt },
    };
  }
  const generated = await providers.generate(question, evidence);
  const answer = safeClaims(generated, evidence);
  return {
    ...answer,
    evidence,
    timings: { retrievalMs, totalMs: Date.now() - startedAt },
  };
}

module.exports = { ask };
