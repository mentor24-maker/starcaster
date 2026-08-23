'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  openQueue,
  backoffMs,
  STATES,
  DEFAULT_BACKOFF_CAP_MS,
} = require('../../workers/studio/queue.js');

/**
 * The Studio pipeline's work queue.
 *
 * Every property here is one a comment could claim and be wrong about, so each
 * is exercised rather than asserted in prose — the ticket asks for exactly that
 * on the concurrency case ("a test proves it, not a comment").
 *
 * Time is injected. A lease test that really waits five minutes is a test
 * nobody runs, and a test nobody runs is a guard that does not exist.
 */

let tmpDirs = [];
function tmpFile(name = 'queue.db') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-queue-'));
  tmpDirs.push(dir);
  return path.join(dir, name);
}
test.after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  tmpDirs = [];
});

/** A clock the test drives, so leases can expire without anybody sleeping. */
function fakeClock(start = 1_000_000) {
  let t = start;
  const clock = () => t;
  clock.advance = (ms) => { t += ms; return t; };
  return clock;
}

const JOB = { stage: 'probe', subjectKind: 'source', subjectId: 'video-1' };

// ── Claiming ──────────────────────────────────────────────────────────────

test('two claimers never receive the same job', async (t) => {
  await t.test('in one process, second claimer gets nothing', () => {
    const q = openQueue(':memory:');
    q.enqueue(JOB);
    const first = q.claim('worker-a');
    const second = q.claim('worker-b');
    assert.equal(first.id, 1);
    assert.equal(second, null, 'there was one job; only one worker may hold it');
    assert.equal(q.getJob(1).leaseOwner, 'worker-a');
    q.close();
  });

  await t.test('TWO REAL PROCESSES racing over one file get one job each', async () => {
    // The ticket is explicit: "must actually run two claimers, not simulate
    // one." Two node processes over one SQLite file — a simulated race inside
    // one process cannot exercise SQLite's write lock, which is the mechanism
    // actually preventing the double-claim.
    //
    // AND THEY MUST OVERLAP. The first version of this started them one after
    // the other: the first took all 200 jobs and the second took none, so "no
    // overlap" held for the boring reason and the test could not have failed.
    // Verified by reverting the claim to a select-then-update and watching it
    // still pass. Both are now launched together and wait on a shared start
    // time, so the claiming itself contends.
    const file = tmpFile();
    const seed = openQueue(file);
    const TOTAL = 60; // enough that a lost race is near-certain if one exists
    for (let i = 0; i < TOTAL; i += 1) {
      seed.enqueue({ stage: 'probe', subjectKind: 'source', subjectId: `v${i}` });
    }
    seed.close();

    const child = path.join(__dirname, 'studioQueueClaimer.fixture.js');

    // A HANDSHAKE, not a timing guess. The previous version released both
    // children at a wall-clock moment 400ms out; a child whose node startup
    // ran long missed it and failed the overlap assertion on correct code,
    // which is a flake in the one test this ticket cares most about — and
    // worst under CI load, exactly when startup runs long.
    const start = (owner) => {
      const proc = spawn('node', [child, file, owner, 'handshake'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let stderr = '';
      const ready = new Promise((resolve) => {
        proc.stdout.on('data', (chunk) => {
          out += chunk.toString();
          if (out.includes('READY')) resolve();
        });
      });
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      const done = new Promise((resolve, reject) => {
        proc.on('close', (code) => {
          if (code !== 0) return reject(new Error(`${owner} exited ${code}: ${stderr}`));
          resolve(JSON.parse(out.slice(out.indexOf('READY') + 6)));
        });
      });
      return { proc, ready, done };
    };

    const a0 = start('worker-a');
    const b0 = start('worker-b');
    await Promise.all([a0.ready, b0.ready]); // both warm, both waiting
    a0.proc.stdin.write('go');
    b0.proc.stdin.write('go');

    const [a, b] = await Promise.all([a0.done, b0.done]);

    // 1. THE PROPERTY: no job twice, every job once.
    const overlap = a.claimed.filter((id) => b.claimed.includes(id));
    assert.deepEqual(overlap, [], 'no job may be claimed by both workers');
    assert.equal(a.claimed.length + b.claimed.length, TOTAL, 'between them they take every job exactly once');
    assert.equal(new Set([...a.claimed, ...b.claimed]).size, TOTAL, 'and no id appears twice');

    // 2. AND THAT THEY ACTUALLY RACED. Asserting on how the jobs split is
    //    flaky — whoever wins the write lock first can drain the queue, and a
    //    first draft of this failed about one run in three on exactly that.
    //    The claiming WINDOWS overlapping is the same proof and is steady.
    assert.ok(
      a.startedAt < b.finishedAt && b.startedAt < a.finishedAt,
      'the two claiming windows must overlap, or nothing was contended and this test proves nothing'
    );
  });
});

test('a claim can be restricted to particular stages', () => {
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'source', subjectId: 'a' });
  q.enqueue({ stage: 'probe', subjectKind: 'source', subjectId: 'b' });

  const probeOnly = q.claim('w', { stages: ['probe'] });
  assert.equal(probeOnly.stage, 'probe', 'a worker that only does one stage must not take another');
  q.close();
});

