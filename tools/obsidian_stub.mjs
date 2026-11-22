#!/usr/bin/env node
/**
 * Standalone PostgREST + embeddings stub for tools/test_obsidian_sync.mjs.
 * Runs as its own process so the test can spawnSync the real sync script
 * without deadlocking the stub's event loop.
 *
 *   OBSIDIAN_STUB_PORT=PORT OBSIDIAN_STUB_FAIL_EMBED=1 node tools/obsidian_stub.mjs
 */
import { createServer } from "node:http";

const PORT = Number(process.env.OBSIDIAN_STUB_PORT);
const ORG = "00000000-0000-0000-0000-000000000001";
const docs = [];
const jobs = [];
let chunks = [];
let embedStatusCode = process.env.OBSIDIAN_STUB_FAIL_EMBED === "1" ? 429 : 200;

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const send = (code, payload) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };

  try {
    if (req.url === "/__control" && req.method === "POST") {
      embedStatusCode = JSON.parse(body).failEmbed ? 429 : 200;
      return send(200, { ok: true, embedStatusCode });
    }
    if (req.url.includes("/embeddings")) {
      const request = JSON.parse(body);
      if (request.input_type !== "passage" || "dimensions" in request) return send(400, {error:"Invalid NVIDIA passage request"});
      if (embedStatusCode !== 200) return send(embedStatusCode, { error: "rate limited" });
      return send(200, {
        data: [{ embedding: Array.from({ length: 1024 }, (_, i) => i / 1024) }],
      });
    }

    const path = decodeURIComponent(req.url.replace(/^\/rest\/v1\//, ""));

    if (path === "organizations?select=id,name&limit=2") {
      return send(200, [{ id: ORG, name: "Koperasi Uji" }]);
    }
    if (path.startsWith("documents?select=")) {
      return send(200, docs);
    }
    if (path.startsWith("knowledge_jobs?select=")) {
      return send(200, jobs);
    }
    if (path.startsWith("knowledge_chunks?select=")) {
      return send(200, chunks);
    }
    if (path === "documents" && req.method === "POST") {
      const doc = { ...JSON.parse(body), id: `doc-${docs.length + 1}` };
      docs.push(doc);
      return send(200, [doc]);
    }
    const deleteDoc = path.match(/^documents\?id=(?:eq\.|in\.\()(.+)\)?$/);
    if (deleteDoc && req.method === "DELETE") {
      const ids = deleteDoc[1].split(",");
      for (let i = docs.length - 1; i >= 0; i--) {
        if (ids.includes(docs[i].id)) docs.splice(i, 1);
      }
      // Jobs whose document is deleted must go too, so the index view the
      // assertions read stays coherent with the real FK behavior.
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (ids.includes(jobs[i].document_id)) jobs.splice(i, 1);
      }
      return send(200, []);
    }
    const deleteJobByDoc = path.match(/^knowledge_jobs\?document_id=eq\.(.+)$/);
    if (deleteJobByDoc && req.method === "DELETE") {
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (jobs[i].document_id === deleteJobByDoc[1]) jobs.splice(i, 1);
      }
      return send(200, []);
    }
    if (path === "knowledge_jobs" && req.method === "POST") {
      const job = { ...JSON.parse(body), id: `job-${jobs.length + 1}` };
      jobs.push(job);
      return send(200, [job]);
    }
    const patchJob = path.match(/^knowledge_jobs\?id=eq\.(.+)$/);
    if (patchJob && req.method === "PATCH") {
      const job = jobs.find((j) => j.id === patchJob[1]);
      if (job) Object.assign(job, JSON.parse(body));
      return send(200, []);
    }
    if (path === "knowledge_chunks" && req.method === "POST") {
      chunks.push(...JSON.parse(body));
      return send(200, []);
    }
    send(404, { error: `unexpected ${req.method} ${req.url}` });
  } catch (error) {
    send(500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.error(`OBSIDIAN_STUB_READY ${PORT}`));
