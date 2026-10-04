'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const watch = require('../../lib/workerWatch.js');
const heartbeat = require('../../lib/nodeHeartbeat.js');

/**
 * Ticket 86bccrz1v — the Mini's Tailscale tunnel was down for 24 days and
 * nothing noticed, because nothing asked whether production could reach the
 * download helper. These pin the three verdicts, the once-per-6h discipline,
 * the clear-on-recovery, and that the check does not hang off ownership.
 */

const URL_ = 'https://mac-mini.example.ts.net';
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-04T12:00:00Z');

test('judge: three verdicts, never two', async (t) => {
  await t.test('a 200 from /health is OK', () => {
    const j = watch.judge({ url: URL_, probe: { status: 200, body: '{"ok":true}' } });
    assert.equal(j.verdict, 'OK');
    assert.equal(j.target, `${URL_}/health`);
  });

  await t.test('no answer is UNREACHABLE and carries the reason', () => {
    const j = watch.judge({ url: URL_, probe: { error: 'fetch failed: ENOTFOUND' } });
    assert.equal(j.verdict, 'UNREACHABLE');
    assert.match(j.reason, /ENOTFOUND/);
  });

  await t.test('an error status is UNREACHABLE too — production cannot use it', () => {
    assert.equal(watch.judge({ url: URL_, probe: { status: 502, body: '' } }).verdict, 'UNREACHABLE');
    assert.equal(watch.judge({ url: URL_, probe: { status: 503, body: '{"ok":false}' } }).verdict, 'UNREACHABLE');
  });

  await t.test('no URL configured is CANNOT TELL, never OK', () => {
    const j = watch.judge({ url: '', probe: null });
    assert.equal(j.verdict, 'CANNOT TELL');
    assert.notEqual(watch.EXIT[j.verdict], 0, 'a reading that could not be taken must not exit as a pass');
    assert.equal(watch.EXIT[j.verdict], 2);
  });

  await t.test('exit codes: 0 OK, 1 UNREACHABLE, 2 CANNOT TELL', () => {
    assert.deepEqual({ ...watch.EXIT }, { OK: 0, UNREACHABLE: 1, 'CANNOT TELL': 2 });
  });
});

test('workerUrl reads the variable production reads, and trims the slash', () => {
  assert.equal(watch.workerUrl({ YOUTUBE_MEDIA_WORKER_URL: `${URL_}/` }), URL_);
  assert.equal(watch.workerUrl({}), '');
});

test('plan: post once per 6h while failing, clear once on recovery', async (t) => {
  await t.test('first failure posts', () => {
    assert.equal(watch.plan({ verdict: 'UNREACHABLE', alarmAt: '', now: NOW }).action, 'post');
  });
  await t.test('a failure inside 6h of the last post stays quiet', () => {
    const alarmAt = new Date(NOW - 2 * HOUR).toISOString();
    assert.equal(watch.plan({ verdict: 'UNREACHABLE', alarmAt, anyOpen: true, now: NOW }).action, 'none');
  });
  await t.test('a failure 6h on posts again', () => {
    const alarmAt = new Date(NOW - 6 * HOUR).toISOString();
    assert.equal(watch.plan({ verdict: 'UNREACHABLE', alarmAt, anyOpen: true, now: NOW }).action, 'post');
  });
  await t.test('CANNOT TELL posts too — it is an alarm, not a pass', () => {
    assert.equal(watch.plan({ verdict: 'CANNOT TELL', alarmAt: '', now: NOW }).action, 'post');
  });
  await t.test('OK with an alarm out clears it, once', () => {
    assert.equal(watch.plan({ verdict: 'OK', anyOpen: true, now: NOW }).action, 'clear');
  });
  await t.test('OK with nothing raised says nothing', () => {
    assert.equal(watch.plan({ verdict: 'OK', anyOpen: false, now: NOW }).action, 'none');
  });
});

test('the bus messages name the machine, the address and what failed', () => {
  const down = watch.judge({ url: URL_, probe: { error: 'fetch failed' } });
  const alarm = watch.renderAlarm({ judged: down, node: 'macbook-pro', at: '2026-10-04T12:00:00Z' });
  assert.match(alarm, /UNREACHABLE/);
  assert.match(alarm, /Tailscale/);
  assert.match(alarm, /mac-mini\.example\.ts\.net\/health/);
  assert.match(alarm, /macbook-pro/);
  const blind = watch.renderAlarm({ judged: watch.judge({ url: '', probe: null }), node: 'mac-mini', at: 'x' });
  assert.match(blind, /CANNOT TELL/);
  assert.match(blind, /not a pass/);
  const clear = watch.renderClear({ judged: watch.judge({ url: URL_, probe: { status: 200 } }), node: 'mac-mini', at: 'x' });
  assert.match(clear, /answers again/);
});

// ── Where it runs ──────────────────────────────────────────────────────────

test('the watchdog does not depend on owning youtube-media', async (t) => {
  const ROOT = path.resolve(__dirname, '../..');
  const runner = fs.readFileSync(path.join(ROOT, 'scripts/run_bus_relay.sh'), 'utf8');

  await t.test('neither half reads machine ownership', () => {
    for (const file of ['lib/workerWatch.js', 'scripts/worker_watch.mjs']) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
      assert.doesNotMatch(src, /\bowns\s*\(|ownerOf|node:owns|ROLES\[/, `${file} must not gate on who owns the helper`);
    }
  });

  await t.test('the relay runs it on every wake, before its own ownership check', () => {
    const line = runner.indexOf('npm run --silent worker-watch -- --check || true');
    const relay = runner.indexOf('npm run --silent clickup -- bus-relay');
    assert.ok(line > 0, 'run_bus_relay.sh must call worker-watch --check, guarded by || true');
    assert.ok(line < relay, 'it must run before the relay asks whether this machine owns it');
  });

  await t.test('it probes the PUBLIC address, never localhost', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/worker_watch.mjs'), 'utf8');
    assert.doesNotMatch(src.replace(/^\s*(\/\/|\*).*$/gm, ''), /localhost|127\.0\.0\.1/);
  });
});

test('a dry-run against a dead address says UNREACHABLE and posts nothing', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const env = { ...process.env, HOME: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ww-')) };
  const r = spawnSync(process.execPath, ['scripts/worker_watch.mjs', '--check', '--dry-run', '--url', 'http://127.0.0.1:1'], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /UNREACHABLE/);
  assert.match(r.stdout, /would post to the bus/);
  assert.equal(fs.existsSync(path.join(heartbeat.heartbeatDir(env.HOME), 'worker-watch-unreachable.stamp')), false,
    'a dry run must not stamp');
});

test('the roll call no longer says nothing asks whether youtube-media is up', () => {
  const why = heartbeat.NOT_REPORTING_WHY['youtube-media'];
  assert.match(why, /worker-watch/);
  assert.doesNotMatch(why, /gets an emitter when something is scheduled/);
});
