'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * YouTube outreach 6/7 (86bcda6bg) — the scheduled drafting pass and its due
 * rules. The rules are pure and tested directly; the pass runs against the
 * same fake database the 4/7 tests use, built from both setup SQL files, with
 * a stand-in "model" so every draft is known in advance.
 */

const schedule = require('../../lib/youtubeOutreachSchedule.js');

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const TARGETS_SQL = path.join(SQL_DIR, 'youtube_outreach_setup.sql');
const COMMENTS_SQL = path.join(SQL_DIR, 'youtube_outreach_comments_setup.sql');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const targetsStorePath = require.resolve('../../lib/youtubeOutreachStore.js');
const commentsStorePath = require.resolve('../../lib/youtubeOutreachCommentsStore.js');
const runDuePath = require.resolve('../../lib/youtubeOutreachRunDue.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const NOON = Date.parse('2026-10-08T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const GOOD = 'The bit about practising the serve toss without a racket first finally made it click for me. Does the same drill work for a kick serve?';

// ── The due rules (pure) ────────────────────────────────────────────────────

const ONCE = { id: 't1', status: 'active', repeatMode: 'once', priority: 'normal', createdAt: '2026-10-01T00:00:00Z' };
const REPEAT = { id: 't2', status: 'active', repeatMode: 'repeat', repeatEveryDays: 7, repeatMaxTimes: 3, repeatUntil: null, priority: 'normal', createdAt: '2026-10-01T00:00:00Z' };
const posted = (targetId, atMs) => ({ targetId, status: 'posted', postedAt: new Date(atMs).toISOString() });

test('a one-off with nothing waiting is due; once posted it is finished, "posted 1 of 1"', () => {
  assert.equal(schedule.evaluateTarget({ target: ONCE, comments: [], now: NOON }).due, true);
  const done = schedule.evaluateTarget({ target: ONCE, comments: [posted('t1', NOON - DAY)], now: NOON });
  assert.equal(done.due, false);
  assert.equal(done.finished, true);
  assert.equal(done.text, 'Finished: posted 1 of 1');
});

test('a rejected draft or a failed post does not use up a one-off', () => {
  const comments = [{ targetId: 't1', status: 'rejected' }, { targetId: 't1', status: 'failed' }];
  assert.equal(schedule.evaluateTarget({ target: ONCE, comments, now: NOON }).due, true);
});

test('ONE WAITING PER TARGET: a draft waiting, or an approved comment not yet posted, blocks a second draft', () => {
  const waiting = schedule.evaluateTarget({ target: ONCE, comments: [{ targetId: 't1', status: 'draft' }], now: NOON });
  assert.equal(waiting.due, false);
  assert.equal(waiting.text, 'Not due: waiting for your approval on the last draft');
  for (const status of ['approved', 'posting']) {
    const v = schedule.evaluateTarget({ target: REPEAT, comments: [{ targetId: 't2', status }], now: NOON });
    assert.equal(v.due, false, status);
    assert.equal(v.reason, 'awaiting_post', status);
  }
});

test('a paused target is never due, and says so', () => {
  const v = schedule.evaluateTarget({ target: { ...ONCE, status: 'paused' }, comments: [], now: NOON });
  assert.deepEqual([v.due, v.text], [false, 'Not due: paused']);
});

test('a repeat is due every N days after its last post, and shows the next date', () => {
  const recent = schedule.evaluateTarget({ target: REPEAT, comments: [posted('t2', NOON - 2 * DAY)], now: NOON, timeZone: 'UTC' });
  assert.equal(recent.due, false);
  assert.equal(recent.text, 'Next draft: Oct 13');
  const later = schedule.evaluateTarget({ target: REPEAT, comments: [posted('t2', NOON - 8 * DAY)], now: NOON, timeZone: 'UTC' });
  assert.equal(later.due, true);
});

test('a repeat stops at its maximum count and after its stop date', () => {
  const used = [0, 1, 2].map((n) => posted('t2', NOON - (30 - n * 8) * DAY));
  const full = schedule.evaluateTarget({ target: REPEAT, comments: used, now: NOON });
  assert.deepEqual([full.due, full.finished, full.text], [false, true, 'Finished: posted 3 of 3']);
  const stopped = schedule.evaluateTarget({ target: { ...REPEAT, repeatUntil: '2026-10-01' }, comments: [], now: NOON });
  assert.equal(stopped.finished, true);
  assert.match(stopped.text, /repeats stopped on 2026-10-01/);
});

test('higher priority goes first, then the target added first', () => {
  const targets = [
    { ...ONCE, id: 'low', priority: 'low', createdAt: '2026-09-01T00:00:00Z' },
    { ...ONCE, id: 'new-high', priority: 'high', createdAt: '2026-10-05T00:00:00Z' },
    { ...ONCE, id: 'old-high', priority: 'high', createdAt: '2026-10-02T00:00:00Z' },
  ];
  const plan = schedule.planAccount({ targets, accountComments: [], settings: { maxCommentsPerDay: 10 }, now: NOON, timeZone: 'UTC' });
  assert.deepEqual(plan.draft.map((t) => t.id), ['old-high', 'new-high', 'low']);
});

test('the daily maximum caps drafting: posted today plus waiting already count against it', () => {
  const targets = ['a', 'b', 'c', 'd'].map((id) => ({ ...ONCE, id }));
  const accountComments = [
    posted('x', NOON - 60 * 60 * 1000), // earlier today
    posted('y', NOON - 2 * DAY), // not today
    { targetId: 'z', status: 'draft' },
  ];
  const plan = schedule.planAccount({ targets, accountComments, settings: { maxCommentsPerDay: 4 }, now: NOON, timeZone: 'UTC' });
  assert.equal(plan.allowance.allowance, 2, '4 a day, 1 posted today, 1 waiting');
  assert.deepEqual(plan.draft.map((t) => t.id), ['a', 'b']);
  assert.equal(plan.held.length, 2);
  assert.match(plan.verdicts.get('c').text, /daily maximum is 4 comments, and 1 posted today plus 1 waiting/);
  const none = schedule.planAccount({ targets, accountComments: [], settings: { maxCommentsPerDay: 0 }, now: NOON, timeZone: 'UTC' });
  assert.equal(none.draft.length, 0, 'a maximum of 0 drafts nothing');
});

test('"today" for the daily maximum is the account\'s own calendar day', () => {
  // 03:00 UTC on Oct 8 is still Oct 7 in Denver.
  const accountComments = [posted('x', Date.parse('2026-10-08T03:00:00Z'))];
  const settings = { maxCommentsPerDay: 1 };
  assert.equal(schedule.draftAllowance({ settings, accountComments, now: NOON, timeZone: 'UTC' }).allowance, 0);
  assert.equal(schedule.draftAllowance({ settings, accountComments, now: NOON, timeZone: 'America/Denver' }).allowance, 1);
});

// ── The pass, against the fake database ─────────────────────────────────────

function withDb() {
  const schema = parseSchemaText(`${fs.readFileSync(TARGETS_SQL, 'utf8')}\n${fs.readFileSync(COMMENTS_SQL, 'utf8')}`);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      youtubeOutreachTargets: 'youtube_outreach_targets',
      youtubeOutreachSettings: 'youtube_outreach_settings',
      youtubeOutreachComments: 'youtube_outreach_comments',
    }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  const paths = [projectScopePath, targetsStorePath, commentsStorePath, runDuePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of paths) delete require.cache[p];
  const targets = require(targetsStorePath);
  const comments = require(commentsStorePath);
  const runner = require(runDuePath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of paths) delete require.cache[p];
  }
  return { db, targets, comments, runner, restore };
}

