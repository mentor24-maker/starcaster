'use strict';

const { isStrictProjectScope } = require('./projectScope');

function safeText(value) {
  return String(value || '').trim();
}

function normalizeScope(scope) {
  return {
    projectId: safeText(scope?.projectId || scope?.project_id),
    userId: safeText(scope?.userId || scope?.user_id),
  };
}

function matchesScopedRecord(record, scope) {
  const { projectId, userId } = normalizeScope(scope);
  if (!projectId) return true;
  const rowProjectId = safeText(record?.project_id || record?.projectId);
  if (rowProjectId === projectId) return true;
  if (isStrictProjectScope()) return false;
  if (!rowProjectId) {
    const rowUserId = safeText(record?.owner_user_id || record?.ownerUserId);
    return !rowUserId || rowUserId === userId;
  }
  return false;
}

function attachScopeFields(record, scope) {
  const next = record && typeof record === 'object' ? { ...record } : {};
  const { projectId, userId } = normalizeScope(scope);
  if (projectId) {
    next.project_id = projectId;
    next.projectId = projectId;
  }
  if (userId) {
    next.owner_user_id = userId;
    next.ownerUserId = userId;
  }
  return next;
}

module.exports = {
  normalizeScope,
  matchesScopedRecord,
  attachScopeFields,
  isStrictProjectScope,
};
