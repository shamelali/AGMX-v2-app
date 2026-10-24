# AGMX image source guide

This guide records free-to-use image libraries that fit AGMX's cooperative-governance, AGM, e-voting, accessibility, and security themes. Prefer the existing product screenshots in `assets/enterprise/` for the landing page; use external images only where a contextual photo or diagram adds value.

## Placeholder replacements

| Placeholder | Recommended source | Intended use | License checklist |
|---|---|---|---|
| `placeholders/hero.svg` | [Pexels annual general meeting search](https://www.pexels.com/search/annual%20general%20meeting/) | Hero or editorial meeting image | Pexels photos are free for personal and commercial use; review the individual image for people, logos, and endorsement concerns. Attribution is appreciated. |
| `placeholders/workflow.svg` | [Vecteezy governance procedure vectors](https://www.vecteezy.com/free-vector/governance-procedure) or [Pixabay governance images](https://pixabay.com/images/search/governance/) | AGM workflow, collaboration, or voting illustration | Verify the individual asset's Free/Editorial label and whether attribution is required before downloading. |
| `placeholders/avatar.svg` | [DiceBear styles](https://www.dicebear.com/styles/) | Neutral member avatar | Check the selected style's license; use a downloaded static asset or self-hosted SVG rather than depending on the API at runtime. |

These are source collections rather than individually selected files because the final choice should match AGMX's visual language and should be reviewed for identifiable people, trademarks, and implied official endorsement. Once selected, append the exact creator, source URL, license, download date, and local filename to this file.

## Additional sources

| Source | Good for | License / usage note |
|---|---|---|
| [Wikimedia Commons — meetings](https://commons.wikimedia.org/wiki/Category:Meetings) | Meeting rooms, civic participation, public-domain and Creative Commons illustrations | Check the individual file page. Many files require attribution; some are ShareAlike. |
| [Openverse](https://openverse.org/) | Search across Creative Commons and public-domain media | Filter by license and verify the original item before downloading. |
| [unDraw](https://undraw.co/illustrations) | Consistent flat illustrations for onboarding, accessibility, and workflows | Free for personal and commercial use under the unDraw license; do not redistribute the illustration library itself. |
| [Openclipart](https://openclipart.org/) | Simple icons and vector illustrations | Public-domain library; still review the individual item before shipping. |
| [Unsplash — meetings](https://unsplash.com/s/photos/meeting) | Optional hero or editorial photography | Unsplash License generally permits free commercial use, but avoid implying endorsement and do not use an unmodified image as the product itself. |

## AGMX-specific selection rules

1. Do not use photos of real members, voting records, identity documents, or private meetings without documented consent.
2. Avoid images that imply official endorsement by SKM, a Malaysian cooperative, or a government body.
3. For every downloaded asset, record the source URL, creator, license, download date, and any required attribution before committing it.
4. Prefer local SVG placeholders in `assets/placeholders/` until a licensed image has been reviewed.
5. Compress raster images, provide descriptive `alt` text, and keep decorative imagery out of the accessibility reading order.

## Existing AGMX assets

- Landing-page hero: `assets/enterprise/01-hero-og-banner.png`.
- Product feature cards: `assets/enterprise/04-agm-hall.png` through `09-senior-mode.png`.
- Contextual photos: use Pexels or Unsplash only after consent/trademark review.
