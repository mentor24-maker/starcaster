'use strict';

/**
 * lib/ContactsStore.js
 * Supabase-backed persistence for the unified contacts table.
 *
 * Replaces lib/store.js (contacts functions) and lib/promoLeads.js.
 * Segments, campaigns and events remain in lib/store.js unchanged.
 *
 * ── Contact types ──────────────────────────────────────────────────────────
 *   lead | prospect | subscriber | member | partner | other
 *
 * ── All functions return { ok, status, data, error } ──────────────────────
 */

const { sbQuery } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
  isStrictProjectScope,
} = require('./projectScope');

/** projectId value for cross-project contact search (all accessible except active). */
const ALL_PROJECTS_SCOPE_ID = '__all__';
const {
  supportsPeopleTable,
  flattenContactWithPerson,
  findPersonByEmail,
  createPerson,
  updatePerson,
  personRowFromContactRow,
  splitIncomingContact,
  nextPersonId,
  normalizeEmail,
} = require('./peopleStore');

const CONTACTS_TABLE      = 'contacts';
const FIELD_CONFIGS_TABLE = 'contact_field_configs';
const CONTACT_TYPES_TABLE = 'contact_types';
const CONTACT_STATUSES_TABLE = 'contact_statuses';
const CONTACT_SOURCES_TABLE = 'contact_sources';
const SEGMENT_TYPES_TABLE = 'segment_types';

const OPTIONS_TABLES = {
  types: CONTACT_TYPES_TABLE,
  statuses: CONTACT_STATUSES_TABLE,
  sources: CONTACT_SOURCES_TABLE,
  segment_types: SEGMENT_TYPES_TABLE
};

// Valid contact types — mirrors the contact_types seed in Phase 1 SQL
const VALID_TYPES = new Set([
  'lead', 'prospect', 'subscriber', 'member', 'partner', 'other', '',
  'team-admin', 'team-editor',
]);
/** Contact types that receive platform team RBAC (extensible later). */
const TEAM_MEMBER_TYPES = new Set(['team-admin', 'team-editor']);
const VALID_CLASSES = new Set(['persona', 'personality', 'personnel']);
const VALID_ENTITY_TYPES = new Set(['Human', 'Agent']);

function normalizeEntityType(value) {
  const text = String(value || '').trim();
  return VALID_ENTITY_TYPES.has(text) ? text : 'Human';
}

function sb({ method = 'GET', table, query = '', body, extraHeaders = {} }) {
  return sbQuery({ method, table, query, body, headers: extraHeaders });
}

function safeText(value) {
  return String(value || '').trim();
}

// ---------------------------------------------------------------------------
// Row normalisers
// ---------------------------------------------------------------------------

/**
 * Normalise a DB row to the shape the frontend and routes expect.
 * Includes all fields from the unified schema.
 */
function rowToContact(row) {
  if (!row) return null;
  const flat = flattenContactWithPerson(row);
  return {
    // Identity
    id:           flat.id,
    personId:     flat.person_id || null,
    authUserId:   flat.auth_user_id || null,
    contactType:  flat.contact_type || '',
    contactClass: flat.contact_class || 'persona',

    // Core
    entity_type:  flat.entity_type || '',
    email:        flat.email      || null,
    firstName:    flat.first_name || '',
    middleName:   flat.middle_name || '',
    lastName:     flat.last_name  || '',
    company:      flat.company    || '',
    phone:        flat.phone      || '',
    city:         flat.city       || '',
    country:      flat.country    || '',
    tags:         Array.isArray(flat.tags) ? flat.tags : [],

    // Social
    website:      flat.website   || '',
    youtube:      flat.youtube   || '',
    instagram:    flat.instagram || '',
    tiktok:       flat.tiktok    || '',
    facebook:     flat.facebook  || '',
    x:            flat.x         || '',
    bluesky:      flat.bluesky   || '',
    patreon:      flat.patreon   || '',
    linkedin:     flat.linkedin  || '',

    // Provenance
    source:       flat.source || '',
    status:       flat.status || '',
    notes:        flat.notes  || '',

    // Custom fields
    customFields: flat.custom_fields || {},

    // Metadata
    createdAt:    flat.created_at,
    updatedAt:    flat.updated_at,
  };
}

function membershipToRow(data, { includeUndefined = false } = {}) {
  const set = (camel, snake, transform) => {
    const val = data[camel] !== undefined ? data[camel] : data[snake];
    if (val === undefined && !includeUndefined) return {};
    const transformed = transform ? transform(val) : val;
    return { [snake]: transformed };
  };
  return {
    ...set('contactType', 'contact_type', (v) => (VALID_TYPES.has(String(v).trim()) ? String(v).trim() || null : null)),
    ...set('contactClass', 'contact_class', (v) => (VALID_CLASSES.has(v) ? v : 'persona')),
    ...set('tags', 'tags', (v) => (Array.isArray(v) ? v.map((t) => String(t).trim()).filter(Boolean) : [])),
    ...set('source', 'source', (v) => String(v || '').trim()),
    ...set('status', 'status', (v) => String(v || '').trim()),
    ...set('notes', 'notes', (v) => String(v || '').trim()),
  };
}

function scopeProjectId(scope) {
  return safeText(scope?.projectId || scope?.project_id);
}

