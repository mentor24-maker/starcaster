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

const { sendJson, sendErr, setCors, getUrlObj } = require('./http');
const { checkLimit } = require('../lib/rateLimiter');
const { getProviderValues } = require('../lib/apiSettings');
const { getUserFromSessionToken } = require('../lib/authStore');
const { resolveCurrentProject } = require('../lib/projectsStore');

const auth        = require('./auth');
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
const develop     = require('./develop');

// Route modules are tried in order — first match wins.
// Put more specific / higher-traffic modules first.
const ROUTE_MODULES = [
  auth,
  projects,
  settings,
  acquire,
  promoLeads,
  assets,
  channels,
  contacts,
  engage,
  develop,
  messaging,
  activityLog,
  config,
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
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // ── Global rate limit ceiling ────────────────────────────────────────────
  // Applied to every API request before any routing logic runs.
  // Expensive endpoints additionally check their own per-endpoint limit
  // inside their route handlers via checkEndpointLimit().
  if (checkLimit(req, res, 'global')) return;

  const urlObj   = getUrlObj(req);
  const pathname = urlObj.pathname;
  const method   = req.method;
  const isAuthRoute = pathname === '/api/auth' || pathname.startsWith('/api/auth/');
  const isDebugRoute = pathname === '/api/debug-routes';
  const sessionToken = auth.readSessionToken(req);
  const authUser = await getUserFromSessionToken(sessionToken);
  req.authUser = authUser || null;
  req.projectContext = null;

  if (!isAuthRoute && !isDebugRoute && !authUser) {
    return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' });
  }

  if (authUser && pathname.startsWith('/api/') && !isAuthRoute && !isDebugRoute) {
    const requestedProjectId = String(req.headers['x-project-id'] || '').trim();
    const projectContextResult = await resolveCurrentProject({
      userId: String(authUser.id || '').trim(),
      requestedProjectId,
      autoCreateDefault: true,
    });
    if (projectContextResult.ok) {
      req.projectContext = projectContextResult.data || null;
    }
  }

  if (pathname === '/api/debug-routes' && method === 'GET') {
    const google = getProviderValues('google_drive');
    const payload = {
      now: new Date().toISOString(),
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
      expectedAcquireRoutes: [
        'POST /api/acquire/youtube-comment-suggestions',
        'POST /api/acquire/youtube-comment',
      ],
    };
    return sendJson(res, 200, { ok: true, data: payload, ...payload });
  }

  try {
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

module.exports = { handleRequest, logRegistry, ROUTE_MODULES };
