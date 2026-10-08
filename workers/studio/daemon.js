'use strict';

/**
 * The Studio worker daemon — Studio Phase 1, slice 7 of 8.
 *
 * One long-running process on the Mini. It reaps expired leases, asks the
 * queue whether any stage has work due, runs ONE unit of that stage's work,
 * records a heartbeat, and sleeps. Forever.
 *
 * WHAT THIS FILE IS NOT. It does not know how to ingest, probe or encode
 * anything. Slices 2/8 through 6/8 already own those decisions and already own
 * their claim-and-settle discipline; a dispatcher that re-implemented claiming
 * would be a second copy of a safety rule, and two copies of a safety rule are
 * two rules that disagree quietly (the same reasoning that put every
 * environment verdict behind lib/environmentBanner.js). So the registry below
 * maps a stage to the pass that already exists, and this file's whole job is
 * *when* to call it and *what to do when it explodes*.
 *
 * THREE THINGS GO WRONG ON A MACHINE NOBODY IS WATCHING, and each one has its
 * own answer here:
 *
 *   a stage throws     — caught, logged, and any job still leased to THIS
 *                        daemon is failed with the reason. The daemon keeps
 *                        going. A pass that dies must not take the lane with
 *                        it.
 *   the process dies   — launchd restarts it (scripts/install_studio_worker.sh,
 *                        KeepAlive), and the job it was holding comes back on
 *                        its own when `reap()` finds the expired lease. That is
 *                        why the queue leases rather than locks: a lock
 *                        released on exit is exactly the thing a `kill -9` does
 *                        not do.
 *   the daemon stops   — and stopping is SILENT, which is the worst of the
 *   firing              three. It beats below, every five minutes, whatever
 *                        the tick concluded. The ALARM on that silence is
 *                        parked until the daemon is actually installed on the
 *                        Mini (lib/nodeHeartbeat.js, NOT_REPORTING_WHY ->
 *                        `studio-worker`, unblocking ~2026-10-01): an alarm
 *                        about a daemon nobody can start is an alarm nobody
 *                        can clear. Parked WITH THE REASON, never as healthy —
 *                        degrade to silence being noticed, not to a false
 *                        negative (DOCTRINE 3.3). The beat itself runs now, so
 *                        graduating it is one entry and no new behaviour.
 *
 * NO `setInterval` AT MODULE SCOPE (DOCTRINE 5.2 — it hangs every test).
 * Nothing in this file schedules anything until `runDaemon` is called, and
 * `tickOnce` — which is what the tests drive — schedules nothing at all.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openQueue, STATES } = require('./queue.js');
const { runIngest, STAGE_INGEST } = require('./ingest.js');
const { watchDrive, STAGE_WATCH } = require('./drive.js');
const { runProbe, STAGE_PROBE } = require('./probePass.js');
const { runProxy, STAGE_PROXY } = require('./proxyPass.js');
const { runTranscribe, STAGE_TRANSCRIBE } = require('./transcribePass.js');

/** How long to wait after a tick that found nothing to do. */
const DEFAULT_IDLE_MS = 30 * 1000;
/** How long to wait after a tick that DID do something — go straight round. */
const DEFAULT_BUSY_MS = 250;
/** How often the reaper runs. Cheap, and the only thing that recovers a crash. */
const DEFAULT_REAP_EVERY_MS = 60 * 1000;
/**
 * How often a beat is written.
 *
 * Five minutes, against a declared cadence of one hour in lib/nodeHeartbeat.js
 * and therefore a six-hour silence threshold. The margin is deliberate, and it
 * covers tick JITTER — a tick that took longer than usual, a machine briefly
 * busy — for the cost of a local file write, which is nothing.
 *
 * WHAT IT DOES NOT COVER, and an earlier version of this comment claimed it
 * did: a single slow job. The beat is written BETWEEN ticks, so nothing at all
 * is written while the loop is inside a stage — and a two-hour encode of a
 * wedding video is an ordinary Tuesday here. Beating oftener cannot help with
 * that; only beating from inside the job can, which is a stage-level change
 * this slice does not make. It costs nothing today because the role is parked
 * (NOT_REPORTING_WHY -> `studio-worker`) and no alarm reads these beats yet.
 * IT IS THE CONDITION TO SETTLE BEFORE THE ROLE GRADUATES: with the encode
 * stage wired in, a healthy daemon doing exactly its job would breach a
 * six-hour threshold, which is a false alarm and the far side of DOCTRINE 3.3.
 */
