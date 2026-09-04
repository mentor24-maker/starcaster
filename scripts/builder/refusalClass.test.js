'use strict';

/**
 * Task 86bbtqpxd — a terminal merge refusal must stop saying the approval is
 * still standing.
 *
 * Ticket 86bbqw49y sat in Ready to launch for twelve hours with its work
 * already merged and live. Twenty-five refusal comments, sixteen of them for
 * "the PR is already merged" — a reason no later pass could ever clear —
 * every one of them closing with "your approval is still standing ... it goes
 * through on its own". The reassurance is what stopped anybody looking.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  REFUSAL_CODES,
  REFUSAL_CLASSES,
  REFUSAL_REASONS,
  classifyRefusal,
  speaksAsTerminal,
  refusalNeeds,
} = require('./refusalClass.js');

const {
  refusalNotice,
  githubGate,
  mergeDecision,
  APPROVAL_CARRIES_OVER,
} = require('./mergeOnComment.js');

// ---------- AC1: every reason is classified, and there is no default

test('every code has an entry, and every entry has a code — no orphans either way', () => {
  const codes = Object.values(REFUSAL_CODES);
  assert.ok(codes.length >= 15, 'the table should cover every refusal the merge step can raise');
  for (const code of codes) {
    const entry = REFUSAL_REASONS[code];
    assert.ok(entry, `code "${code}" is raised but has no classification entry`);
    assert.ok(REFUSAL_CLASSES.includes(entry.kind), `code "${code}" has kind "${entry.kind}", not one of ${REFUSAL_CLASSES.join('/')}`);
  }
  for (const key of Object.keys(REFUSAL_REASONS)) {
    assert.ok(codes.includes(key), `entry "${key}" is classified but no code names it — dead entry`);
  }
});

test('THE RULE: a reason absent from the table throws — there is no default', () => {
  // Break test 1 from the ticket: add a refusal reason without classifying it.
  assert.throws(
    () => classifyRefusal('a-brand-new-reason-nobody-classified'),
    /unclassified merge refusal reason/,
    'an unclassified reason must fail loudly, never inherit a promise by default',
  );
  assert.throws(() => classifyRefusal(undefined), /unclassified merge refusal reason/);
  assert.throws(() => classifyRefusal(''), /unclassified merge refusal reason/);
});

test('a "could not tell" is its own class and SPEAKS as terminal', () => {
  // DOCTRINE 3.11: a reader who cannot be told to wait must be told to look.
  const unknowns = Object.entries(REFUSAL_REASONS).filter(([, e]) => e.kind === 'unknown');
  assert.ok(unknowns.length >= 3, 'the CANNOT TELL answers must be classified, not folded into terminal or transient');
  for (const [code] of unknowns) {
    assert.equal(speaksAsTerminal(code), true, `${code}: unknown must speak as terminal`);
  }
});

test('every raise site in mergeOnComment.js carries a code', () => {
  // The source scan is the guard that a NEW refusal cannot be added without a
  // classification. `classifyRefusal` catches a WRONG code at runtime; this
  // catches a MISSING one, which is the likelier mistake — a refusal added by
  // copying the line above it.
  //
  // Counted rather than matched inside each object literal, because those
  // literals carry template strings with `${...}` in them and a brace-matching
  // regex over that is a second parser waiting to be wrong.
  const src = fs.readFileSync(path.join(__dirname, 'mergeOnComment.js'), 'utf8');
  const count = (re) => (src.match(re) || []).length;

  const gateRefusals = count(/action: 'refuse'/g);
  const gateCodes = count(/refusalCode: R\./g);
  assert.ok(gateRefusals >= 9, `expected githubGate's refusals to be found; saw ${gateRefusals}`);
  assert.equal(gateCodes, gateRefusals,
    `${gateRefusals} refusals are raised with "action: 'refuse'" but only ${gateCodes} carry a "refusalCode: R.<code>" — a refusal was added without classifying it`);

  // mergeDecision raises through its own helper, which takes the code first.
  const decisionRefusals = count(/\brefuse\(/g);
  const decisionCoded = count(/\brefuse\(R\./g);
  assert.ok(decisionCoded >= 4, `expected mergeDecision's refusals to be found; saw ${decisionCoded}`);
  assert.equal(decisionCoded, decisionRefusals,
    `${decisionRefusals} calls to refuse() but only ${decisionCoded} name a code from REFUSAL_CODES`);
});

// ---------- AC2: a terminal refusal drops the promise and names the actor

/** Every code, rendered as the comment the operator actually reads. */
function noticeFor(code) {
  return refusalNotice({
    commentId: '900',
    why: `some reason for ${code}`,
    plainEnglish: 'This ticket is not in a state a script may merge from.',
    refusalCode: code,
  });
}

