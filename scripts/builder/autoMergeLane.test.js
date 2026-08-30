'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  laneAEligibility,
  governanceReason,
  GOVERNANCE_TEST_STEMS,
  WINDOW_MS,
  STALE_MS,
  windowState,
  parseAutoMergeMarker,
  latestAutoMergeMarker,
  markerLine,
  switchCommand,
  killSwitchState,
  SWITCH_STOP,
  SWITCH_RESUME,
  CAP_PER_HOUR,
  CAP_PER_DAY,
  rateCapState,
  selfDisableState,
  laneGate,
  laneADecision,
  announcementNotice,
  cancellationNotice,
  digestDue,
  digestBody,
  digestSince,
  DIGEST_EVERY_MS,
  DIGEST_WINDOW_MS,
  asLedger,
  ledgerAfterMerge,
  ledgerAfterSwitch,
  ledgerAfterDisable,
  ledgerAfterDigest,
  switchSignalsFromLedger,
  mergesSince,
} = require('./autoMergeLane');

/**
 * Task 86bbkw2au — Lane A. Canon: vault doctrine/AUTO-MERGE-LANES.md.
 *
 * THE DANGER IN A FEATURE LIKE THIS IS NOT THAT IT MERGES TOO LITTLE. It is
 * that some path through it merges something nobody agreed to, quietly, at
 * 3am. So the tests that carry the most weight here are the REFUSALS: an
 * unreadable switch, a PR that gained a file during the window, a ticket with
 * no review pass, a stale approval, an announcement that never posted.
 *
 * Every rule below was broken on purpose and watched to fail before the pass
 * was believed. Where that break was subtle, the assertion that caught it is
 * named in a comment.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OPERATOR = 48012725;
const T0 = 1_756_000_000_000; // a fixed epoch; nothing here reads a real clock

let nextId = 1000;
const comment = (text, { at = T0, user = 7, id } = {}) => ({
  id: String(id ?? nextId++),
  date: String(at),
  comment_text: text,
  user: { id: user },
});

const fromDane = (text, at) => comment(text, { at, user: OPERATOR });
const prComment = (n, at) => comment(`PR opened: https://github.com/mentor24-maker/starcaster/pull/${n}`, { at });
const reviewPass = (at) => comment('REVIEW: PASSED (checked out, gates green)', { at });
const reviewFail = (at) => comment('REVIEW: sent back to Queued — the test does not fail when broken', { at });
const armed = (n, at) => comment(`some words\n${markerLine('armed', n, 'iso')}`, { at });
const cancelled = (n, at) => comment(`${markerLine('cancelled', n, 'iso')}`, { at });

/** A ticket that is ready in every way except whatever the test is probing. */
function readyTicket({ pr = 42, verdictAt = T0, prAt = T0 - 1000, extra = [] } = {}) {
  return [prComment(pr, prAt), reviewPass(verdictAt), ...extra];
}

const DOCS_ONLY = ['docs/LOCAL_DEVELOPMENT.md', 'README.md', 'scripts/builder/themeWizardApply.test.js'];

// ── Criterion 1: which files may ride ────────────────────────────────────────

test('a PR of nothing but tests and documents is eligible', () => {
  const r = laneAEligibility([
    'docs/VISUAL_REVIEW.md',
    'README.md',
    'components/builder/Thing.test.tsx',
    'lib/builder-client/parse.test.ts',
    'scripts/builder/slugConflict.test.js',
    'scripts/x.test.mjs',
    'docs/SQL/whatever.sql',
  ]);
  assert.equal(r.eligible, true, r.reason);
  assert.equal(r.files.length, 7);
});

test('ONE file outside the set disqualifies the whole PR — no partial credit', () => {
  // The doctrine's phrasing, and the reason is that a mixed PR's risk is the
  // risk of its riskiest file, never the average of them.
  for (const intruder of [
    'components/builder/SettingsPanel.tsx',
    'lib/projectScope.js',
    'routes/index.js',
    'src/css/_builder-react.css',
    'public/js/core.js',
    'package.json',
  ]) {
    const r = laneAEligibility([...DOCS_ONLY, intruder]);
    assert.equal(r.eligible, false, `${intruder} should have disqualified the PR`);
    assert.equal(r.blockedBy, intruder);
    assert.match(r.reason, /not a test or a document/);
  }
});

test('criterion 4: the machinery that governs machines is never auto-merged', () => {
  const governance = [
    'CLAUDE.md',
    'components/CLAUDE.md',
    'src/css/CLAUDE.md',
    'docs/DOCTRINE.md',
    'docs/LOOP_ENGINEERING.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/workflows/ci.yml',
    // Review round 2 (2026-08-30): the loop's own instruction files are `.md`
    // and were eligible — a PR rewriting the review gate would have merged
    // itself. Agent configuration is governance, whichever folder it is in.
    '.claude/skills/loop-review/SKILL.md',
    '.claude/skills/loop-build/SKILL.md',
    '.claude/skills/loop-spec/SKILL.md',
    '.claude/settings.json',
    'skills/reddit-channel-posting-operator/SKILL.md',
    'scripts/builder/mergeOnComment.test.js',
    'scripts/builder/branchCatchUp.test.js',
    'scripts/builder/wipCap.test.js',
    'scripts/builder/busRelayPlan.test.js',
    'scripts/builder/autoMergeLane.test.js',
    'scripts/builder/reviewGate.test.js',
  ];
  for (const file of governance) {
    assert.equal(laneAEligibility([file]).eligible, false, `${file} must never auto-merge`);
    // And it must still be refused when buried in an otherwise clean PR — the
    // break that mattered here was checking governance only on the first file.
    const mixed = laneAEligibility([...DOCS_ONLY, file]);
    assert.equal(mixed.eligible, false, `${file} must disqualify even alongside clean files`);
    assert.equal(mixed.blockedBy, file);
  }
});

