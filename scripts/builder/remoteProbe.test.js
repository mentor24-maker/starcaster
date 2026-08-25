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
const {
  createExecutor,
  loginShellCommand,
  isTimeout,
  SSH_CONNECTION_FAILED,
} = require('./remoteProbe.js');

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

test('a remote command is wrapped in a login shell, quoted as one argument', () => {
  // Criterion 4. ssh has no argv: it joins everything after the destination
  // with spaces and hands the result to the remote shell, so the inner command
  // has to arrive already quoted or it would be word-split.
  assert.equal(loginShellCommand('command -v colima'), "bash -lc 'command -v colima'");
  assert.equal(
    loginShellCommand('docker ps -a --format "{{.Names}}"'),
    `bash -lc 'docker ps -a --format "{{.Names}}"'`
  );
  // A single quote in the command must not end the quoting early.
  assert.equal(loginShellCommand("echo it's here"), `bash -lc 'echo it'\\''s here'`);
});

test('shell() sends the login-shell form over ssh, never the bare command', () => {
  const { run, calls } = fakeRun((cmd, args) =>
    args[args.length - 1] === 'true' ? { ok: true, out: '' } : { ok: true, out: '/opt/homebrew/bin/colima\n' });
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  exec.shell('macbook-pro', 'command -v colima');
  const probe = calls.find((c) => c.command !== 'true');
  assert.equal(probe.cmd, 'ssh');
  assert.equal(probe.command, "bash -lc 'command -v colima'");
});

test('a command for THIS machine is not wrapped — local PATH is already right', () => {
  const { run, calls } = fakeRun(() => ({ ok: true, out: '/opt/homebrew/bin/colima\n' }));
  const exec = createExecutor({ run, hereId: 'mac-mini' });
  exec.shell('mac-mini', 'command -v colima');
  assert.equal(calls[0].cmd, '/bin/sh');
  assert.equal(calls[0].command, 'command -v colima');
});

