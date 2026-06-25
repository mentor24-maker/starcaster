'use strict';

/**
 * routes/index.js
 * Central API dispatcher. Single source of truth for all routes.
 *
 * Both entry points import from here:
 *   - server.js          (local dev, Node HTTP server)
 *   - api/[...slug].js   (Vercel serverless)
 *
 * ── Adding a new route module ──────────────────────────────────────────────
 *   1. Create routes/myModule.js exporting { handle, manifest }
 *      manifest shape: { id: string, label: string, prefixes: string[] }
 *   2. Import it below and add it to ROUTE_MODULES — that's it.
 *      Do NOT add routes to server.js or api/[...slug].js directly.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Rate limiting:
 *   A global ceiling is checked on every request here before routing.
 *   Per-endpoint limits are checked inside individual route handlers
 *   for expensive operations (acquire, openclaw, import).
 */

const { sendJson, sendErr, setCors, getUrlObj, normalizeApiPathname, getClientHost, getPublicSiteDomainParam, getPublicSiteDomainFromPath } = require('./http');
const { handleProjectDelete } = require('../lib/projectDeleteHandler');
const { checkLimit } = require('../lib/rateLimiter');
const { getProviderValues } = require('../lib/apiSettings');
const { getUserFromSessionToken, getAuthSession } = require('../lib/authStore');
const { getAdminSession } = require('../lib/projectAdminStore');
const { resolveCurrentProject } = require('../lib/projectsStore');
const { requireProjectContext } = require('../lib/requireProjectContext');

const auth        = require('./auth');
const projectAdmin = require('./projectAdmin');
const projects    = require('./projects');
const settings    = require('./settings');
const acquire     = require('./acquire');
const promoLeads  = require('./promoLeads');
const assets      = require('./assets');
const channels    = require('./channels');
const contacts    = require('./contacts');
const activityLog = require('./activityLog');
const config      = require('./config');
const messaging   = require('./messaging');
const engage      = require('./engage');
const builder     = require('./builder');
const communityAssets = require('./communityAssets');
const observe     = require('./observe');
const roger       = require('./devAgent');
const personas    = require('./personas');
const tasks       = require('./tasks');
const polls       = require('./polls');
const platformScreenshots = require('./platformScreenshots');
const crm         = require('./crm');
const blog        = require('./blog');
const admin       = require('./admin');
const publicSite  = require('./publicSite');

// Route modules are tried in order — first match wins.
// Put more specific / higher-traffic modules first.
const ROUTE_MODULES = [
  admin,
  auth,
  projectAdmin,
  projects,
  settings,
  acquire,
  promoLeads,
  assets,
  channels,
  contacts,
  engage,
  builder,
  communityAssets,
  messaging,
  activityLog,
  observe,
  config,
  roger,
  platformScreenshots,
  personas,
  tasks,
  polls,
  crm,
  blog,
  publicSite,
];

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function providerDebug(provider, envVar) {
  const fromEnv = String(process.env[envVar] || '').trim();
  const fromStore = String(getProviderValues(provider)?.api_key || '').trim();
  const selected = fromEnv || fromStore;
  const source = fromEnv ? 'env' : (fromStore ? 'settings' : 'none');
  return {
    provider,
    configured: Boolean(selected),
    source,
    key_hint: maskSecret(selected),
  };
}

const CRON_PATHS = new Set([
  '/api/engage/youtube-comment-agents/run-due',
  '/api/promote/social/posts/publish-due',
  '/api/engage/social/posts/publish-due',
]);

function isAuthorizedCronRequest(req, pathname) {
  if (!CRON_PATHS.has(pathname)) return false;
  const vercelCron = String(req?.headers?.['x-vercel-cron'] || '').trim();
  if (vercelCron) return true;
  const authHeader = String(req?.headers?.authorization || '').trim();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret || !authHeader.startsWith('Bearer ')) return false;
  return authHeader.slice('Bearer '.length).trim() === cronSecret;
}

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------

