"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

// https://www.billplz.com/api#payment-completion-x-signature-callback-url
// Billplz signs ALL posted flat key/value pairs except x_signature (including
// optional transaction_id/status), as lowercase-case-insensitively sorted
// `key`+`value` strings joined with `|`. Null/missing optional values are
// represented by an empty string in the documented sample. This verifier
// intentionally rejects non-scalar values and malformed field names rather
// than silently omitting new/optional parameters from the MAC material.
const REQUIRED = ["id", "collection_id", "paid", "state", "amount", "paid_amount"];

function signatureSource(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
      REQUIRED.some(key => !Object.hasOwn(fields, key)) ||
      Object.keys(fields).some(key => !/^[a-z][a-z_0-9]{0,63}$/.test(key))) return null;
  const parts = [];
  for (const key of Object.keys(fields)) {
    if (key === "x_signature") continue;
    const value = fields[key];
    if (value !== null && typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") return null;
    parts.push(key + (value === null ? "" : String(value)));
  }
  parts.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
  return parts.join("|");
}

function verify(fields, key, crypto = { createHmac, timingSafeEqual }) {
  const source = signatureSource(fields);
  if (!source || typeof key !== "string" || !key || typeof fields.x_signature !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(fields.x_signature)) return false;
  const expected = crypto.createHmac("sha256", key).update(source, "utf8").digest();
  const received = Buffer.from(fields.x_signature, "hex");
  return crypto.timingSafeEqual(expected, received);
}

module.exports = { signatureSource, verify };
