'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openQueue, STATES } = require('../../workers/studio/queue.js');
const {
  runDaemon, tickOnce, formatTick, rotateLog, openLogWriter, ownerId,
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

// ── THE WIRING, which is what round 1 actually got wrong ────────────────────
//
// Every test above this line calls `rotateLog` on a file the test itself wrote,
// so they prove the arithmetic and say nothing about whether the daemon's own
// output ever reaches the file being rotated. It did not: `rotateLog` watched
// ~/Studio/logs/daemon.log while every line went to stdout and thence to the
// launchd log, so the capped file was never created and the growing one had no
// cap. Deleting the `rotateLog` call out of `runDaemon` left all 21 tests
// passing, which is how it shipped green. These four drive `runDaemon` itself.

test('runDaemon WRITES ITS LINES INTO THE FILE rotateLog WATCHES', async () => {
  const dir = tmpdir('wiring');
  const logFile = path.join(dir, 'daemon.log');
  const q = openQueue(':memory:');

  await runDaemon({
    queue: q,
    owner: OWNER,
    runners: {},
    stopAfterTicks: 2,
    sleep: async () => {},
    recordBeat: () => {},
    logFile,
    // No `write`: the default writer is the thing under test.
  });

  assert.ok(fs.existsSync(logFile),
    'the log directory and file are created by the daemon, not by a person remembering to');
  const body = fs.readFileSync(logFile, 'utf8');
  assert.match(body, /starting as studio-test-1/, 'the startup line landed in the file');
  assert.match(body, /nothing due/, 'and so did the tick lines');
  assert.match(body, /stopped after 2 tick\(s\)/, 'and the closing line');
  q.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('after a rotation the daemon REOPENS the log — the next line is not written into daemon.log.1', async () => {
  // The obvious fix — point launchd's StandardOutPath at daemon.log — fails
  // exactly here and fails quietly: the rename does not move the open handle,
  // so writing continues into daemon.log.1, which then grows with no cap, while
  // daemon.log never comes back so rotation reports "no log file yet" forever.
  // One rotation, then unbounded growth. This is the test for that.
  const dir = tmpdir('reopen');
  const logFile = path.join(dir, 'daemon.log');
  const q = openQueue(':memory:');

  await runDaemon({
    queue: q,
    owner: OWNER,
    runners: {},
    stopAfterTicks: 4,
    sleep: async () => {},
    recordBeat: () => {},
    logFile,
    logMaxBytes: 1,   // every tick is over the cap, so every tick rolls
    logKeep: 3,
  });

  assert.ok(fs.existsSync(logFile), 'a live daemon.log exists after rotating, not only rolled copies');
  const live = fs.readFileSync(logFile, 'utf8');
  assert.match(live, /stopped after 4 tick\(s\)/,
    'the LAST line written is in the live file — if the handle were stale it would be in daemon.log.1');
  assert.ok(fs.existsSync(path.join(dir, 'daemon.log.1')), 'and it really did rotate');
  q.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the writer does not echo to a non-TTY, so the launchd log is not a second uncapped copy', () => {
  const dir = tmpdir('tty');
  const seen = [];
  const writer = openLogWriter(path.join(dir, 'daemon.log'), {
    stdout: { isTTY: undefined, write: (l) => seen.push(l) },
  });
  writer.write('hello');
  writer.close();
  assert.equal(seen.length, 0, 'under launchd nothing is echoed — that file is the crash catcher only');
  assert.match(fs.readFileSync(path.join(dir, 'daemon.log'), 'utf8'), /hello/);

  // A terminal DOES get it, or a hand-run shows nothing and reads as hung.
  const tty = [];
  const w2 = openLogWriter(path.join(dir, 'other.log'), {
    stdout: { isTTY: true, write: (l) => tty.push(l) },
  });
  w2.write('visible');
  w2.close();
  assert.deepEqual(tty, ['visible\n']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a log file that cannot be opened degrades to stdout and SAYS SO', () => {
  // A daemon that refuses to work because it cannot write its diary is worse
  // than one whose diary is missing (DOCTRINE 3.3: degrade to silence, never to
  // a false negative). /dev/null/... can never be a directory.
  const seen = [];
  const writer = openLogWriter('/dev/null/nope/daemon.log', {
    stdout: { isTTY: undefined, write: (l) => seen.push(l) },
  });
  assert.ok(writer.problem, 'the failure is reported rather than swallowed');
  assert.match(writer.problem, /could not open the log/);
  writer.write('still working');
  assert.deepEqual(seen, ['still working\n'], 'and the line still gets out, via stdout');
  writer.close();
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

test('studio-worker is a role, and is PARKED with a reason rather than silently missing', () => {
  // The daemon emits a beat every five minutes (the four tests above prove it),
  // but the launchd job it would beat from cannot be installed yet: the role is
  // owned by mac-mini and that machine is unreachable until ~2026-10-01. So it
  // is registered as NOT REPORTING WITH THE REASON — the same shelf db-refresh,
  // youtube-media and weekly-report sit on — rather than as an emitter, which
  // would put a QUIET alarm on the bus every six hours for eleven days about a
  // daemon nobody can start and nobody can clear.
  //
  // WHAT THIS TEST IS REALLY GUARDING is that it is never BOTH and never
  // NEITHER. Neither reads as a bug in the tool rather than a gap in the
  // instrumentation; both makes the roll call carry two answers for one role.
  const { ROLES } = require('../../lib/nodeRoles.js');
  const heartbeat = require('../../lib/nodeHeartbeat.js');
  assert.equal(ROLES['studio-worker'].owner, 'mac-mini');
  assert.equal(heartbeat.BEAT_EMITTERS['studio-worker'], undefined,
    'not an emitter while there is nothing installed to beat from');
  assert.ok(heartbeat.NOT_REPORTING_WHY['studio-worker'],
    'but never silently absent — a role in neither column reports a generic "no emitter" line');
  assert.match(heartbeat.NOT_REPORTING_WHY['studio-worker'], /2026-10-01/,
    'and the reason names the unblocking condition, so the row removes itself rather than becoming furniture');

  // The number the acceptance criterion asked for, asserted where it will still
  // be read when this graduates: six hours of silence. quietAfterFor floors at
  // three hours and otherwise takes six intervals, so the hourly cadence named
  // in the parked note produces exactly that.
  assert.equal(typeof heartbeat.quietAfterFor, 'function');
  // The second argument IS the emitter map — quietAfterFor(role, emitters) —
  // so this asks the real function the real question with the cadence the
  // parked note commits to, rather than restating the arithmetic here.
  const asIfInstalled = { 'studio-worker': { intervalMs: 60 * 60 * 1000, beatMeans: 'liveness' } };
  assert.equal(heartbeat.quietAfterFor('studio-worker', asIfInstalled), 6 * 60 * 60 * 1000,
    'six hours of silence is what Studio 7/8 asked for, derived from the hourly cadence it graduates with');
  assert.equal(heartbeat.quietAfterFor('studio-worker'), null,
    'and TODAY it is null: nothing is installed, so there is no silence to measure yet');
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

// ── A runner that returns having done nothing has NOT worked ────────────────
//
// `runIngest` has five early returns that file a health row and return a report
// without throwing — a missing STUDIO_PROJECT_ID is the likeliest one on a
// freshly installed Mini. The daemon read "returned without throwing" as "a job
// ran", logged "ran one ingest job", and slept the BUSY 250ms with the job
// still pending and still due: four ticks a second forever, a sqlite write each
// time, and a log history rolled away in minutes by lines claiming work that
// never happened. Round 2 of 86bbjv68y.

/** A runner in the shape `runIngest`'s early returns take: files a health row, claims nothing, throws nothing. */
function runnerThatDeclines(stage = 'ingest') {
  return {
    [stage]: {
      label: stage,
      run: async ({ queue }) => {
        // The health row goes under its own stage, exactly as `stopThePass` writes it.
        queue.block({
          stage: `${stage}_health`,
          subjectKind: `${stage}_health`,
          subjectId: '/tmp/studio-cache',
          reason: 'STUDIO_PROJECT_ID is not set, so nothing was ingested',
        });
        return { ok: false, ingested: [] };
      },
    },
  };
}

test('a runner that claims nothing did NOT work, so the daemon sleeps the IDLE interval', async () => {
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });
  const sleeps = [];
  const lines = [];

  const summary = await runDaemon({
    queue: q,
    owner: OWNER,
    runners: runnerThatDeclines(),
    stopAfterTicks: 3,
    idleMs: 30_000,
    busyMs: 250,
    sleep: async (ms) => { sleeps.push(ms); },
    write: (l) => lines.push(l),
    recordBeat: () => {},
    logFile: path.join(tmpdir('hotloop'), 'daemon.log'),
  });

  assert.equal(summary.worked, 0,
    'three ticks, nothing claimed, nothing settled — no work happened and the summary must not say it did');
  // Two sleeps, not three: the loop breaks on the tick count BEFORE sleeping.
  assert.deepEqual(sleeps, [30_000, 30_000],
    'every sleep is the idle one; a 250ms busy sleep here is the hot loop, four ticks a second forever');

  // And the job really is exactly where it started, which is what makes the
  // busy sleep indefensible rather than merely optimistic.
  assert.equal(q.counts().pending, 1, 'the job it "ran" is still pending');
  assert.equal(q.counts().done, 0);
  q.close();
});

test('the tick line does not claim a job ran, and says how many are still due', async () => {
  const q = openQueue(':memory:');
  for (const id of ['a', 'b']) q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: id });
  const lines = [];

  await runDaemon({
    queue: q,
    owner: OWNER,
    runners: runnerThatDeclines(),
    stopAfterTicks: 1,
    sleep: async () => {},
    write: (l) => lines.push(l),
    recordBeat: () => {},
    logFile: path.join(tmpdir('hotline'), 'daemon.log'),
  });

  const tick = lines.find((l) => /studio-daemon\] 20/.test(l));
  assert.ok(tick, 'there is a tick line');
  assert.doesNotMatch(tick, /ran one ingest job/,
    'the lie: six of these a second, every one naming work that did not happen');
  // "nothing due" would be just as false — two jobs ARE due (DOCTRINE 5.31).
  assert.doesNotMatch(tick, /nothing due/,
    'and the opposite lie: the queue is not empty, the runner declined it');
  assert.match(tick, /claimed nothing/);
  assert.match(tick, /2 job\(s\) still due/, 'it names the number, so an empty reading says why it is not empty');
  q.close();
});

test('a job that IS claimed and completed still counts as work, and gets the busy sleep', async () => {
  // The other direction — the fix must not make a working daemon crawl. Without
  // this, "worked = false" always would pass the test above and be a worse bug.
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });
  const sleeps = [];

  const summary = await runDaemon({
    queue: q,
    owner: OWNER,
    runners: runnerThat('complete'),
    // Two ticks so the sleep after the working one is actually taken — the loop
    // breaks on the count before sleeping, so a 1-tick run sleeps not at all.
    stopAfterTicks: 2,
    idleMs: 30_000,
    busyMs: 250,
    sleep: async (ms) => { sleeps.push(ms); },
    write: () => {},
    recordBeat: () => {},
    logFile: path.join(tmpdir('busy'), 'daemon.log'),
  });

  assert.equal(summary.worked, 1);
  assert.deepEqual(sleeps, [250], 'a real unit of work goes straight back round');
  assert.equal(q.counts().done, 1);
  q.close();
});

test('a job merely CLAIMED and left running is work too — the queue moved', async () => {
  // `runnerThat(undefined)` claims and returns without settling, which is what a
  // long job looks like from here. Fingerprinting only terminal states would
  // read this as idle and sleep 30s on a daemon that is mid-job.
  const q = openQueue(':memory:');
  q.enqueue({ stage: 'ingest', subjectKind: 'drive_file', subjectId: 'file-a' });
  const report = await tickOnce({ queue: q, owner: OWNER, runners: runnerThat('leave-running') });
  assert.equal(report.worked, true, 'the job went pending -> running, which is a unit of work started');
  assert.equal(q.counts().running, 1);
  q.close();
});

test('DEFAULT_LOG_KEEP is a number the installer and the daemon can both rely on', () => {
  assert.ok(Number.isInteger(DEFAULT_LOG_KEEP) && DEFAULT_LOG_KEEP > 0);
});
