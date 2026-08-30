'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONFLICT_TICKET_TRAIL,
  STALE_HAND_OFF_MS,
  conflictTicketFiledComment,
  findConflictTicket,
  conflictTicketName,
  conflictTicketBody,
  ageText,
  handOffStalled,
  stalledHandOffLine,
} = require('./conflictWork.js');

const PR = { number: 434, url: 'https://github.com/mentor24-maker/starcaster/pull/434', repo: 'starcaster' };
const TASK = { id: '86bbmfc15', name: 'A sanctioned way to clear the decks', url: 'https://app.clickup.com/t/86bbmfc15' };
const FILED = { id: '86bbzzzzz', url: 'https://app.clickup.com/t/86bbzzzzz' };

let nextId = 1;
const comment = (text) => ({ id: String(nextId++), date: '1000', comment_text: text });

// ---------------------------------------------------------------- the trail

test('the comment it writes is the comment it reads back', () => {
  // Same discipline as loopTrail: a trail the next pass cannot parse is not a
  // trail. If these two ever drift, a conflict is re-filed on every pass.
  const written = conflictTicketFiledComment({ id: FILED.id, url: FILED.url, prNumber: PR.number });
  assert.ok(written.startsWith(CONFLICT_TICKET_TRAIL));
  const read = findConflictTicket([comment(written)], PR.number);
  assert.ok(read, 'the freshly written comment must parse back');
  assert.equal(read.id, FILED.id);
  assert.equal(read.url, FILED.url);
});

test('THE DUPLICATE GUARD: a conflict already filed is never filed twice', () => {
  // The merge step runs every pass. Without this, a conflict that persists for
  // a day files twenty-four identical tickets into the queue the build loop is
  // trying to drain.
  const comments = [
    comment('PR opened: https://github.com/mentor24-maker/starcaster/pull/434'),
    comment(conflictTicketFiledComment({ id: FILED.id, url: FILED.url, prNumber: 434 })),
    comment('merge'),
  ];
  assert.equal(findConflictTicket(comments, 434).id, FILED.id);
});

test('a ticket filed for a DIFFERENT PR does not count as this one', () => {
  // A rebuilt ticket carries the trail of the PR before it. Matching that
  // would leave the new conflict unfiled while reporting an actor that is
  // working on something else.
  const comments = [comment(conflictTicketFiledComment({ id: FILED.id, url: FILED.url, prNumber: 380 }))];
  assert.equal(findConflictTicket(comments, 434), null);
});

test('no trail at all reads as "nothing is filed", not as an error', () => {
  assert.equal(findConflictTicket([], 434), null);
  assert.equal(findConflictTicket([comment('merge'), comment('looks good')], 434), null);
  assert.equal(findConflictTicket(null, 434), null);
});

test('prose that merely mentions a conflict ticket is not a trail', () => {
  const comments = [comment('I think the conflict ticket for PR #434 is somewhere in the queue')];
  assert.equal(findConflictTicket(comments, 434), null);
});

// ------------------------------------------------------- the filed ticket

