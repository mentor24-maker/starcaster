'use strict';

/**
 * The heartbeat — making SILENCE detectable.
 *
 * WHY THIS EXISTS (NODES Slice E, principle P4, ticket 86bbhbadj)
 * A job that FAILS at least writes a log line and, since 2026-08-20, posts to
 * the bus. A job that never fires writes nothing at all, and nothing is
 * indistinguishable from a quiet week. The Mac Mini works overnight with
 * nobody watching; its schedule can be unloaded, its lid-less machine can be
 * unplugged, its launchd job can be evicted after an OS update, and every one
 * of those looks exactly like "no news".
 *
 * So each job records a BEAT when it succeeds, and something reads those beats
 * and speaks up when one stops arriving.
 *
 * THE PART THAT IS EASY TO GET WRONG
 * A watchdog that runs on the same machine as the job it watches cannot
 * detect that machine being off — the case it exists for. The beats therefore
 * live on a surface BOTH machines can read (a ClickUp task), and the check is
 * run by whichever machine happens to be awake, including the one that does
 * NOT own the job. That is why `scripts/run_bus_relay.sh` runs the check
 * before it asks whether it owns the relay: the non-owning machine's wake-up
 * was already happening every ten minutes and doing nothing at all, and it is
 * exactly the right vantage point.
 *
 * THREE STATES, NEVER TWO (docs/DOCTRINE.md §3.11)
 * A role reports as BEATING, OVERDUE, or NOT REPORTING — the last one meaning
 * the job has no beat emitter yet, which is not the same as healthy and must
 * never render as one. Today only `bus-relay` emits; the loops run inside
 * agent sessions with no committed runner to hang a beat on.
 *
 * TWO CLOCKS, ON PURPOSE
 *   - the LOCAL stamp is written on every successful run. It costs nothing,
 *     never touches the network, and gives `doctor:node` a precise answer to
 *     "when did this last work?" on the machine itself.
 *   - the SHARED row is pushed at most once a day. That is what keeps this
 *     from being channel noise x365, and it is the resolution the requirement
 *     actually needs: the acceptance criterion is "stop the job for a day and
 *     see the absence", not "see the absence within ten minutes".
 *
 * NOTHING HERE TOUCHES THE NETWORK. Every decision is a pure function over
 * data the caller fetched, so `node --test` drives every branch with no token,
 * no ClickUp and no clock of its own. The IO lives in
 * `scripts/node_heartbeat.mjs`.
 *
 * NO MACHINE IS NAMED HERE (NODES P1). Paths derive from os.homedir().
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const nodeRoles = require('./nodeRoles.js');

// --- where a beat is recorded ----------------------------------------------

/**
 * The local stamp folder. Under Application Support rather than in the repo
 * because it is a fact about the MACHINE, not about the code — a worktree gets
 * deleted when its thread ships, and a beat history that vanishes with it
 * would report a healthy job as silent.
 */
function heartbeatDir(homedir = os.homedir()) {
  return path.join(homedir, 'Library', 'Application Support', 'starcaster', 'heartbeat');
}

function beatFile(role, homedir = os.homedir()) {
  return path.join(heartbeatDir(homedir), `${String(role).replace(/[^a-z0-9-]/gi, '-')}.json`);
}

/**
 * Record a successful run locally. Best effort by design: a job must never
 * fail because its own bookkeeping could not be written, so this reports
 * rather than throws.
 */
function recordBeat({ role, node, at, homedir = os.homedir(), write = fs } = {}) {
  const beat = { role: String(role), node: String(node || ''), at: at || new Date().toISOString() };
  try {
    write.mkdirSync(heartbeatDir(homedir), { recursive: true });
    write.writeFileSync(beatFile(role, homedir), `${JSON.stringify(beat, null, 2)}\n`);
    return { ok: true, beat };
  } catch (err) {
    return { ok: false, beat, why: String(err && err.message) };
  }
}

/**
 * The last local beat for a role.
 *
 * A missing file and an unreadable one are DIFFERENT answers. "Never beat" is
 * a fact; "the file is corrupt" is a thing we could not read, and rendering
 * the second as the first would send somebody hunting a schedule that is fine.
 */
