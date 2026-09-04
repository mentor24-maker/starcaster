'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  checkMergedTasks,
  checkStampedBranches,
  isTerminal,
  distinctPrs,
  deckVerdict,
  standDownReport,
  SWITCH_TIMEOUT_MS,
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

  // UPDATED 2026-08-25 (task 86bbm4zwd): a terminal task IS now inspected —
  // for the opposite contradiction, a PR left open under it. So its comments
  // are read. What must still hold is that the second run CHANGES NOTHING:
  // no move, no repair, because the merged PR under a Live task is the normal
  // end state.
  const run2 = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'live', 'closed')], run2.clean, run2.repaired, run2.unchecked, {
    getComments: comments('https://github.com/org/repo/pull/42'),
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
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'MERGED' }),
    updateStatus: () => { throw new Error('status did not stick'); },
    isLive: true,
  });
  assert.equal(repaired.length, 0, 'a failed write is not a repair');
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /could not move the task/);
});

test('a contradiction already flagged INSIDE THE WINDOW is not re-posted (review finding 8)', async () => {
  const now = Date.parse('2026-09-02T20:00:00.000Z');
  const posted = [];
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], clean, repaired, unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async (ch, text) => posted.push(text),
    alreadyFlagged: new Map([
      ['contradiction:closed-pr|t1|9', new Date(now - 60 * 60 * 1000).toISOString()],
    ]),
    recordFlagged: () => { throw new Error('must not record — nothing new was posted'); },
    isLive: true,
    now,
  });
  assert.equal(posted.length, 0, 'an unchanged contradiction is posted once per window, not every run');
  assert.equal(repaired.length, 1);
  assert.match(repaired[0], /already said/);
});

test('the SAME contradiction is said again once the 6h window has passed', async () => {
  // The half that was missing until 2026-09-02: the old state file had no
  // clock, so a drift posted once was struck off forever however long it sat.
  const now = Date.parse('2026-09-02T20:00:00.000Z');
  const posted = [];
  const recorded = [];
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], clean, repaired, unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async (ch, text) => posted.push(text),
    alreadyFlagged: new Map([
      ['contradiction:closed-pr|t1|9', new Date(now - 7 * 60 * 60 * 1000).toISOString()],
    ]),
    recordFlagged: (key) => recorded.push(key),
    isLive: true,
    now,
  });
  assert.equal(posted.length, 1);
  assert.deepEqual(recorded, ['contradiction:closed-pr|t1|9']);
});

test('a held finding is still RAISED, so the prune does not mistake it for resolved', async () => {
  // Otherwise: held by the window this pass -> cleared as resolved -> posted
  // again next pass. The window would produce the noise it exists to stop.
  const now = Date.parse('2026-09-02T20:00:00.000Z');
  const raised = [];
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Stuck', 'in review')], clean, repaired, unchecked, {
    getComments: comments('https://github.com/org/repo/pull/9'),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async () => {},
    alreadyFlagged: new Map([['contradiction:closed-pr|t1|9', new Date(now).toISOString()]]),
    recordFlagged: () => {},
    recordRaised: (key) => raised.push(key),
    isLive: true,
    now,
  });
  assert.deepEqual(raised, ['contradiction:closed-pr|t1|9']);
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
      'PR opened: https://github.com/org/repo/pull/374',
      'PR opened: https://github.com/org/repo/pull/391',
    ),
    // distinctPrs yields the number as a STRING (it comes straight out of the
    // URL regex), so compare numerically — a === against a literal silently
    // matches nothing and the test passes for the wrong reason.
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

// ── the scheduled shape (2026-09-02, task 86bbtqytq) ────────────────────────
//
// This tool named the stuck ticket exactly and reached nobody. `npm run repair`
// (#544) gave it a schedule; these two disciplines are what a SCHEDULED pass
// owes on top of that — a window that clears, and asking the switch first.

const {
  flagDue,
  flagKey,
  pruneFlags,
  REPOST_EVERY_MS,
} = require('../reconcile_clickup_github.cjs');