/**
 * Email on contacts.membership rows: null when person_id holds the canonical address.
 * Avoids legacy contacts_email_unique_idx (global) violations across projects.
 */
function emailForMembershipContactRow(personId, email) {
  if (safeText(personId)) return null;
  return email ? normalizeEmail(email) : null;
}

function isGlobalContactEmailConstraintError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('contacts_email_unique_idx')
    || (text.includes('duplicate key') && text.includes('email') && text.includes('contacts'));
}

async function membershipExistsInProject(personId, projectId) {
  const pid = safeText(personId);
  const proj = safeText(projectId);
  if (!pid || !proj) return false;
  const result = await sb({
    table: CONTACTS_TABLE,
    query: `select=id&person_id=eq.${encodeURIComponent(pid)}&project_id=eq.${encodeURIComponent(proj)}&limit=1`,
  });
  if (!result.ok) return false;
  return (Array.isArray(result.data) ? result.data : []).length > 0;
}

async function ensurePersonIdForContactRow(contactRow) {
  const existing = safeText(contactRow?.person_id);
  if (existing) return existing;

  const usePeople = await supportsPeopleTable();
  if (!usePeople) return null;

  const email = normalizeEmail(contactRow?.email);
  if (email) {
    const found = await findPersonByEmail(email);
    if (found.ok && found.data?.id) {
      await sb({
        method: 'PATCH',
        table: CONTACTS_TABLE,
        query: `id=eq.${encodeURIComponent(contactRow.id)}`,
        body: { person_id: found.data.id },
      });
      return found.data.id;
    }
  }

  const personId = nextPersonId();
  const createRes = await createPerson({
    id: personId,
    ...personRowFromContactRow(contactRow),
  });
  if (!createRes.ok && email) {
    const found = await findPersonByEmail(email);
    if (found.ok && found.data?.id) {
      await sb({
        method: 'PATCH',
        table: CONTACTS_TABLE,
        query: `id=eq.${encodeURIComponent(contactRow.id)}`,
        body: { person_id: found.data.id },
      });
      return found.data.id;
    }
    return null;
  }
  if (!createRes.ok) return null;

  await sb({
    method: 'PATCH',
    table: CONTACTS_TABLE,
    query: `id=eq.${encodeURIComponent(contactRow.id)}`,
    body: { person_id: personId },
  });
  return personId;
}

function contactsListQuery(orderParts) {
  return `select=*,people(*)&${orderParts.join('&')}`;
}

/**
 * Normalise incoming contact data (camelCase or snake_case) to a DB row.
 * Only includes fields that are explicitly provided — safe for PATCH calls.
 */
function contactToRow(data, { includeUndefined = false } = {}) {
  const set = (camel, snake, transform) => {
    const val = data[camel] !== undefined ? data[camel] : data[snake];
    if (val === undefined && !includeUndefined) return {};
    const transformed = transform ? transform(val) : val;
    return { [snake]: transformed };
  };

  return {
    ...set('contactType',  'contact_type',  v => VALID_TYPES.has(String(v).trim()) ? String(v).trim() || null : null),
    ...set('authUserId',   'auth_user_id',  v => {
      const id = String(v || '').trim();
      return id || null;
    }),
    ...set('contactClass', 'contact_class', v => VALID_CLASSES.has(v) ? v : 'persona'),
    ...set('entityType',   'entity_type',   v => normalizeEntityType(v)),
    ...set('email',        'email',         v => v ? String(v).trim().toLowerCase() || null : null),
    ...set('firstName',    'first_name',    v => String(v || '').trim()),
    ...set('middleName',   'middle_name',   v => String(v || '').trim()),
    ...set('lastName',     'last_name',     v => String(v || '').trim()),
    ...set('company',      'company',       v => String(v || '').trim()),
    ...set('phone',        'phone',         v => String(v || '').trim()),
    ...set('city',         'city',          v => String(v || '').trim()),
    ...set('country',      'country',       v => String(v || '').trim()),
    ...set('tags',         'tags',          v => Array.isArray(v) ? v.map(t => String(t).trim()).filter(Boolean) : []),
    ...set('website',      'website',       v => String(v || '').trim()),
    ...set('youtube',      'youtube',       v => String(v || '').trim()),
    ...set('instagram',    'instagram',     v => String(v || '').trim()),
    ...set('tiktok',       'tiktok',        v => String(v || '').trim()),
    ...set('facebook',     'facebook',      v => String(v || '').trim()),
    ...set('x',            'x',             v => String(v || '').trim()),
    ...set('bluesky',      'bluesky',       v => String(v || '').trim()),
    ...set('patreon',      'patreon',       v => String(v || '').trim()),
    ...set('linkedin',     'linkedin',      v => String(v || '').trim()),
    ...set('source',       'source',        v => String(v || '').trim()),
    ...set('status',       'status',        v => String(v || '').trim()),
    ...set('notes',        'notes',         v => String(v || '').trim()),
    ...set('customFields', 'custom_fields', v => (v && typeof v === 'object') ? v : {}),
  };
}

// ---------------------------------------------------------------------------
// Contact CRUD
// ---------------------------------------------------------------------------

