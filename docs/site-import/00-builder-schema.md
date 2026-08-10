# Site Import — Phase 0 Discovery: Builder Schema & Platform Facts

Status: **ratified 2026-08-05** (operator + HQ review of pass 1).
Source: codebase survey at commit `f87612c` by three parallel read-only
agents, 2026-08-05. Line numbers are as of that commit and will drift;
file paths and function names are the stable references.

This document answers the ten Phase 0 discovery questions from the Site
Import plan. The Phase 1 functional spec that depends on these answers is
`01-capture-and-ir.md` in this folder.

**Naming note.** The UI says "Builder"; the code and DB historically said
`develop`. `docs/SQL/builder_rename_migration.sql` renamed the live tables
to `builder_*` — the pages table today is `public.builder_landing_page`.
Table names resolve at runtime through `tableConfig()` in
`lib/supabase.js`, so always go through the stores rather than hardcoding
table names.

---

## 1. Page document model

A Builder page is **one row** in `builder_landing_page`; the entire page
design lives in a single jsonb column, `layout_sections`. The TypeScript
source of truth for the document shape is
`lib/builder-client/builder-template.ts` (bundled for the server into the
generated `lib/builder/template.js` — see §5).

### Page record (`BuilderPageRecord`, builder-template.ts ~line 305)

```ts
export type BuilderPageRecord = {
  id: string;
  name: string;
  slug: string;
  templateId: string;
  themeId?: string;
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  layoutSections: BuilderTemplateSection[];
  createdAt: string;
  updatedAt: string;
  isPublished: boolean;
  isPrivate: boolean;
};
```

### Section (`BuilderTemplateSection`, ~line 239)

```ts
export type BuilderTemplateSection = {
  id: string;
  title: string;
  locked: boolean;
  isPrivate: boolean;
  /** ID of the saved section this was instantiated from, if any. */
  savedSectionId?: string;
  /** When true, this instance stays in sync with the master saved section. */
  canonical?: boolean;
  layout: BuilderTemplateLayout;      // single | two-column | three-column |
                                      // two-four | four-two | one-five |
                                      // five-one | one-four-one
  widthMode: "contained" | "full-width";
  widthPercent: string;
  alignment: "left" | "center" | "right";
  marginTop: string;
  marginBottom: string;
  rowBorderWidth: string;
  rowBorderColor: string;
  rowBorderStyle: string;
  rowBorderRadius: string;
  mobileHidden: string;
  desktopHidden: string;
  mobileLayout: "stack" | "keep" | "reverse-stack";
  background: BackgroundSettings;
  overlayScreen?: RowOverlayScreenSettings;
  cellBackgrounds: Record<string, BackgroundSettings>;
  cellPadding: Record<string, string>;
  cellVerticalMargin: Record<string, string>;
  cellMobileHidden: Record<string, string>;
  cellDesktopHidden: Record<string, string>;
  cellIsPrivate: Record<string, string>;
  cellBorderWidth: Record<string, string>;
  cellBorderColor: Record<string, string>;
  cellBorderRadius: Record<string, string>;
  cellBorderStyle: Record<string, string>;
  cellShadow: Record<string, string>;
  cellOpacity: Record<string, string>;
  cellHAlign: Record<string, string>;
  cellVAlign: Record<string, string>;
  modules: BuilderTemplateModule[];
};
```

Column keys are `["main"]`, `["left","right"]`, or
`["left","center","right"]`; legacy `col1/col2/col3` documents are
remapped on read by `resolveModuleColumnForLayout` and
`lib/builder/migrate-from-legacy.js`.

### Module (`BuilderTemplateModule`, ~line 88)

```ts
export type BuilderTemplateModule = {
  id: string;
  type: BuilderTemplateModuleType;
  column: string;
  name: string;
  text: string;
  settings: Record<string, string>;   // everything stringified
  savedModuleId?: string;
  canonicalLocked?: boolean;
};
```

### Background (`BackgroundSettings`, ~line 101)

```ts
export type BackgroundSettings = {
  mode: "none" | "color" | "gradient" | "image" | "style";
  color: string;
  color2: string;
  imageUrl: string;
  /** StarCaster: asset id behind imageUrl so the asset picker can round-trip. */
  imageAssetId?: string;
  styleKey: "" | BackgroundStylePreset;
  opacity?: number;
};
```

