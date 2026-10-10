'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Miner 5/7 (86bcfpry0) — an approved writer's newest Notes are kept
 * on the writer and lined up on the Substack Notes screen as one like and one
 * reply, never twice; the reading pass skips writers read within 7 days.
 *
 * Both stores are the REAL ones over ONE fake database whose schema is read
 * from both setup files, so a column the SQL lacks fails here too.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const minerPath = require.resolve('../../lib/substackMinerStore.js');
const notesPath = require.resolve('../../lib/substackNotesStore.js');
const capturePath = require.resolve('../../lib/acquire/SubstackNotesCapture.js');
const runPath = require.resolve('../../lib/acquire/SubstackNotesReadRun.js');
const ALL = [projectScopePath, minerPath, notesPath, capturePath, runPath];

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withDb() {
  const sql = ['substack_miner_setup.sql', 'substack_notes_setup.sql']
    .map((f) => fs.readFileSync(path.join(SQL_DIR, f), 'utf8')).join('\n');
  const db = createFakeDb(parseSchemaText(sql));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackCandidates: 'substack_candidates',
      substackMinerSettings: 'substack_miner_settings',
      substackNotesItems: 'substack_notes_items',
      substackNotesSettings: 'substack_notes_settings',
    }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of ALL) delete require.cache[p];
  const miner = require(minerPath);
  const notes = require(notesPath);
  const capture = require(capturePath);
  const run = require(runPath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { db, miner, notes, capture, run, restore };
}

async function approvedWriter(miner, handle = 'alpha', scope = SCOPE_A) {
  const made = await miner.upsertCandidate({ handle, name: `${handle} writer` }, scope);
  assert.equal(made.ok, true, made.error);
  const approved = await miner.updateCandidate(made.data.id, { status: 'approved' }, scope);
  assert.equal(approved.ok, true, approved.error);
  return approved.data;
}

const THREE = [
  { url: 'https://substack.com/@alpha/note/c-101', text: 'oldest', postedAt: '2026-10-01T10:00:00Z' },
  { url: 'https://substack.com/@alpha/note/c-303', text: 'newest', postedAt: '2026-10-08T10:00:00Z' },
  { url: 'https://substack.com/@alpha/note/c-202', text: 'middle', postedAt: '2026-10-05T10:00:00Z' },
];

async function itemsFor(notes, scope = SCOPE_A) {
  const res = await notes.listItems(200, scope);
  assert.equal(res.ok, true, res.error);
  return res.data;
}

// ── The endpoint's job: store, and line up ONE like and ONE reply ─────────────

test('3 Notes for an approved writer: 3 stored newest first, exactly one like and one reply for the newest', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    const res = await capture.captureCandidateNotes(writer.id, THREE, SCOPE_A);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.stored, 3);
    assert.deepEqual(res.data.candidate.recentNotes.map((n) => n.text), ['newest', 'middle', 'oldest']);
    assert.ok(res.data.candidate.lastNotesReadAt, 'last_notes_read_at is stamped');

    const items = await itemsFor(notes);
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.kind).sort(), ['like', 'reply']);
    for (const item of items) {
      assert.equal(item.source, 'target');
      assert.equal(item.targetUrl, 'https://substack.com/@alpha/note/c-303');
      assert.equal(item.targetText, 'newest');
      assert.equal(item.status, 'idea');
    }
  } finally { restore(); }
});

test('SAME NOTES TWICE: posting the same 3 again creates no new items', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    await capture.captureCandidateNotes(writer.id, THREE, SCOPE_A);
    const again = await capture.captureCandidateNotes(writer.id, THREE, SCOPE_A);
    assert.equal(again.ok, true, again.error);
    assert.equal(again.data.linedUp.like.created, false);
    assert.equal(again.data.linedUp.reply.created, false);
    assert.equal((await itemsFor(notes)).length, 2, 'still one like and one reply, never two');
    assert.equal(again.data.candidate.recentNotes.length, 3, 'the kept Notes are not doubled either');
  } finally { restore(); }
});

