'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { normalizeMessagingTag } = require('./messagingTagNormalize');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');

function table() {
  return tableConfig().messagingTags;
}

function safeText(value, max = 240) {
  return normalizeMessagingTag(String(value || '').trim().replace(/\s+/g, ' ').slice(0, max));
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

async function listMessagingTags(limit = 5000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const query = await scopedListQuery(table(), `select=*&order=tag.asc&limit=${safeLimit}`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToMessagingTag) : [],
  };
}

async function createMessagingTag(input, scope = null) {
  const row = await scopedInsertRow(table(), { tag: safeText(input?.tag, 240) }, scope);
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

async function getMessagingTag(id, scope = null) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${tagId}&limit=1`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(row) };
}

async function updateMessagingTag(id, input, scope = null) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), { tag: safeText(input?.tag, 240) }, scope);
  const query = await scopedIdQuery(table(), `id=eq.${tagId}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(updated) };
}

async function deleteMessagingTag(id, scope = null) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${tagId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
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
