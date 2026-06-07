'use strict';

/**
 * lib/peopleStore.js
 * Global person identities (canonical profile fields shared across projects).
 * Project memberships remain in public.contacts with person_id.
 */

const { sbQuery } = require('./supabase');

const PEOPLE_TABLE = 'people';

const VALID_ENTITY_TYPES = new Set(['Human', 'Agent']);

let peopleTableSupported = null;

function sb(opts) {
  return sbQuery(opts);
}

function safeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(raw) {
  const text = safeText(raw).toLowerCase();
  return text || null;
}

function normalizeEntityType(value) {
  const text = safeText(value);
  return VALID_ENTITY_TYPES.has(text) ? text : 'Human';
}

async function supportsPeopleTable() {
  if (peopleTableSupported !== null) return peopleTableSupported;
  const probe = await sb({
    table: PEOPLE_TABLE,
    query: 'select=id&limit=1',
  });
  peopleTableSupported = probe.ok;
  return peopleTableSupported;
}

/** Fields stored on people (not per-project membership). */
const PERSON_FIELD_KEYS = [
  'email', 'first_name', 'middle_name', 'last_name', 'company', 'phone', 'city', 'country',
  'entity_type', 'auth_user_id',
  'website', 'youtube', 'instagram', 'tiktok', 'facebook', 'x', 'bluesky', 'patreon', 'linkedin',
  'custom_fields',
];

/** Fields stored on contacts (project membership). */
const MEMBERSHIP_FIELD_KEYS = [
  'contact_type', 'contact_class', 'tags', 'source', 'status', 'notes',
];

function personToRow(data, { includeUndefined = false } = {}) {
  const set = (camel, snake, transform) => {
    const val = data[camel] !== undefined ? data[camel] : data[snake];
    if (val === undefined && !includeUndefined) return {};
    const transformed = transform ? transform(val) : val;
    return { [snake]: transformed };
  };

  return {
    ...set('email', 'email', (v) => (v ? normalizeEmail(v) : null)),
    ...set('firstName', 'first_name', (v) => safeText(v)),
    ...set('middleName', 'middle_name', (v) => safeText(v)),
    ...set('lastName', 'last_name', (v) => safeText(v)),
    ...set('company', 'company', (v) => safeText(v)),
    ...set('phone', 'phone', (v) => safeText(v)),
    ...set('city', 'city', (v) => safeText(v)),
    ...set('country', 'country', (v) => safeText(v)),
    ...set('entityType', 'entity_type', normalizeEntityType),
    ...set('authUserId', 'auth_user_id', (v) => safeText(v) || null),
    ...set('website', 'website', (v) => safeText(v)),
    ...set('youtube', 'youtube', (v) => safeText(v)),
    ...set('instagram', 'instagram', (v) => safeText(v)),
    ...set('tiktok', 'tiktok', (v) => safeText(v)),
    ...set('facebook', 'facebook', (v) => safeText(v)),
    ...set('x', 'x', (v) => safeText(v)),
    ...set('bluesky', 'bluesky', (v) => safeText(v)),
    ...set('patreon', 'patreon', (v) => safeText(v)),
    ...set('linkedin', 'linkedin', (v) => safeText(v)),
    ...set('customFields', 'custom_fields', (v) => ((v && typeof v === 'object') ? v : {})),
  };
}

