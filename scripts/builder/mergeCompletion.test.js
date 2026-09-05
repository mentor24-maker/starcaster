'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyMergeState, mergedAtOf, mergeTimeLabel, waitForMerge } = require('./mergeCompletion');

/**
 * The bug this guards (task 86bbv35cq): `gh pr merge` exiting 0 does not mean
 * the pull request merged. Under a merge queue it ENQUEUES and returns success
 * at once, leaving the PR OPEN. The relay read that as a merge, stamped a
 * fabricated merge time, moved the ticket to Live and announced it on the bus;
 * ship read it as a failure and stopped on every run.
 *
 * The one property that has to hold forever: NOBODY RECORDS A MERGE THEY HAVE
 * NOT OBSERVED — and "enqueued" is a third answer, neither success nor failure.
 */

// A fake clock + scripted reads, so the whole thing is deterministic and
// instant: each sleep advances "now" by the poll interval, and readPr returns
// the next scripted payload (the last one repeats forever).
function harness(script, { timeoutMs = 15 * 60 * 1000, pollIntervalMs = 15 * 1000 } = {}) {
  let clock = 0;
  let i = 0;
  const seen = [];
  const result = waitForMerge({
    timeoutMs,
    pollIntervalMs,
    now: () => clock,
    sleep: (ms) => { clock += ms; },
    readPr: () => {
      const next = i < script.length ? script[i] : script[script.length - 1];
      i += 1;
      if (next === 'throw') throw new Error('gh blew up');
      return next;
    },
    onPoll: (state) => seen.push(state),
  });
  return { ...result, seen, elapsed: clock };
}

const OPEN = { state: 'OPEN', mergedAt: null };
const MERGED = { state: 'MERGED', mergedAt: '2026-09-05T12:00:00Z' };
const CLOSED = { state: 'CLOSED', mergedAt: null };

/* ------------------------------------------------------- classifyMergeState */

test('classifyMergeState reads the four states, and an unread PR is its own answer', () => {
  assert.equal(classifyMergeState(MERGED), 'merged');
  assert.equal(classifyMergeState(OPEN), 'open');
  assert.equal(classifyMergeState(CLOSED), 'closed');
  assert.equal(classifyMergeState({ state: 'merged' }), 'merged', 'case-insensitive');
  // The whole point: a read that did not happen is never one of the three.
  assert.equal(classifyMergeState(null), 'unreadable');
  assert.equal(classifyMergeState(undefined), 'unreadable');
  assert.equal(classifyMergeState({}), 'unreadable');
  assert.equal(classifyMergeState('MERGED'), 'unreadable', 'a string is not a payload');
});

/* ------------------------------------------------------------ the merge time */

test("mergedAt comes from GitHub, and is null rather than invented when absent", () => {
  assert.equal(mergedAtOf(MERGED), '2026-09-05T12:00:00Z');
  assert.equal(mergedAtOf({ state: 'MERGED' }), null);
  assert.equal(mergedAtOf({ state: 'MERGED', mergedAt: '  ' }), null);
  assert.equal(mergedAtOf(null), null);
  // A missing time says so rather than quietly acquiring today's date.
  assert.equal(mergeTimeLabel('2026-09-05T12:00:00Z'), '2026-09-05T12:00:00Z');
  assert.equal(mergeTimeLabel(null), 'a time GitHub did not report');
});

/* ------------------------------------------- today's shape: no queue at all */

test('with no merge queue the first read already says MERGED — no delay at all', () => {
  const r = harness([MERGED]);
  assert.equal(r.outcome, 'merged');
  assert.equal(r.mergedAt, '2026-09-05T12:00:00Z');
  assert.equal(r.polls, 1, 'exactly one read');
  assert.equal(r.elapsed, 0, 'it never slept — criterion 5, no extra delay today');
});

/* ------------------------------------------------- the queued shape, landing */

test('the queued shape — success, OPEN, OPEN, then MERGED — is observed as a merge', () => {
  const r = harness([OPEN, OPEN, MERGED]);
  assert.equal(r.outcome, 'merged');
  assert.equal(r.mergedAt, '2026-09-05T12:00:00Z');
  assert.equal(r.polls, 3);
  assert.deepEqual(r.seen, ['open', 'open', 'merged']);
});

/* ------------------------- THE DEFECT: enqueued must never read as a merge */

test('a PR that stays OPEN is QUEUED — never merged, and never a failure', () => {
  const r = harness([OPEN]);
  assert.equal(r.outcome, 'queued', 'the third answer');
  assert.notEqual(r.outcome, 'merged', 'the false success this ticket exists to remove');
  assert.equal(r.mergedAt, null, 'no merge time is invented for a merge that has not happened');
  assert.ok(r.polls > 1, 'it actually waited rather than answering on the first read');
});

test('a PR closed without merging is its own answer, and not a merge', () => {
  const r = harness([OPEN, CLOSED]);
  assert.equal(r.outcome, 'closed');
  assert.equal(r.mergedAt, null);
  assert.equal(r.polls, 2, 'terminal — it stops looking');
});

/* --------------------------------------------- a read that never happened */