function logRegistry() {
  console.log('[APP] Route registry:');
  for (const mod of ROUTE_MODULES) {
    const { id, label, prefixes } = mod.manifest;
    console.log(`  [${id}] ${label}`);
    for (const prefix of prefixes) {
      console.log(`        ${prefix}/*`);
    }
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  setCors(res, req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const urlObjEarly = getUrlObj(req);
  const pathnameEarly = normalizeApiPathname(urlObjEarly.pathname);
  const methodEarly = String(req.method || '').toUpperCase();

  if (pathnameEarly === '/api/ping' && methodEarly === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: 'starcaster',
      message: 'API is up. Log in via the app, then use Import From Folder.',
    });
  }

  if (pathnameEarly === '/api/assets/import-drive-folder' && methodEarly === 'GET') {
    let importModuleOk = false;
    try {
      require('../lib/assetDriveFolderImport');
      importModuleOk = true;
    } catch {
      importModuleOk = false;
    }
    return sendJson(res, 200, {
      ok: true,
      registered: true,
      available: importModuleOk,
      path: '/api/assets/import-drive-folder',
      note: 'POST requires login. After login, use Assets → Import From Google Drive Folder.',
    });
  }

  if (pathnameEarly === '/api/assets/import-from-fields/status' && methodEarly === 'GET') {
    let importModuleOk = false;
    try {
      require('../lib/assetFieldImport');
      importModuleOk = true;
    } catch (err) {
      importModuleOk = false;
    }
    return sendJson(res, 200, {
      ok: true,
      registered: true,
      available: importModuleOk,
      path: '/api/assets/import-from-fields',
      handler: typeof assets.handleImportFromFields === 'function',
      note: 'POST requires login. After login, use Assets → Images or Messaging → Headlines → Import from Assets.',
    });
  }

  // ── Non-API page requests (custom domain routing) ───────────────────────
  if (isPageRequestPath(pathnameEarly, req)) {
    await handlePageRequest(req, res, pagePathnameForRequest(pathnameEarly));
    return;
  }

  // ── Global rate limit ceiling ────────────────────────────────────────────
  // Applied to every API request before any routing logic runs.
  // Expensive endpoints additionally check their own per-endpoint limit
  // inside their route handlers via checkEndpointLimit().
  if (checkLimit(req, res, 'global')) return;

  const urlObj   = getUrlObj(req);
  const pathname = normalizeApiPathname(urlObj.pathname);
  const method   = req.method;
  const isAuthRoute = pathname === '/api/auth' || pathname.startsWith('/api/auth/');
  const isAdminAuthRoute = pathname.startsWith('/api/admin/auth');
  const isAdminRoute = pathname.startsWith('/api/admin');
  const isDebugRoute = pathname === '/api/debug-routes';
  const isWebhookRoute = pathname === '/api/builder/devAgent/worker' || pathname.startsWith('/api/tasks');
  const isPublicContactSubmit = pathname === '/api/contact' && method === 'POST';
  const isPublicCrmRoute = (pathname === '/api/crm/contact-submit' && method === 'POST')
    || (/^\/api\/crm\/forms\/[^/]+$/.test(pathname) && method === 'GET');
  const isPublicSiteRoute = pathname.startsWith('/api/public/');
  const isFacebookOAuthCallback =
    pathname === '/api/promote/social/facebook/oauth/callback' && method === 'GET';
  const isImportDriveFolderHealth =
    pathname === assets.IMPORT_DRIVE_FOLDER_PATH && method === 'GET';
  const isCronAuthorized = isAuthorizedCronRequest(req, pathname);
  const sessionToken = auth.readSessionToken(req);
  const authSession = await getAuthSession(sessionToken);
  let authUser = authSession?.user || null;

  req.authSession = authSession || null;
  req.authUser = authUser || null;
  req.projectContext = null;
  req.cronPublish = isCronAuthorized;

  // For builder API calls and project-admin API calls, accept an admin
  // session in place of a platform session. Synthesize req.authUser and
  // req.projectContext so route handlers work without modification.
  // /api/admin/platform-users is excluded — that endpoint manages platform
  // auth users and must remain restricted to platform owners only.
  const isProjectAdminApiRoute = pathname.startsWith('/api/admin')
    && !pathname.startsWith('/api/admin/platform-users');
  if (!authUser && (pathname.startsWith('/api/builder') || isProjectAdminApiRoute)) {
    const adminToken = projectAdmin.readAdminSessionToken(req);
    if (adminToken) {
      const adminSession = await getAdminSession(adminToken);
      if (adminSession) {
        authUser = {
          id: adminSession.adminUserId,
          email: adminSession.adminUser.email,
          role: adminSession.adminUser.role,
          isProjectAdmin: true,
        };
        req.authUser = authUser;
        req.projectContext = {
          project: { id: adminSession.projectId },
          projects: [{ id: adminSession.projectId }],
          membership: null,
          resolvedFrom: 'admin_session',
        };
      }
    }
  }

  if (isImportDriveFolderHealth) {
    const handled = await assets.handleImportDriveFolder(req, res, {}, 'GET');
    if (handled) return;
  }

  if (!isAuthRoute && !isAdminAuthRoute && !isDebugRoute && !isWebhookRoute && !isCronAuthorized && !isFacebookOAuthCallback && !isPublicContactSubmit && !isPublicCrmRoute && !isPublicSiteRoute && !authUser) {

    return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' });
  }

  if (authUser && !authUser.isProjectAdmin && pathname.startsWith('/api/') && !isAuthRoute && !isAdminRoute && !isDebugRoute) {
    const requestedProjectId = String(req.headers['x-project-id'] || '').trim();
    const projectContextResult = await resolveCurrentProject({
      userId: String(authUser.id || '').trim(),
      requestedProjectId,
      sessionActiveProjectId: String(authSession?.activeProjectId || '').trim(),
      autoCreateDefault: false,
    });
    if (projectContextResult.ok) {
      req.projectContext = projectContextResult.data || null;
    }
  }

  if (
    authUser
    && pathname.startsWith('/api/')
    && !isAuthRoute
    && !isAdminRoute
    && !isDebugRoute
    && !isWebhookRoute
    && !isCronAuthorized
    && !isFacebookOAuthCallback
  ) {
    const projectRequired = requireProjectContext(req, pathname, method);
    if (!projectRequired.ok) {
      return sendErr(res, projectRequired.status || 400, projectRequired.message, { code: projectRequired.code });
    }
  }

  // Globally track the invocation to model Vercel edge/serverless boundaries natively
  if (pathname.startsWith('/api/') && req.projectContext) {
     const { logUsage } = require('../lib/observeStore');
     const scope = {
        projectId: req.projectContext.project?.id || '',
        userId: authUser?.id || ''
     };
     // Fire and forget to not block execution
     logUsage('vercel', 'api_request', 1, scope);
  }

  if (pathname === '/api/debug-routes' && method === 'GET') {
    const google = getProviderValues('google_drive');
    const openclaw = getProviderValues('openclaw');
    const openclawEnvBase = String(process.env.OPENCLAW_BASE_URL || '').trim();
    const openclawEnvKey = String(process.env.OPENCLAW_API_KEY || '').trim();
    const openclawEnvTimeout = String(process.env.OPENCLAW_TIMEOUT_MS || '').trim();
    const payload = {
      now: new Date().toISOString(),
      build: {
        commit: String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim() || null,
        branch: String(process.env.VERCEL_GIT_COMMIT_REF || '').trim() || null,
        deployment_url: String(process.env.VERCEL_URL || '').trim() || null,
        region: String(process.env.VERCEL_REGION || '').trim() || null,
      },
      routeModules: ROUTE_MODULES.map((mod) => ({
        id: mod?.manifest?.id || '',
        label: mod?.manifest?.label || '',
        prefixes: Array.isArray(mod?.manifest?.prefixes) ? mod.manifest.prefixes : [],
      })),
      llmProviders: [
        providerDebug('openai', 'OPENAI_API_KEY'),
        providerDebug('anthropic', 'ANTHROPIC_API_KEY'),
      ],
      googleOAuth: {
        configured: Boolean(
          String(google?.client_id || '').trim() &&
          String(google?.client_secret || '').trim() &&
          String(google?.refresh_token || '').trim()
        ),
        client_id_hint: maskSecret(google?.client_id || ''),
        refresh_token_hint: maskSecret(google?.refresh_token || ''),
      },
      openclawConfig: {
        configured: Boolean(String(openclaw?.base_url || '').trim() && String(openclaw?.api_key || '').trim()),
        base_url: String(openclaw?.base_url || '').trim(),
        api_key_hint: maskSecret(openclaw?.api_key || ''),
        timeout_ms: String(openclaw?.timeout_ms || '').trim(),
        base_url_source: openclawEnvBase ? 'env' : 'settings',
        api_key_source: openclawEnvKey ? 'env' : 'settings',
        timeout_source: openclawEnvTimeout ? 'env' : 'settings',
      },
      expectedAcquireRoutes: [
        'POST /api/acquire/youtube-comment-suggestions',
        'POST /api/acquire/youtube-comment',
      ],
      expectedDevAgentTeamRoutes: [
        'GET /api/builder/devAgent/team',
        'POST /api/builder/devAgent/team',
        'DELETE /api/builder/devAgent/team/:id',
      ],
      assetFeatures: {
        importDriveFolder: typeof assets.handleImportDriveFolder === 'function',
        importDriveFolderPath: assets.IMPORT_DRIVE_FOLDER_PATH || null,
        importFromFields: typeof assets.handleImportFromFields === 'function',
        importFromFieldsPath: assets.IMPORT_FROM_FIELDS_PATH || null,
        importDriveFolderModule: (() => {
          try {
            require('../lib/assetDriveFolderImport');
            return true;
          } catch {
            return false;
          }
        })(),
      },
    };
    return sendJson(res, 200, { ok: true, data: payload, ...payload });
  }

  try {
    if (assets.isImportDriveFolderPath(pathname) && (method === 'POST' || method === 'GET')) {
      const scope = {
        projectId: String(req?.projectContext?.project?.id || '').trim(),
        userId: String(req?.authUser?.id || '').trim(),
        projectIds: Array.isArray(req?.projectContext?.projects)
          ? req.projectContext.projects.map((project) => String(project?.id || '').trim()).filter(Boolean)
          : [],
      };
      const handled = await assets.handleImportDriveFolder(req, res, scope, String(method || '').toUpperCase());
      if (handled) return;
    }

    if (assets.isImportFromFieldsPath(pathname) && (method === 'POST' || method === 'GET')) {
      const scope = {
        projectId: String(req?.projectContext?.project?.id || '').trim(),
        userId: String(req?.authUser?.id || '').trim(),
        projectIds: Array.isArray(req?.projectContext?.projects)
          ? req.projectContext.projects.map((project) => String(project?.id || '').trim()).filter(Boolean)
          : [],
      };
      const handled = await assets.handleImportFromFields(req, res, scope, String(method || '').toUpperCase());
      if (handled) return;
    }

    if (messaging.isMessagingFormatImportPath(pathname) && method === 'POST') {
      const handled = await messaging.handleFormatImport(req, res, pathname, String(method || '').toUpperCase());
      if (handled) return;
    }

    const requestMethod = String(method || '').toUpperCase();
    if (authUser && pathname.startsWith('/api/projects')) {
      const deleteByIdMatch = pathname.match(/^\/api\/projects\/([^/]+)\/delete\/?$/);
      if (deleteByIdMatch && requestMethod === 'POST') {
        const projectId = decodeURIComponent(deleteByIdMatch[1] || '').trim();
        await handleProjectDelete(req, res, projectId, authUser.id);
        return;
      }
      if (pathname === '/api/projects/delete' && requestMethod === 'POST') {
        await handleProjectDelete(req, res, '', authUser.id);
        return;
      }
    }

    for (const mod of ROUTE_MODULES) {
      const handled = await mod.handle(req, res, pathname, method);
      if (handled) return;
    }
    sendErr(res, 404, `API route not found: ${method} ${pathname}`, { code: 'NOT_FOUND' });
  } catch (err) {
    console.error(`[routes] Unhandled error for ${method} ${pathname}:`, err);
    sendErr(res, 500, err.message || 'Internal server error', { code: 'INTERNAL_ERROR' });
  }
}

