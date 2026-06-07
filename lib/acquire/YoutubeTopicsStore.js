'use strict';

const { sbQuery, tableConfig } = require('../supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('../projectScope');

function table() {
  return tableConfig().acquireYoutubeTopics;
}

function normalizeTopic(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function rowToYoutubeTopic(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    topic: normalizeTopic(row.topic || ''),
    createdAt: String(row.created_at || ''),
  };
}

async function listYoutubeTopics(scope = null) {
  const query = await scopedListQuery(table(), 'select=*&order=topic.asc&limit=5000', scope);
  return sbQuery({
    table: table(),
    query,
  });
}

async function createYoutubeTopic(input, scope = null) {
  const topic = normalizeTopic(input.topic || '');
  const row = await scopedInsertRow(table(), { topic }, scope);
  return sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function getYoutubeTopicById(topicId, scope = null) {
  const id = Number(topicId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid topic id is required' };
  }
  const query = await scopedIdQuery(table(), `select=*&id=eq.${id}&limit=1`, scope);
  return sbQuery({
    table: table(),
    query,
  });
}

async function updateYoutubeTopic(topicId, input, scope = null) {
  const id = Number(topicId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid topic id is required' };
  }

  const topic = normalizeTopic(input.topic || '');
  const query = await scopedIdQuery(table(), `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: { topic },
  });
}

async function deleteYoutubeTopic(topicId, scope = null) {
  const id = Number(topicId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid topic id is required' };
  }
  const query = await scopedIdQuery(table(), `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = {
  rowToYoutubeTopic,
  listYoutubeTopics,
  createYoutubeTopic,
  getYoutubeTopicById,
  updateYoutubeTopic,
  deleteYoutubeTopic,
};
