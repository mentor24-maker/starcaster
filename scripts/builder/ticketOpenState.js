'use strict';

/**
 * Is this ticket still open? — the ONE answer `npm run thread` and
 * `npm run tidy` both use (SC-875).
 *
 * WHY THIS EXISTS. Both used to ask the ticket door `task-open`, a command of
 * the old ClickUp door (`scripts/clickup_direct.mjs`). The door that `npm run
 * clickup` runs now (`Spirality's scripts/clickup.mjs`) has no such command, so every
 * call printed the usage text and exited 1. `npm run thread` read that exit as
 * "this ticket is not open" and refused EVERY ticket (2026-11-18, SC-843 —
 * open, just claimed, refused). Tidy read it as "could not tell", which was
 * safe, but its closed-ticket clean-up quietly stopped doing anything.
 *
 * The second defect is the one this module exists to make impossible: a
 * refused command is CANNOT TELL, never a verdict (DOCTRINE §3.11). So the
 * reading here is three-way, and only a clean, positive answer gets a verdict:
 *
 *   open     the door answered (exit 0) with this ticket's id, a status that
 *            is not Live, and `ended: (still open)`
 *   closed   the door answered (exit 0) with this ticket's id, and the status
 *            is Live or the `ended:` line names an outcome
 *   unknown  everything else — a non-zero exit (unreachable tracker, a ticket
 *            the tracker does not know, an unknown command, doppler failing),
 *            an answer about a different id, or an answer missing a line
 *
 * Tidy DELETES branches on 'closed', so 'closed' is the strict one: a ticket
 * the tracker says it has never heard of is 'unknown', not 'closed' — a typo'd
 * or old ClickUp-era stamp must never authorise deleting unshipped work.
 *
 * It reads `npm run clickup -- get --task <id>`, the same command a session
 * uses, rather than a new door command, because `loop/` is Spirality's copy
 * and is never edited here.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** The value of a `name:   value` line in the door's `get` output, or null. */
function field(stdout, name) {
  const re = new RegExp(`^${name}:[ \\t]*(.*)$`, 'm');
  const m = re.exec(String(stdout || ''));
  return m ? m[1].trim() : null;
}

/** The last few non-empty lines of what a failed command said, for the reason. */
function lastWords(text) {
  const said = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('>'));
  return said.slice(-2).join(' / ');
}

/**
 * Classify one read of `get --task <id>`. Pure, so every branch is testable.
 *
 * @returns {{ state: 'open'|'closed'|'unknown', reason: string, status?: string }}
 */
function classifyTicketRead({ taskId, exitCode, stdout, stderr }) {
  if (!taskId) return { state: 'unknown', reason: 'no ticket id was given' };
  if (exitCode !== 0) {
    const said = lastWords(`${stderr || ''}\n${stdout || ''}`);
    const how = exitCode === null || exitCode === undefined ? 'did not finish' : `exited ${exitCode}`;
    return { state: 'unknown', reason: `the ticket door ${how}${said ? `: ${said}` : ''}` };
  }
  const id = field(stdout, 'id');
  if (!id) return { state: 'unknown', reason: 'the ticket door answered without an id: line' };
  if (id.toLowerCase() !== String(taskId).trim().toLowerCase()) {
    return { state: 'unknown', reason: `the ticket door answered about ${id}, not ${taskId}` };
  }
  const status = field(stdout, 'status');
  if (!status) return { state: 'unknown', reason: 'the ticket door answered without a status: line' };
  if (status.toLowerCase() === 'live') return { state: 'closed', reason: 'it is Live', status };
  const ended = field(stdout, 'ended');
  if (ended === null) return { state: 'unknown', reason: 'the ticket door answered without an ended: line', status };
  if (ended === '(still open)') return { state: 'open', reason: `it is in ${status}`, status };
  return { state: 'closed', reason: `it has ended (${ended})`, status };
}

/**
 * Ask the tracker. Never throws; a failure of any kind is 'unknown'.
 * `run` is injectable for tests; the default goes through `npm` on PATH.
 */
function readTicketOpenState(taskId, { cwd = REPO_ROOT, run } = {}) {
  if (!taskId) return classifyTicketRead({ taskId });
  const exec = run || ((args) => spawnSync('npm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  let res;
  try {
    res = exec(['run', '--silent', 'clickup', '--', 'get', '--task', String(taskId)]);
  } catch (err) {
    return { state: 'unknown', reason: `the ticket door could not be started: ${err.message}` };
  }
  if (res && res.error) {
    return { state: 'unknown', reason: `the ticket door could not be started: ${res.error.message}` };
  }
  return classifyTicketRead({
    taskId,
    exitCode: res ? res.status : null,
    stdout: res ? res.stdout : '',
    stderr: res ? res.stderr : '',
  });
}

module.exports = { classifyTicketRead, readTicketOpenState };
