'use strict';

/**
 * Blog bulk-import: recover discarded Builder pages as blog posts
 * (docs/BLOG_BULK_IMPORT_HANDOFF.md, ticket 86bbtuh3y).
 *
 * The source is orphaned rows in builder_published_pages — snapshots whose
 * page no longer exists in builder_landing_page. They are the ONLY copy of
 * the content (the pages were deleted), so nothing in this file ever writes
 * to that table; it reads snapshots and creates blog_posts drafts.
 *
 * Batch, do not loop: importPosts takes at most IMPORT_BATCH_SIZE ids per
 * call and the client loops — a long loop inside a serverless function is
 * cut off when the response goes out (lib/builderPublishStore.js header;
 * propagateCanonicalSection lost 20 of 50 pages that way on 2026-07-22).
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery } = require('./projectScope');
const { buildCandidate } = require('./blogImportExtract');
const { slugify } = require('./slugify');
const { listPosts, getPostBySlug, createPost } = require('./blogPostsStore');

const IMPORT_BATCH_SIZE = 10;

function snapshotsTable() { return tableConfig().builderPublishedPages; }
function pagesTable() { return tableConfig().builderPages; }

function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Two of the orphans differ from their live twins by one word in the title
 * (handoff §5), so equality alone misses them: compare the first six
 * normalized words in both directions.
 */
function titlesLookAlike(a, b) {
  const wordsA = normalizeTitle(a).split(' ').filter(Boolean);
  const wordsB = normalizeTitle(b).split(' ').filter(Boolean);
  if (!wordsA.length || !wordsB.length) return false;
  const len = Math.min(6, wordsA.length, wordsB.length);
  if (len < 3) return wordsA.join(' ') === wordsB.join(' ');
  return wordsA.slice(0, len).join(' ') === wordsB.slice(0, len).join(' ');
}

/**
 * The address this candidate will actually be created at.
 *
 * The picker's preview screen shows this line ("Address: …") and the operator
 * approves the import on the strength of it, so it has to be the same value
 * the write produces — normalized here rather than only inside the store, or
 * the preview and the row could disagree. A snapshot with no slug of its own
 * falls back to the recovered title instead of a blank, which is an address
 * nothing can reach.
 */
function intendedSlugFor(candidate) {
  return { ...candidate, slug: slugify(candidate.slug) || slugify(candidate.title) };
}

/**
 * Orphaned snapshots for a project: published-page rows whose page_id has no
 * row in builder_landing_page. The snapshot table is keyed on page_id — that
 * is the handle, never the slug (PR #532).
 */
async function listOrphanSnapshots(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'projectId is required' };

  const liveRes = await sbQuery({
    method: 'GET',
    table: pagesTable(),
    query: await scopedListQuery(pagesTable(), 'select=id&limit=5000', { projectId: id }),
  });
  if (!liveRes.ok) return { ok: false, status: liveRes.status || 500, error: 'Could not read the live page list' };
  const liveIds = new Set((Array.isArray(liveRes.data) ? liveRes.data : []).map((r) => String(r.id)));

  const snapRes = await sbQuery({
    method: 'GET',
    table: snapshotsTable(),
    query:
      'select=id,page_id,slug,payload,published_at' +
      `&project_id=eq.${encodeURIComponent(id)}&limit=5000`,
  });
  if (!snapRes.ok) return { ok: false, status: snapRes.status || 500, error: 'Could not read the published snapshots' };

  const orphans = (Array.isArray(snapRes.data) ? snapRes.data : [])
    .filter((row) => !liveIds.has(String(row.page_id)));
  return { ok: true, status: 200, data: orphans };
}

/**
 * Every orphan as an import candidate, with its extracted fields and the
 * flags the picker needs: already imported (a post with this slug exists) and
 * may-duplicate (an existing post's title looks like this one's).
 */