test('every named merge-step test is covered, by construction', () => {
  // A future module joining the merge step must be added to the list, and this
  // is what says so out loud rather than leaving a silent hole.
  for (const stem of GOVERNANCE_TEST_STEMS) {
    assert.ok(governanceReason(`scripts/builder/${stem}.test.js`), `${stem} is listed but not matched`);
  }
  assert.ok(GOVERNANCE_TEST_STEMS.includes('autoMergeLane'),
    'the lane must not be able to auto-merge changes to its own rules');
});

test('an ordinary test file is NOT governance', () => {
  assert.equal(governanceReason('scripts/builder/themeWizardApply.test.js'), null);
  assert.equal(governanceReason('docs/WORK-LOG.md'), null);
});

test('an empty file list is refused, not waved through', () => {
  // The classic vacuous truth: "every file matched" is trivially true of no
  // files. Here it would auto-merge a PR nobody could describe.
  assert.equal(laneAEligibility([]).eligible, false);
  assert.equal(laneAEligibility(null).eligible, false);
  assert.match(laneAEligibility([]).reason, /no changed files/);
});

test('near-misses do not sneak through the test-file pattern', () => {
  for (const f of ['scripts/x.test.js.bak', 'test.js', 'notes.markdown', 'a.test.py', 'x.tests.js']) {
    assert.equal(laneAEligibility([f]).eligible, false, `${f} must not match`);
  }
  // `docs/` must be a PREFIX, not a substring anywhere in the path: a
  // `lib/docs/` folder is library code that happens to be named after
  // documentation.
  assert.equal(laneAEligibility(['lib/docs/thing.ts']).eligible, false);
  // A Markdown file outside docs/ IS eligible, though — `*.md` is its own rule
  // in the allow list, which is what lets a README or a WORK-LOG entry ride.
  assert.equal(laneAEligibility(['docsy/thing.md']).eligible, true);
  assert.equal(laneAEligibility(['components/README.md']).eligible, true);
});

test('gh\'s object shape is accepted as well as bare strings', () => {
  assert.equal(laneAEligibility([{ path: 'docs/a.md' }]).eligible, true);
  assert.equal(laneAEligibility([{ path: 'lib/a.js' }]).eligible, false);
});

// ── The window ───────────────────────────────────────────────────────────────

test('the window is one hour, and it is a named decision', () => {
  assert.equal(WINDOW_MS, HOUR, 'Dane ruled one hour on 2026-08-24');
});

test('window arithmetic runs from the announcement, and refuses a missing one', () => {
  const w = windowState({ announcedAt: T0, now: T0 + 59 * 60 * 1000 });
  assert.equal(w.elapsed, false);
  assert.equal(w.deadlineAt, T0 + HOUR);
  assert.equal(windowState({ announcedAt: T0, now: T0 + HOUR }).elapsed, true);

  // An announcement that never posted has no timestamp, and a window with no
  // start is not a window.
  for (const bad of [null, undefined, 0, NaN, '']) {
    assert.equal(windowState({ announcedAt: bad, now: T0 + DAY }).valid, false);
    assert.equal(windowState({ announcedAt: bad, now: T0 + DAY }).elapsed, false,
      'an unstarted clock must never read as elapsed');
  }
});

test('a failed announcement starts no clock and merges nothing', () => {
  // Acceptance criterion 4, module half: with no armed marker on the ticket
  // there is nothing to merge, however long ago the review passed. (The
  // plumbing half — that a failed post writes no marker at all — is pinned
  // against clickup_direct.mjs at the bottom of this file.)
  const d = laneADecision({
    status: 'Ready to launch',
    comments: readyTicket({ verdictAt: T0 - DAY }),
    operatorId: OPERATOR,
    now: T0 + DAY,
    files: ['lib/nope.js'],
  });
  assert.notEqual(d.act, 'merge');
});

// ── The record on the ticket ─────────────────────────────────────────────────

test('markers round-trip, and the newest one decides', () => {
  assert.deepEqual(parseAutoMergeMarker(markerLine('armed', 7, 'x')), { kind: 'armed', pr: 7 });
  assert.deepEqual(parseAutoMergeMarker(markerLine('cancelled', 7, 'x')), { kind: 'cancelled', pr: 7 });
  assert.equal(parseAutoMergeMarker('no marker here'), null);
  // Prose ABOUT a marker is not a marker: it must start the line.
  assert.equal(parseAutoMergeMarker('as I said, [auto-merge] armed PR #7'), null);

  const latest = latestAutoMergeMarker([armed(7, T0), cancelled(7, T0 + 100), armed(7, T0 - 100)]);
  assert.equal(latest.kind, 'cancelled');
  assert.equal(latest.at, T0 + 100);
});

