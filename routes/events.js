'use strict';

/**
 * Event Calendar API.
 *
 * Mirrors routes/blog.js: a thin layer over lib/eventsStore.js that unwraps
 * the request, scopes it to the project, and logs what changed.
 *
 * Auth is decided centrally in routes/index.js. These routes carry no public
 * exemption yet — the admin manager is the only caller, and it runs behind
 * either a platform session or a project-admin one. The public calendar
 * module (a later ticket) is what will need the published-only read exemption
 * in lib/projectAdminApiAuth.js, and that is a security decision to make with
 * the module that needs it, not in advance.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const {
  listEvents, getEvent, getEventBySlug, createEvent, updateEvent, deleteEvent,
} = require('../lib/eventsStore');
const { logActivity } = require('../lib/activityLog');

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

/**
 * The writable fields, in one list.
 *
 * Create and update read the SAME map, so a field added to one is never
 * missing from the other — the split lists in routes/blog.js are 30 lines of
 * near-duplicate where a typo goes unnoticed.
 */
const TEXT_FIELDS = [
  'title', 'slug', 'status', 'description', 'excerpt',
  'imageUrl', 'imageAlt', 'url', 'timezone',
  'locationName', 'locationAddress', 'locationUrl',
  'organizerName', 'organizerContact',
  'seoTitle', 'seoDescription',
];
const DATE_FIELDS = ['startsAt', 'endsAt'];
const BOOL_FIELDS = ['allDay', 'featured'];

function readBool(value) {
  if (typeof value === 'boolean') return value;
  return String(value || '').trim().toLowerCase() === 'true';
}

/** Only the keys the caller actually sent — so a PATCH never blanks a field. */
function readEventPatch(body) {
  const patch = {};
  for (const key of TEXT_FIELDS) {
    if (body[key] !== undefined) patch[key] = String(body[key] || '').trim();
  }
  // description is rich HTML: trimming is fine, but it is not a one-line field
  // and must not be collapsed further.
  if (body.description !== undefined) patch.description = String(body.description || '');
  for (const key of DATE_FIELDS) {
    if (body[key] !== undefined) patch[key] = body[key] || null;
  }
  for (const key of BOOL_FIELDS) {
    if (body[key] !== undefined) patch[key] = readBool(body[key]);
  }
  return patch;
}

function eventSummary(event) {
  return `"${String(event?.title || '').trim() || 'Untitled event'}"`;
}

async function handle(req, res, pathname, method) {
  const urlObj = getUrlObj(req);

  if (pathname === '/api/events' && method === 'GET') {
    const params = urlObj.searchParams;
    const status = String(params.get('status') || '').trim() || undefined;
    const limit  = parseInt(params.get('limit') || '50', 10) || 50;
    const events = await listEvents({ status, limit }, requestScope(req));
    return sendOk(res, 200, events, { events }, { total: events.length, limit }), true;
  }

  if (pathname === '/api/events' && method === 'POST') {
    const body = await parseJsonBody(req);
    const title = String(body.title || '').trim();
    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    const created = await createEvent({ ...readEventPatch(body), title }, requestScope(req));
    if (!created) return sendErr(res, 500, 'Failed to create event'), true;
    logActivity({
      action: 'event.created', entityType: 'event', entityId: created.id,
      summary: `Event created: ${eventSummary(created)}`,
    });
    return sendOk(res, 201, created, { event: created }), true;
  }

  const eventMatch = pathname.match(/^\/api\/events\/([^/]+)$/);

  if (eventMatch && method === 'GET') {
    const id = decodeURIComponent(eventMatch[1]);
    const bySlug = String(urlObj.searchParams.get('by') || '').trim() === 'slug';
    const event = bySlug
      ? await getEventBySlug(id, requestScope(req))
      : await getEvent(id, requestScope(req));
    if (!event) return sendErr(res, 404, 'Event not found', { code: 'NOT_FOUND' }), true;
    // A slug read with no session is the public path (a visitor on a tenant
    // site): it may only ever see a published event. Draft and cancelled
    // events are 404 there, exactly as an unpublished blog post is.
    const isPublicSlugRead = bySlug && !req.authUser;
    if (isPublicSlugRead && event.status !== 'published') {
      return sendErr(res, 404, 'Event not found', { code: 'NOT_FOUND' }), true;
    }
    return sendOk(res, 200, event, { event }), true;
  }

  if (eventMatch && method === 'PUT') {
    const id = decodeURIComponent(eventMatch[1]);
    const body = await parseJsonBody(req);
    const updated = await updateEvent(id, readEventPatch(body), requestScope(req));
    if (!updated) return sendErr(res, 404, 'Event not found', { code: 'NOT_FOUND' }), true;
    logActivity({
      action: 'event.updated', entityType: 'event', entityId: id,
      summary: `Event updated: ${eventSummary(updated)}`,
    });
    return sendOk(res, 200, updated, { event: updated }), true;
  }

  if (eventMatch && method === 'DELETE') {
    const id = decodeURIComponent(eventMatch[1]);
    const deleted = await deleteEvent(id, requestScope(req));
    if (!deleted) return sendErr(res, 404, 'Event not found', { code: 'NOT_FOUND' }), true;
    logActivity({
      action: 'event.deleted', entityType: 'event', entityId: id,
      summary: `Event deleted: ${eventSummary(deleted)}`,
    });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  return false;
}

const manifest = {
  id:       'events',
  label:    'Events',
  prefixes: ['/api/events'],
};

module.exports = { handle, manifest, readEventPatch };
