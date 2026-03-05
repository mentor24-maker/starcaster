'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().messagingHeadlines;
}

function clean(value, max = 2000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function rowToHeadline(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    headline: clean(row.headline, 2000),
    category: clean(row.category, 240),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function inputToRow(input) {
  return {
    headline: clean(input?.headline, 2000),
    category: clean(input?.category, 240),
  };
}

async function listMessagingHeadlines(limit = 5000) {
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
    data: Array.isArray(res.data) ? res.data.map(rowToHeadline) : [],
  };
}

async function createMessagingHeadline(input) {
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
  return { ok: true, status: 201, data: rowToHeadline(created) };
}

async function updateMessagingHeadline(id, input) {
  const headlineId = Number(id || 0) || 0;
  if (!headlineId) return { ok: false, status: 400, error: 'id is required' };
  const row = inputToRow(input);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${headlineId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Headline not found' };
  return { ok: true, status: 200, data: rowToHeadline(updated) };
}

async function deleteMessagingHeadline(id) {
  const headlineId = Number(id || 0) || 0;
  if (!headlineId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${headlineId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Headline not found' };
  return { ok: true, status: 200, data: rowToHeadline(deleted) };
}

module.exports = {
  listMessagingHeadlines,
  createMessagingHeadline,
  updateMessagingHeadline,
  deleteMessagingHeadline,
  rowToHeadline,
};
