# StarCaster Weekly Summary — June 7–10, 2026

**Product:** StarCaster (Alphire)  
**Repo:** `~/WebApps/starcaster`  
**Reference tenant:** Normie (`~/WebApps/normie`) — used to validate builder pages, modular layouts, and tenant-scoped flows end-to-end  
**Period covered:** Commits **2026-06-07** through **2026-06-09**, plus substantial **uncommitted** work on branch `cursor/estimated-progress-and-peer-filters` and local modular-builder sessions  
**Production:** `https://app.isitas.org` (Vercel)

---

## Executive summary

The past week concentrated on three major product areas:

1. **Acquire** — Rebuilt and extended **Acquire: Web** and **Acquire: YouTube**, then layered a **peer-website discovery pipeline** (Brave Search → classification → Discovered Peers table with filters and progress UX).
2. **Engage / Messaging** — **Facebook Personal** publishing routed through **OpenClaw**; **Import Other Formats** for messaging posts and asset-field import; tweet/tag metadata on posts.
3. **Builder (Develop)** — Large in-progress port of **Normie-style modular page builder** into StarCaster (document model, React island optional, vanilla editor in `develop.js`), plus ongoing fixes for **1-4-1 layout**, **save UX**, **cross-cell module drag**, **module column persistence**, and **table module borders**.

Most builder work is **not yet committed** (~6,400 lines changed locally vs HEAD). Acquire/peer-discovery commits are on the current feature branch; merge and deploy status should be confirmed before production.

---

## Timeline

| Date | Commit / work | Theme |
|------|----------------|-------|
| **Jun 7** | `010bcb7` — Updates to Acquire: Web and Acquire: Youtube | Multitenancy, website peers, project delete, broad Acquire refactor |
| **Jun 7** | `df42539` — Import Other Formats | Messaging posts import, asset field import, tweet fields |
| **Jun 7** | `707a9b8` — Facebook Personal → OpenClaw `/v1/responses` | Engage publishing path |
| **Jun 7** | `489f81c` — Fix `resolvedOpenClawProfile` initialization | Engage hotfix |
| **Jun 9** | `2ba7962` — Brave Search + Google CSE fallback | Peer discovery search providers |
| **Jun 9** | `da5c160` — 100 classified candidates + model categories | Scale + taxonomy |
| **Jun 9** | `9025976` — Hybrid Gemini classifier | AI + heuristic peer classification |
| **Jun 9** | `45104a2` — Estimated progress bars + Discovered Peers filters | Acquire UI polish |
| **Jun 7–10** | Local / thread work (uncommitted) | Modular builder, `lib/builder/*`, develop.js, CSS, SQL drafts |

---

## 1. Acquire: Web & YouTube (Jun 7 foundation)

**Commit:** `010bcb7` — *Updates to Acquire: Web and Acquire: Youtube*

This was the largest landed change of the week (~100+ files). It established project-scoped Acquire and related infrastructure.

### Acquire: Web

- **`lib/directAcquire.js`** — Richer page fetch and metadata extraction (structural HTML stripping, image/metadata handling).
- **`lib/websitePeersStore.js`** — Website peer records for discovered/reference sites.
- **`lib/peerDiscovery.js`** — Initial peer discovery orchestration (expanded heavily on Jun 9).
- **`routes/acquire.js`** — API routes for web acquire and peer flows.
- **`public/js/acquire.js`** — UI for web acquire runs, peer display, settings integration.
- **`src/pages/acquire.html`** — Acquire hub markup updates.

### Acquire: YouTube

- Stores and runs under `lib/acquire/` (comments, details, topics, videos, X/Reddit harvest paths).
- SQL migrations consolidated under `docs/SQL/` (e.g. `013_multitenancy_acquire_youtube.sql`, `supabase_acquire_youtube_details.sql`).

### Multitenancy & projects

- **`docs/SQL/011_multitenancy_acquire_engage.sql`**, **`012_multitenancy_backfill_primary_project.sql`** — Project-scoped Acquire/Engage.
- **`lib/projectDeleteHandler.js`**, **`lib/projectDeleteStore.js`**, **`api/projects/delete.js`** — Safer project deletion.
- **`lib/requireProjectContext.js`**, **`public/js/projectContext.js`** — Session project header patterns.
- Contacts, channels, auth, rate limits, and Supabase table wiring updated for tenant scope.

### Other Jun 7 touchpoints

- Legal pages (`privacy-policy`, `terms-of-service`), auth CSS, channels/settings pages.
- **`website_peers_setup.sql`** — Table for peer websites.

