// The loop's sleep must follow the queue — and must fail toward SLEEPING
// LONGER on every kind of bad input.
//
// The incident behind the floor: `loop-review` was left on a 2-minute
// interval on 2026-08-24 and ran ~360 passes, almost all of them finding
// nothing. Every assertion below that names 900 is guarding against a repeat
// of that, and every assertion that names 3600 is guarding the direction —
// an unknown queue must never be answered with a short interval.
const test = require('node:test');
const assert = require('node:assert');

const li = require('./loopInterval.js');

// ---------------------------------------------------------------------------
// The curve (acceptance criteria 1 and 2)
// ---------------------------------------------------------------------------

test('the curve is depth 0 -> 3600, 1-3 -> 1800, 4+ -> 900', () => {
  assert.equal(li.intervalForDepth(0).seconds, 3600);
  assert.equal(li.intervalForDepth(1).seconds, 1800);
  assert.equal(li.intervalForDepth(2).seconds, 1800);
  assert.equal(li.intervalForDepth(3).seconds, 1800);
  assert.equal(li.intervalForDepth(4).seconds, 900);
  assert.equal(li.intervalForDepth(36).seconds, 900);
});

test('the reason names the depth, so the cadence is never a mystery', () => {
  // The WIP cap shipped with a bare total and nobody could tell why it had
  // declined. This is that lesson applied: the number always travels with
  // its reason.
  assert.match(li.intervalForDepth(12).reason, /900s \(12 claimable/);
});

test('BREAK-TEST THE FLOOR: nothing the curve or a config can say goes below 900s', () => {
  // If someone "just tries" 120 in the runner argument, or edits the state
  // file, or adds a faster rung to the curve, this assertion is what stops
  // 2026-08-24 happening twice.
  assert.equal(li.clampToFloor(120), 900, 'a 120s configured interval must be raised to the floor');
  assert.equal(li.clampToFloor(0), 900);
  assert.equal(li.clampToFloor(-99999), 900);
  assert.equal(li.clampToFloor(899), 900);
  assert.equal(li.clampToFloor(901), 901, 'the floor raises, it does not flatten');
  for (const row of li.CURVE) {
    assert.ok(row.seconds >= li.FLOOR_SECONDS, `curve rung ${row.seconds}s is below the ${li.FLOOR_SECONDS}s floor`);
  }
  // And the whole curve, driven with absurd depths.
  for (const absurd of [NaN, Infinity, -Infinity, -1, null, undefined, 'soon', {}, []]) {
    assert.ok(li.intervalForDepth(absurd).seconds >= li.FLOOR_SECONDS,
      `depth ${String(absurd)} produced an interval under the floor`);
  }
});

test('absurd depth reads as 0 and therefore as the LONGEST interval, not the shortest', () => {
  // Infinity is the interesting one: it reads like "infinitely deep, wake
  // often" and is in fact garbage. Garbage must take the cheap direction.
  assert.equal(li.intervalForDepth(Infinity).seconds, 3600);
  assert.equal(li.intervalForDepth(NaN).seconds, 3600);
  assert.equal(li.intervalForDepth(-5).seconds, 3600);
  assert.match(li.intervalForDepth('soon').reason, /not a number of tickets/);
});

// ---------------------------------------------------------------------------
// The fallback (acceptance criterion 3)
// ---------------------------------------------------------------------------

test('an unreadable queue answers with the CONFIGURED fallback and says why', () => {
  const d = li.fallbackInterval({ fallbackSeconds: 3600, why: 'ClickUp returned HTTP 502' });
  assert.equal(d.seconds, 3600);
  assert.match(d.reason, /could not be read/);
  assert.match(d.reason, /HTTP 502/);
});

test('BREAK-TEST THE FALLBACK DIRECTION: an unreadable queue must not answer with the floor', () => {
  // This is the assertion that fails if someone "simplifies" the fallback to
  // FLOOR_SECONDS. A short interval on unknown state is exactly how quota
  // gets burned invisibly — the failure mode is silent, so the test is the
  // only thing watching.
  const d = li.fallbackInterval({ fallbackSeconds: 3600, why: 'network down' });
  assert.notEqual(d.seconds, li.FLOOR_SECONDS,
    'the fallback must be the configured interval (3600), never the 900s floor');
  assert.equal(d.seconds, li.DEFAULT_FALLBACK_SECONDS);
  // ...and it must not sneak below the floor either, if a human configured
  // something silly.
  const silly = li.fallbackInterval({ fallbackSeconds: 120, why: 'network down' });
  assert.equal(silly.seconds, 900);
  assert.match(silly.reason, /raised to the 900s floor/);
  assert.doesNotMatch(silly.reason, /NOT the floor/, "saying \"not the floor\" while reporting a raise TO the floor is a contradiction");
});

test('a failed read is not a reading: it leaves the hysteresis state untouched', () => {
  // Otherwise two consecutive outages would count as "two consecutive
  // readings" and could shorten the interval on no evidence at all.
  assert.equal(li.fallbackInterval({ fallbackSeconds: 3600, why: 'x' }).state, null);
});

// ---------------------------------------------------------------------------
// Hysteresis (acceptance criterion 4)
// ---------------------------------------------------------------------------

test('BREAK-TEST HYSTERESIS: ONE deep reading does not shorten the interval', () => {
  // A burst of 12 tickets arrives. The queue may be drained again before the
  // loop even wakes, so one reading must not flip the cadence for the night.
  const first = li.decideInterval({ depth: 12, state: null, fallbackSeconds: 3600 });
  assert.equal(first.seconds, 3600, 'a single deep reading shortened the interval — hysteresis is gone');
  assert.equal(first.held, true);
  assert.match(first.reason, /one reading does not \(two consecutive do\)/);
  // It must, however, REMEMBER the reading, or the second one can never fire.
  assert.equal(first.state.lastProposed, 900);
  assert.equal(first.state.interval, 3600);
});

test('TWO consecutive deep readings do shorten it', () => {
  const first = li.decideInterval({ depth: 12, state: null, fallbackSeconds: 3600 });
  const second = li.decideInterval({ depth: 12, state: first.state, fallbackSeconds: 3600 });
  assert.equal(second.seconds, 900);
  assert.equal(second.held, false);
  assert.match(second.reason, /second consecutive short reading/);
});

test('a burst followed by an empty queue leaves the cadence where it was', () => {
  const burst = li.decideInterval({ depth: 12, state: null, fallbackSeconds: 3600 });
  const quiet = li.decideInterval({ depth: 0, state: burst.state, fallbackSeconds: 3600 });
  assert.equal(quiet.seconds, 3600, 'the burst leaked through into the cadence');
});

test('shortening adopts the LATEST reading, not the more excited older one', () => {
  // 12 claimable then 2 claimable: both want shorter than the hour, so the
  // cadence moves — but to 1800, the fresher truth, not to 900.
  const first = li.decideInterval({ depth: 12, state: null, fallbackSeconds: 3600 });
  const second = li.decideInterval({ depth: 2, state: first.state, fallbackSeconds: 3600 });
  assert.equal(second.seconds, 1800);
});

test('LENGTHENING IS IMMEDIATE — erring toward less spend never waits', () => {
  const fast = { interval: 900, lastProposed: 900 };
  const now = li.decideInterval({ depth: 0, state: fast, fallbackSeconds: 3600 });
  assert.equal(now.seconds, 3600);
  assert.equal(now.held, false);
  // One rung is a lengthening too.
  assert.equal(li.decideInterval({ depth: 2, state: fast, fallbackSeconds: 3600 }).seconds, 1800);
});

test('a steady queue is stable — the interval does not oscillate', () => {
  let state = null;
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    const d = li.decideInterval({ depth: 12, state, fallbackSeconds: 3600 });
    seen.push(d.seconds);
    state = d.state;
  }
  assert.deepEqual(seen, [3600, 900, 900, 900, 900]);
});

