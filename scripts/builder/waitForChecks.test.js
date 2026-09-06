'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyChecks, classifyMergeable, waitForChecks } = require('./waitForChecks');

/**
 * The bug this guards (PRs #356/#358, 2026-08-20): ship reached CI seconds
 * after a push, GitHub had no checks yet, and an empty list was read as
 * "failed". The one property that has to hold forever: an ABSENT check is never
 * a failure — only a check that actually reports one is.
 */

// A fake clock + queue so the whole thing is deterministic and instant: each
// sleep advances "now" by the poll interval, and queryChecks returns the next
// scripted list.
function harness(script, {
  appearGraceMs = 3 * 60 * 1000,
  totalBudgetMs = 20 * 60 * 1000,
  pollIntervalMs = 20 * 1000,
  nudge,
  nudgeGraceMs,
  queryMergeable,
} = {}) {
  let clock = 0;
  let i = 0;
  const polled = [];
  const outcome = waitForChecks({
    appearGraceMs,
    totalBudgetMs,
    pollIntervalMs,
    nudge,
    nudgeGraceMs,
    queryMergeable,
    now: () => clock,
    sleep: (ms) => { clock += ms; },
    queryChecks: () => {
      // Hold on the last scripted value once the script runs out.
      const list = i < script.length ? script[i] : script[script.length - 1];
      i += 1;
      return list;
    },
    onPoll: (state) => polled.push(state),
  });
  return { outcome, polls: i, states: polled };
}

const pass = [{ bucket: 'pass' }];
const pending = [{ bucket: 'pending' }];
const fail = [{ bucket: 'fail' }];
const none = [];

test('classifyChecks: empty list is "none", never a failure', () => {
  assert.equal(classifyChecks([]), 'none');
  assert.equal(classifyChecks(null), 'none');
  assert.equal(classifyChecks(undefined), 'none');
});

test('classifyChecks: a failure outranks a pending — no point waiting for the rest', () => {
  assert.equal(classifyChecks([{ bucket: 'pending' }, { bucket: 'fail' }]), 'failed');
  assert.equal(classifyChecks([{ bucket: 'cancel' }, { bucket: 'pass' }]), 'failed');
});

test('classifyChecks: pending outranks passed', () => {
  assert.equal(classifyChecks([{ bucket: 'pass' }, { bucket: 'pending' }]), 'pending');
});

test('classifyChecks: all pass (or skip) is "passed"', () => {
  assert.equal(classifyChecks([{ bucket: 'pass' }, { bucket: 'skipping' }]), 'passed');
});

test('THE ACCEPTANCE PATH: no checks, no checks, then passing → proceeds (passed)', () => {
  const { outcome, states } = harness([none, none, pass]);
  assert.equal(outcome.outcome, 'passed');
  // It genuinely waited through the two empty polls rather than stopping.
  assert.deepEqual(states, ['none', 'none', 'passed']);
});

test('checks appear pending, then pass → passed', () => {
  const { outcome } = harness([none, pending, pending, pass]);
  assert.equal(outcome.outcome, 'passed');
});

test('a real failure stops immediately, even on the first poll', () => {
  const { outcome, polls } = harness([fail]);
  assert.equal(outcome.outcome, 'failed');
  assert.equal(polls, 1);
});

test('checks never appear → "never_appeared", not "failed", and it stops at the grace window', () => {
  // grace 60s, poll 20s: none at 0s, 20s, 40s, then 60s hits the grace ceiling.
  const { outcome } = harness([none], { appearGraceMs: 60 * 1000, pollIntervalMs: 20 * 1000 });
  assert.equal(outcome.outcome, 'never_appeared');
});

test('checks appear but never finish → "timed_out_pending", NOT "never_appeared"', () => {
  // Once a check has appeared, absence of a verdict is a timeout of the running
  // checks — a distinct, honest message — never "they never showed up".
  const { outcome } = harness([pending], { totalBudgetMs: 100 * 1000, pollIntervalMs: 20 * 1000 });
  assert.equal(outcome.outcome, 'timed_out_pending');
});

test('a check that appears within the grace window is honored, not cut short', () => {
  // grace 60s, poll 20s: none at 0s and 20s, then a passing check at 40s —
  // inside the window, so the outcome is driven by the check.
  const { outcome } = harness(
    [none, none, pass],
    { appearGraceMs: 60 * 1000, totalBudgetMs: 20 * 60 * 1000, pollIntervalMs: 20 * 1000 },
  );
  assert.equal(outcome.outcome, 'passed');
});

test('it validates its injected dependencies rather than failing obscurely later', () => {
  assert.throws(() => waitForChecks({ sleep() {}, now() { return 0; } }), /queryChecks/);
  assert.throws(() => waitForChecks({ queryChecks() {}, now() { return 0; } }), /sleep/);
  assert.throws(() => waitForChecks({ queryChecks() {}, sleep() {} }), /now/);
});

