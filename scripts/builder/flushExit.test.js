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
 * HOW MUCH is lost is platform-dependent, and the first version of this file
 * got that wrong — worth writing down, because the wrong version is the
 * intuitive one. Node's docs say stdout-to-a-pipe is synchronous on Linux and
 * asynchronous on macOS, so the obvious reading is "a Mac bug." Measured, the
 * same child printing 200,000 bytes into the same parent:
 *
 *     macOS (the Mini, where the hourly job runs)   65,535   every time
 *     Linux (node:20 in Docker, this machine)      200,000   nothing lost
 *     Linux (the GitHub Actions runner)            146,176   53,825 lost
 *
 * So it is not a Mac bug. It is a race everywhere — the Mac loses it reliably
 * at size, Linux loses it only when the reader is slow, and that second half is
 * the worse one to own because it is the half that passes in testing.
 *
 * The first version of this file asserted the exact figure, 65,536, and that
 * was itself flaky: run the 66,000-byte case on a loaded Mac and all 66,001
 * bytes arrive, because the parent drains the pipe before the child reaches
 * `exit`. Reproduced deliberately under fourteen busy CPUs. So the control
 * asserts the PROPERTY — the old shape loses output, the fix never does — and
 * REPORTS the exact number as a diagnostic rather than pinning it. A racy
 * assertion in the test file of a watchdog is the same defect the watchdog is
 * for. It never skips and always says what it measured: a check that quietly
 * does not run is what this whole PR is about (docs/DOCTRINE.md 3.11).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, '..', 'lib', 'flushExit.cjs');
const PIPE_BUFFER = 65536;
// Where a 200KB payload is reliably lost by the old shape, and so where the
// break-test of the fix actually bites. Elsewhere the race can go either way —
// see the header; CI lost 53,825 bytes and Docker lost none.
const LOSS_IS_RELIABLE = process.platform === 'darwin';
// The size to measure at. Just past the buffer is racy even on a Mac; well past
// it is not, because the child cannot outrun a parent that has 200KB to drain.
const WELL_PAST_THE_BUFFER = 200000;
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

test('the control: the old shape is measured here, and reported whether or not it can be pinned', (t) => {
  const got = printThrough(THE_OLD_WAY, { bytes: WELL_PAST_THE_BUFFER }).stdout.length;
  t.diagnostic(`${WHERE}: the old shape printed ${WELL_PAST_THE_BUFFER + 1} bytes and the parent received ${got}`);

  if (LOSS_IS_RELIABLE) {
    // The property, not the figure. `got` is 65,536 every time it has been
    // looked at, and the header records that — but asserting it is how this
    // file became flaky once already.
    assert.ok(got < 200001,
      `${WHERE}: the old shape must LOSE output at this size, or the break-tests below prove `
      + `nothing — the instrument has changed. It delivered all ${got} bytes.`);
    return;
  }

  // Elsewhere the loss is a race, so there is no stable number to assert — and
  // an assertion that cannot fail is worse than none, because it reads as
  // proof. What IS true on every platform gets asserted instead: the old shape
  // never delivers more than was printed, and the fix always delivers all of
  // it. That keeps this a real check rather than a skip wearing a green tick.
  assert.ok(got <= 200001, `${WHERE}: received more than was printed (${got}) — impossible`);
  assert.equal(printThrough(WITH_HELPER, { bytes: 200000 }).stdout.length, 200001,
    `${WHERE}: whatever this platform does to the old shape, the fix must lose nothing`);
});

test('BREAK-TEST: 200,000 bytes printed through a pipe arrive whole', () => {
  // Revert printAndExit to `console.log(text); process.exit(code)` and this
  // reads 65536 instead of 200001 on a Mac, and something unpredictable
  // elsewhere. Break-test it where the job runs, or the revert may pass.
  const r = printThrough(WITH_HELPER, { bytes: 200000 });
  assert.equal(r.stdout.length, 200001, 'the payload plus its newline, nothing lost');
  assert.equal(r.stdout.trimEnd().length, 200000);
});

test('just past the buffer, the fix delivers everything — and the old shape is a coin toss', () => {
  // Under the buffer, every shape on every platform agrees — the kernel takes
  // it in one go and there is nothing left to lose.
  assert.equal(printThrough(THE_OLD_WAY, { bytes: 65535 }).stdout.length, 65536,
    'under the buffer, both shapes and every platform agree');

  // The fix, everywhere and unconditionally. This is the assertion that matters,
  // and the only one at this size: what the OLD shape does with 66,000 bytes is
  // a coin toss even on a Mac — measured, it delivers all of it under load —
  // so there is nothing here to assert about it and nothing is asserted.
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
