'use strict';

/**
 * Bug Report "Show on: Every page of the site" (SC-804).
 *
 * A Bug Report module set to show site-wide puts its icon on EVERY page the
 * live site serves, including pages that have no Bug Report module of their
 * own. This file answers one question for the public page routes: which
 * module, if any, is site-wide right now?
 *
 * FOUR RULES, each from the ticket:
 *
 *   1. PUBLISHED PAGES ONLY. The switch is read from the snapshots Publish
 *      took (builder_published_pages), never from drafts, so a half-finished
 *      draft cannot change the live site. A project that has never published
 *      has no site-wide icon; each page shows its own module as before.
 *   2. ONLY PAGES A VISITOR CAN REACH. A snapshot outlives an unpublished or
 *      private page (lib/builderPublishStore.js, removeBuildForPage), so the
 *      snapshots are intersected with the pages that are published and public
 *      now. Unpublishing the page that holds the module takes the icon down.
 *   3. ONE WINNER. If modules on several pages are site-wide, the most recently
 *      published page wins. Copies of ONE module (a shared header on forty
 *      pages carries the same module id on every page) count as one module, so
 *      the panel's "another module is already site-wide" warning is about a
 *      genuinely different module, never a copy of itself.
 *   4. CHEAP ON EVERY VISIT. Payloads are big (1.36 MB across a 51-page site)
 *      and are stored as JSON TEXT, so Postgres cannot filter inside them. So
 *      each visit reads two small lists (which pages are public, when each was
 *      last published) and only fetches the payload of a page whose publish
 *      time this server has not already scanned. A whole answer is also held
 *      for a few seconds, so a burst of visits costs one read.
 *
 * FAILURE: if anything cannot be read, the answer is `ok: false` and the route
 * sends no site-wide module. The live page then shows each page's own module,
 * exactly as before this setting existed — a missing icon on a page that never
 * had one, never a broken page.
 */

const { sbQuery, tableConfig } = require('./supabase');

const MODULE_TYPE = 'bug-report';
/** The setting key and its site-wide value. Mirrored in builder-bug-report-module.tsx. */
const SHOW_ON_KEY = 'showOn';
const SHOW_ON_SITE = 'site';

/** How long one project's whole answer is reused, in ms. */
const ANSWER_TTL_MS = 15_000;
/**
 * How long one snapshot's scan is trusted, in ms. A Publish always stamps a new
 * `published_at`, which alone makes a fresh key; but a few maintenance scripts
 * (scripts/import_external_page_images.js, strip_import_placeholder_captions.js,
 * lib/blogImportStore.js) rewrite a payload IN PLACE, and the table has no
 * column that changes when they do. None of them touch Bug Report settings, so
 * this is a backstop: such an edit is seen within the hour, not never.
 */
const SCAN_TTL_MS = 60 * 60 * 1000;
/** Ceiling on remembered per-snapshot scans before the memory is dropped. */
const SCAN_CACHE_LIMIT = 5000;
/** Snapshot payloads fetched per request when several are new. */
const PAYLOAD_BATCH = 20;

const answerCache = new Map(); // projectId -> { at, value }
const scanCache = new Map(); // `${projectId}:${pageId}@${publishedAt}` -> { at, modules[] }

function isSiteWide(module) {
  return module?.type === MODULE_TYPE
    && String(module?.settings?.[SHOW_ON_KEY] ?? '').trim().toLowerCase() === SHOW_ON_SITE;
}

/**
 * Every site-wide Bug Report module in one page payload, at any depth (a
 * table cell's modules nest inside the section's). Pure.
 *
 * @returns {Array<{ moduleId: string, settings: Record<string,string> }>}
 */
function siteWideModulesInPage(payload) {
  const found = [];
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (isSiteWide(node)) {
      const moduleId = String(node.id ?? '');
      const key = moduleId || `#${found.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        const settings = {};
        for (const [k, v] of Object.entries(node.settings || {})) {
          if (typeof v === 'string') settings[k] = v;
        }
        found.push({ moduleId, settings });
      }
      return;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  const sections = payload?.layoutSections ?? payload?.layout_sections ?? null;
  visit(sections, 0);
  return found;
}

/**
 * Pick the winner from the pages' scans. Pure, so the rule is testable without
 * a database.
 *
 * @param {Array<{ pageId: string, pageSlug: string, pageName: string, publishedAt: string,
 *                 modules: Array<{ moduleId: string, settings: object }> }>} scanned
 * @returns {null | { moduleId, settings, pageId, pageSlug, pageName, publishedAt,
 *                    others: Array<{ moduleId, pageId, pageSlug, pageName }> }}
 */
function pickSiteWideBugReport(scanned) {
  const rows = (Array.isArray(scanned) ? scanned : [])
    .filter((row) => Array.isArray(row?.modules) && row.modules.length)
    .slice()
    .sort((a, b) => {
      const diff = (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
      return diff || String(b.pageId).localeCompare(String(a.pageId));
    });
  if (!rows.length) return null;

  const winnerRow = rows[0];
  const winner = winnerRow.modules[0];
  const others = [];
  const counted = new Set([winner.moduleId || `${winnerRow.pageId}#0`]);
  for (const row of rows) {
    row.modules.forEach((module, index) => {
      const key = module.moduleId || `${row.pageId}#${index}`;
      if (counted.has(key)) return;
      counted.add(key);
      others.push({ moduleId: module.moduleId, pageId: row.pageId, pageSlug: row.pageSlug, pageName: row.pageName });
    });
  }

  return {
    moduleId: winner.moduleId,
    settings: winner.settings,
    pageId: winnerRow.pageId,
    pageSlug: winnerRow.pageSlug,
    pageName: winnerRow.pageName,
    publishedAt: winnerRow.publishedAt,
    others,
  };
}

/** What a visitor's browser is sent: the winner only, no list of other modules. */
function publicSiteWideBugReport(answer) {
  if (!answer) return null;
  const { moduleId, settings, pageId, pageSlug, pageName } = answer;
  return { moduleId, settings, pageId, pageSlug, pageName };
}

function parsePayload(value) {
  let payload = value;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (_) { return null; }
  }
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

async function defaultListPublicPages(projectId) {
  const res = await sbQuery({
    method: 'GET',
    table: tableConfig().builderPages,
    query:
      'select=id,slug,name'
      + `&project_id=eq.${encodeURIComponent(projectId)}`
      + '&or=(is_published.eq.true,is_published.is.null)&is_private=eq.false&limit=5000',
  });
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, error: res.error || 'the pages could not be read' };
  const { filterPublicSitePages } = require('./publicSitePageFilter');
  const rows = res.data.map((row) => ({ id: String(row?.id ?? ''), slug: String(row?.slug ?? ''), name: String(row?.name ?? '') }));
  return { ok: true, data: filterPublicSitePages(rows) };
}

