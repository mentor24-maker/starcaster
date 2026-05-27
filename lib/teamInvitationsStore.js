'use strict';

/**
 * lib/teamInvitationsStore.js
 * Project-scoped team invitation tokens (Phase 1 foundation).
 * Phase 2 will send email; Phase 3 will accept and create memberships.
 */

const crypto = require('crypto');
const { sbQuery } = require('./supabase');
const { rowToContact } = require('./ContactsStore');

const TEAM_INVITATIONS_TABLE = String(
  process.env.SUPABASE_TEAM_INVITATIONS_TABLE || 'team_invitations'
).trim();
const CONTACTS_TABLE = 'contacts';
const DEV_TEAM_TABLE = 'dev_team';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const VALID_MEMBERSHIP_ROLES = new Set(['admin', 'editor']);
const VALID_STATUSES = new Set(['pending', 'accepted', 'expired', 'revoked']);
const TEAM_ADMIN_TYPE = 'team-admin';
const TEAM_EDITOR_TYPE = 'team-editor';

function sb(opts = {}) {
  const { extraHeaders, headers, ...rest } = opts;
  return sbQuery({
    ...rest,
    headers: { ...(extraHeaders || {}), ...(headers || {}) },
  });
}

function safeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return safeText(value).toLowerCase();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function membershipRoleFromContactType(contactType) {
  const type = safeText(contactType);
  if (type === TEAM_ADMIN_TYPE) return 'admin';
  if (type === TEAM_EDITOR_TYPE) return 'editor';
  return '';
}

function contactTypeFromMembershipRole(membershipRole) {
  const role = safeText(membershipRole);
  if (role === 'admin') return TEAM_ADMIN_TYPE;
  if (role === 'editor') return TEAM_EDITOR_TYPE;
  return '';
}

function generateInviteToken() {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashInviteToken(rawToken);
  return { rawToken, tokenHash };
}

function hashInviteToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || ''), 'utf8').digest('hex');
}