const DEFAULT_BEAT_EVERY_MS = 5 * 60 * 1000;

/**
 * How often the Drive watch looks for new footage: once a minute.
 *
 * NOT MEASURED — chosen, and here is the arithmetic it was chosen on. One watch
 * pass is about five requests to Google, not one: `getAccessToken` exchanges
 * the refresh token every time (lib/googleDrive.js caches nothing), then the
 * account, one folder check per configured lane, and at least one page of the
 * changes feed. Once a minute is ~7,200 requests a day, against Drive's default
 * allowance of 12,000 a MINUTE per user — so the quota block `fixFor('quota')`
 * describes ("the watch interval is too tight") cannot come from this cadence
 * alone. Going tighter buys nothing a person would notice: a file only reaches
 * Inbox after an upload that takes minutes, and the ingest download behind it
 * takes longer still. Going much looser starts to read as "I dropped it in and
 * nothing happened".
 *
 * IT IS A FLOOR, NOT A TIMER. The watch runs inside a tick, and no tick runs
 * while a stage is mid-job — so during a two-hour encode nothing looks at Drive
 * for two hours. That costs nothing: the cursor is saved in the queue, and the
 * first watch afterwards reads every change it missed, page by page.
 */
const DEFAULT_DRIVE_WATCH_EVERY_MS = 60 * 1000;

/** Rotate at 8 MB, keep 5 — about six weeks of ordinary logging. */
const DEFAULT_LOG_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_LOG_KEEP = 5;

/** The role name this daemon beats under. Must match lib/nodeRoles.js. */
const ROLE = 'studio-worker';

/**
 * THE STAGE REGISTRY — which stages this daemon knows how to run.
 *
 * Each entry's `run` performs AT MOST ONE job: it claims it, does the work, and
 * settles it (complete / fail / release / block). That contract is what lets
 * this file stay out of the claiming business entirely.
 *
 * `ingest`, `probe` and `proxy` are the queue-driven passes; each enqueues the
 * next for every source it finishes (ingest → probe at `downloaded`, probe →
 * proxy at `probed`, proxy ends at `ready` — workers/studio/probePass.js and
 * proxyPass.js). `drive.watch` is cursor-driven rather than job-driven, so it
 * runs from WATCHERS below instead. A job waiting on a stage with no runner
 * (transcription, one day) is REPORTED rather than ignored, because a
 * queue that quietly holds work nobody is doing is a queue that lies about
 * being empty (DOCTRINE 3.11). See `unhandled` in the tick report.
 */
const STAGE_RUNNERS = {
  [STAGE_INGEST]: {
    label: 'ingest',
    run: ({ queue, owner, env }) => runIngest({ queue, owner, env, max: 1 }),
  },
  [STAGE_PROBE]: {
    label: 'probe',
    run: ({ queue, owner, env }) => runProbe({ queue, owner, env, max: 1 }),
  },
  [STAGE_PROXY]: {
    label: 'proxy',
    run: ({ queue, owner, env }) => runProxy({ queue, owner, env, max: 1 }),
  },
  [STAGE_TRANSCRIBE]: {
    label: 'transcribe',
    run: ({ queue, owner, env }) => runTranscribe({ queue, owner, env, max: 1 }),
  },
};

