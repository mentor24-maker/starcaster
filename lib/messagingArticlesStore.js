'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().messagingArticles;
}

function safeText(value, max = 10000) {
  return String(value || '').trim().slice(0, max);
}

function cleanTopic(input) {
  return safeText(input?.topic != null ? input.topic : input?.category, 240);
}

function errorText(res) {
  return String(res?.error || res?.message || '').toLowerCase();
}

function shouldRetryWithoutTopic(res) {
  const text = errorText(res);
  return text.includes('topic') && (text.includes('column') || text.includes('schema cache'));
}

function rowToArticle(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    topic: safeText(row.topic || row.category, 240),
    category: safeText(row.topic || row.category, 240),
    platform: safeText(row.platform, 120),
    author: safeText(row.author, 180),
    title: safeText(row.title, 300),
    subtitle: safeText(row.subtitle, 500),
    url: safeText(row.url, 1200),
    content: safeText(row.content, 50000),
    publish_date: row.publish_date || null,
    thumbnail_asset_id: Number(row.thumbnail_asset_id || 0) || null,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function articleInputToRow(input) {
  return {
    topic: cleanTopic(input),
    platform: safeText(input?.platform, 120),
    author: safeText(input?.author, 180),
    title: safeText(input?.title, 300),
    subtitle: safeText(input?.subtitle, 500),
    url: safeText(input?.url, 1200),
    content: safeText(input?.content, 50000),
    publish_date: input?.publish_date ? new Date(input.publish_date).toISOString() : null,
    thumbnail_asset_id: Number(input?.thumbnail_asset_id || 0) || null,
  };
}

async function listMessagingArticles(limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&order=publish_date.desc.nullslast,created_at.desc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToArticle) : [],
  };
}

async function createMessagingArticle(input) {
  const row = articleInputToRow(input);

  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && shouldRetryWithoutTopic(res)) {
    const legacyRow = { ...row };
    delete legacyRow.topic;
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [legacyRow],
    });
  }
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return {
    ok: true,
    status: 201,
    data: rowToArticle(created),
  };
}

async function updateMessagingArticle(id, input) {
  const articleId = Number(id || 0) || 0;
  if (!articleId) return { ok: false, status: 400, error: 'id is required' };
  const row = articleInputToRow(input);

  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${articleId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && shouldRetryWithoutTopic(res)) {
    const legacyRow = { ...row };
    delete legacyRow.topic;
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query: `id=eq.${articleId}&select=*`,
      headers: { Prefer: 'return=representation' },
      body: legacyRow,
    });
  }
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Article not found' };
  return {
    ok: true,
    status: 200,
    data: rowToArticle(updated),
  };
}

async function deleteMessagingArticle(id) {
  const articleId = Number(id || 0) || 0;
  if (!articleId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${articleId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Article not found' };
  return {
    ok: true,
    status: 200,
    data: rowToArticle(deleted),
  };
}

module.exports = {
  listMessagingArticles,
  createMessagingArticle,
  updateMessagingArticle,
  deleteMessagingArticle,
  rowToArticle,
};
