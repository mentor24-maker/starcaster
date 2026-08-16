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
 * The built page at this address, or null.
 *
 * Returns null on ANY failure — a missing table, an unreadable row, malformed
 * payload — because the caller's fallback is "serve the draft", which is the
 * behaviour that already works. A publish table that is broken must degrade to
 * today's site, never to no site.
 */
async function getPublishedPage(projectId, slugInput) {
  const id = String(projectId || '').trim();
  if (!id) return null;

  // Same address rules the draft path uses: '' and 'home' are both the root,
  // matching ignores case and surrounding slashes. If these two ever disagree,
  // publishing a site would silently move its pages.
  const wanted = String(slugInput ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  const candidates = wanted === '' || wanted === 'home' ? ['', 'home'] : [wanted];

  try {
    const inList = candidates.map((s) => `"${s}"`).join(',');
    const res = await sbQuery({
      method: 'GET',
      table: table(),
      query:
        `select=page_id,slug,payload,published_at` +
        `&project_id=eq.${encodeURIComponent(id)}` +
        `&slug=in.(${encodeURIComponent(inList)})&limit=5`,
    });
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return null;

    // Root: an empty slug wins over a page literally slugged "home", matching
    // the draft picker.
    const rows = res.data;
    const row =
      candidates.length > 1
        ? (rows.find((r) => String(r.slug ?? '') === '') ?? rows.find((r) => String(r.slug ?? '').toLowerCase() === 'home') ?? null)
        : (rows.find((r) => String(r.slug ?? '').toLowerCase() === wanted) ?? null);
    if (!row) return null;

    let payload = row.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { return null; }
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { getPublishedPage };
