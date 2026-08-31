#!/usr/bin/env node
/**
 * `npm run heartbeat` — is anything that should be running quietly not?
 *
 * The decisions live in lib/nodeHeartbeat.js (pure, no network, fully tested).
 * This file is the IO: the local stamp, the shared roll call on ClickUp, and
 * the bus post. See that module's header for why the two clocks differ, and
 * why the watchdog has to be able to run from the machine that does NOT own
 * the job it is watching.
 *
 *   npm run heartbeat                       read the roll call, print it, post nothing
 *   npm run heartbeat -- --check            the same, and post to the bus if a job is quiet
 *   npm run heartbeat -- --beat --role X    record a successful run of X (jobs call this)
 *
 * Exit codes, because scripts branch on this:
 *   0  read cleanly, nothing overdue
 *   1  something is overdue
 *   2  could not tell — never rendered as "all quiet" (docs/DOCTRINE.md 3.11)
 *
 * NOTHING HERE MAY FAIL THE JOB THAT CALLS IT. `--beat` reports its problems
 * and exits 0: a relay that worked perfectly must not be recorded as a failure
 * because its own bookkeeping could not reach ClickUp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const heartbeat = require('../lib/nodeHeartbeat.js');
const nodeRoles = require('../lib/nodeRoles.js');
const clickup = require('./lib/clickup.cjs');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const ROLL_CALL_TASK = process.env.CLICKUP_ROLL_CALL_TASK || '';
// The status the roll call rests in: outside every claim query and every
// bus-relay watch, for the same reason the pause switch sits there — a ticket
// that could be picked up as work would be picked up as work.
const ROLL_CALL_STATUS = process.env.CLICKUP_ROLL_CALL_STATUS || 'Live';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

const NOW = Date.now();
const NODE = nodeRoles.thisNode();

// --- stamps -----------------------------------------------------------------
// Suppression lives on the machine doing the posting, not on the shared
// surface. That is deliberate: if both machines are awake and both see the
// same silence, two posts is a far better failure than a shared stamp one of
// them cannot write turning into no post at all.

function stampPath(name) {
  return path.join(heartbeat.heartbeatDir(), `${name}.stamp`);
}

function readStamp(name) {
  try {
    return fs.readFileSync(stampPath(name), 'utf8').trim();
  } catch {
    return '';
  }
}

function writeStamp(name, at) {
  try {
    fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
    fs.writeFileSync(stampPath(name), `${at}\n`);
    return true;
  } catch {
    return false;
  }
}

function clearStamp(name) {
  try { fs.unlinkSync(stampPath(name)); } catch { /* nothing to clear is the normal case */ }
}

// --- the roll call on ClickUp -----------------------------------------------

/**
 * Find the roll call. Its identity is its NAME; `CLICKUP_ROLL_CALL_TASK` is a
 * shortcut that must never become the definition — a shortcut pointing at a
 * deleted task has to fall back to the name, not report the roll call gone.
 *
 * Never throws. Three answers: found, confirmed-absent, unreadable.
 */
async function findRollCall() {
  if (ROLL_CALL_TASK) {
    try {
      const out = await clickup.call('GET', `/api/v2/task/${ROLL_CALL_TASK}`);
      if (out.ok && out.json && out.json.id) return { readable: true, found: true, task: out.json };
      // 401 covers both a bad token and a task this token cannot see, deleted
      // ones included — so fall through to the name rather than conclude.
    } catch { /* fall through to the list walk */ }
  }
  let tasks;
  try {
    tasks = await clickup.listTasks(LOOP_QUEUE_LIST, { includeClosed: true });
  } catch (err) {
    return { readable: false, found: false, why: `reading the Loop Queue: ${String(err && err.message).slice(0, 200)}` };
  }
  const task = tasks.find(
    (t) => String(t.name || '').trim().toLowerCase() === heartbeat.ROLL_CALL_TASK_NAME.toLowerCase(),
  );
  return task ? { readable: true, found: true, task } : { readable: true, found: false };
}

/**
 * The description ClickUp actually holds.
 *
 * Both fields are consulted and the one with CONTENT wins, because the API
 * does not consistently populate the same one: a task written with
 * `markdown_description` reads back with that field empty and the text under
 * `description` (driven live, 2026-08-31). Preferring one blindly would hand
 * the parser an empty string on a task whose roll call is entirely intact.
 */
function descriptionOf(task) {
  const md = String((task && task.markdown_description) || '');
  const plain = String((task && task.description) || '');
  return md.trim() ? md : plain;
}

