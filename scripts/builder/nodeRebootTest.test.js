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

/**
 * What `nodeProvision.schedulesForNode()` hands over — the roles this machine
 * OWNS, in the three shapes that inventory actually uses: probeable (it has an
 * installer), `blocked` (no installer exists yet) and `manual` (no schedule, on
 * purpose). A verdict is graded against THIS, never against the record: the
 * record is evidence, and evidence cannot also be the standard.
 */
const OWNED = [
  { role: 'bus-relay', installer: 'scripts/install_bus_relay.sh' },
  { role: 'pipeline-pulse', installer: 'scripts/install_pipeline_pulse.sh' },
];

/** The Mini's real shape: three probeable roles and three with no schedule. */
const OWNED_SIX = [
  ...OWNED,
  { role: 'weekly-report', installer: 'scripts/install_weekly_report.sh' },
  { role: 'loop-build', blocked: 'The loops run inside a long-lived agent session — there is no installer in this repo yet.' },
  { role: 'loop-review', blocked: 'Same as loop-build — one session runs both lanes.' },
  { role: 'db-refresh', manual: true, why: 'Deliberately has no schedule; it spends production disk IO.' },
];

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
    owned: OWNED,
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /restarted since/);
  assert.match(verdict.why, /login/);
  assert.match(verdict.fix, /node:verify/);
});

// --- acceptance criterion 2 --------------------------------------------------

test('a verification against the current boot reports PASS', () => {
  const verdict = rt.rebootTestReport({ boot: boot(), stored: storedRecord(), node: 'mac-mini', owned: OWNED });
  assert.equal(verdict.state, 'pass');
  assert.match(verdict.headline, /All 2 owned roles came back/);
  assert.match(verdict.why, /bus-relay, pipeline-pulse/);
});

test('the SAME record goes back to CANNOT TELL once the boot moves, with nobody updating it', () => {
  const stored = storedRecord();
  assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED }).state, 'pass');
  assert.equal(
    rt.rebootTestReport({ boot: boot(BOOT_SEC + 100000), stored, node: 'mac-mini', owned: OWNED }).state,
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
  const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED });
  assert.equal(verdict.state, 'fail');
  assert.match(verdict.headline, /1 role did not come back/);
  assert.match(verdict.why, /pipeline-pulse: schedule installed but launchd has not loaded it/);
});

test('a schedule that is gone entirely reads differently from one that is merely unloaded', () => {
  const stored = storedRecord({ roles: [{ role: 'bus-relay', installed: false, loaded: false }] });
  const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED });
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
  assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED }).state, 'fail');
});

// --- acceptance criterion 4 --------------------------------------------------

test('no record at all is CANNOT TELL, and says how to make one', () => {
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: { found: false, readable: true, file: '/tmp/nope.json' },
    node: 'mac-mini',
    owned: OWNED,
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
    owned: OWNED,
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
    owned: OWNED,
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.why, /sysctl/);
});

// --- the vacuous-truth guard -------------------------------------------------

test('a record that observed no roles is CANNOT TELL, not "everything came back"', () => {
  const verdict = rt.rebootTestReport({ boot: boot(), stored: storedRecord({ roles: [] }), node: 'mac-mini', owned: OWNED });
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

// --- round 2: three ways this reported a pass it had not earned --------------
//
// Each of the four tests below fails against the code as it stood before this
// round, and each was confirmed doing so by reverting the fix and watching it
// go red. That is the point of them: every one is a case where a machine whose
// jobs never came back would have been reported as fine.

test('a record covering 3 roles on a machine that owns 6 does not claim all owned roles came back', () => {
  // The live shape on the Mini. Before this round the headline read
  // "All 3 owned roles came back after the last restart" — on a machine owning
  // six, three of them the loop lanes and the media worker, which are exactly
  // what a 3am power blip takes out and leaves nobody to notice.
  const stored = storedRecord({
    roles: [
      { role: 'bus-relay', installed: true, loaded: true },
      { role: 'pipeline-pulse', installed: true, loaded: true },
      { role: 'weekly-report', installed: true, loaded: true },
    ],
  });
  const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED_SIX });

  assert.equal(verdict.state, 'pass', 'three probeable roles all came back, so this is still a pass');
  assert.doesNotMatch(verdict.headline, /All 3 owned roles/, 'the record is not the measure of what is owned');
  assert.match(verdict.headline, /3 of 6 owned roles confirmed/);
  // The unchecked roles are named where the verdict is READ, not buried.
  for (const role of ['loop-build', 'loop-review', 'db-refresh']) {
    assert.ok(verdict.headline.includes(role), `${role} has no schedule to check and must be named on the verdict line`);
  }
});

