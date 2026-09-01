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
  stalledHandOffHeadline,
  conflictVerdictKind,
  isRealOverlap,
  shouldFileConflictTicket,
} = require('./conflictWork.js');
const { conflictHandOffNotice } = require('./mergeOnComment.js');

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

// ------------------------------------------- one predicate, two decisions
//
// TASK 86bbq80j5 (2026-08-31). On 2026-08-30 PR #444's catch-up merged cleanly
// and lost a race on the PUSH. The hand-off comment read the verdict and said,
// correctly, that the next pass would merge it. 200ms earlier the same pass had
// filed "Resolve the merge conflict on PR #444" into the Loop Queue, because
// the filing decision never consulted the verdict at all. Two comments, two
// actors, and a ticket describing work that did not exist.

/** Every shape a localVerdict is ever handed to this code in. */
const VERDICTS = [
  { label: 'a real overlap', v: { kind: 'real-conflict', reason: 'both touched routes/index.js' }, real: true },
  { label: 'the legacy realConflict flag', v: { realConflict: true, reason: 'both touched routes/index.js' }, real: true },
  { label: 'a lost push race', v: { kind: 'unknown', reason: 'the catch-up merged cleanly but could not be pushed' }, real: false },
  { label: 'the legacy flag, false', v: { realConflict: false, reason: 'could not fetch the branch' }, real: false },
  { label: 'no verdict at all', v: null, real: false },
  { label: 'an undefined verdict', v: undefined, real: false },
];

test('THE LOST PUSH RACE: an unknown verdict files nothing', () => {
  const race = { kind: 'unknown', reason: 'the catch-up merged cleanly but could not be pushed' };
  assert.equal(shouldFileConflictTicket(race), false, 'nothing needs resolving, so nothing may be filed');
  const notice = conflictHandOffNotice({ commentId: '77', pr: PR, localVerdict: race, filed: null });
  assert.equal(notice.actor, 'later-pass');
  assert.match(notice.body, /merged on the next run/i, 'and the promise it already made is unchanged');
});

test('a real overlap still files, exactly as before', () => {
  assert.equal(shouldFileConflictTicket({ kind: 'real-conflict', reason: 'both touched routes/index.js' }), true);
  assert.equal(shouldFileConflictTicket({ realConflict: true, reason: 'both touched routes/index.js' }), true);
});

test('THE DRIFT PROOF: the filing decision and the notice actor read one predicate', () => {
  // Not "they happen to agree on these cases" — they cannot disagree, because
  // conflictHandOffNotice calls isRealOverlap and so does the merge step. This
  // test is the alarm if a future edit gives either side its own copy again.
  for (const { label, v, real } of VERDICTS) {
    const files = shouldFileConflictTicket(v);
    const { actor } = conflictHandOffNotice({ commentId: '77', pr: PR, localVerdict: v, filed: null });
    assert.equal(files, real, `${label}: filing decision`);
    assert.equal(actor !== 'later-pass', real, `${label}: the notice names a different actor than the filing decision`);
    assert.equal(files, isRealOverlap(v), `${label}: both sides must be the same function`);
  }
});

test('NO VERDICT AT ALL is a decision, and the reason is written down', () => {
  // Criterion 4. Null happens on a dry run, and when the local catch-up
  // SUCCEEDED and GitHub's re-read still said conflict — a stale answer. It
  // reads as 'unknown' and files nothing, on purpose.
  assert.equal(conflictVerdictKind(null), 'unknown');
  assert.equal(shouldFileConflictTicket(null), false);
  const src = fs.readFileSync(path.join(__dirname, 'conflictWork.js'), 'utf8');
  const fn = src.slice(src.indexOf('function conflictVerdictKind'), src.indexOf('function isRealOverlap'));
  assert.match(fn, /DELIBERATE/, 'the null choice must be stated, not left to be re-derived by a reader');
  assert.match(fn, /dry run/i);
});

