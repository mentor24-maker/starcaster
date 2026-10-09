'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

/**
 * YouTube outreach 5/7 (86bcda68h) — the Mini's posting worker.
 *
 * The whole worker runs here against the SQL-backed fake database, a stand-in
 * OpenClaw and a stand-in YouTube. Nothing reaches the network. The real-site
 * check (one comment on a real video) waits for the Mini's browser to be signed
 * in, ticket 86bcfbvvq.
 *
 * The rules each test pins: the account limits (cap, gap, hours, no repeat),
 * "a row left `posting` is never retried", and "no link — or a link YouTube
 * disowns — is failed, never posted".
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const TARGETS_SQL = path.join(SQL_DIR, 'youtube_outreach_setup.sql');
const COMMENTS_SQL = path.join(SQL_DIR, 'youtube_outreach_comments_setup.sql');
const REPO = path.join(__dirname, '..', '..');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const targetsStorePath = require.resolve('../../lib/youtubeOutreachStore.js');
const commentsStorePath = require.resolve('../../lib/youtubeOutreachCommentsStore.js');

const limits = require('../../workers/youtube-outreach/limits.js');
const poster = require('../../workers/youtube-outreach/poster.js');
const youtube = require('../../workers/youtube-outreach/adapters/youtube.js');

const PROJECT = 'proj_doe';
const SCOPE = { projectId: PROJECT, userId: 'user_dane' };
const WORDS = 'The bit about practising the serve toss without a racket first finally made it click for me. Does the same drill work for a kick serve?';
const OTHER_WORDS = 'That slow-motion replay of the follow-through was the clearest explanation of the wrist snap I have seen. Thank you for filming it.';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function schemaText() {
  return `${fs.readFileSync(TARGETS_SQL, 'utf8')}\n${fs.readFileSync(COMMENTS_SQL, 'utf8')}`;
}

async function fakeLookup(videoId) {
  return { ok: true, data: { title: `Video ${videoId}`, channelName: 'Some Channel', channelId: 'UC1', publishedAt: '2026-09-01T12:00:00Z', viewCount: 1 } };
}

function withDb() {
  const db = createFakeDb(parseSchemaText(schemaText()));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      youtubeOutreachTargets: 'youtube_outreach_targets',
      youtubeOutreachSettings: 'youtube_outreach_settings',
      youtubeOutreachComments: 'youtube_outreach_comments',
    }),
    sbQuery: db.sbQuery,
  };
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [projectScopePath, targetsStorePath, commentsStorePath]) delete require.cache[p];
  const targets = require(targetsStorePath);
  const comments = require(commentsStorePath);
  return {
    db,
    targets,
    comments,
    restore() {
      if (real) require.cache[supabasePath] = real;
      else delete require.cache[supabasePath];
      for (const p of [projectScopePath, targetsStorePath, commentsStorePath]) delete require.cache[p];
    },
  };
}

/** Open all day, no gap: only the rule a test sets can hold anything. */
const OPEN = { activeStartHour: 0, activeEndHour: 24, minMinutesBetween: 0, jitterMinutes: 0, timeZone: 'UTC', maxCommentsPerDay: 10 };

async function setLimits(targets, overrides = {}) {
  const saved = await targets.saveSettings({ ...OPEN, ...overrides }, SCOPE);
  assert.equal(saved.ok, true, saved.error);
}

/** One target video with one approved comment on it. */
async function approvedComment({ targets, comments }, { videoId = 'dQw4w9WgXcQ', words = WORDS, target = {} } = {}) {
  let made = await targets.createTarget({ videoUrl: `https://www.youtube.com/watch?v=${videoId}`, ...target }, SCOPE, { lookup: fakeLookup });
  if (!made.ok && made.status === 409) {
    const list = await targets.listTargets(200, SCOPE);
    made = { ok: true, data: list.data.find((t) => t.videoId === videoId) };
  }
  assert.equal(made.ok, true, made.error);
  const draft = await comments.writeDraftForTarget(made.data.id, SCOPE, {
    generate: async () => ({ ok: true, text: JSON.stringify({ comment: words }) }),
    readVideo: async () => ({ description: '', topComments: [], note: '' }),
  });
  assert.equal(draft.ok, true, draft.error);
  const approved = await comments.approveComment(draft.data.id, {}, SCOPE);
  assert.equal(approved.ok, true, approved.error);
  return approved.data;
}

