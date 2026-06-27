'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile, isLocalJsonFsWritable } = require('./localDataFs');
const {
  normalizeCrmFormStyles,
  legacyAccentHex,
  resolveStoredFormStyles,
  embedFormStylesMeta,
  publicFormFields,
  stylesSignature,
} = require('./crmFormStyles');
const { scopedIdQuery, scopedInsertRow, scopedListQuery, scopedPatchRow } = require('./projectScope');

const STORE_FILE = path.join(__dirname, '..', 'data', 'crm_forms.json');
const SUPPORT_CACHE = new Map();
let lastFormStoreError = '';

function getLastFormStoreError() {
  return lastFormStoreError;
}

function setLastFormStoreError(message) {
  lastFormStoreError = safeText(message);
}

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
  return writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function safeText(value) {
  return String(value || '').trim();
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  const legacyAccent = safeText(input.accentColor || input.accent_color);
  const styles = normalizeCrmFormStyles(resolveStoredFormStyles(input, legacyAccent), legacyAccent);
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
    accentColor: legacyAccentHex(styles, legacyAccent),
    styles,
    fields: publicFormFields(input.fields)
      .map((f) => ({
        key: safeText(f?.key),
        label: safeText(f?.label),
        type: safeText(f?.type) || 'text',
        required: Boolean(f?.required),
      })),
    createdAt: String(input.createdAt || input.created_at || ''),
    updatedAt: String(input.updatedAt || input.updated_at || ''),
  };
}

function inputToRow(input, options = {}) {
  const f = sanitize(input);
  if (!f) return null;
  const legacyAccent = safeText(input?.accentColor || input?.accent_color || f.accentColor);
  const styles = normalizeCrmFormStyles(
    input?.styles !== undefined ? input.styles : f.styles,
    legacyAccent
  );
  const sourceFields = input?.fields !== undefined ? input.fields : f.fields;
  const fields = options.includeStylesMeta
    ? embedFormStylesMeta(sourceFields, styles, legacyAccent)
    : (Array.isArray(sourceFields)
      ? sourceFields.map((field) => ({
        key: safeText(field?.key),
        label: safeText(field?.label),
        type: safeText(field?.type) || 'text',
        required: Boolean(field?.required),
      }))
      : []);
  return {
    id: f.id,
    crm_config_id: f.crmConfigId,
    name: f.name,
    heading: f.heading,
    submit_label: f.submitLabel,
    success_message: f.successMessage,
    error_message: f.errorMessage,
    accent_color: legacyAccentHex(styles, legacyAccent),
    styles,
    fields,
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

function firstSupabaseRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === 'object' ? data : null;
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

function isStylesColumnError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('styles') && (
    text.includes('schema cache') ||
    text.includes('could not find') ||
    text.includes('column')
  );
}

async function patchCrmFormRow(formId, patchBody, scope) {
  const basePatchQuery = `id=eq.${encodeURIComponent(formId)}&select=*`;
  const patchQuery = await scopedIdQuery(t(), basePatchQuery, scope);
  return sbQuery({
    method: 'PATCH',
    table: t(),
    query: patchQuery,
    headers: { Prefer: 'return=representation' },
    body: patchBody,
  });
}

async function buildSupabasePatch(input, existing, scope) {
  const legacyAccent = safeText(
    input.accentColor !== undefined ? input.accentColor : existing?.accentColor
  );
  const merged = sanitize({
    ...existing,
    ...input,
    id: existing?.id,
    crmConfigId: existing?.crmConfigId,
    createdAt: existing?.createdAt,
  });
  if (!merged) return scopedPatchRow(t(), { updated_at: new Date().toISOString() }, scope);

  const patch = inputToRow(merged, { includeStylesMeta: true });
  if (!patch) return scopedPatchRow(t(), { updated_at: new Date().toISOString() }, scope);

  delete patch.id;
  delete patch.crm_config_id;
  patch.updated_at = new Date().toISOString();
  return scopedPatchRow(t(), patch, scope);
}

async function verifyPersistedFormStyles(formId, expectedStyles, legacyAccent, scope) {
  const formIdText = safeText(formId);
  if (!formIdText || expectedStyles === undefined) return true;

  // Read fields/accent only — the styles column may be absent from PostgREST cache.
  const baseQuery = `select=fields,accent_color&id=eq.${encodeURIComponent(formIdText)}&limit=1`;
  const query = await scopedIdQuery(t(), baseQuery, scope);
  let result = await sbQuery({ table: t(), query });
  if (!result.ok && isStylesColumnError(result.error)) {
    result = await sbQuery({
      table: t(),
      query: `select=fields,accent_color&id=eq.${encodeURIComponent(formIdText)}&limit=1`,
    });
  }
  if (!result.ok) {
    setLastFormStoreError(result.error || 'Failed to verify saved CRM form styles.');
    return false;
  }

  const row = firstSupabaseRow(result.data);
  if (!row) {
    setLastFormStoreError('Saved CRM form could not be reloaded for verification.');
    return false;
  }

  const persisted = normalizeCrmFormStyles(resolveStoredFormStyles(row, legacyAccent), legacyAccent);
  const expected = normalizeCrmFormStyles(expectedStyles, legacyAccent);
  if (stylesSignature(persisted, legacyAccent) === stylesSignature(expected, legacyAccent)) {
    return true;
  }

  setLastFormStoreError(
    'CRM form style settings did not persist. Reload the Supabase API schema cache if the styles column was recently added.'
  );
  return false;
}

function persistLocalForm(store, form) {
  const writeResult = writeStore(store);
  if (!writeResult.ok) return null;
  return form;
}

async function listForms(crmConfigId, scope = null) {
  const configId = safeText(crmConfigId);
  if (!configId) return [];

  if (await supportsSupabase()) {
    const baseQuery = `select=*&crm_config_id=eq.${encodeURIComponent(configId)}&order=updated_at.desc,created_at.desc&limit=500`;
    const query = await scopedListQuery(t(), baseQuery, scope);
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    }
    if (!isMissingTableError(result.error)) return [];
  }

  if (!isLocalJsonFsWritable()) return [];

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

  if (await supportsSupabase()) {
    const baseQuery = `select=*&id=eq.${encodeURIComponent(formId)}&limit=1`;
    const query = await scopedIdQuery(t(), baseQuery, scope);
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return sanitize(firstSupabaseRow(result.data));
    }
    if (!isMissingTableError(result.error)) return null;
  }

  if (!isLocalJsonFsWritable()) return null;

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
    styles: input.styles,
    fields: Array.isArray(input.fields) ? input.fields : [],
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabase()) {
    const row = await scopedInsertRow(t(), {
      ...inputToRow(form, { includeStylesMeta: true }),
      id: form.id,
      created_at: now,
      updated_at: now,
    }, scope);
    let result = await sbQuery({
      method: 'POST',
      table: t(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [row],
    });
    if (!result.ok && row.styles && isStylesColumnError(result.error)) {
      const fallbackRow = { ...row };
      delete fallbackRow.styles;
      result = await sbQuery({
        method: 'POST',
        table: t(),
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: [fallbackRow],
      });
    }
    if (result.ok) {
      const created = sanitize(firstSupabaseRow(result.data));
      if (!created) {
        setLastFormStoreError('CRM form was created but could not be read back.');
        return null;
      }
      const verified = await verifyPersistedFormStyles(
        created.id,
        created.styles,
        created.accentColor,
        scope
      );
      if (!verified) return null;
      return created;
    }
    setLastFormStoreError(result.error || 'Failed to create CRM form in Supabase.');
    return null;
  }

  if (!isLocalJsonFsWritable()) return null;

  const store = readStore();
  store.forms.unshift(form);
  return persistLocalForm(store, form);
}

