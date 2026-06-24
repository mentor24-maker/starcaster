'use strict';

const crypto = require('crypto');
const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const ADMIN_USERS_TABLE = 'app_project_admin_users';
const ADMIN_SESSIONS_TABLE = 'app_project_admin_sessions';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 503, error: 'Project Admin requires Supabase configuration' };
  }
  return null;
}

function safeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return safeText(value).toLowerCase();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashPassword(passwordInput, saltInput = '') {
  const password = String(passwordInput || '');
  const salt = saltInput || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(passwordInput, storedHash) {
  const text = safeText(storedHash);
  if (!text.includes(':')) return false;
  const [salt, existing] = text.split(':');
  if (!salt || !existing) return false;
  const next = hashPassword(passwordInput, salt).split(':')[1];
  try {
    return crypto.timingSafeEqual(Buffer.from(existing, 'hex'), Buffer.from(next, 'hex'));
  } catch {
    return false;
  }
}

function sanitizeAdminUser(row) {
  return {
    id: safeText(row?.id),
    projectId: safeText(row?.project_id),
    email: normalizeEmail(row?.email),
    role: safeText(row?.role) || 'editor',
    createdAt: safeText(row?.created_at),
  };
}

async function createAdminUser({ projectId, email, password, role = 'editor' }) {
  const err = requireSupabase();
  if (err) return err;

  const pid = safeText(projectId);
  const addr = normalizeEmail(email);
  const pwd = String(password || '');
  const userRole = ['admin', 'editor'].includes(String(role || '').trim()) ? String(role).trim() : 'editor';

  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };
  if (!addr) return { ok: false, status: 400, error: 'email is required' };
  if (!pwd || pwd.length < 8) return { ok: false, status: 400, error: 'Password must be at least 8 characters' };

  const checkQuery = `select=id&project_id=eq.${encodeURIComponent(pid)}&email=eq.${encodeURIComponent(addr)}&limit=1`;
  const existing = await sbQuery({ method: 'GET', table: ADMIN_USERS_TABLE, query: checkQuery });
  if (!existing.ok) return { ok: false, status: existing.status || 500, error: existing.error || 'Unable to check for existing user' };
  if (Array.isArray(existing.data) && existing.data.length > 0) {
    return { ok: false, status: 409, error: 'An admin account with that email already exists for this project' };
  }

  const now = new Date().toISOString();
  const row = {
    id: makeId('admusr'),
    project_id: pid,
    email: addr,
    password_hash: hashPassword(pwd),
    role: userRole,
    created_at: now,
    updated_at: now,
  };

  const inserted = await sbQuery({
    method: 'POST',
    table: ADMIN_USERS_TABLE,
    body: row,
    headers: { Prefer: 'return=representation' },
  });
  if (!inserted.ok) return { ok: false, status: inserted.status || 500, error: inserted.error || 'Unable to create admin user' };

  const created = Array.isArray(inserted.data) ? (inserted.data[0] || row) : row;
  return { ok: true, status: 201, data: sanitizeAdminUser(created) };
}

async function authenticateAdminUser({ projectId, email, password }) {
  const err = requireSupabase();
  if (err) return err;

  const pid = safeText(projectId);
  const addr = normalizeEmail(email);
  const pwd = String(password || '');

  if (!pid || !addr || !pwd) return { ok: false, status: 401, error: 'Invalid credentials' };

  const query = `select=*&project_id=eq.${encodeURIComponent(pid)}&email=eq.${encodeURIComponent(addr)}&limit=1`;
  const result = await sbQuery({ method: 'GET', table: ADMIN_USERS_TABLE, query });
  if (!result.ok) return { ok: false, status: 401, error: 'Invalid credentials' };

  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  if (!row) return { ok: false, status: 401, error: 'Invalid credentials' };
  if (!verifyPassword(pwd, row.password_hash)) return { ok: false, status: 401, error: 'Invalid credentials' };

  return { ok: true, status: 200, data: sanitizeAdminUser(row) };
}

