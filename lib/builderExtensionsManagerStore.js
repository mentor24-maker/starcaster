'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

function table() {
  return tableConfig().builderExtensionsManager;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeFilters(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return normalizeFilters(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const next = {};
  Object.entries(value).forEach(([key, raw]) => {
    const cleanKey = safeText(key, 120);
    if (!cleanKey) return;
    next[cleanKey] = safeText(raw, 500);
  });
  return next;
}

function rowToManagerConfig(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    managerKey: safeText(row.manager_key, 120) || 'default',
    defaultFilters: normalizeFilters(row.default_filters),
    defaultSortKey: safeText(row.default_sort_key, 120) || 'updatedAt',
    defaultSortDir: safeText(row.default_sort_dir, 10) || 'desc',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

async function getManagerConfig(scope = null) {
  const query = await scopedListQuery(table(), 'select=*&manager_key=eq.default&limit=1', scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) {
    const created = await saveManagerConfig({
      managerKey: 'default',
      defaultFilters: {},
      defaultSortKey: 'updatedAt',
      defaultSortDir: 'desc',
    }, scope);
    return created;
  }
  return {
    ok: true,
    status: 200,
    data: rowToManagerConfig(row),
  };
}

async function saveManagerConfig(input, scope = null) {
  const currentQuery = await scopedListQuery(table(), 'select=*&manager_key=eq.default&limit=1', scope);
  const current = await sbQuery({
    method: 'GET',
    table: table(),
    query: currentQuery,
  });
  if (!current.ok) return current;
  const row = Array.isArray(current.data) ? current.data[0] : current.data;
  const payload = {
    manager_key: 'default',
    default_filters: normalizeFilters(input?.defaultFilters || input?.default_filters),
    default_sort_key: safeText(input?.defaultSortKey || input?.default_sort_key, 120) || 'updatedAt',
    default_sort_dir: safeText(input?.defaultSortDir || input?.default_sort_dir, 10) || 'desc',
  };
  if (!row) {
    const scopedPayload = await scopedInsertRow(table(), payload, scope);
    const created = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [scopedPayload],
    });
    if (!created.ok) return created;
    const next = Array.isArray(created.data) ? created.data[0] : created.data;
    return { ok: true, status: 201, data: rowToManagerConfig(next) };
  }

  const scopedPayload = await scopedPatchRow(table(), payload, scope);
  const updateQuery = await scopedIdQuery(table(), `id=eq.${Number(row.id || 0) || 0}&select=*`, scope);
  const updated = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: updateQuery,
    headers: { Prefer: 'return=representation' },
    body: scopedPayload,
  });
  if (!updated.ok) return updated;
  const next = Array.isArray(updated.data) ? updated.data[0] : updated.data;
  return { ok: true, status: 200, data: rowToManagerConfig(next) };
}

module.exports = {
  getManagerConfig,
  saveManagerConfig,
  rowToManagerConfig,
};
