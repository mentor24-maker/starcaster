'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().messagingTaglines;
}

function clean(value, max = 2000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function rowToTagline(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    tagline: clean(row.tagline, 2000),
    category: clean(row.category, 240),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function inputToRow(input) {
  return {
    tagline: clean(input?.tagline, 2000),
    category: clean(input?.category, 240),
  };
}

async function listMessagingTaglines(limit = 5000) {
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
    data: Array.isArray(res.data) ? res.data.map(rowToTagline) : [],
  };
}

async function createMessagingTagline(input) {
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
  return { ok: true, status: 201, data: rowToTagline(created) };
}

async function updateMessagingTagline(id, input) {
  const taglineId = Number(id || 0) || 0;
  if (!taglineId) return { ok: false, status: 400, error: 'id is required' };
  const row = inputToRow(input);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${taglineId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Tagline not found' };
  return { ok: true, status: 200, data: rowToTagline(updated) };
}

async function deleteMessagingTagline(id) {
  const taglineId = Number(id || 0) || 0;
  if (!taglineId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${taglineId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Tagline not found' };
  return { ok: true, status: 200, data: rowToTagline(deleted) };
}

module.exports = {
  listMessagingTaglines,
  createMessagingTagline,
  updateMessagingTagline,
  deleteMessagingTagline,
  rowToTagline,
};