test('an owned, probeable role missing from the record is CANNOT TELL naming it', () => {
  // The drift case: a `blocked` row gains an installer, which
  // lib/nodeProvision.js explicitly anticipates. Before this round the section
  // kept reporting PASS off a record written when that role could not be
  // probed at all, until a reboot happened to clear it.
  const owned = [...OWNED, { role: 'youtube-media', installer: 'workers/youtube-media/install.sh' }];
  const verdict = rt.rebootTestReport({ boot: boot(), stored: storedRecord(), node: 'mac-mini', owned });

  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /youtube-media|1 role this machine owns is not in its verification record/);
  assert.ok(verdict.why.includes('youtube-media'), 'the role nobody looked at has to be named');
  assert.match(verdict.fix, /node:verify/);
});

test('rebootTestReport with no node identity is not a pass', () => {
  // doctor_node.mjs passed `node: null` for an unrecognised machine, which did
  // not merely skip the identity question — it disarmed the copied-record
  // guard (`if (node && ...)`) and let the grading run all the way to PASS, on
  // the one kind of machine where the only record that could exist is a copy.
  for (const node of [null, undefined, '']) {
    const verdict = rt.rebootTestReport({ boot: boot(), stored: storedRecord(), node, owned: OWNED });
    assert.notEqual(verdict.state, 'pass', `node ${JSON.stringify(node)} must not reach a pass`);
    assert.equal(verdict.state, 'unknown');
    assert.match(verdict.headline, /does not know which node it is/);
  }
});

test('a plist deleted without unloading prints a FAIL row, not ok under a failing summary', () => {
  // `install_bus_relay.sh --uninstall` produces exactly this state. The table
  // keyed its prefix off `loaded` alone while the summary counted
  // `!installed || !loaded`, so node:verify printed `ok  bus-relay: loaded`
  // under a line saying one role did not come back, naming nothing.
  const row = { role: 'bus-relay', installed: false, loaded: true };

  assert.equal(rt.didNotComeBack(row), true, 'installed AND loaded, or it did not come back');
  assert.match(rt.roleTableLine(row), /^ {2}FAIL {2}bus-relay: /);
  assert.doesNotMatch(rt.roleTableLine(row), /^ {2}ok/);
  // The row and the count are the same fact, so the table can never contradict
  // the summary standing over it.
  assert.equal([row].filter(rt.didNotComeBack).length, 1);
  assert.match(rt.roleTableLine(row), /not installed/);

  // ...and a healthy row still reads as one.
  const good = { role: 'bus-relay', installed: true, loaded: true };
  assert.equal(rt.didNotComeBack(good), false);
  // Both prefixes are four characters wide, so the table's columns line up.
  assert.match(rt.roleTableLine(good), /^ {2}ok {4}bus-relay: loaded$/);
});

test('an owned role with no schedule is named, never silently dropped from the count', () => {
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: storedRecord(),
    node: 'mac-mini',
    owned: [...OWNED, { role: 'loop-build', blocked: 'no installer exists yet' }],
  });
  assert.equal(verdict.state, 'pass');
  assert.match(verdict.headline, /2 of 3 owned roles confirmed/);
  assert.ok(verdict.headline.includes('loop-build'));
  assert.ok(verdict.why.includes('no installer exists yet'), 'the reason travels with the name, as nodeHeartbeat does');
});

