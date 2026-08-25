'use strict';

/**
 * ClickUp access for scripts that need JSON answers (`clickup_direct.mjs`'s
 * `queue`/`comments` print for humans; this returns objects).
 *
 * READS are native here — list tasks, read comments — because there is no
 * clean JSON-dump command to shell out to.
 *
 * WRITES shell out to `scripts/clickup_direct.mjs` (the same way this repo's
 * scripts shell out to `gh`), so a status move inherits that command's
 * hard-won safety rails rather than re-deriving them: read-back verification
 * that the status actually stuck (statuses are per-list — a bare PUT 200s a
 * status the list does not have), automatic assignee clearing on a move to a
 * machine status, and the 401/429 coaching. A second, weaker copy of those
 * rules is exactly the drift this tool exists to catch, so it does not keep
 * one.
 *
 * Token contract: CLICKUP_API_TOKEN from the environment, supplied by Doppler
 * via `npm run <script>` — never handled by an agent (DOCTRINE 4.1). The
 * shell-outs inherit the same environment, so they need no token of their own.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
const ROOT = path.join(__dirname, '..', '..');
const DIRECT = path.join(ROOT, 'scripts', 'clickup_direct.mjs');

function requireToken() {
  if (!TOKEN) {
    throw new Error(
      'CLICKUP_API_TOKEN is not set. Run this via `npm run <script>` so Doppler supplies it ' +
      '(package.json wraps it in `doppler run --project starcaster --config dev`).'
    );
  }
}

async function call(method, apiPath, body) {
  requireToken();
  const res = await fetch(`https://api.clickup.com${apiPath}`, {
    method,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* provider returned a non-JSON error page */ }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Every non-archived task in a list, across all pages.
 *
 * Termination is "an empty page OR ClickUp says last_page===true", never
 * "last_page !== false": the API can OMIT last_page, and `undefined !== false`
 * is true, so the old sentinel returned after page 0 and silently truncated
 * any list past 100 tasks. An empty page always terminates, so an absent flag
 * just means "fetch the next page" rather than "stop and hope".
 */
async function listTasks(listId, { includeClosed = false } = {}) {
  // includeClosed: ClickUp's v2 list endpoint omits closed-type statuses
  // (`Live` among them) unless asked. Opt-in, so callers that want only open
  // work are unaffected.
  const tasks = [];
  const closedParam = includeClosed ? '&include_closed=true' : '';
  for (let page = 0; page < 50; page++) {
    const out = await call('GET', `/api/v2/list/${listId}/task?archived=false${closedParam}&page=${page}`);
    if (!out.ok) throw new Error(`listTasks(${listId}) page ${page}: HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
    const batch = Array.isArray(out.json.tasks) ? out.json.tasks : [];
    tasks.push(...batch);
    if (batch.length === 0 || out.json.last_page === true) return tasks;
  }
  throw new Error(`listTasks(${listId}): stopped after 50 pages — implausibly large, treat as incomplete`);
}

/**
 * Every comment on a task, oldest first, across ALL pages.
 *
 * The endpoint returns ~25 newest-first; a chatty task scrolls its
 * "PR opened: …" comment out of the first page, and a one-page read then
 * reports "no PR linked" for a task that has one — drift the tool invents.
 * Pages via `start`/`start_id` (the oldest comment in a page seeds the next),
 * until a short page or the cap.
 */
async function getTaskComments(taskId) {
  const all = [];
  let query = '';
  for (let page = 0; page < 40; page++) {
    const out = await call('GET', `/api/v2/task/${taskId}/comment${query}`);
    if (!out.ok) throw new Error(`getTaskComments(${taskId}): HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
    const batch = Array.isArray(out.json.comments) ? out.json.comments : [];
    all.push(...batch);
    if (batch.length < 25) break;
    const oldest = batch[batch.length - 1];
    if (!oldest?.id || !oldest?.date) break;
    query = `?start=${encodeURIComponent(oldest.date)}&start_id=${encodeURIComponent(oldest.id)}`;
  }
  // API order is newest-first within a page; reverse the whole set to oldest-first.
  return all.reverse().map((c) => c.comment_text || '');
}

/**
 * Move a task's status through the verified direct door. Throws on any
 * outcome that is not a confirmed, stuck change — including the per-list
 * "that status does not exist" 200 that a bare PUT would report as success.
 * Returns the command's own report line.
 */
function moveTaskStatus(taskId, status) {
  requireToken();
  try {
    return execFileSync('node', [DIRECT, 'status', '--task', String(taskId), '--status', status], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
    throw new Error(`move task ${taskId} -> "${status}" failed: ${detail.slice(0, 300)}`);
  }
}

/** Post to the bus through the direct door (inherits its quota reporting). */
function postBusMessage(channelId, text) {
  requireToken();
  try {
    return execFileSync('node', [DIRECT, 'chat', '--channel', String(channelId), '--body-file', '-'], {
      cwd: ROOT, input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
    throw new Error(`post to bus channel ${channelId} failed: ${detail.slice(0, 300)}`);
  }
}

module.exports = {
  WORKSPACE,
  listTasks,
  getTaskComments,
  moveTaskStatus,
  postBusMessage,
};
