'use strict';

/**
 * Event categories API — the venues / program types the calendar colours
 * events by. A thin layer over lib/eventCategoriesStore.js.
 *
 * The LIST is public (lib/projectAdminApiAuth.js): a visitor's calendar needs
 * the names and colours to draw its legend, and they are shown on the page
 * anyway. A caller with no session gets only id, name, colour and order.
 * Every write needs a session.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const {
  listEventCategories, createEventCategory, updateEventCategory, deleteEventCategory, toPublic, safeColor,
} = require('../lib/eventCategoriesStore');
const { logActivity } = require('../lib/activityLog');

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

/**
 * Only the keys sent, refused when unusable. A colour that is not `#rrggbb`
 * is a 400, not a quiet blank: the admin picked a colour and should learn it
 * did not save.
 */
function readCategoryPatch(body, { requireName }) {
  const patch = {};
  if (body.name !== undefined || requireName) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'A venue or category needs a name.' };
    patch.name = name;
  }
  if (body.color !== undefined) {
    const color = String(body.color || '').trim();
    if (color && !safeColor(color)) return { error: `"${color}" is not a colour (expected #rrggbb).` };
    patch.color = color;
  }
  if (body.sortOrder !== undefined) {
    const order = Number(body.sortOrder);
    if (!Number.isFinite(order)) return { error: 'Sort order must be a number.' };
    patch.sortOrder = Math.trunc(order);
  }
  return { patch };
}

/** A signed-in admin sees the whole record; a visitor sees what the legend paints. */
function categoriesForCaller(list, authUser) {
  return authUser ? list : list.map(toPublic);
}

async function handle(req, res, pathname, method) {
  if (pathname === '/api/event-categories' && method === 'GET') {
    const categories = categoriesForCaller(await listEventCategories(requestScope(req)), req.authUser);
    return sendOk(res, 200, categories, { categories }), true;
  }

  if (pathname === '/api/event-categories' && method === 'POST') {
    const { patch, error } = readCategoryPatch(await parseJsonBody(req), { requireName: true });
    if (error) return sendErr(res, 400, error, { code: 'VALIDATION_ERROR' }), true;
    const created = await createEventCategory(patch, requestScope(req));
    if (!created) return sendErr(res, 500, 'Failed to create the category'), true;
    logActivity({ action: 'event_category.created', entityType: 'event_category', entityId: created.id, summary: `Event category created: "${created.name}"` });
    return sendOk(res, 201, created, { category: created }), true;
  }

  const match = pathname.match(/^\/api\/event-categories\/([^/]+)$/);

  if (match && method === 'PUT') {
    const id = decodeURIComponent(match[1]);
    const { patch, error } = readCategoryPatch(await parseJsonBody(req), { requireName: false });
    if (error) return sendErr(res, 400, error, { code: 'VALIDATION_ERROR' }), true;
    const updated = await updateEventCategory(id, patch, requestScope(req));
    if (!updated) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'event_category.updated', entityType: 'event_category', entityId: id, summary: `Event category updated: "${updated.name}"` });
    return sendOk(res, 200, updated, { category: updated }), true;
  }

  if (match && method === 'DELETE') {
    const id = decodeURIComponent(match[1]);
    const deleted = await deleteEventCategory(id, requestScope(req));
    if (!deleted) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'event_category.deleted', entityType: 'event_category', entityId: id, summary: `Event category deleted: "${deleted.name}"` });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  return false;
}

const manifest = { id: 'eventCategories', label: 'Event categories', prefixes: ['/api/event-categories'] };

module.exports = { handle, manifest, readCategoryPatch, categoriesForCaller };
