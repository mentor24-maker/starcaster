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
async function usableConnection(scope, { store = projectConnectionsStore, refreshBeforeUse = verifySweep.refreshBeforeUse, now = Date.now } = {}) {
  const nowMs = () => Number(now()) || Date.now();
  const found = await findConnectionRow(scope, store);
  if (!found.ok || !found.connected) return found;
  try {
    const full = await store.getConnection({ provider: PROVIDER, accountId: found.row.accountId }, scope);
    if (!full.ok) return { ok: false, error: `the Google Calendar connection could not be read (${full.error || full.status})` };
    const renewed = await refreshBeforeUse({ connection: full.data, scope });
    const connection = renewed?.connection || full.data;
    if (!safeText(connection.accessToken)) return { ok: false, error: 'the Google Calendar connection has no token stored; connect it again' };
    if (renewed && renewed.ok === false) {
      // A token still inside its hour keeps working, so carry on with it. One
      // already past its expiry would only earn Google's vague "Invalid
      // Credentials", so say what actually went wrong instead (review, SC-913).
      const expiresMs = Date.parse(safeText(connection.expiresAt));
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs()) {
        const why = safeText(renewed.note) || 'Google refused';
        return {
          ok: false,
          error: renewed.judged
            ? `Google no longer accepts this Google Calendar connection (${why}); connect Google Calendar again in the Booking Manager`
            : `Google could not be reached to renew the Google Calendar connection (${why}); it will be tried again`,
        };
      }
    }
    return { ok: true, connected: true, connection };
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
  if (!conn.connected) {
    // Connected once and Google has since refused it: the operator's Google
    // busy times are NOT being hidden, which is exactly what the preview must
    // warn about, never "no Google connected" (review, SC-913 round 2).
    if (conn.attention) {
      const why = safeText(conn.attention.lastError);
      return {
        connected: true,
        busy: [],
        unavailable: `Google no longer accepts the Google Calendar connection; connect it again${why ? ` (${why})` : ''}`,
      };
    }
    return { connected: false, busy: [] };
  }
  const res = await google.freeBusy(conn.connection.accessToken, fromMs, toMs);
  if (!res.ok) {
    console.warn(`[booking] Google busy times not read: ${res.error}`);
    return { connected: true, busy: [], unavailable: `Google did not answer: ${res.error}` };
  }
  return { connected: true, busy: res.data.busy };
}

/**
 * Busy blocks with this booking's own time taken out of them, for moving a
 * meeting: its own Google event is busy on the calendar too, and must not stop
 * the visitor moving it by a quarter hour.
 *
 * Interval subtraction, never an exact-match filter (review, SC-913 round 1).
 * Google's free/busy clips each block to the window that was asked about and
 * joins back-to-back events into one block, so the meeting's own event comes
 * back as "busy 10:15-10:30" when the question was 10:15-10:45, or as one
 * 10:00-11:00 block when another event follows it. Only the meeting's own
 * start-to-end is removed; anything either side of it stays busy.
 *
 * A booking that never got a Google event owns nothing on that calendar, so
 * its busy blocks are someone else's and are left whole.
 */
function busyWithoutBooking(busy, booking) {
  const list = Array.isArray(busy) ? busy : [];
  if (!safeText(booking?.googleEventId)) return list;
  const own = { s: Date.parse(booking.startsAt), e: Date.parse(booking.endsAt) };
  if (!Number.isFinite(own.s) || !Number.isFinite(own.e) || own.e <= own.s) return list;
  const out = [];
  for (const block of list) {
    const s = Date.parse(block?.startsAt);
    const e = Date.parse(block?.endsAt);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= own.s || s >= own.e) {
      out.push(block);
      continue;
    }
    if (s < own.s) out.push({ startsAt: new Date(s).toISOString(), endsAt: new Date(own.s).toISOString() });
    if (e > own.e) out.push({ startsAt: new Date(own.e).toISOString(), endsAt: new Date(e).toISOString() });
  }
  return out;
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
 * The Google event id for a booking, chosen by Starcaster rather than Google,
 * so making the event is safe to repeat (review, SC-913 round 2). When Google
 * makes the event but the time limit fires before its answer arrives, no id
 * was saved; Retry then asks to make the SAME id again, Google answers "that
 * already exists", and the event it already made is used instead of a second
 * event with a second Meet link.
 *
 * Google's rule for an id it is handed: 5-1024 characters from 0-9 and a-v
 * (base32hex). A sha256 in hex is only 0-9a-f, inside that set. `generation`
 * makes a new id for a booking whose first event was deleted on Google's side:
 * Google keeps a deleted event's id reserved, so the old one cannot be reused.
 */