/**
 * THE WATCHERS — passes that run on a CLOCK rather than because a job is due.
 *
 * `drive.watch` is the reason this list exists. It is the only thing that puts
 * an `ingest` job on the queue (drive.js `consumeChange`), so it cannot wait
 * for a job to ask for it: with only the runner registry, a file dropped into
 * /Studio/Inbox/ was noticed by nothing at all, ingest had nothing to claim,
 * and the daemon reported "nothing due" — truthfully, every tick, for ever.
 *
 * A watcher keeps its own position (Drive's cursor lives in the queue's
 * `drive_cursor` table), so running it twice costs requests, never duplicate
 * work. It reports its own failures on the queue — `needsAPerson` failures as
 * ONE blocked `drive.watch` row, refreshed rather than duplicated, and cleared
 * by the next clean pass — so the daemon's only jobs are when to call it and
 * keeping a throw from taking the lane down.
 *
 * `drive` is a seam for the tests; left undefined, `watchDrive` uses the real
 * Google client.
 */
const WATCHERS = {
  [STAGE_WATCH]: {
    label: 'drive watch',
    everyMs: DEFAULT_DRIVE_WATCH_EVERY_MS,
    run: ({ queue, env, drive }) => watchDrive({ queue, env, ...(drive ? { drive } : {}) }),
  },
};

function text(value) {
  return String(value == null ? '' : value).trim();
}

/** Where the queue file lives. `STUDIO_QUEUE_FILE` wins; otherwise ~/Studio. */
function resolveQueueFile(options = {}, env = process.env, homedir = os.homedir()) {
  return text(options.queueFile) || text(env.STUDIO_QUEUE_FILE) || path.join(homedir, 'Studio', 'queue.sqlite');
}

/** Where the daemon's own log lives. `STUDIO_LOG_DIR` wins; otherwise ~/Studio/logs. */
function resolveLogFile(options = {}, env = process.env, homedir = os.homedir()) {
  if (text(options.logFile)) return text(options.logFile);
  const dir = text(env.STUDIO_LOG_DIR) || path.join(homedir, 'Studio', 'logs');
  return path.join(dir, 'daemon.log');
}

/**
 * Who this daemon is, to the queue.
 *
 * The PID is in it ON PURPOSE. Two daemons on one machine would otherwise share
 * an owner id, and `heartbeat`, `complete` and `fail` are all guarded on
 * `lease_owner = ?` — a shared id would let a restarted daemon settle a job the
 * previous life is still working on, which is the double-processing the whole
 * lease design exists to prevent. A restart gets a new PID, so it gets a new
 * identity, so the job it left behind comes back through `reap` like any other
 * abandoned lease rather than being silently adopted mid-flight.
 */
function ownerId({ node = os.hostname(), pid = process.pid } = {}) {
  return `studio-${String(node).split('.')[0]}-${pid}`;
}

/**
 * Roll the log over if it has grown past `maxBytes`, keeping `keep` old copies.
 *
 * SIZE, NOT AGE. A week of running must not fill the disk, and the thing that
 * fills a disk is a job failing in a loop and writing a megabyte a minute —
 * which a daily rotation would happily let run for 23 more hours. The size cap
 * bounds the worst case directly.
 *
 * It renames rather than truncating, and it never touches the file it cannot
 * stat. A rotation that throws would take the daemon down on a full disk, which
 * is precisely the moment it is most needed; every failure here is reported in
 * the return value and swallowed.
 */
function rotateLog(file, { maxBytes = DEFAULT_LOG_MAX_BYTES, keep = DEFAULT_LOG_KEEP, io = fs } = {}) {
  let size;
  try {
    size = io.statSync(file).size;
  } catch (err) {
    // No log yet is the ordinary case on a fresh machine, and is not a fault.
    return { rotated: false, why: err.code === 'ENOENT' ? 'no log file yet' : `could not stat the log: ${err.message}` };
  }
  if (size <= maxBytes) return { rotated: false, why: `log is ${size} bytes, under the ${maxBytes}-byte cap`, size };

  try {
    // Oldest first, so nothing is overwritten before it has been shifted along.
    // There is no unlink of the oldest copy and there does not need to be:
    // `renameSync` replaces its destination, so `.{keep-1}` -> `.{keep}` drops
    // the old `.{keep}` on its own. A `keep`th file therefore cannot survive,
    // which is what bounds the disk. (The first draft unlinked it first; a
    // break-test could not make that line matter, which is how it was found to
    // be doing nothing.)
    for (let n = keep - 1; n >= 1; n -= 1) {
      const from = path.join(path.dirname(file), `${path.basename(file)}.${n}`);
      const to = path.join(path.dirname(file), `${path.basename(file)}.${n + 1}`);
      try { io.renameSync(from, to); } catch (_) { /* absent is the normal case */ }
    }
    io.renameSync(file, path.join(path.dirname(file), `${path.basename(file)}.1`));
    return { rotated: true, why: `log reached ${size} bytes (cap ${maxBytes})`, size, keep };
  } catch (err) {
    return { rotated: false, why: `rotation failed: ${err.message}`, size };
  }
}

