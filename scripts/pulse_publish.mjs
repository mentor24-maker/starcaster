#!/usr/bin/env node
/**
 * `npm run pulse:publish` — the SCHEDULED pulse.
 *
 * `npm run pulse` reads and prints. This runs it, puts the full report
 * somewhere durable, and tells the bus about the parts that need somebody.
 *
 *   npm run pulse:publish                 take a reading, publish it, post what is due
 *   npm run pulse:publish -- --dry-run    say exactly what it WOULD write and send, send nothing
 *   npm run pulse:publish -- --job X      read a different loop's log for A1
 *
 * Exit codes, because launchd and the failure alert both branch on this:
 *   0  the pass completed — whatever it found. A finding is a reading, not a
 *      failure of this job.
 *   1  the pass could not complete: the pulse itself did not run, the pause
 *      switch could not be READ (which is not the same as it being paused —
 *      see `pipelineSwitch`), the durable record could not be written, or it
 *      found something and could not DELIVER it to the bus. That last one is
 *      the newest and the least obvious: a run that reads perfectly and ships
 *      nothing is still a watchdog nobody is hearing. A broken watchdog has to
 *      be loud, and "loud" here means both surfaces — non-zero so the failure
 *      alert fires this hour, and no heartbeat so the roll call notices even if
 *      the bus is what is down.
 *
 * A PAUSED pipeline is not a failure and exits 0. It is a complete pass that
 * correctly stayed quiet, so it records its heartbeat like any other.
 *
 * THE PULSE IS RUN AS A SUBPROCESS, ON PURPOSE.
 * `scripts/pulse.cjs` declares read-only as a hard property, not an intention:
 * three sources, no write path, so it cannot post or repair by accident. That
 * property is worth more than the few milliseconds saved by requiring it in
 * here, and importing it would put a ClickUp PUT one typo away from the file
 * that promises it has none. So: this file writes, that file reads, and the
 * boundary between them is a process.
 *
 * IT NEVER DECIDES FROM THE PULSE'S EXIT CODE. `exitCodeFor` does not count a
 * total Loop Queue outage (86bbt6hgx), so a run that saw nothing at all can
 * exit 0. What gets announced is decided from the report's own contents by
 * lib/pulseDigest.js, which does count it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const digest = require('../lib/pulseDigest.js');
const pulse = require('../scripts/builder/pulse.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');
const clickup = require('./lib/clickup.cjs');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const DIGEST_TASK = process.env.CLICKUP_PULSE_DIGEST_TASK || '';
// The status the record rests in: outside every claim query and every relay
// watch, for the same reason the roll call and the pause switch sit there — a
// ticket that could be picked up as work would be picked up as work.
const DIGEST_STATUS = process.env.CLICKUP_PULSE_DIGEST_STATUS || 'Live';
const ROLE = 'pipeline-pulse';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const DRY = flag('dry-run');
const JOB = arg('job', 'loop-build');
const NOW = Date.now();
const NODE = nodeRoles.thisNode();

// EVERY CALL OUT OF THIS FILE HAS A DEADLINE — the three subprocesses AND the
// five ClickUp calls this file makes directly.
//
// Round 1 of this ticket's review bounded the subprocesses. Round 2 found that
// the reasoning below applies word for word to the ClickUp reads and writes
// underneath them, which had no deadline at all: `scripts/lib/clickup.cjs`
// used a bare `fetch`, and Node's `fetch` has no default request timeout, so a
// half-open connection hangs rather than fails. Those five calls run in this
// process, AFTER the reading has been taken. That is the worst place for it.
//
// This job runs hourly under launchd, which will not start a second copy while
// the first is still going. One call that hangs instead of failing takes the
// schedule down completely — no output, no non-zero exit, so
// `report_job_failure.mjs` never fires either. The only thing that would
// eventually notice is the 25-hour roll call, and it would report "stopped
// firing" about a job that is firing and stuck, sending the next reader to
// launchd instead of to a stuck socket.
//
// A deadline turns that into an ordinary loud failure: spawnSync kills the
// child and sets `error`, a bounded fetch throws with the timeout named, every
// caller here treats both as "could not complete", and the next hour tries
// again.
const READING_TIMEOUT_MS = 10 * 60 * 1000; // the pulse: three sources, many `gh` calls
const SWITCH_TIMEOUT_MS = 2 * 60 * 1000;   // one ClickUp read
const BEAT_TIMEOUT_MS = 2 * 60 * 1000;     // a local stamp plus at most one ClickUp write

// The deadline on each ClickUp request this file makes, and it is deliberately
// TIGHTER than the library's own 60s default, because of the one place a
// per-request bound still multiplies: `listTasks` pages, up to 50 times. A
// ClickUp that HANGS throws on the first page and does not multiply — that is
// the failure this bound exists for. A ClickUp that is merely slow does, and
// 50 x 60s is 50 minutes, which does not fit inside an hourly cadence. At 30s
// the worst case is 25 minutes, comfortably inside it, and a single healthy
// ClickUp call takes well under a second.
const CLICKUP_TIMEOUT_MS = 30 * 1000;
const TIMEOUT = { timeoutMs: CLICKUP_TIMEOUT_MS };

// --- suppression stamps -----------------------------------------------------
//
// Beside the heartbeat's and the stale-ready check's, for the reason they live
// there: a stamp records what THIS MACHINE has already said, which is a fact
// about the machine and not about the code, so it must survive a worktree
// being removed.

const STAMP_DIR = path.join(heartbeat.heartbeatDir(), 'pulse');

function readStamps() {
  const stamps = new Map();
  let entries = [];
  try { entries = fs.readdirSync(STAMP_DIR); } catch { return stamps; }
  for (const file of entries) {
    if (!file.endsWith('.stamp')) continue;
    try {
      const at = fs.readFileSync(path.join(STAMP_DIR, file), 'utf8').trim();
      stamps.set(file.replace(/\.stamp$/, ''), at);
    } catch { /* an unreadable stamp reads as "never posted", which errs towards posting */ }
  }
  return stamps;
}

