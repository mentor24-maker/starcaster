'use strict';

/**
 * Substack Miner — importing Substack's own subscriber export so the screen
 * can say which writers became subscribers (Substack Miner 7/7, task
 * 86bcfprya).
 *
 * Substack has no public way to read a publication's subscribers, so Dane
 * downloads the list himself (publication dashboard → Settings → Exports, or
 * Subscribers → Export) and pastes or uploads the CSV. `importSubscribers`
 * reads it and, for every row whose email belongs to a contact in this
 * project, records the row's subscription date against THIS project on that
 * contact (`custom_fields.substack_subscribed_at = { <projectId>: <date> }`).
 * Nothing else on the contact changes, and a row with no matching contact is
 * COUNTED, never created.
 *
 * WHY THE MARK IS KEYED BY PROJECT. With the people table present,
 * `custom_fields` is a PERSON field (lib/peopleStore.js PERSON_FIELD_KEYS),
 * stored on the one `people` row every project shares for that email. A bare
 * date there would mark the person a subscriber in every project they are a
 * contact in, and another project's Substack Miner would count them as
 * Subscribed (round-1 review of PR #815). Each project reads and writes only
 * its own key, so one import never moves another project's count. A bare
 * string left in the field marks no project.
 *
 * WHICH COLUMNS. The export's exact header was not verifiable from here, so
 * the reader accepts the names it is known to use and the obvious variants
 * (EMAIL_HEADERS, DATE_HEADERS below), matched without regard to case, spaces
 * or underscores. The answer names the column it used. A file with no email
 * column is refused with the headers it DID have; a file with no date column
 * is imported with today's date and says so.
 *
 * COUNTS ARE PER ROW of the file. A row matching two contacts (one email on
 * two contacts in the project) marks both, and counts as newly marked when
 * either was newly marked. A contact already carrying a date keeps it — a
 * second import never moves the date, so "already marked" means exactly that.
 *
 * Every outside dependency comes in through `deps`, so
 * scripts/builder/substackSubscriberImport.test.js drives it with no database.
 */

const minerStore = require('../substackMinerStore');
const contactsStore = require('../ContactsStore');

const CONTACT_LIST_LIMIT = 5000;
// Vercel refuses a request body over about 4.5 MB before this code runs, so
// a larger cap would never get to say why the file was refused.
const MAX_CSV_LENGTH = 4 * 1024 * 1024;
const MAX_ROWS = 50000;
const MAX_NAMED_PROBLEMS = 20;
const SUBSCRIBED_FIELD = 'substack_subscribed_at';

/** Header names, compared after lowercasing and dropping spaces, `_` and `-`. */
const EMAIL_HEADERS = ['email', 'emailaddress', 'subscriberemail'];
const DATE_HEADERS = [
  'subscriptiondate', 'subscribedat', 'subscribeddate', 'subscribed',
  'createdat', 'created', 'startdate', 'date',
];

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function headerKey(text) {
  return String(text || '').toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * The rows of a CSV, each a list of cells. Quoted cells may hold commas,
 * line breaks and doubled quotes (`""`); a leading byte-order mark and
 * Windows line endings are absorbed. Wholly blank lines are dropped.
 */
function parseCsv(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((c) => c.trim() !== ''));
}

/** A date the file gave, as an ISO timestamp, or '' when it is not a date. */
function isoDate(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  return new Date(time).toISOString();
}

/**
 * The subscribers a CSV names: `{ email, subscribedAt, line }` per data row,
 * plus the rows it could not use, each with its line number and why.
 */
function readSubscriberCsv(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return refuse('csv is empty — paste the subscriber export, or choose the file');
  }
  if (text.length > MAX_CSV_LENGTH) {
    return refuse(`csv is too large — at most ${MAX_CSV_LENGTH / (1024 * 1024)} MB per import`);
  }
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return refuse('csv has a header line and no subscribers under it');
  }
  if (rows.length - 1 > MAX_ROWS) {
    return refuse(`csv can hold at most ${MAX_ROWS.toLocaleString('en-US')} subscribers per import — got ${(rows.length - 1).toLocaleString('en-US')}`);
  }
  const header = rows[0].map((h) => h.trim());
  const keys = header.map(headerKey);
  const emailIndex = keys.findIndex((k) => EMAIL_HEADERS.includes(k));
  if (emailIndex === -1) {
    return refuse(`csv has no email column — its first line should name one (for example "email"); this file's first line is: ${header.join(', ')}`);
  }
  // The first date header in DATE_HEADERS order wins, so "subscription_date"
  // is preferred over a generic "created_at" when a file carries both.
  let dateIndex = -1;
  for (const wanted of DATE_HEADERS) {
    dateIndex = keys.indexOf(wanted);
    if (dateIndex !== -1) break;
  }

  const subscribers = [];
  const problems = [];
  for (let r = 1; r < rows.length; r += 1) {
    const line = r + 1;
    const cells = rows[r];
    const email = String(cells[emailIndex] || '').trim().toLowerCase();
    if (!email) {
      problems.push({ line, reason: 'the email is blank' });
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      problems.push({ line, reason: `"${email}" is not an email address` });
      continue;
    }
    let subscribedAt = '';
    if (dateIndex !== -1) {
      const raw = String(cells[dateIndex] || '').trim();
      subscribedAt = isoDate(raw);
      if (raw && !subscribedAt) {
        problems.push({ line, reason: `"${raw}" in the ${header[dateIndex]} column is not a date` });
        continue;
      }
    }
    subscribers.push({ email, subscribedAt, line });
  }
  return {
    ok: true,
    status: 200,
    data: {
      rowsRead: rows.length - 1,
      emailColumn: header[emailIndex],
      dateColumn: dateIndex === -1 ? '' : header[dateIndex],
      subscribers,
      problems,
    },
  };
}

