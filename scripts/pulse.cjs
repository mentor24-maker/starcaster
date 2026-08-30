#!/usr/bin/env node
'use strict';

/**
 * `npm run pulse` — read-only pipeline diagnostics. Phase 1 (task 86bbm9h60).
 *
 *   npm run pulse                 human-readable, exit 0
 *   npm run pulse -- --json       machine-readable, for the phase-2 digest
 *   npm run pulse -- --exit-code  0 clean / 1 findings / 2 could-not-tell
 *
 * THIS FILE IS THE READERS ONLY. Every threshold, every classification and
 * every sentence lives in `scripts/builder/pulse.js`, which is pure and tested.
 * The split is criterion 6 of the ticket, and it is the reason a threshold can
 * be break-tested at all.
 *
 * READ-ONLY IS A HARD PROPERTY, NOT AN INTENTION. This file uses exactly three
 * sources and writes to none of them:
 *   - the loop logs on disk, opened for reading
 *   - ClickUp GETs, issued directly rather than through `clickup_direct.mjs`,
 *     because that command's job is writes and this one must not be able to
 *     make one by accident
 *   - `gh pr list` / `gh pr view`, both read subcommands
 * There is no write path in this file. `npm run reconcile` is where repairs
 * live; the pulse reports and stops (the ticket's own rule: report, never
 * repair, because shape 4 has two valid fixes and only a person knows which).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  parsePassLog,
  noOpStreak,
  classifyUnterminated,
  stageResidency,
  driftFindings,
  indexPrsByTicket,
  formatReport,
  exitCodeFor,
} = require('./builder/pulse.js');
const { findPullRequest } = require('./builder/mergeOnComment.js');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const LOOP_LOG_DIR = process.env.LOOP_LOG_DIR || path.join(os.homedir(), 'loop-logs');
const TOKEN = process.env.CLICKUP_API_TOKEN;

const asJson = process.argv.includes('--json');
const useExitCode = process.argv.includes('--exit-code');

// ── A1's source: the loop logs ───────────────────────────────────────────────

/**
 * The build loop's own log. `loop-build` is the one whose claims this check is
 * about; `--job` points it at another.
 *
 * A missing or unreadable log is CANNOT TELL with the reason and the path, not
 * a zero-pass "all clear" — on a machine that does not run the loop, "no log"
 * and "the loop never claimed" are the same bytes.
 */
function readNoOp(job, queuedCount, now) {
  const file = path.join(LOOP_LOG_DIR, `${job}.log`);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // `verdict` travels WITH the error so every consumer — the headline
    // sentence above all — sees the same state the section prints. Without it
    // the headline fell through every guard and said "the loop is claiming"
    // four lines above a CANNOT TELL (review, 2026-08-30).
    return {
      verdict: 'cannot-tell',
      sourceError: `could not read ${file} (${err.code || err.message}) — ` +
        'on a machine that does not run this loop that is expected, but it is still not an all-clear',
      source: file,
      lastPassAt: null,
    };
  }

  const { passes, unterminated } = parsePassLog(text);
  const result = noOpStreak(passes, { queuedCount, now, unterminated });
  return {
    ...result,
    source: file,
    unterminated: unterminated.map((p) => classifyUnterminated(p, { now, passes })),
  };
}

// ── ClickUp: GETs only ───────────────────────────────────────────────────────