/**
 * List contacts, optionally filtered by type.
 * @param {object} [opts]
 * @param {string}  [opts.contactType] - Filter to a specific type
 * @param {string}  [opts.contactClass] - Filter to a specific class
 * @param {number}  [opts.limit]       - Max rows (default 5000)
 * @param {string}  [opts.orderBy]     - Column to order by (default created_at)
 * @param {string}  [opts.orderDir]    - 'asc' | 'desc' (default desc)
 */
async function listContacts({ contactType, contactClass, limit = 5000, orderBy = 'created_at', orderDir = 'desc', scope = null } = {}) {
  let queryParts = [`order=${orderBy}.${orderDir}`, `limit=${limit}`];
  if (contactType && VALID_TYPES.has(contactType)) {
    queryParts.push(`contact_type=eq.${encodeURIComponent(contactType)}`);
  }
  if (contactClass && VALID_CLASSES.has(contactClass)) {
    queryParts.push(`contact_class=eq.${encodeURIComponent(contactClass)}`);
  }
  const usePeople = await supportsPeopleTable();
  const baseSelect = usePeople ? contactsListQuery(queryParts) : `select=*&${queryParts.join('&')}`;
  const query = await scopedListQuery(CONTACTS_TABLE, baseSelect, scope);
  return sb({
    table: CONTACTS_TABLE,
    query,
  });
}

/**
 * Get a single contact by ID.
 */
