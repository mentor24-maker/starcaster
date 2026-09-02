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

/**
 * How often the relay actually wakes, read from the one file that decides it.
 * `INTERVAL_SECONDS` in scripts/install_bus_relay.sh generates the launchd
 * plist, so it is the source of truth; copying the number into this test would
 * just create a second place for it to be wrong.
 */
function relayIntervalSeconds() {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'install_bus_relay.sh'), 'utf8');
  const m = src.match(/^INTERVAL_SECONDS=(\d+)/m);
  assert.ok(m, 'install_bus_relay.sh must declare INTERVAL_SECONDS');
  return Number(m[1]);
}

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

test('a MERGE is terminal, and stays terminal', () => {
  assert.equal(parseMergeMarker(`${MERGE_MARKER} merged PR #372 at 2026-08-22T04:00:00.000Z — 2026-08-22T04:00:01.000Z`).kind, 'terminal');
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

// ---------- the comment must not promise what the marker does not do (86bbk0g4u)

const {
  markerKind,
  mayPromiseApproval,
  refusalNotice,
  conflictHandOffNotice,
  mergedNotice,
  APPROVAL_CARRIES_OVER,
} = require('./mergeOnComment.js');

const SOME_PR = { number: 380, url: PR_URL };

/**
 * THE INVARIANT, asserted over every notice the merge path can post.
 *
 * A 'refused' marker is re-decided on later passes, so its body MAY promise
 * the approval carries over. A 'terminal' marker is spent forever, so its
 * body MUST NOT — that promise is exactly the lie the conflict hand-off told
 * eleven tickets on 2026-08-23. Building body and marker in one function is
 * what makes this checkable at all; before, they lived in different files.
 *
 * SHARPENED 2026-08-30 (task 86bbq0fh8). A re-decidable marker turned out not
 * to be enough. "It goes through on its own" is only true if somebody is going
 * to deal with the reason, and on a conflict nobody was: the hand-off asked
 * the bus for an agent session, nothing reads the bus, and PR #434 sat three
 * days under a comment saying it was progressing. So the promise now needs
 * BOTH a re-decidable marker and a named actor, and `actor: 'nobody'` is the
 * case that must stay silent about merging and say it is stalled instead.
 */
const FILED = { id: '86bbzzzzz', url: 'https://app.clickup.com/t/86bbzzzzz' };

function assertPromiseMatchesMarker(notice, label) {
  const kind = markerKind(notice.marker);
  const promises = notice.body.includes(APPROVAL_CARRIES_OVER);
  assert.ok(notice.actor, `${label}: every notice must name who acts next`);
  const mayPromise = mayPromiseApproval({ marker: notice.marker, actor: notice.actor });
  assert.equal(promises, mayPromise,
    `${label}: marker ${kind}, actor "${notice.actor}" — the body ${promises ? 'promises' : 'does not promise'} the approval carries over and should ${mayPromise ? '' : 'not '}`);
  if (kind === 'terminal') {
    assert.equal(promises, false, `${label}: terminal marker (${notice.marker}) must not promise the approval carries over`);
  }
  if (notice.actor === 'nobody') {
    assert.equal(promises, false, `${label}: no actor exists, so it must not promise a merge`);
  }
}

test('EVERY notice the merge path posts says truthfully whether the approval survives', () => {
  assertPromiseMatchesMarker(
    refusalNotice({ commentId: '77', why: 'checks are red: verify (FAILURE)', plainEnglish: 'x' }),
    'refusal',
  );
  assertPromiseMatchesMarker(
    conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict: null }),
    'hand-off, unchecked locally',
  );
  assertPromiseMatchesMarker(
    conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict: { realConflict: true, reason: 'both touched routes/index.js' }, filed: FILED }),
    'hand-off, real overlap, ticket filed',
  );
  assertPromiseMatchesMarker(
    conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict: { realConflict: true, reason: 'both touched routes/index.js' }, filed: null }),
    'hand-off, real overlap, NOTHING filed',
  );
  assertPromiseMatchesMarker(
    mergedNotice({ commentId: '77', pr: SOME_PR, mergedAt: '2026-08-23T10:00:00.000Z' }),
    'merged',
  );
});

// ---------- a hand-off names its actor, or says there isn't one (86bbq0fh8)

