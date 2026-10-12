'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Miner suggestions (86bch3f2v) — each undecided writer gets a
 * suggested Approve/Reject with reasons, learned from Dane's past decisions;
 * nothing is decided; too few decisions refuses before any AI call.
 *
 * The store is the REAL one over a fake database whose schema is read from
 * the setup file (so a missing `suggestion` column fails here too). The
 * archive fetch and the model are stand-ins.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = [
  '../../lib/projectScope.js', '../../lib/substackMinerStore.js', '../../lib/substackNotesStore.js',
  '../../lib/acquire/SubstackNotesReadRun.js', '../../lib/acquire/SubstackSuggestRun.js',
].map((p) => require.resolve(p));

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };

function withDb() {
  const sql = ['substack_miner_setup.sql', 'substack_notes_setup.sql']
    .map((f) => fs.readFileSync(path.join(SQL_DIR, f), 'utf8')).join('\n');
  const db = createFakeDb(parseSchemaText(sql));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({
        substackCandidates: 'substack_candidates',
        substackMinerSettings: 'substack_miner_settings',
        substackNotesItems: 'substack_notes_items',
        substackNotesSettings: 'substack_notes_settings',
      }),
      sbQuery: db.sbQuery,
    },
  };
  for (const p of ALL) delete require.cache[p];
  const store = require('../../lib/substackMinerStore.js');
  const run = require('../../lib/acquire/SubstackSuggestRun.js');
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { store, run, restore };
}

async function writer(store, handle, decision = null) {
  const saved = await store.upsertCandidate({ handle, name: handle, description: `${handle} writes things` }, SCOPE);
  assert.equal(saved.ok, true, saved.error);
  if (decision) {
    const done = await store.updateCandidate(saved.data.id, decision, SCOPE);
    assert.equal(done.ok, true, done.error);
  }
  return saved.data;
}

/** Five decisions: three approved, two rejected, each with Dane's tags. */
async function history(store) {
  await writer(store, 'deepone', { status: 'approved', decisionReasons: ['polymath'], note: 'thinks across fields' });
  await writer(store, 'deeptwo', { status: 'approved', decisionReasons: ['polymath', 'writes Notes daily'] });
  await writer(store, 'deepthree', { status: 'approved', decisionReasons: ['philosophy + AI'] });
  await writer(store, 'hypeone', { status: 'rejected', decisionReasons: ['AI hype'], note: 'growth hacking' });
  await writer(store, 'hypetwo', { status: 'rejected', decisionReasons: ['AI hype'] });
}

function fakeFetch(calls = [], fail = new Set()) {
  return async (url) => {
    calls.push(url);
    const sub = url.match(/^https:\/\/([^.]+)\.substack\.com\//);
    if (sub && fail.has(sub[1])) return { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
    return { ok: true, data: [{ title: `Post by ${sub ? sub[1] : 'x'}`, subtitle: 'on minds and machines' }, { title: '' }] };
  };
}

function fakeModel(answers, prompts = []) {
  return async (system, prompt) => {
    prompts.push({ system, prompt });
    const handle = (prompt.match(/The writer to judge:\nName: [^(]+\(([^)]+)\)/) || [])[1];
    const a = answers[handle];
    if (typeof a === 'function') return a();
    return { ok: true, text: a === undefined ? '{"action":"approved","reasons":["polymath"],"confidence":"low","why":"default"}' : a };
  };
}

const deps = (extra) => ({ sleep: async () => {}, ...extra });

test('suggests for each undecided writer, in Dane\'s spelling, deciding nothing', async () => {
  const { store, run, restore } = withDb();
  try {
    await history(store);
    const fresh = await writer(store, 'freshone');
    await writer(store, 'freshtwo');
    const prompts = [];
    const res = await run.runSubstackSuggestions(SCOPE, {}, deps({
      fetchJson: fakeFetch(),
      generate: fakeModel({
        freshone: '```json\n{"action":"approved","reasons":["Polymath","new angle","POLYMATH"],"confidence":"high","why":"Writes across philosophy and AI like the writers he approved."}\n```',
        freshtwo: 'Sure: {"action":"rejected","reasons":["ai hype"],"confidence":"medium","why":"Growth-hacking tone."}',
      }, prompts),
    }));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.basedOn, 5);
    assert.deepEqual(res.data.suggested.map((x) => [x.handle, x.action]).sort(), [['freshone', 'approved'], ['freshtwo', 'rejected']]);

    const back = await store.getCandidateById(fresh.id, SCOPE);
    assert.equal(back.data.status, 'candidate', 'a suggestion decides nothing');
    assert.deepEqual(back.data.suggestion.reasons, ['polymath', 'new angle'], 'snapped to his spelling, repeats dropped');
    assert.equal(back.data.suggestion.confidence, 'high');
    assert.equal(back.data.suggestion.basedOn, 5);
    const two = (await store.listCandidates(50, SCOPE)).data.find((c) => c.handle === 'freshtwo');
    assert.deepEqual(two.suggestion.reasons, ['AI hype']);

    // The model was shown his decisions, his words, his tags, and the writer's posts.
    const p = prompts[0].prompt;
    assert.match(p, /APPROVED: deepone/);
    assert.match(p, /REJECTED: hypeone/);
    assert.match(p, /His words: thinks across fields/);
    assert.match(p, /AI hype \(rejecting, used 2×\)/);
    assert.match(p, /Newest posts:\n {2}- Post by fresh/);
  } finally { restore(); }
});

test('a writer already suggested is skipped unless redo; redo suggests again', async () => {
  const { store, run, restore } = withDb();
  try {
    await history(store);
    await writer(store, 'freshone');
    const first = await run.runSubstackSuggestions(SCOPE, {}, deps({ fetchJson: fakeFetch(), generate: fakeModel({}) }));
    assert.equal(first.data.suggested.length, 1);
    const again = await run.runSubstackSuggestions(SCOPE, {}, deps({ fetchJson: fakeFetch(), generate: fakeModel({}) }));
    assert.equal(again.data.suggested.length, 0);
    assert.equal(again.data.alreadySuggested, 1);
    const redo = await run.runSubstackSuggestions(SCOPE, { redo: true }, deps({
      fetchJson: fakeFetch(),
      generate: fakeModel({ freshone: '{"action":"rejected","reasons":[],"confidence":"low","why":"changed"}' }),
    }));
    assert.equal(redo.data.suggested[0].action, 'rejected');
  } finally { restore(); }
});

test('too few decisions, or none of one kind: refused before any AI call or fetch', async () => {
  const { store, run, restore } = withDb();
  try {
    for (const h of ['a1', 'a2', 'a3', 'a4', 'a5']) await writer(store, h, { status: 'approved' });
    await writer(store, 'freshone');
    const calls = [];
    const prompts = [];
    const res = await run.runSubstackSuggestions(SCOPE, {}, deps({ fetchJson: fakeFetch(calls), generate: fakeModel({}, prompts) }));
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /5 approved and 0 rejected/);
    assert.equal(calls.length + prompts.length, 0);
  } finally { restore(); }
});

