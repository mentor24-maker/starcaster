# Modular Builder — Save, Layout, Module Placement, Table Borders

**Repo:** `~/WebApps/starcaster` (StarCaster by Alphire)  
**Reference project:** `~/WebApps/normie` (Normie — primary E2E tenant for builder flows)  
**Thread focus:** Builder modular page editor (pages + templates): row layouts, cross-cell drag, save UX, module column persistence, table module borders  
**Date:** June 2026  
**Status:** Partially resolved — layout (1-4-1) and save feedback improved; module column placement and zero table borders need verification after latest fixes

---

## 1. What this thread was about

The operator worked in **Builder → Pages** (modular landing pages) and hit several related issues:

| # | Topic | Status |
|---|--------|--------|
| **1** | **1-4-1 row layout** reverting to full-width or 2-2-2 after save | **Mostly fixed** — distinct Normie key `one-four-one` vs `three-column` |
| **2** | **Cross-cell module drag** (moving pills between columns in same row) | **Fixed** — drops allowed across columns within a row |
| **3** | **Save Page** with no visible feedback | **Fixed** — button states + toast + primary “Save Page” label |
| **4** | **Modules collapse to first cell** after save | **In progress** — save/merge/column-mapping fixes applied; user reported still broken at last check |
| **5** | **Table module: Border Thickness 0** still shows 1px lines | **In progress** — CSS + inline + backend normalization; user reported still broken at last check |

**Recommendation:** Continue in a **new thread** titled something like *“Verify modular save column placement + table zero borders”* with a hard refresh, one concrete page ID, and DevTools Network tab open on `PATCH /api/develop/landing-pages/:id`.

---

## 2. Architecture context (StarCaster ↔ Normie)

- **Frontend:** Vanilla JS in `public/js/develop.js` — modular page/template editor, drag-drop workspace, save handlers.
- **Backend:** `routes/develop.js` → `lib/developLandingPagesStore.js` / `lib/developPageTemplatesStore.js`.
- **Layout document:** `lib/builder/document.js` serializes via `lib/builder/template.js` + `lib/builder/migrate-from-legacy.js`.
- **Two column vocabularies:**
  - **Legacy (editor UI):** `col1`, `col2`, `col3` + layout codes `6`, `3-3`, `2-2-2`, `1-4-1`, etc.
  - **Normie (API/DB):** `left`, `center`, `right`, `main` + layout keys `single`, `two-column`, `three-column`, `one-four-one`, etc.
- **Normie** is the live reference tenant for validating saved pages end-to-end; builder round-trip must preserve both layout key and per-module `column`.

---

## 3. Completed work

### 3.1 One-four-one layout persistence

**Problem:** `1-4-1` was stored as `three-column` (same as 2-2-2), so reload could not distinguish narrow–wide–narrow from equal thirds.

**Fixes:**

- `lib/builder/migrate-from-legacy.js` — `'1-4-1': 'one-four-one'` (not `three-column`).
- `lib/builder/template.js` — grid `1fr 4fr 1fr` for `one-four-one`.
- `public/js/develop.js` — maps `NORMIE_LAYOUT_TO_LEGACY`, `LEGACY_TO_NORMIE_LAYOUT`, `getModularPageLayoutMeta`, `layoutSectionsForSave`, post-save draft merge.
- Test: `scripts/builder/document.test.js` — `1-4-1` → `one-four-one` round-trip.

**Note:** Rows saved as `three-column` before this fix cannot be auto-distinguished from true 2-2-2; re-select **1-4-1** once if an old row looks wrong.

### 3.2 Cross-column module drag

**Problem:** `getPlacedModuleDropTarget` only allowed drops in the same column; `endPlacedPageModulePointerDrag` always used source column.

**Fixes:**

- Cross-column drops within the same row; cell/stack highlighting; `toColumn: drag.dropTarget.column`.
- `cursor: grab` / `grabbing` on module pills.
- CSS in `src/css/legacy.css` for drop targets.

### 3.3 Save Page feedback

**Problem:** Header **Save** button had no loading/success state; success only via easy-to-miss status bar.

**Fixes:**