### The on-disk envelope — and two silent-loss traps

`serializeBuilderDocument` writes
`{ pageBackground, theme, sections }` into the jsonb column. **On disk the
key is `sections`; in memory it is `layoutSections`.** Both are accepted
on read (`document.sections ?? document.layoutSections`), and legacy rows
may be a bare array.

Trap 1 — **`module.text` is hard-capped at 10,000 characters** by
`safeText(value, 10000)` in the normalizer (builder-template.ts ~1580,
mirrored in the generated server bundle). Longer text is silently
truncated on the very next load. Settings values are also capped at 10k
except `content`/`tableData`/`tableContents` (200k) and `navItems`
(500k).

Trap 2 — the raw normalizer in the template bundle **drops `locked`,
`savedSectionId`, `canonical`, and `rowBorder*`**; `lib/builder/document.js`
re-attaches them around the normalizer. **All page-document writes must go
through `lib/builder/document.js` (`serializeBuilderDocument`), never
through `lib/builder/template.js` directly.**

### Postgres side

`docs/SQL/develop_landing_page_setup.sql` (table now named
`builder_landing_page`); relevant columns:

```sql
id bigserial primary key,
name text not null default '',
template_kind text not null default 'fixed',
template_id text not null default '',
-- ...legacy fixed-template slot columns...
layout_sections jsonb not null default '[]'::jsonb,
content_overrides jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
-- plus, via later migrations:
--   slug text, is_published boolean default true,
--   is_private boolean not null default false,
--   project_id, owner_user_id, theme_id
```

Slug uniqueness is **per project**:

```sql
create unique index if not exists develop_landing_page_slug_project_idx
  on develop_landing_page (project_id, slug)
  where slug is not null and slug <> '';
```

Related tables:

| Live table | Source SQL | Page-doc column | Purpose |
|---|---|---|---|
| `builder_landing_page` | `develop_landing_page_setup.sql` | `layout_sections` | the pages |
| `builder_page_templates` | `develop_page_templates_setup.sql` | `layout_sections` | page templates |
| `builder_saved_sections` | `develop_saved_sections_setup.sql` | `section` (one section) | Header/Footer masters |
| `builder_modules` | `develop_modules_setup.sql` | `settings` | saved module palette |
| `builder_page_snapshots` | `develop_builder_page_snapshots_setup.sql` | `pages` (array of pages) | whole-site snapshots |
| `builder_themes` | `develop_themes_*` | typography jsonb + color columns | saved themes |
| `direct_acquire_runs` | `011_multitenancy_acquire_engage.sql` | `run_json` | existing site-crawl runs (§3) |

---

## 2. Module type inventory

52 types, enumerated in `BuilderTemplateModuleType`
(builder-template.ts ~line 35). The runtime guard `normalizeModuleType`
**falls through to `"text"` for any unknown type** — see §5. No setting is
"required" in a schema sense (every module normalizes to a valid object);
the ● column marks what a module needs to render meaningfully.

| Group | Types | Meaningful-render needs (●) |
|---|---|---|
| Structure/nav | `navigation`, `breadcrumb`, `tractor-nav` | ● `navItems` / `items` JSON |
| Text | `heading`, `text`, `quote`, `speech-bubble`, `headline-rotator` | ● `module.text` (or `headlines`) |
| Media | `image`, `floating-image`, `video`, `slider` | ● `url` / `sliderItems` |
| Raw HTML | `code` | ● `module.text` (sanitized HTML — see §5) |
| Interactive | `button`, `contact-form`, `table`, `social`, `social-share`, `merch`, `confetti`, `reminder`, `player-portal` | ● varies (`href`, `tableData`, `socialItems`, …) |
| Polls | `current-poll`, `previous-results`, `poll-category-list` | runtime data |
| Blog suite | `blog-post`, `blog-post-list`, `blog-post-card`, `blog-author-bio`, `blog-toc`, `blog-related-posts`, `blog-category-filter`, `blog-tag-cloud`, `blog-post-tags`, `blog-newsletter-subscribe`, `blog-post-create`, `blog-post-manager`, `blog-category-manager`, `blog-card-manager`, `blog-search`, `blog-search-results` | content fields / runtime data |
| CRM | `crm-form`, `crm-contacts-table` | ● `crmFormId` / `crmConfigId` |
| Messaging | `messaging-topic-list`, `messaging-tag-list` | runtime data |
| Tenant admin | `admin-login`, `admin-nav-link`, `admin-team-users`, `admin-modules`, `admin-site-settings`, `admin-support-form` | — |

