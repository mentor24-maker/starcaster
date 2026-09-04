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
    { node: 'macbook-pro', role: 'pulse-pipelines', at: agoHours(3) },
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
    { node: 'macbook-pro', role: 'pulse-pipelines', at: agoHours(4) },
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
