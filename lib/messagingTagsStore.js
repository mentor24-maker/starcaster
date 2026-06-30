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

function cleanTopic(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function errorText(res) {
  return String(res?.error || res?.message || '').toLowerCase();
}

function shouldRetryWithLegacyCategory(res) {
  const text = errorText(res);
  return text.includes('topic') && (text.includes('column') || text.includes('schema cache'));
}

function rowToMessagingTag(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    tag: safeText(row.tag, 240),
    topic: cleanTopic(row.topic != null ? row.topic : row.category, 240),
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
  const tag = safeText(input?.tag, 240);
  const topic = cleanTopic(input?.topic != null ? input.topic : input?.category, 240);
  if (!tag) return { ok: false, status: 400, error: 'tag is required' };
  const row = await scopedInsertRow(table(), { tag, topic }, scope);
  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && shouldRetryWithLegacyCategory(res)) {
    const legacyRow = await scopedInsertRow(table(), { tag, category: topic }, scope);
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [legacyRow],
    });
  }
  if (!res.ok && topic && errorText(res).includes('topic') && errorText(res).includes('column')) {
    const fallbackRow = await scopedInsertRow(table(), { tag }, scope);
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [fallbackRow],
    });
  }
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

function buildTagPatch(input) {
  const patch = {};
  if (input?.tag != null) {
    const tag = safeText(input.tag, 240);
    if (!tag) return { ok: false, error: 'tag is required' };
    patch.tag = tag;
  }
  if (input?.topic != null || input?.category != null) {
    patch.topic = cleanTopic(input?.topic != null ? input.topic : input?.category, 240);
  }
  if (!Object.keys(patch).length) {
    return { ok: false, error: 'No fields to update' };
  }
  return { ok: true, patch };
}

async function updateMessagingTag(id, input, scope = null) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const built = buildTagPatch(input || {});
  if (!built.ok) return { ok: false, status: 400, error: built.error || 'No fields to update' };
  let row = await scopedPatchRow(table(), built.patch, scope);
  let query = await scopedIdQuery(table(), `id=eq.${tagId}&select=*`, scope);
  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && shouldRetryWithLegacyCategory(res)) {
    const legacyPatch = { ...built.patch };
    if (legacyPatch.topic != null) {
      legacyPatch.category = legacyPatch.topic;
      delete legacyPatch.topic;
    }
    row = await scopedPatchRow(table(), legacyPatch, scope);
    query = await scopedIdQuery(table(), `id=eq.${tagId}&select=*`, scope);
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: row,
    });
  }
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
