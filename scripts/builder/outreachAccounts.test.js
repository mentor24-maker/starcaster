'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Outreach wizard 2/19 (86bcrmba0) — which account each outreach channel posts
 * as is chosen on the Outreach screen and saved on the channel's settings row
 * (lib/outreachAccounts.js, docs/SQL/outreach_expected_account.sql).
 *
 * Runs against the SQL-backed fake database built from the Reddit SQL files
 * plus this ticket's, in the order they are run. The acceptance criteria each
 * test pins:
 *   - confirming an account makes the hourly check say "signed in as <it>";
 *     choosing a different one gives the wrong-account sentence (break test);
 *   - with no account confirmed an approved item stays approved and its row
 *     says "waiting: choose the account to post as";
 *   - the Mini records who it saw, so the screen can offer it.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const accountsPath = require.resolve('../../lib/outreachAccounts.js');
const storePath = require.resolve('../../lib/redditCommentsStore.js');
const canonStorePath = require.resolve('../../lib/canonStore.js');

const health = require('../../workers/youtube-outreach/health.js');
const poster = require('../../workers/youtube-outreach/poster.js');
const reddit = require('../../workers/youtube-outreach/adapters/reddit.js');
const youtube = require('../../workers/youtube-outreach/adapters/youtube.js');
const substack = require('../../workers/youtube-outreach/adapters/substack.js');

const PROJECT = 'proj_doe';
const SCOPE = { projectId: PROJECT, userId: 'user_dane' };

function schemaOf(file) {
  const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
  return sql.replace(/\ndo \$\$[\s\S]*?end \$\$;\s*$/i, '\n');
}

/** Only the Reddit settings table exists here, so only its lines of this ticket's file apply. */
function schemaText() {
  const ours = schemaOf('outreach_expected_account.sql')
    .split('\n')
    .filter((line) => !/^alter table public\.(youtube_outreach_settings|substack_notes_settings)/.test(line))
    .join('\n');
  return [schemaOf('reddit_comments_setup.sql'), schemaOf('reddit_comments_posting.sql'), ours].join('\n');
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
  for (const p of [accountsPath, storePath, canonStorePath]) delete require.cache[p];
  return {
    db,
    accounts: require(accountsPath),
    store: require(storePath),
    restore() {
      if (real) require.cache[supabasePath] = real;
      else delete require.cache[supabasePath];
      for (const p of [accountsPath, storePath, canonStorePath]) delete require.cache[p];
    },
  };
}

/** A health run whose browser says it is signed in as `username`. */
async function checkAs(checks, username, posts = []) {
  return health.runHealthCheck({
    checks,
    deps: {
      node: 'mac-mini',
      probe: async () => ({ up: true }),
      ask: async () => ({ ok: true, text: JSON.stringify({ signedIn: true, username }) }),
      extractJson: (raw) => JSON.parse(raw),
      post: async (body) => { posts.push(body); },
      readLedger: () => ({}),
      writeLedger: () => {},
    },
  });
}

function redditAdapter(env, extra = {}) {
  return reddit.createRedditAdapter({
    projectId: PROJECT,
    store: env.store,
    readAccount: (accountKey) => env.accounts.readAccountForWorker('reddit', PROJECT, accountKey),
    callOpenClaw: async () => { throw new Error('the browser must not be asked'); },
    ...extra,
  });
}

// ── The store ──────────────────────────────────────────────────────────────

test('a project with no row reads as nobody chosen, Reddit at its plain default pace', async () => {
  const env = withDb();
  try {
    const res = await env.accounts.getAccount('reddit', SCOPE);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.expectedAccount, '');
    assert.equal(res.data.compareWith, '', 'Reddit has no first-run default');
    assert.deepEqual(res.data.pace, { maxCommentsPerDay: 3, minMinutesBetween: 20, jitterMinutes: 10 });
  } finally {
    env.restore();
  }
});

test('choosing an account saves it with both tenant columns, without "u/", and a second choice replaces it', async () => {
  const env = withDb();
  try {
    const first = await env.accounts.chooseAccount('reddit', 'u/Exotic-Break-7850', SCOPE);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.data.expectedAccount, 'Exotic-Break-7850');
    assert.ok(first.data.confirmedAt);
    const again = await env.accounts.chooseAccount('reddit', 'DaneOfEarth', SCOPE);
    assert.equal(again.data.expectedAccount, 'DaneOfEarth');
    const rows = await env.db.sbQuery({ method: 'GET', table: 'reddit_comment_settings', query: 'select=*' });
    assert.equal(rows.data.length, 1, 'one row per project and account');
    assert.equal(rows.data[0].project_id, PROJECT);
    assert.equal(rows.data[0].owner_user_id, 'user_dane');

    assert.equal((await env.accounts.chooseAccount('reddit', '  ', SCOPE)).status, 400);
    assert.equal((await env.accounts.chooseAccount('reddit', 'x', { projectId: PROJECT })).status, 400, 'no user, no write');
    assert.equal((await env.accounts.chooseAccount('myspace', 'x', SCOPE)).status, 400);
  } finally {
    env.restore();
  }
});

