'use strict';

const { sendJson, sendErr, sendStatus, isHeadRequest, getUrlObj, getPublicSiteDomainParam } = require('./http');
const { findProjectByDomain, getPublicProjectById } = require('../lib/projectsStore');
const { listPublishedPagesForProject, listRestrictedAdminSitePagesForProject } = require('../lib/builderPagesStore');
const { getAdminSession } = require('../lib/projectAdminStore');
const projectAdmin = require('./projectAdmin');
const {
  assertProjectIdAllowedOnHost,
  assertDomainQueryAllowedOnHost,
  resolveTenantProjectFromHost,
} = require('../lib/publicSiteHostBinding');
const { writeProjectFaviconResponse } = require('../lib/projectFavicon');

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
      const { id, name, domain: d, logoDataUrl, faviconDataUrl } = tenant.project;
      return respondJson(res, req, 200, { ok: true, project: { id, name, domain: d, logoDataUrl, faviconDataUrl } }), true;
    }

    if (!domainParam) return respondErr(res, req, 400, 'domain is required'), true;
    const result = await findProjectByDomain(domainParam);
    if (!result.ok) return respondErr(res, req, result.status || 404, result.error || 'Not found'), true;

    const { id, name, domain: d, logoDataUrl, faviconDataUrl } = result.data;
    return respondJson(res, req, 200, { ok: true, project: { id, name, domain: d, logoDataUrl, faviconDataUrl } }), true;
  }

  // GET /api/public/favicon?projectId=... — published site favicon (no auth)
  if (pathname === '/api/public/favicon' && (readMethod === 'GET' || readMethod === 'HEAD')) {
    const { searchParams } = getUrlObj(req);
    const tenant = await resolveTenantProjectFromHost(req);
    let project = null;

    if (tenant.ok && !tenant.systemHost && tenant.project) {
      project = tenant.project;
    } else {
      const projectId = String(searchParams.get('projectId') || '').trim();
      if (!projectId) {
        return respondErr(res, req, 400, 'projectId is required'), true;
      }
      const bind = await assertProjectIdAllowedOnHost(req, projectId);
      if (!bind.ok) return respondErr(res, req, bind.status || 403, bind.error, { code: bind.code }), true;
      const loaded = await getPublicProjectById(bind.projectId || projectId);
      if (!loaded.ok) return respondErr(res, req, loaded.status || 404, loaded.error || 'Project not found'), true;
      project = loaded.data;
    }

    await writeProjectFaviconResponse(res, project, {
      headOnly: readMethod === 'HEAD',
      cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    });
    return true;
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

  // GET /api/public/admin-pages?projectId=... — restricted admin site pages (admin session required)
  if (pathname === '/api/public/admin-pages' && (readMethod === 'GET' || readMethod === 'HEAD')) {
    const token = projectAdmin.readAdminSessionToken(req);
    const session = await getAdminSession(token);
    if (!session) {
      return respondErr(res, req, 401, 'Admin authentication required', { code: 'ADMIN_AUTH_REQUIRED' }), true;
    }

    const { searchParams } = getUrlObj(req);
    const projectId = String(searchParams.get('projectId') || '').trim();
    if (!projectId) return respondErr(res, req, 400, 'projectId is required'), true;

    if (String(session.projectId) !== String(projectId)) {
      return respondErr(res, req, 403, 'Project mismatch', { code: 'ADMIN_PROJECT_MISMATCH' }), true;
    }

    const bind = await assertProjectIdAllowedOnHost(req, projectId);
    if (!bind.ok) return respondErr(res, req, bind.status || 403, bind.error, { code: bind.code }), true;

    const scopedProjectId = bind.projectId || projectId;
    const result = await listRestrictedAdminSitePagesForProject(scopedProjectId);
    if (!result.ok) return respondErr(res, req, result.status || 500, result.error || 'Failed to load pages'), true;

    return respondJson(res, req, 200, { ok: true, pages: result.data }), true;
  }

  return false;
}

module.exports = { handle, manifest };
