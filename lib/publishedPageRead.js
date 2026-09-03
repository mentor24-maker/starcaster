'use strict';

/**
 * What a visitor is served: the build if there is one, the draft if not.
 *
 * THE FALLBACK IS THE WHOLE SAFETY STORY
 * A page that has never been published has no build, and is served exactly as
 * it is today — resolved from the draft on the way out. So this ships inert:
 * until somebody presses Publish, every site behaves precisely as it did
 * before, and the change cannot be the reason a page stops rendering.
 *
 * It also means publishing can be adopted one project at a time, and a publish
 * interrupted half way leaves a site that is part built and part live-resolved,
 * both of which render. There is no state in which a page has nothing to serve.
 *
 * Writes: lib/builderPublishStore.js.
 */

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().builderPublishedPages;
}

/**
 * The snapshot for ONE page id, or null.
 *
 * It takes a page id, not an address, and that is the whole fix. The published
 * table is keyed on `page_id` when it is written (`on_conflict=page_id`) but
 * used to be searched by `slug` when it was read — two different keys, with no
 * uniqueness tying them together, so an address could match more than one row
 * and the winner was whatever order Postgres happened to return. On 2026-09-02
 * that served Delray's `/pickleball-videos` from an abandoned page for hours
 * while the real page's header was edited and republished to no effect.
 *
 * Who owns an address is the drafts table's question
 * (`resolvePublicPageIdForSlug`). This one only answers "what did page N look
 * like when it was photographed". An orphan snapshot left behind by a deleted
 * or renamed page is now unreachable rather than merely unlikely — the whole
 * reason to key the read on the same column the write keys on.
 *
 * Returns null on ANY failure — a missing table, an unreadable row, malformed
 * payload — because the caller's fallback is "serve the draft", which is the
 * behaviour that already works. A publish table that is broken must degrade to
 * today's site, never to no site.
 */
async function getPublishedPageById(projectId, pageIdInput) {
  const id = String(projectId || '').trim();
  const pageId = String(pageIdInput ?? '').trim();
  if (!id || !pageId) return null;

  try {
    const res = await sbQuery({
      method: 'GET',
      table: table(),
      query:
        `select=page_id,slug,payload,published_at`
        + `&project_id=eq.${encodeURIComponent(id)}`
        + `&page_id=eq.${encodeURIComponent(pageId)}&limit=1`,
    });
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return null;

    let payload = res.data[0].payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { return null; }
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

/**
 * The built page at this address, or null.
 *
 * Address → page id → snapshot, in that order, never address → snapshot. The
 * address rules are not reimplemented here: `resolvePublicPageIdForSlug` uses
 * the same `pickPageForAddress` the draft path uses, so the two cannot answer
 * differently for one address. They used to, and lib/publicSitePageAddress.js
 * records what it cost.
 */
async function getPublishedPage(projectId, slugInput) {
  const id = String(projectId || '').trim();
  if (!id) return null;

  try {
    const { resolvePublicPageIdForSlug } = require('./builderPagesStore');
    const pageId = await resolvePublicPageIdForSlug(id, slugInput);
    if (!pageId) return null;
    return await getPublishedPageById(id, pageId);
  } catch (_) {
    return null;
  }
}

module.exports = { getPublishedPage, getPublishedPageById };
