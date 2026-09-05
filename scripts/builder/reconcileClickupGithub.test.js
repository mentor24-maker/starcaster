'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  checkMergedTasks,
  checkClaimableTasks,
  claimableCandidates,
  checkStampedBranches,
  isTerminal,
  isInFlight,
  isClaimable,
  isReworkStatus,
  newestCommentAt,
  reopenBlock,
  deckVerdict,
  standDownReport,
  SWITCH_TIMEOUT_MS,
  closureNote,
  nodeName,
  NODE_NAME,
  AUTO_REPAIR_STATUSES,
  OPERATOR_STATUSES,
  CLAIMABLE_STATUSES,
} = require('../reconcile_clickup_github.cjs');
const loopStatuses = require('./loopStatuses.js');

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

/**
 * A merge time AFTER every comment `comments()` above manufactures (they start
 * at 1_700_000_000_000, which is 2023-11-14). Load-bearing since review round 1
 * of 86bbt3wzk: the claimable close is blocked when the ticket has been spoken
 * on SINCE the merge, so a fixture with no merge time — or one older than its
 * own comments — is a fixture that never reaches the code it means to test.
 */
const MERGED_AFTER_COMMENTS = '2026-09-01T00:00:00.000Z';

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
    commentOn: () => {},
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
    commentOn: () => {},
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
    commentOn: () => {},
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
    commentOn: () => {},
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0], /CLOSED without merging/);
});

test('a merged PR on an OPERATOR status is FLAGGED, never auto-moved (review finding 6, two-account model)', async () => {
  for (const status of ['needs your input', 'ready to launch']) {
    const { clean, repaired, unchecked } = buckets();
    const moved = [];
    const posted = [];
    const commented = [];
    await checkMergedTasks([task('t1', 'Held', status)], clean, repaired, unchecked, {
      getComments: comments(trail(42)),
      prState: () => ({ state: 'MERGED' }),
      updateStatus: (id, s) => moved.push([id, s]),
      postBus: async (ch, text) => posted.push(text),
      commentOn: async (id, text) => commented.push([id, text]),
      recordFlagged: () => {},
      isLive: true,
      commentOn: () => {},
    });
    assert.equal(moved.length, 0, `${status}: must never be auto-moved`);
    assert.equal(posted.length, 1, `${status}: must be flagged instead`);
    assert.match(posted[0], /Only you move a task out of that status/);
    assert.equal(unchecked.length, 0, `${status}: nothing should have been left unverified`);
  }
});

/**
 * AC5 of task 86bbtqpxd — this finding is DURABLE, not one line in a sweep.
 *
 * The reconciler made exactly this finding about ticket 86bbqw49y and posted
 * it to the bus, where it competed with everything else and nobody acted on
 * it. The ticket sat twelve hours with its work already merged and live in
 * production. A merged PR under an operator status means FINISHED WORK IS
 * INVISIBLE ON THE DEPLOY LIST, so it lands on the ticket it is about too.
 */
test('a merged PR under an operator status is recorded ON THE TICKET, not only on the bus', async () => {
  const { clean, repaired, unchecked } = buckets();
  const posted = [];
  const commented = [];
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], clean, repaired, unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async (ch, text) => posted.push(text),
    commentOn: async (id, text) => commented.push([id, text]),
    recordFlagged: () => {},
    isLive: true,
  });
  assert.equal(commented.length, 1, 'the durable half of the finding is missing');
  assert.equal(commented[0][0], 't1', 'it goes on the ticket the finding is ABOUT');
  const body = commented[0][1];
  assert.match(body, /already MERGED/);
  assert.match(body, /Dane|an agent session/, 'the message must name who acts (DOCTRINE 2.5)');
  assert.match(body, /deploy list/, 'it must say WHY this matters, not just that it is odd');
  assert.equal(posted.length, 1, 'the bus still hears about it once');
});

test('the durable comment is proposed, never written, in a dry run', async () => {
  const { clean, repaired, unchecked } = buckets();
  const commented = [];
  const posted = [];
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], clean, repaired, unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async (ch, text) => posted.push(text),
    commentOn: async (id, text) => commented.push([id, text]),
    isLive: false,
  });
  assert.equal(commented.length, 0, 'a dry run must never write');
  assert.equal(posted.length, 0);
  assert.ok(repaired.some((r) => /would also comment on task t1/.test(r)), 'and it must SAY it would have');
});

test('a failed ticket comment is reported, never swallowed', async () => {
  // DOCTRINE 3.11: a surface that could not be written is not a surface that
  // carried the finding.
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], clean, repaired, unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async () => {},
    commentOn: async () => { throw new Error('ClickUp said no'); },
    recordFlagged: () => {},
    isLive: true,
  });
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /ticket comment FAILED to post/);
  assert.match(unchecked[0], /ClickUp said no/);
});

test('an unchanged finding is not re-posted on the next run — one comment, not one per run', async () => {
  const flagged = new Map();
  const commented = [];
  const posted = [];
  const deps = {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async (ch, text) => posted.push(text),
    commentOn: async (id, text) => commented.push([id, text]),
    alreadyFlagged: flagged,
    recordFlagged: (key, at) => flagged.set(key, new Date(at || Date.now()).toISOString()),
    isLive: true,
  };
  for (let run = 0; run < 3; run += 1) {
    const { clean, repaired, unchecked } = buckets();
    await checkMergedTasks([task('t1', 'Held', 'ready to launch')], clean, repaired, unchecked, deps);
  }
  assert.equal(commented.length, 1, 'three runs, one comment');
  assert.equal(posted.length, 1, 'three runs, one bus post');
});

