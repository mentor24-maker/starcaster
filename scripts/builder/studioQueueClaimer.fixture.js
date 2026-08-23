'use strict';

/**
 * A second, REAL process that claims jobs — the other half of the concurrency
 * test in studioQueue.test.js.
 *
 * The ticket asks for two claimers rather than a simulation of one, and it is
 * right to: two claims inside a single process cannot exercise SQLite's write
 * lock, which is the mechanism actually preventing the double-claim.
 *
 * It must also actually CONTEND. A first draft of the test started these
 * processes one after the other, so the first took every job and the second
 * took none — "no overlap" was true for the boring reason and the test could
 * not have failed. Both processes are now started together and this one waits
 * on a start barrier: it spins until the wall-clock time it was given, so both
 * begin claiming within the same millisecond.
 *
 * Prints the ids it took as JSON on stdout, and nothing else — the parent
 * parses it. Not named `*.test.js`, so the test runner's glob ignores it.
 */

const fs = require('node:fs');
const { openQueue } = require('../../workers/studio/queue.js');

const [, , file, owner, startAtRaw] = process.argv;
if (!file || !owner) {
  process.stderr.write('usage: studioQueueClaimer.fixture.js <db-file> <owner> [startAtEpochMs]\n');
  process.exit(2);
}

const queue = openQueue(file);
const claimed = [];

// START HANDSHAKE, not a wall-clock guess.
//
// This used to spin until a timestamp the parent picked 400ms ahead. A child
// whose node startup ran long missed the window entirely, and the overlap
// assertion then failed on perfectly correct code — a flake in the one test
// this ticket cares most about, and worst under CI load, which is exactly when
// startup runs long. Now the child says READY and waits to be released, so the
// parent can hold both until both are actually warm.
if (startAtRaw === 'handshake') {
  process.stdout.write('READY\n');
  const fd = fs.openSync('/dev/stdin', 'rs');
  const buf = Buffer.alloc(1);
  // Blocks until the parent writes a byte. No timing assumption at all.
  while (true) {
    try {
      if (fs.readSync(fd, buf, 0, 1, null) > 0) break;
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      throw err;
    }
  }
}
const startedAt = Date.now();

/** A synchronous pause, so the two processes interleave instead of one
 *  process winning the write lock and draining the whole queue before the
 *  other gets a turn. Without it the race is real but invisible: one worker
 *  takes everything and the test cannot tell that from a broken claim. */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (;;) {
  let job;
  try {
    job = queue.claim(owner);
  } catch (err) {
    // A lock we could not get inside the busy timeout is not "no work left".
    // Reporting it as such is how a race quietly becomes a lost job.
    process.stderr.write(`claim failed: ${err && err.message}\n`);
    process.exit(3);
  }
  if (!job) break;
  claimed.push(job.id);
  pause(2);
}

queue.close();

// The window this process spent claiming. The parent asserts the two windows
// OVERLAP, which is a direct proof that the processes contended — far steadier
// than inferring it from how the jobs happened to split, which depends on who
// wins the write lock first and is flaky by nature.
process.stdout.write(JSON.stringify({ claimed, startedAt, finishedAt: Date.now() }));
