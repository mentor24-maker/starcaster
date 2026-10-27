'use strict';

/**
 * Which published pages use a font? (Font Library 6/7, task 86bchyd4p.)
 *
 * Pure: no database, no request. lib/fontUsageStore.js gathers the pages and
 * hands them here; routes/fonts.js serves GET /api/fonts/:id/usage from it.
 *
 * A FONT IS NAMED TWO WAYS. A font slot stores a library font as
 * "lf:<slug>" (lib/builder-client/builder-library-fonts.ts) and a Google font
 * as "gf:<Family>" (builder-google-fonts.ts). Orbitron picked from Google
 * before it was in the library is still Orbitron on the page, so both count.
 *
 * WHERE IT CAN BE NAMED. A theme's font slots (typography.fonts.heading /
 * body / mono, and the per-element styles), a module's fontFamily, a heading
 * font setting — every one stores the same key string. So, like the renderer's
 * own collectLibraryFontSlugs, this walks the whole value instead of listing
 * paths: a font setting added next month is found without touching this file.
 *
 * PAGES, NOT COPIES (CLAUDE.md landmine 17). A page naming the font in two
 * modules, or in a module AND through its theme, is one page.
 */

const LIBRARY_PREFIX = 'lf:';
const GOOGLE_PREFIX = 'gf:';
const MAX_DEPTH = 40;

/**
 * Across every Starcaster site, or only the asking project's own?
 *
 * Every site, because the pages listed are public websites anyway and the
 * point of the column is "go and look at it on a real site". To list only the
 * project's own pages instead, change this one line to `false`.
 */
const USAGE_ACROSS_ALL_SITES = true;

/**
 * The projects whose pages may be listed for this font, or null for "every
 * project". A project's own upload can only be on that project's pages — no
 * other project can load it — so it is never searched for anywhere else.
 */
function usageProjectIds(font, requesterProjectId) {
  if (font?.visibility === 'project') return [String(font.projectId || '')].filter(Boolean);
  if (!USAGE_ACROSS_ALL_SITES) return [String(requesterProjectId || '')].filter(Boolean);
  return null;
}

/** The two keys a page can name this font by: "lf:orbitron" and "gf:Orbitron". */
function fontUsageKeys(font) {
  const slug = String(font?.slug || '').trim();
  const family = String(font?.family || '').trim();
  return {
    library: slug ? `${LIBRARY_PREFIX}${slug}` : '',
    google: family ? `${GOOGLE_PREFIX}${family}`.toLowerCase() : '',
  };
}

/**
 * Does this value name the font anywhere inside it? `libraryCounts` is false
 * for a project that has its own upload under the same slug: there "lf:<slug>"
 * loads THAT font, not this one (lib/fontsStore.js listPublicFontsBySlugs).
 */
function namesFont(value, keys, libraryCounts = true) {
  const seen = new Set();
  const walk = (node, depth) => {
    if (depth > MAX_DEPTH) return false;
    if (typeof node === 'string') {
      const text = node.trim();
      if (libraryCounts && keys.library && text === keys.library) return true;
      return Boolean(keys.google) && text.length === keys.google.length && text.toLowerCase() === keys.google;
    }
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    const children = Array.isArray(node) ? node : Object.values(node);
    return children.some((child) => walk(child, depth + 1));
  };
  return walk(value, 0);
}

function siteBaseUrl(domain) {
  const host = String(domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return host ? `https://${host}` : '';
}

/** A page's live address on its site's own domain; '' when the site has none. */
function pageLiveUrl(domain, slug) {
  const base = siteBaseUrl(domain);
  if (!base) return '';
  const clean = String(slug || '').trim().replace(/^\/+|\/+$/g, '');
  if (!clean || clean.toLowerCase() === 'home') return `${base}/`;
  return `${base}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * @param {object} input
 * @param {{ slug, family }} input.font
 * @param {Array<{ id, projectId, name, slug, layoutSections, themeTypography }>} input.pages
 *   Public pages only (the store filters drafts and private pages).
 *   `themeTypography` is the typography of the theme this page renders with.
 * @param {Map<string, object>} [input.builds]  pageId → published snapshot. A
 *   page with a build is served the build, so the build is what is searched.
 * @param {Map<string, { name, domain }>} [input.projects]
 * @param {Set<string>} [input.libraryShadowedIn]  projects whose own upload
 *   has this font's slug.
 * @returns {{ sites: Array<{ projectId, name, url, pages: Array<{ id, name, slug, url }> }>, totalPages: number }}
 */
function findFontUsage({ font, pages, builds, projects, libraryShadowedIn } = {}) {
  const keys = fontUsageKeys(font);
  const builtPages = builds instanceof Map ? builds : new Map();
  const projectInfo = projects instanceof Map ? projects : new Map();
  const shadowed = libraryShadowedIn instanceof Set ? libraryShadowedIn : new Set();
  const bySite = new Map();
  const counted = new Set();

  for (const page of Array.isArray(pages) ? pages : []) {
    const pageId = String(page?.id ?? '');
    const projectId = String(page?.projectId ?? '');
    if (!pageId || counted.has(pageId)) continue;
    const libraryCounts = !shadowed.has(projectId);
    const build = builtPages.get(pageId);
    const content = build ? [build] : [page.layoutSections, page.themeTypography];
    if (!namesFont(content, keys, libraryCounts)) continue;
    counted.add(pageId);

    if (!bySite.has(projectId)) {
      const project = projectInfo.get(projectId) || {};
      bySite.set(projectId, {
        projectId,
        name: String(project.name || '').trim() || 'Unnamed site',
        url: siteBaseUrl(project.domain),
        pages: [],
      });
    }
    const site = bySite.get(projectId);
    const projectDomain = (projectInfo.get(projectId) || {}).domain;
    site.pages.push({
      id: pageId,
      name: String(page.name || '').trim() || String(page.slug || '').trim() || 'Untitled page',
      slug: String(page.slug || ''),
      url: pageLiveUrl(projectDomain, page.slug),
    });
  }

  const sites = Array.from(bySite.values())
    .map((site) => ({ ...site, pages: site.pages.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { sites, totalPages: counted.size };
}

module.exports = {
  USAGE_ACROSS_ALL_SITES,
  usageProjectIds,
  fontUsageKeys,
  namesFont,
  pageLiveUrl,
  findFontUsage,
};
