'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  checkMergedTasks,
  checkStampedBranches,
  isTerminal,
  closureNote,
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

/**
 * Comment RECORDS, oldest-first, the shape `getTaskCommentRecords` returns.
 *
 * They were bare strings until 2026-09-04 (ticket 86bbuv66c). The decision now
 * runs through `mergeOnComment.findPullRequest`, which sorts by `date` to pick
 * the newest `PR opened:` line — handed strings it would see every comment as
 * equally old and take whichever it met first, which is the OLDEST. So the
 * dates here are load-bearing, not decoration.
 */
const comments = (...c) => async () => c.map((text, i) => ({
  id: `c${i + 1}`,
  date: String(1_700_000_000_000 + i * 1000),
  comment_text: text,
}));

/** The shape `clickup pr-opened` writes — the only shape that decides anything. */
const trail = (n) => `PR opened: https://github.com/org/repo/pull/${n}`;

// ── checkMergedTasks ─────────────────────────────────────────────────────

test('dry run: a merged PR on an auto-repair status is "would repair", and NOTHING is written', async () => {
  const { clean, repaired, unchecked } = buckets();
  let writes = 0;
  await checkMergedTasks([task('t1', 'Widget', 'in review')], clean, repaired, unchecked, {
    getComments: comments(trail(42)),
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
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
    postComment: () => {},
  });
  assert.deepEqual(moved, [['t1', 'Live']]);
  assert.equal(repaired.length, 1);
  assert.doesNotMatch(repaired[0], /DRY RUN/);
});

test('the second run is a no-op: once a task is Live it is out of the in-flight set entirely', async () => {
  const moved = [];
  const run1 = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'in review')], run1.clean, run1.repaired, run1.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
    postComment: () => {},
  });
  assert.equal(moved.length, 1);

  // UPDATED 2026-08-25 (task 86bbm4zwd): a terminal task IS now inspected —
  // for the opposite contradiction, a PR left open under it. So its comments
  // are read. What must still hold is that the second run CHANGES NOTHING:
  // no move, no repair, because the merged PR under a Live task is the normal
  // end state.
  const run2 = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'live', 'closed')], run2.clean, run2.repaired, run2.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
    postComment: () => {},
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
      trail(10),   // superseded
      'sent back, reworked',
      trail(20),   // the real one
    ),
    prState: (o, r, n) => { seen.push(n); return Number(n) === 20 ? { state: 'MERGED' } : { state: 'CLOSED' }; },
    updateStatus: () => {},
    isLive: false,
  });
  assert.deepEqual(seen, [20], 'only the newest PR is consulted');
  assert.equal(repaired.length, 1);
  assert.match(repaired[0], /PR #20 merged \(newest of 2 trail PRs\)/);
});

test('a CLOSED-unmerged PR while the task is in-flight is FLAGGED, never "clean" (review finding 2)', async () => {
  const dry = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], dry.clean, dry.repaired, dry.unchecked, {
    getComments: comments(trail(9)),
    prState: () => ({ state: 'CLOSED' }),
    isLive: false,
  });
  assert.equal(dry.clean.length, 0, 'a dead PR under an in-flight task is drift, not clean');
  assert.equal(dry.repaired.length, 1);
  assert.match(dry.repaired[0], /CLOSED without merging/);

  const posted = [];
  const wet = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], wet.clean, wet.repaired, wet.unchecked, {
    getComments: comments(trail(9)),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async (ch, text) => posted.push(text),
    recordFlagged: () => {},
    isLive: true,
    postComment: () => {},
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
      getComments: comments(trail(42)),
      prState: () => ({ state: 'MERGED' }),
      updateStatus: (id, s) => moved.push([id, s]),
      postBus: async (ch, text) => posted.push(text),
      recordFlagged: () => {},
      isLive: true,
      postComment: () => {},
    });
    assert.equal(moved.length, 0, `${status}: must never be auto-moved`);
    assert.equal(posted.length, 1, `${status}: must be flagged instead`);
    assert.match(posted[0], /Only you move a task out of that status/);
  }
});

