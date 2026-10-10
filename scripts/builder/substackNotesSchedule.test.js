'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Notes 5/7 (86bcet77n) — topic drafts on a timer.
 *
 * The pure rules (lib/substackNotesSchedule.js) are tested on hand-made items
 * standing on a fixed clock. The pass (lib/substackNotesRunDue.js) is tested
 * against the fake database built from BOTH SQL files — the 1/7 tables plus
 * the 5/7 switch column — with a stand-in AI that says what it wrote.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SETUP_SQL = fs.readFileSync(path.join(SQL_DIR, 'substack_notes_setup.sql'), 'utf8');
const SWITCH_SQL = fs.readFileSync(path.join(SQL_DIR, 'substack_notes_auto_topic_drafts.sql'), 'utf8');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
const schedule = require('../../lib/substackNotesSchedule.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackNotesStore.js');
const runDuePath = require.resolve('../../lib/substackNotesRunDue.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const ZONE = 'America/Denver';
// Thursday 2026-10-08, 12:10pm in Denver.
const NOON = Date.UTC(2026, 9, 8, 18, 10);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(ms) { return new Date(ms).toISOString(); }

function settings(overrides = {}) {
  return { autoTopicDrafts: true, topics: ['night sky', 'living off grid'], maxActionsPerDay: 2, ...overrides };
}

function topicNote(topic, at, status = 'draft') {
  return { kind: 'note', source: 'topic', ideaText: topic, status, createdAt: iso(at) };
}

// ── The rules, on their own ────────────────────────────────────────────────

test('switched off, no topics, or a limit of 0: nothing is drafted and the reason is named', () => {
  const off = schedule.planTopicDrafts({ settings: settings({ autoTopicDrafts: false }), items: [], now: NOON, timeZone: ZONE });
  assert.equal(off.count, 0);
  assert.equal(off.text, 'No topic drafts: switched off in Settings');

  // A settings row saved before the 5/7 SQL ran has no switch at all: off.
  const absent = schedule.planTopicDrafts({ settings: { topics: ['a'], maxActionsPerDay: 3 }, items: [], now: NOON, timeZone: ZONE });
  assert.equal(absent.reason, 'off');

  const empty = schedule.planTopicDrafts({ settings: settings({ topics: [] }), items: [], now: NOON, timeZone: ZONE });
  assert.equal(empty.count, 0);
  assert.equal(empty.text, 'No topic drafts: no topics saved in Settings');

  const zero = schedule.planTopicDrafts({ settings: settings({ maxActionsPerDay: 0 }), items: [], now: NOON, timeZone: ZONE });
  assert.equal(zero.count, 0);
  assert.match(zero.text, /Most actions per day is 0/);
});

test('two topics, nothing waiting: drafts up to the daily limit, one on each topic', () => {
  const plan = schedule.planTopicDrafts({ settings: settings(), items: [], now: NOON, timeZone: ZONE });
  assert.equal(plan.count, 2);
  assert.deepEqual(plan.topics, ['night sky', 'living off grid']);
  assert.equal(plan.reason, 'due');
  // The next half-hour pass, in Denver time.
  assert.equal(plan.text, 'Next topic draft: about 12:30 PM MDT ("night sky")');
  // No zone anywhere: UTC, and it says so.
  const utc = schedule.planTopicDrafts({ settings: settings(), items: [], now: NOON, timeZone: '' });
  assert.equal(utc.text, 'Next topic draft: about 6:30 PM UTC ("night sky")');
});

test('NEVER more waiting for approval than the daily limit — every kind counts', () => {
  const waiting = [
    { kind: 'note', source: 'jotted', status: 'draft', createdAt: iso(NOON - DAY) },
    { kind: 'reply', source: 'target', status: 'draft', createdAt: iso(NOON - DAY) },
    { kind: 'like', source: 'target', status: 'idea', createdAt: iso(NOON - DAY) },
  ];
  const full = schedule.planTopicDrafts({ settings: settings({ maxActionsPerDay: 3 }), items: waiting, now: NOON, timeZone: ZONE });
  assert.equal(full.count, 0);
  assert.equal(full.reason, 'full');
  assert.equal(full.text, 'No topic draft for now: 3 already waiting for your approval (the most per day is 3)');

  // One slot open: exactly one topic draft, never two.
  const oneOpen = schedule.planTopicDrafts({ settings: settings({ maxActionsPerDay: 4 }), items: waiting, now: NOON, timeZone: ZONE });
  assert.equal(oneOpen.count, 1);

  // Approved, posted and rejected items are not waiting for approval.
  const decided = ['approved', 'posted', 'rejected'].map((status) => ({ kind: 'note', source: 'jotted', status, createdAt: iso(NOON - DAY) }));
  assert.equal(schedule.planTopicDrafts({ settings: settings(), items: decided, now: NOON, timeZone: ZONE }).count, 2);
});

test('the pass never fills more slots than are open, whatever the limit and the waiting count', () => {
  for (let cap = 1; cap <= 6; cap += 1) {
    for (let already = 0; already <= cap + 1; already += 1) {
      const items = Array.from({ length: already }, () => ({ kind: 'reply', source: 'target', status: 'draft', createdAt: iso(NOON - DAY) }));
      const plan = schedule.planTopicDrafts({ settings: settings({ maxActionsPerDay: cap, topics: ['a', 'b', 'c'] }), items, now: NOON, timeZone: ZONE });
      assert.ok(plan.count <= Math.max(0, cap - already), `cap ${cap}, ${already} waiting: drafted ${plan.count}`);
      assert.equal(plan.count, Math.max(0, cap - already), `cap ${cap}, ${already} waiting`);
    }
  }
});

test("Dane's own undrafted ideas come first and hold their slot", () => {
  const items = [{ kind: 'note', source: 'jotted', ideaText: 'my idea', status: 'idea', createdAt: iso(NOON - HOUR) }];
  const plan = schedule.planTopicDrafts({ settings: settings(), items, now: NOON, timeZone: ZONE });
  assert.equal(plan.count, 1);

  const two = [...items, { kind: 'note', source: 'new_content', ideaText: 'video', status: 'idea', createdAt: iso(NOON - HOUR) }];
  const none = schedule.planTopicDrafts({ settings: settings(), items: two, now: NOON, timeZone: ZONE });
  assert.equal(none.count, 0);
  assert.equal(none.text, 'No topic draft for now: 2 ideas of yours not drafted yet (the most per day is 2)');
});

test('at his daily pace: once the limit of topic drafts is written today, none until tomorrow', () => {
  // Two topic drafts written this morning, both already approved — the slots are open again.
  const items = [
    topicNote('night sky', NOON - 3 * HOUR, 'approved'),
    topicNote('living off grid', NOON - 3 * HOUR + 1000, 'approved'),
  ];
  const today = schedule.planTopicDrafts({ settings: settings(), items, now: NOON, timeZone: ZONE });
  assert.equal(today.count, 0);
  assert.equal(today.reason, 'daily_done');
  assert.equal(today.text, 'No more topic drafts today: 2 topic drafts written today, the most per day is 2');

  // The next morning in Denver it drafts again.
  const tomorrow = schedule.planTopicDrafts({ settings: settings(), items, now: NOON + DAY, timeZone: ZONE });
  assert.equal(tomorrow.count, 2);
});

test('the same topic is never drafted twice in a row when there are two or more', () => {
  const items = [topicNote('night sky', NOON - HOUR, 'rejected')];
  const plan = schedule.planTopicDrafts({ settings: settings({ maxActionsPerDay: 1 }), items, now: NOON + DAY, timeZone: ZONE });
  assert.deepEqual(plan.topics, ['living off grid']);

  // Pass after pass, one draft at a time: it alternates.
  let history = [];
  let clock = NOON;
  const sequence = [];
  for (let i = 0; i < 6; i += 1) {
    const [topic] = schedule.pickTopics(['night sky', 'living off grid'], history, 1, clock);
    sequence.push(topic);
    history = [...history, topicNote(topic, clock)];
    clock += DAY;
  }
  for (let i = 1; i < sequence.length; i += 1) assert.notEqual(sequence[i], sequence[i - 1], sequence.join(' → '));

  // Within one pass, too.
  assert.deepEqual(schedule.pickTopics(['a', 'b'], [], 3, NOON), ['a', 'b', 'a']);
  // A single topic has nothing to rotate with.
  assert.deepEqual(schedule.pickTopics(['only'], [topicNote('only', NOON - HOUR)], 2, NOON), ['only', 'only']);
});

test('a topic drafted in the last 7 days waits while another has not been', () => {
  const items = [
    topicNote('a', NOON - 2 * DAY),
    topicNote('b', NOON - 3 * DAY),
    topicNote('c', NOON - 10 * DAY),
    topicNote('d', NOON - 1 * DAY),
  ];
  assert.deepEqual(schedule.pickTopics(['a', 'b', 'c', 'd', 'e'], items, 2, NOON), ['e', 'c']);
  // Matched case-insensitively against what was saved on the item.
  assert.deepEqual(schedule.pickTopics(['Night Sky', 'stars'], [topicNote('night sky', NOON - HOUR)], 1, NOON), ['stars']);
});

// ── The pass, against the fake database ────────────────────────────────────

function withDb() {
  const db = createFakeDb(parseSchemaText(`${SETUP_SQL}\n${SWITCH_SQL}`));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ substackNotesItems: 'substack_notes_items', substackNotesSettings: 'substack_notes_settings' }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [projectScopePath, storePath, runDuePath]) delete require.cache[p];
  const store = require(storePath);
  const runDue = require(runDuePath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [projectScopePath, storePath, runDuePath]) delete require.cache[p];
  }
  return { db, store, runDue, restore };
}