/**
 * THE 2026-08-23 BUG (PRs #387 and #389): a second push landing ~15s after
 * `gh pr create` left the PR with no runs at all — not the `opened` one, not
 * the push's own. Nothing arrives later on its own, so "wait a bit longer" and
 * "run ship again" are both wrong advice: only a NEW push makes GitHub create
 * a run. These tests pin the recovery.
 */

test('checks never appear → it nudges ONCE, and a run that then shows up is honored', () => {
  let nudges = 0;
  // grace 60s, poll 20s: none at 0/20/40s, the 60s poll spends the grace and
  // nudges; the next poll finds the run the nudge created.
  const { outcome } = harness(
    [none, none, none, none, pass],
    { appearGraceMs: 60 * 1000, pollIntervalMs: 20 * 1000, nudge: () => { nudges += 1; return true; } },
  );
  assert.equal(outcome.outcome, 'passed');
  assert.equal(outcome.nudged, true);
  assert.equal(nudges, 1, 'exactly one nudge — a push per poll would spam the branch');
});

test('nudged and STILL no run → never_appeared, and it says the push was made', () => {
  let nudges = 0;
  const { outcome } = harness([none], {
    appearGraceMs: 60 * 1000,
    nudgeGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    nudge: () => { nudges += 1; return true; },
  });
  assert.equal(outcome.outcome, 'never_appeared');
  assert.equal(outcome.nudged, true);
  assert.equal(nudges, 1, 'it does not keep pushing once the extra window is spent either');
});

test('no nudge available → the old behaviour, unchanged', () => {
  const { outcome } = harness([none], { appearGraceMs: 60 * 1000, pollIntervalMs: 20 * 1000 });
  assert.equal(outcome.outcome, 'never_appeared');
  assert.equal(outcome.nudged, false);
});

test('a nudge that fails or throws stops right there — it never reads as success', () => {
  // EVERY falsy return, not just `false`. The contract is "return falsy (or
  // throw) if the push could not be made", and the check used to be
  // `nudge() !== false`, which honoured exactly one of those values. A nudge
  // written as an ordinary `function nudge() { ...; }` with no return statement
  // — the shape a future caller writes by accident — came back `undefined` and
  // was recorded as a SUCCESSFUL push, so ship would tell the operator to go
  // check whether Actions is enabled about a push that never happened.
  const failures = [
    () => false,
    () => undefined,
    () => { /* no return at all, which is the accident */ },
    () => null,
    () => 0,
    () => '',
    () => { throw new Error('push rejected'); },
  ];
  for (const nudge of failures) {
    const { outcome } = harness([none], { appearGraceMs: 60 * 1000, pollIntervalMs: 20 * 1000, nudge });
    assert.equal(outcome.outcome, 'never_appeared');
    assert.equal(outcome.nudged, false, 'a failed push must not be reported as nudged');
  }
});

test('a nudge that reports success IS recorded as a push', () => {
  // The other half of the boundary: tightening the falsy check must not make
  // every nudge read as a failure. A truthy return still counts.
  for (const nudge of [() => true, () => 'pushed', () => 1]) {
    const { outcome } = harness([none], {
      appearGraceMs: 60 * 1000,
      nudgeGraceMs: 60 * 1000,
      pollIntervalMs: 20 * 1000,
      nudge,
    });
    assert.equal(outcome.outcome, 'never_appeared');
    assert.equal(outcome.nudged, true, 'a push that WAS made must be reported as nudged');
  }
});

test('a check that appears on its own is never nudged for', () => {
  let nudges = 0;
  const { outcome } = harness([none, pass], {
    appearGraceMs: 60 * 1000, pollIntervalMs: 20 * 1000, nudge: () => { nudges += 1; return true; },
  });
  assert.equal(outcome.outcome, 'passed');
  assert.equal(nudges, 0);
  assert.equal(outcome.nudged, false);
});


/**
 * THE 2026-09-06 BUG (PR #630). Commits `8ef87761` and `47f0b6c0` were pushed
 * to an open, non-draft pull request eleven minutes apart and GitHub created no
 * workflow runs for either, while other pull requests in the same repo started
 * full runs in between them. `gh pr view 630 --json mergeable,mergeStateStatus`
 * said `CONFLICTING` / `DIRTY`; `git merge-tree --write-tree` said the merge was
 * clean. Both workflows here trigger on `pull_request`, which runs against the
 * merge ref, and GitHub builds no merge ref for a pull request it believes
 * conflicts — so it runs nothing, silently.
 *
 * The cost is not the missing check, it is the WRONG REMEDY: this code knew
 * only the other cause, so it burned its grace window, pushed a nudge commit
 * that could not help (the new head SHA does not merge either), burned a second
 * window, and told the operator to check whether Actions was enabled. These
 * tests pin the distinction.
 */

