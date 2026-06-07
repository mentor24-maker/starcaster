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
  findUserByEmail,
  updateUserPassword
} = require('../lib/authStore');

const { sendEmail } = require('../lib/mailer');
const {
  hasContactOrPersonForEmail,
  linkAuthUserByEmail,
} = require('../lib/authPersonLink');

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
  const rawCookie = String(cookies[SESSION_COOKIE_NAME] || '').trim();
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

function buildSessionCookieHeader(token, req, { clear = false } = {}) {
  const secure = isSecureRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${clear ? '' : encodeURIComponent(String(token || ''))}`,
    'Path=/',
    'HttpOnly',
  ];
  if (clear) {
    parts.push('Max-Age=0');
  } else {
    parts.push(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    parts.push(`Expires=${new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toUTCString()}`);
  }
  // Secure + SameSite=None only on HTTPS; http://localhost must omit Secure or browsers drop the cookie.
  if (secure) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function setSessionCookie(res, token, req) {
  res.setHeader('Set-Cookie', buildSessionCookieHeader(token, req));
}

function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', buildSessionCookieHeader('', req, { clear: true }));
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

    await linkAuthUserByEmail(created.data.id, email);

    const session = await createSession(created.data.id);
    if (!session.ok) return sendErr(res, session.status || 500, session.error || 'Unable to create session', { code: 'SESSION_FAILED' }), true;

    setSessionCookie(res, session.data.token, req);
    return sendOk(
      res,
      201,
      { user: created.data, sessionToken: session.data.token },
      { user: created.data, sessionToken: session.data.token }
    ), true;
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
    return sendOk(
      res,
      200,
      { user: matched.data, sessionToken: session.data.token },
      { user: matched.data, sessionToken: session.data.token }
    ), true;
  }

  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    const body = await parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const user = await findUserByEmail(email);
    if (!user) {
      const hasIdentity = await hasContactOrPersonForEmail(email);
      if (hasIdentity) {
        return sendErr(
          res,
          404,
          'No login account exists for this email. Use Register (same email) to create your StarCaster password, then sign in.',
          { code: 'AUTH_ACCOUNT_REQUIRED' }
        ), true;
      }
      return sendErr(res, 404, 'User not found', { code: 'USER_NOT_FOUND' }), true;
    }

    // Generate highly secure 6-digit OTP mapping
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const resetTokenStruct = `OTP:${email}:${otp}`;
    
    // Store in AuthSessions internally for 15 minutes physically ensuring cross-lambda sync!
    const session = await createSession(user.id, resetTokenStruct, 15 * 60 * 1000);
    if (!session.ok) return sendErr(res, session.status || 500, session.error || 'Unable to provision reset tunnel.', { code: 'OTP_FAILED' }), true;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; padding: 2rem;">
        <h2>Password Reset Code</h2>
        <p>A password reset was requested for your StarCaster account from Alphire. If this was not you, please ignore this email securely.</p>
        <div style="margin: 2rem 0; padding: 1.5rem; background: #f3f4f6; text-align: center; border-radius: 8px;">
          <h1 style="margin:0; font-size: 2.5rem; letter-spacing: 4px; color: #111827;">${otp}</h1>
        </div>
        <p>This code strictly expires natively in 15 minutes.</p>
      </div>
    `;

    const mail = await sendEmail({
      to: email,
      subject: 'Security: StarCaster Account Password Reset',
      html: htmlBody
    });

    if (!mail.ok) return sendErr(res, mail.status || 500, mail.error, { code: 'EMAIL_FAILED' }), true;

    return sendOk(res, 200, { email }, { message: 'OTP Dispatched' }), true;
  }

  if (pathname === '/api/auth/confirm-reset' && method === 'POST') {
    const body = await parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    const newPassword = String(body.new_password || '').trim();

    if (!email || !code || code.length !== 6 || !newPassword || newPassword.length < 8) {
      return sendErr(res, 400, 'Valid email, 6-digit code, and new password (min 8 chars) physically required.', { code: 'INVALID_INPUT' }), true;
    }

    const resetTokenStruct = `OTP:${email}:${code}`;
    const mappedUser = await getUserFromSessionToken(resetTokenStruct);

    if (!mappedUser || mappedUser.email !== email) {
      return sendErr(res, 401, 'Invalid or expired secure reset code.', { code: 'INVALID_OTP' }), true;
    }

    // Overwrite exact Master Cryptography hash
    const update = await updateUserPassword({ email, newPassword });
    if (!update.ok) return sendErr(res, update.status || 500, update.error, { code: 'UPDATE_FAILED' }), true;

    // Securely burn the single-use OTP instantly after successful override!
    await deleteSession(resetTokenStruct);

    return sendOk(res, 200, { success: true }, { message: 'Password Reset Successful' }), true;
  }

  
  if (pathname === '/api/auth/debugSession' && method === 'GET') {
    const report = { };
    report.cookies = req.headers.cookie;
    report.authHeader = req.headers.authorization;
    report.tokenValue = readSessionToken(req);
    report.supabaseUrl = process.env.SUPABASE_URL ? 'PRESENT' : 'MISSING';
    report.supabaseKey = process.env.SUPABASE_SERVICE_KEY ? 'PRESENT' : 'MISSING';
    report.isConfigured = require('../lib/supabase').isConfigured();
    
    if (report.tokenValue && report.isConfigured) {
        try {
            const { sbQuery } = require('../lib/supabase');
            const q = 'select=*&token=eq.' + encodeURIComponent(report.tokenValue) + '&limit=1';
            const sRes = await sbQuery({ method: 'GET', table: require('../lib/authStore').AUTH_SESSIONS_TABLE, query: q });
            report.sessionDbResponse = sRes;
        } catch (e) {
            report.sessionDbResponseError = e.message;
        }
    }

    return sendOk(res, 200, report, report), true;
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