/**
 * Stamps are stored under a sanitised FILE name and looked up by KEY, so both
 * directions have to agree. `stampFileName` is the single definition and this
 * builds the reverse index from the live items rather than trying to un-mangle
 * a filename — a format written in one place and taken apart in another is a
 * format with two definitions.
 */
function stampsByKey(keys) {
  const onDisk = readStamps();
  const out = new Map();
  for (const key of keys) {
    const file = digest.stampFileName(key).replace(/\.stamp$/, '');
    if (onDisk.has(file)) out.set(key, onDisk.get(file));
  }
  return out;
}

function writeStamp(key, at) {
  try {
    fs.mkdirSync(STAMP_DIR, { recursive: true });
    fs.writeFileSync(path.join(STAMP_DIR, digest.stampFileName(key)), `${at}\n`);
    return null;
  } catch (err) {
    return String(err?.message || err);
  }
}

/**
 * Clear the stamps for findings this run measured and did NOT see. A stamp
 * that is never cleared is an alarm that fires once and then goes quiet for
 * good — the suppression design defeating the thing it protects.
 *
 * THE RULE IS `digest.stampNamesToClear`, AND THIS ONLY DOES THE IO: read the
 * directory, ask, delete what comes back. It used to reimplement the rule over
 * filenames, which is the shape where a test proves a function that nothing
 * runs — the two agreed, so nothing was broken, but changing the rule in the
 * tested function would have passed CI and changed no behaviour at all.
 */
function clearStale({ items, measured }) {
  let files = [];
  try { files = fs.readdirSync(STAMP_DIR); } catch { return []; }
  const onDiskNames = files.filter((f) => f.endsWith('.stamp')).map((f) => f.replace(/\.stamp$/, ''));
  const cleared = [];
  for (const name of digest.stampNamesToClear({ onDiskNames, items, measured })) {
    const file = `${name}.stamp`;
    try { fs.rmSync(path.join(STAMP_DIR, file), { force: true }); cleared.push(file); } catch { /* nothing to clear */ }
  }
  return cleared;
}

// --- the reading ------------------------------------------------------------

/**
 * Run the pulse and read both of its faces: the JSON it emits for machines and
 * the human report it prints for people. Two runs would be two readings of a
 * moving system, and the report on the ticket has to be the report the
 * findings came from — so the JSON is taken once and the text is rendered from
 * it with the pulse's OWN formatter rather than by a second invocation.
 */