// ── ROUND 2 of task 86bbtqpxd: the durable half must actually REACH the
//    tickets that already carry the finding ────────────────────────────────
//
// Review round 1 measured this on the live flag file: the single dedup key was
// checked before EITHER surface was written, so the moment the ticket comment
// was added it was already suppressed on every ticket ever flagged to the bus.
// `.git/reconciler-flags.json` on the Mini held
// `contradiction:merged-operator:86bbqb08p:553` from before the feature
// existed — a live instance of exactly the case the comment is for, which
// would have stayed a bus line forever. The fix that removes a bus-only
// finding must not itself be delivered only where there was no bus finding.

test('ROUND 2: a finding flagged to the bus BEFORE the durable half existed still gets its ticket comment', async () => {
  // Written by an older run: the `|`-fenced key `flagKey` produces, stamped
  // just now so the 6h window is what holds it rather than the run being new.
  const flagged = new Map([['contradiction:merged-operator|t1|42', new Date().toISOString()]]);
  const commented = [];
  const posted = [];
  const { clean, repaired, unchecked } = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], clean, repaired, unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async (ch, text) => posted.push(text),
    commentOn: async (id, text) => commented.push([id, text]),
    alreadyFlagged: flagged,
    recordFlagged: (key, at) => flagged.set(key, new Date(at || Date.now()).toISOString()),
    isLive: true,
  });
  assert.equal(commented.length, 1, 'the ticket comment was never posted, so an old bus flag must not suppress it');
  assert.equal(commented[0][0], 't1');
  assert.equal(posted.length, 0, 'the bus half WAS already said — it is not repeated');
  assert.ok(repaired.some((r) => /the bus half: already said/.test(r)), 'and the report says which surface was skipped and why');

  // ...and it is not said twice on the run after that.
  const second = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], second.clean, second.repaired, second.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async (ch, text) => posted.push(text),
    commentOn: async (id, text) => commented.push([id, text]),
    alreadyFlagged: flagged,
    recordFlagged: (key, at) => flagged.set(key, new Date(at || Date.now()).toISOString()),
    isLive: true,
  });
  assert.equal(commented.length, 1, 'one comment in total, still');
  assert.equal(posted.length, 0);
});

test('ROUND 2: a ticket comment that FAILED is retried next run; the bus post that succeeded is not', async () => {
  // Round 1, finding 3a: `recordFlagged` ran whenever EITHER surface landed,
  // so a comment that threw beside a bus post that worked was reported and
  // then never attempted again. Reported is not recoverable.
  const flagged = new Map();
  const posted = [];
  const commented = [];
  let commentWorks = false;
  const deps = () => ({
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async (ch, text) => posted.push(text),
    commentOn: async (id, text) => {
      if (!commentWorks) throw new Error('ClickUp said no');
      commented.push([id, text]);
    },
    alreadyFlagged: flagged,
    recordFlagged: (key, at) => flagged.set(key, new Date(at || Date.now()).toISOString()),
    isLive: true,
  });

  const first = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], first.clean, first.repaired, first.unchecked, deps());
  assert.equal(commented.length, 0);
  assert.equal(posted.length, 1, 'the bus half landed');
  assert.match(first.unchecked[0], /ticket comment FAILED to post/);
  assert.match(first.unchecked[0], /tried again next run/, 'it must say it is recoverable, because it now is');

  commentWorks = true;
  const second = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], second.clean, second.repaired, second.unchecked, deps());
  assert.equal(commented.length, 1, 'the half that failed is retried');
  assert.equal(posted.length, 1, 'the half that succeeded is NOT repeated');

  const third = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], third.clean, third.repaired, third.unchecked, deps());
  assert.equal(commented.length, 1, 'and now both halves are done and stay quiet');
  assert.equal(posted.length, 1);
});

test('ROUND 2: a bus post that FAILED is retried next run; the comment that succeeded is not', async () => {
  const flagged = new Map();
  const posted = [];
  const commented = [];
  let busWorks = false;
  const deps = () => ({
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    postBus: async (ch, text) => { if (!busWorks) throw new Error('party line down'); posted.push(text); },
    commentOn: async (id, text) => commented.push([id, text]),
    alreadyFlagged: flagged,
    recordFlagged: (key, at) => flagged.set(key, new Date(at || Date.now()).toISOString()),
    isLive: true,
  });

  const first = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], first.clean, first.repaired, first.unchecked, deps());
  assert.equal(commented.length, 1, 'the durable half landed');
  assert.equal(posted.length, 0);
  assert.match(first.unchecked[0], /could not post to the bus/);

  busWorks = true;
  const second = buckets();
  await checkMergedTasks([task('t1', 'Held', 'ready to launch')], second.clean, second.repaired, second.unchecked, deps());
  assert.equal(posted.length, 1, 'the bus half is retried');
  assert.equal(commented.length, 1, 'the ticket is not commented on twice');
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
    commentOn: () => {},
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
    getComments: comments(trail(9)),
    prState: () => ({ state: 'CLOSED' }),
    postBus: async (ch, text) => posted.push(text),
    alreadyFlagged: new Map([
      ['contradiction:closed-pr|t1|9', new Date(now - 60 * 60 * 1000).toISOString()],
    ]),
    recordFlagged: () => { throw new Error('must not record — nothing new was posted'); },
    isLive: true,
    now,
    commentOn: () => {},
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
    getComments: comments(trail(9)),
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
    getComments: comments(trail(9)),
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
    commentOn: () => {},
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

