'use strict';

/**
 * The stranded-ticket sweep, EXECUTED (2026-09-05, task 86bbt204x).
 *
 * The sweep shipped on 2026-09-02 with its "running + stranded" path covered
 * only by regexes over the text of scripts/pipeline.mjs — assertions that the
 * function is called in the right place and that its exit code is wired
 * through. Those are still in pipelinePause.test.js and still worth having:
 * they pin the WIRING, which is what actually broke. But nothing executed the
 * sweep, and this is the code that MOVES REAL TICKETS on the board. A regex
 * proving a function is called cannot catch a bug inside it.
 *
 * So this file drives the whole loop against a fake ClickUp that really
 * applies the writes it is given. That is what makes the last test here
 * possible — run the sweep, then run it again over the queue the first run
 * left behind, and watch the second one find nothing. It is the ticket's own
 * "how to test", performed rather than described.
 *
 * No token, no network, no clock: `nowMs` is injected, so a ticket is stale
 * because the test says it is and not because the suite ran slowly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sweepStranded } = require('./pipelineSweep.js');
const { STRANDED_AFTER_MS, strandedBuildDestination } = require('./pipelinePause.js');
const { REVIEW_CLAIM_NOTE } = require('./loopNote.js');
const loopStatuses = require('./loopStatuses.js');

const NOW = 1_760_000_000_000;
const MIN = 60 * 1000;
/** Comfortably past the threshold, whatever the threshold is tuned to. */
const STALE = STRANDED_AFTER_MS + 30 * MIN;
/** In flight and being worked on — the case the sweep must NOT touch. */
const FRESH = 5 * MIN;

/** A Loop Queue task as ClickUp returns one. */
function ticket({ id, name = `ticket ${id}`, status, ago, loopNote = '', assignees = [] }) {
  return {
    id,
    name,
    status: { status },
    date_updated: String(NOW - ago),
    custom_fields: [{ id: `cf-${id}`, name: 'Loop note', value: loopNote }],
    assignees,
  };
}

const building = (id, opts = {}) => ticket({ id, status: loopStatuses.BUILDING, ago: STALE, ...opts });
const reviewing = (id, opts = {}) => ticket({
  id, status: loopStatuses.IN_REVIEW, ago: STALE, loopNote: `${REVIEW_CLAIM_NOTE} since forever`, ...opts,
});

/**
 * A ClickUp that actually applies what it is told, so the board the sweep
 * leaves behind is a real board a second sweep can read. A fake that only
 * recorded calls could never show that the repair STICKS, which is the half
 * that matters to a reader deciding whether to run it.
 */
function fakeClickUp(tasks, { failNoteOn = [], failMoveOn = [], moveLandsAs = null } = {}) {
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const calls = [];
  const tryCall = async (method, path, body) => {
    calls.push({ method, path, body });
    const id = (path.match(/\/task\/([^/]+)/) || [])[1];
    const task = byId.get(String(id));
    if (method === 'POST' && path.endsWith('/comment')) {
      if (failNoteOn.includes(id)) return { ok: false, res: { status: 500 }, json: null };
      task.comments = (task.comments || []).concat(body.comment_text);
      return { ok: true, res: { status: 200 }, json: {} };
    }
    if (method === 'PUT') {
      if (failMoveOn.includes(id)) return { ok: false, res: { status: 500 }, json: null };
      // `moveLandsAs` is the nastier failure: ClickUp answers 200 and the
      // status is NOT the one that was asked for. A sweep that trusted the
      // 200 would report the ticket unstuck while it sat exactly where it was.
      const landed = moveLandsAs || body.status;
      task.status = { status: String(landed).toLowerCase() };
      task.assignees = [];
      task.date_updated = String(NOW);
      return { ok: true, res: { status: 200 }, json: { status: { status: landed } } };
    }
    return { ok: false, res: { status: 404 }, json: null };
  };
  return { tryCall, calls, byId, tasks };
}

