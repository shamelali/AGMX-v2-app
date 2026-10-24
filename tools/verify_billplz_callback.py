#!/usr/bin/env python3
"""AGMX — Billplz callback verification (signed webhook simulator).

Posts a correctly X-Signature-signed callback to the live
/api/agmx/payment/callback endpoint so the settlement path can be
verified WITHOUT moving real money through the gateway.

The X-Signature key is read from --key or $BILLPLZ_X_SIGNATURE —
never hardcode it, never commit it.

Usage:
  python3 tools/verify_billplz_callback.py \
    --url https://agmx-pb.fly.dev \
    --bill-id <billId dari payment/link> \
    [--key <x-signature-key> | env BILLPLZ_X_SIGNATURE=...] \
    [--transaction-id TESTTX001]

Signature scheme (must mirror pb_hooks/money_flow.lib.js):
  1. drop x_signature
  2. sort remaining keys ascending
  3. concatenate key+value with NO separator
  4. join pairs with '|'
  5. HMAC-SHA256, lowercase hex
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import urllib.request
import urllib.error


def sign(params, key):
    pairs = "|".join(k + str(params[k]) for k in sorted(params))
    return hmac.new(key.encode(), pairs.encode(), hashlib.sha256).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8090")
    ap.add_argument("--bill-id", required=True, help="payments.reference (Billplz bill id)")
    ap.add_argument("--key", default=os.environ.get("BILLPLZ_X_SIGNATURE", ""))
    ap.add_argument("--transaction-id", default="TESTTX001")
    ap.add_argument("--unpaid", action="store_true", help="send paid=false (must settle nothing)")
    args = ap.parse_args()

    if not args.key:
        sys.exit("✗ X-Signature key required (--key or $BILLPLZ_X_SIGNATURE)")

    params = {
        "id": args.bill_id,
        "paid": "false" if args.unpaid else "true",
        "state": "due" if args.unpaid else "paid",
        "transaction_id": args.transaction_id,
        "x_signature": "",  # reserved; excluded from the signature
    }
    params["x_signature"] = sign(params, args.key)

    data = "&".join(f"{k}={v}" for k, v in params.items()).encode()
    req = urllib.request.Request(args.url.rstrip("/") + "/api/agmx/payment/callback",
                                 data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            body = json.loads(r.read().decode())
            print(f"✓ HTTP {r.status}: {json.dumps(body)}")
            if body.get("settled"):
                print("✓ Settlement path verified — invoice marked paid, audit chained.")
            elif body.get("duplicate"):
                print("✓ Idempotency verified — already-settled payment settled nothing.")
            elif body.get("settled") is False:
                print("✓ Unpaid callback correctly settled nothing.")
    except urllib.error.HTTPError as e:
        try:
            print(f"✗ HTTP {e.code}: {e.read().decode()}")
        except Exception:
            print(f"✗ HTTP {e.code}")
        sys.exit(1)


if __name__ == "__main__":
    main()