test('the filed ticket names the branch a session has to check out', () => {
  const name = conflictTicketName({ pr: PR, branch: 'pipeline-pause' });
  assert.match(name, /#434/);
  assert.match(name, /pipeline-pause/);
});

test('the filed ticket tells its builder NOT to ask Dane to approve again', () => {
  // task 86bbk0g4u removed the second-approval failure once. A ticket that
  // reintroduces it by asking him from a different direction is the same bug.
  const body = conflictTicketBody({
    task: TASK, pr: PR, branch: 'pipeline-pause', commentId: '77',
    localVerdict: { kind: 'real-conflict', reason: 'both touched scripts/clickup_direct.mjs' },
  });
  assert.match(body, /Do NOT ask Dane to say "merge" again/);
  assert.match(body, /86bbmfc15/, 'it must link back to the ticket that is waiting');
  assert.match(body, /pipeline-pause/, 'and name the branch');
  assert.match(body, /both touched scripts\/clickup_direct\.mjs/, 'and carry WHY it conflicts');
  assert.match(body, /never rebase-and-force/, 'DOCTRINE 6.6 travels with the work');
});

test('the filed ticket says what it is when the local check could not run', () => {
  const body = conflictTicketBody({
    task: TASK, pr: PR, branch: 'x', commentId: '77',
    localVerdict: { kind: 'unknown', reason: 'the worktree could not be created' },
  });
  assert.match(body, /could not check whether that is true/);
});

// ------------------------------------------------------------- staleness

test('THE THREE DAYS: no ticket filed is stalled from the very first pass', () => {
  // PR #434 sat from 2026-08-26 to 2026-08-29 while every pass logged
  // "MERGE HANDED OFF (unchanged, nothing posted)" and "0 merged". Quiet was
  // correct behaviour and the design had no actor behind it.
  const s = handOffStalled({ at: new Date().toISOString(), now: Date.now(), filed: null });
  assert.equal(s.stalled, true);
  assert.match(s.why, /nothing is going to pick this up/i);
});

test('a freshly filed ticket buys silence — that is the whole point of filing it', () => {
  const now = Date.parse('2026-08-30T12:00:00.000Z');
  const s = handOffStalled({ at: '2026-08-30T11:00:00.000Z', now, filed: FILED });
  assert.equal(s.stalled, false);
});

test('a filed ticket that has not cleared it in a day stops being silent', () => {
  const now = Date.parse('2026-08-30T12:00:00.000Z');
  const s = handOffStalled({ at: '2026-08-28T11:00:00.000Z', now, filed: FILED });
  assert.equal(s.stalled, true);
  assert.match(s.why, /86bbzzzzz/, 'the report must name the ticket that is not moving');
  assert.match(s.why, /2 days/);
});

test('the threshold is a named constant, and it is under the three days that caused this', () => {
  assert.equal(STALE_HAND_OFF_MS, 24 * 60 * 60 * 1000);
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  assert.ok(STALE_HAND_OFF_MS < threeDays,
    'a threshold at or above the incident duration would not have caught the incident');
});

test('an unreadable timestamp counts as stalled — fail safe, the same as everywhere else', () => {
  // "nobody is working on it" and "I cannot tell" look identical, and only one
  // of them is safe to sit on quietly.
  for (const at of ['', null, undefined, 'not a date']) {
    assert.equal(handOffStalled({ at, now: Date.now(), filed: FILED }).stalled, true, String(at));
  }
});

test('the age reads in plain language, not milliseconds', () => {
  assert.equal(ageText(5 * 60 * 1000), '5 minutes');
  assert.equal(ageText(60 * 1000), '1 minute');
  assert.equal(ageText(3 * 60 * 60 * 1000), '3 hours');
  assert.equal(ageText(72 * 60 * 60 * 1000), '3 days');
  assert.equal(ageText(24 * 60 * 60 * 1000), '24 hours');
  assert.equal(ageText(-1), 'an unknown time');
  assert.equal(ageText('nonsense'), 'an unknown time');
});

test('the stalled report line names the actor, or says out loud there is none', () => {
  const withTicket = stalledHandOffLine({
    task: TASK, pr: PR, filed: FILED,
    stalled: { stalled: true, why: 'conflict ticket 86bbzzzzz has been open 2 days without clearing this conflict' },
  });
  assert.match(withTicket, /86bbzzzzz/);
  assert.match(withTicket, /filed as/);

  const without = stalledHandOffLine({
    task: TASK, pr: PR, filed: null,
    stalled: { stalled: true, why: 'no conflict ticket has been filed, so nothing is going to pick this up' },
  });
  assert.match(without, /NOT filed anywhere — no actor exists for it/);
});

// ------------------------------------------------- the wiring, checked flat

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8');

test('the merge step files the ticket BEFORE it builds the hand-off comment', () => {
  // Order is load-bearing: the body's promise is decided by whether a ticket
  // exists, so filing after building it would always report "nobody".
  const fileAt = SCRIPT.indexOf('filed = await fileConflictTicket(');
  const noticeAt = SCRIPT.indexOf('const notice = conflictHandOffNotice(');
  assert.ok(fileAt > 0, 'the merge step must file a conflict ticket');
  assert.ok(noticeAt > 0);
  assert.ok(fileAt < noticeAt, 'the ticket must be filed before the notice that names it is built');
});

test('the conflict ticket is filed into the Loop Queue as Queued — the list the build loop drains', () => {
  // Dane's option C, 2026-08-30. Any other list has no consumer, which is the
  // bug: the bus had none either.
  const fn = SCRIPT.slice(SCRIPT.indexOf('async function fileConflictTicket'), SCRIPT.indexOf('async function runMergeStep'));
  assert.match(fn, /\$\{LOOP_QUEUE_LIST\}\/task/, 'it must file into the Loop Queue');
  assert.match(fn, /status: 'Queued'/, 'and as Queued, or no build loop will claim it');
  assert.match(fn, /PRIORITY\.high/, 'High — Urgent is the operator lane');
});

test('the old bus post no longer asks an empty room for a session', () => {
  // The exact sentence that went nowhere for three days.
  assert.ok(
    !/a session needs to resolve the conflict and push/.test(SCRIPT),
    'the bus post must not request an actor the bus cannot deliver',
  );
});

test('a failure to file is reported, never swallowed', () => {
  // DOCTRINE 3.11: a sweep must report what it could not check. An unfiled
  // conflict with a silent catch is the original bug wearing a new hat.
  const fn = SCRIPT.slice(SCRIPT.indexOf('async function fileConflictTicket'), SCRIPT.indexOf('async function runMergeStep'));
  const pushes = fn.match(/unchecked\.push\(/g) || [];
  assert.ok(pushes.length >= 3, `every failure path must report; found ${pushes.length}`);
  assert.match(fn, /return null;/, 'and must return null so the notice says nobody is on it');
});

test('a stalled conflict is counted ONCE in the summary line', () => {
  // Review round 1 (task 86bbq0fh8): `merges.stalled` and `stalledHandOffs`
  // fire on the same event, and both clauses landed in one console.log —
  // "1 conflict(s) still unresolved, 1 conflict(s) STILL UNRESOLVED" reads as
  // two problems. Only stalledLine reports it, because it vanishes at zero.
  const mergeLine = SCRIPT.slice(SCRIPT.indexOf('const mergeLine'), SCRIPT.indexOf('const stalledLine'));
  assert.ok(mergeLine.length > 0, 'mergeLine must be built before stalledLine');
  assert.ok(!/unresolved/i.test(mergeLine), 'mergeLine must not also count stalled conflicts');
  assert.match(SCRIPT, /const stalledLine = stalledHandOffs\.length \? `, \$\{stalledHandOffs\.length\} conflict\(s\) STILL UNRESOLVED` : ''/);
});

test('announcing a stall re-stamps the marker; a failed announcement does not', () => {
  // The cadence promise in conflictWork.js is one pass of noise per DAY, and
  // the clock is the marker timestamp. Without the re-stamp, every pass after
  // the threshold nags again (review round 1). And the re-stamp must be gated
  // on the bus post SUCCEEDING, or a post nobody saw buys a day of silence.
  const block = SCRIPT.slice(SCRIPT.indexOf('MERGE HAND-OFF STALLED'), SCRIPT.indexOf("outcome: 'handed-off-stalled'"));
  assert.match(block, /else await markMergeHandled\(decision\.commentId, task, unchecked, notice\.marker\)/);
  assert.ok(block.indexOf('busStall.ok') < block.indexOf('markMergeHandled'), 'the re-stamp is the else of the failed-announcement branch');
});

test('a stalled conflict is reported separately from things the pass could not check', () => {
  // `unchecked` exits 1 — that is a health signal about the PASS. A stalled
  // ticket is a healthy pass reporting an unhealthy ticket; conflating them
  // would make the relay look permanently broken and get its exit code ignored.
  assert.match(SCRIPT, /const stalledHandOffs = \[\]/);
  assert.match(SCRIPT, /CONFLICTS STILL UNRESOLVED/);
  const exitBlock = SCRIPT.slice(SCRIPT.indexOf('if (unchecked.length) process.exit(1)') - 400);
  assert.ok(
    !/stalledHandOffs\.length\) process\.exit/.test(exitBlock),
    'a stalled conflict must not fail the relay run',
  );
});
