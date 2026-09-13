'use strict';

/**
 * Publishing: turn drafts into the live snapshot the public site serves.
 *
 * THE CONTRACT (operator, 2026-08-16)
 *   Draft resolves live      — you change a theme or a header and see it
 *                              immediately.
 *   Published materializes   — the built row is a snapshot of the resolved
 *                              result, frozen until you publish again.
 *
 * So nothing here changes how editing behaves. It photographs the result.
 *
 * CHUNKED AND RESUMABLE, BY DESIGN AND FROM THE FIRST COMMIT
 * A whole-site publish is precisely the shape of work that already failed in
 * this codebase: a long loop over many pages inside a serverless function that
 * stops when the response goes out. propagateCanonicalSection died that way on
 * 2026-07-22 and left 30 pages updated and 20 stale, with a different split
 * every save.
 *
 * So publishing never tries to be one long request. `publishPages` takes a
 * batch, writes it, and reports what is left. The caller loops. Stopping
 * anywhere is safe: every page written is a complete build, and the pages not
 * yet reached simply keep serving what they served before — their previous
 * build, or their draft if they have never been published. There is no
 * half-built state, only a smaller published set.
 *
 * Reads: lib/publishedPageRead.js. Table: docs/SQL/develop_builder_published_pages_setup.sql.
 */

const crypto = require('node:crypto');
const { sbQuery, tableConfig } = require('./supabase');
const { scopedInsertRow } = require('./projectScope');

/** Pages per call. Small enough that one batch is never the thing that times out. */
const PUBLISH_BATCH_SIZE = 10;