async function getContact(id, scope = null) {
  const usePeople = await supportsPeopleTable();
  const select = usePeople ? 'select=*,people(*)' : 'select=*';
  const query = await scopedIdQuery(
    CONTACTS_TABLE,
    `${select}&id=eq.${encodeURIComponent(id)}&limit=1`,
    scope
  );
  const result = await sb({
    table: CONTACTS_TABLE,
    query,
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'Contact not found' };
  return { ok: true, status: 200, data: flattenContactWithPerson(row) };
}

/**
 * Create a single contact.
 * @param {object} contact - Contact data (camelCase or snake_case)
 * @param {string} contact.id - Required: pre-generated ID
 */
async function createContact(contact, scope = null) {
  if (!contact.id) return { ok: false, status: 400, error: 'contact.id is required' };

  const usePeople = await supportsPeopleTable();
  if (!usePeople) {
    const row = await scopedInsertRow(CONTACTS_TABLE, {
      id: contact.id,
      ...contactToRow(contact, { includeUndefined: false }),
    }, scope);
    if (!row.contact_type) row.contact_type = 'lead';
    return sb({
      method: 'POST',
      table: CONTACTS_TABLE,
      query: 'select=*',
      extraHeaders: { Prefer: 'return=representation' },
      body: [row],
    });
  }

  const { person: personPatch, membership: membershipPatch } = splitIncomingContact(
    contact,
    contactToRow
  );
  const email = personPatch.email != null ? normalizeEmail(personPatch.email) : null;
  const projectId = scopeProjectId(scope);

  let personId = safeText(contact.personId || contact.person_id);
  if (!personId && email) {
    const found = await findPersonByEmail(email);
    if (!found.ok) return found;
    if (found.data?.id) personId = found.data.id;
  }

  if (personId && projectId && await membershipExistsInProject(personId, projectId)) {
    return { ok: false, status: 409, error: 'This contact is already in the active project' };
  }

  if (!personId) {
    personId = nextPersonId();
    const createPersonRes = await createPerson({ id: personId, ...personPatch });
    if (!createPersonRes.ok) {
      if (email) {
        const found = await findPersonByEmail(email);
        if (!found.ok) return found;
        if (!found.data?.id) return createPersonRes;
        personId = found.data.id;
      } else {
        return createPersonRes;
      }
    }
  } else if (Object.keys(personPatch).length > 0) {
    const updateRes = await updatePerson(personId, personPatch);
    if (!updateRes.ok) return updateRes;
  }

  const row = await scopedInsertRow(CONTACTS_TABLE, {
    id: contact.id,
    person_id: personId,
    email: emailForMembershipContactRow(personId, email),
    ...membershipPatch,
  }, scope);

  if (!row.contact_type) row.contact_type = 'lead';

  const insertRes = await sb({
    method: 'POST',
    table: CONTACTS_TABLE,
    query: 'select=*,people(*)',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!insertRes.ok) {
    if (isGlobalContactEmailConstraintError(insertRes.error)) {
      return {
        ok: false,
        status: 409,
        error: 'Database still has a global unique constraint on contacts.email. Run docs/SQL/contacts_drop_global_email_unique.sql in Supabase.',
      };
    }
    return insertRes;
  }
  const created = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return { ok: true, status: insertRes.status, data: flattenContactWithPerson(created) };
}

/**
 * Update a contact by ID (partial update — only provided fields change).
 * @param {string} id
 * @param {object} patch - Fields to update
 */
async function updateContact(id, patch, scope = null) {
  const usePeople = await supportsPeopleTable();
  if (!usePeople) {
    const row = await scopedPatchRow(CONTACTS_TABLE, contactToRow(patch), scope);
    if (Object.keys(row).length === 0) {
      return { ok: false, status: 400, error: 'No valid fields to update' };
    }
    const query = await scopedIdQuery(CONTACTS_TABLE, `id=eq.${encodeURIComponent(id)}&select=*`, scope);
    return sb({
      method: 'PATCH',
      table: CONTACTS_TABLE,
      query,
      extraHeaders: { Prefer: 'return=representation' },
      body: row,
    });
  }

  const current = await getContact(id, scope);
  if (!current.ok) return current;

  const { person: personPatch, membership: membershipPatch } = splitIncomingContact(patch, contactToRow);
  const memRow = membershipToRow(patch, { includeUndefined: false });
  const hasPerson = Object.keys(personPatch).length > 0;
  const hasMembership = Object.keys(memRow).length > 0;

  if (!hasPerson && !hasMembership) {
    return { ok: false, status: 400, error: 'No valid fields to update' };
  }

  let personId = safeText(current.data?.person_id);
  if (!personId) personId = await ensurePersonIdForContactRow(current.data);

  if (hasPerson && personId) {
    const personRes = await updatePerson(personId, personPatch);
    if (!personRes.ok) return personRes;
  }

  if (hasMembership) {
    const scoped = await scopedPatchRow(CONTACTS_TABLE, memRow, scope);
    if (personPatch.email) scoped.email = normalizeEmail(personPatch.email);
    if (Object.keys(scoped).length > 0) {
      const query = await scopedIdQuery(
        CONTACTS_TABLE,
        `id=eq.${encodeURIComponent(id)}&select=*,people(*)`,
        scope
      );
      const patchRes = await sb({
        method: 'PATCH',
        table: CONTACTS_TABLE,
        query,
        extraHeaders: { Prefer: 'return=representation' },
        body: scoped,
      });
      if (!patchRes.ok) return patchRes;
      const row = Array.isArray(patchRes.data) ? patchRes.data[0] : patchRes.data;
      return { ok: true, status: patchRes.status, data: flattenContactWithPerson(row) };
    }
  }

  if (hasPerson && personPatch.email) {
    const mirror = await scopedPatchRow(CONTACTS_TABLE, { email: normalizeEmail(personPatch.email) }, scope);
    if (Object.keys(mirror).length > 0) {
      const query = await scopedIdQuery(CONTACTS_TABLE, `id=eq.${encodeURIComponent(id)}`, scope);
      await sb({ method: 'PATCH', table: CONTACTS_TABLE, query, body: mirror });
    }
  }

  return getContact(id, scope);
}

/**
 * Delete a contact by ID.
 */
async function deleteContact(id, scope = null) {
  const query = await scopedIdQuery(CONTACTS_TABLE, `id=eq.${encodeURIComponent(id)}`, scope);
  return sb({
    method:       'DELETE',
    table:        CONTACTS_TABLE,
    query,
    extraHeaders: { Prefer: 'return=representation' },
  });
}

/**
 * Bulk import contacts.
 * Skips duplicates by email (ignore strategy).
 * Contacts without email are always inserted (no duplicate check possible).
 *
 * @param {Array<object>} rows - Array of contact objects
 * @param {object} [opts]
 * @param {string} [opts.defaultType] - contact_type for rows that don't specify one (default: 'lead')
 */
async function importContacts(rows, { defaultType = 'lead', scope = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, status: 400, error: 'No contacts to import' };
  }

  const usePeople = await supportsPeopleTable();
  if (!usePeople) {
    const withEmail = [];
    const withoutEmail = [];
    for (const row of rows) {
      if (!row.id) continue;
      const prepared = await scopedInsertRow(CONTACTS_TABLE, {
        id: row.id,
        contact_type: VALID_TYPES.has(row.contact_type || row.contactType)
          ? (row.contact_type || row.contactType)
          : defaultType,
        ...contactToRow(row),
      }, scope);
      const email = prepared.email;
      if (email && email.includes('@')) withEmail.push(prepared);
      else {
        prepared.email = null;
        withoutEmail.push(prepared);
      }
    }
    const results = [];
    if (withEmail.length > 0) {
      results.push(await sb({
        method: 'POST',
        table: CONTACTS_TABLE,
        query: 'on_conflict=project_id,email',
        extraHeaders: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: withEmail,
      }));
    }
    if (withoutEmail.length > 0) {
      results.push(await sb({
        method: 'POST',
        table: CONTACTS_TABLE,
        extraHeaders: { Prefer: 'return=representation' },
        body: withoutEmail,
      }));
    }
    const failed = results.find((r) => !r.ok);
    if (failed) return failed;
    const imported = results.reduce((sum, r) => sum + (Array.isArray(r.data) ? r.data.length : 0), 0);
    return { ok: true, status: 201, data: { imported } };
  }

  let imported = 0;
  for (const row of rows) {
    if (!row.id) continue;
    const payload = {
      ...row,
      contactType: row.contactType || row.contact_type || defaultType,
    };
    const result = await createContact(payload, scope);
    if (!result.ok) {
      if (result.status === 409) continue;
      return result;
    }
    imported += 1;
  }
  return { ok: true, status: 201, data: { imported } };
}

// ---------------------------------------------------------------------------
// Contact Options (Types, Statuses, Sources)
// ---------------------------------------------------------------------------

/**
 * Legacy listContactTypes (returns only active)
 */
async function listContactTypes() {
  return listContactOptions('types', { activeOnly: true });
}

/**
 * List options for a given category (types, statuses, sources).
 * @param {string} category 
 * @param {object} [opts]
 */
async function listContactOptions(category, { activeOnly = false } = {}) {
  const table = OPTIONS_TABLES[category];
  if (!table) return { ok: false, status: 400, error: 'Invalid options category' };
  let query = activeOnly 
    ? 'select=*&is_active=eq.true&order=sort_order.asc'
    : 'select=*&order=sort_order.asc';
  
  let res = await sb({ table, query });
  
  // Graceful fallback for legacy tables (e.g. contact_types) that don't have is_active or sort_order yet
  if (!res.ok && res.error && res.error.includes('does not exist')) {
    res = await sb({ table, query: 'select=*' });
  }
  return res;
}

/**
 * Create a new option
 */
async function createContactOption(category, option) {
  const table = OPTIONS_TABLES[category];
  if (!table) return { ok: false, status: 400, error: 'Invalid options category' };
  if (!option.key) return { ok: false, status: 400, error: 'key is required' };
  if (!option.label) return { ok: false, status: 400, error: 'label is required' };

  return sb({
    method: 'POST',
    table,
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [{
      key: String(option.key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      label: String(option.label).trim(),
      is_active: option.is_active !== false,
      sort_order: option.sort_order || 0
    }]
  });
}

/**
 * Update an option Note: assumes id is uuid or string.
 */
async function updateContactOption(category, id, patch) {
  const table = OPTIONS_TABLES[category];
  if (!table) return { ok: false, status: 400, error: 'Invalid options category' };

  const allowed = ['label', 'is_active', 'sort_order'];
  const body = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) body[key] = patch[key];
  }
  if (Object.keys(body).length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' };
  }

  return sb({
    method: 'PATCH',
    table,
    query: `id=eq.${encodeURIComponent(id)}&select=*`,
    extraHeaders: { Prefer: 'return=representation' },
    body
  });
}