test('the same Note under a different spelling of its link still counts as already lined up', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    await capture.captureCandidateNotes(writer.id, THREE, SCOPE_A);
    const respelled = [{ ...THREE[1], url: 'https://www.substack.com/@alpha/note/c-303/' }];
    const again = await capture.captureCandidateNotes(writer.id, respelled, SCOPE_A);
    assert.equal(again.ok, true, again.error);
    assert.equal((await itemsFor(notes)).length, 2);
  } finally { restore(); }
});

test('a reply Dane already rejected for that Note is not offered again; only the missing like is made', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    const reply = await notes.createItem({ kind: 'reply', source: 'target', targetUrl: THREE[1].url }, SCOPE_A);
    assert.equal(reply.ok, true, reply.error);
    const rejected = await notes.updateItem(reply.data.id, { status: 'rejected' }, SCOPE_A);
    assert.equal(rejected.ok, true, rejected.error);

    const res = await capture.captureCandidateNotes(writer.id, THREE, SCOPE_A);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.linedUp.reply.created, false);
    assert.equal(res.data.linedUp.like.created, true);
    const items = await itemsFor(notes);
    assert.equal(items.filter((i) => i.kind === 'reply').length, 1);
    assert.equal(items.filter((i) => i.kind === 'like').length, 1);
  } finally { restore(); }
});

test('a newer Note next week gets its own like and reply', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    await capture.captureCandidateNotes(writer.id, THREE, SCOPE_A);
    const next = [{ url: 'https://substack.com/@alpha/note/c-404', text: 'next week', postedAt: '2026-10-15T10:00:00Z' }, THREE[1]];
    const res = await capture.captureCandidateNotes(writer.id, next, SCOPE_A);
    assert.equal(res.ok, true, res.error);
    assert.equal((await itemsFor(notes)).length, 4);
    assert.deepEqual(res.data.candidate.recentNotes.map((n) => n.text), ['next week', 'newest', 'middle', 'oldest']);
  } finally { restore(); }
});

test('a writer who is not approved is refused, and nothing is stored or lined up', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const made = await miner.upsertCandidate({ handle: 'beta' }, SCOPE_A);
    const res = await capture.captureCandidateNotes(made.data.id, THREE, SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /not approved/);
    assert.equal((await itemsFor(notes)).length, 0);
    assert.equal((await miner.getCandidateById(made.data.id, SCOPE_A)).data.lastNotesReadAt, null);
  } finally { restore(); }
});

test('another project cannot post Notes onto this project\'s writer', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    const res = await capture.captureCandidateNotes(writer.id, THREE, SCOPE_B);
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal((await itemsFor(notes, SCOPE_A)).length, 0);
    assert.equal((await itemsFor(notes, SCOPE_B)).length, 0);
  } finally { restore(); }
});

test('a link that is not a Note, or a missing date, is refused by position before anything is written', async () => {
  const { miner, notes, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    const bad = await capture.captureCandidateNotes(writer.id, [THREE[0], { url: 'https://alpha.substack.com/p/a-post', text: 'x', postedAt: '2026-10-01T00:00:00Z' }], SCOPE_A);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /notes\[1\]\.url/);
    const undated = await capture.captureCandidateNotes(writer.id, [{ url: THREE[0].url, text: 'x' }], SCOPE_A);
    assert.equal(undated.ok, false);
    assert.match(undated.error, /notes\[0\]\.postedAt/);
    assert.equal((await itemsFor(notes)).length, 0);
  } finally { restore(); }
});

test('at most 10 Notes are kept, newest first', async () => {
  const { miner, capture, restore } = withDb();
  try {
    const writer = await approvedWriter(miner);
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      url: `https://substack.com/@alpha/note/c-${1000 + i}`,
      text: `n${i}`,
      postedAt: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
    }));
    const res = await capture.captureCandidateNotes(writer.id, twelve, SCOPE_A);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.candidate.recentNotes.length, 10);
    assert.equal(res.data.candidate.recentNotes[0].text, 'n11');
  } finally { restore(); }
});

// ── The reading pass ─────────────────────────────────────────────────────────

