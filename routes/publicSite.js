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

  // GET /api/public/routing — temporary host/path diagnostics for custom domains
  if (pathname === '/api/public/routing' && method === 'GET') {
    const { getClientHost, getPublicSiteDomainParam, getPublicSiteDomainFromPath } = require('./http');
    const urlObj = getUrlObj(req);
    const domainParam = getPublicSiteDomainParam(req);
    const pathDomain = getPublicSiteDomainFromPath(urlObj.pathname);
    const host = getClientHost(req);
    const lookupDomain = pathDomain || domainParam || host;
    const lookup = lookupDomain ? await findProjectByDomain(lookupDomain) : { ok: false, error: 'no domain candidate' };
    return sendJson(res, 200, {
      ok: true,
      url: String(req.url || ''),
      pathname: urlObj.pathname,
      pathDomain,
      domainParam,
      clientHost: host,
      lookupOk: lookup.ok,
      lookupError: lookup.error || null,
      projectId: lookup.ok ? lookup.data?.id : null,
    }), true;
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