---

## 2. Peer website discovery pipeline (Jun 9)

Four commits built a full **discover → classify → store → filter** loop for competitor/model sites relative to a project URL.

### 2.1 Search providers (`2ba7962`)

- **`lib/webSearch.js`** — Unified web search with **Brave Search** primary and **Google Custom Search** fallback.
- **`lib/apiSettings.js`** — Provider configuration surfaced in settings.
- **`lib/peerDiscovery.js`** — Discovery orchestration using search batches.
- **`docs/SQL/website_peers_last_acquired_at_migration.sql`**, **`project_social_credentials_setup.sql`** — Schema support.
- Settings UI hooks in **`public/js/settings.js`**, **`src/pages/settings.html`**.

### 2.2 Scale & taxonomy (`da5c160`)

- Discovery expanded toward **~100 classified candidates** per run.
- **`lib/websitePeerTaxonomy.js`** — Category labels and model guide text for classification.
- Acquire routes and UI updated for larger result sets.

### 2.3 Hybrid Gemini classifier (`9025976`)

- **`lib/geminiClient.js`** — Gemini API client for structured JSON classification.
- **`lib/websitePeerClassifier.js`** — **Hybrid** mode: heuristic tier-one + Gemini batches; few-shot examples from existing peers; outputs `website_model`, `reference_role` (peer vs model), confidence, rationale.
- Env: `PEER_CLASSIFICATION_PROVIDER` (`hybrid` | `gemini` | `heuristic`), `PEER_CLASSIFICATION_MODEL` (default `gemini-2.5-flash`).

### 2.4 Progress UX & table filters (`45104a2`)

- **`public/js/estimatedProgress.js`** — Shared estimated progress bar helper (also wired into contacts/messaging where long ops run).
- **`public/js/acquire.js`** — **Discovered Peers** table filters (reference role, website model, etc.), badges, bulk-oriented UX improvements.
- **`src/pages/acquire.html`**, **`src/css/legacy.css`** — Filter row and table chrome aligned with UI standards.

### Uncommitted peer tweaks (current branch)

Local modifications continue on **`lib/websitePeerClassifier.js`**, **`lib/websitePeerTaxonomy.js`**, **`lib/websitePeersStore.js`**, **`lib/directAcquire.js`**, **`routes/acquire.js`**, **`public/js/acquire.js`** — verify diff before merge.

---

## 3. Engage & Messaging (Jun 7)

### Facebook Personal via OpenClaw (`707a9b8`)

- **`lib/openclawGateway.js`**, **`lib/openclawResponsesClient.js`** — Gateway client for OpenClaw responses API.
- **`lib/facebookPersonalPublisher.js`** — Personal Facebook publish path through OpenClaw.
- **`routes/engage.js`** — Route wiring; settings for OpenClaw profile selection.

### Import Other Formats (`df42539`)

- **`lib/assetFieldImport.js`**, **`public/js/assetFieldImport.js`** — Import content into asset-linked fields.
- **`lib/messagingPostsStore.js`**, **`public/js/messagingPostsEditor.js`** — Posts editor enhancements.
- **`docs/SQL/messaging_posts_setup.sql`**, tweet/tagged-contact migrations — Post metadata for social formats.
- Campaigns and promote-social JS updated for new post shapes.

### Bugfix (`489f81c`)

- **`routes/engage.js`** — Fixed temporal dead zone: `resolvedOpenClawProfile` used before initialization.

---

## 4. Builder / Develop module (Jun 7–10, mostly uncommitted)

StarCaster is gaining **Normie-compatible modular page building**: row layouts, draggable modules, landing pages and page templates stored as JSON documents in Supabase.

### 4.1 New architecture (local)

| Layer | Location | Role |
|-------|----------|------|
| Document model | `lib/builder/document.js` | Read/write `layout_sections` on landing pages & templates |
| Normie template engine | `lib/builder/template.js` | Layout normalization, module settings, serialize/parse |
| Legacy migration | `lib/builder/migrate-from-legacy.js` | StarCaster grid codes (`6`, `3-3`, `1-4-1`) ↔ Normie keys (`single`, `two-column`, `one-four-one`) |
| Tests | `scripts/builder/document.test.js` | Round-trip tests for layouts, backgrounds, text blocks, 1-4-1 |
| React island (optional) | `builder-react-entry.jsx`, `components/builder/`, `public/builder-bundle.js`, `public/js/builder.js` | `App.builder.mount()` — toggle via `localStorage builder_v2`; **page mode stays on vanilla editor** |
| Vanilla editor | `public/js/develop.js` (+~2,600 lines vs HEAD) | Modular workspace, row editor, module picker, save flows |
| Navigation module | `public/js/developNavMenu.js` | Nav menu module markup/settings |
| Stores | `lib/developLandingPagesStore.js`, `lib/developPageTemplatesStore.js`, `lib/developModulesStore.js`, etc. | Supabase CRUD with `layout_sections` |
| Routes | `routes/develop.js` | Extended develop API |
| CSS | `src/css/legacy.css`, `src/css/_builder.css` | Workspace, pods, table module scoping |
| Migrations (draft SQL) | `docs/SQL/develop_*`, `game_layer_setup.sql`, etc. | Modular columns, products, saved sections, game layer, project scope |

