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
