'use strict';

/**
 * Bookings and the project's Google Calendar. Booking calendar, slice 5 of 6
 * (SC-913).
 *
 *   googleStatus(scope)                     is a Google Calendar connected, as whom
 *   busyTimes(scope, from, to)              the connected calendar's busy blocks
 *   syncBooking({ kind, booking, ... })     make, move or remove the booking's event
 *
 * NEVER FAILS A BOOKING. By the time syncBooking runs the meeting is saved.
 * Google being unreachable, the token refused, or the connection unreadable
 * all end the same way: the booking stands, is marked `google_sync_status =
 * 'failed'` with the reason, and the Booking Manager shows "No Meet link yet"
 * with a Retry button. Nothing here throws.
 *
 * BUSY TIMES, when Google cannot be asked. The visitor's calendar still shows
 * times (the operator's own bookings are still enforced), and the answer says
 * `googleBusy: 'unavailable'` so the Booking Manager preview can say so. That
 * is a choice: refusing to show any time while Google has a bad minute would
 * take every client's booking page down with it, and a clash with a Google
 * event is something the operator can move, where a visitor turned away is
 * simply gone.
 *
 * THE TOKEN never leaves the server. It is read decrypted from
 * project_connections, renewed if it is within half an hour of expiring
 * (verifySweep.refreshBeforeUse, which stores the renewed one encrypted), used
 * for the one call, and dropped. No log line here carries it.
 */

const projectConnectionsStore = require('./projectConnectionsStore');
const verifySweep = require('./connections/verifySweep');
const google = require('./googleCalendar');

const PROVIDER = 'google_calendar';
/** Rows the resolver would still post with: renewal may be due, nothing refused. */
const LIVE_STATUSES = ['connected', 'expiring'];
const KINDS = ['booked', 'rescheduled', 'cancelled', 'retry'];

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

/**
 * The project's live Google Calendar connection, newest first.
 *   { ok: true, connected: false }                         none connected
 *   { ok: true, connected: true, row }                     one, without its tokens
 *   { ok: false, error }                                   could not tell
 */
async function findConnectionRow(scope, store = projectConnectionsStore) {
  try {
    const listed = await store.listConnections(50, scope);
    if (!listed.ok) return { ok: false, error: `the Google Calendar connection could not be read (${listed.error || listed.status})` };
    const rows = (Array.isArray(listed.data) ? listed.data : []).filter((r) => safeText(r?.provider) === PROVIDER);
    const live = rows.find((r) => LIVE_STATUSES.includes(safeText(r.status)));
    if (live) return { ok: true, connected: true, row: live };
    return { ok: true, connected: false, attention: rows[0] || null };
  } catch (error) {
    return { ok: false, error: `the Google Calendar connection could not be read (${safeText(error?.message) || error})` };
  }
}

/** The live connection WITH a usable access token, renewed first if due. */
async function usableConnection(scope, { store = projectConnectionsStore, refreshBeforeUse = verifySweep.refreshBeforeUse } = {}) {
  const found = await findConnectionRow(scope, store);
  if (!found.ok || !found.connected) return found;
  try {
    const full = await store.getConnection({ provider: PROVIDER, accountId: found.row.accountId }, scope);
    if (!full.ok) return { ok: false, error: `the Google Calendar connection could not be read (${full.error || full.status})` };
    const renewed = await refreshBeforeUse({ connection: full.data, scope });
    const connection = renewed?.connection || full.data;
    if (!safeText(connection.accessToken)) return { ok: false, error: 'the Google Calendar connection has no token stored; connect it again' };
    return { ok: true, connected: true, connection, renewError: renewed && renewed.ok === false ? safeText(renewed.note) : '' };
  } catch (error) {
    return { ok: false, error: `the Google Calendar connection could not be used (${safeText(error?.message) || error})` };
  }
}

/**
 * What the Booking Manager shows: whether the server can connect at all,
 * whether this project has, as whom, and anything needing attention. Never
 * carries a token.
 */
async function googleStatus(scope, deps = {}) {
  const configured = google.isConfigured();
  const found = await findConnectionRow(scope, deps.store);
  if (!found.ok) return { ok: false, status: 500, error: found.error };
  if (!found.connected) {
    const stale = found.attention;
    return {
      ok: true,
      status: 200,
      data: {
        configured,
        connected: false,
        accountLabel: stale ? safeText(stale.accountLabel) : '',
        needsAttention: Boolean(stale),
        lastError: stale ? safeText(stale.lastError) || 'Google no longer accepts this connection. Connect it again.' : '',
      },
    };
  }
  const row = found.row;
  return {
    ok: true,
    status: 200,
    data: {
      configured,
      connected: true,
      accountLabel: safeText(row.accountLabel),
      needsAttention: safeText(row.status) !== 'connected',
      lastError: safeText(row.lastError),
      connectedAt: safeText(row.createdAt),
    },
  };
}

