'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Reddit comments 4/4 (86bch3jpg) — the Reddit adapter for the Mini's one
 * posting worker (workers/youtube-outreach/poster.js).
 *
 * The whole worker runs here against the SQL-backed fake database (built from
 * BOTH Reddit SQL files, in the order they are run), a stand-in OpenClaw and a
 * stand-in Reddit. Nothing reaches the network.
 *
 * The rules each test pins, from the ticket: posted with matching words →
 * `posted`; no link → `failed`; different words → `failed`; unreadable →
 * stays `posting` and is never retried. Plus the pace (3 a day, 20 minutes
 * apart), and that nothing posts while no Reddit account is named.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/redditCommentsStore.js');
const canonStorePath = require.resolve('../../lib/canonStore.js');

const poster = require('../../workers/youtube-outreach/poster.js');
const reddit = require('../../workers/youtube-outreach/adapters/reddit.js');
const limits = require('../../workers/youtube-outreach/limits.js');
const signIn = require('../../lib/openclawSignIn.js');
const health = require('../../workers/youtube-outreach/health.js');

const PROJECT = 'proj_doe';
const ACCOUNT = 'DaneOfEarthTest';
const POST_ID = '1abc2de';
const POST_URL = `https://www.reddit.com/r/Meditation/comments/${POST_ID}/`;
const WORDS = 'I lost the thread for most of a year and came back by sitting for two minutes, not twenty. The length mattered less than not skipping a day.';

const MINUTE = 60 * 1000;

/** A setup file minus its trailing grant to the read-only login, which is not schema. */
function schemaOf(file) {
  const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
  const grant = /\ndo \$\$[\s\S]*?end \$\$;\s*$/i;
  assert.match(sql, grant, `${file} should end with the starcaster_readonly grant block`);
  return sql.replace(grant, '\n');
}

/** 17/19's file only adds columns, so it carries no grant block to strip. */
function browserReadSchema() {
  return fs.readFileSync(path.join(SQL_DIR, 'reddit_comments_browser_read.sql'), 'utf8');
}

function schemaText({ twice = false } = {}) {
  const posting = schemaOf('reddit_comments_posting.sql');
  const read = browserReadSchema();
  return [schemaOf('reddit_comments_setup.sql'), posting, read, twice ? `${posting}\n${read}` : ''].join('\n');
}

function withDb() {
  const db = createFakeDb(parseSchemaText(schemaText()));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ redditCommentItems: 'reddit_comment_items', redditCommentSettings: 'reddit_comment_settings' }),
    sbQuery: db.sbQuery,
  };
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [storePath, canonStorePath]) delete require.cache[p];
  const store = require(storePath);
  return {
    db,
    store,
    restore() {
      if (real) require.cache[supabasePath] = real;
      else delete require.cache[supabasePath];
      for (const p of [storePath, canonStorePath]) delete require.cache[p];
    },
  };
}

let approvedSeq = 0;

/** One approved comment, written the way approveItem leaves it. */
async function approved(env, { words = WORDS, parentCommentId = '', minutesAgo = 60 } = {}) {
  approvedSeq += 1;
  const at = new Date(Date.now() - minutesAgo * MINUTE + approvedSeq * 1000).toISOString();
  const res = await env.db.sbQuery({
    method: 'POST',
    table: 'reddit_comment_items',
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [{
      project_id: PROJECT,
      owner_user_id: 'user_dane',
      target_url: parentCommentId ? `${POST_URL}_/${parentCommentId}/` : POST_URL,
      post_id: POST_ID,
      parent_comment_id: parentCommentId,
      subreddit: 'Meditation',
      post_title: 'How do you keep going?',
      draft_text: words,
      final_text: words,
      status: 'approved',
      approved_by: 'user_dane',
      approved_at: at,
      created_at: at,
      updated_at: at,
    }],
  });
  assert.equal(res.ok, true, res.error);
  return env.store.rowToItem(Array.isArray(res.data) ? res.data[0] : res.data);
}

/**
 * A stand-in OpenClaw that "posts" by writing the comment into a stand-in
 * Reddit, unless told to misbehave. `calls` records every request.
 */
