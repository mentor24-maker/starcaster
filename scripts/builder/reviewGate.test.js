'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('./reviewGate.js');
const mergeOnComment = require('./mergeOnComment.js');
const loopTrail = require('./loopTrail.js');

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);

/** A ticket comment in the shape ClickUp actually returns it. */
function comment(text, atMillis, id = String(atMillis)) {
  return { id, comment_text: text, date: String(atMillis), user: { id: 48012725 } };
}

const PASS_COMMENT = (at) => comment(loopTrail.verdictComment(true, 'gates green, looked at it'), at);
const SEND_BACK = (at) => comment(loopTrail.verdictComment(false, 'the panel is staggered'), at);

const BODY_WITH_TICKET = [
  'Adds the thing.',
  '',
  'https://app.clickup.com/t/86bbmfbkv',
  '',
  'How to test: open the page.',
].join('\n');

// ---------------------------------------------------------------------------
// Acceptance criterion 1 — a PASS newer than the head commit passes.
// ---------------------------------------------------------------------------

test('a review PASS newer than the head commit passes the gate', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: new Date(NOW - HOUR).toISOString(),
    comments: [PASS_COMMENT(NOW)],
  });
  // BREAK-TEST: change reviewGate's final branch to return FAIL and this
  // assertion is the one that fails — the whole gate would refuse every
  // properly reviewed PR, which is the loudest possible symptom.
  assert.equal(decision.verdict, gate.PASS);
  assert.equal(decision.ticketId, '86bbmfbkv');
  assert.equal(gate.allowsMerge(decision.verdict), true);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2 — no verdict at all fails, naming the ticket.
// This is the real 86bbjt1aq / PR #432 shape: a ticket with ordinary build
// chatter on it and no REVIEW line anywhere.
// ---------------------------------------------------------------------------

test('the PR #432 shape — a ticket with no review verdict — fails and names the ticket', () => {
  const ticketChatter = [
    comment('PR opened: https://github.com/alphire/starcaster/pull/432', NOW - 4 * HOUR),
    comment('Module chrome shares one grid; image drop shadow.', NOW - 3 * HOUR),
    comment('Loop note: building', NOW - 5 * HOUR),
  ];
  const decision = gate.reviewGateDecision({
    prBody: 'Module chrome shares one grid\n\nhttps://app.clickup.com/t/86bbjt1aq',
    headCommittedAt: NOW - 3 * HOUR,
    comments: ticketChatter,
  });
  // BREAK-TEST: delete the `if (!newestVerdict)` branch and this fails —
  // an unreviewed ticket would read as a PASS, which is exactly the 12:38
  // incident this whole gate exists to prevent.
  assert.equal(decision.verdict, gate.FAIL);
  assert.match(decision.reason, /no review verdict/);
  assert.match(decision.reason, /86bbjt1aq/);
  assert.match(gate.gateMessage(decision, { prNumber: 432 }), /86bbjt1aq/);
});

test('the message on a refusal names the fix, not just the failure', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: NOW,
    comments: [],
  });
  const message = gate.gateMessage(decision, { prNumber: 432 });
  assert.match(message, /What to do:/);
  assert.match(message, /loop-review/);
  assert.match(message, /gate-waived/);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3 — a send-back as the newest verdict fails.
// ---------------------------------------------------------------------------

test('a send-back as the newest verdict fails, even with an older PASS behind it', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: NOW - 4 * HOUR,
    comments: [PASS_COMMENT(NOW - 3 * HOUR), SEND_BACK(NOW - HOUR)],
  });
  // BREAK-TEST: swap `find` for a `some(isReviewPassed)` over all comments
  // and this fails — a ticket passed once and sent back later would merge on
  // the strength of the verdict that was overturned.
  assert.equal(decision.verdict, gate.FAIL);
  assert.match(decision.reason, /send-back, not a PASS/);
});

test('comment order in the payload does not decide the verdict — the dates do', () => {
  const jumbled = [SEND_BACK(NOW - HOUR), PASS_COMMENT(NOW), comment('unrelated note', NOW - 2 * HOUR)];
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: NOW - 2 * HOUR,
    comments: jumbled,
  });
  // BREAK-TEST: remove the sort in byDateNewestFirst and this fails — the
  // gate would read whichever verdict ClickUp happened to list first.
  assert.equal(decision.verdict, gate.PASS);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 4 — a PASS older than the newest commit fails.