/** A stand-in AI: each draft names its topic, so the test can see which was written. */
function writer() {
  const asked = [];
  const generate = async (system, prompt) => {
    asked.push(prompt);
    const topic = (/night sky|living off grid/.exec(prompt) || ['something'])[0];
    return { ok: true, text: JSON.stringify({ text: `A short Note about ${topic}, written for the test.` }) };
  };
  return { generate, asked };
}

const PASS = { projectTimeZone: async () => ZONE };

async function switchOn(store, scope = SCOPE_A, extra = {}) {
  const saved = await store.saveSettings({
    topics: ['night sky', 'living off grid'], maxActionsPerDay: 2, autoTopicDrafts: true, ...extra,
  }, scope);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.data.autoTopicDrafts, true);
}

test('the switch saves, reads back, and defaults off', async () => {
  const { store, restore } = withDb();
  try {
    const before = await store.getSettings(SCOPE_A);
    assert.equal(before.data.autoTopicDrafts, false);
    await switchOn(store);
    assert.equal((await store.getSettings(SCOPE_A)).data.autoTopicDrafts, true);
    // Saving other settings leaves it alone.
    await store.saveSettings({ voice: 'plain' }, SCOPE_A);
    assert.equal((await store.getSettings(SCOPE_A)).data.autoTopicDrafts, true);
    const bad = await store.saveSettings({ autoTopicDrafts: 'yes' }, SCOPE_A);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /autoTopicDrafts must be true or false/);
  } finally {
    restore();
  }
});