/** A stand-in Substack: profiles by handle, feeds by user id. Counts every read. */
function fakeSubstack({ profiles = {}, feeds = {}, archives = {} } = {}) {
  const reads = [];
  return {
    reads,
    async fetchJson(url) {
      reads.push(url);
      let m = /\/api\/v1\/user\/([^/]+)\/public_profile$/.exec(url);
      if (m) return profiles[m[1]] ? { ok: true, data: profiles[m[1]] } : { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
      m = /^https:\/\/([^.]+)\.substack\.com\/api\/v1\/archive/.exec(url);
      if (m) return archives[m[1]] ? { ok: true, data: archives[m[1]] } : { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
      m = /\/reader\/feed\/profile\/(\d+)\?/.exec(url);
      if (m) return feeds[m[1]] ? { ok: true, data: feeds[m[1]] } : { ok: false, httpStatus: 500, reason: 'answered HTTP 500' };
      return { ok: false, httpStatus: 0, reason: `unexpected address ${url}` };
    },
  };
}

/** One feed item in the shape Substack answered on 2026-10-10 (the Note marker is on `context`). */
function noteItem(id, userId, handle, date, body, extra = {}, contextType = 'note') {
  return {
    type: 'comment',
    context: { type: contextType },
    comment: { id, user_id: userId, handle, date, body, type: 'feed', ancestor_path: '', ...extra },
  };
}

const NOON_UTC = Date.parse('2026-10-10T12:00:00Z');

function runDeps(substack, overrides = {}) {
  return { fetchJson: substack.fetchJson, sleep: async () => {}, now: () => NOON_UTC, ...overrides };
}

test('the pass reads an approved writer\'s own newest 3 Notes and lines up a like and a reply', async () => {
  const { miner, notes, run, restore } = withDb();
  try {
    await approvedWriter(miner, 'alpha');
    const substack = fakeSubstack({
      profiles: { alpha: { id: 77, handle: 'alpha', primaryPublication: { subdomain: 'alpha' } } },
      feeds: {
        77: {
          items: [
            noteItem(5, 77, 'alpha', '2026-10-01T00:00:00Z', 'five'),
            noteItem(9, 77, 'alpha', '2026-10-09T00:00:00Z', 'nine'),
            noteItem(8, 999, 'stranger', '2026-10-09T05:00:00Z', 'a restack of somebody else'),
            noteItem(7, 77, 'alpha', '2026-10-07T00:00:00Z', 'a reply', { ancestor_path: '6' }),
            noteItem(6, 77, 'alpha', '2026-10-06T00:00:00Z', 'six'),
            noteItem(10, 77, 'alpha', '2026-10-09T09:00:00Z', 'not a Note at all', {}, 'post'),
            noteItem(4, 77, 'alpha', '2026-09-30T00:00:00Z', 'four'),
          ],
        },
      },
    });
    const res = await run.runSubstackNotesRead({}, SCOPE_A, runDeps(substack));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.read.length, 1);
    assert.equal(res.data.read[0].notes, 3);
    const writer = (await miner.listCandidates(10, SCOPE_A, { status: 'approved' })).data[0];
    assert.deepEqual(writer.recentNotes.map((n) => n.text), ['nine', 'six', 'five']);
    const items = await itemsFor(notes);
    assert.deepEqual(items.map((i) => i.targetUrl), ['https://substack.com/@alpha/note/c-9', 'https://substack.com/@alpha/note/c-9']);
    assert.match(run.formatReadSummary(res.data), /alpha writer: read 3 Notes — lined up a like and a reply/);
  } finally { restore(); }
});

test('7-DAY SKIP: a writer read within 7 days is skipped, counted and named, and Substack is not asked', async () => {
  const { miner, run, restore } = withDb();
  try {
    const writer = await approvedWriter(miner, 'alpha');
    await miner.recordRecentNotes(writer.id, [], SCOPE_A, { now: NOON_UTC - 2 * 24 * 60 * 60 * 1000 });
    const old = await approvedWriter(miner, 'beta');
    await miner.recordRecentNotes(old.id, [], SCOPE_A, { now: NOON_UTC - 8 * 24 * 60 * 60 * 1000 });

    const substack = fakeSubstack({
      profiles: { beta: { id: 88, handle: 'beta', primaryPublication: { subdomain: 'beta' } } },
      feeds: { 88: { items: [] } },
    });
    const res = await run.runSubstackNotesRead({}, SCOPE_A, runDeps(substack));
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.data.skipped.map((s) => s.handle), ['alpha']);
    assert.equal(res.data.skipped[0].ago, '2 days ago');
    assert.deepEqual(res.data.read.map((r) => r.handle), ['beta'], 'read 8 days ago is due again');
    assert.ok(substack.reads.every((u) => !u.includes('/alpha/')), 'the skipped writer cost no reads');
    const text = run.formatReadSummary(res.data);
    assert.match(text, /alpha writer: skipped, read 2 days ago/);
    assert.match(text, /1 skipped \(read in the last 7 days\)/);
  } finally { restore(); }
});

