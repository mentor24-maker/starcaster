'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyMergeState, classifyMergeHold, holdIsPending, holdLabel,
  mergedAtOf, mergeTimeLabel, waitForMerge,
  prObservationArgv, parsePrObservation, PR_OBSERVATION_QUERY,
} = require('./mergeCompletion');

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

// OPEN comes in three flavours now, and telling them apart IS the round-2 fix.
// ENQUEUED / AUTO are pull requests GitHub is holding and will still merge;
// UNHELD is a merge that was refused, which is what every OPEN reading on
// today's queue-less repo actually is.
const ENQUEUED = { state: 'OPEN', mergedAt: null, isInMergeQueue: true, autoMergeEnabled: false };
const AUTO = { state: 'OPEN', mergedAt: null, isInMergeQueue: false, autoMergeEnabled: true };
const UNHELD = { state: 'OPEN', mergedAt: null, isInMergeQueue: false, autoMergeEnabled: false };
// No hold fields at all — an older reader, or a payload that came back partial.
const OPEN_NO_HOLD = { state: 'OPEN', mergedAt: null };
const MERGED = { state: 'MERGED', mergedAt: '2026-09-05T12:00:00Z', isInMergeQueue: false, autoMergeEnabled: false };
const CLOSED = { state: 'CLOSED', mergedAt: null, isInMergeQueue: false, autoMergeEnabled: false };

/* ------------------------------------------------------- classifyMergeState */

test('classifyMergeState reads the four states, and an unread PR is its own answer', () => {
  assert.equal(classifyMergeState(MERGED), 'merged');
  assert.equal(classifyMergeState(UNHELD), 'open');
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
  const r = harness([ENQUEUED, ENQUEUED, MERGED]);
  assert.equal(r.outcome, 'merged');
  assert.equal(r.mergedAt, '2026-09-05T12:00:00Z');
  assert.equal(r.polls, 3);
  assert.deepEqual(r.seen, ['open', 'open', 'merged']);
});

/* ------------------------- THE DEFECT: enqueued must never read as a merge */

test('a PR GitHub is HOLDING and that stays open is QUEUED — never merged, never a failure', () => {
  const r = harness([ENQUEUED]);
  assert.equal(r.outcome, 'queued', 'the third answer');
  assert.notEqual(r.outcome, 'merged', 'the false success this ticket exists to remove');
  assert.equal(r.mergedAt, null, 'no merge time is invented for a merge that has not happened');
  assert.ok(r.polls > 1, 'it actually waited rather than answering on the first read');
});

test('a PR closed without merging is its own answer, and not a merge', () => {
  const r = harness([ENQUEUED, CLOSED]);
  assert.equal(r.outcome, 'closed');
  assert.equal(r.mergedAt, null);
  assert.equal(r.polls, 2, 'terminal — it stops looking');
});

/* ------------- ROUND 2: "still open" is not "enqueued" until something says so */

test('classifyMergeHold names what is holding the PR, and never guesses', () => {
  assert.equal(classifyMergeHold(ENQUEUED), 'queue');
  assert.equal(classifyMergeHold(AUTO), 'auto-merge');
  assert.equal(classifyMergeHold(UNHELD), 'none');

  // THE ONE THAT MATTERS. An absent reading is not "nothing is holding it".
  // Reading it as 'none' would call a genuinely enqueued PR a failed merge;
  // reading it as a queue is round 1's defect. It is its own answer.
  assert.equal(classifyMergeHold(OPEN_NO_HOLD), 'unknown');
  assert.equal(classifyMergeHold({ state: 'OPEN', isInMergeQueue: false }), 'unknown',
    'half a reading is not a reading');
  assert.equal(classifyMergeHold(null), 'unknown');

  assert.equal(holdIsPending('queue'), true);
  assert.equal(holdIsPending('auto-merge'), true);
  assert.equal(holdIsPending('none'), false);
  assert.equal(holdIsPending('unknown'), false, 'a hold nobody could read does not hold anything');
});

test('holdLabel never invents a merge queue', () => {
  assert.match(holdLabel('queue'), /merge queue/);
  assert.match(holdLabel('auto-merge'), /auto-merge/);
  assert.doesNotMatch(holdLabel('none'), /queue is|still working/);
  assert.match(holdLabel('none'), /nothing is holding it/);
  assert.match(holdLabel('unknown'), /could not be read/);
  assert.doesNotMatch(holdLabel('unknown'), /merge queue entry and no auto-merge/,
    'a hold that could not be read must not be reported as no hold');
});

