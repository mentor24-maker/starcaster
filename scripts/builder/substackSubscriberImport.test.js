'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Substack Miner 7/7 (86bcfprya) — importing Substack's subscriber export and
 * the header's Engaged / Subscribed counts. Both files take their stores
 * through `deps`, so these fakes stand in for the database: contacts keep one
 * list PER PROJECT, so a match against the other project's contact is
 * distinguishable from a match against this one's.
 */

const {
  parseCsv, readSubscriberCsv, importSubscribers, SUBSCRIBED_FIELD,
} = require('../../lib/acquire/SubstackSubscriberImport.js');
const { minerStats, noteHandle, noteKey } = require('../../lib/acquire/SubstackMinerStats.js');

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const OTHER = { projectId: 'proj_b', userId: 'user_2' };

function fakeContacts(byProject) {
  const writes = [];
  const store = {
    writes,
    rowToContact: (row) => (row ? { ...row, customFields: { ...(row.customFields || {}) } } : null),
    async listContacts({ scope } = {}) {
      if (!scope?.projectId) throw new Error('listContacts without a scope would read every project');
      return { ok: true, status: 200, data: (byProject[scope.projectId] || []).map((c) => ({ ...c })) };
    },
    async updateContact(id, patch, scope) {
      const list = byProject[scope.projectId] || [];
      const found = list.find((c) => c.id === id);
      if (!found) return { ok: false, status: 404, error: 'Contact not found' };
      writes.push({ id, patch });
      found.customFields = patch.customFields;
      return { ok: true, status: 200, data: found };
    },
  };
  return store;
}

function fakeMiner(candidates) {
  return {
    async listCandidates(limit, scope, options = {}) {
      if (typeof limit !== 'number') throw new Error('limit first');
      if (!scope?.projectId) throw new Error('scope required');
      const rows = candidates.filter((c) => !options.status || c.status === options.status);
      return { ok: true, status: 200, data: rows.map((c) => ({ recentNotes: [], ...c })) };
    },
  };
}

function fakeNotes(items, { fail = false } = {}) {
  return {
    async listPostedForLimits(limit, scope) {
      if (typeof limit !== 'number') throw new Error('limit first');
      if (!scope?.projectId) throw new Error('scope required');
      if (fail) return { ok: false, status: 503, error: 'substack_notes_items is not available' };
      return { ok: true, status: 200, data: items.filter((i) => i.status === 'posting' || i.status === 'posted') };
    },
  };
}

const CSV = 'email,subscription_date\ndane@alphire.agency,2026-10-01\nWriter@Example.com,2026-10-02\nnobody-matches@example.com,2026-10-01\n';

function setup() {
  const byProject = {
    proj_a: [
      { id: 'c_dane', email: 'dane@alphire.agency', customFields: { keep: 'me' } },
      { id: 'c_writer', email: 'writer@example.com', customFields: {} },
      { id: 'c_noemail', email: null, customFields: {} },
    ],
    proj_b: [{ id: 'c_other', email: 'nobody-matches@example.com', customFields: {} }],
  };
  const contacts = fakeContacts(byProject);
  const miner = fakeMiner([{ id: 'w1', handle: 'writer', status: 'approved', contactId: 'c_writer' }]);
  return { byProject, contacts, deps: { contactsStore: contacts, minerStore: miner, now: () => new Date('2026-10-09T12:00:00Z') } };
}

// ── The CSV reader ───────────────────────────────────────────────────────────

test('parseCsv keeps a comma and a doubled quote inside a quoted cell, and absorbs CRLF and a BOM', () => {
  const rows = parseCsv('﻿email,name\r\n"a@b.co","Smith, ""Jo"""\r\n\r\nc@d.co,x');
  assert.deepEqual(rows, [['email', 'name'], ['a@b.co', 'Smith, "Jo"'], ['c@d.co', 'x']]);
});

test('a quoted cell may hold a line break', () => {
  assert.deepEqual(parseCsv('email,note\na@b.co,"one\ntwo"'), [['email', 'note'], ['a@b.co', 'one\ntwo']]);
});

test('blank emails and non-emails are named by line, not dropped silently', () => {
  const read = readSubscriberCsv('Email,Created At\n,2026-10-01\nnot-an-email,2026-10-01\nok@x.co,2026-10-03\n');
  assert.equal(read.ok, true);
  assert.equal(read.data.rowsRead, 3);
  assert.equal(read.data.emailColumn, 'Email');
  assert.equal(read.data.dateColumn, 'Created At');
  assert.deepEqual(read.data.problems.map((p) => p.line), [2, 3]);
  assert.match(read.data.problems[0].reason, /blank/);
  assert.deepEqual(read.data.subscribers.map((s) => s.email), ['ok@x.co']);
});

