'use strict';

/**
 * The heartbeat's decisions, driven with no network, no token and no clock of
 * its own — which is the whole reason lib/nodeHeartbeat.js holds no IO.
 *
 * Every test here is written against a way this feature could fail QUIETLY,
 * because a monitoring feature that fails loudly is a nuisance and one that
 * fails quietly is worse than not having it: it converts "nobody is watching"
 * into "something is watching", and the second one stops anybody looking.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hb = require('../../lib/nodeHeartbeat.js');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const agoHours = (h) => new Date(NOW - h * HOUR).toISOString();

/** A role table small enough to reason about, shaped like the real one. */
const ROLES = {
  'bus-relay': { owner: 'mac-mini' },
  'db-refresh': { owner: 'macbook-pro' },
};

// --- the verdict ------------------------------------------------------------

test('a fresh beat reports the role as beating', () => {
  const r = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(2) }],
    now: NOW,
    roles: ROLES,
  });
  assert.equal(r.overdue.length, 0);
  assert.equal(r.silent, false);
  assert.deepEqual(r.beating.map((b) => b.role), ['bus-relay']);
});

test('a beat older than the overdue threshold is QUIET, not merely old', () => {
  const r = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(30) }],
    now: NOW,
    roles: ROLES,
  });
  assert.equal(r.silent, true);
  assert.equal(r.overdue[0].role, 'bus-relay');
  assert.equal(r.overdue[0].owner, 'mac-mini');
  assert.match(r.overdue[0].reason, /last succeeded/);
});

// --- the per-role overdue window --------------------------------------------
//
// The roll call used to judge every job against one 25-hour window. That is
// right for a job that runs every ten minutes and impossible for one that runs
// daily or weekly, whose honest beats land further apart than the window — so
// the watchdog would report a healthy job as dead, every day, which is the
// false-alarm failure this whole feature is written against. These tests are
// what stop the window being quietly widened for a fast job on the way past.

/** A role table with one slow job in it — the case that has no live example yet. */
const ROLES_WITH_DAILY = {
  'bus-relay': { owner: 'mac-mini' },
  'nightly-thing': { owner: 'mac-mini' },
};
const EMITTERS_WITH_DAILY = {
  'bus-relay': { intervalMs: 10 * 60 * 1000, beatMeans: 'success', why: 'fixture' },
  'nightly-thing': { intervalMs: 24 * HOUR, beatMeans: 'success', why: 'fixture' },
};

test('each role has its overdue window sized from its own cadence, not one global number', () => {
  assert.equal(hb.overdueAfterFor('nightly-thing', EMITTERS_WITH_DAILY), 48 * HOUR,
    'a daily job gets the push resolution plus one of its own runs');
  assert.equal(hb.overdueAfterFor('bus-relay', EMITTERS_WITH_DAILY), 25 * HOUR,
    'a job that runs oftener than the slack is covered by the slack');
});

test('no existing role has its window moved — this cannot quietly loosen bus-relay', () => {
  // BREAK TEST, the loosening direction, and the reason this change could be
  // adopted everywhere at once. Every role declaring a cadence today runs
  // hourly or oftener, so the slack term wins for all four and each keeps the
  // exact 25 hours it has always had. Anyone who "improves" the formula by
  // adding the interval on top of the slack instead of taking the larger of
  // the two widens bus-relay to 25h10m and the three hourly jobs to 26h, and
  // fails here by name rather than shipping a looser watchdog.
  for (const role of ['bus-relay', 'pipeline-pulse', 'loop-build', 'loop-review']) {
    assert.equal(hb.overdueAfterFor(role), 25 * HOUR,
      `${role}: its overdue window moved off the 25 hours it has always had`);
  }
});

test('a role that declares no cadence gets the floor, never an unmeasurable pass', () => {
  // The counterpart of quietAfterFor returning null. That check reports an
  // unsizeable role as "cannot judge", which is honest because it has a fourth
  // answer to put it in. This one has no such column — every role either beats
  // or is overdue — so an unsizeable role must land on a real window rather
  // than on Infinity, or it becomes permanently unable to be reported dead.
  assert.equal(hb.overdueAfterFor('weekly-report'), hb.OVERDUE_AFTER_MS);
  assert.equal(hb.overdueAfterFor('nonsense-role'), hb.OVERDUE_AFTER_MS);
  assert.equal(hb.OVERDUE_AFTER_MS, 25 * HOUR, 'the floor is still the 25 hours everything used to get');
  assert.equal(hb.OVERDUE_AFTER_MS, hb.PUSH_EVERY_MS + hb.OVERDUE_SLACK_MS,
    'the floor falls out of the same formula rather than being a separate number somebody liked');
});

test('a daily job beating once a day reads as BEATING, not as dead', () => {
  // The bug, stated as a test. Under the old flat 25-hour window this row was
  // reported overdue and posted to the bus — a false alarm on a job that had
  // just run exactly as designed. 48h is the boundary the ticket names (a full
  // day of push throttle plus one of the job's own runs) and it is inclusive
  // by design: the comparison is `>`, so a beat landing precisely on its
  // window is healthy.
  const r = hb.rollCallReport({
    rows: [
      { node: 'mac-mini', role: 'bus-relay', at: agoHours(2) },
      { node: 'mac-mini', role: 'nightly-thing', at: agoHours(48) },
    ],
    now: NOW,
    roles: ROLES_WITH_DAILY,
    emitters: EMITTERS_WITH_DAILY,
  });
  assert.equal(r.silent, false, 'a daily job that beat a day ago is not a silence');
  assert.deepEqual(r.overdue, []);
  assert.ok(r.beating.some((b) => b.role === 'nightly-thing'));
  assert.ok(hb.OVERDUE_AFTER_MS < 48 * HOUR,
    'if the old flat window were still in force this fixture could not distinguish the fix');
});

test('a daily job that genuinely stopped is still reported overdue', () => {
  // BREAK TEST, the direction that matters: the whole risk of this change is
  // loosening a window so far that a real outage stops being reported. Widen
  // nightly-thing's window past four days and this fails.
  const r = hb.rollCallReport({
    rows: [
      { node: 'mac-mini', role: 'bus-relay', at: agoHours(2) },
      { node: 'mac-mini', role: 'nightly-thing', at: agoHours(96) },
    ],
    now: NOW,
    roles: ROLES_WITH_DAILY,
    emitters: EMITTERS_WITH_DAILY,
  });
  assert.equal(r.silent, true, 'four days of silence from a daily job is an outage');
  assert.equal(r.overdue[0].role, 'nightly-thing');
  assert.equal(r.overdue[0].overdueAfterMs, 48 * HOUR);
});

test('every existing role keeps the verdict it has today, role by role', () => {
  // A fixture PER ROLE rather than one for the set, so a regression names the
  // role it loosened instead of failing as an anonymous count.
  for (const role of ['bus-relay', 'pipeline-pulse', 'loop-build', 'loop-review']) {
    const roles = { [role]: { owner: 'mac-mini' } };
    const healthy = hb.rollCallReport({
      rows: [{ node: 'mac-mini', role, at: agoHours(24.5) }], now: NOW, roles,
    });
    assert.equal(healthy.silent, false, `${role}: 24.5h must still read as healthy`);

    const dead = hb.rollCallReport({
      rows: [{ node: 'mac-mini', role, at: agoHours(26) }], now: NOW, roles,
    });
    assert.equal(dead.silent, true, `${role}: 26h must still read as overdue`);
  }
});

test('an overdue reason names the window it was judged against', () => {
  // Once the window is per-role, "last succeeded 30 hours ago" stops being a
  // verdict on its own: 30 hours is dead for the relay and perfectly healthy
  // for a daily job, and a reader on the bus cannot tell which without being
  // told what it was measured against.
  const r = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(30) }],
    now: NOW,
    roles: ROLES,
  });
  assert.match(r.overdue[0].reason, /overdue after/);
  assert.equal(r.overdue[0].overdueAfterMs, 25 * HOUR);
});

test('the threshold has slack, so a run that drifts past 24h is not a false alarm', () => {
  // The push is throttled to once a day. A threshold equal to the interval
  // would report a healthy job as dead roughly daily, and an alarm that cries
  // wolf is an alarm nobody reads — the same failure wearing a different hat.
  const justOver24 = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(24.5) }],
    now: NOW,
    roles: ROLES,
  });
  assert.equal(justOver24.silent, false, '24.5h must still be healthy');
  assert.ok(hb.OVERDUE_AFTER_MS > hb.PUSH_EVERY_MS, 'the threshold must exceed the push interval');
});

test('a role that has never beaten is OVERDUE, never silently absent', () => {
  const r = hb.rollCallReport({ rows: [], now: NOW, roles: ROLES });
  assert.equal(r.silent, true);
  assert.equal(r.overdue[0].reason, 'no beat has ever been recorded');
});

