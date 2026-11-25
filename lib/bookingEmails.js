'use strict';

/**
 * Booking calendar, slice 4 of 6 (SC-912): the emails both sides get when a
 * meeting is booked, cancelled or moved, and the "add to calendar" file.
 *
 *   buildIcs(...)            the .ics file: one VEVENT, times in UTC
 *   buildBookingEmails(...)  the visitor's email and the site owner's alert
 *   sendBookingEmails(...)   send both, AWAITED, and record how it went on
 *                            the booking (notify_status), so a failed send
 *                            shows on the Booking Manager instead of vanishing
 *
 * WHO GETS WHAT
 *   the visitor   their confirmation, in their own time zone, using the
 *                 wording the Booking Manager's Messaging section stores, with
 *                 the private link to cancel or pick a new time
 *   the owner     an alert to the project's Contact Alert Email (Settings
 *                 page): who, when, their note, and a link to the CRM contact
 *                 BY ID (landmine 19). Reply goes straight to the visitor.
 * Both get the .ics on a booking and on a move (same UID, higher SEQUENCE, so
 * the calendar entry moves rather than doubling). A cancellation has no file:
 * a calendar app only removes an entry from an organizer's cancel, which we
 * are not; the email says to delete it.
 *
 * NEVER FAILS THE BOOKING. By the time this runs the meeting is saved. Every
 * failure — no Resend key, no alert address, a refused send, a throttle — is
 * written to the booking as notify_status 'failed' with the reason in plain
 * words, and logged. Dependencies are required at CALL time so the node suite
 * can swap the mailer per test.
 */

const { allowQuietly } = require('./rateLimiter');

const MINUTE = 60000;
const DEFAULT_CALENDAR_NAME = 'Book a meeting';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One line of a header: no line breaks, so a name cannot add a header. */
function oneLine(value, max = 200) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

// ── The calendar file ───────────────────────────────────────────────────────

/** 2026-12-01T17:00:00.000Z → 20261201T170000Z */
function icsTime(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped. */
function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: a content line is at most 75 octets; longer ones continue on
 * the next line after a CRLF and one space. Counted in BYTES, and never
 * splitting a multi-byte character, so an accented name stays readable.
 */
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const len = Buffer.byteLength(char, 'utf8');
    if (size + len > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // the leading space of a continuation line counts
    }
    current += char;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * The "add to calendar" file. Times are UTC (the trailing Z), which every
 * calendar app turns into the reader's own clock, so the file is the same for
 * both sides. `sequence` must go up each time the meeting moves, or a calendar
 * app keeps the old time.
 */
function buildIcs({ uid, startsAt, endsAt, summary, description = '', url = '', location = '', sequence = 0, now = Date.now() }) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('buildIcs needs a start and an end');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StarCaster//Booking Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(uid)}`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SEQUENCE:${Math.max(0, Math.floor(sequence))}`,
    'STATUS:CONFIRMED',
    `SUMMARY:${icsText(oneLine(summary, 300))}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    ...(url ? [`URL:${icsText(url)}`] : []),
    // The Google Meet link (SC-913): calendar apps show LOCATION as a tap-to-join line.
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/**
 * How far the meeting has moved, as a number that only goes up: the seconds
 * between booking and the last move. 0 for a meeting never moved.
 */
function icsSequence(booking) {
  const moved = Date.parse(booking.rescheduledAt || '');
  const made = Date.parse(booking.createdAt || '');
  if (!Number.isFinite(moved) || !Number.isFinite(made)) return 0;
  return Math.max(1, Math.floor((moved - made) / 1000));
}

// ── Wording ─────────────────────────────────────────────────────────────────

/** "Tuesday, December 1, 2026, 10:00 AM – 10:30 AM MST" in the given zone. */
function formatWhen(startsAt, endsAt, timeZone) {
  const zone = timeZone || 'UTC';
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(startsAt));
  const time = (iso, withZone) => new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', minute: '2-digit', ...(withZone ? { timeZoneName: 'short' } : {}),
  }).format(new Date(iso));
  return `${day}, ${time(startsAt, false)} – ${time(endsAt, true)}`;
}

/** The meeting's name: the calendar's own, unless it is still the default label. */
function meetingTitle(calendar) {
  const name = String(calendar?.name || '').trim();
  return name && name !== DEFAULT_CALENDAR_NAME ? name : 'Meeting';
}

function paragraphsHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin: 0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function detailRowsHtml(rows) {
  return rows.map(([label, value, options = {}]) => `
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #587592; font-size: 13px; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>
        <td style="padding: 6px 0; color: #18324a; font-size: 14px;">${options.link && /^https:\/\/\S+$/.test(String(value))
          // Only a row WE mark as a link (the Meet link) is one. Never decide it
          // from the value: a visitor's Name or Note holding an address would
          // become a clickable link in the owner's alert (review, SC-913).
          ? `<a href="${escapeHtml(value)}" style="color: #18324a;">${escapeHtml(value)}</a>`
          : escapeHtml(value).replace(/\n/g, '<br>')}</td>
      </tr>`).join('');
}

function wrapHtml({ heading, intro = '', rows = [], button = null, footer = '' }) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #18324a; max-width: 560px;">
      <h2 style="margin: 0 0 16px;">${escapeHtml(heading)}</h2>
      ${intro}
      <table style="border-collapse: collapse; margin: 0 0 18px;">${detailRowsHtml(rows)}</table>
      ${button ? `<p style="margin: 0 0 18px;"><a href="${escapeHtml(button.href)}" style="display: inline-block; padding: 10px 18px; background: #18324a; color: #ffffff; text-decoration: none; border-radius: 6px;">${escapeHtml(button.label)}</a></p>` : ''}
      ${footer ? `<p style="margin: 0; color: #587592; font-size: 13px;">${footer}</p>` : ''}
    </div>
  `;
}