test('a self-healing hand-off is quiet without a ticket — but not forever', () => {
  // handOffStalled read "no ticket" as "no actor". For a later-pass hand-off
  // the actor is the next pass and it is real, so nagging the bus every ten
  // minutes would be the same false alarm one level down. Age still applies.
  const now = Date.parse('2026-08-30T12:00:00.000Z');
  const fresh = handOffStalled({ at: '2026-08-30T11:00:00.000Z', now, filed: null, actor: 'later-pass' });
  assert.equal(fresh.stalled, false, 'a branch that is healing itself is not news');

  const old = handOffStalled({ at: '2026-08-28T11:00:00.000Z', now, filed: null, actor: 'later-pass' });
  assert.equal(old.stalled, true, 'but one that has not healed in a day is');
  assert.match(old.why, /has not cleared in 2 days/);

  // Any other actor keeps the original rule, which fails toward noise.
  for (const actor of ['nobody', 'loop-queue', undefined]) {
    assert.equal(handOffStalled({ at: '2026-08-30T11:00:00.000Z', now, filed: null, actor }).stalled, true, String(actor));
  }
});

// ----------------------------- the two halves, joined the way the code joins
//
// REVIEW ROUND 1 of task 86bbq80j5 sent the first attempt back. Every test
// above checks `handOffStalled` and `stalledHandOffLine` SEPARATELY, and both
// were correct on their own — which is why the defect survived a green suite.
// It exists only where the merge step feeds one into the other, so these tests
// compose them exactly as `runMergeStep` does and assert on the finished bus
// line rather than on either half.

/** The real 2026-08-30 incident, as the merge step saw it. */
const PR444 = { number: 444, url: 'https://github.com/mentor24-maker/starcaster/pull/444', repo: 'starcaster' };
const TASK444 = { id: '86bbmmv7t', name: 'Review gate holes', url: 'https://app.clickup.com/t/86bbmmv7t' };
const LOST_PUSH_RACE = { kind: 'unknown', reason: 'the catch-up merged cleanly but could not be pushed' };

/** What actually goes to the bus, built the one way the merge step builds it. */
function busLine({ task, pr, filed, stalled, actor }) {
  return `[CC-starcaster bus-relay] ${stalledHandOffHeadline({ actor })} — ${stalledHandOffLine({ task, pr, filed, stalled, actor })}`;
}

test('THE COMPOSED BUS LINE: a self-healing stall names ONE actor, end to end', () => {
  // The sentence review round 1 produced, verbatim, was:
  //
  //   PR #444 has been waiting on a conflict resolution — NOT filed anywhere
  //   — no actor exists for it. no overlap was found, so every pass has been
  //   retrying the catch-up on its own — and it has not cleared in 25 hours.
  //
  // Two clauses, one sentence, two different actors — the same failure shape
  // as the two comments 200ms apart, arriving where Dane reads.
  const notice = conflictHandOffNotice({ commentId: '77', pr: PR444, localVerdict: LOST_PUSH_RACE, filed: null });
  assert.equal(notice.actor, 'later-pass');

  const stalled = handOffStalled({
    at: '2026-08-30T02:00:00.000Z',
    now: Date.parse('2026-08-31T03:00:00.000Z'),
    filed: null,
    actor: notice.actor,
  });
  assert.equal(stalled.stalled, true, '25 hours is past the threshold, so this line really does get posted');

  const posted = busLine({ task: TASK444, pr: PR444, filed: null, stalled, actor: notice.actor });

  assert.ok(!/no actor exists for it/.test(posted),
    `a self-healing stall must not say nobody is on it:\n${posted}`);
  assert.ok(!/CONFLICT STILL UNRESOLVED/.test(posted),
    `and must not call a branch with no overlap a conflict:\n${posted}`);
  assert.match(posted, /no ticket, and none is needed/, 'it says why there is no ticket');
  assert.match(posted, /every pass has been retrying the catch-up on its own/, 'and who is acting');
  assert.match(posted, /has not cleared in 25 hours/, 'and that it is still news');
});