test('a beat from a machine that does NOT own the role cannot make it look alive', () => {
  // The cutover trap. bus-relay used to run on the MacBook; a stale row left
  // behind by the old owner is a cutover artefact, not a heartbeat, and
  // counting it would report a dead relay as healthy on the strength of a beat
  // from a machine that has not run the job for weeks.
  const r = hb.rollCallReport({
    rows: [{ node: 'macbook-pro', role: 'bus-relay', at: agoHours(1) }],
    now: NOW,
    roles: ROLES,
  });
  assert.equal(r.silent, true, "another machine's fresh beat must not count");
  assert.equal(r.beating.length, 0);
});

test('a role with no beat emitter reports NOT REPORTING — never as healthy, never as quiet', () => {
  const r = hb.rollCallReport({ rows: [], now: NOW, roles: ROLES });
  const names = r.notReporting.map((n) => n.role);
  assert.deepEqual(names, ['db-refresh']);
  assert.ok(r.notReporting[0].why, 'a not-reporting role must carry its reason');
  assert.ok(!r.beating.some((b) => b.role === 'db-refresh'));
  assert.ok(!r.overdue.some((o) => o.role === 'db-refresh'));
});

test('an unreadable roll call is CANNOT TELL, and never an all-clear', () => {
  // DOCTRINE 3.11. A watchdog that treats an unreachable ClickUp as "nothing
  // overdue" goes quiet at exactly the moment the infrastructure is sick.
  const r = hb.rollCallReport({ readable: false, why: 'HTTP 500', rows: [], now: NOW, roles: ROLES });
  assert.equal(r.readable, false);
  assert.equal(r.silent, false, 'unreadable must not be reported as a silence either');
  assert.deepEqual(r.beating, []);
  assert.deepEqual(r.overdue, []);
});

test('a beat whose timestamp cannot be read as a date is overdue, not treated as now', () => {
  const r = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'bus-relay', at: 'last tuesday' }],
    now: NOW,
    roles: ROLES,
  });
  assert.equal(r.silent, true);
  assert.match(r.overdue[0].reason, /cannot be read as a date/);
});

// --- the shared payload -----------------------------------------------------

test('a rendered roll call round-trips through the parser', () => {
  const rows = [
    { node: 'mac-mini', role: 'bus-relay', at: agoHours(1) },
    { node: 'mac-mini', role: 'channel-steward', at: agoHours(3) },
  ];
  const parsed = hb.parseRollCall(hb.renderRollCall(rows, { now: NOW }));
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(hb.mergeRollCall([], parsed.rows), hb.mergeRollCall([], rows));
});

test('a description with no data block is an EMPTY roll call, which is a real state', () => {
  const parsed = hb.parseRollCall('Just some prose somebody typed.');
  assert.equal(parsed.parsed, true);
  assert.deepEqual(parsed.rows, []);
});

test('an EMPTY description is unreadable, not an empty roll call', () => {
  // Found by driving this against the live API on 2026-08-31: ClickUp answers
  // a GET with `markdown_description: ""` on a task whose description it is
  // holding fine, the text arriving under `description` instead. Reading that
  // empty string as "no beats yet" would announce every job in the system as
  // quiet at once — a false-alarm storm, off a field that was simply not
  // populated. Every roll call we write carries a preamble, so no text at all
  // means we read nothing.
  for (const empty of ['', '   \n  ', null, undefined]) {
    const parsed = hb.parseRollCall(empty);
    assert.equal(parsed.parsed, false, `"${String(empty)}" must not read as an empty roll call`);
    assert.ok(parsed.why);
  }
});

test('a CORRUPT data block is unreadable, not empty', () => {
  // The dangerous confusion: "no beats yet" and "we cannot tell when anything
  // last ran" render identically if this collapses them, and the second would
  // then be announced as every machine having gone quiet at once.
  const broken = `${hb.BEGIN}\n\`\`\`json\n{ not json at all\n\`\`\`\n${hb.END}`;
  const parsed = hb.parseRollCall(broken);
  assert.equal(parsed.parsed, false);
  assert.ok(parsed.why);
});

test('merging never moves a row backwards', () => {
  // Two machines share one description, so a read-modify-write can race.
  // Losing the newer beat would invent a silence that never happened.
  const existing = [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(1) }];
  const stale = [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(9) }];
  assert.equal(hb.mergeRollCall(existing, stale)[0].at, existing[0].at);
});

test('merging advances a row and leaves every other machine\'s row untouched', () => {
  const existing = [
    { node: 'mac-mini', role: 'bus-relay', at: agoHours(9) },
    // A row for a role mac-mini owns, beaten on the OTHER machine. Not a
    // mistake: a non-owner's beat is a real row (scripts/run_bus_relay.sh
    // records one on every machine that wakes), and `rollCallReport` ignores it
    // because only the owner's row counts. What matters here is that merging one
    // machine's beat leaves the other machine's row alone.
    { node: 'macbook-pro', role: 'bus-relay', at: agoHours(4) },
  ];
  const merged = hb.mergeRollCall(existing, [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(1) }]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.node === 'mac-mini').at, agoHours(1));
  assert.equal(merged.find((r) => r.node === 'macbook-pro').at, agoHours(4));
});

test('the rendered table is generated from the rows, so the two cannot drift', () => {
  const rows = [{ node: 'mac-mini', role: 'bus-relay', at: agoHours(1) }];
  const text = hb.renderRollCall(rows, { now: NOW });
  // The human table above the data block carries the same instant, because it
  // is written from the same array on every push and never read back.
  assert.ok(text.includes(`| mac-mini | bus-relay | ${agoHours(1)} |`));
  assert.ok(text.indexOf('| mac-mini | bus-relay |') < text.indexOf(hb.BEGIN));
});

// --- suppression ------------------------------------------------------------

test('suppression holds inside the window and releases outside it', () => {
  assert.equal(hb.dueAgain({ lastAt: agoHours(1), now: NOW, everyMs: 6 * HOUR }), false);
  assert.equal(hb.dueAgain({ lastAt: agoHours(7), now: NOW, everyMs: 6 * HOUR }), true);
});

test('a missing or unreadable suppression stamp posts rather than staying silent', () => {
  // The asymmetry that matters: a duplicate alert is noise, a swallowed alert
  // is the whole feature not working.
  assert.equal(hb.dueAgain({ lastAt: '', now: NOW, everyMs: 6 * HOUR }), true);
  assert.equal(hb.dueAgain({ lastAt: 'not a date', now: NOW, everyMs: 6 * HOUR }), true);
});

// --- the messages -----------------------------------------------------------

test('the silence post names the machine, the job and when it last worked', () => {
  const text = hb.renderSilencePost({
    overdue: [{ role: 'bus-relay', owner: 'mac-mini', at: agoHours(30), reason: 'last succeeded 30h 0m ago' }],
    now: NOW,
    reportedBy: 'macbook-pro',
  });
  assert.match(text, /bus-relay/);
  assert.match(text, /mac-mini/);
  assert.match(text, /30h/);
  // Readable by somebody who was not already suspicious — that is the whole
  // requirement, so the message has to carry the next step, not just the fact.
  assert.match(text, /npm run doctor:node/);
  assert.match(text, /install_bus_relay\.sh --status/);
});

test('the failure post carries the exit status and the log tail', () => {
  const text = hb.renderFailurePost({
    job: 'bus-relay',
    node: 'mac-mini',
    status: 7,
    at: agoHours(0),
    logTail: 'boom\nsecond line',
    logPath: '/somewhere/relay.log',
  });
  assert.match(text, /bus-relay FAILED on mac-mini/);
  assert.match(text, /exit status 7/);
  assert.match(text, /second line/);
  assert.match(text, /somewhere\/relay\.log/);
});

test('the failure post omits the log block entirely when there is no tail', () => {
  const text = hb.renderFailurePost({ job: 'bus-relay', node: 'mac-mini', status: 1 });
  assert.ok(!text.includes('Last lines:'), 'an empty code fence tells the reader nothing');
});

// --- the local stamp --------------------------------------------------------

