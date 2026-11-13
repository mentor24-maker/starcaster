'use strict';

/**
 * THE TRACKER'S TICKETS, FOR A SCHEDULED CHECK (SC-793).
 *
 * StarCaster's tickets moved from ClickUp to the tracker on 2026-11-12
 * (SC-790). The scheduled checks used to read ClickUp's API directly; the
 * tracker's door (`loop/scripts/clickup.mjs`, the same one `npm run clickup`
 * runs) has one read-only command for them instead, `tickets --json`, and this
 * file is the one way StarCaster's own scripts call it.
 *
 *   readTickets({ project, includeClosed, comments })   the tickets, as data
 *   asLoopTasks(rows)                                    the same, in the shape
 *                                                        the pure checks read
 *   runDoor(args, { input })                             any other door command
 *                                                        (a write: task, describe)
 *
 * `readTickets` builds its own arguments and can only ever run `tickets`, so a
 * read-only caller (`scripts/pulse.cjs`) that imports it alone has no way to
 * write by accident. `runDoor` is the write-capable half, kept apart for
 * callers that are allowed to write (`scripts/pulse_publish.mjs`).
 *
 * Off the Mini the door is pointed at the tracker's network address, exactly
 * as a bus post is (`busPostEnv` in ./clickup.cjs): the config's API address
 * is the Mini's loopback, which reaches nothing from another machine.
 *
 * Every call has a deadline (an unbounded subprocess hangs a launchd job
 * completely: scripts/lib/clickup.cjs, "EVERY CALL OUT OF THIS FILE HAS A
 * DEADLINE"). A failure THROWS with the door's own reason; it never returns an
 * empty list, because a check that reads "no tickets" from a failed read
 * reports a quiet queue that is not quiet.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { busPostEnv, shellFailureDetail } = require('./clickup.cjs');

const ROOT = path.join(__dirname, '..', '..');
const WITH_DOPPLER = path.join(ROOT, 'loop', 'scripts', 'with_doppler.mjs');
const TICKET_DOOR = path.join(ROOT, 'loop', 'scripts', 'clickup.mjs');
const DOOR_TIMEOUT_MS = 2 * 60 * 1000;

function projectConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'spirality.project.json'), 'utf8')); } catch { return {}; }
}

function thisNodeName() {
  try { return require('../../lib/nodeRoles.js').thisNode().name; } catch { return ''; }
}

/** The door's arguments for a ticket read. Pure, so a test can pin them. */
function ticketsArgs({ project, includeClosed = false, comments = false } = {}) {
  const args = ['tickets', '--json'];
  if (includeClosed) args.push('--include-closed');
  if (project) args.push('--project', String(project));
  if (comments) args.push('--comments');
  return args;
}

/**
 * What `tickets --json` printed, as an array. The door prints the JSON on
 * stdout and its notes on stderr; anything that is not an array is a failed
 * read, never an empty one.
 */
function parseTicketsOutput(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('[');
  if (start < 0) throw new Error(`the tracker's tickets read printed no JSON list (${text.trim().slice(0, 160) || 'nothing at all'})`);
  let rows;
  try { rows = JSON.parse(text.slice(start)); } catch (err) {
    throw new Error(`the tracker's tickets read printed JSON that could not be parsed (${String(err?.message || err).slice(0, 160)})`);
  }
  if (!Array.isArray(rows)) throw new Error('the tracker\'s tickets read did not print a list');
  return rows;
}

/** Run one door command, bounded, under Doppler. Throws with the door's reason. */
/**
 * `config` is the project config (spirality.project.json's object), used only
 * to decide the tracker's address off the Mini. It is NOT `readTickets`'s
 * `project`, which is a tracker project's slug for `--project`; one name for
 * both meant a test's config object became `--project [object Object]` and
 * never reached the address decision (SC-793 review).
 */
function runDoor(args, {
  input, what, timeoutMs = DOOR_TIMEOUT_MS, run = execFileSync, env = process.env, node = thisNodeName(), config,
} = {}) {
  try {
    return String(run('node', [WITH_DOPPLER, 'node', TICKET_DOOR, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      input,
      stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: busPostEnv({ node, env, ...(config ? { project: config } : {}) }),
    }));
  } catch (err) {
    throw new Error(`${what || `the tracker's ${args[0]}`} failed: ${shellFailureDetail(err, timeoutMs)}`);
  }
}

/** The tickets of a tracker project (this project's own when none is named). */
function readTickets({ project, includeClosed = false, comments = false, ...opts } = {}) {
  const args = ticketsArgs({ project, includeClosed, comments });
  return parseTicketsOutput(runDoor(args, { what: `reading the tracker's tickets (${args.join(' ')})`, ...opts }));
}

/** A ticket's human page on the tracker (`trackerUrl`/t/<id>), or '' when unknown. */
function ticketPageUrl(id, config = projectConfig()) {
  const base = String(config.trackerUrl || '').replace(/\/+$/, '');
  return base && id ? `${base}/t/${id}` : '';
}

/**
 * What `get --task <id>` printed, minus its header: the description as stored,
 * or null when the output has no description at all (which a read-back must
 * treat as unread, never as an empty description).
 */
/** What the door's `get` prints in place of an empty description. */
const NO_BODY_PLACEHOLDER = '(no body)';

function descriptionFromGet(printed) {
  const text = String(printed || '');
  const cut = text.indexOf('\n---\n');
  if (cut < 0) return null;
  const body = text.slice(cut + 5).replace(/\n\s*tracker: \d+ request\(s\) this run\s*$/, '').trim();
  // The door prints this placeholder for a ticket with NO description
  // (loop/scripts/clickup.mjs `get`). It is not text anybody wrote, so it
  // reads as empty — otherwise a wiped report read back as TRUNCATED, which
  // names the wrong failure (SC-793 review).
  return body === NO_BODY_PLACEHOLDER ? '' : body;
}

/**
 * `tickets --json` rows in the shape the pure checks were written against
 * (ClickUp's task and comment objects), so their logic and their tests are
 * unchanged by the move:
 *
 *   task     { id, name, status: { status }, date_updated (ms), url }
 *   comment  { id, comment_text, user: { id, username }, date (ms) }, oldest first
 *
 * `status.type` is left out on purpose: the tracker has no status types, and
 * the checks fall back to the status name (`live` is the terminal one).
 * Returns `{ tasks, commentsById }`; a row read without `--comments` has no
 * entry in `commentsById`, which a caller must treat as "not read", not "none".
 */
function asLoopTasks(rows, { config = projectConfig() } = {}) {
  const tasks = [];
  const commentsById = new Map();
  for (const row of rows || []) {
    const id = String(row.id);
    const updated = Date.parse(row.updated);
    tasks.push({
      id,
      name: row.name,
      status: { status: String(row.status || '').toLowerCase() },
      date_updated: Number.isFinite(updated) ? updated : null,
      url: ticketPageUrl(id, config),
    });
    if (Array.isArray(row.comments)) {
      commentsById.set(id, row.comments.map((c) => ({
        id: String(c.id),
        comment_text: String(c.text ?? ''),
        user: { id: c.author?.id ?? null, username: c.author?.name ?? null },
        date: Date.parse(c.at),
      })));
    }
  }
  return { tasks, commentsById };
}

module.exports = {
  DOOR_TIMEOUT_MS,
  ticketsArgs,
  parseTicketsOutput,
  runDoor,
  readTickets,
  ticketPageUrl,
  descriptionFromGet,
  NO_BODY_PLACEHOLDER,
  asLoopTasks,
  projectConfig,
};
