'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

function t() { return tableConfig(); }

const ASSET_TYPE_CANONICAL = new Map([
  ['image', 'Image'],
  ['video', 'Video'],
  ['music', 'Audio'],
  ['audio', 'Audio'],
  ['lead magnet', 'Lead Magnet'],
  ['lead_magnet', 'Lead Magnet'],
  ['copy', 'Lead Magnet'],
  ['file', 'File'],
  ['document', 'File'],
  ['screenshot', 'File'],
  ['screen shot', 'File'],
  ['multimedia', 'Video'],
]);

const IMAGE_CATEGORY_CANONICAL = new Map([
  ['article banner', 'Article Banner'],
  ['x post', 'X Post'],
  ['instagram post', 'Instagram Post'],
  ['tiktok post', 'TikTok Post'],
  ['youtube thumbnail', 'YouTube Thumbnail'],
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

async function listAssetCategories(scope = null) {
  const query = await scopedListQuery(
    t().assetCategories,
    'select=*&order=asset_type.asc,category.asc&limit=5000',
    scope
  );
  return sbQuery({
    table: t().assetCategories,
    query,
  });
}

async function findAssetCategoryByTypeAndName(assetType, category, scope = null) {
  const normalizedType = canonicalAssetType(assetType || '');
  const normalizedCategory = canonicalCategory(category || '');
  if (!normalizedType || !normalizedCategory) {
    return { ok: false, status: 400, error: 'assetType and category are required' };
  }
  const query = await scopedListQuery(
    t().assetCategories,
    `select=*&asset_type=eq.${encodeURIComponent(normalizedType)}&category=eq.${encodeURIComponent(normalizedCategory)}&limit=1`,
    scope
  );
  return sbQuery({
    table: t().assetCategories,
    query,
  });
}

async function createAssetCategory(input, scope = null) {
  const row = await scopedInsertRow(t().assetCategories, {
    asset_type: canonicalAssetType(input.assetType || input.asset_type || ''),
    category: canonicalCategory(input.category || ''),
  }, scope);
  const existing = await findAssetCategoryByTypeAndName(row.asset_type, row.category, scope);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    return { ok: false, status: 409, error: 'That asset type already has a category with this name' };
  }
  return sbQuery({
    method: 'POST',
    table: t().assetCategories,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function getAssetCategoryById(categoryId, scope = null) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }
  const query = await scopedIdQuery(t().assetCategories, `select=*&id=eq.${id}&limit=1`, scope);
  return sbQuery({
    table: t().assetCategories,
    query,
  });
}

async function updateAssetCategory(categoryId, input, scope = null) {
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

  if (row.asset_type || row.category) {
    const current = await getAssetCategoryById(id, scope);
    const currentRow = current.ok && Array.isArray(current.data) ? current.data[0] : null;
    const nextType = row.asset_type || canonicalAssetType(String(currentRow?.asset_type || ''));
    const nextCategory = row.category || canonicalCategory(String(currentRow?.category || ''));
    const existing = await findAssetCategoryByTypeAndName(nextType, nextCategory, scope);
    const existingRow = existing.ok && Array.isArray(existing.data) ? existing.data[0] : null;
    if (existingRow && Number(existingRow.id || 0) !== id) {
      return { ok: false, status: 409, error: 'That asset type already has a category with this name' };
    }
  }

  const scopedRow = await scopedPatchRow(t().assetCategories, row, scope);
  const query = await scopedIdQuery(t().assetCategories, `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'PATCH',
    table: t().assetCategories,
    query,
    headers: { Prefer: 'return=representation' },
    body: scopedRow,
  });
}

async function deleteAssetCategory(categoryId, scope = null) {
  const id = Number(categoryId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid category id is required' };
  }
  const query = await scopedIdQuery(t().assetCategories, `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: t().assetCategories,
    query,
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