function readBeat({ role, homedir = os.homedir(), read = fs } = {}) {
  const file = beatFile(role, homedir);
  let raw;
  try {
    raw = read.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { found: false, readable: true, file };
    return { found: false, readable: false, file, why: String(err && err.message) };
  }
  try {
    const beat = JSON.parse(raw);
    if (!beat || typeof beat.at !== 'string') {
      return { found: false, readable: false, file, why: 'the stamp has no `at` instant' };
    }
    return { found: true, readable: true, file, beat };
  } catch (err) {
    return { found: false, readable: false, file, why: `the stamp is not JSON — ${String(err && err.message)}` };
  }
}

// --- the shared surface -----------------------------------------------------

/**
 * The roll call's real identity is its NAME, exactly as the pause switch's is
 * (scripts/builder/pipelinePauseStore.js). An id in an env var is a shortcut,
 * never the definition — a shortcut that points at a deleted task must fall
 * back to the name rather than report the whole roll call missing.
 */
const ROLL_CALL_TASK_NAME = 'Node roll call';

const BEGIN = '<!-- roll-call:data -->';
const END = '<!-- /roll-call:data -->';

/**
 * How long a role may go without a beat before it is OVERDUE.
 *
 * 25 hours, not 24: the push is throttled to once a day, so two consecutive
 * pushes can legitimately land a little over 24 hours apart when a run drifts.
 * A threshold equal to the interval reports a healthy job as dead roughly
 * daily, and an alert that cries wolf is an alert nobody reads — which is the
 * failure this slice exists to prevent, wearing a different hat.
 */
const PUSH_EVERY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_AFTER_MS = 25 * 60 * 60 * 1000;

/** One post per role per 6 hours, matching the failure alert's suppression. */
const REPOST_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * The roles that are EXPECTED to beat.
 *
 * Deliberately not "every role in lib/nodeRoles.js". `db-refresh` has no
 * schedule on purpose and a beat from it would mean nothing; the two loop
 * lanes run inside long-lived agent sessions with no committed runner to hang
 * an emitter on, and `pulse-pipelines` lives in another repo. Listing them
 * here as expected would produce a permanent false alarm; omitting them
 * silently would report a system that is 20% instrumented as fully healthy.
 *
 * So they are neither: `rollCallReport` reports an unlisted role as NOT
 * REPORTING, with the reason, every time.
 */
const BEAT_EMITTERS = {
  'bus-relay': {
    why: 'Runs on a launchd schedule every 10 minutes; scripts/run_bus_relay.sh records the beat.',
  },
};

const NOT_REPORTING_WHY = {
  'db-refresh': 'Has no schedule on purpose — it spends production disk IO and wants a person nearby. '
    + 'Nothing to be silent about.',
  'loop-build': 'Runs inside a long-lived agent session, not a launchd job, so there is no committed runner '
    + 'to record a beat from. It gets an emitter when it gets an installer (lib/nodeProvision.js).',
  'loop-review': 'Same as loop-build — one session runs both lanes.',
  'pulse-pipelines': 'Lives in the pulse repo; its runner is not in this checkout.',
};

// --- reading and writing the roll call's payload ----------------------------

/**
 * Pull the machine-readable rows out of a task description.
 *
 * The JSON block is the ONLY thing parsed. The human-readable table rendered
 * beside it is generated from these rows on every write and never read back —
 * the same rule the rest of this repo applies to generated files, for the same
 * reason: two representations that can be edited independently are two
 * answers, and they disagree quietly.
 *
 * An absent block on a description that plainly exists is an EMPTY roll call,
 * which is a real state (nobody has beaten yet).
 *
 * An EMPTY description is NOT that, and the difference was found by driving
 * this against the live API (2026-08-31): ClickUp answers a GET with
 * `markdown_description: ""` even for a task whose description it is holding
 * perfectly well, the content arriving under `description` instead. A parser
 * that read that empty string as "an empty roll call" would report every job
 * in the system as having gone quiet, all at once, off a field that simply was
 * not populated — a false-alarm storm, which is this feature's own failure
 * mode. Every roll call we write carries a preamble, so a roll call with no
 * text at all is something we could not read.
 */
