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
 *   - the tracker's tickets, through the door's ONE read-only command,
 *     `tickets --json` (`scripts/lib/trackerTickets.cjs` `readTickets`, which
 *     builds its own arguments and can run nothing else). It was ClickUp GETs
 *     until StarCaster moved to the tracker (SC-793)
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
  driftCandidates,
  operatorIdFrom,
  formatReport,
  exitCodeFor,
} = require('./builder/pulse.js');
const { findPullRequest, mergeDecision, checkState } = require('./builder/mergeOnComment.js');
const staleReady = require('../lib/staleReady.js');
const { printAndExit } = require('./lib/flushExit.cjs');

const LOOP_LOG_DIR = process.env.LOOP_LOG_DIR || path.join(os.homedir(), 'loop-logs');
// The read half ONLY. `runDoor` (the write-capable half of the same file) is
// deliberately not imported: see "READ-ONLY IS A HARD PROPERTY" above.
const { readTickets, asLoopTasks, projectConfig } = require('./lib/trackerTickets.cjs');
// Which ticket a PR declares: the one definition pr-opened and the review gate read.
const { findTicketIds } = require('../loop/lib/clickupTicketLink.js');

const PROJECT = projectConfig();
/** The tracker's seat for Dane (`operatorUserId` in spirality.project.json),
 *  whose merge word on a Ready-to-launch ticket this report counts. */
const OPERATOR_ID = operatorIdFrom(PROJECT);

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
function loopLogName(job) {
  const slug = String(PROJECT.projectSlug || '').trim();
  return slug ? `${slug}-${job}.log` : `${job}.log`;
}

function readNoOp(job, queuedCount, now) {
  // `<projectSlug>-<job>.log`: the name Spirality's lane runner writes
  // (`$LOG_DIR/$SLUG-loop-build.log`) since StarCaster's lanes moved to it on
  // 2026-11-12. The old StarCaster runner wrote `loop-build.log`, which stopped
  // growing that day, so reading it made A1 call a running lane stopped (SC-793).
  const file = path.join(LOOP_LOG_DIR, loopLogName(job));
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
    // `start` rides along with the classification because it is the pass's
    // IDENTITY, and the only stable part of it: the message carries an age
    // that changes every hour, so a scheduled consumer keying suppression off
    // the message would re-announce the same hung pass every single run
    // (task 86bbqz7rg). Additive — nothing existing reads it.
    unterminated: unterminated.map((p) => ({ start: p.start, ...classifyUnterminated(p, { now, passes }) })),
  };
}

// ── The tracker: one read ─────────────────────────────────────────────────────

/**
 * Every ticket in this project, Live included, with its comments, in ONE read
 * (SC-793). Live is load-bearing: B1's zombie shape is a terminal ticket whose
 * PR is still open, and a read without closed tickets cannot see one (measured
 * on ClickUp on 2026-08-30: 47 tickets came back where 163 existed). The
 * comments ride along because the tracker answers all ~800 tickets with their
 * comments in under two seconds, which is cheaper than one read per ticket.
 *
 * Throws on a failed read; `main` reports that as CANNOT TELL, never as an
 * empty queue.
 */