test('a date that is not a date skips the row and says which column', () => {
  const read = readSubscriberCsv('email,subscription_date\na@b.co,soon\n');
  assert.equal(read.data.subscribers.length, 0);
  assert.match(read.data.problems[0].reason, /"soon" in the subscription_date column is not a date/);
});

test('subscription_date wins over a generic created_at when a file has both', () => {
  const read = readSubscriberCsv('created_at,email,subscription_date\n2020-01-01,a@b.co,2026-10-01\n');
  assert.equal(read.data.dateColumn, 'subscription_date');
  assert.equal(read.data.subscribers[0].subscribedAt, '2026-10-01T00:00:00.000Z');
});

test('a file with no email column is refused with the headers it has', () => {
  const read = readSubscriberCsv('name,date\nJo,2026-10-01\n');
  assert.equal(read.ok, false);
  assert.match(read.error, /no email column.*name, date/);
});

test('an empty paste and a header-only file are refused', () => {
  assert.equal(readSubscriberCsv('   ').ok, false);
  assert.match(readSubscriberCsv('email\n').error, /no subscribers under it/);
});

// ── The import ───────────────────────────────────────────────────────────────

test('a 3-row CSV with 2 matching emails marks those 2 and reports 1 unmatched', async () => {
  const { byProject, contacts, deps } = setup();
  const res = await importSubscribers({ csv: CSV }, SCOPE, deps);
  assert.equal(res.ok, true, res.error);
  const d = res.data;
  assert.equal(d.rowsRead, 3);
  assert.equal(d.matched, 2);
  assert.equal(d.newlyMarked, 2);
  assert.equal(d.alreadyMarked, 0);
  assert.equal(d.unmatched, 1);
  assert.deepEqual(d.unmatchedEmails, ['nobody-matches@example.com']);
  assert.equal(d.approvedWriterMatches, 1, 'the writer contact belongs to an approved writer');
  assert.equal(contacts.writes.length, 2);
  const dane = byProject.proj_a.find((c) => c.id === 'c_dane');
  assert.equal(dane.customFields[SUBSCRIBED_FIELD], '2026-10-01T00:00:00.000Z');
  assert.equal(dane.customFields.keep, 'me', 'the other custom fields are kept');
  // Never touches the other project's contact with the same email.
  assert.deepEqual(byProject.proj_b[0].customFields, {});
});

test('importing the same CSV again reports 2 already marked, 0 newly marked, and writes nothing', async () => {
  const { contacts, deps } = setup();
  await importSubscribers({ csv: CSV }, SCOPE, deps);
  const before = contacts.writes.length;
  const res = await importSubscribers({ csv: CSV }, SCOPE, deps);
  assert.equal(res.data.alreadyMarked, 2);
  assert.equal(res.data.newlyMarked, 0);
  assert.equal(res.data.unmatched, 1);
  assert.equal(contacts.writes.length, before);
});

test('a second import never moves a date already set', async () => {
  const { byProject, deps } = setup();
  await importSubscribers({ csv: CSV }, SCOPE, deps);
  await importSubscribers({ csv: 'email,subscription_date\ndane@alphire.agency,2027-01-01\n' }, SCOPE, deps);
  assert.equal(byProject.proj_a[0].customFields[SUBSCRIBED_FIELD], '2026-10-01T00:00:00.000Z');
});

test('no date column marks with the import time and says which column was missing', async () => {
  const { byProject, deps } = setup();
  const res = await importSubscribers({ csv: 'email\ndane@alphire.agency\n' }, SCOPE, deps);
  assert.equal(res.data.dateColumn, '');
  assert.equal(byProject.proj_a[0].customFields[SUBSCRIBED_FIELD], '2026-10-09T12:00:00.000Z');
});

test('every row is accounted for: matched + unmatched + unreadable = rows read', async () => {
  const { deps } = setup();
  const res = await importSubscribers({ csv: `${CSV},2026-10-01\nbad,2026-10-01\n` }, SCOPE, deps);
  const d = res.data;
  assert.equal(d.matched + d.unmatched + d.unreadable, d.rowsRead);
  assert.equal(d.matched, d.newlyMarked + d.alreadyMarked);
});

test('a refused contact write stops the import and says how far it got', async () => {
  const { contacts, deps } = setup();
  contacts.updateContact = async () => ({ ok: false, status: 500, error: 'database down' });
  const res = await importSubscribers({ csv: CSV }, SCOPE, deps);
  assert.equal(res.ok, false);
  assert.match(res.error, /database down.*0 contact\(s\) were marked/);
});

