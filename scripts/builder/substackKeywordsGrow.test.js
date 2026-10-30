'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Miner upgrade 2/4 (86bcuxwkr) — the wider keyword list grows on its
 * own from APPROVED writers: their posts, Dane's approval sentence, and the
 * reasons he ticked.
 *
 * The store is the REAL one over a fake database whose schema is read from
 * docs/SQL/substack_miner_setup.sql, so a missing wider_keywords /
 * removed_keywords column fails here. The model is a stand-in.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = [
  '../../lib/projectScope.js', '../../lib/substackMinerStore.js', '../../lib/acquire/SubstackKeywordsGrow.js',
].map((p) => require.resolve(p));

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };

function withDb() {
  const sql = fs.readFileSync(path.join(SQL_DIR, 'substack_miner_setup.sql'), 'utf8');
  const db = createFakeDb(parseSchemaText(sql));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({ substackCandidates: 'substack_candidates', substackMinerSettings: 'substack_miner_settings' }),
      sbQuery: db.sbQuery,
    },
  };
  for (const p of ALL) delete require.cache[p];
  const store = require('../../lib/substackMinerStore.js');
  const grow = require('../../lib/acquire/SubstackKeywordsGrow.js');
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { db, store, grow, restore };
}

async function writer(store, handle, decision = null, posts = null) {
  const saved = await store.upsertCandidate({ handle, name: handle }, SCOPE);
  assert.equal(saved.ok, true, saved.error);
  if (decision) {
    const done = await store.updateCandidate(saved.data.id, decision, SCOPE);
    assert.equal(done.ok, true, done.error);
  }
  if (posts) {
    const read = await store.recordRecentPosts(saved.data.id, { posts }, SCOPE);
    assert.equal(read.ok, true, read.error);
  }
  return saved.data;
}

const POSTS = [{ title: 'Metamodernism and the oscillating self', subtitle: 'a note on sincerity', excerpt: 'Between irony and sincerity…' }];

/** Two approved writers (one with posts, one with a note) and one rejected. */
async function approvedPair(store) {
  await writer(store, 'deepone', { status: 'approved', decisionReasons: ['Polymath ', 'writes  Notes daily'] }, POSTS);
  await writer(store, 'deeptwo', { status: 'approved', decisionReasons: ['polymath'], note: 'Writes about metamodernism and ritual' });
  await writer(store, 'hypeone', { status: 'rejected', decisionReasons: ['AI hype'], note: 'growth hacking' }, [{ title: 'Ten growth hacks' }]);
}

function model(reply, prompts = []) {
  return async (system, prompt) => {
    prompts.push({ system, prompt });
    return typeof reply === 'function' ? reply(prompt) : reply;
  };
}

const TOPICS = {
  ok: true,
  text: '```json\n' + JSON.stringify({ topics: [
    { topic: 'metamodernism', posts: ['deepone'], notes: ['deeptwo'] },
    { topic: 'sincerity', posts: ['deepone'], notes: [] },
    { topic: 'a whole sentence about many things at once', posts: ['deepone'] },
    { topic: 'growth hacks', posts: ['hypeone'] },
    { topic: 'ritual', posts: [], notes: ['nobody-shown'] },
  ] }) + '\n```',
};

test('the SQL adds both columns to the settings table, idempotently', () => {
  const sql = fs.readFileSync(path.join(SQL_DIR, 'substack_miner_setup.sql'), 'utf8');
  assert.match(sql, /alter table public\.substack_miner_settings add column if not exists wider_keywords jsonb not null default '\[\]'::jsonb;/);
  assert.match(sql, /alter table public\.substack_miner_settings add column if not exists removed_keywords jsonb not null default '\[\]'::jsonb;/);
});

