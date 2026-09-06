'use strict';

/**
 * The reboot test's decisions, driven with no machine state of its own —
 * which is the whole reason lib/nodeRebootTest.js holds no IO.
 *
 * Every test here is written against a way this could QUIETLY report a pass.
 * That is the only dangerous direction: a check that says CANNOT TELL when it
 * could have said PASS costs somebody a command, while a check that says PASS
 * on a machine whose jobs never came back converts "nobody is watching" into
 * "something is watching" — and the second one stops anybody looking.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rt = require('../../lib/nodeRebootTest.js');

/**
 * A stand-in home folder, COMPOSED rather than written down. A literal
 * `/Users/...` in a fixture is still a machine-specific path (NODES principle
 * P1), and asserting on a joined path tests the composition rather than one
 * machine's spelling of it.
 */
const FAKE_HOME = path.join(path.sep, 'tmp', 'example-home');

const BOOT_SEC = 1787381676;
const boot = (sec = BOOT_SEC) => ({ ok: true, sec, at: new Date(sec * 1000).toISOString() });

/** A record shaped exactly like one recordVerification would have written. */
function storedRecord(overrides = {}) {
  return {
    found: true,
    readable: true,
    file: '/tmp/role-verification.json',
    record: {
      node: 'mac-mini',
      boot: { sec: BOOT_SEC, at: new Date(BOOT_SEC * 1000).toISOString() },
      at: '2026-09-05T12:00:00.000Z',
      roles: [
        { role: 'bus-relay', installed: true, loaded: true },
        { role: 'pipeline-pulse', installed: true, loaded: true },
      ],
      ...overrides,
    },
  };
}

// --- reading the boot identity ----------------------------------------------

test('kern.boottime is read from its sec field, not its human date', () => {
  const parsed = rt.parseBootTime('{ sec = 1787381676, usec = 445740 } Sat Aug 22 00:54:36 2026');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.sec, 1787381676);
  assert.equal(parsed.at, new Date(1787381676 * 1000).toISOString());
});

test('boot time that cannot be parsed is a stated failure, never a zero', () => {
  for (const text of ['', 'not a boottime', undefined, null, '{ usec = 12 }']) {
    const parsed = rt.parseBootTime(text);
    assert.equal(parsed.ok, false, `expected a refusal for ${JSON.stringify(text)}`);
    assert.match(parsed.why, /kern\.boottime/);
  }
});

test('a boot time of zero is refused rather than treated as the epoch', () => {
  assert.equal(rt.parseBootTime('{ sec = 0, usec = 0 }').ok, false);
});

test('a small clock correction is the same boot; a real restart is not', () => {
  // macOS stores kern.boottime as an absolute instant, so an NTP correction
  // moves it. Absorbing that must not become absorbing a fast reboot.
  assert.equal(rt.isSameBoot(boot(), { sec: BOOT_SEC + 12 }), true);
  assert.equal(rt.isSameBoot(boot(), { sec: BOOT_SEC - 12 }), true);
  assert.equal(rt.isSameBoot(boot(), { sec: BOOT_SEC + rt.SAME_BOOT_TOLERANCE_S + 1 }), false);
  assert.equal(rt.isSameBoot(boot(), { sec: BOOT_SEC + 3600 }), false);
});

test('a missing reading is never the same boot as anything', () => {
  assert.equal(rt.isSameBoot(null, { sec: BOOT_SEC }), false);
  assert.equal(rt.isSameBoot(boot(), null), false);
  assert.equal(rt.isSameBoot(boot(), { sec: 'nonsense' }), false);
});

// --- reading a schedule's status --------------------------------------------

test('an installed and loaded schedule is read from the installer block', () => {
  const text = [
    'machine:  mac-mini (from file)',
    'owns it:  yes',
    `schedule: INSTALLED at ${path.join(FAKE_HOME, 'Library', 'LaunchAgents', 'com.starcaster.bus-relay.plist')}`,
    'loaded:   yes — -\t0\tcom.starcaster.bus-relay',
  ].join('\n');
  assert.deepEqual(rt.parseScheduleStatus(text), { installed: true, loaded: true });
});