const lookup = async (videoId) => ({ ok: true, data: { title: `Video ${videoId}`, channelName: 'Some Channel', channelId: 'UC123', publishedAt: '2026-09-01T12:00:00Z', viewCount: 10 } });
const quietVideo = async () => ({ description: 'A serve lesson.', topComments: [], note: '' });

function model() {
  const asked = [];
  return { asked, generate: async (system, prompt) => { asked.push(prompt); return { ok: true, text: JSON.stringify({ comment: GOOD }) }; } };
}

async function addTarget(targets, videoId, input = {}, scope = SCOPE_A) {
  const created = await targets.createTarget({ videoUrl: `https://www.youtube.com/watch?v=${videoId}`, ...input }, scope, { lookup });
  assert.equal(created.ok, true, created.error);
  return created.data;
}

function pass(runner, m, extra = {}) {
  return runner.runDue({ now: NOON, generate: m.generate, readVideo: quietVideo, projectTimeZone: async () => 'UTC', ...extra });
}

async function markPosted(db, commentId, atMs) {
  const res = await db.sbQuery({
    method: 'PATCH',
    table: 'youtube_outreach_comments',
    query: `id=eq.${commentId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { status: 'posted', posted_at: new Date(atMs).toISOString(), final_text: GOOD },
  });
  assert.equal(res.ok, true, res.error);
}

test('two active targets and nothing waiting: one pass leaves exactly one draft per target', async () => {
  const { targets, comments, runner, restore } = withDb();
  try {
    const a = await addTarget(targets, 'aaaaaaaaaaa');
    const b = await addTarget(targets, 'bbbbbbbbbbb');
    const m = model();
    const result = await pass(runner, m);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.data.drafted.length, 2);
    assert.deepEqual(result.data.failed, []);
    const waiting = await comments.listComments(50, SCOPE_A, { statuses: ['draft'] });
    assert.deepEqual(waiting.data.map((c) => c.targetId).sort(), [a.id, b.id].sort());
    assert.ok(waiting.data.every((c) => c.draftText === GOOD));
  } finally {
    restore();
  }
});

test('a target with a draft waiting gets no second draft on the next pass (nor the one after)', async () => {
  const { targets, comments, runner, restore } = withDb();
  try {
    await addTarget(targets, 'aaaaaaaaaaa');
    await addTarget(targets, 'bbbbbbbbbbb');
    const m = model();
    await pass(runner, m);
    const asks = m.asked.length;
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const again = await pass(runner, m, { now: NOON + (i + 1) * 10 * 60 * 1000 });
      assert.equal(again.data.drafted.length, 0);
    }
    assert.equal(m.asked.length, asks, 'the AI was not even asked');
    const all = await comments.listComments(50, SCOPE_A, {});
    assert.equal(all.data.length, 2);
  } finally {
    restore();
  }
});

test('the store refuses a scheduled draft when one is already waiting, even if the plan missed it', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const a = await addTarget(targets, 'aaaaaaaaaaa');
    const m = model();
    const first = await comments.writeDraftForTarget(a.id, SCOPE_A, { generate: m.generate, readVideo: quietVideo });
    assert.equal(first.ok, true, first.error);
    const second = await comments.writeDraftForTarget(a.id, SCOPE_A, { generate: m.generate, readVideo: quietVideo, onlyIfNoneWaiting: true });
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.match(second.error, /already has a comment waiting for approval/);
  } finally {
    restore();
  }
});

test('a one-off that has posted is marked done, shows "Finished", and is never drafted again; a repeat shows its next date', async () => {
  const { db, targets, comments, runner, restore } = withDb();
  try {
    const once = await addTarget(targets, 'aaaaaaaaaaa');
    const rep = await addTarget(targets, 'bbbbbbbbbbb', { repeatMode: 'repeat', repeatEveryDays: 7, repeatMaxTimes: 3 });
    const m = model();
    await pass(runner, m, { now: NOON - DAY });
    const drafts = (await comments.listComments(50, SCOPE_A, { statuses: ['draft'] })).data;
    for (const d of drafts) await markPosted(db, d.id, NOON - DAY); // eslint-disable-line no-await-in-loop

    const result = await pass(runner, m);
    assert.equal(result.data.drafted.length, 0);
    assert.deepEqual(result.data.finished.map((f) => f.targetId), [once.id]);
    assert.equal((await targets.getTargetById(once.id, SCOPE_A)).data.status, 'done');

    const listed = (await targets.listTargets(50, SCOPE_A)).data;
    const described = await runner.describeSchedule(listed, SCOPE_A, { projectTimeZone: async () => 'UTC', now: NOON });
    assert.equal(described.ok, true, described.error);
    assert.equal(described.data[once.id].text, 'Finished: posted 1 of 1');
    assert.equal(described.data[rep.id].text, 'Next draft: Oct 14');

    const later = await pass(runner, m, { now: NOON + 7 * DAY });
    assert.deepEqual(later.data.drafted.map((d) => d.targetId), [rep.id], 'only the repeat comes due again');
  } finally {
    restore();
  }
});

test('paused targets are skipped, and each project is drafted in its own scope', async () => {
  const { targets, comments, runner, restore } = withDb();
  try {
    const paused = await addTarget(targets, 'aaaaaaaaaaa', { status: 'paused' });
    const other = await addTarget(targets, 'bbbbbbbbbbb', {}, SCOPE_B);
    const result = await pass(runner, model());
    assert.deepEqual(result.data.drafted.map((d) => d.targetId), [other.id]);
    assert.equal((await comments.listComments(50, SCOPE_A, {})).data.length, 0, `paused ${paused.id} got nothing`);
    const theirs = (await comments.listComments(50, SCOPE_B, {})).data;
    assert.equal(theirs.length, 1);
    assert.equal(theirs[0].projectId, 'proj_b');
  } finally {
    restore();
  }
});

test('the daily maximum holds back the rest, and the pass says how many it held', async () => {
  const { targets, runner, restore } = withDb();
  try {
    const saved = await targets.saveSettings({ maxCommentsPerDay: 1 }, SCOPE_A);
    assert.equal(saved.ok, true, saved.error);
    await addTarget(targets, 'aaaaaaaaaaa', { priority: 'low' });
    const high = await addTarget(targets, 'bbbbbbbbbbb', { priority: 'high' });
    const result = await pass(runner, model());
    assert.deepEqual(result.data.drafted.map((d) => d.targetId), [high.id], 'the high-priority one goes first');
    assert.equal(result.data.held.length, 1);
  } finally {
    restore();
  }
});

test('a failed AI call is reported per target, never as "nothing was due"', async () => {
  const { targets, runner, restore } = withDb();
  try {
    await addTarget(targets, 'aaaaaaaaaaa');
    const result = await runner.runDue({
      now: NOON, readVideo: quietVideo, projectTimeZone: async () => 'UTC',
      generate: async () => ({ ok: false, error: 'credit exhausted' }),
    });
    assert.equal(result.data.drafted.length, 0);
    assert.equal(result.data.failed.length, 1);
    assert.match(result.data.failed[0].error, /credit exhausted/);
  } finally {
    restore();
  }
});

// ── The route ───────────────────────────────────────────────────────────────

test('run-due is cron-only: a signed-in session is refused, and the path is on the cron list and the schedule', async () => {
  const route = require('../../routes/youtubeOutreach.js');
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h || {}); },
    end(b) { this.body = String(b || ''); },
  };
  const req = { method: 'GET', url: '/api/youtube-outreach/run-due', headers: { host: 'localhost' }, cronPublish: false,
    authUser: { id: 'user_1' }, projectContext: { project: { id: 'proj_a' } } };
  const handled = await route.handle(req, res, '/api/youtube-outreach/run-due', 'GET');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /CRON_ONLY/);

  const indexSource = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  assert.match(indexSource, /'\/api\/youtube-outreach\/run-due'/, 'missing from CRON_PATHS: Vercel Cron would get a 401');
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/youtube-outreach/run-due'), 'not scheduled in vercel.json');
});
