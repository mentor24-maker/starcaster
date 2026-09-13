'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyChecks, classifyMergeable, isWorkflowCheck, waitForChecks } = require('./waitForChecks');

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
  conflictingConfirmations,
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
    conflictingConfirmations,
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

// Fixtures carry `workflow`, because the real rows do and because
// classifyChecks now reads it to tell this repository's CI runs from the rows
// Vercel posts on every pull request. A row with an empty `workflow` is a
// third-party status; one naming a workflow is ours. Measured shapes are in
// the isWorkflowCheck docblock.
const pass = [{ bucket: 'pass', workflow: 'CI' }];
const pending = [{ bucket: 'pending', workflow: 'CI' }];
const fail = [{ bucket: 'fail', workflow: 'CI' }];
const none = [];

// What a pull request in THIS repository looks like while GitHub has run
// nothing: not empty at all. This is the #630 board, and the list that used to
// read as 'passed'.
const vercelOnly = [
  { bucket: 'pass', name: 'Vercel Preview Comments', workflow: '' },
  { bucket: 'pass', name: 'Vercel', workflow: '' },
];

test('classifyChecks: empty list is "none", never a failure', () => {
  assert.equal(classifyChecks([]), 'none');
  assert.equal(classifyChecks(null), 'none');
  assert.equal(classifyChecks(undefined), 'none');
});

test('classifyChecks: a failure outranks a pending — no point waiting for the rest', () => {
  assert.equal(classifyChecks([{ bucket: 'pending', workflow: 'CI' }, { bucket: 'fail', workflow: 'CI' }]), 'failed');
  assert.equal(classifyChecks([{ bucket: 'cancel', workflow: 'CI' }, { bucket: 'pass', workflow: 'CI' }]), 'failed');
});

test('classifyChecks: pending outranks passed', () => {
  assert.equal(classifyChecks([{ bucket: 'pass', workflow: 'CI' }, { bucket: 'pending', workflow: 'CI' }]), 'pending');
});

