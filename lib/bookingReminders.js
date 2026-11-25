'use strict';

/**
 * Booking calendar, slice 6 of 6 (SC-914): the RULES for reminder emails.
 * Pure: no database, no sending. The scheduled pass that uses them is
 * lib/bookingRemindersRunDue.js; the settings' storage is
 * lib/bookingRemindersStore.js.
 *
 *   normalizeReminderSettings(raw)   what a calendar's stored value means
 *                                    (NULL = the defaults)
 *   reminderSettingsOrError(input)   a save, checked; refuses with the reason
 *   dueOffset(...)                   which reminder, if any, is due right now
 *   buildReminderEmails(...)         the visitor's reminder and the owner's
 *
 * WHICH REMINDER IS DUE. A reminder "1 day before" opens one day before the
 * meeting and stays open until it starts. Two rules keep it to one useful
 * email:
 *   - a reminder whose time had already passed when the meeting was booked
 *     (or last moved) is never sent: someone who books two hours ahead just
 *     got their confirmation, and a "your meeting is tomorrow" would be wrong;
 *   - when several are open at once (the job was down for a while), only the
 *     NEAREST one is sent, so a visitor never gets "in a day" and "in an hour"
 *     in the same minute.
 */

const MINUTE = 60000;
const MAX_OFFSETS = 3;
const MIN_OFFSET = 5;
const MAX_OFFSET = 7 * 24 * 60; // one week
const MAX_ATTEMPTS = 3;

const REMINDER_DEFAULTS = Object.freeze({
  enabled: true,
  offsetsMinutes: Object.freeze([1440, 60]),
  notifyOwner: false,
});

const SETTING_KEYS = ['enabled', 'offsetsMinutes', 'notifyOwner'];

function bad(error) {
  return { ok: false, status: 400, error };
}

function cleanOffsets(list) {
  return [...new Set(list)].sort((a, b) => b - a);
}

/** A stored value → the settings it means. Anything unreadable is the default for that field. */
function normalizeReminderSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const offsets = Array.isArray(source.offsetsMinutes)
    ? source.offsetsMinutes.filter((n) => Number.isInteger(n) && n >= MIN_OFFSET && n <= MAX_OFFSET)
    : null;
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : REMINDER_DEFAULTS.enabled,
    offsetsMinutes: cleanOffsets(offsets === null ? [...REMINDER_DEFAULTS.offsetsMinutes] : offsets).slice(0, MAX_OFFSETS),
    notifyOwner: typeof source.notifyOwner === 'boolean' ? source.notifyOwner : REMINDER_DEFAULTS.notifyOwner,
  };
}

/**
 * A save from the Booking Manager. Every field is required, so a save is the
 * whole setting and never half of one; an unknown field is refused by name.
 */
function reminderSettingsOrError(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('reminder settings must be an object');
  const unknown = Object.keys(input).filter((key) => !SETTING_KEYS.includes(key));
  if (unknown.length) return bad(`Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Known fields are ${SETTING_KEYS.join(', ')}`);
  if (typeof input.enabled !== 'boolean') return bad('enabled must be true or false');
  if (typeof input.notifyOwner !== 'boolean') return bad('notifyOwner must be true or false');
  if (!Array.isArray(input.offsetsMinutes)) return bad('offsetsMinutes must be a list of minutes, like [1440, 60]');
  for (const n of input.offsetsMinutes) {
    if (!Number.isInteger(n) || n < MIN_OFFSET || n > MAX_OFFSET) {
      return bad(`each reminder time must be a whole number of minutes from ${MIN_OFFSET} to ${MAX_OFFSET} (got ${JSON.stringify(n)})`);
    }
  }
  const offsets = cleanOffsets(input.offsetsMinutes);
  if (offsets.length > MAX_OFFSETS) return bad(`at most ${MAX_OFFSETS} reminder times`);
  if (input.enabled && !offsets.length) return bad('choose at least one reminder time, or switch reminders off');
  return { ok: true, value: { enabled: input.enabled, offsetsMinutes: offsets, notifyOwner: input.notifyOwner } };
}

/**
 * The reminder due for one meeting right now, as its offset in minutes, or
 * null. `madeAt` is when the meeting was booked or last moved (ms).
 */
function dueOffset({ startsAt, madeAt, offsetsMinutes, now }) {
  const start = typeof startsAt === 'number' ? startsAt : Date.parse(startsAt);
  if (!Number.isFinite(start) || now >= start) return null;
  const made = Number.isFinite(madeAt) ? madeAt : -Infinity;
  const open = (offsetsMinutes || []).filter((offset) => {
    const opensAt = start - offset * MINUTE;
    return opensAt <= now && made <= opensAt;
  });
  return open.length ? Math.min(...open) : null;
}

/** When the meeting was booked or last moved, in ms (NaN when unknown). */
function madeAtOf(booking) {
  const times = [booking.createdAt, booking.rescheduledAt].map((t) => Date.parse(t || '')).filter(Number.isFinite);
  return times.length ? Math.max(...times) : NaN;
}

/** 1440 → "1 day", 60 → "1 hour", 90 → "90 minutes". */
function offsetLabel(minutes) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (minutes % 10080 === 0) return plural(minutes / 10080, 'week');
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

// ── The emails ──────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function oneLine(value, max = 200) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function meetingTitle(calendar) {
  const name = String(calendar?.name || '').trim();
  return name && name !== 'Book a meeting' ? name : 'Meeting';
}