/**
 * A stand-in OpenClaw that "posts" by writing the comment into a stand-in
 * YouTube, unless told to misbehave. `calls` records every post request.
 */
function standIns({ behave = 'ok' } = {}) {
  const posted = new Map(); // comment id on "YouTube" -> { text, videoId }
  const calls = [];
  let seq = 0;
  const callOpenClaw = async (request) => {
    calls.push(request);
    const videoId = /watch\?v=([A-Za-z0-9_-]{11})/.exec(request.input)[1];
    const open = request.input.lastIndexOf('<comment>');
    const words = request.input.slice(open + '<comment>'.length, request.input.indexOf('</comment>', open));
    seq += 1;
    const lc = `UgxStandIn${seq}AaABAg`;
    const url = `https://www.youtube.com/watch?v=${videoId}&lc=${lc}`;
    const answer = (body) => ({ ok: true, status: 200, text: JSON.stringify(body) });
    switch (behave) {
      case 'ok':
      case 'api-down':
        posted.set(lc, { text: words, videoId });
        return answer({ posted: true, commentUrl: url, screenshotPath: '/tmp/openclaw-shot.png', problem: null });
      case 'success-no-link':
        // The 2026-07-19 shape: the agent says it worked and shows nothing.
        return answer({ posted: true, commentUrl: null, screenshotPath: null, problem: null });
      case 'link-to-nothing':
        return answer({ posted: true, commentUrl: url, screenshotPath: null, problem: null });
      case 'wrong-words':
        posted.set(lc, { text: `${words} (edited by the agent)`, videoId });
        return answer({ posted: true, commentUrl: url, screenshotPath: null, problem: null });
      case 'said-no':
        return answer({ posted: false, commentUrl: null, screenshotPath: null, problem: 'The comment box was disabled on this video.' });
      case 'timeout':
        return { ok: false, status: 504, error: 'OpenClaw /v1/responses timed out after 300000ms' };
      case 'hang':
        return new Promise(() => {}); // the worker is "killed" while waiting here
      default:
        throw new Error(`unknown behaviour ${behave}`);
    }
  };
  const fetchComment = async (lc) => {
    if (behave === 'api-down') return { ok: false, error: 'YouTube\'s API did not answer: quotaExceeded' };
    const found = posted.get(lc);
    return found ? { ok: true, found: true, text: found.text, videoId: found.videoId } : { ok: true, found: false };
  };
  const uploads = [];
  const upload = async (args) => {
    uploads.push(args);
    return { ok: true, data: { location: `https://blob.example/${args.fileName}` } };
  };
  return { callOpenClaw, fetchComment, upload, uploads, calls, posted };
}

function adapterFor(env, ins, extra = {}) {
  return youtube.createYoutubeAdapter({
    projectId: PROJECT,
    store: env.comments,
    targets: env.targets,
    callOpenClaw: ins.callOpenClaw,
    fetchComment: ins.fetchComment,
    upload: ins.upload,
    readFile: () => Buffer.from('png bytes'),
    statFile: () => ({ size: 9 }),
    sleep: async () => {},
    ...extra,
  });
}

async function readRow(env, id) {
  const res = await env.comments.getComment(id, SCOPE);
  assert.equal(res.ok, true, res.error);
  return res.data;
}

// ── The schema ──────────────────────────────────────────────────────────────

test('the poster\'s columns exist, and the file still applies cleanly twice', () => {
  const schema = parseSchemaText(schemaText());
  const columns = schema.tables.get('youtube_outreach_comments').columns;
  for (const name of ['posting_started_at', 'screenshot_url', 'post_note', 'wait_reason', 'wait_checked_at', 'posted_url', 'post_error']) {
    assert.ok(columns.get(name), `youtube_outreach_comments.${name} is missing`);
  }
  const twice = parseSchemaText(`${schemaText()}\n${fs.readFileSync(COMMENTS_SQL, 'utf8')}`);
  assert.deepEqual([...twice.tables.get('youtube_outreach_comments').columns.keys()], [...columns.keys()]);
});

// ── The limits, pure ────────────────────────────────────────────────────────

const NOON_UTC = Date.parse('2026-10-08T12:00:00Z');
const SETTINGS = { maxCommentsPerDay: 1, minMinutesBetween: 45, jitterMinutes: 15, activeStartHour: 8, activeEndHour: 22, oneCommentPerVideo: true };