test('a profile that does not own the publication is NOT trusted; the publication\'s admin is used instead', async () => {
  const { miner, run, restore } = withDb();
  try {
    await approvedWriter(miner, 'alpha');
    const substack = fakeSubstack({
      // Somebody else holds the @alpha profile name.
      profiles: { alpha: { id: 5, handle: 'alpha', primaryPublication: { subdomain: 'somethingelse' } } },
      archives: {
        alpha: [{ publication_id: 321, publishedBylines: [
          { id: 6, handle: 'guest', is_guest: true, publicationUsers: [{ publication_id: 321, role: 'admin' }] },
          { id: 42, handle: 'realalpha', publicationUsers: [{ publication_id: 321, role: 'admin' }] },
        ] }],
      },
      feeds: { 42: { items: [noteItem(1, 42, 'realalpha', '2026-10-09T00:00:00Z', 'mine')] } },
    });
    const res = await run.runSubstackNotesRead({}, SCOPE_A, runDeps(substack));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.read[0].newestUrl, 'https://substack.com/@realalpha/note/c-1');
    assert.ok(!substack.reads.some((u) => u.includes('/profile/5?')), 'the stranger\'s Notes were never read');
  } finally { restore(); }
});

test('a writer nobody can be found for is NOT READ, named with why, and nothing is stamped', async () => {
  const { miner, run, restore } = withDb();
  try {
    const writer = await approvedWriter(miner, 'alpha');
    const res = await run.runSubstackNotesRead({}, SCOPE_A, runDeps(fakeSubstack()));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.failed.length, 1);
    assert.match(res.data.failed[0].reason, /could not tell who writes it/);
    assert.equal((await miner.getCandidateById(writer.id, SCOPE_A)).data.lastNotesReadAt, null, 'a failed read is retried next run, not skipped for a week');
    assert.match(run.formatReadSummary(res.data), /alpha writer: NOT READ/);
  } finally { restore(); }
});

test('outside the account\'s active hours it reads nothing and says when it will', async () => {
  const { miner, notes, run, restore } = withDb();
  try {
    await approvedWriter(miner, 'alpha');
    const saved = await notes.saveSettings({ activeStartHour: 8, activeEndHour: 22, timeZone: 'America/New_York' }, SCOPE_A);
    assert.equal(saved.ok, true, saved.error);
    const substack = fakeSubstack();
    // 06:00 UTC is 2am in New York.
    const res = await run.runSubstackNotesRead({}, SCOPE_A, runDeps(substack, { now: () => Date.parse('2026-10-10T06:00:00Z') }));
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /between 8am and 10pm \(America\/New_York\)/);
    assert.equal(substack.reads.length, 0);
    const byHand = await run.runSubstackNotesRead({ anyHour: true }, SCOPE_A, runDeps(substack, { now: () => Date.parse('2026-10-10T06:00:00Z') }));
    assert.equal(byHand.ok, true, byHand.error);
  } finally { restore(); }
});

test('no approved writers is a refusal that says what to do', async () => {
  const { run, restore } = withDb();
  try {
    const res = await run.runSubstackNotesRead({}, SCOPE_A, runDeps(fakeSubstack()));
    assert.equal(res.ok, false);
    assert.match(res.error, /no approved writers/);
  } finally { restore(); }
});