/**
 * THE DAEMON'S OWN LOG FILE — opened for append, and REOPENED AFTER A ROTATION.
 *
 * This is the half that was missing when slice 7 first shipped, and the failure
 * had the exact shape the rotation was written to prevent. `rotateLog` watched
 * ~/Studio/logs/daemon.log; nothing ever wrote to it, because the daemon's only
 * output was `process.stdout.write` and launchd sends that to
 * ~/Library/Logs/com.starcaster.studio-worker.launchd.log. So the file with the
 * cap was never created — `statSync` returned ENOENT on every tick for the life
 * of the machine, and `rotations` was structurally always 0 — while the file
 * that actually grew had no cap at all.
 *
 * WHY THE DAEMON OPENS THE FILE RATHER THAN LAUNCHD. Pointing StandardOutPath
 * at daemon.log fixes nothing: launchd opens that file once at launch and holds
 * the handle, and a rename does not move an open handle. The writes would keep
 * going into daemon.log.1, which then grows without a cap, while daemon.log no
 * longer exists so rotation goes back to "no log file yet" forever. One
 * rotation, then unbounded growth — the same bug wearing a different hat. The
 * daemon owning the handle is what makes `reopen()` possible, and `reopen()` is
 * the whole fix.
 *
 * AND IT DOES NOT ECHO TO STDOUT UNDER LAUNCHD. If every line went to both, the
 * launchd log would be a second, uncapped copy of the one being capped. stdout
 * gets the line only when it is a terminal — i.e. when a person is running this
 * by hand and wants to see it — which is what makes the plist's claim that the
 * launchd log "only catches what escapes" actually true.
 *
 * Every failure here degrades to stdout and is reported. A daemon that refuses
 * to work because it cannot write its own diary is worse than one whose diary
 * is missing.
 */
function openLogWriter(file, { io = fs, stdout = process.stdout } = {}) {
  const writer = { file, problem: null };
  let fd = null;

  function open() {
    try {
      io.mkdirSync(path.dirname(file), { recursive: true });
      fd = io.openSync(file, 'a');
      writer.problem = null;
    } catch (err) {
      fd = null;
      writer.problem = `could not open the log ${file}: ${err.message} — log lines are going to stdout instead, where launchd will catch them`;
    }
  }

  function close() {
    if (fd === null) return;
    try { io.closeSync(fd); } catch (_) { /* a handle we cannot close is a handle we are done with */ }
    fd = null;
  }

  open();

  writer.write = (line) => {
    let landed = false;
    if (fd !== null) {
      try {
        io.writeSync(fd, `${line}\n`);
        landed = true;
      } catch (err) {
        close();
        writer.problem = `could not write to the log ${file}: ${err.message} — log lines are going to stdout instead`;
      }
    }
    // Not `else`: a TTY gets the line as well as the file, so a hand-run shows
    // its work. Under launchd `isTTY` is undefined and this writes nothing.
    if (!landed || (stdout && stdout.isTTY)) stdout.write(`${line}\n`);
  };
  writer.reopen = () => { close(); open(); };
  writer.close = close;
  return writer;
}