function parseRollCall(description) {
  const text = String(description == null ? '' : description);
  if (!text.trim()) {
    return { parsed: false, rows: [], why: 'the roll call has no description text at all — nothing was read' };
  }
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return { parsed: true, rows: [] };
  const inner = text.slice(start + BEGIN.length, end);
  const fenced = inner.match(/```(?:json)?\s*([\s\S]*?)```/);
  const payload = (fenced ? fenced[1] : inner).trim();
  if (!payload) return { parsed: true, rows: [] };
  try {
    const data = JSON.parse(payload);
    const rows = Array.isArray(data) ? data : (Array.isArray(data && data.rows) ? data.rows : null);
    if (!rows) return { parsed: false, rows: [], why: 'the roll-call block is JSON but not a list of rows' };
    return { parsed: true, rows: rows.filter((r) => r && r.node && r.role && r.at) };
  } catch (err) {
    // NOT an empty roll call. A corrupt block means we do not know when
    // anything last ran, and reporting that as "no beats yet" would be a
    // confident wrong answer about every machine at once.
    return { parsed: false, rows: [], why: `the roll-call block is not JSON — ${String(err && err.message)}` };
  }
}

/** One row per (node, role). A newer beat replaces an older one; nothing else moves. */
function mergeRollCall(existing, incoming) {
  const key = (r) => `${String(r.node).toLowerCase()}::${String(r.role).toLowerCase()}`;
  const out = new Map();
  for (const row of existing || []) out.set(key(row), row);
  for (const row of incoming || []) {
    const prior = out.get(key(row));
    // Never move a row BACKWARDS. Two machines write this description, and a
    // read-modify-write can race; losing the newer beat would invent a silence
    // that never happened.
    if (prior && Date.parse(prior.at) >= Date.parse(row.at)) continue;
    out.set(key(row), row);
  }
  return [...out.values()].sort((a, b) => (`${a.node}${a.role}`).localeCompare(`${b.node}${b.role}`));
}

/** Whole-hours-and-minutes age, for a human reading a table. */
function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'in the future (check the clocks)';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

/**
 * The whole description, rebuilt. Prose first for a person who opens the task,
 * then the generated table, then the data block the machines read.
 */
function renderRollCall(rows, { now = Date.now() } = {}) {
  const sorted = mergeRollCall([], rows);
  const table = sorted.length === 0
    ? '_No beats recorded yet._'
    : [
      '| node | role | last success (UTC) | age |',
      '| --- | --- | --- | --- |',
      ...sorted.map((r) => `| ${r.node} | ${r.role} | ${r.at} | ${ageText(now - Date.parse(r.at))} |`),
    ].join('\n');

  return [
    `The **${ROLL_CALL_TASK_NAME}**. Do not build this, do not close it, do not delete it.`,
    '',
    'Each row is the last time a scheduled job on that machine finished successfully. A job that',
    'fails posts to the bus on its own; this ticket is for the other half — a job that stops firing',
    'writes nothing anywhere, and nothing looks exactly like a quiet week.',
    '',
    'Whichever machine is awake reads this and posts to the bus when a row goes stale, so the check',
    'survives the machine it is checking being switched off. Read it in plain English with',
    '`npm run heartbeat` (`npm run heartbeat -- --check` also posts).',
    '',
    `Rows are pushed at most once a day, and a row older than ${Math.round(OVERDUE_AFTER_MS / 3600000)} hours is reported as overdue.`,
    '',
    '### Last successful run',
    '',
    '_Generated from the block below on every write — edit neither; the next push overwrites both._',
    '',
    table,
    '',
    BEGIN,
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
    END,
    '',
  ].join('\n');
}

// --- the verdict ------------------------------------------------------------

/**
 * What the roll call says, as a decision rather than a printout.
 *
 * `readable: false` is the caller's cue to say CANNOT TELL and post nothing.
 * A watchdog that treats an unreachable ClickUp as "no overdue rows" is a
 * watchdog that goes quiet at exactly the moment the infrastructure is sick —
 * the fail-open shape `pipelinePause.js` was written against.
 */