/**
 * The connected calendar's busy blocks between two instants.
 *   { connected: false, busy: [] }                       nothing connected
 *   { connected: true, busy: [...] }                     Google answered
 *   { connected: true, busy: [], unavailable: reason }   Google could not be asked
 */
async function busyTimes(scope, fromMs, toMs, deps = {}) {
  const conn = await usableConnection(scope, deps);
  if (!conn.ok) {
    console.warn(`[booking] Google busy times not read: ${conn.error}`);
    return { connected: true, busy: [], unavailable: conn.error };
  }
  if (!conn.connected) return { connected: false, busy: [] };
  const res = await google.freeBusy(conn.connection.accessToken, fromMs, toMs);
  if (!res.ok) {
    console.warn(`[booking] Google busy times not read: ${res.error}`);
    return { connected: true, busy: [], unavailable: `Google did not answer: ${res.error}` };
  }
  return { connected: true, busy: res.data.busy };
}

function eventFields({ booking, calendar, siteName = '' }) {
  const title = safeText(calendar?.name) && safeText(calendar.name) !== 'Book a meeting' ? safeText(calendar.name) : 'Meeting';
  const lines = [
    `Booked through ${safeText(siteName) || 'your booking calendar'}.`,
    '',
    `${booking.visitorName} <${booking.visitorEmail}>`,
    booking.visitorPhone ? `Phone: ${booking.visitorPhone}` : '',
    booking.visitorNote ? `Note: ${booking.visitorNote}` : '',
  ].filter((line, i) => i < 2 || line);
  return {
    summary: `${title} with ${booking.visitorName}`,
    description: lines.join('\n'),
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    attendee: { email: booking.visitorEmail, name: booking.visitorName },
  };
}

/** A fresh Meet request id: Google makes one link per id. */
function meetRequestId(booking) {
  return `${safeText(booking.id).slice(0, 40)}-${Date.now().toString(36)}`;
}

/**
 * Make, move or remove the booking's Google event, and record the outcome on
 * the booking. Never throws. Returns
 *   { status: 'skipped' | 'synced' | 'failed', meetLink, eventId, error, booking }
 * where `booking` is the row as now stored (or the one passed in, when
 * nothing was written). 'skipped' means no Google Calendar is connected and
 * the booking never had an event, so nothing was recorded.
 *
 *   kind  'booked'       a new booking: make the event, with a Meet link
 *         'rescheduled'  move the event (or make one, if it never got one)
 *         'cancelled'    remove the event
 *         'retry'        the Booking Manager's Retry: finish whatever is missing
 */
