'use strict';

/**
 * Booking reminders (SC-914, slice 6 of 6).
 *
 *   GET   /api/booking/calendars/:id/reminders   the calendar's reminder settings, and
 *                                                the reminders that failed every attempt
 *   PATCH /api/booking/calendars/:id/reminders   save { enabled, offsetsMinutes, notifyOwner };
 *                                                answers with what the database now holds
 *   GET|POST /api/booking/reminders/run-due      Vercel Cron only: send what is due
 *
 * Registered in routes/index.js AHEAD of routes/booking.js, which would
 * otherwise answer the /calendars/:id/reminders paths with a 405.
 *
 * The settings endpoints are the operator's, scoped to the active project like
 * the rest of /api/booking. run-due is CRON ONLY: it reads every project's
 * meetings at once, so a session is deliberately not enough. `req.cronPublish`
 * is set in routes/index.js only for a CRON_PATHS path carrying Vercel's cron
 * header or the CRON_SECRET bearer token. Vercel's scheduler sends GET.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const store = require('../lib/bookingRemindersStore');
const runDue = require('../lib/bookingRemindersRunDue');

const RUN_DUE = '/api/booking/reminders/run-due';

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
}

function sendResult(res, result) {
  if (!result.ok) {
    const status = result.status || 500;
    return sendErr(res, status, result.error || 'The reminder settings could not be read', {
      code: status === 404 ? 'NOT_FOUND' : status === 400 ? 'INVALID' : status === 409 ? 'CONFLICT' : undefined,
    });
  }
  return sendOk(res, 200, result.data);
}

async function answerRunDue(res) {
  const result = await runDue.runDue();
  if (!result.ok) {
    console.error(`[booking-reminders] run-due REFUSED: ${result.error}`);
    return sendErr(res, result.status || 500, result.error);
  }
  const { looked, truncated, sent, failed, skipped, leftForNextPass } = result.data;
  // Logged on every run, the quiet ones too: "nothing was due" and "never ran"
  // must not look the same in the log.
  console.log(`[booking-reminders] run-due looked=${looked} sent=${sent.length} failed=${failed.length} `
    + `skipped=${skipped.length} left_for_next_pass=${leftForNextPass}${truncated ? ' TRUNCATED: more meetings this week than one pass reads' : ''}`);
  for (const item of failed) {
    console.error(`[booking-reminders] run-due FAILED project=${item.projectId} booking=${item.bookingId} recipient=${item.recipient || '-'}: ${item.error}`);
  }
  return sendOk(res, 200, result.data);
}

/** true when this module answered the request. */
async function handle(req, res, pathname, method) {
  if (pathname === RUN_DUE) {
    if (method !== 'GET' && method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    if (!req.cronPublish) {
      return sendErr(res, 403, 'Booking reminders are sent on a schedule only', { code: 'CRON_ONLY' }), true;
    }
    await answerRunDue(res);
    return true;
  }

  const match = pathname.match(/^\/api\/booking\/calendars\/([^/]+)\/reminders$/);
  if (!match) return false;
  const scope = requestScope(req);
  if (!scope.projectId) {
    sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' });
    return true;
  }
  const calendarId = decodeURIComponent(match[1]);

  if (method === 'GET') {
    const settings = await store.getReminderSettings(calendarId, scope);
    if (!settings.ok) return sendResult(res, settings), true;
    const problems = await store.listReminderProblems(50, calendarId, scope);
    // "Could not read the failures" must never read as "none failed".
    if (!problems.ok) {
      sendErr(res, problems.status || 500, `Could not read which reminders failed: ${problems.error}`);
      return true;
    }
    sendOk(res, 200, { settings: settings.data, problems: problems.data });
    return true;
  }

  if (method === 'PATCH' || method === 'PUT') {
    if (checkEndpointLimit(req, res, 'booking.write')) return true;
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (error) {
      sendErr(res, 400, error.message || 'The request body could not be read', { code: 'INVALID' });
      return true;
    }
    sendResult(res, await store.saveReminderSettings(calendarId, body, scope));
    return true;
  }

  sendErr(res, 405, 'Use GET or PATCH', { code: 'METHOD_NOT_ALLOWED' });
  return true;
}

module.exports = {
  handle,
  manifest: {
    id: 'booking-reminders',
    label: 'Booking reminders',
    // /api/booking/calendars/:id/reminders sits under booking's /api/booking prefix.
    prefixes: ['/api/booking/reminders'],
  },
};
