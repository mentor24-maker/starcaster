'use strict';

const {
  parseJsonBody,
  sendOk,
  sendErr,
  parseCookies,
  getUrlObj,
} = require('./http');

const {
  createAdminUser,
  authenticateAdminUser,
  createAdminSession,
  deleteAdminSession,
  getAdminSession,
  listAdminUsers,
  updateAdminUser,
  deleteAdminUser,
} = require('../lib/projectAdminStore');
const { sbQuery, isConfigured: isSupabaseConfigured } = require('../lib/supabase');
const PROJECTS_TABLE = 'app_projects';

const ADMIN_SESSION_COOKIE_NAME = 'app_admin_session';
const ADMIN_NAV_COOKIE_NAME = 'app_admin_nav';
const ADMIN_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
// Just a "this browser has been an admin before" marker, not a proof of an active session —
// give it the longest lifetime browsers actually honor (Chrome caps Set-Cookie Max-Age at
// 400 days) rather than tying it to the session length, so it outlives logouts and session expiry.
const ADMIN_NAV_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function isSecureRequest(req) {
  const host = String(req.headers.host || '');
  if (host.includes('localhost') || host.includes('127.0.0.1')) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto.includes('https')) return true;
  return process.env.NODE_ENV === 'production';
}

function readAdminSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const rawCookie = String(cookies[ADMIN_SESSION_COOKIE_NAME] || '').trim();
  if (rawCookie) {
    try {
      return decodeURIComponent(rawCookie).trim() || rawCookie;
    } catch {
      return rawCookie;
    }
  }
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function buildAdminSessionCookieHeader(token, req, { clear = false } = {}) {
  const secure = isSecureRequest(req);
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${clear ? '' : encodeURIComponent(String(token || ''))}`,
    'Path=/',
    'HttpOnly',
  ];
  if (clear) {
    parts.push('Max-Age=0');
  } else {
    parts.push(`Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`);
    parts.push(`Expires=${new Date(Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000).toUTCString()}`);
  }
  if (secure) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function buildAdminNavCookieHeader(req) {
  const secure = isSecureRequest(req);
  const parts = [
    `${ADMIN_NAV_COOKIE_NAME}=1`,
    'Path=/',
    `Max-Age=${ADMIN_NAV_COOKIE_MAX_AGE_SECONDS}`,
    `Expires=${new Date(Date.now() + ADMIN_NAV_COOKIE_MAX_AGE_SECONDS * 1000).toUTCString()}`,
  ];
  if (secure) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function setAdminSessionCookie(res, token, req) {
  res.setHeader('Set-Cookie', [
    buildAdminSessionCookieHeader(token, req),
    buildAdminNavCookieHeader(req),
  ]);
}

// Clears the auth-of-record session cookie only. The nav cookie is intentionally left in
// place on logout — it's a "this browser has been an admin before" signal used to decide
// whether to show the admin-nav-link module, not a proof of an active session, so it should
// persist until manually cleared (e.g. by the visitor clearing cookies).
function clearAdminSessionCookie(res, req) {
  res.setHeader('Set-Cookie', [
    buildAdminSessionCookieHeader('', req, { clear: true }),
  ]);
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/admin')) return false;

  // POST /api/admin/auth/login
  if (pathname === '/api/admin/auth/login' && method === 'POST') {
    const body = await parseJsonBody(req);
    const projectId = String(body.projectId || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!projectId || !email || !password) {
      return sendErr(res, 400, 'projectId, email, and password are required', { code: 'ADMIN_LOGIN_INVALID' }), true;
    }

    const auth = await authenticateAdminUser({ projectId, email, password });
    if (!auth.ok) {
      return sendErr(res, auth.status || 401, auth.error || 'Invalid credentials', { code: 'ADMIN_AUTH_FAILED' }), true;
    }

    const session = await createAdminSession(auth.data.id, projectId);
    if (!session.ok) {
      return sendErr(res, session.status || 500, session.error || 'Unable to create session', { code: 'ADMIN_SESSION_FAILED' }), true;
    }

    setAdminSessionCookie(res, session.data.token, req);
    return sendOk(res, 200, { adminUser: auth.data, sessionToken: session.data.token }, { adminUser: auth.data, sessionToken: session.data.token }), true;
  }

  // GET /api/admin/auth/me
  if (pathname === '/api/admin/auth/me' && method === 'GET') {
    const token = readAdminSessionToken(req);
    const session = await getAdminSession(token);
    if (!session) {
      return sendErr(res, 401, 'Not authenticated', { code: 'ADMIN_AUTH_REQUIRED' }), true;
    }
    return sendOk(res, 200, { adminUser: session.adminUser, projectId: session.projectId }, { adminUser: session.adminUser, projectId: session.projectId }), true;
  }

  // POST /api/admin/auth/logout
  if (pathname === '/api/admin/auth/logout' && method === 'POST') {
    const token = readAdminSessionToken(req);
    if (token) await deleteAdminSession(token);
    clearAdminSessionCookie(res, req);
    return sendOk(res, 200, { loggedOut: true }, { loggedOut: true }), true;
  }

  // POST /api/admin/users — platform-owner creates admin user credentials
  // Requires a valid platform session (req.authUser set by routes/index.js).
  if (pathname === '/api/admin/users' && method === 'POST') {
    if (!req.authUser) {
      return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    }

    const body = await parseJsonBody(req);
    const projectId = String(body.projectId || req.projectContext?.project?.id || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = String(body.role || 'editor').trim();

    if (!projectId || !email || !password) {
      return sendErr(res, 400, 'projectId, email, and password are required', { code: 'ADMIN_USER_INVALID' }), true;
    }

    const ownerProjectId = String(req.projectContext?.project?.id || req.headers['x-project-id'] || '').trim();
    if (projectId !== ownerProjectId) {
      return sendErr(res, 403, 'You can only create admin users for your active project', { code: 'ADMIN_USER_FORBIDDEN' }), true;
    }

    const created = await createAdminUser({ projectId, email, password, role });
    if (!created.ok) {
      return sendErr(res, created.status || 400, created.error || 'Unable to create admin user', { code: 'ADMIN_USER_CREATE_FAILED' }), true;
    }

    return sendOk(res, 201, created.data, { adminUser: created.data }), true;
  }

  // GET /api/admin/users — list admin users for the active project
  if (pathname === '/api/admin/users' && method === 'GET') {
    if (!req.authUser) {
      return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    }
    const projectId = String(
      req.projectContext?.project?.id ||
      req.headers['x-project-id'] ||
      getUrlObj(req).searchParams?.get('projectId') || ''
    ).trim();
    if (!projectId) {
      return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    }
    const result = await listAdminUsers(projectId);
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error || 'Unable to list admin users', { code: 'ADMIN_USER_LIST_FAILED' }), true;
    }
    return sendOk(res, 200, result.data, { adminUsers: result.data }), true;
  }

  // PUT /api/admin/users/:id — update role for a project admin user
  const userIdMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/?$/);

  if (userIdMatch && method === 'PUT') {
    if (!req.authUser) {
      return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    }
    const adminUserId = decodeURIComponent(userIdMatch[1] || '').trim();
    const projectId = String(req.projectContext?.project?.id || req.headers['x-project-id'] || '').trim();
    if (!projectId) {
      return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    }
    const body = await parseJsonBody(req);
    const result = await updateAdminUser(adminUserId, projectId, { role: body.role });
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error || 'Unable to update admin user', { code: 'ADMIN_USER_UPDATE_FAILED' }), true;
    }
    return sendOk(res, 200, result.data, { adminUser: result.data }), true;
  }

  // GET /api/admin/enabled-modules — return project's enabled_modules JSON
  if (pathname === '/api/admin/enabled-modules' && method === 'GET') {
    const projectId = String(
      req.projectContext?.project?.id ||
      req.headers['x-project-id'] ||
      getUrlObj(req).searchParams?.get('projectId') || ''
    ).trim();
    if (!projectId) return sendErr(res, 400, 'Project ID is required', { code: 'PROJECT_REQUIRED' }), true;
    if (!isSupabaseConfigured()) return sendErr(res, 503, 'Supabase required', { code: 'SUPABASE_REQUIRED' }), true;
    const query = `select=id,enabled_modules&id=eq.${encodeURIComponent(projectId)}&limit=1`;
    const result = await sbQuery({ method: 'GET', table: PROJECTS_TABLE, query });
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Failed to fetch project'), true;
    const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
    if (!row) return sendErr(res, 404, 'Project not found', { code: 'NOT_FOUND' }), true;
    const enabledModules = (row.enabled_modules && typeof row.enabled_modules === 'object') ? row.enabled_modules : {};
    return sendOk(res, 200, enabledModules, { enabledModules }), true;
  }

  // PATCH /api/admin/enabled-modules — toggle premium module groups on/off
  if (pathname === '/api/admin/enabled-modules' && method === 'PATCH') {
    const projectId = String(
      req.projectContext?.project?.id ||
      req.headers['x-project-id'] || ''
    ).trim();
    if (!projectId) return sendErr(res, 400, 'Project ID is required', { code: 'PROJECT_REQUIRED' }), true;
    if (!isSupabaseConfigured()) return sendErr(res, 503, 'Supabase required', { code: 'SUPABASE_REQUIRED' }), true;
    const body = await parseJsonBody(req);
    const modulePatch = (body.modules && typeof body.modules === 'object' && !Array.isArray(body.modules))
      ? body.modules : {};
    const fetchResult = await sbQuery({ method: 'GET', table: PROJECTS_TABLE, query: `select=enabled_modules&id=eq.${encodeURIComponent(projectId)}&limit=1` });
    if (!fetchResult.ok) return sendErr(res, fetchResult.status || 500, 'Failed to fetch project'), true;
    const row = Array.isArray(fetchResult.data) ? (fetchResult.data[0] || null) : null;
    const current = (row?.enabled_modules && typeof row.enabled_modules === 'object') ? row.enabled_modules : {};
    const updated = { ...current, ...modulePatch };
    const patchResult = await sbQuery({
      method: 'PATCH',
      table: PROJECTS_TABLE,
      query: `id=eq.${encodeURIComponent(projectId)}`,
      body: { enabled_modules: updated },
      headers: { Prefer: 'return=representation' },
    });
    if (!patchResult.ok) return sendErr(res, patchResult.status || 500, 'Failed to update enabled modules'), true;
    return sendOk(res, 200, updated, { enabledModules: updated }), true;
  }

  // GET /api/admin/clusters — list all platform-level clusters
  if (pathname === '/api/admin/clusters' && method === 'GET') {
    if (!isSupabaseConfigured()) return sendErr(res, 503, 'Supabase required', { code: 'SUPABASE_REQUIRED' }), true;
    const result = await sbQuery({ method: 'GET', table: 'builder_clusters', query: 'select=id,name,is_private,created_at&order=created_at.asc' });
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Failed to fetch clusters'), true;
    const clusters = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, clusters, { clusters }), true;
  }

  // POST /api/admin/clusters — create a cluster
  if (pathname === '/api/admin/clusters' && method === 'POST') {
    if (!isSupabaseConfigured()) return sendErr(res, 503, 'Supabase required', { code: 'SUPABASE_REQUIRED' }), true;
    const body = await parseJsonBody(req);
    const name = String(body?.name || '').trim();
    if (!name) return sendErr(res, 400, 'Cluster name is required', { code: 'VALIDATION_ERROR' }), true;
    const isPrivate = body?.isPrivate === true || body?.is_private === true;
    const result = await sbQuery({
      method: 'POST',
      table: 'builder_clusters',
      body: { name, is_private: isPrivate },
      headers: { Prefer: 'return=representation' },
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Failed to create cluster'), true;
    const created = Array.isArray(result.data) ? (result.data[0] || null) : null;
    return sendOk(res, 201, created, { cluster: created }), true;
  }

  // PATCH /api/admin/clusters/:id — update cluster name or privacy
  const clusterIdMatch = pathname.match(/^\/api\/admin\/clusters\/([^/]+)\/?$/);
  if (clusterIdMatch && method === 'PATCH') {
    if (!isSupabaseConfigured()) return sendErr(res, 503, 'Supabase required', { code: 'SUPABASE_REQUIRED' }), true;
    const clusterId = decodeURIComponent(clusterIdMatch[1] || '').trim();
    if (!clusterId) return sendErr(res, 400, 'Cluster ID is required', { code: 'VALIDATION_ERROR' }), true;
    const body = await parseJsonBody(req);
    const patch = {};
    if (body?.name !== undefined) patch.name = String(body.name || '').trim();
    if (body?.isPrivate !== undefined || body?.is_private !== undefined) {
      patch.is_private = (body?.isPrivate ?? body?.is_private) === true;
    }
    const result = await sbQuery({
      method: 'PATCH',
      table: 'builder_clusters',
      query: `id=eq.${encodeURIComponent(clusterId)}`,
      body: patch,
      headers: { Prefer: 'return=representation' },
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Failed to update cluster'), true;
    const updated = Array.isArray(result.data) ? (result.data[0] || null) : null;
    return sendOk(res, 200, updated, { cluster: updated }), true;
  }

  // DELETE /api/admin/clusters/:id — remove a cluster
  if (clusterIdMatch && method === 'DELETE') {
    if (!isSupabaseConfigured()) return sendErr(res, 503, 'Supabase required', { code: 'SUPABASE_REQUIRED' }), true;
    const clusterId = decodeURIComponent(clusterIdMatch[1] || '').trim();
    if (!clusterId) return sendErr(res, 400, 'Cluster ID is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await sbQuery({
      method: 'DELETE',
      table: 'builder_clusters',
      query: `id=eq.${encodeURIComponent(clusterId)}`,
      headers: { Prefer: 'return=minimal' },
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Failed to delete cluster'), true;
    return sendOk(res, 200, { deleted: true }, { deleted: true }), true;
  }

  // DELETE /api/admin/users/:id — platform owner removes an admin user
  const deleteUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/?$/);
  if (deleteUserMatch && method === 'DELETE') {
    if (!req.authUser) {
      return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    }
    const adminUserId = decodeURIComponent(deleteUserMatch[1] || '').trim();
    const projectId = String(
      req.projectContext?.project?.id ||
      req.headers['x-project-id'] ||
      getUrlObj(req).searchParams?.get('projectId') || ''
    ).trim();
    if (!projectId) {
      return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    }
    const result = await deleteAdminUser(adminUserId, projectId);
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error || 'Unable to delete admin user', { code: 'ADMIN_USER_DELETE_FAILED' }), true;
    }
    return sendOk(res, 200, { deleted: true }, { deleted: true }), true;
  }

  return false;
}

module.exports = {
  handle,
  manifest: {
    id: 'projectAdmin',
    label: 'Project Admin',
    prefixes: ['/api/admin'],
  },
  readAdminSessionToken,
};
