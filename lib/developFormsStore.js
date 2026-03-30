'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');

const STORE_FILE = path.join(__dirname, '..', 'data', 'develop_forms.json');

function ensureFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ forms: [] }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
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
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
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
  const { projectId, userId } = normalizeScope(scope);
  if (!projectId) return true;
  const rowProjectId = safeText(form?.projectId || form?.project_id);
  if (rowProjectId === projectId) return true;
  return false;
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    id: String(input.id || ''),
    projectId: safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    name: String(input.name || ''),
    formType: String(input.formType || ''),
    contactType: String(input.contactType || input.contact_type || 'lead').trim() || 'lead',
    leadMagnetType: String(input.leadMagnetType || input.lead_magnet_type || ''),
    leadMagnetId: String(input.leadMagnetId || input.lead_magnet_id || ''),
    ctaId: String(input.ctaId || input.cta_id || ''),
    heading: String(input.heading || ''),
    submitLabel: String(input.submitLabel || ''),
    successMessage: String(input.successMessage || input.success_message || ''),
    errorMessage: String(input.errorMessage || input.error_message || ''),
    accentColor: String(input.accentColor || ''),
    matchLandingColor: Boolean(input.matchLandingColor),
    landingColorMode: String(input.landingColorMode || ''),
    useLandingBackground: Boolean(input.useLandingBackground),
    fields: Array.isArray(input.fields)
      ? input.fields.map((field) => ({
          key: String(field?.key || ''),
          label: String(field?.label || ''),
          type: String(field?.type || 'text'),
          required: Boolean(field?.required),
        }))
      : [],
    createdAt: String(input.createdAt || ''),
    updatedAt: String(input.updatedAt || ''),
  };
}

function listForms(scope = null) {
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

function createForm(input, scope = null) {
  const now = new Date().toISOString();
  const normalizedScope = normalizeScope(scope);
  const form = sanitize({
    id: nextId('dform'),
    projectId: normalizedScope.projectId,
    ownerUserId: normalizedScope.userId,
    name: String(input.name || '').trim(),
    formType: String(input.formType || '').trim(),
    contactType: String(input.contactType || 'lead').trim() || 'lead',
    leadMagnetType: String(input.leadMagnetType || '').trim(),
    leadMagnetId: String(input.leadMagnetId || '').trim(),
    ctaId: String(input.ctaId || '').trim(),
    heading: String(input.heading || '').trim(),
    submitLabel: String(input.submitLabel || '').trim(),
    successMessage: String(input.successMessage || '').trim(),
    errorMessage: String(input.errorMessage || '').trim(),
    accentColor: String(input.accentColor || '').trim(),
    matchLandingColor: Boolean(input.matchLandingColor),
    landingColorMode: String(input.landingColorMode || '').trim(),
    useLandingBackground: Boolean(input.useLandingBackground),
    fields: Array.isArray(input.fields) ? input.fields : [],
    createdAt: now,
    updatedAt: now,
  });

  const store = readStore();
  store.forms.unshift(form);
  writeStore(store);
  return form;
}

function updateForm(id, input, scope = null) {
  const formId = String(id || '').trim();
  if (!formId) return null;
  const store = readStore();
  const idx = store.forms.findIndex((item) => {
    const sanitized = sanitize(item);
    return String(sanitized?.id || '') === formId && matchesScope(sanitized, scope);
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

function deleteForm(id, scope = null) {
  const formId = String(id || '').trim();
  if (!formId) return null;
  const store = readStore();
  const idx = store.forms.findIndex((item) => {
    const sanitized = sanitize(item);
    return String(sanitized?.id || '') === formId && matchesScope(sanitized, scope);
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