Universal settings on every module: `verticalMargin`, `mobileHidden`,
`desktopHidden`. Per-type defaults: `createEmptyModule`
(builder-template.ts ~1823); per-type coercion:
`normalizeBuilderModuleSettingsForType` (~1326).

Two types are **inferred, not declared**: a `text` module carrying
confetti keys is upgraded to `confetti`, and an `image` with
`positionMode === "overlay"` becomes `floating-image`
(`resolveBuilderModuleType`, ~1303). An importer must not assume declared
types round-trip unchanged.

Rendering: one public renderer, `components/builder-template-preview.tsx`
(~4,700 lines, one branch per type), used identically by the editor
canvas, `/builder-preview`, and live tenant sites. Palette metadata:
`components/builder/builder-types.ts`.

---

## 3. Programmatic write path — YES (three of them)

This was the make-or-break question; the answer is a strong yes, and the
repo already contains a working prototype of site import.

### (a) In-process store — the preferred path

`lib/builderPagesStore.js`: `createPage(input, scope)` and
`updatePage(id, input, scope)` take camelCase records, handle project
scoping (`lib/projectScope.js: scopedInsertRow`), and serialize the
document through `lib/builder/document.js`. Transport is PostgREST via
`sbQuery` (`lib/supabase.js`).

### (b) HTTP API — `routes/builder.js` (prefixes `/api/builder`, `/api/develop`)

Highlights: `POST /api/builder/landing-pages` (create),
`PATCH /api/builder/landing-pages/:id`, `bulk-publish`, page snapshots
(`/api/builder/page-snapshots` + `/:id/restore`), saved sections CRUD
(PATCH triggers canonical propagation), and — critically —

**`POST /api/builder/landing-pages/bulk-create-with-model`
(routes/builder.js ~1460) is Site Import v0.** It reads a
`direct_acquire_runs` crawl, matches crawled pages to nav item names,
applies a "content display model," and creates real pages:

```js
const blocks = model.extract(rawHtml);
layoutSections = applyBlocksToSectionsWithHandlers(layoutSections, blocks, userHandlers);
const pageResult = await createPage({ name, slug, templateId: derivedTemplateId,
  themeId, templateKind: 'modular', isPublished: ..., pageBackground: templateBackground,
  theme: effectiveTheme, layoutSections }, scope);
```

The extraction registry is `lib/contentDisplayModels.js` (one model today:
`duda-alternating-2col`, with `detect()`/`extract()`/`applyToSections()`,
plus `sanitizeImportHtml()`). The crawler behind it is
`lib/directAcquire.js`: BFS same-domain crawl, sitemap seeding, image
extraction, 15 s per-page timeout, results persisted to
`direct_acquire_runs`. It has **no robots.txt handling** and no headless
browser — plain fetch.

Content-fill convention: `applyBlocksToSections` **skips `locked`
sections** — locked is the agreed "don't touch" marker for
header/footer/copyright during programmatic population.

### (c) One-off scripts — direct table writes

`scripts/marinoff_punchlist_20260717.mjs` and
`scripts/three_up_convert_20260723.mjs` write `builder_landing_page`
directly with the service key. They established the house safety pattern
every future importer must follow: **dry-run by default with `--apply` to
write; assert all expected matches before any write; full JSON backup to
`docs/SQL/backups/` first; idempotent re-runs; documented rollback.**

---

## 4. Themes and styling

Two layers, both called "theme":

| Layer | Where | Storage | Output |
|---|---|---|---|
| Document theme (`BuilderTheme`) | builder-template.ts | inside the page's `layout_sections` jsonb | typography tokens → `--bx-*` CSS vars |
| Saved theme record (`BuilderThemeSummary`) | builder-template.ts + `components/builder/builder-utils.ts` | `builder_themes` table, referenced by `page.themeId` | palette/chrome → `--lp-*` vars + page margins |

