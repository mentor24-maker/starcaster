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

function resolveParentCategoryId(input) {
  if (input == null || typeof input !== 'object') return null;
  if (
    input.parentCategoryId === null
    || input.parent_category_id === null
    || input.parent_category === null
  ) {
    return null;
  }
  const raw = input.parentCategoryId ?? input.parent_category_id ?? input.parent_category;
  const id = Number(raw || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function rowToAssetCategory(row) {
  if (!row) return null;
  const parentCategoryId = Number(row.parent_category_id || 0) || null;
  return {
    id: Number(row.id || 0) || 0,
    assetType: canonicalAssetType(String(row.asset_type || '')),
    category: canonicalCategory(String(row.category || '')),
    parentCategoryId: parentCategoryId > 0 ? parentCategoryId : null,
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

async function listAssetCategoriesByParent(parentCategoryId, scope = null) {
  const parentId = Number(parentCategoryId || 0);
  if (!Number.isFinite(parentId) || parentId <= 0) {
    return { ok: true, data: [] };
  }
  const query = await scopedListQuery(
    t().assetCategories,
    `select=*&parent_category_id=eq.${parentId}&limit=5000`,
    scope
  );
  return sbQuery({
    table: t().assetCategories,
    query,
  });
}

async function findAssetCategoryByKey(assetType, category, parentCategoryId, scope = null) {
  const normalizedType = canonicalAssetType(assetType || '');
  const normalizedCategory = canonicalCategory(category || '');
  if (!normalizedType || !normalizedCategory) {
    return { ok: false, status: 400, error: 'assetType and category are required' };
  }
  const parentId = Number(parentCategoryId || 0) || 0;
  let query = `select=*&asset_type=eq.${encodeURIComponent(normalizedType)}&category=eq.${encodeURIComponent(normalizedCategory)}`;
  if (parentId > 0) {
    query += `&parent_category_id=eq.${parentId}`;
  } else {
    query += '&parent_category_id=is.null';
  }
  query += '&limit=1';
  const scoped = await scopedListQuery(t().assetCategories, query, scope);
  return sbQuery({
    table: t().assetCategories,
    query: scoped,
  });
}

async function validateParentCategoryAssignment({
  parentCategoryId,
  categoryId,
  assetType,
  scope,
}) {
  const parentId = Number(parentCategoryId || 0) || 0;
  if (!parentId) return { ok: true };

  const selfId = Number(categoryId || 0) || 0;
  if (selfId && parentId === selfId) {
    return { ok: false, status: 400, error: 'A category cannot be its own parent' };
  }

  const parentRes = await getAssetCategoryById(parentId, scope);
  const parentRow = parentRes.ok && Array.isArray(parentRes.data) ? parentRes.data[0] : null;
  if (!parentRow) {
    return { ok: false, status: 400, error: 'Parent category not found' };
  }

  const nextType = canonicalAssetType(assetType || parentRow.asset_type || '');
  const parentType = canonicalAssetType(parentRow.asset_type || '');
  if (nextType && parentType && nextType !== parentType) {
    return { ok: false, status: 400, error: 'Parent category must use the same asset type' };
  }

  let currentId = parentId;
  const visited = new Set();
  while (currentId) {
    if (visited.has(currentId)) {
      return { ok: false, status: 400, error: 'Parent category assignment would create a cycle' };
    }
    visited.add(currentId);
    if (selfId && currentId === selfId) {
      return { ok: false, status: 400, error: 'Parent category cannot be a descendant of this category' };
    }
    const currentRes = await getAssetCategoryById(currentId, scope);
    const currentRow = currentRes.ok && Array.isArray(currentRes.data) ? currentRes.data[0] : null;
    if (!currentRow) break;
    currentId = Number(currentRow.parent_category_id || 0) || 0;
  }

  return { ok: true };
}

async function createAssetCategory(input, scope = null) {
  const assetType = canonicalAssetType(input.assetType || input.asset_type || '');
  const category = canonicalCategory(input.category || '');
  const parentCategoryId = resolveParentCategoryId(input);

  const parentCheck = await validateParentCategoryAssignment({
    parentCategoryId,
    categoryId: 0,
    assetType,
    scope,
  });
  if (!parentCheck.ok) return parentCheck;

  const existing = await findAssetCategoryByKey(assetType, category, parentCategoryId, scope);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    return { ok: false, status: 409, error: 'That asset type already has a category with this name under the selected parent' };
  }

  const row = await scopedInsertRow(t().assetCategories, {
    asset_type: assetType,
    category,
    parent_category_id: parentCategoryId,
  }, scope);

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

  const current = await getAssetCategoryById(id, scope);
  const currentRow = current.ok && Array.isArray(current.data) ? current.data[0] : null;
  if (!currentRow) {
    return { ok: false, status: 404, error: 'Category not found' };
  }

  const row = {};
  if (input.assetType != null || input.asset_type != null) {
    row.asset_type = canonicalAssetType(input.assetType || input.asset_type || '');
  }
  if (input.category != null) {
    row.category = canonicalCategory(input.category || '');
  }
  const parentProvided = (
    input.parentCategoryId !== undefined
    || input.parent_category_id !== undefined
    || input.parent_category !== undefined
  );
  if (parentProvided) {
    row.parent_category_id = resolveParentCategoryId(input);
  }

  if (!Object.keys(row).length) {
    return { ok: false, status: 400, error: 'No fields to update' };
  }

  const nextType = row.asset_type || canonicalAssetType(String(currentRow.asset_type || ''));
  const nextCategory = row.category || canonicalCategory(String(currentRow.category || ''));
  const nextParentId = parentProvided
    ? row.parent_category_id
    : (Number(currentRow.parent_category_id || 0) || null);

  const parentCheck = await validateParentCategoryAssignment({
    parentCategoryId: nextParentId,
    categoryId: id,
    assetType: nextType,
    scope,
  });
  if (!parentCheck.ok) return parentCheck;

  const existing = await findAssetCategoryByKey(nextType, nextCategory, nextParentId, scope);
  const existingRow = existing.ok && Array.isArray(existing.data) ? existing.data[0] : null;
  if (existingRow && Number(existingRow.id || 0) !== id) {
    return { ok: false, status: 409, error: 'That asset type already has a category with this name under the selected parent' };
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

  const children = await listAssetCategoriesByParent(id, scope);
  if (children.ok && Array.isArray(children.data) && children.data.length) {
    return {
      ok: false,
      status: 409,
      error: 'Delete or reassign child categories before removing this category',
    };
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
  resolveParentCategoryId,
  listAssetCategories,
  listAssetCategoriesByParent,
  createAssetCategory,
  getAssetCategoryById,
  updateAssetCategory,
  deleteAssetCategory,
  validateParentCategoryAssignment,
};
