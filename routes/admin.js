'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { listUsers, getUserById, createUser, updateUser, deleteUser } = require('../lib/authStore');
const { logActivity } = require('../lib/activityLog');

function requireAdminRole(req) {
  const role = String(req?.authUser?.role || '').trim();
  return req?.authUser && (role === 'owner' || role === 'admin');
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/admin/platform-users')) return false;

  if (!requireAdminRole(req)) {
    return sendErr(res, 403, 'Forbidden: owner or admin role required', { code: 'FORBIDDEN' }), true;
  }

  if (pathname === '/api/admin/platform-users' && method === 'GET') {
    const result = await listUsers();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { users: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/admin/platform-users' && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = await createUser({
      email: String(body.email || '').trim(),
      password: String(body.password || '').trim(),
      name: String(body.name || '').trim(),
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({ action: 'admin_user.created', entityType: 'admin_user', entityId: result.data.id, summary: `Admin user created: ${result.data.email}` });
    return sendOk(res, 201, result.data, { user: result.data }), true;
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);

  if (userMatch && method === 'GET') {
    const id = decodeURIComponent(userMatch[1]);
    const result = await getUserById(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { user: result.data }), true;
  }

  if (userMatch && method === 'PUT') {
    const id = decodeURIComponent(userMatch[1]);
    const body = await parseJsonBody(req);
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim();
    if (body.role !== undefined) patch.role = String(body.role || '').trim();
    const result = await updateUser(id, patch);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({ action: 'admin_user.updated', entityType: 'admin_user', entityId: id, summary: `Admin user updated: ${result.data.email}` });
    return sendOk(res, 200, result.data, { user: result.data }), true;
  }

  if (userMatch && method === 'DELETE') {
    const id = decodeURIComponent(userMatch[1]);
    if (id === String(req?.authUser?.id || '').trim()) {
      return sendErr(res, 400, 'Cannot delete your own account', { code: 'SELF_DELETE' }), true;
    }
    const result = await deleteUser(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({ action: 'admin_user.deleted', entityType: 'admin_user', entityId: id, summary: `Admin user deleted: ${id}` });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  return false;
}

const manifest = {
  id: 'admin',
  label: 'Admin',
  prefixes: ['/api/admin/platform-users'],
};

module.exports = { handle, manifest };