function invitationRowToModel(row) {
  if (!row) return null;
  return {
    id: safeText(row.id),
    projectId: safeText(row.project_id),
    contactId: safeText(row.contact_id),
    devTeamId: safeText(row.dev_team_id),
    email: normalizeEmail(row.email),
    membershipRole: safeText(row.membership_role),
    status: safeText(row.status),
    invitedByUserId: safeText(row.invited_by_user_id),
    expiresAt: row.expires_at || null,
    acceptedAt: row.accepted_at || null,
    acceptedUserId: safeText(row.accepted_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function isInvitationExpired(invitation) {
  if (!invitation?.expiresAt) return true;
  const expiresMs = new Date(invitation.expiresAt).getTime();
  return !Number.isFinite(expiresMs) || expiresMs <= Date.now();
}

async function fetchContactForProject(contactId, projectId) {
  const cid = safeText(contactId);
  const pid = safeText(projectId);
  if (!cid || !pid) {
    return { ok: false, status: 400, error: 'contactId and projectId are required' };
  }
  const res = await sb({
    table: CONTACTS_TABLE,
    query: `select=*&id=eq.${encodeURIComponent(cid)}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) {
    return { ok: false, status: 404, error: 'Contact not found' };
  }
  const contactProjectId = safeText(row.project_id);
  if (contactProjectId && contactProjectId !== pid) {
    return {
      ok: false,
      status: 409,
      error: 'This contact belongs to another project.',
    };
  }
  return { ok: true, data: rowToContact(row), row };
}

async function fetchDevTeamRow(devTeamId, projectId) {
  const teamId = safeText(devTeamId);
  const pid = safeText(projectId);
  if (!teamId) return { ok: true, data: null };
  const res = await sb({
    table: DEV_TEAM_TABLE,
    query: `select=*&id=eq.${encodeURIComponent(teamId)}&project_id=eq.${encodeURIComponent(pid)}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) {
    return { ok: false, status: 404, error: 'Team member not found for this project' };
  }
  return { ok: true, data: row };
}

async function revokePendingInvitationsForContact(projectId, contactId) {
  const pid = safeText(projectId);
  const cid = safeText(contactId);
  if (!pid || !cid) return { ok: true, data: { revoked: 0 } };

  const now = new Date().toISOString();
  return sb({
    method: 'PATCH',
    table: TEAM_INVITATIONS_TABLE,
    query: `project_id=eq.${encodeURIComponent(pid)}&contact_id=eq.${encodeURIComponent(cid)}&status=eq.pending`,
    extraHeaders: { Prefer: 'return=representation' },
    body: {
      status: 'revoked',
      updated_at: now,
    },
  });
}

/**
 * Create a pending invitation. Returns { invitation, rawToken } — rawToken is only available at creation.
 */
async function createTeamInvitation({
  projectId,
  contactId,
  devTeamId,
  invitedByUserId,
  membershipRole,
  email,
  expiresAt,
}) {
  const pid = safeText(projectId);
  const cid = safeText(contactId);
  const inviterId = safeText(invitedByUserId);
  if (!pid || !cid || !inviterId) {
    return { ok: false, status: 400, error: 'projectId, contactId, and invitedByUserId are required' };
  }

  const contactRes = await fetchContactForProject(cid, pid);
  if (!contactRes.ok) return contactRes;
  const contact = contactRes.data;

  const teamId = safeText(devTeamId);
  if (teamId) {
    const teamRes = await fetchDevTeamRow(teamId, pid);
    if (!teamRes.ok) return teamRes;
    const teamContactId = safeText(teamRes.data?.contact_id);
    if (teamContactId && teamContactId !== cid) {
      return {
        ok: false,
        status: 409,
        error: 'devTeamId does not match the provided contactId',
      };
    }
  }

  const inviteEmail = normalizeEmail(email || contact.email);
  if (!inviteEmail || !inviteEmail.includes('@')) {
    return {
      ok: false,
      status: 400,
      error: 'Contact must have an email address before sending an invitation.',
    };
  }

  let role = safeText(membershipRole);
  if (!role) role = membershipRoleFromContactType(contact.contactType);
  if (!VALID_MEMBERSHIP_ROLES.has(role)) {
    return {
      ok: false,
      status: 400,
      error: 'Contact must be team-admin or team-editor to receive a team invitation.',
    };
  }

  if (safeText(contact.authUserId)) {
    return {
      ok: false,
      status: 409,
      error: 'This contact already has a linked StarCaster account.',
    };
  }

  const expiresMs = expiresAt
    ? new Date(expiresAt).getTime()
    : Date.now() + INVITE_TTL_MS;
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return { ok: false, status: 400, error: 'expiresAt must be in the future' };
  }

  await revokePendingInvitationsForContact(pid, cid);

  const { rawToken, tokenHash } = generateInviteToken();
  const now = new Date().toISOString();
  const row = {
    id: makeId('tinv'),
    project_id: pid,
    contact_id: cid,
    dev_team_id: teamId || null,
    email: inviteEmail,
    token_hash: tokenHash,
    membership_role: role,
    status: 'pending',
    invited_by_user_id: inviterId,
    expires_at: new Date(expiresMs).toISOString(),
    accepted_at: null,
    accepted_user_id: null,
    created_at: now,
    updated_at: now,
  };

  const insertRes = await sb({
    method: 'POST',
    table: TEAM_INVITATIONS_TABLE,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!insertRes.ok) {
    const errText = String(insertRes.error || '').toLowerCase();
    if (insertRes.status === 409 || errText.includes('duplicate') || errText.includes('unique')) {
      return {
        ok: false,
        status: 409,
        error: 'A pending invitation already exists for this team member.',
      };
    }
    return insertRes;
  }

  let saved = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  if (!saved) {
    const fetchRes = await sb({
      table: TEAM_INVITATIONS_TABLE,
      query: `select=*&id=eq.${encodeURIComponent(row.id)}&limit=1`,
    });
    if (fetchRes.ok && Array.isArray(fetchRes.data) && fetchRes.data[0]) {
      saved = fetchRes.data[0];
    }
  }
  if (!saved) {
    return { ok: false, status: 500, error: 'Failed to create invitation' };
  }

  return {
    ok: true,
    status: 201,
    data: {
      invitation: invitationRowToModel(saved),
      rawToken,
    },
  };
}

async function getInvitationByRawToken(rawToken) {
  const token = safeText(rawToken);
  if (!token) {
    return { ok: false, status: 400, error: 'Invitation token is required' };
  }

  const tokenHash = hashInviteToken(token);
  const res = await sb({
    table: TEAM_INVITATIONS_TABLE,
    query: `select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) {
    return { ok: false, status: 404, error: 'Invitation not found or invalid' };
  }

  const invitation = invitationRowToModel(row);
  if (invitation.status !== 'pending') {
    return { ok: false, status: 410, error: `Invitation is ${invitation.status}` };
  }
  if (isInvitationExpired(invitation)) {
    await sb({
      method: 'PATCH',
      table: TEAM_INVITATIONS_TABLE,
      query: `id=eq.${encodeURIComponent(invitation.id)}`,
      body: { status: 'expired', updated_at: new Date().toISOString() },
    });
    return { ok: false, status: 410, error: 'Invitation has expired' };
  }

  return { ok: true, status: 200, data: invitation };
}

async function getInvitationById(id, projectId) {
  const invId = safeText(id);
  const pid = safeText(projectId);
  if (!invId || !pid) {
    return { ok: false, status: 400, error: 'id and projectId are required' };
  }
  const res = await sb({
    table: TEAM_INVITATIONS_TABLE,
    query: `select=*&id=eq.${encodeURIComponent(invId)}&project_id=eq.${encodeURIComponent(pid)}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'Invitation not found' };
  return { ok: true, status: 200, data: invitationRowToModel(row) };
}

async function getActiveInvitationForContact(projectId, contactId) {
  const pid = safeText(projectId);
  const cid = safeText(contactId);
  if (!pid || !cid) {
    return { ok: false, status: 400, error: 'projectId and contactId are required' };
  }
  const res = await sb({
    table: TEAM_INVITATIONS_TABLE,
    query: `select=*&project_id=eq.${encodeURIComponent(pid)}&contact_id=eq.${encodeURIComponent(cid)}&status=eq.pending&order=created_at.desc&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return { ok: true, status: 200, data: null };
  const invitation = invitationRowToModel(row);
  if (isInvitationExpired(invitation)) {
    return { ok: true, status: 200, data: null };
  }
  return { ok: true, status: 200, data: invitation };
}

async function getActiveInvitationForDevTeam(projectId, devTeamId) {
  const pid = safeText(projectId);
  const teamId = safeText(devTeamId);
  if (!pid || !teamId) {
    return { ok: false, status: 400, error: 'projectId and devTeamId are required' };
  }
  const res = await sb({
    table: TEAM_INVITATIONS_TABLE,
    query: `select=*&project_id=eq.${encodeURIComponent(pid)}&dev_team_id=eq.${encodeURIComponent(teamId)}&status=eq.pending&order=created_at.desc&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) return { ok: true, status: 200, data: null };
  const invitation = invitationRowToModel(row);
  if (isInvitationExpired(invitation)) {
    return { ok: true, status: 200, data: null };
  }
  return { ok: true, status: 200, data: invitation };
}

async function listTeamInvitations(projectId, { status } = {}) {
  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };

  let query = `select=*&project_id=eq.${encodeURIComponent(pid)}&order=created_at.desc`;
  const statusFilter = safeText(status);
  if (statusFilter) {
    if (!VALID_STATUSES.has(statusFilter)) {
      return { ok: false, status: 400, error: 'Invalid invitation status filter' };
    }
    query += `&status=eq.${encodeURIComponent(statusFilter)}`;
  }

  const res = await sb({ table: TEAM_INVITATIONS_TABLE, query });
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data : [];
  return {
    ok: true,
    status: 200,
    data: rows.map(invitationRowToModel),
  };
}

async function revokeTeamInvitation({ id, projectId }) {
  const invId = safeText(id);
  const pid = safeText(projectId);
  if (!invId || !pid) {
    return { ok: false, status: 400, error: 'id and projectId are required' };
  }

  const existing = await getInvitationById(invId, pid);
  if (!existing.ok) return existing;
  if (existing.data.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: `Cannot revoke invitation with status ${existing.data.status}`,
    };
  }

  const now = new Date().toISOString();
  const patchRes = await sb({
    method: 'PATCH',
    table: TEAM_INVITATIONS_TABLE,
    query: `id=eq.${encodeURIComponent(invId)}&project_id=eq.${encodeURIComponent(pid)}`,
    extraHeaders: { Prefer: 'return=representation' },
    body: { status: 'revoked', updated_at: now },
  });
  if (!patchRes.ok) return patchRes;
  const row = Array.isArray(patchRes.data) ? patchRes.data[0] : patchRes.data;
  return {
    ok: true,
    status: 200,
    data: invitationRowToModel(row || { ...existing.data, status: 'revoked', updated_at: now }),
  };
}

async function markTeamInvitationAccepted({ id, projectId, acceptedUserId }) {
  const invId = safeText(id);
  const pid = safeText(projectId);
  const userId = safeText(acceptedUserId);
  if (!invId || !pid || !userId) {
    return {
      ok: false,
      status: 400,
      error: 'id, projectId, and acceptedUserId are required',
    };
  }

  const existing = await getInvitationById(invId, pid);
  if (!existing.ok) return existing;
  if (existing.data.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: `Invitation is already ${existing.data.status}`,
    };
  }
  if (isInvitationExpired(existing.data)) {
    await sb({
      method: 'PATCH',
      table: TEAM_INVITATIONS_TABLE,
      query: `id=eq.${encodeURIComponent(invId)}`,
      body: { status: 'expired', updated_at: new Date().toISOString() },
    });
    return { ok: false, status: 410, error: 'Invitation has expired' };
  }

  const now = new Date().toISOString();
  const patchRes = await sb({
    method: 'PATCH',
    table: TEAM_INVITATIONS_TABLE,
    query: `id=eq.${encodeURIComponent(invId)}&project_id=eq.${encodeURIComponent(pid)}`,
    extraHeaders: { Prefer: 'return=representation' },
    body: {
      status: 'accepted',
      accepted_at: now,
      accepted_user_id: userId,
      updated_at: now,
    },
  });
  if (!patchRes.ok) return patchRes;
  const row = Array.isArray(patchRes.data) ? patchRes.data[0] : patchRes.data;
  return {
    ok: true,
    status: 200,
    data: invitationRowToModel(row || {
      ...existing.data,
      status: 'accepted',
      acceptedAt: now,
      acceptedUserId: userId,
      updatedAt: now,
    }),
  };
}

async function linkContactAuthUser({ contactId, userId, projectId }) {
  const cid = safeText(contactId);
  const uid = safeText(userId);
  const pid = safeText(projectId);
  if (!cid || !uid || !pid) {
    return { ok: false, status: 400, error: 'contactId, userId, and projectId are required' };
  }

  const contactRes = await fetchContactForProject(cid, pid);
  if (!contactRes.ok) return contactRes;

  const now = new Date().toISOString();
  const patchRes = await sb({
    method: 'PATCH',
    table: CONTACTS_TABLE,
    query: `id=eq.${encodeURIComponent(cid)}`,
    extraHeaders: { Prefer: 'return=representation' },
    body: {
      auth_user_id: uid,
      updated_at: now,
    },
  });
  if (!patchRes.ok) return patchRes;
  const row = Array.isArray(patchRes.data) ? patchRes.data[0] : patchRes.data;
  if (!row) {
    return { ok: false, status: 500, error: 'Failed to link contact to user account' };
  }
  return { ok: true, status: 200, data: rowToContact(row) };
}

module.exports = {
  isInvitationExpired,
  INVITE_TTL_MS,
  VALID_MEMBERSHIP_ROLES,
  VALID_STATUSES,
  TEAM_ADMIN_TYPE,
  TEAM_EDITOR_TYPE,
  membershipRoleFromContactType,
  contactTypeFromMembershipRole,
  generateInviteToken,
  hashInviteToken,
  invitationRowToModel,
  createTeamInvitation,
  getInvitationByRawToken,
  getInvitationById,
  getActiveInvitationForContact,
  getActiveInvitationForDevTeam,
  listTeamInvitations,
  revokeTeamInvitation,
  markTeamInvitationAccepted,
  linkContactAuthUser,
};
