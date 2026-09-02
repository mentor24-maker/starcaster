#!/usr/bin/env node
/**
 * `npm run throughput` — is the queue getting shorter?
 *
 * The counterpart to `npm run heartbeat`. That one reports LIVENESS: did a job
 * stop firing? This one reports THROUGHPUT: the job fired, and did anything
 * come out the other end?
 *
 * A heartbeat structurally cannot answer the second question. On 2026-08-31
 * the build loop fired every hour, exited 0 every time, and the queue did not
 * move — 52 queued, 1 in review, the oldest rework PR sitting since Aug 25.
 * Every gate was green and every green was honest. Finding it took a morning
 * of reading logs by hand (ticket 86bbqrw3p).
 *
 *   npm run throughput                  read everything, print the report, write nothing
 *   npm run throughput -- --check       the same, and post to the bus on STALLED or UNKNOWN
 *   npm run throughput -- --check --dry-run   say what it WOULD post, send nothing
 *
 * Exit codes, because scripts branch on this:
 *   0  MOVING or IDLE — the pipeline is fine, or had nothing to do
 *   1  STALLED
 *   2  UNKNOWN — a reading needed for the verdict could not be taken. NEVER
 *      rendered as healthy (docs/DOCTRINE.md 3.11)
 *
 * UNKNOWN POSTS TOO, SINCE 2026-09-01 (task 86bbr2jpq). It did not, and that
 * was the quietest failure in the file: run_bus_relay.sh discards this exit
 * code with `|| true`, so the one state whose entire purpose is "a monitor
 * must not fail quietly" reached nobody. A rotated ClickUp token left the
 * stall detector permanently dead with every other job looking fine.
 *
 * The decisions live in lib/loopThroughput.js (pure, no network, fully tested).
 * This file is the IO: the ClickUp read, the `gh` read, the suppression stamp
 * and the bus post.
 *
 * WHERE IT RUNS. Same trick as the heartbeat watchdog, and for the same
 * reason: a check that runs only where the thing it watches runs cannot detect
 * that machine being switched off. scripts/run_bus_relay.sh calls this BEFORE
 * it asks whether it owns the relay, so the non-owning machine's idle wake-up
 * — the one vantage point that survives the owning machine being dead — is
 * where the reading is taken.
 *
 * NOTHING HERE MAY FAIL THE JOB THAT CALLS IT. run_bus_relay.sh guards the
 * call with `|| true` exactly as it does the heartbeat's.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const throughput = require('../lib/loopThroughput.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');
const clickup = require('./lib/clickup.cjs');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const CHECK = flag('check');
const DRY = flag('dry-run');
const DAYS = Number(arg('days', String(throughput.REPORT_DAYS))) || throughput.REPORT_DAYS;
const NOW = Date.now();
const NODE = nodeRoles.thisNode();

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);

// --- the two reads ----------------------------------------------------------

/**
 * Every Loop Queue ticket, CLOSED ONES INCLUDED.
 *
 * `include_closed` is not optional here and its absence would be silent: `Live`
 * is a closed-type status, so without it ClickUp returns only the open work and
 * the headline number — tickets closed per day — is a confident zero on a week
 * where 67 things shipped. That is the same trap `stage-counts` documents.
 */
async function readQueue() {
  try {
    const tasks = await clickup.listTasks(LOOP_QUEUE_LIST, { includeClosed: true });
    if (!Array.isArray(tasks) || !tasks.length) return { tasks: null, why: 'no tasks came back' };
    return { tasks, why: null };
  } catch (err) {
    return { tasks: null, why: String(err?.message || err).slice(0, 200) };
  }
}

/**
 * Open pull requests, with the fields `wipCap.classifyPrs` needs.
 *
 * `body` is REQUIRED and its absence is silent too: that is how a PR is matched
 * to its ticket, and without it every PR falls into "no ticket found" and the
 * rework bucket reads empty. `createdAt` is this file's own addition — the
 * bucket comes from classifyPrs, the ages are looked up beside it.
 */
