'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attemptOf, classifyLocalMerge, chooseRemedy, checklessMessage, REMEDIES,
} = require('./checklessMessage');

/**
 * The message `npm run ship` prints when a pull request has no CI checks.
 *
 * THE PROPERTY UNDER TEST, above all others: it tells the operator to do ONE
 * thing. Round 2 of task 86bbvqkr1 shipped a message assembled by appending a
 * mergeability note to a nudge paragraph, and one of the pairings said "the
 * branch needs a new commit" and "the remedy is a catch-up merge, not another
 * commit" in the same breath. Everything below exists to make that shape
 * unreachable rather than merely absent.
 */

const CONFLICTING = { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' };
const MERGEABLE = { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
const UNKNOWN = { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };

/** Every nudge state a real run can be in, as the caller passes them. */
const ATTEMPT_CASES = [
  { label: 'nudge pushed', args: { nudged: true, nudgeFailedAt: null } },
  { label: 'commit failed', args: { nudged: false, nudgeFailedAt: 'commit' } },
  { label: 'push failed', args: { nudged: false, nudgeFailedAt: 'push' } },
  { label: 'never attempted', args: { nudged: false, nudgeFailedAt: null } },
];

const MERGEABILITY_CASES = [
  { label: 'conflicting, git agrees', mergeable: CONFLICTING, localMerge: 'conflicting' },
  { label: 'conflicting, git says behind', mergeable: CONFLICTING, localMerge: 'clean' },
  { label: 'conflicting, clean but behind-ness unmeasured', mergeable: CONFLICTING, localMerge: 'clean-unconfirmed' },
  { label: 'conflicting, git says current', mergeable: CONFLICTING, localMerge: 'current' },
  { label: 'conflicting, no local reading', mergeable: CONFLICTING, localMerge: null },
  { label: 'mergeable', mergeable: MERGEABLE, localMerge: null },
  { label: 'unknown', mergeable: UNKNOWN, localMerge: null },
  { label: 'no reading at all', mergeable: null, localMerge: null },
];

function everyCombination() {
  const out = [];
  for (const outcome of ['never_appeared', 'blocked_conflicting']) {
    for (const m of MERGEABILITY_CASES) {
      for (const a of ATTEMPT_CASES) {
        out.push({
          label: `${outcome} / ${m.label} / ${a.label}`,
          input: {
            outcome, mergeable: m.mergeable, localMerge: m.localMerge, ...a.args,
            prNumber: 639, prUrl: 'https://github.com/x/y/pull/639',
          },
        });
      }
    }
  }
  return out;
}

test('THE INVARIANT: every message carries exactly one remedy', () => {
  // One `WHAT TO DO:` per message, and it is the counting that matters — the
  // round-2 defect was two remedies in one message, and no amount of careful
  // wording prevents that. One slot does.
  for (const { label, input } of everyCombination()) {
    const { text } = checklessMessage(input);
    const found = text.split('WHAT TO DO:').length - 1;
    assert.equal(found, 1, `${label}: expected exactly one WHAT TO DO:, found ${found}`);
  }
});

test('THE INVARIANT, the other half: no OTHER remedy block appears in the text', () => {
  // Counting headings would not catch a second remedy pasted in without one.
  // This asserts the chosen block is present verbatim and every other block is
  // absent verbatim — which is the concatenation defect, stated exactly.
  for (const { label, input } of everyCombination()) {
    const { remedy, text } = checklessMessage(input);
    assert.ok(text.includes(REMEDIES[remedy]({ prNumber: input.prNumber })),
      `${label}: the chosen remedy (${remedy}) must actually be in the message`);
    for (const key of Object.keys(REMEDIES)) {
      if (key === remedy) continue;
      assert.ok(!text.includes(REMEDIES[key]({ prNumber: input.prNumber })),
        `${label}: chose ${remedy} but the ${key} block is in the message too`);
    }
  }
});

test('no remedy block is a substring of another, or the test above passes vacuously', () => {
  const rendered = Object.entries(REMEDIES).map(([k, f]) => [k, f({ prNumber: 639 })]);
  for (const [a, textA] of rendered) {
    for (const [b, textB] of rendered) {
      if (a === b) continue;
      assert.ok(!textA.includes(textB), `${b}'s block is contained in ${a}'s`);
    }
  }
});

test('nothing above the remedy issues a command — the preamble states facts only', () => {
  // The round-2 message put advice in the base paragraph AND in the appended
  // note. Keeping every instruction inside the one remedy block is what makes
  // counting the blocks a real guarantee rather than a proxy for one.
  for (const { label, input } of everyCombination()) {
    const { text } = checklessMessage(input);
    const preamble = text.slice(0, text.indexOf('WHAT TO DO:'));
    for (const command of ['npm run ship', 'git commit', 'git merge', 'git push', 'gh pr view']) {
      assert.ok(!preamble.includes(command),
        `${label}: the preamble names \`${command}\` — advice belongs in the remedy block`);
    }
  }
});

test('THE #630 CASE: a conflicting head is never told to make a new commit', () => {
  // The specific contradiction that sent round 2 back: nudge commit failed,
  // GitHub says CONFLICTING. The base paragraph said "the branch needs a new
  // commit", the appended note said "not another commit: run ship again".
  const { remedy, text } = checklessMessage({
    outcome: 'never_appeared',
    nudged: false,
    nudgeFailedAt: 'commit',
    mergeable: CONFLICTING,
    localMerge: 'clean',
    prNumber: 630,
    prUrl: 'https://github.com/x/y/pull/630',
  });
  assert.equal(remedy, 'catch-up-merge');
  assert.ok(text.includes('npm run ship'), 'it names the catch-up');
  assert.ok(!text.includes('will NOT help'),
    'the commit-failed advice must not survive alongside the catch-up remedy');
  assert.ok(!/needs a new commit before GitHub/.test(text),
    'and nor must its wording in any other spelling');
});

test('the remedy table: every combination maps to the advice it should', () => {
  const expected = [
    // GitHub says conflicting — git decides WHICH conflicting remedy.
    [{ mergeable: CONFLICTING, localMerge: 'conflicting' }, 'resolve-the-conflict'],
    [{ mergeable: CONFLICTING, localMerge: 'current' }, 'recompute-mergeability'],
    [{ mergeable: CONFLICTING, localMerge: 'clean' }, 'catch-up-merge'],
    [{ mergeable: CONFLICTING, localMerge: 'clean-unconfirmed' }, 'catch-up-merge'],
    [{ mergeable: CONFLICTING, localMerge: null }, 'catch-up-merge'],
    // GitHub says mergeable — the nudge's own outcome decides.
    [{ mergeable: MERGEABLE, nudged: true }, 'check-actions'],
    [{ mergeable: MERGEABLE, nudgeFailedAt: 'push' }, 'push-the-commit'],
    [{ mergeable: MERGEABLE, nudgeFailedAt: 'commit' }, 'new-commit'],
    [{ mergeable: MERGEABLE }, 'new-commit'],
    // No usable reading — neither remedy, whatever the nudge did.
    [{ mergeable: UNKNOWN, nudged: true }, 'establish-the-cause'],
    [{ mergeable: UNKNOWN, nudgeFailedAt: 'commit' }, 'establish-the-cause'],
    [{ mergeable: null }, 'establish-the-cause'],
    [{ mergeable: { mergeable: 'nonsense' } }, 'establish-the-cause'],
  ];
  for (const [input, want] of expected) {
    assert.equal(chooseRemedy(input), want, JSON.stringify(input));
  }
});

test('a conflicting head is decided by GitHub, never overruled by a clean git reading', () => {
  // git saying "merges clean" does NOT mean the checks are coming — GitHub is
  // the one that decides whether to build the merge ref, and it is the one
  // refusing. The local reading only ever picks between conflict remedies.
  for (const localMerge of ['conflicting', 'clean', 'clean-unconfirmed', 'current', null]) {
    const { remedy } = checklessMessage({ mergeable: CONFLICTING, localMerge, nudged: true });
    assert.ok(
      ['resolve-the-conflict', 'catch-up-merge', 'recompute-mergeability'].includes(remedy),
      `local reading ${localMerge} escaped the conflicting family as ${remedy}`,
    );
  }
});

test('the cannot-tell branch hands out no remedy — it hands over the command that settles it', () => {
  const { remedy, text } = checklessMessage({ mergeable: UNKNOWN, prNumber: 700, nudged: true });
  assert.equal(remedy, 'establish-the-cause');
  assert.match(text, /gh pr view 700 --json mergeable,mergeStateStatus/);
  assert.ok(!text.includes('Actions is enabled'),
    'a reading that could not be taken must not be reported as a broken Actions');
  assert.match(text, /find out WHICH cause this is before acting/);
});

test('"Actions is enabled" is stated ONLY when GitHub has actually said MERGEABLE', () => {
  for (const { label, input } of everyCombination()) {
    const { text } = checklessMessage(input);
    if (!text.includes('Actions is enabled')) continue;
    assert.equal(input.mergeable && input.mergeable.mergeable, 'MERGEABLE', label);
    assert.equal(input.nudged, true, `${label}: and only after a nudge was actually pushed`);
  }
});

test('every message says the work is safe and where to look', () => {
  for (const { label, input } of everyCombination()) {
    const { text } = checklessMessage(input);
    assert.match(text, /Nothing was merged; the work is safe on the branch\./, label);
    assert.ok(text.trimEnd().endsWith(input.prUrl), `${label}: it must end with the PR link`);
  }
});

test('the reading it acted on is printed, including when there was none', () => {
  const withReading = checklessMessage({ mergeable: CONFLICTING, localMerge: 'clean' }).text;
  assert.match(withReading, /mergeable: CONFLICTING, mergeStateStatus: DIRTY/);
  assert.match(withReading, /origin\/main merges in cleanly, and this\n    branch is behind it/);

  const noReading = checklessMessage({ mergeable: null }).text;
  assert.match(noReading, /mergeable: \(none\), mergeStateStatus: \(none\)/);

  const unconfirmed = checklessMessage({ mergeable: CONFLICTING, localMerge: null }).text;
  assert.match(unconfirmed, /NO READING/, 'an unconfirmed conflict says so rather than implying agreement');
});

test('what the nudge actually did is reported, and the three states differ', () => {
  const pushed = checklessMessage({ nudged: true, mergeable: MERGEABLE }).text;
  const commit = checklessMessage({ nudgeFailedAt: 'commit', mergeable: MERGEABLE }).text;
  const push = checklessMessage({ nudgeFailedAt: 'push', mergeable: MERGEABLE }).text;
  assert.match(pushed, /extra commit was pushed/);
  assert.match(commit, /could not be made/);
  assert.match(push, /sitting on this branch locally/);
  assert.notEqual(commit, push);
});

test('a FAILED third-party check is named, and not blamed for the missing runs', () => {
  // classifyChecks calls a Vercel-only board `none` on purpose, which is right
  // — but it left a failed deployment unmentioned on the one path that prints
  // a diagnosis. Naming it costs nothing and nothing else would have.
  const { text } = checklessMessage({
    mergeable: MERGEABLE,
    nudged: true,
    checks: [
      { name: 'Vercel', bucket: 'fail', workflow: '' },
      { name: 'Vercel Preview Comments', bucket: 'pass', workflow: '' },
    ],
  });
  assert.match(text, /SEPARATELY, and not the cause of the missing runs: Vercel has FAILED/);

  const clean = checklessMessage({ mergeable: MERGEABLE, nudged: true, checks: [
    { name: 'Vercel', bucket: 'pass', workflow: '' },
  ] }).text;
  assert.ok(!clean.includes('SEPARATELY'), 'nothing is said when nothing failed');

  // A failing row from one of OUR workflows is not a third-party row, and is
  // not this message's business — that board classifies as `failed`, not
  // `none`, so it never reaches here.
  const ours = checklessMessage({ mergeable: MERGEABLE, nudged: true, checks: [
    { name: 'verify', bucket: 'fail', workflow: 'CI' },
  ] }).text;
  assert.ok(!ours.includes('SEPARATELY'));
});

test('the two outcomes get different headlines — one stopped early, one waited it out', () => {
  const blocked = checklessMessage({ outcome: 'blocked_conflicting', mergeable: CONFLICTING }).text;
  const never = checklessMessage({ outcome: 'never_appeared', mergeable: CONFLICTING }).text;
  assert.match(blocked, /stopped early rather than waiting the window out/);
  assert.ok(!never.includes('stopped early'));
});

test('attemptOf reads the two nudge failures apart, and no-nudge from both', () => {
  assert.equal(attemptOf({ nudged: true }), 'pushed');
  assert.equal(attemptOf({ nudged: false, nudgeFailedAt: 'commit' }), 'commit-failed');
  assert.equal(attemptOf({ nudged: false, nudgeFailedAt: 'push' }), 'push-failed');
  assert.equal(attemptOf({}), 'not-attempted');
  assert.equal(attemptOf(), 'not-attempted');
});

/* ------------------------------------------------ git's second opinion ---- */

test('classifyLocalMerge: a clean merge behind main is `clean`, current is `current`', () => {
  const base = { baseResolved: true, headResolved: true, mergeTreeCode: 0, baseIsFresh: true };
  assert.equal(classifyLocalMerge({ ...base, behindCount: 3 }), 'clean');
  assert.equal(classifyLocalMerge({ ...base, behindCount: 0 }), 'current');
});

test('classifyLocalMerge: exit 1 is a conflict ONLY once both refs resolved', () => {
  // `git merge-tree --write-tree` exits 1 for a ref it cannot resolve as well
  // as for a real conflict (measured on git 2.50.1: "nosuchref - not something
  // we can merge"). Reading the bare 1 would send the operator to resolve a
  // conflict that does not exist.
  assert.equal(classifyLocalMerge({
    baseResolved: true, headResolved: true, mergeTreeCode: 1, baseIsFresh: true,
  }), 'conflicting');
  assert.equal(classifyLocalMerge({
    baseResolved: false, headResolved: true, mergeTreeCode: 1, baseIsFresh: true,
  }), null, 'an unresolvable base is a cannot-tell, not a conflict');
  assert.equal(classifyLocalMerge({
    baseResolved: true, headResolved: false, mergeTreeCode: 1, baseIsFresh: true,
  }), null, 'an unresolvable head is a cannot-tell, not a conflict');
  assert.equal(classifyLocalMerge({
    baseResolved: true,
    headResolved: true,
    mergeTreeCode: 1,
    mergeTreeOut: 'merge-tree: nosuchref - not something we can merge',
    baseIsFresh: true,
  }), null, 'and git saying it could not merge something is a cannot-tell too');
});

test('classifyLocalMerge: any other exit code is a cannot-tell, never clean', () => {
  for (const code of [2, 128, 129, null, undefined]) {
    assert.equal(classifyLocalMerge({
      baseResolved: true, headResolved: true, mergeTreeCode: code, baseIsFresh: true,
    }), null, `exit ${code}`);
  }
});

test('classifyLocalMerge: "already current" is never claimed against a stale base', () => {
  // The claim is about origin/main, so it may only be made against a ref this
  // run refreshed. A stale one reports a branch as current while main has
  // moved — which sends the phantom-conflict remedy (push a commit) to a pull
  // request whose real remedy is the catch-up merge.
  assert.equal(classifyLocalMerge({
    baseResolved: true, headResolved: true, mergeTreeCode: 0, behindCount: 0, baseIsFresh: false,
  }), 'clean-unconfirmed');
  assert.equal(classifyLocalMerge({
    baseResolved: true, headResolved: true, mergeTreeCode: 0, behindCount: null, baseIsFresh: true,
  }), 'clean-unconfirmed', 'an uncountable distance is not "current" either');
});

/* --- a CANNOT TELL is never rendered as a measurement (task 86bbvyfuu) ---- */

test('classifyLocalMerge: "behind main" is only claimed when it was actually measured', () => {
  // The claim needs BOTH halves: a base ref this run refreshed, and a distance
  // that parsed. Missing either one used to answer plain `clean`, which the
  // message renders as "this branch is behind it" under a WHAT WAS READ
  // heading — a reading nobody took, printed as a fact.
  const measured = {
    baseResolved: true, headResolved: true, mergeTreeCode: 0, behindCount: 3, baseIsFresh: true,
  };
  assert.equal(classifyLocalMerge(measured), 'clean', 'measured and behind stays `clean`');

  assert.equal(classifyLocalMerge({ ...measured, baseIsFresh: false }), 'clean-unconfirmed',
    'a base ref this run could not refresh establishes nothing about the distance');
  assert.equal(classifyLocalMerge({ ...measured, behindCount: null }), 'clean-unconfirmed',
    'nor does a distance that could not be counted');
  assert.equal(classifyLocalMerge({ ...measured, behindCount: NaN }), 'clean-unconfirmed',
    'nor one that would not parse');
  assert.equal(classifyLocalMerge({ ...measured, behindCount: undefined }), 'clean-unconfirmed',
    'nor one that was never taken at all');
});

test('THE TICKET\'S OWN CASE: a stale base never renders "branch is behind it"', () => {
  // 86bbvyfuu, stated as the acceptance criterion states it. `git fetch origin
  // main` failing while `gh` still works is not exotic in this repo, where git
  // and gh authenticate by different routes.
  const localMerge = classifyLocalMerge({
    baseResolved: true, headResolved: true, mergeTreeCode: 0, behindCount: 0, baseIsFresh: false,
  });
  const { text } = checklessMessage({ mergeable: CONFLICTING, localMerge, prNumber: 639 });
  assert.ok(!text.includes('branch is behind it'),
    'a distance that was never measured must not be reported as one that was');
  assert.match(text, /whether\n    this branch is BEHIND it was NOT established/);
});

test('no message anywhere claims "behind it" unless the reading said `clean`', () => {
  // The invariant rather than the instance: whatever the outcome and whatever
  // the nudge did, that sentence belongs to exactly one local reading.
  for (const { label, input } of everyCombination()) {
    const { text } = checklessMessage(input);
    if (!text.includes('branch is behind it')) continue;
    assert.equal(input.localMerge, 'clean',
      `${label}: claimed the branch is behind main on a \`${input.localMerge}\` reading`);
  }
});

test('the unconfirmed reading gets the SAME remedy — only its evidence differs', () => {
  // Quietly changing which remedy an unconfirmed reading gets would regress
  // 86bbvqkr1, whose whole point is that the catch-up merge is the measured,
  // safe default under uncertainty. What changed is the evidence line above it.
  const shared = { mergeable: CONFLICTING, prNumber: 639, prUrl: 'https://x/y/pull/639' };
  const measured = checklessMessage({ ...shared, localMerge: 'clean' });
  const unconfirmed = checklessMessage({ ...shared, localMerge: 'clean-unconfirmed' });
  const noReading = checklessMessage({ ...shared, localMerge: null });

  assert.equal(measured.remedy, 'catch-up-merge');
  assert.equal(unconfirmed.remedy, 'catch-up-merge');
  assert.equal(noReading.remedy, 'catch-up-merge');
  assert.ok(unconfirmed.text.includes(REMEDIES['catch-up-merge']({ prNumber: 639 })));

  // ...and the three are genuinely distinguishable, or the state is decorative.
  assert.notEqual(measured.text, unconfirmed.text);
  assert.notEqual(noReading.text, unconfirmed.text);
});
