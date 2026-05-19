'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'develop_modules.json');
const SUPPORT_CACHE = new Map();

function t() {
  return tableConfig().developModules;
}

function ensureFile() {
  ensureJsonFile(STORE_FILE, { modules: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { modules: [] };
    if (!Array.isArray(parsed.modules)) parsed.modules = [];
    return parsed;
  } catch {
    return { modules: [] };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function safeText(value) {
  return String(value || '').trim();
}

function cloneJson(value) {
  if (!value || typeof value !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function normalizeScope(scope) {
  return {
    projectId: safeText(scope?.projectId || scope?.project_id),
    userId: safeText(scope?.userId || scope?.user_id),
  };
}

function matchesScope(item, scope) {
  const { projectId } = normalizeScope(scope);
  if (!projectId) return true;
  return safeText(item?.projectId || item?.project_id) === projectId;
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  const settings = input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
    ? cloneJson(input.settings)
    : {};
  return {
    id: safeText(input.id),
    projectId: safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    name: safeText(input.name),
    classId: Number(input.classId || input.class_id || 0) || null,
    moduleType: safeText(input.moduleType || input.module_type) || 'header',
    settings,
    createdAt: safeText(input.createdAt || input.created_at),
    updatedAt: safeText(input.updatedAt || input.updated_at),
  };
}

function inputToRow(input) {
  const module = sanitize(input);
  if (!module) return null;
  return {
    id: module.id,
    name: module.name,
    class_id: module.classId,
    module_type: module.moduleType,
    settings: cloneJson(module.settings),
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

async function supportsSupabaseModules() {
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

async function listModules(scope = null) {
  if (await supportsSupabaseModules()) {
    const query = await scopedListQuery(
      t(),
      'select=*&order=updated_at.desc,created_at.desc&limit=5000',
      scope
    );
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    }
    if (!isMissingTableError(result.error)) return [];
  }

  const store = readStore();
  return store.modules
    .map(sanitize)
    .filter(Boolean)
    .filter((module) => matchesScope(module, scope))
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
}

async function createModule(input, scope = null) {
  const now = new Date().toISOString();
  const normalizedScope = normalizeScope(scope);
  const module = sanitize({
    id: nextId('dmod'),
    projectId: normalizedScope.projectId,
    ownerUserId: normalizedScope.userId,
    name: safeText(input.name),
    classId: Number(input.classId || input.class_id || 0) || null,
    moduleType: safeText(input.moduleType) || 'header',
    settings: input.settings || {},
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabaseModules()) {
    const row = await scopedInsertRow(t(), { ...inputToRow(module), id: module.id }, scope);
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
  store.modules.unshift(module);
  writeStore(store);
  return module;
}

async function updateModule(id, input, scope = null) {
  const moduleId = safeText(id);
  if (!moduleId) return null;

  if (await supportsSupabaseModules()) {
    const existingQuery = await scopedIdQuery(t(), `select=*&id=eq.${encodeURIComponent(moduleId)}&limit=1`, scope);
    const existingResult = await sbQuery({ table: t(), query: existingQuery });
    if (existingResult.ok) {
      const existing = sanitize(Array.isArray(existingResult.data) ? existingResult.data[0] : null);
      if (!existing) return null;
      const row = await scopedPatchRow(t(), inputToRow({
        ...existing,
        ...input,
        id: moduleId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      }), scope);
      const patchQuery = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(moduleId)}&select=*`, scope);
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
  const idx = store.modules.findIndex((item) => {
    const sanitized = sanitize(item);
    return safeText(sanitized?.id) === moduleId && matchesScope(sanitized, scope);
  });
  if (idx < 0) return null;
  const existing = sanitize(store.modules[idx]);
  const updated = sanitize({
    ...existing,
    ...input,
    id: moduleId,
    projectId: existing.projectId,
    ownerUserId: existing.ownerUserId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  store.modules[idx] = updated;
  writeStore(store);
  return updated;
}

async function deleteModule(id, scope = null) {
  const moduleId = safeText(id);
  if (!moduleId) return false;

  if (await supportsSupabaseModules()) {
    const query = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(moduleId)}&select=id`, scope);
    const result = await sbQuery({ method: 'DELETE', table: t(), query, headers: { Prefer: 'return=representation' } });
    if (result.ok) return true;
    if (!isMissingTableError(result.error)) return false;
  }

  const store = readStore();
  const originalLength = store.modules.length;
  store.modules = store.modules.filter((item) => {
    const sanitized = sanitize(item);
    return !(safeText(sanitized?.id) === moduleId && matchesScope(sanitized, scope));
  });
  if (store.modules.length === originalLength) return false;
  writeStore(store);
  return true;
}

module.exports = {
  listModules,
  createModule,
  updateModule,
  deleteModule,
};
