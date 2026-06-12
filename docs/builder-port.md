# Builder Port (from Normie)

The full visual Builder editor was ported from the Normie codebase in June 2026.
Starcaster is now **self-contained** — the Normie checkout is no longer needed.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| Domain logic (single source of truth) | `lib/builder-client/*.ts` | Vendored from normie `lib/`, TypeScript, ESM. Includes the StarCaster extensions (legacy grid codes `3-3`/`1-4-1`/…, `one-four-one` layout, `overlayScreen`, table/navigation/text normalization) that previously lived only in the generated bundle. |
| Starcaster adapters | `lib/builder-client/adapters/` | Same export signatures as the normie modules they replace: API fetch (`builder-admin-fetch.ts`), media library (`use-gallery-media-library.ts` over `/api/assets`), navigation hooks, capability flags, type stubs for normie-only subsystems (player portal, deep dive). |
| Server-side CJS bundles | `lib/builder/template.js`, `email-template.js`, `email-render.js` | **Generated** — do not edit. Regenerate with `npm run build:builder-template` and `npm run build:builder-email-render` after touching `lib/builder-client/builder-template.ts` / `builder-email-*.ts`. |
| Editor UI | `components/` + `components/builder/` | Mirrors normie's layout. `components/builder/stubs/` replaces normie-only components; `components/builder/compat/` provides `next/image|link|navigation|dynamic` shims (mapped via tsconfig `paths`, so vendored files stay byte-compatible with upstream). |
| Entry & shell | `builder-react-entry.tsx` → `public/builder-bundle.js` | `window.BuilderReact.mount/unmount/mountPreview`. Mounted by `public/js/builder.js` (unchanged contract). Build: `npm run build:builder` (`scripts/build_builder_bundle.mjs`, minified; `--watch` in dev). |
| CSS | `src/css/_builder-react.css` | **Generated** by `npm run extract:builder-css` from normie `app/globals.css`; every selector scoped under `.builder-react-root`. |
| Preview | `public/develop-preview.html` | Reads the draft from localStorage (same mechanism as normie `/preview`), renders via `BuilderReact.mountPreview`. |

## API mapping (client adapter `builder-admin-fetch.ts`)

normie `/api/admin/pages` → `/api/develop/landing-pages` (re-keys `landingPages→pages`),
`cell-modules` → `/api/develop/modules` (`modules→cellModules`),
`page-templates`/`saved-sections`/`products` → same names under `/api/develop/`,
`media` → `/api/assets` (+ upload via `/api/assets/import-image`), `polls` → `/api/polls`.
All requests carry the `X-Project-ID` scope header.

## Server changes

- `templateId` is derived from slug/name when the editor doesn't send one (create gets a unique suffix; update is stable).
- Landing pages support `slug` + `is_published` — run `docs/develop_landing_page_publish_migration.sql` in Supabase. Without the columns, saves still succeed (publish fields are dropped with a retry).
- `POST /api/develop/email-templates/:id/render` renders Builder email HTML server-side (merge fields: `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .SiteURL }}`).

## Capability flags (`lib/builder-client/adapters/capabilities.ts`)

`playerPortal`, `legacyRemindersImport`, `pollDeepDive` are **off**: the modules stay in the codebase, are hidden from the palette, and render placeholders in preview.

## Known limitations

- Poll modules in the **preview** call normie's public poll-session endpoints (`/api/polls/next`, `/api/polls/answer`) which have no starcaster equivalent yet; they show their error state in preview. Poll selection in the editor works.
- The reminder runtime's player context fetch degrades to anonymous in preview.
- "Open published page" opens the localStorage preview — there is no public landing-page render route yet.
- Mount-prop record preselection (`BuilderReact.mount(..., { record })`) opens the full editor; the record is selected inside the editor rather than auto-opened.

## Tests

- `npm run test:builder` — node:test for the generated server bundles (document normalization, email render).
- `npm run test:builder-ui` — vitest for vendored domain libs + adapters. One known upstream failure (`rich-text-image.test.ts` lazy-require) fails identically in normie.
- `npm run typecheck` — strict TS over all builder code.
