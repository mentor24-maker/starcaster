'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isMergeCommand,
  isReviewPassed,
  isReviewVerdict,
  findPullRequest,
  mergeDecision,
  checkState,
  githubGate,
} = require('./mergeOnComment.js');

const OPERATOR = 48012725;
const AGENT = 99999999;

/** Comment factory: t is a relative timestamp so ordering is readable. */
let nextId = 1;
function c(t, userId, text) {
  return { id: String(nextId++), date: String(1000 + t), user: { id: userId }, comment_text: text };
}

const PR_URL = 'https://github.com/mentor24-maker/starcaster/pull/362';
const prOpened = (t) => c(t, AGENT, `PR opened: ${PR_URL}\n\nBuilt in worktree .claude/worktrees/x.`);
const reviewPassed = (t) => c(t, AGENT, 'REVIEW PASSED (loop-review, 2026-08-22) — promoted to Ready to launch.');

// ---------------------------------------------------------------- phrases

test('the four sanctioned merge phrases fire, in any casing or padding', () => {
  for (const phrase of ['merge', 'merge it', 'ship it', 'approve']) {
    assert.equal(isMergeCommand(phrase), true, phrase);
    assert.equal(isMergeCommand(phrase.toUpperCase()), true, phrase);
    assert.equal(isMergeCommand(`  ${phrase}\n`), true, phrase);
    assert.equal(isMergeCommand(`${phrase}!`), true, phrase);
  }
});

test('EXACT PHRASE, NEVER SUBSTRING — the sentence that must not merge anything', () => {
  assert.equal(isMergeCommand('do not merge this yet'), false);
  assert.equal(isMergeCommand('merge after the other one lands'), false);
  assert.equal(isMergeCommand("I'll approve the design later"), false);
  assert.equal(isMergeCommand('can you ship it once CI is green?'), false);
  assert.equal(isMergeCommand('hold off — do NOT ship it'), false);
});

test('empty and junk comments are not commands', () => {
  assert.equal(isMergeCommand(''), false);
  assert.equal(isMergeCommand(null), false);
  assert.equal(isMergeCommand('   '), false);
  assert.equal(isMergeCommand('👍'), false);
});

// ---------------------------------------------------------- review verdict

test('both spellings loop-review actually uses count as a pass', () => {
  assert.equal(isReviewPassed('REVIEW PASSED (loop-review, 2026-08-22)'), true);
  assert.equal(isReviewPassed('REVIEW: PASSED (loop-review, 2026-08-21 night) — promoted.'), true);
});

test('a failing verdict is a verdict but not a pass', () => {
  const failed = 'REVIEW: sent back to Queued (loop-review, 2026-08-22) — CI is RED.';
  assert.equal(isReviewVerdict(failed), true);
  assert.equal(isReviewPassed(failed), false);
});

test('prose that merely says the words is not a verdict line', () => {
  assert.equal(isReviewPassed('this is not a REVIEW PASSED situation'), false);
});

// ------------------------------------------------------------------- PR url

test('only a "PR opened:" line is trusted as the PR to merge', () => {
  const comments = [
    c(1, AGENT, 'Releasing back to Queued: depends on PR #341 https://github.com/mentor24-maker/starcaster/pull/341 which has not merged.'),
    prOpened(2),
  ];
  assert.equal(findPullRequest(comments).number, 362);
});

test('a cited PR with no "PR opened:" line yields nothing — refuse, never guess', () => {
  const comments = [c(1, AGENT, 'see https://github.com/mentor24-maker/starcaster/pull/341 for context')];
  assert.equal(findPullRequest(comments), null);
});

test('the newest "PR opened:" wins when a ticket was rebuilt', () => {
  const comments = [prOpened(1), c(5, AGENT, 'PR opened: https://github.com/mentor24-maker/starcaster/pull/400')];
  assert.equal(findPullRequest(comments).number, 400);
});

// -------------------------------------------------------------- decisions

test('the happy path: operator says merge on a passed, PR-carrying ticket', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), reviewPassed(2), c(3, OPERATOR, 'merge')],
  });
  assert.equal(d.act, 'merge');
  assert.equal(d.pr.number, 362);
  assert.equal(d.pr.owner, 'mentor24-maker');
});

test('DELIBERATE: an agent-authored "merge" is ignored — only the operator id authorizes', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), reviewPassed(2), c(3, AGENT, 'merge')],
  });
  assert.equal(d.act, 'ignore');
});

test('DELIBERATE: identity is by id, not by name — an agent named "Dane" still cannot merge', () => {
  const impostor = { id: '77', date: '1003', user: { id: AGENT, username: 'Dane' }, comment_text: 'merge' };
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), reviewPassed(2), impostor],
  });
  assert.equal(d.act, 'ignore');
});

