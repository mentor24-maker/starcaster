'use strict';

const { sendJson, sendErr, getUrlObj } = require('./http');
const { findProjectByDomain } = require('../lib/projectsStore');
const { listPublishedPagesForProject } = require('../lib/builderPagesStore');

const manifest = {
  id: 'public-site',
  label: 'Public Site API (unauthenticated)',
  prefixes: ['/api/public'],
};

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/public/')) return false;

  // GET /api/public/debug-req — temporary host diagnostic
  if (pathname === '/api/public/debug-req' && method === 'GET') {
    return sendJson(res, 200, {
      host: req.headers.host,
      xForwardedHost: req.headers['x-forwarded-host'],
      url: req.url,
      allHeaders: Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => k.startsWith('x-') || k === 'host')
      ),
    }), true;
  }

  // GET /api/public/site?domain=benvin.org
  if (pathname === '/api/public/site' && method === 'GET') {
    const { searchParams } = getUrlObj(req);
    const domain = String(searchParams.get('domain') || '').trim().toLowerCase().replace(/^www\./, '');
    if (!domain) return sendErr(res, 400, 'domain is required'), true;

    const result = await findProjectByDomain(domain);
    if (!result.ok) return sendErr(res, result.status || 404, result.error || 'Not found'), true;

    const { id, name, domain: d, logoDataUrl } = result.data;
    return sendJson(res, 200, { ok: true, project: { id, name, domain: d, logoDataUrl } }), true;
  }

  // GET /api/public/pages?projectId=...
  if (pathname === '/api/public/pages' && method === 'GET') {
    const { searchParams } = getUrlObj(req);
    const projectId = String(searchParams.get('projectId') || '').trim();
    if (!projectId) return sendErr(res, 400, 'projectId is required'), true;

    const result = await listPublishedPagesForProject(projectId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Failed to load pages'), true;

    return sendJson(res, 200, { ok: true, pages: result.data }), true;
  }

  return false;
}

module.exports = { handle, manifest };