test('THE ROUND-2 DEFECT: an OPEN PR with nothing holding it is a FAILURE, answered at once', () => {
  // This is today's repo. No merge queue is enabled — branch protection has no
  // merge_queue block and /rulesets is [] — so every OPEN-after-merge is a
  // real refusal. Round 1 polled it for fifteen minutes and then announced
  // "nothing has gone wrong, GitHub is still working through the merge queue".
  const r = harness([UNHELD]);
  assert.equal(r.outcome, 'not-merged');
  assert.notEqual(r.outcome, 'queued', 'the false reassurance this round exists to remove');
  assert.equal(r.hold, 'none');
  assert.equal(r.polls, 1, 'one read — it does not wait for a queue that is not there');
  assert.equal(r.elapsed, 0, 'and it does not sleep for a second of it');
  assert.equal(r.mergedAt, null);
});

test('a hold that could not be read answers promptly too, and says it could not tell', () => {
  // Prompt, because asserting a queue nobody observed is exactly round 1.
  // Safe, because the caller records nothing either way and the next pass
  // finds a PR GitHub really was holding already merged.
  const r = harness([OPEN_NO_HOLD]);
  assert.equal(r.outcome, 'not-merged');
  assert.equal(r.hold, 'unknown');
  assert.equal(r.polls, 1);
  assert.equal(r.elapsed, 0);
});

test('auto-merge holds it just as a queue does — gh arms one or the other', () => {
  // `gh pr merge --help`: "If required checks have not yet passed, auto-merge
  // will be enabled. If required checks have passed, the pull request will be
  // added to the merge queue." Both are GitHub holding it; only the two
  // together cover what `gh pr merge` can leave behind.
  const r = harness([AUTO, AUTO, MERGED]);
  assert.equal(r.outcome, 'merged');
  assert.equal(r.polls, 3, 'it waited, because something really was holding it');
});

test('a PR that starts held and STOPS being held stops the wait there and then', () => {
  // A merge group whose CI failed drops the PR out of the queue. Continuing to
  // poll for the full budget would report "queued" about a PR nothing is
  // queueing, which is round 1 again by another road.
  const r = harness([ENQUEUED, UNHELD]);
  assert.equal(r.outcome, 'not-merged');
  assert.equal(r.hold, 'none');
  assert.equal(r.polls, 2);
});

test('criterion 5 on the FAILURE path: with no queue, ship gets the true answer in one read', () => {
  // The success half was already measured — MERGED returns on poll 1 having
  // slept 0ms. The half round 1 broke is this one: a refusal must stay the
  // fast, true failure it was, not become a fabricated queue wait.
  const refused = harness([UNHELD], { timeoutMs: 20 * 60 * 1000 });
  assert.equal(refused.outcome, 'not-merged');
  assert.equal(refused.elapsed, 0, 'a 20-minute budget is not spent on a merge nobody is holding');

  const ok = harness([MERGED], { timeoutMs: 20 * 60 * 1000 });
  assert.equal(ok.outcome, 'merged');
  assert.equal(ok.elapsed, 0);
});

/* ------------------------------------------------- the one shared read */

test('the observation asks for the state AND the hold in ONE read', () => {
  // Two calls can disagree in the gap between them, and the gap is precisely
  // where a merge lands.
  for (const field of ['state', 'mergedAt', 'isInMergeQueue', 'autoMergeRequest']) {
    assert.ok(PR_OBSERVATION_QUERY.includes(field), `the query must ask for ${field}`);
  }
  const argv = prObservationArgv('mentor24-maker/starcaster', 625);
  assert.deepEqual(argv.slice(0, 2), ['api', 'graphql']);
  assert.ok(argv.includes('o=mentor24-maker'));
  assert.ok(argv.includes('n=starcaster'));
  assert.ok(argv.includes('p=625'));
});

test('parsePrObservation flattens GitHub\'s answer, and a half-read one is NOT a reading', () => {
  // Measured against real `gh api graphql` output, 2026-09-05.
  const live = '{"data":{"repository":{"pullRequest":{"state":"MERGED",'
    + '"mergedAt":"2026-09-05T22:19:33Z","isInMergeQueue":false,"autoMergeRequest":null}}}}';
  assert.deepEqual(parsePrObservation(live), {
    state: 'MERGED',
    mergedAt: '2026-09-05T22:19:33Z',
    isInMergeQueue: false,
    autoMergeEnabled: false,
  });

  const open = '{"data":{"repository":{"pullRequest":{"state":"OPEN","mergedAt":null,'
    + '"isInMergeQueue":false,"autoMergeRequest":null}}}}';
  assert.equal(classifyMergeHold(parsePrObservation(open)), 'none');

  const armed = '{"data":{"repository":{"pullRequest":{"state":"OPEN","mergedAt":null,'
    + '"isInMergeQueue":false,"autoMergeRequest":{"enabledAt":"2026-09-05T22:00:00Z"}}}}}';
  assert.equal(classifyMergeHold(parsePrObservation(armed)), 'auto-merge');

  // Nothing usable is null, never a partial object — a partial one would
  // classify as OPEN-with-an-unknown-hold, which is a reading. Nothing was read.
  assert.equal(parsePrObservation('not json'), null);
  assert.equal(parsePrObservation('{"data":{"repository":null}}'), null);
  assert.equal(parsePrObservation(null), null);
  assert.equal(parsePrObservation(undefined), null);

  // It takes an already-parsed answer too, so ship's own JSON reader does not
  // have to stringify a payload back just to hand it over.
  assert.equal(parsePrObservation(JSON.parse(live)).state, 'MERGED');
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
  const r = harness([ENQUEUED, null]);
  assert.equal(r.outcome, 'queued');
  assert.ok(r.failedReads > 0, 'and it still reports how many reads came back blind');
});