function standIns({ behave = 'ok', author = ACCOUNT } = {}) {
  const comments = new Map(); // comment id on "Reddit" -> { author, text, linkId, parentId }
  const calls = [];
  let seq = 0;
  const answer = (body) => ({ ok: true, status: 200, text: JSON.stringify(body) });
  const callOpenClaw = async (request) => {
    calls.push(request);
    const open = request.input.lastIndexOf('<comment>');
    const words = request.input.slice(open + '<comment>'.length, request.input.indexOf('</comment>', open));
    seq += 1;
    const id = `nw${seq}x`;
    const url = `https://www.reddit.com/r/Meditation/comments/${POST_ID}/comment/${id}/`;
    const put = (text) => comments.set(id, { author, text, linkId: `t3_${POST_ID}`, parentId: `t3_${POST_ID}` });
    switch (behave) {
      case 'ok':
      case 'reddit-blocked':
        put(words);
        return answer({ posted: true, commentUrl: url, screenshotPath: '/tmp/openclaw-shot.png', problem: null });
      case 'escaped':
        // Reddit's rich-text editor escapes markdown characters in what it stores.
        put(words.replace(/\*/g, '\\*'));
        return answer({ posted: true, commentUrl: url, screenshotPath: null, problem: null });
      case 'success-no-link':
        // The 2026-07-19 shape: the agent says it worked and shows nothing.
        return answer({ posted: true, commentUrl: null, screenshotPath: null, problem: null });
      case 'post-link':
        put(words);
        return answer({ posted: true, commentUrl: POST_URL, screenshotPath: null, problem: null });
      case 'link-to-nothing':
        return answer({ posted: true, commentUrl: url, screenshotPath: null, problem: null });
      case 'wrong-words':
        put('Something else entirely, which the agent wrote instead.');
        return answer({ posted: true, commentUrl: url, screenshotPath: null, problem: null });
      case 'removed':
        put('[removed]');
        return answer({ posted: true, commentUrl: url, screenshotPath: null, problem: null });
      case 'said-no':
        return answer({ posted: false, commentUrl: null, screenshotPath: '/tmp/openclaw-signed-out.png', problem: 'The browser is signed out of Reddit.' });
      case 'timeout':
        return { ok: false, status: 504, error: 'OpenClaw /v1/responses timed out after 300000ms' };
      default:
        throw new Error(`unknown behaviour ${behave}`);
    }
  };
  const readComment = async (id) => {
    if (behave === 'reddit-blocked') {
      return { ok: false, error: 'Reddit blocked this server ("You\'ve been blocked by network security", 403). It refuses reads that are not signed in.' };
    }
    return comments.has(id) ? { ok: true, found: true, ...comments.get(id) } : { ok: true, found: false };
  };
  const uploads = [];
  const upload = async (args) => {
    uploads.push(args);
    return { ok: true, data: { location: `https://blob.example/${args.fileName}` } };
  };
  return { callOpenClaw, readComment, upload, uploads, calls, comments };
}

/** Open all day, no gap, a high cap: only the rule a test sets can hold anything. */
const OPEN = { maxCommentsPerDay: 10, minMinutesBetween: 0, jitterMinutes: 0 };

function adapterFor(env, ins, extra = {}) {
  return reddit.createRedditAdapter({
    projectId: PROJECT,
    store: env.store,
    callOpenClaw: ins.callOpenClaw,
    readComment: ins.readComment,
    upload: ins.upload,
    readFile: () => Buffer.from('png bytes'),
    statFile: () => ({ size: 9 }),
    sleep: async () => {},
    accountName: ACCOUNT,
    pace: OPEN,
    ...extra,
  });
}

async function readRow(env, id) {
  const res = await env.store.getItemById(id, { projectId: PROJECT, userId: 'user_dane' });
  assert.equal(res.ok, true, res.error);
  return res.data;
}

async function onePass(adapter, now = Date.now()) {
  const pass = await poster.runPass({ adapters: [adapter], now });
  return pass.reports[0];
}

// ── The schema and the wiring ─────────────────────────────────────────────

