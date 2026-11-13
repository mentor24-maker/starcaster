'use strict';

/**
 * trackerDoor — the watchdogs' one way to read and write tickets, through the
 * ticket door (`loop/scripts/clickup.mjs`), never ClickUp (SC-794).
 *
 * WHY THIS EXISTS. StarCaster's tickets moved to the tracker on 2026-11-12
 * (SC-790). Slice 1 (SC-791) sent every alarm to the tracker's bus, but the
 * watchdogs on the relay's wake still READ ClickUp's Loop Queue — a list
 * nothing writes to any more — so each one answered CANNOT TELL (or, worse,
 * read a frozen list as the truth). This file is the replacement for the
 * handful of `scripts/lib/clickup.cjs` reads and writes they used, in the
 * SAME SHAPES those callers already consume, so the counting code behind them
 * (lib/loopThroughput.js, lib/staleReady.js, the reconciler's scans) did not
 * have to change:
 *
 *   listTasks()            `tickets --json`, each ticket shaped like a ClickUp
 *                          task (status.status, date_closed, ...)
 *   getTask(id)            `get`, as { ok, status, json } like clickup.call
 *   getTaskCommentRecords  `tickets --json --comments`, as ClickUp comment
 *                          records (comment_text, user.id, date), newest first
 *   createTask / describeTask / setOperatorAssigned / moveTaskStatus /
 *   commentOnTask          `task`, `describe`, `status`, `comment`
 *
 * Every write goes through a door command that reads its own write back and
 * exits non-zero when it did not stick, so a non-zero exit here is a failed
 * write, never a success line.
 *
 * WHICH ADDRESS. The same rule `postBusMessage` follows (clickup.cjs,
 * `busPostEnv`): on the Mini the door's configured 127.0.0.1 reaches the
 * tracker; everywhere else (the MacBook's watchdog wake, on purpose) the door
 * is pointed at the config's network address, `trackerUrl`.
 *
 * WHICH SEAT. The door picks the token from TRACKER_TOKEN_NAME, which a loop
 * runner exports; a watchdog on the relay's wake sets none, so it signs in as
 * the project's hand-run seat. Doppler supplies the value via
 * loop/scripts/with_doppler.mjs; this file never sees it.
 *
 * Synchronous underneath (one subprocess per door command). Callers that
 * `await` these get the value straight back, which is all they need.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { busPostEnv, shellFailureDetail } = require('./clickup.cjs');

const ROOT = path.join(__dirname, '..', '..');
const WITH_DOPPLER = path.join(ROOT, 'loop', 'scripts', 'with_doppler.mjs');
const TICKET_DOOR = path.join(ROOT, 'loop', 'scripts', 'clickup.mjs');
const DOOR_TIMEOUT_MS = Number(process.env.TRACKER_DOOR_TIMEOUT_MS) || 3 * 60 * 1000;

function readProjectConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'spirality.project.json'), 'utf8')); } catch { return {}; }
}
const PROJECT_CONFIG = readProjectConfig();

/** The tracker project the loop's tickets live in. */
const PROJECT = PROJECT_CONFIG.projectSlug || 'starcaster';
/** The tracker project the standing tickets (roll call, SQL, broken links) and the bus live in. */
const BUS_PROJECT = PROJECT_CONFIG.busProject || 'starcaster-bus';
/** Dane's seat ON THE TRACKER. Not the ClickUp id 48012725: that seat writes nothing here. */
const OPERATOR_ID = Number(PROJECT_CONFIG.operatorUserId || 1);
/** The page a person opens for a ticket (not the API address the door calls). */
const TRACKER_URL = String(PROJECT_CONFIG.trackerUrl || 'http://mac-mini.local:4180').replace(/\/$/, '');

/**
 * Is this a tracker ticket id ("SC-12", "SCBUS-3")? A standing ticket's
 * remembered id from before the move is a ClickUp one ("86bcwam1k"): a
 * watcher holding one has never written its ticket on the tracker, so it must
 * not believe "the ticket already says this" (SC-794).
 */
function isTrackerId(id) {
  return /^[A-Z][A-Z0-9]*-\d+$/i.test(String(id || ''));
}

function ticketUrl(id) {
  return `${TRACKER_URL}/t/${id}`;
}

let doorRuns = 0;
/** How many door commands this process ran: the closing "requests" line. */
function requestsMade() { return doorRuns; }

function thisNodeName() {
  try { return require('../../lib/nodeRoles.js').thisNode().name || ''; } catch { return ''; }
}

/**
 * Run one door command and return its stdout. Throws, naming `what` and the
 * door's own reason, on a non-zero exit or a timeout. `run` and `env` are
 * injectable so the tests reach every branch without a tracker.
 */
