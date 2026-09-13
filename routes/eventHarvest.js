'use strict';

/**
 * Schedule harvest API — read a club's flyer into proposed events
 * (task 86bbztj0e). It proposes; it never writes. The Event Manager's review
 * table creates what Dane keeps through /api/events and /api/event-categories.
 *
 * Alphire staff only (Dane, 2026-09-12). Every upload bills Alphire's model
 * account, so a club's own admins are refused. But the Event Manager only
 * WORKS on the club's admin page, behind a club admin login — a platform
 * session never reaches a rendered Event Manager (Builder shows its settings;
 * Builder Preview strips admin modules). So "staff" is decided per request:
 *
 *   - a platform session is staff;
 *   - a club admin session is staff only when its email also has a StarCaster
 *     platform account. Delray's staff have none.
 *
 * Known limit: club admin emails are not verified, so a club admin who can add
 * admins could add one under a staff address. That buys AI spend only — the
 * route reads nothing a club admin cannot already read — and the rate limit
 * caps it. A lookup that fails refuses; it never grants.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { listEvents } = require('../lib/eventsStore');
const { listEventCategories } = require('../lib/eventCategoriesStore');
const {
  HarvestError, isAvailable, extractSchedule, mergeSessions, matchExisting, matchVenues, suggestTimeZone,
} = require('../lib/eventHarvest');
const { logActivity } = require('../lib/activityLog');
const { findUserByEmail } = require('../lib/authStore');

/** Is this signed-in user Alphire staff? `find` is injectable for tests. */
async function isAlphireStaff(authUser, find = findUserByEmail) {
  if (!authUser) return false;
  if (!authUser.isProjectAdmin) return true;
  const email = String(authUser.email || '').trim();
  if (!email) return false;
  try {
    return Boolean(await find(email));
  } catch {
    return false;
  }
}

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/event-harvest')) return false;

  if (!req.authUser) {
    return sendErr(res, 401, 'Sign in to read schedules.', { code: 'NOT_AUTHENTICATED' }), true;
  }
  const staff = await isAlphireStaff(req.authUser);

  // Answered for everyone signed in, so the Event Manager can hide its button
  // without treating a refusal as an error.
  if (pathname === '/api/event-harvest/available' && method === 'GET') {
    return sendOk(res, 200, { available: staff && isAvailable() }), true;
  }

  if (!staff) {
    return sendErr(res, 403, 'Reading schedules with AI is available to Alphire staff only.', { code: 'STAFF_ONLY' }), true;
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
      const matched = matchVenues(extraction.venues, categories, mergeSessions(extraction.sessions));
      const series = matchExisting(matched.series, events);
      const venues = matched.venues;
      logActivity({
        action: 'event.harvest', entityType: 'event', entityId: '',
        summary: `Schedule read from "${String(body.fileName || 'upload').slice(0, 80)}": ${extraction.sessions.length} lines, ${series.length} programs`,
      });
      return sendOk(res, 200, {
        weekStart: extraction.weekStart,
        venues,
        series,
        timeZone: suggestTimeZone(events),
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

module.exports = { handle, manifest, isAlphireStaff };
