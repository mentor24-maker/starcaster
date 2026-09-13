'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * The loop pass time limit (task 86bbzwuz6). A loop-build pass sat idle for
 * eleven hours on 2026-09-12 and loop_runner.sh waited on it forever. These
 * run the real script against commands that hang, so what is tested is the
 * thing the Mini runs — not a description of it.
 */

const SCRIPT = path.join(__dirname, '..', 'run_with_time_limit.sh');
const FAST = { ...process.env, RUN_WITH_TIME_LIMIT_POLL: '1', RUN_WITH_TIME_LIMIT_GRACE: '2' };

function run(args) {
  const started = Date.now();
  const r = spawnSync('bash', [SCRIPT, ...args], { env: FAST, encoding: 'utf8', timeout: 30000 });
  return { ...r, seconds: (Date.now() - started) / 1000 };
}

test('a command that hangs is stopped at the limit and says so', () => {
  const r = run(['2', '--', 'sleep', '60']);
  assert.equal(r.status, 124);
  assert.ok(r.seconds < 10, `took ${r.seconds}s — it waited on the hung command instead of stopping it`);
  assert.match(r.stdout, /stopped after 2s/);
});

test('a command that ignores the stop request is forced', () => {
  const r = run(['2', '--', 'bash', '-c', 'trap "" TERM; while true; do sleep 1; done']);
  assert.equal(r.status, 124);
  assert.ok(r.seconds < 15, `took ${r.seconds}s`);
  assert.match(r.stdout, /ignored the stop request/, 'the pass on 2026-09-12 ignored SIGTERM; this path is the one that freed it');
});

test('a command that finishes keeps its own exit code and is not held to the poll interval', () => {
  const ok = run(['30', '--', 'bash', '-c', 'echo done; exit 0']);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /done/);
  assert.ok(ok.seconds < 5, `took ${ok.seconds}s for an instant command`);
  const failed = run(['30', '--', 'bash', '-c', 'exit 3']);
  assert.equal(failed.status, 3);
  assert.doesNotMatch(failed.stdout, /stopped after/);
});

test('a nonsense limit is refused rather than read as "no limit"', () => {
  assert.equal(run(['soon', '--', 'true']).status, 2);
  assert.equal(run(['0', '--', 'true']).status, 2);
  assert.equal(run(['5', '--']).status, 2);
});

test('loop_runner.sh runs every pass through the time limit', () => {
  const fs = require('fs');
  const runner = fs.readFileSync(path.join(__dirname, '..', 'loop_runner.sh'), 'utf8')
    .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  assert.match(runner, /run_with_time_limit\.sh" "\$\{LOOP_PASS_LIMIT_SECONDS:-7200\}" -- \\\s*\n\s*"\$CLAUDE_BIN" -p/,
    'the claude pass must be the command the time limit wraps');
});
