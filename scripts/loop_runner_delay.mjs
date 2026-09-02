#!/usr/bin/env node
/**
 * The IO half of loopRunnerGuard: read the tail of a pass log, print ONE
 * integer — the seconds the runner should sleep because of a usage limit, or
 * 0 for "no limit; pace normally". The reason goes to stderr, which the
 * runner appends to the same log, so the sleep is never a mystery.
 *
 *   node scripts/loop_runner_delay.mjs <log-file>
 *
 * NOTHING HERE MAY FAIL THE RUNNER. Every problem — missing file, unreadable
 * tail, a bug in this script — prints 0 and a line saying why, and exits 0.
 * A guard that can kill the loop it guards is the one outcome worse than the
 * blind retries it was written to stop (task 86bbtuje2).
 *
 * Only THIS pass's output is scanned (`scopeToLastPass`): the log tail still
 * carries the previous pass's lines, and a 2:38am "resets 2:50am" sitting
 * above a 3:00am pass that succeeded would otherwise read as a limit whose
 * reset is 23 hours away — a healthy pass answered with a needless backoff.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const guard = require('./builder/loopRunnerGuard.js');

/** Only the end of the log matters, and logs run to megabytes. */
const TAIL_BYTES = 16 * 1024;

function tailOf(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

try {
  const file = process.argv[2];
  if (!file) {
    console.error('[loop_runner_delay] no log file given — answering 0 (normal pacing)');
    console.log(0);
    process.exit(0);
  }
  const scoped = guard.scopeToLastPass(tailOf(file));
  const decision = guard.limitDelay({ text: scoped, nowMs: Date.now() });
  if (!decision) {
    console.log(0);
    process.exit(0);
  }
  console.error(`[loop_runner_delay] ${decision.reason}`);
  console.log(decision.seconds);
} catch (err) {
  console.error(`[loop_runner_delay] could not read the log (${err?.message || err}) — answering 0 (normal pacing)`);
  console.log(0);
}
process.exit(0);