/**
 * Delete an option
 */
async function deleteContactOption(category, id) {
  const table = OPTIONS_TABLES[category];
  if (!table) return { ok: false, status: 400, error: 'Invalid options category' };

  return sb({
    method: 'DELETE',
    table,
    query: `id=eq.${encodeURIComponent(id)}`,
    extraHeaders: { Prefer: 'return=representation' }
  });
}

// ---------------------------------------------------------------------------
// Field configs (per contact type custom fields)
// ---------------------------------------------------------------------------

/**
 * List field configs, optionally filtered by contact type.
 */
async function listFieldConfigs(contactType) {
  const typeFilter = contactType && VALID_TYPES.has(contactType)
    ? `&contact_type=eq.${encodeURIComponent(contactType)}`
    : '';
  return sb({
    table: FIELD_CONFIGS_TABLE,
    query: `select=*&is_active=eq.true&order=contact_type.asc,sort_order.asc${typeFilter}`,
  });
}

/**
 * Create a field config.
 */
async function createFieldConfig(config) {
  if (!config.id)          return { ok: false, status: 400, error: 'id is required' };
  if (!config.contact_type) return { ok: false, status: 400, error: 'contact_type is required' };
  if (!config.key)         return { ok: false, status: 400, error: 'key is required' };
  if (!config.label)       return { ok: false, status: 400, error: 'label is required' };

  return sb({
    method:       'POST',
    table:        FIELD_CONFIGS_TABLE,
    query:        'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body:         [{
      id:           config.id,
      contact_type: config.contact_type,
      key:          String(config.key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      label:        String(config.label).trim(),
      field_type:   config.field_type  || 'text',
      required:     config.required    || false,
      is_active:    config.is_active   !== false,
      sort_order:   config.sort_order  || 0,
      options:      Array.isArray(config.options) ? config.options : [],
    }],
  });
}

/**
 * Update a field config by ID.
 */
async function updateFieldConfig(id, patch) {
  const allowed = ['label', 'field_type', 'required', 'is_active', 'sort_order', 'options'];
  const body    = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) body[key] = patch[key];
  }
  if (Object.keys(body).length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' };
  }
  return sb({
    method:       'PATCH',
    table:        FIELD_CONFIGS_TABLE,
    query:        `id=eq.${encodeURIComponent(id)}&select=*`,
    extraHeaders: { Prefer: 'return=representation' },
    body,
  });
}

/**
 * Delete a field config by ID.
 */
async function deleteFieldConfig(id) {
  return sb({
    method:       'DELETE',
    table:        FIELD_CONFIGS_TABLE,
    query:        `id=eq.${encodeURIComponent(id)}`,
    extraHeaders: { Prefer: 'return=representation' },
  });
}

// ---------------------------------------------------------------------------
// Database introspection (moved from promoLeads.js)
// Used by Settings → Database page
// ---------------------------------------------------------------------------

/**
 * List all tables available for field management.
 * Returns a static config — extend this as new tables are added.
 */
async function listDatabaseTables() {
  const tables = [
    {
      key:                  'contacts',
      label:                'Contacts',
      supportsFieldCreation: true,
      description:          'Unified contacts table — all contact types'
    },
  ];
  return { ok: true, status: 200, data: tables };
}

/**
 * Create a new custom field for a contact type.
 * Adds a field config row; the value is stored in contacts.custom_fields JSONB.
 */
