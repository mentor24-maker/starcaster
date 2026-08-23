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
const {
  storeBugReportScreenshot,
  verifyBugReportScreenshots,
  markScreenshotsAttached,
  MAX_SCREENSHOT_BYTES: MAX_BUG_REPORT_SCREENSHOT_BYTES,
} = require('../lib/projectBugReportScreenshots');

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

/**
 * Which project a public bug-report request belongs to.
 *
 * On a tenant's own domain the host decides and the body's projectId may
 * only agree with it. On a system host (starcaster.pro, localhost, previews)
 * the host names no tenant, so the body's projectId is an unverified claim —
 * it is resolved against real projects first, or any string becomes a
 * tenant (the 1/5 review finding). Shared by the bug-report endpoints so they
 * can never disagree about who owns a report.
 */
async function resolveBugReportProject(req, projectIdInput) {
  const projectId = String(projectIdInput || '').trim();
  const bind = await assertProjectIdAllowedOnHost(req, projectId);
  if (!bind.ok) return { ok: false, status: bind.status || 403, error: bind.error, code: bind.code };
  if (bind.projectId) return { ok: true, projectId: String(bind.projectId) };
  // Plain language, not `projectId is required` / `Unknown project`: these two
  // are the only messages from this resolver a member of the public can read,
  // and both mean the same thing to them — the form on this page is not wired
  // to a site. Developer-speak in a visitor-facing dialog tells them nothing
  // they can act on. The `code` still carries the detail for the logs.
  if (!projectId) return { ok: false, status: 400, error: 'This report form is not connected to a site, so nothing could be sent.', code: 'VALIDATION_ERROR' };
  const project = await getPublicProjectById(projectId);
  if (!project.ok || !project.data) {
    return { ok: false, status: 404, error: 'This report form points to a site we do not recognise.', code: 'PROJECT_NOT_FOUND' };
  }
  return { ok: true, projectId: String(project.data.id) };
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

  // GET /api/public/bug-report/viewer?projectId=… — which visibility tier the
  // current browser is, for the Bug Report module's RENDER-side gating:
  // public (no tenant admin session), client (a signed-in tenant admin,
  // editor role), staff (admin role). This is UX, not security — the submit
  // endpoint below re-verifies the session before trusting a tier claim.
  if (pathname === '/api/public/bug-report/viewer' && (readMethod === 'GET' || readMethod === 'HEAD')) {
    // Same treatment as both neighbours below: unauthenticated, uncached, two
    // lookups per call (project resolve + admin session), and a gated module
    // fires it on every page load. checkEndpointLimit returns true when it has
    // ALREADY sent the 429 (CLAUDE.md landmine 11) — bail out, do not invert.
    if (checkEndpointLimit(req, res, 'public.bugReportViewer')) return true;

    const { searchParams } = getUrlObj(req);
    const resolved = await resolveBugReportProject(req, searchParams.get('projectId'));
    if (!resolved.ok) return respondErr(res, req, resolved.status, resolved.error, { code: resolved.code }), true;
    let tier = 'public';
    const token = projectAdmin.readAdminSessionToken(req);
    const session = token ? await getAdminSession(token) : null;
    if (session && String(session.projectId) === String(resolved.projectId)) {
      tier = session.adminUser?.isStaff || session.adminUser?.role === 'admin' ? 'staff' : 'client';
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return respondJson(res, req, 200, { ok: true, data: { tier } }), true;
  }

  // POST /api/public/bug-report/screenshot — one screenshot for a report that
  // is about to be submitted. Why one file per request, why magic bytes, and
  // the orphan cleanup rule: lib/projectBugReportScreenshots.js.
  if (pathname === '/api/public/bug-report/screenshot' && readMethod === 'POST') {
    if (checkEndpointLimit(req, res, 'public.bugReportScreenshot')) return true;

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (e) {
      // The body parser's own 10 MB ceiling fires BEFORE our size check can —
      // turn it into the same plain-language answer rather than a bare 500.
      const tooLarge = /too large/i.test(String(e?.message || ''));
      return respondErr(
        res,
        req,
        tooLarge ? 413 : 400,
        tooLarge
          ? `That screenshot is too large to upload. Screenshots must be ${Math.round(MAX_BUG_REPORT_SCREENSHOT_BYTES / (1024 * 1024))} MB or smaller.`
          : 'That upload could not be read — please pick the file again.',
        { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR' }
      ), true;
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return respondErr(res, req, 400, 'That upload could not be read — please pick the file again.', { code: 'VALIDATION_ERROR' }), true;
    }

    const resolved = await resolveBugReportProject(req, body.projectId);
    if (!resolved.ok) return respondErr(res, req, resolved.status, resolved.error, { code: resolved.code }), true;

    const stored = await storeBugReportScreenshot(
      { fileName: body.fileName, fileBase64: body.fileBase64 },
      { projectId: resolved.projectId }
    );
    if (!stored.ok) return respondErr(res, req, stored.status || 500, stored.error, { code: stored.code }), true;
    return respondJson(res, req, 201, { ok: true, data: stored.data }), true;
  }

  // POST /api/public/bug-report — bug-report intake, no auth required (any
  // tenant site visitor can hit this). See docs/SQL/project_bug_reports_setup.sql.
  if (pathname === '/api/public/bug-report' && readMethod === 'POST') {
    if (checkEndpointLimit(req, res, 'public.bugReport')) return true;

    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return respondErr(res, req, 400, 'A description is required', { code: 'VALIDATION_ERROR' }), true;
    }
    const description = String(body.description || '').trim();
    if (!description) return respondErr(res, req, 400, 'A description is required'), true;
    if (description.length > MAX_BUG_REPORT_DESCRIPTION_LENGTH) {
      return respondErr(res, req, 400, `Description must be ${MAX_BUG_REPORT_DESCRIPTION_LENGTH} characters or fewer`), true;
    }

    const resolved = await resolveBugReportProject(req, body.projectId);
    if (!resolved.ok) return respondErr(res, req, resolved.status, resolved.error, { code: resolved.code }), true;
    const scopedProjectId = resolved.projectId;

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

    // Screenshots were uploaded ahead of time (one request each) and are
    // attached here by (id, token) — the token proves this submitter uploaded
    // them, so guessed ids cannot harvest another reporter's screenshots.
    // `screenshots` is [{ id, token }] from the upload responses; the legacy
    // `screenshotAssetIds` shape carries no tokens and is refused (the task
    // 4/5 module must send `screenshots`).
    const scope = { projectId: scopedProjectId, userId: ownerUserId };
    const screenshotRefs = Array.isArray(body.screenshots) ? body.screenshots : body.screenshotAssetIds;
    const screenshots = await verifyBugReportScreenshots(screenshotRefs, scope);
    if (!screenshots.ok) return respondErr(res, req, screenshots.status || 400, screenshots.error, { code: screenshots.code }), true;

    const result = await createBugReport({
      description,
      pageUrl: body.pageUrl,
      userAgent: body.userAgent || req.headers['user-agent'] || '',
      viewerTier,
      screenshotAssetIds: screenshots.data.assetIds,
    }, scope);

    if (!result.ok) return respondErr(res, req, result.status || 500, result.error || 'Failed to save bug report'), true;

    // The row exists and references them; flipping pending → attached is the
    // orphan-sweep bookkeeping, best-effort by design (see the library header).
    if (screenshots.data.assetIds.length) await markScreenshotsAttached(screenshots.data.assetIds, { projectId: scopedProjectId });

    // AFTER the write, never before: the row is the record. Forwarding to
    // ClickUp (held for the operator) can fail without the reporter ever
    // knowing — the row is marked failed_forward and the failure is logged
    // loudly (lib/bugReportForward.js). Awaited on purpose: serverless freezes
    // the function once the response goes out.
    const forward = await forwardBugReport(result.data, scope);

    return respondJson(res, req, 201, {
      ok: true,
      data: {
        ...result.data,
        status: forward.ok ? 'forwarded' : 'failed_forward',
        screenshots: screenshots.data.assets,
      },
    }), true;
  }

  return false;
}

module.exports = { handle, manifest };