async function listImportCandidates(scope) {
  const projectId = String(scope?.projectId || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const orphansRes = await listOrphanSnapshots(projectId);
  if (!orphansRes.ok) return orphansRes;

  const existing = await listPosts({ limit: 100 }, scope);
  const existingSlugs = new Map(existing.map((p) => [String(p.slug || ''), p]));

  const candidates = orphansRes.data.map((row) => {
    const candidate = intendedSlugFor(buildCandidate(row));
    const slugMatch = candidate.slug ? existingSlugs.get(candidate.slug) : null;
    const twin = slugMatch
      || existing.find((p) => titlesLookAlike(p.title, candidate.title))
      || null;
    return {
      ...candidate,
      alreadyImported: Boolean(slugMatch),
      maybeDuplicateOf: twin && !slugMatch ? String(twin.title || '') : '',
    };
  });

  // Probable posts first, newest first; the undated sink to the bottom of
  // their group; "probably not a post" trails the list, never hidden.
  candidates.sort((a, b) => {
    if (a.looksLikePost !== b.looksLikePost) return a.looksLikePost ? -1 : 1;
    return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
  });

  return { ok: true, status: 200, data: candidates };
}

/**
 * Create draft posts from the chosen orphans. Fields are re-extracted from
 * the snapshot rows here — the request carries only page ids, so what gets
 * written is what the candidates endpoint showed, not what a client sent.
 *
 * Idempotent by slug: a candidate whose slug already names a post in this
 * project is skipped and says so. Everything lands as a draft — Dane
 * publishes after reading (handoff §2).
 */
async function importPosts({ pageIds, defaultAuthor } = {}, scope) {
  const projectId = String(scope?.projectId || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const ids = (Array.isArray(pageIds) ? pageIds : []).map((v) => String(v || '').trim()).filter(Boolean);
  if (!ids.length) return { ok: false, status: 400, error: 'pageIds is required' };
  if (ids.length > IMPORT_BATCH_SIZE) {
    return { ok: false, status: 400, error: `At most ${IMPORT_BATCH_SIZE} pages per call — send the rest in the next batch` };
  }

  const orphansRes = await listOrphanSnapshots(projectId);
  if (!orphansRes.ok) return orphansRes;
  const byPageId = new Map(orphansRes.data.map((row) => [String(row.page_id), row]));

  const fallbackAuthor = String(defaultAuthor || '').trim();
  const results = [];
  for (const pageId of ids) {
    const row = byPageId.get(pageId);
    if (!row) {
      results.push({ pageId, ok: false, reason: 'No discarded page with this id' });
      continue;
    }
    const candidate = intendedSlugFor(buildCandidate(row));
    if (!candidate.title) {
      results.push({ pageId, ok: false, reason: 'No title could be recovered' });
      continue;
    }
    if (candidate.slug && await getPostBySlug(candidate.slug, scope)) {
      results.push({ pageId, ok: false, skipped: true, reason: `A post with the address "${candidate.slug}" already exists` });
      continue;
    }

    const created = await createPost({
      title: candidate.title,
      slug: candidate.slug,
      status: 'draft',
      author: candidate.authorFound ? candidate.author : fallbackAuthor,
      featuredImageUrl: candidate.featuredImageUrl,
      excerpt: candidate.excerpt,
      body: candidate.body,
      // The tags the original WordPress post carried. An untagged source
      // writes [], which is what the column already defaults to.
      tags: candidate.tags,
      // No date in the source stays blank (operator's call, 2026-09-02);
      // publishedAt on a draft is kept and takes effect when published.
      publishedAt: candidate.dateFound ? candidate.publishedAt : null,
    }, scope);

    if (!created) {
      results.push({ pageId, ok: false, reason: 'The post could not be created' });
      continue;
    }
    // Read-back, not trust: a scoping gap writes rows with no tenant and the
    // insert still reports success (CLAUDE.md landmine 12).
    if (String(created.projectId || '') !== projectId) {
      results.push({ pageId, ok: false, postId: created.id, reason: 'Created, but the post did not land in this project — tell an agent session before importing more' });
      continue;
    }
    // Same read-back discipline for the tags: a column the insert silently
    // dropped would otherwise show up only as a post that lost its taxonomy.
    const storedTags = Array.isArray(created.tags) ? created.tags : [];
    const tagsLost = candidate.tags.length > 0 && storedTags.length === 0;
    results.push({
      pageId,
      ok: true,
      postId: created.id,
      slug: created.slug,
      title: created.title,
      tags: storedTags,
      ...(tagsLost ? { warning: `Imported, but its ${candidate.tags.length} tags did not save` } : {}),
    });
  }

  return {
    ok: true,
    status: 200,
    data: {
      created: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      results,
    },
  };
}

module.exports = {
  IMPORT_BATCH_SIZE,
  intendedSlugFor,
  listOrphanSnapshots,
  listImportCandidates,
  importPosts,
  titlesLookAlike,
};