**Build commands added/used:**

```bash
npm run build:builder          # builder-bundle.js
npm run test:builder           # document tests
npm run migrate:builder-documents:dry-run
npx esbuild src/css/main.css --bundle --outfile=public/styles.css
npm run build:html
```

### 4.2 Normie alignment

Normie is the **source of truth** for layout vocabulary:

- **Layouts:** `single`, `two-column`, `three-column`, `one-four-one`, `four-two`, etc.
- **Columns:** `main`, `left`, `right`, `center`
- **StarCaster editor UI** uses legacy **`col1`/`col2`/`col3`** and codes like **`1-4-1`**; save/load must translate correctly.

Validation path: create/edit modular page in StarCaster → save → reopen → compare rendered columns with Normie builder expectations on the same template shape.

### 4.3 Completed builder items (this week’s sessions)

| Item | Status |
|------|--------|
| Distinct **`one-four-one`** layout (not aliased to `three-column`) | Done in `migrate-from-legacy.js` + `template.js` + `develop.js` |
| Grid **`1fr 4fr 1fr`** for 1-4-1 preview | Done |
| **Cross-column module drag** within same row | Done |
| **Save Page** feedback (Saving… / Saved / toast / primary button) | Done |
| Correct **base template id** on page save | Done |
| **`remapSectionToLayout`** / Normie column mapping for orphaned modules | Done |
| Document tests for 1-4-1 round-trip | Done |

### 4.4 Builder items still open (last known state)

| Item | Status |
|------|--------|
| **Modules collapse to first cell after Save** | Fixes applied (`mapLegacyColumnToNormie`, `resolveModuleColumnForLayout`, draft snapshot merge) — **needs verification** |
| **Table module border thickness 0** still shows 1px | CSS + `safeNumericSetting(0)` + backend normalize — **needs verification** |
| Distinguish **table cell borders** vs **workspace drop-zone chrome** | Partially addressed (removed default 1px on `.develop-page-template-row-cell`) |
| Cross-**row** module drag | Not implemented (same-row only) |
| React builder island for **page** mode | Intentionally off; vanilla editor is canonical for pages |

**Detailed handoff:** [Handoff - Modular Builder Save Layout and Table Borders.md](./Handoff%20-%20Modular%20Builder%20Save%20Layout%20and%20Table%20Borders.md)

---

## 5. Assets & media (uncommitted hints)

- **`public/js/assetImageEditor.js`**, **`lib/assetImageBytes.js`**, **`lib/assetImageImport.js`** — Image editor/import path for assets module.
- **`routes/assets.js`**, **`src/pages/assets.html`** — Asset UI extensions.

---

## 6. Game layer & products (SQL drafts, uncommitted)

New SQL setup files (not necessarily applied in Supabase yet):

- `docs/SQL/develop_products_setup.sql`
- `docs/SQL/develop_saved_sections_setup.sql`
- `docs/SQL/game_layer_setup.sql`
- `docs/SQL/develop_builder_project_scope_migration.sql` — `project_id` / `owner_user_id` on builder + game tables

Supporting code: `lib/developProductsStore.js`, `lib/developSavedSectionsStore.js`, `lib/game/*`, `lib/gameLevelEventsStore.js`.

---

## 7. Repository & branch state (as of Jun 10, 2026)

**Branch:** `cursor/estimated-progress-and-peer-filters` (tracks origin)

**Committed (8 commits, Jun 7–9):** Acquire, peers, Engage, messaging import, OpenClaw.

**Uncommitted (~29 files, +6,385 / −1,097 lines vs HEAD):**

- Heavy: `public/js/develop.js`, `public/js/acquire.js`, `public/styles.css`, `src/css/legacy.css`
- Builder stack: `lib/builder/`, `public/builder-bundle.js`, `public/js/builder.js`, `components/builder/`
- Peer/classifier tweaks, direct acquire, package.json scripts