async function createRollCall() {
  const out = await clickup.call('POST', `/api/v2/list/${LOOP_QUEUE_LIST}/task`, {
    name: heartbeat.ROLL_CALL_TASK_NAME,
    status: ROLL_CALL_STATUS,
    markdown_description: heartbeat.renderRollCall([], { now: NOW }),
  });
  if (!out.ok) {
    return {
      ok: false,
      why: `HTTP ${out.status} ${String((out.json && out.json.err) || out.text || '').slice(0, 200)}`
        + `\n  If the failure names the status, this list has no "${ROLL_CALL_STATUS}" status — set`
        + '\n  CLICKUP_ROLL_CALL_STATUS to one the Loop Queue has that no loop claims from.',
    };
  }
  return { ok: true, task: out.json };
}

// --- reading ----------------------------------------------------------------

async function loadReport() {
  const found = await findRollCall();
  if (!found.readable) return { readable: false, why: found.why, task: null, rows: [] };
  if (!found.found) {
    // A CONFIRMED absence. Every role reads as "no beat ever recorded", which
    // is exactly right on a system where nothing has beaten yet, and is the
    // state a fresh checkout starts in.
    return { readable: true, task: null, rows: [], report: heartbeat.rollCallReport({ rows: [], now: NOW }) };
  }
  const parsed = heartbeat.parseRollCall(descriptionOf(found.task));
  if (!parsed.parsed) {
    return {
      readable: false,
      why: `${heartbeat.ROLL_CALL_TASK_NAME} (${found.task.url}): ${parsed.why}`,
      task: found.task,
      rows: [],
    };
  }
  return {
    readable: true,
    task: found.task,
    rows: parsed.rows,
    report: heartbeat.rollCallReport({ rows: parsed.rows, now: NOW }),
  };
}

function printReport(state) {
  const out = [];
  out.push('', bold('NODE ROLL CALL — when did each scheduled job last succeed?'), '');

  if (!state.readable) {
    out.push(`  ${yellow('????')}  Cannot tell.`);
    out.push(`        ${dim(`cannot tell: ${state.why}`)}`);
    out.push(`        ${dim('An unreadable roll call is NOT an all-clear. Nothing has been posted.')}`);
    out.push('');
    console.log(out.join('\n'));
    return 2;
  }

  const { beating, overdue, notReporting } = state.report;

  for (const b of beating) {
    out.push(`  ${green('BEAT')}  ${b.role} on ${b.owner} — last succeeded ${heartbeat.ageText(b.ageMs)}.`);
    out.push(`        ${dim(b.at)}`);
  }
  for (const o of overdue) {
    out.push(`  ${red('QUIET')} ${o.role} on ${o.owner} — ${o.reason}.`);
    out.push(`        ${dim('A job that stops firing writes nothing anywhere. This is that.')}`);
  }
  for (const n of notReporting) {
    out.push(`  ${yellow('????')}  ${n.role} on ${n.owner} — not reporting.`);
    out.push(`        ${dim(`cannot tell: ${n.why}`)}`);
  }

  if (state.task) out.push('', dim(`  Roll call: ${state.task.url}`));
  else out.push('', dim('  No roll-call ticket exists yet — the first beat creates it.'));

  out.push('');
  if (overdue.length === 0 && beating.length > 0) {
    out.push(bold(green('Everything that reports, reports.')));
  } else if (overdue.length === 0) {
    out.push(bold(yellow('Nothing is overdue, and nothing is reporting either.')));
    out.push(dim('Read the ???? lines. A system with no beat emitters is not a healthy system.'));
  } else {
    out.push(bold(red(`${overdue.length} job${overdue.length === 1 ? ' has' : 's have'} gone quiet.`)));
  }
  out.push('');
  console.log(out.join('\n'));
  return overdue.length > 0 ? 1 : 0;
}

// --- recording a beat -------------------------------------------------------

