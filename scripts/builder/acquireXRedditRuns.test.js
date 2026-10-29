'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Task 86bcug169 — the Acquire screen's X and Reddit run history lives in
 * Supabase now, not in data/*.json (which Vercel skips without an error, so no
 * run made on the live site was ever kept).
 *
 * The fake database reads its schema FROM docs/SQL/acquire_x_reddit_runs_setup.sql,
 * so a column the stores write but the SQL does not declare fails here — and
 * so does a table missing owner_user_id, which would make scopedInsertRow stamp
 * no tenant at all (CLAUDE.md landmine 12).
 */

const SQL_FILE = path.join(__dirname, '..', '..', 'docs', 'SQL', 'acquire_x_reddit_runs_setup.sql');
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = [
  '../../lib/projectScope.js',
  '../../lib/acquire/acquireRunsTable.js',
  '../../lib/acquire/XAcquireStore.js',
  '../../lib/acquire/RedditAcquireStore.js',
].map((p) => require.resolve(p));

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const OTHER = { projectId: 'proj_b', userId: 'user_2' };

function withDb({ sql = fs.readFileSync(SQL_FILE, 'utf8') } = {}) {
  const db = createFakeDb(parseSchemaText(sql));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({ xAcquireRuns: 'x_acquire_runs', redditAcquireRuns: 'reddit_acquire_runs' }),
      sbQuery: db.sbQuery,
    },
  };
  for (const p of ALL) delete require.cache[p];
  const x = require('../../lib/acquire/XAcquireStore.js');
  const reddit = require('../../lib/acquire/RedditAcquireStore.js');
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { db, x, reddit, restore };
}

/** Every write the stores make goes to the database, never under data/. */
function watchDataWrites() {
  const seen = [];
  const originals = {};
  for (const name of ['writeFileSync', 'renameSync', 'mkdirSync']) {
    originals[name] = fs[name];
    fs[name] = function (target, ...rest) {
      if (String(target).startsWith(DATA_DIR)) seen.push(`${name} ${target}`);
      return originals[name].call(this, target, ...rest);
    };
  }
  return { seen, stop() { Object.assign(fs, originals); } };
}

const X_INPUT = {
  query: 'consciousness', hashtags: ['awake'], lang: 'en', start_time: '', end_time: '',
  max_tweets: 10, max_replies_per_tweet: 5, include_replies: true,
};
const X_RESULT = {
  tweets: [{ id: 't1', text: 'hello' }, { id: 't2', text: 'world' }],
  replies: [{ id: 'r1' }], meta: { threads_scanned: 2 }, errors: [],
};

const REDDIT_INPUT = {
  target: 'r/philosophy', mode: 'subreddit', source_mode: 'openclaw', subreddit: 'philosophy',
  sort: 'new', max_posts: 25, max_comments: 100, keyword: 'meaning', start_time: '', end_time: '',
  include_replies: true,
};
const REDDIT_RESULT = { subreddit: 'philosophy', posts: [{ id: 'p1' }, { id: 'p2' }], comments: [{ id: 'c1' }], errors: [] };

test('X: a run is saved to the table, listed, opened and deleted — and nothing is written under data/', async () => {
  const { db, x, restore } = withDb();
  const writes = watchDataWrites();
  try {
    const created = await x.createXAcquireRun(X_INPUT, X_RESULT, SCOPE);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.status, 201);
    const id = created.data.run_id;
    assert.match(id, /^xrun_/);

    const rows = db.data.get('x_acquire_runs');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, 'proj_a', 'the row carries its tenant');
    assert.equal(rows[0].owner_user_id, 'user_1', 'and its owner');
    assert.deepEqual(rows[0].hashtags, ['awake']);

    const list = await x.listXAcquireRuns(20, SCOPE);
    assert.equal(list.ok, true);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].run_id, id);
    assert.equal(list.data[0].total_tweets, 2);
    assert.equal(list.data[0].total_replies, 1);
    assert.equal(list.data[0].threads_scanned, 2);

    const one = await x.getXAcquireRun(id, SCOPE);
    assert.equal(one.ok, true);
    assert.deepEqual(one.data.result.tweets.map((t) => t.id), ['t1', 't2']);
    assert.equal(one.data.request.query, 'consciousness');

    const del = await x.deleteXAcquireRun(id, SCOPE);
    assert.deepEqual(del.data, { deleted: true, run_id: id });
    assert.equal((await x.getXAcquireRun(id, SCOPE)).status, 404);
    assert.equal((await x.deleteXAcquireRun(id, SCOPE)).status, 404, 'deleting it twice says it is gone');

    assert.deepEqual(writes.seen, [], 'no write under data/ remains');
  } finally { writes.stop(); restore(); }
});