test('no project, an unknown field, and a missing csv are refused', async () => {
  const { deps } = setup();
  assert.equal((await importSubscribers({ csv: CSV }, {}, deps)).ok, false);
  assert.match((await importSubscribers({ csv: CSV, extra: 1 }, SCOPE, deps)).error, /Unknown field: extra/);
  assert.match((await importSubscribers({}, SCOPE, deps)).error, /csv is empty/);
  assert.equal((await importSubscribers({ csv: CSV }, OTHER, deps)).data.matched, 1, 'project B has its own contact');
});

// ── The counts ───────────────────────────────────────────────────────────────

function statsDeps({ items = [], notesFail = false } = {}) {
  const byProject = {
    proj_a: [
      { id: 'c_sub', email: 'sub@x.co', customFields: { [SUBSCRIBED_FIELD]: '2026-10-01T00:00:00.000Z' } },
      { id: 'c_plain', email: 'plain@x.co', customFields: {} },
      { id: 'c_cand', email: 'cand@x.co', customFields: { [SUBSCRIBED_FIELD]: '2026-10-01T00:00:00.000Z' } },
    ],
  };
  const candidates = [
    { id: 'w1', handle: 'alpha', status: 'approved', contactId: 'c_sub' },
    { id: 'w2', handle: 'beta', status: 'approved', contactId: 'c_plain',
      recentNotes: [{ url: 'https://substack.com/@betaperson/note/c-200', text: '', postedAt: null }] },
    { id: 'w3', handle: 'gamma', status: 'candidate', contactId: 'c_cand' },
    { id: 'w4', handle: 'delta', status: 'rejected', contactId: '' },
  ];
  return {
    contactsStore: fakeContacts(byProject),
    minerStore: fakeMiner(candidates),
    notesStore: fakeNotes(items, { fail: notesFail }),
  };
}

test('Subscribed counts approved writers whose contact is marked — not candidates whose contact is', async () => {
  const res = await minerStats(SCOPE, statsDeps());
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(
    { found: res.data.found, approved: res.data.approved, rejected: res.data.rejected, inContacts: res.data.inContacts },
    { found: 4, approved: 2, rejected: 1, inContacts: 3 }
  );
  assert.equal(res.data.subscribed, 1);
  assert.equal(res.data.engaged, 0);
  assert.deepEqual(res.data.unknown, []);
});

test('Engaged rises by one when a like on an approved writer\'s Note reaches posted', async () => {
  const like = { kind: 'like', status: 'posting', targetUrl: 'https://substack.com/@alpha/note/c-100' };
  const before = await minerStats(SCOPE, statsDeps({ items: [like] }));
  assert.equal(before.data.engaged, 0, 'posting is not posted');
  const after = await minerStats(SCOPE, statsDeps({ items: [{ ...like, status: 'posted' }] }));
  assert.equal(after.data.engaged, 1);
});

test('a Note in the writer\'s recent_notes counts even when its @name is not their handle', async () => {
  const reply = { kind: 'reply', status: 'posted', targetUrl: 'https://substack.com/@betaperson/note/c-200/' };
  const res = await minerStats(SCOPE, statsDeps({ items: [reply] }));
  assert.equal(res.data.engaged, 1);
});

test('our own Notes, and a Note aimed at a writer who is not approved, do not count as engaged', async () => {
  const items = [
    { kind: 'note', status: 'posted', targetUrl: '' },
    { kind: 'like', status: 'posted', targetUrl: 'https://substack.com/@gamma/note/c-1' },
  ];
  const res = await minerStats(SCOPE, statsDeps({ items }));
  assert.equal(res.data.engaged, 0);
});

test('a Notes table that cannot be read makes Engaged null with the reason, never 0', async () => {
  const res = await minerStats(SCOPE, statsDeps({ notesFail: true }));
  assert.equal(res.ok, true);
  assert.equal(res.data.engaged, null);
  assert.equal(res.data.unknown[0].count, 'engaged');
  assert.match(res.data.unknown[0].reason, /not available/);
  assert.equal(res.data.subscribed, 1, 'the other count is still taken');
});

test('Note addresses compare without case, www or a trailing slash', () => {
  assert.equal(noteKey('https://www.Substack.com/@A/note/c-1/'), noteKey('https://substack.com/@a/note/c-1'));
  assert.equal(noteHandle('https://substack.com/@Kind.Of/note/c-9'), 'kind.of');
  assert.equal(noteHandle('https://substack.com/note/c-9'), '');
});
