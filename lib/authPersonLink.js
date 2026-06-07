'use strict';

/**
 * Links app_auth_users to global people / project contacts by email.
 * Contacts in a project are not the same as a StarCaster login (app_auth_users).
 */

const { sbQuery } = require('./supabase');
const {
  findPersonByEmail,
  updatePerson,
  supportsPeopleTable,
  normalizeEmail,
} = require('./peopleStore');

const CONTACTS_TABLE = 'contacts';

async function hasContactOrPersonForEmail(emailInput) {
  const email = normalizeEmail(emailInput);
  if (!email) return false;

  if (await supportsPeopleTable()) {
    const personRes = await findPersonByEmail(email);
    if (!personRes.ok) return false;
    if (personRes.data) return true;
  }

  const byEmail = await sbQuery({
    method: 'GET',
    table: CONTACTS_TABLE,
    query: `select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
  });
  if (byEmail.ok && Array.isArray(byEmail.data) && byEmail.data.length) return true;

  return false;
}

async function linkAuthUserByEmail(userIdInput, emailInput) {
  const userId = String(userIdInput || '').trim();
  const email = normalizeEmail(emailInput);
  if (!userId || !email) {
    return { ok: false, status: 400, error: 'userId and email are required' };
  }

  const now = new Date().toISOString();
  let personId = null;

  if (await supportsPeopleTable()) {
    const personRes = await findPersonByEmail(email);
    if (personRes.ok && personRes.data?.id) {
      personId = personRes.data.id;
      const patch = await updatePerson(personId, { authUserId: userId });
      if (!patch.ok) return patch;
    }
  }

  if (personId) {
    await sbQuery({
      method: 'PATCH',
      table: CONTACTS_TABLE,
      query: `person_id=eq.${encodeURIComponent(personId)}`,
      body: { auth_user_id: userId, updated_at: now },
    });
  }

  await sbQuery({
    method: 'PATCH',
    table: CONTACTS_TABLE,
    query: `email=eq.${encodeURIComponent(email)}`,
    body: { auth_user_id: userId, updated_at: now },
  });

  return { ok: true, status: 200 };
}

module.exports = {
  hasContactOrPersonForEmail,
  linkAuthUserByEmail,
};
