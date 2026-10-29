'use strict';

/**
 * Import a theme another project shares with this one (task 86bcu6uav).
 *
 * A share (lib/builderProjectSharesStore.js) only lets the receiving project
 * SEE the source's themes. Import is the one step that writes, and it writes
 * only into the receiving project: a NEW `builder_themes` row, an independent
 * copy with no link back. The source project is read and nothing else.
 *
 * Four rules, each with the trap behind it:
 *
 *   - The share is RE-CHECKED at import time. The list the Themes page showed
 *     may be minutes old; a project that has since unshared must not still be
 *     copied from by a stale button.
 *   - The copy is NEVER the default theme. `is_default` is written false and
 *     `setDefaultTheme` is not called: the default is what every page without
 *     a theme of its own wears, so an import that flagged it would recolour
 *     the receiving project's live site the moment somebody pressed Import.
 *   - Both tenant columns are written explicitly and the row is READ BACK.
 *     `scopedInsertRow` quietly stops stamping when its probe fails
 *     (CLAUDE.md landmine 12) — the insert would succeed and the copy would
 *     belong to no project, which no screen can find.
 *   - A name already taken in the receiving project gets a suffix
 *     ("Ocean (2)"). An import never overwrites one of this project's themes.
 *
 * The copy is made from the source ROW, column for column, rather than
 * through `rowToTheme` → `inputToRow`: that round trip is a save's
 * normaliser, and anything it does not know about (an older column, a key in
 * the typography JSON a later screen added) would be dropped on the way.
 * Image ids and banner URLs are copied as they are — the operator said shared
 * assets need not be recreated.
 */

const { sbQuery, tableConfig } = require('./supabase');
const sharesStore = require('./builderProjectSharesStore');
const { rowToTheme } = require('./builderThemesStore');

const NAME_MAX = 255;

/** Columns that belong to the SOURCE row's identity and are never copied. */
const NOT_COPIED = ['id', 'project_id', 'owner_user_id', 'is_default', 'created_at', 'updated_at'];

function safeText(value, max = NAME_MAX) {
  return String(value || '').trim().slice(0, max);
}

function themesTable() {
  return tableConfig().builderThemes;
}

function nextThemeId() {
  return `dtheme_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The name an imported copy takes: the source's own name when this project has
 * no theme by that name, otherwise the first free "Name (2)", "Name (3)", ….
 * Compared case-insensitively, because two themes a person reads as the same
 * name are a clash whatever their capitals.
 */
function uniqueThemeName(name, existingNames) {
  const base = safeText(name) || 'Imported theme';
  const taken = new Set((Array.isArray(existingNames) ? existingNames : [])
    .map((n) => safeText(n).toLowerCase())
    .filter(Boolean));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 10000; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, NAME_MAX - 20)} (${Date.now()})`;
}

/**
 * The row to insert: every column of the source row except its identity, plus
 * the new id, name and the receiving project's tenant columns. `is_default` is
 * set false explicitly rather than left to the column default, so the rule
 * holds even on a database whose default was ever changed.
 */
function buildImportedThemeRow(sourceRow, { id, name, targetProjectId, ownerUserId }) {
  const row = {};
  for (const [key, value] of Object.entries(sourceRow || {})) {
    if (NOT_COPIED.includes(key)) continue;
    // JSON columns are deep-copied so the new row shares no object with the
    // source (matters to tests and to any caller holding the source row).
    row[key] = value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }
  row.id = id;
  row.name = name;
  row.project_id = targetProjectId;
  row.owner_user_id = ownerUserId;
  row.is_default = false;
  return row;
}

async function readRows(query) {
  const res = await sbQuery({ method: 'GET', table: themesTable(), query });
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Could not read themes' };
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}

/**
 * Copy the shared theme `themeId` into `targetProjectId`.
 *
 * Returns the store envelope `{ ok, status, data | error }`; `data` is the new
 * theme, mapped the way the Themes list maps its own. A theme that is not (or
 * no longer) shared with the target is a 404 with a plain sentence — the same
 * answer whether it was unshared, deleted, or never existed, so the receiving
 * project learns nothing about the source it was not shown.
 */
async function copySharedTheme({ targetProjectId, ownerUserId, themeId }) {
  const target = safeText(targetProjectId);
  const owner = safeText(ownerUserId);
  const id = safeText(themeId, 120);
  if (!target) return { ok: false, status: 400, error: 'An active project is required' };
  if (!owner) return { ok: false, status: 401, error: 'Not authenticated' };
  if (!id) return { ok: false, status: 400, error: 'A theme id is required' };

  const notShared = {
    ok: false,
    status: 404,
    error: 'That theme is no longer shared with this project, so it cannot be imported. Reload the page to see what is shared now.',
  };

  const sources = await sharesStore.listSourcesSharingWith(target, 'themes');
  if (!sources.ok) return sources;
  if (!sources.data.length) return notShared;

  const found = await readRows(`select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!found.ok) return found;
  const sourceRow = found.data[0];
  const sourceProjectId = safeText(sourceRow?.project_id);
  if (!sourceRow || !sourceProjectId || sourceProjectId === target) return notShared;
  if (!sources.data.includes(sourceProjectId)) return notShared;

  const existing = await readRows(`select=name&project_id=eq.${encodeURIComponent(target)}&limit=5000`);
  if (!existing.ok) return existing;
  const name = uniqueThemeName(sourceRow.name, existing.data.map((r) => r?.name));

  const newId = nextThemeId();
  const inserted = await sbQuery({
    method: 'POST',
    table: themesTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [buildImportedThemeRow(sourceRow, { id: newId, name, targetProjectId: target, ownerUserId: owner })],
  });
  if (!inserted.ok) {
    return { ok: false, status: inserted.status || 500, error: `The copy could not be saved: ${inserted.error || 'unknown error'}` };
  }

  // Read it back from the receiving project rather than trusting the insert.
  const readBack = await readRows(
    `select=*&id=eq.${encodeURIComponent(newId)}&project_id=eq.${encodeURIComponent(target)}&limit=1`
  );
  if (!readBack.ok) return readBack;
  const row = readBack.data[0];
  if (!row || safeText(row.project_id) !== target || safeText(row.owner_user_id) !== owner) {
    return {
      ok: false,
      status: 500,
      error: 'The copy was sent to the database but could not be found in this project afterwards, so the import did not complete.',
    };
  }
  if (row.is_default === true) {
    // Cannot happen through the insert above; if a trigger ever did it, say so
    // rather than report a clean import that just changed the live site.
    return {
      ok: false,
      status: 500,
      error: `"${name}" was imported but came back marked as the default theme. Open Themes and make your usual theme the default again.`,
    };
  }
  return { ok: true, status: 201, data: rowToTheme(row) };
}

module.exports = {
  NOT_COPIED,
  uniqueThemeName,
  buildImportedThemeRow,
  copySharedTheme,
};
