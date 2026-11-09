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
const { collectPageLinkIds } = require('./builder-client/page-link');

async function pageAddressesFor(projectIdInput, pagesOrPage) {
  const projectId = String(projectIdInput || '').trim();
  const ids = [...collectPageLinkIds(pagesOrPage)];
  if (!ids.length) return {};
  if (!projectId) return null;

  try {
    const list = ids.map((id) => encodeURIComponent(id)).join(',');
    const res = await sbQuery({
      method: 'GET',
      table: tableConfig().builderPages,
      query: `select=id,slug&project_id=eq.${encodeURIComponent(projectId)}&id=in.(${list})`,
    });
    if (!res.ok || !Array.isArray(res.data)) return null;
    const map = {};
    for (const row of res.data) {
      const id = String(row?.id ?? '').trim();
      if (id) map[id] = String(row?.slug ?? '').replace(/^\/+/, '');
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
