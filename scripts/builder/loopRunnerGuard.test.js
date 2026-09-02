'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guard = require('./loopRunnerGuard.js');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
/** Executable source only: comments explain the rules and must not satisfy them. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
/** Shell source without comment lines, same reason. */
function shellWithoutComments(text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

// 2026-09-02, 02:08 in America/Denver (UTC-6 in September) — eight minutes
// into the real incident this module was written about.
const AT_0208 = Date.parse('2026-09-02T08:08:00.000Z');
const limitLine = (t) => `You've hit your session limit · resets ${t}`;

// ---------------------------------------------------------------------------
// The parser (task 86bbtuje2). Every message shape below was seen in a real
// log on the Mini; none is invented.
// ---------------------------------------------------------------------------

test('the 2:05am incident, replayed: the runner sleeps to the stated reset', () => {
  const d = guard.limitDelay({ text: limitLine('2:50am (America/Denver)'), nowMs: AT_0208 });
  // 02:08 -> 02:50 is 42 minutes, plus the margin.
  assert.equal(d.seconds, 42 * 60 + guard.MARGIN_SECONDS);
  assert.match(d.reason, /2:50am/);
});

test('hour-only and 12-o-clock forms parse — all seen live', () => {
  // "resets 10pm" at 21:30 Denver -> 30 min + margin.
  const at2130 = Date.parse('2026-09-03T03:30:00.000Z');
  assert.equal(guard.limitDelay({ text: limitLine('10pm (America/Denver)'), nowMs: at2130 }).seconds,
    30 * 60 + guard.MARGIN_SECONDS);
  // "resets 12am" (midnight) at 23:00 Denver -> 60 min + margin.
  const at2300 = Date.parse('2026-09-03T05:00:00.000Z');
  assert.equal(guard.limitDelay({ text: limitLine('12am (America/Denver)'), nowMs: at2300 }).seconds,
    60 * 60 + guard.MARGIN_SECONDS);
  // "resets 12:50pm" at 12:08 Denver -> 42 min + margin.
  const at1208 = Date.parse('2026-09-02T18:08:00.000Z');
  assert.equal(guard.limitDelay({ text: limitLine('12:50pm (America/Denver)'), nowMs: at1208 }).seconds,
    42 * 60 + guard.MARGIN_SECONDS);
});

test('no limit line means null — the two absences must not blur', () => {
  // null is "pace normally"; a backoff object is "limited but unreadable".
  // Collapsing them would either slow every healthy pass or blind the guard.
  assert.equal(guard.limitDelay({ text: 'a perfectly ordinary pass report', nowMs: AT_0208 }), null);
  assert.equal(guard.limitDelay({ text: '', nowMs: AT_0208 }), null);
});

test('a limit whose time cannot be read backs off rather than retrying blind', () => {
  const d = guard.limitDelay({ text: "You've hit your session limit · resets soonish", nowMs: AT_0208 });
  assert.equal(d.seconds, guard.DEFAULT_BACKOFF_SECONDS);
  assert.match(d.reason, /could not be read/);
});

test('an absurd computed sleep falls to the backoff, never to silence-for-a-day', () => {
  // A reset that reads as ~23h away is almost always a stale or mis-read
  // message, and obeying it would park a loop for most of a day on a guess.
  const at1400 = Date.parse('2026-09-02T20:00:00.000Z'); // 14:00 Denver
  const d = guard.limitDelay({ text: limitLine('1pm (America/Denver)'), nowMs: at1400 });
  assert.equal(d.seconds, guard.DEFAULT_BACKOFF_SECONDS);
  assert.match(d.reason, /sanity cap/);
});

test('a zone this machine cannot resolve degrades to the default zone, not a crash', () => {
  const d = guard.limitDelay({ text: limitLine('2:50am (Mars/Olympus)'), nowMs: AT_0208 });
  // Computed as Denver — the only zone ever observed — and still a real sleep.
  assert.equal(d.seconds, 42 * 60 + guard.MARGIN_SECONDS);
});

test('a missing zone defaults instead of failing — wording drift must degrade', () => {
  const d = guard.limitDelay({ text: limitLine('2:50am'), nowMs: AT_0208 });
  assert.equal(d.seconds, 42 * 60 + guard.MARGIN_SECONDS);
});

// ---------------------------------------------------------------------------
// Scoping: a limit line can only belong to the pass that just ran.
// ---------------------------------------------------------------------------

test('a previous pass\'s limit line is out of scope for this pass', () => {
  // The trap: 2:38am's "resets 2:50am" is still in the log tail when the
  // 3:00am pass succeeds. Unscoped, that reads as a limit whose reset is now
  // ~24h away -> the sanity cap -> a needless half-hour backoff after a
  // HEALTHY pass, forever, every pass, since the line never leaves the tail.
  const text = [
    '===== 2026-09-02 02:38:43 START /loop-build =====',
    limitLine('2:50am (America/Denver)'),
    '===== 2026-09-02 02:38:47 END /loop-build =====',
    '===== 2026-09-02 03:00:00 START /loop-build =====',
    'a healthy pass report',
  ].join('\n');
  const scoped = guard.scopeToLastPass(text);
  assert.equal(guard.limitDelay({ text: scoped, nowMs: Date.parse('2026-09-02T09:05:00.000Z') }), null);
  // And unscoped it WOULD have misfired — proving the scope is load-bearing.
  assert.notEqual(guard.limitDelay({ text, nowMs: Date.parse('2026-09-02T09:05:00.000Z') }), null);
});

test('a log with no pass marker is scanned whole', () => {
  assert.equal(guard.scopeToLastPass('no markers here'), 'no markers here');
});

// ---------------------------------------------------------------------------
// The runner and its installer — source-shape, because the thing under test
// is a bash file whose behaviour IS its text.
// ---------------------------------------------------------------------------

test('a pass runs pull -> claude -> beat -> sleep decision, in that order', () => {
  const sh = shellWithoutComments(read('scripts/loop_runner.sh'));
  const pull = sh.indexOf('checkout:current');
  const pass = sh.indexOf('"$CLAUDE_BIN" -p');
  const beat = sh.indexOf('heartbeat -- --beat --role');
  const limit = sh.indexOf('loop_runner_delay.mjs');
  const pace = sh.indexOf('next-interval');
  assert.ok(pull > 0 && pass > pull, 'the timid pull comes before the pass, or a merged skill edit lags a cycle');
  assert.ok(beat > pass, 'the beat records that a pass FIRED — it follows the pass');
  assert.ok(limit > beat, 'the beat lands even on a limited pass — liveness is not quality');
  assert.ok(pace > limit, 'the usage limit outranks the pacing curve');
});

test('the lock records its pid and a stale lock is cleared, not obeyed forever', () => {
  const sh = shellWithoutComments(read('scripts/loop_runner.sh'));
  assert.match(sh, /echo "\$\$" > "\$LOCK\/pid"/, 'the lock names its holder');
  assert.match(sh, /kill -0 "\$OLD_PID"/, 'liveness of the holder is CHECKED, not assumed');
  assert.match(sh, /STALE lock/, 'and a dead holder is announced before the takeover');
  // Without this, a reboot leaves the lock of the life that died, RunAtLoad
  // finds it, and the loops never start again — silently.
});

test('the runner still refuses the honest case: a second LIVE runner', () => {
  const sh = shellWithoutComments(read('scripts/loop_runner.sh'));
  assert.match(sh, /Refusing to start a second/, 'the 2026-08-22 double-review incident stays closed');
});

test('the permission model is unchanged: allowedTools, never skip-permissions', () => {
  const sh = read('scripts/loop_runner.sh');
  assert.match(sh, /--allowedTools/);
  // shellWithoutComments, not the JS stripper: the flag's only appearance is
  // in a `#` comment explaining why it is NOT used — exactly the appearance
  // this assertion must ignore. (Found by this test failing on the unbroken
  // file: an assertion that cannot pass is as dead as one that cannot fail.)
  assert.doesNotMatch(shellWithoutComments(sh), /dangerously-skip-permissions/);
});

test('the END line no longer presents the exit code as a verdict', () => {
  const sh = shellWithoutComments(read('scripts/loop_runner.sh'));
  assert.match(sh, /END \/\$SKILL \(exit \$CODE — not a verdict/,
    'claude -p exits 0 whenever it produced output; the pass that abandoned 86bbjt1b4 exited 0');
});

test('neither the runner nor the installer will run from a worktree', () => {
  for (const f of ['scripts/loop_runner.sh', 'scripts/install_loop_runner.sh']) {
    assert.match(shellWithoutComments(read(f)), /gitdir:.*worktrees/,
      `${f} must refuse a folder that is deleted when its work ships`);
  }
});

test('the installer keeps the runner alive across death and reboot', () => {
  const sh = read('scripts/install_loop_runner.sh');
  assert.match(sh, /<key>KeepAlive<\/key>/);
  assert.match(sh, /<key>RunAtLoad<\/key>/);
  assert.match(sh, /<key>ThrottleInterval<\/key>/,
    'KeepAlive plus the lock means a refused start would relaunch hot without a throttle');
  for (const skill of ['loop-build', 'loop-review']) {
    assert.match(sh, new RegExp(skill), `both loops install: ${skill}`);
  }
});

test('the installer speaks bash 3.2 — the bash every Mac actually ships', () => {
  for (const f of ['scripts/install_loop_runner.sh', 'scripts/loop_runner.sh']) {
    assert.doesNotMatch(shellWithoutComments(read(f)), /declare -A/,
      `${f}: associative arrays do not exist in macOS bash, and the failure is a launch-time error on the machine that matters`);
  }
});

test('the delay CLI can only ever answer a number, and scopes to the last pass', () => {
  const src = withoutComments(read('scripts/loop_runner_delay.mjs'));
  assert.match(src, /scopeToLastPass/, 'unscoped, a stale limit line backs off every healthy pass forever');
  assert.match(src, /console\.log\(0\)/, 'every failure path answers 0 — a guard may not kill the loop it guards');
  assert.doesNotMatch(src, /process\.exit\((?!0)/, 'and never exits non-zero');
});

// ---------------------------------------------------------------------------
// The graduation: the loop lanes now beat.
// ---------------------------------------------------------------------------

test('loop-build and loop-review are beat emitters, and only that', () => {
  const hb = require('../../lib/nodeHeartbeat.js');
  for (const role of ['loop-build', 'loop-review']) {
    assert.ok(hb.BEAT_EMITTERS[role], `${role} must be expected to beat — the runner records one per pass`);
    assert.ok(!hb.NOT_REPORTING_WHY[role], `${role} must leave the not-reporting column, or the roll call carries both answers`);
  }
});