function readOpenPrs() {
  const out = spawnSync('gh', [
    'pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,state,body,createdAt',
  ], { encoding: 'utf8' });
  if (out.error) {
    const why = out.error.code === 'ENOENT'
      ? 'the `gh` command is not installed on this machine'
      : String(out.error.message);
    return { prs: null, why };
  }
  if (out.status !== 0) return { prs: null, why: String(out.stderr || '').trim().slice(0, 200) || 'gh failed' };
  try {
    const prs = JSON.parse(String(out.stdout || ''));
    return Array.isArray(prs) ? { prs, why: null } : { prs: null, why: 'gh returned something that is not a list' };
  } catch {
    return { prs: null, why: 'gh returned output that is not JSON' };
  }
}

// --- suppression ------------------------------------------------------------

/**
 * One post per 6 hours, cleared by the next non-stalled run — the same
 * discipline scripts/report_job_failure.mjs uses, and the stamp lives beside
 * its stamps for the same reason: it is a fact about this MACHINE's posting,
 * not about the code, so it must not vanish when a worktree is removed.
 *
 * Cleared by a recovery rather than by a timer, so a stall that is fixed and
 * returns is announced again straight away instead of being swallowed by a
 * window the earlier stall opened.
 */
const stampFile = `${heartbeat.heartbeatDir()}/stalled-loop-queue.stamp`;

/**
 * The last time a reading was TAKEN, which is a different question from the
 * last time one was posted.
 *
 * run_bus_relay.sh wakes every ten minutes. This check costs a full Loop Queue
 * read (three ClickUp pages at 215 tickets) plus a `gh pr list` — call it four
 * API calls, 576 a day, to watch a signal whose window is 24 HOURS. That is
 * 144 times more often than the thing it measures can meaningfully change, and
 * this workspace already runs close enough to ClickUp's per-minute limit that
 * the loop commands print how much of it is left.
 *
 * So `--check` takes a fresh reading at most once an hour. Still 24 readings a
 * day against a 24-hour window, which is ample, and a stall that is real at
 * 2pm is still real at 3pm. A hand-run `npm run throughput` is never throttled
 * — a person asking the question wants today's answer, not the last one.
 */
const readStampFile = `${heartbeat.heartbeatDir()}/throughput-read.stamp`;
const READ_EVERY_MS = 60 * 60 * 1000;

/**
 * One post per 6 hours for an UNKNOWN verdict, cleared by the next pass that
 * CAN take a reading — the same discipline the stall stamp above uses, and the
 * same folder, for the same reason.
 *
 * WHY THERE IS A SECOND STAMP RATHER THAN ONE SHARED ONE. A stall and a
 * cannot-read are different findings with different repairs, and they can
 * follow each other: the token is rotated on Monday (UNKNOWN), fixed on
 * Tuesday, and the queue turns out to have been stalled the whole time. One
 * stamp would swallow the second announcement inside the first one's window.
 */
const unknownStampFile = `${heartbeat.heartbeatDir()}/unknown-loop-queue.stamp`;

