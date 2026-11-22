(() => {
  "use strict";
  const { text, download } = window.AGMX_TOOLS;
  const $ = (id) => document.getElementById(id);
  const encoder = new TextEncoder();
  const curve = { name: "ECDSA", namedCurve: "P-256" };
  const signatureAlgorithm = { name: "ECDSA", hash: "SHA-256" };
  const sizeLimit = 6 * 1024 * 1024;
  let keys;
  function base64(bytes) {
    let raw = "";
    for (let i = 0; i < bytes.length; i += 16384)
      raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(raw);
  }
  function bytes64(value) {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  }
  async function sha(bytes) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function pem(raw, label) {
    return (
      "-----BEGIN " +
      label +
      "-----\n" +
      base64(new Uint8Array(raw))
        .match(/.{1,64}/g)
        .join("\n") +
      "\n-----END " +
      label +
      "-----\n"
    );
  }
  async function readKey(file, signing) {
    if (!file || file.size > 16384) throw Error("key");
    const label = signing ? "PRIVATE KEY" : "PUBLIC KEY";
    const regex = new RegExp(
      "^-----BEGIN " +
        label +
        "-----\\s*([a-zA-Z0-9+/=\\s]+?)\\s*-----END " +
        label +
        "-----$",
    );
    const match = (await file.text()).trim().match(regex);
    if (!match) throw Error("key");
    return crypto.subtle.importKey(
      signing ? "pkcs8" : "spki",
      bytes64(match[1]),
      curve,
      false,
      [signing ? "sign" : "verify"],
    );
  }
  function onSubmit(id, work, failure) {
    const form = $(id + "-form"),
      status = $(id + "-status");
    form.addEventListener("input", () => {
      status.textContent = "";
      if (id === "verify") $("verified-files").replaceChildren();
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      if (button.disabled) return;
      const controls = Array.from(form.querySelectorAll("button, input"));
      controls.forEach((control) => {
        control.disabled = true;
      });
      status.textContent = text("Sedang memproses…", "Processing…");
      if (id === "verify") $("verified-files").replaceChildren();
      try {
        await work(status);
      } catch (_) {
        status.textContent = text(...failure);
      } finally {
        controls.forEach((control) => {
          control.disabled = false;
        });
      }
    };
  }
  onSubmit(
    "sign",
    async (status) => {
      const files = Array.from($("sign-files").files);
      if (
        !files.length ||
        files.length > 8 ||
        files.reduce((n, f) => n + f.size, 0) > sizeLimit ||
        new Set(files.map((f) => f.name)).size !== files.length
      )
        throw Error("files");
      const key = await readKey($("private-key").files[0], true);
      const entries = [],
        contents = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        entries.push({
          name: file.name,
          size: bytes.length,
          sha256: await sha(bytes),
        });
        contents.push(base64(bytes));
      }
      const manifest = JSON.stringify({
        format: "agmx.evidence.v1",
        created: new Date().toISOString(),
        files: entries,
      });
      const signature = base64(
        new Uint8Array(
          await crypto.subtle.sign(
            signatureAlgorithm,
            key,
            encoder.encode(manifest),
          ),
        ),
      );
      download(
        new Blob([JSON.stringify({ manifest, signature, contents })], {
          type: "application/json",
        }),
        "agmx-evidence.json",
      );
      status.textContent = text(
        "Pek bertandatangan telah dimuat turun.",
        "Signed evidence pack downloaded.",
      );
    },
    [
      "Semak format kunci dan had fail. Setiap nama fail mesti berbeza.",
      "Check the key format and file limits. Each filename must be unique.",
    ],
  );
  onSubmit(
    "verify",
    async (status) => {
      const pack = $("signed-pack").files[0];
      if (!pack || pack.size > sizeLimit * 1.5 + 65536) throw Error("size");
      const key = await readKey($("public-key").files[0], false);
      const data = JSON.parse(await pack.text());
      if (
        typeof data.manifest !== "string" ||
        data.manifest.length > 32768 ||
        typeof data.signature !== "string" ||
        !(await crypto.subtle.verify(
          signatureAlgorithm,
          key,
          bytes64(data.signature),
          encoder.encode(data.manifest),
        ))
      )
        throw Error("signature");
      const manifest = JSON.parse(data.manifest);
      if (
        manifest.format !== "agmx.evidence.v1" ||
        !Array.isArray(manifest.files) ||
        manifest.files.length < 1 ||
        manifest.files.length > 8 ||
        !Array.isArray(data.contents) ||
        manifest.files.length !== data.contents.length
      )
        throw Error("manifest");
      const saved = [],
        names = new Set();
      let total = 0;
      for (const [i, entry] of manifest.files.entries()) {
        if (
          typeof entry.name !== "string" ||
          !entry.name ||
          /[/\\\u0000-\u001f]/.test(entry.name) ||
          names.has(entry.name) ||
          typeof data.contents[i] !== "string"
        )
          throw Error("entry");
        names.add(entry.name);
        const bytes = bytes64(data.contents[i]);
        total += bytes.length;
        if (
          total > sizeLimit ||
          bytes.length !== entry.size ||
          (await sha(bytes)) !== entry.sha256
        )
          throw Error("digest");
        saved.push({ name: entry.name, bytes });
      }
      for (const file of saved) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = file.name;
        button.onclick = () =>
          download(
            new Blob([file.bytes], { type: "application/octet-stream" }),
            file.name,
          );
        $("verified-files").appendChild(button);
      }
      status.textContent = text(
        "Tandatangan dan semua fail sepadan dengan kunci awam anda.",
        "Signature and all files verified against your public key.",
      );
    },
    [
      "Pengesahan gagal. Semak pek asal dan kunci awam penandatangan.",
      "Verification failed. Check the original pack and the signer’s public key.",
    ],
  );
  $("generate").onclick = async () => {
    const generate = $("generate");
    generate.disabled = true;
    try {
      const pair = await crypto.subtle.generateKey(curve, true, [
        "sign",
        "verify",
      ]);
      keys = {
        private: pem(
          await crypto.subtle.exportKey("pkcs8", pair.privateKey),
          "PRIVATE KEY",
        ),
        public: pem(
          await crypto.subtle.exportKey("spki", pair.publicKey),
          "PUBLIC KEY",
        ),
      };
      $("save-private").hidden = $("save-public").hidden = false;
      $("key-status").textContent = text(
        "Simpan kedua-dua fail sebelum menutup halaman.",
        "Save both files before closing this page.",
      );
    } catch (_) {
      generate.disabled = false;
      $("key-status").textContent = text(
        "Peranti ini tidak dapat menjana kunci.",
        "This device could not generate keys.",
      );
    }
  };
  for (const type of ["private", "public"])
    $("save-" + type).onclick = () =>
      download(
        new Blob([keys[type]], { type: "application/x-pem-file" }),
        "agmx-" + type + ".pem",
      );
})();