The document theme is typography-first: font roles
(`heading`/`body`/`mono`), a modular type scale
(`baseSize` × `ratio`ⁿ with per-heading overrides), semantic colors
(`text`/`heading`/`muted`/`link`/`linkHover`/`selection`), sparse
per-element overrides (`h1`–`h6`, `p`, `a`, `blockquote`, `button`,
`nav`, `caption`, `code`), form-control colors, and page margins. All
defaults are "inherit" sentinels — an absent theme renders exactly like
the pre-theme baseline.

Resolution: `getThemeRootVars()` / `getBuilderThemeStyleVars()`
(`components/builder/builder-utils.ts`) inject CSS custom properties onto
the `.builder-preview-shell` root; hand-authored rules in
`src/css/_builder-theme.css` read them with pre-theme fallbacks.
**Per-module inline settings win over theme tokens.**

Constraint for import: **fonts are a closed set of 11 curated Google
fonts** (`BUILDER_HEADING_FONTS`), wired into `<link>` tags in
`src/layout.html` / `public/site.html` / `public/builder-preview.html`.
An imported site's arbitrary font families cannot be represented without
extending that list; nearest-match is the realistic mapping.

---

## 5. Raw-HTML capability and the cost of a new module type

### The `code` module already does raw HTML

`type: "code"` renders sanitized HTML from `module.text` via
`BuilderCodeEmbed` (`components/builder/builder-code-embed.tsx`), which
defers iframes behind a click-to-load shield and traps focus-steal. This
is the natural "PlaceholderBlock" — no new module type required.

The gate is `sanitizeEmbedHtml` in
`lib/builder-client/sanitize-html.ts` (DOMPurify):

- Allowed tags: rich-text set (p, br, strong, b, em, i, u, s, del,
  strike, h1–h6, ul, ol, li, blockquote, pre, code, a, span, div, img)
  plus `iframe`.
- Allowed attrs: href, target, rel, style, class, id, src, alt, width,
  height, loading + iframe attrs (allow, allowfullscreen, frameborder,
  scrolling, title, referrerpolicy).
- **Stripped: `<section> <header> <footer> <nav> <main> <article>
  <picture> <source> <svg> <video> <audio> <button> <form> <input>
  <table> <canvas>`, `srcset`, all `data-*`, inline `<style>`/`<script>`.**

Widening this allowlist is a security decision affecting both client and
server bundles. Consequence for capture (ratified amendment A of the
Phase 1 spec): elements built from these stripped tags must carry
screenshot crops, because the screenshot is the placeholder's primary
payload.

### If a dedicated module type is added later — the checklist

Worked precedent: `admin-nav-link` (commit `942ee05`) and
`admin-support-form` (commit `ef627ea`). Files: (1)
`lib/builder-client/builder-template.ts` — type union +
`normalizeModuleType` + defaults chain; (2)
`components/builder/builder-types.ts` — palette item; (3) new
`components/builder/builder-<x>-module-settings.tsx`; (4)
`components/builder/builder-module-card.tsx` — canvas preview + settings
mount + generic-chrome opt-outs; (5)
`components/builder-template-preview.tsx` — public renderer; (6)
`src/css/_builder-react.css` / `_builder-react-overrides.css`; optionally
(7) the email-render skip list (`builder-email-render.ts`); (8)
`PRIVATE_ONLY_MODULE_TYPES` in `components/BuilderPublicSitePage.tsx` if
never-public. Commands, in order: **`npm run build:builder-template`
(non-negotiable — skipping it makes the server silently coerce the new
type to `"text"` on every page load, destroying data)**, then
`npm run build:builder`, `build:css` if CSS changed, `pin:assets`, then
`npm run typecheck` + `npm run test:builder-ui`.

---

## 6. Media storage

**Vercel Blob is the live primary store.** `lib/assetStorage.js` is a
provider switch keyed by `ASSET_STORAGE_PROVIDER` (env sets
`vercel_blob`); Google Drive is the legacy fallback. **Supabase Storage
is used nowhere** (the Supabase-URL shapes in
`lib/builder-client/builder-asset-url.ts` are dead normalizer paths from
the ported app).

- Server upload for a worker: `uploadBufferToBlob()` in
  `lib/blobStorage.js` — takes a Buffer, no base64 round-trip, no ~7 MB
  route body cap. Paths: `<BLOB_ASSETS_ROOT>/<AssetType>/<Category>/
  <timestamp>_<name>`, `access: 'public'`, 1-year cache.
