'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'crm_contacts.json');
const SUPPORT_CACHE = new Map();

function t() {
  return tableConfig().crmContacts;
}

function ensureFile() {
  ensureJsonFile(STORE_FILE, { contacts: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { contacts: [] };
    if (!Array.isArray(parsed.contacts)) parsed.contacts = [];
    return parsed;
  } catch {
    return { contacts: [] };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function safeText(value) {
  return String(value || '').trim();
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  const emailRaw = safeText(input.email);
  return {
    id: String(input.id || ''),
    crmConfigId: safeText(input.crmConfigId || input.crm_config_id),
    projectId: safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    email: emailRaw ? emailRaw.toLowerCase() : null,
    data: (input.data && typeof input.data === 'object') ? input.data : {},
    source: safeText(input.source),
    tags: Array.isArray(input.tags) ? input.tags : [],
    createdAt: String(input.createdAt || input.created_at || ''),
    updatedAt: String(input.updatedAt || input.updated_at || ''),
  };
}

function inputToRow(input) {
  const c = sanitize(input);
  if (!c) return null;
  return {
    id: c.id,
    crm_config_id: c.crmConfigId,
    email: c.email || null,
    data: typeof c.data === 'object' ? c.data : {},
    source: c.source,
    tags: Array.isArray(c.tags) ? c.tags : [],
  };
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return (
    text.includes('does not exist') ||
    text.includes('relation') ||
    text.includes('schema cache')
  );
}

function isDuplicateError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('unique') || text.includes('duplicate') || text.includes('already exists');
}

async function supportsSupabase() {
  if (!isSupabaseConfigured()) return false;
  const table = t();
  if (!table) return false;
  if (SUPPORT_CACHE.has(table)) return SUPPORT_CACHE.get(table);
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  const supported = probe.ok || !isMissingTableError(probe.error);
  SUPPORT_CACHE.set(table, supported);
  return supported;
}

async function listContacts(crmConfigId, scope = null) {
  const configId = safeText(crmConfigId);
  if (!configId) return [];
  const projectId = safeText(scope?.projectId || scope?.project_id);

  if (await supportsSupabase()) {
    let query = `select=*&crm_config_id=eq.${encodeURIComponent(configId)}&order=created_at.desc&limit=5000`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    }
    if (!isMissingTableError(result.error)) return [];
  }

  const store = readStore();
  return store.contacts
    .map(sanitize)
    .filter(Boolean)
    .filter((c) => c.crmConfigId === configId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function getContact(id, scope = null) {
  const contactId = safeText(id);
  if (!contactId) return null;
  const projectId = safeText(scope?.projectId || scope?.project_id);

  if (await supportsSupabase()) {
    let query = `select=*&id=eq.${encodeURIComponent(contactId)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return sanitize(Array.isArray(result.data) ? result.data[0] : null);
    }
    if (!isMissingTableError(result.error)) return null;
  }

  const store = readStore();
  const row = store.contacts.find((c) => safeText(sanitize(c)?.id) === contactId);
  return sanitize(row) || null;
}

async function createContact(input, scope = null) {
  const now = new Date().toISOString();
  const projectId = safeText(scope?.projectId || scope?.project_id);
  const userId = safeText(scope?.userId || scope?.user_id);

  const contact = sanitize({
    id: nextId('crmct'),
    crmConfigId: safeText(input.crmConfigId || input.crm_config_id),
    projectId,
    ownerUserId: userId,
    email: safeText(input.email).toLowerCase() || null,
    data: (input.data && typeof input.data === 'object') ? input.data : {},
    source: safeText(input.source),
    tags: Array.isArray(input.tags) ? input.tags : [],
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabase()) {
    const row = {
      ...inputToRow(contact),
      id: contact.id,
      project_id: projectId,
      owner_user_id: userId,
    };
    const result = await sbQuery({
      method: 'POST',
      table: t(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [row],
    });
    if (result.ok) {
      const created = Array.isArray(result.data) ? result.data[0] : result.data;
      return sanitize(created);
    }
    if (isDuplicateError(result.error)) {
      const err = new Error('A contact with this email already exists in this CRM.');
      err.code = 'DUPLICATE_EMAIL';
      err.status = 409;
      throw err;
    }
    if (!isMissingTableError(result.error)) return null;
  }

  if (contact.email) {
    const store = readStore();
    const dupe = store.contacts.find((c) => {
      const s = sanitize(c);
      return s?.crmConfigId === contact.crmConfigId && s?.email === contact.email;
    });
    if (dupe) {
      const err = new Error('A contact with this email already exists in this CRM.');
      err.code = 'DUPLICATE_EMAIL';
      err.status = 409;
      throw err;
    }
  }

  const store = readStore();
  store.contacts.unshift(contact);
  writeStore(store);
  return contact;
}

async function updateContact(id, input, scope = null) {
  const contactId = safeText(id);
  if (!contactId) return null;
  const projectId = safeText(scope?.projectId || scope?.project_id);

  if (await supportsSupabase()) {
    let existQuery = `select=*&id=eq.${encodeURIComponent(contactId)}&limit=1`;
    if (projectId) existQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const existingResult = await sbQuery({ table: t(), query: existQuery });
    if (existingResult.ok) {
      const existing = sanitize(Array.isArray(existingResult.data) ? existingResult.data[0] : null);
      if (!existing) return null;
      const row = inputToRow({
        ...existing,
        ...input,
        id: contactId,
        crmConfigId: existing.crmConfigId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
      let patchQuery = `id=eq.${encodeURIComponent(contactId)}&select=*`;
      if (projectId) patchQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
      const updated = await sbQuery({
        method: 'PATCH',
        table: t(),
        query: patchQuery,
        headers: { Prefer: 'return=representation' },
        body: row,
      });
      if (updated.ok) {
        const next = Array.isArray(updated.data) ? updated.data[0] : updated.data;
        return sanitize(next);
      }
      if (!isMissingTableError(updated.error)) return null;
    } else if (!isMissingTableError(existingResult.error)) {
      return null;
    }
  }

  const store = readStore();
  const idx = store.contacts.findIndex((item) => safeText(sanitize(item)?.id) === contactId);
  if (idx < 0) return null;
  const existing = sanitize(store.contacts[idx]);
  const next = sanitize({
    ...existing,
    ...input,
    id: contactId,
    crmConfigId: existing.crmConfigId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  store.contacts[idx] = next;
  writeStore(store);
  return next;
}

async function deleteContact(id, scope = null) {
  const contactId = safeText(id);
  if (!contactId) return null;

  if (await supportsSupabase()) {
    // Delete by ID only — contacts may have been created before project_id
    // scoping was added (or via public form submission with empty project_id).
    // Security is maintained at the route layer (requires auth + project context).
    const query = `id=eq.${encodeURIComponent(contactId)}&select=*`;
    const result = await sbQuery({
      method: 'DELETE',
      table: t(),
      query,
      headers: { Prefer: 'return=representation' },
    });
    if (result.ok) {
      const removed = Array.isArray(result.data) ? result.data[0] : result.data;
      return sanitize(removed);
    }
    if (!isMissingTableError(result.error)) return null;
  }

  const store = readStore();
  const idx = store.contacts.findIndex((item) => safeText(sanitize(item)?.id) === contactId);
  if (idx < 0) return null;
  const [removed] = store.contacts.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

module.exports = { listContacts, getContact, createContact, updateContact, deleteContact };