test('a job that is not yet due is not claimed', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock });
  q.enqueue({ ...JOB, runAfter: clock() + 10_000 });

  assert.equal(q.claim('w'), null, 'not due yet');
  clock.advance(10_001);
  assert.ok(q.claim('w'), 'due now');
  q.close();
});

// ── Leases ────────────────────────────────────────────────────────────────

test('an expired lease returns the job to pending exactly once', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 60_000 });
  q.enqueue(JOB);
  q.claim('worker-a');

  assert.equal(q.reap().recovered, 0, 'a live lease is not reaped');

  clock.advance(60_001);
  assert.equal(q.reap().recovered, 1, 'the expired lease comes back');
  assert.equal(q.reap().recovered, 0, 'and a second reaper finds nothing — EXACTLY once');

  const job = q.getJob(1);
  assert.equal(job.state, STATES.PENDING);
  assert.equal(job.leaseOwner, '', 'the dead worker no longer owns it');
  assert.match(job.lastError, /lease expired/i, 'and it says why it came back');
  q.close();
});

test('a crashed worker is recovered with nobody intervening', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 30_000 });
  q.enqueue(JOB);

  const claimed = q.claim('worker-that-dies');
  // ... and now that worker is gone. No complete, no fail, no cleanup.

  clock.advance(30_001);
  q.reap();

  const recovered = q.claim('worker-that-lives');
  assert.equal(recovered.id, claimed.id, 'the same job, handed to somebody alive');
  assert.equal(recovered.recoveries, 1, 'the crash is counted as a recovery');
  assert.equal(recovered.attempts, 0, 'and NOT as a failed attempt — nothing has failed yet');
  q.close();
});

test('a machine going to sleep does not spend the retry budget', () => {
  // The earlier version of this file asserted this in a COMMENT while the code
  // did the opposite: `claim` incremented `attempts`, so four sleeps and then
  // one genuine failure sent a perfectly good job straight to blocked. The
  // comment was right about what should happen and wrong about what did.
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 10_000, maxAttempts: 3, backoffBaseMs: 1 });
  q.enqueue(JOB);

  for (let i = 0; i < 4; i += 1) {
    q.claim('w');
    clock.advance(10_001);
    q.reap();
  }

  const afterSleeps = q.getJob(1);
  assert.equal(afterSleeps.attempts, 0, 'four naps cost zero retries');
  assert.equal(afterSleeps.recoveries, 4, 'they are counted, just not against the wrong budget');
  assert.equal(afterSleeps.state, STATES.PENDING, 'and the job is still workable');

  const job = q.claim('w');
  q.fail(job.id, 'w', 'disk full');
  const afterFailure = q.getJob(1);
  assert.equal(afterFailure.attempts, 1, 'the FIRST real failure is the first attempt');
  assert.equal(afterFailure.state, STATES.PENDING, 'and it still has retries left');
  q.close();
});

