'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PASS_MARKERS,
  NOOP_STREAK_THRESHOLD,
  parsePassLog,
  classifyPass,
  classifyUnterminated,
  PASS_HUNG_AFTER_HOURS,
  noOpStreak,
  STAGE_THRESHOLDS,
  RESIDENCY_PROXY_NOTE,
  stageResidency,
  driftFindings,
  isTerminalStatus,
  indexPrsByTicket,
  COMPLETION_MARKER,
  bottleneckSentence,
  describeBreakdown,
  formatDuration,
  formatReport,
  tally,
  exitCodeFor,
} = require('./pulse');

/**
 * Task 86bbm9h60. Seven incidents in one week, not one of them a crash — every
 * one a component that ran, exited 0, and accomplished nothing.
 *
 * THE DANGER IN A DIAGNOSTIC IS NOT THAT IT MISSES SOMETHING. It is that it
 * quietly reports "fine" for a source it could not read, which is the exact
 * failure it was built to catch, arriving through the tool meant to catch it
 * (DOCTRINE 3.11). So the tests that matter most here are the ones proving
 * CANNOT TELL never collapses into CLEAR, and that each threshold actually
 * fires — every one below was broken on purpose and watched to fail before
 * being believed.
 */

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-08-26T12:00:00.000Z');
const agoHours = (h) => NOW - h * HOUR;

// ── A1: parsing the loop log ────────────────────────────────────────────────

const banner = (stamp, kind, exit) =>
  `===== ${stamp} ${kind} /loop-build${exit === undefined ? '' : ` (exit ${exit})`} =====`;

test('parsePassLog pairs START and END banners and keeps the body between them', () => {
  const log = [
    banner('2026-08-26 01:00:00', 'START'),
    'built a thing, 86bbaaaaa',
    banner('2026-08-26 01:20:00', 'END', 0),
    banner('2026-08-26 02:00:00', 'START'),
    'WIP cap reached — 12 PR(s) open, cap 5.',
    banner('2026-08-26 02:01:00', 'END', 0),
  ].join('\n');

  const { passes, unterminated } = parsePassLog(log);
  assert.equal(passes.length, 2);
  assert.equal(unterminated.length, 0);
  assert.equal(passes[0].start, '2026-08-26 01:00:00');
  assert.equal(passes[0].end, '2026-08-26 01:20:00');
  assert.equal(passes[0].exitCode, 0);
  assert.deepEqual(passes[0].body, ['built a thing, 86bbaaaaa']);
});

test('BREAK-TEST: a pass that started and never ended is reported, never dropped', () => {
  // A hung loop and a quiet loop produce the same silence. If parsePassLog
  // discarded the unterminated pass, that silence would be indistinguishable
  // from "no passes ran", which is the whole failure mode.
  const log = [
    banner('2026-08-26 01:00:00', 'START'),
    'claimed 86bbaaaaa',
    banner('2026-08-26 01:20:00', 'END', 0),
    banner('2026-08-26 02:00:00', 'START'),
    'still going...',
  ].join('\n');

  const { passes, unterminated } = parsePassLog(log);
  assert.equal(passes.length, 1, 'the finished pass');
  assert.equal(unterminated.length, 1, 'the hung one must survive as its own state');
  assert.equal(unterminated[0].start, '2026-08-26 02:00:00');
});

test('a banner quoted INSIDE a pass body cannot open a phantom pass', () => {
  // The agent's own report often quotes log lines. Anchoring the banner regex
  // whole-line is what stops a quoted example from splitting one pass in two.
  const log = [
    banner('2026-08-26 01:00:00', 'START'),
    'the wrapper writes `===== 2026-08-26 01:00:00 START /loop-build =====` around each pass',
    banner('2026-08-26 01:20:00', 'END', 0),
  ].join('\n');
  const { passes, unterminated } = parsePassLog(log);
  assert.equal(passes.length, 1);
  assert.equal(unterminated.length, 0, 'the quoted banner is indented, so it is body text');
});

// ── A1: classifying a pass ──────────────────────────────────────────────────

const pass = (body, exitCode = 0) => ({ body: [].concat(body), exitCode, start: 'x', end: 'y' });

test('the quota notice classifies as a decline with its reason — the 14-hour incident', () => {
  const out = classifyPass(pass('You\'ve hit your weekly limit · resets 5pm (America/Denver)', 1));
  assert.equal(out.outcome, 'declined');
  assert.equal(out.reasonKey, 'quota-exhausted');
  assert.match(out.reason, /quota/i);
});