test('a failure names the roles nobody looked at as well as the ones that failed', () => {
  const stored = storedRecord({
    roles: [
      { role: 'bus-relay', installed: true, loaded: false },
      { role: 'pipeline-pulse', installed: true, loaded: true },
    ],
  });
  const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED_SIX });
  assert.equal(verdict.state, 'fail', 'a found defect outranks a blind spot');
  assert.match(verdict.why, /bus-relay: schedule installed but launchd has not loaded it/);
  assert.ok(verdict.why.includes('weekly-report'), 'an unverified role must not be hidden by a failure elsewhere');
  assert.ok(verdict.why.includes('loop-build'), 'nor must a role with no schedule at all');
});

test('without the owned inventory there is no pass to be had', () => {
  for (const owned of [undefined, null, 'bus-relay', [{ installer: 'x' }]]) {
    const verdict = rt.rebootTestReport({ boot: boot(), stored: storedRecord(), node: 'mac-mini', owned });
    assert.equal(verdict.state, 'unknown', `owned=${JSON.stringify(owned)} must not reach a pass`);
  }
});

test('the record states what was NOT looked at, so it is a full statement', () => {
  const write = { mkdirSync: () => {}, writeFileSync: () => {} };
  const written = rt.recordVerification({
    node: 'mac-mini',
    boot: boot(),
    roles: [{ role: 'bus-relay', installed: true, loaded: true }],
    skipped: [{ role: 'loop-build', why: 'no installer exists yet' }],
    write,
  });
  assert.equal(written.ok, true);
  assert.deepEqual(written.record.skipped, [{ role: 'loop-build', why: 'no installer exists yet' }]);

  // And a skipped row with no reason is refused, for the same reason an
  // observation with no reading is: it would record that something was passed
  // over without recording what.
  for (const skipped of [[{ role: 'loop-build' }], [{ why: 'no installer' }], 'loop-build']) {
    assert.equal(
      rt.recordVerification({ node: 'mac-mini', boot: boot(), roles: [{ role: 'a', installed: true, loaded: true }], skipped, write }).ok,
      false,
      `expected a refusal for ${JSON.stringify(skipped)}`,
    );
  }
});

// --- round 3: the verdict comes off what is OWNED **and** PROBEABLE ----------
//
// Round 2 graded the PASS count against ownership and left everything else
// grading `record.roles`. Each test below returned the WRONG verdict before
// that was fixed; the wrong answer each one produced is quoted with it.

test('a machine whose owned roles all lost their schedules cannot reach a pass', () => {
  // Was: state 'pass', headline "0 of 2 owned roles confirmed after the last
  // restart" — a green tick over nothing at all. lib/nodeProvision.js hands
  // back `blocked` automatically for any role with no registered installer, so
  // a role LOSING its installer produces exactly this shape.
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: storedRecord({ roles: [{ role: 'bus-relay', installed: true, loaded: true }] }),
    node: 'mac-mini',
    owned: [
      { role: 'bus-relay', blocked: 'the installer was removed' },
      { role: 'weekly-report', manual: true, why: 'no schedule, on purpose' },
    ],
  });
  assert.equal(verdict.state, 'unknown');
  assert.doesNotMatch(verdict.headline, /confirmed/, 'nothing was confirmed, so nothing may say it was');
  assert.match(verdict.why, /not a pass/);
});

