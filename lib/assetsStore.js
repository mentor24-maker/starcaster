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
  ['banner image', 'Website Banner Image'],
  ['website banner', 'Website Banner Image'],
  ['website banner image', 'Website Banner Image'],
  ['hero banner', 'Website Banner Image'],
  ['feature', 'Feature Image'],
  ['feature image', 'Feature Image'],
  ['feature graphic', 'Feature Image'],
  ['featured image', 'Feature Image'],
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

function rowToAsset(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    assetName: row.asset_name || '',
    assetType: canonicalAssetType(row.asset_type || ''),
    category: canonicalCategory(row.category || ''),
    location: row.location || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    size: Number(row.size || 0) || 0,
    imageWidth: Number(row.image_width || 0) || 0,
    imageHeight: Number(row.image_height || 0) || 0,
    topic: row.topic || '',
    comments: row.comments || '',
    generationStatus: row.generation_status || '',
    generationJobId: row.generation_job_id || '',
    createdAt: row.created_at || row.updated_at || ''
  };
}

async function listAssets(scope = null) {
  const query = await scopedListQuery(t().assets, 'select=*&order=asset_name.asc&limit=5000', scope);
  return sbQuery({
    table: t().assets,
    query,
  });
}

async function getAssetById(assetId, scope = null) {
  const id = Number(assetId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid asset id is required' };
  }
  const query = await scopedIdQuery(t().assets, `select=*&id=eq.${id}&limit=1`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: t().assets,
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Asset not found' };
  return { ok: true, status: 200, data: row };
}

async function createAsset(asset, scope = null) {
  const row = await scopedInsertRow(t().assets, {
    asset_name: String(asset.assetName || asset.asset_name || '').trim(),
    asset_type: canonicalAssetType(asset.assetType || asset.asset_type || ''),
    category: canonicalCategory(asset.category || ''),
    location: String(asset.location || '').trim(),
    tags: Array.isArray(asset.tags)
      ? asset.tags.map((v) => String(v || '').trim()).filter(Boolean)
      : [],
    size: Math.max(0, Number(asset.size || 0) || 0),
    image_width: Math.max(0, Number(asset.imageWidth || asset.image_width || 0) || 0) || null,
    image_height: Math.max(0, Number(asset.imageHeight || asset.image_height || 0) || 0) || null,
    topic: String(asset.topic || '').trim(),
    comments: String(asset.comments || '').trim(),
    generation_status: asset.generationStatus || asset.generation_status || null,
    generation_job_id: asset.generationJobId || asset.generation_job_id || null,
  }, scope);

  return sbQuery({
    method: 'POST',
    table: t().assets,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function updateAsset(assetId, patch, scope = null) {
  const id = Number(assetId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid asset id is required' };
  }

  const row = {};
  if (patch.assetName != null || patch.asset_name != null) {
    row.asset_name = String((patch.assetName ?? patch.asset_name ?? '')).trim();
  }
  if (patch.assetType != null || patch.asset_type != null) {
    row.asset_type = canonicalAssetType(patch.assetType ?? patch.asset_type ?? '');
  }
  if (patch.location != null) {
    row.location = String(patch.location || '').trim();
  }
  if (patch.category != null) {
    row.category = canonicalCategory(patch.category || '');
  }
  if (patch.tags != null) {
    row.tags = Array.isArray(patch.tags)
      ? patch.tags.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
  }
  if (patch.size != null) {
    row.size = Math.max(0, Number(patch.size || 0) || 0);
  }
  if (patch.imageWidth != null || patch.image_width != null) {
    row.image_width = Math.max(0, Number((patch.imageWidth ?? patch.image_width ?? 0)) || 0) || null;
  }
  if (patch.imageHeight != null || patch.image_height != null) {
    row.image_height = Math.max(0, Number((patch.imageHeight ?? patch.image_height ?? 0)) || 0) || null;
  }
  if (patch.topic != null) {
    row.topic = String(patch.topic || '').trim();
  }
  if (patch.comments != null) {
    row.comments = String(patch.comments || '').trim();
  }
  if (patch.generationStatus !== undefined || patch.generation_status !== undefined) {
    row.generation_status = patch.generationStatus ?? patch.generation_status ?? null;
  }
  if (patch.generationJobId !== undefined || patch.generation_job_id !== undefined) {
    row.generation_job_id = patch.generationJobId ?? patch.generation_job_id ?? null;
  }

  if (!Object.keys(row).length) {
    return { ok: false, status: 400, error: 'No fields to update' };
  }

  const scopedRow = await scopedPatchRow(t().assets, row, scope);
  const query = await scopedIdQuery(t().assets, `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'PATCH',
    table: t().assets,
    query,
    headers: { Prefer: 'return=representation' },
    body: scopedRow,
  });
}

async function deleteAsset(assetId, scope = null) {
  const id = Number(assetId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid asset id is required' };
  }

  const query = await scopedIdQuery(t().assets, `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: t().assets,
    query,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = { listAssets, getAssetById, createAsset, updateAsset, deleteAsset, rowToAsset };