test('the WIP-cap message classifies as a decline, in both the exact and paraphrased form', () => {
  const exact = classifyPass(pass('WIP cap reached — 12 PR(s) open, cap 5. Not claiming.'));
  assert.equal(exact.reasonKey, 'wip-cap');
  const paraphrase = classifyPass(pass('`wip-check` said **16 PRs open, cap 5** so I stopped.'));
  assert.equal(paraphrase.reasonKey, 'wip-cap', 'a pass that retells the message must still classify');
});

test('BREAK-TEST: a rework pass whose build-start exited 3 is NOT read as a cap decline', () => {
  // The first draft matched `wip-check` and `exit 3` anywhere in the body, and
  // mislabelled a real claim on 2026-08-26 01:45 because build-start — a
  // different command — had exited 3. Requiring the QUOTED message is the fix,
  // so this asserts on the exact prose that used to break it.
  const out = classifyPass(pass(
    'This ticket was already in flight, so I continued PR #431 rather than opening a ' +
    'second one (`build-start` said so, exit 3). Ticket 86bbm4zwd.'
  ));
  assert.equal(out.outcome, 'claimed', 'exit 3 from another command must not read as the cap');
});

test('another machine owning the loop is a decline with a reason, not a failure', () => {
  const out = classifyPass(pass('"loop-build" is owned by macbook-pro. This machine is mac-mini, so it did nothing.'));
  assert.equal(out.outcome, 'declined');
  assert.equal(out.reasonKey, 'not-this-machine');
});

test('a pass naming a ticket and hitting no decline marker is a claim', () => {
  assert.equal(classifyPass(pass('Built 86bbm9h60 into PR #440.')).outcome, 'claimed');
});

test('BREAK-TEST: an unreadable pass is "unknown", never "declined" and never "claimed"', () => {
  // Guessing "declined" from silence invents an outage; guessing "claimed"
  // hides one. Both are worse than saying so.
  const out = classifyPass(pass('Done.'));
  assert.equal(out.outcome, 'unknown');
  assert.notEqual(out.outcome, 'declined');
  assert.notEqual(out.outcome, 'claimed');
});

test('a non-zero exit with no marker is "failed", carrying the code', () => {
  const out = classifyPass(pass('something went wrong', 1));
  assert.equal(out.outcome, 'failed');
  assert.match(out.reason, /exit 1/);
});

// ── A1: the streak ──────────────────────────────────────────────────────────

const capped = (n) =>
  Array.from({ length: n }, (_, i) => pass('WIP cap reached — 12 PR(s) open, cap 5.', 0, i));
const claimed = () => pass('Built 86bbaaaaa into PR #1.');

test('the threshold is three, and two declines do not fire', () => {
  assert.equal(NOOP_STREAK_THRESHOLD, 3, 'one is normal, two is plausible, eight happened');
  const out = noOpStreak([claimed(), ...capped(2)], { queuedCount: 20 });
  assert.equal(out.verdict, 'clear');
  assert.equal(out.streak, 2);
});

test('BREAK-TEST: three consecutive declines with work queued fires, and says why', () => {
  const out = noOpStreak([claimed(), ...capped(3)], { queuedCount: 20 });
  assert.equal(out.verdict, 'finding');
  assert.equal(out.streak, 3);
  assert.match(out.message, /3 consecutive claimless passes/);
  assert.match(out.message, /20 queued/);
  assert.match(out.message, /3× wip-cap/, 'rule 3: the count arrives with its breakdown');
});

test('a claim resets the streak — the walk stops at the newest claim', () => {
  const out = noOpStreak([...capped(8), claimed(), ...capped(1)], { queuedCount: 20 });
  assert.equal(out.streak, 1, 'the eight older declines are history, not the current streak');
  assert.equal(out.verdict, 'clear');
});

test('BREAK-TEST: declining an EMPTY queue is never a finding', () => {
  // A loop with nothing to claim is working perfectly. Alarming here trains
  // the reader to ignore the alarm, which costs more than the check is worth.
  const out = noOpStreak([...capped(9)], { queuedCount: 0 });
  assert.equal(out.verdict, 'clear');
  assert.match(out.message, /queue is empty/);
});

test('BREAK-TEST: an unreadable queued count is CANNOT TELL, not clear', () => {
  const out = noOpStreak([...capped(9)], { queuedCount: null });
  assert.equal(out.verdict, 'cannot-tell');
  assert.notEqual(out.verdict, 'clear');
});