test('THE BUG: a terminal refusal never says the approval is still standing', () => {
  // Break test 2 from the ticket: force `already merged` and read the message.
  const notice = noticeFor(REFUSAL_CODES.prAlreadyMerged);
  assert.equal(notice.terminal, true);
  assert.ok(
    !notice.body.includes(APPROVAL_CARRIES_OVER),
    'the standing-approval paragraph is the sentence that cost twelve hours; it must be absent',
  );
  assert.ok(!/goes through on its own/.test(notice.body), 'nothing may imply a later pass will handle it');
  assert.match(notice.body, /This PR is merged; the work is live/);
  assert.match(notice.body, /moving to Live/);
});

test('every terminal and unknown reason drops the promise; every transient one keeps it', () => {
  for (const code of Object.values(REFUSAL_CODES)) {
    const notice = noticeFor(code);
    const promises = notice.body.includes(APPROVAL_CARRIES_OVER);
    const terminal = speaksAsTerminal(code);
    assert.equal(promises, !terminal,
      `${code} (${classifyRefusal(code).kind}): body ${promises ? 'promises' : 'does not promise'} the approval carries over and should ${terminal ? 'not ' : ''}`);
    assert.equal(notice.terminal, terminal);
    assert.equal(notice.actor, terminal ? 'agent-or-operator' : 'later-pass');
  }
});

test('AC: every terminal message names WHO must act — never an unnamed actor', () => {
  // docs/DOCTRINE.md §2.5. A hand-off that cannot name an actor does not get
  // to imply one; "this needs to be dealt with" is the defect, not the fix.
  const BANNED = [
    /\bsomebody\b/i, /\bsomeone\b/i, /\banybody\b/i, /\banyone\b/i,
    /needs to be (?:dealt with|looked at|handled)/i,
    /will be (?:dealt with|looked at|handled)/i,
  ];
  for (const code of Object.values(REFUSAL_CODES)) {
    if (!speaksAsTerminal(code)) {
      assert.equal(refusalNeeds(code), '', `${code}: a transient reason must not carry a "what to do" sentence`);
      continue;
    }
    const needs = refusalNeeds(code);
    assert.ok(needs, `${code}: a terminal reason must say what it needs instead of the promise`);
    assert.match(needs, /an agent session|Dane/i, `${code}: names no actor — "${needs}"`);
    for (const banned of BANNED) {
      assert.ok(!banned.test(needs), `${code}: passive/unnamed actor matched ${banned} — "${needs}"`);
    }
    assert.match(needs, /will not ask again|will not post about it again/i,
      `${code}: a terminal refusal must say out loud that nothing further is coming`);
  }
});

test('refusalNotice REFUSES to render without a classification', () => {
  assert.throws(
    () => refusalNotice({ commentId: '1', why: 'x', plainEnglish: 'y' }),
    /unclassified merge refusal reason/,
    'an unclassified refusal must not be able to reach the operator at all',
  );
});

// ---------- the codes actually reach the notices from the real raise sites

const PR_URL = 'https://github.com/o/r/pull/512';
const VERDICT = { id: '1', date: '1000', user: { id: 9 }, comment_text: 'REVIEW: PASSED (everything green)' };
const PR_TRAIL = { id: '2', date: '1001', user: { id: 9 }, comment_text: `PR opened: ${PR_URL}` };
const MERGE_WORD = { id: '3', date: '2000', user: { id: 42 }, comment_text: 'merge' };

function decide(comments, refused) {
  return mergeDecision({
    status: 'Ready to launch',
    comments: [...comments].reverse(),
    operatorId: 42,
    handled: new Set(),
    refused,
  });
}

test('mergeDecision hands its refusals out with the code attached', () => {
  const noVerdict = decide([PR_TRAIL, MERGE_WORD]);
  assert.equal(noVerdict.act, 'refuse');
  assert.equal(noVerdict.refusalCode, REFUSAL_CODES.noReviewVerdict);
  assert.equal(speaksAsTerminal(noVerdict.refusalCode), false, 'loop-review will write the verdict — genuinely transient');

  const noPr = decide([VERDICT, MERGE_WORD]);
  assert.equal(noPr.act, 'refuse');
  assert.equal(noPr.refusalCode, REFUSAL_CODES.noPrRecorded);
  assert.equal(speaksAsTerminal(noPr.refusalCode), true, 'no later pass can invent a PR link');
});

