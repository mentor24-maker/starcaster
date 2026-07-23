'use strict';

/**
 * Asset usage index — "where is this image actually used?"
 *
 * Walks every Builder page in the active project and records which asset URLs
 * appear in it, so the Assets screen can show a "Used In" count per image and
 * list the pages behind it.
 *
 * The walk is deliberately generic: rather than enumerating every settings key
 * that can hold an image (module image URLs, section backgrounds, page
 * backgrounds, theme shells, HTML embedded in text modules...), it recurses the
 * whole page document and treats any http(s) string that looks like a file as a
 * reference. New module types that carry images are therefore picked up without
 * touching this file.
 */

const { listPages } = require('./builderPagesStore');
const { listAssets, rowToAsset } = require('./assetsStore');

/** Extensions we treat as "this string is an image/media reference". */
const MEDIA_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i;

/** URLs embedded inside HTML strings: <img src="..."> and CSS url(...). */
const EMBEDDED_URL_RE = /(?:src\s*=\s*["']|url\(\s*["']?)(https?:\/\/[^"')\s]+)/gi;

/**
 * Normalize a URL into a comparison key: host (lowercased) + path, with the
 * protocol, query string and hash removed. Two references to the same blob
 * survive a protocol change or an appended cache-buster and still match.
 * The path keeps its original case — blob storage paths are case-sensitive.
 */
function urlKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(?:https?:)?\/\/([^/?#]+)([^?#]*)/i);
  if (match) return `${match[1].toLowerCase()}${match[2]}`;
  return raw.split(/[?#]/)[0];
}

function looksLikeMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return false;
  if (!/^(?:https?:)?\/\//i.test(raw)) return false;
  return MEDIA_EXT_RE.test(raw.split(/[?#]/)[0]);
}

function safeLabel(value, max = 80) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Recurse `node`, adding every media URL found to `out` as `key -> where`.
 * `where` is a human label describing the spot on the page.
 */
function scan(node, where, out, depth = 0) {
  if (node == null || depth > 12) return;

  if (typeof node === 'string') {
    if (looksLikeMediaUrl(node)) out.push({ key: urlKey(node), url: node.trim(), where });
    // Text modules hold HTML; pull <img src> / url() out of it too.
    if (node.includes('://') && /[<(]/.test(node)) {
      for (const match of node.matchAll(EMBEDDED_URL_RE)) {
        if (looksLikeMediaUrl(match[1])) out.push({ key: urlKey(match[1]), url: match[1], where });
      }
    }
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) scan(item, where, out, depth + 1);
    return;
  }

  if (typeof node === 'object') {
    for (const value of Object.values(node)) scan(value, where, out, depth + 1);
  }
}

function sectionLabel(section, index) {
  return safeLabel(section?.title || section?.name || '') || `Section ${index + 1}`;
}

function moduleLabel(module) {
  const name = safeLabel(module?.name || '');
  const type = safeLabel(module?.type || 'module', 40);
  return name ? `${name} (${type})` : `${type} module`;
}

/** Collect `{ key, url, where }` hits for one page. */
function collectPageHits(page) {
  const hits = [];
  const sections = Array.isArray(page?.layoutSections) ? page.layoutSections : [];

  sections.forEach((section, index) => {
    if (!section || typeof section !== 'object') return;
    const label = sectionLabel(section, index);
    // Everything on the section itself (background, styling) minus the modules,
    // which get their own, more specific label below.
    const { modules, ...sectionShell } = section;
    scan(sectionShell, `${label} — section background`, hits);
    if (Array.isArray(modules)) {
      for (const module of modules) scan(module, `${label} › ${moduleLabel(module)}`, hits);
    }
  });

  scan(page?.pageBackground, 'Page background', hits);
  scan(page?.theme, 'Page theme', hits);
  return hits;
}

/**
 * Build the usage index for a project.
 *
 * @returns {Promise<{ ok: true, data: { usage: object, unmatched: Array, pagesScanned: number } }>}
 *   `usage` is keyed by asset id: `{ count, pages: [{ pageId, pageName, slug,
 *   isPublished, places: string[] }] }` where `count` is the number of distinct
 *   pages the asset appears on. `unmatched` lists image URLs used on pages that
 *   have no matching row in the asset library.
 */
async function collectAssetUsage(scope = null) {
  const [pagesResult, assetsResult] = await Promise.all([
    listPages(5000, scope),
    listAssets(scope),
  ]);
  if (!pagesResult.ok) return pagesResult;
  if (!assetsResult.ok) return assetsResult;

  // asset location -> asset id. Later rows do not clobber earlier ones, so the
  // first asset registered for a URL wins if two rows share a location.
  const assetIdByKey = new Map();
  for (const row of Array.isArray(assetsResult.data) ? assetsResult.data : []) {
    const asset = rowToAsset(row);
    const key = urlKey(asset?.location);
    if (key && !assetIdByKey.has(key)) assetIdByKey.set(key, String(asset.id));
  }

  const pages = Array.isArray(pagesResult.data) ? pagesResult.data : [];
  const usage = {};
  const unmatched = new Map();

  for (const page of pages) {
    const hits = collectPageHits(page);
    if (!hits.length) continue;

    // Collapse repeats within this page: one entry per asset, with the distinct
    // spots it was found in.
    const placesByKey = new Map();
    for (const hit of hits) {
      if (!hit.key) continue;
      if (!placesByKey.has(hit.key)) placesByKey.set(hit.key, { url: hit.url, places: new Set() });
      placesByKey.get(hit.key).places.add(hit.where);
    }

    for (const [key, entry] of placesByKey) {
      const assetId = assetIdByKey.get(key);
      if (!assetId) {
        if (!unmatched.has(key)) unmatched.set(key, { url: entry.url, pages: 0 });
        unmatched.get(key).pages += 1;
        continue;
      }
      if (!usage[assetId]) usage[assetId] = { count: 0, pages: [] };
      usage[assetId].count += 1;
      usage[assetId].pages.push({
        pageId: String(page.id || ''),
        pageName: safeLabel(page.name || '', 160) || `Page ${page.id}`,
        slug: String(page.slug || ''),
        isPublished: page.isPublished !== false,
        places: Array.from(entry.places).slice(0, 12),
      });
    }
  }

  for (const entry of Object.values(usage)) {
    entry.pages.sort((a, b) => a.pageName.localeCompare(b.pageName));
  }

  return {
    ok: true,
    status: 200,
    data: {
      usage,
      unmatched: Array.from(unmatched.values()).sort((a, b) => b.pages - a.pages),
      pagesScanned: pages.length,
    },
  };
}

module.exports = { collectAssetUsage, urlKey };
