'use strict';

/**
 * The scheduled pulse's three decisions, pinned.
 *
 * Every test here is written so that REVERTING the behaviour it covers makes
 * it fail — that is the whole point of the file, and each one was checked that
 * way rather than assumed. The names say what breaks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const digest = require('../../lib/pulseDigest.js');
const pulse = require('./pulse.js');
const nodeRoles = require('../../lib/nodeRoles.js');
const heartbeat = require('../../lib/nodeHeartbeat.js');

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-09-02T12:00:00Z');

/** A pulse result with every section present and clean. */
function cleanResult(over = {}) {
  return {
    generatedAt: new Date(NOW).toISOString(),
    job: 'loop-build',
    noOp: { verdict: 'clear', message: '0 claimless passes; 3 queued', unterminated: [] },
    residency: { findings: [], cannotTell: [], census: { queued: 3 }, unmeasured: [] },
    drift: { findings: [], cannotTell: [], ticketsCompared: 5, openPrsCompared: 2 },
    readyActors: null,
    queueError: null,
    ...over,
  };
}

// --- what reaches the bus ---------------------------------------------------

test('a clean run announces nothing at all — silence on the bus is what a healthy pipeline earns', () => {
  const { items } = digest.announcements(cleanResult());
  assert.deepEqual(items, []);
});

test('a NOTICE never reaches the bus; it lives on the durable record only', () => {
  const { items } = digest.announcements(cleanResult({
    drift: {
      findings: [{ shape: 'shape-1', severity: 'notice', taskId: '86bbaaa', pr: 12, message: 'the ticket did not follow' }],
      cannotTell: [],
    },
  }));
  assert.deepEqual(items, [], 'a notice is real and it is not urgent — posting it is how a channel gets filtered');
});

