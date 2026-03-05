'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().messagingWhitePapers;
}

function safeText(value, max = 10000) {
  return String(value || '').trim().slice(0, max);
}

function rowToWhitePaper(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    platform: safeText(row.platform, 120),
    author: safeText(row.author, 180),
    title: safeText(row.title, 300),
    subtitle: safeText(row.subtitle, 500),
    url: safeText(row.url, 1200),
    content: safeText(row.content, 50000),
    publish_date: row.publish_date || null,
    thumbnail_asset_id: Number(row.thumbnail_asset_id || 0) || null,
    pdf_name: safeText(row.pdf_name, 255),
    pdf_mime_type: safeText(row.pdf_mime_type, 120),
    pdf_data_url: safeText(row.pdf_data_url, 9_000_000),
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function whitePaperInputToRow(input) {
  return {
    platform: safeText(input?.platform, 120),
    author: safeText(input?.author, 180),
    title: safeText(input?.title, 300),
    subtitle: safeText(input?.subtitle, 500),
    url: safeText(input?.url, 1200),
    content: safeText(input?.content, 50000),
    publish_date: input?.publish_date ? new Date(input.publish_date).toISOString() : null,
    thumbnail_asset_id: Number(input?.thumbnail_asset_id || 0) || null,
    pdf_name: safeText(input?.pdf_name, 255),
    pdf_mime_type: safeText(input?.pdf_mime_type, 120),
    pdf_data_url: safeText(input?.pdf_data_url, 9_000_000),
  };
}

async function listMessagingWhitePapers(limit = 200) {
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
    data: Array.isArray(res.data) ? res.data.map(rowToWhitePaper) : [],
  };
}

async function createMessagingWhitePaper(input) {
  const row = whitePaperInputToRow(input);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return {
    ok: true,
    status: 201,
    data: rowToWhitePaper(created),
  };
}

async function updateMessagingWhitePaper(id, input) {
  const whitePaperId = Number(id || 0) || 0;
  if (!whitePaperId) return { ok: false, status: 400, error: 'id is required' };
  const row = whitePaperInputToRow(input);

  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${whitePaperId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'White paper not found' };
  return {
    ok: true,
    status: 200,
    data: rowToWhitePaper(updated),
  };
}

async function deleteMessagingWhitePaper(id) {
  const whitePaperId = Number(id || 0) || 0;
  if (!whitePaperId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${whitePaperId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'White paper not found' };
  return {
    ok: true,
    status: 200,
    data: rowToWhitePaper(deleted),
  };
}

module.exports = {
  listMessagingWhitePapers,
  createMessagingWhitePaper,
  updateMessagingWhitePaper,
  deleteMessagingWhitePaper,
  rowToWhitePaper,
};
