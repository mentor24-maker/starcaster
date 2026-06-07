'use strict';

function safeText(value) {
  return String(value || '').trim();
}

function isProjectContextOptional(pathname, method) {
  const path = safeText(pathname);
  const requestMethod = String(method || '').toUpperCase();
  if (!path.startsWith('/api/')) return true;
  if (path === '/api/debug-routes') return true;
  if (path.startsWith('/api/auth')) return true;
  if (path === '/api/health') return true;

  if (path === '/api/projects' && (requestMethod === 'GET' || requestMethod === 'POST')) return true;
  if (path === '/api/projects/current' && requestMethod === 'GET') return true;
  if (path === '/api/projects/active' && requestMethod === 'POST') return true;
  if (path === '/api/projects/delete' && requestMethod === 'POST') return true;

  const projectDeleteMatch = path.match(/^\/api\/projects\/([^/]+)\/delete\/?$/);
  if (projectDeleteMatch && requestMethod === 'POST') {
    const projectId = decodeURIComponent(projectDeleteMatch[1] || '').trim();
    if (projectId && projectId !== 'current' && projectId !== 'active') return true;
  }

  const projectIdMatch = path.match(/^\/api\/projects\/([^/]+)\/?$/);
  if (projectIdMatch && (requestMethod === 'PATCH' || requestMethod === 'DELETE')) {
    const projectId = decodeURIComponent(projectIdMatch[1] || '').trim();
    if (projectId && projectId !== 'current' && projectId !== 'active') return true;
  }

  if (path === '/api/settings/profile' && (requestMethod === 'GET' || requestMethod === 'POST')) return true;
  if (path.startsWith('/api/settings/apis')) return true;
  if (path.startsWith('/api/settings/training')) return true;
  if (path === '/api/settings/youtube-miner-context') return true;
  if (path === '/api/settings/database/tables' && requestMethod === 'GET') return true;
  if (path === '/api/settings/email-senders' && requestMethod === 'GET') return true;

  return false;
}

function requireProjectContext(req, pathname, method) {
  if (isProjectContextOptional(pathname, method)) return { ok: true };
  const projectId = safeText(req?.projectContext?.project?.id);
  if (!projectId) {
    return {
      ok: false,
      status: 400,
      message: 'Active project is required',
      code: 'PROJECT_REQUIRED',
    };
  }
  return { ok: true };
}

module.exports = {
  isProjectContextOptional,
  requireProjectContext,
};