- `saveModularPageRecord()` — **Saving…** → **Saved** (green) → **Save Page**; disables sibling save buttons during request.
- Toast via `App.notify` (also `App.components.Toast`).
- Header button: `btn-primary`, label **Save Page** (`src/pages/develop.html`).
- Correct **base template id** on save (`resolveLandingPageBaseTemplateId()` — not the modular template record id).
- Lighter post-save refresh (`refreshAfterModularPageSave`) instead of full `refresh()` when editing a page.

### 3.4 Layout remapping / modules stuck in first cell (partial)

**Problem:** After choosing 1-4-1, modules could pile into col1; `remapSectionToLayout` did not map Normie columns.

**Fixes (earlier in thread):**

- `moduleBelongsToLayoutColumn()` + `mapNormieColumnToLegacy()` in remap/drag paths.
- `coerceNormieSectionToLegacy` uses resolved legacy layout for column keys.

---

## 4. In-progress / latest fixes (needs verification)

### 4.1 Modules reset to first cell after Save

**Symptoms:** User drags modules into separate cells; after **Save Page**, all pills appear in the first column again.

**Root causes identified:**

1. **Save payload** sent legacy `col1`/`col2`/`col3` while section `layout` was Normie `one-four-one` — server `normalizeLayoutSections` treated unknown columns as invalid → defaulted to first allowed column (`left` → displays as col1).
2. **Post-save merge** sometimes preferred API response modules over draft placements when column counts matched.
3. **`layoutSectionsForSave`** re-ran `getModularEditorLayoutSections()` which could alter draft before serialize.
4. **Cross-column drag** only allowed **same section index** — moving between columns works, but not between rows (by design in current code).

**Latest fixes (may be unverified if build/test was interrupted):**

| Area | Change |
|------|--------|
| `layoutSectionsForSave` | Map modules to Normie columns via `mapLegacyColumnToNormie()`; write `cellPadding`, `cellBorderWidth`, etc.; use `normalizePageTemplateLayoutSections(sections)` directly (no re-coerce on save). |
| `lib/builder/template.js` | `resolveModuleColumnForLayout()` — maps `col1`→`left`, `col2`→`center`, `col3`→`right` for `one-four-one` / `three-column`. |
| `saveModularPageRecord` | Snapshot draft with `normalizePageTemplateLayoutSections(modularPageTemplateDraft.layoutSections)` before API call. |
| `mergeModulePlacementsFromDraft` | Always prefer draft column by module id **or index** when merging API response. |
| `moveModularPageModule` | Default column to first layout column id, not `'main'`. |

**How to verify:**

1. Hard refresh (`Cmd+Shift+R`), edit a modular page with 1-4-1 row.
2. Drag three modules to left / center / right cells.
3. **Save Page** — confirm pills stay in place without reload.
4. Navigate away → **Edit Page** again — confirm persistence from DB.
5. In Network tab, inspect PATCH body: each module should have `"column": "left"|"center"|"right"` (not `col1` only).

### 4.2 Table module — 0px border still shows 1px

**Symptoms:** **Border Thickness** set to **0**; cells still show visible 1px lines (editor, preview, and/or saved page view).

**Root causes identified:**

1. **Global CRUD CSS** — `src/css/_tables.css` applies `th, td { border-bottom: 1px solid ... }` and black header styles; builder tables need scoped overrides.
2. **Falsy zero bug** — `safeText(0)` and `safeText(next.borderThickness) || '1'` treat **0** as empty → thickness falls back to **1**.
3. **Normie vs StarCaster field names** — table defaults use `borderWidth` in `lib/builder/template.js`; editor uses `borderThickness`.
4. **Editor workspace chrome** — `.develop-page-template-row-cell` had hardcoded `border: 1px solid #999` and inset box-shadow (looks like “cell borders” in the builder grid, not the table module).
5. **Preview iframe** — embedded `<style>` in preview modal may omit table reset rules present in main `styles.css`.

**Fixes applied across thread + latest pass:**