function rollCallReport({ readable = true, why = '', rows = [], now = Date.now(), roles = nodeRoles.ROLES } = {}) {
  if (!readable) {
    return { readable: false, why, beating: [], overdue: [], notReporting: [], silent: false };
  }

  const beating = [];
  const overdue = [];
  const notReporting = [];

  for (const role of Object.keys(roles)) {
    const owner = roles[role] && roles[role].owner;
    if (!BEAT_EMITTERS[role]) {
      notReporting.push({
        role,
        owner,
        why: NOT_REPORTING_WHY[role] || 'No beat emitter is registered for this role in lib/nodeHeartbeat.js.',
      });
      continue;
    }
    // Only the OWNER's row counts. A stale row left behind by a machine that
    // used to own the job is a cutover artefact, not a heartbeat, and treating
    // it as one would report a job as healthy on the strength of a beat from a
    // machine that has not run it for weeks.
    const row = rows.find(
      (r) => String(r.role).toLowerCase() === role && String(r.node).toLowerCase() === String(owner).toLowerCase(),
    );
    if (!row) {
      overdue.push({ role, owner, at: null, ageMs: null, reason: 'no beat has ever been recorded' });
      continue;
    }
    const ageMs = now - Date.parse(row.at);
    if (!Number.isFinite(ageMs)) {
      overdue.push({ role, owner, at: row.at, ageMs: null, reason: 'its recorded time cannot be read as a date' });
    } else if (ageMs > OVERDUE_AFTER_MS) {
      overdue.push({ role, owner, at: row.at, ageMs, reason: `last succeeded ${ageText(ageMs)}` });
    } else {
      beating.push({ role, owner, at: row.at, ageMs });
    }
  }

  return { readable: true, why: '', beating, overdue, notReporting, silent: overdue.length > 0 };
}

/** Has enough time passed since the last post/push of this kind? */
function dueAgain({ lastAt, now = Date.now(), everyMs }) {
  if (!lastAt) return true;
  const then = Date.parse(lastAt);
  if (!Number.isFinite(then)) return true;
  return now - then >= everyMs;
}

/**
 * The bus message for a silence. Written to be readable by somebody who was
 * not already suspicious, which is the whole requirement: it names the
 * machine, the job, when it last worked, and the one command that says more.
 */
function renderSilencePost({ overdue, now = Date.now(), reportedBy = '' }) {
  const lines = [
    '🔕 **A scheduled job has gone quiet.**',
    '',
    ...overdue.map((o) => `- **${o.role}** on **${o.owner}** — ${o.reason}${o.at ? ` (last beat ${o.at})` : ''}.`),
    '',
    'Nothing failed — that would have posted on its own. This is the other half: the job stopped',
    'firing, which writes nothing anywhere and reads exactly like a quiet week.',
    '',
    'Check it with:',
    '```',
    'npm run doctor:node                      # is that machine still a valid node?',
    './scripts/install_bus_relay.sh --status  # is the schedule installed and loaded?',
    'npm run heartbeat                        # the whole roll call',
    '```',
    '',
    `_Noticed at ${new Date(now).toISOString()}${reportedBy ? ` by ${reportedBy}` : ''}. `
      + `Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until a beat returns._`,
    '',
    '— [CC-starcaster]',
  ];
  return lines.join('\n');
}

/** The bus message for a job that failed — the committed half of the Phase 0 alert. */
function renderFailurePost({ job, node, status, at = new Date().toISOString(), logTail = '', logPath = '' }) {
  return [
    `🚨 **${job} FAILED on ${node}** — exit status ${status} at ${at}.`,
    '',
    logPath ? `Log: \`${logPath}\`` : '',
    logTail ? ['', 'Last lines:', '```', String(logTail).trimEnd(), '```'].join('\n') : '',
    '',
    `_Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until the job succeeds again._`,
    '',
    '— [CC-starcaster]',
  ].filter((l) => l !== '').join('\n');
}

module.exports = {
  BEAT_EMITTERS,
  BEGIN,
  END,
  NOT_REPORTING_WHY,
  OVERDUE_AFTER_MS,
  PUSH_EVERY_MS,
  REPOST_EVERY_MS,
  ROLL_CALL_TASK_NAME,
  ageText,
  beatFile,
  dueAgain,
  heartbeatDir,
  mergeRollCall,
  parseRollCall,
  readBeat,
  recordBeat,
  renderFailurePost,
  renderRollCall,
  renderSilencePost,
  rollCallReport,
};
