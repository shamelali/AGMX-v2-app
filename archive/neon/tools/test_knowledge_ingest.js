"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pdfPages } = require("./knowledge-ingest");

function samplePdf() {
  const content = "BT /F1 12 Tf 50 100 Td (Annual meeting requires a quorum.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agmx-pdf-"));
  try {
    const filename = path.join(directory, "minutes.pdf");
    await fs.writeFile(filename, samplePdf());
    assert.deepEqual(await pdfPages(filename), [{ page: 1, text: "Annual meeting requires a quorum." }]);
    await assert.rejects(() => pdfPages(directory), /local file/);
    console.log("knowledge PDF extraction: actual pdfjs parsing and page provenance passed");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