/**
 * WHAT THE QUEUE SAYS ABOUT ONE STAGE, in a form two readings can be compared by.
 *
 * This exists because "the runner returned without throwing" is NOT the same
 * question as "a unit of work happened", and the daemon used to treat them as
 * one. `runIngest` has five early returns that file a health row and return a
 * report — no throw — leaving the pending job pending and immediately due:
 * `STUDIO_PROJECT_ID` unset, a junk disk floor, junk Drive timeouts, a cache
 * disk `statfs` cannot read, and free space under the floor. The first of those
 * is the likeliest state of the Mini the first time this daemon is installed.
 * On that reading the daemon logged "ran one ingest job", slept the BUSY 250ms
 * and came straight back — four ticks a second, forever, each one writing a
 * `queue.block` row, pegging a core on the machine that is meant to be encoding
 * video, and rolling the whole log history away in minutes while every line
 * claimed work that never happened. Found by review round 2 of 86bbjv68y.
 *
 * So the verdict is taken from the QUEUE, which cannot be fooled by a return
 * value. Non-terminal jobs are fingerprinted individually — a claim, a settle,
 * a retry and a backoff all move one of these fields — and terminal ones are
 * counted, so a job completing during the tick changes the reading too.
 *
 * SCOPED TO THE STAGE THAT RAN, deliberately. `stopThePass` writes its health
 * row under a DIFFERENT stage, so a whole-queue reading would see that write
 * and call it work — which is the very hot loop this is here to stop.
 */
function stageFingerprint(queue, stage) {
  const live = [];
  let settled = 0;
  for (const job of queue.listJobs({ stage })) {
    if (job.state === STATES.PENDING || job.state === STATES.RUNNING) {
      live.push(`${job.id}:${job.state}:${job.attempts}:${job.recoveries}:${job.runAfter}:${job.leaseOwner}`);
    } else {
      settled += 1;
    }
  }
  return `${settled}|${live.join(',')}`;
}

/**
 * ONE TICK. Reap, find a stage with work due, run one job of it, report.
 *
 * Pure of timers and of process state, so the tests drive it directly rather
 * than through a loop they would then have to stop. Everything it did is in
 * the returned report — including the things it could not do.
 */
async function tickOnce({
  queue,
  owner,
  env = process.env,
  runners = STAGE_RUNNERS,
  watchers = WATCHERS,
  // When each watcher last ran, keyed by its stage. The CALLER owns this object
  // and passes the same one every tick — that is what lets `tickOnce` stay free
  // of process state while the cadence still holds across ticks. A fresh `{}`
  // (the default) means "never ran", so a lone tick always watches.
  watchedAt = {},
  drive,
  now = Date.now(),
  reap = true,
}) {
  if (!queue) throw new Error('tickOnce needs a queue (workers/studio/queue.js)');
  const report = {
    at: new Date(now).toISOString(),
    owner,
    reaped: null,
    stage: null,
    // `ranStage` is "a runner was called"; `worked` is "the queue moved". They
    // are different questions and conflating them is defect 1 above.
    ranStage: false,
    worked: false,
    stillDue: 0,
    result: null,
    error: null,
    failedJobs: [],
    unhandled: [],
    // One entry per watcher that was DUE this tick. A watcher that was not due
    // is absent rather than listed as skipped: once a minute against a tick
    // every 30 seconds, "not due" is the ordinary state of half the ticks.
    watched: [],
  };

  if (reap) report.reaped = queue.reap();

  // WATCH BEFORE RUNNING, so a file Drive reports this tick is due for the
  // runner loop below in the same tick rather than a whole idle sleep later.
  // And a watch that fails is reported and walked past — its failure is about
  // Google, and the jobs already on the queue do not depend on Google being up.
  for (const [stage, watcher] of Object.entries(watchers)) {
    const last = watchedAt[stage];
    if (last != null && now - last < watcher.everyMs) continue;
    // Stamped whether it succeeds or not. A watch that fails every time must
    // still be held to its cadence, or a dead credential would be retried on
    // every tick — which is the retry storm drive.js exists to refuse.
    watchedAt[stage] = now;
    const entry = { stage, label: watcher.label || stage, result: null, error: null };
    try {
      entry.result = await watcher.run({ queue, owner, env, now, drive });
    } catch (err) {
      entry.error = { message: err.message, stack: err.stack };
    }
    report.watched.push(entry);
  }

  // Stages with work due but no runner. Asked BEFORE anything is claimed, so
  // the answer is about the queue rather than about what this tick happened to
  // pick up, and reported on every tick that sees one.
  for (const job of queue.listJobs({ state: STATES.PENDING })) {
    if (runners[job.stage]) continue;
    if (!report.unhandled.some((u) => u.stage === job.stage)) {
      report.unhandled.push({
        stage: job.stage,
        why: 'no runner is registered for this stage in workers/studio/daemon.js, so nothing is doing this work',
      });
    }
  }

  for (const stage of Object.keys(runners)) {
    const due = queue.waiting({ stage });
    if (!due || due.dueNow <= 0) continue;
    report.stage = stage;
    report.ranStage = true;
    const before = stageFingerprint(queue, stage);
    try {
      report.result = await runners[stage].run({ queue, owner, env, now });
      // NOT `true`. See stageFingerprint above: a runner that returns having
      // claimed nothing has not worked, and saying it did costs the busy sleep.
      report.worked = stageFingerprint(queue, stage) !== before;
    } catch (err) {
      // A STAGE THAT THREW IS NOT A LANE THAT STOPS. The pass owns settling its
      // own job and did not get to; anything still leased to THIS daemon is
      // failed with the reason, so it retries on its own backoff and reaches
      // `blocked` with a readable error rather than sitting `running` until the
      // lease expires. Guarded on the owner id, so a job another daemon claimed
      // in the meantime is not touched.
      report.error = { stage, message: err.message, stack: err.stack };
      for (const job of queue.listJobs({ state: STATES.RUNNING })) {
        if (job.leaseOwner !== owner) continue;
        const reason = `the ${stage} stage threw and did not report on this job: ${err.message}`;
        if (queue.fail(job.id, owner, reason)) report.failedJobs.push({ id: job.id, reason });
      }
    }
    break; // one unit of work per tick; the loop comes straight back round
  }

  // Asked AFTER the runner, so a tick that ran a stage and moved nothing can
  // say how much is still sitting there rather than printing "nothing due",
  // which would be flatly false (DOCTRINE 5.31 — an empty reading that does
  // not say why reads as a broken one).
  if (report.stage) report.stillDue = queue.waiting({ stage: report.stage }).dueNow;

  return report;
}

