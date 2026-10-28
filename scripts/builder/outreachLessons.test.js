'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Outreach wizard 13/19 (86bcrmbpm) — lessons from Dane's choices.
 *
 * The fake database reads its schema from the real SQL files
 * (outreach_feedback_setup.sql, outreach_lessons_setup.sql), so a tenant
 * column dropped from either fails here (landmine 12). That the drafters put
 * the lessons that are ON into their prompts, and record them as
 * lessons_used, is tested in each channel's own store test (search
 * "Outreach wizard 13/19" in redditComments, youtubeOutreachComments and
 * substackNotesDrafter .test.js), against that channel's real tables.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { lessonsSql } = require('./outreachLessonsSql.js');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const STORE_PATHS = ['../../lib/outreachFeedbackStore.js', '../../lib/outreachLessons.js'].map((p) => require.resolve(p));

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function schemaText() {
  const grant = /\ndo \$\$[\s\S]*?end \$\$;\s*$/i;
  return `${fs.readFileSync(path.join(SQL_DIR, 'outreach_feedback_setup.sql'), 'utf8').replace(grant, '\n')}\n${lessonsSql([])}`;
}

function withDb() {
  const db = createFakeDb(parseSchemaText(schemaText()));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({}),
    sbQuery: (req) => db.sbQuery(req),
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of STORE_PATHS) delete require.cache[p];
  const [feedback, lessons] = STORE_PATHS.map((p) => require(p));
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  }
  return { db, feedback, lessons, restore };
}

const START = Date.parse('2026-10-20T12:00:00Z');

/**
 * Put decisions in oldest first, one minute apart, so "newest first" is a
 * fact of the data and not of insertion order. Returns the saved rows,
 * oldest first.
 */
async function seed(db, entries, scope = SCOPE_A) {
  const saved = [];
  for (const [i, e] of entries.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.sbQuery({
      method: 'POST',
      table: 'outreach_feedback',
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [{
        project_id: scope.projectId,
        owner_user_id: scope.userId,
        channel: e.channel || 'reddit',
        item_id: `item-${i}`,
        item_kind: '',
        action: e.action,
        reason_tags: e.reasons || [],
        note: e.note || '',
        draft_text: e.draft || `Draft ${i}`,
        final_text: e.final || '',
        chosen_option: e.action === 'chose-option' ? 1 : null,
        created_at: new Date(START + i * 60000).toISOString(),
      }],
    });
    assert.equal(res.ok, true, res.error);
    saved.push(res.data[0]);
  }
  return saved;
}

/** A stand-in AI that answers with `lessons` and keeps what it was asked. */
function suggester(lessons) {
  const asked = [];
  return {
    asked,
    generate: async (system, prompt) => {
      asked.push({ system, prompt });
      return { ok: true, text: JSON.stringify({ lessons }) };
    },
  };
}

// Oldest first. Shown newest first, they are F6..F1 to the model: F1 the
// approval, F4 the edit, F2/F3/F5/F6 the four rejections. Saved spellings
// are as recordFeedback leaves them (trimmed), in mixed case.
const DECISIONS = [
  { action: 'rejected', reasons: ['too salesy'] },
  { action: 'rejected', reasons: ['too salesy', 'too long'] },
  { action: 'approved-edited', final: 'Shorter.' },
  { action: 'rejected', reasons: ['too salesy'] },
  { action: 'rejected', reasons: ['Too Salesy'] },
  { action: 'approved-as-is' },
];

// ── Suggesting ─────────────────────────────────────────────────────────────