function readQueue() {
  return asLoopTasks(readTickets({ includeClosed: true, comments: true }));
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

/**
 * One PR's state AND every check on it, in a single `gh` call. null means
 * "could not tell", which callers must not treat as an answer (the same rule
 * build-start follows).
 *
 * `statusCheckRollup` was added on 2026-09-01 (task 86bbqp68c). Until then this
 * file never read check state anywhere, which is why its `Ready to launch`
 * bottleneck line could only ever name the operator — it had no way to see a
 * red build, so a machine-side stall came out as "the machine side is keeping
 * up" with Dane's name on it.
 */
function prSnapshot(number) {
  try {
    const out = JSON.parse(gh(['pr', 'view', String(number), '--json', 'state,mergedAt,statusCheckRollup']));
    return {
      state: String(out.state || '').toUpperCase() || null,
      checks: checkState(out.statusCheckRollup),
      why: null,
    };
  } catch (err) {
    return { state: null, checks: null, why: String(err?.message || err).slice(0, 160) };
  }
}

// ── B1: assemble one record per ticket ───────────────────────────────────────

/**
 * Only tickets worth comparing are compared, because each one can cost a
 * `gh pr view` and the list runs to hundreds (the comments themselves arrive
 * with the one tracker read, `commentsById`). That is every in-flight ticket (shapes
 * 1 and 3), every ticket an open PR names (shape 4), and every terminal ticket
 * an open PR names (shape 2).
 *
 * A ticket that is terminal AND that no open PR names cannot be in any of the
 * four shapes, so skipping it drops no finding — and the report says how many
 * were compared so the number is never mistaken for "all of them".
 */
async function readDrift(tasks, { prs: openPrs, error: prError }, { now, commentsById = new Map() } = {}) {
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
      // No PR side means no actor can be identified either, and `readyActors`
      // being absent is what makes the bottleneck line say so out loud rather
      // than fall back to naming Dane.
      readyRecords: null,
    };
  }

  const byTicket = indexPrsByTicket(openPrs, findTicketIds);
  const candidates = driftCandidates(tasks, byTicket);

  const records = [];
  // The Ready-to-launch half rides along on THIS loop rather than opening its
  // own. Comments cost a request each and the `gh pr view` beside them costs
  // another; a second sweep over the same tickets would double both to answer a
  // question the data already in hand can answer. See `readyActors` below.
  const readyRecords = [];

  for (const task of candidates) {
    const id = String(task.id);
    const isReady = String(task?.status?.status || '').trim().toLowerCase() === staleReady.READY_STAGE;
    const readyBase = {
      taskId: id,
      name: task.name,
      url: task.url || id,
      hours: (now - Number(task.date_updated)) / staleReady.MS_PER_HOUR,
    };

    const comments = commentsById.get(id) || null;
    if (!comments) {
      records.push({
        taskId: id,
        name: task.name,
        status: task.status?.status,
        statusType: task.status?.type,
        commentsReadable: false,
      });
      if (isReady) readyRecords.push({ ...readyBase, commentsReadable: false });
      continue;
    }

    const joined = comments.map((c) => c.comment_text || '').join('\n');
    const ticketPrNumbers = [...joined.matchAll(PR_OPENED_NUMBER_RE)].map((m) => Number(m[1]));
    const seen = findPullRequest(comments);
    const snap = seen ? prSnapshot(seen.number) : null;

    records.push({
      taskId: id,
      name: task.name,
      status: task.status?.status,
      statusType: task.status?.type,
      commentsReadable: true,
      ticketPrNumbers,
      buildStartSees: seen ? seen.number : null,
      buildStartPrState: snap ? snap.state : null,
      openPrsNamingTicket: byTicket.get(id.toLowerCase()) || [],
    });

    if (isReady) {
      readyRecords.push({
        ...readyBase,
        commentsReadable: true,
        pr: seen ? { number: seen.number, url: seen.url } : null,
        prReadable: Boolean(snap && snap.state),
        prReadError: snap ? snap.why : null,
        prState: snap ? snap.state : null,
        checks: snap ? snap.checks : null,
        mergeWordReadable: OPERATOR_ID.id !== null,
        mergeWordError: OPERATOR_ID.why,
        mergeWordGiven: OPERATOR_ID.id === null ? null : (() => {
          const d = mergeDecision({ status: task.status?.status, comments, operatorId: OPERATOR_ID.id });
          return d.act === 'merge' || d.act === 'refuse';
        })(),
      });
    }
  }

  return {
    ...driftFindings(records),
    ticketsCompared: records.length,
    openPrsCompared: openPrs.length,
    readyRecords,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const job = argValue('--job') || 'loop-build';
  const generatedAt = new Date().toISOString();

  let tasks = null;
  let commentsById = new Map();
  let queueError = null;
  try {
    ({ tasks, commentsById } = readQueue());
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
    ? await readDrift(tasks, listOpenPrs(), { now: Date.parse(generatedAt), commentsById })
    : null;

  // WHOSE HANDS the Ready-to-launch backlog needs, read from GitHub rather than
  // assumed (task 86bbqp68c). `null` when the PR side could not be read at all,
  // which `readyBottleneck` renders as "not known here" — never as the operator.
  const readyActors = drift && drift.readyRecords
    ? staleReady.actorTally(staleReady.readyFindings(drift.readyRecords).findings)
    : null;

  const result = { generatedAt, job, noOp, residency, drift, readyActors, queueError };

  if (queueError) {
    // Rule 2: the failure is stated, and the run still completes.
    result.residency = null;
    result.drift = null;
    result.readyActors = null;
  }

  const code = useExitCode ? exitCodeFor(result) : 0;

  // `printAndExit`, never `console.log` followed by `process.exit` — on macOS
  // stdout to a pipe is asynchronous, so exiting straight after printing
  // discards everything past the 64KB the kernel had already taken. This
  // output IS read through a pipe: `scripts/pulse_publish.mjs` spawns this
  // command with --json and parses what comes back. See scripts/lib/flushExit.cjs
  // for the measurements.
  if (asJson) {
    printAndExit(JSON.stringify(result, null, 2), code);
  } else {
    if (queueError) {
      console.log(`CANNOT TELL — the tracker's tickets could not be read: ${queueError}`);
      console.log('A2 and B1 need it, so both are reported as unread rather than as clear.\n');
    }
    printAndExit(formatReport(result), code);
  }
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

main().catch((err) => {
  // Rule 5: even a crash says so loudly rather than producing a quiet nothing.
  // Through the same flush-then-leave door: a crash message discarded by
  // `process.exit` IS the quiet nothing this rule forbids, and stderr is a
  // pipe here too.
  console.error(`PULSE FAILED — ${err.message}`);
  printAndExit('This is not an all-clear. No check ran.', useExitCode ? 2 : 0, { stream: 'stderr' });
});
