'use strict';

/**
 * lib/appInvitationsStore.js
 * Platform invitations — the only way to create a StarCaster login.
 *
 * Distinct from the two invitation stores that already exist:
 *   teamInvitationsStore     — invites an existing CRM contact onto a project
 *                              team; requires a contacts row and a project.
 *   contactProjectInvitations — grants an existing contact access to another
 *                              project; also requires both.
 * This one invites an email address the platform has never seen, and the
 * project is optional.
 *
 * The raw token is returned exactly once, at creation, and never stored — only
 * its SHA-256 hash goes to the database, so a leaked table dump cannot be
 * redeemed.
 */

const crypto = require('crypto');
const { sbQuery } = require('./supabase');

const TABLE = String(process.env.SUPABASE_APP_INVITATIONS_TABLE || 'app_invitations').trim();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_PROJECT_ROLES = new Set(['owner', 'member']);

function safeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return safeText(value).toLowerCase();
}

function makeId() {
  return `inv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function generateToken() {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hashToken(rawToken) };
}

function rowToModel(row) {
  if (!row) return null;
  return {
    id: safeText(row.id),
    email: normalizeEmail(row.email),
    projectId: safeText(row.project_id),
    projectRole: safeText(row.project_role) || 'member',
    status: safeText(row.status),
    invitedByUserId: safeText(row.invited_by_user_id),
    expiresAt: row.expires_at || null,
    acceptedAt: row.accepted_at || null,
    acceptedUserId: safeText(row.accepted_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function missingTableError(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

const SETUP_HINT =
  'Run docs/SQL/app_invitations_setup.sql in Supabase, then reload the API schema '
  + '(Dashboard → Project Settings → API → Reload schema).';

/**
 * Has the table been created yet? Registration needs to know: until the
 * migration is applied there are no invitations, and refusing every sign-up
 * on that basis would lock the platform rather than protect it.
 */
async function isReady() {
  const res = await sbQuery({ table: TABLE, query: 'select=id&limit=1' });
  if (res.ok) return { ok: true, ready: true };
  if (missingTableError(res)) return { ok: true, ready: false, hint: SETUP_HINT };
  return { ok: false, status: res.status || 500, error: res.error };
}

async function revokePendingForEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return;
  await sbQuery({
    method: 'PATCH',
    table: TABLE,
    query: `email=eq.${encodeURIComponent(target)}&status=eq.pending`,
    headers: { Prefer: 'return=minimal' },
    body: { status: 'revoked', updated_at: new Date().toISOString() },
  });
}

async function createInvitation({ email, projectId, projectRole, invitedByUserId, expiresAt }) {
  const invEmail = normalizeEmail(email);
  const inviter = safeText(invitedByUserId);
  const pid = safeText(projectId);
  const role = safeText(projectRole) || 'member';

  if (!invEmail || !invEmail.includes('@')) {
    return { ok: false, status: 400, error: 'A valid email address is required' };
  }
  if (!inviter) return { ok: false, status: 400, error: 'invitedByUserId is required' };
  if (!VALID_PROJECT_ROLES.has(role)) {
    return { ok: false, status: 400, error: `Role must be one of: ${[...VALID_PROJECT_ROLES].join(', ')}` };
  }

  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Date.now() + INVITE_TTL_MS;
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return { ok: false, status: 400, error: 'expiresAt must be in the future' };
  }

  // Re-inviting the same address supersedes the old link rather than leaving
  // two live tokens for one mailbox.
  await revokePendingForEmail(invEmail);

  const { rawToken, tokenHash } = generateToken();
  const now = new Date().toISOString();
  const row = {
    id: makeId(),
    email: invEmail,
    project_id: pid || null,
    project_role: role,
    token_hash: tokenHash,
    status: 'pending',
    invited_by_user_id: inviter,
    expires_at: new Date(expiresMs).toISOString(),
    accepted_at: null,
    accepted_user_id: null,
    created_at: now,
    updated_at: now,
  };

  const insertRes = await sbQuery({
    method: 'POST',
    table: TABLE,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!insertRes.ok) {
    if (missingTableError(insertRes)) {
      return { ok: false, status: 503, error: `Invitations are not set up yet. ${SETUP_HINT}` };
    }
    return insertRes;
  }

  const saved = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return {
    ok: true,
    status: 201,
    data: { invitation: rowToModel(saved || row), rawToken },
  };
}

/**
 * Look an invitation up by its raw token. Returns the invitation only when it
 * is genuinely redeemable — pending and unexpired.
 */
async function getInvitationByToken(rawToken) {
  const token = safeText(rawToken);
  if (!token) return { ok: false, status: 400, error: 'Token is required' };

  const res = await sbQuery({
    table: TABLE,
    query: `select=*&token_hash=eq.${encodeURIComponent(hashToken(token))}&limit=1`,
  });
  if (!res.ok) {
    if (missingTableError(res)) return { ok: false, status: 503, error: `Invitations are not set up yet. ${SETUP_HINT}` };
    return res;
  }

  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'This invitation link is not valid' };

  const invitation = rowToModel(row);
  if (invitation.status !== 'pending') {
    return { ok: false, status: 409, error: `This invitation has already been ${invitation.status}` };
  }
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'This invitation has expired' };
  }

  return { ok: true, status: 200, data: invitation };
}

/**
 * Mark an invitation redeemed. Conditional on it still being pending, so two
 * simultaneous sign-ups on one link cannot both succeed.
 */
async function acceptInvitation(invitationId, acceptedUserId) {
  const id = safeText(invitationId);
  const userId = safeText(acceptedUserId);
  if (!id || !userId) return { ok: false, status: 400, error: 'invitationId and acceptedUserId are required' };

  const now = new Date().toISOString();
  const res = await sbQuery({
    method: 'PATCH',
    table: TABLE,
    query: `id=eq.${encodeURIComponent(id)}&status=eq.pending`,
    headers: { Prefer: 'return=representation' },
    body: {
      status: 'accepted',
      accepted_at: now,
      accepted_user_id: userId,
      updated_at: now,
    },
  });
  if (!res.ok) return res;

  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 409, error: 'This invitation has already been used' };
  return { ok: true, status: 200, data: rowToModel(row) };
}

async function listInvitations({ invitedByUserId, projectId, status } = {}) {
  const filters = ['select=*', 'order=created_at.desc', 'limit=200'];
  if (safeText(invitedByUserId)) filters.push(`invited_by_user_id=eq.${encodeURIComponent(safeText(invitedByUserId))}`);
  if (safeText(projectId)) filters.push(`project_id=eq.${encodeURIComponent(safeText(projectId))}`);
  if (safeText(status)) filters.push(`status=eq.${encodeURIComponent(safeText(status))}`);

  const res = await sbQuery({ table: TABLE, query: filters.join('&') });
  if (!res.ok) {
    if (missingTableError(res)) return { ok: true, status: 200, data: [] };
    return res;
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  return { ok: true, status: 200, data: rows.map(rowToModel) };
}

async function getInvitationById(invitationId) {
  const id = safeText(invitationId);
  if (!id) return { ok: false, status: 400, error: 'invitationId is required' };
  const res = await sbQuery({ table: TABLE, query: `select=*&id=eq.${encodeURIComponent(id)}&limit=1` });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Invitation not found' };
  return { ok: true, status: 200, data: rowToModel(row) };
}

async function revokeInvitation(invitationId) {
  const id = safeText(invitationId);
  if (!id) return { ok: false, status: 400, error: 'invitationId is required' };

  const res = await sbQuery({
    method: 'PATCH',
    table: TABLE,
    query: `id=eq.${encodeURIComponent(id)}&status=eq.pending`,
    headers: { Prefer: 'return=representation' },
    body: { status: 'revoked', updated_at: new Date().toISOString() },
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 409, error: 'Only a pending invitation can be revoked' };
  return { ok: true, status: 200, data: rowToModel(row) };
}

module.exports = {
  isReady,
  createInvitation,
  getInvitationByToken,
  getInvitationById,
  acceptInvitation,
  listInvitations,
  revokeInvitation,
  INVITE_TTL_MS,
  SETUP_HINT,
};