test('BREAK-TEST: a streak made ENTIRELY of unclassifiable passes is CANNOT TELL', () => {
  // We do not know these declined. Reporting a stall we cannot see is how a
  // diagnostic loses the reader's trust; reporting "fine" is how it loses them
  // their week.
  const out = noOpStreak([claimed(), pass('Done.'), pass('Done.'), pass('Done.')], { queuedCount: 5 });
  assert.equal(out.verdict, 'cannot-tell');
  assert.equal(out.unreadable, 3);
});

test('a mixed streak still fires, and counts the unreadable passes separately', () => {
  const out = noOpStreak(
    [claimed(), ...capped(2), pass('Done.')],
    { queuedCount: 5 }
  );
  assert.equal(out.verdict, 'finding');
  assert.equal(out.streak, 3);
  assert.equal(out.unreadable, 1);
  assert.match(out.message, /1× unreadable/, 'counted, not assumed');
});

// ── A2: stage residency ─────────────────────────────────────────────────────

const task = (id, status, updatedHoursAgo, name = 'a ticket') => ({
  id,
  name,
  status: { status },
  date_updated: String(agoHours(updatedHoursAgo)),
});

test('every threshold carries the derivation of its number', () => {
  for (const [stage, rule] of Object.entries(STAGE_THRESHOLDS)) {
    assert.ok(rule.hours > 0, `${stage} needs a threshold`);
    assert.ok(rule.why && rule.why.length > 20, `${stage}'s number must say where it came from`);
  }
  assert.equal(STAGE_THRESHOLDS.building.hours, 2);
  assert.equal(STAGE_THRESHOLDS['in review'].hours, 4);
  assert.equal(STAGE_THRESHOLDS['ready to launch'].hours, 24);
  assert.equal(STAGE_THRESHOLDS.queued.hours, 24 * 7);
});

test('BREAK-TEST: a ticket 70 hours in Building is found, with its measurement and threshold', () => {
  // The real shape on 2026-08-25: three tickets at 65-72 hours in a stage a
  // build leaves in fifteen minutes.
  const out = stageResidency([task('86bbstuck', 'building', 70, 'Studio Phase 0')], { now: NOW });
  assert.equal(out.findings.length, 1);
  const f = out.findings[0];
  assert.equal(f.severity, 'alarm');
  assert.match(f.message, /86bbstuck/);
  assert.match(f.message, /2\.9d/, 'the measurement, not a bare "stale"');
  assert.match(f.message, /threshold 2h/, 'and the threshold it crossed');
  assert.match(f.message, /65-72 hours/, 'and where that threshold came from');
});

test('a ticket inside its threshold is not a finding', () => {
  const out = stageResidency([task('86bbfine', 'building', 1)], { now: NOW });
  assert.equal(out.findings.length, 0);
  assert.deepEqual(out.census, { building: 1 });
});

test('Ready to launch is a NOTICE, not an alarm — it is the operator\'s to hold', () => {
  const out = stageResidency([task('86bbheld', 'ready to launch', 40)], { now: NOW });
  assert.equal(out.findings[0].severity, 'notice');
});

test('BREAK-TEST: a ticket with no usable date_updated is CANNOT TELL, not clear', () => {
  const out = stageResidency([{ id: '86bbnodate', name: 'x', status: { status: 'building' } }], { now: NOW });
  assert.equal(out.findings.length, 0);
  assert.equal(out.cannotTell.length, 1);
  assert.match(out.cannotTell[0].reason, /date_updated/);
});

test('a stage with no threshold is listed as unmeasured, never silently skipped', () => {
  const out = stageResidency([task('86bbask', 'needs your input', 500)], { now: NOW });
  assert.equal(out.findings.length, 0);
  assert.equal(out.unmeasured.length, 1, 'invisible and inside-threshold must not look alike');
  assert.equal(out.unmeasured[0].status, 'needs your input');
});

test('the proxy note is carried with the result, so the output cannot overstate its precision', () => {
  const out = stageResidency([], { now: NOW });
  assert.equal(out.proxyNote, RESIDENCY_PROXY_NOTE);
  assert.match(out.proxyNote, /date_updated/);
  assert.match(out.proxyNote, /FLOOR of the real wait/);
});

test('findings come back worst-first', () => {
  const out = stageResidency(
    [task('86bba', 'building', 5), task('86bbb', 'building', 70), task('86bbc', 'building', 30)],
    { now: NOW }
  );
  assert.deepEqual(out.findings.map((f) => f.taskId), ['86bbb', '86bbc', '86bba']);
});

