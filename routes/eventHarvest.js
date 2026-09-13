'use strict';

/**
 * Schedule harvest API — read a club's flyer into proposed events
 * (task 86bbztj0e). It proposes; it never writes. The Event Manager's review
 * table creates what Dane keeps through /api/events and /api/event-categories.
 *
 * Platform login only: `/api/event-harvest` is in
 * PROJECT_ADMIN_SESSION_DENY_PREFIXES, so a tenant admin session is never
 * turned into auth here, and the handler refuses anything without a platform
 * user as well — two locks, because the first one being edited away would
 * otherwise open a spend path silently.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { listEvents } = require('../lib/eventsStore');
const { listEventCategories } = require('../lib/eventCategoriesStore');
const {
  HarvestError, isAvailable, extractSchedule, mergeSessions, matchExisting, matchVenues,
} = require('../lib/eventHarvest');
const { logActivity } = require('../lib/activityLog');

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/event-harvest')) return false;

  if (!req.authUser) {
    return sendErr(res, 401, 'Sign in to StarCaster to read schedules.', { code: 'NOT_AUTHENTICATED' }), true;
  }

  if (pathname === '/api/event-harvest/available' && method === 'GET') {
    return sendOk(res, 200, { available: isAvailable() }), true;
  }

  if (pathname === '/api/event-harvest/extract' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'events.harvest')) return true;
    const scope = requestScope(req);
    if (!scope.projectId) return sendErr(res, 400, 'Choose a project first.', { code: 'NO_PROJECT' }), true;
    try {
      const body = await parseJsonBody(req);
      const extraction = await extractSchedule(body, scope);
      const [events, categories] = await Promise.all([
        listEvents({ limit: 500 }, scope),
        listEventCategories(scope),
      ]);
      const series = matchExisting(mergeSessions(extraction.sessions), events);
      const venues = matchVenues(extraction.venues, categories);
      logActivity({
        action: 'event.harvest', entityType: 'event', entityId: '',
        summary: `Schedule read from "${String(body.fileName || 'upload').slice(0, 80)}": ${extraction.sessions.length} lines, ${series.length} programs`,
      });
      return sendOk(res, 200, {
        weekStart: extraction.weekStart,
        venues,
        series,
        lineCount: extraction.sessions.length,
        dropped: extraction.dropped,
      }), true;
    } catch (err) {
      if (err instanceof HarvestError) return sendErr(res, err.status, err.message, { code: err.code }), true;
      throw err;
    }
  }

  return sendErr(res, 404, 'Not found', { code: 'NOT_FOUND' }), true;
}

const manifest = { id: 'eventHarvest', label: 'Schedule harvest', prefixes: ['/api/event-harvest'] };

module.exports = { handle, manifest };