// ---------------------------------------------------------------------------
// Non-API page request handler (static files + custom domain routing)
// ---------------------------------------------------------------------------

const _fs   = require('fs');
const _path = require('path');

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

function isRegisteredApiPath(pathname) {
  const p = normalizeApiPathname(pathname);
  if (p === '/api') return true;
  if (CRON_PATHS.has(p)) return true;
  if (p === '/api/ping') return true;
  if (p === '/api/debug-routes') return true;
  if (p === '/api/contact') return true;
  if (p === '/api/assets/import-drive-folder') return true;
  if (p === '/api/assets/import-from-fields/status') return true;
  if (p === '/api/assets/import-from-fields') return true;
  if (p === '/api/builder/devAgent/worker') return true;
  for (const mod of ROUTE_MODULES) {
    const prefixes = Array.isArray(mod?.manifest?.prefixes) ? mod.manifest.prefixes : [];
    for (const prefix of prefixes) {
      const norm = normalizeApiPathname(prefix);
      if (p === norm || p.startsWith(`${norm}/`)) return true;
    }
  }
  return false;
}

function isPageRequestPath(pathname, req) {
  const p = normalizeApiPathname(pathname);
  if (p === '/api') return true;
  if (p === '/api/app-shell.html') return true;
  if (p === '/api/_site' || p.startsWith('/api/_site/')) return true;
  if (!p.startsWith('/api/')) return true;
  if (!isRegisteredApiPath(p)) {
    const host = getClientHost(req);
    if (host && !isSystemHost(host)) return true;
  }
  return false;
}