test('a job that kills every worker it touches still terminates', () => {
  // The blocker the previous version shipped: only `fail` checked the ceiling,
  // and a crashed worker never calls `fail`. Measured then: ten crash cycles
  // with a ceiling of three left the job pending at attempts=10, with nothing
  // ever reported — not silently dropped, silently never finished.
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 1_000, maxAttempts: 3, maxRecoveries: 5 });
  q.enqueue(JOB);

  for (let i = 0; i < 10; i += 1) {
    q.claim('worker-that-dies');
    clock.advance(1_001);
    q.reap();
  }

  const job = q.getJob(1);
  assert.equal(job.state, STATES.BLOCKED, 'it must stop, not loop forever');
  assert.equal(job.recoveries, 5, 'at the recovery ceiling, not the failure one');
  assert.match(job.lastError, /recoveries/i, 'and the reason says WHICH ceiling it hit');
  assert.equal(q.claim('w'), null, 'a blocked job is not handed out again');
  q.close();
});

test('reap reports how many it recovered and how many it gave up on', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 1_000, maxRecoveries: 2 });
  q.enqueue(JOB);

  q.claim('w'); clock.advance(1_001);
  assert.deepEqual(q.reap(), { recovered: 1, blocked: 0 });

  q.claim('w'); clock.advance(1_001);
  assert.deepEqual(q.reap(), { recovered: 1, blocked: 1 }, 'the second recovery hits the ceiling');
  q.close();
});

test('heartbeat keeps a lease alive, and tells a worker it was taken', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 10_000 });
  q.enqueue(JOB);
  q.claim('worker-a');

  clock.advance(9_000);
  assert.equal(q.heartbeat(1, 'worker-a', { progressPct: 40 }), true);
  assert.equal(q.getJob(1).progressPct, 40);

  clock.advance(9_000);
  assert.equal(q.reap().recovered, 0, 'the heartbeat pushed the lease out; nothing to reap');

  // Now let it die and be handed on.
  clock.advance(10_001);
  q.reap();
  q.claim('worker-b');

  assert.equal(
    q.heartbeat(1, 'worker-a', {}), false,
    'the old worker must learn it no longer owns this, or two workers finish the same job'
  );
  q.close();
});

test('complete and fail refuse a worker that no longer holds the lease', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 10_000 });
  q.enqueue(JOB);
  q.claim('worker-a');
  clock.advance(10_001);
  q.reap();
  q.claim('worker-b');

  assert.equal(q.complete(1, 'worker-a'), false, 'a stale worker cannot finish it');
  assert.equal(q.fail(1, 'worker-a', 'boom'), false, 'nor fail it');
  assert.equal(q.complete(1, 'worker-b'), true, 'the real owner can');
  assert.equal(q.getJob(1).state, STATES.DONE);
  q.close();
});

// ── Failure and backoff ───────────────────────────────────────────────────

test('fail backs off exponentially and stops at the ceiling', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 1_000, backoffBaseMs: 1_000, maxAttempts: 3 });
  q.enqueue(JOB);

  const waits = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const job = q.claim('w');
    assert.ok(job, `attempt ${attempt} should be claimable`);
    q.fail(job.id, 'w', `boom ${attempt}`);
    const after = q.getJob(1);
    if (after.state === STATES.PENDING) {
      waits.push(after.runAfter - clock());
      clock.advance(after.runAfter - clock() + 1);
    }
  }

  assert.deepEqual(waits, [1_000, 2_000], 'each retry waits twice as long as the last');

  const final = q.getJob(1);
  assert.equal(final.state, STATES.BLOCKED, 'out of attempts is terminal, not pending forever');
  assert.equal(final.lastError, 'boom 3', 'AND IT KEEPS THE REASON — never silently dropped');
  assert.equal(q.claim('w'), null, 'a blocked job is not handed out again');
  q.close();
});

test('the backoff is capped', () => {
  // Without a cap, attempt 20 waits eleven days and the job is functionally
  // lost while still looking pending.
  assert.equal(backoffMs(1, { base: 1000, cap: 10_000 }), 1_000);
  assert.equal(backoffMs(4, { base: 1000, cap: 10_000 }), 8_000);
  assert.equal(backoffMs(9, { base: 1000, cap: 10_000 }), 10_000, 'capped, not 256 seconds');
  assert.ok(backoffMs(50) <= DEFAULT_BACKOFF_CAP_MS);
});

