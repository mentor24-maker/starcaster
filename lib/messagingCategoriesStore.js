'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().messagingCategories;
}

function safeText(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function rowToMessagingCategory(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    category: safeText(row.category, 240),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

async function listMessagingCategories(limit = 5000) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&order=category.asc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToMessagingCategory) : [],
  };
}

async function createMessagingCategory(input) {
  const row = { category: safeText(input?.category, 240) };
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToMessagingCategory(created) };
}

async function getMessagingCategory(id) {
  const categoryId = Number(id || 0) || 0;
  if (!categoryId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&id=eq.${categoryId}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Category not found' };
  return { ok: true, status: 200, data: rowToMessagingCategory(row) };
}

async function updateMessagingCategory(id, input) {
  const categoryId = Number(id || 0) || 0;
  if (!categoryId) return { ok: false, status: 400, error: 'id is required' };
  const row = { category: safeText(input?.category, 240) };
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${categoryId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Category not found' };
  return { ok: true, status: 200, data: rowToMessagingCategory(updated) };
}

async function deleteMessagingCategory(id) {
  const categoryId = Number(id || 0) || 0;
  if (!categoryId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${categoryId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Category not found' };
  return { ok: true, status: 200, data: rowToMessagingCategory(deleted) };
}

module.exports = {
  listMessagingCategories,
  createMessagingCategory,
  getMessagingCategory,
  updateMessagingCategory,
  deleteMessagingCategory,
};