test('an open PR is clean', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: comments(trail(9)),
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
  assert.match(unchecked[0], /no "PR opened:" trail/);
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
    getComments: comments(trail(9)),
    prState: () => null,
    isLive: false,
  });
  assert.deepEqual([clean.length, repaired.length, unchecked.length], [0, 0, 1]);
  assert.match(unchecked[0], /could not read PR #9/);
});

test('Queued is out of scope entirely; Live is inspected ONLY for an open PR', async () => {
  // UPDATED 2026-08-25 (task 86bbm4zwd). Live used to be out of scope with
  // Queued, which is exactly why a PR left open under a closed ticket was
  // invisible — and two of those helped deadlock the build loop. Queued stays
  // out: a queued ticket with an open PR is rework, not a contradiction.
  const { clean, repaired, unchecked } = buckets();
  const asked = [];
  await checkMergedTasks([task('t1', 'A', 'queued'), task('t2', 'B', 'live', 'closed')], clean, repaired, unchecked, {
    getComments: async (id) => { asked.push(id); return []; },
    isLive: false,
  });
  assert.deepEqual(asked, ['t2'], 'the queued task must never be asked about; the live one must');
  // No PR linked on t2, so nothing to contradict — still silent.
  assert.deepEqual({ clean, repaired, unchecked }, buckets());
});

test('a write failure during a live repair is UNCHECKED, not silently swallowed', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'X', 'building')], clean, repaired, unchecked, {
    getComments: comments(trail(9)),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: () => { throw new Error('status did not stick'); },
    isLive: true,
    postComment: () => {},
  });
  assert.equal(repaired.length, 0, 'a failed write is not a repair');
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /could not move the task/);
});

test('a contradiction already flagged on an earlier run is NOT re-posted (review finding 8)', async () => {
  const posted = [];
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], clean, repaired, unchecked, {
    getComments: comments(trail(9)),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async (ch, text) => posted.push(text),
    alreadyFlagged: new Set(['contradiction:closed-pr:t1:9']),
    recordFlagged: () => { throw new Error('must not record — nothing new was posted'); },
    isLive: true,
    postComment: () => {},
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
    postComment: () => {},
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

test('closureNote names the actor, the machine, the PR and its merge time', () => {
  const note = closureNote({
    prName: 'PR #42',
    prUrl: 'https://github.com/org/repo/pull/42',
    mergedAt: '2026-09-04T03:06:41Z',
  });
  assert.match(note, /reconcile/, 'the job must name itself — the ClickUp token is Dane, so nothing else can');
  assert.match(note, /PR #42/);
  assert.match(note, /https:\/\/github\.com\/org\/repo\/pull\/42/);
  assert.match(note, /2026-09-04T03:06:41Z/);
  assert.match(note, /not his word/, 'a machine write must never read as the operator');
});

test('isTerminal: type wins, name is the fallback', () => {
  assert.equal(isTerminal({ status: { status: 'Live' } }), true);
  assert.equal(isTerminal({ status: { status: 'Done', type: 'closed' } }), true);
  assert.equal(isTerminal({ status: { status: 'In review', type: 'custom' } }), false);
  assert.equal(isTerminal({ status: { status: 'building' } }), false);
});

// ── The other direction: a terminal task keeping an open PR ───────────────
// (2026-08-25, task 86bbm4zwd)

test('a Live task whose newest PR is still OPEN is flagged', async () => {
  // The real pair: 86bbjk5rw went Live via PR #391, but PR #374 — an earlier
  // attempt at the same ticket — was left open. Two of these counted against
  // the work-in-progress cap and helped deadlock the build loop for four
  // hourly passes. checkMergedTasks only ever looked at IN-FLIGHT tasks, so
  // this pair was invisible to it.
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Race-safe verdicts', 'live', 'closed')], clean, repaired, unchecked, {
    getComments: comments('PR opened: https://github.com/org/repo/pull/374'),
    prState: () => ({ state: 'OPEN' }),
    isLive: false,
  });
  assert.equal(repaired.length, 1, 'the contradiction must be reported');
  assert.match(repaired[0], /DRY RUN/);
  assert.match(repaired[0], /open PR under a terminal task/i);
  assert.match(repaired[0], /#374 is still OPEN/);
  assert.match(repaired[0], /work-in-progress cap/, 'it must say why it matters, not just that it is odd');
});

test('it is never repaired automatically — only a person knows which side is wrong', async () => {
  // "Close the PR" and "the ticket was closed too early" are both plausible,
  // and picking wrong either discards work or reopens shipped work.
  const { clean, repaired, unchecked } = buckets();
  let writes = 0;
  await checkMergedTasks([task('t1', 'Widget', 'live', 'closed')], clean, repaired, unchecked, {
    getComments: comments('PR opened: https://github.com/org/repo/pull/374'),
    prState: () => ({ state: 'OPEN' }),
    updateStatus: () => { writes += 1; },
    postBus: () => {},
    isLive: true,
    postComment: () => {},
  });
  assert.equal(writes, 0, 'a terminal task with an open PR must never be moved automatically');
});

test('a Live task whose PR is merged is not flagged — that is the normal end state', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'live', 'closed')], clean, repaired, unchecked, {
    getComments: comments('PR opened: https://github.com/org/repo/pull/391'),
    prState: () => ({ state: 'MERGED' }),
    isLive: false,
  });
  assert.equal(repaired.length, 0, 'the overwhelmingly common case must stay silent');
});

