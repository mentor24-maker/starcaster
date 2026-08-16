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

/**
 * RETENTION, in three tiers.
 *
 * A flat "newest 25" was the whole rule until 2026-08-15, and by that evening
 * the Delray home page sat at exactly 25 revisions spanning about ninety
 * minutes. On a build day the version from that morning was already gone --
 * and the morning version is precisely what you want at 5pm when you discover
 * something broke at 10am.
 *
 * So: fine-grained for the session in progress, then thinning out.
 *
 *   · every revision from the newest 25          (undo, while you are working)
 *   · the FIRST revision of each hour, 7 days    (what the page looked like
 *   · the FIRST revision of each day, 30 days     before that hour/day's work)
 *   · nothing older
 *
 * The FIRST of each period rather than the last, because a revision holds the
 * state a page was in BEFORE a save -- so the earliest one in an hour is the
 * page as it stood when that hour began.
 *
 * Layout JSON runs to ~140KB on a built-out page, which is what stops this
 * being "keep everything".
 */
const REVISIONS_PER_PAGE = 25;
const HOURLY_WINDOW_DAYS = 7;
const DAILY_WINDOW_DAYS = 30;

/** How many rows the History panel lists. Larger than the fine-grained tier so
 *  the older milestones are actually reachable from the UI. */
const HISTORY_LIST_LIMIT = 60;

/** Upper bound on rows examined per prune. Two queries, regardless of history size. */
const PRUNE_SCAN_LIMIT = 500;

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Which revision ids this page no longer needs, given the tiers above.
 *
 * Pure and total: takes the rows and the current time, returns ids. `now` is a
 * parameter and not Date.now() so the tier boundaries can be tested exactly
 * rather than by sleeping.
 *
 * Anything with an unreadable created_at is KEPT. This function is the only
 * code in the system that deletes history, and history is the safety net every
 * other part of this feature leans on -- when it cannot tell, it must not cut.
 */
function selectRevisionsToDrop(rows, now) {
  const parsed = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ id: Number(row?.id) || 0, at: Date.parse(String(row?.created_at || '')) }))
    .filter((row) => row.id);

  const undated = parsed.filter((row) => !Number.isFinite(row.at));
  const dated = parsed
    .filter((row) => Number.isFinite(row.at))
    .sort((a, b) => b.at - a.at); // newest first

  const keep = new Set(undated.map((row) => row.id));

  // Tier 1: every one of the newest N.
  dated.slice(0, REVISIONS_PER_PAGE).forEach((row) => keep.add(row.id));

  // Tiers 2 and 3: the FIRST revision in each period. Walking oldest-first
  // means the first row seen for a bucket is the earliest one in it.
  const hourlyCutoff = now - HOURLY_WINDOW_DAYS * DAY_MS;
  const dailyCutoff = now - DAILY_WINDOW_DAYS * DAY_MS;
  const seenHours = new Set();
  const seenDays = new Set();

  for (const row of [...dated].reverse()) {
    if (row.at < dailyCutoff) continue; // older than the longest window: drop
    const day = Math.floor(row.at / DAY_MS);
    if (row.at >= hourlyCutoff) {
      const hour = Math.floor(row.at / HOUR_MS);
      if (!seenHours.has(hour)) {
        seenHours.add(hour);
        seenDays.add(day);
        keep.add(row.id);
      }
      continue;
    }
    if (!seenDays.has(day)) {
      seenDays.add(day);
      keep.add(row.id);
    }
  }

  return parsed.filter((row) => !keep.has(row.id)).map((row) => row.id);
}

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

/** How many section names a summary spells out before it says "and N more". */
const SUMMARY_NAME_LIMIT = 3;

/** A section's name for the history list, falling back to its position. */
function sectionName(section, index) {
  return safeText(section?.title, 60) || `Section ${index + 1}`;
}

/**
 * Join names into "A", "B" and "C", or "A", "B", "C" and 4 more.
 * The result has to fit on one line in the panel, so the tail is a count.
 */