/** Everything the sweep needs, with the parts a test wants to vary on top. */
function run(tasks, opts = {}) {
  const fake = opts.fake || fakeClickUp(tasks);
  const said = [];
  const cleared = [];
  return sweepStranded({
    by: 'a test',
    queue: { readable: true, tasks },
    nowMs: NOW,
    buildStartFor: async (id) => ({ action: (opts.actions || {})[id] || 'fresh' }),
    clearLoopNote: async (task) => {
      if ((opts.failClearOn || []).includes(String(task.id))) return false;
      cleared.push(String(task.id));
      const f = task.custom_fields.find((x) => x.name === 'Loop note');
      f.value = '';
      return true;
    },
    tryCall: fake.tryCall,
    log: (m) => said.push(m),
    ...opts.sweep,
  }).then((out) => ({ ...out, said, cleared, fake }));
}

// ---------------------------------------------------------------------------
// The headline criterion: pipeline RUNNING, a ticket stranded, and the sweep
// both moves it and says where it went.
// ---------------------------------------------------------------------------

test('a stranded build is moved, and the sweep says where it went', async () => {
  const tasks = [building('b1', { name: 'Half-built thing', assignees: [{ id: 7 }] })];
  const { swept, found, sweepState, said, fake } = await run(tasks, {
    actions: { b1: 'continue' }, sweep: { apply: true },
  });

  assert.equal(found, 1, 'it found the stranded ticket');
  assert.deepEqual(swept, [{ id: 'b1', kind: 'a build', destination: 'Rework' }]);
  assert.deepEqual(sweepState, { checked: true, left: 0, why: '' });

  // The BOARD moved, not merely the report.
  assert.equal(fake.byId.get('b1').status.status, 'rework');
  // ...and it says so, naming the ticket and the destination. "Says where it
  // went" is the acceptance criterion, so it is asserted rather than assumed.
  assert.match(said.join('\n'), /b1 \("Half-built thing"\) returned to Rework/);
  assert.match(said.join('\n'), /untouched for/, 'and how stale it was, so a reader can judge the call');

  // The hand-back note is written BEFORE the move. A move with no note is a
  // ticket that changed status with nothing on it saying who did that or why.
  const [first, second] = fake.calls;
  assert.match(first.path, /\/task\/b1\/comment$/);
  assert.equal(first.method, 'POST');
  assert.equal(second.method, 'PUT');
  assert.equal(second.body.status, 'Rework');
  // The stale assignee is taken off on the way out, or the ticket keeps
  // sitting in somebody's "assigned to me" while nothing is working on it.
  assert.deepEqual(second.body.assignees, { add: [], rem: [7] });
});

test('where a stranded build goes depends on whether anything was built for it', async () => {
  // Not re-derived here — this is strandedBuildDestination's rule, executed
  // through the loop to prove the loop actually asks it (task 86bbr1u9v).
  for (const [action, expected] of [['continue', 'Rework'], ['fresh', 'Queued'], ['unknown', 'Rework']]) {
    const tasks = [building('b1')];
    const { swept, fake } = await run(tasks, { actions: { b1: action }, sweep: { apply: true } });
    assert.equal(swept[0].destination, expected, `${action} -> ${expected}`);
    assert.equal(fake.byId.get('b1').status.status, expected.toLowerCase());
    assert.equal(strandedBuildDestination(action).status, expected, 'and it is the shared rule, not a copy');
  }
});