test('a beat writes and reads back from a derived path, naming no machine', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'heartbeat-'));
  try {
    const wrote = hb.recordBeat({ role: 'bus-relay', node: 'mac-mini', at: agoHours(1), homedir: home });
    assert.equal(wrote.ok, true);
    const back = hb.readBeat({ role: 'bus-relay', homedir: home });
    assert.equal(back.found, true);
    assert.equal(back.beat.at, agoHours(1));
    assert.ok(hb.beatFile('bus-relay', home).startsWith(home), 'the path must derive from the home it was given');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a missing stamp and a CORRUPT stamp are different answers', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'heartbeat-'));
  try {
    const missing = hb.readBeat({ role: 'bus-relay', homedir: home });
    assert.equal(missing.found, false);
    assert.equal(missing.readable, true, 'never beaten is a fact we know');

    fs.mkdirSync(hb.heartbeatDir(home), { recursive: true });
    fs.writeFileSync(hb.beatFile('bus-relay', home), 'this is not json');
    const corrupt = hb.readBeat({ role: 'bus-relay', homedir: home });
    assert.equal(corrupt.found, false);
    assert.equal(corrupt.readable, false, 'a corrupt stamp is something we could NOT read');
    assert.ok(corrupt.why);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a beat that cannot be written reports rather than throws', () => {
  // The job has already succeeded. Its own bookkeeping must never be able to
  // turn that into a failure.
  const wrote = hb.recordBeat({
    role: 'bus-relay',
    node: 'mac-mini',
    homedir: '/',
    write: { mkdirSync() { throw new Error('read-only file system'); }, writeFileSync() {} },
  });
  assert.equal(wrote.ok, false);
  assert.match(wrote.why, /read-only/);
});

// --- the registry it is measured against ------------------------------------

test('every role in the real registry is either an emitter or has a stated reason', () => {
  // The hole this closes: adding a role to lib/nodeRoles.js and forgetting it
  // here would make it report as NOT REPORTING with a generic message, which
  // reads like a bug in the tool rather than a gap in the instrumentation.
  const nodeRoles = require('../../lib/nodeRoles.js');
  for (const role of Object.keys(nodeRoles.ROLES)) {
    assert.ok(
      hb.BEAT_EMITTERS[role] || hb.NOT_REPORTING_WHY[role],
      `role "${role}" is in lib/nodeRoles.js but lib/nodeHeartbeat.js neither expects a beat from it `
      + 'nor says why it does not. Add it to BEAT_EMITTERS or NOT_REPORTING_WHY.',
    );
  }
});

// --- the recency alarm (task 86bbugeda) -------------------------------------
//
// This alarm's failure mode is SILENCE, so every test below is written to be
// able to fail in the quiet direction. Two of them are break-tests in the
// literal sense the ticket asked for: one fails if the threshold is made
// enormous (a dead job stops alarming), one fails if it is made tiny (an
// ordinary blip starts alarming). A monitoring test that cannot fail is worth
// nothing, and this is the feature where that matters most.

/** A beat as `readBeat()` returns one. */
const beatAt = (at) => ({ found: true, readable: true, file: '/dev/null', beat: { role: 'x', node: 'mac-mini', at } });

test('the threshold is derived per role from that role every job cadence, not one global number', () => {
  // The whole point of the ticket: a single number cannot serve a job that runs
  // every ten minutes and one that runs every hour.
  assert.equal(hb.quietAfterFor('bus-relay'), 3 * HOUR, 'a 10-minute job floors at 3 hours');
  assert.equal(hb.quietAfterFor('pipeline-pulse'), 6 * HOUR);
  assert.equal(hb.quietAfterFor('loop-build'), 6 * HOUR);
  assert.equal(hb.quietAfterFor('loop-review'), 6 * HOUR);
  // A role with no declared cadence is not "fine" — there is nothing to judge.
  assert.equal(hb.quietAfterFor('weekly-report'), null);
  assert.equal(hb.quietAfterFor('nonsense-role'), null);
});

test('every derived threshold clears the gap that role legitimately shows', () => {
  // BREAK TEST, quiet direction. These are the measured p99 beat-to-beat gaps
  // from the Mini's own logs over the 14 days to 2026-09-04 — the numbers the
  // ticket demanded be taken before a threshold was chosen. If somebody tightens
  // QUIET_AFTER_MISSES or MIN_QUIET_AFTER_MS to chase the ticket's proposed one
  // hour, this fails and names the role it would have started crying wolf about.
  const measuredP99Hours = {
    'bus-relay': 1.20,
    'pipeline-pulse': 1.02,
    'loop-build': 1.55,
    'loop-review': 1.50,
  };
  for (const [role, p99] of Object.entries(measuredP99Hours)) {
    const threshold = hb.quietAfterFor(role) / HOUR;
    assert.ok(
      threshold >= p99 * 2,
      `${role}: threshold ${threshold}h is not at least twice its measured p99 gap of ${p99}h — `
      + 'this alarm would fire on the job working normally, which is how the 2026-09-02 alarm died',
    );
  }
  // And the loop lanes must clear a legitimate usage-limit sleep. The runner
  // deliberately sleeps until a stated reset (scripts/loop_runner_delay.mjs);
  // the longest observed was 10,380s and the session window is five hours.
  for (const role of ['loop-build', 'loop-review']) {
    assert.ok(
      hb.quietAfterFor(role) >= 5 * HOUR,
      `${role}: a threshold under 5 hours alarms on the runner waiting out a session limit, which is correct behaviour`,
    );
  }
});

test('a dead job alarms once its own threshold has passed', () => {
  // BREAK TEST, the other direction: make the threshold enormous and this fails.
  const r = hb.recencyReport({
    entries: [{ role: 'bus-relay', owner: 'mac-mini', beat: beatAt(agoHours(16)) }],
    now: NOW,
  });
  assert.equal(r.quiet.length, 1, 'sixteen hours of silence from a ten-minute job must alarm');
  assert.equal(r.silent, true);
  assert.match(r.quiet[0].reason, /last succeeded/);
  assert.equal(r.fresh.length, 0);
});

test('one or two failed passes do NOT fire it — the real 529 blip of 2026-09-03', () => {
  // BREAK TEST, quiet direction: make the threshold tiny and this fails.
  //
  // The fixture is the actual incident named in the ticket, read off the Mini's
  // loop log. loop-build started at 08:18:58, hit `API Error: 529 Overloaded`,
  // exited 1 at 08:22:11 — and the runner recorded a beat anyway, because that
  // role beats on liveness. The next pass ran an hour later. Nothing here is a
  // dead job, and an alarm that fires on it is an alarm Dane learns to ignore.
  const blip = hb.recencyReport({
    entries: [{ role: 'loop-build', owner: 'mac-mini', beat: beatAt(agoHours(1.07)) }],
    now: NOW,
  });
  assert.equal(blip.quiet.length, 0, 'a single failed pass followed by a beat is not a silence');
  assert.equal(blip.fresh.length, 1);

  // Two in a row, at this role's ceiling interval, is still not an alarm.
  const twice = hb.recencyReport({
    entries: [{ role: 'loop-build', owner: 'mac-mini', beat: beatAt(agoHours(2.1)) }],
    now: NOW,
  });
  assert.equal(twice.quiet.length, 0);

  // And the longest legitimate relay gap in 14 days (4.51h on 2026-09-01) —
  // that one SHOULD alarm at a 3h threshold, which is the judgement call this
  // test pins rather than leaves to memory.
  const realOutage = hb.recencyReport({
    entries: [{ role: 'bus-relay', owner: 'mac-mini', beat: beatAt(agoHours(4.51)) }],
    now: NOW,
  });
  assert.equal(realOutage.quiet.length, 1, '25 consecutive failed relay passes over 4.5 hours is a dead job, not a blip');
});

test('a liveness-beating role says so in its alarm, because the beat does not mean success', () => {
  // loop-build beats after EVERY pass whatever it concluded (scripts/loop_runner.sh).
  // Reporting that as "has not succeeded" would be a confident wrong sentence
  // about what is broken — the runner has stopped, which is a different repair.
  const r = hb.recencyReport({
    entries: [{ role: 'loop-build', owner: 'mac-mini', beat: beatAt(agoHours(12)) }],
    now: NOW,
  });
  assert.equal(r.quiet.length, 1);
  assert.equal(r.quiet[0].beatMeans, 'liveness');
  assert.match(r.quiet[0].reason, /last ran/);
  assert.doesNotMatch(r.quiet[0].reason, /succeeded/);
  const post = hb.renderStalePost({ quiet: r.quiet, node: 'mac-mini', now: NOW });
  assert.match(post, /the runner itself has stopped/);
});

test('four answers, never two — nothing unmeasurable is reported as healthy', () => {
  const r = hb.recencyReport({
    entries: [
      // never beaten here: already the roll call's finding, not counted twice
      { role: 'bus-relay', owner: 'mac-mini', beat: { found: false, readable: true, file: '/x' } },
      // corrupt stamp: a thing we could not read, not a silence
      { role: 'loop-build', owner: 'mac-mini', beat: { found: false, readable: false, file: '/x', why: 'the stamp is not JSON' } },
      // no declared cadence: nothing to judge it against
      { role: 'weekly-report', owner: 'mac-mini', beat: beatAt(agoHours(200)) },
      // a beat from the future is a clock fault, not a healthy job
      { role: 'loop-review', owner: 'mac-mini', beat: beatAt(new Date(NOW + HOUR).toISOString()) },
    ],
    now: NOW,
  });
  assert.equal(r.quiet.length, 0);
  assert.equal(r.fresh.length, 0, 'not one of these four may be counted as beating');
  assert.equal(r.unknown.length, 4);
  assert.match(r.unknown.find((u) => u.role === 'weekly-report').why, /no run interval is declared/);
  assert.match(r.unknown.find((u) => u.role === 'loop-review').why, /in the future/);
});

