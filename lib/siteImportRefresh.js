'use strict';

/**
 * Importing a site again REFRESHES the pages the earlier import built
 * (task 86bcynzn5; Dane, 2026-11-04: "real refresh").
 *
 * The mapper (scripts/site_import_map.mjs) decides which pages it may update
 * from the job's own map checkpoint — the page ids it built, the fingerprint
 * of every section it wrote, the menu sections it made. A confirmed re-import
 * (`checkpoints.reimportOf`, set by POST /api/site-import/jobs) is a NEW job
 * with no map checkpoint of its own, so before this it saw no pages at all:
 * every existing page counted as somebody else's address, and the second
 * import's pages landed beside the first set with "-2" slugs, plus twin
 * "Top Menu (site)" sections.
 *
 * `resolveRefreshSource` hands the mapper the earlier job's map checkpoint
 * instead. The clobber guard then does the protecting, exactly as it does on
 * a re-run of one job: a section whose content changed since the import wrote
 * it is kept and reported, never overwritten.
 *
 * Pure apart from the `getJob` it is given, so it is tested with fixture jobs
 * (scripts/builder/siteImportRefresh.test.js).
 */

const MAX_CHAIN = 20;

/**
 * Which map checkpoint does this job build against?
 *
 *   - Its own, when it has one (a re-run of this job) → { refresh: null }.
 *   - Otherwise, when it is a confirmed re-import, the most recent job up the
 *     `reimportOf` chain that HAS one → { refresh: { job, chain } }.
 *   - Otherwise nothing → { prior: {}, refresh: null } (a first import).
 *
 * A link in the chain that cannot be read THROWS. Answering "nothing to
 * refresh" for an unreadable earlier job would build the second set of pages
 * this exists to prevent — "could not tell" must never read as "nothing there".
 * A job from another project, or a loop in the chain, throws too.
 *
 * @param {object} job  the job being mapped (store shape: id, projectId, checkpoints)
 * @param {(id: string) => Promise<object|null>} getJob  loads a job; null when absent
 */
async function resolveRefreshSource(job, getJob) {
  const own = job && job.checkpoints && job.checkpoints.map;
  if (own && typeof own === 'object') return { prior: own, refresh: null };

  const chain = [];
  const seen = new Set([String(job.id)]);
  let nextId = job.checkpoints && job.checkpoints.reimportOf;
  while (nextId) {
    const id = String(nextId);
    if (seen.has(id)) throw new Error(`re-import chain loops back to ${id} (${[job.id, ...chain.map((j) => j.id), id].join(' → ')}).`);
    if (chain.length >= MAX_CHAIN) throw new Error(`re-import chain from ${job.id} is longer than ${MAX_CHAIN} jobs — refusing to guess which one built the pages.`);
    seen.add(id);
    let earlier;
    try {
      earlier = await getJob(id);
    } catch (err) {
      throw new Error(`could not read the earlier import ${id} this job re-imports: ${err.message || err}`);
    }
    if (!earlier) throw new Error(`the earlier import ${id} this job re-imports no longer exists — cannot tell which pages it built.`);
    if (String(earlier.projectId) !== String(job.projectId)) {
      throw new Error(`the earlier import ${id} belongs to project ${earlier.projectId}, not ${job.projectId}.`);
    }
    chain.push(earlier);
    const map = earlier.checkpoints && earlier.checkpoints.map;
    if (map && typeof map === 'object' && map.pageIds && Object.keys(map.pageIds).length) {
      return { prior: map, refresh: { job: earlier, chain } };
    }
    nextId = earlier.checkpoints && earlier.checkpoints.reimportOf;
  }
  // A re-import of a site whose earlier copy never had pages built: there is
  // nothing to refresh, so this is a first build. Said, not silent.
  return { prior: {}, refresh: null, unbuiltChain: chain };
}

/** "Nov 4" — the date an earlier import built its pages. */
function shortDate(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return 'an unknown date';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * What a refresh will do, counted the way the write step will act:
 *   refreshed — pages the earlier import built that still exist
 *   recreated — pages it built that have since been deleted (the write
 *               step makes these again; the report must say so — Scope)
 *   added     — pages in this capture the earlier import never built
 *
 * @param {{ key: string, slug: string }[]} mappedPages  mapSite(...).pages
 * @param {Record<string,string>} priorPageIds  key → Builder page id
 * @param {{ id: string|number }[]} existingPages  the project's pages now
 */
function planRefresh(mappedPages, priorPageIds, existingPages) {
  const live = new Set(existingPages.map((p) => String(p.id)));
  const refreshed = [];
  const recreated = [];
  const added = [];
  for (const page of mappedPages) {
    const id = priorPageIds[page.key];
    if (!id) added.push(page);
    else if (live.has(String(id))) refreshed.push(page);
    else recreated.push(page);
  }
  return { refreshed, recreated, added };
}

/**
 * The line the dry run (and --apply) opens with:
 * "Refreshing N pages built by the import of <address> on <date>; M sections
 * you edited will be kept; K new pages."
 */
function refreshSummaryLine(refresh, plan, keptSections) {
  const src = refresh.job;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  let line = `Refreshing ${plural(plan.refreshed.length, 'page', 'pages')} built by the import of ${src.sourceUrl} on ${shortDate(src.checkpoints.map.at || src.finishedAt || src.createdAt)}; `
    + `${plural(keptSections, 'section', 'sections')} you edited will be kept; ${plural(plan.added.length, 'new page', 'new pages')}.`;
  if (plan.recreated.length) {
    line += ` ${plural(plan.recreated.length, 'page', 'pages')} that import built ${plan.recreated.length === 1 ? 'was' : 'were'} deleted since and will be made again: ${plan.recreated.map((p) => `/${p.slug}`).join(', ')}.`;
  }
  return line;
}

/**
 * The clobber guard's question, asked of every mapped section on a page an
 * import already built: has somebody changed it since the import wrote it?
 * A section is human-modified when the page still holds it and its current
 * fingerprint no longer matches the one recorded at import time. A section
 * with no recorded fingerprint, or one deleted from the page, is not — the
 * mapper writes it (a deleted one is recreated, by design). `forced` names
 * sections the operator asked to overwrite anyway (--force-section).
 *
 * On a refresh, `priorPageIds` and `sectionHashes` are the EARLIER job's — that
 * is what makes an edit made after the first import survive the second.
 *
 * @returns {{ page, section, live }[]}
 */
function findHumanModifiedSections(mappedPages, { priorPageIds, sectionHashes, existingPages, forced = new Set(), fingerprint }) {
  const found = [];
  for (const page of mappedPages) {
    const existingId = priorPageIds[page.key];
    if (!existingId) continue;
    const current = existingPages.find((p) => String(p.id) === String(existingId));
    if (!current) continue;
    for (const section of page.sections) {
      const priorHash = sectionHashes[section.id];
      if (!priorHash) continue;
      const live = (current.layoutSections || []).find((s) => s.id === section.id);
      if (!live) continue;
      if (fingerprint(live) !== priorHash && !forced.has(section.id)) found.push({ page, section, live });
    }
  }
  return found;
}

/** Make the import theme the project default? Not on a refresh (Scope). */
function themeMakesDefault(refresh) {
  return !refresh;
}

module.exports = {
  resolveRefreshSource, planRefresh, refreshSummaryLine, shortDate,
  findHumanModifiedSections, themeMakesDefault,
};