// ── B1: drift, both directions ──────────────────────────────────────────────

const record = (over) => ({
  taskId: '86bbdrift',
  name: 'a ticket',
  status: 'building',
  commentsReadable: true,
  ticketPrNumbers: [],
  buildStartSees: null,
  buildStartPrState: null,
  openPrsNamingTicket: [],
  ...over,
});

test('shape 1 — in-flight ticket whose PR is merged is a notice, and names reconcile', () => {
  const { findings } = driftFindings([
    record({ status: 'in review', ticketPrNumbers: [400], buildStartSees: 400, buildStartPrState: 'MERGED' }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].shape, 'shape-1');
  assert.equal(findings[0].severity, 'notice');
  assert.match(findings[0].message, /reconcile/);
});

test('shape 2 — a terminal ticket with a still-open PR is a zombie, and alarms', () => {
  const { findings } = driftFindings([
    record({ status: 'live', ticketPrNumbers: [401], buildStartSees: 401, buildStartPrState: 'OPEN' }),
  ]);
  assert.equal(findings[0].shape, 'shape-2');
  assert.equal(findings[0].severity, 'alarm');
  assert.match(findings[0].message, /still open/);
});

test('BREAK-TEST: shape 3 — in flight with no PR on EITHER side is stranded', () => {
  const { findings } = driftFindings([record({ status: 'building' })]);
  assert.equal(findings[0].shape, 'shape-3');
  assert.equal(findings[0].severity, 'alarm');
  assert.match(findings[0].message, /stranded/);
  assert.equal(findings[0].pr, null);
});

test('a ticket in flight with an OPEN PR recorded on both sides is clean', () => {
  const { findings, cannotTell } = driftFindings([
    record({ ticketPrNumbers: [402], buildStartSees: 402, buildStartPrState: 'OPEN', openPrsNamingTicket: [402] }),
  ]);
  assert.deepEqual(findings, []);
  assert.deepEqual(cannotTell, []);
});

test('BREAK-TEST: shape 4 — a PR names the ticket but the ticket has no record of it', () => {
  // The dangerous one, and the reason this check reads both directions.
  // build-start decides "is there already a branch" by reading THE TICKET, so
  // a link that exists only on the PR side is invisible to it — which is
  // exactly how duplicate PRs #407 and #408 were born. Real case: #373.
  const { findings } = driftFindings([
    record({ status: 'building', openPrsNamingTicket: [373] }),
  ]);
  const shape4 = findings.filter((f) => f.shape === 'shape-4');
  assert.equal(shape4.length, 1);
  assert.equal(shape4[0].pr, 373);
  assert.equal(shape4[0].severity, 'alarm');
  assert.match(shape4[0].message, /build-start would see nothing/);
  assert.match(shape4[0].message, /duplicate/);
});

test('shape 4 also fires when the ticket records a DIFFERENT PR than the open one', () => {
  const { findings } = driftFindings([
    record({ ticketPrNumbers: [300], buildStartSees: 300, buildStartPrState: 'CLOSED', openPrsNamingTicket: [373] }),
  ]);
  const shape4 = findings.filter((f) => f.shape === 'shape-4');
  assert.equal(shape4.length, 1);
  assert.match(shape4[0].message, /build-start would see #300/);
});

test('BREAK-TEST: unreadable comments are CANNOT TELL — never reported as stranded', () => {
  // A ticket whose comments failed to load has no PR link visible, which looks
  // identical to having none. Calling that "stranded" manufactures a finding.
  const { findings, cannotTell } = driftFindings([record({ commentsReadable: false })]);
  assert.deepEqual(findings, []);
  assert.equal(cannotTell.length, 1);
  assert.match(cannotTell[0].reason, /could not be read/);
});

test('BREAK-TEST: an unreadable PR state is CANNOT TELL, not a clean ticket', () => {
  const { findings, cannotTell } = driftFindings([
    record({ ticketPrNumbers: [404], buildStartSees: 404, buildStartPrState: null, openPrsNamingTicket: [404] }),
  ]);
  assert.deepEqual(findings, []);
  assert.equal(cannotTell.length, 1);
  assert.match(cannotTell[0].reason, /would not say whether it is open/);
});

// ── Rule 4: the bottleneck sentence ─────────────────────────────────────────

test('a firing no-op streak names BUILD as the bottleneck, and clears the operator', () => {
  const noOp = noOpStreak([claimed(), ...capped(4)], { queuedCount: 26 });
  const s = bottleneckSentence({
    noOp,
    residency: stageResidency([task('86bbr', 'ready to launch', 1)], { now: NOW }),
  });
  assert.match(s, /^Bottleneck: BUILD/);
  assert.match(s, /4 consecutive claimless passes/);
  assert.match(s, /26 queued/);
  assert.match(s, /Ready to launch holds 1/, 'it must say the operator is not the problem');
});

test('a backed-up review stage names REVIEW', () => {
  const residency = stageResidency(
    [task('86bb1', 'in review', 40), task('86bb2', 'in review', 50), task('86bb3', 'in review', 1)],
    { now: NOW }
  );
  const s = bottleneckSentence({ noOp: noOpStreak([claimed()], { queuedCount: 3 }), residency });
  assert.match(s, /^Bottleneck: REVIEW/);
  assert.match(s, /2 of 3/, 'the count with its denominator, not a bare number');
});

test('approved work waiting past a day names the OPERATOR, and says the machines kept up', () => {
  const residency = stageResidency([task('86bb1', 'ready to launch', 40)], { now: NOW });
  const s = bottleneckSentence({ noOp: noOpStreak([claimed()], { queuedCount: 0 }), residency });
  assert.match(s, /^Bottleneck: OPERATOR/);
  assert.match(s, /machine side is keeping up/);
});

test('BREAK-TEST: a healthy pipeline says so out loud — silence is never all-clear', () => {
  const residency = stageResidency([task('86bb1', 'in review', 1)], { now: NOW });
  const s = bottleneckSentence({ noOp: noOpStreak([claimed()], { queuedCount: 4 }), residency });
  assert.match(s, /^No bottleneck/);
  assert.ok(s.length > 20, 'rule 1: an all-clear must be a stated sentence, not an empty line');
});

test('BREAK-TEST: when the streak cannot be judged, the bottleneck says CANNOT TELL', () => {
  const noOp = noOpStreak([...capped(5)], { queuedCount: null });
  const s = bottleneckSentence({ noOp, residency: stageResidency([], { now: NOW }) });
  assert.match(s, /^Bottleneck: CANNOT TELL/);
});

// ── The report and the exit code ────────────────────────────────────────────

const fullResult = () => ({
  generatedAt: '2026-08-26T12:00:00.000Z',
  noOp: { ...noOpStreak([claimed(), ...capped(4)], { queuedCount: 26 }), source: '/tmp/loop-build.log', unterminated: [] },
  residency: stageResidency([task('86bbstuck', 'building', 70)], { now: NOW }),
  drift: { ...driftFindings([record({ openPrsNamingTicket: [373] })]), ticketsCompared: 4, openPrsCompared: 10 },
});

test('BREAK-TEST: the report prints all three checks even when a check is clear', () => {
  // Rule 1. If a clear check printed nothing, an all-clear run and a run that
  // died after check one would look the same on screen.
  const clean = {
    generatedAt: '2026-08-26T12:00:00.000Z',
    noOp: { ...noOpStreak([claimed()], { queuedCount: 2 }), source: '/tmp/x.log', unterminated: [] },
    residency: stageResidency([task('86bb1', 'building', 1)], { now: NOW }),
    drift: { findings: [], cannotTell: [], ticketsCompared: 1, openPrsCompared: 3 },
  };
  const text = formatReport(clean);
  assert.match(text, /A1\s+NO-OP STREAK/);
  assert.match(text, /A2\s+STAGE RESIDENCY/);
  assert.match(text, /B1\s+TICKET <-> PR DRIFT/);
  assert.match(text, /CLEAR\s+every measured ticket is inside its threshold/);
  assert.match(text, /CLEAR\s+every ticket and PR names the other/);
});

test('BREAK-TEST: the report always ends with the completion marker — rule 5', () => {
  // A scheduled run that produces no report must be distinguishable from one
  // that ran and found nothing. The marker is what makes the absence readable.
  const text = formatReport(fullResult());
  assert.ok(text.trim().split('\n').pop().startsWith(COMPLETION_MARKER));
  assert.match(text, /absence IS the alert/);
});

test('the report names the ticket, the measurement and the threshold for every finding', () => {
  const text = formatReport(fullResult());
  assert.match(text, /86bbstuck/);
  assert.match(text, /threshold 2h/);
  assert.match(text, /PR #373/);
  assert.match(text, /shape-4/);
});

test('an unread loop log is reported as CANNOT TELL with its reason', () => {
  const text = formatReport({
    generatedAt: 'now',
    noOp: { sourceError: 'could not read /tmp/nope.log (ENOENT)' },
    residency: stageResidency([], { now: NOW }),
    drift: { findings: [], cannotTell: [], ticketsCompared: 0, openPrsCompared: 0 },
  });
  assert.match(text, /CANNOT TELL — could not read \/tmp\/nope\.log \(ENOENT\)/);
});

test('the summary totals carry their parts, and say a could-not-tell is not a pass', () => {
  const text = formatReport(fullResult());
  assert.match(text, /alarm\(s\).*notice\(s\).*could-not-tell/);
  assert.match(text, /A could-not-tell is not a pass/);
});

test('tally counts alarms, notices and could-not-tells into separate buckets', () => {
  const t = tally(fullResult());
  assert.ok(t.alarms >= 3, 'the streak, the stuck ticket and the one-way link');
  assert.equal(t.cannotTell, 0);
});

test('BREAK-TEST: --exit-code separates "clean" from "could not look"', () => {
  // 0 and 2 must never collapse: a caller has to be able to treat "I looked
  // and it was fine" differently from "I could not look".
  const clean = {
    noOp: { ...noOpStreak([claimed()], { queuedCount: 0 }), unterminated: [] },
    residency: stageResidency([], { now: NOW }),
    drift: { findings: [], cannotTell: [] },
  };
  assert.equal(exitCodeFor(clean), 0);

  const blind = {
    noOp: { sourceError: 'no log' },
    residency: stageResidency([], { now: NOW }),
    drift: { findings: [], cannotTell: [] },
  };
  assert.equal(exitCodeFor(blind), 2, 'could-not-tell is its own exit code, not 0');

  assert.equal(exitCodeFor(fullResult()), 1);
});

// ── small helpers ───────────────────────────────────────────────────────────

test('describeBreakdown never returns a bare number', () => {
  assert.equal(describeBreakdown({ 'wip-cap': 3, unreadable: 1 }), '3× wip-cap, 1× unreadable');
  assert.match(describeBreakdown({}), /nothing to break down/);
});

test('formatDuration switches units so a long wait reads as days', () => {
  assert.equal(formatDuration(0.5), '30m');
  assert.equal(formatDuration(3), '3h');
  assert.equal(formatDuration(70), '2.9d');
});

test('every pass marker has a human-readable label', () => {
  for (const m of PASS_MARKERS) {
    assert.ok(m.key && m.label && m.re instanceof RegExp);
    assert.ok(m.label.length > 10, `${m.key} needs a label a person can read`);
  }
});

test('BREAK-TEST: the bottleneck sentence and the finding quote the SAME queued count', () => {
  // Caught while writing this suite. The sentence read `queued` off the stage
  // census while the streak finding read it off its own input, so a report
  // could print "0 queued" one line above a finding saying 26 — one report
  // contradicting itself, which is worse than no report. One source now.
  const noOp = noOpStreak([claimed(), ...capped(4)], { queuedCount: 26 });
  const residency = stageResidency([task('86bbr', 'ready to launch', 1)], { now: NOW });
  const sentence = bottleneckSentence({ noOp, residency });

  assert.match(noOp.message, /26 queued/);
  assert.match(sentence, /26 queued/, 'the census holds no queued tickets, but 26 is the real number');
});

// ── The two defects the first production run exposed ────────────────────────

test('BREAK-TEST: a QUEUED ticket with an open PR is a send-back, not a zombie', () => {
  // The first run against production called two of these zombies — 86bbjve6b
  // with #419 open and 86bbev0gx with #428 — because `queued` is not in the
  // in-flight set and "not in flight" had been read as "finished". It is the
  // ordinary state of work a review handed back, and the exact state
  // build-start exists to recognise. A check that cries wolf gets ignored,
  // and then misses the real one.
  const { findings } = driftFindings([
    record({ status: 'queued', ticketPrNumbers: [419], buildStartSees: 419,
             buildStartPrState: 'OPEN', openPrsNamingTicket: [419] }),
  ]);
  assert.deepEqual(findings, [], 'a send-back is normal, and must produce no finding at all');
});

test('a queued ticket whose PR has MERGED is still drift — the work is live, the ticket is not', () => {
  const { findings } = driftFindings([
    record({ status: 'queued', ticketPrNumbers: [419], buildStartSees: 419, buildStartPrState: 'MERGED' }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].shape, 'shape-1');
});

test('ClickUp\'s own status.type settles terminality, so a future done-type needs no name list', () => {
  assert.equal(isTerminalStatus('live'), true);
  assert.equal(isTerminalStatus('queued'), false);
  assert.equal(isTerminalStatus('building'), false);
  assert.equal(isTerminalStatus("won't do", 'closed'), true, 'a status this file has never heard of');
  assert.equal(isTerminalStatus('in review', 'open'), false);
});

test('BREAK-TEST: a PR that merely MENTIONS other tickets does not link to them', () => {
  // The other production false positive. PR #435 discusses four other tickets
  // in its prose — one of them the literal example `86bbnonexistent` — while
  // declaring exactly one via the required ClickUp URL line. Scanning for bare
  // ids reported four one-way links that do not exist.
  const index = indexPrsByTicket([{
    number: 435,
    title: 'One command that answers what is actually waiting on Dane',
    body: [
      'https://app.clickup.com/t/86bbk34x7',
      '',
      'This supersedes the approach in 86bbjj6qb and covers 86bbjve6b too.',
      'An id that does not exist, such as 86bbnonexistent, prints a clear error.',
    ].join('\n'),
  }]);

  assert.deepEqual([...index.keys()], ['86bbk34x7'], 'only the declared ticket');
  assert.deepEqual(index.get('86bbk34x7'), [435]);
  for (const mentioned of ['86bbjj6qb', '86bbjve6b', '86bbnonexistent']) {
    assert.equal(index.has(mentioned), false, `${mentioned} is discussed, not claimed`);
  }
});

test('two PRs declaring the same ticket both land under it', () => {
  const index = indexPrsByTicket([
    { number: 1, title: 'a', body: 'https://app.clickup.com/t/86bbsame' },
    { number: 2, title: 'b', body: 'ref https://app.clickup.com/t/86bbsame here' },
  ]);
  assert.deepEqual(index.get('86bbsame'), [1, 2]);
});

test('a PR with no ClickUp link contributes nothing rather than throwing', () => {
  assert.equal(indexPrsByTicket([{ number: 9, title: 'x', body: null }]).size, 0);
  assert.equal(indexPrsByTicket(null).size, 0);
});

// ── A running pass is not a hung one ────────────────────────────────────────

test('BREAK-TEST: the pulse does not report the loop pass it is running inside as hung', () => {
  // The first production run did exactly this. The pulse runs while the loop
  // runs, so the newest pass is usually the live one; calling it "hung or
  // killed" on every single run teaches the reader to skim that line, and the
  // day it means something they skim past it then too.
  const now = Date.parse('2026-08-26T09:10:00');
  const out = classifyUnterminated({ start: '2026-08-26 08:53:10' }, { now });
  assert.equal(out.state, 'running');
  assert.notEqual(out.state, 'hung');
  assert.match(out.message, /running right now/);
});

test('BREAK-TEST: a pass unterminated for two days IS hung, and says how long', () => {
  const now = Date.parse('2026-08-26T09:10:00');
  const out = classifyUnterminated({ start: '2026-08-23 22:13:52' }, { now });
  assert.equal(out.state, 'hung');
  assert.match(out.message, /2\.5d/);
  assert.match(out.message, /past 4h is dead/, 'the threshold, with its derivation');
});

test('the hung threshold sits well outside the longest real pass', () => {
  assert.equal(PASS_HUNG_AFTER_HOURS, 4, 'longest observed pass was 38 minutes');
});

test('an unreadable or future-dated start is CANNOT TELL, not a verdict', () => {
  const now = Date.parse('2026-08-26T09:10:00');
  assert.equal(classifyUnterminated({ start: 'not a date' }, { now }).state, 'cannot-tell');
  assert.equal(classifyUnterminated({ start: '2027-01-01 00:00:00' }, { now }).state, 'cannot-tell');
});

test('a hung pass counts as an alarm; a running one counts as nothing at all', () => {
  const base = {
    residency: stageResidency([], { now: NOW }),
    drift: { findings: [], cannotTell: [] },
  };
  const running = tally({ ...base, noOp: { verdict: 'clear', unterminated: [{ state: 'running', message: 'x' }] } });
  assert.deepEqual(running, { alarms: 0, notices: 0, cannotTell: 0 });

  const hung = tally({ ...base, noOp: { verdict: 'clear', unterminated: [{ state: 'hung', message: 'x' }] } });
  assert.equal(hung.alarms, 1);
});

// ── The #373 fixture, reconstructed exactly ─────────────────────────────────

test('BREAK-TEST: the real one-way link — PR #373 <-> 86bbjj6qb, as it stood on 2026-08-25', () => {
  // The case the ticket names, and the reason B1 reads both directions. It has
  // since been repaired by hand (a `PR opened:` comment was added), so the live
  // pulse correctly reports nothing for it — which is exactly why the proof
  // that the check WOULD have caught it has to live here, in the state as it
  // actually stood: PR #373 open and declaring the ticket, the ticket itself
  // carrying no record of any PR.
  const index = indexPrsByTicket([{
    number: 373,
    title: 'Public POST endpoints verify the projectId they are handed',
    body: 'https://app.clickup.com/t/86bbjj6qb\n\nPlain-language summary…',
  }]);
  assert.deepEqual(index.get('86bbjj6qb'), [373]);

  const { findings } = driftFindings([{
    taskId: '86bbjj6qb',
    name: 'Public POST endpoints accept an unverified projectId on system hosts',
    status: 'ready to launch',
    commentsReadable: true,
    ticketPrNumbers: [],          // the ticket had no "PR opened:" line
    buildStartSees: null,         // …so build-start saw nothing
    buildStartPrState: null,
    openPrsNamingTicket: index.get('86bbjj6qb'),
  }]);

  const shape4 = findings.filter((f) => f.shape === 'shape-4');
  assert.equal(shape4.length, 1, 'the one-way link must be found');
  assert.equal(shape4[0].pr, 373);
  assert.equal(shape4[0].taskId, '86bbjj6qb');
  assert.match(shape4[0].message, /build-start would see nothing/);
});

test('and once the "PR opened:" comment is added, the same ticket reports clean', () => {
  // The repair that actually happened. The finding must disappear on the fix,
  // or it is not measuring the drift — it is measuring the ticket's existence.
  const { findings, cannotTell } = driftFindings([{
    taskId: '86bbjj6qb',
    name: 'Public POST endpoints accept an unverified projectId on system hosts',
    status: 'ready to launch',
    commentsReadable: true,
    ticketPrNumbers: [373],
    buildStartSees: 373,
    buildStartPrState: 'OPEN',
    openPrsNamingTicket: [373],
  }]);
  assert.deepEqual(findings, []);
  assert.deepEqual(cannotTell, []);
});

// ── Read-only is a property, not an intention ───────────────────────────────

test('BREAK-TEST: the pulse command contains no write path at all', () => {
  // Criterion 5. Proven empirically once (the Loop Queue was byte-identical
  // across four production runs), but an empirical proof expires the moment
  // someone adds a convenience "…and fix it while we're here". This is the
  // part that cannot expire.
  //
  // Report, never repair, is not fussiness: shape 4 has two valid fixes — add
  // the comment, or close the PR as superseded — and only a person knows
  // which. `npm run reconcile` is where repairs live.
  const src = fs.readFileSync(path.join(__dirname, '..', 'pulse.cjs'), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))   // strip comment lines
    .join('\n');

  const forbidden = [
    [/method:\s*'(POST|PUT|PATCH|DELETE)'/, 'an HTTP write to ClickUp'],
    [/clickup_direct/, 'a shell-out to the write-capable ClickUp command'],
    [/moveTaskStatus|postBusMessage/, 'a status move or a bus post'],
    [/fs\.(writeFile|appendFile|unlink|rm|mkdir)/, 'a filesystem write'],
    [/'(pr|issue)',\s*'(edit|comment|merge|close|create|review)'/, 'a GitHub write subcommand'],
    [/execFileSync\(\s*'git'/, 'a git invocation'],
  ];
  for (const [re, what] of forbidden) {
    assert.equal(re.test(code), false, `scripts/pulse.cjs must contain no ${what}`);
  }

  assert.match(code, /method:\s*'GET'/, 'and it really does read ClickUp');
  assert.match(code, /'pr',\s*'list'/, 'and it really does read GitHub');
});

test('the pure module reaches nothing outside itself — no clock, no network, no disk', () => {
  // Every threshold here is break-testable only because `now` is passed in.
  // A module that read its own clock could not be tested against a fixed date,
  // and a threshold nobody can test is a threshold that drifts.
  const src = fs.readFileSync(path.join(__dirname, 'pulse.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
  for (const re of [/require\(/, /Date\.now\(\)/, /new Date\(\)/, /fetch\(/, /execFileSync/]) {
    assert.equal(re.test(code), false, `pulse.js must stay pure — found ${re}`);
  }
});