test('a job stuck exactly ON its threshold is not yet quiet, one millisecond past it is', () => {
  const at = (ms) => hb.recencyReport({
    entries: [{ role: 'bus-relay', owner: 'mac-mini', beat: beatAt(new Date(NOW - ms).toISOString()) }],
    now: NOW,
  });
  assert.equal(at(3 * HOUR).quiet.length, 0);
  assert.equal(at(3 * HOUR + 1).quiet.length, 1);
});

test('the quiet post is repeated far less often than the flapping alert', () => {
  // Two different alarms about one dead job on the same 6-hour cadence is just
  // every message twice. The ticket's non-goal keeps the flapping throttle as
  // it is; this one has to be coarser than it.
  assert.ok(hb.STALE_REPOST_EVERY_MS > hb.REPOST_EVERY_MS);
  assert.equal(hb.STALE_REPOST_EVERY_MS, 12 * HOUR);
});

test('the recovery post exists, and cannot become an all-clear x365', () => {
  // It is rendered here, but scripts/node_heartbeat.mjs only sends it when the
  // `stale-<role>` stamp exists — and that stamp is written only when a quiet
  // report actually went to the bus. A healthy job never produces one.
  const post = hb.renderRecoveredPost({ role: 'bus-relay', node: 'mac-mini', quietSince: agoHours(9), now: NOW });
  assert.match(post, /is beating again/);
  assert.match(post, /not a routine all-clear/);
});

test('the local recency check and the shared roll call answer different questions', () => {
  // The regression this guards: somebody "simplifying" by deriving one from the
  // other. A 25-hour roll-call window cannot see a 16-hour outage, and a local
  // check cannot see a machine that is switched off. Both, or neither works.
  assert.ok(hb.OVERDUE_AFTER_MS > hb.quietAfterFor('bus-relay') * 4,
    'the shared roll call is deliberately far coarser than the local recency alarm');
});

test('every beat emitter declares both its cadence and what its beat MEANS', () => {
  // Adding an emitter without a cadence would leave it permanently unjudged by
  // the recency alarm while looking instrumented — the exact shape of failure
  // the NOT_REPORTING column exists to prevent one floor up.
  for (const [role, entry] of Object.entries(hb.BEAT_EMITTERS)) {
    assert.ok(Number.isFinite(entry.intervalMs) && entry.intervalMs > 0,
      `beat emitter "${role}" declares no intervalMs, so the recency alarm can never judge it`);
    assert.ok(['success', 'liveness'].includes(entry.beatMeans),
      `beat emitter "${role}" must say whether its beat means 'success' or 'liveness' — `
      + 'the alarm wording and the repair are different for each');
  }
});

test('the alarm quotes the job real cadence, not the threshold divided back down', () => {
  // Found by rehearsing the alarm rather than by reading it: bus-relay's
  // threshold is FLOORED at 3 hours, so `threshold / misses` claimed the relay
  // was "expected about every 30m" about a job that runs every ten minutes.
  // Every sentence in an alarm is a fact somebody will act on.
  const r = hb.recencyReport({
    entries: [{ role: 'bus-relay', owner: 'mac-mini', beat: beatAt(agoHours(16)) }],
    now: NOW,
  });
  assert.equal(r.quiet[0].intervalMs, 10 * 60 * 1000);
  assert.match(r.quiet[0].reason, /expected about every 10m/);
  assert.doesNotMatch(r.quiet[0].reason, /every 30m/);
});

// --- the two Pulse pipelines (task 86bbw9nbj) --------------------------------
//
// These roles replaced one `pulse-pipelines` row that sat in the NOT_REPORTING
// column with the reason "lives in the pulse repo; its runner is not in this
// checkout". True, and not a reason it could not beat: on 2026-09-04 both jobs
// were dead for 33 hours — 127 skipped runs — and nothing said so, found the
// next day by accident. The time before that was 820 failed runs over twelve
// days, also found by accident.

test('both pulse pipelines are expected to beat, at the cadence their schedules declare', () => {
  // The numbers are not decoration: every window in this file is derived from
  // intervalMs, so a wrong cadence here silently produces a wrong verdict rather
  // than an error. They come from pulse's own plists —
  // launchd/com.danechristensen.pulse.channel-steward.plist StartInterval 900,
  // and librarian-sweep's 86400.
  assert.equal(hb.BEAT_EMITTERS['channel-steward'].intervalMs, 15 * 60 * 1000);
  assert.equal(hb.BEAT_EMITTERS['librarian-sweep'].intervalMs, 24 * HOUR);
  for (const role of ['channel-steward', 'librarian-sweep']) {
    assert.equal(hb.BEAT_EMITTERS[role].beatMeans, 'success',
      `${role} beats only on a run that completed, so its beat means success rather than liveness`);
    assert.equal(hb.NOT_REPORTING_WHY[role], undefined,
      `${role} cannot be both expected to beat and excused from beating`);
  }
});

test('the daily pipeline is judged against a DAILY window, which is the whole reason it waited', () => {
  // This ticket had to land behind the per-role window (task 86bbw9n9f) for
  // exactly this number. On the old flat 25 hours, librarian-sweep — which runs
  // every 24h, pushed at most once a day — would have read as overdue while
  // perfectly healthy, on day one, which is this feature's own failure mode.
  assert.equal(hb.overdueAfterFor('librarian-sweep'), 48 * HOUR);
  assert.ok(hb.overdueAfterFor('librarian-sweep') > 24 * HOUR + hb.PUSH_EVERY_MS - HOUR,
    'a daily job needs a window of a day plus one of its own runs, or an honest beat reads as dead');

  // And the fast one is unchanged from every other frequent role: 25 hours.
  assert.equal(hb.overdueAfterFor('channel-steward'), hb.OVERDUE_AFTER_MS);

  // The local alarm's thresholds, which are a different question and a different
  // surface. channel-steward lands on the three-hour floor (six missed runs is
  // 90 minutes, well inside a launchd job's ordinary drift), and that 3h is the
  // number the ticket's own break test waits out.
  assert.equal(hb.quietAfterFor('channel-steward'), hb.MIN_QUIET_AFTER_MS);
  assert.equal(hb.quietAfterFor('librarian-sweep'), 6 * 24 * HOUR);
});

test('a healthy daily beat reads as BEATING, and one that has missed two days does not', () => {
  // The break-test in both directions, which is what makes the number above
  // evidence rather than an assertion about itself.
  const roles = { 'librarian-sweep': { owner: 'mac-mini' } };
  const healthy = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'librarian-sweep', at: agoHours(30) }], now: NOW, roles,
  });
  assert.equal(healthy.overdue.length, 0, 'a daily job 30 hours after its last beat is healthy, not dead');
  assert.equal(healthy.beating.length, 1);

  const dead = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'librarian-sweep', at: agoHours(60) }], now: NOW, roles,
  });
  assert.equal(dead.overdue.length, 1);
  assert.match(dead.overdue[0].reason, /overdue after 2d 0h/);
});

test('the retired pulse-pipelines role is gone from every column', () => {
  // The rename's break-test. A leftover row in either column would be a role no
  // machine owns: `rollCallReport` iterates the REGISTRY, so the row would never
  // be reached, and an unreachable excuse reads exactly like a covered one.
  assert.equal(hb.BEAT_EMITTERS['pulse-pipelines'], undefined);
  assert.equal(hb.NOT_REPORTING_WHY['pulse-pipelines'], undefined);
  const nodeRoles = require('../../lib/nodeRoles.js');
  assert.equal(nodeRoles.ROLES['pulse-pipelines'], undefined);
  assert.equal(nodeRoles.roleOwner('channel-steward'), 'mac-mini');
  assert.equal(nodeRoles.roleOwner('librarian-sweep'), 'mac-mini');
});

// --- relaying a local stamp onto the shared row (task 86bbw9nbj) -------------
//
// The half the Pulse slice deliberately left for this ticket. Pulse writes only
// the LOCAL stamp — no credential, no network call inside an unattended pipeline
// runner — so without a relay its rows never reach the shared surface that
// `rollCallReport` actually reads, and two healthy jobs read as overdue forever.

/** A push entry as `doPushOwned` assembles one. */
const pushEntry = (role, at, lastPushAt = '') => ({ role, beat: beatAt(at), lastPushAt });

