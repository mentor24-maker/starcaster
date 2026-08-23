'use strict';

/**
 * Two layers, because the thing being tested is a two-machine behaviour and
 * whichever machine you run this on, there is only one of it:
 *
 *   1. createExecutor with an injected `run` — no socket is ever opened.
 *   2. check_ecosystem_drift.cjs end to end, against a fixture inventory that
 *      declares a second machine, with a FAKE `ssh` on PATH standing in for it.
 *      That is the ticket's "break it on purpose in both directions" — asleep
 *      must stay COULD NOT CHECK, broken must become DRIFT — done in a way
 *      that does not need Dane to put a Mac to sleep.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createExecutor, SSH_CONNECTION_FAILED } = require('./remoteProbe.js');

// ── the executor, with `run` injected ──────────────────────────────────────

// Records every call so we can assert how many connections were made.
function fakeRun(handler) {
  const calls = [];
  const run = (cmd, args, timeoutMs) => {
    calls.push({ cmd, args, timeoutMs, command: args[args.length - 1] });
    return handler(cmd, args);
  };
  return { run, calls };
}
const reachable = () => ({ ok: true, out: '' });

test('a machine is asked over ssh exactly once, however many probes want it', () => {
  const { run, calls } = fakeRun(reachable);
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  exec.reach('macbook-pro');
  exec.reach('macbook-pro');
  exec.shell('macbook-pro', 'command -v colima');
  exec.shell('macbook-pro', 'launchctl list');
  const probes = calls.filter((c) => c.command === 'true');
  assert.equal(probes.length, 1, 'reachability should be established once and reused');
});

test('the machine we are standing on is reachable without ssh at all', () => {
  const { run, calls } = fakeRun(reachable);
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  assert.deepEqual(exec.reach('mac-mini'), { reachable: true });
  assert.equal(calls.length, 0);
});

test('a command for this machine runs locally, not over ssh', () => {
  const { run, calls } = fakeRun(() => ({ ok: true, out: '/bin/colima\n' }));
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  const r = exec.shell('mac-mini', 'command -v colima');
  assert.equal(r.ran, true);
  assert.equal(r.ok, true);
  assert.equal(calls[0].cmd, '/bin/sh');
});

test('an unreachable host is COULD NOT CHECK, with the wording it has always had', () => {
  const { run } = fakeRun(() => ({ ok: false, code: SSH_CONNECTION_FAILED }));
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  const r = exec.reach('macbook-pro');
  assert.equal(r.reachable, false);
  assert.match(r.why, /asleep, off this network, or key not set up; not treated as drift/);
});

test('a probe on an unreachable host does not run and says why', () => {
  const { run } = fakeRun(() => ({ ok: false, code: SSH_CONNECTION_FAILED }));
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  const r = exec.shell('macbook-pro', 'command -v colima');
  assert.equal(r.ran, false);
  assert.match(r.why, /not treated as drift/);
});

test('a remote command that ANSWERS and fails is a verdict, not an unreachable host', () => {
  // This is the distinction the whole ticket turns on: exit 1 came back FROM
  // the machine, so the connection worked and the answer is "no".
  const { run } = fakeRun((cmd, args) =>
    args[args.length - 1] === 'true' ? { ok: true, out: '' } : { ok: false, code: 1 });
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  const r = exec.shell('macbook-pro', 'command -v colima');
  assert.equal(r.ran, true, 'the probe ran — this must be reportable as drift');
  assert.equal(r.ok, false);
});

test('a connection that drops mid-probe is COULD NOT CHECK, never drift', () => {
  const { run } = fakeRun((cmd, args) =>
    args[args.length - 1] === 'true' ? { ok: true, out: '' } : { ok: false, code: SSH_CONNECTION_FAILED });
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  const r = exec.shell('macbook-pro', 'launchctl list');
  assert.equal(r.ran, false);
  assert.match(r.why, /not treated as drift/);
});

test('a probe that times out is COULD NOT CHECK, never drift', () => {
  const { run } = fakeRun((cmd, args) =>
    args[args.length - 1] === 'true' ? { ok: true, out: '' } : { ok: false, timedOut: true, code: null });
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  assert.equal(exec.shell('macbook-pro', 'launchctl list').ran, false);
});

// ── the whole check, against a fixture inventory and a fake ssh ────────────

const CHECK = path.join(__dirname, '..', 'check_ecosystem_drift.cjs');

// A two-machine world: this one (matched by the real login user, exactly as
// the check matches it) and a remote one that declares an ssh route.
function fixtureInventory() {
  return {
    meta: { title: 'fixture', updated: '2026-08-23' },
    objects: [
      {
        id: 'here-box', name: 'Here', kind: 'machine', layer: 'workstations',
        summary: 'the machine running the test',
        detail: { user: os.userInfo().username }, probe: 'hostname',
      },
      {
        id: 'remote-box', name: 'Remote', kind: 'machine', layer: 'workstations',
        summary: 'the other machine', detail: { user: 'somebody-else' }, probe: 'ssh',
      },
      {
        id: 'colima', name: 'Colima', kind: 'runtime', layer: 'local-dev',
        summary: 'container runtime on the remote box', host: 'remote-box',
        detail: { autostart: 'com.starcaster.colima LaunchAgent' }, probe: 'command',
      },
      {
        id: 'docker', name: 'Docker', kind: 'runtime', layer: 'local-dev',
        summary: 'unpinned — expected on every machine', probe: 'docker-info',
      },
      {
        id: 'job-colima', name: 'colima autostart', kind: 'job', layer: 'local-dev',
        summary: 'brings the runtime up', host: 'remote-box',
        detail: { label: 'com.starcaster.colima' }, probe: 'launchctl',
      },
      // The skills sweep reads THIS repo, not the fixture, so the real loop
      // skills have to be declared or every fixture run reports them as drift.
      ...['loop-spec', 'loop-build', 'loop-review'].map((id) => ({
        id, name: id, kind: 'agent', layer: 'coordination',
        summary: 'loop skill', probe: 'skill-file',
      })),
    ],
    relationships: [],
  };
}

// A fake `ssh` (plus local `docker`/`launchctl`) on PATH, driven by env vars.
// Everything the check shells out to is stubbed, so the run is hermetic.
function fakeBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-bin-'));
  const write = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  };

  write('ssh', `#!/bin/sh
while [ "$1" = "-o" ]; do shift 2; done
target="$1"; shift
cmd="$*"
if [ "$FAKE_SSH" = "unreachable" ]; then
  echo "ssh: connect to host $target port 22: Host is down" >&2
  exit 255
fi
if [ "$cmd" = "true" ]; then exit 0; fi
if [ "$FAKE_SSH" = "drops" ]; then
  echo "client_loop: send disconnect" >&2
  exit 255
fi
case "$cmd" in
  "command -v colima")
    [ "$FAKE_COLIMA" = "missing" ] && exit 1
    echo "/opt/homebrew/bin/colima"; exit 0 ;;
  "command -v docker")
    echo "/usr/local/bin/docker"; exit 0 ;;
  docker\\ ps*)
    if [ "$FAKE_DOCKER" = "down" ]; then
      echo "Cannot connect to the Docker daemon." >&2; exit 1
    fi
    exit 0 ;;
  "launchctl list")
    printf 'PID\\tStatus\\tLabel\\n'
    [ "$FAKE_JOB" = "missing" ] || printf -- '-\\t0\\tcom.starcaster.colima\\n'
    [ "$FAKE_STRAY" = "yes" ] && printf -- '-\\t0\\tcom.starcaster.mystery\\n'
    exit 0 ;;
esac
exit 127
`);

  // Local stubs, so the fixture run never touches the real machine's state.
  write('docker', `#!/bin/sh\nexit 0\n`);
  write('launchctl', `#!/bin/sh\nprintf 'PID\\tStatus\\tLabel\\n'\nexit 0\n`);
  return dir;
}

// Runs the real check against the fixture and returns its report.
function runCheck(env = {}) {
  const bin = fakeBin();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-inv-'));
  const inv = path.join(dir, 'inventory.yaml');
  fs.writeFileSync(inv, JSON.stringify(fixtureInventory())); // YAML is a superset of JSON
  try {
    let status = 0;
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [CHECK, '--inventory', inv], {
        encoding: 'utf8',
        env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
      });
    } catch (err) {
      status = err.status;
      stdout = err.stdout ?? '';
    }
    const section = (name) => {
      const m = stdout.match(new RegExp(`${name}[^\\n]*\\n((?:\\s{4}[^\\n]*\\n)*)`));
      return m ? m[1] : '';
    };
    return { status, stdout, drift: section('DRIFT'), cannot: section('COULD NOT CHECK'), ok: section('OK \\(') };
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('AC3: a healthy remote machine is probed there, not written off for being elsewhere', () => {
  const r = runCheck({ FAKE_SSH: 'ok' });
  assert.equal(r.status, 0, r.stdout);
  // The two lines the ticket opens with must be gone from COULD NOT CHECK.
  assert.doesNotMatch(r.cannot, /colima/, 'colima should no longer be skipped for living elsewhere');
  assert.doesNotMatch(r.cannot, /job-colima/, 'job-colima should no longer be skipped for living elsewhere');
  assert.match(r.ok, /colima.*installed on remote-box/);
  assert.match(r.ok, /job-colima.*loaded in launchctl on remote-box/);
});

test('AC2: an unreachable remote machine is COULD NOT CHECK and the run still succeeds', () => {
  const r = runCheck({ FAKE_SSH: 'unreachable' });
  assert.equal(r.status, 0, 'a sleeping machine must never fail the run');
  assert.match(r.cannot, /asleep, off this network, or key not set up; not treated as drift/);
  assert.match(r.cannot, /colima/);
  assert.doesNotMatch(r.drift, /colima/, 'unreachable is not drift');
});

test('AC1: a runtime that is installed but will not start on the remote box is DRIFT', () => {
  // The 2026-08-21 failure: colima present, docker daemon dead, and the
  // inventory says something is supposed to bring it up unattended.
  const r = runCheck({ FAKE_SSH: 'ok', FAKE_DOCKER: 'down' });
  assert.equal(r.status, 1, 'this must fail the run');
  assert.match(r.drift, /docker on remote-box/);
  assert.match(r.drift, /installed, but will not start/);
});

test('a missing command on the remote box is DRIFT, naming where it is missing', () => {
  const r = runCheck({ FAKE_SSH: 'ok', FAKE_COLIMA: 'missing' });
  assert.equal(r.status, 1);
  assert.match(r.drift, /colima.*not installed there/);
});

test('a scheduled job absent from the remote machine is DRIFT', () => {
  const r = runCheck({ FAKE_SSH: 'ok', FAKE_JOB: 'missing' });
  assert.equal(r.status, 1);
  assert.match(r.drift, /launchctl there has no such job/);
});

test('the reverse sweep sees a job running on the remote machine the inventory forgot', () => {
  const r = runCheck({ FAKE_SSH: 'ok', FAKE_STRAY: 'yes' });
  assert.equal(r.status, 1);
  assert.match(r.drift, /com\.starcaster\.mystery/);
  assert.match(r.drift, /loaded in launchctl on remote-box/);
});

test('a connection that answers then drops is COULD NOT CHECK, not drift', () => {
  const r = runCheck({ FAKE_SSH: 'drops' });
  assert.equal(r.status, 0, 'a flaky link must not be reported as a disagreement');
  assert.match(r.cannot, /not treated as drift/);
});