test('before the 5/7 SQL runs, every other setting still saves and the switch says which file is missing', async () => {
  const db = createFakeDb(parseSchemaText(SETUP_SQL));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ substackNotesItems: 'substack_notes_items', substackNotesSettings: 'substack_notes_settings' }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [projectScopePath, storePath, runDuePath]) delete require.cache[p];
  try {
    const store = require(storePath);
    const runDue = require(runDuePath);
    const saved = await store.saveSettings({ topics: ['night sky'], maxActionsPerDay: 2 }, SCOPE_A);
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.data.autoTopicDrafts, false);

    const refused = await store.saveSettings({ autoTopicDrafts: true }, SCOPE_A);
    assert.equal(refused.ok, false);
    assert.match(refused.error, /substack_notes_auto_topic_drafts\.sql has to be run first/);

    const pass = await runDue.runDue({ ...PASS, generate: writer().generate });
    assert.equal(pass.ok, false);
    assert.match(pass.error, /substack_notes_auto_topic_drafts\.sql/);
  } finally {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [projectScopePath, storePath, runDuePath]) delete require.cache[p];
  }
});

test('a pass drafts up to the limit; a second pass drafts nothing more', async () => {
  const { store, runDue, restore } = withDb();
  try {
    await switchOn(store);
    const ai = writer();
    const first = await runDue.runDue({ ...PASS, generate: ai.generate });
    assert.equal(first.ok, true, first.error);
    assert.equal(first.data.accounts, 1);
    assert.deepEqual(first.data.drafted.map((d) => d.topic), ['night sky', 'living off grid']);
    assert.deepEqual(first.data.failed, []);

    const items = (await store.listItems(100, SCOPE_A)).data;
    assert.equal(items.length, 2);
    for (const item of items) {
      assert.equal(item.kind, 'note');
      assert.equal(item.source, 'topic');
      assert.equal(item.status, 'draft', 'a draft waiting for approval — never approved by the timer');
      assert.match(item.draftText, /A short Note about/);
    }

    const second = await runDue.runDue({ ...PASS, generate: ai.generate });
    assert.equal(second.data.drafted.length, 0);
    assert.equal(second.data.idle[0].reason, 'full');
    assert.equal((await store.listItems(100, SCOPE_A)).data.length, 2, 'still 2, not 4');
    assert.equal(ai.asked.length, 2);
  } finally {
    restore();
  }
});

