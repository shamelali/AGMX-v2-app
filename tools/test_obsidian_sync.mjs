#!/usr/bin/env node
/**
 * AGMX — Obsidian sync end-to-end regression test
 *
 * Spawns scripts/obsidian-sync.mjs against a standalone PostgREST +
 * embeddings stub (tools/obsidian_stub.mjs) and pins the behaviors the sync
 * has to keep: a failed embed pass must not leave an orphan document or a
 * stuck `processing` job, and a changed note must replace its previous
 * document rather than stacking a duplicate. Nothing here touches the network
 * or a real database.
 *
 *   node tools/test_obsidian_sync.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "scripts", "obsidian-sync.mjs");
const STUB = join(here, "obsidian_stub.mjs");
const ORG = "00000000-0000-0000-0000-000000000001";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function failEmbed(stub, on) {
  return fetch(`${stub.base}/__control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ failEmbed: on }),
  });
}

async function startStub(failEmbed = false) {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const child = spawn("node", [STUB], {
    env: { ...process.env, OBSIDIAN_STUB_PORT: String(port), ...(failEmbed ? { OBSIDIAN_STUB_FAIL_EMBED: "1" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/rest/v1/organizations?select=id,name&limit=2`);
      if (probe.ok) { ready = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(ready, "stub did not come up");
  return { port, base: `http://127.0.0.1:${port}`, child };
}

function runSync(base, vault) {
  const env = {
    ...process.env,
    SUPABASE_URL: base,
    SUPABASE_SECRET_KEY: "test-service-key",
    LLM_PROVIDER: "nvidia",
    NVIDIA_NIM_API_KEY: "test-nim-key",
    NVIDIA_NIM_BASE_URL: `${base}/v1`,
  };
  const result = spawnSync("node", [SCRIPT, "--vault", vault], { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

const A = "# Notis\n\nNotis mesyuarat mesti dihantar empat belas hari sebelum tarikh mesyuarat.\n";
const B = "# Kuorum\n\nKuorum ialah dua kali ganda bilangan ahli hadir.\n\nPengundian dibuat secara ya, tidak atau kecuali.\n";
const C = "# Kelulusan\n\nMinit perlu ditandatangani oleh pengerusi dan setiausaha.\n";

test("failed embed leaves no orphan document or stuck job, and a retry succeeds", async () => {
  const stub = await startStub();
  const vault = mkdtempSync(join(tmpdir(), "agmx-obs-"));
  mkdirSync(join(vault, "nested"));
  writeFileSync(join(vault, "a.md"), A);
  writeFileSync(join(vault, "nested", "b.md"), B);

  try {
    // First pass: two notes indexed, jobs completed.
    let out = runSync(stub.base, vault);
    assert(out.status === 0, `first sync failed: ${out.stderr}`);
    assert(out.stdout.includes("2 added, 0 unchanged"), `unexpected first run: ${out.stdout}`);
    const health = await fetch(`${stub.base}/rest/v1/documents?select=id,filename,sha256`);
    const docs = await health.json();
    assert(docs.length === 2, `expected 2 documents, found ${docs.length}`);
    const jobs = await (await fetch(`${stub.base}/rest/v1/knowledge_jobs?select=id,status`)).json();
    assert(jobs.every((j) => j.status === "completed"), "all jobs should be completed");

    const indexed = await (await fetch(stub.base + "/rest/v1/knowledge_chunks?select=embedding")).json();
    assert(indexed.length && indexed.every(r => r.embedding.length === 2048 && r.embedding.slice(1024).every(n => n === 0)),
      "NVIDIA vectors must fill the 2048-dimensional storage column without changing the native coordinates");

    // Second pass is a no-op (hash unchanged).
    out = runSync(stub.base, vault);
    assert(out.stdout.includes("0 added, 2 unchanged"), `re-run should skip: ${out.stdout}`);

    // A changed note replaces its previous document instead of stacking a copy.
    writeFileSync(join(vault, "a.md"), "# Notis (disemak)\n\nTeks baharu yang lebih panjang untuk mengesahkan penggantian dokumen lama.\n");
    out = runSync(stub.base, vault);
    assert(out.status === 0, `replacement sync failed: ${out.stderr}`);
    const docsAfter = await (await fetch(`${stub.base}/rest/v1/documents?select=id,filename,sha256`)).json();
    assert(docsAfter.length === 2, `replacement must not add a third document, found ${docsAfter.length}`);
    assert(docsAfter.filter((d) => d.filename === "a.md").length === 1, "exactly one a.md document should exist");

    // Fail the embed endpoint: the new note is inserted, then embed fails.
    await failEmbed(stub, true);
    writeFileSync(join(vault, "c.md"), C);
    out = runSync(stub.base, vault);
    assert(out.status !== 0, "a failed embed must make the sync exit non-zero");
    const docsAfterFail = await (await fetch(`${stub.base}/rest/v1/documents?select=id,filename`)).json();
    assert(!docsAfterFail.some((d) => d.filename === "c.md"), "c.md must not remain as an orphan document after the failed pass");
    const jobsAfterFail = await (await fetch(`${stub.base}/rest/v1/knowledge_jobs?select=id,status,source_path`)).json();
    assert(!jobsAfterFail.some((j) => j.source_path === "c.md"), "no c.md job may be left behind after the failed pass");

    // Recovery: embeddings come back, the note is indexed exactly once.
    await failEmbed(stub, false);
    out = runSync(stub.base, vault);
    assert(out.status === 0, `recovery sync failed: ${out.stderr}`);
    const docsRecovered = await (await fetch(`${stub.base}/rest/v1/documents?select=id,filename`)).json();
    assert(docsRecovered.filter((d) => d.filename === "c.md").length === 1, "c.md must be indexed exactly once after recovery");
  } finally {
    try { stub.child.kill("SIGKILL"); } catch {}
    rmSync(vault, { recursive: true, force: true });
  }
});

/* ---- runner ---- */
let failed = 0;
let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${error.message}`);
  }
}
console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
