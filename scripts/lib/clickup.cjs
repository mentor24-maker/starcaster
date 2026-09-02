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

/**
 * EVERY CALL OUT OF THIS FILE HAS A DEADLINE, and until 2026-09-02 none of
 * them did (task 86bbqz7rg, review round 2).
 *
 * Node's `fetch` has no default request timeout and `execFileSync` has no
 * default `timeout:`, so a half-open connection to ClickUp does not fail — it
 * waits, effectively forever. For a script somebody is watching that is an
 * annoyance. For a SCHEDULED job it is the worst available outcome: launchd
 * will not start a second copy while the first is still going, so the caller
 * never exits, never prints, never returns non-zero, and
 * `report_job_failure.mjs` never fires. The only thing that eventually
 * notices is the 25-hour roll call, which would announce that the job has
 * "stopped firing" about a job that is firing and stuck — sending the next
 * reader to launchd instead of to a stuck socket.
 *
 * A deadline turns that into an ordinary loud failure: the call throws with a
 * message that names the timeout, the caller's existing catch treats it like
 * any other failed read, and the next run tries again.
 *
 * KNOWN RESIDUAL, BY DESIGN: `listTasks` pages, so a ClickUp that is slow but
 * still answering is bounded at (pages x timeout), not at one timeout — up to
 * 50 x 60s in the worst case. A call that HANGS throws on the first page and
 * does not multiply, which is the failure this bound exists for. A caller on
 * a tight schedule passes a smaller `timeoutMs` to bring the product under its
 * own cadence; `scripts/pulse_publish.mjs` does exactly that and shows the
 * arithmetic.
 */
const HTTP_TIMEOUT_MS = Number(process.env.CLICKUP_HTTP_TIMEOUT_MS) || 60 * 1000;
const SHELL_TIMEOUT_MS = Number(process.env.CLICKUP_SHELL_TIMEOUT_MS) || 2 * 60 * 1000;

/**
 * The API root. A constant in every real run; overridable ONLY so the deadline
 * above can be proven against a server that deliberately never answers, which
 * is the one thing a pure test of the message cannot show
 * (`scripts/builder/clickupTimeouts.test.js`).
 */
const API_BASE = process.env.CLICKUP_API_BASE || 'https://api.clickup.com';

function requireToken() {
  if (!TOKEN) {
    throw new Error(
      'CLICKUP_API_TOKEN is not set. Run this via `npm run <script>` so Doppler supplies it ' +
      '(package.json wraps it in `doppler run --project starcaster --config dev`).'
    );
  }
}

