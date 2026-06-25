'use strict';

const { sendJson, sendErr, getUrlObj, getPublicSiteDomainParam } = require('./http');
const { findProjectByDomain } = require('../lib/projectsStore');
const { listPublishedPagesForProject } = require('../lib/builderPagesStore');

const manifest = {
  id: 'public-site',
  label: 'Public Site API (unauthenticated)',
  prefixes: ['/api/public'],
};

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/public/')) return false;

  // GET /api/public/site?domain=benvin.org
  if (pathname === '/api/public/site' && method === 'GET') {
    const { searchParams } = getUrlObj(req);
    const domain = String(
      searchParams.get('domain')
      || getPublicSiteDomainParam(req)
      || ''
    ).trim().toLowerCase().replace(/^www\./, '');
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