test('reads that all come back blind are UNKNOWN, not queued and not merged', () => {
  const r = harness([null]);
  assert.equal(r.outcome, 'unknown');
  assert.ok(r.failedReads > 0);
  assert.equal(r.mergedAt, null);
});

test('a thrown read is a blind read, not a crash', () => {
  const r = harness(['throw']);
  assert.equal(r.outcome, 'unknown');
  assert.ok(r.failedReads > 0);
});

test('one clean OPEN outranks a blind final read — a known-queued PR stays queued', () => {
  // OPEN once, then the reads go blind (a rate limit) for the rest of the
  // budget. It IS queued; a throttled last poll must not downgrade that to
  // "nobody looked".
  const r = harness([OPEN, null]);
  assert.equal(r.outcome, 'queued');
  assert.ok(r.failedReads > 0, 'and it still reports how many reads came back blind');
});

test('a blind read mid-wait does not stop the wait, and the merge is still seen', () => {
  const r = harness([OPEN, null, null, MERGED]);
  assert.equal(r.outcome, 'merged');
  assert.equal(r.failedReads, 2);
});

/* ------------------------------------------------------------ the contract */

test('waitForMerge refuses to run without its injected clock and IO', () => {
  assert.throws(() => waitForMerge({ sleep: () => {}, now: () => 0 }), /readPr/);
  assert.throws(() => waitForMerge({ readPr: () => null, now: () => 0 }), /sleep/);
  assert.throws(() => waitForMerge({ readPr: () => null, sleep: () => {} }), /now/);
});

/* ------------------------------------------------- both callers, at source */

/**
 * Source-level, for the reason `shipThread.test.js` gives about the force-push
 * property: driving either caller for real needs a remote, a pull request, CI
 * and a merge queue, so the property would go untested in practice — and an
 * untested property is how it came back.
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const shipCode = withoutComments(fs.readFileSync(path.join(__dirname, '..', 'ship_thread.cjs'), 'utf8'));
const relayCode = withoutComments(fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8'));

test('both callers ask the SAME shared function whether the merge happened', () => {
  assert.match(shipCode, /require\(['"]\.\/builder\/mergeCompletion['"]\)/, 'ship imports mergeCompletion');
  assert.match(shipCode, /waitForMerge\(/, 'ship calls waitForMerge');
  assert.match(relayCode, /from '\.\/builder\/mergeCompletion\.js'/, 'the relay imports mergeCompletion');
  assert.match(relayCode, /mergeCompletion\.waitForMerge\(/, 'the relay calls waitForMerge');
});

test('ship no longer calls a bare `gh pr view --json state` a merge verdict', () => {
  // The old line — one read, one instant after the merge command — is what
  // would fail every single run under a queue.
  assert.doesNotMatch(
    shipCode,
    /--jq['"],\s*['"]\.state/,
    'the single-shot state read is gone; the merge verdict comes from waitForMerge'
  );
});

test('the relay never stamps its own clock as the merge time', () => {
  // Criterion 4. `new Date()` at the moment gh returned is wrong by seconds
  // today and by however long a queue takes tomorrow — and it is written on
  // the ticket as fact.
  const mergeStep = relayCode.slice(relayCode.indexOf('async function runMergeStep'));
  assert.doesNotMatch(
    mergeStep,
    /const mergedAt = new Date\(\)/,
    'mergedAt comes off the PR, never from new Date()'
  );
  assert.match(mergeStep, /mergeCompletion\.mergedAtOf\(prJson\)/, 'the already-merged path reads GitHub\'s time');
  assert.match(mergeStep, /mergeCompletion\.mergeTimeLabel\(observed\.mergedAt\)/, 'the merge path reads GitHub\'s time');
});

test('the relay asks GitHub for mergedAt, or it could not have it', () => {
  assert.match(relayCode, /const fields = 'number,state,mergedAt,/, "`mergedAt` is in the gh pr view field list");
});

test('the relay does no merge bookkeeping unless the merge was observed', () => {
  const mergeStep = relayCode.slice(relayCode.indexOf('async function runMergeStep'));
  const wait = mergeStep.indexOf('mergeCompletion.waitForMerge(');
  assert.ok(wait > 0, 'the wait exists');
  const guard = mergeStep.indexOf("observed.outcome !== 'merged'", wait);
  assert.ok(guard > wait, 'and it is guarded on the observed outcome');
  // Every irreversible-looking record must come AFTER that guard.
  for (const marker of ['const mergedAt =', 'mergedNotice({', 'recordMergedTicket(mergedRecord']) {
    const at = mergeStep.indexOf(marker, wait);
    assert.ok(at > guard, `"${marker}" happens only after the merge is observed`);
  }
});

test('merge-not-observed is its own outcome, counted apart from merged and waiting', () => {
  assert.match(relayCode, /outcome: 'merge-not-observed'/, 'the merge step returns it');
  assert.match(relayCode, /m\.outcome === 'merge-not-observed'\) merges\.notObserved\+\+/, 'and it has its own tally');
  assert.doesNotMatch(
    relayCode,
    /m\.outcome === 'merged' \|\| m\.outcome === 'merge-not-observed'/,
    'it is never counted as a merge'
  );
});
