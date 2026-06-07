'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('../routes/http');
const { setSessionActiveProject } = require('./authStore');
const { deleteProjectForUser } = require('./projectDeleteStore');

function safeText(value) {
  return String(value || '').trim();
}

function readPurgeAssociated(req, body) {
  const urlObj = (() => {
    try {
      return getUrlObj(req);
    } catch {
      return null;
    }
  })();
  const purgeQuery = safeText(
    urlObj?.searchParams?.get('purgeAssociated') || urlObj?.searchParams?.get('purge_associated')
  ).toLowerCase();
  return Boolean(
    body?.purgeAssociated
    || body?.purge_associated
    || purgeQuery === 'true'
    || purgeQuery === '1'
    || purgeQuery === 'yes'
    || safeText(req?.headers?.['x-purge-associated']).toLowerCase() === 'true'
  );
}

async function handleProjectDelete(req, res, projectIdInput, userIdInput) {
  const projectId = safeText(projectIdInput);
  const userId = safeText(userIdInput);
  if (!userId) {
    return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
  }
  let body = {};
  try {
    body = await parseJsonBody(req);
  } catch (_) {
    body = {};
  }

  const resolvedProjectId = safeText(projectId) || safeText(body?.projectId || body?.project_id);
  if (!resolvedProjectId || resolvedProjectId === 'current' || resolvedProjectId === 'active') {
    return sendErr(res, 400, 'Valid project id is required', { code: 'VALIDATION_ERROR' }), true;
  }

  const result = await deleteProjectForUser(resolvedProjectId, userId, {
    purgeAssociated: readPurgeAssociated(req, body),
  });
  if (!result.ok) {
    return sendErr(res, result.status || 500, result.error, { code: result.code || 'PROJECT_DELETE_FAILED' }), true;
  }

  const sessionToken = safeText(req?.authSession?.token);
  const activeProjectId = safeText(req?.authSession?.activeProjectId);
  if (sessionToken && activeProjectId === resolvedProjectId) {
    await setSessionActiveProject(sessionToken, '');
  }

  return sendOk(res, 200, result.data, result.data), true;
}

module.exports = {
  handleProjectDelete,
  readPurgeAssociated,
};
