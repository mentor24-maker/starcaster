'use strict';

/**
 * The image-URL → scaled-copies map a live site needs.
 *
 * A public page holds image URLs, never asset ids, so the browser cannot look
 * up what copies exist. This builds the small lookup table that
 * `GET /api/public/pages` ships alongside the pages, which
 * `lib/builder-client/image-renditions.ts` then registers.
 *
 * Only images the returned pages actually reference are included. Sending the
 * whole library would add roughly 100 KB to every page load to describe
 * pictures that page never shows.
 *
 * This is an optimisation on a path that must not break. Every failure — the
 * migration not run yet, the database unreachable, a malformed row — returns an
 * empty map, and the site renders its images exactly as it did before.
 */

const { sbQuery, tableConfig } = require('./supabase');

// Named columns rather than `select=*`: three rows in this table hold multi-MB
// base64 payloads in `location` and a full select times out (see
// scripts/generate_asset_renditions.js).
const COLUMNS = 'location,renditions';

function serializeForSearch(pages) {
  try {
    return JSON.stringify(pages || []);
  } catch {
    return '';
  }
}

/**
 * `location` values are stored as absolute URLs but a page may reference the
 * same file through a proxy path, so match on the distinctive tail of the URL
 * rather than the whole thing.
 */
function referenceNeedle(location) {
  const text = String(location || '').trim();
  if (!text) return '';
  const withoutQuery = text.split(/[?#]/)[0];
  const lastSegment = withoutQuery.split('/').filter(Boolean).pop() || '';
  return lastSegment || withoutQuery;
}

async function buildRenditionMapForPages(projectId, pages) {
  const scopedProjectId = String(projectId || '').trim();
  if (!scopedProjectId) return {};

  const haystack = serializeForSearch(pages);
  if (!haystack) return {};

  let res;
  try {
    res = await sbQuery({
      table: tableConfig().assets,
      query:
        `select=${COLUMNS}&asset_type=eq.Image&project_id=eq.${encodeURIComponent(scopedProjectId)}` +
        `&renditions=neq.[]&limit=5000`,
    });
  } catch {
    return {};
  }
  if (!res || !res.ok || !Array.isArray(res.data)) return {};

  const { normalizeRenditions } = require('./assetsStore');
  const map = {};

  for (const row of res.data) {
    const location = String((row && row.location) || '').trim();
    if (!location) continue;

    const renditions = normalizeRenditions(row.renditions);
    if (renditions.length < 2) continue;

    const needle = referenceNeedle(location);
    if (!needle || !haystack.includes(needle)) continue;

    // Trimmed to what the browser needs to choose a file. `bytes` is useful
    // when auditing the library and pure weight on the wire.
    map[location] = renditions.map((item) => {
      const entry = { w: item.w, h: item.h, url: item.url, format: item.format };
      if (item.role) entry.role = item.role;
      return entry;
    });
  }

  return map;
}

module.exports = {
  buildRenditionMapForPages,
  referenceNeedle,
};
