'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().messagingTopics;
}

function safeText(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function rowToMessagingTopic(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    topic: safeText(row.topic || row.category, 240),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

async function listMessagingTopics(limit = 5000) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&order=topic.asc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToMessagingTopic) : [],
  };
}

async function createMessagingTopic(input) {
  const row = { topic: safeText(input?.topic, 240) };
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToMessagingTopic(created) };
}

async function getMessagingTopic(id) {
  const topicId = Number(id || 0) || 0;
  if (!topicId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&id=eq.${topicId}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Topic not found' };
  return { ok: true, status: 200, data: rowToMessagingTopic(row) };
}

async function updateMessagingTopic(id, input) {
  const topicId = Number(id || 0) || 0;
  if (!topicId) return { ok: false, status: 400, error: 'id is required' };
  const row = { topic: safeText(input?.topic, 240) };
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${topicId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Topic not found' };
  return { ok: true, status: 200, data: rowToMessagingTopic(updated) };
}

async function deleteMessagingTopic(id) {
  const topicId = Number(id || 0) || 0;
  if (!topicId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${topicId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Topic not found' };
  return { ok: true, status: 200, data: rowToMessagingTopic(deleted) };
}

module.exports = {
  listMessagingTopics,
  createMessagingTopic,
  getMessagingTopic,
  updateMessagingTopic,
  deleteMessagingTopic,
};
