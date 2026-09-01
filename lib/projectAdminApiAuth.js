'use strict';

/**
 * Tenant admin + public tenant site API auth helpers.
 *
 * Project admins on custom domains use app_admin_session (not platform app_session).
 * Public tenant pages read blog/CRM/theme data with X-Project-ID only.
 */

const { resolvePublicProjectForRequest } = require('./publicSiteHostBinding');

function readSearchParams(req) {
  try {
    if (req && req.url) {
      return new URL(String(req.url), 'https://site.local').searchParams;
    }
  } catch {
    /* ignore */
  }
  return new URLSearchParams();
}

/** Platform-only prefixes — never synthesize project-admin auth for these. */
const PROJECT_ADMIN_SESSION_DENY_PREFIXES = Object.freeze([
  '/api/auth',
  '/api/admin/auth',
  '/api/admin/platform-users',
  '/api/public/',
  '/api/acquire',
  '/api/promote',
  '/api/settings',
  '/api/tasks',
  '/api/observe',
  '/api/platform-screenshots',
  '/api/config',
  '/api/channels',
  '/api/personas',
  '/api/engage',
  '/api/contacts',
  '/api/activityLog',
  '/api/roger',
  '/api/projects',
  // Site Import is Alphire-staff-only (ratified decision 3): it captures
  // un-reviewed third-party sites, so tenant admins never see it.
  '/api/site-import',
  // Theme Wizard is agency-only for v1 (spec §2). It spends model tokens and
  // its apply step rewrites every page in the project, so the guardrail goes
  // in now rather than when tenants are eventually let in.
  '/api/builder/theme-wizard',

  // ── Asset endpoints a tenant admin does NOT get ──────────────────────────
  //
  // Most of /api/assets IS a tenant admin's own media and stays reachable —
  // that is what the Media Manager module runs on. These are the exceptions,
  // and the line between them is whose resources get spent, not whose data
  // gets touched. Everything below either bills the platform or reaches into
  // an Alphire-owned third-party account.
  //
  // AI generation bills Alphire's model account per call, and nothing caps a
  // tenant's use of it. Covers /generate, /generate/status, /generate/cancel.
  '/api/assets/generate',
  // Stock video search runs on a platform API key with a shared quota; one
  // tenant could exhaust it for every other tenant.
  '/api/assets/video/',
  // These three reach Alphire's own Google Drive with Alphire's credentials.
  // A tenant admin uploading there would be writing into the agency's Drive.
  '/api/assets/upload-google-drive',
  '/api/assets/import-drive-folder',
  '/api/assets/drive-file/',
  // Server-side image processing (sharp/sips) on platform compute, per asset
  // and unbounded. The Media Manager module does not need it; if a tenant
  // feature ever does, that is a decision to make with the feature.
  '/api/assets/bulk-resize',
  // Platform marketing tooling — pours asset fields into draft tweets on
  // Alphire's own channels. Not a tenant surface.
  '/api/assets/import-from-fields',
]);

function isPublicCrmRoute(pathname, method) {
  const requestMethod = String(method || '').toUpperCase();
  return (pathname === '/api/crm/contact-submit' && requestMethod === 'POST')
    || (/^\/api\/crm\/forms\/[^/]+$/.test(pathname) && requestMethod === 'GET');
}

/**
 * Read-only routes public tenant pages may call without login.
 * Requires a valid X-Project-ID bound to the request host.
 */
function isPublicTenantContentReadRoute(pathname, method, req) {
  const requestMethod = String(method || '').toUpperCase();
  if (requestMethod !== 'GET' && requestMethod !== 'HEAD') return false;

  if (pathname === '/api/blog/posts') {
    const status = String(readSearchParams(req).get('status') || '').trim().toLowerCase();
    return status === 'published';
  }
  if (/^\/api\/blog\/posts\/[^/]+$/.test(pathname)) {
    return String(readSearchParams(req).get('by') || '').trim().toLowerCase() === 'slug';
  }
  if (pathname === '/api/blog/categories' || /^\/api\/blog\/categories\/[^/]+$/.test(pathname)) return true;

  /*
   * EVENTS — the public calendar's read path, and nothing more.
   *
   * Deliberately the same two openings the blog has, for the same reason: a
   * visitor on a tenant site has no login, and a calendar that cannot be read
   * without one is not a public calendar. Both are narrow:
   *
   *   - the LIST only when it explicitly asks for published events, so an
   *     unauthenticated caller cannot ask for drafts by leaving the filter off;
   *   - a SINGLE event only by slug, and routes/events.js additionally refuses
   *     any event that is not published when there is no session — a draft or a
   *     cancelled-but-unpublished event 404s to a visitor.
   *
   * Everything else about /api/events — creating, editing, deleting, and the
   * unfiltered list the admin manager uses — still requires a session.
   */
  if (pathname === '/api/events') {
    const status = String(readSearchParams(req).get('status') || '').trim().toLowerCase();
    return status === 'published';
  }
  if (/^\/api\/events\/[^/]+$/.test(pathname)) {
    return String(readSearchParams(req).get('by') || '').trim().toLowerCase() === 'slug';
  }
  if (pathname === '/api/messaging/tags' || pathname === '/api/messaging/topics') return true;
  if (pathname === '/api/community-assets') return true;
  if (pathname === '/api/builder/themes') return true;
  if (/^\/api\/polls(\/|$)/.test(pathname)) return true;
  if (pathname === '/api/blog/card-template') return true;

  return false;
}

function acceptsProjectAdminSession(pathname, options = {}) {
  const path = String(pathname || '');
  if (!path.startsWith('/api/')) return false;
  if (options.isPublicCrmRoute) return false;
  if (isPublicTenantContentReadRoute(path, options.method, options.req)) return false;
  if (path === '/api/contact' || path === '/api/debug-routes') return false;

  for (const prefix of PROJECT_ADMIN_SESSION_DENY_PREFIXES) {
    if (path.startsWith(prefix)) return false;
  }

  return true;
}

/**
 * Mint a project context for an unauthenticated public tenant page.
 *
 * These are reads of already-public content, but this is also what lets the
 * request past the 401 in routes/index.js — so it uses the verifying resolver
 * rather than the read-only host check. On a system host that means a
 * fabricated X-Project-ID now gets no context (and therefore a 401) instead of
 * an empty 200 pretending a tenant exists.
 */
async function resolvePublicTenantProjectContext(req) {
  const projectId = String(req.headers['x-project-id'] || '').trim();
  if (!projectId) return null;

  const bind = await resolvePublicProjectForRequest(req, projectId);
  if (!bind.ok) return null;

  const scopedId = bind.projectId;
  return {
    project: { id: scopedId },
    projects: [{ id: scopedId }],
    membership: null,
    resolvedFrom: 'public_tenant_header',
  };
}

module.exports = {
  PROJECT_ADMIN_SESSION_DENY_PREFIXES,
  acceptsProjectAdminSession,
  isPublicCrmRoute,
  isPublicTenantContentReadRoute,
  resolvePublicTenantProjectContext,
};