test('after feedback is seeded, lessons are proposed, each citing the feedback behind it — counted in code, not by the model', async () => {
  const { db, lessons, restore } = withDb();
  try {
    const rows = (await seed(db, DECISIONS)).reverse(); // newest first, as F1..F6
    const model = suggester([
      // F2, F3, F5, F6: the four rejections, every one tagged "too salesy".
      { text: 'Never sound like you are selling something.', from: ['F2', 'F3', 'F5', 'F6'] },
      { text: '  Keep it short:\ttwo sentences. ', from: ['F4', 'f5'] },
      { text: 'Use more exclamation marks!', from: ['F99'] },
      { text: 'A lesson with nothing behind it.' },
    ]);
    const res = await lessons.refreshLessons('reddit', SCOPE_A, { generate: model.generate });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.added, 2);

    // The model was shown every decision under its label, with his reasons.
    assert.match(model.asked[0].prompt, /\[F1\] Reddit, APPROVED as written/);
    assert.match(model.asked[0].prompt, /\[F2\] Reddit, REJECTED\n {2}reasons: "Too Salesy"/);
    assert.match(model.asked[0].prompt, /\[F4\] Reddit, APPROVED after Dane edited it[\s\S]*his version: Shorter\./);

    const listed = await lessons.listLessons('reddit', SCOPE_A);
    assert.equal(listed.ok, true, listed.error);
    const [selling, short] = listed.data;
    assert.equal(selling.text, 'Never sound like you are selling something.');
    assert.equal(selling.why, 'from 4 rejections tagged "Too Salesy"');
    assert.deepEqual(selling.evidence.map((e) => e.feedbackId), [rows[1].id, rows[2].id, rows[4].id, rows[5].id]);
    assert.deepEqual(selling.evidence[0].reasons, ['Too Salesy']);
    assert.equal(short.text, 'Keep it short: two sentences.');
    // A tie between two reasons is broken A–Z.
    assert.equal(short.why, 'from 1 rejection tagged "too long" and 1 edit');
    assert.ok(listed.data.every((l) => l.enabled && l.source === 'suggested'));

    // BREAK TEST: a lesson citing only decisions it was not shown, or none, is dropped and named.
    assert.deepEqual(res.data.dropped.map((d) => d.text), ['Use more exclamation marks!', 'A lesson with nothing behind it.']);
    assert.match(res.data.dropped[0].reason, /named none of the decisions/);
  } finally {
    restore();
  }
});

test('a refresh replaces only suggestions he left alone: an off lesson stays off and is not re-suggested; edited and his own are kept', async () => {
  const { db, lessons, restore } = withDb();
  try {
    await seed(db, DECISIONS);
    const first = suggester([
      { text: 'Leave me alone.', from: ['F1'] },
      { text: 'Switch me off.', from: ['F2'] },
      { text: 'Edit me.', from: ['F3'] },
    ]);
    assert.equal((await lessons.refreshLessons('reddit', SCOPE_A, { generate: first.generate })).ok, true);
    const own = await lessons.createLesson({ channel: 'reddit', text: 'My own lesson.' }, SCOPE_A);
    const byText = Object.fromEntries((await lessons.listLessons('reddit', SCOPE_A)).data.map((l) => [l.text, l]));
    assert.equal((await lessons.updateLesson(byText['Switch me off.'].id, { enabled: false }, SCOPE_A)).ok, true);
    const edited = await lessons.updateLesson(byText['Edit me.'].id, { text: 'Edited by Dane.' }, SCOPE_A);
    assert.equal(edited.data.edited, true);

    const second = suggester([
      { text: 'switch me off', from: ['F4'] },
      { text: 'A fresh lesson.', from: ['F5'] },
    ]);
    const res = await lessons.refreshLessons('reddit', SCOPE_A, { generate: second.generate });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.replaced, 1);
    assert.match(second.asked[0].prompt, /switched OFF[^\n]*\n- Switch me off\./);
    assert.match(second.asked[0].prompt, /already in place[^\n]*\n(- .*\n)*- Edited by Dane\./);

    const after = (await lessons.listLessons('reddit', SCOPE_A)).data;
    assert.deepEqual(after.map((l) => [l.text, l.enabled]).sort(), [
      ['A fresh lesson.', true],
      ['Edited by Dane.', true],
      ['My own lesson.', true],
      ['Switch me off.', false],
    ]);
    assert.equal(after.find((l) => l.text === 'My own lesson.').id, own.data.id);
    assert.deepEqual(res.data.dropped.map((d) => d.reason), ['it is already a lesson, or one you switched off']);
  } finally {
    restore();
  }
});

test('a refresh whose AI fails, or answers nothing usable, changes nothing', async () => {
  const { db, lessons, restore } = withDb();
  try {
    await seed(db, DECISIONS);
    await lessons.refreshLessons('reddit', SCOPE_A, { generate: suggester([{ text: 'Keep me.', from: ['F1'] }]).generate });
    const failed = await lessons.refreshLessons('reddit', SCOPE_A, { generate: async () => ({ ok: false, error: 'rate limited' }) });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /rate limited\. Nothing was changed/);
    const garbled = await lessons.refreshLessons('reddit', SCOPE_A, { generate: async () => ({ ok: true, text: 'Sure! Here are some lessons.' }) });
    assert.match(garbled.error, /could not be read as a list of lessons/);
    const none = await lessons.refreshLessons('reddit', SCOPE_A, { generate: suggester([]).generate });
    assert.equal(none.ok, true);
    assert.match(none.data.note, /No new lessons/);
    assert.deepEqual((await lessons.listLessons('reddit', SCOPE_A)).data.map((l) => l.text), ['Keep me.']);
  } finally {
    restore();
  }
});

