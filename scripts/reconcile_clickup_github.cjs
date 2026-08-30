#!/usr/bin/env node
'use strict';

/**
 * The reconciler — Charter Q2 (2026-08-18): keeps the Loop Queue and GitHub
 * reality from silently drifting apart. Meant to run on a schedule (the Mac
 * Mini engine room).
 *
 *   npm run reconcile              # dry run — prints every proposed action
 *   npm run reconcile -- --live    # moves tasks / posts to the bus
 *
 * WHAT IT CHECKS
 *   1. Every in-flight task whose comments link a GitHub PR. The NEWEST
 *      distinct PR is authoritative (a task sent back and rebuilt carries two
 *      links; the superseded one must not win forever). Then:
 *        - PR merged, task in an auto-repair status (Building / In review) →
 *          move to Live.
 *        - PR merged, task in an OPERATOR status (Needs your input / Ready to
 *          launch) → FLAG, never move: only the operator moves a task out of
 *          those two, and auto-moving a Needs-your-input task would bury the
 *          question waiting for him (two-account model).
 *        - PR CLOSED-unmerged while the task is in-flight → FLAG: the
 *          stuck-ticket case, drift this tool exists to surface.
 *        - PR open → clean.
 *   2. Every local branch stamped with a ClickUp task (Task-closes-thread /
 *      PR #344) whose stamped task has reached a terminal status → FLAG: the
 *      closed-task cleanup should have removed the branch and did not.
 *
 * Every task and branch lands in exactly ONE of three buckets — clean,
 * repaired (a write, or in dry-run a "would"), or COULD NOT CHECK. The third
 * is never folded into the first (DOCTRINE 3.11): a sweep that silently skips
 * what it could not read has surveyed nothing.
 *
 * What it deliberately does NOT do: auto-file tasks for unstamped branches.
 * Every branch predating PR #344 is unstamped, so that would manufacture
 * false positives on day one. Reported as "could not check", not skipped.
 *
 * Writes go through scripts/clickup_direct.mjs (lib/clickup.cjs shells out),
 * so a status move is verified and clears assignees, and the bus post reports
 * quota — one implementation of those rules, not a weaker second copy.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { listTasks, getTaskComments, moveTaskStatus, postBusMessage } = require('./lib/clickup.cjs');

/** How many terminal tasks the leftover-PR scan looks at, most recent first.
 *  Bounded because the terminal set grows forever — see the scan below. */
const TERMINAL_SCAN_MAX = 25;
const { branchInventory, stampedTaskId, root } = require('./lib/repo_state.cjs');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';

// The status ladder, by ROLE — not a hand-copied name list per concern.
// Auto-repair: the machine may move these on its own. Operator: only Dane
// moves a task out of these (two-account model), so the tool flags, never
// moves. A merged PR is meaningful against BOTH; the difference is the action.
const AUTO_REPAIR_STATUSES = new Set(['building', 'in review']);
const OPERATOR_STATUSES = new Set(['needs your input', 'ready to launch']);
const TERMINAL_STATUS_TO_SET = 'Live';
const PR_URL_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

// Where flagged contradictions are remembered between scheduled runs, so an
// unchanged drift is posted to the bus ONCE, not every run (channel spam +
// the rolling ClickUp write quota). Machine-local, never committed.
const FLAG_STATE_FILE = path.join(root, '.git', 'reconciler-flags.json');

const live = process.argv.includes('--live');
const quiet = process.argv.includes('--quiet');

function say(line) {
  if (!quiet) console.log(line);
}

/** In-flight for the PURPOSE of the merged-PR check (either action path). */
function isInFlight(task) {
  const s = (task.status?.status || '').toLowerCase();
  return AUTO_REPAIR_STATUSES.has(s) || OPERATOR_STATUSES.has(s);
}

/** Terminal from ClickUp's own status.type where present (so a future
 *  "Won't do" done-type status is terminal without being name-listed), with a
 *  name fallback for callers/tests that carry no type. */