/** The project-keyed map the field holds, or {} when it holds anything else. */
function subscribedMapOf(contact) {
  const custom = contact && contact.customFields && typeof contact.customFields === 'object' ? contact.customFields : {};
  const value = custom[SUBSCRIBED_FIELD];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** When this contact subscribed, as recorded for THIS project, or ''. */
function subscribedAtOf(contact, projectId) {
  const key = String(projectId || '').trim();
  if (!key) return '';
  const value = subscribedMapOf(contact)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * Read the CSV and mark the matching contacts. The answer counts every row:
 * `rowsRead = matched + unmatched + unreadable`, and
 * `matched = newlyMarked + alreadyMarked`.
 */
async function importSubscribers(input, scope = null, deps = {}) {
  const contacts = deps.contactsStore || contactsStore;
  const store = deps.minerStore || minerStore;
  const now = deps.now ? deps.now() : new Date();

  const projectId = String(scope?.projectId || '').trim();
  if (!projectId) return refuse('No project is selected, so there are no contacts to match subscribers against.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('The request must be { csv }');
  const extra = Object.keys(input).filter((key) => key !== 'csv');
  if (extra.length) return refuse(`Unknown field: ${extra.join(', ')} — the import takes only csv`);

  const read = readSubscriberCsv(input.csv);
  if (!read.ok) return read;
  const { rowsRead, emailColumn, dateColumn, subscribers, problems } = read.data;

  const listed = await contacts.listContacts({ limit: CONTACT_LIST_LIMIT, orderBy: 'created_at', orderDir: 'asc', scope });
  if (!listed.ok) return listed;
  const rows = Array.isArray(listed.data) ? listed.data : [];
  const byEmail = new Map();
  for (const contact of rows.map(contacts.rowToContact).filter(Boolean)) {
    const email = String(contact.email || '').trim().toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(contact);
  }

  // Which contacts are approved writers', so the answer can say whether the
  // Subscribed count in the header can move at all.
  const approved = await store.listCandidates(1000, scope, { status: 'approved' });
  const approvedContactIds = new Set(
    approved.ok ? (approved.data || []).map((c) => c.contactId).filter(Boolean) : []
  );

  const fallbackDate = now.toISOString();
  const result = {
    rowsRead,
    matched: 0,
    newlyMarked: 0,
    alreadyMarked: 0,
    unmatched: 0,
    unreadable: problems.length,
    approvedWriterMatches: 0,
    emailColumn,
    dateColumn,
    contactsSearched: rows.length,
    contactsTruncated: rows.length >= CONTACT_LIST_LIMIT,
    approvedWritersKnown: approved.ok,
    problems: problems.slice(0, MAX_NAMED_PROBLEMS),
    unmatchedEmails: [],
  };

  for (const subscriber of subscribers) {
    const found = byEmail.get(subscriber.email);
    if (!found) {
      result.unmatched += 1;
      if (result.unmatchedEmails.length < MAX_NAMED_PROBLEMS) result.unmatchedEmails.push(subscriber.email);
      continue;
    }
    result.matched += 1;
    if (found.some((c) => approvedContactIds.has(c.id))) result.approvedWriterMatches += 1;
    let marked = false;
    for (const contact of found) {
      if (subscribedAtOf(contact, projectId)) continue;
      const date = subscriber.subscribedAt || fallbackDate;
      const customFields = {
        ...(contact.customFields || {}),
        [SUBSCRIBED_FIELD]: { ...subscribedMapOf(contact), [projectId]: date },
      };
      const saved = await contacts.updateContact(contact.id, { customFields }, scope);
      // A refused write is not one row's fault: stop and say how far it got,
      // rather than reporting the rest as imported.
      if (!saved.ok) {
        return refuse(
          `Contact ${contact.id} (${subscriber.email}, line ${subscriber.line}) could not be marked: ${saved.error || `status ${saved.status}`}. `
          + `${result.newlyMarked} contact(s) were marked before it stopped; importing again carries on from here.`,
          saved.status || 500
        );
      }
      contact.customFields = customFields;
      marked = true;
    }
    if (marked) result.newlyMarked += 1;
    else result.alreadyMarked += 1;
  }
  return { ok: true, status: 200, data: result };
}

module.exports = {
  SUBSCRIBED_FIELD,
  EMAIL_HEADERS,
  DATE_HEADERS,
  parseCsv,
  readSubscriberCsv,
  importSubscribers,
  subscribedAtOf,
};