test('a terminal task whose PR state cannot be read is unchecked, never assumed fine', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'live', 'closed')], clean, repaired, unchecked, {
    getComments: comments('PR opened: https://github.com/org/repo/pull/374'),
    prState: () => null,
    isLive: false,
  });
  assert.equal(repaired.length, 0);
  assert.equal(unchecked.length, 1, 'DOCTRINE 3.11 — could not check is never folded into all clear');
  assert.match(unchecked[0], /could not be read/);
});

test('THE REAL SHAPE: a Live ticket linking an open leftover AND a newer merged PR', async () => {
  // Review round 1. The first version took only the NEWEST linked PR and
  // skipped when it was not open — so on the exact 2026-08-25 case (86bbjk5rw
  // linked #374, left open, then #391 which shipped it) the newest was merged
  // and the check returned silently. It must inspect EVERY linked PR.
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Race-safe verdicts', 'live', 'closed')], clean, repaired, unchecked, {
    getComments: comments(
      trail(374),
      trail(391),
    ),
    // The trail parser yields the number as a Number; older code yielded a
    // string. Comparing numerically survives both — a === against a literal of
    // the wrong type silently matches nothing and the test passes for the
    // wrong reason.
    prState: (o, r, number) => ({ state: Number(number) === 374 ? 'OPEN' : 'MERGED' }),
    isLive: false,
  });
  assert.equal(repaired.length, 1, 'the open leftover must be found behind the newer merged PR');
  assert.match(repaired[0], /#374 is still OPEN/);
  assert.doesNotMatch(repaired[0], /#391/, 'the merged one is not a contradiction');
});

test('reconcile asks for closed tasks, or the leftover-PR scan cannot fire', () => {
  // Review round 1, measured: without include_closed the fetch returned 36
  // tasks and ZERO terminal ones, so tasks.filter(isTerminal) iterated an
  // empty set and the whole check was decoration. With it: 98 terminal tasks.
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  assert.match(src, /listTasks\(LOOP_QUEUE_LIST, \{ includeClosed: true \}\)/);
  const lib = fs.readFileSync(path.join(__dirname, '../lib/clickup.cjs'), 'utf8');
  assert.match(lib, /include_closed=true/, 'and listTasks must actually send it');
});

