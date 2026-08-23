'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkMergedTasks,
  checkStampedBranches,
  isTerminal,
  distinctPrs,
} = require('../reconcile_clickup_github.cjs');

/**
 * Charter Q2 — the reconciler. Every dependency (`gh pr view`, ClickUp reads/
 * writes, the bus post) is injected fake here, so these tests drive the real
 * decision logic without touching the network.
 *
 * The acceptance case: "a seeded drift case (task open for merged work) is
 * detected and repaired; second run is a no-op." Both halves are below.
 */

function task(id, name, status, type) {
  return { id, name, status: { status, ...(type ? { type } : {}) } };
}

function buckets() {
  return { clean: [], repaired: [], unchecked: [] };
}

const comments = (...c) => async () => c;

// ── checkMergedTasks ─────────────────────────────────────────────────────

test('dry run: a merged PR on an auto-repair status is "would repair", and NOTHING is written', async () => {
  const { clean, repaired, unchecked } = buckets();
  let writes = 0;
  await checkMergedTasks([task('t1', 'Widget', 'in review')], clean, repaired, unchecked, {
    getComments: comments('see https://github.com/org/repo/pull/42'),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: () => { writes += 1; },
    isLive: false,
  });
  assert.equal(writes, 0, 'dry run must never write');
  assert.equal(repaired.length, 1);
  assert.match(repaired[0], /DRY RUN/);
  assert.match(repaired[0], /PR #42 merged/);
  assert.equal(clean.length + unchecked.length, 0);
});

test('live: a merged PR on Building IS repaired — the task is moved to Live, via the verified door', async () => {
  const { clean, repaired, unchecked } = buckets();
  const moved = [];
  await checkMergedTasks([task('t1', 'Widget', 'building')], clean, repaired, unchecked, {
    getComments: comments('PR: https://github.com/org/repo/pull/42'),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
  });
  assert.deepEqual(moved, [['t1', 'Live']]);
  assert.equal(repaired.length, 1);
  assert.doesNotMatch(repaired[0], /DRY RUN/);
});

test('the second run is a no-op: once a task is Live it is out of the in-flight set entirely', async () => {
  const moved = [];
  const run1 = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'in review')], run1.clean, run1.repaired, run1.unchecked, {
    getComments: comments('https://github.com/org/repo/pull/42'),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
  });
  assert.equal(moved.length, 1);

  const run2 = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'live')], run2.clean, run2.repaired, run2.unchecked, {
    getComments: async () => { throw new Error('must not even be asked — task is no longer in-flight'); },
    prState: () => ({ state: 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
  });
  assert.equal(moved.length, 1, 'the second run must not touch it again');
  assert.deepEqual(run2, buckets());
});

test('the NEWEST linked PR is authoritative — a superseded older link never wins (review finding 1)', async () => {
  const { clean, repaired, unchecked } = buckets();
  const seen = [];
  // Oldest comment links the abandoned first PR; newest links the merged one.
  await checkMergedTasks([task('t1', 'Rebuilt', 'in review')], clean, repaired, unchecked, {
    getComments: comments(
      'PR opened: https://github.com/org/repo/pull/10',   // superseded
      'sent back, reworked',
      'PR opened: https://github.com/org/repo/pull/20',   // the real one
    ),
    prState: (o, r, n) => { seen.push(n); return n === '20' ? { state: 'MERGED' } : { state: 'CLOSED' }; },
    updateStatus: () => {},
    isLive: false,
  });
  assert.deepEqual(seen, ['20'], 'only the newest PR is consulted');
  assert.equal(repaired.length, 1);
  assert.match(repaired[0], /PR #20 merged \(newest of 2 linked PRs\)/);
});

test('a CLOSED-unmerged PR while the task is in-flight is FLAGGED, never "clean" (review finding 2)', async () => {
  const dry = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], dry.clean, dry.repaired, dry.unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'CLOSED' }),
    isLive: false,
  });
  assert.equal(dry.clean.length, 0, 'a dead PR under an in-flight task is drift, not clean');
  assert.equal(dry.repaired.length, 1);
  assert.match(dry.repaired[0], /CLOSED without merging/);

  const posted = [];
  const wet = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], wet.clean, wet.repaired, wet.unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async (ch, text) => posted.push(text),
    recordFlagged: () => {},
    isLive: true,
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0], /CLOSED without merging/);
});

test('a merged PR on an OPERATOR status is FLAGGED, never auto-moved (review finding 6, two-account model)', async () => {
  for (const status of ['needs your input', 'ready to launch']) {
    const { clean, repaired, unchecked } = buckets();
    const moved = [];
    const posted = [];
    await checkMergedTasks([task('t1', 'Held', status)], clean, repaired, unchecked, {
      getComments: comments('https://github.com/org/repo/pull/42'),
      prState: () => ({ state: 'MERGED' }),
      updateStatus: (id, s) => moved.push([id, s]),
      postBus: async (ch, text) => posted.push(text),
      recordFlagged: () => {},
      isLive: true,
    });
    assert.equal(moved.length, 0, `${status}: must never be auto-moved`);
    assert.equal(posted.length, 1, `${status}: must be flagged instead`);
    assert.match(posted[0], /Only you move a task out of that status/);
  }
});

