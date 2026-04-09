'use strict';

const {
  parseJsonBody,
  sendOk,
  sendErr,
  normalizeEmail,
  parseCookies,
} = require('./http');

const {
  createUser,
  authenticateUser,
  createSession,
  deleteSession,
  getUserFromSessionToken,
} = require('../lib/authStore');

const SESSION_COOKIE_NAME = 'app_session';
const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

function isSecureRequest(req) {
  const host = String(req.headers.host || '');
  if (host.includes('localhost') || host.includes('127.0.0.1')) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto.includes('https')) return true;
  return process.env.NODE_ENV === 'production';
}

function readSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const fromCookie = String(cookies[SESSION_COOKIE_NAME] || '').trim();
  if (fromCookie) return fromCookie;

  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function setSessionCookie(res, token, req) {
  const expiresDate = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toUTCString();
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(String(token || ''))}`,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    `Expires=${expiresDate}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res, req) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/auth')) return false;

  if (pathname === '/api/auth/me' && method === 'GET') {
    const token = readSessionToken(req);
    const user = await getUserFromSessionToken(token);
    if (!user) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    return sendOk(res, 200, { user }, { user }), true;
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    const created = await createUser({ name, email, password });
    if (!created.ok) return sendErr(res, created.status || 400, created.error || 'Unable to register', { code: 'REGISTER_FAILED' }), true;

    const session = await createSession(created.data.id);
    if (!session.ok) return sendErr(res, session.status || 500, session.error || 'Unable to create session', { code: 'SESSION_FAILED' }), true;

    setSessionCookie(res, session.data.token, req);
    const payload = { user: created.data, token: session.data.token };
    return sendOk(res, 201, payload, payload), true;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    const matched = await authenticateUser({ email, password });
    if (!matched.ok) return sendErr(res, matched.status || 401, matched.error || 'Invalid login', { code: 'LOGIN_FAILED' }), true;

    const session = await createSession(matched.data.id);
    if (!session.ok) return sendErr(res, session.status || 500, session.error || 'Unable to create session', { code: 'SESSION_FAILED' }), true;

    setSessionCookie(res, session.data.token, req);
    const payload = { user: matched.data, token: session.data.token };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = readSessionToken(req);
    if (token) await deleteSession(token);
    clearSessionCookie(res, req);
    return sendOk(res, 200, { loggedOut: true }, { loggedOut: true }), true;
  }

  return sendErr(res, 404, `Auth route not found: ${method} ${pathname}`, { code: 'NOT_FOUND' }), true;
}

module.exports = {
  handle,
  manifest: {
    id: 'auth',
    label: 'Authentication',
    prefixes: ['/api/auth'],
  },
  readSessionToken,
};