// The send-back-then-push case: reviewed, fixed, pushed, and the PASS on the
// ticket now describes code that no longer exists.
// ---------------------------------------------------------------------------

test('a PASS that predates the newest commit fails — it reviewed code that has changed', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: NOW,
    comments: [PASS_COMMENT(NOW - 2 * HOUR)],
  });
  // BREAK-TEST: drop the `verdictAt < headAt` comparison and this fails —
  // every send-back-then-push would merge on a stale review.
  assert.equal(decision.verdict, gate.FAIL);
  assert.match(decision.reason, /older than this PR's newest commit/);
});

test('a PASS at the same instant as the commit passes — equal is not stale', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: NOW,
    comments: [PASS_COMMENT(NOW)],
  });
  assert.equal(decision.verdict, gate.PASS);
});

test('an unreadable date is CANNOT TELL, never a pass', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: 'not-a-date',
    comments: [PASS_COMMENT(NOW)],
  });
  // BREAK-TEST: make the unreadable-date branch return PASS and this fails —
  // the freshness rule would be skippable by handing it a bad timestamp.
  assert.equal(decision.verdict, gate.CANNOT_TELL);
  assert.equal(gate.allowsMerge(decision.verdict), false);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 5 — no ticket link in the body fails.
// ---------------------------------------------------------------------------

test('a PR body with no ClickUp link fails — a PR nobody can trace does not merge', () => {
  const decision = gate.reviewGateDecision({
    prBody: 'Quick fix, no ticket.',
    headCommittedAt: NOW,
    comments: [PASS_COMMENT(NOW)],
  });
  // BREAK-TEST: return PASS when ticketId is empty and this fails — hand-made
  // PRs would route around the gate simply by omitting the link.
  assert.equal(decision.verdict, gate.FAIL);
  assert.match(decision.reason, /no ClickUp ticket link/);
});

test('both live ClickUp link shapes are recognised', () => {
  assert.equal(gate.findTicketId('see https://app.clickup.com/t/86bbmfbkv'), '86bbmfbkv');
  // ClickUp's own "copy link" button includes the workspace id.
  assert.equal(gate.findTicketId('https://app.clickup.com/t/90141423066/86bbmfbkv'), '86bbmfbkv');
  assert.equal(gate.findTicketId('no link here'), '');
});

