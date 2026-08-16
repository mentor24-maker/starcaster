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
    // Empty means the row predates the saved_by columns, or the migration has
    // not been run here. The panel renders that as an em dash rather than
    // inventing an "Unknown" user.
    savedBy: safeText(row.saved_by, 120),
    savedByName: safeText(row.saved_by_name, 160),
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
  'id,page_id,name,slug,template_id,theme_id,section_count,module_count,layout_bytes,reason,created_at,saved_by,saved_by_name';

/** The same list without the author columns, for a database that lacks them. */
const SUMMARY_COLUMNS_WITHOUT_AUTHOR =
  'id,page_id,name,slug,template_id,theme_id,section_count,module_count,layout_bytes,reason,created_at';

const AUTHOR_COLUMNS = ['saved_by', 'saved_by_name'];

/**
 * PostgREST answers 42703 ("column ... does not exist") when
 * docs/SQL/builder_page_revisions_saved_by_migration.sql has not been run.
 * Same shape as the theme_id / is_private / search_priority retries elsewhere:
 * drop the column the deployment does not have and keep the rest of the write.
 */
function rejectsAuthorColumns(res) {
  // Same detection the page store uses for theme_id / is_private /
  // search_priority: the rejected column's name appears in the error message.
  const message = safeText(res?.error || res?.message || '', 1000).toLowerCase();
  return AUTHOR_COLUMNS.some((column) => message.includes(column));
}

function stripAuthorColumns(row) {
  const next = { ...row };
  for (const column of AUTHOR_COLUMNS) delete next[column];
  return next;
}

/**
 * Who to credit for a save. `name` is preferred, email is the fallback -- a
 * project-admin session carries no name at all, and "brandon@example.com" in
 * the history beats a blank.
 */
function describeActor(actor) {
  if (!actor || typeof actor !== 'object') return { id: '', name: '' };
  return {
    id: safeText(actor.id, 120),
    name: safeText(actor.name, 160) || safeText(actor.email, 160),
  };
}

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
  const actor = describeActor(options.actor);

  try {
    const row = await scopedInsertRow(
      table(),
      {
        page_id: id,
        saved_by: actor.id || null,
        saved_by_name: actor.name || null,
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

    let res = await sbQuery({ method: 'POST', table: table(), body: [row] });
    // A deployment that has not run the saved_by migration still gets its
    // history -- just without the name. Losing the author is a cosmetic
    // regression; losing the revision is the thing this table exists to stop.
    if (!res.ok && rejectsAuthorColumns(res)) {
      res = await sbQuery({ method: 'POST', table: table(), body: [stripAuthorColumns(row)] });
    }
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

  const tail = `&page_id=eq.${id}&order=created_at.desc&limit=${REVISIONS_PER_PAGE}`;
  const query = await scopedListQuery(table(), `select=${SUMMARY_COLUMNS}${tail}`, scope);
  let res = await sbQuery({ method: 'GET', table: table(), query });
  // Selecting a column the deployment does not have is a hard 400, so the
  // whole panel would report itself unavailable purely because the newer
  // migration has not been run. Ask again without the author columns.
  if (!res.ok && rejectsAuthorColumns(res)) {
    const fallback = await scopedListQuery(
      table(),
      `select=${SUMMARY_COLUMNS_WITHOUT_AUTHOR}${tail}`,
      scope
    );
    res = await sbQuery({ method: 'GET', table: table(), query: fallback });
  }
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

/**
 * How close a revision's created_at must sit to the page's updated_at before
 * we will name its author as the person who made that save. In production the
 * gap is milliseconds (the revision is written straight after the page PATCH
 * lands); ten seconds is slack for a slow round trip.
 */
const ATTRIBUTION_WINDOW_MS = 10_000;

/**
 * Who made the save that last touched this page, for the stale-editor warning.
 *
 * Returns '' rather than guessing. A metadata-only save (rename, visibility)
 * mints no revision, so the newest revision can belong to an EARLIER save by a
 * different person -- naming them would put the wrong name in front of the
 * operator, which is worse than the honest "Somebody else". The timestamp
 * window is what rules that case out.
 */
async function findSaveAuthor(pageId, liveUpdatedAt, scope = null) {
  const id = Number(pageId || 0) || 0;
  const liveAt = Date.parse(String(liveUpdatedAt || ''));
  if (!id || !Number.isFinite(liveAt)) return '';

  try {
    const query = await scopedListQuery(
      table(),
      `select=saved_by_name,created_at&page_id=eq.${id}&order=created_at.desc&limit=1`,
      scope
    );
    const res = await sbQuery({ method: 'GET', table: table(), query });
    if (!res.ok) return '';
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    const name = safeText(row?.saved_by_name, 160);
    if (!name) return '';
    const revisionAt = Date.parse(String(row?.created_at || ''));
    if (!Number.isFinite(revisionAt)) return '';
    return Math.abs(revisionAt - liveAt) <= ATTRIBUTION_WINDOW_MS ? name : '';
  } catch (_) {
    return '';
  }
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
  findSaveAuthor,
  getPageRevision,
  prunePageRevisions,
  // exported for tests
  summarise,
  layoutChanged,
  describeActor,
  rejectsAuthorColumns,
  stripAuthorColumns,
};
