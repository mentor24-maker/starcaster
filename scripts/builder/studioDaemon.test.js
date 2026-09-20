'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openQueue, STATES } = require('../../workers/studio/queue.js');
const {
  runDaemon, tickOnce, formatTick, rotateLog, ownerId,
  resolveQueueFile, resolveLogFile, DEFAULT_LOG_KEEP,
} = require('../../workers/studio/daemon.js');

const OWNER = 'studio-test-1';

function tmpdir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `studio-daemon-${name}-`));
}

/** A stage runner that claims one job and settles it the way it was told to. */
function runnerThat(behaviour, stage = 'ingest') {
  return {
    [stage]: {
      label: stage,
      run: async ({ queue, owner }) => {
        const job = queue.claim(owner, { stages: [stage] });
        if (!job) return { claimed: null };
        if (behaviour === 'complete') { queue.complete(job.id, owner); return { claimed: job.id }; }
        if (behaviour === 'throw-after-claim') throw new Error('ffmpeg fell over');
        if (behaviour === 'throw-before-settle') throw new Error('the disk went away');
        return { claimed: job.id };
      },
    },
  };
}

// ── The acceptance criterion: a stage throwing must not take the lane ───────

test('a stage that throws fails its job WITH A REASON and the daemon keeps going', async () => {
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });

  const report = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('throw-after-claim') });

  assert.ok(report.error, 'the throw is reported, not swallowed');
  assert.match(report.error.message, /ffmpeg fell over/);
  assert.equal(report.failedJobs.length, 1, 'the job it was holding was failed');
  assert.match(report.failedJobs[0].reason, /ffmpeg fell over/,
    'and the reason names what actually happened — a blank last_error reads as "never tried"');

  // Failed, not left running: it is back in the queue on its own backoff, and
  // will reach `blocked` with that reason rather than sitting there forever.
  const job = q.getJob(report.failedJobs[0].id);
  assert.equal(job.state, STATES.PENDING);
  assert.equal(job.attempts, 1);
  assert.match(job.lastError, /ffmpeg fell over/);

  // And the daemon is still usable: the very next tick works normally.
  const after = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('complete') });
  assert.equal(after.error, null);
  q.close();
});

test('a throw never touches a job another daemon has since claimed', async () => {
  // The guard that matters: `fail` is conditioned on lease_owner, so a stale
  // daemon cannot reset work a live one is doing. This asserts the daemon
  // relies on that rather than failing everything it finds running.
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'mine' });
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'theirs' });
  const theirs = q.claim('another-daemon', { stages: ['ingest'] });

  const report = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('throw-after-claim') });

  assert.equal(report.failedJobs.length, 1);
  assert.notEqual(report.failedJobs[0].id, theirs.id);
  assert.equal(q.getJob(theirs.id).state, STATES.RUNNING, 'the other daemon\'s job is untouched');
  q.close();
});

test('a throw with nothing left claimed says so rather than reporting a phantom failure', async () => {
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });
  const runners = {
    ingest: {
      label: 'ingest',
      run: async ({ queue, owner }) => {
        const job = queue.claim(owner, { stages: ['ingest'] });
        queue.fail(job.id, owner, 'the pass settled this itself');
        throw new Error('and then threw on its way out');
      },
    },
  };
  const report = await tickOnce({ queue: q, owner: OWNER, runners });
  assert.ok(report.error);
  assert.equal(report.failedJobs.length, 0);
  assert.match(formatTick(report), /no job was left leased to this daemon/);
  assert.match(q.getJob(1).lastError, /the pass settled this itself/,
    'the pass\'s own reason survives — the daemon does not overwrite it');
  q.close();
});

// ── Recovering from a kill -9: the lease, not a lock ────────────────────────