test('daily maximum: one already posted today means the next waits for tomorrow\'s allowance', () => {
  const history = [{ id: 'a', postedAt: '2026-10-08T07:30:00Z' }];
  const verdict = limits.checkAccountLimits({ settings: { ...SETTINGS, minMinutesBetween: 0, jitterMinutes: 0 }, history, itemId: 'b', now: NOON_UTC, timeZone: 'UTC' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.scope, 'account');
  assert.match(verdict.reason, /tomorrow's allowance/);
  assert.match(verdict.reason, /1 of 1/);
});

test('daily maximum: "today" is the account\'s own calendar day, not UTC\'s', () => {
  // 03:00 UTC on the 8th is still the 7th in Denver.
  const history = [{ id: 'a', postedAt: '2026-10-08T03:00:00Z' }];
  const settings = { ...SETTINGS, minMinutesBetween: 0, jitterMinutes: 0, activeStartHour: 0, activeEndHour: 24 };
  assert.equal(limits.checkAccountLimits({ settings, history, itemId: 'b', now: NOON_UTC, timeZone: 'UTC' }).ok, false);
  assert.equal(limits.checkAccountLimits({ settings, history, itemId: 'b', now: NOON_UTC, timeZone: 'America/Denver' }).ok, true);
});

test('daily maximum counts a comment still `posting` — it may well be live', () => {
  const history = [{ id: 'a', postedAt: null, postingStartedAt: '2026-10-08T11:00:00Z' }];
  const verdict = limits.checkAccountLimits({ settings: { ...SETTINGS, minMinutesBetween: 0, jitterMinutes: 0 }, history, itemId: 'b', now: NOON_UTC, timeZone: 'UTC' });
  assert.equal(verdict.ok, false);
});

test('active hours: before the start and from the end hour on, everything waits, and the hours are named', () => {
  const settings = { ...SETTINGS, maxCommentsPerDay: 10 };
  const early = limits.checkAccountLimits({ settings, history: [], itemId: 'x', now: Date.parse('2026-10-08T07:59:00Z'), timeZone: 'UTC' });
  assert.equal(early.ok, false);
  assert.match(early.reason, /between 8am and 10pm \(UTC\)/);
  assert.equal(limits.checkAccountLimits({ settings, history: [], itemId: 'x', now: Date.parse('2026-10-08T08:00:00Z'), timeZone: 'UTC' }).ok, true);
  assert.equal(limits.checkAccountLimits({ settings, history: [], itemId: 'x', now: Date.parse('2026-10-08T22:00:00Z'), timeZone: 'UTC' }).ok, false);
  // An overnight window wraps past midnight.
  assert.equal(limits.insideHours(23, 22, 6), true);
  assert.equal(limits.insideHours(12, 22, 6), false);
});

test('gap: the minimum plus a per-comment jitter that stays put between passes', () => {
  const j1 = limits.jitterMinutesFor('comment-1', 15);
  assert.equal(limits.jitterMinutesFor('comment-1', 15), j1, 'a re-roll every pass would bunch posts at the minimum');
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    const j = limits.jitterMinutesFor(id, 15);
    assert.ok(j >= 0 && j <= 15, `${id}: ${j}`);
  }
  assert.equal(limits.jitterMinutesFor('anything', 0), 0);

  const settings = { ...SETTINGS, maxCommentsPerDay: 10 };
  const lastAt = NOON_UTC - 30 * MINUTE;
  const tooSoon = limits.checkAccountLimits({ settings, history: [{ id: 'a', postedAt: new Date(lastAt).toISOString() }], itemId: 'comment-1', now: NOON_UTC, timeZone: 'UTC' });
  assert.equal(tooSoon.ok, false);
  assert.match(tooSoon.reason, /gap between comments/);
  const later = NOON_UTC + (45 + j1 - 30) * MINUTE;
  assert.equal(limits.checkAccountLimits({ settings, history: [{ id: 'a', postedAt: new Date(lastAt).toISOString() }], itemId: 'comment-1', now: later, timeZone: 'UTC' }).ok, true);
});

test('no repeat: a video that already has a comment holds THIS comment only, unless its target repeats', () => {
  const history = [{ id: 'a', postedAt: '2026-10-01T12:00:00Z' }];
  const once = limits.checkItemRules({ settings: SETTINGS, target: { status: 'active', repeatMode: 'once' }, videoHistory: history, now: NOON_UTC, timeZone: 'UTC' });
  assert.equal(once.ok, false);
  assert.equal(once.scope, 'item', 'an account-wide wait here would let one comment hold the whole queue');
  const repeat = { status: 'active', repeatMode: 'repeat', repeatEveryDays: 7, repeatMaxTimes: 3, repeatUntil: null };
  assert.equal(limits.checkItemRules({ settings: SETTINGS, target: repeat, videoHistory: history, now: NOON_UTC, timeZone: 'UTC' }).ok, true);
  const notDue = limits.checkItemRules({ settings: SETTINGS, target: { ...repeat, repeatEveryDays: 14 }, videoHistory: history, now: NOON_UTC, timeZone: 'UTC' });
  assert.equal(notDue.ok, false);
  assert.match(notDue.reason, /every 14 days; the next is due Oct 15/);
  const used = limits.checkItemRules({ settings: SETTINGS, target: { ...repeat, repeatMaxTimes: 1 }, videoHistory: history, now: NOON_UTC, timeZone: 'UTC' });
  assert.equal(used.ok, false);
  assert.equal(limits.checkItemRules({ settings: SETTINGS, target: { status: 'paused', repeatMode: 'once' }, videoHistory: [], now: NOON_UTC, timeZone: 'UTC' }).ok, false);
  assert.equal(limits.checkItemRules({ settings: SETTINGS, target: null, videoHistory: [], now: NOON_UTC, timeZone: 'UTC' }).ok, false);
});

// ── The whole worker against the stand-ins ─────────────────────────────────

test('an approved comment posts, is proven against YouTube, and its row reads posted with a link and a screenshot', async () => {
  const env = withDb();
  try {
    await setLimits(env.targets);
    const comment = await approvedComment(env);
    const ins = standIns();
    const pass = await poster.runPass({ adapters: [adapterFor(env, ins)] });
    assert.equal(pass.reports[0].posted.outcome, 'posted', JSON.stringify(pass.reports[0]));

    const row = await readRow(env, comment.id);
    assert.equal(row.status, 'posted');
    assert.match(row.postedUrl, /^https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&lc=Ugx/);
    assert.ok(row.postedAt);
    assert.equal(row.screenshotUrl, `https://blob.example/comment-${comment.id}.png`);
    assert.equal(ins.calls.length, 1);
    assert.match(ins.calls[0].input, /profile "dane-of-earth"/);
    assert.ok(ins.calls[0].input.includes(`<comment>${WORDS}</comment>`), 'the exact approved words, nothing else');
  } finally {
    env.restore();
  }
});

test('with the daily maximum at 1, a second approved comment waits — and the row says it is waiting for tomorrow\'s allowance', async () => {
  const env = withDb();
  try {
    await setLimits(env.targets, { maxCommentsPerDay: 1 });
    const first = await approvedComment(env, { videoId: 'aaaaaaaaaaa' });
    const second = await approvedComment(env, { videoId: 'bbbbbbbbbbb', words: OTHER_WORDS });
    const ins = standIns();
    const adapter = adapterFor(env, ins);

    await poster.runPass({ adapters: [adapter] });
    const pass2 = await poster.runPass({ adapters: [adapter] });
    assert.equal(pass2.reports[0].posted, null);

    assert.equal((await readRow(env, first.id)).status, 'posted');
    const waiting = await readRow(env, second.id);
    assert.equal(waiting.status, 'approved');
    assert.match(waiting.waitReason, /tomorrow's allowance/);
    assert.ok(waiting.waitCheckedAt);
    assert.equal(ins.calls.length, 1, 'the browser was asked exactly once');
  } finally {
    env.restore();
  }
});

test('a comment the limits hold for ITSELF does not hold the one behind it', async () => {
  const env = withDb();
  try {
    await setLimits(env.targets);
    // Same video twice; the target is not set to repeat.
    const first = await approvedComment(env, { videoId: 'ccccccccccc' });
    const ins = standIns();
    const adapter = adapterFor(env, ins);
    await poster.runPass({ adapters: [adapter] });
    const blocked = await approvedComment(env, { videoId: 'ccccccccccc', words: OTHER_WORDS });
    const other = await approvedComment(env, { videoId: 'ddddddddddd' });

    await poster.runPass({ adapters: [adapter] });
    assert.equal((await readRow(env, first.id)).status, 'posted');
    const held = await readRow(env, blocked.id);
    assert.equal(held.status, 'approved');
    assert.match(held.waitReason, /already a comment on this video/);
    assert.equal((await readRow(env, other.id)).status, 'posted', 'the next comment went out past the held one');
  } finally {
    env.restore();
  }
});

test('killing the worker mid-post leaves the row `posting`, flagged for a hand check, and it is never posted again', async () => {
  const env = withDb();
  try {
    await setLimits(env.targets, { maxCommentsPerDay: 5 });
    const comment = await approvedComment(env);

    // Life 1: the browser is asked and never answers — the process is killed here.
    const hung = standIns({ behave: 'hang' });
    const abandoned = poster.runPass({ adapters: [adapterFor(env, hung)] });
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 20 && !hung.calls.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(hung.calls.length, 1, 'the browser was asked');
    void abandoned; // never settles, exactly like a killed process

    const midPost = await readRow(env, comment.id);
    assert.equal(midPost.status, 'posting');

    // Life 2: a fresh worker, a working browser.
    const fresh = standIns();
    const pass = await poster.runPass({ adapters: [adapterFor(env, fresh)] });
    assert.equal(fresh.calls.length, 0, 'a `posting` row must never be offered to the browser again');
    assert.equal(pass.reports[0].approved, 0);
    assert.equal((await readRow(env, comment.id)).status, 'posting');

    // Ten minutes on, the screen flags it for a hand check.
    const row = (await env.db.sbQuery({ method: 'GET', table: 'youtube_outreach_comments', query: 'select=*' })).data[0];
    assert.equal(env.comments.needsHandCheck(row, Date.parse(row.posting_started_at) + 2 * MINUTE), false);
    assert.equal(env.comments.needsHandCheck(row, Date.parse(row.posting_started_at) + env.comments.POSTING_STALE_MS), true);
  } finally {
    env.restore();
  }
});

test('PROOF RULE: the browser says it posted but returns no link — the row is failed, never posted', async () => {
  const env = withDb();
  try {
    await setLimits(env.targets);
    const comment = await approvedComment(env);
    const ins = standIns({ behave: 'success-no-link' });
    await poster.runPass({ adapters: [adapterFor(env, ins)] });
    const row = await readRow(env, comment.id);
    assert.equal(row.status, 'failed');
    assert.match(row.postError, /no link/);
  } finally {
    env.restore();
  }
});

test('PROOF RULE: a link YouTube has no comment at, or one saying other words, is failed', async () => {
  for (const behave of ['link-to-nothing', 'wrong-words']) {
    const env = withDb();
    try {
      await setLimits(env.targets);
      const comment = await approvedComment(env);
      await poster.runPass({ adapters: [adapterFor(env, standIns({ behave }))] });
      const row = await readRow(env, comment.id);
      assert.equal(row.status, 'failed', behave);
      assert.match(row.postError, behave === 'link-to-nothing' ? /YouTube has no comment at it/ : /does not say what was approved/);
      assert.match(row.postedUrl, /lc=/, 'the link is kept so Dane can look');
    } finally {
      env.restore();
    }
  }
});

test('the browser saying it could not is failed with its own words; a timeout or an unreadable YouTube is a hand check', async () => {
  const cases = [
    ['said-no', 'failed', /comment box was disabled/],
    ['timeout', 'posting', /timed out.*not be tried again/],
    ['api-down', 'posting', /quotaExceeded/],
  ];
  for (const [behave, status, words] of cases) {
    const env = withDb();
    try {
      await setLimits(env.targets);
      const comment = await approvedComment(env);
      await poster.runPass({ adapters: [adapterFor(env, standIns({ behave }))] });
      const row = await readRow(env, comment.id);
      assert.equal(row.status, status, behave);
      assert.match(row.postError, words, behave);
      if (status === 'posting') assert.equal(row.needsHandCheck, true, `${behave} must read as "check this one by hand"`);
    } finally {
      env.restore();
    }
  }
});

test('each site keeps its own limits: one site waiting does not stop another posting', async () => {
  const settled = [];
  const site = (name, allowed) => ({
    name,
    listApproved: async () => ({ ok: true, data: [{ id: `${name}-1`, waitReason: '' }] }),
    checkLimits: async () => (allowed ? { ok: true } : { ok: false, scope: 'account', reason: `${name} is resting` }),
    noteWaiting: async (item, reason) => { settled.push(`${item.id} waits: ${reason}`); return { ok: true }; },
    markPosting: async () => ({ ok: true }),
    post: async () => ({ ok: true, url: 'https://example.test/c/1', screenshot: '' }),
    verify: async () => ({ verdict: 'proven' }),
    keepScreenshot: async () => ({ note: '' }),
    markPosted: async (item) => { settled.push(`${item.id} posted`); return { ok: true }; },
    markFailed: async () => ({ ok: true }),
    flagForHandCheck: async () => ({ ok: true }),
  });
  const pass = await poster.runPass({ adapters: [site('busy', false), site('quiet', true)] });
  assert.deepEqual(settled, ['busy-1 waits: busy is resting', 'quiet-1 posted']);
  assert.match(poster.formatPass(pass), /quiet: comment quiet-1 POSTED and proven/);
});

test('an ACCOUNT wait holds the newer comments on that account too — a smaller random gap never jumps the queue', async () => {
  // The round-1 send-back, reproduced against the real limits.js: last post 31
  // minutes ago, minimum 30, jitter up to 15. Pick two ids whose per-comment
  // jitter differs so the OLDEST is still held and the newer would be allowed.
  const settings = { maxCommentsPerDay: 10, minMinutesBetween: 30, jitterMinutes: 15, activeStartHour: 0, activeEndHour: 24 };
  const ids = Array.from({ length: 200 }, (_, i) => `comment-${i}`);
  const oldest = ids.find((id) => limits.jitterMinutesFor(id, 15) >= 5);
  const newer = ids.find((id) => limits.jitterMinutesFor(id, 15) === 0);
  assert.ok(oldest && newer, 'the fixture needs one large and one zero jitter');
  const now = NOON_UTC;
  const history = [{ id: 'earlier', postedAt: new Date(now - 31 * MINUTE).toISOString() }];
  const verdictFor = (id) => limits.checkAccountLimits({ settings, history, itemId: id, now, timeZone: 'UTC' });
  assert.equal(verdictFor(oldest).ok, false, 'fixture: the oldest is held by the gap');
  assert.equal(verdictFor(newer).ok, true, 'fixture: asked on its own, the newer one would be allowed');

  const settled = [];
  const adapter = {
    name: 'youtube',
    listApproved: async () => ({
      ok: true,
      data: [
        { id: oldest, accountKey: 'dane_of_earth', waitReason: '' },
        { id: newer, accountKey: 'dane_of_earth', waitReason: '' },
        { id: 'elsewhere-1', accountKey: 'another_account', waitReason: '' },
      ],
    }),
    checkLimits: async (item) => (item.accountKey === 'dane_of_earth' ? verdictFor(item.id) : { ok: true }),
    noteWaiting: async (item, reason) => { settled.push(`${item.id} waits: ${reason}`); return { ok: true }; },
    markPosting: async () => ({ ok: true }),
    post: async () => ({ ok: true, url: 'https://example.test/c/1', screenshot: '' }),
    verify: async () => ({ verdict: 'proven' }),
    keepScreenshot: async () => ({ note: '' }),
    markPosted: async (item) => { settled.push(`${item.id} posted`); return { ok: true }; },
    markFailed: async () => ({ ok: true }),
    flagForHandCheck: async () => ({ ok: true }),
  };
  const pass = await poster.runPass({ adapters: [adapter], now });
  const held = verdictFor(oldest).reason;
  assert.ok(!settled.includes(`${newer} posted`), `the newer comment jumped the gap: ${settled.join(' | ')}`);
  assert.deepEqual(settled.slice(0, 2), [`${oldest} waits: ${held}`, `${newer} waits: ${held}`],
    'both wait, and both name the time the ACCOUNT can post next');
  // A wait on one account does not hold a different account.
  assert.equal(pass.reports[0].posted.id, 'elsewhere-1');
});

test('a site that throws is reported and the next site still runs', async () => {
  const broken = { name: 'broken', listApproved: async () => { throw new Error('database unreachable'); } };
  const fine = { name: 'fine', listApproved: async () => ({ ok: true, data: [] }) };
  const pass = await poster.runPass({ adapters: [broken, fine] });
  assert.match(pass.reports[0].error, /database unreachable/);
  assert.equal(pass.reports[1].error, null);
  assert.match(poster.formatPass(pass), /broken: COULD NOT RUN/);
});

// ── The pieces around it ───────────────────────────────────────────────────

test('comment links: only this video, only youtube.com, only with a comment id', () => {
  assert.equal(youtube.parseCommentLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=UgxAbc123', 'dQw4w9WgXcQ').commentId, 'UgxAbc123');
  assert.equal(youtube.parseCommentLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=UgxP.Reply9', 'dQw4w9WgXcQ').ok, true);
  assert.equal(youtube.parseCommentLink('https://www.youtube.com/watch?v=OTHERVIDEO1&lc=UgxAbc123', 'dQw4w9WgXcQ').ok, false);
  assert.equal(youtube.parseCommentLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ').ok, false);
  assert.equal(youtube.parseCommentLink('https://evil.example/watch?v=dQw4w9WgXcQ&lc=UgxAbc123', 'dQw4w9WgXcQ').ok, false);
});

test('a reply goes under the named comment, and the browser is told to click once', async () => {
  const input = youtube.buildPostInstructions({
    item: { videoId: 'dQw4w9WgXcQ', text: 'Hi' },
    placement: 'reply_specific',
    replyToCommentId: 'UgxTarget',
    profile: 'dane-of-earth',
    accountName: 'Dane of Earth',
  });
  assert.match(input, /watch\?v=dQw4w9WgXcQ&lc=UgxTarget/);
  assert.match(input, /Never click it twice/);
});

test('a screenshot is only kept from a folder OpenClaw writes to', () => {
  const home = path.join(path.sep, 'home-for-test');
  assert.equal(youtube.screenshotPathAllowed(path.join(home, '.openclaw', 'media', 'shot.png'), home), true);
  assert.equal(youtube.screenshotPathAllowed('/tmp/shot.png', home), true);
  assert.equal(youtube.screenshotPathAllowed(path.join(home, '.ssh', 'id_rsa'), home), false);
  assert.equal(youtube.screenshotPathAllowed('relative.png', home), false);
});

test('the worker refuses to talk to an OpenClaw that is not on this machine', () => {
  const apiSettingsPath = require.resolve('../../lib/apiSettings.js');
  const clientPath = require.resolve('../../lib/openclawResponsesClient.js');
  const realApi = require.cache[apiSettingsPath];
  require.cache[apiSettingsPath] = {
    id: apiSettingsPath, filename: apiSettingsPath, loaded: true,
    exports: { getProviderValues: () => ({ base_url: 'http://18.222.149.88:18789', api_key: 'x' }) },
  };
  delete require.cache[clientPath];
  try {
    const refused = poster.configureOpenClaw({ OPENCLAW_API_KEY: 'token' }, '/nonexistent');
    assert.equal(refused.ok, false);
    assert.match(refused.why, /only this machine/);
  } finally {
    if (realApi) require.cache[apiSettingsPath] = realApi; else delete require.cache[apiSettingsPath];
    delete require.cache[clientPath];
  }
});

test('the role is the Mini\'s, beats under its own name, and is parked with a reason until installed', () => {
  const { ROLES } = require('../../lib/nodeRoles.js');
  const hb = require('../../lib/nodeHeartbeat.js');
  const provision = require('../../lib/nodeProvision.js');
  assert.equal(ROLES[poster.ROLE].owner, 'mac-mini');
  assert.ok(hb.NOT_REPORTING_WHY[poster.ROLE], 'parked with a stated reason');
  assert.equal(hb.BEAT_EMITTERS[poster.ROLE], undefined, 'not judged until it is installed');
  const job = provision.JOB_SCHEDULES[poster.ROLE];
  assert.ok(job && job.blocked && !job.installer, 'provision:node --apply must not install it before the sign-in');
});

test('the install script writes a plist that runs the worker under doppler, and it lints', (t) => {
  const script = path.join(REPO, 'scripts', 'install_youtube_outreach_worker.sh');
  const plist = execFileSync('bash', [script, '--print-plist'], { encoding: 'utf8' });
  assert.match(plist, /doppler run --scope \S+ --project starcaster --config prd --no-check-version -- \S+ \S+\/workers\/youtube-outreach\/poster\.js/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  const lint = spawnSync('plutil', ['-lint', '-'], { input: plist, encoding: 'utf8' });
  if (lint.error) {
    t.skip('plutil is not on this machine (not macOS) — the plist was not linted');
    return;
  }
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
});