test('THE DRIFT PROOF EXTENDS TO THE STALL: no message names an actor the notice did not pick', () => {
  // The invariant worth locking, one loop over the same VERDICTS table: the
  // stalled announcement — banner included — may only describe the actor
  // `conflictHandOffNotice` chose. Any future branch that reaches for `filed`
  // again fails here rather than on the bus a day later.
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  const threeDaysAgo = '2026-08-28T12:00:00.000Z';

  for (const { label, v, real } of VERDICTS) {
    // `filed` is not free: the merge step only ever holds a ticket when the
    // shared predicate allowed one to be filed in the first place.
    for (const filed of real ? [FILED, null] : [null]) {
      const { actor } = conflictHandOffNotice({ commentId: '77', pr: PR, localVerdict: v, filed });
      const stalled = handOffStalled({ at: threeDaysAgo, now, filed, actor });
      assert.equal(stalled.stalled, true, `${label}: three days is stalled whatever the actor`);
      const posted = busLine({ task: TASK, pr: PR, filed, stalled, actor });
      const where = `${label} (filed=${Boolean(filed)}, actor=${actor})`;

      assert.equal(/no actor exists for it/.test(posted), actor === 'nobody',
        `${where}: "nobody" may appear exactly when the notice picked nobody\n${posted}`);
      assert.equal(posted.includes(FILED.url), actor === 'loop-queue',
        `${where}: the filed ticket is named exactly when the loop queue is the actor\n${posted}`);
      assert.equal(/CONFLICT STILL UNRESOLVED/.test(posted), actor !== 'later-pass',
        `${where}: only a hand-off with a real overlap may be announced as a conflict\n${posted}`);
    }
  }
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

test('THE FILING GATE IS IN THE MERGE STEP, not just in the predicate', () => {
  // The predicate is only a fix if the call site asks it. This is the exact
  // line that filed on `gate.action` alone for PR #444.
  assert.match(
    SCRIPT,
    /if \(shouldFileConflictTicket\(localVerdict\) && !filed && !dryRun\) \{/,
    'fileConflictTicket must be gated on the shared predicate',
  );
  assert.ok(
    !/if \(!filed && !dryRun\) \{\n\s*filed = await fileConflictTicket/.test(SCRIPT),
    'the ungated form must not come back',
  );
});

test('THE STALL BRANCH PASSES THE ACTOR TOO — the branch round 1 caught', () => {
  // Three branches were converted to read the notice's actor and this fourth
  // one was not, so it kept deriving the actor from `filed`. It is also the
  // only one of the four that posts to the bus.
  const block = SCRIPT.slice(SCRIPT.indexOf('const stalled = handOffStalled('), SCRIPT.indexOf("outcome: 'handed-off-stalled'"));
  assert.ok(block.length > 0, 'the stall branch must exist');
  assert.match(block, /stalledHandOffLine\(\{ task, pr, filed, stalled, actor: notice\.actor \}\)/,
    'the bus line must be built from the actor, not from `filed` alone');
  assert.ok(!/stalledHandOffLine\(\{ task, pr, filed, stalled \}\)/.test(SCRIPT),
    'the actor-blind form must not come back');
  assert.match(block, /stalledHandOffHeadline\(\{ actor: notice\.actor \}\)/,
    'and so must the banner above it');
  assert.ok(!/CONFLICT STILL UNRESOLVED — \$\{line\}/.test(SCRIPT),
    'the hardcoded conflict banner must not come back');
});

test('the hand-off messages read the notice actor, never `filed` alone', () => {
  // "No ticket" and "no actor" are different things, and every branch that
  // conflated them told the room to point a session at a healthy branch.
  const block = SCRIPT.slice(SCRIPT.indexOf('const selfHealing = notice.actor'), SCRIPT.indexOf("outcome: 'handed-off', reason"));
  assert.match(SCRIPT, /const selfHealing = notice\.actor === 'later-pass';/);
  assert.match(block, /actor: notice\.actor/, 'the stall check must know which actor it is waiting on');
  assert.match(block, /const busBody = selfHealing/, 'the bus post must not call a self-healing branch blocked');
  assert.match(block, /if \(!filed && !selfHealing\) unchecked\.push\(/, 'a self-healing hand-off is not an unchecked pass');
});
