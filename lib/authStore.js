'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const USERS_FILE = path.join(__dirname, '..', 'data', 'auth_users.json');
const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'auth_sessions.json');
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const AUTH_USERS_TABLE = String(process.env.SUPABASE_AUTH_USERS_TABLE || 'app_auth_users').trim();
const AUTH_SESSIONS_TABLE = String(process.env.SUPABASE_AUTH_SESSIONS_TABLE || 'app_auth_sessions').trim();

function useSupabase() {
  return isSupabaseConfigured();
}

function ensureFile(filePath, seed) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
  }
}

function readJson(filePath, fallback) {
  try {
    ensureFile(filePath, fallback);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureFile(filePath, data);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, 0o600);
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

function sanitizeUser(user) {
  return {
    id: safeText(user?.id),
    email: normalizeEmail(user?.email),
    name: safeText(user?.name),
    role: safeText(user?.role) || 'user',
    createdAt: safeText(user?.created_at || user?.createdAt),
  };
}

function listUsersFile() {
  const store = readJson(USERS_FILE, { users: [] });
  const users = Array.isArray(store.users) ? store.users : [];
  return users.filter((user) => user && typeof user === 'object');
}

function writeUsersFile(users) {
  writeJson(USERS_FILE, { users });
}

function listSessionsFile() {
  const store = readJson(SESSIONS_FILE, { sessions: [] });
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  return sessions.filter((row) => row && typeof row === 'object');
}

function writeSessionsFile(sessions) {
  writeJson(SESSIONS_FILE, { sessions });
}

async function countUsersSupabase() {
  const query = 'select=id&limit=1';
  const result = await sbQuery({ method: 'GET', table: AUTH_USERS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to query users' };
  return { ok: true, count: Array.isArray(result.data) ? result.data.length : 0 };
}

async function findUserByEmailSupabase(email) {
  const query = `select=*&email=eq.${encodeURIComponent(email)}&limit=1`;
  const result = await sbQuery({ method: 'GET', table: AUTH_USERS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to query users' };
  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  return { ok: true, row };
}

async function findUserByIdSupabase(userId) {
  const query = `select=*&id=eq.${encodeURIComponent(userId)}&limit=1`;
  const result = await sbQuery({ method: 'GET', table: AUTH_USERS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to query users' };
  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  return { ok: true, row };
}

async function insertUserSupabase(user) {
  const result = await sbQuery({
    method: 'POST',
    table: AUTH_USERS_TABLE,
    body: user,
    headers: { Prefer: 'return=representation' },
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to create user' };
  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  return { ok: true, row };
}

async function insertSessionSupabase(session) {
  const result = await sbQuery({
    method: 'POST',
    table: AUTH_SESSIONS_TABLE,
    body: session,
    headers: { Prefer: 'return=representation' },
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to create session' };
  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  return { ok: true, row };
}

async function findSessionByTokenSupabase(token) {
  const query = `select=*&token=eq.${encodeURIComponent(token)}&limit=1`;
  const result = await sbQuery({ method: 'GET', table: AUTH_SESSIONS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to query sessions' };
  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  return { ok: true, row };
}

async function deleteSessionByTokenSupabase(token) {
  const query = `token=eq.${encodeURIComponent(token)}`;
  const result = await sbQuery({ method: 'DELETE', table: AUTH_SESSIONS_TABLE, query });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Unable to delete session' };
  return { ok: true };
}

async function createUser({ email, password, name }) {
  const userEmail = normalizeEmail(email);
  const userName = safeText(name);
  const pwd = String(password || '');
  if (!userEmail) return { ok: false, status: 400, error: 'Email is required' };
  if (!pwd || pwd.length < 8) return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  if (!userName) return { ok: false, status: 400, error: 'Name is required' };

  if (useSupabase()) {
    const existing = await findUserByEmailSupabase(userEmail);
    if (!existing.ok) return existing;
    if (existing.row) return { ok: false, status: 409, error: 'An account with that email already exists' };

    const count = await countUsersSupabase();
    if (!count.ok) return { ok: false, status: count.status || 500, error: count.error || 'Unable to determine first user' };

    const now = new Date().toISOString();
    const user = {
      id: makeId('usr'),
      email: userEmail,
      name: userName,
      password_hash: hashPassword(pwd),
      role: count.count === 0 ? 'owner' : 'user',
      created_at: now,
      updated_at: now,
    };
    const inserted = await insertUserSupabase(user);
    if (!inserted.ok) return inserted;
    return { ok: true, status: 201, data: sanitizeUser(inserted.row || user) };
  }

  const users = listUsersFile();
  if (users.some((user) => normalizeEmail(user.email) === userEmail)) {
    return { ok: false, status: 409, error: 'An account with that email already exists' };
  }

  const now = new Date().toISOString();
  const user = {
    id: makeId('usr'),
    email: userEmail,
    name: userName,
    passwordHash: hashPassword(pwd),
    role: users.length === 0 ? 'owner' : 'user',
    createdAt: now,
    updatedAt: now,
  };
  users.unshift(user);
  writeUsersFile(users);
  return { ok: true, status: 201, data: sanitizeUser(user) };
}

async function authenticateUser({ email, password }) {
  const userEmail = normalizeEmail(email);
  const pwd = String(password || '');
  if (!userEmail || !pwd) return { ok: false, status: 400, error: 'Email and password are required' };

  if (useSupabase()) {
    const found = await findUserByEmailSupabase(userEmail);
    if (!found.ok) return found;
    const user = found.row;
    if (!user) return { ok: false, status: 401, error: 'Invalid email or password' };
    if (!verifyPassword(pwd, user.password_hash)) return { ok: false, status: 401, error: 'Invalid email or password' };
    return { ok: true, status: 200, data: sanitizeUser(user) };
  }

  const users = listUsersFile();
  const user = users.find((row) => normalizeEmail(row.email) === userEmail);
  if (!user) return { ok: false, status: 401, error: 'Invalid email or password' };
  if (!verifyPassword(pwd, user.passwordHash)) return { ok: false, status: 401, error: 'Invalid email or password' };
  return { ok: true, status: 200, data: sanitizeUser(user) };
}

async function createSession(userIdInput) {
  const userId = safeText(userIdInput);
  if (!userId) return { ok: false, status: 400, error: 'user_id is required' };

  if (useSupabase()) {
    const userResult = await findUserByIdSupabase(userId);
    if (!userResult.ok) return userResult;
    if (!userResult.row) return { ok: false, status: 404, error: 'User not found' };

    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const session = {
      token,
      user_id: userId,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    const inserted = await insertSessionSupabase(session);
    if (!inserted.ok) return inserted;

    return {
      ok: true,
      status: 201,
      data: {
        token,
        userId,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
      },
    };
  }

  const users = listUsersFile();
  const user = users.find((row) => safeText(row.id) === userId);
  if (!user) return { ok: false, status: 404, error: 'User not found' };

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  const sessions = listSessionsFile().filter((row) => new Date(String(row.expiresAt || 0)).getTime() > now);
  sessions.unshift(session);
  writeSessionsFile(sessions);
  return { ok: true, status: 201, data: session };
}

async function deleteSession(tokenInput) {
  const token = safeText(tokenInput);
  if (!token) return { ok: true, status: 200, data: { deleted: false } };

  if (useSupabase()) {
    const result = await deleteSessionByTokenSupabase(token);
    if (!result.ok) return result;
    return { ok: true, status: 200, data: { deleted: true } };
  }

  const sessions = listSessionsFile();
  const next = sessions.filter((row) => safeText(row.token) !== token);
  writeSessionsFile(next);
  return { ok: true, status: 200, data: { deleted: sessions.length !== next.length } };
}

async function getUserFromSessionToken(tokenInput) {
  const token = safeText(tokenInput);
  if (!token) return null;

  if (useSupabase()) {
    const session = await findSessionByTokenSupabase(token);
    if (!session.ok || !session.row) return null;
    const expiresAt = new Date(String(session.row.expires_at || 0)).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

    const userResult = await findUserByIdSupabase(safeText(session.row.user_id));
    if (!userResult.ok || !userResult.row) return null;
    return sanitizeUser(userResult.row);
  }

  const now = Date.now();
  const sessions = listSessionsFile();
  const active = sessions.find((row) => safeText(row.token) === token && new Date(String(row.expiresAt || 0)).getTime() > now);
  if (!active) return null;
  const users = listUsersFile();
  const user = users.find((row) => safeText(row.id) === safeText(active.userId));
  if (!user) return null;
  return sanitizeUser(user);
}

module.exports = {
  createUser,
  authenticateUser,
  createSession,
  deleteSession,
  getUserFromSessionToken,
  useSupabase,
  AUTH_USERS_TABLE,
  AUTH_SESSIONS_TABLE,
};
