# Google Auth for AGMX (PocketBase)

Setup in two places: **Google Cloud Console** and your **PocketBase server**.

---

## 1. Google Cloud Console

1. Open https://console.cloud.google.com → pick or create a project.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
3. Choose **Web application**.
4. Fill in:

   | Field | Value |
   |---|---|
   | Name | `AGMX PocketBase` |
   | Authorized JavaScript origins | `http://localhost:8090` and `https://your-pb-domain.com` |
   | Authorized redirect URIs | `https://your-pb-domain.com/api/collections/_pb_users_auth_/auth-with-oauth2` |

5. Click **Create** → copy the **Client ID** (you do *not* need the secret —
   PocketBase's OAuth2 flow is a public client using PKCE-style implicit
   exchange; it never receives the client secret).

---

## 2. PocketBase server

1. Open the admin UI: `http://localhost:8090/_/` (or your hosted URL).
2. **Settings → Auth → OAuth2 → Add provider**.
3. Fill in:

   | Field | Value |
   |---|---|
   | Provider | `Google` |
   | Client ID | *(from step 1)* |
   | Client secret | *(leave blank unless your redirect URI uses PKCE)* |
   | Auth URL | `https://accounts.google.com/o/oauth2/v2/auth` |
   | Token URL | `https://oauth2.googleapis.com/token` |
   | User profile URL | `https://www.googleapis.com/oauth2/v3/userinfo` |
   | Redirect URL | `https://your-pb-domain.com` |
   | Scopes | `openid email profile` |

4. **Save**, then tick **Enable** for that provider.

---

## 3. Bind the user's cooperative to their Google account

AGMX is multi-tenant: every user belongs to one `organizations` record and has
a `role`. Store both on the PocketBase auth record so the RLS rules can read
them with `@request.auth.organizationId` and `@request.auth.role`.

Open any user record in the admin UI and fill in:

- `organizationId` — the 15-char PocketBase record id of the cooperative
- `role` — one of `admin`, `secretary`, `chairman`, `treasurer`, `board`, `member`
- `memberId` — the `members` record id (only for member accounts)
- `language` — `BM` or `EN`
- `seniorMode` — bool

Any user without `organizationId` sees the **onboarding** screen instead of the
dashboard. That is how new Google sign-ins get attached to a cooperative.

---

## 4. Front-end config

Create `config.js` in the repo root (gitignored) — or set the same keys in
Vercel environment variables and inject them:

```js
window.AGMX_CONFIG = {
  url: "https://pb.agmx-project.vercel.app",   // your PocketBase URL
  googleClientId: "1234567890-abc.apps.googleusercontent.com",
  appName: "AGMX",
  demoMode: false,   // set true to fall back to data.js when PB is down
};
```

Then load it **before** the client:

```html
<script src="config.js"></script>
<script src="pocketbase-client.js"></script>
<script src="data.js"></script>
<script src="app.js"></script>
```

---

## 5. Test

1. Start PocketBase: `./bin/pocketbase serve --http=0.0.0.0:8090`
2. Open `http://localhost:8090/_/` and confirm Google shows as enabled.
3. In your app, click **Continue with Google**.
4. You should be redirected to Google's consent screen, then back to the app
   with a session token in `localStorage.pb_token`.

If you get *"Google auth is not configured on the PocketBase server"*, the
provider is disabled or the `auth-methods` endpoint returned a 404 — check step 2.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` in Google console | Redirect URI must match **exactly**, including trailing slash |
| `Access blocked: app not verified` | Normal for new apps — click *Advanced → Go to app (unsafe)*, or submit for verification |
| Redirects to Google then bounces to 404 | PocketBase's `Redirect URL` must be the origin serving the client, not the `/api` path |
| CORS error in console | Add your site origin to PocketBase `Settings → Application → Allowed Origins` |
| Token stored but every query 403 | `organizationId` not set on the auth record — see step 3 |

---

## Security notes

- **Never** put a client secret in `config.js` — it ships to every browser.
- Serve the client and PocketBase over **HTTPS**; the SHA-256 audit chain
  falls back to a non-cryptographic hash on `http://` origins.
- Mark the provider as **internal** in PocketBase if you don't want public
  Google sign-ups creating unclaimed accounts.