function html({ heading, intro, rows, button, footer }) {
  const paragraphs = String(intro || '')
    .split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin: 0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const table = rows.map(([label, value, link]) => `
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #587592; font-size: 13px; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>
        <td style="padding: 6px 0; color: #18324a; font-size: 14px;">${link
          ? `<a href="${escapeHtml(value)}" style="color: #18324a;">${escapeHtml(value)}</a>`
          : escapeHtml(value).replace(/\n/g, '<br>')}</td>
      </tr>`).join('');
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #18324a; max-width: 560px;">
      <h2 style="margin: 0 0 16px;">${escapeHtml(heading)}</h2>
      ${paragraphs}
      <table style="border-collapse: collapse; margin: 0 0 18px;">${table}</table>
      ${button ? `<p style="margin: 0 0 18px;"><a href="${escapeHtml(button.href)}" style="display: inline-block; padding: 10px 18px; background: #18324a; color: #ffffff; text-decoration: none; border-radius: 6px;">${escapeHtml(button.label)}</a></p>` : ''}
      ${footer ? `<p style="margin: 0; color: #587592; font-size: 13px;">${escapeHtml(footer)}</p>` : ''}
    </div>
  `;
}

/**
 * The two reminder emails for one meeting. Pure.
 *
 *   booking     { startsAt, endsAt, visitorName, visitorEmail, visitorPhone,
 *                 visitorNote, visitorTimeZone, meetLink }
 *   calendar    { name, timeZone, messaging }
 *   siteName    the project's name
 *   manageUrl   the visitor's cancel/reschedule link, or ''
 *   contactUrl  the owner's link to the CRM contact, or ''
 *
 * The visitor's subject and text come from the Booking Manager's Messaging
 * section (reminderEmailSubject / reminderEmailBody) when set.
 */
function buildReminderEmails({ booking, calendar, siteName = '', manageUrl = '', contactUrl = '' }) {
  const { formatWhen } = require('./bookingEmails');
  const site = String(siteName || '').trim() || 'our team';
  const title = meetingTitle(calendar);
  const ownerZone = calendar?.timeZone || 'UTC';
  const visitorZone = booking.visitorTimeZone || ownerZone;
  const messaging = calendar?.messaging || {};
  // The Google Meet link, when the project's Google Calendar made one (SC-913).
  const meetLink = /^https:\/\/\S+$/.test(String(booking.meetLink || '').trim()) ? String(booking.meetLink).trim() : '';

  const visitorRows = [['When', formatWhen(booking.startsAt, booking.endsAt, visitorZone)]];
  if (meetLink) visitorRows.push(['Video call', meetLink, true]);
  const visitorIntro = String(messaging.reminderEmailBody || '').trim()
    || `This is a reminder of your ${title === 'Meeting' ? 'meeting' : title} with ${site}. The details are below.`;
  const visitorSubject = oneLine(messaging.reminderEmailSubject)
    || `Reminder: your ${title === 'Meeting' ? 'meeting' : title} with ${site}`;
  const visitor = {
    subject: visitorSubject,
    text: [
      visitorIntro,
      '',
      ...visitorRows.map(([label, value]) => `${label}: ${value}`),
      ...(manageUrl ? ['', `Can't make it? Cancel or pick a new time: ${manageUrl}`] : []),
      '',
      `— ${site}`,
    ].join('\n'),
    html: html({
      heading: 'Your meeting is coming up',
      intro: visitorIntro,
      rows: visitorRows,
      button: manageUrl ? { href: manageUrl, label: 'Cancel or pick a new time' } : null,
      footer: `— ${site}`,
    }),
  };

  const whenOwner = formatWhen(booking.startsAt, booking.endsAt, ownerZone);
  const ownerRows = [
    ['When', whenOwner],
    ...(meetLink ? [['Video call', meetLink, true]] : []),
    ['Name', booking.visitorName],
    ['Email', booking.visitorEmail],
    ...(booking.visitorPhone ? [['Phone', booking.visitorPhone]] : []),
    ...(booking.visitorNote ? [['Note', booking.visitorNote]] : []),
  ];
  const ownerLead = `A reminder: you have a meeting with ${booking.visitorName} coming up.`;
  const operator = {
    subject: oneLine(`Reminder: ${booking.visitorName}, ${whenOwner}`, 200),
    text: [
      ownerLead,
      '',
      ...ownerRows.map(([label, value]) => `${label}: ${value}`),
      '',
      contactUrl ? `Their CRM contact: ${contactUrl}` : 'This booking is not linked to a CRM contact.',
    ].join('\n'),
    html: html({
      heading: 'Meeting reminder',
      intro: ownerLead,
      rows: ownerRows,
      button: contactUrl ? { href: contactUrl, label: 'Open CRM Contact' } : null,
      footer: contactUrl ? '' : 'This booking is not linked to a CRM contact.',
    }),
  };
  return { visitor, operator };
}

module.exports = {
  REMINDER_DEFAULTS,
  MAX_ATTEMPTS,
  MAX_OFFSETS,
  MIN_OFFSET,
  MAX_OFFSET,
  normalizeReminderSettings,
  reminderSettingsOrError,
  dueOffset,
  madeAtOf,
  offsetLabel,
  buildReminderEmails,
};