test('a beat that has never been pushed is relayed, carrying the STAMP instant', () => {
  const plan = hb.rollCallPushPlan({ entries: [pushEntry('channel-steward', agoHours(0.2))], now: NOW });
  assert.equal(plan.push.length, 1);
  assert.equal(plan.push[0].role, 'channel-steward');
  assert.equal(plan.push[0].at, agoHours(0.2), 'the pushed instant is the stamp own, never the clock');
  assert.deepEqual(plan.held, []);
  assert.deepEqual(plan.unknown, []);
});

test('RELAYING CANNOT MAKE A DEAD JOB LOOK ALIVE — the property the whole mechanism rests on', () => {
  // The break-test for this feature's worst failure, which would also have been
  // its quietest: a relay that stamped `now` instead of the beat's own instant
  // would refresh the row every ten minutes over a job that died on Tuesday, and
  // permanently silence the alarm it exists to feed. Nothing else here would
  // fail — the row would parse, the table would render, every count would look
  // right.
  const diedAt = agoHours(40);
  const plan = hb.rollCallPushPlan({ entries: [pushEntry('channel-steward', diedAt)], now: NOW });
  assert.equal(plan.push[0].at, diedAt);

  // And the row it produces is still judged dead, end to end.
  const verdict = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: plan.push[0].role, at: plan.push[0].at }],
    now: NOW,
    roles: { 'channel-steward': { owner: 'mac-mini' } },
  });
  assert.equal(verdict.silent, true, 'a relayed stale beat must still report the job as quiet');
  assert.equal(verdict.overdue[0].role, 'channel-steward');
});

test('a beat already on the roll call is not pushed again', () => {
  // Otherwise a job producing no new beats costs a ClickUp round trip a day for
  // ever, writing the same instant back over itself.
  const plan = hb.rollCallPushPlan({
    entries: [pushEntry('librarian-sweep', agoHours(30), agoHours(30))], now: NOW,
  });
  assert.deepEqual(plan.push, []);
  assert.match(plan.held[0].why, /already on the roll call/);
});

test('the once-a-day throttle holds even when the local stamp is newer', () => {
  // The shared row is documented at day resolution and every window in this file
  // is derived from that. A relay firing on the ten-minute wake would otherwise
  // push every ten minutes per role.
  const throttled = hb.rollCallPushPlan({
    entries: [pushEntry('channel-steward', agoHours(0.1), agoHours(3))], now: NOW,
  });
  assert.deepEqual(throttled.push, []);
  assert.match(throttled.held[0].why, /pushed within the last 24h/);

  // ...and releases on the far side of it, which is what makes the assertion
  // above a threshold rather than a blanket refusal.
  const due = hb.rollCallPushPlan({
    entries: [pushEntry('channel-steward', agoHours(0.1), agoHours(25))], now: NOW,
  });
  assert.equal(due.push.length, 1);
});

test('a stamp that cannot be read is CANNOT TELL, never a quiet skip', () => {
  // DOCTRINE 3.11. A corrupt stamp silently dropped from the plan is a role
  // whose row stops being refreshed with nothing anywhere saying why — and the
  // roll call would then report it overdue, sending somebody to look at a
  // schedule that is fine.
  const plan = hb.rollCallPushPlan({
    entries: [
      { role: 'channel-steward', beat: { found: false, readable: false, file: '/x', why: 'the stamp is not JSON' } },
      { role: 'librarian-sweep', beat: beatAt('last tuesday') },
    ],
    now: NOW,
  });
  assert.deepEqual(plan.push, []);
  assert.equal(plan.unknown.length, 2);
  assert.match(plan.unknown[0].why, /not JSON/);
  assert.match(plan.unknown[1].why, /cannot be read as a date/);
});

test('a stamp dated in the future is a clock problem, not a fresh beat', () => {
  // Pushing it would park the row ahead of real time and keep the role reading
  // as fresh for as long as the skew lasted — the same refusal recencyReport
  // makes, for the same reason.
  const plan = hb.rollCallPushPlan({
    entries: [pushEntry('channel-steward', new Date(NOW + 2 * HOUR).toISOString())], now: NOW,
  });
  assert.deepEqual(plan.push, []);
  assert.match(plan.unknown[0].why, /in the future/);
});

test('a role that has never beaten here is not relayed, and says the roll call already has it', () => {
  // Not `unknown`: there is genuinely nothing to carry, and "never beaten" is
  // already reported as overdue by rollCallReport. Counting it twice would put
  // one silence on two surfaces.
  const plan = hb.rollCallPushPlan({
    entries: [{ role: 'channel-steward', beat: { found: false, readable: true, file: '/x' } }], now: NOW,
  });
  assert.deepEqual(plan.push, []);
  assert.deepEqual(plan.unknown, []);
  assert.match(plan.held[0].why, /never beaten on this machine/);
  assert.match(plan.held[0].why, /already reports that as overdue/);
});

test('several roles are planned together, so one write can carry them all', () => {
  // The description is read-modify-written and two machines edit it, so N pushes
  // would be N chances to lose an update for no gain.
  const plan = hb.rollCallPushPlan({
    entries: [pushEntry('channel-steward', agoHours(0.1)), pushEntry('librarian-sweep', agoHours(20))],
    now: NOW,
  });
  assert.deepEqual(plan.push.map((p) => p.role), ['channel-steward', 'librarian-sweep']);
});

// --- never beaten is not the same failure as stopped beating -----------------
//
// Found by rehearsing the roll call on the Mini rather than by reading it (task
// 86bbw9nbj). The day librarian-sweep was named as an emitter it had a perfectly
// healthy daily schedule and no stamp yet, and the report said "A job that stops
// firing writes nothing anywhere. This is that." — untrue of a role that has not
// stopped anything. Every future emitter graduation has the same day-one window.

test('a role that has never beaten is flagged as such, and still counts as overdue', () => {
  // Flagged, NOT demoted. A role expected to beat that never has is genuinely
  // not healthy, so it stays in `overdue` and still reaches the bus — the fix is
  // to the sentence, not to the detection.
  const r = hb.rollCallReport({
    rows: [], now: NOW, roles: { 'channel-steward': { owner: 'mac-mini' } },
  });
  assert.equal(r.silent, true, 'never beaten must still be reported, not swallowed');
  assert.equal(r.overdue.length, 1);
  assert.equal(r.overdue[0].neverBeaten, true);
  assert.equal(r.overdue[0].at, null);
});

test('a role that has stopped beating is NOT flagged as never beaten', () => {
  // The other half of the distinction — without this, marking everything would
  // pass the test above while losing the difference entirely.
  const r = hb.rollCallReport({
    rows: [{ node: 'mac-mini', role: 'channel-steward', at: agoHours(40) }],
    now: NOW,
    roles: { 'channel-steward': { owner: 'mac-mini' } },
  });
  assert.equal(r.overdue.length, 1);
  assert.ok(!r.overdue[0].neverBeaten);
  assert.equal(r.overdue[0].at, agoHours(40));
});

test('the bus post does not tell somebody a job stopped when it never started', () => {
  const post = hb.renderSilencePost({
    overdue: [{ role: 'librarian-sweep', owner: 'mac-mini', at: null, neverBeaten: true, reason: 'no beat has ever been recorded' }],
    now: NOW,
  });
  assert.match(post, /has never reported/);
  assert.doesNotMatch(post, /has gone quiet/);
  assert.doesNotMatch(post, /the job stopped\nfiring/);
  assert.match(post, /either nothing is installed to beat from/);
});

test('a mixed post keeps the quiet headline and still marks the new role', () => {
  // The case that made a flag better than a second message type: one genuinely
  // dead job and one newly-named role in the same reading. Claiming "never
  // reported" about the dead one would be as wrong as the reverse.
  const post = hb.renderSilencePost({
    overdue: [
      { role: 'bus-relay', owner: 'mac-mini', at: agoHours(100), reason: 'last succeeded 4d 4h ago' },
      { role: 'librarian-sweep', owner: 'mac-mini', at: null, neverBeaten: true, reason: 'no beat has ever been recorded' },
    ],
    now: NOW,
  });
  assert.match(post, /has gone quiet/);
  assert.match(post, /\*\*librarian-sweep\*\*.*Never beaten/s);
  assert.doesNotMatch(post.split('librarian-sweep')[0], /Never beaten/);
});

// --- closing an alarm, which is half of having one ---------------------------
//
// Task 86bbw9nbj round 1. Every clear in this system lived inside `--beat`, so
// the two roles whose runner is in another repo — the two this feature exists
// to instrument — could raise an alarm and never close it. All of these are
// written against that shape: the fire half working and the clear half missing
// is indistinguishable from a job that is still dead.
//
// Round 2 then broke the other direction: the fix cleared all three suppression
// stamps on FRESHNESS, which is a three-to-six-hour window and not a success,
// so a job failing right now had its failure-alert throttle removed on the same
// ten-minute wake that reported the failure. Everything below asserts the rule
// that settles both: an alarm is closed only by a beat newer than the alarm.