async function createDatabaseField(input) {
  const { nextId } = require('./supabase');

  const contactType = String(input.contact_type || input.contactType || 'lead').trim();
  if (!VALID_TYPES.has(contactType)) {
    return { ok: false, status: 400, error: `Invalid contact_type: ${contactType}` };
  }

  const key = String(input.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!key) return { ok: false, status: 400, error: 'Field key is required' };

  const label = String(input.label || '').trim();
  if (!label) return { ok: false, status: 400, error: 'Field label is required' };

  return createFieldConfig({
    id:           `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    contact_type: contactType,
    key,
    label,
    field_type:   input.type       || input.field_type || 'text',
    required:     input.required   || false,
    is_active:    input.is_active  !== false,
    sort_order:   Number(input.position || input.sort_order || 0),
    options:      Array.isArray(input.options) ? input.options : [],
  });
}

function contactMatchesSearch(flatRow, q) {
  const term = safeText(q).toLowerCase();
  if (!term) return true;
  const parts = [
    flatRow.first_name,
    flatRow.middle_name,
    flatRow.last_name,
    flatRow.email,
    flatRow.company,
  ].map((v) => String(v || '').toLowerCase());
  return parts.some((part) => part.includes(term));
}

function contactSearchSelect(usePeople) {
  return usePeople
    ? 'select=*,people(*)'
    : 'select=id,project_id,first_name,middle_name,last_name,email,company,contact_type,contact_class,person_id';
}

async function runContactSearchQuery(baseQuery, scope) {
  let query = await scopedListQuery(CONTACTS_TABLE, baseQuery, scope);
  let result = await sb({ table: CONTACTS_TABLE, query });
  if (result.ok) return result;
  const usePeople = await supportsPeopleTable();
  if (usePeople && String(result.error || '').toLowerCase().includes('people')) {
    const fallback = baseQuery.replace('select=*,people(*)', 'select=*');
    query = await scopedListQuery(CONTACTS_TABLE, fallback, scope);
    result = await sb({ table: CONTACTS_TABLE, query });
  }
  return result;
}

function filterSearchRows(rows, searchQuery, limit) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const q = safeText(searchQuery);
  let flat = rows.map(flattenContactWithPerson);
  if (q) flat = flat.filter((row) => contactMatchesSearch(row, q));
  return flat.slice(0, cap);
}

/**
 * Search contacts in a specific project (uses project scope compat for legacy NULL project_id).
 */
async function searchContactsInProject(projectId, searchQuery, { limit = 50, userScope = null } = {}) {
  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };

  const scope = {
    projectId: pid,
    userId: safeText(userScope?.userId),
    projectIds: Array.isArray(userScope?.projectIds) ? userScope.projectIds : [],
  };
  const usePeople = await supportsPeopleTable();
  const fetchLimit = Math.min(Math.max(Number(limit) || 50, 1), 100) * 4;
  const base = `${contactSearchSelect(usePeople)}&order=created_at.desc&limit=${fetchLimit}`;
  const result = await runContactSearchQuery(base, scope);
  if (!result.ok) return result;

  const rows = Array.isArray(result.data) ? result.data : [];
  return { ok: true, status: 200, data: filterSearchRows(rows, searchQuery, limit) };
}

/**
 * Search contacts across all projects the user can access (except the active project).
 */
async function searchContactsAcrossProjects(searchQuery, { limit = 50, userScope = null } = {}) {
  const activeId = safeText(userScope?.projectId);
  const userId = safeText(userScope?.userId);
  const accessible = Array.isArray(userScope?.projectIds)
    ? userScope.projectIds.map((id) => safeText(id)).filter(Boolean)
    : [];
  const projectIds = accessible.filter((id) => id && id !== activeId);

  const usePeople = await supportsPeopleTable();
  const select = contactSearchSelect(usePeople);
  const fetchLimit = Math.min(Math.max(Number(limit) || 50, 1), 100) * 6;
  const merged = new Map();

  const absorb = (rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const flat = flattenContactWithPerson(row);
      if (flat?.id) merged.set(flat.id, flat);
    });
  };

  for (const pid of projectIds) {
    const scope = { projectId: pid, userId, projectIds: accessible };
    const base = `${select}&order=created_at.desc&limit=${fetchLimit}`;
    const result = await runContactSearchQuery(base, scope);
    if (result.ok) absorb(result.data);
  }

  if (!isStrictProjectScope() && userId) {
    const legacyQuery = `${select}&project_id=is.null&owner_user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${fetchLimit}`;
    const legacyRes = await sb({ table: CONTACTS_TABLE, query: legacyQuery });
    if (legacyRes.ok) absorb(legacyRes.data);
    else if (!String(legacyRes.error || '').toLowerCase().includes('owner_user_id')) {
      const fallbackLegacy = await sb({
        table: CONTACTS_TABLE,
        query: `${select}&project_id=is.null&order=created_at.desc&limit=${fetchLimit}`,
      });
      if (fallbackLegacy.ok) absorb(fallbackLegacy.data);
    }
  }

  const rows = filterSearchRows([...merged.values()], searchQuery, limit);
  return { ok: true, status: 200, data: rows };
}

async function contactExistsInProjectByEmail(email, projectId) {
  const normalized = normalizeEmail(email);
  const pid = safeText(projectId);
  if (!pid) return false;

  const usePeople = await supportsPeopleTable();
  if (usePeople && normalized) {
    const found = await findPersonByEmail(normalized);
    if (!found.ok || !found.data?.id) return false;
    return membershipExistsInProject(found.data.id, pid);
  }

  if (!normalized) return false;
  const result = await sb({
    table: CONTACTS_TABLE,
    query: `select=id&project_id=eq.${encodeURIComponent(pid)}&email=eq.${encodeURIComponent(normalized)}&limit=1`,
  });
  if (!result.ok) return false;
  return (Array.isArray(result.data) ? result.data : []).length > 0;
}

function nextContactId() {
  return `contact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create a project membership row from an existing contact / person profile.
 */
async function linkContactMembershipFromRow(flatRow, {
  newId,
  targetScope,
  contactType,
  contactClass,
} = {}) {
  const id = safeText(newId);
  const tgtPid = safeText(targetScope?.projectId || targetScope?.project_id);
  if (!id || !tgtPid) {
    return { ok: false, status: 400, error: 'Membership id and target project are required' };
  }

  const usePeople = await supportsPeopleTable();
  const email = flatRow.email ? normalizeEmail(flatRow.email) : null;

  if (!usePeople) {
    if (email && await contactExistsInProjectByEmail(email, tgtPid)) {
      return { ok: false, status: 409, error: 'This contact is already in that project' };
    }
    const {
      id: _omitId,
      created_at: _c,
      updated_at: _u,
      project_id: _p,
      owner_user_id: _o,
      person_id: _person,
      people: _people,
      ...copyFields
    } = flatRow;
    const typeOverride = safeText(contactType);
    const classOverride = safeText(contactClass);
    if (typeOverride) copyFields.contact_type = typeOverride;
    if (classOverride && VALID_CLASSES.has(classOverride)) copyFields.contact_class = classOverride;
    copyFields.email = email;
    const row = await scopedInsertRow(CONTACTS_TABLE, { id, ...copyFields }, targetScope);
    if (!row.contact_type) row.contact_type = 'lead';
    const legacyRes = await sb({
      method: 'POST',
      table: CONTACTS_TABLE,
      query: 'select=*',
      extraHeaders: { Prefer: 'return=representation' },
      body: [row],
    });
    if (!legacyRes.ok && isGlobalContactEmailConstraintError(legacyRes.error)) {
      return {
        ok: false,
        status: 409,
        error: 'Database still has a global unique constraint on contacts.email. Run docs/SQL/contacts_drop_global_email_unique.sql in Supabase.',
      };
    }
    return legacyRes;
  }

  let personId = safeText(flatRow.person_id);
  if (!personId) personId = await ensurePersonIdForContactRow(flatRow);
  if (!personId) {
    return { ok: false, status: 500, error: 'Could not resolve person for this contact' };
  }

  if (await membershipExistsInProject(personId, tgtPid)) {
    return { ok: false, status: 409, error: 'This contact is already in that project' };
  }

  const typeOverride = safeText(contactType);
  const classOverride = safeText(contactClass);
  const membership = {
    contact_type: typeOverride || flatRow.contact_type || 'lead',
    contact_class: (classOverride && VALID_CLASSES.has(classOverride))
      ? classOverride
      : (flatRow.contact_class || 'persona'),
    tags: Array.isArray(flatRow.tags) ? flatRow.tags : [],
    source: flatRow.source || '',
    status: flatRow.status || '',
    notes: flatRow.notes || '',
  };

  const row = await scopedInsertRow(CONTACTS_TABLE, {
    id,
    person_id: personId,
    email: emailForMembershipContactRow(personId, email),
    ...membership,
  }, targetScope);

  const insertRes = await sb({
    method: 'POST',
    table: CONTACTS_TABLE,
    query: 'select=*,people(*)',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!insertRes.ok) {
    if (isGlobalContactEmailConstraintError(insertRes.error)) {
      return {
        ok: false,
        status: 409,
        error: 'Database still has a global unique constraint on contacts.email. Run docs/SQL/contacts_drop_global_email_unique.sql in Supabase.',
      };
    }
    return insertRes;
  }
  const created = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return { ok: true, status: insertRes.status, data: flattenContactWithPerson(created) };
}

/**
 * List project IDs where this contact (person) already has a membership.
 */
async function listContactMembershipProjectIds(contactId, userScope = null) {
  const cid = safeText(contactId);
  if (!cid) return { ok: false, status: 400, error: 'contactId is required' };

  const getRes = await getContact(cid, userScope);
  if (!getRes.ok) return getRes;
  const flat = getRes.data;
  const accessible = new Set(
    (Array.isArray(userScope?.projectIds) ? userScope.projectIds : [])
      .map((id) => safeText(id))
      .filter(Boolean)
  );
  if (userScope?.projectId) accessible.add(safeText(userScope.projectId));

  const personId = safeText(flat.person_id);
  if (personId && await supportsPeopleTable()) {
    const result = await sb({
      table: CONTACTS_TABLE,
      query: `select=project_id&person_id=eq.${encodeURIComponent(personId)}&project_id=not.is.null&limit=500`,
    });
    if (!result.ok) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    const projectIds = [...new Set(rows
      .map((row) => safeText(row.project_id))
      .filter((pid) => pid && (!accessible.size || accessible.has(pid))))];
    return { ok: true, status: 200, data: projectIds };
  }

  const rowProjectId = safeText(flat.project_id);
  return { ok: true, status: 200, data: rowProjectId ? [rowProjectId] : [] };
}

/**
 * Add contact person to one or more projects (new membership rows).
 */
async function assignContactToProjects({
  contactId,
  projectIds,
  userScope = null,
  contactType,
  contactClass,
} = {}) {
  const cid = safeText(contactId);
  const targets = [...new Set((Array.isArray(projectIds) ? projectIds : []).map(safeText).filter(Boolean))];
  if (!cid) return { ok: false, status: 400, error: 'contactId is required' };
  if (!targets.length) return { ok: false, status: 400, error: 'At least one project is required' };

  const getRes = await getContact(cid, userScope);
  if (!getRes.ok) return getRes;
  const flat = getRes.data;

  const added = [];
  const skipped = [];

  for (const targetProjectId of targets) {
    const targetScope = {
      projectId: targetProjectId,
      userId: safeText(userScope?.userId),
      projectIds: Array.isArray(userScope?.projectIds) ? userScope.projectIds : [],
    };
    const linkRes = await linkContactMembershipFromRow(flat, {
      newId: nextContactId(),
      targetScope,
      contactType,
      contactClass,
    });
    if (linkRes.ok) {
      added.push({
        projectId: targetProjectId,
        contactId: linkRes.data?.id || '',
      });
    } else {
      skipped.push({
        projectId: targetProjectId,
        error: linkRes.error || 'Could not add to project',
        status: linkRes.status || 500,
      });
    }
  }

  if (!added.length && skipped.length) {
    const first = skipped[0];
    return {
      ok: false,
      status: first.status || 409,
      error: first.error || 'Contact could not be added to any project',
      data: { added, skipped },
    };
  }

  return { ok: true, status: 201, data: { added, skipped } };
}

/**
 * Link an existing person (from another project's membership) into the active project.
 */
async function assignContactFromProject({
  sourceContactId,
  sourceProjectId,
  newId,
  targetScope,
  contactType,
  contactClass,
} = {}) {
  const srcId = safeText(sourceContactId);
  const srcPid = safeText(sourceProjectId);
  const tgtPid = safeText(targetScope?.projectId || targetScope?.project_id);
  const id = safeText(newId);

  if (!srcId || !srcPid || !tgtPid || !id) {
    return { ok: false, status: 400, error: 'sourceContactId, sourceProjectId, and target project are required' };
  }
  if (srcPid === tgtPid) {
    return { ok: false, status: 400, error: 'Choose a project other than the active project' };
  }

  const usePeople = await supportsPeopleTable();
  const srcSelect = usePeople ? 'select=*,people(*)' : 'select=*';
  const srcRes = await sb({
    table: CONTACTS_TABLE,
    query: `${srcSelect}&id=eq.${encodeURIComponent(srcId)}&limit=1`,
  });
  if (!srcRes.ok) return srcRes;
  const sourceRow = Array.isArray(srcRes.data) ? srcRes.data[0] : null;
  if (!sourceRow) return { ok: false, status: 404, error: 'Contact not found' };

  const rowProjectId = safeText(sourceRow.project_id);
  const legacySource = srcPid === '__legacy__';
  if (legacySource && rowProjectId) {
    return { ok: false, status: 400, error: 'Contact is not a legacy unassigned row' };
  }
  if (!legacySource && rowProjectId && rowProjectId !== srcPid) {
    return { ok: false, status: 400, error: 'Contact does not belong to the selected project' };
  }
  if (!legacySource && !rowProjectId && srcPid) {
    const probeScope = { projectId: srcPid, userId: safeText(targetScope?.userId) };
    const probe = await runContactSearchQuery(
      `${srcSelect}&id=eq.${encodeURIComponent(srcId)}&limit=1`,
      probeScope
    );
    if (!probe.ok || !(Array.isArray(probe.data) && probe.data[0])) {
      return { ok: false, status: 404, error: 'Contact not found in the selected project' };
    }
  }

  const flat = flattenContactWithPerson(sourceRow);
  return linkContactMembershipFromRow(flat, {
    newId: id,
    targetScope,
    contactType,
    contactClass,
  });
}

/**
 * Check whether Supabase is configured (used by /api/health).
 */
function hasSupabaseConfig() {
  const { getProviderValues } = require('./apiSettings');
  const vals = getProviderValues('supabase');
  return !!(vals.url && vals.service_role_key);
}

module.exports = {
  // Contacts CRUD
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  searchContactsInProject,
  searchContactsAcrossProjects,
  ALL_PROJECTS_SCOPE_ID,
  assignContactFromProject,
  assignContactToProjects,
  listContactMembershipProjectIds,
  linkContactMembershipFromRow,

  // Contact options
  listContactTypes,
  listContactOptions,
  createContactOption,
  updateContactOption,
  deleteContactOption,

  // Field configs
  listFieldConfigs,
  createFieldConfig,
  updateFieldConfig,
  deleteFieldConfig,

  // Database introspection
  listDatabaseTables,
  createDatabaseField,
  hasSupabaseConfig,

  // Normalisers
  rowToContact,
  contactToRow,
  TEAM_MEMBER_TYPES,
};