function takeReading() {
  const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'pulse.cjs'), '--json', '--job', JOB], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: READING_TIMEOUT_MS,
  });
  if (out.error) {
    const timedOut = out.error.code === 'ETIMEDOUT' || out.signal;
    return {
      ok: false,
      why: timedOut
        ? `the pulse did not finish within ${Math.round(READING_TIMEOUT_MS / 60000)} minutes and was killed `
          + '(most likely a `gh` or ClickUp call that hung rather than failed)'
        : `the pulse could not be started (${out.error.message})`,
    };
  }
  const stdout = String(out.stdout || '');
  if (!stdout.trim()) {
    return {
      ok: false,
      why: `the pulse printed nothing (exit ${out.status}). ${String(out.stderr || '').trim().slice(0, 300)}`,
    };
  }
  let result;
  try {
    result = JSON.parse(stdout);
  } catch (err) {
    return { ok: false, why: `the pulse's JSON could not be parsed — ${String(err?.message || err).slice(0, 200)}` };
  }
  return { ok: true, result, report: pulse.formatReport(result) };
}

// --- the durable record -----------------------------------------------------

/**
 * Find the record. Its identity is its NAME; `CLICKUP_PULSE_DIGEST_TASK` is a
 * shortcut that must never become the definition — a shortcut pointing at a
 * deleted task has to fall back to the name, not report the record gone.
 */
async function findDigestTask() {
  if (DIGEST_TASK) {
    try {
      const out = await clickup.call('GET', `/api/v2/task/${DIGEST_TASK}`, undefined, TIMEOUT);
      if (out.ok && out.json && out.json.id) return { readable: true, found: true, task: out.json };
    } catch { /* fall through to the name */ }
  }
  let tasks;
  try {
    tasks = await clickup.listTasks(LOOP_QUEUE_LIST, { includeClosed: true, timeoutMs: CLICKUP_TIMEOUT_MS });
  } catch (err) {
    return { readable: false, found: false, why: `reading the Loop Queue: ${String(err?.message || err).slice(0, 200)}` };
  }
  const task = tasks.find(
    (t) => String(t.name || '').trim().toLowerCase() === digest.DIGEST_TASK_NAME.toLowerCase(),
  );
  return task ? { readable: true, found: true, task } : { readable: true, found: false };
}

/**
 * Read the record back and say whether it LANDED.
 *
 * `clickup_direct.mjs describe` does this for exactly the reason it matters
 * here: a description write that normalises to nothing returns a clean 200
 * (docs/DOCTRINE.md §3.10). What the reading MEANS is decided by
 * `digest.digestWriteVerdict`, which is pure and tested; this only fetches.
 */
async function readDigestBack(taskId, sent) {
  let back;
  try {
    back = await clickup.call(
      'GET', `/api/v2/task/${taskId}?include_markdown_description=true`, undefined, TIMEOUT,
    );
  } catch (err) {
    return digest.digestWriteVerdict({ sent, readable: false, why: String(err?.message || err).slice(0, 200) });
  }
  if (!back.ok) {
    return digest.digestWriteVerdict({ sent, readable: false, why: `HTTP ${back.status}` });
  }
  const saved = back.json?.markdown_description ?? back.json?.description ?? '';
  return digest.digestWriteVerdict({ sent, readBack: saved });
}

async function writeDigest(body) {
  const found = await findDigestTask();
  if (!found.readable) return { ok: false, why: found.why };

  // The POST and the PUT are the only two ClickUp calls in this file that were
  // not inside a try/catch, and `clickup.call` THROWS on a network failure
  // while returning `{ok:false}` on an HTTP error. Unwrapped, a network
  // failure here escaped as a stack trace — losing the "the reading is now
  // nowhere but this log" line written for exactly that moment. The run still
  // exited non-zero, so the alert fired; it just arrived unreadable.
  if (!found.found) {
    let made;
    try {
      made = await clickup.call('POST', `/api/v2/list/${LOOP_QUEUE_LIST}/task`, {
        name: digest.DIGEST_TASK_NAME,
        status: DIGEST_STATUS,
        markdown_description: body,
      }, TIMEOUT);
    } catch (err) {
      return { ok: false, why: `creating the record: ${String(err?.message || err).slice(0, 300)}` };
    }
    if (!made.ok) {
      return {
        ok: false,
        why: `HTTP ${made.status} ${String(made.json?.err || made.text || '').slice(0, 200)}`
          + `\n  If the failure names the status, this list has no "${DIGEST_STATUS}" status — set`
          + '\n  CLICKUP_PULSE_DIGEST_STATUS to one the Loop Queue has that no loop claims from.',
      };
    }
    const check = await readDigestBack(made.json?.id, body);
    if (!check.ok) return { ok: false, why: check.why };
    return { ok: true, task: made.json, created: true, verified: check.verified, warn: check.why };
  }

  let wrote;
  try {
    wrote = await clickup.call(
      'PUT', `/api/v2/task/${found.task.id}`, { markdown_description: body }, TIMEOUT,
    );
  } catch (err) {
    return { ok: false, why: `writing ${found.task.url}: ${String(err?.message || err).slice(0, 300)}` };
  }
  if (!wrote.ok) {
    return { ok: false, why: `HTTP ${wrote.status} writing ${found.task.url}` };
  }
  const check = await readDigestBack(found.task.id, body);
  if (!check.ok) return { ok: false, why: `${check.why} (${found.task.url})` };
  return { ok: true, task: found.task, created: false, verified: check.verified, warn: check.why };
}

