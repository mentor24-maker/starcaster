'use strict';

/**
 * The CURRENT address of every page a served page links to by reference.
 *
 * A page setting that picks one of the site's pages stores the page's id
 * (lib/builder-client/page-link.js — `page:<id>|<fallback>`), not a copy of
 * its address, so renaming a page cannot break the links to it (task
 * 86bcxmrw2). Something has to turn that id back into an address when the
 * page is served, and it has to be the address as it is NOW. This answers
 * `{ [pageId]: slug }` for exactly the ids the served pages mention — one
 * small query, nothing when they mention none — and the renderer resolves
 * each reference through the same rule the Builder preview uses.
 *
 * Addresses come from the drafts table, which is the authority on what an
 * address means (lib/publishedPageRead.js defers to it the same way).
 *
 * Returns null when the lookup itself failed. The renderer then uses each
 * link's saved fallback address — exactly what it would have shown before
 * this existed — and a database blip never reads as "the page was deleted".
 */

const { sbQuery, tableConfig } = require('./supabase');
const { addSectionAnchors, collectPageLinkIds, mentionsSectionLink } = require('./builder-client/page-link');

/** The served pages as a list, whichever shape was passed. */
function servedPages(pagesOrPage) {
  if (Array.isArray(pagesOrPage)) return pagesOrPage;
  return pagesOrPage && typeof pagesOrPage === 'object' ? [pagesOrPage] : [];
}

async function pageAddressesFor(projectIdInput, pagesOrPage) {
  const projectId = String(projectIdInput || '').trim();
  const ids = [...collectPageLinkIds(pagesOrPage)];
  if (!ids.length) return {};
  if (!projectId) return null;

  try {
    // A link to a SECTION of a page (`page:<id>#<section>|…`, task SC-852)
    // needs that section's anchor name as it is now, which lives in the
    // page's sections — so they are read only when some link names one.
    const wantsAnchors = mentionsSectionLink(pagesOrPage);
    const list = ids.map((id) => encodeURIComponent(id)).join(',');
    const res = await sbQuery({
      method: 'GET',
      table: tableConfig().builderPages,
      query: `select=id,slug${wantsAnchors ? ',layout_sections' : ''}&project_id=eq.${encodeURIComponent(projectId)}&id=in.(${list})`,
    });
    if (!res.ok || !Array.isArray(res.data)) return null;
    const map = {};
    for (const row of res.data) {
      const id = String(row?.id ?? '').trim();
      if (!id) continue;
      map[id] = String(row?.slug ?? '').replace(/^\/+/, '');
      if (wantsAnchors) addSectionAnchors(map, id, row?.layout_sections);
    }
    // A page being served links to its OWN sections by the names it is
    // being served WITH — its published copy, which may differ from the draft
    // just read. Those win, so a same-page menu link always lands.
    if (wantsAnchors) {
      for (const page of servedPages(pagesOrPage)) {
        const id = String(page?.id ?? '').trim();
        if (id && id in map) addSectionAnchors(map, id, page?.layoutSections ?? page?.layout_sections);
      }
    }
    const missing = ids.filter((id) => !(id in map));
    if (missing.length) {
      console.warn(`[page-links] project ${projectId}: linked page(s) ${missing.join(', ')} no longer exist — serving their saved addresses`);
    }
    return map;
  } catch (_) {
    return null;
  }
}

module.exports = { pageAddressesFor };