const NOW = Date.parse('2026-09-02T20:00:00.000Z');
const HOUR = 60 * 60 * 1000;

test('a contradiction is posted once, held for 6h, then said again', () => {
  const key = flagKey('closed-pr', '86bbqw49y', 513);
  assert.equal(flagDue({ key, state: new Map(), now: NOW }).due, true, 'never said before');
  const said = new Map([[key, new Date(NOW - HOUR).toISOString()]]);
  assert.equal(flagDue({ key, state: said, now: NOW }).due, false);
  const old = new Map([[key, new Date(NOW - 7 * HOUR).toISOString()]]);
  assert.equal(flagDue({ key, state: old, now: NOW }).due, true,
    'a drift still unfixed after 6h is said again — it did not stop being true');
  assert.equal(REPOST_EVERY_MS, 6 * HOUR);
});

test('BREAK-TEST: the window is not infinite — the old state file had no clock at all', () => {
  // It used to be a bare array of keys: posted once, struck off FOREVER. An
  // alarm that fires once and then goes quiet is the failure suppression is
  // meant to prevent. A legacy entry loads with no time and reads as never
  // said, which errs towards speaking.
  const key = flagKey('merged-operator', '86bbqw49y', 513);
  assert.equal(flagDue({ key, state: new Map([[key, '']]), now: NOW }).due, true);
  assert.equal(flagDue({ key, state: new Map([[key, 'not a date']]), now: NOW }).due, true);
});

test('a RESOLVED contradiction loses its stamp, so a returning drift is announced at once', () => {
  const gone = flagKey('closed-pr', '86bbqw49y', 513);
  const still = flagKey('stale-branch', 'weekly-report', '86bbk34ym');
  const state = new Map([[gone, new Date(NOW).toISOString()], [still, new Date(NOW).toISOString()]]);
  const out = pruneFlags(state, {
    subjects: new Set(['86bbqw49y', 'weekly-report']),
    raised: new Set([still]),
  });
  assert.deepEqual(out.cleared, [gone]);
  assert.ok(out.state.has(still), 'a contradiction raised again this pass keeps its window');
});

test('BREAK-TEST: a subject this pass never LOOKED at keeps its stamp', () => {
  // "I did not see it" is not "it is fixed" (DOCTRINE 3.11). The terminal scan
  // is bounded at 25, so tickets rotate out of view every run — clearing on
  // absence would repost the same contradiction on a loop.
  const key = flagKey('open-pr-under-terminal', '86bbjk5rw', 374);
  const state = new Map([[key, new Date(NOW).toISOString()]]);
  const out = pruneFlags(state, { subjects: new Set(['86bbsomethingelse']), raised: new Set() });
  assert.deepEqual(out.cleared, []);
  assert.ok(out.state.has(key));
});

test('the key fences its subject, so the pruner never has to guess which shape it is', () => {
  // Two of the four contradiction shapes put a BRANCH where the others put a
  // task id. A pruner that split on ':' would read "stale-branch" as the
  // subject of every branch flag and clear nothing, silently.
  assert.equal(flagKey('stale-branch', 'watchdogs-reach-dane', '86bbtqytq').split('|')[1],
    'watchdogs-reach-dane');
  assert.equal(flagKey('closed-pr', '86bbtqytq', 583).split('|')[1], '86bbtqytq');
});

test('BREAK-TEST: --check asks the pipeline switch BEFORE it reads or writes anything', () => {
  // It moves tickets and posts to the bus. Running while Dane has the deck is
  // exactly the collision the switch exists to prevent (PR #432).
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  assert.match(src, /pipeline\.mjs/, 'it must consult the one switch implementation, not read the flag twice');
  const pauseAt = src.indexOf('const deck = deckVerdict()');
  const readAt = src.indexOf('await listTasks(LOOP_QUEUE_LIST');
  assert.ok(pauseAt > 0 && pauseAt < readAt, 'the switch is asked before the queue is read');
});