function nameList(names) {
  if (names.length <= SUMMARY_NAME_LIMIT) {
    const quoted = names.map((n) => `"${n}"`);
    if (quoted.length === 1) return quoted[0];
    return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  }
  const shown = names.slice(0, SUMMARY_NAME_LIMIT).map((n) => `"${n}"`).join(', ');
  return `${shown} and ${names.length - SUMMARY_NAME_LIMIT} more`;
}

/**
 * One line saying what the save that replaced `before` did to it.
 *
 * `before` is the version being banked; `after` is what is taking its place.
 * Both are in memory at the one moment this can be computed cheaply, which is
 * why it is stored rather than derived when the list is read -- layout_sections
 * runs to ~140KB on a built-out page and the history list must never load it.
 *
 * Existence is tracked by section ID, not by position: a section that MOVED has
 * not been removed and re-added, and reporting it that way would be a lie in
 * the one place the operator goes when something has gone missing.
 */
function describeChange(before, after) {
  const from = sectionsOf(before);
  const to = sectionsOf(after);

  const fromIds = from.map((s, i) => String(s?.id ?? `#${i}`));
  const toIds = to.map((s, i) => String(s?.id ?? `#${i}`));
  const fromById = new Map(from.map((s, i) => [fromIds[i], { section: s, index: i }]));
  const toById = new Map(to.map((s, i) => [toIds[i], { section: s, index: i }]));

  // Named from the ORIGINAL index, not the filtered one. Mapping after a
  // filter renumbers everything, so an untitled fourth section reported itself
  // as "Section 1" -- a position fallback that points at the wrong section is
  // worse than no name at all.
  const added = to.flatMap((s, i) => (fromById.has(toIds[i]) ? [] : [sectionName(s, i)]));
  const removed = from.flatMap((s, i) => (toById.has(fromIds[i]) ? [] : [sectionName(s, i)]));

  const parts = [];
  if (added.length) parts.push(`Added ${nameList(added)}`);
  if (removed.length) parts.push(`Removed ${nameList(removed)}`);
  if (parts.length) return parts.join(' · ');

  // Same set of sections. Either their contents changed, or only their order
  // did -- and "Reordered" is worth saying, because a section that looks
  // missing is often just somewhere else on the page.
  const edited = [];
  for (const [id, entry] of fromById) {
    const other = toById.get(id);
    if (!other) continue;
    if (JSON.stringify(entry.section) !== JSON.stringify(other.section)) {
      edited.push(sectionName(entry.section, entry.index));
    }
  }
  if (edited.length) return `Edited ${nameList(edited)}`;

  const orderChanged = fromIds.some((id, i) => toIds[i] !== id);
  if (orderChanged) return 'Reordered sections';

  return '';
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
    // What the save that replaced this version did to it. Empty on rows
    // recorded before the column existed; the panel falls back to the counts.
    changeSummary: safeText(row.change_summary, 300),
    createdAt: row.created_at || '',
  };
  if (includeLayout) {
    revision.layoutSections = sectionsOf(row.layout_sections);
    revision.pageBackground = parseJson(row.page_background, null);
    revision.theme = parseJson(row.theme, null);
  }
  return revision;
}

const BASE_SUMMARY_COLUMNS =
  'id,page_id,name,slug,template_id,theme_id,section_count,module_count,layout_bytes,reason,created_at';

/**
 * Columns added after the table shipped, each behind its own migration. A
 * deployment may have run any subset of them, so both the write and the read
 * fall back by dropping whichever ones PostgREST rejects -- the same pattern
 * theme_id, is_private and search_priority follow in builderPagesStore.
 */
const OPTIONAL_COLUMNS = ['saved_by', 'saved_by_name', 'change_summary'];

const SUMMARY_COLUMNS = `${BASE_SUMMARY_COLUMNS},${OPTIONAL_COLUMNS.join(',')}`;

/**
 * Which optional columns this deployment rejected, if any.
 *
 * PostgREST names the offending column in its 42703 message, so the answer is
 * read straight out of it -- the same detection the page store uses for
 * theme_id / is_private / search_priority. Returns [] for any other failure,
 * so an unrelated error is never "fixed" by silently dropping data.
 */
