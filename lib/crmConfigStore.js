'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'crm_configs.json');
const SUPPORT_CACHE = new Map();

function t() {
  return tableConfig().crmConfigs;
}

function ensureFile() {
  ensureJsonFile(STORE_FILE, { configs: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { configs: [] };
    if (!Array.isArray(parsed.configs)) parsed.configs = [];
    return parsed;
  } catch {
    return { configs: [] };
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

function matchesScope(config, scope) {
  const { projectId } = normalizeScope(scope);
  if (!projectId) return true;
  return safeText(config?.projectId || config?.project_id) === projectId;
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  const raw = input.standardFields || input.standard_fields;
  const rawCustom = input.customFields || input.custom_fields;
  return {
    id: String(input.id || ''),
    projectId: safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    name: String(input.name || 'CRM'),
    status: String(input.status || 'active'),
    standardFields: Array.isArray(raw) ? raw : ['email', 'first_name', 'last_name', 'phone'],
    customFields: Array.isArray(rawCustom)
      ? rawCustom.map((f) => ({
          key: safeText(f?.key),
          label: safeText(f?.label),
          type: safeText(f?.type) || 'text',
          required: Boolean(f?.required),
          options: Array.isArray(f?.options) ? f.options.map(String) : [],
        }))
      : [],
    createdAt: String(input.createdAt || input.created_at || ''),
    updatedAt: String(input.updatedAt || input.updated_at || ''),
  };
}

function inputToRow(input) {
  const c = sanitize(input);
  if (!c) return null;
  return {
    id: safeText(c.id),
    name: safeText(c.name) || 'CRM',
    status: safeText(c.status) || 'active',
    standard_fields: Array.isArray(c.standardFields) ? c.standardFields : [],
    custom_fields: Array.isArray(c.customFields) ? c.customFields : [],
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

async function listConfigs(scope = null) {
  if (await supportsSupabase()) {
    const query = await scopedListQuery(
      t(),
      'select=*&order=updated_at.desc,created_at.desc&limit=500',
      scope
    );
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : [])
        .map(sanitize)
        .filter(Boolean)
        .filter((c) => matchesScope(c, scope));
    }
    if (!isMissingTableError(result.error)) return [];
  }

  const store = readStore();
  return store.configs
    .map(sanitize)
    .filter(Boolean)
    .filter((c) => matchesScope(c, scope))
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
}

async function getConfig(id, scope = null) {
  const configId = safeText(id);
  if (!configId) return null;
  const all = await listConfigs(scope);
  return all.find((c) => c.id === configId) || null;
}

async function createConfig(input, scope = null) {
  const now = new Date().toISOString();
  const normalizedScope = normalizeScope(scope);
  const config = sanitize({
    id: nextId('crmc'),
    projectId: normalizedScope.projectId,
    ownerUserId: normalizedScope.userId,
    name: safeText(input.name) || 'CRM',
    status: safeText(input.status) || 'active',
    standardFields: Array.isArray(input.standardFields) ? input.standardFields : ['email', 'first_name', 'last_name', 'phone'],
    customFields: Array.isArray(input.customFields) ? input.customFields : [],
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabase()) {
    const row = await scopedInsertRow(t(), { ...inputToRow(config), id: config.id }, scope);
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
  store.configs.unshift(config);
  writeStore(store);
  return config;
}

async function updateConfig(id, input, scope = null) {
  const configId = safeText(id);
  if (!configId) return null;

  if (await supportsSupabase()) {
    const existingQuery = await scopedIdQuery(t(), `select=*&id=eq.${encodeURIComponent(configId)}&limit=1`, scope);
    const existingResult = await sbQuery({ table: t(), query: existingQuery });
    if (existingResult.ok) {
      const existing = sanitize(Array.isArray(existingResult.data) ? existingResult.data[0] : null);
      if (!existing) return null;
      const row = await scopedPatchRow(t(), inputToRow({
        ...existing,
        ...input,
        id: configId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      }), scope);
      const patchQuery = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(configId)}&select=*`, scope);
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
  const idx = store.configs.findIndex((item) => {
    const s = sanitize(item);
    return safeText(s?.id) === configId && matchesScope(s, scope);
  });
  if (idx < 0) return null;
  const existing = sanitize(store.configs[idx]);
  const next = sanitize({
    ...existing,
    ...input,
    id: configId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  store.configs[idx] = next;
  writeStore(store);
  return next;
}

async function deleteConfig(id, scope = null) {
  const configId = safeText(id);
  if (!configId) return null;

  if (await supportsSupabase()) {
    const query = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(configId)}&select=*`, scope);
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
  const idx = store.configs.findIndex((item) => {
    const s = sanitize(item);
    return safeText(s?.id) === configId && matchesScope(s, scope);
  });
  if (idx < 0) return null;
  const [removed] = store.configs.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

module.exports = { listConfigs, getConfig, createConfig, updateConfig, deleteConfig };
