'use strict';

/**
 * --apply's jump-link step (task SC-854). The mapper wrote each jump link as a
 * plain address ("/#contact-us") because page ids did not exist yet. Once the
 * pages are written they do, so this stores each link by reference — page id
 * and section id — the way the Builder's link picker does, and reads every
 * changed page back. Only sections this run owns are touched: one somebody
 * edited since is left as they left it.
 *
 * It NEVER throws. It runs after the pages are created and before the map
 * checkpoint records their ids; a throw here on a job's first build would
 * leave pages nothing remembers making, and the next run would build a second
 * set (review of SC-854). So a page whose links cannot be stored is reported —
 * `error` + `warn` — and counted in `failed`, the run is marked failed by the
 * caller, and the other pages carry on. A page that keeps its plain addresses
 * still works: "/#contact-us" scrolls by itself, it just is not stored by
 * reference.
 *
 * @param {object} args
 * @param {{ pages: { key: string, slug: string }[], sectionLinks: object[] }} args.out  the mapper's output
 * @param {Record<string, string|number>} args.pageIds  page.key -> Builder page id
 * @param {Map<string, string[]>} args.ownedSectionIds  pageId -> section ids this run owns
 * @param {object[]} [args.targets]  the section links to reference (defaults to out.sectionLinks)
 * @param {{ getPage: Function, updatePage: Function }} args.pagesStore  envelope-returning store
 * @param {object} args.scope
 * @param {Function} args.referenceSectionLinks  from lib/site-import/dist/map.js
 * @param {(line: string) => void} [args.log]
 * @param {(line: string) => void} [args.warn]   a line for the Imports screen
 * @param {(line: string) => void} [args.error]
 * @returns {Promise<{ pagesChanged: number, linksReferenced: number, failed: string[] }>}
 */
async function referenceJumpLinks({
  out, pageIds, ownedSectionIds, targets, pagesStore, scope, referenceSectionLinks,
  log = () => {}, warn = () => {}, error = () => {},
}) {
  const links = targets || out.sectionLinks || [];
  const result = { pagesChanged: 0, linksReferenced: 0, failed: [] };
  if (!links.length) return result;
  const must = (res, what) => {
    if (!res || res.ok === false) throw new Error(`${what}: ${res?.error?.message || res?.error || `status ${res?.status}`}`);
    return res.data;
  };
  // Every stored section reference, whichever page it points at: a link to
  // another page's section is checked after the write too.
  const countRefs = (sections) => (JSON.stringify(sections || []).match(/page:[^"#|\\]+#/g) || []).length;

  for (const page of out.pages || []) {
    const pageId = pageIds[page.key];
    if (!pageId) continue;
    try {
      const owned = new Set(ownedSectionIds.get(String(pageId)) || []);
      const current = must(await pagesStore.getPage(pageId, scope), `read /${page.slug} for jump links`);
      const sections = current.layoutSections || [];
      const mine = sections.filter((s) => owned.has(s.id));
      const { sections: swapped, referenced } = referenceSectionLinks(mine, links, pageIds);
      if (!referenced) continue;
      const byId = new Map(swapped.map((s) => [s.id, s]));
      const next = sections.map((s) => byId.get(s.id) || s);
      // Spread the page and pass the ARRAY (landmine 13), then read it back.
      must(await pagesStore.updatePage(pageId, { ...current, layoutSections: next }, scope), `store jump links on /${page.slug}`);
      const after = must(await pagesStore.getPage(pageId, scope), `re-read /${page.slug}`);
      const stored = countRefs(after.layoutSections);
      const expected = countRefs(next);
      if (stored < expected) {
        throw new Error(`/${page.slug} (page ${pageId}): ${expected} section link(s) written, ${stored} read back`);
      }
      result.pagesChanged += 1;
      result.linksReferenced += referenced;
    } catch (err) {
      const why = String(err?.message || err);
      error(`ERROR: jump links on /${page.slug} (page ${pageId}) were not stored by reference: ${why}`);
      warn(`/${page.slug}: its jump links were not stored by reference (${why}); they keep their plain addresses, which still scroll.`);
      result.failed.push(page.slug);
    }
  }
  log(`Jump links: stored ${result.linksReferenced} link(s) by reference on ${result.pagesChanged} page(s); read back.`
    + (result.failed.length ? ` ${result.failed.length} page(s) failed: ${result.failed.map((s) => `/${s}`).join(', ')}.` : ''));
  return result;
}

module.exports = { referenceJumpLinks };