test('the tick reaps an expired lease, which is how a killed daemon\'s job comes back', async () => {
  let now = 1_000_000;
  const q = openQueue(':memory:', { clock: () => now, leaseMs: 60_000 });
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });

  // A daemon claims it and is killed — no complete, no fail, no release.
  const held = q.claim('daemon-that-died', { stages: ['ingest'] });
  assert.equal(q.getJob(held.id).state, STATES.RUNNING);

  now += 61_000; // the lease expires
  const report = await tickOnce({ queue: q, owner: OWNER, runners: {}, now });

  assert.equal(report.reaped.recovered, 1);
  const back = q.getJob(held.id);
  assert.equal(back.state, STATES.PENDING, 'reclaimed with no human involved');
  assert.equal(back.recoveries, 1);
  assert.equal(back.attempts, 0, 'a crash is not the job failing — its retry budget is intact');
  q.close();
});

test('reap is skipped on ticks between its interval, and the report says nothing rather than lying', async () => {
  const q = openQueue(':memory:');
  const report = await tickOnce({ queue: q, owner: OWNER, runners: {}, reap: false });
  assert.equal(report.reaped, null);
  q.close();
});

// ── Work nobody is doing must be reported, never ignored ────────────────────

test('a waiting job on a stage with no runner is NAMED, not silently skipped', async () => {
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'transcribe', subjectKind: 'clip', subjectId: 'c1' });
  q.enqueue({ stage: 'transcribe', subjectKind: 'clip', subjectId: 'c2' });

  const report = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('complete') });

  assert.equal(report.worked, false);
  assert.equal(report.unhandled.length, 1, 'one line per stage, not one per job');
  assert.equal(report.unhandled[0].stage, 'transcribe');
  assert.match(formatTick(report), /WAITING WITH NOBODY ON IT: stage "transcribe"/);
  q.close();
});

test('a tick with nothing due says "nothing due" and claims nothing', async () => {
  const q = openQueue(':memory:');
  const report = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('complete') });
  assert.equal(report.worked, false);
  assert.equal(report.stage, null);
  assert.match(formatTick(report), /nothing due/);
  q.close();
});

test('a job held off by backoff is not due, so no runner is started for it', async () => {
  let now = 1_000_000;
  const q = openQueue(':memory:', { clock: () => now });
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'later', runAfter: now + 60_000 });
  const report = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('complete'), now });
  assert.equal(report.worked, false, 'a pass started for a job that cannot be claimed is a pass that does its whole preflight for nothing');
  q.close();
});

test('one unit of work per tick, even with a full queue', async () => {
  const q = openQueue(':memory:');
  for (const id of ['a', 'b', 'c']) q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: id });
  const report = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('complete') });
  assert.equal(report.worked, true);
  assert.equal(q.counts().done, 1);
  q.close();
});

// ── Log rotation: a week of running must not fill the disk ──────────────────

