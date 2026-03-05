'use strict';

const { sbQuery, tableConfig } = require('../supabase');

function categoriesTable() {
  return tableConfig().harvestYoutubeCategories;
}

function normalizeCategory(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function rowToYoutubeCategory(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    category: normalizeCategory(row.category || ''),
    createdAt: String(row.created_at || ''),
  };
}

async function listYoutubeCategories() {
  return sbQuery({
    table: categoriesTable(),
    query: 'select=*&order=category.asc&limit=5000',
  });
}

async function createYoutubeCategory(input) {
  const category = normalizeCategory(input.category || '');
  return sbQuery({
    method: 'POST',
    table: categoriesTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [{ category }],
  });
}

async function getYoutubeCategoryById(categoryId) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }
  return sbQuery({
    table: categoriesTable(),
    query: `select=*&id=eq.${id}&limit=1`,
  });
}

async function updateYoutubeCategory(categoryId, input) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }

  const category = normalizeCategory(input.category || '');
  return sbQuery({
    method: 'PATCH',
    table: categoriesTable(),
    query: `id=eq.${id}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { category },
  });
}

async function deleteYoutubeCategory(categoryId) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }
  return sbQuery({
    method: 'DELETE',
    table: categoriesTable(),
    query: `id=eq.${id}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = {
  rowToYoutubeCategory,
  listYoutubeCategories,
  createYoutubeCategory,
  getYoutubeCategoryById,
  updateYoutubeCategory,
  deleteYoutubeCategory,
};
