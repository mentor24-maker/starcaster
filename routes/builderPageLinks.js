'use strict';

/**
 * What still links to the pages I am about to delete?
 *
 *   POST /api/builder/page-links/inbound   { pageIds: [...] }
 *     → { ok, data: { pages: { [pageId]: [{ text, source }] }, checked: { pages, savedSections, forms } } }
 *
 * Builder › Pages asks this before it shows the delete dialog, so the dialog
 * can name every button, menu item and form that would be left pointing at
 * nothing (task 86bcxn69z). The answer is lib/pageInboundLinks.js — the same
 * scan the weekly broken-link check runs, so the two cannot disagree.
 *
 * Read-only. A read that fails is an ERROR, never an empty answer: "could not
 * check" must not reach the dialog looking like "nothing links here".
 *
 * Its own module rather than another branch in routes/builder.js, per
 * routes/CLAUDE.md. AUTHENTICATED: /api/builder/* requires a session
 * (routes/index.js), and every read is scoped to the caller's active project.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const { sbQuery, tableConfig } = require('../lib/supabase');
const scan = require('../lib/pageInboundLinks');

const manifest = {
  id: 'builder-page-links',
  label: 'Which links point at a page (the delete warning on Builder › Pages)',
  prefixes: ['/api/builder/page-links/'],
};

const INBOUND_PATH = '/api/builder/page-links/inbound';

function must(res, what) {
  if (!res || res.ok !== true) throw new Error(`${what}: ${res?.status || ''} ${res?.error || 'no answer'}`.trim());
  return Array.isArray(res.data) ? res.data : [];
}

async function readForms(projectId) {
  const res = await sbQuery({
    method: 'GET',
    table: tableConfig().crmForms,
    query: `select=id,name,fields&project_id=eq.${encodeURIComponent(projectId)}&limit=2000`,
  });
  return must(res, 'reading the CRM forms');
}

async function handle(req, res, pathname, method) {
  if (pathname !== INBOUND_PATH) return false;
  if (String(method || '').toUpperCase() !== 'POST') return false;

  const scope = requestProjectScope(req);
  if (!scope.projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;

  const body = await parseJsonBody(req).catch(() => ({}));
  const pageIds = (Array.isArray(body?.pageIds) ? body.pageIds : []).map((id) => String(id ?? '').trim()).filter(Boolean);
  if (!pageIds.length) return sendErr(res, 400, 'pageIds is required', { code: 'PAGE_IDS_REQUIRED' }), true;

  let pages; let savedSections; let forms;
  try {
    const { listPages } = require('../lib/builderPagesStore');
    const { listSavedSections } = require('../lib/builderSavedSectionsStore');
    // Limit FIRST (CLAUDE.md landmine 12) — the scope as a limit reads every project.
    [pages, savedSections, forms] = await Promise.all([
      listPages(5000, scope).then((r) => must(r, 'reading the pages')),
      listSavedSections(5000, scope).then((r) => must(r, 'reading the saved sections')),
      readForms(scope.projectId),
    ]);
  } catch (err) {
    return sendErr(res, 502, `Could not check what links to ${pageIds.length === 1 ? 'this page' : 'these pages'} — ${err.message}`, { code: 'LINK_CHECK_FAILED' }), true;
  }

  const links = scan.collectProjectLinks({ pages, savedSections, forms, domain: scope.project?.domain || '' });
  const byPage = scan.linksToPages(links, pages, pageIds);
  const out = {};
  for (const [id, hits] of Object.entries(byPage)) {
    out[id] = hits.map((link) => ({ text: scan.describeLink(link), source: link.source }));
  }
  return sendOk(res, 200, {
    pages: out,
    checked: { pages: pages.length, savedSections: savedSections.length, forms: forms.length },
  }), true;
}

module.exports = { handle, manifest };
