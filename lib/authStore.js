'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, '..', 'data', 'auth_users.json');
const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'auth_sessions.json');
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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

function listUsers() {
  const store = readJson(USERS_FILE, { users: [] });
  const users = Array.isArray(store.users) ? store.users : [];
  return users.filter((user) => user && typeof user === 'object');
}

function writeUsers(users) {
  writeJson(USERS_FILE, { users });
}

function listSessions() {
  const store = readJson(SESSIONS_FILE, { sessions: [] });
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  return sessions.filter((row) => row && typeof row === 'object');
}

function writeSessions(sessions) {
  writeJson(SESSIONS_FILE, { sessions });
}

function sanitizeUser(user) {
  return {
    id: safeText(user?.id),
    email: normalizeEmail(user?.email),
    name: safeText(user?.name),
    role: safeText(user?.role) || 'user',
    createdAt: safeText(user?.createdAt),
  };
}

function createUser({ email, password, name }) {
  const userEmail = normalizeEmail(email);
  const userName = safeText(name);
  const pwd = String(password || '');
  if (!userEmail) return { ok: false, status: 400, error: 'Email is required' };
  if (!pwd || pwd.length < 8) return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  if (!userName) return { ok: false, status: 400, error: 'Name is required' };

  const users = listUsers();
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
  writeUsers(users);
  return { ok: true, status: 201, data: sanitizeUser(user) };
}

function authenticateUser({ email, password }) {
  const userEmail = normalizeEmail(email);
  const pwd = String(password || '');
  if (!userEmail || !pwd) return { ok: false, status: 400, error: 'Email and password are required' };
  const users = listUsers();
  const user = users.find((row) => normalizeEmail(row.email) === userEmail);
  if (!user) return { ok: false, status: 401, error: 'Invalid email or password' };
  if (!verifyPassword(pwd, user.passwordHash)) return { ok: false, status: 401, error: 'Invalid email or password' };
  return { ok: true, status: 200, data: sanitizeUser(user) };
}

function createSession(userIdInput) {
  const userId = safeText(userIdInput);
  if (!userId) return { ok: false, status: 400, error: 'user_id is required' };
  const users = listUsers();
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
  const sessions = listSessions().filter((row) => new Date(String(row.expiresAt || 0)).getTime() > now);
  sessions.unshift(session);
  writeSessions(sessions);
  return { ok: true, status: 201, data: session };
}

function deleteSession(tokenInput) {
  const token = safeText(tokenInput);
  if (!token) return { ok: true, status: 200, data: { deleted: false } };
  const sessions = listSessions();
  const next = sessions.filter((row) => safeText(row.token) !== token);
  writeSessions(next);
  return { ok: true, status: 200, data: { deleted: sessions.length !== next.length } };
}

function getUserFromSessionToken(tokenInput) {
  const token = safeText(tokenInput);
  if (!token) return null;
  const now = Date.now();
  const sessions = listSessions();
  const active = sessions.find((row) => safeText(row.token) === token && new Date(String(row.expiresAt || 0)).getTime() > now);
  if (!active) return null;
  const users = listUsers();
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
};

