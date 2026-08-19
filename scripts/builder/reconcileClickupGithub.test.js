'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkMergedTasks,
  checkStampedBranches,
} = require('../reconcile_clickup_github.cjs');

/**
 * Charter Q2 — the reconciler. Every dependency (`gh pr view`, ClickUp reads/
 * writes, the bus post) is injected fake here, so these tests drive the real
 * decision logic without touching the network — same discipline as
 * scripts/builder/taskClosesThread.test.js's fake-npm tests for isTaskOpen.
 *
 * The acceptance test this file exists to satisfy: "a seeded drift case
 * (task open for merged work) is detected and repaired; second run is a
 * no-op." Both halves are below — 'seeds and repairs a merged PR' and
 * 'the second run is a no-op'.
 */

function task(id, name, status) {
  return { id, name, status: { status } };
}

function buckets() {
  return { clean: [], repaired: [], unchecked: [] };
}

// ── checkMergedTasks ─────────────────────────────────────────────────────

test('dry run: a merged PR is reported as "would repair", and NOTHING is written', async () => {
  const { clean, repaired, unchecked } = buckets();
  const tasks = [task('t1', 'Widget thing', 'in review')];
  const calls = { updateStatus: 0 };

  await checkMergedTasks(tasks, clean, repaired, unchecked, {
    getComments: async () => ['see https://github.com/org/repo/pull/42'],
    prState: () => ({ state: 'MERGED' }),
    updateStatus: async () => { calls.updateStatus += 1; },
    isLive: false,
  });

  assert.equal(calls.updateStatus, 0, 'dry run must never write');
  assert.equal(repaired.length, 1);
  assert.match(repaired[0], /DRY RUN/);
  assert.match(repaired[0], /PR #42 merged/);
  assert.equal(clean.length, 0);
  assert.equal(unchecked.length, 0);
});

test('live: a merged PR IS repaired — the task is moved to Live', async () => {
  const { clean, repaired, unchecked } = buckets();
  const tasks = [task('t1', 'Widget thing', 'in review')];
  const moved = [];

  await checkMergedTasks(tasks, clean, repaired, unchecked, {
    getComments: async () => ['PR: https://github.com/org/repo/pull/42'],
    prState: () => ({ state: 'MERGED' }),
    updateStatus: async (id, status) => moved.push([id, status]),
    isLive: true,
  });

  assert.deepEqual(moved, [['t1', 'Live']]);
  assert.equal(repaired.length, 1);
  assert.doesNotMatch(repaired[0], /DRY RUN/);
});

test('the second run is a no-op: once a task is no longer in-flight, it is never touched again', async () => {
  // Simulates running the reconciler twice: the first run's repair already
  // moved the task out of the in-flight set (checkMergedTasks filters on
  // status BEFORE doing anything else), so a second pass over the SAME task
  // list post-repair does nothing at all.
  const tasksBeforeRepair = [task('t1', 'Widget thing', 'in review')];
  const tasksAfterRepair = [task('t1', 'Widget thing', 'live')]; // what listTasks would now return

  const moved = [];
  const run1 = buckets();
  await checkMergedTasks(tasksBeforeRepair, run1.clean, run1.repaired, run1.unchecked, {
    getComments: async () => ['https://github.com/org/repo/pull/42'],
    prState: () => ({ state: 'MERGED' }),
    updateStatus: async (id, status) => moved.push([id, status]),
    isLive: true,
  });
  assert.equal(moved.length, 1, 'the first run repairs it');

  const run2 = buckets();
  await checkMergedTasks(tasksAfterRepair, run2.clean, run2.repaired, run2.unchecked, {
    getComments: async () => { throw new Error('must not even be asked — task is no longer in-flight'); },
    prState: () => ({ state: 'MERGED' }),
    updateStatus: async (id, status) => moved.push([id, status]),
    isLive: true,
  });
  assert.equal(moved.length, 1, 'the second run must not repair (or touch) it again');
  assert.deepEqual(run2, { clean: [], repaired: [], unchecked: [] }, 'nothing to report — the task fell out of scope entirely');
});

test('an open (not merged) PR is clean, not repaired', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: async () => ['https://github.com/org/repo/pull/9'],
    prState: () => ({ state: 'OPEN' }),
    isLive: false,
  });
  assert.equal(repaired.length, 0);
  assert.equal(clean.length, 1);
  assert.match(clean[0], /is open, matches/);
});