test('THE BUG: a real conflict with nothing filed must not say it will merge', () => {
  // PR #434, 2026-08-26 to 2026-08-29. The comment said the approval stood and
  // it would merge once the branch was caught up; "once the branch is caught
  // up" had no owner, the bus post asking for an agent session went into a
  // room nothing reads, and three days passed. Dane found it himself.
  const { body, actor } = conflictHandOffNotice({
    commentId: '77', pr: SOME_PR, filed: null,
    localVerdict: { kind: 'real-conflict', reason: 'both touched routes/index.js' },
  });
  assert.equal(actor, 'nobody');
  assert.ok(!body.includes(APPROVAL_CARRIES_OVER), 'must not promise the approval carries over with no actor');
  assert.doesNotMatch(body, /will merge|goes through on its own|on a later run/i,
    'must not describe a merge that nothing is going to perform');
  assert.match(body, /Nothing is currently working on it/i, 'must say plainly that it is stalled');
  assert.match(body, /agent session/i, 'must name what kind of actor it needs');
});

test('a filed conflict ticket IS the named actor, and the body says which one', () => {
  const { body, actor } = conflictHandOffNotice({
    commentId: '77', pr: SOME_PR, filed: FILED,
    localVerdict: { kind: 'real-conflict', reason: 'both touched routes/index.js' },
  });
  assert.equal(actor, 'loop-queue');
  assert.match(body, new RegExp(FILED.id), 'the ticket that will do the work must be named by id');
  assert.match(body, new RegExp(FILED.url.replace(/[/.]/g, '\\$&')), 'and linked');
  assert.match(body, /build loop drains every pass/i, 'and the reader must be told that actor is already running');
  assert.ok(body.includes(APPROVAL_CARRIES_OVER), 'with a real actor the approval genuinely does carry over');
});

test('no hand-off leans on the passive voice to imply an actor it cannot name', () => {
  // vault doctrine/TERMINOLOGY.md, 2026-08-29: a hand-off names which of the
  // two it needs — a person or an agent session — and passive voice implying
  // an unnamed one is itself the defect.
  const stalled = conflictHandOffNotice({
    commentId: '77', pr: SOME_PR, filed: null,
    localVerdict: { kind: 'real-conflict', reason: 'overlap' },
  }).body;
  for (const weasel of [/it will be (?:merged|caught up|resolved)/i, /once the branch is caught up/i]) {
    assert.doesNotMatch(stalled, weasel, `passive promise with no actor behind it: ${weasel}`);
  }
});

test('a stale GitHub answer still retries, filed or not — a PROVEN no-overlap needs nobody', () => {
  // This used to be written against `localVerdict: null`, on the belief that
  // "no verdict" meant "the check found nothing". Review round 2 of task
  // 86bbq80j5 separated those: the retry promise belongs to a verdict that
  // actually came back clean, which is now stated rather than inferred from an
  // absence. The old shape sent "nobody needs to claim it" to the bus for a
  // failed fetch and for a repo the machine has no checkout of.
  for (const filed of [null, FILED]) {
    const n = conflictHandOffNotice({
      commentId: '77', pr: SOME_PR, filed,
      localVerdict: { kind: 'no-overlap', reason: 'the catch-up merged cleanly but could not be pushed' },
    });
    assert.equal(n.actor, 'later-pass');
    assert.ok(n.body.includes(APPROVAL_CARRIES_OVER));
    assert.match(n.body, /merged on the next run/i);
  }
});

test('NO VERDICT is not a finding — a dry run may not stand the room down', () => {
  // The other half of the same separation. Null now means one thing only: a
  // dry run, which never attempts the catch-up. It gets an actor, which is
  // what makes the dry run report an unfiled hand-off as stalled instead of
  // calling it self-healing (review round 2, item 5).
  const n = conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict: null, filed: null });
  assert.equal(n.actor, 'nobody');
  assert.doesNotMatch(n.body, /merged on the next run/i, 'it has no finding to promise on');
  assert.match(n.body, /no local check was attempted/i, 'and it says so');
});