test('the posting columns and the settings table exist, and the file applies cleanly twice', () => {
  const schema = parseSchemaText(schemaText({ twice: true }));
  const items = schema.tables.get ? schema.tables.get('reddit_comment_items') : schema.tables.reddit_comment_items;
  const settings = schema.tables.get ? schema.tables.get('reddit_comment_settings') : schema.tables.reddit_comment_settings;
  assert.ok(items && settings, 'both tables are defined');
  const sql = fs.readFileSync(path.join(SQL_DIR, 'reddit_comments_posting.sql'), 'utf8');
  for (const column of ['account_key', 'posting_started_at', 'post_note', 'wait_reason', 'wait_checked_at']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}\\b`), `${column} is added idempotently`);
  }
  assert.match(sql, /project_id\s+text not null/);
  assert.match(sql, /owner_user_id\s+text not null/, 'both tenant columns (landmine 12)');
  assert.match(sql, /reddit_comment_settings enable row level security/);
});

test('the worker lists the Reddit adapter beside YouTube and Substack, on the same project setting', () => {
  assert.deepEqual(poster.ADAPTERS.map((a) => a.name), ['youtube', 'substack', 'reddit']);
  const built = poster.buildAdapters({ YOUTUBE_OUTREACH_PROJECT_ID: PROJECT }, poster.ADAPTERS.filter((a) => a.name === 'reddit'));
  assert.deepEqual(built.problems, []);
  assert.equal(built.adapters[0].projectId, PROJECT);
  const own = poster.buildAdapters({ REDDIT_COMMENTS_PROJECT_ID: 'proj_other', YOUTUBE_OUTREACH_PROJECT_ID: PROJECT }, poster.ADAPTERS.filter((a) => a.name === 'reddit'));
  assert.equal(own.adapters[0].projectId, 'proj_other');
});

test('the pace is 3 a day, 20 minutes apart — the ticket\'s deliberately low default', () => {
  assert.deepEqual({ ...limits.REDDIT_PACE }, { maxCommentsPerDay: 3, minMinutesBetween: 20, jitterMinutes: 10 });
  assert.ok(Object.isFrozen(limits.REDDIT_PACE));
});

test('the browser is told the exact words, the account, the profile, and to click Comment once', () => {
  const plain = reddit.buildPostInstructions({ item: { text: WORDS, targetUrl: POST_URL, parentCommentId: '' }, profile: 'dane-of-earth', accountName: ACCOUNT });
  assert.match(plain, /profile "dane-of-earth"/);
  assert.match(plain, new RegExp(`account is "${ACCOUNT}"`));
  assert.ok(plain.includes(`<comment>${WORDS}</comment>`));
  assert.match(plain, /Click the "Comment" button once\. Never click it twice\./);
  assert.match(plain, /"Join the conversation"/);
  const reply = reddit.buildPostInstructions({ item: { text: WORDS, targetUrl: `${POST_URL}_/kx9yz12/`, parentCommentId: 'kx9yz12' }, profile: 'dane-of-earth', accountName: ACCOUNT });
  assert.match(reply, /Click "Reply" under that comment/);
});

test('a comment permalink is read for its post and comment; a post link is not a comment', () => {
  assert.deepEqual(reddit.parsePermalink(`https://www.reddit.com/r/Meditation/comments/${POST_ID}/comment/nw1x/`), { ok: true, postId: POST_ID, commentId: 'nw1x' });
  assert.deepEqual(reddit.parsePermalink(`https://www.reddit.com/r/Meditation/comments/${POST_ID}/how_do_you/nw1x/`), { ok: true, postId: POST_ID, commentId: 'nw1x' });
  assert.equal(reddit.parsePermalink(POST_URL).ok, false);
  assert.equal(reddit.parsePermalink('https://example.com/x').ok, false);
});

// ── The four outcomes the ticket names ─────────────────────────────────────

test('POSTED WITH MATCHING WORDS: the row reads posted, with the link and the screenshot', async () => {
  const env = withDb();
  try {
    const item = await approved(env);
    const ins = standIns();
    const report = await onePass(adapterFor(env, ins));
    assert.equal(report.posted.outcome, 'posted', report.posted.why);
    const row = await readRow(env, item.id);
    assert.equal(row.status, 'posted');
    assert.match(row.postedUrl, /\/comment\/nw1x\/$/);
    assert.equal(row.screenshotUrl, `https://blob.example/comment-${item.id}.png`);
    assert.ok(row.postedAt);
    assert.equal(ins.uploads[0].assetType, 'RedditComments');
  } finally {
    env.restore();
  }
});

