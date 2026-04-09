'use strict';

const { sbQuery, tableConfig } = require('../supabase');

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

async function listYoutubeTopics() {
  return sbQuery({
    table: table(),
    query: 'select=*&order=topic.asc&limit=5000',
  });
}

async function createYoutubeTopic(input) {
  const topic = normalizeTopic(input.topic || '');
  return sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [{ topic }],
  });
}

async function getYoutubeTopicById(topicId) {
  const id = Number(topicId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid topic id is required' };
  }
  return sbQuery({
    table: table(),
    query: `select=*&id=eq.${id}&limit=1`,
  });
}

async function updateYoutubeTopic(topicId, input) {
  const id = Number(topicId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid topic id is required' };
  }

  const topic = normalizeTopic(input.topic || '');
  return sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${id}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { topic },
  });
}

async function deleteYoutubeTopic(topicId) {
  const id = Number(topicId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid topic id is required' };
  }
  return sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${id}&select=*`,
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