/**
 * THE MACHINE NAME (2026-09-05, task 86bbvcr0k).
 *
 * `thisNode()` returns a record, not a string, and this file used to keep the
 * whole record — so every ticket the reconciler closed was told it was closed
 * on `[object Object]`. Live on 86bbv1qp9.
 *
 * These drive the SHAPE rather than the value. A test that only asserted
 * "mac-mini" would pass on this machine and say nothing about the next change
 * to `thisNode()`'s return type, which is the thing that broke.
 */
test('nodeName reads the name out of the record thisNode actually returns', () => {
  assert.equal(
    nodeName(() => ({ name: 'mac-mini', source: 'file', file: '/x', raw: 'mac-mini' })),
    'mac-mini',
  );
  assert.equal(nodeName(() => 'macbook-pro'), 'macbook-pro', 'a bare string still works');
});

test('nodeName falls back rather than rendering a non-name', () => {
  const fallback = 'an unnamed machine';
  assert.equal(nodeName(() => ({ source: 'hostname', raw: '' })), fallback, 'record with no name');
  assert.equal(nodeName(() => ({ name: '' })), fallback, 'empty name');
  assert.equal(nodeName(() => ({ name: '   ' })), fallback, 'whitespace name');
  assert.equal(nodeName(() => ({ name: null })), fallback, 'null name');
  assert.equal(nodeName(() => null), fallback, 'no node at all');
  assert.equal(nodeName(() => { throw new Error('no identity file'); }), fallback, 'a thrower');
});

test('no shape thisNode can return renders as [object Object] or undefined', () => {
  const shapes = [
    () => ({ name: 'mac-mini', source: 'file', file: '/x', raw: 'mac-mini' }),
    () => ({ name: 'macbook-pro' }),
    () => ({ source: 'hostname' }),
    () => ({}),
    () => 'mac-mini',
    () => null,
    () => undefined,
    () => { throw new Error('unreadable'); },
  ];
  for (const readNode of shapes) {
    const name = nodeName(readNode);
    assert.equal(typeof name, 'string');
    assert.ok(name.trim().length > 0, 'a blank name reads as a broken note too');
    assert.doesNotMatch(name, /\[object Object\]|undefined|null/);
  }
});

test('the closure note names a real machine — never [object Object]', () => {
  const note = closureNote({
    prName: 'PR #42',
    prUrl: 'https://github.com/org/repo/pull/42',
    mergedAt: '2026-09-04T03:06:41Z',
  });
  assert.doesNotMatch(note, /\[object Object\]/, 'this is what shipped to 86bbv1qp9');
  assert.doesNotMatch(note, / on (undefined|null|)\./);
  assert.match(
    note,
    new RegExp(`on ${NODE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`),
    'and it is the name this machine actually answers to',
  );
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
    commentOn: () => {},
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
    commentOn: () => {},
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
    commentOn: () => {},
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
    commentOn: () => order.push('comment'),
    updateStatus: () => order.push('move'),
    isLive: true,
  });
  assert.deepEqual(order, ['comment', 'move'], 'the trail is written first, or a failure leaves a silent close');

  const second = buckets();
  const moved = [];
  await checkMergedTasks([task('t2', 'Widget', 'building')], second.clean, second.repaired, second.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    commentOn: () => { throw new Error('ClickUp said no'); },
    updateStatus: (id, status) => moved.push([id, status]),
    isLive: true,
  });
  assert.deepEqual(moved, [], 'no explanation means no close — an unexplained close is the defect');
  assert.equal(second.repaired.length, 0);
  assert.match(second.unchecked[0], /ClickUp said no/);
  assert.match(second.unchecked[0], /NOT moved/);
});

test('onWrite fires only when a live move actually happens — it is what makes the pass exit 4', async () => {
  let writes = 0;
  const dry = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'building')], dry.clean, dry.repaired, dry.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    commentOn: () => {},
    updateStatus: () => {},
    onWrite: () => { writes += 1; },
    isLive: false,
  });
  assert.equal(writes, 0, 'a rehearsal that reported exit 3 would call a dry run a change');

  const live = buckets();
  await checkMergedTasks([task('t1', 'Widget', 'building')], live.clean, live.repaired, live.unchecked, {
    getComments: comments(trail(42)),
    prState: () => ({ state: 'MERGED' }),
    commentOn: () => {},
    updateStatus: () => {},
    onWrite: () => { writes += 1; },
    isLive: true,
  });
  assert.equal(writes, 1);
});

// ── the closing line nothing was testing (review round 2, 2026-09-04) ───────
//
// `requestsMade()` is called on the LAST line of a reconcile pass — after every
// ticket has been read, every repair applied and every bus post sent. If the
// symbol is ever missing, the pass throws a TypeError at the finish line having
// already done all of its work: the board is changed, the exit code is non-zero,
// and the supervising `npm run repair` reads the whole pass as a failure.
//
// Nothing covered it. `grep requestsMade scripts/builder/*.test.js` found
// nothing, so every gate stayed green through a rename — and the merge that
// prompted this test came within one conflict of proving it, because `main` had
// independently rewritten the very function the counter lives in. The conflict
// is the only reason anybody looked.
//
// `stale_ready.mjs` closes with the identical line and would die the identical
// way, so it is covered here too rather than waiting for its own incident.

test('the counter both closing lines call exists, is callable, and returns a number', () => {
  const clickup = require('../lib/clickup.cjs');
  assert.equal(typeof clickup.requestsMade, 'function',
    'reconcile and stale-ready both call this on their last line — undefined here is a TypeError after the work is done');
  const n = clickup.requestsMade();
  assert.ok(Number.isFinite(n), `the closing line interpolates this into a report; got ${typeof n}`);
  assert.ok(n >= 0, 'a request count is never negative');
});