test('the two hand-off kinds say two different things', () => {
  // 'needs-rebuild' was a third kind while committed HTML carried ?v= asset
  // pins; retired 2026-08-24 with the pins themselves (task 86bbkh288).
  const of = (localVerdict) => conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict }).body;
  const real = of({ kind: 'real-conflict', reason: 'both touched routes/index.js' });
  const couldNotCheck = of({ kind: 'could-not-check', reason: 'the local merge could not run' });
  const noOverlap = of({ kind: 'no-overlap', reason: 'the catch-up merged cleanly but could not be pushed' });
  assert.notEqual(real, couldNotCheck);
  assert.notEqual(couldNotCheck, noOverlap, 'THREE kinds, and the middle two are not one kind');
  assert.match(real, /both changed the same lines/);
  assert.match(real, /never resolve one blind/);
  assert.match(couldNotCheck, /could not check whether that is true/);
  assert.match(noOverlap, /with no overlap at all/);
});

test('an old-style realConflict verdict still reads correctly', () => {
  // Belt and braces: the boolean shape predates `kind`, and a caller that has
  // not been updated must not silently fall through to "unknown".
  const body = conflictHandOffNotice({
    commentId: '77', pr: SOME_PR, localVerdict: { realConflict: true, reason: 'overlap' },
  }).body;
  assert.match(body, /both changed the same lines/,
    'the pre-`kind` boolean shape must still read as a real overlap');
});

test('THE BUG: the hand-off told him his merge still stood, then threw it away', () => {
  // Verbatim from the 2026-08-23 record: the comment said "then your merge
  // still stands and this goes through", and the marker beside it parsed as
  // terminal, so no later pass ever looked again.
  //
  // The verdict here is the stale-GitHub one that day actually was. It used to
  // be written as `null` and rely on null reading as self-healing; review
  // round 2 made that state itself instead of being inferred from an absence.
  const notice = conflictHandOffNotice({
    commentId: '77', pr: SOME_PR,
    localVerdict: { kind: 'no-overlap', reason: 'main merged into the branch with no conflict' },
  });
  assert.equal(markerKind(notice.marker), 'refused');
  // The opening line says what happened, in the operator's own requested
  // shape (2026-08-24). It used to open "Needs a hand", which read as a
  // request for him to do something in a lane where the only thing he owes
  // is the merge word he had already given.
  assert.match(notice.body, /was not able to merge on the last attempt/i);
  assert.ok(notice.body.includes(APPROVAL_CARRIES_OVER));
});

test('the hand-off never asks the operator for a person, or for anything at all', () => {
  // He reads this comment in Ready to launch, which is HIS lane: the only
  // thing owed there is his merge word, and he has already given it. Wording
  // that reads as a request sends him looking for an action that does not
  // exist — he said so on 2026-08-24, about this exact comment.
  for (const localVerdict of [
    null,
    { realConflict: true, reason: 'both touched routes/index.js' },
    { realConflict: false, reason: 'the catch-up could not be pushed' },
  ]) {
    const { body } = conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict });
    assert.doesNotMatch(body, /needs a person|needs a hand/i, `asks for a person: ${body}`);
  }
});

test('only a REAL overlap is denied the "next run" promise', () => {
  // The whole family of bugs behind this ticket is the machine promising an
  // outcome it cannot deliver. A real overlap will hit the same wall next
  // pass, so it must not say the next run merges it; anything else retries
  // usefully and must say so, or he is left wondering whether to act.
  // With a ticket filed there IS an actor, so the "later run" promise is
  // honest; without one the body must not promise a merge at all, which the
  // stalled-hand-off tests above cover.
  const real = conflictHandOffNotice({
    commentId: '77', pr: SOME_PR, filed: FILED,
    localVerdict: { realConflict: true, reason: 'both touched routes/index.js' },
  }).body;
  assert.doesNotMatch(real, /on the next run/i);
  assert.match(real, /on a later run/i);
  assert.match(real, /both changed the same lines/i);

  // Only a PROVEN no-overlap earns the next-run promise (review round 2). The
  // loop here used to include `null` and the legacy `realConflict: false`,
  // neither of which is evidence that anything was checked — and a promise
  // made on no evidence is the family of bug this whole ticket is about.
  const { body } = conflictHandOffNotice({
    commentId: '77', pr: SOME_PR,
    localVerdict: { kind: 'no-overlap', reason: 'the catch-up merged cleanly but could not be pushed' },
  });
  assert.match(body, /merged on the next run/i, `no retry promise: ${body}`);

  for (const localVerdict of [null, { realConflict: false, reason: 'the catch-up could not be pushed' }]) {
    const n = conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict, filed: FILED });
    assert.doesNotMatch(n.body, /merged on the next run/i,
      `a check that never ran may not promise the next run merges it: ${n.body}`);
  }
});

