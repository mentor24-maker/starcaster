'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');

function t() {
  return tableConfig();
}

function tableName() {
  return t().assetAssociations || 'asset_associations';
}

function rowToAssociation(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    assetId: Number(row.asset_id || 0) || 0,
    targetType: String(row.target_type || '').trim(),
    targetId: String(row.target_id || '').trim(),
    targetLabel: String(row.target_label || '').trim(),
    createdAt: String(row.created_at || ''),
  };
}

async function listAssociationsForAsset(assetId, scope = null) {
  const id = Number(assetId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'assetId is required' };
  }
  const query = await scopedListQuery(
    tableName(),
    `select=*&asset_id=eq.${id}&order=created_at.desc&limit=500`,
    scope
  );
  return sbQuery({ table: tableName(), query });
}

async function createAssociation(input, scope = null) {
  const assetId = Number(input?.assetId ?? input?.asset_id ?? 0);
  const targetType = String(input?.targetType ?? input?.target_type ?? '').trim();
  const targetId = String(input?.targetId ?? input?.target_id ?? '').trim();
  const targetLabel = String(input?.targetLabel ?? input?.target_label ?? '').trim();

  if (!Number.isFinite(assetId) || assetId <= 0) {
    return { ok: false, status: 400, error: 'assetId is required' };
  }
  if (!targetType) {
    return { ok: false, status: 400, error: 'targetType is required' };
  }
  if (!targetId) {
    return { ok: false, status: 400, error: 'targetId is required' };
  }

  const row = await scopedInsertRow(tableName(), {
    asset_id: assetId,
    target_type: targetType,
    target_id: targetId,
    target_label: targetLabel,
  }, scope);

  return sbQuery({
    method: 'POST',
    table: tableName(),
    query: 'select=*',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function deleteAssociation(associationId, scope = null) {
  const id = Number(associationId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'association id is required' };
  }
  const query = await scopedIdQuery(tableName(), `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: tableName(),
    query,
    extraHeaders: { Prefer: 'return=representation' },
  });
}

module.exports = {
  listAssociationsForAsset,
  createAssociation,
  deleteAssociation,
  rowToAssociation,
};
