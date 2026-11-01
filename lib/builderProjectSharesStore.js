'use strict';

/**
 * Project-to-project sharing of Builder libraries (task 86bcu6t1c).
 *
 * One row in `builder_project_shares` says "the SOURCE project (`project_id`)
 * lets the TARGET project (`target_project_id`) see every item of one type".
 * Nothing is copied when a share is made; the receiving project only ever
 * READS the source's items here, and copies one into itself later through an
 * explicit Import (separate tickets).
 *
 * This is the first code that reads one tenant's Builder data on behalf of
 * another, so the reads below never go through `scopedListQuery`: outside
 * STRICT_PROJECT_SCOPE that helper also returns rows with a NULL project_id
 * (legacy rows from before projects existed), which here would hand one
 * client's unscoped rows to another. Every cross-project read filters
 * `project_id=eq.<source>` and nothing else decides which rows come back.
 *
 * No local-file fallback, on purpose: a store that answers from a JSON file
 * when the database refuses reports success while nothing is saved
 * (CLAUDE.md landmines 6 and 15). A missing table is an error the caller sees.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { rowToPageTemplate } = require('./builderPageTemplatesStore');
const { rowToTheme } = require('./builderThemesStore');
const { rowToSavedSection } = require('./builderSavedSectionsStore');

const SHARE_OBJECT_TYPES = Object.freeze(['saved_sections', 'page_templates', 'themes']);

/**
 * Pages are shared ONE BY ONE (task 86bcw3m94), unlike the library types
 * above, which share everything of a type. A page share row carries the page's
 * id in `object_id`; a library-type row leaves it blank. Kept out of
 * SHARE_OBJECT_TYPES on purpose: that list is "the types you tick", and a
 * page is picked by name instead.
 */
const PAGES_TYPE = 'pages';
const PAGES_SQL_FILE = 'docs/SQL/builder_project_shares_pages.sql';

const ITEM_SOURCES = {
  saved_sections: { tableKey: 'builderSavedSections', toItem: rowToSavedSection },
  page_templates: { tableKey: 'builderPageTemplates', toItem: rowToPageTemplate },
  themes: { tableKey: 'builderThemes', toItem: rowToTheme },
};

function table() {
  return tableConfig().builderProjectShares;
}

/**
 * The error a failed read of the shares table returns. When the table itself
 * is missing, say so by name: on 2026-10-30 production had never run
 * builder_project_shares_setup.sql, and the panel reported an owner of
 * thirteen projects as having none (task 86bcvk7uf). PostgREST answers a
 * missing table with "Could not find the table ... in the schema cache";
 * Postgres itself with "relation ... does not exist".
 */
function sharesReadError(res, fallback) {
  const text = String(res?.error || '');
  if (/schema cache|does not exist|PGRST205|42P01/i.test(text)) {
    return {
      ok: false,
      status: 503,
      code: 'SHARES_TABLE_MISSING',
      error: 'Sharing is not set up on this database yet: the builder_project_shares table does not exist '
        + '(run docs/SQL/builder_project_shares_setup.sql).',
    };
  }
  return { ok: false, status: res?.status || 500, error: text || fallback };
}

function safeText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function isShareObjectType(value) {
  return SHARE_OBJECT_TYPES.includes(safeText(value));
}