async function createAdminSession(adminUserId, projectId) {
  const err = requireSupabase();
  if (err) return err;

  const uid = safeText(adminUserId);
  const pid = safeText(projectId);
  if (!uid || !pid) return { ok: false, status: 400, error: 'adminUserId and projectId are required' };

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const row = {
    token,
    admin_user_id: uid,
    project_id: pid,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
  };

  const inserted = await sbQuery({
    method: 'POST',
    table: ADMIN_SESSIONS_TABLE,
    body: row,
    headers: { Prefer: 'return=representation' },
  });
  if (!inserted.ok) return { ok: false, status: inserted.status || 500, error: inserted.error || 'Unable to create admin session' };

  return {
    ok: true,
    status: 201,
    data: { token, adminUserId: uid, projectId: pid, expiresAt: row.expires_at },
  };
}

async function getAdminSession(tokenInput) {
  if (!isSupabaseConfigured()) return null;
  const token = safeText(tokenInput);
  if (!token) return null;

  const query = `select=*&token=eq.${encodeURIComponent(token)}&limit=1`;
  const result = await sbQuery({ method: 'GET', table: ADMIN_SESSIONS_TABLE, query });
  if (!result.ok) return null;

  const session = Array.isArray(result.data) ? (result.data[0] || null) : null;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const userQuery = `select=*&id=eq.${encodeURIComponent(session.admin_user_id)}&limit=1`;
  const userResult = await sbQuery({ method: 'GET', table: ADMIN_USERS_TABLE, query: userQuery });
  if (!userResult.ok) return null;

  const userRow = Array.isArray(userResult.data) ? (userResult.data[0] || null) : null;
  if (!userRow) return null;

  return {
    token,
    adminUserId: safeText(session.admin_user_id),
    projectId: safeText(session.project_id),
    adminUser: sanitizeAdminUser(userRow),
  };
}

async function deleteAdminSession(tokenInput) {
  const err = requireSupabase();
  if (err) return err;

  const token = safeText(tokenInput);
  if (!token) return { ok: true };

  const query = `token=eq.${encodeURIComponent(token)}`;
  const result = await sbQuery({ method: 'DELETE', table: ADMIN_SESSIONS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to delete session' };
  return { ok: true };
}

async function listAdminUsers(projectId) {
  const err = requireSupabase();
  if (err) return err;

  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };

  const query = `select=id,email,role,created_at&project_id=eq.${encodeURIComponent(pid)}&order=created_at.asc`;
  const result = await sbQuery({ method: 'GET', table: ADMIN_USERS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to list admin users' };

  const rows = Array.isArray(result.data) ? result.data : [];
  return { ok: true, data: rows.map(sanitizeAdminUser) };
}

async function updateAdminUser(id, projectId, patch) {
  const err = requireSupabase();
  if (err) return err;

  const uid = safeText(id);
  const pid = safeText(projectId);
  if (!uid || !pid) return { ok: false, status: 400, error: 'id and projectId are required' };

  const allowed = {};
  if (patch.role !== undefined) {
    const r = safeText(patch.role);
    if (['admin', 'editor'].includes(r)) allowed.role = r;
  }
  if (!Object.keys(allowed).length) return { ok: false, status: 400, error: 'No valid fields to update' };
  allowed.updated_at = new Date().toISOString();

  const query = `id=eq.${encodeURIComponent(uid)}&project_id=eq.${encodeURIComponent(pid)}`;
  const result = await sbQuery({
    method: 'PATCH',
    table: ADMIN_USERS_TABLE,
    query,
    body: allowed,
    headers: { Prefer: 'return=representation' },
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to update admin user' };
  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  if (!row) return { ok: false, status: 404, error: 'Admin user not found' };
  return { ok: true, data: sanitizeAdminUser(row) };
}

async function deleteAdminUser(id, projectId) {
  const err = requireSupabase();
  if (err) return err;

  const uid = safeText(id);
  const pid = safeText(projectId);
  if (!uid || !pid) return { ok: false, status: 400, error: 'id and projectId are required' };

  const query = `id=eq.${encodeURIComponent(uid)}&project_id=eq.${encodeURIComponent(pid)}`;
  const result = await sbQuery({ method: 'DELETE', table: ADMIN_USERS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to delete admin user' };
  return { ok: true };
}

module.exports = {
  createAdminUser,
  authenticateAdminUser,
  createAdminSession,
  getAdminSession,
  deleteAdminSession,
  listAdminUsers,
  updateAdminUser,
  deleteAdminUser,
};
