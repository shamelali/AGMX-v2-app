# AGMX — Enterprise Image Pack

Enterprise-standard, brand-consistent imagery for the AGMX product, generated to
match the app's exact design system:

| Token | Value |
|---|---|
| Primary | `#0B5394` (deep blue) |
| Primary dark | `#063356` → `#0B5394` (sidebar gradient) |
| Accent | `#D4A017` (Malaysian gold) |
| Success / Danger | `#10B981` / `#EF4444` |
| Background / Surface | `#F5F7FB` / `#FFFFFF` |

All images: flat vector-style UI, no photos, no people, minimal short text
(Bahasa Melayu with English terms), consistent with `styles.css`.

## The set

| File | Use it for |
|---|---|
| `01-hero-og-banner.png` | Marketing hero background, Open Graph / social share card (1200×630-style), pitch deck cover |
| `02-login.png` | Docs, README, feature page "One Click Join" |
| `03-dashboard.png` | Hero product screenshot, investor deck, dashboard feature |
| `04-agm-hall.png` | "Dewan AGM / Live Hall" feature, live-voting demo shots |
| `05-e-voting.png` | E-voting feature, product tour |
| `06-ai-copilot.png` | AI Copilot / 4 agents feature |
| `07-compliance.png` | Compliance / SKM / BRule feature |
| `08-digital-vault.png` | Digital Vault / security feature |
| `09-senior-mode.png` | Senior Mode / accessibility feature |
| `10-mobile-member.png` | Mobile member experience, app-store style marketing |

## Suggested integration points

1. **Landing page (`index.html`)** — currently fully self-contained with no
   imagery. Natural spots:
   - Hero: `01-hero-og-banner.png` as a background/visual under the headline
   - Feature cards: `02`–`08` beside "Fungsi Utama" copy
   - OG meta: add `<meta property="og:image" content="…/01-hero-og-banner.png">`
2. **README.md** — replace/augment the file listing with `03-dashboard.png`
   or `04-agm-hall.png` as the opening visual.
3. **Vercel preview** — keep assets under `assets/` so the SPA's existing
   `img-src 'self' data:` CSP permits them.

## Notes

- Generated at a default canvas; for social sharing, downscale
  `01-hero-og-banner.png` to 1200×630 before publishing.
- If any image is re-generated, keep the prompt tokens above for consistency.