test('the hand-off marker and the reason the plumbing compares are the SAME string', () => {
  // The quieting in clickup_direct.mjs compares the reason a previous pass
  // recorded against the one it just derived. If those two ever differ by a
  // character, a permanently-conflicting ticket gets an identical comment
  // on every pass instead of going silent.
  const notice = conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict: null });
  const derived = notice.marker.replace(/^refused:\s*/, '');
  const readBack = parseMergeMarker(`${MERGE_MARKER} ${notice.marker} — 2026-08-23T10:00:00.000Z`);
  assert.equal(readBack.kind, 'refused');
  assert.equal(readBack.reason, derived);
});

test('MIGRATION: the eleven already-stuck hand-offs read back as re-decidable', () => {
  // Written before this change, so no "refused:" prefix. They must now heal
  // themselves on the next pass rather than needing a command run by hand.
  const legacy = parseMergeMarker(`${MERGE_MARKER} conflict hand-off on PR #380 — 2026-08-23T04:00:00.000Z`);
  assert.equal(legacy.kind, 'refused');
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.reason, 'conflict hand-off on PR #380');

  // ...and the reason it yields is byte-identical to what a NEW hand-off
  // records, so a ticket that is still genuinely conflicted stays quiet
  // instead of being re-announced once per pass.
  const fresh = conflictHandOffNotice({ commentId: '77', pr: SOME_PR, localVerdict: null });
  assert.equal(fresh.marker.replace(/^refused:\s*/, ''), legacy.reason);
});

test('MIGRATION does not reach a merged marker — that stays spent forever', () => {
  for (const spent of [
    'merged PR #380 at 2026-08-22T04:00:00.000Z',
    'conflict hand-off on PR #380 and then some',
    'handed off',
  ]) {
    assert.equal(parseMergeMarker(`${MERGE_MARKER} ${spent} — 2026-08-23T04:00:00.000Z`).kind, 'terminal', spent);
  }
});

test('AC2: a conflict cleared since the hand-off merges on the next pass, unprompted', () => {
  const cmd = c(3, OPERATOR, 'merge');
  const comments = [reviewPassed(1), prOpened(2), cmd];

  // Pass 1 reached 'merge' on the ClickUp side and then hit a conflict at the
  // GitHub gate. Rebuild what bus-relay records: the hand-off marker, parsed
  // back off the reply thread exactly as the live pass does.
  const first = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments });
  assert.equal(first.act, 'merge');
  assert.equal(
    githubGate({ state: 'OPEN', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }).action,
    'conflict',
  );
  const notice = conflictHandOffNotice({ commentId: first.commentId, pr: SOME_PR, localVerdict: null });
  const parsed = latestMergeMarker([marker(4, notice.marker)]);
  const refused = new Map([[first.commentId, parsed.reason]]);

  // Someone merges main into the branch and pushes. Next pass: the SAME
  // authorization is still live — under the old terminal marker it was in
  // `handled` and this decision was never reached at all.
  const second = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments, refused });
  assert.equal(second.act, 'merge');
  assert.equal(second.pr.number, 362);
  assert.equal(second.priorRefusal, 'conflict hand-off on PR #380');
  assert.equal(
    githubGate({
      state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    }).action,
    'merge',
  );
});

test('a still-conflicted ticket stays quiet: the reason it derives is the one it recorded', () => {
  const cmd = c(3, OPERATOR, 'merge');
  const comments = [reviewPassed(1), prOpened(2), cmd];
  const notice = conflictHandOffNotice({ commentId: String(cmd.id), pr: SOME_PR, localVerdict: null });
  const refused = new Map([[String(cmd.id), notice.marker.replace(/^refused:\s*/, '')]]);
  const again = mergeDecision({ status: 'ready to launch', operatorId: OPERATOR, comments, refused });
  // mergeDecision cannot know about the conflict — it lives at the GitHub
  // gate — so it correctly still says 'merge' and hands the plumbing the
  // reason to compare against.
  assert.equal(again.act, 'merge');
  assert.equal(again.priorRefusal, notice.marker.replace(/^refused:\s*/, ''));
});