test('no role is named as confirmed and as not-checked in the same verdict', () => {
  // Was: "Observed: bus-relay. Not checked: bus-relay (the installer was
  // removed)" — one role on both sides of one sentence.
  //
  // This reads the names back out of the rendered sentence rather than off
  // `verdict.roles`, and that is the whole point of it. Against the fix,
  // `verdict.roles` is drawn from the probeable inventory and `Not checked`
  // from the unprobeable one, so comparing those two can NEVER fail however
  // wrong the prose is — an assertion that cannot fail is not a test. What a
  // reader sees is the sentence, so the sentence is what is checked.
  const observedIn = (text) => {
    const m = /Observed: ([^.]*)\./.exec(text);
    return m ? m[1].split(',').map((r) => r.trim()).filter(Boolean) : [];
  };
  const notCheckedIn = (text) => {
    const m = /Not checked: (.*)$/.exec(text);
    return m ? m[1] : '';
  };

  const verdicts = [
    // A role that has lost its installer, still sitting in the record.
    rt.rebootTestReport({
      boot: boot(),
      stored: storedRecord({
        roles: [
          { role: 'bus-relay', installed: true, loaded: true },
          { role: 'pipeline-pulse', installed: true, loaded: true },
        ],
      }),
      node: 'mac-mini',
      owned: [{ role: 'bus-relay', blocked: 'the installer was removed' }, ...OWNED.slice(1)],
    }),
    rt.rebootTestReport({ boot: boot(), stored: storedRecord(), node: 'mac-mini', owned: OWNED_SIX }),
    rt.rebootTestReport({ boot: boot(), stored: storedRecord(), node: 'mac-mini', owned: OWNED }),
  ];

  for (const verdict of verdicts) {
    const text = `${verdict.headline} ${verdict.why}`;
    const notChecked = notCheckedIn(text);
    for (const role of observedIn(text)) {
      assert.ok(
        !new RegExp(`\\b${role}\\b`).test(notChecked),
        `"${role}" is named as observed and as not checked in one verdict: ${text}`,
      );
    }
  }
});

test('a record row for a role this machine does not own is not a failure', () => {
  // Was: state 'fail', "1 role did not come back after this machine restarted.
  // bus-relay: schedule not installed" — a permanent failure naming a job this
  // Mac does not run, clearable only by deleting the record.
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: storedRecord({
      roles: [
        { role: 'weekly-report', installed: true, loaded: true },
        { role: 'bus-relay', installed: false, loaded: false },
      ],
    }),
    node: 'mac-mini',
    owned: [{ role: 'weekly-report', installer: 'scripts/install_weekly_report.sh' }],
  });
  assert.notEqual(verdict.state, 'fail', 'a role this machine does not own cannot fail on it');
  assert.equal(verdict.state, 'pass');
  assert.match(verdict.why, /bus-relay is in the record, but this machine no longer owns it/);
  assert.deepEqual(verdict.roles.map((r) => r.role), ['weekly-report']);
});

test('a machine with nothing probeable is not sent to a command that refuses it', () => {
  // Was: "This machine's roles have never been verified since the reboot test
  // was added." with fix `npm run node:verify` — which exits 2 on exactly this
  // machine (scripts/verify_node_roles.mjs), so macbook-pro had a CANNOT TELL
  // it could never clear.
  const macbookPro = [
    { role: 'db-refresh', manual: true, why: 'Deliberately has no schedule; it spends production disk IO.' },
    { role: 'pulse-pipelines', blocked: 'Installing these needs pulse\'s bin/install-launchd.sh, which is Slice B.' },
  ];
  for (const stored of [{ found: false, readable: true, file: '/tmp/nope.json' }, storedRecord()]) {
    const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'macbook-pro', owned: macbookPro });
    assert.equal(verdict.state, 'unknown');
    assert.doesNotMatch(verdict.fix, /node:verify/, 'the fix line must not be a command that refuses this machine');
    assert.match(verdict.headline, /a reboot could take away/);
    assert.match(verdict.why, /exit 2/);
  }
});

test('a record covering only roles that have moved away confirms nothing', () => {
  // The empty-CONFIRMATION guard, as against the empty-RECORD one six lines
  // above it in the library: every row is real, and not one of them speaks for
  // a role this machine currently owns and can probe.
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: storedRecord({ roles: [{ role: 'weekly-report', installed: true, loaded: true }] }),
    node: 'mac-mini',
    owned: [{ role: 'bus-relay', installer: 'scripts/install_bus_relay.sh' }],
  });
  assert.equal(verdict.state, 'unknown');
  assert.match(verdict.headline, /speaks for a role it currently owns/);
});

