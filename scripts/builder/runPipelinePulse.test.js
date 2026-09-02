'use strict';

/**
 * The scheduled pulse's runner: every non-zero ending must reach the failure
 * reporter, including the one that decides not to run at all.
 *
 * Round 3's send-back (2026-09-02): the CANNOT-TELL branch — this machine
 * cannot say which node it is, so it cannot know whether it owns the job —
 * printed four loud lines and then `exit 1` on the spot, jumping clean over the
 * `report:failure` block at the bottom. The comment above it claimed it refused
 * "out loud ... rather than skipping quietly", and the code did not have that
 * property: the refusal reached the launchd log and nowhere a person looks.
 * Nothing would surface for up to 25 hours, and then as "stopped firing", which
 * points the next reader at launchd instead of at a one-line file in $HOME.
 *
 * These tests run the real script with a stubbed `npm` on PATH, so what is
 * being checked is what the script DOES, not what its comments say.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'run_pipeline_pulse.sh');

// A stand-in for npm that records every call and returns the exit code the
// test asks for. Deliberately does NOT reach the network, Doppler or ClickUp.
const NPM_STUB = `#!/bin/sh
echo "$*" >> "$NPM_CALLS"
case "$*" in
  *checkout:current*) exit 0 ;;
  *node:owns*)        exit "\${STUB_OWNS:-0}" ;;
  *pulse:publish*)    exit "\${STUB_PUBLISH:-0}" ;;
  *report:failure*)   exit "\${STUB_REPORT:-0}" ;;
esac
exit 0
`;

function run({ owns = 0, publish = 0, report = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-runner-'));
  const bin = path.join(dir, 'npm');
  const calls = path.join(dir, 'calls.txt');
  fs.writeFileSync(bin, NPM_STUB, { mode: 0o755 });
  fs.writeFileSync(calls, '');
  try {
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        NPM_CALLS: calls,
        STUB_OWNS: String(owns),
        STUB_PUBLISH: String(publish),
        STUB_REPORT: String(report),
      },
    });
    return {
      status: r.status,
      out: `${r.stdout || ''}${r.stderr || ''}`,
      calls: fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const reported = (calls) => calls.filter((c) => c.includes('report:failure'));

test('a clean pass runs the publisher, exits 0, and reports nothing', () => {
  const r = run({ owns: 0, publish: 0 });
  assert.equal(r.status, 0);
  assert.ok(r.calls.some((c) => c.includes('pulse:publish')), 'it actually ran the publisher');
  assert.deepEqual(reported(r.calls), [], 'a healthy pass must not raise a failure alert');
});

test('a publisher that exits non-zero is reported, with its own status', () => {
  const r = run({ owns: 0, publish: 1 });
  assert.equal(r.status, 1);
  assert.equal(reported(r.calls).length, 1);
  assert.match(reported(r.calls)[0], /--status 1/);
});

test('BREAK-TEST: CANNOT TELL which node this is reaches the failure reporter, not just the log', () => {
  // Restore `exit 1` inside the ownership branch and this fails: the script
  // still prints its four loud lines and still exits 1, but report:failure is
  // never called and the refusal exists only in the launchd log.
  const r = run({ owns: 1 });
  assert.equal(r.status, 1, 'it still refuses');
  assert.match(r.out, /could not say which node it is/, 'and still says why');
  assert.ok(!r.calls.some((c) => c.includes('pulse:publish')),
    'and still does not run the publisher on a guess');
  assert.equal(reported(r.calls).length, 1,
    'THIS is the fix: the refusal now leaves the launchd log and lands where a person looks');
  assert.match(reported(r.calls)[0], /--job pipeline-pulse/);
  assert.match(reported(r.calls)[0], /--status 1/);
});

test('another machine owning the job is exit 0 and reports nothing — that is normal, not a failure', () => {
  const r = run({ owns: 3 });
  assert.equal(r.status, 0);
  assert.match(r.out, /another machine owns pipeline-pulse/);
  assert.ok(!r.calls.some((c) => c.includes('pulse:publish')));
  assert.deepEqual(reported(r.calls), [],
    'a bus post every hour saying the Mini is not the Mini would be pure noise');
});

test('a failing failure-reporter never changes the exit code the job reports', () => {
  // `|| true` on the reporter, like its neighbours: the alert failing must not
  // rewrite the outcome launchd records for the job itself.
  const r = run({ owns: 0, publish: 1, report: 9 });
  assert.equal(r.status, 1, 'the job still ends with the publisher status, not the reporter status');
});

test('there is exactly ONE exit path for a non-zero outcome', () => {
  // The structural half of the fix, pinned so a future branch cannot quietly
  // grow its own `exit 1` above the reporter again. `exit 0` for another
  // machine's job is fine — it is not a failure and has nothing to report.
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const earlyExits = code.match(/^\s*exit\s+[1-9]/gm) || [];
  assert.deepEqual(earlyExits, [],
    'a non-zero exit before the report:failure block is the defect this file exists to prevent');
});