async function doBeat(role) {
  if (!role) {
    console.error(`--beat needs --role <role>. Known roles: ${Object.keys(nodeRoles.ROLES).join(', ')}`);
    return 0;
  }
  const at = new Date(NOW).toISOString();

  // 1. The local stamp, every time. Free, offline, and the precise answer to
  //    "when did this last work on this machine".
  const local = heartbeat.recordBeat({ role, node: NODE.name, at });
  if (!local.ok) console.error(`heartbeat: could not write the local beat (${local.why}) — carrying on.`);
  else console.error(`heartbeat: ${role} beat recorded locally at ${at}.`);

  // A successful run clears its own alarms — both the silence one and the
  // failure one that scripts/report_job_failure.mjs sets — so a fault that is
  // fixed and later returns is announced immediately rather than waiting out a
  // suppression window the previous fault opened. Both stamps are cleared HERE
  // rather than by the calling shell script so that exactly one file knows
  // where they live (NODES P1).
  clearStamp(`quiet-${role}`);
  clearStamp(`failed-${role}`);

  // 2. The shared row, at most once a day. This is the throttle that keeps the
  //    feature from being channel noise x365 — and it is also the resolution
  //    the requirement asks for: a day-long absence, not a ten-minute one.
  if (!heartbeat.dueAgain({ lastAt: readStamp(`push-${role}`), now: NOW, everyMs: heartbeat.PUSH_EVERY_MS })) {
    console.error('heartbeat: shared row already pushed within the last day — not pushing again.');
    return 0;
  }

  const found = await findRollCall();
  if (!found.readable) {
    // Loud, and exit 0. The job itself succeeded; failing it here would turn a
    // ClickUp hiccup into a false failure alert, which is the alarm fatigue
    // this slice exists to avoid, wearing a different hat.
    console.error(`heartbeat: could not reach the roll call (${found.why}) — the local beat stands. Not failing the job.`);
    return 0;
  }

  let task = found.task;
  if (!found.found) {
    console.error(`heartbeat: no "${heartbeat.ROLL_CALL_TASK_NAME}" ticket yet — creating it.`);
    const made = await createRollCall();
    if (!made.ok) {
      console.error(`heartbeat: could not create it (${made.why}). The local beat stands.`);
      return 0;
    }
    task = made.task;
  }

  // Read-modify-write. Two machines share this description, so the merge only
  // ever advances a row and never moves one backwards; a lost update costs at
  // most one day's resolution on the other machine's row, and its next push
  // corrects it.
  const fresh = await clickup.call('GET', `/api/v2/task/${task.id}`);
  const existing = fresh.ok ? heartbeat.parseRollCall(descriptionOf(fresh.json)) : { parsed: false, rows: [] };
  const rows = heartbeat.mergeRollCall(existing.parsed ? existing.rows : [], [{ node: NODE.name, role, at }]);
  if (!existing.parsed) {
    console.error('heartbeat: the existing roll-call block could not be read — rewriting it from this beat alone.');
  }

  const wrote = await clickup.call('PUT', `/api/v2/task/${task.id}`, {
    markdown_description: heartbeat.renderRollCall(rows, { now: NOW }),
  });
  if (!wrote.ok) {
    console.error(`heartbeat: could not write the roll call (HTTP ${wrote.status}). The local beat stands.`);
    return 0;
  }
  writeStamp(`push-${role}`, at);
  console.error(`heartbeat: ${role} pushed to the roll call (${task.url}).`);
  return 0;
}

// --- the watchdog -----------------------------------------------------------

async function doCheck(state) {
  if (!state.readable) return; // printReport has already said CANNOT TELL.
  const quiet = state.report.overdue;
  if (quiet.length === 0) return;

  // One post per role per 6 hours. Filtering per role rather than per run
  // means a second job going quiet is announced straight away instead of being
  // swallowed by the first one's suppression window.
  const toAnnounce = quiet.filter((o) => heartbeat.dueAgain({
    lastAt: readStamp(`quiet-${o.role}`), now: NOW, everyMs: heartbeat.REPOST_EVERY_MS,
  }));
  if (toAnnounce.length === 0) {
    console.error('heartbeat: already announced within the suppression window — not posting again.');
    return;
  }

  const text = heartbeat.renderSilencePost({
    overdue: toAnnounce,
    now: NOW,
    reportedBy: NODE.name || 'an unnamed machine',
  });
  try {
    clickup.postBusMessage(BUS_CHANNEL, text);
    const at = new Date(NOW).toISOString();
    for (const o of toAnnounce) writeStamp(`quiet-${o.role}`, at);
    console.error(`heartbeat: posted to the bus about ${toAnnounce.map((o) => o.role).join(', ')}.`);
  } catch (err) {
    // The bus was down for sixteen hours on 2026-08-23. A failed announcement
    // must be loud and must NOT be recorded as sent, so the next pass retries.
    console.error(`heartbeat: could NOT post to the bus (${String(err && err.message).slice(0, 200)}).`);
    console.error('heartbeat: not stamping it as announced, so the next pass tries again.');
  }
}

// --- main -------------------------------------------------------------------

if (flag('beat')) {
  process.exit(await doBeat(arg('role')));
}

const state = await loadReport();
const code = printReport(state);
if (flag('check')) await doCheck(state);
process.exit(code);
