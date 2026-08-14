'use strict';

/**
 * Per-page revision history for the Builder.
 *
 * Each row is the state a page held BEFORE a layout-changing save, so the
 * live row is the present and this table is the trail behind it. Recording the
 * PRIOR state rather than the new one is what makes the feature useful from
 * the moment it ships: the first save on a page that predates this table
 * captures its good existing layout, with no backfill.
 *
 * Every write here is best-effort. A page save must never fail because its
 * history could not be written -- losing the audit trail is an inconvenience,
 * losing the save is the thing we are here to prevent. See recordPageRevision.
 *
 * Background: docs/SQL/develop_builder_page_revisions_setup.sql.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');

/** Newest N kept per page. Layout JSON runs to ~140KB on a built-out page. */
const REVISIONS_PER_PAGE = 25;

function table() {
  return tableConfig().builderPageRevisions;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function sectionsOf(value) {
  const parsed = parseJson(value, []);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.sections)) return parsed.sections;
  return [];
}

/**
 * Summary counts, stored alongside the layout so the history list never has to
 * read the layout itself.
 */
function summarise(layoutSections) {
  const sections = sectionsOf(layoutSections);
  const moduleCount = sections.reduce(
    (total, section) => total + (Array.isArray(section?.modules) ? section.modules.length : 0),
    0
  );
  let bytes = 0;
  try {
    bytes = JSON.stringify(layoutSections ?? []).length;
  } catch (_) {
    bytes = 0;
  }
  return { sectionCount: sections.length, moduleCount, layoutBytes: bytes };
}

/**
 * True when two layouts differ. A save that leaves the layout untouched (a
 * rename, a visibility toggle) should not mint a revision -- otherwise the
 * history fills with entries that restore to the same thing.
 */
function layoutChanged(before, after) {
  try {
    return JSON.stringify(before ?? []) !== JSON.stringify(after ?? []);
  } catch (_) {
    // Unserialisable input: assume it changed rather than silently skipping.
    return true;
  }
}

function rowToRevision(row, { includeLayout = false } = {}) {
  if (!row) return null;
  const revision = {
    id: String(row.id ?? ''),
    pageId: String(row.page_id ?? ''),
    name: safeText(row.name, 255),
    slug: safeText(row.slug, 255),
    templateId: safeText(row.template_id, 120),
    themeId: safeText(row.theme_id, 120),
    sectionCount: Number(row.section_count || 0) || 0,
    moduleCount: Number(row.module_count || 0) || 0,
    layoutBytes: Number(row.layout_bytes || 0) || 0,
    reason: safeText(row.reason, 40) || 'save',
    createdAt: row.created_at || '',
  };
  if (includeLayout) {
    revision.layoutSections = sectionsOf(row.layout_sections);
    revision.pageBackground = parseJson(row.page_background, null);
    revision.theme = parseJson(row.theme, null);
  }
  return revision;
}

const SUMMARY_COLUMNS =
  'id,page_id,name,slug,template_id,theme_id,section_count,module_count,layout_bytes,reason,created_at';

/**
 * Drop everything past the newest REVISIONS_PER_PAGE for this page.
 *
 * Best-effort like the insert: a page whose history grew one row too long is
 * not a reason to surface an error.
 */
async function prunePageRevisions(pageId, scope = null) {
  const id = Number(pageId || 0) || 0;
  if (!id) return;
  try {
    const listQuery = await scopedListQuery(
      table(),
      `select=id&page_id=eq.${id}&order=created_at.desc&offset=${REVISIONS_PER_PAGE}&limit=200`,
      scope
    );
    const res = await sbQuery({ method: 'GET', table: table(), query: listQuery });
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return;

    const ids = res.data.map((row) => Number(row.id)).filter(Boolean);
    if (!ids.length) return;

    await sbQuery({
      method: 'DELETE',
      table: table(),
      query: `id=in.(${ids.join(',')})`,
    });
  } catch (_) {
    // History pruning is housekeeping; never let it reach the caller.
  }
}

/**
 * Record `previous` as a revision of `pageId`, unless its layout matches
 * `nextLayoutSections` (nothing changed) or the table is absent.
 *
 * Returns nothing and throws nothing, by design -- callers sit on the page
 * save path.
 */
async function recordPageRevision(pageId, previous, nextLayoutSections, options = {}) {
  const id = Number(pageId || 0) || 0;
  if (!id || !previous) return;

  const previousLayout = previous.layoutSections ?? previous.layout_sections ?? [];
  if (!layoutChanged(previousLayout, nextLayoutSections)) return;

  const { sectionCount, moduleCount, layoutBytes } = summarise(previousLayout);

  try {
    const row = await scopedInsertRow(
      table(),
      {
        page_id: id,
        name: safeText(previous.name, 255),
        slug: safeText(previous.slug, 255),
        template_id: safeText(previous.templateId ?? previous.template_id, 120),
        theme_id: safeText(previous.themeId ?? previous.theme_id, 120) || null,
        layout_sections: JSON.stringify(sectionsOf(previousLayout)),
        page_background: JSON.stringify(previous.pageBackground ?? previous.page_background ?? null),
        theme: JSON.stringify(previous.theme ?? null),
        section_count: sectionCount,
        module_count: moduleCount,
        layout_bytes: layoutBytes,
        reason: safeText(options.reason, 40) || 'save',
      },
      options.scope || null
    );

    const res = await sbQuery({ method: 'POST', table: table(), body: [row] });
    if (!res.ok) return; // table not applied yet, or PostgREST rejected it
  } catch (_) {
    // A page save must never fail because its history could not be written.
    return;
  }

  await prunePageRevisions(id, options.scope || null);
}

async function listPageRevisions(pageId, scope = null) {
  const id = Number(pageId || 0) || 0;
  if (!id) return { ok: false, status: 400, error: 'page id is required' };

  const query = await scopedListQuery(
    table(),
    `select=${SUMMARY_COLUMNS}&page_id=eq.${id}&order=created_at.desc&limit=${REVISIONS_PER_PAGE}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 500,
      error: 'Page history is unavailable. Run docs/SQL/develop_builder_page_revisions_setup.sql in Supabase.',
      code: 'HISTORY_UNAVAILABLE',
    };
  }
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map((row) => rowToRevision(row)) : [],
  };
}

async function getPageRevision(revisionId, scope = null) {
  const id = Number(revisionId || 0) || 0;
  if (!id) return { ok: false, status: 400, error: 'revision id is required' };

  const query = await scopedIdQuery(table(), `select=*&id=eq.${id}&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;

  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Revision not found' };
  return { ok: true, status: 200, data: rowToRevision(row, { includeLayout: true }) };
}

module.exports = {
  REVISIONS_PER_PAGE,
  recordPageRevision,
  listPageRevisions,
  getPageRevision,
  prunePageRevisions,
  // exported for tests
  summarise,
  layoutChanged,
};
