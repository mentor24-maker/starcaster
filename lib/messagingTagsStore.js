'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().messagingTags;
}

function safeText(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function rowToMessagingTag(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    tag: safeText(row.tag, 240),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

async function listMessagingTags(limit = 5000) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&order=tag.asc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToMessagingTag) : [],
  };
}

async function createMessagingTag(input) {
  const row = { tag: safeText(input?.tag, 240) };
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToMessagingTag(created) };
}

async function getMessagingTag(id) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&id=eq.${tagId}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(row) };
}

async function updateMessagingTag(id, input) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const row = { tag: safeText(input?.tag, 240) };
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${tagId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(updated) };
}

async function deleteMessagingTag(id) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${tagId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(deleted) };
}

module.exports = {
  listMessagingTags,
  createMessagingTag,
  getMessagingTag,
  updateMessagingTag,
  deleteMessagingTag,
};
