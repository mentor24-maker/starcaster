'use strict';

const { sendJson, sendErr, sendStatus, isHeadRequest, getUrlObj, getPublicSiteDomainParam } = require('./http');
const { findProjectByDomain } = require('../lib/projectsStore');
const { listPublishedPagesForProject } = require('../lib/builderPagesStore');
const {
  assertProjectIdAllowedOnHost,
  assertDomainQueryAllowedOnHost,
  resolveTenantProjectFromHost,
} = require('../lib/publicSiteHostBinding');

const manifest = {
  id: 'public-site',
  label: 'Public Site API (unauthenticated)',
  prefixes: ['/api/public'],
};

function respondJson(res, req, status, payload) {
  if (isHeadRequest(req)) return sendStatus(res, status);
  return sendJson(res, status, payload);
}

function respondErr(res, req, status, message, opts = {}) {
  if (isHeadRequest(req)) return sendStatus(res, status);
  return sendErr(res, status, message, opts);
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/public/')) return false;

  const readMethod = String(method || '').toUpperCase();

  // GET /api/public/site?domain=benvin.org
  if (pathname === '/api/public/site' && (readMethod === 'GET' || readMethod === 'HEAD')) {
    const { searchParams } = getUrlObj(req);
    const domainParam = String(
      searchParams.get('domain')
      || getPublicSiteDomainParam(req)
      || ''
    ).trim().toLowerCase().replace(/^www\./, '');

    const tenant = await resolveTenantProjectFromHost(req);
    if (!tenant.ok) return respondErr(res, req, tenant.status || 403, tenant.error, { code: tenant.code }), true;

    if (!tenant.systemHost) {
      const domainCheck = await assertDomainQueryAllowedOnHost(req, domainParam);
      if (!domainCheck.ok) return respondErr(res, req, domainCheck.status || 403, domainCheck.error, { code: domainCheck.code }), true;
      const { id, name, domain: d, logoDataUrl } = tenant.project;
      return respondJson(res, req, 200, { ok: true, project: { id, name, domain: d, logoDataUrl } }), true;
    }

    if (!domainParam) return respondErr(res, req, 400, 'domain is required'), true;
    const result = await findProjectByDomain(domainParam);
    if (!result.ok) return respondErr(res, req, result.status || 404, result.error || 'Not found'), true;

    const { id, name, domain: d, logoDataUrl } = result.data;
    return respondJson(res, req, 200, { ok: true, project: { id, name, domain: d, logoDataUrl } }), true;
  }

  // GET /api/public/pages?projectId=...
  if (pathname === '/api/public/pages' && (readMethod === 'GET' || readMethod === 'HEAD')) {
    const { searchParams } = getUrlObj(req);
    const projectId = String(searchParams.get('projectId') || '').trim();
    if (!projectId) return respondErr(res, req, 400, 'projectId is required'), true;

    const bind = await assertProjectIdAllowedOnHost(req, projectId);
    if (!bind.ok) return respondErr(res, req, bind.status || 403, bind.error, { code: bind.code }), true;

    const scopedProjectId = bind.projectId || projectId;
    const result = await listPublishedPagesForProject(scopedProjectId);
    if (!result.ok) return respondErr(res, req, result.status || 500, result.error || 'Failed to load pages'), true;

    return respondJson(res, req, 200, { ok: true, pages: result.data }), true;
  }

  return false;
}

module.exports = { handle, manifest };
