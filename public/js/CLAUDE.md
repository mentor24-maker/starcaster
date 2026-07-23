# public/js/ — FROZEN (end-of-life)

This vanilla-JS admin app is frozen as of July 2026. **Bugfixes only.**

- Never add new files here (the conventions checker fails the commit).
- New admin UI goes in React: `components/` + `lib/builder-client/`.
- When a screen gets substantial work, migrate it to React instead of
  extending it here (see `docs/FABLE_OVERHAUL_PLAN.md`, Phase 4).

## Nothing here is compiled

These files load as plain `<script src>` tags. They are excluded from
`tsconfig.json`, there is no linter, and esbuild never sees them (the one
exception is `richtext-vendor-entry.js`, a bundle input). A syntax error
therefore reaches production, and it kills the **entire file** — every
function it defines goes silently dead, with no error anywhere but the
browser console.

`npm run check:syntax` gates that in pre-commit and CI. It catches syntax
only; `App.assset.foo()` parses fine and fails at runtime. After editing
anything here, open the app and check the console.

## For bugfixes in existing modules

- Everything hangs off `window.App`; shared state, `App.api()`, project
  switcher, and navigation live in `core.js`.
- **`App.els` is a static registry** in `core.js` — any DOM id you
  reference via `els.*` must be registered there first, or it is silently
  `undefined`.
- Modules follow `manifest: { id, label, pageId }` + `init()` and are
  registered in `public/app.js` (`App.manifests`). Markup lives in
  `src/pages/*.html` → `npm run build:html` (never edit
  `public/app-shell.html`).
- `richtext-vendor.js` is a generated bundle (`npm run build:richtext`) —
  don't edit it.