// --- the pipeline switch ----------------------------------------------------

/**
 * Has Dane taken the deck? Every actor asks, this one included — a watchdog
 * shouting on the bus while he works through something by hand is exactly the
 * collision the switch exists to prevent.
 *
 * Asked by RUNNING the one implementation rather than reading the flag a
 * second way here: two readers of a safety flag are two flags, and they
 * disagree quietly. Fails safe in the same direction the switch does — if it
 * cannot be asked at all, nothing is published.
 *
 * Checked before POSTING and before WRITING, because both are writes. The
 * reading itself is free and happens either way, so a paused pass still prints
 * a complete report to its log.
 *
 * IT SEPARATES "PAUSED" FROM "COULD NOT BE READ", WHICH `check` DELIBERATELY
 * DOES NOT. Both exit 3 there, because both must lead to writing nothing, and
 * that is right. But they are not the same event to REPORT:
 *
 *   paused           a healthy pass. It took a full reading and correctly
 *                    stayed quiet. It beats, and exits 0.
 *   could not read   a muzzled watchdog. Left as a quiet exit 0 it publishes
 *                    nothing, every hour, forever, while `report_job_failure`
 *                    never fires — and the only thing that eventually notices
 *                    is the 25-hour roll call, which would say "stopped
 *                    firing" about a job that is firing. Loud, and exit 1.
 *
 * `--json` carries the difference across as `certain`, from the same verdict
 * `check` prints, so this still is not a second reader of the flag.
 */
function pipelineSwitch() {
  const out = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'pipeline.mjs'), 'check', '--json'],
    { encoding: 'utf8', timeout: SWITCH_TIMEOUT_MS },
  );
  return digest.switchVerdict({ ...out, timeoutMs: SWITCH_TIMEOUT_MS });
}

// --- the beat ---------------------------------------------------------------

/**
 * Recorded by every pass that COMPLETED, which includes a paused one: it took
 * a full reading and correctly stayed quiet, and that is the job working. An
 * earlier version returned before this, so Dane holding the deck for a day
 * made the roll call announce that this job had gone quiet while it was
 * running perfectly — a false alarm from the very watchdog whose only value is
 * being trustworthy.
 */
function recordBeat() {
  if (DRY) return;
  const beat = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'node_heartbeat.mjs'), '--beat', '--role', ROLE],
    { encoding: 'utf8', timeout: BEAT_TIMEOUT_MS },
  );
  if (beat.error) {
    console.log(`The beat could not be recorded (${beat.error.message}). The roll call will read this pass as a miss.`);
    return;
  }
  const said = String(beat.stderr || '').trim();
  if (said) console.log(said);
}

// --- the pass ---------------------------------------------------------------

const reading = takeReading();
if (!reading.ok) {
  // The watchdog itself did not work. Loud, and a non-zero exit, so
  // report_job_failure.mjs turns it into a bus post — silence here is the one
  // outcome this whole ticket exists to prevent.
  console.log(`PULSE PUBLISH FAILED — ${reading.why}`);
  console.log('No reading was taken. This is not an all-clear.');
  process.exit(1);
}

const { result, report } = reading;
console.log(report);

const { items, measured } = digest.announcements(result);
const body = digest.renderDigest({
  result, report, items, node: NODE.name, now: NOW, everyMs: heartbeat.REPOST_EVERY_MS,
});

const sw = pipelineSwitch();
const outcome = digest.switchOutcome(sw);
if (!outcome.publish) {
  console.log('');
  if (outcome.loud) {
    // Not a pause — a broken read of the thing that decides whether to
    // publish. Loud and non-zero so `report_job_failure.mjs` turns it into a
    // bus post; the alternative is publishing nothing hourly with nobody told.
    console.log(`PULSE PUBLISH FAILED — ${sw.why}`);
    console.log('The reading above is real, and nothing was published because the pause switch could not be');
    console.log('read. That is not "Dane has the deck" — it is this job unable to tell, and not an all-clear.');
  } else {
    console.log(`Not publishing: ${sw.why}`);
    console.log('Dane has the deck, so this stays quiet. The report above still stands.');
  }
  // A paused pass is a COMPLETE pass and beats; an unreadable one did not
  // complete and must not, or the roll call certifies a blind watchdog.
  if (outcome.beat) recordBeat();
  process.exit(outcome.exit);
}