async function defaultListBuilds(projectId) {
  const res = await sbQuery({
    method: 'GET',
    table: tableConfig().builderPublishedPages,
    query: `select=page_id,published_at&project_id=eq.${encodeURIComponent(projectId)}&limit=5000`,
  });
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, error: res.error || 'the published pages could not be read' };
  return { ok: true, data: res.data.map((row) => ({ pageId: String(row?.page_id ?? ''), publishedAt: String(row?.published_at ?? '') })) };
}

async function defaultFetchPayloads(projectId, pageIds) {
  const ids = pageIds.map((id) => encodeURIComponent(id)).join(',');
  const res = await sbQuery({
    method: 'GET',
    table: tableConfig().builderPublishedPages,
    query: `select=page_id,published_at,payload&project_id=eq.${encodeURIComponent(projectId)}&page_id=in.(${ids})`,
  });
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, error: res.error || 'the published pages could not be read' };
  return {
    ok: true,
    data: res.data.map((row) => ({
      pageId: String(row?.page_id ?? ''),
      publishedAt: String(row?.published_at ?? ''),
      payload: parsePayload(row?.payload),
    })),
  };
}

/**
 * Which Bug Report module is site-wide for this project right now?
 *
 * @returns {Promise<{ ok: true, data: ReturnType<typeof pickSiteWideBugReport> }
 *                 | { ok: false, error: string }>}
 */
async function resolveSiteWideBugReport(projectIdInput, deps = {}) {
  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, error: 'projectId is required' };

  const now = (deps.now || Date.now)();
  const useCache = !deps.noCache;
  const cached = useCache ? answerCache.get(projectId) : null;
  if (cached && now - cached.at < ANSWER_TTL_MS) return { ok: true, data: cached.value };

  const listPublicPages = deps.listPublicPages || defaultListPublicPages;
  const listBuilds = deps.listBuilds || defaultListBuilds;
  const fetchPayloads = deps.fetchPayloads || defaultFetchPayloads;

  try {
    const [pagesRes, buildsRes] = await Promise.all([listPublicPages(projectId), listBuilds(projectId)]);
    if (!pagesRes?.ok) return { ok: false, error: pagesRes?.error || 'the pages could not be read' };
    if (!buildsRes?.ok) return { ok: false, error: buildsRes?.error || 'the published pages could not be read' };

    const pagesById = new Map(pagesRes.data.map((page) => [String(page.id), page]));
    const live = buildsRes.data.filter((build) => build.pageId && pagesById.has(build.pageId));

    const keyOf = (build) => `${projectId}:${build.pageId}@${build.publishedAt}`;
    const fresh = (build) => {
      const hit = scanCache.get(keyOf(build));
      return Boolean(hit) && now - hit.at < SCAN_TTL_MS;
    };
    const missing = live.filter((build) => !fresh(build));
    for (let i = 0; i < missing.length; i += PAYLOAD_BATCH) {
      const batch = missing.slice(i, i + PAYLOAD_BATCH);
      const res = await fetchPayloads(projectId, batch.map((build) => build.pageId));
      if (!res?.ok) return { ok: false, error: res?.error || 'the published pages could not be read' };
      for (const row of res.data) {
        // A payload that will not parse is recorded as having no module rather
        // than failing the whole site: that page's own snapshot is broken, and
        // the public read already serves its draft in that case.
        if (scanCache.size >= SCAN_CACHE_LIMIT) scanCache.clear();
        scanCache.set(keyOf(row), { at: now, modules: row.payload ? siteWideModulesInPage(row.payload) : [] });
      }
    }

    const scanned = live.map((build) => {
      const page = pagesById.get(build.pageId);
      return {
        pageId: build.pageId,
        pageSlug: String(page?.slug ?? ''),
        pageName: String(page?.name ?? ''),
        publishedAt: build.publishedAt,
        // Republished between the list and the fetch: the next visit scans it.
        modules: scanCache.get(keyOf(build))?.modules || [],
      };
    });

    const value = pickSiteWideBugReport(scanned);
    if (useCache) answerCache.set(projectId, { at: now, value });
    return { ok: true, data: value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Forget a project's held answer, so the next visit reads afresh (called after a publish). */
function forgetSiteWideBugReport(projectId) {
  answerCache.delete(String(projectId || '').trim());
}

module.exports = {
  MODULE_TYPE,
  SHOW_ON_KEY,
  SHOW_ON_SITE,
  ANSWER_TTL_MS,
  SCAN_TTL_MS,
  siteWideModulesInPage,
  pickSiteWideBugReport,
  publicSiteWideBugReport,
  resolveSiteWideBugReport,
  forgetSiteWideBugReport,
};
