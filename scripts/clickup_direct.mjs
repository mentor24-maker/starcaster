#!/usr/bin/env node
/**
 * clickup_direct.mjs — file ClickUp tasks and chat posts through ClickUp's OWN
 * REST API, bypassing the claude.ai ClickUp connector.
 *
 * WHY THIS EXISTS (2026-08-17). The connector enforces a rolling ~24h budget on
 * WRITES. When it is spent, `create_task` and `send_chat_message` fail while
 * plain reads keep working, so it presents as a random outage rather than a
 * quota. ClickUp's own limits are a different bucket entirely — roughly 100
 * requests per MINUTE, reset in 60 seconds — so a personal API token still
 * works when the connector is exhausted. See DOCTRINE 1.7.
 *
 * The token is read from the environment, never printed and never logged.
 * Agents do not handle the live value (DOCTRINE 4.1); the operator exports it.
 *
 *   export CLICKUP_API_TOKEN=pk_...
 *   node scripts/clickup_direct.mjs whoami
 *   node scripts/clickup_direct.mjs task --list <id> --name "..." --body-file body.md \
 *        [--status Queued] [--priority high] [--id-out .id]
 *   node scripts/clickup_direct.mjs chat --channel <id> --body-file post.md
 *
 * Body may also come from stdin with `--body-file -`.
 */

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

const TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
const PRIORITY = { urgent: 1, high: 2, normal: 3, low: 4 };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readBody(spec) {
  return spec === '-' ? readFileSync(0, 'utf8') : readFileSync(spec, 'utf8');
}

/**
 * Report ClickUp's real rate-limit state from the response headers. Printing
 * the true numbers is the whole point: the connector's own error text is not
 * trustworthy about this (it says "NaN minutes" on the chat endpoints).
 */
function reportLimits(res) {
  const limit = res.headers.get('x-ratelimit-limit');
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (!limit && !remaining) return;
  const secs = reset ? Number(reset) - Math.floor(Date.now() / 1000) : NaN;
  const resetTxt = Number.isFinite(secs) ? ` (resets in ${Math.max(0, secs)}s)` : '';
  console.log(`  ClickUp's own limit: ${remaining ?? '?'} of ${limit ?? '?'} left this minute${resetTxt}`);
}

async function call(method, path, body) {
  const res = await fetch(`https://api.clickup.com${path}`, {
    method,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* provider returned a non-JSON error page */ }
  return { res, json, text };
}

function die(label, { res, json, text }) {
  console.error(`\n${label} FAILED — HTTP ${res.status}`);
  console.error(json?.err || json?.error || text.slice(0, 500));
  // Say what to do in terms of the thing the operator touches (DOCTRINE 2.2).
  if (res.status === 401) {
    console.error('\n401 means the token is wrong or expired — not that ClickUp is down.');
    console.error('Re-copy it: ClickUp -> your avatar (bottom-left) -> Settings -> Apps -> API Token.');
  }
  if (res.status === 429) {
    console.error('\n429 is ClickUp itself throttling, and it clears in under a minute.');
    console.error('This is NOT the connector quota — wait 60s and run the same command again.');
  }
  process.exit(1);
}

function usage(code = 2) {
  console.error('Usage: node scripts/clickup_direct.mjs <whoami|task|chat> [options]');
  console.error('  whoami');
  console.error('  task --list <id> --name "<name>" --body-file <file|-> [--status S] [--priority urgent|high|normal|low] [--id-out <file>]');
  console.error('  chat --channel <id> --body-file <file|->');
  process.exit(code);
}

if (!TOKEN) {
  console.error('CLICKUP_API_TOKEN is not set in this terminal window.\n');
  console.error('Get one: ClickUp -> your avatar (bottom-left) -> Settings -> Apps -> API Token.');
  console.error('Then, in this same window:\n');
  console.error('  export CLICKUP_API_TOKEN=pk_your_token_here\n');
  console.error('It lasts only for that window. Never commit it, and never paste it into a file.');
  process.exit(2);
}

const cmd = process.argv[2];

if (cmd === 'whoami') {
  const out = await call('GET', '/api/v2/user');
  if (!out.res.ok) die('whoami', out);
  // Report identity, not just success (DOCTRINE 3.5).
  console.log(`Token valid. Acting as: ${out.json.user.username} <${out.json.user.email}>`);
  reportLimits(out.res);

} else if (cmd === 'task') {
  const list = arg('list'), name = arg('name'), bodyFile = arg('body-file');
  if (!list || !name || !bodyFile) usage();

  const out = await call('POST', `/api/v2/list/${list}/task`, {
    name,
    markdown_description: readBody(bodyFile),
    status: arg('status') || undefined,
    priority: PRIORITY[arg('priority', '')] || undefined,
  });
  if (!out.res.ok) die('create task', out);

  const id = out.json.id;
  const idOut = arg('id-out');
  if (idOut) writeFileSync(idOut, id);
  console.log(`\nCreated task ${id}\n  ${out.json.url}`);
  reportLimits(out.res);

  // A 200 proves a write happened, not that the right thing landed. Read it
  // back — an empty description is the silent failure this repo keeps hitting.
  const check = await call('GET', `/api/v2/task/${id}`);
  if (!check.res.ok) {
    console.error('  WARNING: created, but could not read it back to verify.');
    process.exit(1);
  }
  const t = check.json;
  const chars = (t.description || '').length;
  console.log('\nVerified by reading the task back:');
  console.log(`  name:        ${t.name}`);
  console.log(`  list:        ${t.list?.name} (${t.list?.id})`);
  console.log(`  status:      ${t.status?.status}`);
  console.log(`  priority:    ${t.priority?.priority ?? '(none)'}`);
  console.log(`  description: ${chars} characters`);
  if (chars === 0) {
    console.error('\n  BODY IS EMPTY — the description did not save. Task exists but is a shell.');
    process.exit(1);
  }

} else if (cmd === 'chat') {
  const channel = arg('channel'), bodyFile = arg('body-file');
  if (!channel || !bodyFile) usage();
  const out = await call('POST', `/api/v3/workspaces/${WORKSPACE}/chat/channels/${channel}/messages`, {
    type: 'message',
    content: readBody(bodyFile),
    content_format: 'text/md',
  });
  if (!out.res.ok) die('send chat message', out);
  console.log(`\nPosted to channel ${channel}. Message id ${out.json?.data?.id ?? out.json?.id ?? '(unknown)'}`);
  reportLimits(out.res);

} else {
  usage();
}
