#!/usr/bin/env node
// Pure static regression check: no secrets, network calls or payments.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const config = fs.readFileSync(new URL('../api/config.js', import.meta.url), 'utf8');
assert.match(config, /process\.env\.HITPAY_API_KEY\s*&&\s*process\.env\.HITPAY_SALT/, 'HitPay config must require both API key and salt');
assert.match(config, /process\.env\.BILLPLZ_API_KEY\s*&&\s*process\.env\.BILLPLZ_COLLECTION_ID\s*&&\s*process\.env\.BILLPLZ_X_SIGNATURE/, 'Billplz config must require callback signature key');
console.log('PASS: gateway readiness requires settlement verification credentials');