function googleEventIdFor(booking, generation = 0) {
  const hash = require('crypto').createHash('sha256').update(`starcaster-booking:${safeText(booking?.id)}`).digest('hex').slice(0, 40);
  return generation ? `sc${hash}${Number(generation).toString(32)}` : `sc${hash}`;
}

/** True when a Google event time (`{ dateTime }`) is the same instant as an ISO time. */
function sameInstant(googleTime, iso) {
  const a = Date.parse(safeText(googleTime?.dateTime));
  const b = Date.parse(safeText(iso));
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** An event Google returned that still stands: not deleted ("cancelled" on Google). */
function liveEvent(read) {
  return Boolean(read?.ok && read.data && safeText(read.data.status) !== 'cancelled');
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
 *         'retry'        the Booking Manager's Retry: make Google match the
 *                        booking, whatever step failed before. A cancelled
 *                        booking's event is removed; a booked one's event is
 *                        made, moved to the booking's time, and given a Meet
 *                        link, as each is needed (review, SC-913 round 2: a
 *                        Retry that only looked for a Meet link reported a
 *                        failed MOVE as fixed with the event at the old time).
 */
async function syncBooking({ kind, booking, calendar, siteName = '', scope }, deps = {}) {
  const store = deps.bookingStore || require('./bookingStore');
  const base = { meetLink: safeText(booking?.meetLink), eventId: safeText(booking?.googleEventId), error: '', booking };
  if (!KINDS.includes(kind) || !booking?.id) return { ...base, status: 'failed', error: `unknown Google step ${JSON.stringify(kind)}` };
  const hadEvent = Boolean(base.eventId);
  const removing = kind === 'cancelled' || (kind === 'retry' && safeText(booking.status) === 'cancelled');

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
  const failed = async (error, fields = {}, fallback = booking) => {
    console.error(`[booking] booking ${booking.id} (${kind}) Google Calendar: ${error}`);
    const saved = await record('failed', { error, ...fields });
    return {
      ...base,
      ...('eventId' in fields ? { eventId: safeText(fields.eventId) } : {}),
      ...('meetLink' in fields ? { meetLink: safeText(fields.meetLink) } : {}),
      status: 'failed',
      error,
      booking: saved || fallback,
    };
  };
  const synced = async (fields = {}) => {
    const saved = await record('synced', fields);
    return {
      ...base,
      ...('eventId' in fields ? { eventId: safeText(fields.eventId) } : {}),
      ...('meetLink' in fields ? { meetLink: safeText(fields.meetLink) } : {}),
      status: 'synced',
      booking: saved || booking,
    };
  };

  const conn = await usableConnection(scope, deps);
  if (!conn.ok) {
    // Could not tell whether a calendar is connected. A booking that never had
    // an event and has nothing to remove is marked, so the Manager shows it.
    return failed(conn.error);
  }
  if (!conn.connected) {
    if (conn.attention && !removing) {
      // Connected once, and Google has since refused it: the booking says so,
      // so its row in the Booking Manager names the fix rather than nothing.
      const why = safeText(conn.attention.lastError);
      return failed(`Google no longer accepts the Google Calendar connection; connect Google Calendar again in the Booking Manager${why ? ` (${why})` : ''}`);
    }
    if (!hadEvent) return { ...base, status: 'skipped' };
    return failed('Google Calendar is no longer connected, so its event was not changed');
  }
  const token = conn.connection.accessToken;
  const meetRequest = () => ({ createRequest: { requestId: meetRequestId(booking), conferenceSolutionKey: { type: 'hangoutsMeet' } } });

  /**
   * An event that stands on Google: bring it to the booking's time and give it
   * a Meet link, as either is needed, and record it as the booking's event.
   */
  const finishExisting = async (eventId, event) => {
    const recorded = eventId === base.eventId ? {} : { eventId };
    const patch = {};
    if (!sameInstant(event?.start, booking.startsAt) || !sameInstant(event?.end, booking.endsAt)) {
      patch.start = { dateTime: new Date(booking.startsAt).toISOString() };
      patch.end = { dateTime: new Date(booking.endsAt).toISOString() };
    }
    let meetLink = google.meetLinkOf(event);
    if (!meetLink) patch.conferenceData = meetRequest();
    if (Object.keys(patch).length) {
      const changed = await google.patchEvent(token, eventId, patch);
      if (!changed.ok) {
        const what = patch.start ? 'moved' : 'given a Meet link';
        return failed(`the Google Calendar event could not be ${what}: ${changed.error}`, recorded);
      }
      meetLink = google.meetLinkOf(changed.data) || meetLink;
    }
    if (!meetLink) return failed('Google has the calendar event but has not given it a Meet link yet', { ...recorded, meetLink: '' });
    return synced({ ...recorded, meetLink });
  };

  try {
    if (removing) {
      if (!hadEvent) return synced();
      const gone = await google.deleteEvent(token, base.eventId);
      if (!gone.ok) return failed(`the Google Calendar event could not be removed: ${gone.error}`);
      return synced();
    }

    let goneOnGoogle = false;
    if (hadEvent) {
      const read = await google.getEvent(token, base.eventId);
      if (liveEvent(read)) return finishExisting(base.eventId, read.data);
      if (!read.ok && read.status !== 404 && read.status !== 410) {
        const what = kind === 'rescheduled' ? 'could not be moved' : 'could not be read';
        return failed(`the Google Calendar event ${what}: ${read.error}`);
      }
      // Deleted on Google's side, and its Meet link with it: make a new one
      // below. Never email the dead link (review, SC-913).
      goneOnGoogle = true;
    }

    // An event gone from Google takes its id and Meet link with it.
    const stale = goneOnGoogle ? { eventId: '', meetLink: '' } : {};
    const staleBooking = goneOnGoogle ? { ...booking, googleEventId: '', meetLink: '' } : booking;
    const fields = { ...eventFields({ booking, calendar, siteName }), requestId: meetRequestId(booking) };

    let eventId = googleEventIdFor(booking);
    let made = await google.createEvent(token, { ...fields, id: eventId });
    if (!made.ok && made.status === 409) {
      // That id exists already: an earlier attempt made it and its answer was
      // lost to the time limit. Use it, rather than make a second event.
      const read = await google.getEvent(token, eventId);
      if (liveEvent(read)) return finishExisting(eventId, read.data);
      if (!read.ok && read.status !== 404 && read.status !== 410) {
        return failed(`the Google Calendar event could not be read: ${read.error}`, stale, staleBooking);
      }
      // Deleted on Google's side, and its id stays reserved: take a new one.
      eventId = googleEventIdFor(booking, Date.now());
      made = await google.createEvent(token, { ...fields, id: eventId });
    }
    if (!made.ok) return failed(`the Google Calendar event could not be made: ${made.error}`, stale, staleBooking);
    eventId = safeText(made.data?.id) || eventId;
    const meetLink = google.meetLinkOf(made.data);
    if (!meetLink) {
      return failed('Google made the calendar event but has not given it a Meet link yet', { eventId, meetLink: '' }, staleBooking);
    }
    return synced({ eventId, meetLink });
  } catch (error) {
    return failed(`Google Calendar step threw: ${safeText(error?.message) || error}`);
  }
}

/**
 * The page to come back to after Google's sign-in, or '' when the one offered
 * cannot be trusted. It must be on the same origin the request itself came
 * from (the browser's own Origin header, which a page cannot forge), so a
 * sign-in can only ever return to the site that started it.
 */
function trustedReturnTo(returnTo, requestOrigin) {
  const origin = safeText(requestOrigin);
  if (!origin || !safeText(returnTo)) return '';
  try {
    const url = new URL(safeText(returnTo));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.origin !== new URL(origin).origin) return '';
    return url.href.slice(0, 1500);
  } catch {
    return '';
  }
}

/** Where to send the operator's browser to connect. Needs a signed-in user. */
function startConnect(scope, { returnTo = '', requestOrigin = '' } = {}) {
  if (!safeText(scope?.projectId) || !safeText(scope?.userId)) {
    return { ok: false, status: 401, error: 'Sign in before connecting Google Calendar' };
  }
  const adapter = require('./connections/registry').adapterFor(PROVIDER);
  const started = adapter.authorizeUrl({
    projectId: scope.projectId,
    userId: scope.userId,
    returnTo: trustedReturnTo(returnTo, requestOrigin),
  });
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
  busyWithoutBooking,
  googleEventIdFor,
  // Exported for the tests.
  trustedReturnTo,
  findConnectionRow,
  usableConnection,
};