test('one pass adds keywords from posts, notes AND reasons, each recording its kind and writer', async () => {
  const { store, grow, restore } = withDb();
  try {
    await approvedPair(store);
    const prompts = [];
    const res = await grow.runKeywordsGrow(SCOPE, { generate: model(TOPICS, prompts) });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.approved, 2);
    assert.equal(res.data.topicsSkipped, undefined);
    // Only approved writers are shown to the model — never the rejected one.
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].prompt, /WRITER deepone/);
    assert.match(prompts[0].prompt, /Dane's words on approving: Writes about metamodernism/);
    assert.doesNotMatch(prompts[0].prompt, /hypeone|growth hacking/);

    const settings = await store.getSettings(SCOPE);
    const bySource = (a, b) => `${a.kind}${a.handle}`.localeCompare(`${b.kind}${b.handle}`);
    const byWord = Object.fromEntries(settings.data.widerKeywords.map((e) => [e.keyword, [...e.sources].sort(bySource)]));
    assert.deepEqual(byWord.metamodernism, [{ kind: 'note', handle: 'deeptwo' }, { kind: 'post', handle: 'deepone' }]);
    assert.deepEqual(byWord.sincerity, [{ kind: 'post', handle: 'deepone' }]);
    // Reasons word for word after cleaning; "polymath" from two writers (spelled
    // "Polymath " and "polymath") is ONE keyword with two sources.
    const polymath = Object.keys(byWord).filter((k) => k.toLowerCase() === 'polymath');
    assert.equal(polymath.length, 1);
    assert.deepEqual(byWord[polymath[0]], [{ kind: 'reason', handle: 'deepone' }, { kind: 'reason', handle: 'deeptwo' }]);
    assert.deepEqual(byWord['writes Notes daily'], [{ kind: 'reason', handle: 'deepone' }]);
    // A sentence, a rejected writer's topic, and a topic naming nobody shown are dropped and counted.
    assert.equal(byWord['a whole sentence about many things at once'], undefined);
    assert.equal(byWord['growth hacks'], undefined);
    assert.equal(byWord.ritual, undefined);
    assert.equal(byWord['AI hype'], undefined);
    assert.equal(res.data.topicsDropped, 3);
    assert.ok(settings.data.widerKeywords.every((e) => e.firstSeenAt));
  } finally { restore(); }
});

test('a keyword Dane removed never comes back, even when a later pass finds it again', async () => {
  const { store, grow, restore } = withDb();
  try {
    await approvedPair(store);
    await grow.runKeywordsGrow(SCOPE, { generate: model(TOPICS) });
    const removed = await store.removeWiderKeyword('  METAMODERNISM ', SCOPE);
    assert.equal(removed.ok, true, removed.error);
    assert.ok(!removed.data.widerKeywords.some((e) => e.keyword === 'metamodernism'));
    assert.deepEqual(removed.data.removedKeywords, ['METAMODERNISM']);

    const again = await grow.runKeywordsGrow(SCOPE, { generate: model(TOPICS) });
    assert.equal(again.ok, true, again.error);
    assert.equal(again.data.removedBefore, 1);
    const after = await store.getSettings(SCOPE);
    assert.ok(!after.data.widerKeywords.some((e) => e.keyword.toLowerCase() === 'metamodernism'));
  } finally { restore(); }
});

test('a keyword already in the search list is never added to the wider list, ignoring case', async () => {
  const { store, grow, restore } = withDb();
  try {
    await approvedPair(store);
    await store.saveSettings({ keywords: ['SINCERITY', 'polymath'] }, SCOPE);
    const res = await grow.runKeywordsGrow(SCOPE, { generate: model(TOPICS) });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.alreadySearched, 2);
    const words = res.data.widerKeywords.map((e) => e.keyword.toLowerCase());
    assert.ok(!words.includes('sincerity'));
    assert.ok(!words.includes('polymath'));
    assert.ok(words.includes('metamodernism'));
  } finally { restore(); }
});