async function syncBooking({ kind, booking, calendar, siteName = '', scope }, deps = {}) {
  const store = deps.bookingStore || require('./bookingStore');
  const base = { meetLink: safeText(booking?.meetLink), eventId: safeText(booking?.googleEventId), error: '', booking };
  if (!KINDS.includes(kind) || !booking?.id) return { ...base, status: 'failed', error: `unknown Google step ${JSON.stringify(kind)}` };
  const hadEvent = Boolean(base.eventId);

  const record = async (status, fields = {}) => {
    try {
      const saved = await store.recordGoogleSync(booking.id, { status, ...fields }, scope);
      if (!saved.ok) {
        console.error(`[booking] booking ${booking.id}: could not record its Google step (${status}): ${saved.error}`);
        return null;
      }
      return saved.data;
    } catch (error) {
      console.error(`[booking] booking ${booking.id}: recording its Google step threw: ${safeText(error?.message) || error}`);
      return null;
    }
  };
  const failed = async (error, fields = {}) => {
    console.error(`[booking] booking ${booking.id} (${kind}) Google Calendar: ${error}`);
    const saved = await record('failed', { error, ...fields });
    return { ...base, ...('eventId' in fields ? { eventId: safeText(fields.eventId) } : {}), status: 'failed', error, booking: saved || booking };
  };

  const conn = await usableConnection(scope, deps);
  if (!conn.ok) {
    // Could not tell whether a calendar is connected. A booking that never had
    // an event and has nothing to remove is marked, so the Manager shows it.
    return failed(conn.error);
  }
  if (!conn.connected) {
    if (!hadEvent) return { ...base, status: 'skipped' };
    return failed('Google Calendar is no longer connected, so its event was not changed');
  }
  const token = conn.connection.accessToken;

  try {
    if (kind === 'cancelled') {
      if (!hadEvent) {
        const saved = await record('synced');
        return { ...base, status: 'synced', booking: saved || booking };
      }
      const gone = await google.deleteEvent(token, base.eventId);
      if (!gone.ok) return failed(`the Google Calendar event could not be removed: ${gone.error}`);
      const saved = await record('synced');
      return { ...base, status: 'synced', booking: saved || booking };
    }

    if (hadEvent && kind === 'rescheduled') {
      const moved = await google.patchEvent(token, base.eventId, {
        start: { dateTime: new Date(booking.startsAt).toISOString() },
        end: { dateTime: new Date(booking.endsAt).toISOString() },
        ...(base.meetLink ? {} : { conferenceData: { createRequest: { requestId: meetRequestId(booking), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }),
      });
      if (!moved.ok) return failed(`the Google Calendar event could not be moved: ${moved.error}`);
      const meetLink = google.meetLinkOf(moved.data) || base.meetLink;
      if (!meetLink) return failed('Google moved the event but has not given it a Meet link yet', { meetLink: '' });
      const saved = await record('synced', { meetLink });
      return { ...base, meetLink, status: 'synced', booking: saved || booking };
    }

    if (hadEvent) {
      // A retry on an event that exists: it may have its Meet link by now.
      const read = await google.getEvent(token, base.eventId);
      if (read.ok) {
        const existing = google.meetLinkOf(read.data);
        if (existing) {
          const saved = await record('synced', { meetLink: existing });
          return { ...base, meetLink: existing, status: 'synced', booking: saved || booking };
        }
        const asked = await google.patchEvent(token, base.eventId, {
          conferenceData: { createRequest: { requestId: meetRequestId(booking), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        });
        if (!asked.ok) return failed(`Google would not add a Meet link to the event: ${asked.error}`);
        const meetLink = google.meetLinkOf(asked.data);
        if (!meetLink) return failed('Google has not given the event a Meet link yet');
        const saved = await record('synced', { meetLink });
        return { ...base, meetLink, status: 'synced', booking: saved || booking };
      }
      if (read.status !== 404 && read.status !== 410) return failed(`the Google Calendar event could not be read: ${read.error}`);
      // Deleted on Google's side: make a new one below.
    }

    const made = await google.createEvent(token, { ...eventFields({ booking, calendar, siteName }), requestId: meetRequestId(booking) });
    if (!made.ok) return failed(`the Google Calendar event could not be made: ${made.error}`);
    const eventId = safeText(made.data?.id);
    const meetLink = google.meetLinkOf(made.data);
    if (!meetLink) {
      return failed('Google made the calendar event but has not given it a Meet link yet', { eventId, meetLink: '' });
    }
    const saved = await record('synced', { eventId, meetLink });
    return { ...base, eventId, meetLink, status: 'synced', booking: saved || booking };
  } catch (error) {
    return failed(`Google Calendar step threw: ${safeText(error?.message) || error}`);
  }
}

/** Where to send the operator's browser to connect. Needs a signed-in user. */
function startConnect(scope) {
  if (!safeText(scope?.projectId) || !safeText(scope?.userId)) {
    return { ok: false, status: 401, error: 'Sign in before connecting Google Calendar' };
  }
  const adapter = require('./connections/registry').adapterFor(PROVIDER);
  const started = adapter.authorizeUrl({ projectId: scope.projectId, userId: scope.userId });
  if (!started.ok) return { ok: false, status: started.status || 400, error: started.error, code: started.code };
  return { ok: true, status: 200, data: { authorizeUrl: started.data.authorizeUrl } };
}

/**
 * Withdraw the permission at Google, then forget every stored Google Calendar
 * grant for this project. The stored tokens are deleted even when Google could
 * not confirm the revoke, and the answer says so (`revokedAtProvider: false`
 * with the reason), because a client who pressed Disconnect wants Starcaster
 * to stop holding the key.
 */
async function disconnect(scope, deps = {}) {
  const store = deps.store || projectConnectionsStore;
  const revoke = deps.revokeConnection || verifySweep.revokeConnection;
  const listed = await store.listConnections(50, scope);
  if (!listed.ok) return { ok: false, status: listed.status || 500, error: `Could not read the connection: ${listed.error}` };
  const rows = (Array.isArray(listed.data) ? listed.data : []).filter((r) => safeText(r?.provider) === PROVIDER);
  let removed = 0;
  const notRevoked = [];
  for (const row of rows) {
    const handedBack = await revoke({ provider: PROVIDER, accountId: row.accountId, scope, force: true });
    if (!handedBack.revokedAtProvider) notRevoked.push(safeText(handedBack.reason));
    const gone = await store.deleteConnection({ provider: PROVIDER, accountId: row.accountId }, scope);
    if (!gone.ok && gone.status !== 404) {
      return { ok: false, status: gone.status || 500, error: `Google Calendar could not be disconnected: ${gone.error}` };
    }
    removed += 1;
  }
  return {
    ok: true,
    status: 200,
    data: { disconnected: true, removed, revokedAtProvider: removed > 0 && notRevoked.length === 0, notRevoked },
  };
}

module.exports = {
  PROVIDER,
  googleStatus,
  startConnect,
  disconnect,
  busyTimes,
  syncBooking,
  eventFields,
  // Exported for the tests.
  findConnectionRow,
  usableConnection,
};