function rowToPerson(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || null,
    firstName: row.first_name || '',
    middleName: row.middle_name || '',
    lastName: row.last_name || '',
    company: row.company || '',
    phone: row.phone || '',
    city: row.city || '',
    country: row.country || '',
    entityType: row.entity_type || 'Human',
    authUserId: row.auth_user_id || null,
    website: row.website || '',
    youtube: row.youtube || '',
    instagram: row.instagram || '',
    tiktok: row.tiktok || '',
    facebook: row.facebook || '',
    x: row.x || '',
    bluesky: row.bluesky || '',
    patreon: row.patreon || '',
    linkedin: row.linkedin || '',
    customFields: row.custom_fields || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Merge embedded people.* onto a contacts row for rowToContact().
 */
function flattenContactWithPerson(contactRow) {
  if (!contactRow || typeof contactRow !== 'object') return contactRow;
  const embedded = contactRow.people;
  const person = (embedded && typeof embedded === 'object' && !Array.isArray(embedded))
    ? embedded
    : null;
  const { people: _drop, ...contact } = contactRow;
  if (!person) return contact;

  return {
    ...contact,
    person_id: contact.person_id || person.id,
    email: person.email != null ? person.email : contact.email,
    first_name: person.first_name != null ? person.first_name : contact.first_name,
    middle_name: person.middle_name != null ? person.middle_name : contact.middle_name,
    last_name: person.last_name != null ? person.last_name : contact.last_name,
    company: person.company != null ? person.company : contact.company,
    phone: person.phone != null ? person.phone : contact.phone,
    city: person.city != null ? person.city : contact.city,
    country: person.country != null ? person.country : contact.country,
    entity_type: person.entity_type != null ? person.entity_type : contact.entity_type,
    auth_user_id: person.auth_user_id != null ? person.auth_user_id : contact.auth_user_id,
    website: person.website != null ? person.website : contact.website,
    youtube: person.youtube != null ? person.youtube : contact.youtube,
    instagram: person.instagram != null ? person.instagram : contact.instagram,
    tiktok: person.tiktok != null ? person.tiktok : contact.tiktok,
    facebook: person.facebook != null ? person.facebook : contact.facebook,
    x: person.x != null ? person.x : contact.x,
    bluesky: person.bluesky != null ? person.bluesky : contact.bluesky,
    patreon: person.patreon != null ? person.patreon : contact.patreon,
    linkedin: person.linkedin != null ? person.linkedin : contact.linkedin,
    custom_fields: person.custom_fields != null ? person.custom_fields : contact.custom_fields,
  };
}

const CONTACT_EMBED_SELECT = 'select=*,people(*)';

async function findPersonByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: true, status: 200, data: null };
  if (!(await supportsPeopleTable())) {
    return { ok: true, status: 200, data: null };
  }
  const result = await sb({
    table: PEOPLE_TABLE,
    query: `select=*&email=eq.${encodeURIComponent(normalized)}&limit=1`,
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return { ok: true, status: 200, data: row };
}

async function getPersonById(id) {
  const pid = safeText(id);
  if (!pid) return { ok: false, status: 400, error: 'person id is required' };
  if (!(await supportsPeopleTable())) {
    return { ok: false, status: 404, error: 'People table not available' };
  }
  const result = await sb({
    table: PEOPLE_TABLE,
    query: `select=*&id=eq.${encodeURIComponent(pid)}&limit=1`,
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'Person not found' };
  return { ok: true, status: 200, data: row };
}

async function createPerson(person, { id } = {}) {
  const personId = safeText(id || person?.id);
  if (!personId) return { ok: false, status: 400, error: 'person id is required' };

  const row = {
    id: personId,
    ...personToRow(person, { includeUndefined: false }),
  };

  return sb({
    method: 'POST',
    table: PEOPLE_TABLE,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function updatePerson(id, patch) {
  const pid = safeText(id);
  if (!pid) return { ok: false, status: 400, error: 'person id is required' };

  const row = personToRow(patch);
  if (Object.keys(row).length === 0) {
    return { ok: false, status: 400, error: 'No valid person fields to update' };
  }

  return sb({
    method: 'PATCH',
    table: PEOPLE_TABLE,
    query: `id=eq.${encodeURIComponent(pid)}&select=*`,
    extraHeaders: { Prefer: 'return=representation' },
    body: row,
  });
}

/**
 * Build a people row from a legacy flat contacts row (backfill / lazy link).
 */
function personRowFromContactRow(contactRow) {
  const c = contactRow || {};
  return {
    email: c.email ? normalizeEmail(c.email) : null,
    first_name: safeText(c.first_name),
    middle_name: safeText(c.middle_name),
    last_name: safeText(c.last_name),
    company: safeText(c.company),
    phone: safeText(c.phone),
    city: safeText(c.city),
    country: safeText(c.country),
    entity_type: normalizeEntityType(c.entity_type),
    auth_user_id: safeText(c.auth_user_id) || null,
    website: safeText(c.website),
    youtube: safeText(c.youtube),
    instagram: safeText(c.instagram),
    tiktok: safeText(c.tiktok),
    facebook: safeText(c.facebook),
    x: safeText(c.x),
    bluesky: safeText(c.bluesky),
    patreon: safeText(c.patreon),
    linkedin: safeText(c.linkedin),
    custom_fields: (c.custom_fields && typeof c.custom_fields === 'object') ? c.custom_fields : {},
  };
}

function splitIncomingContact(data, contactToRowFn) {
  const full = contactToRowFn(data, { includeUndefined: false });
  const person = {};
  const membership = {};
  for (const key of PERSON_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(full, key)) person[key] = full[key];
  }
  for (const key of MEMBERSHIP_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(full, key)) membership[key] = full[key];
  }
  return { person, membership };
}

function nextPersonId() {
  return `person_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function deletePersonIfOrphaned(personIdInput) {
  const personId = safeText(personIdInput);
  if (!personId || !(await supportsPeopleTable())) return false;

  const contactsTable = String(process.env.SUPABASE_CONTACTS_TABLE || 'contacts').trim();
  const remaining = await sb({
    table: contactsTable,
    query: `select=id&person_id=eq.${encodeURIComponent(personId)}&limit=1`,
  });
  if (!remaining.ok) return false;
  if (Array.isArray(remaining.data) && remaining.data.length) return false;

  const deleted = await sb({
    method: 'DELETE',
    table: PEOPLE_TABLE,
    query: `id=eq.${encodeURIComponent(personId)}`,
  });
  return Boolean(deleted.ok);
}

module.exports = {
  PEOPLE_TABLE,
  PERSON_FIELD_KEYS,
  MEMBERSHIP_FIELD_KEYS,
  CONTACT_EMBED_SELECT,
  supportsPeopleTable,
  safeText,
  normalizeEmail,
  personToRow,
  rowToPerson,
  flattenContactWithPerson,
  findPersonByEmail,
  getPersonById,
  createPerson,
  updatePerson,
  personRowFromContactRow,
  splitIncomingContact,
  nextPersonId,
  deletePersonIfOrphaned,
};