async function clickupGet(apiPath) {
  if (!TOKEN) {
    throw new Error(
      'CLICKUP_API_TOKEN is not set. Run this via `npm run pulse` so Doppler supplies it.'
    );
  }
  const res = await fetch(`https://api.clickup.com${apiPath}`, {
    method: 'GET',
    headers: { Authorization: TOKEN },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a non-JSON error page */ }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${json?.err || text.slice(0, 160)}`);
  return json;
}

/** Every non-archived task in the list, across all pages. Same termination
 *  rule as lib/clickup.cjs: an empty page or an explicit last_page, never
 *  `last_page !== false` (the API can omit the flag, which truncated at 100).
 *
 *  `include_closed=true` IS LOAD-BEARING. Without it the list endpoint hides
 *  every closed-type status: measured live on 2026-08-30, 47 tickets came back
 *  where 163 existed, and all 116 `Live` ones were invisible — which made B1's
 *  zombie shape (terminal ticket, PR still open) impossible to fire. The
 *  fourth reader in this repo to hit the same trap; see the regression test. */
async function listTasks(listId) {
  const tasks = [];
  for (let page = 0; page < 50; page++) {
    const json = await clickupGet(`/api/v2/list/${listId}/task?archived=false&include_closed=true&page=${page}`);
    const batch = Array.isArray(json.tasks) ? json.tasks : [];
    tasks.push(...batch);
    if (batch.length === 0 || json.last_page === true) return tasks;
  }
  throw new Error('stopped after 50 pages — implausible, treat the read as incomplete');
}

/**
 * A task's comments as OBJECTS, oldest-first — not the plain strings
 * `lib/clickup.cjs` returns — because `findPullRequest` is the reader
 * `build-start` itself uses, and shape 4 is defined as "what build-start would
 * see". Asking a different question with a second parser is how the two drift.
 */
async function getComments(taskId) {
  const all = [];
  let query = '';
  for (let page = 0; page < 40; page++) {
    const json = await clickupGet(`/api/v2/task/${taskId}/comment${query}`);
    const batch = Array.isArray(json.comments) ? json.comments : [];
    all.push(...batch);
    if (batch.length < 25) break;
    const oldest = batch[batch.length - 1];
    if (!oldest?.id || !oldest?.date) break;
    query = `?start=${encodeURIComponent(oldest.date)}&start_id=${encodeURIComponent(oldest.id)}`;
  }
  return all.reverse();
}

// ── GitHub: read subcommands only ────────────────────────────────────────────

const PR_OPENED_NUMBER_RE = /^\s*PR opened:\s*https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/gim;

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Open PRs with their bodies, so the PR→ticket direction can be read.
 *  `{ prs: null, error }` means the lookup failed — never an empty list, which
 *  would report every ticket as stranded — and the error travels with it so
 *  the CANNOT line can say WHY (auth, rate limit, wrong folder), per rule 2. */
function listOpenPrs() {
  try {
    const prs = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '200',
      '--json', 'number,title,body,headRefName']));
    return { prs, error: null };
  } catch (err) {
    const stderr = String(err.stderr || '').trim().split('\n')[0];
    return { prs: null, error: stderr || err.code || err.message };
  }
}

/** One PR's state. null means "could not tell", which callers must not treat
 *  as an answer (the same rule build-start follows). */
function prState(number) {
  try {
    const out = JSON.parse(gh(['pr', 'view', String(number), '--json', 'state,mergedAt']));
    return String(out.state || '').toUpperCase() || null;
  } catch {
    return null;
  }
}

// ── B1: assemble one record per ticket ───────────────────────────────────────

/**
 * Only tickets worth comparing are fetched, because comments cost a request
 * each and the list runs to hundreds. That is every in-flight ticket (shapes
 * 1 and 3), every ticket an open PR names (shape 4), and every terminal ticket
 * an open PR names (shape 2).
 *
 * A ticket that is terminal AND that no open PR names cannot be in any of the
 * four shapes, so skipping it drops no finding — and the report says how many
 * were compared so the number is never mistaken for "all of them".
 */
async function readDrift(tasks, { prs: openPrs, error: prError }) {
  if (openPrs === null) {
    return {
      findings: [],
      cannotTell: [{
        taskId: '(all)',
        status: '-',
        reason: `\`gh pr list\` failed (${prError}), so the PR side could not be read at all — ` +
          'without it every ticket would falsely read as stranded, so nothing is reported',
      }],
      ticketsCompared: 0,
      openPrsCompared: 0,
    };
  }

  const byTicket = indexPrsByTicket(openPrs);
  const { IN_FLIGHT_STATUSES } = require('./builder/pulse.js');

  const candidates = tasks.filter((t) => {
    const status = String(t?.status?.status || '').toLowerCase();
    return IN_FLIGHT_STATUSES.has(status) || byTicket.has(String(t?.id || '').toLowerCase());
  });

  const records = [];
  for (const task of candidates) {
    const id = String(task.id);
    let comments = null;
    try {
      comments = await getComments(id);
    } catch {
      records.push({
        taskId: id,
        name: task.name,
        status: task.status?.status,
        statusType: task.status?.type,
        commentsReadable: false,
      });
      continue;
    }

    const joined = comments.map((c) => c.comment_text || '').join('\n');
    const ticketPrNumbers = [...joined.matchAll(PR_OPENED_NUMBER_RE)].map((m) => Number(m[1]));
    const seen = findPullRequest(comments);

    records.push({
      taskId: id,
      name: task.name,
      status: task.status?.status,
      statusType: task.status?.type,
      commentsReadable: true,
      ticketPrNumbers,
      buildStartSees: seen ? seen.number : null,
      buildStartPrState: seen ? prState(seen.number) : null,
      openPrsNamingTicket: byTicket.get(id.toLowerCase()) || [],
    });
  }

  return {
    ...driftFindings(records),
    ticketsCompared: records.length,
    openPrsCompared: openPrs.length,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const job = argValue('--job') || 'loop-build';
  const generatedAt = new Date().toISOString();

  let tasks = null;
  let queueError = null;
  try {
    tasks = await listTasks(LOOP_QUEUE_LIST);
  } catch (err) {
    queueError = err.message;
  }

  const queuedCount = tasks
    ? tasks.filter((t) => String(t?.status?.status || '').toLowerCase() === 'queued').length
    : null;

  const noOp = readNoOp(job, queuedCount, Date.parse(generatedAt));

  const residency = tasks
    ? stageResidency(tasks, { now: Date.parse(generatedAt) })
    : null;

  const drift = tasks
    ? await readDrift(tasks, listOpenPrs())
    : null;

  const result = { generatedAt, job, noOp, residency, drift, queueError };

  if (queueError) {
    // Rule 2: the failure is stated, and the run still completes.
    result.residency = null;
    result.drift = null;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (queueError) {
      console.log(`CANNOT TELL — the Loop Queue could not be read: ${queueError}`);
      console.log('A2 and B1 need it, so both are reported as unread rather than as clear.\n');
    }
    console.log(formatReport(result));
  }

  process.exit(useExitCode ? exitCodeFor(result) : 0);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

main().catch((err) => {
  // Rule 5: even a crash says so loudly rather than producing a quiet nothing.
  console.error(`PULSE FAILED — ${err.message}`);
  console.error('This is not an all-clear. No check ran.');
  process.exit(useExitCode ? 2 : 0);
});
