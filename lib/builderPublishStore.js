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

  const pending = pagesResult.data.filter((page) => {
    const build = built.get(String(page.id));
    if (!build) return true; // never published
    const draftAt = Date.parse(String(page.updatedAt || '')) || 0;
    const builtAt = Date.parse(String(build.sourceUpdatedAt || '')) || 0;
    return draftAt > builtAt;
  });

  pending.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { ok: true, status: 200, data: pending, total: pagesResult.data.length };
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
 * Build one batch. Returns what it wrote and what is still outstanding, so the
 * caller can keep going without holding any state of its own.
 *
 * @param {string} projectId
 * @param {object} [options]
 * @param {string} [options.buildId]  Continue an existing publish rather than starting one.
 * @param {number} [options.limit]    Pages this call may write.
 */
async function publishPages(projectId, options = {}) {
  const id = String(projectId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'projectId is required' };

  const pendingResult = await listPendingPublish(id);
  if (!pendingResult.ok) return pendingResult;

  const buildId = safeText(options.buildId, 120) || newBuildId();
  const limit = Math.max(1, Math.min(Number(options.limit) || PUBLISH_BATCH_SIZE, 50));
  const batch = pendingResult.data.slice(0, limit);

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
    source_updated_at: page.updatedAt || null,
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

  const remaining = Math.max(0, pendingResult.data.length - batch.length);
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
  listPendingPublish,
  listBuildsForProject,
  getPublishStatus,
};
