'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'crm_forms.json');
const SUPPORT_CACHE = new Map();

function t() {
  return tableConfig().crmForms;
}

function ensureFile() {
  ensureJsonFile(STORE_FILE, { forms: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { forms: [] };
    if (!Array.isArray(parsed.forms)) parsed.forms = [];
    return parsed;
  } catch {
    return { forms: [] };
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
  return {
    id: String(input.id || ''),
    crmConfigId: safeText(input.crmConfigId || input.crm_config_id),
    projectId: safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    name: String(input.name || ''),
    heading: String(input.heading || ''),
    submitLabel: String(input.submitLabel || input.submit_label || 'Submit'),
    successMessage: String(input.successMessage || input.success_message || 'Thank you! Your information has been saved.'),
    errorMessage: String(input.errorMessage || input.error_message || 'Something went wrong. Please try again.'),
    accentColor: String(input.accentColor || input.accent_color || ''),
    fields: Array.isArray(input.fields)
      ? input.fields.map((f) => ({
          key: safeText(f?.key),
          label: safeText(f?.label),
          type: safeText(f?.type) || 'text',
          required: Boolean(f?.required),
        }))
      : [],
    createdAt: String(input.createdAt || input.created_at || ''),
    updatedAt: String(input.updatedAt || input.updated_at || ''),
  };
}

function inputToRow(input) {
  const f = sanitize(input);
  if (!f) return null;
  return {
    id: f.id,
    crm_config_id: f.crmConfigId,
    name: f.name,
    heading: f.heading,
    submit_label: f.submitLabel,
    success_message: f.successMessage,
    error_message: f.errorMessage,
    accent_color: f.accentColor,
    fields: Array.isArray(f.fields) ? f.fields : [],
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

async function listForms(crmConfigId, scope = null) {
  const configId = safeText(crmConfigId);
  if (!configId) return [];
  const projectId = safeText(scope?.projectId || scope?.project_id);

  if (await supportsSupabase()) {
    let query = `select=*&crm_config_id=eq.${encodeURIComponent(configId)}&order=updated_at.desc,created_at.desc&limit=500`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    }
    if (!isMissingTableError(result.error)) return [];
  }

  const store = readStore();
  return store.forms
    .map(sanitize)
    .filter(Boolean)
    .filter((f) => f.crmConfigId === configId)
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
}

async function getForm(id, scope = null) {
  const formId = safeText(id);
  if (!formId) return null;
  const projectId = safeText(scope?.projectId || scope?.project_id);

  if (await supportsSupabase()) {
    let query = `select=*&id=eq.${encodeURIComponent(formId)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return sanitize(Array.isArray(result.data) ? result.data[0] : null);
    }
    if (!isMissingTableError(result.error)) return null;
  }

  const store = readStore();
  const row = store.forms.find((f) => safeText(sanitize(f)?.id) === formId);
  return sanitize(row) || null;
}

async function createForm(input, scope = null) {
  const now = new Date().toISOString();
  const projectId = safeText(scope?.projectId || scope?.project_id);
  const userId = safeText(scope?.userId || scope?.user_id);

  const form = sanitize({
    id: nextId('crmf'),
    crmConfigId: safeText(input.crmConfigId || input.crm_config_id),
    projectId,
    ownerUserId: userId,
    name: safeText(input.name),
    heading: safeText(input.heading),
    submitLabel: safeText(input.submitLabel || input.submit_label) || 'Submit',
    successMessage: safeText(input.successMessage || input.success_message) || 'Thank you! Your information has been saved.',
    errorMessage: safeText(input.errorMessage || input.error_message) || 'Something went wrong. Please try again.',
    accentColor: safeText(input.accentColor || input.accent_color),
    fields: Array.isArray(input.fields) ? input.fields : [],
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabase()) {
    const row = {
      ...inputToRow(form),
      id: form.id,
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
    if (!isMissingTableError(result.error)) return null;
  }

  const store = readStore();
  store.forms.unshift(form);
  writeStore(store);
  return form;
}

async function updateForm(id, input, scope = null) {
  const formId = safeText(id);
  if (!formId) return null;
  const projectId = safeText(scope?.projectId || scope?.project_id);

  if (await supportsSupabase()) {
    let existQuery = `select=*&id=eq.${encodeURIComponent(formId)}&limit=1`;
    if (projectId) existQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const existingResult = await sbQuery({ table: t(), query: existQuery });
    if (existingResult.ok) {
      const existing = sanitize(Array.isArray(existingResult.data) ? existingResult.data[0] : null);
      if (!existing) return null;
      const row = inputToRow({
        ...existing,
        ...input,
        id: formId,
        crmConfigId: existing.crmConfigId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      });
      let patchQuery = `id=eq.${encodeURIComponent(formId)}&select=*`;
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
  const idx = store.forms.findIndex((item) => safeText(sanitize(item)?.id) === formId);
  if (idx < 0) return null;
  const existing = sanitize(store.forms[idx]);
  const next = sanitize({
    ...existing,
    ...input,
    id: formId,
    crmConfigId: existing.crmConfigId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  store.forms[idx] = next;
  writeStore(store);
  return next;
}

async function deleteForm(id, scope = null) {
  const formId = safeText(id);
  if (!formId) return null;
  const projectId = safeText(scope?.projectId || scope?.project_id);

  if (await supportsSupabase()) {
    let query = `id=eq.${encodeURIComponent(formId)}&select=*`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
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
  const idx = store.forms.findIndex((item) => safeText(sanitize(item)?.id) === formId);
  if (idx < 0) return null;
  const [removed] = store.forms.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

module.exports = { listForms, getForm, createForm, updateForm, deleteForm };
