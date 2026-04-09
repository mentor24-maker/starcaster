'use strict';

/**
 * routes/contacts.js
 * Contacts (all types), segments, and campaigns.
 *
 * Phase 2: Uses ContactsStore.js for the unified contacts table.
 * Segments and campaigns still use store.js (unchanged).
 *
 * Contact type is passed as a query param: GET /api/contacts?type=lead
 * Defaults to returning ALL types when no type filter is given.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const {
  listContacts, getContact, createContact,
  updateContact, deleteContact, importContacts,
  listContactTypes, rowToContact,
} = require('../lib/ContactsStore');
const {
  listSegments, createSegment, updateSegment, deleteSegment,
  listCampaigns, createCampaign, updateCampaign, deleteCampaign,
  listCampaignEvents, insertCampaignEvents,
  rowToCampaign,
} = require('../lib/store');
const {
  listContactPersonas,
  createContactPersona,
  getContactPersonaById,
  updateContactPersona,
  deleteContactPersona,
  rowToContactPersona,
} = require('../lib/contactPersonasStore');
const { logActivity } = require('../lib/activityLog');
const { validate }    = require('../lib/validate');

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function requestScope(req) {
  const projectIds = Array.isArray(req?.projectContext?.projects)
    ? req.projectContext.projects.map((project) => String(project?.id || '').trim()).filter(Boolean)
    : [];
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
    projectIds,
  };
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CONTACT_CREATE_SCHEMA = {
  contactType: { type: 'string', required: false, enum: ['lead','prospect','subscriber','member','partner','other'], default: 'lead' },
  email:       { type: 'string', required: false, format: 'email', maxLength: 254 },
  firstName:   { type: 'string', required: false, maxLength: 100, default: '' },
  lastName:    { type: 'string', required: false, maxLength: 100, default: '' },
  company:     { type: 'string', required: false, maxLength: 200, default: '' },
  phone:       { type: 'string', required: false, maxLength: 50,  default: '' },
  city:        { type: 'string', required: false, maxLength: 100, default: '' },
  country:     { type: 'string', required: false, maxLength: 100, default: '' },
  tags:        { type: 'array',  required: false, items: { type: 'string' }, default: [] },
  website:     { type: 'string', required: false, maxLength: 500, default: '' },
  youtube:     { type: 'string', required: false, maxLength: 500, default: '' },
  instagram:   { type: 'string', required: false, maxLength: 500, default: '' },
  tiktok:      { type: 'string', required: false, maxLength: 500, default: '' },
  facebook:    { type: 'string', required: false, maxLength: 500, default: '' },
  x:           { type: 'string', required: false, maxLength: 500, default: '' },
  bluesky:     { type: 'string', required: false, maxLength: 500, default: '' },
  patreon:     { type: 'string', required: false, maxLength: 500, default: '' },
  linkedin:    { type: 'string', required: false, maxLength: 500, default: '' },
  source:      { type: 'string', required: false, maxLength: 200, default: '' },
  status:      { type: 'string', required: false, maxLength: 100, default: '' },
  notes:       { type: 'string', required: false, default: '' },
  customFields:{ type: 'object', required: false, default: {} },
};

const CONTACT_UPDATE_SCHEMA = { ...CONTACT_CREATE_SCHEMA };
// Make all fields optional for updates
Object.keys(CONTACT_UPDATE_SCHEMA).forEach(k => {
  CONTACT_UPDATE_SCHEMA[k] = { ...CONTACT_UPDATE_SCHEMA[k], required: false };
  delete CONTACT_UPDATE_SCHEMA[k].default;
});

const CONTACT_IMPORT_SCHEMA = {
  contacts:    { type: 'array',  required: true },
  contactType: { type: 'string', required: false, enum: ['lead','prospect','subscriber','member','partner','other'] },
};

const SEGMENT_CREATE_SCHEMA = {
  name:       { type: 'string', required: true,  minLength: 1, maxLength: 200 },
  rules:      { type: 'array',  required: false, default: [] },
  definition: { type: 'object', required: false },
};

const SEGMENT_UPDATE_SCHEMA = {
  name:       { type: 'string', required: false, minLength: 1, maxLength: 200 },
  rules:      { type: 'array',  required: false },
  definition: { type: 'object', required: false },
};

const CAMPAIGN_CREATE_SCHEMA = {
  name:      { type: 'string', required: true, minLength: 1, maxLength: 200 },
  subject:   { type: 'string', required: true, minLength: 1, maxLength: 500 },
  content:   { type: 'string', required: true, minLength: 1 },
  segmentId: { type: 'string', required: false, default: '' },
};

const CAMPAIGN_UPDATE_SCHEMA = {
  name:      { type: 'string', required: false, minLength: 1, maxLength: 200 },
  subject:   { type: 'string', required: false, minLength: 1, maxLength: 500 },
  content:   { type: 'string', required: false, minLength: 1 },
  segmentId: { type: 'string', required: false },
  status:    { type: 'string', required: false, maxLength: 100 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function segmentFieldValue(contact, key) {
  const field = String(key || '').trim();
  if (field === 'social') {
    return [
      contact?.youtube,
      contact?.instagram,
      contact?.tiktok,
      contact?.facebook,
      contact?.x,
      contact?.bluesky,
      contact?.patreon,
      contact?.linkedin,
      contact?.customFields?.substack || contact?.custom_fields?.substack,
      contact?.customFields?.medium || contact?.custom_fields?.medium,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' | ');
  }
  if (field === 'forms') {
    const customForms = contact?.customFields?.forms ?? contact?.custom_fields?.forms;
    return customForms == null ? '' : String(customForms);
  }
  if (field === 'content') {
    const customContent = contact?.customFields?.content ?? contact?.custom_fields?.content;
    return customContent == null ? '' : String(customContent);
  }
  if (field === 'meetings') {
    const customMeetings = contact?.customFields?.meetings ?? contact?.custom_fields?.meetings;
    return customMeetings == null ? '' : String(customMeetings);
  }
  const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const custom = (contact && typeof contact.customFields === 'object' && contact.customFields) || {};
  const raw = (
    contact?.[field] !== undefined ? contact[field]
    : contact?.[camel] !== undefined ? contact[camel]
    : custom[field]
  );
  if (Array.isArray(raw)) return raw.join(', ');
  return raw == null ? '' : String(raw);
}

function socialUsername(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) {
    return text.replace(/^@+/, '').toLowerCase();
  }
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('substack.com')) {
      return host.replace(/\.substack\.com$/, '').replace(/^www\./, '').toLowerCase();
    }
    const parts = parsed.pathname.split('/').map((part) => part.trim()).filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : '';
    return last.replace(/^@+/, '').toLowerCase();
  } catch {
    return text.replace(/^@+/, '').toLowerCase();
  }
}

function isEngagementField(field) {
  return String(field || '').startsWith('engagement_');
}

function slugifyEngagementToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function engagementMetricCount(contact, field, metricToken) {
  const custom = (contact && typeof contact.customFields === 'object' && contact.customFields)
    || (contact && typeof contact.custom_fields === 'object' && contact.custom_fields)
    || {};
  const base = String(field || '').replace(/^engagement_/, '');
  const metric = slugifyEngagementToken(metricToken);
  const directKeys = [`${base}_${metric}`, `engagement_${base}_${metric}`];
  for (const key of directKeys) {
    const raw = custom[key];
    if (raw != null && raw !== '') {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  const nestedDirect = custom?.[base]?.[metric];
  if (nestedDirect != null && nestedDirect !== '') {
    const parsed = Number(nestedDirect);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const nestedEngagement = custom?.engagement?.[base]?.[metric];
  if (nestedEngagement != null && nestedEngagement !== '') {
    const parsed = Number(nestedEngagement);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function countMatchesBucket(count, bucket) {
  const n = Number(count) || 0;
  switch (String(bucket || '')) {
    case '0': return n === 0;
    case '1': return n === 1;
    case '2-5': return n >= 2 && n <= 5;
    case '6-10': return n >= 6 && n <= 10;
    case '10+': return n > 10;
    default: return false;
  }
}

function contactMatchesDefinitionFilters(contact, definition) {
  const filters = definition && typeof definition.filters === 'object' ? definition.filters : null;
  if (!filters) return null;
  const logicMode = String(definition?.logicMode || 'all').toLowerCase() === 'any' ? 'any' : 'all';
  const fallbackJoiner = logicMode === 'any' ? ' OR ' : ' AND ';
  const clauses = Array.isArray(definition?.clauses) && definition.clauses.length
    ? definition.clauses
        .map((clause, index) => ({
          id: String(clause?.id || '').trim().toUpperCase() || String.fromCharCode(65 + (index % 26)),
          field: String(clause?.field || '').trim(),
          mode: String(clause?.mode || 'contains').toLowerCase(),
          value: String(clause?.value || '').trim(),
        }))
        .filter((clause) => clause.field && (clause.mode === 'is_empty' || clause.mode === 'is_known' || clause.value))
    : Object.entries(filters)
        .map(([field, config], index) => {
          const mode = String(config?.mode || 'contains').toLowerCase();
          const value = String(config?.value || '').trim();
          if (mode === 'is_empty' || mode === 'is_known') return { id: String.fromCharCode(65 + (index % 26)), field, mode, value: '' };
          if (!value) return null;
          return { id: String.fromCharCode(65 + (index % 26)), field, mode, value };
        })
        .filter(Boolean);

  if (!clauses.length) return true;

  const clauseResults = {};
  clauses.forEach(({ id, field, mode, value }) => {
    if (isEngagementField(field)) {
      clauseResults[id] = countMatchesBucket(engagementMetricCount(contact, field, mode), value);
      return;
    }
    const rawValue = String(segmentFieldValue(contact, field) || '').trim();
    const haystack = ['youtube', 'instagram', 'tiktok', 'facebook', 'x', 'bluesky', 'patreon', 'linkedin', 'substack', 'medium']
      .includes(String(field || '').trim().toLowerCase())
      ? socialUsername(rawValue)
      : rawValue.toLowerCase();
    const needle = String(value || '').trim().toLowerCase();

    if (mode === 'is_empty') {
      clauseResults[id] = !rawValue;
      return;
    }
    if (mode === 'is_known') {
      clauseResults[id] = Boolean(rawValue);
      return;
    }
    if (mode === 'starts_with') {
      clauseResults[id] = haystack.startsWith(needle);
      return;
    }
    if (mode === 'ends_with') {
      clauseResults[id] = haystack.endsWith(needle);
      return;
    }
    if (mode === 'equals') {
      clauseResults[id] = haystack === needle;
      return;
    }
    clauseResults[id] = haystack.includes(needle);
  });

  const tokens = Array.isArray(definition?.logicTokens) && definition.logicTokens.length
    ? definition.logicTokens.map((token) => String(token || '').toUpperCase().trim()).filter(Boolean)
    : (String(definition?.logic || '').trim() || clauses.map((clause) => clause.id).join(fallbackJoiner))
        .toUpperCase().replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const validIds = new Set(clauses.map((clause) => clause.id));
  const precedence = { OR: 1, AND: 2 };
  const output = [];
  const ops = [];
  let expectOperand = true;

  for (const token of tokens) {
    if (validIds.has(token)) {
      if (!expectOperand) return false;
      output.push(token);
      expectOperand = false;
      continue;
    }
    if (token === '(') {
      if (!expectOperand) return false;
      ops.push(token);
      continue;
    }
    if (token === ')') {
      if (expectOperand) return false;
      while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
      if (!ops.length) return false;
      ops.pop();
      continue;
    }
    if (token === 'AND' || token === 'OR') {
      if (expectOperand) return false;
      while (ops.length && precedence[ops[ops.length - 1]] >= precedence[token]) output.push(ops.pop());
      ops.push(token);
      expectOperand = true;
      continue;
    }
    return false;
  }
  if (expectOperand) return false;
  while (ops.length) {
    const op = ops.pop();
    if (op === '(') return false;
    output.push(op);
  }

  const stack = [];
  for (const token of output) {
    if (validIds.has(token)) {
      stack.push(Boolean(clauseResults[token]));
      continue;
    }
    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) return false;
    stack.push(token === 'AND' ? (left && right) : (left || right));
  }

  return stack.length === 1 ? Boolean(stack[0]) : false;
}

function contactMatchesSegment(contact, segment) {
  const definitionMatch = contactMatchesDefinitionFilters(contact, segment?.definition);
  if (definitionMatch !== null) return definitionMatch;

  const rules = Array.isArray(segment.rules) ? segment.rules : [];
  if (!rules.length) return true;
  return rules.every((rule) => {
    const field  = String(rule.field    || '').toLowerCase();
    const op     = String(rule.operator || '').toLowerCase();
    const value  = String(rule.value    || '').toLowerCase();
    const source = String(segmentFieldValue(contact, field) || '').toLowerCase();
    if (op === 'contains') return source.includes(value);
    if (op === 'starts_with') return source.startsWith(value);
    if (op === 'ends_with')   return source.endsWith(value);
    if (op === 'is_empty')    return !source.trim();
    if (op === 'is_known')    return Boolean(source.trim());
    if (op === 'equals')      return source === value;
    return false;
  });
}

function computeCampaignStats(campaign, events = []) {
  const sent       = campaign.sentCount || 0;
  const openCount  = events.filter(e => (e.campaign_id || e.campaignId) === campaign.id && e.type === 'open').length;
  const clickCount = events.filter(e => (e.campaign_id || e.campaignId) === campaign.id && e.type === 'click').length;
  return {
    sent,
    opens:     openCount,
    clicks:    clickCount,
    openRate:  sent ? Number(((openCount  / sent) * 100).toFixed(1)) : 0,
    clickRate: sent ? Number(((clickCount / sent) * 100).toFixed(1)) : 0,
  };
}

function cleanSegmentRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map(r => ({
      field:    String(r.field    || '').trim(),
      operator: String(r.operator || '').trim(),
      value:    String(r.value    || '').trim(),
    }))
    .filter((r) => {
      if (!r.field || !r.operator) return false;
      if (r.operator === 'is_known' || r.operator === 'is_empty') return true;
      return Boolean(r.value);
    });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

async function handleContacts(req, res, pathname, method) {
  const urlObj = getUrlObj(req);

  if (pathname === '/api/contact-personas' && method === 'GET') {
    const result = await listContactPersonas(requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const personas = (Array.isArray(result.data) ? result.data : []).map(rowToContactPersona);
    return sendOk(res, 200, personas, { personas }, { total: personas.length }), true;
  }

  if (pathname === '/api/contact-personas' && method === 'POST') {
    const body = await parseJsonBody(req);
    const persona = String(body.persona || '').trim();
    const description = String(body.description || '').trim();
    if (!persona) return sendErr(res, 400, 'Persona name is required', { code: 'VALIDATION_ERROR' }), true;
    const payload = { persona, description };
    const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').trim();
    if ((Array.isArray(tags) && tags.length) || (!Array.isArray(tags) && tags)) {
      payload.tags = tags;
    }
    if (String(body.parentPersonaId || body.parent_persona_id || '').trim()) {
      payload.parentPersonaId = Number(body.parentPersonaId || body.parent_persona_id || 0) || null;
    }
    const result = await createContactPersona(payload, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 201, rowToContactPersona(created), { persona: rowToContactPersona(created) }), true;
  }

  const personaMatch = pathname.match(/^\/api\/contact-personas\/(\d+)\/?$/);
  if (personaMatch && method === 'GET') {
    const result = await getContactPersonaById(Number(personaMatch[1]), requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return sendErr(res, 404, 'Persona not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToContactPersona(row), { persona: rowToContactPersona(row) }), true;
  }

  if (personaMatch && method === 'PATCH') {
    const body = await parseJsonBody(req);
    const payload = {};
    if ('persona' in body) payload.persona = String(body.persona || '').trim();
    if ('description' in body) payload.description = String(body.description || '').trim();
    if ('tags' in body) {
      const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').trim();
      if ((Array.isArray(tags) && tags.length) || (!Array.isArray(tags) && tags)) {
        payload.tags = tags;
      }
    }
    if (('parentPersonaId' in body || 'parent_persona_id' in body) && String(body.parentPersonaId || body.parent_persona_id || '').trim()) {
      payload.parentPersonaId = Number(body.parentPersonaId || body.parent_persona_id || 0) || null;
    }
    if ('persona' in payload && !payload.persona) {
      return sendErr(res, 400, 'Persona name is required', { code: 'VALIDATION_ERROR' }), true;
    }
    const result = await updateContactPersona(Number(personaMatch[1]), payload, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Persona not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToContactPersona(updated), { persona: rowToContactPersona(updated) }), true;
  }

  if (personaMatch && method === 'DELETE') {
    const result = await deleteContactPersona(Number(personaMatch[1]), requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!deleted) return sendErr(res, 404, 'Persona not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToContactPersona(deleted), { persona: rowToContactPersona(deleted) }), true;
  }

  // GET /api/contacts — list, optionally filtered by type
  if (pathname === '/api/contacts' && method === 'GET') {
    const contactType = urlObj.searchParams.get('type') || undefined;
    const result = await listContacts({ contactType, scope: requestScope(req) });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const contacts = (Array.isArray(result.data) ? result.data : []).map(rowToContact);
    return sendOk(res, 200, contacts, { contacts }, { total: contacts.length }), true;
  }

  // GET /api/contacts/types — list all contact types
  if (pathname === '/api/contacts/types' && method === 'GET') {
    const result = await listContactTypes();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { types: result.data }), true;
  }

  // POST /api/contacts — create a contact
  if (pathname === '/api/contacts' && method === 'POST') {
    const body = await parseJsonBody(req);
    const v    = validate(CONTACT_CREATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    // Email is optional but must be valid if provided
    const email = v.data.email ? normalizeEmail(v.data.email) : null;

    const result = await createContact({
      id:          nextId('contact'),
      contactType: v.data.contactType || 'lead',
      email,
      ...v.data,
    }, requestScope(req));

    if (!result.ok) {
      const isDupe = result.status === 409 || String(result.error).toLowerCase().includes('unique');
      return sendErr(res, isDupe ? 409 : result.status || 500, result.error,
        { code: isDupe ? 'DUPLICATE_EMAIL' : 'DB_ERROR' }), true;
    }

    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    logActivity({
      action: 'contact.created', entityType: 'contact', entityId: created.id,
      summary: `Contact added: ${email || created.id}`,
      meta: { contactType: v.data.contactType || 'lead' },
    });
    const contact = rowToContact(created);
    return sendOk(res, 201, contact, { contact }), true;
  }

  // GET /api/contacts/:id
  const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch && method === 'GET') {
    const result = await getContact(decodeURIComponent(contactMatch[1]), requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const contact = rowToContact(result.data);
    return sendOk(res, 200, contact, { contact }), true;
  }

  // PUT /api/contacts/:id — update a contact
  if (contactMatch && method === 'PUT') {
    const body = await parseJsonBody(req);
    const v    = validate(CONTACT_UPDATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    const id     = decodeURIComponent(contactMatch[1]);
    const result = await updateContact(id, v.data, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Contact not found', { code: 'NOT_FOUND' }), true;
    logActivity({
      action: 'contact.updated', entityType: 'contact', entityId: id,
      summary: `Contact updated: ${updated.email || id}`,
    });
    return sendOk(res, 200, rowToContact(updated), { contact: rowToContact(updated) }), true;
  }

  // DELETE /api/contacts/:id
  if (contactMatch && method === 'DELETE') {
    const id     = decodeURIComponent(contactMatch[1]);
    const result = await deleteContact(id, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'contact.deleted', entityType: 'contact', entityId: id,
      summary: `Contact deleted: ${id}`,
    });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  // POST /api/contacts/import
  if (pathname === '/api/contacts/import' && method === 'POST') {
    const body = await parseJsonBody(req);
    const v    = validate(CONTACT_IMPORT_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    const rows = v.data.contacts.map(row => ({ ...row, id: nextId('contact') }));
    const result = await importContacts(rows, { defaultType: v.data.contactType || 'lead', scope: requestScope(req) });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;

    const imported = result.data?.imported || 0;
    logActivity({
      action: 'contact.imported', entityType: 'contact',
      summary: `${imported} contact${imported !== 1 ? 's' : ''} imported`,
      meta: { count: imported, contactType: v.data.contactType || 'lead' },
    });
    return sendOk(res, 201, { imported }, { imported }, { total: imported }), true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Segments (unchanged from previous version)
// ---------------------------------------------------------------------------

async function handleSegments(req, res, pathname, method) {
  if (pathname === '/api/segments' && method === 'GET') {
    const scope = requestScope(req);
    const [segRes, conRes] = await Promise.all([listSegments(scope), listContacts({ scope })]);
    if (!segRes.ok) return sendErr(res, segRes.status || 500, segRes.error), true;
    const contacts = conRes.ok && Array.isArray(conRes.data) ? conRes.data.map(rowToContact) : [];
    const segments = (Array.isArray(segRes.data) ? segRes.data : []).map(seg => ({
      ...seg,
      audienceSize: contacts.filter(c => contactMatchesSegment(c, seg)).length,
    }));
    return sendOk(res, 200, segments, { segments }, { total: segments.length }), true;
  }

  if (pathname === '/api/segments' && method === 'POST') {
    const body = await parseJsonBody(req);
    const v    = validate(SEGMENT_CREATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;
    const result = await createSegment({
      id: nextId('segment'), name: v.data.name,
      rules: cleanSegmentRules(v.data.rules), definition: v.data.definition ?? null,
    }, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    logActivity({ action: 'segment.created', entityType: 'segment', entityId: created.id, summary: `Segment created: "${v.data.name}"` });
    return sendOk(res, 201, created, { segment: created }), true;
  }

  const segmentMatch = pathname.match(/^\/api\/segments\/([^/]+)$/);

  if (segmentMatch && method === 'PUT') {
    const body = await parseJsonBody(req);
    const v    = validate(SEGMENT_UPDATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;
    const id   = decodeURIComponent(segmentMatch[1]);
    const patch = {};
    if (v.data.name       !== undefined) patch.name       = v.data.name;
    if (v.data.rules      !== undefined) patch.rules      = cleanSegmentRules(v.data.rules);
    if (v.data.definition !== undefined) patch.definition = v.data.definition ?? null;
    const result = await updateSegment(id, patch, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Segment not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'segment.updated', entityType: 'segment', entityId: id, summary: `Segment updated: "${updated.name || id}"` });
    return sendOk(res, 200, updated, { segment: updated }), true;
  }

  if (segmentMatch && method === 'DELETE') {
    const id     = decodeURIComponent(segmentMatch[1]);
    const result = await deleteSegment(id, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({ action: 'segment.deleted', entityType: 'segment', entityId: id, summary: `Segment deleted: ${id}` });
    return sendOk(res, 200, { deleted: true, segmentId: id }, { deleted: true }), true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Campaigns (unchanged from previous version)
// ---------------------------------------------------------------------------

async function handleCampaigns(req, res, pathname, method) {
  if (pathname === '/api/campaigns' && method === 'GET') {
    const result = await listCampaigns(requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const campaigns = (Array.isArray(result.data) ? result.data : []).map(rowToCampaign);
    await Promise.all(campaigns.map(async (c) => {
      const evRes = await listCampaignEvents(c.id);
      c.stats = computeCampaignStats(c, evRes.ok && Array.isArray(evRes.data) ? evRes.data : []);
    }));
    return sendOk(res, 200, campaigns, { campaigns }, { total: campaigns.length }), true;
  }

  if (pathname === '/api/campaigns' && method === 'POST') {
    const body = await parseJsonBody(req);
    const v    = validate(CAMPAIGN_CREATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;
    const result = await createCampaign({ id: nextId('campaign'), ...v.data, segmentId: v.data.segmentId || null }, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created  = Array.isArray(result.data) ? result.data[0] : result.data;
    const campaign = rowToCampaign(created);
    logActivity({ action: 'campaign.created', entityType: 'campaign', entityId: created.id, summary: `Campaign created: "${v.data.name}"` });
    return sendOk(res, 201, campaign, { campaign }), true;
  }

  const campaignMatch = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (campaignMatch && method === 'PATCH') {
    const campaignId = campaignMatch[1];
    const body = await parseJsonBody(req);
    const v = validate(CAMPAIGN_UPDATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(v.data, 'name')) patch.name = v.data.name;
    if (Object.prototype.hasOwnProperty.call(v.data, 'subject')) patch.subject = v.data.subject;
    if (Object.prototype.hasOwnProperty.call(v.data, 'content')) patch.content = v.data.content;
    if (Object.prototype.hasOwnProperty.call(v.data, 'segmentId')) patch.segment_id = v.data.segmentId || null;
    if (Object.prototype.hasOwnProperty.call(v.data, 'status')) patch.status = v.data.status;
    const result = await updateCampaign(campaignId, patch, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    const campaign = rowToCampaign(updated);
    logActivity({ action: 'campaign.updated', entityType: 'campaign', entityId: campaignId, summary: `Campaign updated: "${campaign.name}"` });
    return sendOk(res, 200, campaign, { campaign }), true;
  }

  if (campaignMatch && method === 'DELETE') {
    const campaignId = campaignMatch[1];
    const result = await deleteCampaign(campaignId, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({ action: 'campaign.deleted', entityType: 'campaign', entityId: campaignId, summary: `Campaign deleted: ${campaignId}` });
    return sendOk(res, 200, { ok: true }, { ok: true }), true;
  }

  const sendMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/send$/);
  if (sendMatch && method === 'POST') {
    const campaignId = sendMatch[1];
    const scope = requestScope(req);
    const [campRes, segRes, conRes] = await Promise.all([listCampaigns(scope), listSegments(scope), listContacts({ scope })]);
    if (!campRes.ok) return sendErr(res, campRes.status || 500, campRes.error), true;
    const campaigns  = (Array.isArray(campRes.data) ? campRes.data : []).map(rowToCampaign);
    const campaign   = campaigns.find(c => c.id === campaignId);
    if (!campaign) return sendErr(res, 404, 'Campaign not found', { code: 'NOT_FOUND' }), true;
    const segments   = segRes.ok && Array.isArray(segRes.data) ? segRes.data : [];
    const contacts   = conRes.ok && Array.isArray(conRes.data) ? conRes.data.map(rowToContact) : [];
    const segment    = campaign.segmentId ? segments.find(s => s.id === campaign.segmentId) : null;
    const recipients = contacts.filter(c => !segment || contactMatchesSegment(c, segment));
    await updateCampaign(campaignId, { status: 'sent', sent_count: recipients.length, last_sent_at: new Date().toISOString() }, requestScope(req));
    const newEvents  = [];
    recipients.forEach(r => {
      if (Math.random() < 0.45) newEvents.push({ id: nextId('event'), campaignId, contactId: r.id, type: 'open' });
      if (Math.random() < 0.09) newEvents.push({ id: nextId('event'), campaignId, contactId: r.id, type: 'click' });
    });
    await insertCampaignEvents(newEvents);
    const stats  = computeCampaignStats({ ...campaign, sentCount: recipients.length }, newEvents);
    const payload = { message: 'Campaign send simulated', recipients: recipients.length, stats };
    logActivity({ action: 'campaign.sent', entityType: 'campaign', entityId: campaignId, summary: `Campaign "${campaign.name}" sent to ${recipients.length} recipients`, meta: stats });
    return sendOk(res, 200, payload, payload), true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handle(req, res, pathname, method) {
  if (await handleContacts(req, res, pathname, method)) return true;
  if (await handleSegments(req, res, pathname, method)) return true;
  if (await handleCampaigns(req, res, pathname, method)) return true;
  return false;
}

const manifest = {
  id:       'contacts',
  label:    'Contacts, Segments & Campaigns',
  prefixes: ['/api/contacts', '/api/contact-personas', '/api/segments', '/api/campaigns'],
};

module.exports = { handle, manifest };