function uniqueTexts(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = safeText(value);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/**
 * The settings screen is two checkbox lists — which types, which projects —
 * and what is stored is every ticked type for every ticked project. Stored per
 * pair so a finer screen can come later without a migration. An empty list on
 * EITHER side means no shares at all, never "everything".
 */
function buildSharePairs(sourceProjectId, types, targetProjectIds, pageIds = []) {
  const source = safeText(sourceProjectId);
  const wantedTypes = uniqueTexts(types).filter(isShareObjectType);
  const wantedPages = uniqueTexts(pageIds);
  const targets = uniqueTexts(targetProjectIds).filter((id) => id !== source);
  const pairs = [];
  for (const targetProjectId of targets) {
    for (const objectType of wantedTypes) {
      pairs.push({ targetProjectId, objectType });
    }
    for (const objectId of wantedPages) {
      pairs.push({ targetProjectId, objectType: PAGES_TYPE, objectId });
    }
  }
  return pairs;
}

function rowToShare(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: safeText(row.id),
    projectId: safeText(row.project_id),
    ownerUserId: safeText(row.owner_user_id),
    targetProjectId: safeText(row.target_project_id),
    objectType: safeText(row.object_type),
    // Absent before builder_project_shares_pages.sql: reads as blank, which is
    // what every library-type row holds anyway.
    objectId: safeText(row.object_id),
    createdByUserId: safeText(row.created_by_user_id),
    createdAt: safeText(row.created_at),
  };
}

/** Summarise a project's share rows as the two lists the screen ticks. */
function summarizeShares(shares) {
  const list = Array.isArray(shares) ? shares : [];
  return {
    types: SHARE_OBJECT_TYPES.filter((type) => list.some((s) => s.objectType === type)),
    pageIds: uniqueTexts(list.filter((s) => s.objectType === PAGES_TYPE).map((s) => s.objectId)),
    targets: uniqueTexts(list.map((s) => s.targetProjectId)),
    pairs: list.map((s) => ({ targetProjectId: s.targetProjectId, objectType: s.objectType, objectId: s.objectId })),
  };
}

/** Every share the SOURCE project has made. */
async function listSharesFrom(limit = 1000, sourceProjectId) {
  const source = safeText(sourceProjectId);
  if (!source) return { ok: false, status: 400, error: 'A source project id is required' };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&project_id=eq.${encodeURIComponent(source)}&order=created_at.asc&limit=${safeLimit}`,
  });
  if (!res.ok) return sharesReadError(res, 'Could not read project shares');
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToShare).filter(Boolean) };
}

/**
 * Can this database hold a page share? Asked BEFORE the replace below clears
 * anything, so a save that ticks a page on a database that has not run
 * builder_project_shares_pages.sql is refused with everything already shared
 * left in place — not cleared and then half rewritten.
 */
async function checkPageSharesReady() {
  const res = await sbQuery({ method: 'GET', table: table(), query: 'select=object_id&limit=1' });
  if (res.ok) return { ok: true };
  // The column test comes first: Postgres words a missing COLUMN as
  // "column … does not exist", which the missing-TABLE test would also match.
  if (/object_id|42703/i.test(String(res.error || ''))) {
    return {
      ok: false,
      status: 503,
      code: 'PAGE_SHARES_NOT_SET_UP',
      error: `Sharing pages is not set up on this database yet (run ${PAGES_SQL_FILE}). `
        + 'Nothing was changed: untick the pages to save the rest.',
    };
  }
  return sharesReadError(res, 'Could not read project shares');
}

/**
 * Replace the source project's whole share set with
 * (`types` + `pageIds`) × `targetProjectIds`.
 *
 * Delete first, then insert. If the insert fails the project is left sharing
 * LESS than intended, never more — the failure direction that cannot leak —
 * and the error is returned rather than swallowed. The new set is read back
 * from the table, so the caller reports what is stored, not what it sent.
 *
 * Callers decide who may do this and which targets are allowed (the route
 * checks ownership and membership); this function only writes.
 */
async function replaceSharesFrom(sourceProjectId, { types, targetProjectIds, pageIds, ownerUserId, createdByUserId } = {}) {
  const source = safeText(sourceProjectId);
  if (!source) return { ok: false, status: 400, error: 'A source project id is required' };
  const owner = safeText(ownerUserId);
  if (!owner) return { ok: false, status: 400, error: 'An owner user id is required' };

  const pairs = buildSharePairs(source, types, targetProjectIds, pageIds);
  if (pairs.some((pair) => pair.objectType === PAGES_TYPE)) {
    const ready = await checkPageSharesReady();
    if (!ready.ok) return ready;
  }

  const cleared = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `project_id=eq.${encodeURIComponent(source)}`,
  });
  if (!cleared.ok) {
    return { ok: false, status: cleared.status || 500, error: cleared.error || 'Could not clear the old shares' };
  }

  if (pairs.length) {
    const createdBy = safeText(createdByUserId) || owner;
    // `object_id` only on page rows: a library-type row gets the column's
    // blank default, so saving those still works on a database that has not
    // run builder_project_shares_pages.sql.
    const rows = pairs.map((pair) => ({
      project_id: source,
      owner_user_id: owner,
      target_project_id: pair.targetProjectId,
      object_type: pair.objectType,
      ...(pair.objectType === PAGES_TYPE ? { object_id: pair.objectId } : {}),
      created_by_user_id: createdBy,
    }));
    const inserted = await sbQuery({ method: 'POST', table: table(), body: rows });
    if (!inserted.ok) {
      return {
        ok: false,
        status: inserted.status || 500,
        error: `The old shares were cleared but the new ones could not be saved: ${inserted.error || 'unknown error'}`,
      };
    }
  }

  return listSharesFrom(5000, source);
}

/** Which projects share `objectType` with the TARGET project. */
async function listSourcesSharingWith(targetProjectId, objectType) {
  const target = safeText(targetProjectId);
  if (!target) return { ok: false, status: 400, error: 'A target project id is required' };
  if (!isShareObjectType(objectType)) {
    return { ok: false, status: 400, error: `Unknown share type. Allowed: ${SHARE_OBJECT_TYPES.join(', ')}` };
  }
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=project_id&target_project_id=eq.${encodeURIComponent(target)}`
      + `&object_type=eq.${encodeURIComponent(objectType)}&limit=5000`,
  });
  if (!res.ok) return sharesReadError(res, 'Could not read project shares');
  const sources = uniqueTexts((Array.isArray(res.data) ? res.data : []).map((r) => r?.project_id))
    .filter((id) => id !== target);
  return { ok: true, status: 200, data: sources };
}

