'use strict';

const { sendOk, sendErr, parseJsonBody, normalizeApiPathname } = require('./http');
const {
  listProjectsForUser,
  createProjectForUser,
  resolveCurrentProject,
  setActiveProjectForSession,
  updateProjectForUser,
} = require('../lib/projectsStore');
const { setSessionActiveProject } = require('../lib/authStore');
const { handleProjectDelete } = require('../lib/projectDeleteHandler');

function safeText(value) {
  return String(value || '').trim();
}

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();
  const normalizedPath = normalizeApiPathname(pathname);
  if (!normalizedPath.startsWith('/api/projects')) return false;

  const userId = safeText(req?.authUser?.id);
  if (!userId) {
    return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
  }

  if (normalizedPath === '/api/projects' && requestMethod === 'GET') {
    const result = await listProjectsForUser(userId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const projects = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, projects, { projects }, { total: projects.length }), true;
  }

  if (normalizedPath === '/api/projects/current' && requestMethod === 'GET') {
    const requestedProjectId = safeText(req.headers['x-project-id']);
    const sessionActiveProjectId = safeText(req?.authSession?.activeProjectId);
    const result = await resolveCurrentProject({
      userId,
      requestedProjectId,
      sessionActiveProjectId,
      autoCreateDefault: true,
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;

    const data = result.data || {};
    const resolvedFrom = safeText(data.resolvedFrom);
    const sessionToken = safeText(req?.authSession?.token);
    if (
      sessionToken
      && data.project?.id
      && resolvedFrom === 'header'
      && !sessionActiveProjectId
    ) {
      await setSessionActiveProject(sessionToken, data.project.id);
      data.sessionActiveProjectId = data.project.id;
      data.resolvedFrom = 'session';
    }

    return sendOk(res, 200, data, data), true;
  }

  if (normalizedPath === '/api/projects/active' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const projectId = safeText(body?.projectId || body?.project_id);
    const sessionToken = safeText(req?.authSession?.token);
    const result = await setActiveProjectForSession(userId, projectId, sessionToken);
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error, { code: result.code || 'PROJECT_ACTIVE_FAILED' }), true;
    }
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (normalizedPath === '/api/projects/delete' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const projectId = safeText(body?.projectId || body?.project_id);
    return handleProjectDelete(req, res, projectId, userId);
  }

  const projectDeleteMatch = normalizedPath.match(/^\/api\/projects\/([^/]+)\/delete\/?$/);
  if (projectDeleteMatch && requestMethod === 'POST') {
    const projectId = decodeURIComponent(projectDeleteMatch[1] || '').trim();
    return handleProjectDelete(req, res, projectId, userId);
  }

  const projectIdMatch = normalizedPath.match(/^\/api\/projects\/([^/]+)\/?$/);
  if (projectIdMatch && requestMethod === 'DELETE') {
    const projectId = decodeURIComponent(projectIdMatch[1] || '').trim();
    return handleProjectDelete(req, res, projectId, userId);
  }

  if (projectIdMatch && requestMethod === 'PATCH') {
    const projectId = decodeURIComponent(projectIdMatch[1] || '').trim();
    if (!projectId || projectId === 'current' || projectId === 'active') {
      return sendErr(res, 400, 'Valid project id is required', { code: 'VALIDATION_ERROR' }), true;
    }
    const body = await parseJsonBody(req);
    const result = await updateProjectForUser(projectId, body, userId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error, { code: 'PROJECT_UPDATE_FAILED' }), true;
    return sendOk(res, 200, { project: result.data }, { project: result.data }), true;
  }

  if (normalizedPath === '/api/projects' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const result = await createProjectForUser(
      {
        name: body?.name,
        slug: body?.slug,
        description: body?.description,
        projectUrl: body?.projectUrl || body?.project_url || body?.website,
      },
      userId
    );
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = result.data || null;
    const sessionToken = safeText(req?.authSession?.token);
    if (created?.id && sessionToken) {
      await setActiveProjectForSession(userId, created.id, sessionToken);
    }
    return sendOk(res, 201, created, { project: created }), true;
  }

  return sendErr(res, 404, `Projects route not found: ${requestMethod} ${normalizedPath}`, { code: 'NOT_FOUND' }), true;
}

const manifest = {
  id: 'projects',
  label: 'Projects',
  prefixes: ['/api/projects'],
};

module.exports = { handle, manifest };
