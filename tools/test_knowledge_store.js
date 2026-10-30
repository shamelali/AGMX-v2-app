"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const neon = require("../api/_lib/neon");
const { ask } = require("../api/_lib/knowledge-core");

function vectorAt(index) {
  const values = Array(1024).fill(0);
  values[index] = 1;
  return values;
}

async function run() {
  // Execute the application's parameterized SQL against ephemeral Postgres,
  // including its migrations, without using a deployment DATABASE_URL.
  const db = new PGlite({ extensions: { pgcrypto } });
  const previousSql = neon.sql;
  neon.sql = () => async (strings, ...values) => {
    const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    return (await db.query(query, values)).rows;
  };
  const store = require("../api/_lib/knowledge-store");
  try {
    for (const filename of ["schema.sql", "graphrag.sql"]) {
      await db.exec(fs.readFileSync(path.join(__dirname, "../neon", filename), "utf8"));
    }
    // PGlite has no pgvector extension. Keep the production migration separate:
    // this test-only domain lets us exercise the store's parameterized ::vector
    // inserts and nullable column, but cannot evaluate cosine distance.
    await db.exec("create domain vector as text; alter table knowledge_chunks add column embedding vector;");
    await db.exec(`insert into organizations (id, slug, name, status) values
      ('org-a', 'org-a', 'Organization A', 'active'),
      ('org-b', 'org-b', 'Organization B', 'trial'),
      ('org-suspended', 'org-suspended', 'Suspended organization', 'suspended')`);

    assert.equal(await store.enqueue("org-suspended", { title: "Policy", pages: [{ page: 1, text: "text" }] }), null);
    await assert.rejects(() => store.enqueue("org-a", {
      title: "Duplicate pages", pages: [{ page: 1, text: "first" }, { page: 1, text: "second" }],
    }), /page numbers must be unique/);

    async function publish(orgId, title, body, source, target, page = 1) {
      const queued = await store.enqueue(orgId, { title, pages: [{ page, text: body }] });
      assert.equal(queued.status, "queued");
      const claimed = await store.claim();
      assert.equal(claimed.id, queued.id);
      assert.equal(claimed.attempts, 1);
      const chunk = { id: `${queued.id}:0`, title, page, text: body };
      const assertion = { source, type: "REQUIRES", target, quote: body, chunkId: chunk.id };
      const embeddings = [{ id: chunk.id, values: vectorAt(0) }];
      await store.complete(claimed.id, claimed.leaseToken, [chunk], [assertion, assertion], embeddings);
      assert.equal((await store.job(orgId, queued.id)).status, "ready");
      assert.equal(await store.job(orgId === "org-a" ? "org-b" : "org-a", queued.id), null);
      await assert.rejects(() => store.complete(claimed.id, claimed.leaseToken, [chunk], [assertion], embeddings), /lease is stale/);
      return chunk;
    }

    const seed = await publish("org-a", "Meeting", "The meeting requires policy alpha.", "meeting", "policy alpha", 99);
    const linked = await publish("org-a", "Policy", "Policy alpha requires an annual review.", "policy alpha", "annual review");
    const foreign = await publish("org-b", "Private", "Policy alpha requires a private review.", "policy alpha", "private review");
    await assert.rejects(() => db.query(
      "insert into knowledge_assertions (document_id, source, type, target, quote, chunk_id) " +
      "select document_id, 'foreign', 'REQUIRES', 'leak', 'should not appear', $2 " +
      "from knowledge_chunks where id = $1",
      [foreign.id, seed.id],
    ), /foreign key constraint/);
    const stored = (await db.query('select "text", embedding::text as embedding from knowledge_chunks where id = $1', [seed.id])).rows[0];
    assert.equal(stored.text, "The meeting requires policy alpha.");
    assert.equal(stored.embedding, `[${vectorAt(0).join(",")}]`, "chunk and embedding publish together");
    assert.equal(Number((await db.query("select count(*) as total from knowledge_assertions")).rows[0].total), 3,
      "publication must persist each document's edge exactly once");
    assert.equal(Number((await db.query("select count(*) as total from knowledge_chunks where embedding is null")).rows[0].total), 0);

    const evidence = await store.evidence("org-a", [foreign.id, seed.id], "");
    assert.deepEqual(evidence.chunks.map(chunk => chunk.id), [seed.id, linked.id]);
    assert.equal(evidence.assertions.length, 2);
    assert.equal(evidence.assertions.some(edge => edge.target === "private review"), false);
    assert.deepEqual(await store.evidence("org-suspended", [seed.id], "policy"), { chunks: [], assertions: [] });

    // Stub the search provider for ask: PGlite cannot run the pgvector cosine
    // operator, while real store.evidence still enforces tenant/graph scoping.
    const answer = await ask("org-a", "What review is required?", {
      providers: {
        async embed() { return vectorAt(0); },
        async generate(question, sources) {
          assert.equal(sources.chunks.some(chunk => chunk.id === linked.id), true, "graph-only evidence reaches generation");
          assert.equal(sources.chunks.some(chunk => chunk.id === foreign.id), false);
          return { claims: [{ text: "An annual review is required.", kind: "fact", citations: [linked.id] }] };
        },
      },
      store: {
        ...store,
        async semanticSearch(orgId, vector) {
          assert.equal(orgId, "org-a");
          assert.equal(vector.length, 1024);
          return [{ id: seed.id, score: 1 }, { id: foreign.id, score: 0.5 }];
        },
      },
    });
    assert.deepEqual(answer.claims[0].citations, [linked.id]);

    const lexical = await store.evidence("org-a", [], "annual review");
    assert.equal(lexical.chunks.some(chunk => chunk.id === linked.id), true, "lexical retrieval works without vector seeds");

    // More than 24 connected sources must not displace the original seed.
    for (let index = 0; index < 24; index += 1) {
      await publish("org-a", `Related policy ${index}`, `Policy alpha requires action ${index}.`, "policy alpha", `action ${index}`);
    }
    const bounded = await store.evidence("org-a", [seed.id], "policy");
    assert.equal(bounded.chunks.length, 24);
    assert.equal(bounded.chunks[0].id, seed.id);
    assert.ok(bounded.assertions.length <= 60);

    const legacyId = `${seed.id.split(":")[0]}:1`;
    await db.query(
      'insert into knowledge_chunks (id, document_id, title, page, "text") values ($1, $2, $3, $4, $5)',
      [legacyId, seed.id.split(":")[0], "Legacy document", 1, "Backfill source text"],
    );
    assert.deepEqual((await store.unembeddedChunks(1)).map(row => row.id), [legacyId]);
    await assert.rejects(() => store.unembeddedChunks(0), /limit must be/);
    await assert.rejects(() => store.setEmbedding(legacyId, [1]), /1024 dimensions/);
    assert.equal(await store.setEmbedding(legacyId, vectorAt(0)), true);
    assert.equal(await store.setEmbedding(legacyId, vectorAt(1)), false, "a repeated backfill must not overwrite an embedding");
    assert.deepEqual(await store.unembeddedChunks(), []);

    const invalid = await store.enqueue("org-a", { title: "Invalid vectors", pages: [{ page: 1, text: "Valid chunk." }] });
    const invalidLease = await store.claim();
    assert.equal(invalidLease.id, invalid.id);
    const chunk = { id: `${invalid.id}:0`, title: "Invalid vectors", page: 1, text: "Valid chunk." };
    const other = { id: `${invalid.id}:1`, title: "Invalid vectors", page: 1, text: "Another chunk." };
    const validRecord = { id: chunk.id, values: vectorAt(0) };
    for (const [records, reason] of [
      [undefined, /one record per chunk/],
      [null, /one record per chunk/],
      [[], /one record per chunk/],
      [[{ id: chunk.id, values: null }], /1024 dimensions/],
      [[{ id: chunk.id, values: [1] }], /1024 dimensions/],
      [[{ id: chunk.id, values: Array(1024).fill(0) }], /must not be zero/],
      [[{ id: chunk.id, values: vectorAt(0).map((value, index) => index === 1 ? NaN : value) }], /finite numbers/],
      [[{ id: chunk.id, values: vectorAt(0).map((value, index) => index === 1 ? Infinity : value) }], /finite numbers/],
      [[{ id: chunk.id, values: vectorAt(0).map((value, index) => index === 1 ? "0" : value) }], /finite numbers/],
      [[{ id: other.id, values: vectorAt(0) }], /embedding id must match/],
    ]) {
      await assert.rejects(() => store.complete(invalid.id, invalidLease.leaseToken, [chunk], [], records), reason);
    }
    await assert.rejects(() => store.complete(invalid.id, invalidLease.leaseToken, [chunk, other], [],
      [validRecord, validRecord]), /embedding id must match/);
    assert.equal((await store.job("org-a", invalid.id)).status, "processing");
    assert.equal(Number((await db.query("select count(*) as total from knowledge_chunks where document_id = $1", [invalid.id])).rows[0].total), 0);
    assert.equal(Number((await db.query("select count(*) as total from knowledge_assertions where document_id = $1", [invalid.id])).rows[0].total), 0);

    // Match embeddings by chunk ID even when records arrive in a different order.
    await store.complete(invalid.id, invalidLease.leaseToken, [chunk, other], [], [
      { id: other.id, values: vectorAt(1) }, validRecord,
    ]);
    assert.equal((await store.job("org-a", invalid.id)).status, "ready");
    const published = (await db.query("select id, embedding::text as embedding from knowledge_chunks where document_id = $1 order by id", [invalid.id])).rows;
    assert.deepEqual(published.map(row => row.id), [chunk.id, other.id]);
    assert.deepEqual(published.map(row => row.embedding), [vectorAt(0), vectorAt(1)].map(values => `[${values.join(",")}]`));

    const retry = await store.enqueue("org-a", { title: "Retry", pages: [{ page: 1, text: "Retry text" }] });
    const firstLease = await store.claim();
    assert.equal(firstLease.id, retry.id);
    assert.equal(await store.renew(retry.id, firstLease.leaseToken), true);
    assert.equal(await store.claim(), null, "unexpired jobs must not be reclaimed");
    await db.query("update knowledge_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [retry.id]);
    assert.equal(await store.renew(retry.id, firstLease.leaseToken), false, "an expired lease cannot be revived");
    const secondLease = await store.claim();
    assert.equal(secondLease.attempts, 2);
    assert.notEqual(secondLease.leaseToken, firstLease.leaseToken);
    assert.equal(await store.renew(retry.id, firstLease.leaseToken), false);
    assert.equal(await store.renew(retry.id, secondLease.leaseToken), true);
    const retryChunk = { id: `${retry.id}:0`, title: "Retry", page: 1, text: "Retry text" };
    await assert.rejects(() => store.complete(retry.id, firstLease.leaseToken, [retryChunk], [],
      [{ id: retryChunk.id, values: vectorAt(0) }]), /lease is stale/);
    assert.equal(Number((await db.query("select count(*) as total from knowledge_chunks where document_id = $1", [retry.id])).rows[0].total), 0,
      "a stale lease cannot publish any chunk or embedding");
    await store.fail(retry.id, firstLease.leaseToken);
    assert.equal((await store.job("org-a", retry.id)).status, "processing", "stale failure cannot release a new lease");
    await store.fail(retry.id, secondLease.leaseToken);
    assert.equal((await store.job("org-a", retry.id)).status, "queued");
    const lastLease = await store.claim();
    assert.equal(lastLease.attempts, 3);
    await db.query("update knowledge_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [retry.id]);
    assert.equal(await store.claim(), null);
    assert.equal((await store.job("org-a", retry.id)).status, "failed");
    assert.equal(await store.job("org-a", randomUUID()), null);

    console.log("knowledge Postgres integration: embedding publication, graph/tenant isolation, expansion, bounds, and stale leases passed");
  } finally {
    neon.sql = previousSql;
    await db.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