**Untracked (examples):**

- `docs/Cursor Threads/Handoff - Modular Builder Save Layout and Table Borders.md`
- Multiple `docs/SQL/*.sql` drafts
- Builder scripts, game lib, asset image editor

**Recommendation:** Split into reviewable PRs — (1) peer discovery + Acquire UI, (2) builder document model + develop API, (3) modular editor UX fixes — before a single large merge.

---

## 8. Normie relationship (what moved vs what didn’t)

| Area | StarCaster this week | Normie |
|------|----------------------|--------|
| Modular layout document | Ported via `lib/builder/*` | Original schema / editor reference |
| 1-4-1 layout key | `one-four-one` in serializer | Same key expected on round-trip |
| Page editor | Vanilla `develop.js` (+ optional React for templates) | Full Normie builder UI |
| Peer discovery / Acquire | StarCaster-only feature work | May consume results as tenant data |
| E2E validation | Operator tests flows on Normie project | Production-like tenant |

No Normie repo changes are tracked in StarCaster git; coordination is **behavioral parity** on saved `layout_sections` JSON.

---

## 9. Operations & verification checklist

### Acquire / peers (committed features)

- [ ] Brave + Google CSE keys in project/api settings
- [ ] Gemini key if using hybrid/Gemini classification
- [ ] Run web acquire on a project URL → Discovered Peers populated
- [ ] Filters and progress bars on long runs
- [ ] `website_peers` / `last_acquired_at` migrations applied in Supabase

### Builder (uncommitted)

- [ ] `develop_landing_page_modular_migration.sql` / `develop_page_templates_modular_migration.sql` applied
- [ ] `npm run build` (html + builder bundle + css)
- [ ] Hard refresh; `develop.js?v=14` (or current cache bust in `src/layout.html`)
- [ ] 1-4-1 row survives Save Page + reopen
- [ ] Modules stay in correct columns after save (PATCH body uses `left`/`center`/`right`)
- [ ] Table module at border thickness **0** — no visible cell rules in preview/live view
- [ ] `npm run test:builder` passes

### Engage

- [ ] OpenClaw profile configured; Facebook Personal publish smoke test
- [ ] Import Other Formats on a messaging post

---

## 10. Key files quick reference

| Area | Files |
|------|--------|
| Acquire UI | `public/js/acquire.js`, `src/pages/acquire.html`, `routes/acquire.js` |
| Peer discovery | `lib/peerDiscovery.js`, `lib/webSearch.js`, `lib/websitePeerClassifier.js`, `lib/websitePeerTaxonomy.js` |
| Direct web acquire | `lib/directAcquire.js`, `lib/websitePeersStore.js` |
| Progress bars | `public/js/estimatedProgress.js` |
| Modular editor | `public/js/develop.js`, `src/pages/develop.html` |
| Builder core | `lib/builder/document.js`, `template.js`, `migrate-from-legacy.js` |
| Builder bridge | `public/js/builder.js`, `public/builder-bundle.js` |
| Engage / OpenClaw | `lib/facebookPersonalPublisher.js`, `lib/openclawGateway.js`, `routes/engage.js` |
| Messaging import | `lib/assetFieldImport.js`, `public/js/messagingPostsEditor.js` |
| CSS | `src/css/legacy.css`, `src/css/_tables.css` (CRUD tables — don’t weaken globally) |
| SQL index | `docs/SQL/` |

---

## 11. Suggested next steps

1. **Verify and commit** modular builder column-save + table border fixes; run `test:builder`.
2. **Open PR** for Jun 9 peer-discovery series if not already merged to main.
3. **Apply** pending SQL for modular pages and builder project scope in Supabase staging.
4. **Split** the 6k-line uncommitted develop.js / builder work into incremental commits.
5. **Re-test on Normie** — one modular landing page with 1-4-1, three modules in three columns, table with 0px borders.

---

## 12. Related handoff documents

- [Handoff - Modular Builder Save Layout and Table Borders.md](./Handoff%20-%20Modular%20Builder%20Save%20Layout%20and%20Table%20Borders.md) — deep dive on open builder bugs
- [Handoff - Alphire Starcaster orientation.md](./Handoff%20-%20Alphire%20Starcaster%20orientation.md) — product/repo orientation
- `docs/AI_AGENT_HANDOFF.md` — canonical agent entry point at repo root

---

*Generated from git history (Jun 7–9, 2026), working tree status, and Cursor agent sessions on modular builder work. Update this file when major commits land or open items close.*