function rowsText(rows) {
  return rows.map(([label, value]) => `${label}: ${value}`).join('\n');
}

const KINDS = ['booked', 'cancelled', 'rescheduled'];

/**
 * Both emails for one event. Pure: no sending, no database.
 *
 *   kind        'booked' | 'cancelled' | 'rescheduled'
 *   booking     the booking as it now stands (a move: its NEW time)
 *   previous    a move only: { startsAt, endsAt } it moved from
 *   calendar    the booking's calendar (time zone, name, messaging)
 *   siteName    the project's name, as the emails sign off
 *   manageUrl   the visitor's private cancel/reschedule link
 *   contactUrl  the operator's link to the CRM contact, or '' when none
 *
 * Returns { visitor, operator }, each { subject, text, html, attachments }.
 */
function buildBookingEmails({ kind, booking, previous = null, calendar, siteName = '', manageUrl = '', contactUrl = '', now = Date.now() }) {
  if (!KINDS.includes(kind)) throw new Error(`buildBookingEmails: unknown kind ${JSON.stringify(kind)}`);
  const site = String(siteName || '').trim() || 'our team';
  const title = meetingTitle(calendar);
  const ownerZone = calendar?.timeZone || 'UTC';
  const visitorZone = booking.visitorTimeZone || ownerZone;
  const whenVisitor = formatWhen(booking.startsAt, booking.endsAt, visitorZone);
  const whenOwner = formatWhen(booking.startsAt, booking.endsAt, ownerZone);
  const messaging = calendar?.messaging || {};
  // The Google Meet link, when the project's Google Calendar made one (SC-913).
  // A cancelled meeting has no call to join.
  const meetLink = kind === 'cancelled' ? '' : String(booking.meetLink || '').trim();
  const meetLine = meetLink ? `Join with Google Meet: ${meetLink}` : '';

  const ics = kind === 'cancelled' ? null : buildIcs({
    uid: `${booking.id}@booking.starcaster`,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    summary: `${title} with ${site}`,
    description: [meetLine, manageUrl ? `To cancel or pick a new time: ${manageUrl}` : ''].filter(Boolean).join('\n'),
    url: manageUrl,
    location: meetLink,
    sequence: icsSequence(booking),
    now,
  });
  const ownerIcs = kind === 'cancelled' ? null : buildIcs({
    uid: `${booking.id}@booking.starcaster`,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    summary: `${title} with ${booking.visitorName}`,
    description: [
      `${booking.visitorName} <${booking.visitorEmail}>`,
      booking.visitorPhone ? `Phone: ${booking.visitorPhone}` : '',
      booking.visitorNote ? `Note: ${booking.visitorNote}` : '',
      meetLine,
    ].filter(Boolean).join('\n'),
    location: meetLink,
    sequence: icsSequence(booking),
    now,
  });
  const attach = (content) => (content ? [{
    filename: 'meeting.ics',
    content: Buffer.from(content, 'utf8').toString('base64'),
    contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
  }] : []);

  const previousVisitor = previous ? formatWhen(previous.startsAt, previous.endsAt, visitorZone) : '';
  const previousOwner = previous ? formatWhen(previous.startsAt, previous.endsAt, ownerZone) : '';

  // ── the visitor ──
  const visitorRows = [['When', whenVisitor]];
  if (kind === 'rescheduled') visitorRows.push(['Was', previousVisitor]);
  if (meetLink) visitorRows.push(['Video call', meetLink, { link: true }]);
  let visitorSubject;
  let visitorHeading;
  let visitorIntro;
  if (kind === 'booked') {
    visitorSubject = oneLine(messaging.confirmationEmailSubject) || `Your ${title === 'Meeting' ? 'meeting' : title} with ${site} is booked`;
    visitorHeading = 'You are booked';
    visitorIntro = String(messaging.confirmationEmailBody || '').trim() || `Thank you for booking a time with ${site}. The details are below.`;
  } else if (kind === 'rescheduled') {
    visitorSubject = `Your meeting with ${site} has moved`;
    visitorHeading = 'Your meeting has moved';
    visitorIntro = `Your meeting with ${site} is now at the new time below.`;
  } else {
    visitorSubject = `Your meeting with ${site} is cancelled`;
    visitorHeading = 'Your meeting is cancelled';
    visitorIntro = `Your meeting with ${site} has been cancelled. If you added it to your calendar, you can delete it there.`;
  }
  const visitorButton = kind !== 'cancelled' && manageUrl ? { href: manageUrl, label: 'Cancel or pick a new time' } : null;
  const visitorFooterText = kind === 'cancelled'
    ? ''
    : 'The attached file adds this meeting to your calendar.';
  const visitor = {
    subject: visitorSubject,
    text: [
      visitorIntro,
      '',
      rowsText(visitorRows),
      ...(visitorButton ? ['', `To cancel or pick a new time: ${manageUrl}`] : []),
      ...(visitorFooterText ? ['', visitorFooterText] : []),
      '',
      `— ${site}`,
    ].join('\n'),
    html: wrapHtml({
      heading: visitorHeading,
      intro: paragraphsHtml(visitorIntro),
      rows: visitorRows,
      button: visitorButton,
      footer: [escapeHtml(visitorFooterText), `— ${escapeHtml(site)}`].filter(Boolean).join('<br>'),
    }),
    attachments: attach(ics),
  };

  // ── the site owner ──
  const ownerRows = [
    ['When', whenOwner],
    ...(kind === 'rescheduled' ? [['Was', previousOwner]] : []),
    ...(meetLink ? [['Video call', meetLink, { link: true }]] : []),
    ['Name', booking.visitorName],
    ['Email', booking.visitorEmail],
    ...(booking.visitorPhone ? [['Phone', booking.visitorPhone]] : []),
    ...(booking.visitorNote ? [['Note', booking.visitorNote]] : []),
  ];
  const ownerHeading = kind === 'booked' ? 'New booking' : kind === 'rescheduled' ? 'A booking has moved' : 'A booking was cancelled';
  const ownerLead = kind === 'booked'
    ? `${booking.visitorName} booked a time on ${site}.`
    : kind === 'rescheduled'
      ? `${booking.visitorName} moved their meeting to a new time.`
      : `${booking.visitorName} cancelled their meeting. The time is free for visitors to book again.`;
  const contactLine = contactUrl
    ? `Their CRM contact: ${contactUrl}`
    : 'This booking is not linked to a CRM contact.';
  const operator = {
    subject: oneLine(`${kind === 'booked' ? 'New booking' : kind === 'rescheduled' ? 'Booking moved' : 'Booking cancelled'}: ${booking.visitorName}, ${whenOwner}`, 200),
    text: [ownerLead, '', rowsText(ownerRows), '', contactLine].join('\n'),
    html: wrapHtml({
      heading: ownerHeading,
      intro: paragraphsHtml(ownerLead),
      rows: ownerRows,
      button: contactUrl ? { href: contactUrl, label: 'Open CRM Contact' } : null,
      footer: contactUrl ? '' : 'This booking is not linked to a CRM contact.',
    }),
    attachments: attach(ownerIcs),
  };
  return { visitor, operator };
}