test('an ALARM reaches the bus', () => {
  const { items } = digest.announcements(cleanResult({
    drift: {
      findings: [{ shape: 'shape-4', severity: 'alarm', taskId: '86bbaaa', pr: 449, message: 'PR #449 names it, the ticket does not' }],
      cannotTell: [],
    },
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, 'alarm');
  assert.match(items[0].detail, /PR #449/);
});

test('a COULD-NOT-TELL reaches the bus — it is not a pass (DOCTRINE 3.11)', () => {
  const { items } = digest.announcements(cleanResult({
    drift: { findings: [], cannotTell: [{ taskId: '86bbaaa', status: 'building', reason: 'gh would not answer' }] },
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, 'cannot-tell');
});

test('a total Loop Queue outage is announced, even though pulse.tally() does not count it', () => {
  // The deliberate difference documented in lib/pulseDigest.js. If this ever
  // stops being true because tally() was fixed (86bbt6hgx), delete the
  // special case rather than leaving two answers in the codebase.
  const result = cleanResult({ residency: null, drift: null, queueError: 'HTTP 500' });
  const { items } = digest.announcements(result);
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'queue:unreadable');
  assert.equal(pulse.tally(result).cannotTell, 0, 'tally still under-counts this — that is the gap being worked around');
});

test('an unreadable A1 log is a could-not-tell, not an all-clear', () => {
  const { items, measured } = digest.announcements(cleanResult({
    noOp: { sourceError: 'could not read ~/loop-logs/loop-build.log (ENOENT)', verdict: 'cannot-tell', unterminated: [] },
  }));
  assert.equal(items.filter((i) => i.scope === 'a1').length, 1);
  assert.ok(!measured.includes('a1'), 'a section that could not be read was not measured, so its stamps stay put');
});

test('announcements covers every alarm and could-not-tell pulse.tally() counts', () => {
  // THE ANTI-DRIFT TEST. If a future section is added to tally() and not to
  // announcements(), the pulse would count an alarm in its own summary line
  // and never tell anybody about it — a check reporting to a ticket nobody
  // has open. Comparing the two counts is cheaper than remembering.
  const result = cleanResult({
    noOp: {
      verdict: 'finding',
      message: 'the loop has not run in 9h',
      unterminated: [
        { start: '2026-09-01 03:00:00', state: 'hung', message: 'a pass started and never ended' },
        { start: '2026-09-01 04:00:00', state: 'running', message: 'almost certainly the one running now' },
        { start: 'nonsense', state: 'cannot-tell', message: 'unreadable timestamp' },
      ],
    },
    residency: {
      findings: [
        { taskId: '86bb1', status: 'building', severity: 'alarm', message: 'stuck building' },
        { taskId: '86bb2', status: 'queued', severity: 'notice', message: 'sat a while' },
      ],
      cannotTell: [{ taskId: '86bb3', status: 'queued', reason: 'no usable date_updated' }],
      census: {},
    },
    drift: {
      findings: [
        { shape: 'shape-4', severity: 'alarm', taskId: '86bb4', pr: 1, message: 'one-way link' },
        { shape: 'shape-1', severity: 'notice', taskId: '86bb5', pr: 2, message: 'ticket did not follow' },
      ],
      cannotTell: [{ taskId: '86bb6', status: 'building', reason: 'comments unreadable' }],
    },
  });
  const counted = pulse.tally(result);
  const { items } = digest.announcements(result);
  assert.equal(items.filter((i) => i.severity === 'alarm').length, counted.alarms,
    'every alarm the pulse counts must be announced');
  assert.equal(items.filter((i) => i.severity === 'cannot-tell').length, counted.cannotTell,
    'every could-not-tell the pulse counts must be announced');
  assert.equal(items.length, counted.alarms + counted.cannotTell);
  assert.equal(counted.notices, 2, 'and the notices are deliberately NOT in there');
});

// --- identity across runs ---------------------------------------------------

test('a hung pass keeps the same key as it gets older, so it is announced once and not hourly', () => {
  const at = (message) => digest.announcements(cleanResult({
    noOp: { verdict: 'clear', message: 'fine', unterminated: [{ start: '2026-09-01 03:00:00', state: 'hung', message }] },
  })).items[0].key;
  // The message carries the age, which changes every run. The key must not.
  //
  // The ages go FIRST in these two strings on purpose. An earlier version put
  // them at the end, where a truncating key derived from the message would
  // have cut them off and passed — an assertion that could not fail, caught by
  // break-testing it. The key must be built from `start`, and the second
  // assertion says so directly rather than only by implication.
  const nine = at('9h in: a pass started 2026-09-01 03:00:00 and never printed an END banner');
  const ten = at('10h in: a pass started 2026-09-01 03:00:00 and never printed an END banner');
  assert.equal(nine, ten);
  assert.ok(nine.includes('2026-09-01 03:00:00'), 'the key is the pass start, which is its identity');
  assert.ok(!nine.includes('9h in'), 'and carries nothing that changes between runs');
});

test('the same ticket stuck in a DIFFERENT stage is a new finding and is announced again', () => {
  const keyFor = (status) => digest.announcements(cleanResult({
    residency: { findings: [{ taskId: '86bb1', status, severity: 'alarm', message: 'stuck' }], cannotTell: [], census: {} },
  })).items[0].key;
  assert.notEqual(keyFor('building'), keyFor('in review'));
});

test('two one-way PRs on one ticket are two findings, not one', () => {
  const { items } = digest.announcements(cleanResult({
    drift: {
      findings: [
        { shape: 'shape-4', severity: 'alarm', taskId: '86bb1', pr: 446, message: 'PR #446' },
        { shape: 'shape-4', severity: 'alarm', taskId: '86bb1', pr: 449, message: 'PR #449' },
      ],
      cannotTell: [],
    },
  }));
  assert.equal(new Set(items.map((i) => i.key)).size, 2);
});

// --- suppression ------------------------------------------------------------

test('a finding announced inside the window is held, and one outside it is due', () => {
  const items = [{ key: 'a', severity: 'alarm' }, { key: 'b', severity: 'alarm' }];
  const { due, held } = digest.duePosts({
    items,
    stamps: { a: new Date(NOW - HOUR).toISOString(), b: new Date(NOW - 7 * HOUR).toISOString() },
    now: NOW,
    everyMs: 6 * HOUR,
  });
  assert.deepEqual(due.map((i) => i.key), ['b']);
  assert.deepEqual(held.map((i) => i.key), ['a']);
});

test('an unparseable stamp errs towards posting, never towards silence', () => {
  const { due } = digest.duePosts({
    items: [{ key: 'a', severity: 'alarm' }], stamps: { a: 'not a date' }, now: NOW, everyMs: 6 * HOUR,
  });
  assert.equal(due.length, 1);
});

test('a stamp is cleared only when its section was actually measured', () => {
  const existing = ['a1:loop-build:stalled', 'b1:86bb1:shape-4:449'];
  // b1 was read this pass and the finding is gone; a1 could not be read.
  const clear = digest.staleStampKeys(existing, { items: [], measured: ['b1'] });
  assert.deepEqual(clear, ['b1:86bb1:shape-4:449'],
    'clearing a1 would re-announce it the moment the log came back; never clearing b1 '
    + 'would turn a six-hour window into a permanent one');
});

test('a stamp for a finding this run STILL sees is never cleared', () => {
  const key = 'b1:86bb1:shape-4:449';
  assert.deepEqual(digest.staleStampKeys([key], { items: [{ key }], measured: ['b1'] }), []);
});

test('a live finding whose key is SANITISED on disk still matches, so its stamp is not cleared', () => {
  // The real case, not a hypothetical one: an A1 hung-pass key carries the
  // pass's start time, and those spaces become dashes in the filename. The
  // publisher reads basenames off disk and asks about them, so both sides have
  // to be in the stored form. Comparing a raw key against a stored name finds
  // no match, decides the alarm has gone away, clears its stamp — and
  // re-announces a still-live alarm every hour, which is how a channel gets
  // filtered and the check stops being read.
  const key = 'a1:loop-build:hung:2026-09-01 03:00:00';
  const onDisk = digest.stampFileName(key).replace(/\.stamp$/, '');
  assert.notEqual(onDisk, key, 'the fixture is only meaningful while this key IS sanitised');
  assert.deepEqual(
    digest.stampNamesToClear({ onDiskNames: [onDisk], items: [{ key }], measured: ['a1'] }), [],
    'the finding is still live, so its stamp stays',
  );
});

test('a stamp whose finding HAS gone away is cleared, sanitised name and all', () => {
  const gone = digest.stampFileName('a1:loop-build:hung:2026-09-01 03:00:00').replace(/\.stamp$/, '');
  assert.deepEqual(
    digest.stampNamesToClear({ onDiskNames: [gone], items: [], measured: ['a1'] }), [gone],
    'never clearing turns a six-hour suppression window into a permanent silence',
  );
});

test('the stamp filename keeps the colon, so the scope can be read back off disk', () => {
  const key = 'b1:86bb1:shape-4:449';
  const file = digest.stampFileName(key).replace(/\.stamp$/, '');
  assert.equal(digest.scopeOfKey(file), 'b1');
});

// --- what gets written ------------------------------------------------------

test('the durable record repeats the findings above the report, not only inside it', () => {
  const result = cleanResult({
    drift: { findings: [{ shape: 'shape-4', severity: 'alarm', taskId: '86bb1', pr: 449, message: 'PR #449 one-way link' }], cannotTell: [] },
  });
  const { items } = digest.announcements(result);
  const body = digest.renderDigest({
    result, report: 'the full report body', items, node: 'mac-mini', now: NOW, everyMs: 6 * HOUR,
  });
  const fenceAt = body.indexOf('```');
  const summaryAt = body.indexOf('PR #449 one-way link');
  // `indexOf` returns -1 when the text is absent, and -1 is less than
  // everything — so the presence check has to come first or the ordering
  // assertion passes hardest exactly when the summary has been deleted. That
  // is what break-testing this found.
  assert.ok(summaryAt >= 0, 'the finding has to appear in the summary at all');
  assert.ok(fenceAt >= 0, 'and the full report has to be there under it');
  assert.ok(summaryAt < fenceAt,
    'ClickUp renders this in a wide column and a long fence still has to be scrolled');
  assert.match(body, /1 alarm\(s\), 0 notice\(s\), 0 could-not-tell/);
  assert.match(body, /A could-not-tell is not a pass/);
});

test('a clean run still writes a record — silence is never an all-clear (rule 1)', () => {
  const body = digest.renderDigest({
    result: cleanResult(), report: 'clean', items: [], node: 'mac-mini', now: NOW, everyMs: 6 * HOUR,
  });
  assert.match(body, /Nothing was announced this run/);
  assert.match(body, /rewritten in place/);
});

test('the bus post separates alarms from could-not-tells and says the window', () => {
  const text = digest.renderPulsePost({
    items: [
      { key: 'a', severity: 'alarm', title: 'x', detail: 'a real alarm' },
      { key: 'b', severity: 'cannot-tell', title: 'y', detail: 'a reading not taken' },
    ],
    node: 'mac-mini',
    now: NOW,
    everyMs: 6 * HOUR,
    digestUrl: 'https://app.clickup.com/t/abc',
  });
  assert.match(text, /1 alarm\b/);
  assert.match(text, /1 could-not-tell/);
  assert.match(text, /not an all-clear/);
  assert.match(text, /once every 6 hours/);
  assert.match(text, /https:\/\/app\.clickup\.com\/t\/abc/);
  assert.match(text, /— \[CC-starcaster\]/);
});

// --- the pause switch: paused and unreadable are NOT the same outcome -------

test('a PAUSED pass still records its heartbeat — it is a complete pass that stayed quiet', () => {
  const outcome = digest.switchOutcome({ readable: true, paused: true });
  assert.equal(outcome.publish, false, 'Dane has the deck, so nothing is written');
  assert.equal(outcome.beat, true,
    'without the beat, a day on the deck makes the roll call announce this job has gone quiet '
    + 'while it is running perfectly — a false alarm from the watchdog whose only value is being trusted');
  assert.equal(outcome.exit, 0);
  assert.equal(outcome.loud, false);
});

test('an UNREADABLE switch does not beat, exits non-zero, and says so loudly', () => {
  const outcome = digest.switchOutcome({ readable: false, paused: true });
  assert.equal(outcome.publish, false);
  assert.equal(outcome.beat, false,
    'a beat here would certify a blind watchdog as healthy');
  assert.equal(outcome.exit, 1,
    'a quiet 0 publishes nothing every hour forever and report_job_failure never fires');
  assert.equal(outcome.loud, true);
});

test('a RUNNING pipeline publishes and beats', () => {
  assert.deepEqual(digest.switchOutcome({ readable: true, paused: false }),
    { publish: true, beat: true, exit: 0, loud: false });
});

// --- round-3 send-back: a pass that delivered nothing is not a pass ---------

test('a pass that found things and DELIVERED NONE of them does not beat and exits non-zero', () => {
  // The defect verbatim: the catch around postBusMessage logged the failure and
  // fell through to recordBeat() and exit(0), so six alarms reaching nobody
  // ended as a green run on every surface — exit 0, heartbeat recorded,
  // report_job_failure never fired, roll call showing the job alive and well.
  const outcome = digest.deliveryOutcome({ due: 6, delivered: false, why: 'ClickUp 429' });
  assert.equal(outcome.exit, 1,
    'non-zero is what makes report_job_failure fire this hour');
  assert.equal(outcome.beat, false,
    'and withholding the beat is what makes the roll call notice at 25h even when the '
    + 'bus itself is what is down — the two surfaces fail independently, so it takes both');
  assert.equal(outcome.loud, true);
  assert.match(outcome.why, /6 finding\(s\) were found and NONE of them reached the bus/);
  assert.match(outcome.why, /ClickUp 429/, 'and it names the reason it could not send');
});

test('a delivered pass beats and exits 0', () => {
  assert.deepEqual(digest.deliveryOutcome({ due: 6, delivered: true }),
    { beat: true, exit: 0, loud: false, why: '' });
});

test('nothing due is delivered trivially — a quiet pass is a complete pass', () => {
  // The common case by far, and it must not be dragged into the failure branch
  // by a `delivered: false` default or by counting an empty send as a failure.
  assert.deepEqual(digest.deliveryOutcome({ due: 0, delivered: true }),
    { beat: true, exit: 0, loud: false, why: '' });
  assert.deepEqual(digest.deliveryOutcome({ due: 0, delivered: false }),
    { beat: true, exit: 0, loud: false, why: '' });
  assert.deepEqual(digest.deliveryOutcome(),
    { beat: true, exit: 0, loud: false, why: '' });
});

test('BREAK-TEST: the publisher decides its ending from what it DELIVERED, not from getting there', () => {
  // Pins the wiring, not just the decision. The bug was entirely in the call
  // site: the pure function did not exist, and `recordBeat(); process.exit(0)`
  // sat unconditionally at the bottom of the file.
  const src = fs.readFileSync(path.join(__dirname, '..', 'pulse_publish.mjs'), 'utf8');
  assert.match(src, /digest\.deliveryOutcome\(\{[^}]*delivered: !sendFailure/,
    'pulse_publish.mjs must ask deliveryOutcome whether the send actually happened');
  assert.match(src, /if \(delivery\.beat\) recordBeat\(\);/,
    'the beat must be conditional on delivery');
  assert.match(src, /process\.exit\(delivery\.exit\);/,
    'and so must the exit code');
  assert.doesNotMatch(src, /^recordBeat\(\);$/m,
    'an unconditional recordBeat() at the bottom is the exact shape that was sent back');
});

test('the switch verdict reads `certain: false` as unreadable, not as paused', () => {
  // The two shapes pipeline.mjs reports this way: a failed ClickUp read, and a
  // trail truncated so badly that a "still paused" reminder arrived without
  // the pause it refers to. Both exit 3 there — deliberately — so the exit
  // code cannot be what tells them apart.
  const v = digest.switchVerdict({
    status: 3,
    stdout: JSON.stringify({ paused: true, certain: false, code: 3, message: 'Could not read the pipeline pause switch.' }),
  });
  assert.equal(v.readable, false);
  assert.match(v.why, /Could not read/);
});

test('a genuine pause is readable, so it is reported as a pause and not as a fault', () => {
  const v = digest.switchVerdict({
    status: 3,
    stdout: JSON.stringify({ paused: true, certain: true, code: 3, message: 'The pipeline is PAUSED — Dane has the deck.\nWhy: shipping by hand' }),
  });
  assert.equal(v.readable, true);
  assert.equal(v.paused, true);
  assert.equal(v.why, 'The pipeline is PAUSED — Dane has the deck.', 'the first line, not the whole message');
});

test('a switch check that printed no verdict at all is unreadable, never an all-clear', () => {
  // The shape when pipeline.mjs bails before it can answer — no token, a crash.
  const v = digest.switchVerdict({ status: 2, stdout: '', stderr: 'CLICKUP_API_TOKEN is not set in this environment.' });
  assert.equal(v.readable, false);
  assert.equal(v.paused, true, 'and it still fails safe: nothing is published');
  assert.match(v.why, /CLICKUP_API_TOKEN/, 'the reason has to travel, or the log says only "something went wrong"');
});

test('a switch check that HUNG is unreadable and names the timeout', () => {
  // This is what spawnSync reports when its deadline kills the child. Without
  // a deadline it never reports anything: launchd will not start a second copy
  // while the first is stuck, so the schedule is simply dead.
  const v = digest.switchVerdict({
    error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    signal: 'SIGTERM',
    timeoutMs: 2 * 60 * 1000,
  });
  assert.equal(v.readable, false);
  assert.match(v.why, /did not answer within 2 minutes/);
});

test('the verdict is the LAST parseable line, so anything printed before it cannot be mistaken for it', () => {
  // The decoy is deliberately verdict-SHAPED and says the opposite. An earlier
  // version of this test used a decoy with no `paused` key, which the shape
  // guard skipped either way — so scanning forwards passed just as happily and
  // the assertion could not fail. Break-testing it is what found that.
  const v = digest.switchVerdict({
    status: 0,
    stdout: JSON.stringify({ paused: true, certain: false, code: 3, message: 'a stale line printed first' })
      + '\nsome prose that does not parse\n'
      + JSON.stringify({ paused: false, certain: true, code: 0, message: 'The pipeline is RUNNING.' }),
  });
  assert.equal(v.readable, true, 'the last word is the answer, not the first');
  assert.equal(v.paused, false);
  assert.equal(v.why, 'The pipeline is RUNNING.');
});

// --- SCOPES actually decides something --------------------------------------

test('every scope announcements() can produce is listed in SCOPES', () => {
  // SCOPES is documented as the authoritative list of clearable scopes, and it
  // used to be referenced by nothing at all — so a scope invented by a typo
  // would have been honoured silently, and a genuinely new section would have
  // had its stamps quietly never cleared. It bounds staleStampKeys now, which
  // makes this pairing load-bearing rather than decorative.
  const result = cleanResult({
    noOp: { verdict: 'finding', message: 'not claiming', unterminated: [{ start: 's', state: 'hung', message: 'hung' }] },
    residency: {
      findings: [{ taskId: '86bb1', status: 'building', severity: 'alarm', message: 'stuck' }],
      cannotTell: [{ taskId: '86bb2', status: 'queued', reason: 'no date' }],
      census: {},
    },
    drift: {
      findings: [{ shape: 'shape-4', severity: 'alarm', taskId: '86bb3', pr: 1, message: 'one-way' }],
      cannotTell: [{ taskId: '86bb4', status: 'building', reason: 'unreadable' }],
    },
  });
  const { items, measured } = digest.announcements(result);
  for (const scope of [...items.map((i) => i.scope), ...measured]) {
    assert.ok(digest.SCOPES.includes(scope), `scope "${scope}" is produced but is not in SCOPES`);
  }
  const outage = digest.announcements(cleanResult({ residency: null, drift: null, queueError: 'HTTP 500' }));
  assert.ok(digest.SCOPES.includes(outage.items[0].scope), 'including the queue scope');
});

test('a scope that is not in SCOPES can never clear a stamp', () => {
  const existing = ['b2:86bb1:whatever'];
  assert.deepEqual(digest.staleStampKeys(existing, { items: [], measured: ['b2'] }), [],
    'a section nothing declares must not be able to authorise a delete');
  assert.deepEqual(digest.staleStampKeys(['b1:86bb1:x'], { items: [], measured: ['b1'] }), ['b1:86bb1:x'],
    'while a declared one still can — otherwise this test would pass with the rule removed');
});

// --- the durable record must not contradict itself --------------------------

test('the headline agrees with the findings under it when the Loop Queue is unreadable', () => {
  // pulse.tally() does not count queueError (86bbt6hgx), so a headline taken
  // from it read "0 alarm(s), 0 notice(s), 0 could-not-tell" directly above a
  // CANNOT TELL line saying the queue could not be read at all — a
  // contradiction on the one surface a person actually scans.
  const result = cleanResult({ residency: null, drift: null, queueError: 'HTTP 500' });
  const { items } = digest.announcements(result);
  const body = digest.renderDigest({
    result, report: 'the full report', items, node: 'mac-mini', now: NOW, everyMs: 6 * HOUR,
  });
  assert.match(body, /0 alarm\(s\), 0 notice\(s\), 1 could-not-tell/);
  assert.match(body, /CANNOT TELL/, 'and the finding it is counting is right underneath');
  assert.equal(pulse.tally(result).cannotTell, 0, 'tally still says 0 — the headline no longer asks it');
});

// --- the registry entries this job depends on -------------------------------

test('pipeline-pulse is a registered role owned by exactly one machine', () => {
  const entry = nodeRoles.ROLES['pipeline-pulse'];
  assert.ok(entry, 'without a row here the runner cannot ask whether it may run');
  assert.notEqual(entry.owner, nodeRoles.ANY, '"any" would let two machines rewrite one ticket and post one alarm twice');
  assert.ok(nodeRoles.isKnownNode(entry.owner));
});

test('pipeline-pulse is a real beat emitter, and its cadence fits the overdue window', () => {
  assert.ok(heartbeat.BEAT_EMITTERS['pipeline-pulse'],
    'it has a committed runner that beats — listing it as NOT REPORTING would be false, '
    + 'and leaving it out of both tables fails nodeHeartbeat.test.js');
  assert.ok(!heartbeat.NOT_REPORTING_WHY['pipeline-pulse'], 'it must not be in both');
  // Hourly runs, pushed at most daily, against a 25h window. This is the
  // arithmetic weekly-report fails, which is why that one is still a reason.
  assert.ok(heartbeat.OVERDUE_AFTER_MS > heartbeat.PUSH_EVERY_MS,
    'a healthy hourly job must never be able to read as overdue');
});

test('pipeline-pulse has an installer registered, so provisioning does not report it blocked', () => {
  const provision = require('../../lib/nodeProvision.js');
  const row = provision.JOB_SCHEDULES['pipeline-pulse'];
  assert.ok(row && row.installer, 'a job with no installer row reads as CANNOT DO YET forever');
  assert.equal(row.label, 'com.starcaster.pipeline-pulse');
});

// --- did the durable record actually land? ----------------------------------
//
// Round 2 of this ticket's review: `writeDigest` treated a 200 as proof. A
// ClickUp description write that normalises to nothing returns a clean 200
// (DOCTRINE §3.10), and this write replaces the whole field.

test('a record that reads back EMPTY is a failure, not a success', () => {
  const v = digest.digestWriteVerdict({ sent: 'a full report, hundreds of characters long', readBack: '' });
  assert.equal(v.ok, false, 'the write returned ok and the ticket is blank — that is the case a 200 hides');
  assert.match(v.why, /EMPTY/);
});

test('a record that reads back TRUNCATED is a failure', () => {
  const sent = 'x'.repeat(1000);
  const v = digest.digestWriteVerdict({ sent, readBack: 'x'.repeat(100) });
  assert.equal(v.ok, false, 'a tenth of the report is loss, not markdown normalisation');
  assert.match(v.why, /TRUNCATED/);
  assert.match(v.why, /1000 characters sent, 100 read back/, 'the numbers, so nobody has to guess how bad');
});

test('ClickUp normalising the markdown is NOT treated as loss', () => {
  const sent = 'x'.repeat(1000);
  // 80% back: real, and what a save that rewrites list markers and spacing does.
  const v = digest.digestWriteVerdict({ sent, readBack: 'x'.repeat(800) });
  assert.equal(v.ok, true, 'an exact-match test would fail every single healthy run');
  assert.equal(v.verified, true);
});

test('a read-back that could not be taken is UNVERIFIED, and the pass still completes', () => {
  const v = digest.digestWriteVerdict({ sent: 'a full report', readable: false, why: 'HTTP 502' });
  assert.equal(v.ok, true,
    'failing here would stop this pass posting the alarms it just found — suppressing real '
    + 'alarms to punish an unverifiable read is the worse of the two failures');
  assert.equal(v.verified, false, 'and it must be able to SAY it did not check');
  assert.match(v.why, /UNVERIFIED/);
  assert.match(v.why, /HTTP 502/, 'naming why, so the reader is not sent hunting');
});

test('a verified record says so, with nothing to report', () => {
  const sent = 'a full report';
  const v = digest.digestWriteVerdict({ sent, readBack: sent });
  assert.deepEqual(v, { ok: true, verified: true, why: '' });
});