test('a stranded REVIEW is released where it stands, never sent back', async () => {
  // The expensive mistake: "In review" is where a ticket WAITS for a reviewer,
  // and its build is finished with a PR open. Moving it to Queued would throw
  // that away and hand the whole job to a second builder.
  const tasks = [reviewing('r1', { name: 'Waiting on a checker' })];
  const { swept, said, cleared, fake } = await run(tasks, { sweep: { apply: true } });

  assert.deepEqual(swept, [{ id: 'r1', kind: 'a review', destination: 'In review' }]);
  assert.equal(fake.byId.get('r1').status.status, loopStatuses.IN_REVIEW, 'the status is untouched');
  assert.deepEqual(cleared, ['r1'], 'the stale claim note IS the release, so it must be cleared');
  assert.ok(!fake.calls.some((c) => c.method === 'PUT'), 'a review is never moved');
  assert.match(said.join('\n'), /r1 \("Waiting on a checker"\) released in "In review"/);
});

test('a ticket that is merely in flight is left alone', async () => {
  // The safety property. 90 minutes is longer than any loop pass but NOT
  // longer than a hand-driven fast-track session, which holds a ticket in
  // "Building" for hours without touching it. Sweeping that ticket would
  // hand somebody's live work to a second builder.
  const tasks = [building('busy', { ago: FRESH }), reviewing('checking', { ago: FRESH })];
  const { swept, found, sweepState, fake } = await run(tasks, { sweep: { apply: true } });

  assert.equal(found, 0);
  assert.deepEqual(swept, []);
  assert.deepEqual(sweepState, { checked: true, left: 0, why: '' }, 'looked, found nothing — an all-clear it earned');
  assert.deepEqual(fake.calls, [], 'and it wrote nothing at all');
});

test('a resting "In review" ticket with no claim note is not in flight at all', async () => {
  // Without the note nothing is running on it — it is waiting to be claimed,
  // which is the normal state of a reviewable ticket, not a stranded one.
  const tasks = [ticket({ id: 'resting', status: loopStatuses.IN_REVIEW, ago: STALE })];
  const { found, swept } = await run(tasks, { sweep: { apply: true } });
  assert.equal(found, 0);
  assert.deepEqual(swept, []);
});

// ---------------------------------------------------------------------------
// The dry run — the default, and the guard that makes an always-available
// sweep safe to hand anyone.
// ---------------------------------------------------------------------------

test('a dry run previews the real destination and writes absolutely nothing', async () => {
  const tasks = [building('b1', { name: 'Would move' }), reviewing('r1')];
  const { swept, found, said, cleared, fake } = await run(tasks, { actions: { b1: 'continue' } });

  assert.equal(found, 2);
  assert.deepEqual(swept, [
    { id: 'b1', kind: 'a build', destination: 'Rework' },
    { id: 'r1', kind: 'a review', destination: 'In review' },
  ], 'the preview names the same destinations the apply would');

  assert.deepEqual(fake.calls, [], 'not one write');
  assert.deepEqual(cleared, [], 'and no note cleared');
  assert.equal(fake.byId.get('b1').status.status, loopStatuses.BUILDING, 'the board is untouched');
  // Conditional wording throughout: a preview that reads as a completed sweep
  // is worse than no preview.
  assert.match(said.join('\n'), /b1 \("Would move"\) WOULD return to Rework/);
  assert.match(said.join('\n'), /r1 .*WOULD be released where it stands/);
});

test('the dry run asks the SAME question the apply does, not a cheaper guess', async () => {
  // If the preview guessed the destination it would be a different program
  // from the one it previews, and the guess is what a reader would act on.
  const asked = [];
  const tasks = [building('b1')];
  await sweepStranded({
    by: 'a test',
    queue: { readable: true, tasks },
    nowMs: NOW,
    buildStartFor: async (id) => { asked.push(id); return { action: 'continue' }; },
    clearLoopNote: async () => true,
    tryCall: async () => { throw new Error('a dry run must not call ClickUp'); },
    log: () => {},
  });
  assert.deepEqual(asked, ['b1'], 'the build-start lookup happens on a dry run too');
});

// ---------------------------------------------------------------------------
// Every way it can fail. "Left behind" is the number a summary cannot see for
// itself, and printing an all-clear over a ticket that is still stuck is the
// defect this three-part report exists to prevent (86bbqw49y).
// ---------------------------------------------------------------------------