// ── Merging in one pass (task 86bbk2fb5) ────────────────────────────────────

/**
 * Merging one PR is ~3 minutes of work — catch up, run CI (verify median 85s),
 * merge — and we were achieving 1.25 merges an hour. The cost was the shape:
 * pass N caught the branch up and left, CI finished 85 seconds later, pass N+1
 * merged an hour after that.
 *
 * The rule that makes waiting safe is that running out of budget produces a
 * WAIT — precisely what the pass returned before — and never a merge. These
 * tests exist mostly to defend that asymmetry.
 */

const {
  IN_PASS_WAIT_MS,
  IN_PASS_POLL_MS,
  MAX_IN_PASS_WAITS,
  mayWaitInPass,
  afterCatchUpDecision,
} = require('./mergeOnComment.js');

test('a green PR after the catch-up merges in this pass', () => {
  const out = afterCatchUpDecision({ gate: { action: 'merge', reason: '1 check green' }, elapsedMs: 20_000 });
  assert.equal(out.action, 'merge');
});

test('red during the wait refuses, with the gate\'s own words', () => {
  // No new wording: the existing refusal path handles it, unchanged.
  const out = afterCatchUpDecision({ gate: { action: 'refuse', reason: 'checks are red: verify' }, elapsedMs: 20_000 });
  assert.equal(out.action, 'refuse');
  assert.equal(out.reason, 'checks are red: verify');
});

test('a conflict discovered during the wait goes to the conflict path', () => {
  const out = afterCatchUpDecision({ gate: { action: 'conflict', reason: 'the branch conflicts' }, elapsedMs: 1000 });
  assert.equal(out.action, 'conflict');
});

test('still running inside the budget means ask again', () => {
  const out = afterCatchUpDecision({ gate: { action: 'wait', reason: 'checks still running: verify' }, elapsedMs: 30_000 });
  assert.equal(out.action, 'poll-again');
});

test('a branch that goes behind during the wait ends the wait — polling cannot catch it up', () => {
  // BREAK-TEST: delete the update-branch arm of afterCatchUpDecision and this
  // fails — `assert.equal(out.action, 'update-branch')` reports 'poll-again',
  // which polls out the full budget and then answers "CI was still running"
  // about a branch whose CI was fine and had merely fallen behind main
  // (found in review, 2026-08-30, task 86bbmk7pv).
  const out = afterCatchUpDecision({ gate: { action: 'update-branch', reason: 'the branch is behind main' }, elapsedMs: 1000 });
  assert.equal(out.action, 'update-branch');
  assert.equal(out.reason, 'the branch is behind main');
});

test('OUT OF BUDGET IS A WAIT, never a merge', () => {
  // The whole safety of this feature. A slow CI run must not become either a
  // failure or an unchecked merge — it must become exactly the outcome the
  // pass produced before this existed.
  for (const gate of [
    { action: 'wait', reason: 'checks still running: verify' },
    { action: 'wait', reason: 'GitHub is still computing whether the branch merges cleanly' },
    { action: 'unknown-future-action' },
    {},
  ]) {
    const out = afterCatchUpDecision({ gate, elapsedMs: IN_PASS_WAIT_MS + 1 });
    assert.equal(out.action, 'wait', `${JSON.stringify(gate)} must time out to wait`);
    assert.notEqual(out.action, 'merge');
  }
});

test('the timeout says how long it waited, so the log is readable', () => {
  const out = afterCatchUpDecision({ gate: { action: 'wait' }, elapsedMs: 999_999, budgetMs: 180_000 });
  assert.match(out.reason, /180s/);
  assert.match(out.reason, /next pass/);
});

test('the per-pass cap is enforced, and the extras fall through', () => {
  assert.equal(mayWaitInPass(0), true);
  assert.equal(mayWaitInPass(MAX_IN_PASS_WAITS - 1), true);
  assert.equal(mayWaitInPass(MAX_IN_PASS_WAITS), false, 'the cap must actually stop it');
  assert.equal(mayWaitInPass(MAX_IN_PASS_WAITS + 5), false);
  assert.equal(mayWaitInPass(0, 0), false, 'a cap of zero disables in-pass waiting entirely');
});