test('an open PR is clean', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'OPEN' }),
    isLive: false,
  });
  assert.equal(repaired.length, 0);
  assert.equal(clean.length, 1);
  assert.match(clean[0], /is open, matches/);
});

test('an in-flight task with NO PR link is UNCHECKED, not clean (review finding 3)', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: comments('just a status update, no link'),
    isLive: false,
  });
  assert.equal(clean.length, 0, 'no way to confirm shipped-or-not is not "fine"');
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /no PR linked/);
});

test('comments that could not be read are UNCHECKED (DOCTRINE 3.11)', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: async () => { throw new Error('ClickUp 500'); },
    isLive: false,
  });
  assert.deepEqual([clean.length, repaired.length, unchecked.length], [0, 0, 1]);
  assert.match(unchecked[0], /could not read comments/);
});

test('a linked PR gh could not read is UNCHECKED, never assumed merged or open', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => null,
    isLive: false,
  });
  assert.deepEqual([clean.length, repaired.length, unchecked.length], [0, 0, 1]);
  assert.match(unchecked[0], /could not read PR #9/);
});

test('only in-flight statuses are inspected — Queued and Live are out of scope', async () => {
  const { clean, repaired, unchecked } = buckets();
  let asked = 0;
  await checkMergedTasks([task('t1', 'A', 'queued'), task('t2', 'B', 'live')], clean, repaired, unchecked, {
    getComments: async () => { asked += 1; return []; },
    isLive: false,
  });
  assert.equal(asked, 0);
  assert.deepEqual({ clean, repaired, unchecked }, buckets());
});

test('a write failure during a live repair is UNCHECKED, not silently swallowed', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: () => { throw new Error('status did not stick'); },
    isLive: true,
  });
  assert.equal(repaired.length, 0, 'a failed write is not a repair');
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /could not move the task/);
});

test('a contradiction already flagged on an earlier run is NOT re-posted (review finding 8)', async () => {
  const posted = [];
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], clean, repaired, unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async (ch, text) => posted.push(text),
    alreadyFlagged: new Set(['contradiction:closed-pr:t1:9']),
    recordFlagged: () => { throw new Error('must not record — nothing new was posted'); },
    isLive: true,
  });
  assert.equal(posted.length, 0, 'an unchanged contradiction is posted once, not every run');
  assert.equal(repaired.length, 1);
  assert.match(repaired[0], /already flagged on an earlier run/);
});

// ── checkStampedBranches ─────────────────────────────────────────────────

test('an unstamped branch is UNCHECKED, never assumed orphaned or tracked', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkStampedBranches([], clean, repaired, unchecked, {
    branches: [{ name: 'some-old-branch', onMac: true }],
    getStampedTaskId: () => '',
  });
  assert.deepEqual([clean.length, repaired.length], [0, 0]);
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

test('a branch whose stamped task is terminal is flagged — dry proposes, live posts once', async () => {
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
    postBus: async (ch, text) => posted.push(text),
    recordFlagged: () => {},
    isLive: true,
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0], /already live/i);
});

test('terminal-ness comes from ClickUp status.type, so a done-type custom status counts (review finding D)', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkStampedBranches([task('t1', 'Widget', "Won't do", 'closed')], clean, repaired, unchecked, {
    branches: [{ name: 'wont-do-branch', onMac: true }],
    getStampedTaskId: () => 't1',
    postBus: async () => {},
    recordFlagged: () => {},
    isLive: false,
  });
  assert.equal(repaired.length, 1, "a 'closed'-type status is terminal even though its name is not 'live'");
  assert.equal(clean.length, 0);
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

// ── pure helpers ──────────────────────────────────────────────────────────

test('distinctPrs de-duplicates and preserves order (oldest→newest)', () => {
  const prs = distinctPrs([
    'https://github.com/org/repo/pull/10',
    'noise',
    'https://github.com/org/repo/pull/10',   // dup of the first
    'https://github.com/org/repo/pull/20',
  ]);
  assert.deepEqual(prs.map((p) => p.number), ['10', '20']);
});

test('isTerminal: type wins, name is the fallback', () => {
  assert.equal(isTerminal({ status: { status: 'Live' } }), true);
  assert.equal(isTerminal({ status: { status: 'Done', type: 'closed' } }), true);
  assert.equal(isTerminal({ status: { status: 'In review', type: 'custom' } }), false);
  assert.equal(isTerminal({ status: { status: 'building' } }), false);
});