// ── The kill switch (standing condition 1) ───────────────────────────────────

test('stop is matched loosely, resume strictly — the asymmetry is deliberate', () => {
  assert.equal(switchCommand(SWITCH_STOP), 'stop');
  assert.equal(switchCommand('Stop Auto-Merging.'), 'stop');
  assert.equal(switchCommand('stop auto merging'), 'stop', 'nobody types the hyphen twice');
  assert.equal(switchCommand('hey, stop auto-merging until I look at this'), 'stop',
    'a stop buried in a sentence must still stop it');

  assert.equal(switchCommand(SWITCH_RESUME), 'resume');
  assert.equal(switchCommand('resume auto merging'), 'resume');
  assert.equal(switchCommand('I might resume auto-merging tomorrow'), null,
    'a resume must be the whole message — a false resume costs an unwanted merge');
  assert.equal(switchCommand('merge'), null);
  assert.equal(switchCommand(''), null);
});

test('an UNREADABLE switch means OFF — the fail-safe direction', () => {
  // The most important assertion in this file. "He never said stop" and "I
  // could not find out whether he said stop" look identical from inside the
  // pass, and only one of them is safe to act on.
  const s = killSwitchState({ signals: [], readable: false });
  assert.equal(s.state, 'off');
  assert.match(s.why, /could not be read/);

  // Even with a resume on the record: if the sources cannot be read we do not
  // know it is the newest thing said.
  assert.equal(killSwitchState({
    signals: [{ kind: 'resume', at: T0 }],
    readable: false,
  }).state, 'off');
});

test('the newest signal wins, in both directions', () => {
  assert.equal(killSwitchState({ signals: [] }).state, 'on');
  assert.equal(killSwitchState({ signals: [{ kind: 'stop', at: T0 }] }).state, 'off');
  assert.equal(killSwitchState({
    signals: [{ kind: 'stop', at: T0 }, { kind: 'resume', at: T0 + 1 }],
  }).state, 'on');
  assert.equal(killSwitchState({
    signals: [{ kind: 'resume', at: T0 }, { kind: 'stop', at: T0 + 1 }],
  }).state, 'off');
});

test('a stop is remembered, so it cannot vanish when a ticket closes', () => {
  // A pass only reads OPEN tickets. A stop said on a ticket that later goes
  // Live would disappear from view and the lane would switch itself back on —
  // the one direction a fail-safe must never fail in.
  const l = ledgerAfterSwitch(asLedger(null), { kind: 'stop', at: T0, where: 'on task 1' });
  assert.equal(l.switch.kind, 'stop');
  assert.equal(killSwitchState({ signals: switchSignalsFromLedger(l) }).state, 'off');

  // An older signal never overwrites a newer record.
  const same = ledgerAfterSwitch(l, { kind: 'resume', at: T0 - 1 });
  assert.equal(same.switch.kind, 'stop');

  // A newer resume does, and it clears a self-disable in the same move: one
  // word puts the lane back, rather than two hidden off switches.
  const disabled = ledgerAfterDisable(l, 'something went wrong', T0);
  assert.equal(disabled.disabled.why, 'something went wrong');
  const resumed = ledgerAfterSwitch(disabled, { kind: 'resume', at: T0 + 1 });
  assert.equal(resumed.switch.kind, 'resume');
  assert.equal(resumed.disabled, null, 'resume must clear the self-disable too');
});

// ── The rate cap (standing condition 2) ──────────────────────────────────────

test('the cap holds at 3 an hour and 12 a day', () => {
  assert.equal(CAP_PER_HOUR, 3);
  assert.equal(CAP_PER_DAY, 12);

  const hourly = Array.from({ length: 3 }, (_, i) => ({ at: T0 - i * 60_000 }));
  assert.equal(rateCapState(hourly, T0).allowed, false);
  assert.match(rateCapState(hourly, T0).why, /hourly/);
  assert.equal(rateCapState(hourly.slice(0, 2), T0).allowed, true);

  // Three an hour ago no longer counts against the hour.
  assert.equal(rateCapState(hourly.map((e) => ({ at: e.at - HOUR })), T0).allowed, true);
});

test('the daily cap is a ROLLING window, not a calendar day', () => {
  // "12 per day" that resets at midnight permits 24 in two hours across the
  // boundary — which is precisely the runaway the cap exists to catch.
  const spread = Array.from({ length: 12 }, (_, i) => ({ at: T0 - i * 90 * 60 * 1000 }));
  const cap = rateCapState(spread, T0);
  assert.equal(cap.allowed, false);
  assert.match(cap.why, /daily/);
  assert.equal(rateCapState(spread.map((e) => ({ at: e.at - DAY })), T0).allowed, true);
});

test('a garbled ledger entry cannot inflate or deflate the count', () => {
  assert.equal(rateCapState([{ at: 'nonsense' }, { at: null }, {}], T0).inDay, 0);
});

// ── Self-disable (standing condition 4) ──────────────────────────────────────

