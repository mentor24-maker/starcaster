'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyChecks, waitForChecks } = require('./waitForChecks');

/**
 * The bug this guards (PRs #356/#358, 2026-08-20): ship reached CI seconds
 * after a push, GitHub had no checks yet, and an empty list was read as
 * "failed". The one property that has to hold forever: an ABSENT check is never
 * a failure — only a check that actually reports one is.
 */

// A fake clock + queue so the whole thing is deterministic and instant: each
// sleep advances "now" by the poll interval, and queryChecks returns the next
// scripted list.
function harness(script, { appearGraceMs = 3 * 60 * 1000, totalBudgetMs = 20 * 60 * 1000, pollIntervalMs = 20 * 1000 } = {}) {
  let clock = 0;
  let i = 0;
  const polled = [];
  const outcome = waitForChecks({
    appearGraceMs,
    totalBudgetMs,
    pollIntervalMs,
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
