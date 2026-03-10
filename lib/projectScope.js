'use strict';

const { sbQuery } = require('./supabase');

const SUPPORT_CACHE = new Map();

function safeText(value) {
  return String(value || '').trim();
}

function appendQuery(baseQuery, fragment) {
  const base = String(baseQuery || '').trim();
  const frag = String(fragment || '').trim();
  if (!frag) return base;
  if (!base) return frag.replace(/^&+/, '');
  return `${base}${frag.startsWith('&') ? '' : '&'}${frag}`;
}

function isMissingProjectColumnError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return (
    text.includes('project_id') ||
    text.includes('owner_user_id') ||
    text.includes('column') ||
    text.includes('schema cache')
  );
}

async function supportsProjectColumns(table) {
  const tableName = safeText(table);
  if (!tableName) return false;
  if (SUPPORT_CACHE.has(tableName)) return SUPPORT_CACHE.get(tableName);

  const probe = await sbQuery({
    table: tableName,
    query: 'select=project_id,owner_user_id&limit=1',
  });
  const supported = probe.ok;
  SUPPORT_CACHE.set(tableName, supported);
  return supported;
}

function getScopeValues(scope) {
  return {
    projectId: safeText(scope?.projectId || scope?.project_id),
    userId: safeText(scope?.userId || scope?.user_id),
  };
}

async function scopedListQuery(table, baseQuery, scope) {
  const { projectId } = getScopeValues(scope);
  if (!projectId) return String(baseQuery || '');
  const supports = await supportsProjectColumns(table);
  if (!supports) return String(baseQuery || '');
  return appendQuery(baseQuery, `project_id=eq.${encodeURIComponent(projectId)}`);
}

async function scopedIdQuery(table, idQuery, scope) {
  const { projectId } = getScopeValues(scope);
  if (!projectId) return String(idQuery || '');
  const supports = await supportsProjectColumns(table);
  if (!supports) return String(idQuery || '');
  return appendQuery(idQuery, `project_id=eq.${encodeURIComponent(projectId)}`);
}

async function scopedInsertRow(table, rowInput, scope) {
  const row = rowInput && typeof rowInput === 'object' ? { ...rowInput } : {};
  const { projectId, userId } = getScopeValues(scope);
  if (!projectId) return row;
  const supports = await supportsProjectColumns(table);
  if (!supports) return row;
  row.project_id = projectId;
  if (userId) row.owner_user_id = userId;
  return row;
}

async function scopedPatchRow(table, patchInput, scope) {
  const patch = patchInput && typeof patchInput === 'object' ? { ...patchInput } : {};
  const { userId } = getScopeValues(scope);
  const supports = await supportsProjectColumns(table);
  if (!supports) return patch;
  if (userId && !('owner_user_id' in patch)) patch.owner_user_id = userId;
  return patch;
}

module.exports = {
  supportsProjectColumns,
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
};