const conflicting = { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' };
const clean = { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
const notYetKnown = { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };

test('classifyMergeable: either field is enough to call it conflicting', () => {
  assert.equal(classifyMergeable(conflicting), 'conflicting');
  assert.equal(classifyMergeable({ mergeable: 'CONFLICTING' }), 'conflicting');
  assert.equal(classifyMergeable({ mergeStateStatus: 'DIRTY' }), 'conflicting');
  assert.equal(classifyMergeable('conflicting'), 'conflicting');
});

test('classifyMergeable: UNKNOWN is not conflicting — it is the normal state after a push', () => {
  // Treating GitHub's "still working it out" as a conflict would abandon the
  // wait on nearly every healthy pull request, which is a worse bug than the
  // one this guard fixes.
  assert.equal(classifyMergeable(notYetKnown), 'unknown');
  assert.equal(classifyMergeable(null), 'unknown');
  assert.equal(classifyMergeable(undefined), 'unknown');
  assert.equal(classifyMergeable({}), 'unknown');
  assert.equal(classifyMergeable(clean), 'mergeable');
});

test('THE #630 PATH: no checks + a conflicting head → blocked_conflicting, on the FIRST poll', () => {
  const { outcome, polls } = harness([none], {
    appearGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => conflicting,
  });
  assert.equal(outcome.outcome, 'blocked_conflicting');
  assert.equal(polls, 1, 'it stops at once rather than waiting out a window that cannot end well');
  assert.deepEqual(outcome.mergeable, conflicting, 'the reading rides along so the caller can name the remedy');
});

test('a conflicting head is never NUDGED — the nudge is the other cause\'s remedy', () => {
  // This is the whole point. An empty commit moves the head SHA, but the new
  // SHA does not merge either, so the push accomplishes nothing and costs a
  // second grace window plus a commit on the branch.
  let nudges = 0;
  const { outcome } = harness([none], {
    appearGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    nudge: () => { nudges += 1; return true; },
    queryMergeable: () => conflicting,
  });
  assert.equal(outcome.outcome, 'blocked_conflicting');
  assert.equal(nudges, 0, 'pushing an empty commit at a conflicting head is the wrong remedy');
  assert.equal(outcome.nudged, false);
});

test('a mergeable head with no checks still nudges — the old behaviour is untouched', () => {
  let nudges = 0;
  const { outcome } = harness([none, none, none, none, pass], {
    appearGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    nudge: () => { nudges += 1; return true; },
    queryMergeable: () => clean,
  });
  assert.equal(outcome.outcome, 'passed');
  assert.equal(nudges, 1);
});

test('UNKNOWN then CONFLICTING → it keeps asking, and catches the conflict when GitHub says so', () => {
  // GitHub computes mergeability lazily, so the first reading after a push is
  // routinely UNKNOWN. Reading it ONCE would miss every real conflict.
  const readings = [notYetKnown, notYetKnown, conflicting];
  let i = 0;
  const { outcome, polls } = harness([none], {
    appearGraceMs: 10 * 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => readings[Math.min(i++, readings.length - 1)],
  });
  assert.equal(outcome.outcome, 'blocked_conflicting');
  assert.equal(polls, 3, 'it waited through the two UNKNOWN readings rather than giving up');
});

test('a probe that throws or returns nothing is "cannot tell" — never a conflict, never a pass', () => {
  for (const queryMergeable of [() => { throw new Error('gh exploded'); }, () => null, () => undefined]) {
    const { outcome } = harness([none], {
      appearGraceMs: 60 * 1000, pollIntervalMs: 20 * 1000, queryMergeable,
    });
    assert.equal(outcome.outcome, 'never_appeared', 'an unreadable probe falls back to the old path');
    assert.equal(outcome.mergeable, null);
  }
});

test('the probe stops once a check exists — a conflict found later is the merge gate\'s business', () => {
  // Once checks are running, this function\'s job is to report their verdict.
  // A pull request that goes conflicting mid-run still has real checks with a
  // real result, and the merge gate refuses a DIRTY head on its own.
  let probes = 0;
  const { outcome } = harness([pending, pending, pass], {
    appearGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => { probes += 1; return conflicting; },
  });
  assert.equal(outcome.outcome, 'passed');
  assert.equal(probes, 0, 'no wasted GitHub call once the checks are real');
});

test('no queryMergeable at all → every previous outcome is byte-for-byte what it was', () => {
  // The guard is additive. A caller that does not pass the probe must behave
  // exactly as it did before this existed.
  assert.equal(harness([none], { appearGraceMs: 60 * 1000 }).outcome.outcome, 'never_appeared');
  assert.equal(harness([none, none, pass]).outcome.outcome, 'passed');
  assert.equal(harness([fail]).outcome.outcome, 'failed');
});
