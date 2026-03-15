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
  const projectIds = Array.isArray(scope?.projectIds)
    ? scope.projectIds.map((value) => safeText(value)).filter(Boolean)
    : [];
  return {
    projectId: safeText(scope?.projectId || scope?.project_id),
    userId: safeText(scope?.userId || scope?.user_id),
    projectIds,
  };
}

function projectCompatOr(projectId, userId, projectIdsInput) {
  const pid = encodeURIComponent(projectId);
  const uid = encodeURIComponent(userId || '');
  const projectIds = Array.isArray(projectIdsInput)
    ? projectIdsInput
        .map((value) => safeText(value))
        .filter(Boolean)
        .filter((value, index, arr) => arr.indexOf(value) === index)
    : [];
  const membershipIds = projectIds.filter((id) => id !== projectId);
  const membershipFilter = membershipIds.length
    ? `,project_id.in.(${membershipIds.map((id) => encodeURIComponent(id)).join(',')})`
    : '';
  if (uid) {
    // Backward compatibility:
    // - include selected project rows
    // - include rows from any project this user belongs to (data may have been
    //   created before selected-project switching stabilized)
    // - include legacy rows with null project_id owned by the current user
    //   (or without owner_user_id set from pre-project migrations)
    return `(project_id.eq.${pid}${membershipFilter},and(project_id.is.null,or(owner_user_id.eq.${uid},owner_user_id.is.null)))`;
  }
  return `(project_id.eq.${pid}${membershipFilter},project_id.is.null)`;
}

async function scopedListQuery(table, baseQuery, scope) {
  const { projectId, userId, projectIds } = getScopeValues(scope);
  if (!projectId) return String(baseQuery || '');
  const supports = await supportsProjectColumns(table);
  if (!supports) return String(baseQuery || '');
  return appendQuery(baseQuery, `or=${projectCompatOr(projectId, userId, projectIds)}`);
}

async function scopedIdQuery(table, idQuery, scope) {
  const { projectId, userId, projectIds } = getScopeValues(scope);
  if (!projectId) return String(idQuery || '');
  const supports = await supportsProjectColumns(table);
  if (!supports) return String(idQuery || '');
  return appendQuery(idQuery, `or=${projectCompatOr(projectId, userId, projectIds)}`);
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
