'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'builder_forms.json');
const SUPPORT_CACHE = new Map();

function t() {
  return tableConfig().builderForms;
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

function normalizeScope(scope) {
  return {
    projectId: safeText(scope?.projectId || scope?.project_id),
    userId: safeText(scope?.userId || scope?.user_id),
  };
}

function matchesScope(form, scope) {
  const { projectId } = normalizeScope(scope);
  if (!projectId) return true;
  const rowProjectId = safeText(form?.projectId || form?.project_id);
  return rowProjectId === projectId;
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    id: String(input.id || ''),
    projectId: safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    name: String(input.name || ''),
    formType: String(input.formType || input.form_type || ''),
    contactType: String(input.contactType || input.contact_type || 'lead').trim() || 'lead',
    leadMagnetType: String(input.leadMagnetType || input.lead_magnet_type || ''),
    leadMagnetId: String(input.leadMagnetId || input.lead_magnet_id || ''),
    ctaId: String(input.ctaId || input.cta_id || ''),
    heading: String(input.heading || ''),
    submitLabel: String(input.submitLabel || input.submit_label || ''),
    successMessage: String(input.successMessage || input.success_message || ''),
    errorMessage: String(input.errorMessage || input.error_message || ''),
    accentColor: String(input.accentColor || input.accent_color || ''),
    matchLandingColor: Boolean(input.matchLandingColor ?? input.match_landing_color),
    landingColorMode: String(input.landingColorMode || input.landing_color_mode || ''),
    useLandingBackground: Boolean(input.useLandingBackground ?? input.use_landing_background),
    fields: Array.isArray(input.fields)
      ? input.fields.map((field) => ({
          key: String(field?.key || ''),
          label: String(field?.label || ''),
          type: String(field?.type || 'text'),
          required: Boolean(field?.required),
        }))
      : [],
    createdAt: String(input.createdAt || input.created_at || ''),
    updatedAt: String(input.updatedAt || input.updated_at || ''),
  };
}

function inputToRow(input) {
  const form = sanitize(input);
  if (!form) return null;
  return {
    id: safeText(form.id),
    name: safeText(form.name),
    form_type: safeText(form.formType),
    contact_type: safeText(form.contactType) || 'lead',
    lead_magnet_type: safeText(form.leadMagnetType),
    lead_magnet_id: safeText(form.leadMagnetId),
    cta_id: safeText(form.ctaId),
    heading: safeText(form.heading),
    submit_label: safeText(form.submitLabel),
    success_message: safeText(form.successMessage),
    error_message: safeText(form.errorMessage),
    accent_color: safeText(form.accentColor),
    match_landing_color: Boolean(form.matchLandingColor),
    landing_color_mode: safeText(form.landingColorMode),
    use_landing_background: Boolean(form.useLandingBackground),
    fields: Array.isArray(form.fields) ? form.fields : [],
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

async function supportsSupabaseForms() {
  if (!isSupabaseConfigured()) return false;
  const table = t();
  if (!table) return false;
  if (SUPPORT_CACHE.has(table)) return SUPPORT_CACHE.get(table);
  const probe = await sbQuery({
    table,
    query: 'select=id&limit=1',
  });
  const supported = probe.ok || !isMissingTableError(probe.error);
  SUPPORT_CACHE.set(table, supported);
  return supported;
}

async function listForms(scope = null) {
  if (await supportsSupabaseForms()) {
    const query = await scopedListQuery(
      t(),
      'select=*&order=updated_at.desc,created_at.desc&limit=5000',
      scope
    );
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : [])
        .map(sanitize)
        .filter(Boolean)
        .filter((form) => matchesScope(form, scope));
    }
    if (!isMissingTableError(result.error)) return [];
  }

  const store = readStore();
  return store.forms
    .map(sanitize)
    .filter(Boolean)
    .filter((form) => matchesScope(form, scope))
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
}

async function createForm(input, scope = null) {
  const now = new Date().toISOString();
  const normalizedScope = normalizeScope(scope);
  const form = sanitize({
    id: nextId('dform'),
    projectId: normalizedScope.projectId,
    ownerUserId: normalizedScope.userId,
    name: safeText(input.name),
    formType: safeText(input.formType),
    contactType: safeText(input.contactType || 'lead') || 'lead',
    leadMagnetType: safeText(input.leadMagnetType),
    leadMagnetId: safeText(input.leadMagnetId),
    ctaId: safeText(input.ctaId),
    heading: safeText(input.heading),
    submitLabel: safeText(input.submitLabel),
    successMessage: safeText(input.successMessage),
    errorMessage: safeText(input.errorMessage),
    accentColor: safeText(input.accentColor),
    matchLandingColor: Boolean(input.matchLandingColor),
    landingColorMode: safeText(input.landingColorMode),
    useLandingBackground: Boolean(input.useLandingBackground),
    fields: Array.isArray(input.fields) ? input.fields : [],
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabaseForms()) {
    const row = await scopedInsertRow(t(), {
      ...inputToRow(form),
      id: form.id,
    }, scope);
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

  if (await supportsSupabaseForms()) {
    const existingQuery = await scopedIdQuery(t(), `select=*&id=eq.${encodeURIComponent(formId)}&limit=1`, scope);
    const existingResult = await sbQuery({ table: t(), query: existingQuery });
    if (existingResult.ok) {
      const existing = sanitize(Array.isArray(existingResult.data) ? existingResult.data[0] : null);
      if (!existing) return null;
      const row = await scopedPatchRow(t(), inputToRow({
        ...existing,
        ...input,
        id: formId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      }), scope);
      const patchQuery = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(formId)}&select=*`, scope);
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
  const idx = store.forms.findIndex((item) => {
    const sanitized = sanitize(item);
    return safeText(sanitized?.id) === formId && matchesScope(sanitized, scope);
  });
  if (idx < 0) return null;
  const existing = sanitize(store.forms[idx]);
  const next = sanitize({
    ...existing,
    ...input,
    id: formId,
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

  if (await supportsSupabaseForms()) {
    const query = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(formId)}&select=*`, scope);
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
  const idx = store.forms.findIndex((item) => {
    const sanitized = sanitize(item);
    return safeText(sanitized?.id) === formId && matchesScope(sanitized, scope);
  });
  if (idx < 0) return null;
  const [removed] = store.forms.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

module.exports = {
  listForms,
  createForm,
  updateForm,
  deleteForm,
};