test('a corrupt or hand-edited state file cannot push the interval below the floor', () => {
  const d = li.decideInterval({ depth: 12, state: { interval: 60, lastProposed: 60 }, fallbackSeconds: 3600 });
  assert.ok(d.seconds >= li.FLOOR_SECONDS, 'a doctored state file got under the floor');
});

test('with no state, the cadence in force is the runner argument, not the proposal', () => {
  // The first pass must follow the SAME rule as every later pass rather than
  // skipping the guard exactly when nothing is known yet.
  const d = li.decideInterval({ depth: 99, state: null, fallbackSeconds: 1800 });
  assert.equal(d.seconds, 1800);
});

// ---------------------------------------------------------------------------
// "Claimable", not "queued" (acceptance criterion 5)
// ---------------------------------------------------------------------------

// A fixture standing in for the Loop Queue. `resolveRepo` is injected, so no
// test here touches the filesystem or asks which repos this machine has.
const fakeRepo = (tags) => {
  const names = (tags || []).map((t) => String(t.name || t));
  const repo = names.find((n) => n.startsWith('repo:'));
  if (!repo) return { repo: 'starcaster', action: 'build', reason: 'no repo: tag' };
  const name = repo.slice('repo:'.length);
  if (name === 'starcaster') return { repo: name, action: 'build', reason: 'declared' };
  return { repo: name, action: 'escalate', reason: `repo:${name} is not checked out on this machine` };
};