test('anything under "could not fully verify" disables the lane', () => {
  const d = selfDisableState({ unchecked: ['could not read PR #9'] });
  assert.equal(d.disabled, true);
  assert.equal(d.fresh, true);
  assert.match(d.why, /could not fully verify/);
  assert.equal(selfDisableState({ unchecked: [] }).disabled, false);
});

test('a red main after an auto-merge disables the lane', () => {
  assert.equal(selfDisableState({ mainBuildRed: true }).disabled, true);
  assert.match(selfDisableState({ mainBuildRed: true }).why, /red/);
});

test('a disable persists until a human clears it', () => {
  const d = selfDisableState({ persisted: { at: T0, why: 'main went red' } });
  assert.equal(d.disabled, true);
  assert.equal(d.fresh, false, 'a remembered disable must not re-announce itself every pass');
  assert.equal(d.why, 'main went red');
});

test('the gate reports WHY, cheapest and most serious reason first', () => {
  const off = killSwitchState({ signals: [{ kind: 'stop', at: T0 }] });
  const dis = selfDisableState({ unchecked: ['x'] });
  const cap = rateCapState(Array.from({ length: 3 }, () => ({ at: T0 })), T0);

  assert.equal(laneGate({ killSwitch: off, selfDisable: dis, rateCap: cap }).kind, 'kill-switch');
  assert.equal(laneGate({ killSwitch: killSwitchState({}), selfDisable: dis, rateCap: cap }).kind, 'self-disabled');
  assert.equal(laneGate({ killSwitch: killSwitchState({}), selfDisable: selfDisableState({}), rateCap: cap }).kind, 'rate-cap');
  assert.equal(laneGate({
    killSwitch: killSwitchState({}),
    selfDisable: selfDisableState({}),
    rateCap: rateCapState([], T0),
  }).allowed, true);
});

// ── The decision ─────────────────────────────────────────────────────────────

test('an eligible, reviewed, unannounced ticket is announced', () => {
  const d = laneADecision({
    status: 'Ready to launch',
    comments: readyTicket(),
    operatorId: OPERATOR,
    now: T0 + 1000,
    files: DOCS_ONLY,
  });
  assert.equal(d.act, 'announce');
  assert.equal(d.pr.number, 42);
});

test('the module asks for the file list rather than guessing without it', () => {
  const d = laneADecision({
    status: 'Ready to launch',
    comments: readyTicket(),
    operatorId: OPERATOR,
    now: T0 + 1000,
  });
  assert.equal(d.act, 'need-files');
  assert.equal(d.pr.number, 42);
});

test('criterion 8: no review PASS, no eligibility — whatever the files', () => {
  const base = { status: 'Ready to launch', operatorId: OPERATOR, now: T0 + 1000, files: DOCS_ONLY };

  // No verdict at all.
  assert.equal(laneADecision({ ...base, comments: [prComment(42, T0)] }).act, 'ignore');
  // A verdict that failed.
  const failed = laneADecision({ ...base, comments: [prComment(42, T0), reviewFail(T0 + 1)] });
  assert.equal(failed.act, 'ignore');
  assert.match(failed.reason, /not a PASS/);
  // A pass superseded by a later failure.
  const superseded = laneADecision({
    ...base,
    comments: [prComment(42, T0), reviewPass(T0 + 1), reviewFail(T0 + 2)],
  });
  assert.equal(superseded.act, 'ignore');
});

test('any status other than Ready to launch is ignored', () => {
  for (const status of ['Queued', 'Building', 'In review', 'Needs your input', 'Live', '', null]) {
    assert.equal(laneADecision({
      status, comments: readyTicket(), operatorId: OPERATOR, now: T0 + 1000, files: DOCS_ONLY,
    }).act, 'ignore', `status ${status} must not be eligible`);
  }
  // Case-insensitively the same status IS eligible — ClickUp lowercases.
  assert.equal(laneADecision({
    status: 'ready to launch', comments: readyTicket(), operatorId: OPERATOR, now: T0 + 1000, files: DOCS_ONLY,
  }).act, 'announce');
});

test('no PR comment means nothing to merge', () => {
  const d = laneADecision({
    status: 'Ready to launch',
    comments: [reviewPass(T0)],
    operatorId: OPERATOR,
    now: T0 + 1000,
    files: DOCS_ONLY,
  });
  assert.equal(d.act, 'ignore');
  assert.match(d.reason, /PR opened/);
});

test('an armed ticket waits out its hour, then merges', () => {
  const comments = readyTicket({ extra: [armed(42, T0 + 10)] });
  const base = { status: 'Ready to launch', comments, operatorId: OPERATOR, files: DOCS_ONLY };

  const early = laneADecision({ ...base, now: T0 + 10 + 59 * 60 * 1000 });
  assert.equal(early.act, 'ignore');
  assert.match(early.reason, /window has \d+ minute/);

  const due = laneADecision({ ...base, now: T0 + 10 + HOUR });
  assert.equal(due.act, 'merge');
  assert.equal(due.pr.number, 42);
  assert.deepEqual(due.eligibility.files, DOCS_ONLY);
});