test('the log rotates at the size cap and keeps the configured number of copies', () => {
  const dir = tmpdir('rotate');
  const file = path.join(dir, 'daemon.log');
  fs.writeFileSync(file, 'x'.repeat(200));

  assert.equal(rotateLog(file, { maxBytes: 1000 }).rotated, false, 'under the cap, nothing moves');
  assert.ok(fs.existsSync(file));

  const first = rotateLog(file, { maxBytes: 100, keep: 3 });
  assert.equal(first.rotated, true);
  assert.match(first.why, /reached 200 bytes/);
  assert.equal(fs.existsSync(file), false, 'the live log was renamed out of the way');
  assert.equal(fs.readFileSync(path.join(dir, 'daemon.log.1'), 'utf8').length, 200);

  fs.writeFileSync(file, 'y'.repeat(200));
  rotateLog(file, { maxBytes: 100, keep: 3 });
  assert.equal(fs.readFileSync(path.join(dir, 'daemon.log.1'), 'utf8')[0], 'y');
  assert.equal(fs.readFileSync(path.join(dir, 'daemon.log.2'), 'utf8')[0], 'x', 'the older copy shifted along');

  // The cap is what bounds the disk: keep + 1 files, never more, however many
  // times it rolls. A job failing in a loop writing a megabyte a minute is what
  // this is for, and a daily rotation would let that run for 23 more hours.
  for (let i = 0; i < 10; i += 1) {
    fs.writeFileSync(file, 'z'.repeat(200));
    rotateLog(file, { maxBytes: 100, keep: 3 });
  }
  const left = fs.readdirSync(dir).filter((f) => f.startsWith('daemon.log'));
  assert.equal(left.length, 3, 'keep=3 means three old copies and no live log at this instant');
  assert.equal(fs.existsSync(path.join(dir, 'daemon.log.4')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a log that does not exist yet is not a fault', () => {
  const dir = tmpdir('nolog');
  const out = rotateLog(path.join(dir, 'daemon.log'));
  assert.equal(out.rotated, false);
  assert.match(out.why, /no log file yet/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a rotation that throws is reported and swallowed — it must never stop the daemon', () => {
  // A full disk is precisely when rotation fails and precisely when the daemon
  // is most needed. It reports and carries on.
  const out = rotateLog('/anywhere/daemon.log', {
    maxBytes: 1,
    io: {
      statSync: () => ({ size: 999 }),
      renameSync: () => { throw new Error('read-only file system'); },
      unlinkSync: () => {},
    },
  });
  assert.equal(out.rotated, false);
  assert.match(out.why, /rotation failed: read-only file system/);
});

// ── Identity, paths and the beat ────────────────────────────────────────────

test('the owner id carries the pid, so a restart does not adopt the old life\'s job', () => {
  const before = ownerId({ node: 'mac-mini.local', pid: 100 });
  const after = ownerId({ node: 'mac-mini.local', pid: 101 });
  assert.equal(before, 'studio-mac-mini-100');
  assert.notEqual(before, after);
});

test('the queue file and log path are derived, and the env wins over the default', () => {
  // A real temp folder stands in for the home directory rather than a literal
  // one written down. The Mini's home is not this laptop's, and a committed
  // file that names a machine is correct on exactly one machine (vault
  // doctrine/NODES.md P1) — which `npm run check:paths` blocks at commit.
  const home = tmpdir('home');
  const elsewhere = tmpdir('elsewhere');
  assert.equal(resolveQueueFile({}, {}, home), path.join(home, 'Studio', 'queue.sqlite'));
  assert.equal(resolveLogFile({}, {}, home), path.join(home, 'Studio', 'logs', 'daemon.log'));

  const queueOverride = path.join(elsewhere, 'q.sqlite');
  assert.equal(resolveQueueFile({}, { STUDIO_QUEUE_FILE: queueOverride }, home), queueOverride);
  assert.equal(resolveLogFile({}, { STUDIO_LOG_DIR: elsewhere }, home), path.join(elsewhere, 'daemon.log'));

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

test('the daemon beats on a tick that did nothing at all — liveness, not success', async () => {
  const q = openQueue(':memory:');
  const beats = [];
  let now = 5_000_000;
  const summary = await runDaemon({
    queue: q,
    owner: OWNER,
    runners: {},
    stopAfterTicks: 1,
    clock: () => now,
    sleep: async () => {},
    write: () => {},
    recordBeat: (b) => beats.push(b),
    node: 'mac-mini',
    logFile: path.join(tmpdir('beat'), 'daemon.log'),
  });
  assert.equal(summary.worked, 0, 'there was no work');
  assert.equal(beats.length, 1, 'and it beat anyway — an idle weekend is not a dead daemon');
  assert.equal(beats[0].role, 'studio-worker');
  assert.equal(beats[0].node, 'mac-mini');
  q.close();
});

test('the daemon beats after a tick whose stage THREW', async () => {
  // The beat means "the daemon is alive", so a run of failures must still beat.
  // A beat that only fired on success would go quiet during exactly the outage
  // a person most needs to see reported as a working daemon with failing work.
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });
  const beats = [];
  await runDaemon({
    queue: q,
    owner: OWNER,
    runners: runnerThat('throw-after-claim'),
    stopAfterTicks: 1,
    clock: () => 5_000_000,
    sleep: async () => {},
    write: () => {},
    recordBeat: (b) => beats.push(b),
    logFile: path.join(tmpdir('beat2'), 'daemon.log'),
  });
  assert.equal(beats.length, 1);
  q.close();
});

test('a beat that cannot be written does not stop the work, and says so', async () => {
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });
  const lines = [];
  const summary = await runDaemon({
    queue: q,
    owner: OWNER,
    runners: runnerThat('complete'),
    stopAfterTicks: 1,
    clock: () => 5_000_000,
    sleep: async () => {},
    write: (l) => lines.push(l),
    recordBeat: () => { throw new Error('the heartbeat folder is read-only'); },
    logFile: path.join(tmpdir('beat3'), 'daemon.log'),
  });
  assert.equal(summary.worked, 1, 'the job still ran');
  assert.ok(lines.some((l) => /could not record the heartbeat/.test(l)));
  assert.ok(lines.some((l) => /--stale-check/.test(l)), 'and it names where the silence will be reported');
  q.close();
});

test('the beat is throttled — twenty ticks in a minute do not write twenty stamps', async () => {
  const q = openQueue(':memory:');
  const beats = [];
  let now = 5_000_000;
  await runDaemon({
    queue: q,
    owner: OWNER,
    runners: {},
    stopAfterTicks: 20,
    beatEveryMs: 5 * 60 * 1000,
    clock: () => { now += 1000; return now; },
    sleep: async () => {},
    write: () => {},
    recordBeat: (b) => beats.push(b),
    logFile: path.join(tmpdir('beat4'), 'daemon.log'),
  });
  assert.equal(beats.length, 1, '20 seconds of ticks is one beat, not twenty');
  q.close();
});

test('studio-worker is registered as a role AND as a beat emitter', () => {
  // Both halves are required and they are in different files. A role with no
  // emitter reports NOT REPORTING forever; an emitter with no role is a beat
  // nothing judges. This is the pairing the daemon's whole silence alarm rests
  // on, so it is asserted rather than assumed.
  const { ROLES } = require('../../lib/nodeRoles.js');
  const heartbeat = require('../../lib/nodeHeartbeat.js');
  assert.equal(ROLES['studio-worker'].owner, 'mac-mini');
  // Unconditional on purpose. An `if (exported)` guard around this would make
  // the assertion silently stop running the day somebody stops exporting it,
  // which is a test that cannot fail (DOCTRINE: break-test both directions).
  assert.equal(typeof heartbeat.quietAfterFor, 'function');
  assert.equal(heartbeat.quietAfterFor('studio-worker'), 6 * 60 * 60 * 1000,
    'six hours of silence is what Studio 7/8 asked for, and it is derived from the declared cadence');
  assert.equal(heartbeat.BEAT_EMITTERS['studio-worker'].beatMeans, 'liveness');
});

test('the whole loop: claim, run, complete, beat, and report', async () => {
  const q = openQueue(':memory:');
  for (const id of ['a', 'b']) q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: id });
  const lines = [];
  let now = 9_000_000;
  const summary = await runDaemon({
    queue: q,
    owner: OWNER,
    runners: runnerThat('complete'),
    stopAfterTicks: 3,
    clock: () => { now += 1000; return now; },
    sleep: async () => {},
    write: (l) => lines.push(l),
    recordBeat: () => {},
    logFile: path.join(tmpdir('loop'), 'daemon.log'),
  });
  assert.equal(summary.ticks, 3);
  assert.equal(summary.worked, 2, 'two jobs, then nothing left to do');
  assert.equal(q.counts().done, 2);
  assert.ok(lines.some((l) => /ran one ingest job/.test(l)));
  assert.ok(lines.some((l) => /nothing due/.test(l)));
  q.close();
});

test('DEFAULT_LOG_KEEP is a number the installer and the daemon can both rely on', () => {
  assert.ok(Number.isInteger(DEFAULT_LOG_KEEP) && DEFAULT_LOG_KEEP > 0);
});