const QUEUE = [
  { id: 'a1', status: { status: 'Queued', type: 'custom' }, tags: [] },
  { id: 'a2', status: { status: 'queued', type: 'custom' }, tags: [{ name: 'repo:starcaster' }] },
  // Wrong repo — real work, but not work THIS loop could claim.
  { id: 'a3', status: { status: 'Queued', type: 'custom' }, tags: [{ name: 'repo:normie' }] },
  // Blocked: waiting on a1, which is still open.
  { id: 'a4', status: { status: 'Queued', type: 'custom' }, tags: [], dependencies: [{ task_id: 'a4', depends_on: 'a1' }] },
  // Blocked by something outside this list — unknowable, so treated as blocking.
  { id: 'a5', status: { status: 'Queued', type: 'custom' }, tags: [], dependencies: [{ task_id: 'a5', depends_on: 'zz' }] },
  // Waiting on a DONE task: claimable.
  { id: 'a6', status: { status: 'Queued', type: 'custom' }, tags: [], dependencies: [{ task_id: 'a6', depends_on: 'd1' }] },
  { id: 'd1', status: { status: 'Live', type: 'closed' }, tags: [] },
  // The mirror edge: a7 BLOCKS a1. That must not make a7 look blocked.
  { id: 'a7', status: { status: 'Queued', type: 'custom' }, tags: [], dependencies: [{ task_id: 'a1', depends_on: 'a7' }] },
  // Other statuses are not this loop's work.
  { id: 'b1', status: { status: 'Building', type: 'custom' }, tags: [] },
  { id: 'b2', status: { status: 'In review', type: 'custom' }, tags: [] },
];

test('"claimable" counts only what loop-build could actually take', () => {
  const r = li.claimableDepth({ loop: 'loop-build', tasks: QUEUE, capReached: false, resolveRepo: fakeRepo });
  assert.deepEqual(r.claimable.map((t) => t.id).sort(), ['a1', 'a2', 'a6', 'a7']);
  assert.equal(r.depth, 4);
});

test('the wrong-repo and blocked exclusions are REPORTED, not silently dropped', () => {
  // A sweep that cannot say what it skipped gives a false all-clear
  // (DOCTRINE 3.11). Here the cost of silence is a cadence nobody can explain.
  const r = li.claimableDepth({ loop: 'loop-build', tasks: QUEUE, capReached: false, resolveRepo: fakeRepo });
  const byId = Object.fromEntries(r.excluded.map((x) => [x.id, x.why]));
  assert.match(byId.a3, /repo escalates/);
  assert.match(byId.a4, /waiting on a1/);
  assert.match(byId.a5, /not in this list/);
  // ...and tickets that were never candidates are not reported as exclusions.
  assert.ok(!('b1' in byId));
});