test('DELIBERATE: the operator saying "merge" on a Queued ticket does nothing', () => {
  for (const status of ['Queued', 'Building', 'In review', 'Needs your input', 'Live']) {
    const d = mergeDecision({
      status,
      operatorId: OPERATOR,
      comments: [prOpened(1), reviewPassed(2), c(3, OPERATOR, 'merge')],
    });
    assert.equal(d.act, 'ignore', status);
  }
});

test('DELIBERATE: no REVIEW PASSED comment → refused, with a reason worth reading', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), c(3, OPERATOR, 'merge')],
  });
  assert.equal(d.act, 'refuse');
  assert.match(d.reason, /no review verdict/);
});

test('DELIBERATE: the latest verdict is a FAIL → refused even though an older pass exists', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [
      prOpened(1),
      reviewPassed(2),
      c(3, AGENT, 'REVIEW: sent back to Queued — a blocking finding.'),
      c(4, OPERATOR, 'merge'),
    ],
  });
  assert.equal(d.act, 'refuse');
  assert.match(d.reason, /not a PASS/);
});

test('DELIBERATE: a stale "merge" from an earlier round cannot release the new PR', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), c(2, OPERATOR, 'merge'), c(8, AGENT, 'PR opened: https://github.com/mentor24-maker/starcaster/pull/400'), reviewPassed(9)],
  });
  assert.equal(d.act, 'refuse');
  assert.match(d.reason, /predates/);
});

test('DELIBERATE: no "PR opened:" comment → refused, nothing guessed', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [reviewPassed(2), c(3, OPERATOR, 'merge')],
  });
  assert.equal(d.act, 'refuse');
  assert.match(d.reason, /PR opened/);
});

test('a comment already handled never fires twice', () => {
  const cmd = c(3, OPERATOR, 'merge');
  const comments = [prOpened(1), reviewPassed(2), cmd];
  assert.equal(mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments }).act, 'merge');
  const second = mergeDecision({
    status: 'ready to launch', operatorId: OPERATOR, comments, handled: new Set([cmd.id]),
  });
  assert.equal(second.act, 'ignore');
});

test('a ticket with no operator comments at all is silent, not refused', () => {
  const d = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments: [prOpened(1), reviewPassed(2)] });
  assert.equal(d.act, 'ignore');
});

test('an operator comment that is a question, not a command, is ignored', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), reviewPassed(2), c(3, OPERATOR, 'does this touch the live site?')],
  });
  assert.equal(d.act, 'ignore');
});

// ------------------------------------------------------------ github gate

