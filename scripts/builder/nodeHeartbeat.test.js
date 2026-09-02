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
