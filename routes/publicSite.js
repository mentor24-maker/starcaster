'use strict';

const { sendJson, sendErr, sendStatus, isHeadRequest, getUrlObj, getPublicSiteDomainParam, parseJsonBody } = require('./http');
const { findProjectByDomain, getPublicProjectById } = require('../lib/projectsStore');
const {
  listPublishedPagesForProject,
  getPublishedPageForProject,
  listRestrictedAdminSitePagesForProject,
} = require('../lib/builderPagesStore');
const { getAdminSession } = require('../lib/projectAdminStore');
const projectAdmin = require('./projectAdmin');
const {
  assertProjectIdAllowedOnHost,
  assertDomainQueryAllowedOnHost,
  resolveTenantProjectFromHost,
} = require('../lib/publicSiteHostBinding');
const { writeProjectFaviconResponse } = require('../lib/projectFavicon');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { createBugReport, MAX_DESCRIPTION_LENGTH: MAX_BUG_REPORT_DESCRIPTION_LENGTH } = require('../lib/projectBugReportsStore');
const { forwardBugReport } = require('../lib/bugReportForward');

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

    // Which scaled-down copies exist for the images these pages use, so the
    // browser can fetch a 600px file for a 600px slot instead of the original.
    // Empty on any failure — never a reason to fail a page load.
    const { buildRenditionMapForPages } = require('../lib/assetRenditionsForPages');
    const renditions = await buildRenditionMapForPages(scopedProjectId, result.data);

    return respondJson(res, req, 200, { ok: true, pages: result.data, renditions }), true;
  }

  // GET /api/public/page?projectId=...&slug=... — ONE published page.
  //
  // The site used to fetch every published page and pick one in the browser:
  // 1.36 MB across the wire on Marinoff (51 pages) to show roughly 30 KB of
  // page. This answers with the page asked for.
  //
  // /api/public/pages stays. The site-search RESULTS module builds its index
  // from every page and genuinely needs them all — it is now the only thing
  // that asks for the whole site, and it only loads on a results page.
  if (pathname === '/api/public/page' && (readMethod === 'GET' || readMethod === 'HEAD')) {
    const { searchParams } = getUrlObj(req);
    const projectId = String(searchParams.get('projectId') || '').trim();
    if (!projectId) return respondErr(res, req, 400, 'projectId is required'), true;

    const bind = await assertProjectIdAllowedOnHost(req, projectId);
    if (!bind.ok) return respondErr(res, req, bind.status || 403, bind.error, { code: bind.code }), true;

    const scopedProjectId = bind.projectId || projectId;
    const slug = String(searchParams.get('slug') || '');

    // A private slug is never served here — that path requires an admin
    // session and has its own endpoint. Answering 404 rather than 403 keeps
    // this endpoint from confirming which private pages exist.
    const { isPrivateSiteSlug } = require('../lib/builder-client/public-site-page-slugs');
    if (isPrivateSiteSlug(slug)) {
      return respondErr(res, req, 404, 'Page not found', { code: 'PAGE_NOT_FOUND' }), true;
    }

    // Prefer the BUILD — the snapshot Publish took — and fall back to
    // resolving the draft on the way out, which is what every page did before
    // publishing existed. A project that has never published is served exactly
    // as it is today, so this cannot be the reason a page stops rendering.
    const { getPublishedPage } = require('../lib/publishedPageRead');
    const built = await getPublishedPage(scopedProjectId, slug);

    let page = built;
    if (!page) {
      const result = await getPublishedPageForProject(scopedProjectId, slug);
      if (!result.ok) {
        return respondErr(res, req, result.status || 500, result.error || 'Failed to load page', {
          code: result.code || null,
        }), true;
      }
      page = result.data;
    }

    const { buildRenditionMapForPages } = require('../lib/assetRenditionsForPages');
    const renditions = await buildRenditionMapForPages(scopedProjectId, [page]);

    return respondJson(res, req, 200, {
      ok: true,
      page,
      renditions,
      // Which of the two answered. Useful in a browser's network tab when a
      // page looks stale: "draft" means this project has not published it.
      source: built ? 'published' : 'draft',
    }), true;
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

  // POST /api/public/bug-report — bug-report intake, no auth required (any
  // tenant site visitor can hit this). See docs/SQL/project_bug_reports_setup.sql.
  if (pathname === '/api/public/bug-report' && readMethod === 'POST') {
    if (checkEndpointLimit(req, res, 'public.bugReport')) return true;

    const body = await parseJsonBody(req);
    const projectId = String(body.projectId || '').trim();
    const bind = await assertProjectIdAllowedOnHost(req, projectId);
    if (!bind.ok) return respondErr(res, req, bind.status || 403, bind.error, { code: bind.code }), true;
    const description = String(body.description || '').trim();
    if (!description) return respondErr(res, req, 400, 'A description is required'), true;
    if (description.length > MAX_BUG_REPORT_DESCRIPTION_LENGTH) {
      return respondErr(res, req, 400, `Description must be ${MAX_BUG_REPORT_DESCRIPTION_LENGTH} characters or fewer`), true;
    }

    let scopedProjectId = bind.projectId || '';
    if (!scopedProjectId) {
      // System host (starcaster.pro, localhost, previews): the host names no
      // tenant, so the body's projectId is an unverified claim — resolve it
      // against real projects before writing, or any string becomes a tenant.
      if (!projectId) return respondErr(res, req, 400, 'projectId is required'), true;
      const project = await getPublicProjectById(projectId);
      if (!project.ok || !project.data) {
        return respondErr(res, req, 404, 'Unknown project', { code: 'PROJECT_NOT_FOUND' }), true;
      }
      scopedProjectId = String(project.data.id);
    }

    // A report claiming a client/staff viewer tier is only trusted if the
    // request carries a real tenant admin session for THIS project —
    // hiding an icon in the UI is not a security boundary.
    let viewerTier = String(body.viewerTier || '').trim().toLowerCase();
    let ownerUserId = '';
    if (viewerTier === 'client' || viewerTier === 'staff') {
      const token = projectAdmin.readAdminSessionToken(req);
      const session = await getAdminSession(token);
      if (session && String(session.projectId) === String(scopedProjectId)) {
        ownerUserId = session.adminUserId;
      } else {
        viewerTier = 'public';
      }
    }

    const scope = { projectId: scopedProjectId, userId: ownerUserId };
    const result = await createBugReport({
      description,
      pageUrl: body.pageUrl,
      userAgent: body.userAgent || req.headers['user-agent'] || '',
      viewerTier,
    }, scope);

    if (!result.ok) return respondErr(res, req, result.status || 500, result.error || 'Failed to save bug report'), true;

    // AFTER the write, never before: the row is the record. Forwarding to
    // ClickUp (held for the operator) can fail without the reporter ever
    // knowing — the row is marked failed_forward and the failure is logged
    // loudly (lib/bugReportForward.js). Awaited on purpose: serverless freezes
    // the function once the response goes out.
    const forward = await forwardBugReport(result.data, scope);
    const data = { ...result.data, status: forward.ok ? 'forwarded' : 'failed_forward' };
    return respondJson(res, req, 201, { ok: true, data }), true;
  }

  return false;
}

module.exports = { handle, manifest };