function rejectedOptionalColumns(res) {
  const message = safeText(res?.error || res?.message || '', 1000).toLowerCase();
  return OPTIONAL_COLUMNS.filter((column) => {
    // Whole identifier, not a substring: "saved_by" sits inside
    // "saved_by_name", so a plain includes() reported BOTH as missing when
    // only the longer one was, and dropped a column the database actually had.
    const boundary = new RegExp(`(^|[^a-z0-9_])${column}([^a-z0-9_]|$)`);
    return boundary.test(message);
  });
}

function stripColumns(row, columns) {
  const next = { ...row };
  for (const column of columns) delete next[column];
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
async function prunePageRevisions(pageId, scope = null, now = Date.now()) {
  const id = Number(pageId || 0) || 0;
  if (!id) return;
  try {
    // ONE read and ONE delete, whatever the history looks like. The tiers need
    // to see every row to pick a first-of-hour, but this still cannot grow into
    // a per-save cost that scales with how long a page has existed: the scan is
    // capped, and the cap is far above what the tiers can ever leave behind
    // (25 + 24x7 + 30 = 223).
    const listQuery = await scopedListQuery(
      table(),
      `select=id,created_at&page_id=eq.${id}&order=created_at.desc&limit=${PRUNE_SCAN_LIMIT}`,
      scope
    );
    const res = await sbQuery({ method: 'GET', table: table(), query: listQuery });
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return;

    const ids = selectRevisionsToDrop(res.data, now);
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
  // Computed HERE and nowhere else: this is the one call that holds both the
  // version being banked and the version replacing it.
  const changeSummary = describeChange(previousLayout, nextLayoutSections);

  try {
    const row = await scopedInsertRow(
      table(),
      {
        page_id: id,
        saved_by: actor.id || null,
        saved_by_name: actor.name || null,
        change_summary: changeSummary || null,
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
    // A deployment that has not run one of the later migrations still gets its
    // history -- just without that column. Losing the author or the summary is
    // a cosmetic regression; losing the revision is the thing this table exists
    // to stop. PostgREST reports one missing column at a time, so this retries
    // while it keeps naming new ones rather than assuming a single round trip.
    let dropped = [];
    while (!res.ok) {
      const rejected = rejectedOptionalColumns(res).filter((c) => !dropped.includes(c));
      if (!rejected.length) return; // table absent, or a failure we must not paper over
      dropped = [...dropped, ...rejected];
      res = await sbQuery({ method: 'POST', table: table(), body: [stripColumns(row, dropped)] });
    }
  } catch (_) {
    // A page save must never fail because its history could not be written.
    return;
  }

  await prunePageRevisions(id, options.scope || null);
}

async function listPageRevisions(pageId, scope = null) {
  const id = Number(pageId || 0) || 0;
  if (!id) return { ok: false, status: 400, error: 'page id is required' };

  const tail = `&page_id=eq.${id}&order=created_at.desc&limit=${HISTORY_LIST_LIMIT}`;
  // Selecting a column the deployment does not have is a hard 400, so the whole
  // panel would report itself unavailable purely because a later migration has
  // not been run. Drop whichever columns it names and ask again.
  let columns = [...OPTIONAL_COLUMNS];
  let res = await sbQuery({
    method: 'GET',
    table: table(),
    query: await scopedListQuery(table(), `select=${SUMMARY_COLUMNS}${tail}`, scope),
  });
  while (!res.ok) {
    const rejected = rejectedOptionalColumns(res).filter((c) => columns.includes(c));
    if (!rejected.length) break;
    columns = columns.filter((c) => !rejected.includes(c));
    const select = [BASE_SUMMARY_COLUMNS, ...columns].join(',');
    res = await sbQuery({
      method: 'GET',
      table: table(),
      query: await scopedListQuery(table(), `select=${select}${tail}`, scope),
    });
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
  HISTORY_LIST_LIMIT,
  selectRevisionsToDrop,
  recordPageRevision,
  listPageRevisions,
  findSaveAuthor,
  getPageRevision,
  prunePageRevisions,
  // exported for tests
  summarise,
  layoutChanged,
  describeActor,
  rejectedOptionalColumns,
  stripColumns,
  describeChange,
};