test('installed but not loaded is a distinct reading from not installed', () => {
  assert.deepEqual(
    rt.parseScheduleStatus('schedule: INSTALLED at /x.plist\nloaded:   no'),
    { installed: true, loaded: false },
  );
  assert.deepEqual(
    rt.parseScheduleStatus('schedule: NOT INSTALLED'),
    { installed: false, loaded: false },
  );
  assert.deepEqual(rt.parseScheduleStatus(''), { installed: false, loaded: false });
});

// --- the verdict: acceptance criterion 1 ------------------------------------

test('a machine that has restarted since its verification reports CANNOT TELL', () => {
  const verdict = rt.rebootTestReport({
    boot: boot(BOOT_SEC + 90000),
    stored: storedRecord(),
    node: 'mac-mini',
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /restarted since/);
  assert.match(verdict.why, /login/);
  assert.match(verdict.fix, /node:verify/);
});

// --- acceptance criterion 2 --------------------------------------------------

test('a verification against the current boot reports PASS', () => {
  const verdict = rt.rebootTestReport({ boot: boot(), stored: storedRecord(), node: 'mac-mini' });
  assert.equal(verdict.state, 'pass');
  assert.match(verdict.headline, /All 2 owned roles came back/);
  assert.match(verdict.why, /bus-relay, pipeline-pulse/);
});

test('the SAME record goes back to CANNOT TELL once the boot moves, with nobody updating it', () => {
  const stored = storedRecord();
  assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini' }).state, 'pass');
  assert.equal(
    rt.rebootTestReport({ boot: boot(BOOT_SEC + 100000), stored, node: 'mac-mini' }).state,
    'unknown',
  );
});

// --- acceptance criterion 3 --------------------------------------------------

test('a role that did not come back is a FAIL that names it', () => {
  const stored = storedRecord({
    roles: [
      { role: 'bus-relay', installed: true, loaded: true },
      { role: 'pipeline-pulse', installed: true, loaded: false },
    ],
  });
  const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini' });
  assert.equal(verdict.state, 'fail');
  assert.match(verdict.headline, /1 role did not come back/);
  assert.match(verdict.why, /pipeline-pulse: schedule installed but launchd has not loaded it/);
});

test('a schedule that is gone entirely reads differently from one that is merely unloaded', () => {
  const stored = storedRecord({ roles: [{ role: 'bus-relay', installed: false, loaded: false }] });
  const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini' });
  assert.equal(verdict.state, 'fail');
  assert.match(verdict.why, /bus-relay: schedule not installed/);
});

test('the verdict is re-derived from the rows every read, so a stale PASS cannot survive', () => {
  // The record carries observations, never a verdict. Even a record that
  // claims to be a pass is graded on what it actually saw.
  const stored = storedRecord({
    verdict: 'pass',
    ok: true,
    roles: [{ role: 'bus-relay', installed: true, loaded: false }],
  });
  assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini' }).state, 'fail');
});

// --- acceptance criterion 4 --------------------------------------------------

test('no record at all is CANNOT TELL, and says how to make one', () => {
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: { found: false, readable: true, file: '/tmp/nope.json' },
    node: 'mac-mini',
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /never been verified/);
  assert.match(verdict.fix, /node:verify/);
});

test('an unreadable record is CANNOT TELL, and is not confused with a missing one', () => {
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: { found: false, readable: false, file: '/tmp/x.json', why: 'the record is not JSON — bad token' },
    node: 'mac-mini',
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /could not be read/);
  assert.match(verdict.why, /not JSON/);
});

test('a boot time that could not be read is CANNOT TELL, never a pass', () => {
  const verdict = rt.rebootTestReport({
    boot: { why: 'sysctl is not on this shell\'s PATH' },
    stored: storedRecord(),
    node: 'mac-mini',
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.why, /sysctl/);
});

// --- the vacuous-truth guard -------------------------------------------------

test('a record that observed no roles is CANNOT TELL, not "everything came back"', () => {
  const verdict = rt.rebootTestReport({ boot: boot(), stored: storedRecord({ roles: [] }), node: 'mac-mini' });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /observed no roles/);
});