async function call(method, apiPath, body, { timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  requireToken();
  let res;
  try {
    res = await fetch(`${API_BASE}${apiPath}`, {
      method,
      headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      // The deadline covers the response HEADERS. `res.text()` below is bounded
      // by the same signal, because aborting the signal also errors a body that
      // is still streaming.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(timeoutAwareMessage(err, `${method} ${apiPath}`, timeoutMs));
  }
  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw new Error(timeoutAwareMessage(err, `${method} ${apiPath} (reading the response body)`, timeoutMs));
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* provider returned a non-JSON error page */ }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Name the timeout when it was one. A caller that logs `The operation was
 * aborted` sends its reader looking for a bug in this file; one that logs the
 * deadline sends them to the network, which is where the fault is.
 *
 * Both shapes are checked because they are produced by different layers:
 * `AbortSignal.timeout` rejects with a DOMException named `TimeoutError`, and
 * an abort arriving while the body streams surfaces as `AbortError`.
 */
function timeoutAwareMessage(err, what, timeoutMs) {
  const name = String(err?.name || '');
  const timedOut = name === 'TimeoutError' || name === 'AbortError' || err?.code === 'ABORT_ERR';
  if (timedOut) {
    return `ClickUp ${what} did not answer within ${Math.round(timeoutMs / 1000)}s and was abandoned `
      + '(a hung connection, not an error response — the request was given up on, not retried)';
  }
  return `ClickUp ${what} failed: ${String(err?.message || err).slice(0, 300)}`;
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
async function listTasks(listId, { includeClosed = false, timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  // includeClosed: ClickUp's v2 list endpoint omits closed-type statuses
  // (`Live` among them) unless asked. Opt-in, so callers that want only open
  // work are unaffected.
  const tasks = [];
  const closedParam = includeClosed ? '&include_closed=true' : '';
  for (let page = 0; page < 50; page++) {
    const out = await call(
      'GET',
      `/api/v2/list/${listId}/task?archived=false${closedParam}&page=${page}`,
      undefined,
      { timeoutMs },
    );
    if (!out.ok) throw new Error(`listTasks(${listId}) page ${page}: HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
    const batch = Array.isArray(out.json.tasks) ? out.json.tasks : [];
    tasks.push(...batch);
    if (batch.length === 0 || out.json.last_page === true) return tasks;
  }
  throw new Error(`listTasks(${listId}): stopped after 50 pages — implausibly large, treat as incomplete`);
}

/** ClickUp hands back at most this many comments per page, newest first. */
const COMMENT_PAGE_SIZE = 25;

/**
 * The PAGING RULE for a task's comments — the rule only, with no transport and
 * no failure policy of its own.
 *
 * The endpoint returns ~25 comments, newest first, and a chatty task scrolls
 * its own history off page one. `start`/`start_id`, seeded from the OLDEST
 * comment of each page, walks backwards through the rest.
 *
 * It lives here, injected rather than hard-wired, because a second copy of
 * this rule is not a second copy of some code — it is a second answer to
 * "have I read the whole trail", and the two disagree silently. The pipeline
 * pause switch learned that the expensive way on 2026-08-25: its state is one
 * comment on a task that also gets an hourly reminder comment, so after about
 * 25 hours the PAUSE record scrolled off page one, an unpaged read found no
 * state, and the pause reported itself as RUNNING — the one feature whose
 * whole premise is failing safe, failing open.
 *
 * `get(path)` answers `{ ok, json }` and MUST NOT throw; what a failed read
 * means is the caller's decision, and the two callers decide differently (this
 * file throws, the pause store reports "unreadable", which means "paused").
 *
 *   complete: true   the whole trail is in `comments`, newest-first.
 *   complete: false  it is NOT all there — `failed` carries the bad response,
 *                    or `capped` says it ran past `maxPages`.
 */
async function pageComments({ get, taskId, maxPages = 40 }) {
  const comments = [];
  let query = '';
  for (let page = 0; page < maxPages; page += 1) {
    const out = await get(`/api/v2/task/${taskId}/comment${query}`);
    if (!out || out.ok !== true) return { complete: false, comments, failed: out || null, capped: false };
    const batch = Array.isArray(out.json && out.json.comments) ? out.json.comments : [];
    comments.push(...batch);
    // A short page is the end of the trail. There is no `last_page` on this
    // endpoint, so the page size IS the terminator.
    if (batch.length < COMMENT_PAGE_SIZE) return { complete: true, comments, failed: null, capped: false };
    const oldest = batch[batch.length - 1];
    // No cursor to seed the next page with: stop rather than re-request the
    // same page forever. Reported as INCOMPLETE, because it is.
    if (!oldest || !oldest.id || !oldest.date) return { complete: false, comments, failed: null, capped: true };
    query = `?start=${encodeURIComponent(oldest.date)}&start_id=${encodeURIComponent(oldest.id)}`;
  }
  return { complete: false, comments, failed: null, capped: true };
}

/**
 * Every comment on a task, oldest first, across ALL pages.
 *
 * Throws on an incomplete read — the same choice `listTasks` makes above. A
 * caller here wants the trail, and half a trail that looks whole is how a
 * reader concludes something never happened.
 */
async function getTaskComments(taskId) {
  const out = await pageComments({ get: (p) => call('GET', p), taskId });
  if (!out.complete) {
    if (out.capped) {
      throw new Error(`getTaskComments(${taskId}): stopped without reaching the end of the trail — treat as incomplete`);
    }
    const f = out.failed || {};
    throw new Error(`getTaskComments(${taskId}): HTTP ${f.status} ${(f.json && f.json.err) || String(f.text || '').slice(0, 200)}`);
  }
  // API order is newest-first within a page; reverse the whole set to oldest-first.
  return out.comments.reverse().map((c) => c.comment_text || '');
}

/**
 * The one bounded door to `clickup_direct.mjs`.
 *
 * Both write helpers below go through it so the deadline is written once —
 * `postBusMessage` is a subprocess that talks to ClickUp over the same network
 * as the fetches above, and an unbounded one hangs a scheduled job exactly as
 * completely (task 86bbqz7rg, review round 2). `run` is injectable so the
 * timeout and the message it produces can be tested without a real hang.
 */
function runDirect(args, { input, what, timeoutMs = SHELL_TIMEOUT_MS, run = execFileSync } = {}) {
  requireToken();
  try {
    return run('node', [DIRECT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      input,
      stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    }).trim();
  } catch (err) {
    throw new Error(`${what} failed: ${shellFailureDetail(err, timeoutMs)}`);
  }
}

/**
 * What actually went wrong with a shell-out. A killed child reports its signal
 * and nothing else useful, so a bare `err.stderr` on a timeout is empty — and
 * "failed: " with nothing after it is the log line that sends somebody hunting
 * for a bug in this file instead of at a stuck socket.
 */
function shellFailureDetail(err, timeoutMs) {
  if (err?.killed || err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT') {
    return `it did not finish within ${Math.round(timeoutMs / 1000)}s and was killed `
      + '(most likely a ClickUp call that hung rather than failed)';
  }
  const detail = (err?.stderr || err?.stdout || err?.message || '').toString().trim();
  return detail.slice(0, 300);
}

/**
 * Move a task's status through the verified direct door. Throws on any
 * outcome that is not a confirmed, stuck change — including the per-list
 * "that status does not exist" 200 that a bare PUT would report as success.
 * Returns the command's own report line.
 */
function moveTaskStatus(taskId, status, { timeoutMs = SHELL_TIMEOUT_MS } = {}) {
  return runDirect(['status', '--task', String(taskId), '--status', status], {
    what: `move task ${taskId} -> "${status}"`,
    timeoutMs,
  });
}

/** Post to the bus through the direct door (inherits its quota reporting). */
function postBusMessage(channelId, text, { timeoutMs = SHELL_TIMEOUT_MS } = {}) {
  return runDirect(['chat', '--channel', String(channelId), '--body-file', '-'], {
    input: text,
    what: `post to bus channel ${channelId}`,
    timeoutMs,
  });
}

module.exports = {
  WORKSPACE,
  COMMENT_PAGE_SIZE,
  HTTP_TIMEOUT_MS,
  SHELL_TIMEOUT_MS,
  runDirect,
  shellFailureDetail,
  // The raw door, for callers that need an endpoint this module has no opinion
  // about (the heartbeat's roll call reads and rewrites a task description).
  // Exported rather than re-implemented: a second fetch wrapper is a second
  // place for the token contract and the JSON/non-JSON handling to drift.
  call,
  listTasks,
  pageComments,
  getTaskComments,
  moveTaskStatus,
  postBusMessage,
};