/** One line per tick, in the shape a person reads at 8am with no context. */
function formatTick(report) {
  const parts = [`[studio-daemon] ${report.at}`];
  if (report.reaped && (report.reaped.recovered || report.reaped.blocked)) {
    parts.push(`reaped ${report.reaped.recovered} expired lease(s), ${report.reaped.blocked} gave up for good`);
  }
  for (const w of report.watched || []) parts.push(formatWatch(w));
  if (report.error) {
    parts.push(`${report.stage} THREW: ${report.error.message}`);
    parts.push(report.failedJobs.length
      ? `failed job(s) ${report.failedJobs.map((j) => j.id).join(', ')} with that reason — the daemon is still running`
      : 'no job was left leased to this daemon, so nothing needed failing — the daemon is still running');
  } else if (report.worked) {
    parts.push(`ran one ${report.stage} job`);
  } else if (report.ranStage) {
    // THE THIRD OUTCOME, and the one that used to be invisible. The stage had
    // work due and its runner declined it without throwing — the shape
    // `runIngest` takes when it cannot start at all. "nothing due" here would
    // be a lie about a queue with jobs in it, and "ran one job" was the lie it
    // actually told, so say the true thing and name where the reason is.
    parts.push(`the ${report.stage} stage ran and claimed nothing — ${report.stillDue} job(s) still due`);
    parts.push('nothing moved, so the reason is on the queue, not here: read the blocked rows for this stage (the ingest health row names a missing STUDIO_PROJECT_ID, an unreadable cache disk or a full one)');
  } else if (!report.unhandled.length) {
    parts.push('nothing due');
  }
  for (const u of report.unhandled) parts.push(`WAITING WITH NOBODY ON IT: stage "${u.stage}" — ${u.why}`);
  return parts.join(' — ');
}