async function updateForm(id, input, scope = null) {
  const formId = safeText(id);
  if (!formId) return null;
  setLastFormStoreError('');

  if (await supportsSupabase()) {
    const baseExistQuery = `select=*&id=eq.${encodeURIComponent(formId)}&limit=1`;
    const existQuery = await scopedIdQuery(t(), baseExistQuery, scope);
    const existingResult = await sbQuery({ table: t(), query: existQuery });
    if (!existingResult.ok) {
      setLastFormStoreError(existingResult.error || 'Failed to load CRM form before update.');
      return null;
    }

    const existing = sanitize(firstSupabaseRow(existingResult.data));
    if (!existing) return null;

    const legacyAccent = safeText(
      input.accentColor !== undefined ? input.accentColor : existing.accentColor
    );
    const expectedStyles = normalizeCrmFormStyles(
      input.styles !== undefined ? input.styles : existing.styles,
      legacyAccent
    );

    const patchBody = await buildSupabasePatch(input, existing, scope);
    let updated = await patchCrmFormRow(formId, patchBody, scope);
    if (!updated.ok && patchBody.styles && isStylesColumnError(updated.error)) {
      const fallbackPatch = { ...patchBody };
      delete fallbackPatch.styles;
      updated = await patchCrmFormRow(formId, fallbackPatch, scope);
    }
    if (!updated.ok) {
      setLastFormStoreError(updated.error || 'Failed to update CRM form in Supabase.');
      return null;
    }

    const next = sanitize(firstSupabaseRow(updated.data));
    if (!next) {
      setLastFormStoreError('CRM form update succeeded but no row was returned.');
      return null;
    }

    const verified = await verifyPersistedFormStyles(formId, expectedStyles, legacyAccent, scope);
    if (!verified) return null;

    const verifiedRow = await getForm(formId, scope);
    return verifiedRow || next;
  }

  if (!isLocalJsonFsWritable()) {
    setLastFormStoreError('CRM form storage is unavailable in this environment.');
    return null;
  }

  const store = readStore();
  const idx = store.forms.findIndex((item) => safeText(sanitize(item)?.id) === formId);
  if (idx < 0) return null;
  const existing = sanitize(store.forms[idx]);
  const mergedFields = embedFormStylesMeta(
    input.fields !== undefined ? input.fields : existing.fields,
    input.styles !== undefined ? input.styles : existing.styles,
    input.accentColor !== undefined ? input.accentColor : existing.accentColor
  );
  const next = sanitize({
    ...existing,
    ...input,
    fields: mergedFields,
    id: formId,
    crmConfigId: existing.crmConfigId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  store.forms[idx] = next;
  return persistLocalForm(store, next);
}

async function deleteForm(id, scope = null) {
  const formId = safeText(id);
  if (!formId) return null;

  if (await supportsSupabase()) {
    const baseQuery = `id=eq.${encodeURIComponent(formId)}&select=*`;
    const query = await scopedIdQuery(t(), baseQuery, scope);
    const result = await sbQuery({
      method: 'DELETE',
      table: t(),
      query,
      headers: { Prefer: 'return=representation' },
    });
    if (result.ok) {
      return sanitize(firstSupabaseRow(result.data));
    }
    if (!isMissingTableError(result.error)) return null;
  }

  if (!isLocalJsonFsWritable()) return null;

  const store = readStore();
  const idx = store.forms.findIndex((item) => safeText(sanitize(item)?.id) === formId);
  if (idx < 0) return null;
  const [removed] = store.forms.splice(idx, 1);
  return persistLocalForm(store, sanitize(removed));
}

module.exports = {
  listForms,
  getForm,
  createForm,
  updateForm,
  deleteForm,
  getLastFormStoreError,
};