const closeout = (role, beatAt, stamps) => hb.alarmCloseoutPlan({ fresh: [{ role, beatAt, stamps }] });
const kinds = (list) => list.map((c) => `${c.role}:${c.kind}`);

test('a job that recovered after its silence was reported gets its alarm closed AND announced', () => {
  const plan = closeout('channel-steward', agoHours(1), { stale: agoHours(5) });
  assert.deepEqual(kinds(plan.clear), ['channel-steward:stale']);
  assert.equal(plan.announce.length, 1);
  assert.equal(plan.announce[0].role, 'channel-steward');
  assert.equal(plan.announce[0].quietSince, agoHours(5));
});

test('a healthy job nobody ever reported quiet has nothing to clear and says nothing — no all-clear x365', () => {
  const plan = hb.alarmCloseoutPlan({
    fresh: [
      { role: 'bus-relay', beatAt: agoHours(1), stamps: {} },
      { role: 'channel-steward', beatAt: agoHours(1), stamps: {} },
    ],
  });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.announce, [], 'posting here would be routine good news, which the non-goals forbid');
});

test('an empty stale stamp is not an alarm — it announces nothing', () => {
  const plan = closeout('librarian-sweep', agoHours(1), { stale: '   ' });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(plan.announce, []);
});

test('A JOB THAT IS STILL DEAD CANNOT CLOSE ITS OWN ALARM — only fresh roles are ever passed in', () => {
  // The gate is recencyReport's own arithmetic, so this asserts the join: a
  // role whose newest beat is past its threshold lands in `quiet`, never in
  // `fresh`, and therefore never reaches the closeout plan at all. Without
  // this the relay would clear an alarm every ten minutes and the stale check
  // would raise it again — churn, in place of an honest silence.
  const report = hb.recencyReport({
    entries: [{
      role: 'channel-steward',
      owner: 'mac-mini',
      beat: { readable: true, found: true, beat: { at: agoHours(30) } },
    }],
    now: NOW,
  });
  assert.equal(report.fresh.length, 0);
  assert.equal(report.quiet.length, 1);

  const plan = hb.alarmCloseoutPlan({
    fresh: report.fresh.map((f) => ({ role: f.role, beatAt: f.at, stamps: { stale: agoHours(20) } })),
  });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(plan.announce, []);
});

test('several recovered roles are closed in one pass, each announced on its own merit', () => {
  const plan = hb.alarmCloseoutPlan({
    fresh: [
      { role: 'channel-steward', beatAt: agoHours(1), stamps: { stale: agoHours(9) } },
      { role: 'librarian-sweep', beatAt: agoHours(1), stamps: {} },
      { role: 'bus-relay', beatAt: agoHours(1), stamps: { stale: agoHours(4) } },
    ],
  });
  assert.deepEqual(kinds(plan.clear), ['channel-steward:stale', 'bus-relay:stale']);
  assert.deepEqual(plan.announce.map((a) => a.role), ['channel-steward', 'bus-relay']);
});

// --- round 2: freshness decides WHO is considered, not WHICH alarms go -------
//
// `failed-<role>` is the six-hour suppression stamp for the failure alert and
// report_job_failure.mjs states its contract in as many words: cleared by the
// next SUCCESS, not by a timer. Both steps run in ONE pass of run_bus_relay.sh
// — the closeout at line 121, the failure report at line 265 — so clearing it
// off an hours-old beat turned one bus post into roughly eighteen over three
// hours. `quiet-<role>` is the same bug on the shared-row channel.

test('A FAILURE ALARM RAISED SINCE THE LAST BEAT STANDS — the fresh window is not a success', () => {
  // bus-relay's threshold is floored at 3h. Beat at -2h, failure at -1h: the
  // job is "fresh" and is failing right now. Round 2 cleared the stamp here.
  const plan = closeout('bus-relay', agoHours(2), { failed: agoHours(1) });
  assert.deepEqual(plan.clear, [], 'the failure throttle was removed from a job that has not succeeded since it failed');
  assert.deepEqual(kinds(plan.keep), ['bus-relay:failed']);
  assert.match(plan.keep[0].why, /nothing has succeeded since/);
});

test('a silence alarm raised since the last beat stands too — same rule, shared-row channel', () => {
  const plan = closeout('bus-relay', agoHours(2), { quiet: agoHours(1) });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(kinds(plan.keep), ['bus-relay:quiet']);
});

test('a failure alarm older than the newest beat IS closed — a success since the fault clears it', () => {
  const plan = closeout('bus-relay', agoHours(1), { failed: agoHours(2), quiet: agoHours(2) });
  assert.deepEqual(kinds(plan.clear), ['bus-relay:quiet', 'bus-relay:failed']);
  assert.deepEqual(plan.keep, []);
  // The `quiet-` clear announces (task 86bbzzyxb); the `failed-` clear alongside
  // it does not, and the assertion that matters here is that ONE post comes out
  // of two clears. This test asserted `announce` was empty until 86bbzzyxb, on
  // the reasoning "a failure alert is not a silence report" — true of `failed-`
  // and false of the `quiet-` sitting next to it in the same fixture.
  assert.deepEqual(plan.announce, [{ role: 'bus-relay', quietSince: agoHours(2) }]);
});

// --- task 86bbzzyxb: the shared-row channel could be reported dead and never
// --- reported alive.
//
// Two silence alarms, two independently-derived windows, and only one of them
// announced its recovery. For every role beating hourly or oftener the local
// window is the tighter one, so `stale-` always fires too and the bug is
// invisible. `librarian-sweep` runs DAILY and inverts the pair — 48h shared
// against 6 days local — so an outage landing between those two numbers was
// posted to the bus as quiet, recovered, had its stamp cleared in silence, and
// nobody was told. The Pulse outage this whole feature was built for was 33
// hours; the one before it was twelve days. Both land in that window.

test('A SHARED-ROW SILENCE THAT CLEARS IS ANNOUNCED — not only the local one', () => {
  // librarian-sweep, 60 hours after the shared watchdog reported it quiet:
  // past the 48h shared window, inside the 6-day local one, so `stale-` was
  // never raised and `quiet-` is the only stamp there is.
  const plan = closeout('librarian-sweep', agoHours(1), { quiet: agoHours(60) });
  assert.deepEqual(kinds(plan.clear), ['librarian-sweep:quiet']);
  assert.equal(plan.announce.length, 1, 'reported dead and never reported alive');
  assert.equal(plan.announce[0].role, 'librarian-sweep');
  assert.equal(plan.announce[0].quietSince, agoHours(60));
});

test('a role whose two silence alarms both clear is announced ONCE, from the EARLIER instant', () => {
  // It recovered once. Two posts would be the "all is well" noise the non-goals
  // forbid, and the later instant would understate how long it was dark.
  const plan = closeout('channel-steward', agoHours(1), { quiet: agoHours(9), stale: agoHours(4) });
  assert.deepEqual(kinds(plan.clear), ['channel-steward:quiet', 'channel-steward:stale']);
  assert.equal(plan.announce.length, 1);
  assert.equal(plan.announce[0].quietSince, agoHours(9), 'the moment its silence first reached the bus');
});

test('a failure alarm on its own still announces nothing — `failed-` is not a silence report', () => {
  // The other half of the rule, and the reason `failed-` was left out: it is
  // raised for a job that RAN and exited non-zero, and renderRecoveredPost says
  // "it was reported quiet" in as many words.
  const plan = closeout('bus-relay', agoHours(1), { failed: agoHours(2) });
  assert.deepEqual(kinds(plan.clear), ['bus-relay:failed']);
  assert.deepEqual(plan.announce, []);
});

test('a shared-row alarm deliberately left standing announces nothing either', () => {
  // The same guard the stale channel already had: the announce rides on the
  // CLEAR, never on the stamp merely existing.
  const plan = closeout('librarian-sweep', agoHours(70), { quiet: agoHours(60) });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(kinds(plan.keep), ['librarian-sweep:quiet']);
  assert.deepEqual(plan.announce, [], 'announced a recovery it had just refused to close');
});

test('an unreadable quiet stamp is CANNOT TELL, and nothing is announced off it', () => {
  const plan = closeout('librarian-sweep', agoHours(1), { quiet: 'some time last week' });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(kinds(plan.cannotTell), ['librarian-sweep:quiet']);
  assert.deepEqual(plan.announce, []);
});

