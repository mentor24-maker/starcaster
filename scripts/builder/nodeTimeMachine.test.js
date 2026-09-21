'use strict';

/**
 * Tests for lib/nodeTimeMachine.js — when did Time Machine last FINISH a
 * backup, on each machine that is supposed to have one (ticket 86bbvr110).
 *
 * The fixtures are the MacBook's real output, captured 2026-09-21 (the data
 * blobs trimmed): `tmutil latestbackup` failing to mount and still exiting 0,
 * and `defaults export` carrying the fifteen completed backups that ended on
 * 2024-11-15. The ticket's four break-tests are the first four tests, in its
 * order; steps 1–3 prove the check can fail, step 4 proves it can still pass.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROBE_COMMAND,
  STALE_AFTER_MS,
  TIME_MACHINE_NODES,
  destinationsFrom,
  parsePlist,
  splitProbe,
  timeMachineReport,
} = require('../../lib/nodeTimeMachine.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-21T08:40:00Z');

const DESTINATIONS = [
  '====================================================',
  'Name          : Blue Passport',
  'Kind          : Local',
  'ID            : 2529BA88-EB07-4AF5-AC36-6CEF451078E9',
].join('\n');

const MOUNT_FAILED = 'Failed to mount backup destination, error: Error Domain=com.apple.backupd.ErrorDomain Code=18 "Failed to mount destination." UserInfo={NSLocalizedDescription=Failed to mount destination.}';

function prefsXml({ snapshots = ['2024-11-15T18:27:54Z', '2024-11-15T20:55:02Z'], error = 'Insufficient battery power remaining (16%)' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AutoBackup</key>
	<true/>
	<key>BackupAlias</key>
	<data>
	AAAAAAEiAAIAAQtNeSBQYXNzcG9ydA==
	</data>
	<key>Destinations</key>
	<array>
		<dict>
			<key>AttemptDates</key>
			<array>
				<date>2024-11-15T20:53:02Z</date>
			</array>
			<key>DestinationID</key>
			<string>2529BA88-EB07-4AF5-AC36-6CEF451078E9</string>
			<key>LastKnownVolumeName</key>
			<string>Blue Passport</string>
			${error ? `<key>MessageParameters</key>
			<array>
				<string>${error}</string>
			</array>` : ''}
			<key>RESULT</key>
			<integer>101</integer>
			<key>SnapshotDates</key>
			<array>
${snapshots.map((s) => `				<date>${s}</date>`).join('\n')}
			</array>
		</dict>
	</array>
	<key>LastBackupActivity</key>
	<string>2026-09-21-005335</string>
</dict>
</plist>`;
}

function probeOut({ destinations = DESTINATIONS, latest = MOUNT_FAILED, prefs = prefsXml(), end = true } = {}) {
  return ['@@DESTINATIONS', destinations, '@@LATEST', latest, '@@PREFS', prefs, ...(end ? ['@@END'] : [])].join('\n');
}

const reached = (out) => ({ ran: true, ok: true, out, where: 'this machine' });
const report = (probe, opts = {}) => timeMachineReport({ machine: 'macbook-pro', probe, expected: true, now: NOW, ...opts });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// --- the ticket's four break-tests ------------------------------------------

test('1. a stale last backup is FAIL', () => {
  const r = report(reached(probeOut({ latest: '/Volumes/Blue Passport/Backups.backupdb/2024-11-15-205502.backup', error: null })));
  assert.equal(r.state, 'FAIL');
  assert.match(r.headline, /22 months ago \(2024-11-15, to Blue Passport\)/);
  assert.match(r.why, /14-day threshold/);
});

test('2. an unmountable destination is FAIL — with the reason named — never CANNOT TELL', () => {
  const r = report(reached(probeOut()));
  assert.equal(r.state, 'FAIL');
  assert.match(r.why, /cannot be mounted right now/);
  assert.match(r.why, /Insufficient battery power remaining \(16%\)/, 'Time Machine\'s own last error is quoted');
  assert.match(r.fix, /Plug in Blue Passport/);
});

test('3. an unreachable machine is CANNOT TELL — not FAIL, not PASS', () => {
  const why = 'ssh "macbook-pro" did not answer — asleep, off this network, or key not set up; not treated as drift';
  const r = report({ ran: false, why });
  assert.equal(r.state, 'CANNOT TELL');
  assert.equal(r.why, why);
});

test('4. a fresh backup is PASS — the check can still pass', () => {
  const r = report(reached(probeOut({
    latest: '/Volumes/Blue Passport/Backups.backupdb/x.backup',
    prefs: prefsXml({ snapshots: [iso(NOW - 3 * DAY), iso(NOW - 2 * 3600000)], error: null }),
  })));
  assert.equal(r.state, 'PASS');
  assert.match(r.headline, /2 hours ago/);
  assert.equal(r.why, null);
});

// --- the cry-wolf trap, and the edges ---------------------------------------

test('an unplugged drive with a recent backup is PASS, and says the drive is not attached', () => {
  const r = report(reached(probeOut({ prefs: prefsXml({ snapshots: [iso(NOW - 5 * DAY)] }) })));
  assert.equal(r.state, 'PASS');
  assert.match(r.why, /not attached right now/);
});

test('the threshold is a boundary: one minute inside passes, one minute past fails', () => {
  const at = (ms) => report(reached(probeOut({ prefs: prefsXml({ snapshots: [iso(NOW - ms)], error: null }) }))).state;
  assert.equal(at(STALE_AFTER_MS - 60000), 'PASS');
  assert.equal(at(STALE_AFTER_MS + 60000), 'FAIL');
});

test('the NEWEST completed backup decides, whatever order the record lists them in', () => {
  const r = report(reached(probeOut({ prefs: prefsXml({ snapshots: [iso(NOW - 1 * DAY), iso(NOW - 400 * DAY)] }) })));
  assert.equal(r.state, 'PASS');
});

test('a destination that has never completed a backup is FAIL', () => {
  const r = report(reached(probeOut({ prefs: prefsXml({ snapshots: [] }) })));
  assert.equal(r.state, 'FAIL');
  assert.match(r.headline, /never completed a backup/);
});

test('an EXPECTED machine with no destination at all is FAIL — it cannot drop out of the check', () => {
  const r = report(reached(probeOut({ destinations: 'No destinations configured.', latest: '', prefs: 'Domain /Library/Preferences/com.apple.TimeMachine does not exist' })));
  assert.equal(r.state, 'FAIL');
  assert.match(r.headline, /no Time Machine destination at all/);
});

test('a machine NOT expected to have one, with none, is a note — not a grade', () => {
  const r = timeMachineReport({
    machine: 'mac-mini',
    probe: reached(probeOut({ destinations: 'No destinations configured.', latest: '', prefs: '' })),
    expected: false,
    now: NOW,
  });
  assert.equal(r.state, 'NOT EXPECTED');
});

test('a machine NOT expected to have one that HAS one is still graded', () => {
  const r = timeMachineReport({ machine: 'mac-mini', probe: reached(probeOut()), expected: false, now: NOW });
  assert.equal(r.state, 'FAIL');
});

test('output cut short (no @@END) is CANNOT TELL — a half-read record is not a reading', () => {
  const r = report(reached(probeOut({ end: false })));
  assert.equal(r.state, 'CANNOT TELL');
  assert.match(r.why, /cut short/);
});

test('a probe that ran and failed with no output is CANNOT TELL', () => {
  const r = report({ ran: true, ok: false, out: '' });
  assert.equal(r.state, 'CANNOT TELL');
  assert.match(r.why, /failed or timed out/);
});

test('a configured destination whose record cannot be read is CANNOT TELL, quoting what macOS said', () => {
  const r = report(reached(probeOut({ prefs: 'Could not export domain: Operation not permitted' })));
  assert.equal(r.state, 'CANNOT TELL');
  assert.match(r.why, /Operation not permitted/);
});

test('tmutil naming a destination the record does not know is CANNOT TELL, not a guess', () => {
  const r = report(reached(probeOut({ prefs: '<?xml version="1.0"?><plist version="1.0"><dict><key>AutoBackup</key><true/></dict></plist>' })));
  assert.equal(r.state, 'CANNOT TELL');
});

// --- the plumbing ------------------------------------------------------------

test('the probe always exits 0, so its output survives a failing sub-command', () => {
  assert.match(PROBE_COMMAND, /; true$/);
  for (const m of ['@@DESTINATIONS', '@@LATEST', '@@PREFS', '@@END']) assert.ok(PROBE_COMMAND.includes(`echo ${m}`), m);
  // Never tmutil latestbackup's exit code — measured 0 on a mount failure.
  assert.ok(PROBE_COMMAND.includes('/usr/bin/defaults export /Library/Preferences/com.apple.TimeMachine -'));
});

test('splitProbe separates the sections and notices the end marker', () => {
  const parts = splitProbe(probeOut());
  assert.equal(parts.complete, true);
  assert.match(parts.destinations, /Blue Passport/);
  assert.match(parts.latest, /Failed to mount/);
  assert.match(parts.prefs, /^<\?xml/);
});

test('parsePlist reads the real export: dates, strings, integers, data and nested arrays', () => {
  const p = parsePlist(prefsXml());
  assert.equal(p.AutoBackup, true);
  assert.equal(p.LastBackupActivity, '2026-09-21-005335');
  const [d] = destinationsFrom(p);
  assert.equal(d.name, 'Blue Passport');
  assert.equal(d.snapshots.length, 2);
  assert.equal(new Date(d.snapshots[1]).toISOString(), '2024-11-15T20:55:02.000Z');
  assert.equal(d.lastError, 'Insufficient battery power remaining (16%)');
  assert.equal(p.Destinations[0].RESULT, 101);
});

test('parsePlist returns null for anything that is not a plist, so it can never read as "empty"', () => {
  assert.equal(parsePlist('Domain does not exist'), null);
  assert.equal(parsePlist(''), null);
});

test('LastBackupActivity is never read as a completed backup', () => {
  // It is refreshed by every ATTEMPT — it said 2026-09-21 on a machine whose
  // last completed backup was 22 months earlier.
  const r = report(reached(probeOut({ prefs: prefsXml({ snapshots: [] }) })));
  assert.notEqual(r.state, 'PASS');
});

test('the MacBook is expected to have Time Machine; the Mini is not', () => {
  assert.ok(TIME_MACHINE_NODES['macbook-pro']);
  assert.equal(TIME_MACHINE_NODES['mac-mini'], undefined);
});