test('an armed announcement goes STALE after a day, and a stale one cancels rather than merges', () => {
  // Review round 2 (2026-08-30): arm three PRs, say "stop auto-merging", come
  // back a fortnight later and say "resume" — all three were past their
  // deadline and would have merged on windows that closed two weeks ago,
  // with no fresh notice and nothing on his screen.
  assert.equal(STALE_MS, 24 * WINDOW_MS, 'a day is the shelf life, as a named multiple of the window');
  const fresh = windowState({ announcedAt: T0, now: T0 + 2 * HOUR });
  assert.equal(fresh.elapsed, true);
  assert.equal(fresh.stale, false);
  const old = windowState({ announcedAt: T0, now: T0 + STALE_MS });
  assert.equal(old.stale, true);
  assert.equal(windowState({ announcedAt: 0, now: T0 }).stale, false, 'no announcement is not a stale one');

  const comments = readyTicket({ extra: [armed(42, T0 + 10)] });
  const base = { status: 'Ready to launch', comments, operatorId: OPERATOR, files: DOCS_ONLY };
  const d = laneADecision({ ...base, now: T0 + 10 + 14 * DAY });
  assert.equal(d.act, 'cancel', 'a fortnight-old announcement must cancel, never merge');
  assert.equal(d.stale, true);
  assert.match(d.reason, /stale/);
  assert.equal(d.announcementId, comments[2].id);

  // And the cancel is terminal like any other: no re-announcement without a
  // fresh PASS, which is the existing rule doing its job.
  const after = [...comments, cancelled(42, T0 + 10 + 14 * DAY)];
  const again = laneADecision({ ...base, comments: after, now: T0 + 10 + 14 * DAY + 1000 });
  assert.equal(again.act, 'ignore');
  assert.match(again.reason, /no fresh review PASS/);
});

test('ANY comment from Dane during the window cancels it — not a keyword', () => {
  const comments = readyTicket({ extra: [armed(42, T0 + 10), fromDane('hmm', T0 + 20)] });
  const d = laneADecision({
    status: 'Ready to launch', comments, operatorId: OPERATOR, now: T0 + 10 + HOUR, files: DOCS_ONLY,
  });
  assert.equal(d.act, 'cancel');
  assert.match(d.reason, /you commented/);

  // Even a comment that reads like approval. His explicit "merge" goes through
  // the path that was already his; it must not ALSO ride the lane.
  const approving = readyTicket({ extra: [armed(42, T0 + 10), fromDane('merge', T0 + 20)] });
  assert.equal(laneADecision({
    status: 'Ready to launch', comments: approving, operatorId: OPERATOR, now: T0 + 10 + HOUR, files: DOCS_ONLY,
  }).act, 'cancel');
});

test('only HIS comments object, and only ones inside the window', () => {
  // A machine comment during the window is the pipeline talking to itself.
  const machine = readyTicket({ extra: [armed(42, T0 + 10), comment('bot noise', { at: T0 + 20 })] });
  assert.equal(laneADecision({
    status: 'Ready to launch', comments: machine, operatorId: OPERATOR, now: T0 + 10 + HOUR, files: DOCS_ONLY,
  }).act, 'merge');

  // His comment from BEFORE the announcement is not an objection to it — the
  // announcement came after and gave him a fresh hour.
  const before = readyTicket({ extra: [fromDane('looks good', T0 + 5), armed(42, T0 + 10)] });
  assert.equal(laneADecision({
    status: 'Ready to launch', comments: before, operatorId: OPERATOR, now: T0 + 10 + HOUR, files: DOCS_ONLY,
  }).act, 'merge');
});

test('cancelling is terminal — no re-announcement without a FRESH review pass', () => {
  const base = { status: 'Ready to launch', operatorId: OPERATOR, now: T0 + DAY, files: DOCS_ONLY };

  const stale = [prComment(42, T0), reviewPass(T0 + 1), cancelled(42, T0 + 100)];
  const d = laneADecision({ ...base, comments: stale });
  assert.equal(d.act, 'ignore');
  assert.match(d.reason, /no fresh review PASS since/);

  // A new review pass after the cancellation re-opens it.
  const fresh = [...stale, reviewPass(T0 + 200)];
  assert.equal(laneADecision({ ...base, comments: fresh }).act, 'announce');
});

test('an announcement for an OLDER PR does not arm the new one', () => {
  // A rebuilt ticket carries the previous round's announcement. The new PR has
  // to earn its own, which is the same rule that makes a cancellation stick.
  const comments = [prComment(99, T0 + 300), reviewPass(T0 + 1), armed(42, T0 + 100)];
  const d = laneADecision({
    status: 'Ready to launch', comments, operatorId: OPERATOR, now: T0 + DAY, files: DOCS_ONLY,
  });
  assert.equal(d.act, 'ignore');
  assert.match(d.reason, /different PR/);

  const reviewed = [...comments, reviewPass(T0 + 400)];
  const next = laneADecision({
    status: 'Ready to launch', comments: reviewed, operatorId: OPERATOR, now: T0 + DAY, files: DOCS_ONLY,
  });
  assert.equal(next.act, 'announce');
  assert.equal(next.pr.number, 99);
});

