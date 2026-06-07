'use strict';

/**
 * lib/devTeamStore.js
 * Project-scoped dev_team rows with contact resolution for the Team UI.
 */

const { sbQuery } = require('./supabase');
const { rowToContact } = require('./ContactsStore');
const { listTeamInvitations, isInvitationExpired } = require('./teamInvitationsStore');

const DEV_TEAM_TABLE = 'dev_team';
const CONTACTS_TABLE = 'contacts';

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

function contactDisplayName(contact) {
  if (!contact) return '';
  const first = String(contact.firstName || '').trim();
  const last = String(contact.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  return full || String(contact.email || '').trim() || String(contact.id || '').trim();
}

/**
 * List team members for one project, with contact records joined by id.
 * Contact lookup uses ids from dev_team only (no cross-project list leakage).
 */
async function listDevTeamMembers(projectId) {
  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };

  const teamRes = await sb({
    table: DEV_TEAM_TABLE,
    query: `select=*&project_id=eq.${encodeURIComponent(pid)}&order=created_at.asc`,
  });
  if (!teamRes.ok) return teamRes;

  const rows = Array.isArray(teamRes.data) ? teamRes.data : [];
  if (!rows.length) {
    return { ok: true, status: 200, data: [] };
  }

  const contactIds = [...new Set(rows.map((r) => safeText(r.contact_id)).filter(Boolean))];
  const contactsById = {};

  if (contactIds.length) {
    const inList = contactIds.map((id) => encodeURIComponent(id)).join(',');
    const conRes = await sb({
      table: CONTACTS_TABLE,
      query: `select=*,people(*)&id=in.(${inList})`,
    });
    if (conRes.ok && Array.isArray(conRes.data)) {
      conRes.data.forEach((row) => {
        const c = rowToContact(row);
        if (c?.id) contactsById[c.id] = c;
      });
    }
  }

  const pendingByContactId = new Map();
  try {
    const invRes = await listTeamInvitations(pid);
    if (invRes.ok && Array.isArray(invRes.data)) {
      invRes.data.forEach((inv) => {
        if (inv.status !== 'pending' || isInvitationExpired(inv)) return;
        if (!pendingByContactId.has(inv.contactId)) {
          pendingByContactId.set(inv.contactId, inv);
        }
      });
    }
  } catch (_) {
    // Invitations are optional; never block the team roster if invite tables are missing.
  }

  const data = rows.map((row) => {
    const contact = contactsById[row.contact_id] || null;
    const contactId = safeText(row.contact_id);
    const pendingInvitation = pendingByContactId.get(contactId) || null;
    const authUserId = safeText(contact?.authUserId);
    let accountStatus = 'not_invited';
    if (authUserId) accountStatus = 'active';
    else if (pendingInvitation) accountStatus = 'invite_pending';

    return {
      id: row.id,
      project_id: row.project_id,
      contact_id: row.contact_id,
      role: row.role || '',
      created_at: row.created_at,
      member_name: contact ? contactDisplayName(contact) : '',
      account_status: accountStatus,
      accountStatus,
      invitation: pendingInvitation,
      contact,
    };
  });

  return { ok: true, status: 200, data };
}

async function getDevTeamMember(teamId, projectId) {
  const id = safeText(teamId);
  const pid = safeText(projectId);
  if (!id || !pid) {
    return { ok: false, status: 400, error: 'teamId and projectId are required' };
  }

  const teamRes = await sb({
    table: DEV_TEAM_TABLE,
    query: `select=*&id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(pid)}&limit=1`,
  });
  if (!teamRes.ok) return teamRes;
  const row = Array.isArray(teamRes.data) ? teamRes.data[0] : null;
  if (!row) {
    return { ok: false, status: 404, error: 'Team member not found' };
  }

  let contact = null;
  const cid = safeText(row.contact_id);
  if (cid) {
    const conRes = await sb({
      table: CONTACTS_TABLE,
      query: `select=*,people(*)&id=eq.${encodeURIComponent(cid)}&limit=1`,
    });
    if (conRes.ok && Array.isArray(conRes.data) && conRes.data[0]) {
      contact = rowToContact(conRes.data[0]);
    }
  }

  const member = {
    id: row.id,
    project_id: row.project_id,
    contact_id: row.contact_id,
    role: row.role || '',
    created_at: row.created_at,
    member_name: contact ? contactDisplayName(contact) : '',
    contact,
  };

  return { ok: true, status: 200, data: member };
}

async function addDevTeamMember({ projectId, contactId, role }) {
  const pid = safeText(projectId);
  const cid = safeText(contactId);
  const roleName = safeText(role);
  if (!pid || !cid || !roleName) {
    return { ok: false, status: 400, error: 'projectId, contactId, and role are required' };
  }

  const conRes = await sb({
    table: CONTACTS_TABLE,
    query: `select=*,people(*)&id=eq.${encodeURIComponent(cid)}&limit=1`,
  });
  if (!conRes.ok) return conRes;
  const contactRow = Array.isArray(conRes.data) ? conRes.data[0] : null;
  if (!contactRow) {
    return {
      ok: false,
      status: 404,
      error: 'Contact not found. Create the contact under this project first.',
    };
  }
  const contactProjectId = safeText(contactRow.project_id);
  if (contactProjectId && contactProjectId !== pid) {
    return {
      ok: false,
      status: 409,
      error: 'This contact belongs to another project. Switch projects or create a contact here.',
    };
  }

  const insertRes = await sb({
    method: 'POST',
    table: DEV_TEAM_TABLE,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [{
      project_id: pid,
      contact_id: cid,
      role: roleName,
    }],
  });
  if (!insertRes.ok) {
    const errText = String(insertRes.error || '').toLowerCase();
    if (insertRes.status === 409 || errText.includes('duplicate') || errText.includes('unique')) {
      return { ok: false, status: 409, error: 'This contact is already a team member.' };
    }
    return insertRes;
  }

  let row = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  if (!row) {
    const fetchRes = await sb({
      table: DEV_TEAM_TABLE,
      query: `select=*&project_id=eq.${encodeURIComponent(pid)}&contact_id=eq.${encodeURIComponent(cid)}&limit=1`,
    });
    if (fetchRes.ok && Array.isArray(fetchRes.data) && fetchRes.data[0]) {
      row = fetchRes.data[0];
    }
  }
  const contact = rowToContact(contactRow);
  if (!row) {
    return {
      ok: false,
      status: 500,
      error: insertRes.error || 'Failed to create team member',
    };
  }
  return {
    ok: true,
    status: 201,
    data: {
      ...row,
      member_name: contactDisplayName(contact),
      contact,
    },
  };
}

async function removeDevTeamMember(teamId, projectId) {
  const id = safeText(teamId);
  const pid = safeText(projectId);
  if (!id || !pid) return { ok: false, status: 400, error: 'teamId and projectId are required' };

  return sb({
    method: 'DELETE',
    table: DEV_TEAM_TABLE,
    query: `id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(pid)}`,
  });
}

module.exports = {
  listDevTeamMembers,
  getDevTeamMember,
  addDevTeamMember,
  removeDevTeamMember,
  contactDisplayName,
};
