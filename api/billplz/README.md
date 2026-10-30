# Billplz serverless adapter

Deploy the `api/billplz/*.js` files as Node.js Vercel functions. Set these **server-only** environment variables in the deployment (never `config.js`):

| Variable | Purpose |
|---|---|
| `BILLPLZ_API_KEY` | Billplz secret key, used as Basic Auth username with empty password |
| `BILLPLZ_COLLECTION_ID` | Collection for created bills and verified callbacks |
| `BILLPLZ_X_SIGNATURE_KEY` | Callback X Signature HMAC key; enable X Signature Callback URL in Billplz |
| `BILLPLZ_API_BASE_URL` | `https://www.billplz.com/api` (default), or `https://www.billplz-sandbox.com/api` |
| `BILLPLZ_CALLBACK_URL` | Deployment's full HTTPS `https://…/api/billplz/callback` URL |
| `PB_URL` | PocketBase server URL (HTTPS except loopback), reachable from functions |
| `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` | PocketBase superuser credentials, server only |

`POST /api/billplz/create-bill` accepts JSON `{ "invoiceId": "…", "amountSen": 1999, "name": "…", "email": "…", "description": "…" }` with `Authorization: Bearer <PocketBase user token>`. It refreshes the user token at PocketBase, requires organization admin/secretary, reads the same-organization invoice with a server-only superuser session and checks the whole invoice amount (MYR, converted to integer sen). It reserves a payment record as pending, creates a Billplz v3 bill, stores its ID in `payments.gatewayRef`, and responds with `{ paymentId, billId, url }`. Bill creation is blocked while any payment is pending or succeeded for the invoice; orphaned/failed attempts need staff reconciliation, never an automatic duplicate charge. `reference_1` is the payment ID, but callback reconciliation uses the stored `gatewayRef`, not a caller-supplied payment ID.

`POST /api/billplz/callback` accepts Billplz `application/x-www-form-urlencoded` data. The verifier in `_signature.js` follows [Billplz X Signature Callback URL](https://www.billplz.com/api#payment-completion-x-signature-callback-url): take **all** posted flat key/value fields except `x_signature` (including optional fields such as `transaction_id` and `transaction_status`), concatenate each field name and its value (empty for null), sort the resulting strings ascending case-insensitively, join with `|`, then compute hex HMAC-SHA256 with `BILLPLZ_X_SIGNATURE_KEY` and compare in constant time. Duplicate form fields or non-scalar fields are rejected. The callback matches the signed Bill ID to the stored gateway reference, checks collection, amount, organization, invoice amount and coherent settlement status, then marks payment succeeded and invoice paid; repeated callbacks do not write again. A `due` state leaves the intent pending because subsequent payment attempts can still succeed. No browser redirect counts as confirmation.

PocketBase REST calls are sequential, so if the payment update succeeds but invoice update fails, Billplz retries the callback and the next delivery completes the invoice. Monitor and reconcile callbacks whose database write cannot complete. Run `node tools/test_billplz_endpoints.js` without credentials. The existing client-side `paymentDemo` flow is separate and unchanged.