function runDoor(args, {
  input, what = args[0], timeoutMs = DOOR_TIMEOUT_MS, run = execFileSync, env = process.env, node,
} = {}) {
  doorRuns += 1;
  try {
    return String(run('node', [WITH_DOPPLER, 'node', TICKET_DOOR, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: 256 * 1024 * 1024,
      env: busPostEnv({ node: node === undefined ? thisNodeName() : node, env, project: PROJECT_CONFIG }),
    }));
  } catch (err) {
    throw new Error(`${what} on the tracker failed: ${shellFailureDetail(err, timeoutMs)}`);
  }
}

/** An ISO time as ClickUp's millisecond string, or null. */
function ms(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? String(t) : null;
}

const CLOSED_STATUSES = new Set(['live']);

/**
 * One `tickets --json` object in the shape the callers read off a ClickUp
 * task. `date_closed` is when a Live ticket entered Live — Live is the one
 * closed status, and that is exactly the instant ClickUp used to stamp.
 */
function asClickUpTask(t) {
  const status = String(t.status || '').toLowerCase();
  const closed = CLOSED_STATUSES.has(status);
  return {
    id: String(t.id),
    name: t.name,
    status: { status, type: closed ? 'closed' : 'custom' },
    priority: t.priority ? { priority: t.priority } : null,
    tags: (t.tags || []).map((name) => ({ name })),
    date_created: ms(t.created),
    date_updated: ms(t.updated),
    date_closed: closed ? ms(t.statusSince) : null,
    status_since: ms(t.statusSince),
    url: ticketUrl(t.id),
  };
}

/** One `tickets --json --comments` comment as a ClickUp comment record. */
function asCommentRecord(c) {
  return {
    id: String(c.id),
    comment_text: String(c.text ?? ''),
    user: { id: c.author?.id ?? null, username: c.author?.name ?? null },
    date: ms(c.at),
  };
}

function parseTickets(stdout, what) {
  let out;
  try { out = JSON.parse(String(stdout || '').trim() || 'null'); } catch { out = null; }
  if (!Array.isArray(out)) throw new Error(`${what}: the door printed something that is not a JSON list of tickets`);
  return out;
}

function ticketsArgs({ project, includeClosed, comments }) {
  const args = ['tickets', '--json', '--project', project];
  if (includeClosed) args.push('--include-closed');
  if (comments) args.push('--comments');
  return args;
}

/**
 * Every ticket in `project` (the loop's own by default), shaped like ClickUp
 * tasks. Open tickets only unless `includeClosed`. Throws on any failed read:
 * the door prints nothing at all rather than half a list.
 */
async function listTasks({ project = PROJECT, includeClosed = false, timeoutMs, run, env } = {}) {
  const what = `reading the ${project} tickets`;
  const stdout = runDoor(ticketsArgs({ project, includeClosed, comments: false }), { what, timeoutMs, run, env });
  return parseTickets(stdout, what).map(asClickUpTask);
}

// One read of every comment per process, per scope: the door has no per-ticket
// JSON comment read, and its human `comments` print is not a contract. Open
// tickets first (a handful, so cheap); a ticket not among them costs the one
// read that includes Live.
const commentCache = new Map();
function commentsIn({ project, includeClosed, timeoutMs, run, env }) {
  const key = `${project}|${includeClosed ? 'all' : 'open'}`;
  if (!commentCache.has(key)) {
    const what = `reading the comments on the ${project} tickets`;
    const stdout = runDoor(ticketsArgs({ project, includeClosed, comments: true }), { what, timeoutMs, run, env });
    const byId = new Map();
    for (const t of parseTickets(stdout, what)) {
      // Oldest first from the door; ClickUp's order (newest first) out.
      byId.set(String(t.id).toLowerCase(), (t.comments || []).map(asCommentRecord).reverse());
    }
    commentCache.set(key, byId);
  }
  return commentCache.get(key);
}

/**
 * Every top-level comment on one ticket, as ClickUp comment records, newest
 * first (the order `clickup.getTaskCommentRecords` answered in). Throws on a
 * failed read, and when the ticket is in neither read: no comments and an
 * unknown ticket are different findings.
 */
async function getTaskCommentRecords(taskId, { project = PROJECT, timeoutMs, run, env } = {}) {
  const id = String(taskId).toLowerCase();
  const open = commentsIn({ project, includeClosed: false, timeoutMs, run, env });
  if (open.has(id)) return open.get(id);
  const all = commentsIn({ project, includeClosed: true, timeoutMs, run, env });
  if (all.has(id)) return all.get(id);
  throw new Error(`ticket ${taskId} is not in the ${project} project on the tracker`);
}

/** The comments, or null when they could not be read (the stale-* checks' contract). */
async function readComments(taskId, opts) {
  try { return await getTaskCommentRecords(taskId, opts); } catch { return null; }
}