test('with no decisions recorded, a refresh says so and never asks the AI', async () => {
  const { lessons, restore } = withDb();
  try {
    const model = suggester([{ text: 'x', from: ['F1'] }]);
    const res = await lessons.refreshLessons('youtube', SCOPE_A, { generate: model.generate });
    assert.equal(res.status, 409);
    assert.match(res.error, /No decisions have been recorded on YouTube yet/);
    assert.equal(model.asked.length, 0);
  } finally {
    restore();
  }
});

test('an "all channels" refresh reads every channel\'s decisions; a channel refresh reads only its own', async () => {
  const { db, lessons, restore } = withDb();
  try {
    await seed(db, [{ channel: 'youtube', action: 'rejected', reasons: ['too long'] }, { channel: 'reddit', action: 'approved-as-is' }]);
    const all = suggester([]);
    await lessons.refreshLessons('all', SCOPE_A, { generate: all.generate });
    assert.match(all.asked[0].prompt, /on every channel[\s\S]*\[F1\] Reddit[\s\S]*\[F2\] YouTube/);
    const yt = suggester([]);
    await lessons.refreshLessons('youtube', SCOPE_A, { generate: yt.generate });
    assert.doesNotMatch(yt.asked[0].prompt, /Reddit,/);
  } finally {
    restore();
  }
});

test('every fifth decision on a channel refreshes its lessons, and only then', async () => {
  const { db, lessons, restore } = withDb();
  try {
    const model = suggester([{ text: 'Shorter.', from: ['F1'] }]);
    await seed(db, DECISIONS.slice(0, 4));
    assert.equal(await lessons.refreshIfDue('reddit', SCOPE_A, { generate: model.generate }), null);
    assert.equal(model.asked.length, 0);
    await seed(db, [{ action: 'rejected', reasons: ['too long'] }]);
    const due = await lessons.refreshIfDue('reddit', SCOPE_A, { generate: model.generate });
    assert.deepEqual(due, { refreshed: true, added: 1, error: '' });
    // Five on another channel do not count toward this one.
    assert.equal(await lessons.refreshIfDue('youtube', SCOPE_A, { generate: model.generate }), null);
    const failing = await lessons.refreshIfDue('reddit', SCOPE_A, { generate: async () => ({ ok: false, error: 'down' }) });
    assert.equal(failing.refreshed, false);
    assert.match(failing.error, /The lessons were not refreshed: The AI did not suggest any lessons: down/);
  } finally {
    restore();
  }
});

test('a decision recorded through attachFeedback still stands when the lessons refresh it triggers fails', async () => {
  const { db, feedback, restore } = withDb();
  const aiPath = require.resolve('../../lib/aiClient.js');
  const realAi = require.cache[aiPath];
  require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: { queryAnthropic: async () => ({ ok: false, error: 'no key in tests' }) } };
  try {
    await seed(db, DECISIONS.slice(0, 4));
    const decided = await feedback.attachFeedback({ ok: true, status: 200, data: { id: 'item-x', status: 'rejected' } },
      { channel: 'reddit', action: 'rejected', reasons: ['too long'] }, SCOPE_A);
    assert.equal(decided.ok, true);
    assert.equal(decided.data.feedback.recorded, true);
    assert.equal(decided.data.feedback.lessons.refreshed, false);
    assert.match(decided.data.feedback.lessons.error, /no key in tests/);
  } finally {
    if (realAi) require.cache[aiPath] = realAi;
    else delete require.cache[aiPath];
    restore();
  }
});

// ── The score ──────────────────────────────────────────────────────────────