test('Reddit: a run is saved to the table, listed, opened and deleted — and nothing is written under data/', async () => {
  const { db, reddit, restore } = withDb();
  const writes = watchDataWrites();
  try {
    const created = await reddit.createRedditAcquireRun(REDDIT_INPUT, REDDIT_RESULT, SCOPE);
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.data.run_id;
    assert.match(id, /^rrun_/);

    const [row] = db.data.get('reddit_acquire_runs');
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.owner_user_id, 'user_1');
    assert.equal(row.keyword, 'meaning');
    assert.equal(row.max_comments, 100);

    const list = await reddit.listRedditAcquireRuns(20, SCOPE);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].total_posts, 2);
    assert.equal(list.data[0].total_comments, 1);
    assert.equal(list.data[0].sort, 'new');

    const one = await reddit.getRedditAcquireRun(id, SCOPE);
    assert.deepEqual(one.data.result.posts.map((p) => p.id), ['p1', 'p2']);

    assert.equal((await reddit.deleteRedditAcquireRun(id, SCOPE)).ok, true);
    assert.equal((await reddit.listRedditAcquireRuns(20, SCOPE)).data.length, 0);

    assert.deepEqual(writes.seen, [], 'no write under data/ remains');
  } finally { writes.stop(); restore(); }
});

test('another project cannot see, open or delete a run', async () => {
  const { x, reddit, restore } = withDb();
  try {
    const xr = (await x.createXAcquireRun(X_INPUT, X_RESULT, SCOPE)).data;
    const rr = (await reddit.createRedditAcquireRun(REDDIT_INPUT, REDDIT_RESULT, SCOPE)).data;

    assert.equal((await x.listXAcquireRuns(20, OTHER)).data.length, 0);
    assert.equal((await reddit.listRedditAcquireRuns(20, OTHER)).data.length, 0);
    assert.equal((await x.getXAcquireRun(xr.run_id, OTHER)).status, 404);
    assert.equal((await reddit.getRedditAcquireRun(rr.run_id, OTHER)).status, 404);
    assert.equal((await x.deleteXAcquireRun(xr.run_id, OTHER)).status, 404);
    assert.equal((await x.listXAcquireRuns(20, SCOPE)).data.length, 1, 'the owner still has it');
  } finally { restore(); }
});

test('the history lists newest first and honours the limit', async () => {
  const { x, restore } = withDb();
  try {
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await x.createXAcquireRun({ ...X_INPUT, query: `q${i}` }, X_RESULT, SCOPE)).data.run_id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const list = await x.listXAcquireRuns(2, SCOPE);
    assert.deepEqual(list.data.map((r) => r.query), ['q2', 'q1']);
  } finally { restore(); }
});

test('when the table is missing the store says so — it does not answer success and keep nothing', async () => {
  // A database with neither table: exactly production before the SQL is run.
  const { x, reddit, restore } = withDb({ sql: '' });
  try {
    const xs = await x.createXAcquireRun(X_INPUT, X_RESULT, SCOPE);
    assert.equal(xs.ok, false);
    assert.match(xs.error, /Could not save the X run/);
    const rs = await reddit.createRedditAcquireRun(REDDIT_INPUT, REDDIT_RESULT, SCOPE);
    assert.equal(rs.ok, false);
    assert.match(rs.error, /Could not save the Reddit run/);
    const list = await x.listXAcquireRuns(20, SCOPE);
    assert.equal(list.ok, false, 'an unreadable history is an error, not an empty list');
    assert.match(list.error, /Could not read the X run history/);
  } finally { restore(); }
});