/**
 * Forget every comment read so far. The cache is one read per process, which
 * is right for a watchdog that reads once; a command that WRITES a comment and
 * then reads it back (the pause switch's `writeRecord`) must not be answered
 * from before its own write.
 */
function forgetComments() { commentCache.clear(); }

function _resetCacheForTests() { commentCache.clear(); doorRuns = 0; }

/**
 * `get`'s print, taken apart: the header lines, then everything after the
 * first `---` line is the description, exactly as stored. The header can
 * never hold a `---` line, so the first one is the boundary.
 */
function parseGet(stdout) {
  const lines = String(stdout || '').split('\n');
  const cut = lines.indexOf('---');
  if (cut < 0) return null;
  const head = {};
  for (const line of lines.slice(0, cut)) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line);
    if (m && !(m[1] in head)) head[m[1]] = m[2];
  }
  if (!head.id) return null;
  let body = lines.slice(cut + 1).join('\n').replace(/\n$/, '');
  if (body === '(no body)') body = '';
  const assignees = [...String(head.assigned || '').matchAll(/\((\d+)\)/g)].map((m) => ({ id: Number(m[1]) }));
  return {
    id: head.id,
    name: head.name || '',
    status: { status: String(head.status || '').toLowerCase() },
    assignees,
    markdown_description: body,
    description: body,
    url: ticketUrl(head.id),
  };
}

/**
 * One ticket, as `{ ok, status, json }` — the envelope `clickup.call('GET',
 * '/task/<id>')` answered with, so a caller's `out.ok` test still means "the
 * read came back". Never throws: `why` says what failed.
 */
async function getTask(taskId, { timeoutMs, run, env } = {}) {
  try {
    const json = parseGet(runDoor(['get', '--task', String(taskId)], { what: `reading ticket ${taskId}`, timeoutMs, run, env }));
    if (!json) return { ok: false, status: 0, json: null, why: `ticket ${taskId}: the door's answer had no ticket in it` };
    return { ok: true, status: 200, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, why: String(err.message || err).slice(0, 300) };
  }
}