test('a blind read mid-wait does not stop the wait, and the merge is still seen', () => {
  const r = harness([ENQUEUED, null, null, MERGED]);
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

test('ROUND 2: neither caller may report a queue it never established', () => {
  // The defect: `outcome: 'queued'` was returned for any OPEN pull request,
  // so on a repo with no merge queue — this one — every refused merge was
  // announced as a queue wait. Both callers now read the HOLD, and both have
  // a path for the merge simply not having happened.
  for (const [who, code] of [['ship', shipCode], ['the relay', relayCode]]) {
    assert.match(code, /prObservationArgv\(/, `${who} reads the hold in the same call as the state`);
    assert.match(code, /parsePrObservation\(/, `${who} flattens that one answer`);
    assert.match(code, /'not-merged'/, `${who} has an answer for a merge that simply did not happen`);
    assert.match(code, /holdLabel\(/, `${who} names what is (or is not) holding it, rather than asserting a queue`);
  }

  // And the queue-less refusal must not be dressed up. Round 1's ship message
  // said this, in full, about a merge GitHub had just refused.
  assert.doesNotMatch(shipCode, /Nothing has gone wrong and nothing else has been changed\. GitHub is still working\s*\n?\s*through the merge queue/,
    'the reassurance that was false on every run is gone');
});

test('ship waits only on a merge GitHub is holding, and its bound is derived', () => {
  // The 15-minute literal traced to nothing. A merge queue runs `verify` once
  // more on the merged result — the same CI run ship already waits on — so the
  // ceiling is the one already measured for that.
  assert.match(shipCode, /const MERGE_TIMEOUT_MIN = CI_TIMEOUT_MIN;/,
    'the merge ceiling is derived from the CI ceiling, not picked');
  assert.doesNotMatch(shipCode, /const MERGE_TIMEOUT_MIN = \d/, 'and it is not a literal');

  // The re-read must not go back through `quiet()`, which glues stderr onto
  // stdout before JSON.parse — one gh notice and a good answer reads as blind,
  // which is a cannot-tell manufactured out of a perfectly good reading. Same
  // property `pullRequestTitle.test.js` pins for the ClickUp fetcher, and it
  // is pinned on the READER, not on the call site: an earlier version of this
  // assertion looked only at the merge region and passed cleanly while
  // `readJson` itself was reverted to `quiet()` underneath it.
  const reader = shipCode.slice(
    shipCode.indexOf('function readJson('),
    shipCode.indexOf('const bucketOf =')
  );
  assert.ok(reader.length > 0, 'ship has a JSON reader of its own');
  assert.equal(/quiet\(/.test(reader), false, 'quiet() merges stderr into the payload it is about to parse');
  assert.match(reader, /result\.stdout/, 'it parses stdout alone');
  assert.doesNotMatch(reader, /result\.stderr/, 'and never the two concatenated');
});

test('THE RELAY WAIT IS CHARGED TO THE PASS BUDGET, not standing beside it', () => {
  // The round-2 defect on this side: the wait took a 15-minute default,
  // blocking, uncapped per ticket, and charged to nothing — so the tested
  // "a pass cannot outlast its own interval" invariant did not cover it, and
  // one enqueued PR was 900s against a 600s wake.
  const mergeStep = relayCode.slice(relayCode.indexOf('async function runMergeStep'));
  const budget = mergeStep.indexOf('mergeOnComment.mergeObserveBudget(');
  assert.ok(budget > 0, 'the relay asks the shared budget how long it may wait');

  const wait = mergeStep.indexOf('mergeCompletion.waitForMerge(', budget);
  assert.ok(wait > budget, 'and it asks BEFORE waiting, or the answer is decoration');

  assert.match(mergeStep.slice(budget, wait), /inPassBudget\.used \+= 1/,
    'a charged wait actually spends a slot, or the cap counts nothing');

  const call = mergeStep.slice(wait, mergeStep.indexOf('});', wait));
  assert.match(call, /timeoutMs: observeBudget\.timeoutMs/, 'the wait is bounded by that answer');
  assert.doesNotMatch(call, /timeoutMs: \d/, 'never by a literal');
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