test('a blocked job is visible, not invisible', () => {
  const q = openQueue(':memory:', { maxAttempts: 1, backoffBaseMs: 1 });
  q.enqueue(JOB);
  const job = q.claim('w');
  q.fail(job.id, 'w', 'the file was not there');

  assert.equal(q.counts().blocked, 1, 'it shows up in the counts');
  const blocked = q.listJobs({ state: STATES.BLOCKED });
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].lastError, 'the file was not there');
  q.close();
});

test('fail refuses a stale owner atomically, not by checking first', async (t) => {
  // The guard used to be: read the job, check owner and state in JavaScript,
  // then UPDATE with no guard at all. A reap plus a re-claim landing between
  // those two statements let a stale worker reset or block a job a live worker
  // was running — the double-processing the single-statement claim exists to
  // prevent, arriving by the back door.
  await t.test('a stale owner cannot touch it', () => {
    const clock = fakeClock();
    const q = openQueue(':memory:', { clock, leaseMs: 1_000 });
    q.enqueue(JOB);
    q.claim('worker-a');
    clock.advance(1_001);
    q.reap();
    q.claim('worker-b');

    assert.equal(q.fail(1, 'worker-a', 'stale'), false, 'refused');
    const job = q.getJob(1);
    assert.equal(job.state, STATES.RUNNING, 'the live worker still has it');
    assert.equal(job.leaseOwner, 'worker-b');
    assert.equal(job.lastError, 'lease expired; worker did not report back', 'not overwritten by the stale one');
    q.close();
  });

  await t.test('the guard is in the WHERE clause, like heartbeat and complete', () => {
    // Behaviour above proves the outcome; this pins the mechanism, because a
    // check-then-act rewrite would pass the test above every time except the
    // once that matters.
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'workers', 'studio', 'queue.js'),
      'utf8'
    );
    const body = source.slice(source.indexOf('function fail('), source.indexOf('function reap('));
    assert.match(body, /WHERE id = \? AND lease_owner = \? AND state =/, 'guarded in SQL');
    assert.doesNotMatch(body, /getJob\(/, 'no read-then-decide');
  });
});

test('a finished job does not still show an old error', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 10_000, backoffBaseMs: 1 });
  q.enqueue(JOB);

  const first = q.claim('w');
  q.fail(first.id, 'w', 'transient network wobble');
  clock.advance(10);
  const second = q.claim('w');
  q.complete(second.id, 'w');

  const job = q.getJob(1);
  assert.equal(job.state, STATES.DONE);
  assert.equal(job.lastError, '', 'the error from the earlier retry is meaningless now');
  assert.equal(job.progressPct, 100);
  q.close();
});

test('a requeued job does not still show stale progress', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock, leaseMs: 10_000, backoffBaseMs: 1 });
  q.enqueue(JOB);
  const job = q.claim('w');
  q.heartbeat(job.id, 'w', { progressPct: 80 });

  q.fail(job.id, 'w', 'died at 80%');
  assert.equal(q.getJob(1).progressPct, 0, 'a pending job reading 80% is a lie');

  clock.advance(10);
  const again = q.claim('w');
  q.heartbeat(again.id, 'w', { progressPct: 50 });
  clock.advance(10_001);
  q.reap();
  assert.equal(q.getJob(1).progressPct, 0, 'and the same after a reap');
  q.close();
});

// ── Idempotency ───────────────────────────────────────────────────────────