test('Reddit\'s pace saves whole numbers in range and refuses the rest', async () => {
  const env = withDb();
  try {
    const saved = await env.accounts.saveRedditPace({ maxCommentsPerDay: 5, minMinutesBetween: 30 }, SCOPE);
    assert.equal(saved.ok, true, saved.error);
    assert.deepEqual(saved.data.pace, { maxCommentsPerDay: 5, minMinutesBetween: 30, jitterMinutes: 10 });
    assert.equal((await env.accounts.saveRedditPace({ maxCommentsPerDay: 0 }, SCOPE)).status, 400);
    assert.equal((await env.accounts.saveRedditPace({ minMinutesBetween: 2.5 }, SCOPE)).status, 400);
    assert.equal((await env.accounts.saveRedditPace({}, SCOPE)).status, 400);
  } finally {
    env.restore();
  }
});

test('"Check now" leaves a request the worker sees once, and only after it was made', async () => {
  const env = withDb();
  try {
    const before = Date.now() - 1000;
    assert.equal(await env.accounts.checkRequestedSince({ reddit: PROJECT }, before), false);
    const asked = await env.accounts.requestCheck('reddit', SCOPE);
    assert.equal(asked.ok, true, asked.error);
    assert.equal(await env.accounts.checkRequestedSince({ reddit: PROJECT }, before), true);
    assert.equal(await env.accounts.checkRequestedSince({ reddit: PROJECT }, Date.now() + 1000), false, 'a check that ran after it answers it');
  } finally {
    env.restore();
  }
});

// ── The hourly check compares with the chosen account ──────────────────────

test('CONFIRMING AN ACCOUNT: the hourly check then reports "signed in as" it — and choosing another gives the wrong-account sentence', async () => {
  const env = withDb();
  try {
    const checks = poster.browserChecksFor([redditAdapter(env)]);

    // Nobody chosen: no verdict either way, but the Mini records who it saw.
    let run = await checkAs(checks, 'u/Exotic-Break-7850');
    assert.equal(run.results[0].state, 'cannot_tell');
    let seen = await env.accounts.getAccount('reddit', SCOPE);
    assert.equal(seen.data.observedAccount, 'Exotic-Break-7850', 'the screen can offer who the Mini is signed in as');

    // Dane clicks "Post as this account".
    await env.accounts.chooseAccount('reddit', seen.data.observedAccount, SCOPE);
    run = await checkAs(checks, 'u/Exotic-Break-7850');
    assert.equal(run.results[0].state, 'signed_in');
    assert.equal(run.results[0].message, 'Mini: signed in to Reddit as Exotic-Break-7850.');

    // BREAK TEST: he chooses an account the browser is NOT signed in as.
    await env.accounts.chooseAccount('reddit', 'DaneOfEarth', SCOPE);
    const posts = [];
    run = await checkAs(checks, 'u/Exotic-Break-7850', posts);
    assert.equal(run.results[0].state, 'wrong_account');
    assert.match(run.results[0].message, /signed in as "Exotic-Break-7850", not DaneOfEarth/);
    assert.match(posts.join('\n'), /not DaneOfEarth/, 'the wrong account reaches the bus');
    const check = await env.store.getBrowserCheck({ projectId: PROJECT });
    assert.equal(check.data.state, 'wrong_account');
    seen = await env.accounts.getAccount('reddit', SCOPE);
    assert.equal(seen.data.observedAccount, 'Exotic-Break-7850');
  } finally {
    env.restore();
  }
});

test('a choice that cannot be read falls back to the listed account and says so, rather than skipping the check', async () => {
  const run = await checkAs([{
    site: 'reddit',
    accountKey: 'dane_of_earth',
    profile: 'dane-of-earth',
    who: '',
    resolve: async () => { throw new Error('database asleep'); },
    record: async () => ({ ok: true }),
  }], 'u/Someone');
  assert.equal(run.results.length, 1);
  assert.match(run.problems.join('\n'), /the chosen account could not be read \(database asleep\)/);
});

// ── Nothing posts until an account is chosen ──────────────────────────────