/**
 * One watcher's outcome, in the tick line.
 *
 * Read off the watch report rather than restated, and with the SAME four
 * verdicts drive.js's own `formatReport` headline uses — OK, BLOCKED, FINISHED
 * WITH FAILURES, COULD NOT TELL — so "could not tell" never reads as a quiet
 * clean pass. A blocked watch carries its reason in full: that sentence names
 * the errand (re-mint the token, fix a folder id), and the tick line is where a
 * person reading the log at 8am will see it first.
 */
function formatWatch(w) {
  if (w.error) return `${w.label} THREW: ${w.error.message} — the stages still ran this tick`;
  const r = w.result || {};
  if (r.blocked) return `${w.label} BLOCKED (${r.blocked.kind}): ${r.blocked.reason}`;
  const queued = Array.isArray(r.processed) ? r.processed.length : 0;
  const skipped = Array.isArray(r.skipped) ? r.skipped.length : 0;
  const failed = Array.isArray(r.failed) ? r.failed.length : 0;
  const blind = Array.isArray(r.blind) ? r.blind.length : 0;
  let verdict = 'OK';
  if (!r.ok) verdict = failed ? 'FINISHED WITH FAILURES' : 'COULD NOT TELL';
  const bits = [`${w.label} ${verdict}: ${queued} new file(s) queued, ${skipped} skipped, ${failed} failed`];
  if (r.cursor && r.cursor.initialised) bits.push('started watching from now, nothing replayed');
  if (blind) bits.push(`${blind} thing(s) it could not check`);
  if (r.recovered) bits.push('the previous block has cleared');
  return bits.join(', ');
}

/**
 * The daemon proper. Runs until it is asked to stop.
 *
 * `stopAfterTicks` exists for the tests and for a hand-run smoke check; the
 * real process runs with it unset and stops on SIGTERM/SIGINT, AFTER the tick
 * in flight finishes. Killing a pass mid-job strands its lease for the reap
 * interval, which is recoverable but wasteful, and launchd sends SIGTERM first
 * precisely so a process can decline to be rude about it.
 */
