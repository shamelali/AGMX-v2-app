"use strict";

const assert = require("node:assert/strict");
const providers = require("../api/_lib/knowledge-providers");

async function run() {
  const names = ["NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_EMBEDDING_MODEL"];
  const previousEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = global.fetch;
  let fetchCount = 0;
  const vector = Array.from({ length: 1024 }, (_, index) => index / 1024);
  global.fetch = async () => {
    fetchCount += 1;
    throw new Error("Unexpected outbound request");
  };

  try {
    names.forEach((name) => delete process.env[name]);
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA_API_KEY is not configured/);
    process.env.NVIDIA_API_KEY = "fake-test-key";
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA_BASE_URL is not configured/);
    process.env.NVIDIA_BASE_URL = "https://untrusted.example/v1";
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA_BASE_URL must be/);
    process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
    process.env.NVIDIA_EMBEDDING_MODEL = "another/model";
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA_EMBEDDING_MODEL must be baai\/bge-m3/);
    process.env.NVIDIA_EMBEDDING_MODEL = " ";
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA_EMBEDDING_MODEL must be/);
    delete process.env.NVIDIA_EMBEDDING_MODEL;
    await assert.rejects(() => providers.embed(" "), /text is invalid/);
    await assert.rejects(() => providers.embed("x".repeat(100_001)), /text is invalid/);
    await assert.rejects(() => providers.embed("A question?", "passage"), /task must be query or document/);
    assert.equal(fetchCount, 0, "invalid config, text and task must never send a request");

    const requests = [];
    global.fetch = async (url, options) => {
      fetchCount += 1;
      requests.push({ url, options });
      return { ok: true, json: async () => ({ data: [{ embedding: vector }] }) };
    };
    assert.deepEqual(await providers.embed("What is the policy?"), vector);
    assert.deepEqual(await providers.embed("Das Dokument", "document"), vector);
    process.env.NVIDIA_EMBEDDING_MODEL = "baai/bge-m3";
    assert.deepEqual(await providers.embed("What is the policy?", "query"), vector);
    assert.deepEqual(requests.map(({ url }) => url), Array(3).fill("https://integrate.api.nvidia.com/v1/embeddings"));
    for (const [{ options }, text] of requests.map((request, index) => [request, ["What is the policy?", "Das Dokument", "What is the policy?"][index]])) {
      assert.equal(options.method, "POST");
      assert.deepEqual(options.headers, {
        "content-type": "application/json", authorization: "Bearer fake-test-key",
      });
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), {
        model: "baai/bge-m3", input: [text], encoding_format: "float", truncate: "END",
      });
    }

    const invalidEmbeddings = [
      { data: [] },
      { data: [{ values: vector }] },
      { data: [{ embedding: vector.slice(1) }] },
      { data: [{ embedding: [...vector.slice(0, -1), NaN] }] },
      { data: [{ embedding: [...vector.slice(0, -1), "0"] }] },
    ];
    for (const response of invalidEmbeddings) {
      global.fetch = async () => {
        fetchCount += 1;
        return { ok: true, json: async () => response };
      };
      await assert.rejects(() => providers.embed("A question?"), /embedding (must contain exactly 1024 dimensions|contains a non-finite value)/);
    }

    global.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA embedding request failed \(HTTP 429\)/);
    global.fetch = async () => ({ ok: true, json: async () => { throw new Error("fake-test-key"); } });
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA embedding returned invalid JSON/);
    global.fetch = async () => { throw new Error("fake-test-key"); };
    await assert.rejects(() => providers.embed("A question?"), /^Error: NVIDIA embedding request failed$/);
    global.fetch = async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; };
    await assert.rejects(() => providers.embed("A question?"), /NVIDIA embedding request timed out/);

    console.log("NVIDIA embedding request, validation and error tests passed");
  } finally {
    global.fetch = previousFetch;
    for (const name of names) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
