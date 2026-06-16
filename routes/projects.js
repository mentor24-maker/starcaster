'use strict';

const { sendOk, sendErr, parseJsonBody, normalizeApiPathname } = require('./http');
const {
  listProjectsForUser,
  createProjectForUser,
  resolveCurrentProject,
  setActiveProjectForSession,
  updateProjectForUser,
  listProjectMembers,
  removeMemberFromProject,
  addMemberToProject,
} = require('../lib/projectsStore');
const { setSessionActiveProject, findUserByEmail } = require('../lib/authStore');
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

  // GET /api/projects/:id/members — list members with user info
  const membersMatch = normalizedPath.match(/^\/api\/projects\/([^/]+)\/members\/?$/);
  if (membersMatch && requestMethod === 'GET') {
    const projectId = decodeURIComponent(membersMatch[1] || '').trim();
    if (!projectId) return sendErr(res, 400, 'Valid project id is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await listProjectMembers(projectId, userId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { members: result.data }, { total: result.data.length }), true;
  }

  // POST /api/projects/:id/members — directly add a user by email (no invitation required)
  if (membersMatch && requestMethod === 'POST') {
    const projectId = decodeURIComponent(membersMatch[1] || '').trim();
    if (!projectId) return sendErr(res, 400, 'Valid project id is required', { code: 'VALIDATION_ERROR' }), true;

    // Verify requesting user owns this project
    const accessResult = await listProjectsForUser(userId);
    if (!accessResult.ok) return sendErr(res, accessResult.status || 500, accessResult.error), true;
    const userProject = (Array.isArray(accessResult.data) ? accessResult.data : []).find(
      (p) => safeText(p?.id) === projectId
    );
    if (!userProject) return sendErr(res, 403, 'Project not found or access denied', { code: 'FORBIDDEN' }), true;
    if (safeText(userProject?.membership?.role) !== 'owner') {
      return sendErr(res, 403, 'Only project owners can add members', { code: 'FORBIDDEN' }), true;
    }

    const body = await parseJsonBody(req);
    const email = safeText(body?.email);
    const role = safeText(body?.role) || 'member';
    if (!email) return sendErr(res, 400, 'email is required', { code: 'VALIDATION_ERROR' }), true;
    if (email.toLowerCase() === safeText(req?.authUser?.email).toLowerCase()) {
      return sendErr(res, 400, 'You are already a member of this project', { code: 'VALIDATION_ERROR' }), true;
    }

    const targetUser = await findUserByEmail(email);
    if (!targetUser) {
      return sendErr(res, 404, 'No account found for that email address. They must register first.', { code: 'USER_NOT_FOUND' }), true;
    }

    const result = await addMemberToProject(projectId, targetUser.id, role);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, {
      ...result.data,
      email: safeText(targetUser.email),
      name: safeText(targetUser.name),
    }, { member: result.data }), true;
  }

  // DELETE /api/projects/:id/members/:uid — remove a member
  const memberUidMatch = normalizedPath.match(/^\/api\/projects\/([^/]+)\/members\/([^/]+)\/?$/);
  if (memberUidMatch && requestMethod === 'DELETE') {
    const projectId = decodeURIComponent(memberUidMatch[1] || '').trim();
    const targetUserId = decodeURIComponent(memberUidMatch[2] || '').trim();
    const result = await removeMemberFromProject(projectId, targetUserId, userId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  return sendErr(res, 404, `Projects route not found: ${requestMethod} ${normalizedPath}`, { code: 'NOT_FOUND' }), true;
}

const manifest = {
  id: 'projects',
  label: 'Projects',
  prefixes: ['/api/projects'],
};

module.exports = { handle, manifest };