/**
 * Every item of `objectType` that another project shares with the TARGET
 * project, each tagged with where it came from. Read-only.
 *
 * `projectNames` maps a project id to its name; the route supplies it so this
 * store never has to read the projects table. A saved section marked Private
 * stays out: its owner said so, and a project-wide share is not a reason to
 * override that.
 */
async function listSharedItems(targetProjectId, objectType, { projectNames = {}, limit = 1000 } = {}) {
  const sourcesRes = await listSourcesSharingWith(targetProjectId, objectType);
  if (!sourcesRes.ok) return sourcesRes;
  const sources = sourcesRes.data;
  if (!sources.length) return { ok: true, status: 200, data: [] };

  const { tableKey, toItem } = ITEM_SOURCES[objectType];
  const itemTable = tableConfig()[tableKey];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const items = [];
  for (const sourceProjectId of sources) {
    const res = await sbQuery({
      method: 'GET',
      table: itemTable,
      query: `select=*&project_id=eq.${encodeURIComponent(sourceProjectId)}`
        + `&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    });
    if (!res.ok) {
      return { ok: false, status: res.status || 500, error: res.error || `Could not read shared ${objectType}` };
    }
    for (const row of Array.isArray(res.data) ? res.data : []) {
      // Belt and braces: the query already filtered on project_id, but this is
      // the line between two clients, so a row that does not carry the source's
      // id is dropped rather than trusted.
      if (safeText(row?.project_id) !== sourceProjectId) continue;
      if (objectType === 'saved_sections' && row?.is_private === true) continue;
      const item = toItem(row);
      if (!item) continue;
      items.push({
        ...item,
        sourceProjectId,
        sourceProjectName: safeText(projectNames[sourceProjectId]) || sourceProjectId,
      });
    }
  }
  return { ok: true, status: 200, data: items };
}

function pagesTable() {
  return tableConfig().builderPages;
}

/** A page as the share screens show it: enough to recognise, nothing more. */
function rowToPageSummary(row) {
  return {
    id: safeText(row?.id, 120),
    name: safeText(row?.name),
    slug: safeText(row?.slug, 160),
    isPublished: row?.is_published == null ? true : row.is_published === true,
    updatedAt: safeText(row?.updated_at, 60),
  };
}

/**
 * The pages a project could share: the picker in its own Share with panel,
 * and the set a PUT's `pageIds` is checked against. Filtered on project_id
 * and nothing else, for the same reason as every read in this file.
 */
async function listProjectPages(projectId) {
  const source = safeText(projectId);
  if (!source) return { ok: false, status: 400, error: 'A project id is required' };
  const res = await sbQuery({
    method: 'GET',
    table: pagesTable(),
    query: `select=id,name,slug,is_published,updated_at,project_id&project_id=eq.${encodeURIComponent(source)}`
      + '&order=name.asc&limit=5000',
  });
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Could not read this project\'s pages' };
  const pages = (Array.isArray(res.data) ? res.data : [])
    .filter((row) => safeText(row?.project_id) === source)
    .map(rowToPageSummary)
    .filter((page) => page.id);
  return { ok: true, status: 200, data: pages };
}

/**
 * Every page another project shares with the TARGET, as
 * `[{ sourceProjectId, pageId }]`. A database without the object_id column
 * holds no page shares, so it answers with none rather than an error — the
 * Pages screen's button is simply absent there.
 */
async function listPageSharesWith(targetProjectId) {
  const target = safeText(targetProjectId);
  if (!target) return { ok: false, status: 400, error: 'A target project id is required' };
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=project_id,object_id&target_project_id=eq.${encodeURIComponent(target)}`
      + `&object_type=eq.${PAGES_TYPE}&limit=5000`,
  });
  if (!res.ok) {
    if (/object_id|42703/i.test(String(res.error || ''))) return { ok: true, status: 200, data: [] };
    return sharesReadError(res, 'Could not read project shares');
  }
  const out = [];
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const sourceProjectId = safeText(row?.project_id);
    const pageId = safeText(row?.object_id);
    if (!sourceProjectId || !pageId || sourceProjectId === target) continue;
    if (!out.some((s) => s.sourceProjectId === sourceProjectId && s.pageId === pageId)) {
      out.push({ sourceProjectId, pageId });
    }
  }
  return { ok: true, status: 200, data: out };
}