test('a PR that gains a runtime file DURING the window does not merge', () => {
  // The window is an hour long and a branch can gain a commit inside it. A PR
  // that was tests-only at 8:15 and touches lib/ at 8:47 must not merge at
  // 9:15 on the strength of what it used to be.
  const comments = readyTicket({ extra: [armed(42, T0 + 10)] });
  const d = laneADecision({
    status: 'Ready to launch',
    comments,
    operatorId: OPERATOR,
    now: T0 + 10 + HOUR,
    files: [...DOCS_ONLY, 'lib/projectScope.js'],
  });
  assert.equal(d.act, 'cancel');
  assert.match(d.reason, /no longer a Lane A change/);
  assert.match(d.reason, /lib\/projectScope\.js/);
});

test('eligibility is re-asked at merge time, not trusted from the announcement', () => {
  // The break that this caught: an early version checked files only on the
  // announce path, so the merge path merged whatever the PR had become. This
  // assertion is the one that failed.
  const comments = readyTicket({ extra: [armed(42, T0 + 10)] });
  const d = laneADecision({
    status: 'Ready to launch', comments, operatorId: OPERATOR, now: T0 + 10 + HOUR,
  });
  assert.equal(d.act, 'need-files', 'the merge path must fetch the file list again');
});

// ── What gets said ───────────────────────────────────────────────────────────

test('the announcement names the deadline, the files, and how to stop it', () => {
  const n = announcementNotice({
    pr: { number: 42, url: 'https://github.com/o/r/pull/42' },
    files: DOCS_ONLY,
    deadlineLabel: '9:15pm EDT',
    at: '2026-08-25T20:15:00.000Z',
  });
  assert.match(n.body, /9:15pm EDT/);
  assert.match(n.body, /just comment on this ticket/i);
  for (const f of DOCS_ONLY) assert.ok(n.body.includes(f), `${f} must be listed`);
  // The body carries its own marker, so what a later pass reads and what he
  // was told are the same comment by construction.
  assert.deepEqual(parseAutoMergeMarker(n.body), { kind: 'armed', pr: 42 });
  assert.deepEqual(parseAutoMergeMarker(n.marker), { kind: 'armed', pr: 42 });
});

test('a cancellation says nothing merged, and promises no second announcement', () => {
  const n = cancellationNotice({
    pr: { number: 42, url: 'https://github.com/o/r/pull/42' },
    why: 'you commented on this ticket while the window was open',
    at: '2026-08-25T20:20:00.000Z',
  });
  assert.match(n.body, /Nothing was merged/i);
  assert.match(n.body, /still Ready to launch/);
  assert.match(n.body, /fresh review/);
  assert.deepEqual(parseAutoMergeMarker(n.body), { kind: 'cancelled', pr: 42 });
});

test('every notice pairs its promise with the marker it writes', () => {
  // The pattern mergeOnComment.js arrived at the hard way: written apart, a
  // promise and the record of what was done drift, and on 2026-08-23 eleven
  // tickets were told "your approval still stands" beside a marker that spent
  // it. Built together, a test can assert the pairing.
  const pr = { number: 5, url: 'u' };
  const a = announcementNotice({ pr, files: ['README.md'], deadlineLabel: '1:00pm', at: 'x' });
  const c = cancellationNotice({ pr, why: 'because', at: 'x' });
  assert.equal(parseAutoMergeMarker(a.marker).kind, 'armed');
  assert.equal(parseAutoMergeMarker(c.marker).kind, 'cancelled');
  assert.ok(a.body.includes(a.marker), 'the announcement body must carry its own marker');
  assert.ok(c.body.includes(c.marker), 'the cancellation body must carry its own marker');
});

// ── The digest (standing condition 3) ────────────────────────────────────────

test('the digest posts on a quiet day, and says none', () => {
  // A silent day and a broken job must not look alike — which is the entire
  // reason this branch exists rather than an early return.
  const body = digestBody({ entries: [], sinceLabel: 'the last 24 hours' });
  assert.match(body, /\*\*none\*\*/);
  assert.match(body, /last 24 hours/);
});

