'use strict';

/**
 * A small, focused ClickUp REST client for scripts that need more than a
 * single yes/no answer (scripts/clickup_direct.mjs's `task-open` covers
 * that case). `clickup_direct.mjs` itself is a CLI with no exports and
 * several `process.exit()` calls baked into its command branches — not safe
 * to `require()`/`import()` as a library — so this is a second, deliberately
 * small implementation of the same auth/fetch shape, not a refactor of that
 * file. Extracting THIS (rather than duplicating fetch/token logic inline in
 * every script that needs it) is the smaller, safer move; folding
 * clickup_direct.mjs's ~450 lines of CLI branches into this module too is a
 * separate, larger refactor this file does not attempt.
 *
 * Same token contract as clickup_direct.mjs: CLICKUP_API_TOKEN from the
 * environment, supplied by Doppler via `npm run <script>` — never handled
 * directly by an agent (DOCTRINE 4.1).
 */

const TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';

function requireToken() {
  if (!TOKEN) {
    throw new Error(
      'CLICKUP_API_TOKEN is not set. Run this via `npm run <script>` so Doppler supplies it ' +
      '(package.json wraps it in `doppler run --project starcaster --config dev`).'
    );
  }
}

async function call(method, path, body) {
  requireToken();
  const res = await fetch(`https://api.clickup.com${path}`, {
    method,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* provider returned a non-JSON error page */ }
  return { ok: res.ok, status: res.status, json, text };
}

/** Every non-archived task in a list, across all pages (DOCTRINE 5.12 — a
 *  first-page-only read silently starves everything past it). */
async function listTasks(listId) {
  const tasks = [];
  for (let page = 0; page < 50; page++) {
    const out = await call('GET', `/api/v2/list/${listId}/task?archived=false&page=${page}`);
    if (!out.ok) throw new Error(`listTasks(${listId}) page ${page}: HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
    tasks.push(...out.json.tasks);
    if (out.json.last_page !== false || out.json.tasks.length === 0) return tasks;
  }
  throw new Error(`listTasks(${listId}): stopped after 50 pages — implausibly large, treat as incomplete`);
}

/** Oldest first — comments arrive newest-first from the API. */
async function getTaskComments(taskId) {
  const out = await call('GET', `/api/v2/task/${taskId}/comment`);
  if (!out.ok) throw new Error(`getTaskComments(${taskId}): HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
  return (out.json.comments || []).slice().reverse().map((c) => c.comment_text || '');
}

async function setTaskStatus(taskId, status) {
  const out = await call('PUT', `/api/v2/task/${taskId}`, { status });
  if (!out.ok) throw new Error(`setTaskStatus(${taskId}, ${status}): HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
  return out.json;
}

async function createTask(listId, { name, description }) {
  const out = await call('POST', `/api/v2/list/${listId}/task`, {
    name,
    markdown_content: description,
  });
  if (!out.ok) throw new Error(`createTask: HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
  return out.json;
}

async function postBusMessage(channelId, text) {
  const out = await call('POST', `/api/v3/workspaces/${WORKSPACE}/chat/channels/${channelId}/messages`, {
    type: 'message', content: text, content_format: 'text/md',
  });
  if (!out.ok) throw new Error(`postBusMessage: HTTP ${out.status} ${out.json?.err || out.text.slice(0, 200)}`);
  return out.json;
}

module.exports = {
  listTasks,
  getTaskComments,
  setTaskStatus,
  createTask,
  postBusMessage,
};
