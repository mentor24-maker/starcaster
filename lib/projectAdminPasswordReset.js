'use strict';

/**
 * Project-admin password reset — emailed one-time code.
 *
 * Tenant admins (brandonmarinoff.com/admin-login etc.) authenticate against
 * app_project_admin_users, not platform auth, so they cannot use
 * /api/auth/forgot-password. This is the equivalent flow for them.
 *
 * Deliberately NOT stored in app_project_admin_sessions (which is how the
 * platform flow in routes/auth.js does it): a row there is a live session, so
 * a reset code parked in that table doubles as a working session token. Codes
 * live in their own table, hashed, single-use, attempt-capped.
 *
 * Requires docs/SQL/project_admin_password_resets.sql to be applied.
 */

const crypto = require('crypto');
const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');
const {
  hashPassword,
  verifyPassword,
  updateAdminUserPassword,
  deleteAdminSessionsForUser,
} = require('./projectAdminStore');

const RESETS_TABLE = 'app_project_admin_password_resets';
const ADMIN_USERS_TABLE = 'app_project_admin_users';
const CODE_TTL_MS = 15 * 60 * 1000;   // 15 minutes
const MAX_ATTEMPTS = 5;

function safeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return safeText(value).toLowerCase();
}

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 503, error: 'Password reset requires Supabase configuration' };
  }
  return null;
}

/** Cryptographically uniform 6-digit code — Math.random() is not suitable here. */
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function findAdminUser(projectId, email) {
  const query = `select=id,email,project_id&project_id=eq.${encodeURIComponent(projectId)}`
    + `&email=eq.${encodeURIComponent(email)}&limit=1`;
  const result = await sbQuery({ method: 'GET', table: ADMIN_USERS_TABLE, query });
  if (!result.ok) return null;
  return Array.isArray(result.data) ? (result.data[0] || null) : null;
}

/**
 * Issue a reset code for a tenant admin.
 *
 * Returns { ok: true, data: { code, email, adminUserId } } when an account
 * exists, or { ok: true, data: null } when it does not — callers must respond
 * identically either way so a public endpoint cannot be used to enumerate
 * which email addresses have admin accounts.
 */
async function createPasswordResetCode({ projectId: projectIdInput, email: emailInput }) {
  const err = requireSupabase();
  if (err) return err;

  const projectId = safeText(projectIdInput);
  const email = normalizeEmail(emailInput);
  if (!projectId || !email) return { ok: false, status: 400, error: 'projectId and email are required' };

  const user = await findAdminUser(projectId, email);
  if (!user) return { ok: true, data: null };

  // Retire any codes still outstanding for this account so only the newest works.
  await sbQuery({
    method: 'PATCH',
    table: RESETS_TABLE,
    query: `admin_user_id=eq.${encodeURIComponent(user.id)}&used_at=is.null`,
    body: { used_at: new Date().toISOString() },
  });

  const code = generateCode();
  const now = Date.now();
  const row = {
    id: `pwreset_${now}_${crypto.randomBytes(4).toString('hex')}`,
    project_id: projectId,
    admin_user_id: safeText(user.id),
    email,
    code_hash: hashPassword(code),
    attempts: 0,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    used_at: null,
  };

  const inserted = await sbQuery({ method: 'POST', table: RESETS_TABLE, body: row });
  if (!inserted.ok) {
    return { ok: false, status: inserted.status || 500, error: inserted.error || 'Unable to store reset code' };
  }

  return { ok: true, data: { code, email, adminUserId: row.admin_user_id, ttlMinutes: CODE_TTL_MS / 60000 } };
}

/**
 * Verify a code and set the new password. Every failure returns the same
 * generic message so a caller cannot tell "wrong code" from "expired" from
 * "no such account".
 */
async function consumePasswordResetCode({
  projectId: projectIdInput,
  email: emailInput,
  code: codeInput,
  newPassword,
}) {
  const err = requireSupabase();
  if (err) return err;

  const projectId = safeText(projectIdInput);
  const email = normalizeEmail(emailInput);
  const code = safeText(codeInput);
  const password = String(newPassword || '');

  if (!projectId || !email || !code) {
    return { ok: false, status: 400, error: 'projectId, email and code are required' };
  }
  if (password.length < 8) {
    return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  }

  const invalid = { ok: false, status: 400, error: 'That code is invalid or has expired. Request a new one.' };

  const query = `select=*&project_id=eq.${encodeURIComponent(projectId)}`
    + `&email=eq.${encodeURIComponent(email)}&used_at=is.null`
    + `&order=created_at.desc&limit=1`;
  const result = await sbQuery({ method: 'GET', table: RESETS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to verify reset code' };

  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  if (!row) return invalid;
  if (new Date(row.expires_at).getTime() < Date.now()) return invalid;
  if (Number(row.attempts || 0) >= MAX_ATTEMPTS) return invalid;

  if (!verifyPassword(code, row.code_hash)) {
    await sbQuery({
      method: 'PATCH',
      table: RESETS_TABLE,
      query: `id=eq.${encodeURIComponent(row.id)}`,
      body: { attempts: Number(row.attempts || 0) + 1 },
    });
    return invalid;
  }

  const updated = await updateAdminUserPassword(row.admin_user_id, projectId, password);
  if (!updated.ok) return updated;

  await sbQuery({
    method: 'PATCH',
    table: RESETS_TABLE,
    query: `id=eq.${encodeURIComponent(row.id)}`,
    body: { used_at: new Date().toISOString() },
  });

  // A password change must not leave old sessions signed in.
  await deleteAdminSessionsForUser(row.admin_user_id);

  return { ok: true, data: { email } };
}

module.exports = {
  createPasswordResetCode,
  consumePasswordResetCode,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
};
