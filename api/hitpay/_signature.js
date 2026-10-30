"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

// Event-webhook contract: hex HMAC-SHA256(raw JSON body bytes, per-endpoint salt)
// arrives in Hitpay-Signature. Never stringify parsed JSON or accept legacy hmac.
function verify(raw, signature, salt) {
  if (!Buffer.isBuffer(raw) || !raw.length || typeof salt !== "string" || !salt ||
      typeof signature !== "string" || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", salt).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

module.exports = { verify };
