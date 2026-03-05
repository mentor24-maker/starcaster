'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function defaultNormalize(value) {
  return value;
}

function createMessagingTextStore(options) {
  const {
    tableKey,
    field,
    label = field,
    maxLength = 4000,
    normalize = defaultNormalize,
  } = options || {};

  function table() {
    return tableConfig()[tableKey];
  }

  function clean(value, max = maxLength) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
  }

  function normalizeFieldValue(value) {
    return clean(normalize(clean(value, maxLength)) || '', maxLength);
  }

  function rowToItem(row) {
    if (!row) return null;
    return {
      id: Number(row.id || 0) || 0,
      [field]: normalizeFieldValue(row[field]),
      category: clean(row.category, 240),
      created_at: String(row.created_at || ''),
      updated_at: String(row.updated_at || ''),
    };
  }

  function inputToRow(input) {
    return {
      [field]: normalizeFieldValue(input?.[field]),
      category: clean(input?.category, 240),
    };
  }

  async function list(limit = 5000) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
    const res = await sbQuery({
      method: 'GET',
      table: table(),
      query: `select=*&order=created_at.desc&limit=${safeLimit}`,
    });
    if (!res.ok) return res;
    return {
      ok: true,
      status: 200,
      data: Array.isArray(res.data) ? res.data.map(rowToItem) : [],
    };
  }

  async function create(input) {
    const row = inputToRow(input);
    const res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [row],
    });
    if (!res.ok) return res;
    const created = Array.isArray(res.data) ? res.data[0] : res.data;
    return { ok: true, status: 201, data: rowToItem(created) };
  }

  async function update(id, input) {
    const itemId = Number(id || 0) || 0;
    if (!itemId) return { ok: false, status: 400, error: 'id is required' };
    const row = inputToRow(input);
    const res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query: `id=eq.${itemId}&select=*`,
      headers: { Prefer: 'return=representation' },
      body: row,
    });
    if (!res.ok) return res;
    const updated = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!updated) return { ok: false, status: 404, error: `${label} not found` };
    return { ok: true, status: 200, data: rowToItem(updated) };
  }

  async function remove(id) {
    const itemId = Number(id || 0) || 0;
    if (!itemId) return { ok: false, status: 400, error: 'id is required' };
    const res = await sbQuery({
      method: 'DELETE',
      table: table(),
      query: `id=eq.${itemId}&select=*`,
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok) return res;
    const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!deleted) return { ok: false, status: 404, error: `${label} not found` };
    return { ok: true, status: 200, data: rowToItem(deleted) };
  }

  return {
    list,
    create,
    update,
    remove,
    rowToItem,
  };
}

module.exports = {
  createMessagingTextStore,
};