test('and each closing line really reaches THAT export, not a local of its own', () => {
  // A rename on either side has to fail somewhere. The source check is what
  // catches the half a runtime check cannot: a script that quietly stopped
  // importing it and grew its own counter would still pass the test above.
  const reconcileSrc = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  assert.match(reconcileSrc, /requestsMade,/, 'reconcile imports the shared counter');
  assert.match(reconcileSrc, /requests this pass: \$\{requestsMade\(\)\}/, 'and its closing line calls it');

  const staleSrc = fs.readFileSync(path.join(__dirname, '../stale_ready.mjs'), 'utf8');
  assert.match(staleSrc, /requests this pass: \$\{clickup\.requestsMade\(\)\}/,
    'stale-ready closes with the same line, through the same export');
});

test('the counter is the ONE DOOR\'s, so a pass counts what the door actually spent', () => {
  // The merge decision, asserted (2026-09-04). Two counters existed for a day:
  // this file's, incremented inside `callOnce`, and the shared client's
  // `budget.requests`, incremented at the attempt inside `clickupFetch`.
  // Keeping both is the "keep both sides" shape DOCTRINE 6.7 is about — two
  // numbers that disagree on purpose, with nothing saying which one the report
  // means. Re-introduce a private counter here and this fails.
  const clickup = require('../lib/clickup.cjs');
  const src = fs.readFileSync(path.join(__dirname, '../lib/clickup.cjs'), 'utf8');
  assert.match(src, /const requestsMade = \(\) => budget\.requests;/,
    'the reported figure and the budget the client throttles on must be one number');
  assert.doesNotMatch(src, /requestCount \+= 1/, 'a second, private counter is exactly what was merged away');
  assert.equal(clickup.requestsMade(), clickup.getBudget().requests,
    'and they agree at runtime, not only in the source');
});


// ── the status taxonomy: the property that would have caught this ──────────
//
// Acceptance criterion 5 of task 86bbt3wzk, and the actual requirement of it.
// The bug was not that a scan was wrong; it was that `Queued` and `Rework`
// belonged to NO set, so both scans skipped them and neither said so. Three
// hand-maintained name lists in one file made that a matter of remembering.
// Now all four are derived from `loopStatuses`, and this pins the invariant
// that makes derivation worth anything.

test('every Loop Queue status belongs to exactly one of the reconciler\'s four sets', () => {
  const membership = (display) => {
    const s = display.toLowerCase();
    const t = { id: 'x', name: 'x', status: { status: s } };
    return [
      ['auto-repair', AUTO_REPAIR_STATUSES.has(s)],
      ['operator', OPERATOR_STATUSES.has(s)],
      ['claimable', CLAIMABLE_STATUSES.has(s)],
      ['terminal', isTerminal(t)],
    ].filter(([, hit]) => hit).map(([n]) => n);
  };

  for (const display of loopStatuses.STAGE_ORDER) {
    const sets = membership(display);
    assert.equal(
      sets.length, 1,
      `"${display}" is in ${sets.length} of the four sets (${sets.join(', ') || 'NONE'}). `
      + 'A status in no set is skipped by every scan and reported by none — that is the 86bbt3wzk bug. '
      + 'A status in two would be acted on twice.'
    );
  }

  // And the ladder this iterates is the real one, not a stale copy: if a status
  // is added to DISPLAY without reaching STAGE_ORDER, the loop above would
  // silently stop covering it.
  assert.deepEqual(
    [...loopStatuses.STAGE_ORDER].map((d) => d.toLowerCase()).sort(),
    Object.keys(loopStatuses.DISPLAY).sort(),
    'STAGE_ORDER and DISPLAY must name the same seven statuses'
  );
});