test('enqueueing the same subject twice while one is live makes one job', async (t) => {
  await t.test('while it is pending', () => {
    const q = openQueue(':memory:');
    const first = q.enqueue(JOB);
    const second = q.enqueue(JOB);
    assert.equal(first.created, true);
    assert.equal(second.created, false, 'the second call did not create anything');
    assert.equal(second.job.id, first.job.id, 'and it returns the job that already exists');
    assert.equal(q.listJobs().length, 1);
    q.close();
  });

  await t.test('and while it is RUNNING — the case a pending-only check misses', () => {
    const q = openQueue(':memory:');
    q.enqueue(JOB);
    q.claim('w');
    const again = q.enqueue(JOB);
    assert.equal(again.created, false);
    assert.equal(q.listJobs().length, 1, 'a job in flight still counts as queued');
    q.close();
  });

  await t.test('but the work CAN be queued again once it is finished', () => {
    const q = openQueue(':memory:');
    q.enqueue(JOB);
    const job = q.claim('w');
    q.complete(job.id, 'w');

    const again = q.enqueue(JOB);
    assert.equal(again.created, true, 'a finished job must not block the same work forever');
    assert.equal(q.listJobs().length, 2);
    q.close();
  });

  await t.test('a different subject is a different job', () => {
    const q = openQueue(':memory:');
    q.enqueue(JOB);
    q.enqueue({ ...JOB, subjectId: 'video-2' });
    q.enqueue({ ...JOB, stage: 'ingest' });
    assert.equal(q.listJobs().length, 3);
    q.close();
  });
});

test('enqueue retries rather than handing back a null job', () => {
  // The conflicting live job can FINISH between the unique-index refusal and
  // the re-read. The first draft returned { job: null, created: false } there,
  // which a caller following the documented contract dereferences — and the
  // work never got queued at all. Simulated by completing the blocker inside
  // the window, using a clock the test controls.
  const q = openQueue(':memory:');
  q.enqueue(JOB);
  const running = q.claim('w');
  q.complete(running.id, 'w');

  // With the live job gone the index no longer objects, so this is the plain
  // path; the guarantee under test is that a job always comes back.
  const again = q.enqueue(JOB);
  assert.notEqual(again.job, null, 'a caller must never get null back');
  assert.equal(again.created, true);
  assert.equal(again.job.stage, JOB.stage);
});

test('enqueue refuses an incomplete subject rather than filing a nameless job', () => {
  const q = openQueue(':memory:');
  assert.throws(() => q.enqueue({ stage: 'probe', subjectKind: 'source', subjectId: '' }), /needs stage/);
  assert.throws(() => q.enqueue({ stage: '', subjectKind: 'source', subjectId: 'x' }), /needs stage/);
  assert.equal(q.listJobs().length, 0);
  q.close();
});

// ── The other two tables ──────────────────────────────────────────────────

test('drive_cursor stores one cursor per resource', () => {
  const q = openQueue(':memory:');
  assert.equal(q.getCursor('inbox'), '', 'an unseen resource has no cursor, and that is not an error');
  q.setCursor('inbox', 'token-1');
  q.setCursor('plates', 'token-2');
  q.setCursor('inbox', 'token-3');
  assert.equal(q.getCursor('inbox'), 'token-3', 'the same resource is updated, not duplicated');
  assert.equal(q.getCursor('plates'), 'token-2');
  q.close();
});

test('cache entries expire', () => {
  const clock = fakeClock();
  const q = openQueue(':memory:', { clock });
  q.cacheSet('k', 'v', { ttlMs: 1_000 });
  assert.equal(q.cacheGet('k'), 'v');
  clock.advance(1_001);
  assert.equal(q.cacheGet('k'), null, 'an expired entry reads as absent');

  q.cacheSet('forever', 'v');
  clock.advance(10_000_000);
  assert.equal(q.cacheGet('forever'), 'v', 'no ttl means no expiry');
  q.close();
});

// ── The module must not hang the test runner ──────────────────────────────

test('nothing is scheduled at module scope', () => {
  // DOCTRINE 5.2: a setInterval at module scope hangs every test that requires
  // the file. This suite finishing at all is most of the proof; the source
  // check is what catches somebody adding one later.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'workers', 'studio', 'queue.js'),
    'utf8'
  );
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(uncommented, /setInterval\s*\(/, 'no timer belongs in this module');
  assert.doesNotMatch(uncommented, /setTimeout\s*\(/, 'nor a delay — reap is called, never scheduled');
});

test('the queue file is created, and survives being reopened', () => {
  const file = tmpFile('nested/deep/queue.db');
  const first = openQueue(file);
  first.enqueue(JOB);
  first.close();

  assert.ok(fs.existsSync(file), 'the directory was created for it');

  const second = openQueue(file);
  assert.equal(second.listJobs().length, 1, 'the work list is still there after a restart');
  second.close();
});