test('Add to search goes through the ordinary settings save, and the keyword then leaves the wider list', async () => {
  const { store, grow, restore } = withDb();
  try {
    await approvedPair(store);
    await grow.runKeywordsGrow(SCOPE, { generate: model(TOPICS) });
    const before = await store.getSettings(SCOPE);
    assert.ok(before.data.widerKeywords.some((e) => e.keyword === 'metamodernism'));
    // What the Run tab sends: the search list plus the one keyword.
    const saved = await store.saveSettings({ keywords: [...before.data.keywords, 'metamodernism'] }, SCOPE);
    assert.equal(saved.ok, true, saved.error);
    assert.deepEqual(saved.data.keywords, ['metamodernism']);
    assert.ok(!saved.data.widerKeywords.some((e) => e.keyword === 'metamodernism'));
    // The settings save cannot write the wider list itself.
    const refused = await store.saveSettings({ widerKeywords: [] }, SCOPE);
    assert.equal(refused.ok, false);
    assert.match(refused.error, /Unknown field/);
  } finally { restore(); }
});

test('if the AI call fails, the reason keywords are still added and the summary says topics were skipped and why', async () => {
  const { store, grow, restore } = withDb();
  try {
    await approvedPair(store);
    const res = await grow.runKeywordsGrow(SCOPE, { generate: model({ ok: false, error: 'Your credit balance is too low.' }) });
    assert.equal(res.ok, true, res.error);
    assert.match(res.data.topicsSkipped, /the AI did not answer: Your credit balance is too low/);
    assert.deepEqual(res.data.added.map((k) => k.toLowerCase()).sort(), ['polymath', 'writes notes daily']);
    const lines = grow.formatKeywordsGrowSummary(res.data).join('\n');
    assert.match(lines, /Topics from posts and notes were skipped: the AI did not answer: Your credit balance is too low\. Keywords/);
    assert.match(lines, /Keywords from your reasons were still added/);

    const garbled = await grow.runKeywordsGrow(SCOPE, { generate: model({ ok: true, text: 'Sure! Here are some topics.' }) });
    assert.match(garbled.data.topicsSkipped, /not with a list of topics/);
  } finally { restore(); }
});

test('with nothing to read, no AI call is made and the summary says why', async () => {
  const { store, grow, restore } = withDb();
  try {
    let calls = 0;
    const generate = async () => { calls += 1; return TOPICS; };
    const none = await grow.runKeywordsGrow(SCOPE, { generate });
    assert.equal(none.ok, true, none.error);
    assert.equal(none.data.approved, 0);
    assert.match(none.data.topicsSkipped, /no approved writers/);

    await writer(store, 'quiet', { status: 'approved', decisionReasons: ['calm'] });
    const unread = await grow.runKeywordsGrow(SCOPE, { generate });
    assert.equal(unread.data.withPostsRead, 0);
    assert.match(unread.data.topicsSkipped, /none of your 1 approved writer has posts read yet/);
    assert.deepEqual(unread.data.added, ['calm']);
    assert.equal(calls, 0);
  } finally { restore(); }
});

test('the wider list stops at 300 and counts what it could not add', async () => {
  const { store, restore } = withDb();
  try {
    const many = Array.from({ length: 305 }, (_, i) => ({ keyword: `topic ${i}`, sources: [{ kind: 'post', handle: 'w' }] }));
    const res = await store.mergeWiderKeywords(many, SCOPE);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.added.length, 300);
    assert.equal(res.data.overCap, 5);
    assert.equal(res.data.settings.widerKeywords.length, 300);
  } finally { restore(); }
});

test('the wider lists are tenanted: another project sees none of them', async () => {
  const { db, store, restore } = withDb();
  try {
    await store.mergeWiderKeywords([{ keyword: 'ritual', sources: [{ kind: 'note', handle: 'w' }] }], SCOPE);
    const row = db.data.get('substack_miner_settings')[0];
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.owner_user_id, 'user_1');
    const other = await store.getSettings({ projectId: 'proj_b', userId: 'user_2' });
    assert.deepEqual(other.data.widerKeywords, []);
    const blank = await store.removeWiderKeyword('ritual', { projectId: '' });
    assert.equal(blank.ok, false);
  } finally { restore(); }
});