test('BREAK-TEST: a queue of ONLY wrong-repo tickets is depth 0, not depth 3', () => {
  // The whole point of "claimable, not queued". If this ever regresses, the
  // loop wakes every 15 minutes forever for work it can never take.
  const foreign = [
    { id: 'n1', status: { status: 'Queued' }, tags: [{ name: 'repo:normie' }] },
    { id: 'n2', status: { status: 'Queued' }, tags: [{ name: 'repo:pulse' }] },
    { id: 'n3', status: { status: 'Queued' }, tags: [{ name: 'repo:vault' }] },
  ];
  const r = li.claimableDepth({ loop: 'loop-build', tasks: foreign, capReached: false, resolveRepo: fakeRepo });
  assert.equal(r.depth, 0);
  assert.equal(li.intervalForDepth(r.depth).seconds, 3600);
});

test('BREAK-TEST: a full WIP cap makes the queue depth 0 however deep it is', () => {
  const r = li.claimableDepth({ loop: 'loop-build', tasks: QUEUE, capReached: true, resolveRepo: fakeRepo });
  assert.equal(r.depth, 0, 'a capped loop claims nothing, so a deep queue is not a reason to wake sooner');
  assert.match(r.note, /work-in-progress cap is full/);
  assert.equal(li.intervalForDepth(r.depth).seconds, 3600);
});

test('the WIP cap does NOT throttle loop-review — that would deadlock the pipeline', () => {
  // The cap is waiting on exactly the PRs review drains. Pausing review
  // because the cap is full would make the cap permanent.
  const r = li.claimableDepth({ loop: 'loop-review', tasks: QUEUE, capReached: true, resolveRepo: fakeRepo });
  assert.equal(r.depth, 1);
  assert.deepEqual(r.claimable.map((t) => t.id), ['b2']);
});

test('loop-review is paced on "In review" depth, loop-build on "Queued"', () => {
  const build = li.claimableDepth({ loop: 'loop-build', tasks: QUEUE, resolveRepo: fakeRepo });
  const review = li.claimableDepth({ loop: 'loop-review', tasks: QUEUE, resolveRepo: fakeRepo });
  assert.equal(build.depth, 4);
  assert.equal(review.depth, 1);
});

test('an unknown loop name throws rather than guessing a status', () => {
  assert.throws(
    () => li.claimableDepth({ loop: 'loop-deploy', tasks: QUEUE }),
    /unknown loop "loop-deploy"/,
  );
});

test('a list of junk does not crash and reads as empty', () => {
  const r = li.claimableDepth({ loop: 'loop-build', tasks: [null, 7, 'x', {}], resolveRepo: fakeRepo });
  assert.equal(r.depth, 0);
});

// ---------------------------------------------------------------------------
// The runner must survive the command failing (acceptance criterion 6)
// ---------------------------------------------------------------------------

test('every answer this module gives is a plain positive integer of seconds', () => {
  // The runner validates with ^[0-9]+$ and falls back if it does not match.
  // This checks the producing end: no floats, no strings, no NaN.
  const answers = [
    li.intervalForDepth(0), li.intervalForDepth(7), li.intervalForDepth('x'),
    li.decideInterval({ depth: 4, state: null, fallbackSeconds: 3600 }),
    li.fallbackInterval({ fallbackSeconds: 3600, why: 'x' }),
  ];
  for (const a of answers) {
    assert.ok(Number.isInteger(a.seconds) && a.seconds > 0, `not a positive integer: ${a.seconds}`);
    assert.match(String(a.seconds), /^[0-9]+$/);
    assert.ok(String(a.reason).length > 0, 'an answer with no reason');
  }
});