function pagePathnameForRequest(pathname) {
  const p = normalizeApiPathname(pathname);
  if (p === '/api') return '/';
  if (p === '/api/app-shell.html') return '/app-shell.html';
  if (p === '/api/_site') return '/_site';
  if (p.startsWith('/api/_site/')) return p.slice(4);
  if (p.startsWith('/api/') && !isRegisteredApiPath(p)) {
    return p.slice(4) || '/';
  }
  return p;
}

function isSystemHost(host) {
  if (!host) return true;
  if (/^localhost$|^127\.|^0\.0\.0\.0$/.test(host)) return true;
  if (host.endsWith('.vercel.app')) return true;
  if (host === 'starcaster.pro' || host.endsWith('.starcaster.pro')) return true;
  return false;
}

async function resolvePublicSiteProject(req, pathname) {
  const { findProjectByDomain } = require('../lib/projectsStore');
  const pathDomain = getPublicSiteDomainFromPath(pathname || '');
  const domainParam = getPublicSiteDomainParam(req);
  const host = getClientHost(req);
  const candidates = [];
  if (pathDomain) candidates.push(pathDomain);
  if (domainParam) candidates.push(domainParam);
  if (host && !isSystemHost(host)) candidates.push(host);
  const seen = new Set();
  for (const domain of candidates) {
    const key = String(domain || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const result = await findProjectByDomain(key);
    if (result.ok) return result;
  }
  return { ok: false };
}

function servePublicSiteHtml(res, projectId, projectName) {
  let siteHtml;
  try {
    siteHtml = _fs.readFileSync(_path.join(__dirname, '../public/site.html'), 'utf8');
  } catch {
    res.statusCode = 500;
    res.end('Site template unavailable');
    return true;
  }
  const config = JSON.stringify({ projectId, projectName });
  siteHtml = siteHtml.replace('</head>', `  <script>window.__SITE_CONFIG__ = ${config};</script>\n</head>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.statusCode = 200;
  res.end(siteHtml);
  return true;
}

function serveStaticPage(res, pathname) {
  const safePath = pathname.replace(/\.\./g, '').replace(/\/+/g, '/') || '/';
  if (isBootstrapPath(safePath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Public site bootstrap path unavailable');
    return;
  }
  if (safePath === '/app-shell.html') {
    const filePath = _path.join(__dirname, '../public/app-shell.html');
    try {
      const content = _fs.readFileSync(filePath);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.statusCode = 200;
      return res.end(content);
    } catch {
      res.statusCode = 404;
      return res.end('Not found');
    }
  }
  let filePath;
  if (safePath === '/') {
    filePath = _path.join(__dirname, '../public/app-shell.html');
  } else {
    const rel = safePath.replace(/^\//, '');
    filePath = _path.join(__dirname, '../public', rel);
    if (!_path.extname(safePath) && !_fs.existsSync(filePath)) {
      filePath += '.html';
    }
  }
  if (!_fs.existsSync(filePath)) {
    filePath = _path.join(__dirname, '../public/app-shell.html');
  }
  const ext = _path.extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  try {
    const content = _fs.readFileSync(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.statusCode = 200;
    return res.end(content);
  } catch {
    res.statusCode = 404;
    return res.end('Not found');
  }
}

function isBootstrapPath(pathname) {
  const p = normalizeApiPathname(pathname || '');
  return p === '/_site' || p === '/api/_site'
    || p.startsWith('/_site/') || p.startsWith('/api/_site/');
}

function redirectToCleanPublicPath(res, targetPath) {
  const path = String(targetPath || '/').trim() || '/';
  res.statusCode = 301;
  res.setHeader('Location', path.startsWith('/') ? path : `/${path}`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end();
}

async function handlePageRequest(req, res, pathname) {
  const urlObj = getUrlObj(req);

  if (isBootstrapPath(pathname)) {
    const result = await resolvePublicSiteProject(req, pathname);
    const restorePath = String(urlObj.searchParams.get('path') || '/').trim() || '/';
    if (result.ok) {
      res.setHeader('X-Site-Handler', 'bootstrap-redirect');
      redirectToCleanPublicPath(res, restorePath);
      return;
    }
    res.setHeader('X-Site-Handler', 'bootstrap-miss');
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Public site not found for this domain');
    return;
  }

  const result = await resolvePublicSiteProject(req, pathname);
  if (result.ok) {
    const { id: projectId, name: projectName } = result.data;
    res.setHeader('X-Site-Handler', 'resolved');
    servePublicSiteHtml(res, projectId, projectName);
    return;
  }

  const host = getClientHost(req);
  if (host && !isSystemHost(host)) {
    res.setHeader('X-Site-Handler', 'domain-miss');
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('No published site for this domain');
    return;
  }

  res.setHeader('X-Site-Handler', 'app-shell');
  serveStaticPage(res, pathname);
}

module.exports = { handleRequest, logRegistry, ROUTE_MODULES };