test('a task with no PR link yet is clean — nothing to compare, not a failure', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: async () => ['just a status update, no link'],
    isLive: false,
  });
  assert.equal(clean.length, 1);
  assert.equal(unchecked.length, 0);
});

test('a task whose comments could not be read is UNCHECKED, never silently clean (DOCTRINE 3.11)', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: async () => { throw new Error('ClickUp 500'); },
    isLive: false,
  });
  assert.equal(clean.length, 0);
  assert.equal(repaired.length, 0);
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /could not read comments/);
});

test('a linked PR that gh could not read is UNCHECKED, never assumed merged or assumed open', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: async () => ['https://github.com/org/repo/pull/9'],
    prState: () => null, // gh not authed / network down / PR deleted
    isLive: false,
  });
  assert.equal(clean.length, 0, 'must not be assumed fine');
  assert.equal(repaired.length, 0, 'must not be assumed merged');
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /could not read PR #9/);
});

test('only tasks in an in-flight status are considered at all — Queued and Live are out of scope', async () => {
  const { clean, repaired, unchecked } = buckets();
  const tasks = [task('t1', 'Not started', 'queued'), task('t2', 'Already done', 'live')];
  let asked = 0;
  await checkMergedTasks(tasks, clean, repaired, unchecked, {
    getComments: async () => { asked += 1; return []; },
    isLive: false,
  });
  assert.equal(asked, 0, 'neither Queued nor Live should ever be inspected');
  assert.deepEqual({ clean, repaired, unchecked }, buckets());
});

test('a write failure during a live repair is UNCHECKED, not silently swallowed', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: async () => ['https://github.com/org/repo/pull/9'],
    prState: () => ({ state: 'MERGED' }),
    updateStatus: async () => { throw new Error('ClickUp rejected the write'); },
    isLive: true,
  });
  assert.equal(repaired.length, 0, 'a failed write is not a repair');
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /could not move the task/);
});

// ── checkStampedBranches ─────────────────────────────────────────────────

test('an unstamped branch is UNCHECKED, never assumed orphaned or assumed tracked', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkStampedBranches([], clean, repaired, unchecked, {
    branches: [{ name: 'some-old-branch', onMac: true }],
    getStampedTaskId: () => '',
  });
  assert.deepEqual(clean, []);
  assert.deepEqual(repaired, []);
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /no ClickUp task stamp/);
});

test('a branch stamped with a still-open task is clean', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkStampedBranches([task('t1', 'Widget', 'building')], clean, repaired, unchecked, {
    branches: [{ name: 'widget-thing', onMac: true }],
    getStampedTaskId: () => 't1',
  });
  assert.equal(clean.length, 1);
  assert.match(clean[0], /tracked by task t1/);
  assert.equal(unchecked.length, 0);
});

test('a branch whose stamped task is already Live is a contradiction — dry run proposes, live flags to the bus', async () => {
  const dry = buckets();
  await checkStampedBranches([task('t1', 'Widget', 'live')], dry.clean, dry.repaired, dry.unchecked, {
    branches: [{ name: 'widget-thing', onMac: true }],
    getStampedTaskId: () => 't1',
    isLive: false,
  });
  assert.equal(dry.repaired.length, 1);
  assert.match(dry.repaired[0], /DRY RUN/);

  const posted = [];
  const wet = buckets();
  await checkStampedBranches([task('t1', 'Widget', 'live')], wet.clean, wet.repaired, wet.unchecked, {
    branches: [{ name: 'widget-thing', onMac: true }],
    getStampedTaskId: () => 't1',
    postBus: async (channel, text) => posted.push({ channel, text }),
    isLive: true,
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /already live/);
  assert.equal(wet.repaired.length, 1);
});

test('a stamp pointing at a task outside this list is UNCHECKED, not assumed orphaned', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkStampedBranches([], clean, repaired, unchecked, {
    branches: [{ name: 'mystery-branch', onMac: true }],
    getStampedTaskId: () => 'not-in-this-list',
  });
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /not in this Loop Queue list/);
});