test('githubGate hands its refusals out with the code attached', () => {
  assert.equal(githubGate({ state: 'MERGED' }).refusalCode, REFUSAL_CODES.prAlreadyMerged);
  assert.equal(githubGate({ state: 'CLOSED' }).refusalCode, REFUSAL_CODES.prNotOpen);
  assert.equal(githubGate({ state: 'OPEN', isDraft: true }).refusalCode, REFUSAL_CODES.prIsDraft);
  const red = githubGate({
    state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    statusCheckRollup: [{ name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE' }],
  });
  assert.equal(red.refusalCode, REFUSAL_CODES.checksRed);
  const noChecks = githubGate({
    state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [],
  });
  assert.equal(noChecks.refusalCode, REFUSAL_CODES.noChecksAtAll);
  assert.equal(speaksAsTerminal(noChecks.refusalCode), true,
    'GitHub creates a check run for a push, not for waiting — a checkless PR stays checkless');
});

test('the three reasons from the 86bbqw49y wreck classify the way the incident showed', () => {
  // The ticket's own table: 16 already-merged (terminal), 3 no-PR-opened
  // (terminal), 6 no-review-verdict (transient). Two thirds of the refusals
  // told the reader to wait for something that was never coming.
  assert.equal(classifyRefusal(REFUSAL_CODES.prAlreadyMerged).kind, 'terminal');
  assert.equal(classifyRefusal(REFUSAL_CODES.noPrRecorded).kind, 'terminal');
  assert.equal(classifyRefusal(REFUSAL_CODES.noReviewVerdict).kind, 'transient');
});

// ---------- AC3: one comment, one bus post, then it stops

/**
 * THE ESCALATION SHAPE. A terminal refusal is the end of the line, so it says
 * so once and goes quiet — it must not bury the ticket in identical comments,
 * and it must not go quiet while still sounding like progress. The first half
 * is the dedup, tested here across three consecutive passes; the second half
 * is the wording, tested above.
 *
 * This drives the REAL decision function with the marker the previous pass
 * would have written, which is exactly what the relay does (it reads its own
 * markers back off the ticket).
 */
test('AC3: three consecutive passes over a terminal refusal post ONE comment', () => {
  const comments = [VERDICT, MERGE_WORD]; // a verdict and his word, but no PR trail
  const posted = [];
  const refused = new Map();

  for (let pass = 1; pass <= 3; pass += 1) {
    const decision = decide(comments, refused);
    if (decision.act === 'refuse') {
      // What the relay does: post the notice, then record the marker.
      posted.push(refusalNotice({
        commentId: decision.commentId,
        why: decision.reason,
        plainEnglish: 'This ticket is not in a state a script may merge from.',
        refusalCode: decision.refusalCode,
      }));
      refused.set(String(decision.commentId), decision.reason);
    } else {
      assert.equal(decision.act, 'ignore', `pass ${pass}: a repeat must be quiet, not a second refusal`);
      assert.match(decision.reason, /already refused for the same reason/);
    }
  }

  assert.equal(posted.length, 1, 'three passes, one comment — the repeat is not news');
  assert.equal(posted[0].terminal, true);
  assert.ok(!posted[0].body.includes(APPROVAL_CARRIES_OVER));
  // And the one comment that DID go out says nothing further is coming, which
  // is what turns "went quiet" from a silence into a full stop.
  assert.match(posted[0].body, /will not ask again/i);
});

test('a TRANSIENT refusal goes quiet the same way — the dedup is not the defect', () => {
  // Worth pinning: the fix is to the WORDING and the escalation, not to the
  // dedup. Quieting an unchanged repeat was always right.
  const comments = [PR_TRAIL, MERGE_WORD]; // no verdict yet
  const refused = new Map();
  const first = decide(comments, refused);
  assert.equal(first.act, 'refuse');
  refused.set(String(first.commentId), first.reason);
  const second = decide(comments, refused);
  assert.equal(second.act, 'ignore');
  assert.equal(second.refusalCode, REFUSAL_CODES.noReviewVerdict, 'even a quiet repeat carries its code');
});
