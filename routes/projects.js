'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
const {
  listProjectsForUser,
  createProjectForUser,
  resolveCurrentProject,
} = require('../lib/projectsStore');

function safeText(value) {
  return String(value || '').trim();
}

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();
  const userId = safeText(req?.authUser?.id);
  if (!userId) return false;

  if (pathname === '/api/projects' && requestMethod === 'GET') {
    const result = await listProjectsForUser(userId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const projects = Array.isArray(result.data) ? result.data : [];
    return sendOk(res, 200, projects, { projects }, { total: projects.length }), true;
  }

  if (pathname === '/api/projects/current' && requestMethod === 'GET') {
    const requestedProjectId = safeText(req.headers['x-project-id']);
    const result = await resolveCurrentProject({
      userId,
      requestedProjectId,
      autoCreateDefault: true,
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (pathname === '/api/projects' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const result = await createProjectForUser(
      {
        name: body?.name,
        slug: body?.slug,
        description: body?.description,
      },
      userId
    );
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { project: result.data }), true;
  }

  return false;
}

const manifest = {
  id: 'projects',
  label: 'Projects',
  prefixes: ['/api/projects'],
};

module.exports = { handle, manifest };