// ── the switch's TWO non-zero answers (review round 1, 2026-09-03) ────────
//
// The whole ticket is about a check that could not run being reported as a
// normal state. This pass shipped one of its own: every non-zero exit from the
// switch was graded "Dane has the deck", so a throttled ClickUp read or a
// rotated token printed a false statement about him and took the drift
// watchdog off the air on a green board. The ACTION is right and unchanged —
// stand down either way. The words and the exit code are the fix.

test('a genuine pause is still a normal decline: exit 3, and it names Dane', () => {
  const out = standDownReport({ paused: true, readable: true, why: 'Dane paused it at 6:12pm — "taking the deck"' });
  assert.equal(out.exit, 3);
  assert.ok(out.lines.join(' ').includes('Dane has the deck'));
});

test('BREAK-TEST: an UNREADABLE switch exits 2 and never says Dane has the deck', () => {
  // Break it by folding unreadable back into paused (return the paused branch
  // for both) and this fails on both counts.
  const out = standDownReport({ paused: true, readable: false, why: 'CLICKUP_API_TOKEN is not set in this environment.' });
  assert.equal(out.exit, 2, 'cannot-tell is exit 2, which is what repair reads as CANNOT TELL');
  const said = out.lines.join(' ');
  assert.ok(!/Dane/.test(said), 'nothing here knows what Dane is doing — saying so is the lie that hid this');
  assert.match(said, /COULD NOT TELL/);
  assert.match(said, /not an all-clear/);
});

test('BREAK-TEST: the two stand-downs never print the same sentence', () => {
  const paused = standDownReport({ paused: true, readable: true, why: 'x' });
  const blind = standDownReport({ paused: true, readable: false, why: 'x' });
  assert.notEqual(paused.exit, blind.exit);
  const shared = paused.lines.filter((l) => blind.lines.includes(l));
  assert.deepEqual(shared, [], 'the switch itself requires these lead to the same behaviour in different words');
});

test('the verdict is graded by pulseDigest, not by a second reading of the exit code', () => {
  // Unreadable: the switch answered with no parseable verdict line at all,
  // which is what a missing token actually produces.
  const blind = deckVerdict(() => ({ status: 2, stdout: '', stderr: 'CLICKUP_API_TOKEN is not set in this environment.' }));
  assert.equal(blind.readable, false);
  assert.equal(blind.paused, true, 'it still stands down — the safe direction is unchanged');

  const paused = deckVerdict(() => ({ status: 3, stdout: JSON.stringify({ paused: true, certain: true, code: 3, message: 'The pipeline is PAUSED.' }) }));
  assert.equal(paused.readable, true);
  assert.equal(paused.paused, true);

  const running = deckVerdict(() => ({ status: 0, stdout: JSON.stringify({ paused: false, certain: true, code: 0, message: 'The pipeline is RUNNING.' }) }));
  assert.equal(running.paused, false);
  assert.equal(running.readable, true);
});

test('BREAK-TEST: the switch read carries a deadline, so a hung switch cannot pin the relay wake', () => {
  let opts = null;
  deckVerdict((_bin, _args, o) => { opts = o; return { status: 0, stdout: '{"paused":false,"certain":true}' }; });
  assert.equal(opts.timeout, SWITCH_TIMEOUT_MS);
  assert.ok(SWITCH_TIMEOUT_MS > 0);
});

test('it asks with --json, because the exit code cannot carry the distinction', () => {
  let args = null;
  deckVerdict((_bin, a) => { args = a; return { status: 0, stdout: '{"paused":false,"certain":true}' }; });
  assert.ok(args.includes('check') && args.includes('--json'),
    'both non-zero answers exit 3 by contract; only --json says which');
});

test('--check IS the live shape — a scheduled watchdog that only proposed would fix nothing', () => {
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  assert.match(src, /const live = check \|\| process\.argv\.includes\('--live'\)/);
});