function readFileOrEmpty(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

function readStamp() {
  return readFileOrEmpty(stampFile);
}

function clearStamp() {
  try { fs.rmSync(stampFile, { force: true }); } catch { /* nothing to clear */ }
}

function writeStamp(file, at) {
  try {
    fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
    fs.writeFileSync(file, `${at}\n`);
    return null;
  } catch (err) {
    return String(err?.message || err);
  }
}

// Taken BEFORE either read, so a throttled pass costs nothing at all. `--force`
// is the escape hatch, and it is the flag a break test would reach for.
if (CHECK && !flag('force')
    && !throughput.dueAgain({ lastAt: readFileOrEmpty(readStampFile), now: NOW, everyMs: READ_EVERY_MS })) {
  console.log('Read within the last hour — not asking ClickUp or GitHub again. '
    + '(`--force` takes a fresh reading; a hand-run `npm run throughput` is never throttled.)');
  process.exit(0);
}

function clearUnknownStamp() {
  try { fs.rmSync(unknownStampFile, { force: true }); } catch { /* nothing to clear */ }
}

/**
 * An UNKNOWN verdict reaching the bus — the alarm this check did not have
 * until 2026-09-01 (task 86bbr2jpq, finding 1).
 *
 * `run_bus_relay.sh` guards this whole call with `|| true`, so exiting 2 told
 * nobody anything: a rotated token or a sustained rate limit left the stall
 * detector permanently dead while every other job on the board looked fine.
 * It printed UNKNOWN to a launchd log, which is honest and unread.
 *
 * KNOWN RESIDUAL, SAID OUT LOUD. When the cause IS ClickUp being unreachable,
 * this post travels the same wire that just failed, so it will very likely
 * fail too — the same residual `scripts/report_job_failure.mjs` documents, and
 * the same answer: the heartbeat notices the absence of success from the OTHER
 * machine, which is the only vantage point that survives this one. The post is
 * still worth attempting, because the other UNKNOWN — an undated closure
 * inside the window — happens while ClickUp is perfectly healthy.
 */
function announceUnknown(v) {
  if (!CHECK) return;
  const text = throughput.renderUnknownPost({
    verdict: v, now: NOW, node: NODE.name || 'an unnamed machine',
  });
  if (DRY) {
    console.log('');
    console.log('--dry-run — this is what would go to the bus, and nothing was sent:');
    console.log('');
    console.log(text);
    return;
  }
  if (!throughput.dueAgain({
    lastAt: readFileOrEmpty(unknownStampFile), now: NOW, everyMs: heartbeat.REPOST_EVERY_MS,
  })) {
    console.log('');
    console.log(`Already reported as unknown within the last ${Math.round(heartbeat.REPOST_EVERY_MS / 3600000)}h `
      + '— not posting again.');
    return;
  }
  try {
    clickup.postBusMessage(BUS_CHANNEL, text);
    const why = writeStamp(unknownStampFile, new Date(NOW).toISOString());
    if (why) console.log(`Posted, but the suppression stamp could not be written (${why}).`);
    console.log('');
    console.log('Posted to the bus.');
  } catch (err) {
    console.log('');
    console.log(red(`Could NOT post the unknown-reading alert to the bus `
      + `(${String(err?.message || err).slice(0, 300)}).`));
    console.log('Not stamping it as sent, so the next pass tries again.');
  }
}

// --- the pass ---------------------------------------------------------------

// THE HOURLY CLOCK RESTARTS ON THE ATTEMPT, NOT ON A SUCCESS (task 86bbr2jpq,
// finding 2). This used to be stamped after the reads had come back, so a
// ClickUp 429 skipped it — and the relay wakes every ten minutes, so a rate
// limit made the check hammer the very limit that broke it, six times an hour
// instead of once, keeping itself broken. Stamped here, a failed pass costs
// the same hour a successful one does.
if (CHECK) writeStamp(readStampFile, new Date(NOW).toISOString());

const queueRead = await readQueue();
const prRead = readOpenPrs();

if (!queueRead.tasks) {
  // No tickets, no verdict. Said out loud and exited 2 — never as "all quiet".
  const v = throughput.verdict({ unreadable: `the Loop Queue could not be read (${queueRead.why})` });
  console.log(`${yellow(v.state)}\n${v.why}`);
  announceUnknown(v);
  process.exit(v.exitCode);
}

const tasks = queueRead.tasks;
const queue = throughput.queueShape(tasks);
const closed = throughput.closedPerDay({ tasks, now: NOW, days: DAYS });
const closedLast24h = throughput.closedSince({ tasks, now: NOW });
const curve = throughput.depthPerDay({ tasks, now: NOW, days: DAYS });
const plateau = throughput.depthPlateau(curve);
// A FACT for the reader, not an input to any rule — `sinceLastClose` says why.
const lastClose = throughput.sinceLastClose({ tasks, now: NOW });
const trend = throughput.depthTrend(curve);

// The rework bucket, from classifyPrs. An unreadable `gh` is NOT fatal: the
// stall verdict does not depend on it, and refusing to report a stall because
// GitHub was briefly unreachable would be this feature failing in the exact
// direction it exists to prevent.
const ticketStatusById = Object.create(null);
for (const t of tasks) ticketStatusById[String(t.id)] = t.status?.status ?? '';
const rework = prRead.prs
  ? throughput.reworkPrs({ prs: prRead.prs, ticketStatusById, now: NOW })
  : { rows: [], oldest: null, groups: null };

/**
 * WAS ANYTHING IN THE LOOP QUEUE EDITED INSIDE THE WINDOW? A plain fact about
 * the list, and the verdict is told only that.
 *
 * THIS USED TO BE CALLED `loopsFiring` AND IT CLAIMED TOO MUCH (2026-09-01,
 * task 86bbr2jpq, finding 3). The evidence is `date_updated`, which ClickUp
 * bumps on ANY edit — a comment from Dane, a relay note, a priority change —
 * so "a ticket touched inside the window proves a pass ran", which is what the
 * old docstring said, is simply not true. It sent the reader hunting a
 * pipeline bug in the case where the loop lanes were not running at all, and
 * that case is arguably the likeliest cause of a stall, because the lanes live
 * inside long-lived agent sessions that somebody has to open.
 *
 * Naming it after the evidence makes `false` answerable, which the old
 * question never was: "no loop pass ran" could not be concluded from silence
 * (a pass that finds the WIP cap full writes nothing), but "nothing edited the
 * Loop Queue for 24 hours" is exactly what an empty list of recent updates
 * shows. `null` is kept for the case where no ticket carries a readable
 * timestamp at all — a shape ClickUp should never return, and not one to
 * report as a confident `false`.
 */
const withTimestamps = tasks.filter((t) => throughput.updatedAt(t) !== null);
const queueTouched = withTimestamps.length
  ? withTimestamps.some((t) => throughput.updatedAt(t) > NOW - throughput.STALL_WINDOW_MS)
  : null;

// A finished ticket carrying no closure date is invisible to `closedSince`, so
// one edited inside the window could be a closure this run cannot see. It
// makes the verdict UNKNOWN rather than STALLED — see `recentUndatedClosures`.
const undated = throughput.undatedClosures(tasks);
const undatedRecent = throughput.recentUndatedClosures({ tasks, now: NOW });

const v = throughput.verdict({
  closedLast24h, queue, queueTouched, trend, lastClose, undatedRecent,
});

const colour = v.state === 'STALLED' ? red : v.state === 'UNKNOWN' ? yellow : green;
console.log(throughput.renderReport({
  verdict: { ...v, state: colour(v.state) }, closed, curve, plateau, rework, queue, now: NOW, lastClose, trend,
  undated,
}));

if (prRead.why) {
  console.log('');
  console.log(yellow(`Rework pull requests could NOT be read (${prRead.why}) — that section is missing, not empty.`));
}

// --- the alert --------------------------------------------------------------

if (!CHECK) process.exit(v.exitCode);

// A READING THAT COULD NOT BE TAKEN IS ITSELF THE ALARM. The queue read
// succeeded here, so this is the other UNKNOWN: an undated closure inside the
// window, which means the zero the stall rests on cannot be trusted. It is not
// a stall, so the stall suppression clears; it is not health either.
if (v.state === 'UNKNOWN') {
  clearStamp();
  announceUnknown(v);
  process.exit(v.exitCode);
}

// A reading WAS taken, so an earlier unknown has cleared — the next one is
// announced at once rather than being swallowed by that window.
clearUnknownStamp();

if (!v.stalled) {
  // A recovery clears the suppression, so the next stall is announced at once.
  clearStamp();
  process.exit(v.exitCode);
}

const text = throughput.renderStallPost({
  verdict: v, closed, plateau, rework, queue, now: NOW, lastClose, undated,
  reworkUnreadable: prRead.why, node: NODE.name || 'an unnamed machine',
});

if (DRY) {
  console.log('');
  console.log('--dry-run — this is what would go to the bus, and nothing was sent:');
  console.log('');
  console.log(text);
  process.exit(v.exitCode);
}

if (!throughput.dueAgain({ lastAt: readStamp(), now: NOW, everyMs: heartbeat.REPOST_EVERY_MS })) {
  console.log('');
  console.log(`Already reported within the last ${Math.round(heartbeat.REPOST_EVERY_MS / 3600000)}h — not posting again.`);
  process.exit(v.exitCode);
}

try {
  clickup.postBusMessage(BUS_CHANNEL, text);
  // Posted but not stamped: the next stall inside the window posts a duplicate.
  // Noisy, and far better than an unwritable folder silencing the alarm
  // outright — the same trade report_job_failure.mjs makes.
  const why = writeStamp(stampFile, new Date(NOW).toISOString());
  if (why) console.log(`Posted, but the suppression stamp could not be written (${why}).`);
  console.log('');
  console.log('Posted to the bus.');
} catch (err) {
  console.log('');
  console.log(red(`Could NOT post to the bus (${String(err?.message || err).slice(0, 300)}).`));
  console.log('Not stamping it as sent, so the next pass tries again.');
}

process.exit(v.exitCode);