test('a ticket whose note could not be written is LEFT, not moved silently', async () => {
  const tasks = [building('b1')];
  const fake = fakeClickUp(tasks, { failNoteOn: ['b1'] });
  const { swept, found, sweepState, said } = await run(tasks, { fake, sweep: { apply: true } });

  assert.equal(found, 1, 'it was found');
  assert.deepEqual(swept, [], 'and NOT counted as swept');
  assert.equal(sweepState.left, 1, 'it is counted as left behind');
  assert.equal(tasks[0].status.status, loopStatuses.BUILDING, 'the status was not touched');
  assert.ok(!fake.calls.some((c) => c.method === 'PUT'),
    'no move may follow a failed note — that is a status change with no account of who did it');
  assert.match(said.join('\n'), /LEAVING it where it is rather than moving it silently/);
});

test('a note that lands over a move that does not leaves the ticket counted as stranded', async () => {
  const tasks = [building('b1')];
  const fake = fakeClickUp(tasks, { failMoveOn: ['b1'] });
  const { swept, sweepState, said } = await run(tasks, { fake, sweep: { apply: true } });

  assert.deepEqual(swept, []);
  assert.equal(sweepState.left, 1);
  assert.match(said.join('\n'), /the note landed but the move to Queued did NOT/);
  assert.match(said.join('\n'), /it is still stranded/);
});

test('a 200 that did not actually change the status is still a failure', async () => {
  // The quiet one. ClickUp answers OK and the ticket is where it was; a sweep
  // that trusted the 200 would report it unstuck (DOCTRINE 3.10 — a 200 is not
  // evidence).
  const tasks = [building('b1')];
  const fake = fakeClickUp(tasks, { moveLandsAs: loopStatuses.BUILDING });
  const { swept, sweepState } = await run(tasks, { fake, sweep: { apply: true } });

  assert.deepEqual(swept, [], 'it may not be reported as swept');
  assert.equal(sweepState.left, 1);
});

test('a review whose stale claim could not be cleared is left behind too', async () => {
  const tasks = [reviewing('r1')];
  const { swept, sweepState, said } = await run(tasks, { failClearOn: ['r1'], sweep: { apply: true } });

  assert.deepEqual(swept, []);
  assert.equal(sweepState.left, 1);
  assert.match(said.join('\n'), /the next review pass will still see it as taken/);
});

test('one ticket failing does not stop the sweep reaching the next', async () => {
  const tasks = [building('b1'), building('b2')];
  const fake = fakeClickUp(tasks, { failNoteOn: ['b1'] });
  const { swept, found, sweepState } = await run(tasks, { fake, sweep: { apply: true } });

  assert.equal(found, 2);
  assert.deepEqual(swept.map((s) => s.id), ['b2'], 'the healthy one still got unstuck');
  assert.equal(sweepState.left, 1);
});

test('a queue that could not be read is "could not tell", never an all-clear', async () => {
  // DOCTRINE 3.11, and this feature's oldest scar. Not looking and finding
  // nothing are different answers.
  for (const queue of [{ readable: false }, null, undefined]) {
    const said = [];
    const out = await sweepStranded({
      by: 'a test',
      queue,
      apply: true,
      buildStartFor: async () => { throw new Error('nothing may be looked up'); },
      clearLoopNote: async () => { throw new Error('nothing may be cleared'); },
      tryCall: async () => { throw new Error('nothing may be written'); },
      log: (m) => said.push(m),
    });
    assert.equal(out.sweepState.checked, false, 'it must not claim to have looked');
    assert.equal(out.found, 0);
    assert.deepEqual(out.swept, []);
    assert.equal(out.sweepState.why, 'the queue could not be read');
    assert.match(said.join('\n'), /the queue could not be read, so nothing was swept/);
  }
});