test('Reddit\'s escaped markdown is the same words, not different ones', async () => {
  const env = withDb();
  try {
    const item = await approved(env, { words: 'Two minutes * every day beat twenty * some days.' });
    const report = await onePass(adapterFor(env, standIns({ behave: 'escaped' })));
    assert.equal(report.posted.outcome, 'posted', report.posted.why);
    assert.equal((await readRow(env, item.id)).status, 'posted');
  } finally {
    env.restore();
  }
});

test('NO LINK MEANS FAILED: the browser says it posted but returns no link (or the post\'s link)', async () => {
  const env = withDb();
  try {
    const item = await approved(env);
    await onePass(adapterFor(env, standIns({ behave: 'success-no-link' })));
    const row = await readRow(env, item.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /returned no link to the comment/);

    const second = await approved(env);
    await onePass(adapterFor(env, standIns({ behave: 'post-link' })));
    const row2 = await readRow(env, second.id);
    assert.equal(row2.status, 'failed');
    assert.match(row2.error, /not to one comment on it/);
  } finally {
    env.restore();
  }
});

test('WORDS DIFFER MEANS FAILED: the comment at the link says something else', async () => {
  const env = withDb();
  try {
    const item = await approved(env);
    const report = await onePass(adapterFor(env, standIns({ behave: 'wrong-words' })));
    assert.equal(report.posted.outcome, 'failed');
    const row = await readRow(env, item.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /does not say what was approved\. Reddit shows: "Something else entirely/);
    assert.match(row.postedUrl, /\/comment\/nw1x\/$/, 'the link is kept so Dane can see what went up');
  } finally {
    env.restore();
  }
});

test('a link to nothing, a removed comment, or another author is failed, never posted', async () => {
  const env = withDb();
  try {
    const nothing = await approved(env);
    await onePass(adapterFor(env, standIns({ behave: 'link-to-nothing' })));
    assert.match((await readRow(env, nothing.id)).error, /Reddit has no comment at it/);

    const removed = await approved(env);
    await onePass(adapterFor(env, standIns({ behave: 'removed' })));
    assert.match((await readRow(env, removed.id)).error, /\[removed\] — the subreddit's moderators or Reddit's spam filter/);

    const someoneElse = await approved(env);
    await onePass(adapterFor(env, standIns({ author: 'SomebodyElse' })));
    const row = await readRow(env, someoneElse.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /written by "SomebodyElse", not DaneOfEarthTest/);
  } finally {
    env.restore();
  }
});

test('UNREADABLE STAYS POSTING: Reddit refusing the read leaves the row for a hand check, with its link, and it is never retried', async () => {
  const env = withDb();
  try {
    const item = await approved(env);
    const ins = standIns({ behave: 'reddit-blocked' });
    const adapter = adapterFor(env, ins);
    const report = await onePass(adapter);
    assert.equal(report.posted.outcome, 'hand-check');
    const row = await readRow(env, item.id);
    assert.equal(row.status, 'posting');
    assert.equal(row.needsHandCheck, true);
    assert.match(row.error, /Reddit blocked this server/);
    assert.match(row.postedUrl, /\/comment\/nw1x\/$/, 'the link it may be at is kept for the hand check');

    // Never offered again: the next pass finds nothing approved.
    const again = await onePass(adapter, Date.now() + 60 * MINUTE);
    assert.equal(again.approved, 0);
    assert.equal(again.posted, null);
    assert.equal(ins.calls.length, 1, 'the browser was asked exactly once');
  } finally {
    env.restore();
  }
});

test('OpenClaw saying no is failed in its own words, with its screenshot; a timeout is a hand check naming Reddit', async () => {
  const env = withDb();
  try {
    const no = await approved(env);
    await onePass(adapterFor(env, standIns({ behave: 'said-no' })));
    const row = await readRow(env, no.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /OpenClaw did not post it: The browser is signed out of Reddit\./);
    assert.match(row.screenshotUrl, /blob\.example/);

    const late = await approved(env);
    await onePass(adapterFor(env, standIns({ behave: 'timeout' })));
    const row2 = await readRow(env, late.id);
    assert.equal(row2.status, 'posting');
    assert.match(row2.error, /Open the post on Reddit and check by hand\./);
    assert.doesNotMatch(row2.error, /video/);
  } finally {
    env.restore();
  }
});

// ── Holding back ────────────────────────────────────────────────────────────

test('NOTHING POSTS WITHOUT A NAMED ACCOUNT: every approved comment waits, says why, and the browser is never asked', async () => {
  const env = withDb();
  try {
    const item = await approved(env);
    const ins = standIns();
    const report = await onePass(adapterFor(env, ins, { accountName: '' }));
    assert.equal(report.posted, null);
    assert.equal(ins.calls.length, 0);
    const row = await readRow(env, item.id);
    assert.equal(row.status, 'approved');
    assert.match(row.waitReason, /choose the account to post as/);
  } finally {
    env.restore();
  }
});

test('THE DAILY CAP: with 3 a day, the fourth waits for tomorrow and says so on its row', async () => {
  const env = withDb();
  try {
    const items = [];
    for (let i = 0; i < 4; i += 1) items.push(await approved(env, { words: `${WORDS} (${i})` }));
    const ins = standIns();
    const adapter = adapterFor(env, ins, { pace: { ...OPEN, maxCommentsPerDay: 3 } });
    for (let i = 0; i < 4; i += 1) await onePass(adapter);
    const rows = await Promise.all(items.map((i) => readRow(env, i.id)));
    assert.deepEqual(rows.map((r) => r.status), ['posted', 'posted', 'posted', 'approved']);
    assert.match(rows[3].waitReason, /Waiting for tomorrow's allowance — 3 of 3 comments a day already posted today/);
  } finally {
    env.restore();
  }
});

test('THE GAP: a second comment waits until 20 minutes after the first', async () => {
  const env = withDb();
  try {
    const first = await approved(env);
    const second = await approved(env, { words: `${WORDS} Again.` });
    const adapter = adapterFor(env, standIns(), { pace: { maxCommentsPerDay: 3, minMinutesBetween: 20, jitterMinutes: 0 } });
    const start = Date.now();
    await onePass(adapter, start);
    await onePass(adapter, start + 5 * MINUTE);
    assert.equal((await readRow(env, first.id)).status, 'posted');
    const waiting = await readRow(env, second.id);
    assert.equal(waiting.status, 'approved');
    assert.match(waiting.waitReason, /at least 20 minutes apart/);
    await onePass(adapter, start + 21 * MINUTE);
    assert.equal((await readRow(env, second.id)).status, 'posted');
  } finally {
    env.restore();
  }
});

test('the posting moves are guarded: a row is taken from approved once, and settled from posting once', async () => {
  const env = withDb();
  try {
    const scope = { projectId: PROJECT };
    const item = await approved(env);
    assert.equal((await env.store.markPosting(item.id, scope)).ok, true);
    const twice = await env.store.markPosting(item.id, scope);
    assert.equal(twice.ok, false);
    assert.equal(twice.status, 409);
    assert.equal((await env.store.markPosted(item.id, { url: 'https://www.reddit.com/x' }, scope)).ok, true);
    const again = await env.store.markFailed(item.id, { error: 'late' }, scope);
    assert.equal(again.status, 409);
    const other = await env.store.markPosting(item.id, { projectId: 'proj_other' });
    assert.equal(other.ok, false, 'another project cannot touch it');
  } finally {
    env.restore();
  }
});

test('a `posting` row reads as a hand check once stale, or once the worker wrote why', () => {
  const store = require('../../lib/redditCommentsStore.js');
  const now = Date.now();
  assert.equal(store.needsHandCheck({ status: 'posting', error: '', posting_started_at: new Date(now - MINUTE).toISOString() }, now), false);
  assert.equal(store.needsHandCheck({ status: 'posting', error: '', posting_started_at: new Date(now - 11 * MINUTE).toISOString() }, now), true);
  assert.equal(store.needsHandCheck({ status: 'posting', error: 'could not tell', posting_started_at: new Date(now).toISOString() }, now), true);
  assert.equal(store.needsHandCheck({ status: 'approved', error: 'x' }, now), false);
});

// ── The sign-in check ──────────────────────────────────────────────────────

test('Reddit\'s sign-in verdicts: signed out is 1, the named account is 0, someone else is 1, no name is 2', () => {
  const site = { ...signIn.SITES.reddit };
  try {
    assert.equal(signIn.judge({ signedIn: false }, 'reddit').code, 1);
    assert.equal(signIn.judge({ signedIn: false }, 'reddit').kind, 'signed_out');
    // While no account is named, a signed-in browser is no verdict either way.
    signIn.SITES.reddit.expected = '';
    assert.equal(signIn.judge({ signedIn: true, username: 'u/Anyone' }, 'reddit').code, 2);
    signIn.SITES.reddit.expected = ACCOUNT;
    assert.equal(signIn.judge({ signedIn: true, username: `u/${ACCOUNT.toLowerCase()}` }, 'reddit').code, 0);
    assert.equal(signIn.judge({ signedIn: true, username: 'u/SomebodyElse' }, 'reddit').kind, 'wrong_account');
    assert.equal(signIn.judge({ signedIn: true, username: null }, 'reddit').code, 2);
  } finally {
    Object.assign(signIn.SITES.reddit, site);
  }
});

test('the smoke check knows --site reddit', async () => {
  const smoke = await import('../openclaw_smoke.mjs');
  assert.ok(smoke.SITES.reddit);
  assert.equal(smoke.judge({ signedIn: false }, 'reddit').code, 1);
});

test('the hourly check watches Reddit with the ticket\'s sentence, and saves the reading where the screen reads it', async () => {
  const env = withDb();
  try {
    const adapter = adapterFor(env, standIns());
    const checks = poster.browserChecksFor([adapter]);
    assert.deepEqual(checks.map((c) => `${c.site}:${c.accountKey}:${c.profile}:${c.who}`), [`reddit:dane_of_earth:dane-of-earth:${ACCOUNT}`]);
    const posts = [];
    const run = await health.runHealthCheck({
      checks,
      deps: {
        node: 'mac-mini',
        probe: async () => ({ up: true }),
        ask: async () => ({ ok: true, text: JSON.stringify({ signedIn: false, username: null }) }),
        extractJson: (raw) => JSON.parse(raw),
        post: async (body) => { posts.push(body); },
        readLedger: () => ({}),
        writeLedger: () => {},
      },
    });
    assert.deepEqual(run.problems, []);
    assert.equal(run.results[0].message, `Reddit on the Mini is signed out of ${ACCOUNT}. Sign in again in the dane-of-earth browser.`);
    assert.match(posts[0], /Reddit comments \(mac-mini\)/);
    const saved = await env.store.getBrowserCheck({ projectId: PROJECT });
    assert.equal(saved.data.state, 'signed_out');
    assert.equal(saved.data.message, run.results[0].message);

    // A good check updates the same row, and moves "last signed in".
    const ok = await env.store.recordBrowserCheck({ state: 'signed_in', message: `Mini: signed in to Reddit as ${ACCOUNT}.`, checkedAt: new Date().toISOString() }, { projectId: PROJECT });
    assert.equal(ok.ok, true, ok.error);
    const after = await env.store.getBrowserCheck({ projectId: PROJECT });
    assert.equal(after.data.state, 'signed_in');
    assert.ok(after.data.signedInAt);
    const rows = await env.db.sbQuery({ method: 'GET', table: 'reddit_comment_settings', query: 'select=*' });
    assert.equal(rows.data.length, 1, 'one row per project and account');
    assert.equal(rows.data[0].owner_user_id, env.store.WORKER_USER, 'both tenant columns are stamped');
  } finally {
    env.restore();
  }
});

test('a signed-in reading with no account named reads as could-not-tell, never as fine', () => {
  assert.equal(health.sentence('signed_in', { site: 'reddit', who: '' }), 'Mini: signed in to Reddit.');
  assert.equal(health.sentence('signed_out', { site: 'reddit', who: '', profile: 'dane-of-earth' }), 'Reddit on the Mini is signed out. Sign in again in the dane-of-earth browser.');
  assert.match(health.sentence('cannot_tell', { site: 'reddit', who: '', detail: 'no account named' }), /could not tell whether Reddit is signed in: no account named/);
});

// ── Reading posts for Dane (Outreach wizard 17/19, task 86bcrmbuv) ────────

const DANE = { projectId: PROJECT, userId: 'user_dane' };
const SIGNED_IN = {
  browserCheck: async () => ({ ok: true, data: { state: 'signed_in', message: 'Signed in', checkedAt: new Date().toISOString() } }),
};

/** A stand-in OpenClaw that "reads" by answering `body` (an object, or raw text). */
function reader(body, { fail = null } = {}) {
  const calls = [];
  return {
    calls,
    callOpenClaw: async (request) => {
      calls.push(request);
      if (fail) return { ok: false, status: fail.status || 502, error: fail.error };
      return { ok: true, status: 200, text: typeof body === 'string' ? body : JSON.stringify(body) };
    },
  };
}

const READ_ANSWER = {
  signedIn: true,
  found: true,
  removed: false,
  removedBy: null,
  subreddit: 'r/Meditation',
  title: 'How do you keep going?',
  body: 'I keep quitting after a week.',
  author: 'u/quietpond',
  comment: null,
  topComments: [
    { id: 'c1', author: 'a', body: 'Two minutes a day.', score: 40 },
    { id: 'c2', author: 'b', body: '[removed]', score: 3 },
  ],
  problem: null,
};

test('the read columns are added idempotently, and only an idea row may be reading', () => {
  const sql = browserReadSchema();
  for (const column of ['read_state', 'read_error', 'read_code', 'read_requested_at', 'read_finished_at']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}\\b`), `${column} is added idempotently`);
  }
  assert.match(sql, /check \(read_state in \('', 'reading', 'failed'\)\)/);
});

test('the read instructions name the profile and the link, ask for ~20 top comments, and forbid any click that changes Reddit', () => {
  const text = reddit.buildReadInstructions({ item: { targetUrl: POST_URL, parentCommentId: '' }, profile: 'dane-of-earth' });
  assert.match(text, /profile "dane-of-earth"/);
  assert.match(text, new RegExp(`Open ${POST_URL.replace(/[.?]/g, '\\$&')}`));
  assert.match(text, /up to 20 of the top comments/);
  assert.match(text, /Do not click Reply, vote, join, follow, message or change anything/);
  assert.doesNotMatch(text, /comment \(id/);
  const reply = reddit.buildReadInstructions({ item: { targetUrl: `${POST_URL}_/kx9yz12/`, parentCommentId: 'kx9yz12' }, profile: 'p' });
  assert.match(reply, /one comment \(id kx9yz12\)/);
});

test('A POST LINK IS READ BY THE MINI: one pass fills in the title, body and top comments, with no pasting', async () => {
  const env = withDb();
  try {
    const added = await env.store.addItem({ url: POST_URL }, DANE, SIGNED_IN);
    assert.equal(added.data.readState, 'reading');
    const ins = reader(READ_ANSWER);
    const report = await onePass(adapterFor(env, ins));
    assert.deepEqual(report.read, { id: added.data.id, outcome: 'read', why: '' });
    assert.equal(ins.calls.length, 1, 'one read, and nothing approved to post');
    assert.equal(ins.calls[0].user, 'starcaster:reddit-post-reader');
    assert.match(ins.calls[0].input, /Only read|Do not click Reply/);

    const row = await readRow(env, added.data.id);
    assert.equal(row.readState, '');
    assert.equal(row.postReadFrom, 'reddit');
    assert.equal(row.subreddit, 'Meditation', 'r/ is dropped');
    assert.equal(row.postTitle, 'How do you keep going?');
    assert.equal(row.postBody, 'I keep quitting after a week.');
    assert.equal(row.postAuthor, 'quietpond', 'u/ is dropped');
    assert.deepEqual(row.topComments, [{ id: 'c1', author: 'a', body: 'Two minutes a day.', score: 40 }], 'a removed comment is not kept');
    assert.match(poster.formatPass({ reports: [report] }), new RegExp(`reddit: post ${added.data.id} READ`));

    const idle = await onePass(adapterFor(env, ins));
    assert.equal(idle.read, null, 'nothing left to read');
    assert.equal(ins.calls.length, 1);
  } finally {
    env.restore();
  }
});

test('a comment link is read with the comment being replied to', async () => {
  const env = withDb();
  try {
    const added = await env.store.addItem({ url: `${POST_URL}x/kx9yz12/` }, DANE, SIGNED_IN);
    await onePass(adapterFor(env, reader({ ...READ_ANSWER, comment: { id: 'kx9yz12', author: 'u/replyto', body: 'I tried apps, none stuck.' } })));
    const row = await readRow(env, added.data.id);
    assert.equal(row.parentCommentAuthor, 'replyto');
    assert.equal(row.parentCommentText, 'I tried apps, none stuck.');

    const gone = await env.store.addItem({ url: `${POST_URL}x/kx9yz13/` }, DANE, SIGNED_IN);
    await onePass(adapterFor(env, reader({ ...READ_ANSWER, comment: { id: 'kx9yz13', author: '[deleted]', body: '[deleted]' } })));
    assert.match((await readRow(env, gone.data.id)).readError, /comment being replied to was removed or deleted/);
  } finally {
    env.restore();
  }
});

test('A REMOVED POST says "Reddit says this post was removed", and every other failed read names its reason', async () => {
  const cases = [
    [{ ...READ_ANSWER, removed: true, removedBy: 'the moderators' }, 'REDDIT_REMOVED', /^Reddit says this post was removed \(by the moderators\), so there is nothing to answer\.$/],
    [{ ...READ_ANSWER, removed: true, removedBy: null }, 'REDDIT_REMOVED', /^Reddit says this post was removed, so/],
    [{ ...READ_ANSWER, signedIn: false }, 'MINI_SIGNED_OUT', /not signed in to Reddit.*Paste the post's title and text instead/],
    [{ ...READ_ANSWER, found: false }, 'REDDIT_NOT_FOUND', /no such post/],
    [{ ...READ_ANSWER, title: '' }, 'READ_NO_TITLE', /read no title/],
    ['I could not find the page, sorry.', 'READ_NO_ANSWER', /not with the post's details\. It said: I could not find the page, sorry\./],
  ];
  for (const [answer, code, message] of cases) {
    const env = withDb();
    try {
      // eslint-disable-next-line no-await-in-loop
      const added = await env.store.addItem({ url: POST_URL }, DANE, SIGNED_IN);
      // eslint-disable-next-line no-await-in-loop
      const report = await onePass(adapterFor(env, reader(answer)));
      assert.equal(report.read.outcome, 'failed', code);
      // eslint-disable-next-line no-await-in-loop
      const row = await readRow(env, added.data.id);
      assert.equal(row.readState, 'failed');
      assert.equal(row.readCode, code);
      assert.match(row.readError, message);
      assert.equal(row.postTitle, '', 'nothing is filled in from a failed read');
    } finally {
      env.restore();
    }
  }
});

test('OpenClaw not answering is a failed read that says so, and posting still runs in the same pass', async () => {
  const env = withDb();
  try {
    const added = await env.store.addItem({ url: POST_URL }, DANE, SIGNED_IN);
    const toPost = await approved(env);
    const posting = standIns();
    let first = true;
    const callOpenClaw = async (request) => {
      if (first) { first = false; return { ok: false, status: 504, error: 'OpenClaw did not answer within 180 seconds' }; }
      return posting.callOpenClaw(request);
    };
    const report = await onePass(adapterFor(env, { ...posting, callOpenClaw }));
    assert.equal(report.read.outcome, 'failed');
    assert.match((await readRow(env, added.data.id)).readError, /^The Mini's browser could not read the post \(OpenClaw: OpenClaw did not answer within 180 seconds\)\.$/);
    assert.equal(report.posted.outcome, 'posted', 'a failed read does not stop the post');
    assert.equal((await readRow(env, toPost.id)).status, 'posted');
  } finally {
    env.restore();
  }
});

test('a paste that lands while the Mini is reading wins; the Mini\'s late answer is not saved over it', async () => {
  const env = withDb();
  try {
    const added = await env.store.addItem({ url: POST_URL }, DANE, SIGNED_IN);
    const ins = reader(READ_ANSWER);
    const slow = async (request) => {
      await env.store.pasteForItem(added.data.id, { postTitle: 'Pasted title', postBody: 'Pasted body' }, DANE);
      return ins.callOpenClaw(request);
    };
    const report = await onePass(adapterFor(env, { callOpenClaw: slow }));
    assert.equal(report.read.outcome, 'unsaved');
    const row = await readRow(env, added.data.id);
    assert.equal(row.postTitle, 'Pasted title');
    assert.equal(row.postReadFrom, 'pasted');
  } finally {
    env.restore();
  }
});