test('recordVerification refuses to write a verification with nothing in it', () => {
  const calls = [];
  const write = { mkdirSync: () => calls.push('mkdir'), writeFileSync: () => calls.push('write') };

  assert.equal(rt.recordVerification({ node: 'mac-mini', boot: boot(), roles: [], write }).ok, false);
  assert.equal(rt.recordVerification({ node: 'mac-mini', boot: boot(), write }).ok, false);
  assert.equal(rt.recordVerification({ node: 'mac-mini', roles: [{ role: 'a', installed: true, loaded: true }], write }).ok, false);
  assert.deepEqual(calls, [], 'a refused verification must not touch the disk');
});

test('recordVerification refuses an observation that does not say what it saw', () => {
  const write = { mkdirSync: () => {}, writeFileSync: () => {} };
  const bad = [
    [{ role: 'bus-relay' }],
    [{ role: 'bus-relay', installed: true }],
    [{ role: '', installed: true, loaded: true }],
    [{ installed: true, loaded: true }],
    [{ role: 'bus-relay', installed: 'yes', loaded: 'yes' }],
  ];
  for (const roles of bad) {
    const r = rt.recordVerification({ node: 'mac-mini', boot: boot(), roles, write });
    assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(roles)}`);
  }
});

// --- a record from somewhere else -------------------------------------------

test('a record copied from another machine says nothing about this one', () => {
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: storedRecord({ node: 'macbook-pro' }),
    node: 'mac-mini',
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /belongs to macbook-pro/);
});

// --- the round trip, on a real temporary folder ------------------------------

test('a written verification reads back and grades the same way', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reboot-test-'));
  try {
    const written = rt.recordVerification({
      node: 'mac-mini',
      boot: boot(),
      roles: [{ role: 'bus-relay', installed: true, loaded: true }],
      homedir: home,
    });
    assert.equal(written.ok, true);

    const stored = rt.readVerification({ homedir: home });
    assert.equal(stored.found, true);
    assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini' }).state, 'pass');
    assert.equal(
      rt.rebootTestReport({ boot: boot(BOOT_SEC + 100000), stored, node: 'mac-mini' }).state,
      'unknown',
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a corrupt record on disk is unreadable, not absent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reboot-test-'));
  try {
    fs.mkdirSync(rt.verificationDir(home), { recursive: true });
    fs.writeFileSync(rt.verificationFile(home), '{ not json');
    const stored = rt.readVerification({ homedir: home });
    assert.equal(stored.found, false);
    assert.equal(stored.readable, false);
    assert.match(stored.why, /not JSON/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a record with no boot identity cannot be aged, so it is unreadable', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reboot-test-'));
  try {
    fs.mkdirSync(rt.verificationDir(home), { recursive: true });
    fs.writeFileSync(rt.verificationFile(home), JSON.stringify({ node: 'mac-mini', roles: [] }));
    const stored = rt.readVerification({ homedir: home });
    assert.equal(stored.readable, false);
    assert.match(stored.why, /no boot identity/);
    assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini' }).state, 'unknown');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the record lives beside the heartbeat stamps, not in the repo', () => {
  // A worktree is deleted when its thread ships. A verification that vanished
  // with it would report a confirmed machine as unconfirmed.
  assert.equal(
    rt.verificationDir(FAKE_HOME),
    path.join(FAKE_HOME, 'Library', 'Application Support', 'starcaster', 'heartbeat'),
  );
  assert.equal(path.dirname(rt.verificationFile(FAKE_HOME)), rt.verificationDir(FAKE_HOME));
  assert.equal(path.basename(rt.verificationFile(FAKE_HOME)), 'role-verification.json');
  // ...and it is NOT in the repo, which is the point of the folder choice.
  assert.ok(!rt.verificationDir(FAKE_HOME).includes('starcaster/.claude'));
});