function table() {
  return tableConfig().builderPublishedPages;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function newBuildId() {
  return `build_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * A publish is only as good as what it photographs. This is the SAME function
 * the public list endpoint uses, so a built page and a live-resolved page
 * cannot differ: frame sections resolved against their masters (#247), theme
 * shell attached, private pages filtered out.
 */
async function loadPublishablePages(projectId) {
  const { listPublishedPagesForProject } = require('./builderPagesStore');
  const result = await listPublishedPagesForProject(projectId);
  if (!result.ok) return result;
  return { ok: true, status: 200, data: Array.isArray(result.data) ? result.data : [] };
}

/**
 * Which pages still need building, newest-draft-first so the most recently
 * edited page goes live soonest if a publish is interrupted.
 */
async function listPendingPublish(projectId) {
  const pagesResult = await loadPublishablePages(projectId);
  if (!pagesResult.ok) return pagesResult;

  const builtResult = await listBuildsForProject(projectId);
  const built = new Map(
    (builtResult.ok ? builtResult.data : []).map((row) => [String(row.pageId), row])
  );

  const pending = pagesResult.data.filter((page) => isPagePendingPublish(page, built.get(String(page.id))));

  pending.sort((a, b) => publishSourceStamp(b).localeCompare(publishSourceStamp(a)));
  return { ok: true, status: 200, data: pending, total: pagesResult.data.length };
}

/**
 * WHEN did the thing a snapshot photographs last change?
 *
 * A page's own `updatedAt` is only half of it. The snapshot also bakes in the
 * page's THEME (`themeShell`, attached by `enrichPagesWithThemeShell`), and a
 * theme is a reference: saving one writes the theme row and no page row —
 * deliberately, since 2026-08-15 (scripts/builder/themeIsAReference.test.js).
 * So until 2026-09-13 a theme save moved nothing here: every page using the
 * theme kept an older `updatedAt` than its build, read as up to date, and the
 * Publish panel said there was nothing to publish while the live site still
 * showed the old headline colour. The operator's only way through was to open
 * every page, save it by hand to bump its clock, and publish (task 86bbzy9ym).
 *
 * The stamp is therefore the LATER of the page's clock and its theme's clock.
 * ONE function, used by both the staleness check and the write: if the check
 * compared against the theme clock but the write recorded only the page's,
 * a page whose theme is newer would be pending again the moment it was
 * published, forever.
 *
 * Returns an ISO string, or '' when neither clock can be read.
 */
function publishSourceStamp(page) {
  const pageAt = Date.parse(String(page?.updatedAt || '')) || 0;
  const themeAt = Date.parse(String(page?.themeShell?.updatedAt || '')) || 0;
  const latest = Math.max(pageAt, themeAt);
  return latest > 0 ? new Date(latest).toISOString() : '';
}

/**
 * Does this page have changes its build does not show?
 *
 * @param {object} page   A page as `loadPublishablePages` returns it (theme shell attached).
 * @param {object|null|undefined} build  The page's current build summary, or nothing if never published.
 */
function isPagePendingPublish(page, build) {
  if (!build) return true; // never published
  const sourceAt = Date.parse(publishSourceStamp(page)) || 0;
  const builtAt = Date.parse(String(build.sourceUpdatedAt || '')) || 0;
  return sourceAt > builtAt;
}

function rowToBuild(row) {
  if (!row) return null;
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (_) { payload = null; }
  }
  return {
    id: String(row.id ?? ''),
    pageId: String(row.page_id ?? ''),
    slug: safeText(row.slug, 160),
    payload: payload && typeof payload === 'object' ? payload : null,
    sourceUpdatedAt: row.source_updated_at || '',
    buildId: safeText(row.build_id, 120),
    publishedAt: row.published_at || '',
  };
}

/** Summary rows only — payload is large and the staleness check never needs it. */
async function listBuildsForProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'projectId is required' };

  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query:
      `select=id,page_id,slug,source_updated_at,build_id,published_at` +
      `&project_id=eq.${encodeURIComponent(id)}&limit=5000`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToBuild) : [],
  };
}

/**
 * Narrow the pending list to a named set of pages.
 *
 * Its own function so the rule is reachable by a test — driving `publishPages`
 * needs a database, and the rule that matters most here is the one an
 * inattentive `if (pageIds.length)` gets backwards:
 *
 *   ABSENT (undefined/null) = publish everything pending. What the Publish
 *     panel asks for.
 *   EMPTY ARRAY            = publish NOTHING. A caller whose page list came
 *     back empty — a fan-out that rewrote no pages, a tally that could not be
 *     read — must not fall through to putting the whole site live.
 *
 * It intersects, it never adds: naming a page that is not pending does not
 * publish it, so a stale or wrong id costs nothing.
 *
 * @param {Array<{id: string|number}>} pending
 * @param {string[]|undefined|null} pageIds
 */
function selectPagesToPublish(pending, pageIds) {
  const all = Array.isArray(pending) ? pending : [];
  if (!Array.isArray(pageIds)) return all;
  const only = new Set(pageIds.map((pageId) => String(pageId || '').trim()).filter(Boolean));
  return all.filter((page) => only.has(String(page.id)));
}

/**
 * Build one batch. Returns what it wrote and what is still outstanding, so the
 * caller can keep going without holding any state of its own.
 *
 * PUBLISHING A NAMED SET (`pageIds`)
 * Without it this publishes EVERYTHING pending, which is right for the Publish
 * panel and wrong for every other caller. Saving a saved section rewrites the
 * drafts of the pages that follow it; offering to put *those* live must not
 * also push the operator's unrelated half-finished drafts out to visitors.
 * So the filter is an intersection with the pending list, never a source of
 * pages in its own right: a page that is already published, or does not belong
 * to this project, is not publishable by naming it here.
 *
 * @param {string} projectId
 * @param {object} [options]
 * @param {string} [options.buildId]  Continue an existing publish rather than starting one.
 * @param {number} [options.limit]    Pages this call may write.
 * @param {string[]} [options.pageIds] Publish only these pages. Absent/empty = all pending.
 */
async function publishPages(projectId, options = {}) {
  const id = String(projectId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'projectId is required' };

  const pendingResult = await listPendingPublish(id);
  if (!pendingResult.ok) return pendingResult;

  const pending = selectPagesToPublish(pendingResult.data, options.pageIds);

  const buildId = safeText(options.buildId, 120) || newBuildId();
  const limit = Math.max(1, Math.min(Number(options.limit) || PUBLISH_BATCH_SIZE, 50));
  const batch = pending.slice(0, limit);

  if (!batch.length) {
    return {
      ok: true,
      status: 200,
      data: { buildId, published: 0, remaining: 0, total: pendingResult.total, done: true, pages: [] },
    };
  }

  const rows = await Promise.all(batch.map(async (page) => scopedInsertRow(table(), {
    page_id: Number(page.id) || 0,
    slug: safeText(page.slug, 160),
    payload: JSON.stringify(page),
    source_updated_at: publishSourceStamp(page) || null,
    build_id: buildId,
    published_at: new Date().toISOString(),
  }, { projectId: id, userId: '' })));

  // Upsert on page_id: one build per page, replaced each publish.
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'on_conflict=page_id',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: rows,
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 500,
      error:
        'Could not write the published pages. Run ' +
        'docs/SQL/develop_builder_published_pages_setup.sql in Supabase.',
      code: 'PUBLISH_TABLE_MISSING',
    };
  }

  const remaining = Math.max(0, pending.length - batch.length);
  return {
    ok: true,
    status: 200,
    data: {
      buildId,
      published: batch.length,
      remaining,
      total: pendingResult.total,
      done: remaining === 0,
      pages: batch.map((p) => ({ id: String(p.id), slug: String(p.slug ?? '') })),
    },
  };
}

/**
 * Throw away the snapshot for one page.
 *
 * NOTHING USED TO DO THIS, AND THAT WAS THE BUG.
 * A snapshot was written on publish and then lived forever. Delete the page,
 * unpublish it, mark it private, or change its address, and the old snapshot
 * stayed in the table still claiming the address it was photographed at. The
 * read has since been keyed on page id (lib/publishedPageRead.js), so an
 * orphan can no longer be served BY MISTAKE. What is left is garbage: a
 * deleted page's entire content, sitting in a table nothing will ever read
 * again and nothing can ever clean up, because the page it belonged to is gone
 * and its id is the only handle on it.
 *
 * SCOPE, DELIBERATELY: this is called on delete only. Unpublishing a page or
 * marking it private also leaves its snapshot behind, and that snapshot is
 * already unreachable — `resolvePublicPageIdForSlug` will not resolve an
 * address to an unpublished or private page, so it cannot be served. Deleting
 * it too would mean a page taken private and put back serves its DRAFT until
 * the next publish, which is a change to what publishing promises and not
 * something to slip in alongside a bug fix. Filed separately.
 *
 * Best-effort by design: a page delete that already succeeded must not be
 * reported as failed because the snapshot cleanup could not run. It returns
 * what happened so a caller that wants to log it can, and no caller has to.
 */
async function removeBuildForPage(projectId, pageIdInput) {
  const id = String(projectId || '').trim();
  const pageId = Number(pageIdInput || 0) || 0;
  if (!id || !pageId) return { ok: false, status: 400, error: 'projectId and pageId are required' };

  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `project_id=eq.${encodeURIComponent(id)}&page_id=eq.${pageId}`,
    headers: { Prefer: 'return=minimal' },
  });
  if (!res.ok) return { ok: false, status: res.status || 500, error: 'Could not remove the published snapshot' };
  return { ok: true, status: 200 };
}

/** How much of this project is unpublished. Cheap enough for a UI badge. */
async function getPublishStatus(projectId) {
  const pendingResult = await listPendingPublish(projectId);
  if (!pendingResult.ok) return pendingResult;
  return {
    ok: true,
    status: 200,
    data: {
      pending: pendingResult.data.length,
      total: pendingResult.total,
      pages: pendingResult.data.slice(0, 50).map((p) => ({ id: String(p.id), slug: String(p.slug ?? ''), name: String(p.name ?? '') })),
    },
  };
}

module.exports = {
  PUBLISH_BATCH_SIZE,
  publishPages,
  removeBuildForPage,
  listPendingPublish,
  listBuildsForProject,
  selectPagesToPublish,
  getPublishStatus,
  // Exported for scripts/builder/themeSavePublish.test.js: the two-clock rule
  // is what makes a theme save reach the Publish panel, and driving the real
  // thing needs a database.
  publishSourceStamp,
  isPagePendingPublish,
};
