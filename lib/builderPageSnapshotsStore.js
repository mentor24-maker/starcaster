'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');

function table() {
  return tableConfig().builderPageSnapshots;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function rowToSnapshot(row) {
  if (!row) return null;
  let pages = [];
  if (Array.isArray(row.pages)) {
    pages = row.pages;
  } else if (typeof row.pages === 'string') {
    try { pages = JSON.parse(row.pages); } catch (_) { pages = []; }
  }
  return {
    id: String(row.id ?? ''),
    label: safeText(row.label, 255),
    pageCount: Number(row.page_count || 0) || 0,
    pages,
    createdAt: row.created_at || '',
  };
}

async function listPageSnapshots(scope = null) {
  const query = await scopedListQuery(
    table(),
    'select=id,label,page_count,created_at&order=created_at.desc&limit=100',
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToSnapshot) : [],
  };
}

async function getPageSnapshot(id, scope = null) {
  const snapId = Number(id || 0) || 0;
  if (!snapId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${snapId}&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Snapshot not found' };
  return { ok: true, status: 200, data: rowToSnapshot(row) };
}

async function createPageSnapshot(input, scope = null) {
  const pages = Array.isArray(input?.pages) ? input.pages : [];
  const row = await scopedInsertRow(table(), {
    label: safeText(input?.label, 255),
    page_count: pages.length,
    pages: JSON.stringify(pages),
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToSnapshot(created) };
}

async function deletePageSnapshot(id, scope = null) {
  const snapId = Number(id || 0) || 0;
  if (!snapId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${snapId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Snapshot not found' };
  return { ok: true, status: 200, data: rowToSnapshot(removed) };
}

module.exports = {
  listPageSnapshots,
  getPageSnapshot,
  createPageSnapshot,
  deletePageSnapshot,
};