test('the sets are DERIVED from loopStatuses, not re-listed here', () => {
  // The preferred means of criterion 5. A future edit that pastes the names
  // back into this file passes the test above and reintroduces exactly the
  // drift that caused the bug, so the source is checked too.
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  assert.match(src, /AUTO_REPAIR_STATUSES = new Set\(loopStatuses\.IN_PROGRESS_STATUSES\)/);
  assert.match(src, /OPERATOR_STATUSES = new Set\(loopStatuses\.OPERATOR_HELD_STATUSES\)/);
  assert.match(src, /CLAIMABLE_STATUSES = new Set\(loopStatuses\.CLAIMABLE_BY_BUILD\)/);
  assert.match(src, /loopStatuses\.TERMINAL_STATUSES\.includes\(/);
});

test('a claimable ticket is claimable and NOT in-flight or terminal — the gap, stated', () => {
  for (const s of loopStatuses.CLAIMABLE_BY_BUILD) {
    const t = task('t', 'n', s);
    assert.equal(isClaimable(t), true, `${s} must be claimable`);
    assert.equal(isInFlight(t), false, `${s} must not read as in-flight`);
    assert.equal(isTerminal(t), false, `${s} must not read as terminal`);
  }
});

// ── the third scan ─────────────────────────────────────────────────────────

/** The index shape `gh pr list --json number,state,body,url` returns. */
const indexed = (number, taskId, state = 'OPEN') => ({
  number,
  state,
  url: `https://github.com/org/repo/pull/${number}`,
  body: `Fixes things.\n\nhttps://app.clickup.com/t/${taskId}\n`,
});

test('claimableCandidates nominates only the ids it was asked about', () => {
  const prs = [indexed(1, 'aaa'), indexed(2, 'bbb'), indexed(3, 'aaa'), { body: null }, null];
  const byTicket = claimableCandidates(prs, ['aaa', 'ZZZ']);
  assert.deepEqual([...byTicket.keys()], ['aaa']);
  assert.deepEqual(byTicket.get('aaa').map((p) => p.number), [1, 3]);
  assert.equal(byTicket.has('bbb'), false, 'bbb is not claimable, so it is not a candidate');
});

test('claimableCandidates matches case-insensitively, both directions', () => {
  const byTicket = claimableCandidates(
    [{ number: 9, body: 'https://app.clickup.com/t/86BBT3WZK' }],
    ['  86bbt3wzk  ']
  );
  assert.deepEqual([...byTicket.keys()], ['86bbt3wzk']);
});

test('CLAIMABLE + OPEN PR: flagged to the bus AND onto the ticket, and never moved', async () => {
  const { clean, repaired, unchecked } = buckets();
  const bus = [];
  const ticketComments = [];
  let moves = 0;
  await checkClaimableTasks([task('t1', 'Panel sweep 8/15', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(449, 't1')],
    getComments: comments(trail(449)),
    prState: () => ({ state: 'OPEN' }),
    updateStatus: () => { moves += 1; },
    postBus: async (_c, m) => { bus.push(m); },
    commentOn: async (id, text) => { ticketComments.push({ id, text }); },
    isLive: true,
    log: () => {},
  });
  assert.equal(moves, 0, 'a claimable ticket with an open PR is a decision, not a bookkeeping slip');
  assert.equal(bus.length, 1);
  assert.match(bus[0], /is "queued" — a status loop-build CLAIMS FROM — but its own PR #449 is still OPEN/);
  assert.equal(ticketComments.length, 1, 'the durable half lands on the ticket the next claimer reads');
  assert.equal(ticketComments[0].id, 't1');
  assert.match(ticketComments[0].text, /build-start --task t1/);
  assert.equal(clean.length, 0, 'this is drift, not clean');
});

test('CLAIMABLE + OPEN PR in dry run: proposed, nothing sent, nothing moved', async () => {
  const { clean, repaired, unchecked } = buckets();
  let writes = 0;
  await checkClaimableTasks([task('t1', 'Panel sweep 8/15', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(449, 't1')],
    getComments: comments(trail(449)),
    prState: () => ({ state: 'OPEN' }),
    updateStatus: () => { writes += 1; },
    postBus: async () => { writes += 1; },
    commentOn: async () => { writes += 1; },
    isLive: false,
    log: () => {},
  });
  assert.equal(writes, 0, 'a dry run writes nothing at all');
  assert.ok(repaired.some((l) => l.startsWith('[DRY RUN]')));
});

test('CLAIMABLE + MERGED PR: moved to Live under --live, with the closure note FIRST', async () => {
  const { clean, repaired, unchecked } = buckets();
  const order = [];
  let wrote = 0;
  await checkClaimableTasks([task('t1', 'Shipped already', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(500, 't1', 'MERGED')],
    getComments: comments(trail(500)),
    prState: () => ({ state: 'MERGED', mergedAt: '2026-09-01T00:00:00Z' }),
    commentOn: () => { order.push('comment'); },
    updateStatus: (id, status) => { order.push(`status:${id}:${status}`); },
    onWrite: () => { wrote += 1; },
    postBus: async () => { throw new Error('a merged repair posts no bus line'); },
    isLive: true,
    log: () => {},
  });
  assert.deepEqual(order, ['comment', 'status:t1:Live'], 'the explanation is written before the close');
  assert.equal(wrote, 1, 'a live write must reach onWrite, or the pass exits like one that changed nothing');
  assert.ok(repaired.some((l) => /moved to Live/.test(l)));
});

test('CLAIMABLE + MERGED PR: a closure note that cannot post means NO move', async () => {
  const { clean, repaired, unchecked } = buckets();
  let moves = 0;
  await checkClaimableTasks([task('t1', 'Shipped already', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(500, 't1', 'MERGED')],
    getComments: comments(trail(500)),
    prState: () => ({ state: 'MERGED', mergedAt: MERGED_AFTER_COMMENTS }),
    commentOn: () => { throw new Error('ClickUp said no'); },
    updateStatus: () => { moves += 1; },
    isLive: true,
    log: () => {},
  });
  assert.equal(moves, 0, 'an unexplained close is the failure this gate exists to prevent');
  assert.equal(repaired.length, 0);
  assert.ok(unchecked.some((l) => /NOT moved to Live/.test(l)));
});

test('CLAIMABLE + MERGED PR in dry run: says it would move, moves nothing', async () => {
  const { clean, repaired, unchecked } = buckets();
  let writes = 0;
  await checkClaimableTasks([task('t1', 'Shipped already', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(500, 't1', 'MERGED')],
    getComments: comments(trail(500)),
    prState: () => ({ state: 'MERGED', mergedAt: MERGED_AFTER_COMMENTS }),
    commentOn: () => { writes += 1; },
    updateStatus: () => { writes += 1; },
    isLive: false,
    log: () => {},
  });
  assert.equal(writes, 0);
  assert.ok(repaired.some((l) => /\[DRY RUN\].*would move to Live/.test(l)));
});

test('CLAIMABLE + CLOSED-unmerged PR is CLEAN — an abandoned branch is the system working', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkClaimableTasks([task('t1', 'Abandoned', 'rework')], clean, repaired, unchecked, {
    prIndex: () => [indexed(7, 't1', 'CLOSED')],
    getComments: comments(trail(7)),
    prState: () => ({ state: 'CLOSED' }),
    isLive: true,
    log: () => {},
  });
  assert.equal(repaired.length, 0);
  assert.equal(unchecked.length, 0);
  assert.ok(clean.some((l) => /closed unmerged/.test(l)));
});

// ── criterion 4: what could NOT be read never reads as clean ───────────────

test('an unreadable PR index puts the WHOLE claimable set in "could not check"', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkClaimableTasks(
    [task('t1', 'a', 'queued'), task('t2', 'b', 'rework')],
    clean, repaired, unchecked,
    { prIndex: () => null, isLive: true, log: () => {} }
  );
  assert.equal(clean.length, 0, 'nothing was checked, so nothing is clean');
  assert.equal(repaired.length, 0);
  assert.equal(unchecked.length, 1);
  assert.match(unchecked[0], /2 claimable task\(s\).*could not be read/);
});