test('the gate agrees with loopTrail about what counts as a ticket link', () => {
  const body = BODY_WITH_TICKET;
  const id = gate.findTicketId(body);
  // Two readers of the same fact; if they disagreed, `pr-opened` would accept
  // a PR body the gate then refuses to trace.
  assert.equal(loopTrail.prBodyCarriesTicket(body, id, `https://app.clickup.com/t/${id}`), true);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 6 — a waiver passes and is announced.
// ---------------------------------------------------------------------------

test('a [gate-waived: reason] body passes, carries the reason, and is announced', () => {
  const decision = gate.reviewGateDecision({
    prBody: 'Hotfix.\n\n[gate-waived: production is down, no time for the lane]',
    headCommittedAt: NOW,
    comments: null,
  });
  assert.equal(decision.verdict, gate.WAIVED);
  assert.equal(decision.waiverReason, 'production is down, no time for the lane');
  assert.equal(gate.allowsMerge(decision.verdict), true);

  const announcement = gate.waiverAnnouncement({
    prNumber: 432,
    prUrl: 'https://github.com/alphire/starcaster/pull/432',
    reason: decision.waiverReason,
    actor: 'daneofearth',
  });
  // BREAK-TEST: drop the reason from waiverAnnouncement and this fails — an
  // override nobody can read the reason for is not an override, it is a hole.
  assert.match(announcement, /WAIVED on PR #432/);
  assert.match(announcement, /production is down/);
  assert.match(announcement, /pull\/432/);
});

test('a waiver overrides even the missing-ticket rule — that is what it is for', () => {
  const decision = gate.reviewGateDecision({
    prBody: '[gate-waived: emergency revert]',
    headCommittedAt: NOW,
    comments: null,
  });
  assert.equal(decision.verdict, gate.WAIVED);
});

test('an empty waiver is not a waiver — a reason is required', () => {
  const decision = gate.reviewGateDecision({
    prBody: 'https://app.clickup.com/t/86bbmfbkv\n\n[gate-waived: ]',
    headCommittedAt: NOW,
    comments: [],
  });
  // BREAK-TEST: the guard here is the TRUTHINESS check on the captured
  // reason, not the regex — relaxing WAIVER_RE alone changes nothing, because
  // an empty capture is still falsy. Swap `if (waiverReason)` for
  // `if (WAIVER_RE.test(prBody))` and this fails: `[gate-waived:]` becomes a
  // silent, reasonless way past every rule below it. (Verified by mutation.)
  assert.equal(decision.verdict, gate.FAIL);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 7 — the parser is IMPORTED, and the two agree.
// ---------------------------------------------------------------------------

test('the gate and the merge step agree on every fixture verdict', () => {
  const fixtures = [
    'REVIEW: PASSED — gates green',
    'REVIEW PASSED (no colon, the other live spelling)',
    '  REVIEW: PASSED',
    'REVIEW: sent back to Queued — the panel is staggered',
    'REVIEW: sent back to Queued',
    'this is not a REVIEW PASSED situation, just prose about one',
    'PR opened: https://github.com/alphire/starcaster/pull/432',
    'merge',
    '',
  ];

  for (const text of fixtures) {
    const at = NOW;
    const decision = gate.reviewGateDecision({
      prBody: BODY_WITH_TICKET,
      headCommittedAt: at,
      comments: [comment(text, at)],
    });

    const isVerdict = mergeOnComment.isReviewVerdict(text);
    const isPass = mergeOnComment.isReviewPassed(text);

    // The gate's answer must be derivable from the merge step's own two
    // predicates, for every fixture. If someone re-implements the parser
    // here, this is the assertion that catches it.
    const expected = !isVerdict ? gate.FAIL : (isPass ? gate.PASS : gate.FAIL);
    assert.equal(
      decision.verdict,
      expected,
      `gate and merge step disagree about: ${JSON.stringify(text)}`,
    );

    // And the same verdict list must give loopTrail's Ready-to-launch gate
    // the same yes/no, so all three readers of a ticket stay in step.
    const ready = loopTrail.readyToLaunchGate([comment(text, at)]);
    assert.equal(
      ready.ok,
      decision.verdict === gate.PASS,
      `readyToLaunchGate and the review gate disagree about: ${JSON.stringify(text)}`,
    );
  }
});

test('the gate imports the verdict parser rather than re-implementing it', () => {
  const source = require('node:fs').readFileSync(require.resolve('./reviewGate.js'), 'utf8');
  assert.match(source, /require\('\.\/mergeOnComment\.js'\)/);
  // BREAK-TEST: paste a local copy of REVIEW_PASSED_RE into reviewGate.js and
  // this fails — the two could then drift about what a PASS is, which is the
  // one disagreement that must be impossible.
  assert.doesNotMatch(source, /REVIEW\s*\\s\*:\?/);
  assert.doesNotMatch(source, /const\s+REVIEW_PASSED_RE/);
  assert.doesNotMatch(source, /const\s+REVIEW_VERDICT_RE/);
});

// ---------------------------------------------------------------------------
// Acceptance criterion 8 — ClickUp unreachable is CANNOT TELL, never a pass.
// ---------------------------------------------------------------------------

test('unreadable ClickUp comments are CANNOT TELL, never a pass', () => {
  for (const comments of [null, undefined, 'oops', { comments: [] }]) {
    const decision = gate.reviewGateDecision({
      prBody: BODY_WITH_TICKET,
      headCommittedAt: NOW,
      comments,
      clickupError: 'HTTP 503',
    });
    // BREAK-TEST: change the Array.isArray guard to `if (!comments)` and the
    // 'oops' / object cases fall through to "no verdict"→FAIL, which is still
    // safe — but change it to default to `[]` and this fails loudly. A gate
    // that opens when it cannot see is not a gate.
    assert.equal(decision.verdict, gate.CANNOT_TELL, `comments = ${JSON.stringify(comments)}`);
    assert.equal(gate.allowsMerge(decision.verdict), false);
  }
});

test('an empty comment list is NOT the same as an unreadable one', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: NOW,
    comments: [],
  });
  // "I looked and there is nothing" is a FAIL naming the ticket; "I could not
  // look" is a CANNOT TELL naming the outage. Collapsing them would send the
  // reader after the wrong thing.
  assert.equal(decision.verdict, gate.FAIL);
  assert.match(decision.reason, /no review verdict/);
});

test('a missing CI token reads as CANNOT TELL and says which secret is missing', () => {
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: NOW,
    comments: null,
    clickupError: 'CLICKUP_API_TOKEN is not set in this job — the CI secret is missing',
  });
  assert.equal(decision.verdict, gate.CANNOT_TELL);
  assert.match(gate.gateMessage(decision), /CLICKUP_API_TOKEN|token/i);
});