test('an unreadable answer is named and stores nothing; an unreadable archive still gets judged', async () => {
  const { store, run, restore } = withDb();
  try {
    await history(store);
    const bad = await writer(store, 'garbled');
    await writer(store, 'noposts');
    const res = await run.runSubstackSuggestions(SCOPE, {}, deps({
      fetchJson: fakeFetch([], new Set(['noposts'])),
      generate: fakeModel({ garbled: 'I think they are nice.', noposts: '{"action":"maybe","reasons":[],"confidence":"low","why":"x"}' }),
    }));
    assert.equal(res.ok, true);
    assert.deepEqual(res.data.notSuggested.map((x) => x.handle).sort(), ['garbled', 'noposts']);
    assert.match(res.data.notSuggested.find((x) => x.handle === 'noposts').reason, /action must be approved or rejected/);
    assert.deepEqual(res.data.postsUnread.map((x) => x.handle), ['noposts']);
    assert.equal((await store.getCandidateById(bad.id, SCOPE)).data.suggestion, null);
  } finally { restore(); }
});

test('a credit or key failure stops the run and says how many were not reached', async () => {
  const { store, run, restore } = withDb();
  try {
    await history(store);
    for (const h of ['f1', 'f2', 'f3']) await writer(store, h);
    let asked = 0;
    const res = await run.runSubstackSuggestions(SCOPE, {}, deps({
      fetchJson: fakeFetch(),
      generate: async () => { asked += 1; return { ok: false, error: 'Your credit balance is too low' }; },
    }));
    assert.equal(res.ok, true);
    assert.equal(asked, 1, 'one failure is enough to know');
    assert.equal(res.data.notReached, 2);
    assert.match(res.data.stoppedBecause, /credit balance/);
  } finally { restore(); }
});

test('the time budget leaves the rest for the next run, and says so', async () => {
  const { store, run, restore } = withDb();
  try {
    await history(store);
    for (const h of ['f1', 'f2', 'f3']) await writer(store, h);
    let t = 0;
    const res = await run.runSubstackSuggestions(SCOPE, {}, deps({
      fetchJson: fakeFetch(), generate: fakeModel({}), now: () => { t += 1000; return t; }, timeBudgetMs: 2500,
    }));
    assert.equal(res.data.suggested.length + res.data.notReached, 3);
    assert.ok(res.data.notReached > 0);
  } finally { restore(); }
});

test('recordSuggestion refuses a writer already decided, and a malformed suggestion by name', async () => {
  const { store, restore } = withDb();
  try {
    const decided = await writer(store, 'done', { status: 'approved' });
    const late = await store.recordSuggestion(decided.id, { action: 'rejected', reasons: [], confidence: 'low', why: '' }, SCOPE);
    assert.equal(late.ok, false);
    assert.equal(late.status, 409);
    const open = await writer(store, 'open');
    const odd = await store.recordSuggestion(open.id, { action: 'approved', reasons: [], confidence: 'certain', why: '' }, SCOPE);
    assert.match(odd.error, /confidence must be high, medium or low/);
  } finally { restore(); }
});

test('archiveUrl reads a custom domain when the writer has one', () => {
  const { run, restore } = withDb();
  try {
    assert.equal(run.archiveUrl({ handle: 'x', publicationUrl: 'https://www.example.com/' }), 'https://www.example.com/api/v1/archive?sort=new&limit=8');
    assert.equal(run.archiveUrl({ handle: 'x', publicationUrl: '' }), 'https://x.substack.com/api/v1/archive?sort=new&limit=8');
  } finally { restore(); }
});