test('the score matches a count taken by hand: of the newest 20 decisions, the ones approved in the draft\'s own words', async () => {
  const { db, lessons, restore } = withDb();
  try {
    // Oldest first. The first five are older than the newest 20, and are all
    // approvals — a score that read too far back would count them.
    const actions = [
      'approved-as-is', 'approved-as-is', 'approved-as-is', 'approved-as-is', 'approved-as-is',
      // The newest 20, by hand: as-is ×4, chose-option ×2 = 6 unedited.
      'rejected', 'approved-as-is', 'approved-edited', 'rejected', 'chose-option',
      'rejected', 'rejected', 'approved-edited', 'approved-as-is', 'rejected',
      'approved-edited', 'rejected', 'chose-option', 'rejected', 'approved-as-is',
      'rejected', 'approved-edited', 'rejected', 'approved-as-is', 'rejected',
    ];
    await seed(db, actions.map((action) => ({ action })));
    await seed(db, [{ channel: 'youtube', action: 'approved-as-is' }]);
    const view = await lessons.learnView('reddit', SCOPE_A);
    assert.equal(view.ok, true, view.error);
    assert.deepEqual(
      { unedited: view.data.score.unedited, counted: view.data.score.counted },
      { unedited: 6, counted: 20 },
    );
    assert.equal(view.data.score.sentence, 'Approved without edits, last 20: 6 of 20.');

    const yt = await lessons.learnView('youtube', SCOPE_A);
    assert.equal(yt.data.score.sentence, 'Approved without edits, last 1 (all there are so far): 1 of 1.');
    const fresh = await lessons.learnView('substack', SCOPE_A);
    assert.equal(fresh.data.score.sentence, 'Approved without edits: no decisions recorded yet.');
  } finally {
    restore();
  }
});

// ── His own, changing, deleting ─────────────────────────────────────────────

test('his own lesson is one line; a channel lesson and an all-channel lesson both show on that channel, all-channel first', async () => {
  const { lessons, restore } = withDb();
  try {
    assert.match((await lessons.createLesson({ channel: 'reddit', text: 'two\nlines' }, SCOPE_A)).error, /one line/);
    assert.match((await lessons.createLesson({ channel: 'reddit', text: '   ' }, SCOPE_A)).error, /empty/);
    assert.match((await lessons.createLesson({ channel: 'reddit', text: 'x'.repeat(161) }, SCOPE_A)).error, /160 characters at most/);
    assert.match((await lessons.createLesson({ channel: 'tiktok', text: 'x' }, SCOPE_A)).error, /channel must be one of/);
    assert.match((await lessons.createLesson({ channel: 'reddit', text: 'x', extra: 1 }, SCOPE_A)).error, /extra/);

    const mine = await lessons.createLesson({ channel: 'reddit', text: 'Ask one real question.' }, SCOPE_A);
    const all = await lessons.createLesson({ channel: 'all', text: 'No exclamation marks.' }, SCOPE_A);
    assert.equal(mine.data.source, 'dane');
    assert.equal(mine.data.why, 'You wrote this one.');
    const listed = await lessons.listLessons('reddit', SCOPE_A);
    assert.deepEqual(listed.data.map((l) => l.id), [all.data.id, mine.data.id]);
    assert.deepEqual((await lessons.listLessons('youtube', SCOPE_A)).data.map((l) => l.id), [all.data.id]);
  } finally {
    restore();
  }
});

test('change, switch off and delete — and another project can do none of them, nor see the lesson', async () => {
  const { lessons, restore } = withDb();
  try {
    const made = await lessons.createLesson({ channel: 'substack', text: 'Plain words.' }, SCOPE_A);
    const id = made.data.id;

    const theirs = await lessons.updateLesson(id, { enabled: false }, SCOPE_B);
    assert.equal(theirs.status, 404);
    assert.equal((await lessons.deleteLesson(id, SCOPE_B)).status, 404);
    assert.deepEqual((await lessons.listLessons('substack', SCOPE_B)).data, []);
    assert.equal((await lessons.listLessons('substack', SCOPE_A)).data[0].enabled, true);

    assert.match((await lessons.updateLesson(id, { enabled: 'no' }, SCOPE_A)).error, /true \(on\) or false \(off\)/);
    assert.match((await lessons.updateLesson(id, {}, SCOPE_A)).error, /Nothing to change/);
    assert.match((await lessons.updateLesson('not-an-id', { enabled: false }, SCOPE_A)).error, /not a lesson id/);
    const changed = await lessons.updateLesson(id, { text: 'Plainer words.', enabled: false }, SCOPE_A);
    assert.equal(changed.ok, true, changed.error);
    assert.deepEqual([changed.data.text, changed.data.enabled], ['Plainer words.', false]);

    const draftLessons = await lessons.lessonsForDraft('substack', SCOPE_A);
    assert.deepEqual(draftLessons.data, []);

    assert.equal((await lessons.deleteLesson(id, SCOPE_A)).ok, true);
    assert.equal((await lessons.deleteLesson(id, SCOPE_A)).status, 404);
    assert.deepEqual((await lessons.listLessons('substack', SCOPE_A)).data, []);
  } finally {
    restore();
  }
});