- Asset rows: `assets` table via `lib/assetsStore.js`, per-project scoped.
  Key column is `location` — **a URL string; modules reference assets by
  URL**, with optional `imageAssetId` for picker round-trip.
- "Used In": `lib/assetUsage.js` recursively scans page documents and
  matches by normalized URL (host + path, query stripped, path case
  preserved). An importer must write the same canonical URL into the
  asset row and the page JSON. Its `MEDIA_EXT_RE` covers images only —
  PDFs and fonts need an extension for usage counts.
- House doctrine (from `docs/SQL/project_support_requests.sql`): binaries
  never pass through Postgres; store the public URL.

---

## 7. Versioning, drafts, snapshots

- Drafts are a flag, not a separate row: `is_published` /
  `is_private` on the page. Public reads filter
  `is_published != false AND is_private = false`.
- Whole-site snapshots: `builder_page_snapshots`
  (`POST /api/builder/page-snapshots`, `POST .../:id/restore` loops
  `updatePage`). Project-scoped; stores the full page array in one jsonb.
- **No per-page revision history exists.** Saving overwrites the document.
- Import pattern that fits what exists: **snapshot the whole site first
  (one API call), land every imported page as `is_published: false`.**
  Rollback = restore + delete the draft slugs.

---

## 8. Site structure and navigation

**Nav is not a first-class object — there is no menus table.** Navigation
is a `navigation` module whose `settings.navItems` is a JSON string of
`{id, label, href, parentId, target, width?}` (one submenu level via
`parentId`). Two editors exist (vanilla `public/js/builderNavMenu.js` and
the React module card); schema unification in builder-template.ts
migrates legacy keys (`variant`→`navDirection`, `url`→`href`).