function isTerminal(task) {
  const type = (task.status?.type || '').toLowerCase();
  if (type === 'closed' || type === 'done') return true;
  return (task.status?.status || '').toLowerCase() === 'live';
}

/** null means "could not tell" — never treated as a real answer. */
function ghPrState(owner, repoName, number) {
  try {
    const out = execFileSync(
      'gh', ['pr', 'view', String(number), '--repo', `${owner}/${repoName}`, '--json', 'state,mergedAt,title'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Distinct PR URLs in a comment list, in order (comments arrive oldest-first,
 *  so the LAST entry is the newest — the authoritative one). */
function distinctPrs(comments) {
  const seen = new Set();
  const prs = [];
  for (const text of comments) {
    const m = String(text || '').match(PR_URL_RE);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}#${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prs.push({ owner: m[1], repoName: m[2], number: m[3] });
  }
  return prs;
}

function loadFlagState() {
  try {
    return new Set(JSON.parse(fs.readFileSync(FLAG_STATE_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveFlagState(set) {
  try {
    fs.writeFileSync(FLAG_STATE_FILE, JSON.stringify([...set], null, 2));
  } catch (err) {
    // Best-effort: a missing state file only costs one duplicate post, never
    // a wrong action — but say so rather than pretend it saved.
    console.error(`[reconcile] could not save flag state (${err.message}) — a flag may repost next run`);
  }
}

/**
 * @param {object} deps injectable so a test drives this with fake data instead
 *   of the network — every one defaults to the real implementation.
 */
async function checkMergedTasks(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    getComments = getTaskComments,
    prState = ghPrState,
    updateStatus = moveTaskStatus,
    postBus = postBusMessage,
    alreadyFlagged = null,
    recordFlagged = () => {},
    isLive = live,
    log = say,
  } = deps;

  const inFlight = tasks.filter(isInFlight);
  log(`[reconcile] ${inFlight.length} in-flight task(s) of ${tasks.length} total in the Loop Queue`);

  // The OTHER direction (2026-08-25, task 86bbm4zwd): a task that is Live
  // while its PR is still open. The loop below only ever looked at in-flight
  // tasks, so this pair was invisible — and it is not harmless. Two such
  // zombies (#374 under a Live 86bbjk5rw, #381 under a Live 86bbjk5wj, both
  // shipped by a DIFFERENT PR) counted against the work-in-progress cap and
  // helped deadlock the build loop for four hourly passes that morning.
  //
  // Never repaired automatically: the right answer is sometimes "close the
  // PR" and sometimes "the ticket was closed too early", and only a person
  // can tell which. Flagged, with both facts, so the choice is one command.
  // Bounded on purpose (review round 1): one comment read plus one `gh` call
  // per terminal task, per run. There are already 66 Live tickets and the set
  // only grows, so the scan takes the most recently updated TERMINAL_SCAN_MAX
  // and says how many it skipped. An unbounded scan that grows forever is a
  // job that quietly gets slower until someone notices it timing out.
  const terminal = tasks.filter(isTerminal)
    .sort((a, b) => Number(b.date_updated || 0) - Number(a.date_updated || 0));
  const scanned = terminal.slice(0, TERMINAL_SCAN_MAX);
  if (terminal.length > scanned.length) {
    log(`[reconcile] scanning the ${scanned.length} most recently updated of ${terminal.length} terminal task(s) for leftover open PRs`);
  }

  for (const task of scanned) {
    const label = `task ${task.id} "${task.name}"`;
    let comments;
    try {
      comments = await getComments(task.id);
    } catch {
      unchecked.push(`${label}: terminal, but its comments could not be read — cannot tell whether a PR is still open`);
      continue;
    }
    // EVERY distinct linked PR, not just the newest (review round 1). The real
    // 2026-08-25 shape is a Live ticket linking an open leftover AND a later
    // merged PR that actually shipped it — so "newest" is the merged one and
    // the check returned silently on the exact case it was written for.
    for (const linked of distinctPrs(comments)) {
      const pr = prState(linked.owner, linked.repoName, linked.number);
      if (!pr) {
        unchecked.push(`${label}: terminal, but the state of PR #${linked.number} could not be read`);
        continue;
      }
      if (pr.state !== 'OPEN') continue;
      await flag(
        `contradiction:open-pr-under-terminal:${task.id}:${linked.number}`,
        `${label} is "${task.status?.status}" but its linked PR #${linked.number} is still OPEN. ` +
          'Either the work shipped under a different PR and this one is a leftover — which counts against the ' +
          'work-in-progress cap and blocks the build loop — or the task was closed too early. Close the PR, or reopen the task.',
        { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, isLive, what: `${label}: open PR under a terminal task` }
      );
    }
  }


  for (const task of inFlight) {
    const status = (task.status?.status || '').toLowerCase();
    const label = `task ${task.id} "${task.name}"`;

    let comments;
    try {
      comments = await getComments(task.id);
    } catch (err) {
      unchecked.push(`${label}: could not read comments — ${err.message}`);
      continue;
    }

    const prs = distinctPrs(comments);
    if (prs.length === 0) {
      // Not clean: an in-flight task with no PR link cannot be confirmed
      // shipped-or-not, so it is unverified, not fine (DOCTRINE 3.11).
      unchecked.push(`${label}: in-flight but no PR linked in its comments — cannot confirm whether it shipped`);
      continue;
    }

    // Newest distinct PR is authoritative; a superseded older link never wins.
    const authoritative = prs[prs.length - 1];
    const pr = prState(authoritative.owner, authoritative.repoName, authoritative.number);
    const prName = `PR #${authoritative.number}`;
    if (!pr) {
      unchecked.push(`${label}: could not read ${prName} (${authoritative.owner}/${authoritative.repoName}) from GitHub`);
      continue;
    }
    const multi = prs.length > 1 ? ` (newest of ${prs.length} linked PRs)` : '';

    if (pr.state === 'OPEN') {
      clean.push(`${label}: ${prName} is open${multi}, matches ClickUp`);
      continue;
    }

    if (pr.state === 'MERGED') {
      if (AUTO_REPAIR_STATUSES.has(status)) {
        if (isLive) {
          try {
            updateStatus(task.id, TERMINAL_STATUS_TO_SET);
            repaired.push(`${label}: ${prName} merged${multi} — moved to ${TERMINAL_STATUS_TO_SET}`);
          } catch (err) {
            unchecked.push(`${label}: ${prName} merged, but could not move the task — ${err.message}`);
          }
        } else {
          repaired.push(`[DRY RUN] ${label}: ${prName} merged${multi} — would move to ${TERMINAL_STATUS_TO_SET}`);
        }
      } else {
        // Operator status: flag, never move — the operator owns the exit.
        await flag(
          `contradiction:merged-operator:${task.id}:${authoritative.number}`,
          `${label} sits in "${task.status?.status}" but ${prName} is already MERGED. ` +
            `Only you move a task out of that status — moving it automatically would bury the handoff. Worth a look.`,
          { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, isLive, what: `${label}: merged PR under an operator status` }
        );
      }
      continue;
    }

    // CLOSED (unmerged) while still in-flight — the stuck-ticket case.
    await flag(
      `contradiction:closed-pr:${task.id}:${authoritative.number}`,
      `${label} is in-flight ("${task.status?.status}") but its newest PR ${prName} is CLOSED without merging` +
        `${multi}. The work is not shipping under that PR — reopen it, link a new one, or park the task.`,
      { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, isLive, what: `${label}: in-flight over a closed, unmerged PR` }
    );
  }
}

/** Post a contradiction to the bus once per unchanged state; dry-run proposes. */
async function flag(key, message, ctx) {
  const { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, isLive, what } = ctx;
  if (!isLive) {
    repaired.push(`[DRY RUN] ${what} — would flag to the bus: ${message}`);
    return;
  }
  if (alreadyFlagged && alreadyFlagged.has(key)) {
    // Already posted on an earlier run and nothing changed — not re-posted,
    // and not silently dropped from the report either.
    repaired.push(`${what} — already flagged on an earlier run (not re-posted)`);
    return;
  }
  try {
    await postBus(BUS_CHANNEL, `[reconciler] ${message}`);
    recordFlagged(key);
    repaired.push(`${what} — flagged to the bus`);
  } catch (err) {
    unchecked.push(`${what}: contradiction found but could not post to the bus — ${err.message}`);
  }
}

/** Same injection shape as checkMergedTasks. */
async function checkStampedBranches(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    branches: branchesOverride = null,
    getStampedTaskId = stampedTaskId,
    postBus = postBusMessage,
    alreadyFlagged = null,
    recordFlagged = () => {},
    isLive = live,
  } = deps;

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const branches = branchesOverride || branchInventory().filter((b) => b.onMac && b.name !== 'main');

  for (const branch of branches) {
    const taskId = getStampedTaskId(branch.name);
    if (!taskId) {
      unchecked.push(
        `branch ${branch.name}: no ClickUp task stamp — cannot verify whether it is tracked ` +
        `(only threads started with \`npm run thread <topic> <task-id>\` after PR #344 carry one)`
      );
      continue;
    }

    const task = tasksById.get(taskId);
    if (!task) {
      unchecked.push(`branch ${branch.name}: stamped task ${taskId} is not in this Loop Queue list — cannot verify`);
      continue;
    }

    if (!isTerminal(task)) {
      clean.push(`branch ${branch.name}: tracked by task ${taskId} (${task.status?.status})`);
      continue;
    }

    await flag(
      `contradiction:stale-branch:${branch.name}:${taskId}`,
      `branch \`${branch.name}\` is still on this Mac, but its stamped task ${taskId} ("${task.name}") ` +
        `is already ${task.status?.status}. \`npm run tidy\` should have cleaned this up — worth a look.`,
      { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, isLive, what: `branch ${branch.name}: stamped task already terminal` }
    );
  }
}

async function main() {
  const clean = [];
  const repaired = [];
  const unchecked = [];

  let tasks;
  try {
    // include_closed: ClickUp drops closed-type statuses by default, so
    // without it `tasks.filter(isTerminal)` is structurally empty and the
    // leftover-PR scan below can never fire (review round 1, measured: 36
    // tasks returned while 66 Live tickets existed).
    tasks = await listTasks(LOOP_QUEUE_LIST, { includeClosed: true });
  } catch (err) {
    console.error(`[reconcile] FAILED to read the Loop Queue — nothing could be checked: ${err.message}`);
    process.exit(1);
  }

  // Flag state is only touched on a live run; dry-run must change nothing.
  const alreadyFlagged = live ? loadFlagState() : new Set();
  const recordFlagged = (key) => alreadyFlagged.add(key);
  const deps = { alreadyFlagged, recordFlagged };

  await checkMergedTasks(tasks, clean, repaired, unchecked, deps);
  await checkStampedBranches(tasks, clean, repaired, unchecked, deps);

  if (live) saveFlagState(alreadyFlagged);

  say('');
  say(`[reconcile] ${clean.length} checked clean, ${repaired.length} ${live ? 'repaired/flagged' : 'would repair/flag'}, ${unchecked.length} could not check.`);
  if (repaired.length) {
    say(live ? '\nRepaired / flagged:' : '\nWould repair / flag:');
    repaired.forEach((line) => say(`  ✓ ${line}`));
  }
  if (unchecked.length) {
    say('\nCould NOT check — not the same as clean:');
    unchecked.forEach((line) => say(`  ? ${line}`));
  }
  if (!quiet && clean.length) {
    say('\nChecked, no drift:');
    clean.forEach((line) => say(`  · ${line}`));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[reconcile] unexpected failure: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  checkMergedTasks,
  checkStampedBranches,
  isInFlight,
  isTerminal,
  distinctPrs,
  ghPrState,
  PR_URL_RE,
  AUTO_REPAIR_STATUSES,
  OPERATOR_STATUSES,
  TERMINAL_STATUS_TO_SET,
};