if (DRY) {
  console.log('');
  console.log(`--dry-run — this is what would be written to the "${digest.DIGEST_TASK_NAME}" ticket:`);
  console.log('');
  console.log(body);
}

const wrote = DRY ? { ok: true, task: null, created: false } : await writeDigest(body);
if (!wrote.ok) {
  console.log('');
  console.log(`Could NOT write the durable record — ${wrote.why}`);
  console.log('The reading above is real and is now nowhere but this log, which is the failure this job exists to prevent.');
  process.exit(1);
}
if (!DRY) {
  console.log('');
  console.log(`${wrote.created ? 'Created' : 'Rewrote'} ${digest.DIGEST_TASK_NAME}: ${wrote.task?.url || '(no url)'}`);
  // Written and read back, or written and NOT checked. The second is said out
  // loud rather than swallowed: it is not a failure (see digestWriteVerdict),
  // and an unstated gap is exactly what a watchdog must never produce.
  if (wrote.verified === false) console.log(`NOT VERIFIED — ${wrote.warn}`);
}

const cleared = DRY ? [] : clearStale({ items, measured });
if (cleared.length) console.log(`Cleared ${cleared.length} suppression stamp(s) for findings that have gone away.`);

// What the bus was OWED and what it actually got. A pass that found things and
// delivered none of them must not end as a success — see digest.deliveryOutcome.
let owed = 0;
let sendFailure = null;

if (!items.length) {
  console.log('Nothing to announce — no alarms and nothing it could not read.');
} else {
  const { due, held } = digest.duePosts({
    items, stamps: stampsByKey(items.map((i) => i.key)), now: NOW, everyMs: heartbeat.REPOST_EVERY_MS,
  });
  if (held.length) {
    console.log(`${held.length} finding(s) already announced within the last `
      + `${Math.round(heartbeat.REPOST_EVERY_MS / 3600000)}h — not posting those again.`);
  }
  if (due.length) {
    owed = due.length;
    const text = digest.renderPulsePost({
      items: due,
      node: NODE.name || 'an unnamed machine',
      now: NOW,
      everyMs: heartbeat.REPOST_EVERY_MS,
      digestUrl: wrote.task?.url || '',
    });
    if (DRY) {
      console.log('');
      console.log('--dry-run — this is what would go to the bus, and nothing was sent:');
      console.log('');
      console.log(text);
    } else {
      try {
        // Bounded by `clickup.SHELL_TIMEOUT_MS` — it is a subprocess that talks
        // to ClickUp, so it can hang the schedule exactly as a fetch can.
        clickup.postBusMessage(BUS_CHANNEL, text);
        for (const item of due) {
          const why = writeStamp(item.key, new Date(NOW).toISOString());
          if (why) console.log(`Posted, but the suppression stamp for ${item.key} could not be written (${why}).`);
        }
        console.log(`Posted ${due.length} finding(s) to the bus.`);
      } catch (err) {
        // Posted-and-not-stamped costs a duplicate; not-posted-and-stamped
        // costs a silence. Only one of those is recoverable, so a failed send
        // is never recorded as sent — that is what makes a TRANSIENT failure
        // heal itself on the next run.
        sendFailure = String(err?.message || err).slice(0, 300);
        console.log(`Could NOT post to the bus (${sendFailure}).`);
        console.log('Not stamping it as sent, so the next pass tries again.');
      }
    }
  }
}

// The beat, and only on a pass that actually completed AND delivered what it
// found. It is what makes the roll call able to say this job has stopped
// firing — which is the exact failure that produced this ticket, one floor up.
// A beat on a pass that shipped nothing certifies the opposite of that.
const delivery = digest.deliveryOutcome({ due: owed, delivered: !sendFailure, why: sendFailure || '' });
if (delivery.loud) {
  console.log('');
  console.log(`PULSE PUBLISH FAILED — ${delivery.why}`);
  console.log('The reading above is real and the durable record holds it, but the alert did not go out.');
  console.log('Exiting non-zero so report_job_failure.mjs says so, and NOT beating, so the roll call');
  console.log('notices too if the bus stays unreachable for longer than the failure alert can cover.');
}
if (delivery.beat) recordBeat();

process.exit(delivery.exit);