// --- a record from somewhere else -------------------------------------------

test('a record copied from another machine says nothing about this one', () => {
  const verdict = rt.rebootTestReport({
    boot: boot(),
    stored: storedRecord({ node: 'macbook-pro' }),
    node: 'mac-mini',
    owned: OWNED,
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
    // Graded against a machine that owns exactly the role the record covers —
    // anything else is the drift case, which has its own test below.
    const ownsOne = [OWNED[0]];
    assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: ownsOne }).state, 'pass');
    assert.equal(
      rt.rebootTestReport({ boot: boot(BOOT_SEC + 100000), stored, node: 'mac-mini', owned: ownsOne }).state,
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
    assert.equal(rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED }).state, 'unknown');
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

// --- round 3: a record shape neither half agreed on --------------------------
//
// The write half validated every row; the read half validated the record's
// SHAPE and stopped at the edge of the list; the verdict then read `row.role`
// off each row. The gap between them was a TypeError, and `doctor_node.mjs`
// prints its whole report with one `console.log` on its last line, so all six
// sections went with it.

test('a record row that is not an observation makes the record unreadable', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reboot-test-'));
  try {
    fs.mkdirSync(rt.verificationDir(home), { recursive: true });
    const bad = [
      [null, { role: 'bus-relay', installed: true, loaded: true }],
      [{ role: 'bus-relay', installed: true, loaded: true }, 'bus-relay'],
      [['bus-relay', true, true]],
      [{ installed: true, loaded: true }],
      [{ role: '', installed: true, loaded: true }],
      [{ role: 'bus-relay' }],
      [{ role: 'bus-relay', installed: true }],
      [{ role: 'bus-relay', installed: 'yes', loaded: 'yes' }],
    ];
    for (const roles of bad) {
      fs.writeFileSync(
        rt.verificationFile(home),
        JSON.stringify({ node: 'mac-mini', boot: { sec: BOOT_SEC }, at: 'x', roles, skipped: [] }),
      );
      const stored = rt.readVerification({ homedir: home });
      assert.equal(stored.readable, false, `expected a refusal for ${JSON.stringify(roles)}`);
      assert.equal(stored.found, false);
      assert.ok(stored.why, 'an unreadable record must say what is wrong with it');
      // Criterion 4: unreadable is CANNOT TELL upstairs, never a pass.
      const verdict = rt.rebootTestReport({ boot: boot(), stored, node: 'mac-mini', owned: OWNED });
      assert.equal(verdict.state, 'unknown');
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a malformed record is a verdict, not a TypeError, even handed over directly', () => {
  // This is the crash itself. `rebootTestReport` is documented as taking what
  // `readVerification` returned, and is also fed records straight from callers
  // and tests — the same reason the empty-record guard above it stayed. A
  // crash is not one of the three states, and the caller that dies here is the
  // diagnostic somebody is running BECAUSE something is already wrong.
  for (const roles of [[null], [undefined], ['bus-relay'], [{ installed: true, loaded: true }], [{ role: 'bus-relay' }]]) {
    let verdict;
    assert.doesNotThrow(() => {
      verdict = rt.rebootTestReport({
        boot: boot(),
        stored: storedRecord({ roles }),
        node: 'mac-mini',
        owned: OWNED,
      });
    }, `a record row of ${JSON.stringify(roles)} threw instead of answering`);
    assert.equal(verdict.state, 'unknown');
    assert.doesNotMatch(verdict.headline, /confirmed|came back/, 'an ungradeable record is not a pass');
  }
});

test('a record that cannot say which machine it describes is not this machine\'s', () => {
  // Was: `if (node && record.node && record.node !== node)`, so a record with
  // no attribution skipped the copied-record guard and was graded to a PASS —
  // the shape with the LEAST claim on this machine of any, by this module's own
  // reasoning about copied Application Support folders.
  for (const missing of ['', undefined, null, 0, 123, {}]) {
    const verdict = rt.rebootTestReport({
      boot: boot(),
      stored: storedRecord({ node: missing }),
      node: 'mac-mini',
      owned: OWNED,
    });
    assert.equal(verdict.state, 'unknown', `record.node = ${JSON.stringify(missing)} reached ${verdict.state}`);
    assert.match(verdict.headline, /does not say which machine/);
    assert.doesNotMatch(verdict.headline, /came back|confirmed/);
  }
});

test('recordVerification refuses to write a record that cannot name its machine', () => {
  // The other half of the same rule: nothing may WRITE the shape the reader
  // now refuses. `verify_node_roles.mjs` refuses an unknown node before it
  // reaches here, so nothing in this repo writes one today — which is exactly
  // the "nothing calls it that way yet" round 1 was sent back over.
  const calls = [];
  const write = { mkdirSync: () => calls.push('mkdir'), writeFileSync: () => calls.push('write') };
  const roles = [{ role: 'bus-relay', installed: true, loaded: true }];
  for (const node of [undefined, null, '', 0, 42]) {
    const r = rt.recordVerification({ node, boot: boot(), roles, write });
    assert.equal(r.ok, false, `expected a refusal for node ${JSON.stringify(node)}`);
    assert.match(r.why, /which machine/);
  }
  assert.deepEqual(calls, [], 'a refused verification must not touch the disk');
  assert.equal(rt.recordVerification({ node: 'mac-mini', boot: boot(), roles, write }).ok, true);
});

test('a stale row does not read as a fourth role with no schedule', () => {
  // The seam: the not-checked list joined its entries with a bare space and
  // was never terminated, so the stale-row sentence ran straight on from the
  // last one — `youtube-media (Installing it needs ...) pulse-pipelines is in
  // the record, but ...`. The operator's whole answer is this line.
  const owned = [
    OWNED[0],
    { role: 'loop-build', blocked: 'The loops run inside a long-lived agent session. There is no installer in this repo yet.' },
    { role: 'loop-review', blocked: 'Same as loop-build. One session runs both lanes.' },
  ];
  const stale = 'pulse-pipelines';
  const withStale = (rows) => storedRecord({ roles: [...rows, { role: stale, installed: true, loaded: true }] });

  const pass = rt.rebootTestReport({
    boot: boot(),
    stored: withStale([{ role: 'bus-relay', installed: true, loaded: true }]),
    node: 'mac-mini',
    owned,
  });
  assert.equal(pass.state, 'pass');

  const fail = rt.rebootTestReport({
    boot: boot(),
    stored: withStale([{ role: 'bus-relay', installed: true, loaded: false }]),
    node: 'mac-mini',
    owned,
  });
  assert.equal(fail.state, 'fail');

  for (const verdict of [pass, fail]) {
    // The clause a reader takes as "roles with no schedule" is everything from
    // `Not checked:` to the first full stop. The stale role must not be in it.
    const clause = /Not checked: ([^.]*)\./.exec(verdict.why);
    assert.ok(clause, `no terminated "Not checked:" clause in: ${verdict.why}`);
    assert.doesNotMatch(
      clause[1],
      new RegExp(`\\b${stale}\\b`),
      `"${stale}" is stale, but it reads as a role with no schedule: ${verdict.why}`,
    );
    assert.doesNotMatch(clause[1], /is in the record/, `the stale sentence ran on: ${verdict.why}`);
    // ...and it is still said, in its own sentence.
    assert.match(verdict.why, new RegExp(`\\. ${stale} is in the record`));
  }

  // The FAIL line's own seam: the roles that did not come back were listed
  // without a full stop, so the next finding ran on from `...has not loaded it`.
  assert.doesNotMatch(fail.why, /loaded it [A-Za-z]/, `the failure clause ran on: ${fail.why}`);
});