/**
 * The pages shared with the TARGET, each read from its own source project by
 * id AND project_id, and tagged with where it came from. A page its source has
 * since deleted is left out. Summaries only — the page body is read at import.
 */
async function listSharedPages(targetProjectId, { projectNames = {} } = {}) {
  const shares = await listPageSharesWith(targetProjectId);
  if (!shares.ok) return shares;
  const items = [];
  for (const { sourceProjectId, pageId } of shares.data) {
    const res = await sbQuery({
      method: 'GET',
      table: pagesTable(),
      query: `select=id,name,slug,is_published,updated_at,project_id`
        + `&id=eq.${encodeURIComponent(pageId)}&project_id=eq.${encodeURIComponent(sourceProjectId)}&limit=1`,
    });
    if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Could not read shared pages' };
    const row = (Array.isArray(res.data) ? res.data : [])
      .find((r) => safeText(r?.id, 120) === pageId && safeText(r?.project_id) === sourceProjectId);
    if (!row) continue;
    items.push({
      ...rowToPageSummary(row),
      sourceProjectId,
      sourceProjectName: safeText(projectNames[sourceProjectId]) || sourceProjectId,
    });
  }
  return { ok: true, status: 200, data: items };
}

module.exports = {
  sharesReadError,
  SHARE_OBJECT_TYPES,
  PAGES_TYPE,
  PAGES_SQL_FILE,
  checkPageSharesReady,
  listProjectPages,
  listPageSharesWith,
  listSharedPages,
  isShareObjectType,
  buildSharePairs,
  summarizeShares,
  listSharesFrom,
  replaceSharesFrom,
  listSourcesSharingWith,
  listSharedItems,
};
