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
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

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
const VALID_TYPES = new Set(['lead', 'prospect', 'subscriber', 'member', 'partner', 'other', '']);
const VALID_CLASSES = new Set(['persona', 'personality', 'personnel']);

function sb({ method = 'GET', table, query = '', body, extraHeaders = {} }) {
  return sbQuery({ method, table, query, body, headers: extraHeaders });
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
  return {
    // Identity
    id:           row.id,
    contactType:  row.contact_type || '',
    contactClass: row.contact_class || 'persona',

    // Core
    entity_type:  row.entity_type || '',
    email:        row.email      || null,
    firstName:    row.first_name || '',
    lastName:     row.last_name  || '',
    company:      row.company    || '',
    phone:        row.phone      || '',
    city:         row.city       || '',
    country:      row.country    || '',
    tags:         Array.isArray(row.tags) ? row.tags : [],

    // Social
    website:      row.website   || '',
    youtube:      row.youtube   || '',
    instagram:    row.instagram || '',
    tiktok:       row.tiktok    || '',
    facebook:     row.facebook  || '',
    x:            row.x         || '',
    bluesky:      row.bluesky   || '',
    patreon:      row.patreon   || '',
    linkedin:     row.linkedin  || '',

    // Provenance
    source:       row.source || '',
    status:       row.status || '',
    notes:        row.notes  || '',

    // Custom fields
    customFields: row.custom_fields || {},

    // Metadata
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
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
    ...set('contactClass', 'contact_class', v => VALID_CLASSES.has(v) ? v : 'persona'),
    ...set('entityType',   'entity_type',   v => String(v || '').trim()),
    ...set('email',        'email',         v => v ? String(v).trim().toLowerCase() || null : null),
    ...set('firstName',    'first_name',    v => String(v || '').trim()),
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
  const query = await scopedListQuery(
    CONTACTS_TABLE,
    `select=*&${queryParts.join('&')}`,
    scope
  );
  return sb({
    table: CONTACTS_TABLE,
    query,
  });
}

/**
 * Get a single contact by ID.
 */
async function getContact(id, scope = null) {
  const query = await scopedIdQuery(CONTACTS_TABLE, `select=*&id=eq.${encodeURIComponent(id)}&limit=1`, scope);
  const result = await sb({
    table: CONTACTS_TABLE,
    query,
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'Contact not found' };
  return { ok: true, status: 200, data: row };
}

/**
 * Create a single contact.
 * @param {object} contact - Contact data (camelCase or snake_case)
 * @param {string} contact.id - Required: pre-generated ID
 */
async function createContact(contact, scope = null) {
  if (!contact.id) return { ok: false, status: 400, error: 'contact.id is required' };

  const row = await scopedInsertRow(CONTACTS_TABLE, {
    id: contact.id,
    ...contactToRow(contact, { includeUndefined: false }),
  }, scope);

  // Default contact_type to 'lead' if not specified
  if (!row.contact_type) row.contact_type = 'lead';

  return sb({
    method:       'POST',
    table:        CONTACTS_TABLE,
    query:        'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body:         [row],
  });
}

/**
 * Update a contact by ID (partial update — only provided fields change).
 * @param {string} id
 * @param {object} patch - Fields to update
 */
async function updateContact(id, patch, scope = null) {
  const row = await scopedPatchRow(CONTACTS_TABLE, contactToRow(patch), scope);
  if (Object.keys(row).length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' };
  }
  const query = await scopedIdQuery(CONTACTS_TABLE, `id=eq.${encodeURIComponent(id)}&select=*`, scope);
  return sb({
    method:       'PATCH',
    table:        CONTACTS_TABLE,
    query,
    extraHeaders: { Prefer: 'return=representation' },
    body:         row,
  });
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

  // Split into rows with email (dedup on email) and rows without (always insert)
  const withEmail    = [];
  const withoutEmail = [];

  for (const row of rows) {
    if (!row.id) continue; // skip rows without a pre-generated ID
    const prepared = await scopedInsertRow(CONTACTS_TABLE, {
      id:           row.id,
      contact_type: VALID_TYPES.has(row.contact_type || row.contactType)
                      ? (row.contact_type || row.contactType)
                      : defaultType,
      ...contactToRow(row),
    }, scope);
    const email = prepared.email;
    if (email && email.includes('@')) {
      withEmail.push(prepared);
    } else {
      prepared.email = null; // ensure null not empty string
      withoutEmail.push(prepared);
    }
  }

  const results = [];

  if (withEmail.length > 0) {
    const r = await sb({
      method:       'POST',
      table:        CONTACTS_TABLE,
      query:        'on_conflict=project_id,email',
      extraHeaders: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body:         withEmail,
    });
    results.push(r);
  }

  if (withoutEmail.length > 0) {
    const r = await sb({
      method:       'POST',
      table:        CONTACTS_TABLE,
      extraHeaders: { Prefer: 'return=representation' },
      body:         withoutEmail,
    });
    results.push(r);
  }

  const failed = results.find(r => !r.ok);
  if (failed) return failed;

  const imported = results.reduce((sum, r) => {
    return sum + (Array.isArray(r.data) ? r.data.length : 0);
  }, 0);

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
};