/** A temp file for a door command that wants a path (`--id-out`). */
function tempFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-door-'));
  return { path: path.join(dir, name), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * File a ticket in `project` and read back its id. `{ ok, json: { id, url }, why }`;
 * never throws. The door refuses a body it would mangle and exits non-zero if
 * the name, status or body did not stick.
 */
async function createTask({ project = BUS_PROJECT, name, status, body, timeoutMs, run, env } = {}) {
  const idOut = tempFile('id');
  try {
    const args = ['task', '--list', project, '--name', name, '--body-file', '-', '--id-out', idOut.path];
    if (status) args.push('--status', status);
    runDoor(args, { input: body, what: `filing "${name}" in ${project}`, timeoutMs, run, env });
    let id = '';
    try { id = fs.readFileSync(idOut.path, 'utf8').trim(); } catch { /* said below */ }
    if (!id) return { ok: false, why: `filed "${name}", but the door wrote no id back` };
    return { ok: true, status: 200, json: { id, name, url: ticketUrl(id) } };
  } catch (err) {
    return { ok: false, why: String(err.message || err).slice(0, 300) };
  } finally {
    idOut.cleanup();
  }
}

/** REPLACE a ticket's description (the door reads it back). `{ ok, why }`; never throws. */
async function describeTask(taskId, body, { timeoutMs, run, env } = {}) {
  try {
    runDoor(['describe', '--task', String(taskId), '--body-file', '-'], { input: body, what: `rewriting ticket ${taskId}`, timeoutMs, run, env });
    return { ok: true };
  } catch (err) {
    return { ok: false, why: String(err.message || err).slice(0, 300) };
  }
}

/**
 * Put Dane on a standing ticket (`assign: true`) or take everybody off it
 * (`false`), leaving its status where it is. The door verifies the assignees
 * from the write's own answer. `{ ok, why }`; never throws.
 */
async function setOperatorAssigned(taskId, assign, { status, timeoutMs, run, env } = {}) {
  const args = ['status', '--task', String(taskId), '--status', status, '--no-auto-assign'];
  if (assign) args.push('--assign', String(OPERATOR_ID));
  else args.push('--clear-assignees');
  try {
    runDoor(args, { what: `${assign ? 'assigning Dane to' : 'clearing the assignees on'} ticket ${taskId}`, timeoutMs, run, env });
    return { ok: true };
  } catch (err) {
    return { ok: false, why: String(err.message || err).slice(0, 300) };
  }
}

/**
 * Move a ticket, through the door's verified `status`. `ifStatus` makes it a
 * guarded move: the tracker refuses the write if the ticket has left that
 * status, which surfaces here as a throw. Same contract as
 * clickup.cjs `moveTaskStatus`, which the reconciler used.
 */
function moveTaskStatus(taskId, status, { ifStatus = null, timeoutMs, run, env } = {}) {
  const guard = ifStatus ? ['--if-status', String(ifStatus)] : [];
  return runDoor(['status', '--task', String(taskId), '--status', status, ...guard], {
    what: `moving ticket ${taskId} -> "${status}"${ifStatus ? ` (only while it is "${ifStatus}")` : ''}`,
    timeoutMs, run, env,
  }).trim();
}

/** A comment on a ticket, read back by the door. Throws when it did not land. */
function commentOnTask(taskId, text, { timeoutMs, run, env } = {}) {
  return runDoor(['comment', '--task', String(taskId), '--body-file', '-'], {
    input: text, what: `commenting on ticket ${taskId}`, timeoutMs, run, env,
  }).trim();
}


/**
 * A STANDING TICKET — one ticket, found by its NAME in the bus project and
 * rewritten in place, with Dane assigned while it holds something for him
 * ("SQL waiting for you", "Broken links on client sites"). One routine for
 * both, because they were two copies of the same ClickUp routine.
 *
 *   assign   true: Dane on it / false: nobody on it / null: leave it alone
 *   remembered  the id this machine wrote last time; a shortcut only — a
 *            ticket that is gone or renamed falls back to the name. (Ids
 *            remembered from ClickUp simply miss and fall back.)
 *
 * Created when absent, never duplicated: a list that could not be read is a
 * failure, never "absent". The description and the assignees are both read
 * back afterwards. Returns { ok, id, url, why }; never throws.
 */
async function writeStandingTicket({
  name, body, assign = null, remembered = '', status = 'Live', project = BUS_PROJECT, verdict, run, env,
} = {}) {
  const named = (t) => String(t?.name || '').trim().toLowerCase() === String(name).trim().toLowerCase();
  const opts = { run, env };
  let task = null;
  if (remembered) {
    const out = await getTask(remembered, opts);
    if (out.ok && named(out.json)) task = out.json;
  }
  if (!task) {
    let listed;
    try {
      listed = (await listTasks({ project, includeClosed: true, ...opts })).find(named) || null;
    } catch (err) {
      return { ok: false, why: `reading the tracker's ${project} project: ${String(err?.message || err).slice(0, 200)}` };
    }
    if (listed) {
      const out = await getTask(listed.id, opts);
      if (!out.ok) return { ok: false, id: listed.id, url: listed.url, why: out.why };
      task = out.json;
    }
  }
  if (!task) {
    const made = await createTask({ project, name, status, body, ...opts });
    if (!made.ok) return { ok: false, why: `creating the ticket: ${made.why}` };
    task = { id: made.json.id, url: made.json.url, assignees: [] };
  } else {
    const wrote = await describeTask(task.id, body, opts);
    if (!wrote.ok) return { ok: false, id: task.id, url: task.url, why: wrote.why };
  }
  const has = (task.assignees || []).map((a) => Number(a.id));
  const onlyDane = has.length === 1 && has[0] === OPERATOR_ID;
  if ((assign === true && !onlyDane) || (assign === false && has.length)) {
    const moved = await setOperatorAssigned(task.id, assign, { status, ...opts });
    if (!moved.ok) return { ok: false, id: task.id, url: task.url, why: `the description landed but the assignees did not: ${moved.why}` };
  }
  const back = await getTask(task.id, opts);
  if (!back.ok) return { ok: false, id: task.id, url: task.url, why: `written, but reading it back failed (${back.why})` };
  if (verdict) {
    const landed = verdict({ sent: body, readBack: back.json.markdown_description });
    if (!landed.ok) return { ok: false, id: task.id, url: task.url, why: landed.why };
  }
  const ids = back.json.assignees.map((a) => Number(a.id));
  const assignedRight = assign === null || (assign ? ids.length === 1 && ids[0] === OPERATOR_ID : ids.length === 0);
  if (!assignedRight) return { ok: false, id: task.id, url: task.url, why: `the description landed but the assignees read back as [${ids.join(', ')}]` };
  return { ok: true, id: task.id, url: back.json.url, why: '' };
}

module.exports = {
  PROJECT,
  BUS_PROJECT,
  OPERATOR_ID,
  TRACKER_URL,
  ticketUrl,
  isTrackerId,
  runDoor,
  requestsMade,
  asClickUpTask,
  asCommentRecord,
  listTasks,
  getTaskCommentRecords,
  readComments,
  parseGet,
  getTask,
  createTask,
  describeTask,
  setOperatorAssigned,
  moveTaskStatus,
  commentOnTask,
  writeStandingTicket,
  forgetComments,
  _resetCacheForTests,
};