// ---------------------------------------------------------------------------
// Advisory vs enforcing — the half only Dane can switch on.
// ---------------------------------------------------------------------------

test('advisory mode never turns a check red; enforcing mode does', () => {
  for (const verdict of [gate.FAIL, gate.CANNOT_TELL]) {
    // BREAK-TEST: return 1 in advisory mode and this fails. It matters more
    // than it looks: mergeOnComment.githubGate refuses ANY PR with a red
    // check, so an advisory gate that went red would block every relay merge
    // through a rule nobody had agreed to enforce yet.
    assert.equal(gate.exitCodeFor(verdict, false), 0, `${verdict} advisory`);
    assert.equal(gate.exitCodeFor(verdict, true), 1, `${verdict} enforcing`);
  }
  for (const verdict of [gate.PASS, gate.WAIVED]) {
    assert.equal(gate.exitCodeFor(verdict, false), 0);
    assert.equal(gate.exitCodeFor(verdict, true), 0);
  }
});

test('the enforcing switch reads only explicit yes values', () => {
  for (const on of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
    assert.equal(gate.isEnforcing(on), true, `"${on}" should enable enforcement`);
  }
  for (const off of ['', undefined, null, 'false', '0', 'no', 'maybe', 'off']) {
    // BREAK-TEST: make this `Boolean(value)` and the string 'false' turns the
    // gate on — the opposite of what the person setting it meant.
    assert.equal(gate.isEnforcing(off), false, `"${off}" should not enable enforcement`);
  }
});

// ---------------------------------------------------------------------------
// The workflow wiring — the parts a unit test can still hold still.
// ---------------------------------------------------------------------------

test('the workflow runs the gate, feeds it the token, and never invents a secret name', () => {
  const yml = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', '.github', 'workflows', 'review-gate.yml'),
    'utf8',
  );
  assert.match(yml, /name:\s*review-gate/);
  assert.match(yml, /on:\s*\n\s*pull_request:/);
  assert.match(yml, /node scripts\/review_gate\.mjs/);
  // The token name matches the one the rest of the repo already uses, rather
  // than a new one made up for CI (task non-goal: "do not invent a CI secret").
  assert.match(yml, /CLICKUP_API_TOKEN:\s*\$\{\{\s*secrets\.CLICKUP_API_TOKEN\s*\}\}/);
  assert.match(yml, /REVIEW_GATE_ENFORCING:\s*\$\{\{\s*vars\.REVIEW_GATE_ENFORCING\s*\}\}/);
  // `edited` matters: adding the ticket link IS the fix for one of the
  // refusals, and a gate blind to its own fix sends people to a re-run button.
  assert.match(yml, /types:\s*\[[^\]]*edited[^\]]*\]/);
});

test('the ClickUp token name the gate reads is the one the repo already uses', () => {
  const direct = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'clickup_direct.mjs'),
    'utf8',
  );
  const runner = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'review_gate.mjs'),
    'utf8',
  );
  assert.match(direct, /process\.env\.CLICKUP_API_TOKEN/);
  assert.match(runner, /process\.env\.CLICKUP_API_TOKEN/);
});

// ---------------------------------------------------------------------------
// Freshness measures the branch's OWN commits, not its catch-up merges.
//
// Found while checking the gate against live PRs before shipping it, which is
// the step the ticket asked for ("confirm it does not false-fail"). #406 was
// reviewed and passed at 14:11 on 08-23; its three later commits were all
// `Merge remote-tracking branch 'origin/main'`, because branch protection is
// strict and this repo catches up by merging rather than rebasing. A naive
// "newest commit" rule failed it, and #400, and would have deadlocked the
// pipeline: catch up, go stale, re-review, catch up again.
// ---------------------------------------------------------------------------

test('a catch-up merge after the review does not make the review stale', () => {
  // The exact shape of PR #406.
  const commits = [
    { committedDate: '2026-08-23T14:04:20Z', parents: 1 },
    { committedDate: '2026-08-23T14:05:08Z', parents: 1 },
    { committedDate: '2026-08-24T02:02:58Z', parents: 2 },
    { committedDate: '2026-08-24T02:54:12Z', parents: 2 },
    { committedDate: '2026-08-24T03:01:34Z', parents: 2 },
  ];
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: gate.newestSubstantiveCommitAt(commits),
    comments: [PASS_COMMENT(Date.parse('2026-08-23T14:11:57Z'))],
  });
  // BREAK-TEST: make newestSubstantiveCommitAt return the newest commit of
  // any kind and this fails. It is the difference between a gate that can be
  // switched on and one that refuses every merge the relay makes.
  assert.equal(decision.verdict, gate.PASS);
});

