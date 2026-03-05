'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function t() { return tableConfig(); }

const ASSET_TYPE_CANONICAL = new Map([
  ['image', 'Image'],
  ['video', 'Video'],
  ['music', 'Audio'],
  ['audio', 'Audio'],
  ['lead magnet', 'Lead Magnet'],
  ['lead_magnet', 'Lead Magnet'],
  ['copy', 'Lead Magnet'],
  ['multimedia', 'Video'],
]);

const IMAGE_CATEGORY_CANONICAL = new Map([
  ['article banner', 'Article Banner'],
  ['x post', 'X Post'],
  ['instagram post', 'Instagram Post'],
  ['tiktok post', 'TikTok Post'],
  ['youtube thumbnail', 'Youtube Thumbnail'],
  ['miscellaneous', 'Miscellaneous'],
]);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function canonicalAssetType(value) {
  const raw = String(value || '').trim();
  const key = normalizeKey(raw);
  return ASSET_TYPE_CANONICAL.get(key) || raw;
}

function canonicalCategory(value) {
  const raw = String(value || '').trim();
  const key = normalizeKey(raw);
  return IMAGE_CATEGORY_CANONICAL.get(key) || raw;
}

function rowToAssetCategory(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    assetType: canonicalAssetType(String(row.asset_type || '')),
    category: canonicalCategory(String(row.category || '')),
    createdAt: String(row.created_at || ''),
  };
}

async function listAssetCategories() {
  return sbQuery({
    table: t().assetCategories,
    query: 'select=*&order=asset_type.asc,category.asc&limit=5000',
  });
}

async function createAssetCategory(input) {
  const row = {
    asset_type: canonicalAssetType(input.assetType || input.asset_type || ''),
    category: canonicalCategory(input.category || ''),
  };
  return sbQuery({
    method: 'POST',
    table: t().assetCategories,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function getAssetCategoryById(categoryId) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }
  return sbQuery({
    table: t().assetCategories,
    query: `select=*&id=eq.${id}&limit=1`,
  });
}

async function updateAssetCategory(categoryId, input) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }

  const row = {};
  if (input.assetType != null || input.asset_type != null) {
    row.asset_type = canonicalAssetType(input.assetType || input.asset_type || '');
  }
  if (input.category != null) {
    row.category = canonicalCategory(input.category || '');
  }

  if (!Object.keys(row).length) {
    return { ok: false, status: 400, error: 'No fields to update' };
  }

  return sbQuery({
    method: 'PATCH',
    table: t().assetCategories,
    query: `id=eq.${id}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
}

async function deleteAssetCategory(categoryId) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }
  return sbQuery({
    method: 'DELETE',
    table: t().assetCategories,
    query: `id=eq.${id}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = {
  rowToAssetCategory,
  listAssetCategories,
  createAssetCategory,
  getAssetCategoryById,
  updateAssetCategory,
  deleteAssetCategory,
};