test('the inversion this bug hid in is real — librarian-sweep alone has a LOOSER local window', () => {
  // The two windows are two functions: `quietAfterFor` is the local stale check
  // (six missed runs, three-hour floor) and `overdueAfterFor` is the shared-row
  // watchdog (a day plus the cadence). For every other role the local one is
  // tighter, so `stale-` is always raised alongside `quiet-` and announcing off
  // `stale-` alone looked correct. If this inversion ever disappears the hole
  // closes on its own — and a future reader deleting the fix above should have
  // to delete this first, with the arithmetic in front of them.
  const local = hb.quietAfterFor('librarian-sweep');
  const shared = hb.overdueAfterFor('librarian-sweep');
  assert.ok(local > shared, `local ${hb.ageText(local)} is not looser than shared ${hb.ageText(shared)}`);
  for (const role of ['bus-relay', 'channel-steward', 'pipeline-pulse', 'loop-build', 'loop-review']) {
    assert.ok(
      hb.quietAfterFor(role) < hb.overdueAfterFor(role),
      `${role}'s local window (${hb.ageText(hb.quietAfterFor(role))}) is no longer tighter than its shared one `
      + `(${hb.ageText(hb.overdueAfterFor(role))}), so it now has the librarian-sweep hole too`,
    );
  }
});

test('the three stamps are judged SEPARATELY — one can go while another stands', () => {
  // The whole point of the round-2 fix. A job that was reported quiet, came
  // back, and has since failed again: the silence is genuinely over, the
  // failure is genuinely current, and one pass must answer both.
  const plan = closeout('pipeline-pulse', agoHours(2), { stale: agoHours(6), failed: agoHours(1) });
  assert.deepEqual(kinds(plan.clear), ['pipeline-pulse:stale']);
  assert.deepEqual(kinds(plan.keep), ['pipeline-pulse:failed']);
  assert.equal(plan.announce.length, 1, 'the recovery from silence is still announced');
});

test('a beat at exactly the alarm instant does NOT close it — strictly newer, or the alarm stands', () => {
  const plan = closeout('bus-relay', agoHours(2), { failed: agoHours(2) });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(kinds(plan.keep), ['bus-relay:failed']);
});

test('an unreadable stamp is CANNOT TELL, and the alarm is left standing', () => {
  const plan = closeout('bus-relay', agoHours(1), { failed: 'last tuesday' });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(kinds(plan.cannotTell), ['bus-relay:failed']);
  assert.match(plan.cannotTell[0].why, /cannot be read as a date/);
});

test('an unreadable BEAT is CANNOT TELL for every alarm the role carries', () => {
  const plan = closeout('bus-relay', 'no idea', { failed: agoHours(2), stale: agoHours(3) });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(kinds(plan.cannotTell), ['bus-relay:failed', 'bus-relay:stale']);
  assert.deepEqual(plan.announce, [], 'nothing may be announced off a beat that cannot be read');
});

test('the announce rides on the stale CLEAR, never on the stamp merely existing', () => {
  // Otherwise a role whose silence alarm is deliberately left standing would
  // still be announced as beating again — good news about a job nobody has
  // established is back.
  const plan = closeout('channel-steward', agoHours(4), { stale: agoHours(2) });
  assert.deepEqual(plan.clear, []);
  assert.deepEqual(kinds(plan.keep), ['channel-steward:stale']);
  assert.deepEqual(plan.announce, [], 'announced a recovery it had just refused to close');
});

// --- the relay's verdict -----------------------------------------------------

test('an unreadable stamp is CANNOT TELL even when another role pushed successfully', () => {
  // The exact round-1 defect: the zero-push path returned 2 for this and the
  // success path returned 0 flat, so one good push washed out a blind reading.
  const v = hb.relayVerdict({ ownedEmitters: 3, pushed: 1, unknown: 1 });
  assert.equal(v.exit, 2);
  assert.equal(v.reading, false);
});

test('a machine that owns no beating role is NOT a green all-clear', () => {
  // Reachable on macbook-pro, which owns only db-refresh. "Every local beat
  // this machine owns is already on the roll call" is vacuously true of zero
  // beats, and doStaleCheck already refuses to call the same situation clear.
  const v = hb.relayVerdict({ ownedEmitters: 0, pushed: 0, unknown: 0 });
  assert.equal(v.exit, 2);
  assert.equal(v.reading, false);
  assert.match(v.why, /no job that records a beat/);
});

test('a clean relay pass, with something pushed and nothing unreadable, is a pass', () => {
  const v = hb.relayVerdict({ ownedEmitters: 2, pushed: 2, unknown: 0 });
  assert.equal(v.exit, 0);
  assert.equal(v.reading, true);
});

test('nothing to push and nothing unreadable is the ordinary steady state, and passes', () => {
  const v = hb.relayVerdict({ ownedEmitters: 2, pushed: 0, unknown: 0 });
  assert.equal(v.exit, 0);
  assert.equal(v.reading, true);
});

test('the relay never returns 1 — it moves a fact, it judges no job', () => {
  for (const args of [
    { ownedEmitters: 0, pushed: 0, unknown: 0 },
    { ownedEmitters: 2, pushed: 0, unknown: 2 },
    { ownedEmitters: 2, pushed: 2, unknown: 0 },
    { ownedEmitters: 5, pushed: 1, unknown: 3 },
  ]) {
    assert.ok([0, 2].includes(hb.relayVerdict(args).exit), `${JSON.stringify(args)} answered 1`);
  }
});

// --- one place knows where the stamps live -----------------------------------