test('the budget is a named constant, roughly 2x the observed median', () => {
  // 85s median for `verify`. A literal here is how a tuned number becomes a
  // mystery number six months later.
  assert.equal(typeof IN_PASS_WAIT_MS, 'number');
  // This range is about the MEDIAN, not about the schedule. The tighter of the
  // two constraints is the next test: cap x budget must stay under the relay's
  // interval, which at cap 3 and a 600s interval means a budget under 200s.
  assert.ok(IN_PASS_WAIT_MS >= 120_000 && IN_PASS_WAIT_MS <= 300_000,
    `budget should be ~2x the 85s median, got ${IN_PASS_WAIT_MS}ms`);
  assert.ok(IN_PASS_POLL_MS > 0 && IN_PASS_POLL_MS < IN_PASS_WAIT_MS);
});

test('worst case is bounded — a pass cannot outlast its own interval', () => {
  // launchd runs one instance per Label and COALESCES the firings it misses
  // while a pass is still running, so a long pass can never stack. What it can
  // do is swallow the firing it overran: approvals that arrived meanwhile then
  // wait on work already in flight instead of being picked up next time round.
  //
  // So the bound is the relay's own interval — read from the source of truth
  // rather than written down a second time here. A literal would be a number
  // that stops agreeing with the schedule the moment either one moves, which
  // is exactly what happened to the 15-minute bound this replaces: it was
  // picked when the relay ran hourly, and it survived the change to 10 minutes
  // still permitting a pass 1.5x longer than the whole interval.
  const intervalMs = relayIntervalSeconds() * 1000;
  const worstMs = MAX_IN_PASS_WAITS * IN_PASS_WAIT_MS;
  assert.ok(worstMs < intervalMs,
    `a pass could hold open for ${Math.round(worstMs / 60_000)} minutes, which is not ` +
    `shorter than the ${Math.round(intervalMs / 60_000)}-minute relay interval — it would ` +
    `swallow its own next firing and delay approvals that arrive while it runs`);
});

test('the relay waits after BOTH catch-up paths, and merges the same way', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../clickup_direct.mjs'), 'utf8');

  // Both the GitHub update-branch path and the local false-conflict catch-up
  // must wait — fixing only one leaves half the backlog waiting a full extra
  // interval for no reason.
  //
  // Counting the NAME is not enough: a first version of this assertion counted
  // `waitForChecksInPass(` and a break that left the identifier in place while
  // never calling it passed cleanly. The AWAITED calls are the thing.
  //
  // THREE since 2026-08-26 (task 86bbmk7pv): the two catch-up paths, plus the
  // re-run of a stale review gate, which waits for the same reason — a merge
  // that has to wait three minutes should not wait a whole relay interval.
  const awaited = (src.match(/await waitForChecksInPass\(/g) || []).length;
  assert.equal(awaited, 3,
    `expected exactly 3 awaited calls — two catch-up paths and the stale review-gate re-run — found ${awaited}`);
  assert.match(src, /branch updated from main —/);
  assert.match(src, /re-ran the stale review gate/,
    'the stale review-gate re-run must say so on the console, like every other path here');

  // It must NOT decide mergeability itself. The `gateOf` hook added for the
  // stale-gate re-run narrows when to KEEP WAITING; it can never widen "may
  // merge", because its default is githubGate and the one caller that
  // overrides it composes with githubGate rather than replacing it — through
  // the pure, tested duringRerunWait, whose only pass-through is a FRESH
  // answer (an 'absent' mid-swap rollup keeps waiting; reviewGate.test.js
  // pins that arm by behaviour).
  assert.match(src, /gateOf = githubGate/,
    'the in-pass wait must default to the same gate');
  assert.match(src, /gate: gateOf\(json\)/,
    'the in-pass wait must re-ask the gate it was given, not re-implement it');
  assert.match(src, /reviewGate\.duringRerunWait\(\{\n\s*staleness: reviewGate\.reviewGateStaleness\(\{ rollup: json\.statusCheckRollup, comments \}\),\n\s*gate: githubGate\(json\),/,
    'the stale-gate hook must route through the tested duringRerunWait, composed with githubGate for the actual merge decision');
});

// ── The operator card must not be read as the verdict (task 86bbrem48) ────
// 2026-09-01: four approved tickets sat in `Ready to launch` overnight while
// the queue stood still behind a full WIP cap. The merge step refused each
// one with "the most recent review verdict is not a PASS" — a false
// statement. loop-review's own operator card contains a prose line beginning
// "Review re-ran everything independently on the merged code: ...", the card
// is NEWER than the verdict, and the old pattern (/^\s*REVIEW\b.*$/im)
// matched any line starting with the word "Review". The review pass was
// poisoning its own verdict, permanently: the card can never stop being
// newer than the verdict it accompanies.

// Verbatim shape from 86bbr1u9v, which is the ticket that jammed.
const operatorCard = (t) => c(t, AGENT, [
  'NEEDED FROM DANE: Merge approval on PR #489',
  '',
  'Review re-ran everything independently on the merged code: typecheck clean,',
  '1976 + 1388 tests passing, conventions, syntax, clean build.',
].join('\n'));

test('an operator card posted AFTER the verdict does not become the verdict', () => {
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), reviewPassed(2), operatorCard(3), c(4, OPERATOR, 'merge')],
  });
  assert.equal(d.act, 'merge', 'the newest PASS still governs — the card is prose, not a verdict');
  assert.equal(d.pr.number, 362);
});

