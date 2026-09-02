'use strict';

/**
 * Printing a large report and then exiting must not lose the report.
 *
 * These tests spawn a REAL child process and read its stdout through a REAL
 * pipe, because that is the only arrangement in which the bug exists. Run the
 * same code with stdout attached to a terminal and every one of them passes
 * against the broken version too — which is exactly how a `console.log` +
 * `process.exit()` pair survived being written, reviewed and shipped.
 *
 * The threshold is not arbitrary: a macOS pipe buffer is 65,536 bytes, and
 * anything up to it survives by luck. The first byte past it is lost, and so is
 * everything after.
 *
 * AND IT IS PLATFORM-SPECIFIC, which is the part worth knowing. From Node's own
 * docs, writes to `process.stdout` are synchronous for pipes on Linux and
 * Windows and ASYNCHRONOUS for pipes on macOS. So `process.exit()` discards
 * unflushed output on a Mac and does not on CI's Linux runner — this bug could
 * never have been caught by CI, and the machine that actually runs the hourly
 * job is a Mac. The control tests below therefore assert the behaviour of the
 * platform they are ON, and say which one that was, rather than skipping: a
 * check that quietly does not run is the failure this whole PR is about
 * (docs/DOCTRINE.md 3.11). The tests of the FIX are unconditional, because
 * flushing before leaving is correct everywhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, '..', 'lib', 'flushExit.cjs');
const PIPE_BUFFER = 65536;
// macOS: stdout-to-a-pipe is asynchronous, so exiting straight after printing
// loses whatever has not flushed. Linux/Windows: synchronous, so it does not.
const PIPE_IS_ASYNC = process.platform === 'darwin';
const WHERE = `measured on ${process.platform}`;

/** Run a child that prints `bytes` of output through a pipe, and see what arrives. */
function printThrough(body, { bytes = 200000, args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-exit-'));
  const child = path.join(dir, 'child.cjs');
  fs.writeFileSync(child, body);
  try {
    const r = spawnSync(process.execPath, [child, String(bytes), ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30000,
    });
    return {
      stdout: r.stdout || '',
      stderr: r.stderr || '',
      status: r.status,
      signal: r.signal,
      error: r.error || null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const WITH_HELPER = `
const { printAndExit } = require(${JSON.stringify(HELPER)});
const n = Number(process.argv[2]);
printAndExit('x'.repeat(n), Number(process.argv[3] || 0));
`;

// The shape this replaced, kept here as the control. If it ever stops
// truncating, the platform has changed underneath us and these tests are
// measuring nothing — better to find that out here than in production.
const THE_OLD_WAY = `
const n = Number(process.argv[2]);
console.log('x'.repeat(n));
process.exit(0);
`;

test('the control: what the OLD shape does on this platform, stated out loud', () => {
  // Not a skip on Linux — an assertion of the opposite, so the platform split
  // itself is pinned. If macOS ever stops truncating, or Linux ever starts,
  // this fails and the next reader learns it here rather than in production.
  const big = printThrough(THE_OLD_WAY, { bytes: 200000 });
  if (PIPE_IS_ASYNC) {
    assert.equal(big.stdout.length, PIPE_BUFFER,
      `${WHERE}: the old shape must truncate at exactly the pipe buffer, or every test below `
      + 'is uncalibrated and the bug this PR fixes is not the bug that was measured');
  } else {
    assert.equal(big.stdout.length, 200001,
      `${WHERE}: pipes are synchronous here, so the old shape does NOT lose output. This is why `
      + 'CI could never have caught this, and why the Mac that runs the hourly job could.');
  }
});

test('BREAK-TEST: 200,000 bytes printed through a pipe arrive whole', () => {
  // Revert printAndExit to `console.log(text); process.exit(code)` and this
  // reads 65536 instead of 200001 — ON A MAC. On Linux the revert passes,
  // which is exactly why the break-test has to be run where the job runs.
  const r = printThrough(WITH_HELPER, { bytes: 200000 });
  assert.equal(r.stdout.length, 200001, 'the payload plus its newline, nothing lost');
  assert.equal(r.stdout.trimEnd().length, 200000);
});

test('the first byte past the buffer is where the old way started losing, and the new way does not', () => {
  // 65,536 survives by luck everywhere. 66,000 is the smallest round number
  // that does not on a Mac, and it is the measurement in the helper's header.
  assert.equal(printThrough(THE_OLD_WAY, { bytes: 65535 }).stdout.length, 65536,
    'under the buffer, both shapes and both platforms agree');
  assert.equal(printThrough(THE_OLD_WAY, { bytes: 66000 }).stdout.length,
    PIPE_IS_ASYNC ? PIPE_BUFFER : 66001,
    `${WHERE}: where the old shape starts losing, if it does`);
  // The fix, on every platform: past the buffer, nothing is lost.
  assert.equal(printThrough(WITH_HELPER, { bytes: 66000 }).stdout.length, 66001);
});

test('JSON that big is still parseable at the far end — the actual consumer contract', () => {
  // What pulse_publish.mjs does: spawn the pulse with --json and JSON.parse
  // what comes back. Truncated JSON does not parse, and the publisher reports
  // that as "the pulse's JSON could not be parsed" — a bus alarm about a bug
  // that does not exist, raised by a watchdog that has gone blind.
  const body = `
const { printAndExit } = require(${JSON.stringify(HELPER)});
const n = Number(process.argv[2]);
const rows = [];
for (let i = 0; rows.join(',').length < n; i += 1) rows.push({ id: 'ticket-' + i, note: 'x'.repeat(120) });
printAndExit(JSON.stringify({ rows }, null, 2), 0);
`;
  const r = printThrough(body, { bytes: 250000 });
  assert.ok(r.stdout.length > PIPE_BUFFER, `expected a payload past the buffer, got ${r.stdout.length}`);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.rows) && parsed.rows.length > 1000);
});

test('the exit code survives the flush — both the fast path and the natural one', () => {
  assert.equal(printThrough(WITH_HELPER, { bytes: 100, args: ['0'] }).status, 0);
  assert.equal(printThrough(WITH_HELPER, { bytes: 100, args: ['2'] }).status, 2);
  // And past the buffer, where the exit happens from the flush callback rather
  // than immediately — the path where a wrong code would be easy to miss.
  assert.equal(printThrough(WITH_HELPER, { bytes: 200000, args: ['2'] }).status, 2);
});

test('it LEAVES — an open handle must not turn a truncation into a hang', () => {
  // The trade the round-3 review named: `process.exitCode` alone waits for the
  // event loop to drain, and anything holding it open (undici keep-alive
  // sockets after a fetch, most obviously) turns short output into a hung
  // hourly job, which is strictly worse. So the helper exits, it does not ask.
  const body = `
const net = require('node:net');
const server = net.createServer();
server.listen(0);                       // a handle that would hold the loop open forever
const { printAndExit } = require(${JSON.stringify(HELPER)});
printAndExit('x'.repeat(Number(process.argv[2])), 0);
`;
  const r = printThrough(body, { bytes: 200000 });
  assert.equal(r.signal, null, 'killed by the test timeout means it hung');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.length, 200001, 'and it still flushed everything before leaving');
});

test('stderr takes the same door — a crash message is the one that must not be dropped', () => {
  const body = `
const { printAndExit } = require(${JSON.stringify(HELPER)});
printAndExit('e'.repeat(Number(process.argv[2])), 2, { stream: 'stderr' });
`;
  const r = printThrough(body, { bytes: 200000 });
  assert.equal(r.stderr.length, 200001);
  assert.equal(r.status, 2);
});

test('BREAK-TEST: the pulse prints its handoff through the flush door, not straight into exit', () => {
  // The call site, pinned. `scripts/pulse_publish.mjs` reads this output
  // through a pipe, so a bare `console.log(JSON.stringify(...)); process.exit()`
  // here is the production bug regardless of how the helper behaves.
  const src = fs.readFileSync(path.join(__dirname, '..', 'pulse.cjs'), 'utf8');
  assert.match(src, /printAndExit\(JSON\.stringify\(result, null, 2\), code\)/,
    'the --json handoff must flush before it leaves');
  assert.match(src, /printAndExit\(formatReport\(result\), code\)/,
    'and so must the human report — it is piped by the runner into the launchd log');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
  assert.doesNotMatch(code, /console\.log\(JSON\.stringify\(result[\s\S]{0,200}?process\.exit\(/,
    'printing and then exiting is the shape that loses the last 64KB');
});