test('NO ACCOUNT CONFIRMED: an approved Reddit comment stays approved and its row says "waiting: choose the account to post as"', async () => {
  const env = withDb();
  try {
    const at = new Date(Date.now() - 3600000).toISOString();
    const made = await env.db.sbQuery({
      method: 'POST',
      table: 'reddit_comment_items',
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [{
        project_id: PROJECT, owner_user_id: 'user_dane', target_url: 'https://www.reddit.com/r/x/comments/1abc2de/', post_id: '1abc2de',
        subreddit: 'x', post_title: 't', draft_text: 'words', final_text: 'words', status: 'approved', approved_by: 'user_dane', approved_at: at, created_at: at, updated_at: at,
      }],
    });
    assert.equal(made.ok, true, made.error);
    const pass = await poster.runPass({ adapters: [redditAdapter(env)] });
    assert.equal(pass.reports[0].posted, null);
    const row = (await env.db.sbQuery({ method: 'GET', table: 'reddit_comment_items', query: 'select=*' })).data[0];
    assert.equal(row.status, 'approved');
    assert.match(row.wait_reason, /^Waiting: choose the account to post as/);
  } finally {
    env.restore();
  }
});

test('the saved pace is what the Reddit adapter enforces', async () => {
  const env = withDb();
  try {
    await env.accounts.chooseAccount('reddit', 'DaneOfEarth', SCOPE);
    await env.accounts.saveRedditPace({ maxCommentsPerDay: 1, minMinutesBetween: 0 }, SCOPE);
    const adapter = redditAdapter(env);
    adapter.beginPass();
    const store = { ...env.store, listPostedForLimits: async () => ({ ok: true, data: [{ id: 'old', postedAt: new Date().toISOString() }] }) };
    const held = await reddit.createRedditAdapter({
      projectId: PROJECT,
      store,
      readAccount: (k) => env.accounts.readAccountForWorker('reddit', PROJECT, k),
    }).checkLimits({ id: 'new', accountKey: 'dane_of_earth', text: 'w', targetUrl: 'https://x', postId: '1abc2de' }, Date.now());
    assert.equal(held.ok, false);
    assert.match(held.reason, /1 of 1 comment a day/);
  } finally {
    env.restore();
  }
});

for (const [name, make] of [
  ['YouTube', (readAccount) => youtube.createYoutubeAdapter({ projectId: PROJECT, store: {}, targets: {}, readAccount })],
  ['Substack', (readAccount) => substack.createSubstackAdapter({ projectId: PROJECT, store: {}, readAccount })],
]) {
  test(`${name}: with no account chosen every item waits, account-wide, before anything else is read`, async () => {
    const adapter = make(async () => ({ ok: true, data: { expectedAccount: '', compareWith: 'Dane of Earth' } }));
    adapter.beginPass();
    const verdict = await adapter.checkLimits({ id: 'i1', accountKey: 'dane_of_earth', kind: 'note', text: 'hi' }, Date.now());
    assert.equal(verdict.ok, false);
    assert.equal(verdict.scope, 'account');
    assert.match(verdict.reason, new RegExp(`^Waiting: choose the account to post as — Engage › Outreach, ${name}, Connect\\.$`));
  });

  test(`${name}: the hourly check compares with the chosen account, falling back to the first-run default`, async () => {
    let row = { expectedAccount: '', compareWith: 'Dane of Earth' };
    const adapter = make(async () => ({ ok: true, data: row }));
    const checks = adapter.browserChecks ? adapter.browserChecks() : [];
    if (!checks.length) return; // Substack is checked by poster.js SIGN_IN_CHECKS, tested below
    assert.deepEqual(await checks[0].resolve(), { who: 'Dane of Earth' });
    row = { expectedAccount: 'Someone Else', compareWith: 'Someone Else' };
    assert.deepEqual(await checks[0].resolve(), { who: 'Someone Else' });
  });
}

test('the Substack sign-in-only check carries a resolve, so a choice on the screen counts from the next check', () => {
  const built = poster.buildSignInChecks({ YOUTUBE_OUTREACH_PROJECT_ID: PROJECT });
  assert.deepEqual(built.problems, []);
  assert.equal(built.checks[0].site, 'substack');
  assert.equal(typeof built.checks[0].resolve, 'function');
});

test('the worker runs its sign-in check early when "Check now" was pressed, and not otherwise', async () => {
  let now = Date.parse('2026-10-26T20:00:00Z');
  const calls = [];
  let askedAt = 0;
  await poster.runPoster({
    adapters: [],
    stopAfterPasses: 3,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
    write: () => {},
    recordBeat: () => {},
    passEveryMs: 2 * 60 * 1000,
    requestPollMs: 30 * 1000,
    checkHealth: async () => { calls.push(now); return ''; },
    // Pressed 45 seconds into the first wait.
    checkRequested: async (since) => { if (!askedAt) askedAt = now + 45 * 1000; return askedAt <= now && askedAt > since; },
  });
  const start = Date.parse('2026-10-26T20:00:00Z');
  assert.equal(calls[0], start, 'the first pass checks');
  assert.equal(calls.length, 2, 'one early check for the one request, and no more');
  assert.ok(calls[1] - start <= 90 * 1000, `answered within a minute and a half, not at the next hourly check (${(calls[1] - start) / 1000}s)`);
});