Header/Footer are **canonical saved sections**: a master row in
`builder_saved_sections`, instantiated on each page with
`savedSectionId` + `canonical: true`. Saving the master fan-outs to every
linked page via `propagateCanonicalSection`
(`lib/builderPagesStore.js`) — **replacing the whole section instance,
keeping only its id.** The propagation is awaited, not fire-and-forget
(serverless freeze incident, PR #21).

**Hard rule from the 2026-07-21 Marinoff menu-loss incident
(`scripts/marinoff_menu_recovery_20260721.mjs`): any nav an import
produces must be written into the saved-section master, never onto page
rows** — otherwise the next unrelated header save silently reverts it.

Site page list = rows in `builder_landing_page` filtered by
`project_id`; no sitemap/tree object. Home page is by convention: empty
slug wins, then `slug === 'home'`. `admin`/`admin-*` slugs are
auto-private (`lib/builder-client/public-site-page-slugs.js`). Creating a
page does **not** add it to any menu; the Bulk Create flow runs the other
direction (reads a nav to decide which pages to create).

Custom-domain serving: middleware rewrite → `routes/publicSitePages.js`
resolves host → project (`X-Site-Handler` response header is the debug
oracle) → serves `public/site.html` shell → client React fetches
`/api/public/pages` and renders with the same
`builder-template-preview.tsx`. No server-side HTML rendering of pages.

---

## 9. Background job / queue infrastructure

**None.** Facts:

- One Vercel cron total (`/api/promote/social/posts/publish-due`, every
  5 min). Cron auth is centralized (`CRON_PATHS` +
  `isAuthorizedCronRequest` in `routes/index.js`; `x-vercel-cron` header
  or `CRON_SECRET` bearer).
- "Due" processing is a filtered list looped serially in-request — no
  claiming, no leases, no idempotency keys anywhere in the repo.
- The YouTube agent "scheduler" is browser-triggered; the devAgent
  "worker" is a fire-and-forget self-fetch where **the operator's browser
  tab is the keep-alive**.
- Serverless function ceiling is 300 s (`vercel.json`), and **Playwright
  cannot run on Vercel** — stated in-repo
  (`routes/platformScreenshots.js`) and worked around by spawning local
  child processes. Playwright is already a dependency, lazily required
  for URL screenshots (`routes/builder.js: getChromium()`).
- Operator-script conventions (the de-facto job runner):
  `<topic>_<YYYYMMDD>.mjs`, dry-run default + `--apply`, JSON backups to
  `docs/SQL/backups/`, and the cloud-credentials guard — refuse
  localhost, instruct `doppler run --config prd -- node <script>`.
  Worktree caveat: env files are gitignored; scripts resolve env from a
  candidate list preferring `.env.local.cloud-backup`.

Site Import's worker therefore runs **off-Vercel** and, if it claims jobs
from a table, it establishes that pattern for the codebase (design the
table for it: `claimed_at`, `claimed_by`, `attempts`).

Migrations: **`docs/SQL/*.sql`, applied by hand in the Supabase SQL
editor and logged in `docs/Markdown Files/MIGRATIONS_APPLIED.md`, is the
schema source of truth** (`docs/DOCTRINE.md`; `supabase/migrations/` is
explicitly non-authoritative). Never `supabase db push`.

---

## 10. Where Site Import lives

Following stated conventions (`routes/index.js` header comment,
`routes/CLAUDE.md` "don't grow the monoliths", lib store naming, frozen
`public/js/`):

| Piece | Location |
|---|---|
| Schema | `docs/SQL/site_import_setup.sql` (+ MIGRATIONS_APPLIED.md entry) |
| API | `routes/siteImport.js` exporting `{ handle, manifest: { id: 'siteImport', label: 'Site Import', prefixes: ['/api/site-import'] } }`, registered in `ROUTE_MODULES` |
| Stores | `lib/siteImportStore.js` (scoped CRUD via `sbQuery` + `projectScope`) |
| Engine/IR/worker | `lib/site-import/` (capture provider, normalizer, IR types) |
| Worker entry | `scripts/site_import_worker.mjs` (operator-run, off-Vercel) |
| Admin UI | `components/builder/site-import-page.tsx`, mounted via `builder-react-entry.tsx` (`window.SiteImportReact`), host div in `src/pages/*.html` (rebuilt by `build:html`), minimal mount wiring in the vanilla shell following the existing feature-mount pattern |
| Fixtures/tests | `scripts/site-import/` fixtures + `node --test`, mirroring `npm run test:builder` |

Platform conventions that apply automatically or must be handled:

- **Auth** is centralized in `routes/index.js`; a new `/api/site-import`
  prefix requires `app_session` by default and requires an active project
  (`x-project-id` → `req.projectContext`) unless opted out. Good default.
- **Tenant project-admin sessions reach any new `/api/` prefix by
  default** — Site Import is Alphire-staff-only, so `/api/site-import`
  must be added to `PROJECT_ADMIN_SESSION_DENY_PREFIXES`
  (`lib/projectAdminApiAuth.js` / `routes/index.js`).
- **Rate limiting**: add a `siteImport.*` key to `LIMITS` in
  `lib/rateLimiter.js` (unknown keys log-and-allow) and use the idiom
  exactly: `if (checkEndpointLimit(req, res, 'siteImport.jobs')) return true;`
  — the function returns `true` when it has ALREADY sent the 429
  (CLAUDE.md landmine #11).
- **Envelope**: `sendOk` / `sendErr` from `routes/http.js`
  (`{ ok: true, data }` / `{ ok: false, error: { message, code? } }`).
- **Status UI**: polling is the house style (Realtime is used only by the
  Ask Roger chat); poll `GET /api/site-import/jobs/:id`.

---

## Constraints an importer must respect (summary)

1. `module.text` truncates at 10,000 chars — split long content.
2. Unknown module types are silently coerced to `text`; any new type
   needs the dual registration + `npm run build:builder-template`.
3. Page-document writes go through `lib/builder/document.js`
   (`serializeBuilderDocument`) — the raw normalizer drops fields.
4. On-disk key `sections` vs in-memory `layoutSections`; legacy bare
   arrays exist.
5. Slug uniqueness is `(project_id, slug)`; home is `''`/`'home'`;
   `admin-*` slugs are auto-private.
6. Imported nav goes to the Header saved-section master, never page rows.
7. `locked` sections are off-limits to programmatic content fill.
8. Land imports as unpublished drafts; whole-site snapshot first;
   dry-run by default; JSON backup; idempotent re-runs.
9. Assets referenced by URL; write the same canonical URL to the asset
   row and the page JSON so "Used In" matches.
10. Binaries to Blob, URLs to Postgres — never binary through the DB.
