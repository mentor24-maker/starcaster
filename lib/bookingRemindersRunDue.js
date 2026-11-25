'use strict';

/**
 * Booking reminders, the scheduled pass (SC-914, slice 6 of 6). Vercel Cron
 * calls GET /api/booking/reminders/run-due every five minutes; this finds
 * every booked meeting coming up in any project, works out which reminder is
 * due (lib/bookingReminders.js dueOffset), and sends it.
 *
 * SENT ONCE. Each reminder is CLAIMED in the database before it is sent
 * (lib/bookingRemindersStore.js claimReminder), so running the pass twice in
 * a row, or two passes at once, sends it once. A failed send is retried on
 * the next pass, up to three attempts in all; after that it stays "failed"
 * and the Booking Manager shows it.
 *
 * NEVER TO A CANCELLED MEETING. The read only finds booked meetings, and the
 * booking is read AGAIN after the claim and just before sending: a meeting
 * cancelled (or moved) in between is marked skipped, not reminded.
 *
 * The visitor's reminder and the site owner's (when the Booking Manager asks
 * for one) are separate reminders, claimed and retried separately, so a
 * failure on one side never re-sends the other.
 *
 * Every failure is reported in the pass's answer, never skipped quietly:
 * "nothing was due" and "could not look" must not print the same summary.
 * Dependencies are required at CALL time so the node suite can swap them.
 */

const MINUTE = 60000;
/** The furthest ahead any reminder can open (a week), plus a little room. */
const HORIZON_MS = (7 * 24 * 60 + 60) * MINUTE;
/** Emails sent in one pass. Anything left over is still due five minutes later. */
const MAX_SENDS_PER_PASS = 60;