// ── Links ───────────────────────────────────────────────────────────────────

/**
 * The site the visitor booked on, as an origin: the host the request came in
 * on (a client's own domain, which is where their manage link should open),
 * https everywhere except this machine.
 */
function requestSiteOrigin(req) {
  const headers = req?.headers || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (!host) return '';
  const local = /^(localhost|127\.|\[::1\])/i.test(host);
  const forwarded = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwarded || (local ? 'http' : 'https');
  return `${proto}://${host}`;
}

function manageLink(origin, projectId, token) {
  if (!origin || !token) return '';
  return `${origin}/api/public/booking/manage?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;
}

/** The Contact Manager page, naming the contact BY ID (landmine 19). */
function contactLink(origin, contactId) {
  const id = String(contactId || '').trim();
  if (!origin || !id) return '';
  return `${origin}/admin-contact-manager?contact=${encodeURIComponent(id)}`;
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * Send both emails for one event and record the outcome on the booking.
 * Never throws. Returns { status: 'sent'|'failed', error, sent: { visitor, operator } }.
 *
 *   manageToken  the booking's token (createBooking's answer, or the one the
 *                visitor's link carried); without it the visitor gets no link
 */
async function sendBookingEmails({ kind, booking, previous = null, calendar, projectId, origin, manageToken = '', scope }) {
  const problems = [];
  const sent = { visitor: false, operator: false };
  try {
    const { sendEmail } = require('./mailer');
    const { getPublicProjectById } = require('./projectsStore');
    const { getContactAlertEmails } = require('./projectSiteSettingsStore');
    const projectResult = await getPublicProjectById(projectId).catch(() => null);
    const siteName = String(projectResult?.data?.name || '').trim();
    const team = await getContactAlertEmails(projectId).catch(() => []);
    const emails = buildBookingEmails({
      kind,
      booking,
      previous,
      calendar,
      siteName,
      manageUrl: manageLink(origin, projectId, manageToken),
      contactUrl: contactLink(origin, booking.crmContactId),
    });

    // The visitor's address came from a public form, so a script could aim it
    // at a stranger: throttled per address, like the CRM form's confirmation.
    if (!allowQuietly('booking.email.recipient', String(booking.visitorEmail).toLowerCase())) {
      problems.push('the visitor was not emailed: too many booking emails to that address in the last hour');
    } else {
      const mail = await sendEmail({
        to: booking.visitorEmail,
        fromName: siteName || undefined,
        replyTo: team.length ? team : undefined,
        ...emails.visitor,
      });
      if (mail?.ok) sent.visitor = true;
      else problems.push(`the visitor was not emailed: ${mail?.error || 'the mail service refused it'}`);
    }

    if (!team.length) {
      problems.push('the site owner was not emailed: no Contact Alert Email is set on the Settings page');
    } else {
      const mail = await sendEmail({
        to: team,
        fromName: siteName || undefined,
        replyTo: booking.visitorEmail,
        ...emails.operator,
      });
      if (mail?.ok) sent.operator = true;
      else problems.push(`the site owner was not emailed: ${mail?.error || 'the mail service refused it'}`);
    }
  } catch (error) {
    problems.push(`the booking emails could not be prepared: ${error?.message || error}`);
  }

  const status = problems.length ? 'failed' : 'sent';
  const error = problems.join('; ');
  if (problems.length) console.error(`[booking] booking ${booking.id} (${kind}) emails: ${error}`);
  try {
    const store = require('./bookingStore');
    const recorded = await store.recordNotification(booking.id, { status, error }, scope);
    if (!recorded.ok) console.error(`[booking] booking ${booking.id}: could not record how its emails went (${status}): ${recorded.error}`);
  } catch (e) {
    console.error(`[booking] booking ${booking.id}: recording its email status threw: ${e?.message || e}`);
  }
  return { status, error, sent };
}

module.exports = {
  buildIcs,
  buildBookingEmails,
  sendBookingEmails,
  formatWhen,
  foldLine,
  icsText,
  icsSequence,
  requestSiteOrigin,
  manageLink,
  contactLink,
};