async function runDaemon(options = {}) {
  const {
    env = process.env,
    runners = STAGE_RUNNERS,
    watchers = WATCHERS,
    drive,
    idleMs = DEFAULT_IDLE_MS,
    busyMs = DEFAULT_BUSY_MS,
    reapEveryMs = DEFAULT_REAP_EVERY_MS,
    beatEveryMs = DEFAULT_BEAT_EVERY_MS,
    logMaxBytes = DEFAULT_LOG_MAX_BYTES,
    logKeep = DEFAULT_LOG_KEEP,
    stopAfterTicks = 0,
    clock = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    write: writeOption = null,
    recordBeat = null,
    node = os.hostname(),
    // A seam, so a test can watch the handle this function OPENS get closed.
    // "the queue was left open" is otherwise invisible from outside the
    // process, which is how the leak below survived a review.
    open = openQueue,
  } = options;

  const owner = text(options.owner) || ownerId({ node });
  const queueFile = resolveQueueFile(options, env);
  const logFile = resolveLogFile(options, env);
  const queue = options.queue || open(queueFile);

  // The default writer IS the file `rotateLog` watches — that wiring is the
  // defect this slice was sent back for, so it is not an option with a
  // fallback. A caller that passes its own `write` (the tests, a smoke run)
  // opts out of the file entirely and out of rotating it.
  const writer = writeOption ? null : openLogWriter(logFile);
  const write = writeOption || ((line) => writer.write(line));

  let stopping = false;
  const stop = () => { stopping = true; };
  const ownsSignals = !options.queue && !stopAfterTicks;
  if (ownsSignals) {
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }

  write(`[studio-daemon] starting as ${owner} — queue ${queueFile}, log ${logFile}`);
  if (writer && writer.problem) write(`[studio-daemon] ${writer.problem}`);

  let lastReap = 0;
  let lastBeat = 0;
  const watchedAt = {};
  let ticks = 0;
  const summary = { ticks: 0, worked: 0, errors: 0, beats: 0, rotations: 0, owner, queueFile, logFile };

  while (!stopping) {
    const now = clock();
    const rotation = rotateLog(logFile, { maxBytes: logMaxBytes, keep: logKeep });
    if (rotation.rotated) {
      // REOPEN BEFORE THE NEXT LINE IS WRITTEN. The rename moved the file, not
      // our open handle: without this, every line from here on lands in
      // daemon.log.1, daemon.log never comes back, and nothing is ever capped
      // again. The rotation message below is itself the first line of the new
      // file, so a log always says why it starts where it does.
      if (writer) writer.reopen();
      summary.rotations += 1;
      write(`[studio-daemon] rotated the log — ${rotation.why}`);
    }

    const report = await tickOnce({
      queue, owner, env, runners, watchers, watchedAt, drive, now,
      reap: now - lastReap >= reapEveryMs,
    });
    if (report.reaped) lastReap = now;
    summary.ticks += 1;
    if (report.worked) summary.worked += 1;
    if (report.error) summary.errors += 1;
    write(formatTick(report));

    // THE BEAT IS LIVENESS, NOT SUCCESS, and it is recorded whatever the tick
    // concluded — including a tick that found nothing to do and a tick whose
    // stage threw. What this catches is the DAEMON going quiet; whether the
    // work is any good is the queue's own `blocked` column, which a person can
    // read. A beat that only fired on a successful job would report a healthy
    // idle machine as dead every quiet weekend.
    // THE CLOCK IS READ AGAIN HERE, after the tick rather than before it. `now`
    // is the instant the tick STARTED, so beating with it stamped a beat that
    // was already as old as the job that had just run — on a two-hour encode,
    // two hours old the moment it was written, which is the one reading a
    // staleness check must never be given.
    const beatAt = clock();
    if (beatAt - lastBeat >= beatEveryMs) {
      lastBeat = beatAt;
      try {
        const beat = recordBeat || require('../../lib/nodeHeartbeat.js').recordBeat;
        beat({ role: ROLE, node, at: new Date(beatAt).toISOString() });
        summary.beats += 1;
      } catch (err) {
        // A beat that could not be written must never stop the work. The
        // silence it causes is itself the alarm, which is the whole design.
        write(`[studio-daemon] could not record the heartbeat: ${err.message} — the work continues, and the missing beat will be reported by npm run heartbeat -- --stale-check`);
      }
    }

    ticks += 1;
    if (stopAfterTicks && ticks >= stopAfterTicks) break;
    if (!stopping) await sleep(report.worked ? busyMs : idleMs);
  }

  if (ownsSignals) {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
  // CLOSING IS ABOUT WHO OPENED IT, NOT ABOUT WHO OWNED THE SIGNALS. These were
  // nested, and `ownsSignals` is false whenever `stopAfterTicks` is set — so the
  // hand-run smoke check this file's own comment describes opened
  // ~/Studio/queue.sqlite and walked away from the handle. A caller that passed
  // its own queue still closes its own queue.
  if (!options.queue) queue.close();
  write(`[studio-daemon] stopped after ${summary.ticks} tick(s): ${summary.worked} job(s) run, ${summary.errors} stage error(s), ${summary.beats} beat(s).`);
  if (writer) writer.close();
  return summary;
}

module.exports = {
  runDaemon,
  tickOnce,
  formatTick,
  formatWatch,
  // Exported for their own tests. Each is a decision that can be wrong on its
  // own, and driving a whole daemon loop to check one boundary is how a test
  // ends up asserting nothing in particular.
  rotateLog,
  openLogWriter,
  ownerId,
  resolveQueueFile,
  resolveLogFile,
  STAGE_RUNNERS,
  WATCHERS,
  ROLE,
  DEFAULT_IDLE_MS,
  DEFAULT_BUSY_MS,
  DEFAULT_REAP_EVERY_MS,
  DEFAULT_BEAT_EVERY_MS,
  DEFAULT_DRIVE_WATCH_EVERY_MS,
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_LOG_KEEP,
};

// Run it when this file is the program, not when it is required by a test.
if (require.main === module) {
  runDaemon().catch((err) => {
    process.stderr.write(`[studio-daemon] stopped by an unexpected error: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