test('the leftover-PR scan is bounded — the terminal set only grows', () => {
  // One comment read plus one gh call per terminal task, per run, over a set
  // that is already 98 and grows every time work ships.
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  // Assert the cap is APPLIED, not merely declared — the first version of this
  // test checked only that the constant existed, and passed happily with
  // `const scanned = terminal;` substituted in.
  assert.match(src, /const scanned = terminal\.slice\(0, TERMINAL_SCAN_MAX\);/,
    'the cap must actually slice the set the scan iterates');
  assert.match(src, /sort\(\(a, b\) => Number\(b\.date_updated \|\| 0\) - Number\(a\.date_updated \|\| 0\)\)/,
    'and take the most recently updated, so the cap keeps the useful end');
  assert.match(src, /scanning the \$\{scanned\.length\} most recently updated of \$\{terminal\.length\}/,
    'and say how many it skipped — a silent cap is a check that quietly stops covering things');
});


// ── the 2026-09-03 false close (ticket 86bbuv66c) ─────────────────────────

test('a PR mentioned in DISCUSSION is not this ticket\'s PR — no move, and it says it cannot confirm', async () => {
  // The incident, in one test. 86bbu60ax carried a cross-reference to PR #558
  // ("Docs: overlay screens…", merged, unrelated) filed by a loop pass as
  // evidence — exactly what a loop should do. The moment a session claimed the
  // ticket into Building, reconcile read that URL as the ticket's own work and
  // closed an urgent, unbuilt ticket as shipped.
  const { clean, repaired, unchecked } = buckets();
  const moved = [];
  await checkMergedTasks([task('t1', 'Reconcile bug', 'building')], clean, repaired, unchecked, {
    getComments: comments(
      'That is precisely the open defect on https://github.com/org/repo/pull/558 — filed as evidence.',
    ),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    postComment: () => {},
    isLive: true,
  });
  assert.deepEqual(moved, [], 'a quoted PR must never close a ticket');
  assert.equal(repaired.length, 0);
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /no "PR opened:" trail/);
});

test('a quoted PR does not win over the ticket\'s own older trail PR', async () => {
  // The sharper version: the ticket HAS a trail, and someone later pasted a
  // different, merged PR into discussion. Newest-comment-wins would close it.
  const { clean, repaired, unchecked } = buckets();
  const moved = [];
  await checkMergedTasks([task('t1', 'Widget', 'in review')], clean, repaired, unchecked, {
    getComments: comments(
      trail(42),
      'see also https://github.com/org/repo/pull/558 which shipped last night',
    ),
    prState: (o, r, number) => ({ state: Number(number) === 42 ? 'OPEN' : 'MERGED' }),
    updateStatus: (id, status) => moved.push([id, status]),
    postComment: () => {},
    isLive: true,
  });
  assert.deepEqual(moved, [], 'the ticket\'s own PR is open, so it has not shipped');
  assert.equal(clean.length, 1);
  assert.match(clean[0], /PR #42 is open/);
});

test('the explanation comment is posted BEFORE the move, and a failed comment cancels the move', async () => {
  const order = [];
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'building')], clean, repaired, unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED', mergedAt: '2026-09-04T03:06:41Z' }),
    postComment: () => order.push('comment'),
    updateStatus: () => order.push('move'),
    isLive: true,
  });
  assert.deepEqual(order, ['comment', 'move'], 'the trail is written first, or a failure leaves a silent close');

  const second = buckets();
  const moved = [];
  await checkMergedTasks([task('t2', 'Widget', 'building')], second.clean, second.repaired, second.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postComment: () => { throw new Error('ClickUp said no'); },
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
  });
  assert.deepEqual(moved, [], 'no explanation means no close — an unexplained close is the defect');
  assert.equal(second.repaired.length, 0);
  assert.match(second.unchecked[0], /ClickUp said no/);
  assert.match(second.unchecked[0], /NOT moved/);
});

test('onWrite fires only when a live move actually happens — it is what makes the pass exit 3', async () => {
  let writes = 0;
  const dry = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'building')], dry.clean, dry.repaired, dry.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postComment: () => {},
    updateStatus: () => {},
    onWrite: () => { writes += 1; },
    isLive: false,
  });
  assert.equal(writes, 0, 'a rehearsal that reported exit 3 would call a dry run a change');

  const live = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'building')], live.clean, live.repaired, live.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postComment: () => {},
    updateStatus: () => {},
    onWrite: () => { writes += 1; },
    isLive: true,
  });
  assert.equal(writes, 1);
});