test('a real commit pushed after the review still makes it stale', () => {
  const commits = [
    { committedDate: '2026-08-23T14:04:20Z', parents: 1 },
    { committedDate: '2026-08-24T02:02:58Z', parents: 2 },
    // A genuine fix, pushed after the send-back.
    { committedDate: '2026-08-24T09:00:00Z', parents: 1 },
  ];
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: gate.newestSubstantiveCommitAt(commits),
    comments: [PASS_COMMENT(Date.parse('2026-08-23T14:11:57Z'))],
  });
  // BREAK-TEST: skip ALL commits rather than only merges and this fails —
  // the freshness rule would stop existing, which is criterion 4's whole point.
  assert.equal(decision.verdict, gate.FAIL);
  assert.match(decision.reason, /older than this PR's newest commit/);
});

test('a merge commit is detected by parent count, not by its message', () => {
  const byParents = gate.newestSubstantiveCommitAt([
    { committedDate: '2026-08-23T10:00:00Z', parents: 1 },
    // No message anywhere in the input: the rule cannot be depending on one.
    { committedDate: '2026-08-24T10:00:00Z', parents: 2 },
  ]);
  assert.equal(byParents, Date.parse('2026-08-23T10:00:00Z'));
});

test('a PR made only of merge commits falls back to the strictest reading', () => {
  const allMerges = [
    { committedDate: '2026-08-23T10:00:00Z', parents: 2 },
    { committedDate: '2026-08-24T10:00:00Z', parents: 2 },
  ];
  // BREAK-TEST: drop the `own.length ? own : dated` fallback and this returns
  // -Infinity, which reads as "reviewed forever ago" — a pass, silently, on a
  // PR with no freshness rule at all.
  assert.equal(gate.newestSubstantiveCommitAt(allMerges), Date.parse('2026-08-24T10:00:00Z'));
});

test('missing parent information counts every commit — the safe direction', () => {
  // What the runner falls back to when the REST commit list cannot be read.
  const noParents = [
    { committedDate: '2026-08-23T10:00:00Z' },
    { committedDate: '2026-08-24T10:00:00Z' },
  ];
  assert.equal(gate.newestSubstantiveCommitAt(noParents), Date.parse('2026-08-24T10:00:00Z'));
});

test('no commits at all is not a date, so the gate answers CANNOT TELL', () => {
  assert.equal(Number.isFinite(gate.newestSubstantiveCommitAt([])), false);
  const decision = gate.reviewGateDecision({
    prBody: BODY_WITH_TICKET,
    headCommittedAt: gate.newestSubstantiveCommitAt([]),
    comments: [PASS_COMMENT(NOW)],
  });
  assert.equal(decision.verdict, gate.CANNOT_TELL);
});

// ---------------------------------------------------------------------------
// A waiver must be an INSTRUCTION, not a mention.
//
// Caught by the very first CI run of this gate, on its own pull request. The
// PR describing the gate necessarily documents the waiver syntax — and the
// first version of WAIVER_RE matched anywhere in the body, so the gate read
// its own documentation as a live waiver and let itself straight through.
// Any PR quoting the syntax would have bypassed the gate while looking
// entirely ordinary. Same fix, and the same reasoning, as mergeOnComment
// anchoring its verdict regexes: prose about a rule is not the rule.
// ---------------------------------------------------------------------------

test('documenting the waiver syntax does not waive the gate', () => {
  // The real PR #433 body shape, trimmed to the parts that matter.
  //
  // Every mention here carries a REALISTIC reason on purpose. The first
  // version of this fixture led with `<reason>`, and because findWaiver only
  // ever read the FIRST match, the placeholder guard answered it and this
  // test passed with the anchors removed — a break-test that could not break,
  // on the one bug that actually escaped (found in review, 2026-08-25). The
  // only thing standing between this body and a waiver is now the anchoring.
  const docBody = [
    'https://app.clickup.com/t/86bbmfbkv',
    '',
    'There is an escape hatch: writing `[gate-waived: production is down]`',
    'in the body lets it through.',
    '',
    '| Situation | Verdict |',
    '|---|---|',
    '| `[gate-waived: hotfix, site is down]` in the PR body | **pass**, announced |',
  ].join('\n');

  // BREAK-TEST: drop the ^...$ anchors from WAIVER_RE and this fails —
  // observed failing on both assertions below, with 'production is down'
  // returned from a sentence. That is exactly what shipped for one CI run,
  // and the gate waived itself.
  assert.equal(gate.findWaiver(docBody), '');

  const decision = gate.reviewGateDecision({
    prBody: docBody,
    headCommittedAt: NOW,
    comments: [],
  });
  assert.equal(decision.verdict, gate.FAIL);
  assert.match(decision.reason, /no review verdict/);
});

