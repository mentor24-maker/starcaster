#!/usr/bin/env node
/**
 * Report a failed scheduled job to the bus. The COMMITTED half of the alert.
 *
 * WHY THIS FILE EXISTS AT ALL
 * The failure alert was built on 2026-08-20 (NODES Slice E, Phase 0) and it
 * worked — the break test posted, the suppression held. But it was built where
 * the job lived at the time: inside `~/Library/Application Support/starcaster/
 * bus-relay-cron.sh`, a hand-installed file on the MacBook Pro, in git nowhere.
 *
 * Then Slice B brought the schedule into the repo (`scripts/run_bus_relay.sh`
 * + `scripts/install_bus_relay.sh`) and ownership of bus-relay moved to the
 * Mac Mini. The committed runner had no failure path, because the failure path
 * had never been committed. So on the machine that actually runs the relay
 * today, a failure reaches nobody — the alert Dane watched work is not
 * installed where the job is. Nothing announced that; it is precisely the kind
 * of silent regression an uncommitted file produces.
 *
 * Hence: one tested program in the repo, called by the runner in one line,
 * rather than shell logic no test and no review ever sees.
 *
 *   node scripts/report_job_failure.mjs --job bus-relay --status 1 --log <path>
 *
 * KNOWN RESIDUAL, BY DESIGN (carried forward from Phase 0). This alert shares
 * the job's own dependencies — node, doppler, the network — so a failure in
 * one of those kills the job and the alert together. That residual is exactly
 * what the heartbeat covers: `scripts/node_heartbeat.mjs` notices the absence
 * of success from a DIFFERENT machine, which is the only vantage point that
 * survives this one being broken or switched off.
 *
 * ALWAYS EXITS 0. The job has already failed; its own exit status is what the
 * schedule and the log record. A reporter that failed the run a second time
 * would only make the log harder to read.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');
const clickup = require('./lib/clickup.cjs');

const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const job = arg('job');
const status = arg('status', '?');
const logPath = arg('log');
const tailLines = Number(arg('tail', '12')) || 12;

if (!job) {
  console.error('report_job_failure: --job <name> is required. Nothing reported.');
  process.exit(0);
}

const node = nodeRoles.thisNode();
const at = new Date().toISOString();

// The suppression stamp lives beside the heartbeat's, in the machine's own
// state folder. One post per job per 6 hours: a job failing every ten minutes
// would otherwise bury the channel, and a buried channel is an unread channel.
// The stamp is cleared by the next SUCCESS (scripts/run_bus_relay.sh), not by
// a timer, so a fault that is fixed and returns is announced again straight
// away rather than being swallowed by a window the earlier fault opened.
const stampFile = `${heartbeat.heartbeatDir()}/failed-${job.replace(/[^a-z0-9-]/gi, '-')}.stamp`;

function readStamp() {
  try { return fs.readFileSync(stampFile, 'utf8').trim(); } catch { return ''; }
}

if (!heartbeat.dueAgain({ lastAt: readStamp(), now: Date.now(), everyMs: heartbeat.REPOST_EVERY_MS })) {
  console.error(`report_job_failure: ${job} already reported within the last `
    + `${Math.round(heartbeat.REPOST_EVERY_MS / 3600000)}h — not posting again. The log still records this run.`);
  process.exit(0);
}

let logTail = '';
if (logPath) {
  try {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    logTail = lines.slice(-tailLines).join('\n');
  } catch (err) {
    // Say so in the post rather than posting a confident empty tail. "No log
    // lines" and "we could not read the log" are different findings and the
    // second one is itself a clue.
    logTail = `(could not read ${logPath}: ${String(err && err.message)})`;
  }
}

const text = heartbeat.renderFailurePost({
  job,
  node: node.name || 'an unnamed machine',
  status,
  at,
  logTail,
  logPath,
});

try {
  clickup.postBusMessage(BUS_CHANNEL, text);
  try {
    fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
    fs.writeFileSync(stampFile, `${at}\n`);
  } catch (err) {
    // Posted but not stamped: the next failure inside the window posts a
    // duplicate. Noisy, and far better than the alternative, where an
    // unwritable stamp folder silences the alarm entirely.
    console.error(`report_job_failure: posted, but the suppression stamp could not be written (${String(err && err.message)}).`);
  }
  console.error(`report_job_failure: ${job} failure on ${node.name} posted to the bus.`);
} catch (err) {
  console.error(`report_job_failure: could NOT post to the bus (${String(err && err.message).slice(0, 300)}).`);
  console.error('report_job_failure: not stamping it as sent, so the next failure tries again.');
}

process.exit(0);