/** A project's name, address and alert emails, read once per pass. */
function projectReader() {
  const cache = new Map();
  return async function read(projectId) {
    if (cache.has(projectId)) return cache.get(projectId);
    const { getPublicProjectById } = require('./projectsStore');
    const { getContactAlertEmails } = require('./projectSiteSettingsStore');
    const { getAppPublicOrigin } = require('./appOrigin');
    const project = await getPublicProjectById(projectId).catch(() => null);
    const name = String(project?.data?.name || '').trim();
    const domain = String(project?.data?.domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    // The visitor's link opens on the client's own site when it has one;
    // otherwise on the app's address, where the manage page also answers.
    const origin = domain ? `https://${domain}` : getAppPublicOrigin(null);
    let team = [];
    let teamError = '';
    try {
      team = await getContactAlertEmails(projectId);
    } catch (error) {
      teamError = error?.message || String(error);
    }
    const value = { name, origin, team: Array.isArray(team) ? team : [], teamError };
    cache.set(projectId, value);
    return value;
  };
}

/**
 * One pass. `options.now` (ms) is the clock, for tests; `options.maxSends`
 * the per-pass ceiling.
 *
 * Returns `{ ok, status, data: { looked, truncated, sent, failed, skipped, leftForNextPass } }`.
 * `ok` is false only when the meetings could not be read at all.
 */
async function runDue(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxSends = Number.isInteger(options.maxSends) && options.maxSends >= 0 ? options.maxSends : MAX_SENDS_PER_PASS;
  const store = require('./bookingRemindersStore');
  const rules = require('./bookingReminders');
  const { manageLink, contactLink } = require('./bookingEmails');
  const { sendEmail } = require('./mailer');

  const upcoming = await store.listUpcomingBookings({ now, horizonMs: HORIZON_MS });
  if (!upcoming.ok) {
    return { ok: false, status: upcoming.status || 500, error: `Could not read the upcoming meetings: ${upcoming.error || 'unknown error'}` };
  }
  const { bookings, truncated } = upcoming.data;
  // `truncated`: more meetings in the next week than one pass reads. The
  // soonest were read, which are the ones whose reminders are due first.
  const report = { looked: bookings.length, truncated, sent: [], failed: [], skipped: [], leftForNextPass: 0 };
  if (!bookings.length) return { ok: true, status: 200, data: report };

  const calendars = await store.readCalendarsForRun(bookings.map((b) => b.calendarId));
  if (!calendars.ok) {
    // Most likely docs/SQL/booking_reminders.sql has not run (no
    // reminder_settings column). Loud, so it is not read as "nothing due".
    return { ok: false, status: calendars.status || 500, error: `Could not read the booking calendars' reminder settings: ${calendars.error || 'unknown error'}` };
  }

  const readProject = projectReader();
  let budget = maxSends;

  for (const booking of bookings) {
    const calendar = calendars.data.get(booking.calendarId);
    const where = { projectId: booking.projectId, bookingId: booking.id };
    if (!calendar || calendar.projectId !== booking.projectId) {
      report.failed.push({ ...where, recipient: '', error: 'its booking calendar could not be found in its project' });
      continue;
    }
    if (!calendar.reminders.enabled) continue;
    const offset = rules.dueOffset({
      startsAt: booking.startsAt,
      madeAt: rules.madeAtOf(booking),
      offsetsMinutes: calendar.reminders.offsetsMinutes,
      now,
    });
    if (offset === null) continue;

    const recipients = calendar.reminders.notifyOwner ? ['visitor', 'owner'] : ['visitor'];
    for (const recipient of recipients) {
      if (budget <= 0) {
        report.leftForNextPass += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const claim = await store.claimReminder({ booking, offsetMinutes: offset, recipient, now });
      if (!claim.ok) {
        report.failed.push({ ...where, recipient, error: `could not claim the reminder: ${claim.error || 'unknown error'}` });
        continue;
      }
      if (!claim.data) continue; // sent already, given up on, or another pass has it
      budget -= 1;
      const guard = { guardStatus: 'sending', guardAttempts: claim.data.attempt };
      const record = async (status, error = '') => {
        const done = await store.finishReminder(claim.data.id, { status, error }, guard);
        if (!done.ok) console.error(`[booking-reminders] booking ${booking.id} ${recipient}: could not record "${status}": ${done.error}`);
      };

      // Read it again: cancelled or moved since the list was read gets nothing.
      // eslint-disable-next-line no-await-in-loop
      const fresh = await store.readBookingNow(booking);
      if (!fresh.ok) {
        // eslint-disable-next-line no-await-in-loop
        await record('failed', `could not check the meeting was still booked: ${fresh.error || 'unknown error'}`);
        report.failed.push({ ...where, recipient, error: 'could not check the meeting was still booked' });
        continue;
      }
      if (!fresh.data || fresh.data.status !== 'booked' || fresh.data.startsAt !== booking.startsAt) {
        const why = !fresh.data || fresh.data.status !== 'booked' ? 'the meeting was cancelled' : 'the meeting was moved';
        // eslint-disable-next-line no-await-in-loop
        await record('skipped', why);
        report.skipped.push({ ...where, recipient, why });
        continue;
      }

      let error = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        const project = await readProject(booking.projectId);
        const emails = rules.buildReminderEmails({
          booking,
          calendar,
          siteName: project.name,
          manageUrl: manageLink(project.origin, booking.projectId, booking.manageToken),
          contactUrl: contactLink(project.origin, booking.crmContactId),
        });
        if (recipient === 'visitor') {
          // eslint-disable-next-line no-await-in-loop
          const mail = await sendEmail({
            to: booking.visitorEmail,
            fromName: project.name || undefined,
            replyTo: project.team.length ? project.team : undefined,
            ...emails.visitor,
          });
          if (!mail?.ok) error = `the visitor was not emailed: ${mail?.error || 'the mail service refused it'}`;
        } else if (!project.team.length) {
          error = project.teamError
            ? `the site owner was not emailed: the Contact Alert Email could not be read (${project.teamError})`
            : 'the site owner was not emailed: no Contact Alert Email is set on the Settings page';
        } else {
          // eslint-disable-next-line no-await-in-loop
          const mail = await sendEmail({
            to: project.team,
            fromName: project.name || undefined,
            replyTo: booking.visitorEmail,
            ...emails.operator,
          });
          if (!mail?.ok) error = `the site owner was not emailed: ${mail?.error || 'the mail service refused it'}`;
        }
      } catch (e) {
        error = `the reminder could not be prepared: ${e?.message || e}`;
      }

      // eslint-disable-next-line no-await-in-loop
      await record(error ? 'failed' : 'sent', error);
      if (error) report.failed.push({ ...where, recipient, attempt: claim.data.attempt, error });
      else report.sent.push({ ...where, recipient, offsetMinutes: offset });
    }
  }

  return { ok: true, status: 200, data: report };
}

module.exports = { HORIZON_MS, MAX_SENDS_PER_PASS, runDue };