test('no project, or no user, is a refusal — never every project\'s lessons', async () => {
  const { lessons, restore } = withDb();
  try {
    assert.match((await lessons.listLessons('reddit', { userId: 'u' })).error, /No project is selected/);
    assert.match((await lessons.createLesson({ channel: 'reddit', text: 'x' }, { projectId: 'p' })).error, /both tenant columns/);
  } finally {
    restore();
  }
});

test('on a database without the lessons SQL, a read and a draft both name the file to run', async () => {
  const db = createFakeDb(parseSchemaText(fs.readFileSync(path.join(SQL_DIR, 'outreach_feedback_setup.sql'), 'utf8').replace(/\ndo \$\$[\s\S]*?end \$\$;\s*$/i, '\n')));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { isConfigured: () => true, tableConfig: () => ({}), sbQuery: (req) => db.sbQuery(req) } };
  for (const p of STORE_PATHS) delete require.cache[p];
  try {
    const lessons = require('../../lib/outreachLessons.js');
    const read = await lessons.listLessons('reddit', SCOPE_A);
    assert.equal(read.ok, false);
    assert.equal(read.code, 'SQL_NOT_RUN');
    assert.match(read.error, /run docs\/SQL\/outreach_lessons_setup\.sql/);
    const forDraft = await lessons.lessonsForDraft('reddit', SCOPE_A);
    assert.match(forDraft.error, /^Not written: .*outreach_lessons_setup\.sql/);
    const column = lessons.explainMissingLessonsColumn({ ok: false, status: 400, error: 'Could not find the \'lessons_used\' column of \'reddit_comment_items\'' });
    assert.match(column.error, /written but not saved: the lessons_used column is missing — run docs\/SQL\/outreach_lessons_setup\.sql/);
  } finally {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  }
});

// ── The routes ─────────────────────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: 0,
    body: '',
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h || {}); },
    end(b) { this.body = b || ''; },
  };
}

test('the routes reach the lessons store with the request\'s project, and refuse unknown methods', async () => {
  const route = require('../../routes/outreach');
  const calls = [];
  const lessons = {
    learnView: async (channel, scope) => (calls.push(['view', channel, scope.projectId]), { ok: true, status: 200, data: { lessons: [] } }),
    createLesson: async (body) => (calls.push(['create', body.text]), { ok: true, status: 201, data: {} }),
    updateLesson: async (id, body) => (calls.push(['update', id, body.enabled]), { ok: true, status: 200, data: {} }),
    deleteLesson: async (id) => (calls.push(['delete', id]), { ok: true, status: 200, data: {} }),
    refreshLessons: async (channel) => (calls.push(['refresh', channel]), { ok: true, status: 200, data: {} }),
  };
  const req = (method, url, body) => {
    const { Readable } = require('stream');
    const r = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(r, { method, url, headers: { 'content-type': 'application/json' }, projectContext: { project: { id: 'proj_a' } }, authUser: { id: 'user_1' }, socket: { remoteAddress: '127.0.0.1' } });
    return r;
  };
  const run = async (method, url, body) => {
    const res = fakeRes();
    const pathname = url.split('?')[0];
    await route.handle(req(method, url, body), res, pathname, method, { lessons });
    return res;
  };
  assert.equal((await run('GET', '/api/outreach/lessons?channel=reddit')).statusCode, 200);
  assert.equal((await run('POST', '/api/outreach/lessons', { channel: 'reddit', text: 'Hi.' })).statusCode, 201);
  assert.equal((await run('POST', '/api/outreach/lessons/abc', { enabled: false })).statusCode, 200);
  assert.equal((await run('DELETE', '/api/outreach/lessons/abc')).statusCode, 200);
  assert.equal((await run('POST', '/api/outreach/lessons/refresh', { channel: 'all' })).statusCode, 200);
  assert.equal((await run('PUT', '/api/outreach/lessons')).statusCode, 405);
  assert.deepEqual(calls, [
    ['view', 'reddit', 'proj_a'],
    ['create', 'Hi.'],
    ['update', 'abc', false],
    ['delete', 'abc'],
    ['refresh', 'all'],
  ]);
});