// ---------------------------------------------------------------------------
// The trail. Whoever moved a ticket is the only account there is of why it
// moved, and a wrong actor in it is the defect itself (DOCTRINE 2.5/2.6).
// ---------------------------------------------------------------------------

test('the hand-back note credits the command that actually ran', async () => {
  const tasks = [building('b1')];
  const { fake } = await run(tasks, {
    actions: { b1: 'continue' },
    sweep: { apply: true, command: 'npm run pipeline -- sweep --apply', by: 'an agent session on mac-mini' },
  });
  const note = fake.byId.get('b1').comments[0];
  assert.match(note, /npm run pipeline -- sweep --apply/, 'the command that ran');
  assert.doesNotMatch(note, /resume/, 'and never a resume that did not happen');
  assert.match(note, /Rework/, 'the note names the destination the move then used');
  assert.match(note, /build-start/, 'and tells the next pass to look for its own branch first');
});

test('the note names the SAME destination the move uses', async () => {
  // A note saying "Queued" above a move to "Rework" is a trail that
  // contradicts the board, and the trail is the only thing the next pass reads.
  for (const [action, expected] of [['continue', 'Rework'], ['fresh', 'Queued']]) {
    const tasks = [building('b1')];
    const { fake } = await run(tasks, { actions: { b1: action }, sweep: { apply: true } });
    assert.match(fake.byId.get('b1').comments[0], new RegExp(expected));
    assert.equal(fake.calls.find((c) => c.method === 'PUT').body.status, expected);
  }
});

// ---------------------------------------------------------------------------
// The ticket's own "how to test", performed: sweep, then sweep the board the
// first run left behind and watch it come back clean.
// ---------------------------------------------------------------------------

test('running the sweep twice: the second pass finds nothing left to do', async () => {
  const tasks = [
    building('b1', { assignees: [{ id: 7 }] }),
    building('b2'),
    reviewing('r1'),
    building('busy', { ago: FRESH }),
  ];
  const fake = fakeClickUp(tasks);

  const first = await run(tasks, { fake, actions: { b1: 'continue', b2: 'fresh' }, sweep: { apply: true } });
  assert.equal(first.found, 3);
  assert.deepEqual(first.swept.map((s) => `${s.id}->${s.destination}`),
    ['b1->Rework', 'b2->Queued', 'r1->In review']);
  assert.equal(first.sweepState.left, 0);

  // The same fixture objects, mutated by the writes above — this is the board
  // as the next reader would find it.
  const second = await run(tasks, { fake, sweep: { apply: true } });
  assert.equal(second.found, 0, 'nothing is stranded any more');
  assert.deepEqual(second.swept, []);
  assert.deepEqual(second.sweepState, { checked: true, left: 0, why: '' },
    'a clean report that was EARNED by looking, which is the only kind worth printing');

  // Specifically: the repair stuck, in all three shapes.
  assert.equal(fake.byId.get('b1').status.status, 'rework');
  assert.equal(fake.byId.get('b2').status.status, 'queued');
  assert.equal(fake.byId.get('r1').status.status, loopStatuses.IN_REVIEW, 'the review stayed put');
  assert.equal(fake.byId.get('r1').custom_fields[0].value, '', 'and its stale claim is gone');
  assert.equal(fake.byId.get('busy').status.status, loopStatuses.BUILDING, 'live work was never touched');
});

test('the threshold is a parameter, so a caller can widen or narrow what counts', async () => {
  // `--stranded-after-minutes` exists so the dry run is a real instrument:
  // without it the only way to watch this find anything is to wait an hour and
  // a half for a pass to die, which is how a sweep ships never having been
  // seen to work.
  const tasks = [building('b1', { ago: 20 * MIN })];
  assert.equal((await run(tasks, { sweep: { apply: true } })).found, 0, 'not stale by the default');
  assert.equal((await run(tasks, { sweep: { apply: true, strandedAfterMs: 10 * MIN } })).found, 1,
    'stale once the caller says 10 minutes');
});