test('unreadable comments on a nominated ticket land in "could not check"', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkClaimableTasks([task('t1', 'a', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(1, 't1')],
    getComments: async () => { throw new Error('rate limited'); },
    isLive: true,
    log: () => {},
  });
  assert.equal(clean.length, 0);
  assert.match(unchecked[0], /comments could not be read — rate limited/);
});

test('an unreadable PR state lands in "could not check", never in clean', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkClaimableTasks([task('t1', 'a', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(1, 't1')],
    getComments: comments(trail(1)),
    prState: () => null,
    isLive: true,
    log: () => {},
  });
  assert.equal(clean.length, 0);
  assert.match(unchecked[0], /state of PR #1 could not be read/);
});

test('a nominated ticket with no PR-opened trail is unchecked, not judged', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkClaimableTasks([task('t1', 'a', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(1, 't1')],
    getComments: comments('some chatter, no trail'),
    prState: () => { throw new Error('the trail decides, so GitHub is never asked'); },
    isLive: true,
    log: () => {},
  });
  assert.equal(clean.length, 0);
  assert.equal(repaired.length, 0);
  assert.match(unchecked[0], /carries no `PR opened:` trail/);
});

test('claimable tickets no PR names are reported as not directly read — one line, not N', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkClaimableTasks(
    [task('t1', 'a', 'queued'), task('t2', 'b', 'queued'), task('t3', 'c', 'rework')],
    clean, repaired, unchecked,
    {
      prIndex: () => [indexed(1, 't1')],
      getComments: comments(trail(1)),
      prState: () => ({ state: 'OPEN' }),
      postBus: async () => {},
      commentOn: async () => {},
      isLive: true,
      log: () => {},
    }
  );
  const line = unchecked.find((l) => /not read directly/.test(l));
  assert.ok(line, 'the honest edge of the cheap index must be stated');
  assert.match(line, /^2 claimable task\(s\)/);
});

/** An index whose merged half was bounded, with the given window floor. */
function windowed(list, startIso) {
  Object.defineProperty(list, 'mergedWindowStart', {
    value: startIso === null ? null : Date.parse(startIso),
    enumerable: false,
  });
  return list;
}
const AUG_1 = Date.parse('2026-08-01T00:00:00Z');
const SEP_1 = Date.parse('2026-09-01T00:00:00Z');

test('a claimable ticket OLDER than the merged window is reported as possibly missed', async () => {
  const { clean, repaired, unchecked } = buckets();
  const old = { ...task('t1', 'ancient', 'queued'), date_created: String(AUG_1) };
  await checkClaimableTasks([old], clean, repaired, unchecked, {
    prIndex: () => windowed([], '2026-09-01T00:00:00Z'),
    indexLimit: 3,
    isLive: true,
    log: () => {},
  });
  assert.ok(unchecked.some((l) => /older than the 3 merged pull requests read.*window starts 2026-09-01/.test(l)),
    `expected a window line, got: ${JSON.stringify(unchecked)}`);
});

test('a claimable ticket INSIDE the merged window is not — the line self-silences', async () => {
  // The first version said "the index hit its limit" whenever it read `limit`
  // rows, which is true on every run against 607 merges. An honest "could not
  // check" line that fires unconditionally is wallpaper, so the bound reports
  // only when a ticket's answer could actually lie outside the window.
  const { clean, repaired, unchecked } = buckets();
  const recent = { ...task('t1', 'fresh', 'queued'), date_created: String(SEP_1 + 86400000) };
  await checkClaimableTasks([recent], clean, repaired, unchecked, {
    prIndex: () => windowed([], '2026-09-01T00:00:00Z'),
    indexLimit: 3,
    isLive: true,
    log: () => {},
  });
  assert.equal(unchecked.filter((l) => /older than the/.test(l)).length, 0);
});

test('an UNbounded merged half never reports a window at all', async () => {
  const { clean, repaired, unchecked } = buckets();
  const old = { ...task('t1', 'ancient', 'queued'), date_created: String(AUG_1) };
  await checkClaimableTasks([old], clean, repaired, unchecked, {
    prIndex: () => windowed([], null),
    indexLimit: 3,
    isLive: true,
    log: () => {},
  });
  assert.equal(unchecked.filter((l) => /older than the/.test(l)).length, 0,
    'null means the window covered every merge there is — a different statement from a floor');
});

