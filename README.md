# AGMX Project

## Modernized AGMX Public Landing Page

**Status**: ✅ Production live at `https://www.agmx.me`

**Modernization**: 16 commits including:
- DutaGovern branding (Governance OS → DutaGovern)
- 9 Undraw SVG illustrations integrated
- CACHE v12 bump with changelog
- "Data hosted in Singapore" removal from hero proof
- 56 policies schema match verification
- GitHub secret scanning cleanup (agmx.json removed from history)

---

## CACHE Bumping Policy

The CACHE version in `sw.js` (`agmx-www-agmx-my-v12`) should ONLY be bumped when:

### ✅ **BUMP WHEN**:
- `index.html` structure changes (new sections, removed sections, layout changes)
- `landing.css` is modified (additive design changes, new styles, removed styles)
- `landing.js` is modified (new IntersectionObserver targets, new counter targets, new nav states)
- Any file listed in the `PRECACHE` array changes

### ❌ **DO NOT BUMP WHEN**:
- Text content changes (hero proof, plan names, policy descriptions)
- SVG illustration selection changes (different undraw.co URL, same file type)
- Non-precached files change (api routes, config, metadata)
- Minor CSS adjustments that don't change the layout

### **Current Version**: v12
*(bumped when index.html, landing.css, and landing.js were all added together)*

### **Next Bump**: Only when any of the three PRECACHE files above materially change.

---

## Project Verification

| Check | Result |
|-------|--------|
| **DutaGovern branding** | ✅ Complete (22 files renamed) |
| **Undraw illustrations** | ✅ Integrated (9 SVGs, 14 references) |
| **CACHE v12** | ✅ Synced (sw.js) |
| **"Data hosted in Singapore"** | ✅ Removed |
| **56 policies match schema** | ✅ Verified |
| **Git status** | ✅ Clean |
| **check.sh** | ✅ 82/87 pass (5 warnings, 2 environmental) |

---

## Deployment

- **Vercel**: `https://www.agmx.me` (auto-deploy from `git push origin main`)
- **GitHub**: `https://github.com/shamelali/AGMX-v2-app`
- **Codebase**: Local main at `2e78b73` (all 16 modernization commits)