test('the digest lists lane, PR and the files that qualified each merge', () => {
  const body = digestBody({
    entries: [{ lane: 'A', pr: 42, task: '86bb1', files: ['docs/a.md'] }],
    sinceLabel: 'the last 24 hours',
  });
  assert.match(body, /Lane A/);
  assert.match(body, /PR #42/);
  assert.match(body, /86bb1/);
  assert.match(body, /docs\/a\.md/);
});

test('the digest is due when it has never run, and once a day after', () => {
  assert.equal(digestDue(0, T0), true);
  assert.equal(digestDue(null, T0), true);
  assert.equal(digestDue(T0, T0 + 60_000), false);
  assert.equal(digestDue(T0, T0 + DIGEST_EVERY_MS), true);
  assert.ok(DIGEST_EVERY_MS < DAY, 'a daily digest must be due slightly under a day, or it drifts a day later each time');
});

// ── The ledger ───────────────────────────────────────────────────────────────

test('the ledger survives junk on disk without throwing', () => {
  for (const junk of [null, undefined, 'nonsense', 42, [], { merges: 'no' }]) {
    const l = asLedger(junk);
    assert.deepEqual(l.merges, []);
    assert.equal(l.disabled, null);
  }
});

test('merges accumulate and old ones are pruned', () => {
  let l = asLedger(null);
  l = ledgerAfterMerge(l, { at: T0, pr: 1 }, T0);
  l = ledgerAfterMerge(l, { at: T0 + 1000, pr: 2 }, T0 + 1000);
  assert.equal(l.merges.length, 2);

  // Three days later the old ones cannot affect a 24-hour cap and only make
  // the file grow forever.
  l = ledgerAfterMerge(l, { at: T0 + 3 * DAY, pr: 3 }, T0 + 3 * DAY);
  assert.deepEqual(l.merges.map((m) => m.pr), [3]);
});

test('mergesSince and the digest window agree', () => {
  const l = ledgerAfterMerge(
    ledgerAfterMerge(asLedger(null), { at: T0 - 2 * HOUR, pr: 1 }, T0),
    { at: T0 - 30 * HOUR, pr: 2 }, T0,
  );
  assert.deepEqual(mergesSince(l, T0 - DAY).map((m) => m.pr), [1]);
});

test('consecutive digests do not overlap — each one starts where the last one stopped', () => {
  // Review round 2 (2026-08-30): digests were 20 hours apart and each covered
  // a fixed 24, so every merge in the four-hour overlap was listed twice.
  const never = asLedger(null);
  assert.equal(digestSince(never, T0), T0 - DIGEST_WINDOW_MS, 'the first digest ever covers a day');
  const posted = ledgerAfterDigest(never, T0 - 20 * HOUR);
  assert.equal(digestSince(posted, T0), T0 - 20 * HOUR, 'a later digest starts at the previous one');

  let l = posted;
  l = ledgerAfterMerge(l, { at: T0 - 22 * HOUR, pr: 1 }, T0); // before the last digest: already reported
  l = ledgerAfterMerge(l, { at: T0 - 3 * HOUR, pr: 2 }, T0);  // since it: report now
  assert.deepEqual(mergesSince(l, digestSince(l, T0)).map((m) => m.pr), [2],
    'a merge reported by the previous digest must not be reported again');
});

test('the digest stamp advances', () => {
  assert.equal(ledgerAfterDigest(asLedger(null), T0).lastDigestAt, T0);
});

// ── The plumbing keeps its side of the bargain ───────────────────────────────

const RELAY = fs.readFileSync(path.join(__dirname, '../clickup_direct.mjs'), 'utf8');

test('the relay merges through the SAME gate, not a second one', () => {
  // Acceptance criterion: "merges exactly as the operator-authorised path
  // does — same gate, same marker, same Live transition". A second merge
  // implementation would be a second set of preconditions to keep in step,
  // and the one that drifted would be the one nobody was watching.
  assert.match(RELAY, /lane: \{ name: 'A', decision, files: decision\.eligibility\.files \}/,
    'the lane must reach the merge through runMergeStep');
  const mergeCommands = (RELAY.match(/'pr', 'merge'/g) || []).length;
  assert.equal(mergeCommands, 1, `there must be exactly ONE place that merges a PR, found ${mergeCommands}`);
  const gateCalls = (RELAY.match(/githubGate\(/g) || []).length;
  assert.ok(gateCalls >= 1, 'the lane must not re-implement mergeability');
});

test('the relay starts the clock from the CONFIRMED post, never from local time', () => {
  // The break this caught: an early version computed the deadline from
  // Date.now() at send time and never read the comment back, so a post that
  // silently failed still armed a window.
  assert.match(RELAY, /async function postLaneNotice/);
  assert.match(RELAY, /posted\.at \+ WINDOW_MS/,
    'the binding deadline must be derived from the confirmed post time');
  assert.match(RELAY, /nothing is armed and nothing will merge/,
    'a failed announcement must say so and arm nothing');
});

test('the relay treats an unreadable switch as OFF', () => {
  assert.match(RELAY, /const readable = busSw\.readable && led\.ok;/,
    'both the party line and the ledger must be readable for the switch to be trusted');
  assert.match(RELAY, /readable,\n\s*\}\);/);
});

test('the relay disables the lane on an unverified pass, and says so', () => {
  assert.match(RELAY, /selfDisableState\(\{ unchecked, mainBuildRed: mainRed, persisted: ledger\.disabled \}\)/);
  assert.match(RELAY, /AUTO-MERGE DISABLED ITSELF/);
  // The lane must run AFTER the main loop, or it would be judging a
  // half-finished account of the pass's own reliability.
  assert.ok(RELAY.indexOf('const laneCandidates = []') < RELAY.indexOf('Lane A: announce, wait one hour, merge'));
});

test('the window is never written as a literal at the call site', () => {
  // A tuned number copied into the plumbing is how a decision he made with
  // reasons becomes a mystery number six months later.
  const laneSection = RELAY.slice(RELAY.indexOf('Lane A: announce, wait one hour, merge'));
  assert.equal(/3600000|3_600_000|60 \* 60 \* 1000/.test(laneSection), false,
    'the lane plumbing must use WINDOW_MS, not a literal hour');
});

