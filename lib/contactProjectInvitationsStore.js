'use strict';

const crypto = require('crypto');
const { sbQuery } = require('./supabase');

const TABLE = String(
  process.env.SUPABASE_CONTACT_PROJECT_INVITATIONS_TABLE || 'contact_project_invitations'
).trim();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_STATUSES = new Set(['pending', 'accepted', 'revoked']);

function sb(opts = {}) {
  const { extraHeaders, headers, ...rest } = opts;
  return sbQuery({ ...rest, headers: { ...(extraHeaders || {}), ...(headers || {}) } });
}

function safeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return safeText(value).toLowerCase();
}

function makeId() {
  return `cpi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateToken() {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
  return { rawToken, tokenHash };
}

function rowToModel(row) {
  if (!row) return null;
  return {
    id:               safeText(row.id),
    contactId:        safeText(row.contact_id),
    projectId:        safeText(row.project_id),
    email:            normalizeEmail(row.email),
    status:           safeText(row.status),
    invitedByUserId:  safeText(row.invited_by_user_id),
    expiresAt:        row.expires_at || null,
    acceptedAt:       row.accepted_at || null,
    acceptedByEmail:  safeText(row.accepted_by_email),
    createdAt:        row.created_at || null,
    updatedAt:        row.updated_at || null,
  };
}

async function revokePending(contactId, projectId) {
  const cid = safeText(contactId);
  const pid = safeText(projectId);
  if (!cid || !pid) return;
  const now = new Date().toISOString();
  await sb({
    method: 'PATCH',
    table: TABLE,
    query: `contact_id=eq.${encodeURIComponent(cid)}&project_id=eq.${encodeURIComponent(pid)}&status=eq.pending`,
    extraHeaders: { Prefer: 'return=minimal' },
    body: { status: 'revoked', updated_at: now },
  });
}

async function createContactProjectInvitation({ contactId, projectId, email, invitedByUserId, expiresAt }) {
  const cid      = safeText(contactId);
  const pid      = safeText(projectId);
  const invEmail = normalizeEmail(email);
  const inviter  = safeText(invitedByUserId);

  if (!cid || !pid || !inviter) {
    return { ok: false, status: 400, error: 'contactId, projectId, and invitedByUserId are required' };
  }
  if (!invEmail || !invEmail.includes('@')) {
    return { ok: false, status: 400, error: 'Contact must have a valid email address to receive an invitation.' };
  }

  const expiresMs = expiresAt
    ? new Date(expiresAt).getTime()
    : Date.now() + INVITE_TTL_MS;
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return { ok: false, status: 400, error: 'expiresAt must be in the future' };
  }

  await revokePending(cid, pid);

  const { rawToken, tokenHash } = generateToken();
  const now = new Date().toISOString();
  const row = {
    id:                 makeId(),
    contact_id:         cid,
    project_id:         pid,
    email:              invEmail,
    token_hash:         tokenHash,
    status:             'pending',
    invited_by_user_id: inviter,
    expires_at:         new Date(expiresMs).toISOString(),
    accepted_at:        null,
    accepted_by_email:  null,
    created_at:         now,
    updated_at:         now,
  };

  const insertRes = await sb({
    method: 'POST',
    table: TABLE,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!insertRes.ok) return insertRes;

  let saved = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  if (!saved) {
    const fetchRes = await sb({ table: TABLE, query: `select=*&id=eq.${encodeURIComponent(row.id)}&limit=1` });
    if (fetchRes.ok && Array.isArray(fetchRes.data) && fetchRes.data[0]) saved = fetchRes.data[0];
  }
  if (!saved) return { ok: false, status: 500, error: 'Failed to create invitation' };

  return { ok: true, status: 201, data: { invitation: rowToModel(saved), rawToken } };
}

async function getContactProjectInvitationByToken(rawToken) {
  const token = safeText(rawToken);
  if (!token) return { ok: false, status: 400, error: 'Token is required' };

  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const res = await sb({
    table: TABLE,
    query: `select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`,
  });
  if (!res.ok) return res;

  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Invitation not found' };

  const invitation = rowToModel(row);
  if (invitation.status !== 'pending') {
    return { ok: false, status: 409, error: `Invitation has already been ${invitation.status}` };
  }
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'This invitation has expired' };
  }

  return { ok: true, status: 200, data: invitation };
}

async function acceptContactProjectInvitation(rawToken, acceptedByEmail) {
  const lookupRes = await getContactProjectInvitationByToken(rawToken);
  if (!lookupRes.ok) {
    // If already accepted, return success so the caller can still grant membership
    if (lookupRes.status === 409) {
      const token = safeText(rawToken);
      const tokenHash = require('crypto').createHash('sha256').update(token, 'utf8').digest('hex');
      const refetch = await sb({
        table: TABLE,
        query: `select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`,
      });
      const row = refetch.ok && Array.isArray(refetch.data) ? refetch.data[0] : null;
      if (row) {
        const inv = rowToModel(row);
        return { ok: true, status: 200, data: { invitation: inv, projectId: inv.projectId }, alreadyAccepted: true };
      }
    }
    return lookupRes;
  }

  const invitation = lookupRes.data;
  const now = new Date().toISOString();

  await sb({
    method: 'PATCH',
    table: TABLE,
    query: `id=eq.${encodeURIComponent(invitation.id)}`,
    extraHeaders: { Prefer: 'return=minimal' },
    body: {
      status:            'accepted',
      accepted_at:       now,
      accepted_by_email: normalizeEmail(acceptedByEmail || ''),
      updated_at:        now,
    },
  });

  return { ok: true, status: 200, data: { invitation, projectId: invitation.projectId } };
}

async function listContactProjectInvitations(contactId) {
  const cid = safeText(contactId);
  if (!cid) return { ok: false, status: 400, error: 'contactId is required' };

  const res = await sb({
    table: TABLE,
    query: `select=id,project_id,email,status,expires_at,created_at&contact_id=eq.${encodeURIComponent(cid)}&order=created_at.desc&limit=50`,
  });
  if (!res.ok) return res;

  const rows = Array.isArray(res.data) ? res.data : [];
  return { ok: true, status: 200, data: rows.map(rowToModel) };
}

module.exports = {
  createContactProjectInvitation,
  getContactProjectInvitationByToken,
  acceptContactProjectInvitation,
  listContactProjectInvitations,
};
