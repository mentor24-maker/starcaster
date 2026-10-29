'use strict';

/**
 * Import an item another project shares with this one (task 86bcu6tzk).
 *
 * A share (lib/builderProjectSharesStore.js) only lets the receiving project
 * SEE the source's items. Import is the one step that writes, and it writes
 * only into the receiving project: a NEW row, an independent copy, never a
 * link. The source project is read and nothing else.
 *
 * Reusable on purpose — the page-template import brings along the saved
 * sections its header and footer point to, and copies them through
 * `copySharedSavedSection` here rather than a second implementation.
 *
 * Three rules, each with the trap behind it:
 *
 *   - The share is RE-CHECKED at import time. The list the screen showed may
 *     be minutes old; a project that has since unshared must not still be
 *     copied from by a stale button.
 *   - Both tenant columns are written explicitly and the row is READ BACK.
 *     `scopedInsertRow` quietly stops stamping when its probe fails
 *     (CLAUDE.md landmine 12), and the saved-sections store falls back to a
 *     local JSON file (landmines 6 and 15) — either would report a copy that
 *     no screen in the receiving project can find.
 *   - Every lineage marker is stripped (`savedSectionId`, `savedModuleId`,
 *     `canonical`, `canonicalLocked`). They point at masters in the SOURCE
 *     project; a copy that kept them would either follow another client's
 *     edits or read as a broken link. Media URLs are left exactly as they are
 *     — the operator said the assets need not be recreated.
 */

const { nextId } = require('../routes/http');
const { sbQuery, tableConfig } = require('./supabase');
const sharesStore = require('./builderProjectSharesStore');
const { rowToSavedSection } = require('./builderSavedSectionsStore');

const NAME_MAX = 255;
const LINEAGE_KEYS = ['savedSectionId', 'savedModuleId', 'canonical', 'canonicalLocked'];

function safeText(value, max = NAME_MAX) {
  return String(value || '').trim().slice(0, max);
}

/**
 * The name an imported copy takes: the source's own name when this project has
 * none by that name, otherwise the first free "Name (2)", "Name (3)", ….
 * Never the name of an existing section — an import never overwrites.
 * Compared case-insensitively, because two sections a person reads as the
 * same name are a clash whatever their capitals.
 */
function uniqueImportName(name, existingNames) {
  const base = safeText(name) || 'Imported section';
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
 * A deep copy of `value` with every lineage marker removed. Module `settings`
 * are copied verbatim and not searched: they are free-form strings, and a
 * setting that happened to be called `canonical` is content, not lineage.
 */
function stripLineage(value) {
  if (Array.isArray(value)) return value.map(stripLineage);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (LINEAGE_KEYS.includes(key)) continue;
    out[key] = key === 'settings' ? JSON.parse(JSON.stringify(child ?? null)) : stripLineage(child);
  }
  return out;
}

function savedSectionsTable() {
  return tableConfig().builderSavedSections;
}

async function readRows(query) {
  const res = await sbQuery({ method: 'GET', table: savedSectionsTable(), query });
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Could not read saved sections' };
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}

/**
 * Copy the shared saved section `sectionId` into `targetProjectId`.
 *
 * Returns the store envelope `{ ok, status, data | error }`; `data` is the new
 * row, mapped the way the saved-sections list maps its own. A section that is
 * not (or no longer) shared with the target is a 404 with a plain sentence —
 * the same answer whether it was unshared, made private, deleted, or never
 * existed, so the receiving project learns nothing about the source it was
 * not shown.
 */
async function copySharedSavedSection({ targetProjectId, ownerUserId, sectionId }) {
  const target = safeText(targetProjectId);
  const owner = safeText(ownerUserId);
  const id = safeText(sectionId, 120);
  if (!target) return { ok: false, status: 400, error: 'An active project is required' };
  if (!owner) return { ok: false, status: 401, error: 'Not authenticated' };
  if (!id) return { ok: false, status: 400, error: 'A section id is required' };

  const notShared = {
    ok: false,
    status: 404,
    error: 'That section is no longer shared with this project, so it cannot be imported. Reload the list to see what is shared now.',
  };

  const sources = await sharesStore.listSourcesSharingWith(target, 'saved_sections');
  if (!sources.ok) return sources;
  if (!sources.data.length) return notShared;

  const found = await readRows(`select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!found.ok) return found;
  const sourceRow = found.data[0];
  const sourceProjectId = safeText(sourceRow?.project_id);
  if (!sourceRow || !sourceProjectId || sourceProjectId === target) return notShared;
  if (!sources.data.includes(sourceProjectId)) return notShared;
  if (sourceRow.is_private === true) return notShared;

  const existing = await readRows(`select=name&project_id=eq.${encodeURIComponent(target)}&limit=5000`);
  if (!existing.ok) return existing;
  const name = uniqueImportName(sourceRow.name, existing.data.map((r) => r?.name));

  const section = stripLineage(sourceRow.section && typeof sourceRow.section === 'object' ? sourceRow.section : {});
  // One name: the stamped title follows the row name, as every rename does
  // (lib/builder-client/saved-section-name.ts).
  section.title = name;

  const newId = nextId('saved_section');
  const inserted = await sbQuery({
    method: 'POST',
    table: savedSectionsTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [{
      id: newId,
      name,
      section,
      is_private: false,
      project_id: target,
      owner_user_id: owner,
    }],
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
  return { ok: true, status: 201, data: rowToSavedSection(row) };
}

module.exports = {
  uniqueImportName,
  stripLineage,
  copySharedSavedSection,
};
