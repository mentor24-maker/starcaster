# Static Asset Versioning and Cache-Busting

> Build: [`scripts/pin_asset_versions.cjs`](../../scripts/pin_asset_versions.cjs) · Check: [`scripts/check_asset_versions.cjs`](../../scripts/check_asset_versions.cjs)

---

## The Problem

Vercel's CDN caches static files aggressively. When you deploy a new `styles.css` or `builder-bundle.js`, browsers and the CDN may keep serving an old copy until the URL changes.

The fix is **content-hash query strings**:

```html
<script src="/builder-bundle.js?v=fbf61eaa"></script>
```

The hash changes only when the file bytes change.

---

## How It Works Now (centralized)

**One script pins every HTML shell** — no manual file list to maintain.

`scripts/pin_asset_versions.cjs` scans:

| Path | Why |
|---|---|
| `public/*.html` | Every standalone shell (`site.html`, `builder-preview.html`, legal pages, …) |
| `src/layout.html` | Admin SPA source template |

For each `<script src="/…js">` and `<link href="/…css">` pointing at a file under `public/`, it writes `?v=<md5-first-8>`.

It runs automatically from:

| Command | When pins update |
|---|---|
| `npm run build` | End of full production build (+ `check:assets` fails if anything is stale) |
| `npm run build:html` | `app-shell.html` via `injectContentHashes()` (same logic) |
| `npm run build:builder` | After `builder-bundle.js` compiles |
| `npm run build:css` | After `styles.css` compiles |
| `npm run pin:assets` | Manual / emergency |
| `npm run dev` | Watches `styles.css`, `builder-bundle.js`, `bundle.js` and re-pins on change |

---

## Automation (no manual bumping)

Asset pins are kept current automatically at four points:

| Trigger | What runs |
|---|---|
| **Every `git commit`** | Pre-commit hook → `pin:assets --stage` (re-pins all HTML, stages fixes) |
| **`npm install`** | Installs/refreshes the pre-commit hook (`prepare` script) |
| **`npm run dev`** | Watches bundle files; re-pins HTML when JS/CSS artifacts change |
| **`npm run build`** | Full pin + `check:assets` gate (build fails if anything is still stale) |

Manual escape hatch: `npm run pin:assets` any time.

To install the hook without a full `npm install`:

```bash
node scripts/install_git_hooks.cjs
```

---

## NPM Scripts

| Script | Purpose |
|---|---|
| `npm run pin:assets` | Pin all HTML shells to current artifact hashes |
| `npm run check:assets` | Exit 1 if any HTML reference is missing or stale `?v=` |
| `npm run bust [label]` | Emergency force-bust (then re-pins from content hashes) |
| `npm run build:css` | CSS compile + pin |
| `npm run build` | Full build + pin + verify |

---

## Adding a New HTML Shell

Put it in `public/*.html` with **unversioned** paths:

```html
<link rel="stylesheet" href="/styles.css" />
<script src="/builder-bundle.js"></script>
```

Run any build command (or `npm run pin:assets`). **No build-script edit required.**

---

## Diagnostic Checklist

If a CSS/JS change has no effect on the live site:

1. Run `npm run build` (or at minimum `npm run pin:assets`).
2. Run `npm run check:assets` — must pass.
3. Confirm your commit includes the updated HTML shell(s) **and** the rebuilt artifact.
4. Hard-refresh the page (HTML shells are `no-cache` on Vercel; the `?v=` on JS/CSS is what busts CDN cache for those files).

---

## History

| Date | Issue | Fix |
|---|---|---|
| June 2026 | `site.html` stuck at `styles.css?v=13` | Auto-pin in build |
| June 2026 | `builder-preview.html` stuck at `builder-bundle.js?v=7` | Missed by hardcoded file list in `build_builder_bundle.mjs` |
| June 2026 | Recurring stale shells | Centralized `pin_asset_versions.cjs` scans all `public/*.html` + `check:assets` gate on `npm run build` |

---

## Do Not

- Hand-edit `?v=` integers in HTML (they will be overwritten on the next build).
- Add new HTML shells without running a build before commit.
- Maintain a separate manual list of HTML files in build scripts — use `public/*.html` instead.