test('--no-merge turns Lane A off with the rest', () => {
  assert.match(RELAY, /if \(mergingAllowed\) \{\n\s*const now = Date\.now\(\);/,
    'the whole lane must sit behind the existing merge off-switch');
});

test('a paused pipeline turns Lane A off with the rest', () => {
  // Lane A is the one merge path that needs no human word at all, so the
  // pause switch guarding it is load-bearing rather than incidental: while
  // Dane has the deck, nothing may land under him — least of all a merge
  // nobody had to authorise. The lane sits behind `mergingAllowed`, and this
  // pins what that name is actually made of. It was inherited from main by a
  // three-way merge on 2026-08-30 and nothing asserted it until now.
  assert.match(RELAY, /const mergingAllowed = mergeSwitchOn && !pauseState\.paused;/,
    'the merge off-switch must include the pipeline pause, not just --no-merge');
});

test('a lane merge threads its marker under the ANNOUNCEMENT, not an undefined comment', () => {
  // Review round 2 (2026-08-30): laneADecision sets announcementId, never
  // commentId, so the marker POSTed to /comment/undefined/reply, failed, and
  // filed a false "could not write the dedup marker" under the very section
  // the self-disable watches. Every auto-merge would have disabled the lane.
  assert.match(RELAY, /const authorizingComment = lane \? decision\.announcementId : decision\.commentId;/);
  assert.match(RELAY, /markMergeHandled\(authorizingComment, task, unchecked, mergedRecord\.marker\)/);
  assert.match(RELAY, /mergedNotice\(\{\n\s*commentId: authorizingComment,/);
  const laneSection = RELAY.slice(RELAY.indexOf('async function runMergeStep'), RELAY.indexOf('function ledgerPath'));
  assert.equal(/mergedRecord\.marker[\s\S]*decision\.commentId/.test(laneSection.slice(laneSection.indexOf('MERGED PR'))), false,
    'nothing after the merge may reach for decision.commentId, which a lane never has');
});

test('a ledger that could not be read is never written over', () => {
  // Review round 2 (2026-08-30): the end-of-pass write was `if (!dryRun &&
  // led.file) writeLedger(...)`, so a corrupt ledger was replaced with an
  // empty one and a persisted stop vanished on the next pass. The write now
  // goes through saveLedgerIfReadable, which refuses unless the read was clean.
  const laneSection = RELAY.slice(RELAY.indexOf('Lane A: announce, wait one hour, merge'));
  assert.equal(/writeLedger(File)?\(/.test(laneSection), false, 'the lane must not write the ledger directly');
  assert.match(laneSection, /saveLedgerIfReadable\(led, ledger\)/);
  assert.equal(/readFileSync|writeFileSync/.test(RELAY.slice(RELAY.indexOf('function readLedger'), RELAY.indexOf('readBusSwitchSignals'))), false,
    'ledger IO lives in autoMergeLedgerFile.js, where it is tested');
});

test('an unrecognised party-line body is UNREADABLE, not "he never said stop"', () => {
  const fn = RELAY.slice(RELAY.indexOf('async function readBusSwitchSignals'), RELAY.indexOf('function mainBuildIsRed'));
  assert.match(fn, /if \(!messages\) \{\n\s*return \{ readable: false/);
});

test('a truncated file list is refused rather than judged', () => {
  const fn = RELAY.slice(RELAY.indexOf('function prChangedFiles'), RELAY.indexOf('async function postLaneNotice'));
  assert.match(fn, /'files,changedFiles'/);
  assert.match(fn, /json\.changedFiles\) !== files\.length/);
});

test('a dry run announces nothing, cancels nothing and merges nothing', () => {
  const laneSection = RELAY.slice(RELAY.indexOf('Lane A: announce, wait one hour, merge'));
  for (const phrase of [
    'DRY RUN — would announce Lane A',
    'DRY RUN — would cancel Lane A',
    'DRY RUN — would auto-merge PR',
    'DRY RUN — would post to the bus',
  ]) {
    assert.ok(laneSection.includes(phrase), `dry run must cover: ${phrase}`);
  }
});

test('this very change could not have auto-merged itself', () => {
  // Criterion 4 is not an abstraction. The files below are what this task
  // touched, and a lane that would wave them through would be a lane that can
  // widen its own permissions.
  const ownFiles = [
    'scripts/builder/autoMergeLane.js',
    'scripts/builder/autoMergeLane.test.js',
    'scripts/builder/autoMergeLedgerFile.js',
    'scripts/builder/autoMergeLedgerFile.test.js',
    'scripts/clickup_direct.mjs',
    'docs/LOOP_ENGINEERING.md',
  ];
  const r = laneAEligibility(ownFiles);
  assert.equal(r.eligible, false, 'Lane A must never be able to ship Lane A');
});

test('LOOP_ENGINEERING documents the lane, the window, the switch and the digest', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../../docs/LOOP_ENGINEERING.md'), 'utf8');
  for (const needle of [
    'Lane A',
    SWITCH_STOP,
    SWITCH_RESUME,
    'AUTO-MERGE-LANES',
    'auto-merge-status',
  ]) {
    assert.ok(doc.includes(needle), `LOOP_ENGINEERING.md must document: ${needle}`);
  }
});