test('a ticket already nominated is never counted as possibly missed', async () => {
  const { clean, repaired, unchecked } = buckets();
  const old = { ...task('t1', 'ancient', 'queued'), date_created: String(AUG_1) };
  await checkClaimableTasks([old], clean, repaired, unchecked, {
    prIndex: () => windowed([indexed(1, 't1')], '2026-09-01T00:00:00Z'),
    getComments: comments(trail(1)),
    prState: () => ({ state: 'OPEN' }),
    postBus: async () => {},
    commentOn: async () => {},
    indexLimit: 3,
    isLive: true,
    log: () => {},
  });
  assert.equal(unchecked.filter((l) => /older than the/.test(l)).length, 0,
    'its PR was found; the window cannot have hidden it');
});

test('the real index asks for open PRs unbounded and merged PRs bounded', () => {
  // The asymmetry is the decision; a shared `--state all --limit` would restore
  // the truncate-every-run behaviour without failing anything above.
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  assert.match(src, /ask\(\['--state', 'open', '--limit', '1000'\]\)/);
  assert.match(src, /ask\(\['--state', 'merged', '--limit', String\(limit\)\]\)/);
  assert.doesNotMatch(src, /'--state', 'all'/, "one 'all' query is what truncated on every run");
});

test('if EITHER half of the index fails, the whole index fails', () => {
  // Half an index reported as a whole one is the false all-clear this ticket is
  // about, one level down: the open half succeeding while the merged half
  // throws would silently answer "no claimable ticket has a merged PR".
  const { ghPrIndex } = require('../reconcile_clickup_github.cjs');
  const realExec = require('child_process').execFileSync;
  assert.equal(typeof ghPrIndex, 'function');
  // The concat is inside one try; a throw from either `ask` returns null.
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  const body = src.slice(src.indexOf('function ghPrIndex'), src.indexOf('function claimableCandidates'));
  assert.equal((body.match(/try \{/g) || []).length, 1, 'one try around both halves, not one each');
  assert.match(body, /catch \{\s*return null;/);
  assert.ok(realExec, 'sanity');
});

test('no claimable tickets: the scan says so and asks GitHub nothing', async () => {
  const { clean, repaired, unchecked } = buckets();
  await checkClaimableTasks([task('t1', 'a', 'in review')], clean, repaired, unchecked, {
    prIndex: () => { throw new Error('must not be called'); },
    isLive: true,
    log: () => {},
  });
  assert.deepEqual([clean, repaired, unchecked], [[], [], []]);
});

test('the third scan is actually WIRED INTO the pass, not merely exported', () => {
  // The scan could be perfect and never run. `checkMergedTasks` and
  // `checkStampedBranches` are both called from main(); this one must be too.
  const src = fs.readFileSync(path.join(__dirname, '../reconcile_clickup_github.cjs'), 'utf8');
  assert.match(src, /await checkClaimableTasks\(tasks, clean, repaired, unchecked, deps\);/,
    'main() must run the third scan, with the same deps the other two get');
});

// ── review round 1: the verdict split, the reopen guard, the stale trail ────
//
// Three findings, all of them about the scan being CONFIDENTLY WRONG rather
// than blind: it called every send-back drift, it undid a deliberate reopen
// every half hour, and it closed a ticket over a pull request that was still
// open. The tests below are the property each fix asserts; each was
// break-tested by reverting its fix and watching the named test fail.

test('REWORK + OPEN PR is CLEAN — that is the defined state of every send-back', async () => {
  const { clean, repaired, unchecked } = buckets();
  let writes = 0;
  await checkClaimableTasks([task('t1', 'Sent back twice', 'rework')], clean, repaired, unchecked, {
    prIndex: () => [indexed(607, 't1')],
    getComments: comments(trail(607)),
    prState: () => ({ state: 'OPEN' }),
    updateStatus: () => { writes += 1; },
    postBus: async () => { writes += 1; },
    commentOn: async () => { writes += 1; },
    isLive: true,
    log: () => {},
  });
  assert.equal(writes, 0, 'a healthy send-back must not raise an alarm or leave a permanent comment');
  assert.equal(repaired.length, 0);
  assert.equal(unchecked.length, 0);
  assert.ok(clean.some((l) => /a send-back keeps its branch and its PR/.test(l)),
    'and the clean line has to SAY why, or the next reader re-files this as a bug');
});

test('QUEUED + OPEN PR still flags — that half was right and must not be lost', async () => {
  const { clean, repaired, unchecked } = buckets();
  const bus = [];
  await checkClaimableTasks([task('t1', 'Never started, apparently', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(449, 't1')],
    getComments: comments(trail(449)),
    prState: () => ({ state: 'OPEN' }),
    postBus: async (_c, m) => { bus.push(m); },
    commentOn: async () => {},
    isLive: true,
    log: () => {},
  });
  assert.equal(bus.length, 1, 'a Queued ticket advertises as unstarted — that IS the duplicate-build shape');
  assert.equal(clean.length, 0);
});

test('the two tiers get DIFFERENT verdicts on identical facts — the split is the fix', async () => {
  const run = async (status) => {
    const b = buckets();
    await checkClaimableTasks([task('t1', 'same facts', status)], b.clean, b.repaired, b.unchecked, {
      prIndex: () => [indexed(11, 't1')],
      getComments: comments(trail(11)),
      prState: () => ({ state: 'OPEN' }),
      postBus: async () => {},
      commentOn: async () => {},
      isLive: true,
      log: () => {},
    });
    return b;
  };
  const rework = await run('rework');
  const queued = await run('queued');
  assert.equal(rework.clean.length, 1);
  assert.equal(queued.clean.length, 0);
  assert.equal(rework.repaired.length, 0);
  assert.ok(queued.repaired.length > 0, 'the flag lands in `repaired` as the action it took');
});

test('isReworkStatus reads the ONE status module, so the split cannot drift', () => {
  assert.equal(isReworkStatus(loopStatuses.REWORK), true);
  assert.equal(isReworkStatus('  ReWork '), true);
  assert.equal(isReworkStatus(loopStatuses.QUEUED), false);
  assert.equal(isReworkStatus(''), false);
  assert.equal(isReworkStatus(null), false);
});

test('a REOPENED ticket is not re-closed — the closure note asks for exactly this', async () => {
  const { clean, repaired, unchecked } = buckets();
  let moves = 0;
  await checkClaimableTasks([task('t1', 'Closed too early', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(500, 't1', 'MERGED')],
    // oldest -> newest: the trail, this job's own closure note, then the reopen
    getComments: async () => [
      { id: 'c1', date: '1700000000000', comment_text: trail(500) },
      { id: 'c2', date: String(Date.parse('2026-09-01T01:00:00Z')), comment_text: 'Closed to Live by reconcile' },
      { id: 'c3', date: String(Date.parse('2026-09-02T09:00:00Z')), comment_text: 'That was wrong — reopening, the trail names the wrong PR.' },
    ],
    prState: () => ({ state: 'MERGED', mergedAt: MERGED_AFTER_COMMENTS }),
    commentOn: () => { moves += 1; },
    updateStatus: () => { moves += 1; },
    isLive: true,
    log: () => {},
  });
  assert.equal(moves, 0, 'closing it again undoes the reopen every 30 minutes, forever');
  assert.equal(repaired.length, 0);
  assert.ok(unchecked.some((l) => /POSTDATES the merge/.test(l)),
    'and it is reported as could-not-tell, never as clean');
});

test('the reopen guard is silent on the drift it EXISTS to repair', async () => {
  const { clean, repaired, unchecked } = buckets();
  const order = [];
  await checkClaimableTasks([task('t1', 'Genuinely shipped', 'queued')], clean, repaired, unchecked, {
    prIndex: () => [indexed(500, 't1', 'MERGED')],
    getComments: comments(trail(500)),   // every comment predates the merge
    prState: () => ({ state: 'MERGED', mergedAt: MERGED_AFTER_COMMENTS }),
    commentOn: () => { order.push('comment'); },
    updateStatus: (id, st) => { order.push(`status:${id}:${st}`); },
    isLive: true,
    log: () => {},
  });
  assert.deepEqual(order, ['comment', 'status:t1:Live'],
    'a guard that also blocks the normal case is a repair half that never fires');
});

test('reopenBlock: a merge with no readable time is CANNOT TELL, never a licence to close', () => {
  const spoke = [{ date: '1700000000000' }];
  assert.equal(reopenBlock({ comments: spoke, mergedAt: '2026-09-01T00:00:00Z' }), null);
  assert.match(String(reopenBlock({ comments: spoke, mergedAt: null })), /gave no merge time/);
  assert.match(String(reopenBlock({ comments: spoke, mergedAt: 'not a date' })), /gave no merge time/);
  assert.match(String(reopenBlock({ comments: [], mergedAt: '2026-09-01T00:00:00Z' })), /readable date/);
});

test('newestCommentAt takes the MAX, not the last — comment order is not guaranteed', () => {
  assert.equal(newestCommentAt([{ date: '30' }, { date: '10' }, { date: '20' }]), 30);
  assert.equal(newestCommentAt([{ date: 'nonsense' }, { date: null }]), 0);
  assert.equal(newestCommentAt(null), 0);
});

test('a merged trail PR does NOT close the ticket while a nominating PR is still OPEN', async () => {
  const { clean, repaired, unchecked } = buckets();
  let moves = 0;
  await checkClaimableTasks([task('t1', 'Round two, no trail written', 'queued')], clean, repaired, unchecked, {
    // the index sees BOTH: the merged round one, and the open round two whose
    // `pr-opened` line was never written
    prIndex: () => [indexed(601, 't1', 'OPEN'), indexed(500, 't1', 'MERGED')],
    getComments: comments(trail(500)),
    prState: () => ({ state: 'MERGED', mergedAt: MERGED_AFTER_COMMENTS }),
    commentOn: () => { moves += 1; },
    updateStatus: () => { moves += 1; },
    isLive: true,
    log: () => {},
  });
  assert.equal(moves, 0, 'closing here buries a pull request that is still in flight');
  assert.equal(repaired.length, 0);
  assert.equal(clean.length, 0);
  const line = unchecked.find((l) => /still OPEN/.test(l));
  assert.ok(line, 'it lands in could-not-check');
  assert.match(line, /#601/, 'naming the open PR');
  assert.match(line, /PR #500 is MERGED/, 'and the merged one it would have closed on');
});

test('the stale-trail guard does not fire when every nominating PR is merged', async () => {
  const { clean, repaired, unchecked } = buckets();
  let closed = false;
  await checkClaimableTasks([task('t1', 'Shipped', 'rework')], clean, repaired, unchecked, {
    prIndex: () => [indexed(500, 't1', 'MERGED'), indexed(499, 't1', 'CLOSED')],
    getComments: comments(trail(500)),
    prState: () => ({ state: 'MERGED', mergedAt: MERGED_AFTER_COMMENTS }),
    commentOn: () => {},
    updateStatus: () => { closed = true; },
    isLive: true,
    log: () => {},
  });
  assert.equal(closed, true, 'a merged Rework ticket IS drift — the MERGED half was never split');
  assert.equal(unchecked.length, 0);
});