test('a prose line beginning "Review" is not a verdict at all', () => {
  assert.equal(isReviewVerdict('Review re-ran everything independently on the merged code'), false);
  assert.equal(isReviewVerdict('Reviewed the branch and it looks fine'), false);
  // Still a verdict, both spellings, both outcomes — the fix narrows the
  // pattern, it does not move it.
  assert.equal(isReviewVerdict('REVIEW: PASSED — verified on the merged code'), true);
  assert.equal(isReviewVerdict('REVIEW PASSED (loop-review, 2026-08-22)'), true);
  assert.equal(isReviewVerdict('REVIEW: sent back to Queued — a blocking finding.'), true);
});

test('DELIBERATE: the fix made the gate STRICTER, never more willing to merge', () => {
  // The one property that must survive: a genuine send-back that is newer
  // than a pass still refuses, even with an operator card in the mix. A fix
  // to a merge gate that loosens it is worse than the bug it repairs.
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [
      prOpened(1),
      reviewPassed(2),
      operatorCard(3),
      c(4, AGENT, 'REVIEW: sent back to Queued — a blocking finding.'),
      c(5, OPERATOR, 'merge'),
    ],
  });
  assert.equal(d.act, 'refuse');
  assert.match(d.reason, /not a PASS/);
});

test('a ticket carrying ONLY a card and no verdict still refuses', () => {
  // The card must not stand in for a verdict in either direction: it cannot
  // block a pass, and it cannot substitute for one.
  const d = mergeDecision({
    status: 'ready to launch',
    operatorId: OPERATOR,
    comments: [prOpened(1), operatorCard(2), c(3, OPERATOR, 'merge')],
  });
  assert.equal(d.act, 'refuse');
  assert.match(d.reason, /no review verdict/);
});

// ── A pasted merge word is still the merge word (task 86bbt038u) ─────────────
//
// The same ClickUp behaviour that swallowed Dane's `resume auto-merging` on
// 2026-09-01 applies here: his `merge` worked only because he typed it by
// hand. Pasting it would have produced a fenced block and been ignored, with
// the ticket sitting in Ready to launch looking like he had never answered.

test('a fenced merge word is a merge command', () => {
  assert.equal(isMergeCommand('```\nmerge\n```'), true);
  assert.equal(isMergeCommand('```cpp\nmerge\n```'), true);
});

test('inline backticks around a merge phrase still count', () => {
  assert.equal(isMergeCommand('`merge it`'), true);
  assert.equal(isMergeCommand('`ship it`'), true);
});

test('stripping the fence does NOT turn the closed set into a substring match', () => {
  assert.equal(isMergeCommand('do not merge this yet'), false);
  assert.equal(isMergeCommand('```\ndo not merge this yet\n```'), false);
  assert.equal(isMergeCommand("I'll approve the design later"), false);
});