// ---------------------------------------------------------------------------
// The same weakness, one step further out — found in review, 2026-08-25.
//
// The line anchor stops a mention inside a sentence, but not a realistic
// example sitting ALONE inside a code fence, which is exactly how this repo
// writes down its own rules. The next docs page with a plausible reason in it
// would have waived the gate silently.
// ---------------------------------------------------------------------------

test('a realistic waiver shown as a code example does not waive the gate', () => {
  const fenced = [
    'https://app.clickup.com/t/86bbmfbkv',
    '',
    'To override, put this on a line of its own:',
    '',
    '```',
    '[gate-waived: production is down]',
    '```',
    '',
    'and it is announced on the bus.',
  ].join('\n');

  // BREAK-TEST: delete the CODE_FENCE_RE branch in findWaiver and this fails
  // — observed returning 'production is down', i.e. a docs page describing
  // the override would have used it.
  assert.equal(gate.findWaiver(fenced), '');
  assert.equal(
    gate.reviewGateDecision({ prBody: fenced, headCommittedAt: NOW, comments: [] }).verdict,
    gate.FAIL,
  );

  // Tildes are the other fence Markdown accepts, and a four-space indent is
  // the third way to show code.
  assert.equal(gate.findWaiver('~~~\n[gate-waived: production is down]\n~~~'), '');
  // BREAK-TEST: delete the INDENTED_CODE_RE branch and this line fails.
  assert.equal(gate.findWaiver('Example:\n\n    [gate-waived: production is down]\n'), '');

  // A single backtick pair is not a fence, but inline code is not a line of
  // its own either — the anchor already refuses it.
  assert.equal(gate.findWaiver('`[gate-waived: production is down]`'), '');
});

test('an unclosed fence hides the rest of the body — losing a waiver, never granting one', () => {
  const body = 'https://app.clickup.com/t/86bbmfbkv\n\n```\nsome output\n\n[gate-waived: real reason]';
  // Fail-closed by design: the gate goes on to check the ticket rather than
  // opening. BREAK-TEST: make the fence skip fail OPEN (scan fenced lines
  // when the fence never closes) and this returns 'real reason'.
  assert.equal(gate.findWaiver(body), '');
});

test('a placeholder does not stop the search — the next line is still read', () => {
  // The mechanism behind the un-failable break-test above: rejecting a
  // placeholder must skip that ONE line, not abandon the body.
  const body = '[gate-waived: <reason>]\n[gate-waived: production is down]';
  assert.equal(gate.findWaiver(body), 'production is down');
});

test('a waiver alone on its line still works, in the shapes people actually write', () => {
  const shapes = [
    '[gate-waived: production is down]',
    'Hotfix.\n\n[gate-waived: production is down]\n\nMore detail below.',
    '- [gate-waived: production is down]',
    '  [gate-waived: production is down]  ',
    '> [gate-waived: production is down]',
  ];
  for (const body of shapes) {
    assert.equal(gate.findWaiver(body), 'production is down', `shape: ${JSON.stringify(body)}`);
  }
});

test('a placeholder copied out of the documentation is not a reason', () => {
  // BREAK-TEST: remove the PLACEHOLDER_REASON_RE check and this fails — a
  // pasted example on its own line becomes a working waiver.
  assert.equal(gate.findWaiver('[gate-waived: <reason>]'), '');
  assert.equal(gate.findWaiver('[gate-waived: <your reason here>]'), '');
  // A real reason that merely contains angle brackets is still a reason.
  assert.equal(gate.findWaiver('[gate-waived: revert <script> injection fix]'), 'revert <script> injection fix');
});

test('a waiver cannot smuggle itself in on the same line as other text', () => {
  assert.equal(gate.findWaiver('fixes things [gate-waived: because] and ships'), '');
  assert.equal(gate.findWaiver('[gate-waived: because] and ships'), '');
});
