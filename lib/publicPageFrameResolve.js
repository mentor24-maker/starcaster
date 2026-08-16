'use strict';

/**
 * Resolve every page's frame from the live saved section, on the way out.
 *
 * WHAT THIS REMOVES
 * A page stores its header as a canonical INSTANCE: savedSectionId, plus a
 * full copy of the master's content. Keeping those copies in step is
 * propagateCanonicalSection's job -- it walks every page carrying that
 * savedSectionId and rewrites each one. Two incidents came out of that loop:
 *
 *   2026-07-21  a single master save silently rewrote 46 Marinoff pages,
 *               with no preview and no undo.
 *   2026-07-22  the same loop was killed part-way by the serverless function
 *               freezing after the response went out: 30 pages updated, 20
 *               left stale, and a different split every save. It surfaced as
 *               "the footer won't save".
 *
 * Resolving here means the PUBLIC SITE never depends on that loop having
 * finished. Whatever the master says right now is what a visitor sees, even
 * if every stored copy on every page is stale. The 07-22 failure mode stops
 * being able to reach a visitor at all.
 *
 * WHAT THIS DOES NOT DO
 * It does not stop the copies being written, and does not retire propagation
 * -- the Builder canvas still reads the stored copy, so the loop still has a
 * job until the editor resolves too. This is deliberately the half that only
 * touches what visitors are served.
 *
 * SAFETY
 * Best-effort in both directions. A page whose master cannot be found keeps
 * the copy it already had, which is exactly today's behaviour, so a missing
 * or unreadable saved-sections table degrades to the current site rather than
 * to a site with no headers. Nothing here can make a page fail to load.
 */

// lib/builder/template-frame.js is generated from builder-template-frame.ts by
// `npm run build:builder-template` (PR #252 added it). Requiring it is how the
// server shares the browser's resolver rather than keeping a second copy of the
// rule in CommonJS. Landmine 1 applies.
const { resolveFrameSection, isFrameSection } = require('./builder/template-frame');

/**
 * @param {Array<object>} pages   pages as rowToPage returns them
 * @param {Array<object>} savedSections  {id, name, section} masters
 * @returns {{pages: Array<object>, resolved: number, unresolved: number}}
 */
function resolvePagesFrameSections(pages, savedSections) {
  const list = Array.isArray(pages) ? pages : [];
  const masters = Array.isArray(savedSections) ? savedSections : [];
  if (!list.length || !masters.length) {
    return { pages: list, resolved: 0, unresolved: 0 };
  }

  let resolved = 0;
  let unresolved = 0;

  const nextPages = list.map((page) => {
    const sections = Array.isArray(page?.layoutSections) ? page.layoutSections : null;
    if (!sections || !sections.some(isFrameSection)) return page;

    let changed = false;
    const nextSections = sections.map((section) => {
      if (!isFrameSection(section)) return section;

      // Look the master up first. resolveFrameSection deliberately falls back
      // to the stored copy when it cannot find one, so its return value alone
      // cannot tell "served the master" from "kept the old copy" — and on a
      // live site that distinction is the whole point of the counts.
      const hasMaster = masters.some((m) => m && m.id === section.savedSectionId && m.section);
      if (!hasMaster) {
        // Master deleted or not loaded. Keep what the page has rather than
        // dropping a band out of a live site — stale beats missing.
        unresolved += 1;
        return section;
      }

      // The instance's own id is preserved, so anchors and per-page section
      // styling keyed on it keep working.
      const live = resolveFrameSection(section, masters, () => String(section?.id || ''));
      if (!live) {
        unresolved += 1;
        return section;
      }
      resolved += 1;
      changed = true;
      return live;
    });

    return changed ? { ...page, layoutSections: nextSections } : page;
  });

  return { pages: nextPages, resolved, unresolved };
}

/**
 * Load the project's masters and resolve. Swallows its own failures: the
 * caller is on a page-load path and a stale header is never worth a 500.
 */
async function resolvePagesFrameSectionsForProject(pages, projectId) {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) return list;

  try {
    const { listSavedSections } = require('./builderSavedSectionsStore');
    const result = await listSavedSections(5000, { projectId: String(projectId || ''), userId: '' });
    if (!result?.ok || !Array.isArray(result.data) || !result.data.length) return list;
    return resolvePagesFrameSections(list, result.data).pages;
  } catch (_) {
    return list;
  }
}

module.exports = {
  resolvePagesFrameSections,
  resolvePagesFrameSectionsForProject,
};
