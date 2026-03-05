'use strict';

/**
 * routes/promoLeads.js
 * Phase 3: All /api/promo-leads/* endpoints rerouted to ContactsStore.js.
 *
 * The promo_leads table is gone. All lead data now lives in the unified
 * contacts table with contact_type = 'lead'.
 *
 * These endpoints remain alive so the existing frontend continues working
 * unchanged while Phase 4 migrates the UI. They will be retired in Phase 5.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const {
  listContacts, createContact, updateContact, deleteContact, importContacts,
  listFieldConfigs, createFieldConfig, updateFieldConfig, deleteFieldConfig,
  listDatabaseTables, createDatabaseField,
  rowToContact,
} = require('../lib/ContactsStore');
const { logActivity } = require('../lib/activityLog');
const { validate }    = require('../lib/validate');

// All promo-leads routes operate on contact_type = 'lead'
const LEAD_TYPE = 'lead';

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const FIELD_CONFIG_CREATE_SCHEMA = {
  key:          { type: 'string',  required: true,  minLength: 1, maxLength: 100 },
  label:        { type: 'string',  required: true,  minLength: 1, maxLength: 200 },
  contact_type: { type: 'string',  required: false, enum: ['lead','prospect','subscriber','member','partner','other'], default: 'lead' },
  type:         { type: 'string',  required: false, enum: ['text','email','number','boolean','date','url','select'], default: 'text' },
  required:     { type: 'boolean', required: false, default: false },
  order:        { type: 'number',  required: false },
};

const FIELD_CONFIG_UPDATE_SCHEMA = {
  label:    { type: 'string',  required: false, minLength: 1, maxLength: 200 },
  type:     { type: 'string',  required: false, enum: ['text','email','number','boolean','date','url','select'] },
  required: { type: 'boolean', required: false },
  order:    { type: 'number',  required: false },
};

const LEAD_CREATE_SCHEMA = {
  email:        { type: 'string', required: false, format: 'email', maxLength: 254 },
  first_name:   { type: 'string', required: false, maxLength: 100 },
  last_name:    { type: 'string', required: false, maxLength: 100 },
  company:      { type: 'string', required: false, maxLength: 200 },
  phone:        { type: 'string', required: false, maxLength: 50  },
  source:       { type: 'string', required: false, maxLength: 200 },
  status:       { type: 'string', required: false, maxLength: 100 },
  notes:        { type: 'string', required: false },
};

const LEAD_UPDATE_SCHEMA = { ...LEAD_CREATE_SCHEMA };

const IMPORT_SCHEMA = {
  contacts: { type: 'array', required: true },
};

// ---------------------------------------------------------------------------
// Helper: map a legacy promo-lead row shape to ContactsStore format
// ---------------------------------------------------------------------------

function leadBodyToContact(body) {
  return {
    contactType:  LEAD_TYPE,
    email:        body.email        || body.Email        || null,
    firstName:    body.first_name   || body.firstName    || body.First_Name || '',
    lastName:     body.last_name    || body.lastName     || body.Last_Name  || '',
    company:      body.company      || body.Company      || '',
    phone:        body.phone        || body.Phone        || '',
    source:       body.source       || body.Source       || '',
    status:       body.status       || body.Status       || '',
    notes:        body.notes        || body.Notes        || '',
    tags:         body.tags         || [],
    customFields: body.custom_fields|| body.customFields || {},
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

async function handle(req, res, pathname, method) {
  const urlObj = getUrlObj(req);

  // ── Field configs ──────────────────────────────────────────────────────────

  // GET /api/promo-leads/fields
  if (pathname === '/api/promo-leads/fields' && method === 'GET') {
    const result = await listFieldConfigs(LEAD_TYPE);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const fields = result.data || [];
    return sendOk(res, 200, fields, { fields }, { total: fields.length }), true;
  }

  // POST /api/promo-leads/fields
  if (pathname === '/api/promo-leads/fields' && method === 'POST') {
    const body = await parseJsonBody(req);
    const v    = validate(FIELD_CONFIG_CREATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    const result = await createFieldConfig({
      id:           nextId('cfg'),
      contact_type: v.data.contact_type || LEAD_TYPE,
      key:          v.data.key,
      label:        v.data.label,
      field_type:   v.data.type || 'text',
      required:     v.data.required || false,
      sort_order:   v.data.order    || 0,
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const field = Array.isArray(result.data) ? result.data[0] : result.data;
    logActivity({
      action: 'contact.field_created', entityType: 'contact',
      summary: `Custom field created: "${v.data.label}" for ${v.data.contact_type || LEAD_TYPE}`
    });
    return sendOk(res, 201, field, { field }), true;
  }

  // PUT /api/promo-leads/fields/:id
  const fieldMatch = pathname.match(/^\/api\/promo-leads\/fields\/([^/]+)$/);
  if (fieldMatch && method === 'PUT') {
    const body = await parseJsonBody(req);
    const v    = validate(FIELD_CONFIG_UPDATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;
    const result = await updateFieldConfig(fieldMatch[1], {
      label:      v.data.label,
      field_type: v.data.type,
      required:   v.data.required,
      sort_order: v.data.order,
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const field = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 200, field, { field }), true;
  }

  // DELETE /api/promo-leads/fields/:id
  if (fieldMatch && method === 'DELETE') {
    const result = await deleteFieldConfig(fieldMatch[1]);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'contact.field_deleted', entityType: 'contact',
      summary: `Custom field deleted: ${fieldMatch[1]}`
    });
    return sendOk(res, 200, { deleted: true }, { deleted: true }), true;
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  // POST /api/promo-leads/import ⚡ RATE LIMITED
  if (pathname === '/api/promo-leads/import' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'import')) return true;

    const body = await parseJsonBody(req);
    const v    = validate(IMPORT_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    const rows = v.data.contacts.map(row => ({
      ...leadBodyToContact(row),
      id: nextId('contact'),
    }));

    const result = await importContacts(rows, { defaultType: LEAD_TYPE });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;

    const count = result.data?.imported || 0;
    logActivity({
      action: 'contact.imported', entityType: 'contact',
      summary: `${count} lead${count !== 1 ? 's' : ''} imported`,
      meta: { count, contactType: LEAD_TYPE }
    });
    return sendOk(res, 200, result.data, result.data, { total: count }), true;
  }

  // ── Columns check (legacy — now always returns exists:true for core fields) ──

  // POST /api/promo-leads/columns/check
  if (pathname === '/api/promo-leads/columns/check' && method === 'POST') {
    const body = await parseJsonBody(req);
    const columns = Array.isArray(body.columns) ? body.columns : [];
    // In the unified table, all standard columns always exist
    const results = columns.map(col => ({ column: col, exists: true, error: null }));
    return sendOk(res, 200, results, { columns: results }), true;
  }

  // ── Database tables (Settings page) ───────────────────────────────────────

  // GET /api/promo-leads/database/tables
  if (pathname === '/api/promo-leads/database/tables' && method === 'GET') {
    const result = await listDatabaseTables();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tables: result.data }), true;
  }

  // POST /api/promo-leads/database/fields
  if (pathname === '/api/promo-leads/database/fields' && method === 'POST') {
    const body   = await parseJsonBody(req);
    const result = await createDatabaseField(body);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, result.data), true;
  }

  // ── Lead CRUD ──────────────────────────────────────────────────────────────

  // GET /api/promo-leads
  if (pathname === '/api/promo-leads' && method === 'GET') {
    const limit  = Number(urlObj.searchParams.get('limit') || 500);
    const result = await listContacts({ contactType: LEAD_TYPE, limit });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const leads = (Array.isArray(result.data) ? result.data : []).map(rowToContact);
    return sendOk(res, 200, leads, { leads }, { total: leads.length }), true;
  }

  // POST /api/promo-leads
  if (pathname === '/api/promo-leads' && method === 'POST') {
    const body = await parseJsonBody(req);
    const v    = validate(LEAD_CREATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    const result = await createContact({
      id: nextId('contact'),
      ...leadBodyToContact(body),
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const lead = rowToContact(Array.isArray(result.data) ? result.data[0] : result.data);
    logActivity({
      action: 'contact.created', entityType: 'contact', entityId: lead.id,
      summary: `Lead captured: ${lead.email || lead.id}`,
      meta: { source: body.source }
    });
    return sendOk(res, 201, lead, { lead }), true;
  }

  // PUT /api/promo-leads/:id
  const leadMatch = pathname.match(/^\/api\/promo-leads\/([^/]+)$/);
  if (leadMatch && method === 'PUT') {
    const body = await parseJsonBody(req);
    const v    = validate(LEAD_UPDATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    const result = await updateContact(leadMatch[1], leadBodyToContact(body));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const lead = rowToContact(Array.isArray(result.data) ? result.data[0] : result.data);
    return sendOk(res, 200, lead, { lead }), true;
  }

  // DELETE /api/promo-leads/:id
  if (leadMatch && method === 'DELETE') {
    const result = await deleteContact(leadMatch[1]);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'contact.deleted', entityType: 'contact', entityId: leadMatch[1],
      summary: `Lead deleted: ${leadMatch[1]}`
    });
    return sendOk(res, 200, { deleted: true }, { deleted: true }), true;
  }

  return false;
}

const manifest = {
  id:       'promoLeads',
  label:    'Contacts',
  prefixes: ['/api/promo-leads'],
};

module.exports = { handle, manifest };