| Area | Change |
|------|--------|
| `buildTableCellBorderCss` | `!important` zero borders when thickness ≤ 0 |
| `getTableModuleBorderThickness` | Reads `borderThickness ?? borderWidth` |
| `syncTableModuleBorderSettings` | Keeps both keys in sync on module save |
| `safeNumericSetting` | Preserves numeric **0** for container/table borders |
| `src/css/legacy.css` | Scoped `.develop-template-table-slot .develop-module-table` resets; `[data-zero-border="true"]`; removed default 1px on `.develop-page-template-row-cell` |
| `lib/builder/template.js` | Table settings normalize `borderThickness`/`borderWidth` with `normalizeSpacingValue(..., 0, 24)` |
| Preview iframe styles in `develop.js` | Table reset block added |

**How to verify:**

1. Add a **Table** module; set **Border Thickness** to **0**; save module settings.
2. Check preview tab and saved page view — no grid lines on `<th>`/`<td>`.
3. Distinguish **table cell borders** from **builder column drop-zone chrome** (latter should no longer be a forced 1px gray box if latest CSS shipped).
4. Rebuild: `npx esbuild src/css/main.css --bundle --outfile=public/styles.css` and `npm run build:html`; cache bust `develop.js?v=14` in `src/layout.html`.

---

## 5. Key files

| Area | Files |
|------|--------|
| Modular editor / save / drag | `public/js/develop.js` |
| Row layout backend | `lib/builder/migrate-from-legacy.js`, `lib/builder/template.js`, `lib/builder/document.js` |
| Landing page API | `routes/develop.js`, `lib/developLandingPagesStore.js` |
| Table / workspace CSS | `src/css/legacy.css`, `src/css/_tables.css` (CRUD only — do not weaken globally) |
| Page markup | `src/pages/develop.html` → `npm run build:html` |
| Tests | `scripts/builder/document.test.js` |
| Cache bust | `src/layout.html` (`develop.js?v=14` at last edit) |

---

## 6. Environment notes

- `npm run build:css` does not exist — use `npx esbuild src/css/main.css --bundle --outfile=public/styles.css` or `npm run build`.
- Restart local server after `lib/builder/*` changes.
- Supabase: modular pages need `template_kind` and `layout_sections` columns (`docs/develop_landing_page_modular_migration.sql` if missing).
- **Nothing committed** unless operator explicitly requests — check `git status` before deploy.

---

## 7. Open items / success criteria

- [ ] Drag modules to separate cells on 1-4-1 row → **Save Page** → placements unchanged in UI.
- [ ] Close editor, reopen same page from **Builder: Pages** list → placements still correct.
- [ ] PATCH payload modules use Normie columns (`left`/`center`/`right`) for 1-4-1 sections.
- [ ] Table module at **Border Thickness 0** — no visible cell borders in editor preview, modal preview, and live page.
- [ ] Container **Border Thickness 0** on column settings respected (via `safeNumericSetting` + `buildContainerStyle`).
- [ ] Optional: cross-**row** module drag (currently same-row only).

---

## 8. Paste-ready prompt for follow-up thread

```
Continue modular builder fixes on StarCaster (Normie reference tenant).

1) Module columns after save: User drags modules into separate cells on a 1-4-1 row; after Save Page, all modules return to the first cell. Verify PATCH body column values, lib/builder/template.js resolveModuleColumnForLayout, layoutSectionsForSave mapLegacyColumnToNormie, mergeModulePlacementsFromDraft, and reload via getModularEditorLayoutSections / coerceNormieSectionToLegacy.

2) Table borders: Border Thickness 0 still shows 1px on table cells. Check safeNumericSetting(0), buildTableCellBorderCss, getTableModuleBorderThickness, global _tables.css leak, preview iframe styles, and whether user is conflating table borders with .develop-page-template-row-cell chrome.

Read: docs/Cursor Threads/Handoff - Modular Builder Save Layout and Table Borders.md

Hard refresh after CSS/JS rebuild. Do not commit unless asked.
```

---

## 9. Related prior handoff context

This thread continued work from an earlier session on the same modular editor (1-4-1 persistence, cross-cell drag, initial border investigation). Agent transcript: `29d3cc65-f74b-4509-bb0b-0f614056bcfb` (Cursor agent transcripts folder for this project).