test('three already waiting with a limit of 3: nothing drafted, and the screen line says why', async () => {
  const { store, runDue, restore } = withDb();
  try {
    await switchOn(store, SCOPE_A, { maxActionsPerDay: 3 });
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const like = await store.createItem({ kind: 'like', targetUrl: `https://substack.com/@a/note/c-${100 + i}` }, SCOPE_A);
      assert.equal(like.ok, true, like.error);
    }
    const ai = writer();
    const pass = await runDue.runDue({ ...PASS, generate: ai.generate });
    assert.equal(pass.data.drafted.length, 0);
    assert.equal(ai.asked.length, 0);

    const line = await runDue.describeTopicSchedule(SCOPE_A, PASS);
    assert.equal(line.ok, true, line.error);
    assert.equal(line.data.due, false);
    assert.equal(line.data.text, 'No topic draft for now: 3 already waiting for your approval (the most per day is 3)');
  } finally {
    restore();
  }
});

test('only accounts with the switch on are drafted for, each in its own project', async () => {
  const { store, runDue, restore } = withDb();
  try {
    await switchOn(store, SCOPE_A);
    await store.saveSettings({ topics: ['night sky'], maxActionsPerDay: 2 }, SCOPE_B);
    const pass = await runDue.runDue({ ...PASS, generate: writer().generate });
    assert.equal(pass.data.accounts, 1);
    assert.equal((await store.listItems(100, SCOPE_B)).data.length, 0);
    const a = (await store.listItems(100, SCOPE_A)).data;
    assert.equal(a.length, 2);
    assert.ok(a.every((item) => item.projectId === 'proj_a'));
  } finally {
    restore();
  }
});

test('a draft the AI could not write leaves no idea behind and is reported', async () => {
  const { store, runDue, restore } = withDb();
  try {
    await switchOn(store);
    const pass = await runDue.runDue({ ...PASS, generate: async () => ({ ok: false, error: 'out of credit' }) });
    assert.equal(pass.ok, true);
    assert.equal(pass.data.drafted.length, 0);
    assert.equal(pass.data.failed.length, 2);
    assert.match(pass.data.failed[0].error, /out of credit/);
    assert.equal((await store.listItems(100, SCOPE_A)).data.length, 0);
  } finally {
    restore();
  }
});

test('the per-pass ceiling leaves the rest for the next pass, by name', async () => {
  const { store, runDue, restore } = withDb();
  try {
    await switchOn(store);
    const pass = await runDue.runDue({ ...PASS, generate: writer().generate, maxDrafts: 1 });
    assert.equal(pass.data.drafted.length, 1);
    assert.deepEqual(pass.data.skippedForPassLimit.map((s) => s.topic), ['living off grid']);
  } finally {
    restore();
  }
});

test('the run-due route is cron-only, and listed where the dispatcher and Vercel both look', async () => {
  const route = require('../../routes/substackNotes.js');
  let status = 0;
  let body = '';
  const res = {
    statusCode: 0,
    setHeader() {},
    writeHead(code) { status = code; },
    end(chunk) { body = String(chunk || ''); },
  };
  Object.defineProperty(res, 'statusCode', { set(v) { status = v; }, get() { return status; } });
  const handled = await route.handle({ method: 'GET', url: '/api/engage/substack-notes/run-due', headers: {}, cronPublish: false },
    res, '/api/engage/substack-notes/run-due', 'GET');
  assert.equal(handled, true);
  assert.equal(status, 403);
  assert.match(body, /CRON_ONLY/);

  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/engage/substack-notes/run-due' && c.schedule === `*/${schedule.PASS_EVERY_MINUTES} * * * *`),
    'the cron schedule and the screen\'s "next pass" time must agree');
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  assert.match(dispatcher, /'\/api\/engage\/substack-notes\/run-due'/);
});