test('classifyChecks: all pass (or skip) is "passed"', () => {
  assert.equal(classifyChecks([{ bucket: 'pass', workflow: 'CI' }, { bucket: 'skipping', workflow: 'review-gate' }]), 'passed');
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

test('THE #630 PATH: no checks + a conflicting head → blocked_conflicting, as soon as it is confirmed', () => {
  const { outcome, polls } = harness([none], {
    appearGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => conflicting,
  });
  assert.equal(outcome.outcome, 'blocked_conflicting');
  // Two polls, not one: GitHub's mergeability is cached, so a lone reading can
  // describe the branch as it was before the last push. It still stops long
  // before the grace window, which is the behaviour that matters.
  assert.equal(polls, 2, 'it confirms, then stops — rather than waiting out a window that cannot end well');
  assert.deepEqual(outcome.mergeable, conflicting, 'the reading rides along so the caller can name the remedy');
});

test('A SINGLE conflicting reading is not a verdict — the stale-cache false stop', () => {
  // The costly case is the RECOVERY. You merge origin/main in to fix a
  // conflicting head and push; ship polls a second later; GitHub answers out
  // of its cache with the pre-push CONFLICTING. Acting on that one reading
  // stops ship to advise the catch-up merge that just happened.
  const readings = [conflicting, clean, clean];
  let i = 0;
  const { outcome } = harness([none, none, pass], {
    appearGraceMs: 10 * 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => readings[Math.min(i++, readings.length - 1)],
  });
  assert.equal(outcome.outcome, 'passed', 'one stale reading must not abandon a pull request that is fine');
});

test('confirmation means CONSECUTIVE — a clean reading in between resets the count', () => {
  // Otherwise two conflicting answers half an hour apart, with a clean one
  // between them, would add up to a verdict neither of them supports.
  const readings = [conflicting, clean, conflicting, clean, clean];
  let i = 0;
  const { outcome } = harness([none, none, none, none, pass], {
    appearGraceMs: 10 * 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => readings[Math.min(i++, readings.length - 1)],
  });
  assert.equal(outcome.outcome, 'passed');
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
  // The conflict is confirmed at the second poll, still inside the grace
  // window, so the nudge is never reached.
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
  const readings = [notYetKnown, notYetKnown, conflicting, conflicting];
  let i = 0;
  const { outcome, polls } = harness([none], {
    appearGraceMs: 10 * 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => readings[Math.min(i++, readings.length - 1)],
  });
  assert.equal(outcome.outcome, 'blocked_conflicting');
  assert.equal(polls, 4, 'it waited through the two UNKNOWN readings rather than giving up');
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

/* ---------------------------------------------------------------------------
 * ROUND 2: "no checks" means none of OURS.
 *
 * The guard above shipped unreachable. It waited for an empty check list, and
 * a pull request in this repository is never empty — Vercel posts rows on
 * every one — so on the very incident it was written for it classified four
 * rows of nothing-happened as `passed` and probed zero times.
 * ------------------------------------------------------------------------- */

test('isWorkflowCheck: a run belongs to a workflow, a third-party status does not', () => {
  assert.equal(isWorkflowCheck({ name: 'verify', workflow: 'CI' }), true);
  assert.equal(isWorkflowCheck({ name: 'review-gate', workflow: 'review-gate' }), true);
  assert.equal(isWorkflowCheck({ name: 'Vercel', workflow: '' }), false);
  assert.equal(isWorkflowCheck({ name: 'Vercel Preview Comments', workflow: '   ' }), false);
  assert.equal(isWorkflowCheck({ name: 'Vercel' }), false);
  assert.equal(isWorkflowCheck(null), false);
});

test('THE ROUND-2 DEFECT: a board of nothing but Vercel rows is "none", not "passed"', () => {
  // The exact rollup from PR #630, replayed. This returning 'passed' is what
  // made the conflicting-head guard unreachable AND let ship walk into the
  // merge step with no CI green at all.
  assert.equal(classifyChecks(vercelOnly), 'none');
});

test('a third-party row does not make a half-finished board look finished', () => {
  // Vercel green + our CI still running is 'pending', not 'passed'.
  assert.equal(classifyChecks([...vercelOnly, { bucket: 'pending', workflow: 'CI' }]), 'pending');
  // And our CI green alongside them is a real pass.
  assert.equal(
    classifyChecks([...vercelOnly, { bucket: 'pass', workflow: 'CI' }, { bucket: 'pass', workflow: 'review-gate' }]),
    'passed'
  );
});

test('once OUR checks exist, a failure anywhere still outranks — including a third-party one', () => {
  // The conservative half, deliberately unchanged: a failed Vercel deployment
  // has always stopped ship, and a missing-checks fix does not get to quietly
  // start merging failed deployments.
  assert.equal(
    classifyChecks([{ bucket: 'fail', name: 'Vercel', workflow: '' }, { bucket: 'pass', workflow: 'CI' }]),
    'failed'
  );
});

test('with NO checks of ours, absence outranks a third-party failure', () => {
  // "Our CI has not run" is the truer statement about that pull request, and
  // it is the state that lets the conflicting-head probe ask why. Neither
  // answer merges anything, so preferring the diagnostic one costs nothing.
  assert.equal(classifyChecks([{ bucket: 'fail', name: 'Vercel', workflow: '' }]), 'none');
});

test('check rows with no `workflow` field at all THROW — a cannot-tell is not a verdict', () => {
  // Only reachable by editing the `--json` list in ship_thread.cjs. Reporting
  // 'none' there would tell ship that a fully green pull request has no checks
  // — this round's defect, in the other direction and just as silent.
  assert.throws(
    () => classifyChecks([{ bucket: 'pass' }, { bucket: 'pass' }]),
    /workflow/,
    'it must refuse to classify rows it cannot classify'
  );
  // An empty list is still an honest 'none' — there is nothing to misread.
  assert.equal(classifyChecks([]), 'none');
});

test('THE #630 PATH END TO END: Vercel rows + a conflicting head → blocked_conflicting', () => {
  // The whole point of the round. Before this fix these exact inputs returned
  // outcome 'passed' with zero probes, and ship went on to try to merge a pull
  // request with no CI green.
  let probes = 0;
  const { outcome } = harness([vercelOnly], {
    appearGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    queryMergeable: () => { probes += 1; return conflicting; },
  });
  assert.equal(outcome.outcome, 'blocked_conflicting');
  assert.equal(probes, 2, 'the probe runs and confirms, on a board that used to read as green');
  assert.deepEqual(outcome.mergeable, conflicting);
});

test('Vercel rows and a MERGEABLE head → the other cause, so it nudges', () => {
  // The same board with the opposite reading gets the opposite remedy.
  let nudges = 0;
  const { outcome } = harness([vercelOnly], {
    appearGraceMs: 60 * 1000,
    pollIntervalMs: 20 * 1000,
    nudge: () => { nudges += 1; return true; },
    queryMergeable: () => clean,
  });
  assert.equal(nudges, 1, 'a checkless-but-mergeable PR still gets its nudge commit');
  assert.equal(outcome.outcome, 'never_appeared');
  assert.equal(outcome.nudged, true);
});

test('Vercel rows, then our CI appears and passes → passed, and it never nudged', () => {
  const ciGreen = [...vercelOnly, { bucket: 'pass', workflow: 'CI' }, { bucket: 'pass', workflow: 'review-gate' }];
  let nudges = 0;
  const { outcome } = harness([vercelOnly, vercelOnly, ciGreen], {
    appearGraceMs: 10 * 60 * 1000,
    pollIntervalMs: 20 * 1000,
    nudge: () => { nudges += 1; return true; },
    queryMergeable: () => clean,
  });
  assert.equal(outcome.outcome, 'passed');
  assert.equal(nudges, 0, 'the checks arrived on their own — nothing to nudge');
});