test('EVERY alarm clear in the CLI lives in one function, so a role cannot be given half a clear', () => {
  // This is the shape of the round-1 defect rather than the defect itself: the
  // clears were inline in `--beat`, so the paths that do not call `--beat` —
  // which is the only two roles this whole slice exists for — silently got
  // none of them. A second inline site is how that comes back, and nothing
  // else in the repo would notice, because the CLI has no other test.
  const src = fs.readFileSync(path.join(__dirname, '..', 'node_heartbeat.mjs'), 'utf8');
  const body = src.slice(src.indexOf('function closeAlarms('), src.indexOf('// --- the roll call on ClickUp'));
  assert.ok(body.length > 0, 'closeAlarms() has moved or been renamed — this guard is now measuring nothing');

  const callSites = src.match(/clearStamp\(`/g) || [];
  const inside = body.match(/clearStamp\(`/g) || [];
  assert.equal(callSites.length, inside.length,
    `${callSites.length - inside.length} clearStamp() call(s) sit outside closeAlarms()`);

  const posts = src.match(/renderRecoveredPost\(/g) || [];
  assert.equal(posts.length, 1, 'the "beating again" post is sent from more than one place');
});

test('BOTH paths that see a successful run close its alarms — the recency check as well as --beat', () => {
  // The defect, stated structurally. `--beat` closed alarms and the recency
  // check did not, so a role whose runner never calls `--beat` — channel-steward
  // and librarian-sweep, the two this ticket exists for — could alarm and never
  // recover. Deleting either call site is silent otherwise: the CLI runs its
  // work at import, so nothing else here can drive it.
  const src = fs.readFileSync(path.join(__dirname, '..', 'node_heartbeat.mjs'), 'utf8');
  const fnBody = (name, endsBefore) => {
    const from = src.indexOf(`function ${name}(`);
    assert.ok(from >= 0, `${name}() has moved or been renamed — this guard is now measuring nothing`);
    const to = src.indexOf(endsBefore, from);
    assert.ok(to > from, `the marker after ${name}() has moved — this guard is now measuring nothing`);
    return src.slice(from, to);
  };
  assert.match(fnBody('doBeat', '// --- the recency alarm'), /closeAlarms\(/,
    'a job reporting its own success no longer closes its own alarm');
  const staleCheck = fnBody('doStaleCheck', '// --- relaying local stamps');
  assert.match(staleCheck, /closeAlarms\(/,
    'the check that RAISES the silence alarm no longer closes it — the two pulse roles reach no other path');

  // AND IT IS FED ONLY BY `report.fresh`. Found by break-testing: widening that
  // input to include `report.quiet` closes the alarm of a job that is still
  // dead, and every unit test here still passed, because the plan is pure and
  // was being handed the wrong set. The safety property lives at the call site,
  // so this is where it has to be pinned.
  const call = staleCheck.slice(staleCheck.indexOf('closeAlarms('));
  const fedBy = call.slice(0, call.indexOf('}))'));
  assert.match(fedBy, /report\.fresh\.map\(/, 'the closeout is no longer fed from report.fresh');
  assert.doesNotMatch(fedBy, /report\.quiet/,
    'a role judged QUIET is being handed to the closeout — a job that is still dead would close its own alarm');
});

test('NO STAMP IS CLEARED EXCEPT ONE THE PLAN NAMED — the round-2 defect was at the call site', () => {
  // Round 2 is the reason this guard exists at all. `alarmCloseoutPlan` was
  // pure and correct at the question it was asked; the CLI then cleared all
  // three stamps for every role the plan listed, so the rule the plan enforced
  // was overwritten one line later. Every unit test passed. The property is
  // structural: the clear loop must be driven by `plan.clear`, which carries a
  // per-stamp decision, and never by the roles handed in.
  const src = fs.readFileSync(path.join(__dirname, '..', 'node_heartbeat.mjs'), 'utf8');
  const from = src.indexOf('function closeAlarms(');
  assert.ok(from >= 0, 'closeAlarms() has moved or been renamed — this guard is now measuring nothing');
  const body = src.slice(from, src.indexOf('// --- the roll call on ClickUp'));

  const clears = [...body.matchAll(/for \(const (\w+) of ([\w.]+)\) clearStamp\(/g)];
  assert.equal(clears.length, 1, 'the clear is no longer a single loop — count the sites by hand before trusting this');
  assert.equal(clears[0][2], 'plan.clear',
    `stamps are being cleared from "${clears[0][2]}" rather than from plan.clear — the per-stamp decision is being bypassed`);

  // And the plan must be given the beat to compare against. Without it every
  // stamp is a cannot-tell and alarms stand for ever, which fails safe but is
  // still a silent loss of the feature.
  assert.match(body, /beatAt: r\.beatAt/, 'the closeout is no longer told when the role last beat');
  for (const kind of ['quiet', 'failed', 'stale']) {
    assert.ok(body.includes(`${kind}: readStamp(\`${kind}-`),
      `the ${kind}-<role> stamp is no longer read, so the plan cannot judge it`);
  }
});

test('the failure alert and the closeout name the SAME stamp — a rename on either side is silent', () => {
  // The clear lives in this repo and the raise lives in another file that
  // nothing imports. They agree only by the string `failed-<job>`, and if they
  // stop agreeing the alert is raised for ever and closed never — which is the
  // exact shape of the round-1 defect, arriving through a rename instead.
  const closeSrc = fs.readFileSync(path.join(__dirname, '..', 'node_heartbeat.mjs'), 'utf8');
  const raiseSrc = fs.readFileSync(path.join(__dirname, '..', 'report_job_failure.mjs'), 'utf8');
  assert.match(raiseSrc, /failed-\$\{job/, 'report_job_failure.mjs no longer writes a failed-<job> stamp under that name');
  assert.match(closeSrc, /failed: readStamp\(`failed-\$\{r\.role\}`\)/,
    'the closeout no longer reads failed-<role> — the failure alert would be raised and never cleared');
});

test('A FAILED ROLL-CALL READ NEVER BECOMES AN EMPTY ONE — both read-modify-write sites', () => {
  // Round-2 review, finding 3. `clickup.call` resolves on an HTTP error rather
  // than throwing, so `fresh.ok === false` used to fall into the same branch as
  // "the description carries no readable block" — and the PUT then rewrote the
  // shared roll call from this machine's beats alone, deleting every other
  // machine's row. `--push-owned` makes it worse than `--beat` did, because it
  // writes N roles in one go.
  const src = fs.readFileSync(path.join(__dirname, '..', 'node_heartbeat.mjs'), 'utf8');
  const reads = [...src.matchAll(/const fresh = await clickup\.call\('GET'/g)];
  assert.equal(reads.length, 2, 'the roll-call read sites have changed in number — check each one by hand');
  for (const read of reads) {
    const after = src.slice(read.index, read.index + 2500);
    const guardAt = after.indexOf('if (!fresh.ok)');
    const mergeAt = after.indexOf('mergeRollCall');
    assert.ok(guardAt >= 0,
      'a roll-call read is not checked before the merge — a failed GET would rewrite the shared row from nothing');
    assert.ok(mergeAt >= 0, 'the merge has moved away from its read — check this site by hand');
    assert.ok(guardAt < mergeAt,
      'the failed-read guard sits AFTER the merge, so it cannot prevent the wipe');
  }
  assert.doesNotMatch(src, /fresh\.ok \? heartbeat\.parseRollCall/,
    'the failed-read and unparseable-block cases are conflated again');
});

test('the relay report survives a transport failure — it is buffered, so a throw would eat it', () => {
  // Round-2 review, finding 4. `clickup.call` throws on a transport failure by
  // contract; `doPushOwned` builds its whole report in an array and prints once
  // at the end, so an uncaught throw lost every line including the PUSH lines
  // saying what was about to be written.
  const src = fs.readFileSync(path.join(__dirname, '..', 'node_heartbeat.mjs'), 'utf8');
  const from = src.indexOf('async function doPushOwned()');
  assert.ok(from >= 0, 'doPushOwned() has moved or been renamed — this guard is now measuring nothing');
  const body = src.slice(from, src.indexOf('async function pushOwnedPass('));
  assert.match(body, /try \{/, 'the buffered relay pass is no longer wrapped, so a network blip loses the whole report');
  assert.match(body, /console\.log\(out\.join/, 'the catch no longer prints the buffer it was written to rescue');
  assert.match(body, /return 2;/, 'a transport failure is not reported as a cannot-tell');
});

// --- task 86bbzzyxb: `blocked` says nothing about whether a job is RUNNING ---
//
// `blocked` in lib/nodeProvision.js means THIS PROVISIONER cannot install the
// schedule. Every reader used to slide from there to "so there is nothing to
// report about this job", which held only while the two coincided. PR #673
// ended that: channel-steward and librarian-sweep are blocked because their
// installer lives in the pulse repo, and are simultaneously the two roles with
// live local stamps here. loop-build and loop-review were already like that.

test('A BLOCKED JOB THAT IS BEATING SAYS SO — the install step is what is blocked, not the job', () => {
  const note = hb.blockedScheduleBeatNote({
    role: 'channel-steward',
    beat: { readable: true, found: true, beat: { at: agoHours(1) } },
    now: NOW,
  });
  assert.match(note, /IT IS RUNNING ANYWAY/);
  assert.match(note, /last succeeded here/);
});

test('a blocked job whose beat is stale is not reported as running', () => {
  const note = hb.blockedScheduleBeatNote({
    role: 'channel-steward',
    beat: { readable: true, found: true, beat: { at: agoHours(200) } },
    now: NOW,
  });
  assert.doesNotMatch(note, /IT IS RUNNING ANYWAY/);
  assert.match(note, /nothing appears to be running it now/);
});

test('a blocked job that has never beaten says that, rather than nothing', () => {
  const note = hb.blockedScheduleBeatNote({
    role: 'channel-steward', beat: { readable: true, found: false }, now: NOW,
  });
  assert.match(note, /never recorded a beat/);
});

test('an unreadable stamp on a blocked job is a CANNOT TELL, never a silence', () => {
  const note = hb.blockedScheduleBeatNote({
    role: 'channel-steward', beat: { readable: false, why: 'permission denied' }, now: NOW,
  });
  assert.match(note, /cannot be told from here/);
  assert.match(note, /permission denied/);
});

test('a blocked job with no emitter registered adds nothing — silence beats "no information"', () => {
  // youtube-media: blocked, and genuinely nothing beats for it. A line per
  // blocked row saying "no information" trains the eye to skip the section.
  assert.equal(hb.blockedScheduleBeatNote({ role: 'youtube-media', beat: { readable: true, found: false }, now: NOW }), '');
});

test('doctor:node no longer skips a blocked job in its last-succeeded-here section', () => {
  // The gap itself, asserted against the source rather than the output, because
  // the output needs a real machine with real stamps. `blocked` appearing in
  // that loop's skip line is the whole of the defect.
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/doctor_node.mjs'), 'utf8');
  const marker = 'WHEN DID EACH OWNED JOB LAST ACTUALLY WORK?';
  const at = src.indexOf(marker);
  assert.ok(at > 0, 'the last-succeeded-here section has been renamed — re-point this test');
  const loopAt = src.indexOf('for (const job of owned) {', at);
  assert.ok(loopAt > 0);
  const skip = src.slice(loopAt, src.indexOf('\n', src.indexOf('continue;', loopAt)));
  assert.doesNotMatch(skip, /job\.blocked/, 'a blocked job is skipped again — it will appear as neither PASS, FAIL nor CANNOT TELL');
  assert.match(skip, /job\.manual/, 'a manual job has no schedule on purpose and still has nothing to report');
});

test('the four blocked-but-beating roles really are blocked AND registered emitters', () => {
  // The join that makes the fix necessary. If a future change gives any of
  // these an installer, this test says so rather than leaving dead code behind.
  const provision = require('../../lib/nodeProvision.js');
  const nodeRoles = require('../../lib/nodeRoles.js');
  for (const role of ['channel-steward', 'librarian-sweep', 'loop-build', 'loop-review']) {
    const spec = provision.schedulesForNode(nodeRoles.roleOwner(role)).find((s) => s.role === role);
    assert.ok(spec, `${role} is owned by nobody`);
    assert.ok(spec.blocked, `${role} is no longer blocked — the skip this fixes may be removable`);
    assert.ok(hb.BEAT_EMITTERS[role], `${role} is no longer a beat emitter`);
  }
});