const green = [
  { __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { __typename: 'StatusContext', context: 'Vercel', state: 'SUCCESS' },
];

test('open + green + clean merges', () => {
  const g = githubGate({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: green });
  assert.equal(g.action, 'merge');
});

test('DELIBERATE: conflicts stop the script dead — never update-branch, never resolve', () => {
  const g = githubGate({ state: 'OPEN', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', statusCheckRollup: green });
  assert.equal(g.action, 'conflict');
});

test('behind main asks for update-branch, not a merge', () => {
  const g = githubGate({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND', statusCheckRollup: green });
  assert.equal(g.action, 'update-branch');
});

test('a StatusContext failure is a red PR — the shape a CheckRun-only reader would miss', () => {
  const rollup = [
    { __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'StatusContext', context: 'Vercel', state: 'FAILURE' },
  ];
  const g = githubGate({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: rollup });
  assert.equal(g.action, 'refuse');
  assert.match(g.reason, /Vercel/);
});

test('a check still running means wait quietly, not refuse', () => {
  const rollup = [{ __typename: 'CheckRun', name: 'verify', status: 'IN_PROGRESS' }];
  const g = githubGate({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', statusCheckRollup: rollup });
  assert.equal(g.action, 'wait');
});

test('a PR with no checks at all is refused — unverified is not green', () => {
  const g = githubGate({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [] });
  assert.equal(g.action, 'refuse');
  assert.match(g.reason, /no checks/);
});

test('closed, merged and draft PRs are all refused', () => {
  assert.equal(githubGate({ state: 'MERGED' }).action, 'refuse');
  assert.equal(githubGate({ state: 'CLOSED' }).action, 'refuse');
  const draft = githubGate({ state: 'OPEN', isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: green });
  assert.equal(draft.action, 'refuse');
  assert.match(draft.reason, /draft/);
});

test('UNKNOWN mergeability waits — GitHub has not finished computing it', () => {
  const g = githubGate({ state: 'OPEN', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', statusCheckRollup: green });
  assert.equal(g.action, 'wait');
});

test('checkState reads both rollup shapes and both failure spellings', () => {
  const s = checkState([
    { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'b', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', name: 'c', status: 'QUEUED' },
    { __typename: 'StatusContext', context: 'd', state: 'PENDING' },
    { __typename: 'StatusContext', context: 'e', state: 'ERROR' },
  ]);
  assert.deepEqual(s.pending, ['c', 'd']);
  assert.equal(s.failed.length, 2);
});

// ------------------------------------------- re-planning a refusal (86bbjt18r)

const {
  MERGE_MARKER,
  parseMergeMarker,
  latestMergeMarker,
} = require('./mergeOnComment.js');

/** A marker reply, in the exact shape markMergeHandled writes. */
function marker(t, what) {
  return { id: `m${nextId++}`, date: String(1000 + t), comment_text: `${MERGE_MARKER} ${what} — 2026-08-22T0${t}:00:00.000Z` };
}

test('a marker that is not ours parses as nothing', () => {
  assert.equal(parseMergeMarker('[bus-relay] sent to channel 2kydhxeu-474 at ...'), null);
  assert.equal(parseMergeMarker(''), null);
  assert.equal(parseMergeMarker('merge'), null);
});

test('a refusal marker keeps its reason, em-dash and all', () => {
  const why = 'no "PR opened:" comment on this ticket — nothing to merge';
  const parsed = parseMergeMarker(`${MERGE_MARKER} refused: ${why} — 2026-08-22T04:00:00.000Z`);
  assert.equal(parsed.kind, 'refused');
  assert.equal(parsed.reason, why);
  assert.equal(parsed.at, '2026-08-22T04:00:00.000Z');
});

test('a merge and a conflict hand-off are terminal, and stay terminal', () => {
  assert.equal(parseMergeMarker(`${MERGE_MARKER} merged PR #372 at 2026-08-22T04:00:00.000Z — 2026-08-22T04:00:01.000Z`).kind, 'terminal');
  assert.equal(parseMergeMarker(`${MERGE_MARKER} conflict hand-off on PR #380 — 2026-08-22T04:00:00.000Z`).kind, 'terminal');
});

test('markers written before this change still parse (nothing needs migrating)', () => {
  // The live format has not changed — only its reading. Both of these are
  // verbatim from the 2026-08-22 run.
  assert.equal(parseMergeMarker(`${MERGE_MARKER} refused: the most recent review verdict is not a PASS — 2026-08-22T03:12:44.101Z`).kind, 'refused');
  assert.equal(parseMergeMarker(`${MERGE_MARKER} merged PR #345 at 2026-08-22T03:20:00.000Z — 2026-08-22T03:20:02.222Z`).kind, 'terminal');
});

test('the NEWEST marker decides — a refusal after a refusal replaces it', () => {
  const replies = [marker(1, 'refused: reason A'), marker(3, 'refused: reason B'), marker(2, 'refused: reason C')];
  assert.equal(latestMergeMarker(replies).reason, 'reason B');
  assert.equal(latestMergeMarker([]), null);
});

test('THE BUG: a refusal is re-planned once its reason is fixed, with no second "merge"', () => {
  // 2026-08-22, verbatim: refused for "no PR opened:", the comment added by
  // hand minutes later, and three later passes never looked again.
  const cmd = c(3, OPERATOR, 'merge');
  const before = [reviewPassed(2), cmd];
  const first = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments: before });
  assert.equal(first.act, 'refuse');
  assert.match(first.reason, /no "PR opened:"/);

  // The pass that refused wrote a marker recording that reason. Rebuild the
  // refusal map the way bus-relay does — by PARSING that marker back off the
  // reply thread — so this test exercises the reader, not just the rule.
  // Under the old rule the comment was struck off forever. Now the missing PR
  // comment arrives and the very next pass merges it — Dane says nothing.
  const replies = [marker(3, `refused: ${first.reason}`)];
  const parsed = latestMergeMarker(replies);
  assert.equal(parsed.kind, 'refused');
  const refused = new Map([[first.commentId, parsed.reason]]);
  const after = [...before, prOpened(4)];
  const second = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments: after, refused });
  assert.equal(second.act, 'merge');
  assert.equal(second.pr.number, 362);
});

test('re-planning is silent while the reason still holds — no duplicate refusals', () => {
  const cmd = c(3, OPERATOR, 'merge');
  const comments = [reviewPassed(2), cmd];
  const first = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments });
  const refused = new Map([[first.commentId, first.reason]]);
  const again = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments, refused });
  assert.equal(again.act, 'ignore');
  assert.match(again.reason, /already refused for the same reason/);
});

test('a DIFFERENT refusal reason is news, and is said out loud', () => {
  const cmd = c(3, OPERATOR, 'merge');
  const comments = [reviewPassed(2), cmd];
  const refused = new Map([[String(cmd.id), 'some older reason that no longer applies']]);
  const out = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments, refused });
  assert.equal(out.act, 'refuse');
  assert.match(out.reason, /no "PR opened:"/);
});

test('a TERMINAL marker is still spent forever — a merged PR is never re-merged', () => {
  const cmd = c(3, OPERATOR, 'merge');
  const comments = [reviewPassed(1), prOpened(2), cmd];
  const out = mergeDecision({
    status: 'ready to launch', operatorId: OPERATOR, comments,
    handled: new Set([String(cmd.id)]),
    refused: new Map(),
  });
  assert.equal(out.act, 'ignore');
});
