'use strict';

/**
 * Site Export API — download a project's site as a WordPress import file
 * built for the Divi theme (lib/wordpressExport.js does the converting).
 *
 *   GET /api/site-export/wordpress/summary   what the file will hold, as JSON
 *   GET /api/site-export/wordpress/download  the file itself (WXR .xml)
 *
 * Both read the ACTIVE project (x-project-id). Staff-only, like Site Import:
 * '/api/site-export' sits in PROJECT_ADMIN_SESSION_DENY_PREFIXES, because the
 * file carries every page and draft post a project has.
 *
 * Read-only: nothing here writes to the database.
 */

const { sendOk, sendErr } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { listPages } = require('../lib/builderPagesStore');
const { listPosts } = require('../lib/blogPostsStore');
const { buildWordPressExport } = require('../lib/wordpressExport');

const PREFIX = '/api/site-export';

// listPosts caps a page at 100; walk until a short page. The ceiling is a
// guard against a store that ignores `page`, not a real limit.
async function listAllPosts(scope) {
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await listPosts({ page, limit: 100 }, scope);
    const rows = Array.isArray(batch) ? batch : [];
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

function requestOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

function siteUrlFor(project, origin) {
  const domain = String(project?.domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (domain) return `https://${domain}`;
  for (const candidate of [project?.canonicalUrl, project?.siteUrl, project?.projectUrl, project?.website]) {
    if (/^https?:\/\//i.test(String(candidate || ''))) return String(candidate).replace(/\/+$/, '');
  }
  return origin;
}

async function buildForRequest(req) {
  const scope = requestProjectScope(req);
  const pagesRes = await listPages(5000, { projectId: scope.projectId, userId: scope.userId });
  if (!pagesRes.ok) return { error: pagesRes.error || 'Could not read the pages', status: pagesRes.status || 500 };
  const posts = await listAllPosts({ projectId: scope.projectId, userId: scope.userId });
  const project = scope.project || {};
  const origin = requestOrigin(req);
  const logo = String(project.logoDataUrl || '');
  return {
    project,
    result: buildWordPressExport({
      project: {
        name: project.name,
        slug: project.slug,
        description: project.description,
        siteUrl: siteUrlFor(project, origin),
        // A data: URL logo cannot be downloaded by WordPress; leave it out.
        logoUrl: /^https?:\/\//i.test(logo) || logo.startsWith('/') ? logo : '',
      },
      pages: pagesRes.data,
      posts,
      // Site-relative images (/images/...) are served by StarCaster itself.
      assetOrigin: origin,
    }),
  };
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith(PREFIX)) return false;
  if (!req.authUser) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
  if (method !== 'GET') return sendErr(res, 405, 'Method not allowed', { code: 'METHOD_NOT_ALLOWED' }), true;

  const isSummary = pathname === `${PREFIX}/wordpress/summary`;
  const isDownload = pathname === `${PREFIX}/wordpress/download`;
  if (!isSummary && !isDownload) return sendErr(res, 404, 'Unknown Site Export endpoint', { code: 'NOT_FOUND' }), true;

  // Landmine #11: returns true when it has ALREADY sent the 429.
  if (checkEndpointLimit(req, res, 'siteExport.wordpress')) return true;

  const scope = requestProjectScope(req);
  if (!scope.projectId) {
    return sendErr(res, 400, 'An active project is required (x-project-id header)', { code: 'PROJECT_REQUIRED' }), true;
  }

  const built = await buildForRequest(req);
  if (built.error) return sendErr(res, built.status, built.error), true;
  const { xml, report } = built.result;

  if (isSummary) return sendOk(res, 200, { report, bytes: Buffer.byteLength(xml, 'utf8') }), true;

  const base = String(built.project.slug || built.project.name || 'site')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
  const filename = `${base}-wordpress-divi-${report.generatedAt.slice(0, 10)}.xml`;
  const body = Buffer.from(xml, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
  return true;
}

module.exports = {
  handle,
  manifest: { id: 'siteExport', label: 'Site Export', prefixes: [PREFIX] },
  // exported for tests
  siteUrlFor,
};