test('isTimeout recognises a REAL execFileSync timeout, which does not set killed', () => {
  // The guard this feeds used to say `err.killed === true`, which Node never
  // sets here — so it was permanently false and a stalled machine read as
  // drift. Asserted against a genuine timeout rather than a hand-made object,
  // because a hand-made object is exactly what hid this the first time.
  let err;
  try {
    execFileSync('/bin/sh', ['-c', 'sleep 5'], { timeout: 300 });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'the command should have timed out');
  assert.notEqual(err.killed, true, 'if this ever becomes true, Node changed — the OR still covers it');
  assert.equal(isTimeout(err), true);

  // And an ordinary non-zero exit is NOT a timeout — that distinction is the
  // whole difference between COULD NOT CHECK and DRIFT.
  let fail;
  try {
    execFileSync('/bin/sh', ['-c', 'exit 1']);
  } catch (e) {
    fail = e;
  }
  assert.equal(isTimeout(fail), false);
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
//
// The fake ssh models sshd's ENVIRONMENT as well as its exit codes, which is
// what makes criterion 4 testable. A real `ssh host 'cmd'` runs a NON-login
// shell whose PATH is /usr/bin:/bin:/usr/sbin:/sbin — Homebrew is not on it.
// Only a login shell (`bash -lc`) runs the profile that puts it back. So this
// stub resolves colima and docker ONLY when it was invoked through one, and
// answers "command not found" otherwise, exactly as the real Mini would.
// Measured there on 2026-08-24: colima is /opt/homebrew/bin/colima, docker is
// /usr/local/bin/docker, and /bin/launchctl is on the bare PATH — which is why
// the launchctl probes kept passing and hid the bug in the other two.
//
// Written with no backticks and no ${...}: this is a shell script living
// inside a JS template literal, and both of those would be eaten by JS first.
const FAKE_SSH_SCRIPT = [
  '#!/bin/sh',
  'while [ "$1" = "-o" ]; do shift 2; done',
  'target="$1"; shift',
  'cmd="$*"',
  'if [ "$FAKE_SSH" = "unreachable" ]; then',
  '  echo "ssh: connect to host $target port 22: Host is down" >&2',
  '  exit 255',
  'fi',
  'if [ "$cmd" = "true" ]; then exit 0; fi',
  'if [ "$FAKE_SSH" = "drops" ]; then',
  '  echo "client_loop: send disconnect" >&2',
  '  exit 255',
  'fi',
  '',
  '# Was this run through a login shell? If so, unwrap it and allow Homebrew.',
  'login=no',
  'case "$cmd" in',
  '  "bash -lc "*)',
  '    login=yes',
  '    cmd=$(printf %s "$cmd" | sed "s/^bash -lc .//; s/.$//") ;;',
  'esac',
  '',
  '# Anything Homebrew installed is invisible to a non-login shell.',
  'case "$cmd" in',
  '  "command -v colima"|"command -v docker"|"docker ps"*)',
  '    if [ "$login" != "yes" ]; then',
  '      echo "sh: $cmd: command not found" >&2',
  '      exit 127',
  '    fi ;;',
  'esac',
  '',
  '# The link dies AFTER the daemon probe but BEFORE we can ask whether docker',
  '# is installed. ssh reports its own failure as 255, not the command verdict.',
  'if [ "$FAKE_DROP_AFTER_DOCKER" = "yes" ] && [ "$cmd" = "command -v docker" ]; then',
  '  echo "client_loop: send disconnect" >&2',
  '  exit 255',
  'fi',
  '',
  'case "$cmd" in',
  '  "command -v colima")',
  '    [ "$FAKE_COLIMA" = "missing" ] && exit 1',
  '    echo "/opt/homebrew/bin/colima"; exit 0 ;;',
  '  "command -v docker")',
  '    echo "/usr/local/bin/docker"; exit 0 ;;',
  '  "docker ps"*)',
  '    if [ "$FAKE_DOCKER" = "down" ]; then',
  '      echo "Cannot connect to the Docker daemon." >&2; exit 1',
  '    fi',
  '    exit 0 ;;',
  '  "launchctl list")',
  '    printf "PID\\tStatus\\tLabel\\n"',
  '    [ "$FAKE_JOB" = "missing" ] || printf -- "-\\t0\\tcom.starcaster.colima\\n"',
  '    [ "$FAKE_STRAY" = "yes" ] && printf -- "-\\t0\\tcom.starcaster.mystery\\n"',
  '    exit 0 ;;',
  'esac',
  'exit 127',
  '',
].join('\n');

function fakeBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-bin-'));
  const write = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  };

  write('ssh', FAKE_SSH_SCRIPT);

  // Local stubs, so the fixture run never touches the real machine's state.
  write('docker', '#!/bin/sh\nexit 0\n');
  write('launchctl', '#!/bin/sh\nprintf "PID\\tStatus\\tLabel\\n"\nexit 0\n');
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

test("AC4: a Homebrew-installed tool on the remote box reports OK, not missing", () => {
  // The false-positive test, and the one that fails if the login-shell wrapper
  // is removed. colima and docker live on PATHs that only a login shell has,
  // so a bare `ssh host 'cmd'` reports BOTH of them missing and calls a
  // perfectly healthy machine drift — simultaneously, about every Homebrew
  // tool it knows. Break it on purpose (drop `bash -lc` from
  // remoteProbe.shell) and this test goes red; that was checked, not assumed.
  const r = runCheck({ FAKE_SSH: 'ok' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.ok, /colima.*installed on remote-box.*\/opt\/homebrew\/bin\/colima/);
  assert.match(r.ok, /docker on remote-box.*daemon answering/);
  assert.doesNotMatch(r.drift, /colima/, 'a healthy Homebrew tool must never read as drift');
  assert.doesNotMatch(r.drift, /docker/, 'a healthy docker must never read as drift');
});

test("AC4: launchctl alone would have hidden this — it is on the bare PATH", () => {
  // Recorded so nobody re-derives it: the launchctl probes pass with or
  // without the login shell, because /bin/launchctl needs no Homebrew. That
  // is why the feature looked like it worked while two probes were broken.
  const r = runCheck({ FAKE_SSH: 'ok' });
  assert.match(r.ok, /job-colima.*loaded in launchctl on remote-box/);
});

test("a link that drops between the docker probes is COULD NOT CHECK, not an absent binary", () => {
  // The daemon answers "no", then the connection dies before we can ask
  // whether docker is even installed. Reporting "no docker binary is
  // installed there" would be drift invented about a sleeping machine.
  const r = runCheck({ FAKE_SSH: 'ok', FAKE_DOCKER: 'down', FAKE_DROP_AFTER_DOCKER: 'yes' });
  assert.equal(r.status, 0, `a dropped link must not fail the run:\n${r.stdout}`);
  assert.match(r.cannot, /docker on remote-box/);
  assert.match(r.cannot, /cannot tell whether it is absent or merely down/);
  assert.doesNotMatch(r.drift, /no docker binary is installed/);
});
