#!/usr/bin/env node
'use strict';

/**
 * The reconciler — Charter Q2 (2026-08-18): keeps the Loop Queue and GitHub
 * reality from silently drifting apart.
 *
 * What it checks:
 *   1. Every IN-FLIGHT task (Building / In review / Needs your input / Ready
 *      to launch) whose comments link a GitHub PR: if that PR has merged,
 *      the task is moved to Live. This is the case the acceptance test
 *      seeds and repairs.
 *   2. Every local branch stamped with a ClickUp task (`branch.<name>.
 *      clickup-task`, Task-closes-thread / PR #344) whose stamped task has
 *      already reached a terminal status: flagged to the bus as a
 *      contradiction — the branch should have been cleaned up by
 *      `npm run tidy`'s own closed-task path and was not.
 *
 * What it deliberately does NOT do: file new ClickUp tasks for branches with
 * no stamp at all. Every branch that predates PR #344 has no stamp — filing
 * "no task tracks this branch" for every one of them would be noisy and
 * frequently wrong (many already have Loop Queue tasks tracked by name/title
 * only, which this script has no reliable way to match). Once threads are
 * routinely started via `npm run thread <topic> <task-id>`, an unstamped
 * branch becomes a much stronger signal and that action can be added; today
 * it would mostly manufacture false positives. This gap is reported, not
 * silently skipped (DOCTRINE 3.11) — see the "could not check" bucket below.
 *
 * Every task and branch lands in exactly ONE of three buckets — clean,
 * repaired, or COULD NOT CHECK — and the third is never folded into the
 * first. That is the whole discipline DOCTRINE 3.11 exists to enforce: a
 * sweep that silently skips what it cannot read has not surveyed anything.
 *
 * Dry-run by default — prints every proposed action, changes nothing.
 * Meant to run on a schedule (the Mac Mini engine room task).
 *
 *   npm run reconcile              # dry run
 *   npm run reconcile -- --live    # actually moves tasks / posts to the bus
 */

const { execFileSync } = require('child_process');
const { listTasks, getTaskComments, setTaskStatus, postBusMessage } = require('./lib/clickup.cjs');
const { branchInventory } = require('./lib/repo_state.cjs');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const IN_FLIGHT_STATUSES = new Set(['building', 'in review', 'needs your input', 'ready to launch']);
const TERMINAL_STATUSES = new Set(['live']);
const TERMINAL_STATUS_TO_SET = 'Live';
const PR_URL_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

const live = process.argv.includes('--live');
const quiet = process.argv.includes('--quiet');

function say(line) {
  if (!quiet) console.log(line);
}

/** null means "could not tell" — network, gh not authed, PR deleted, wrong
 *  repo — never treated the same as a real answer. */
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

function stampedTaskId(branchName) {
  try {
    return execFileSync('git', ['config', '--get', `branch.${branchName}.clickup-task`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * @param {object} deps injectable so a test can drive this with fake data
 *   instead of the network — every one defaults to the real implementation.
 */
async function checkMergedTasks(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    getComments = getTaskComments,
    prState = ghPrState,
    updateStatus = setTaskStatus,
    isLive = live,
    log = say,
  } = deps;

  const inFlight = tasks.filter((t) => IN_FLIGHT_STATUSES.has((t.status?.status || '').toLowerCase()));
  log(`[reconcile] ${inFlight.length} in-flight task(s) of ${tasks.length} total in the Loop Queue`);

  for (const task of inFlight) {
    let comments;
    try {
      comments = await getComments(task.id);
    } catch (err) {
      unchecked.push(`task ${task.id} "${task.name}": could not read comments — ${err.message}`);
      continue;
    }

    const prMatch = comments.map((c) => c.match(PR_URL_RE)).find(Boolean);
    if (!prMatch) {
      clean.push(`task ${task.id} "${task.name}": no PR linked yet — nothing to compare`);
      continue;
    }

    const [, owner, repoName, number] = prMatch;
    const pr = prState(owner, repoName, number);
    if (!pr) {
      unchecked.push(`task ${task.id} "${task.name}": could not read PR #${number} (${owner}/${repoName}) from GitHub`);
      continue;
    }

    if (pr.state === 'MERGED') {
      if (isLive) {
        try {
          await updateStatus(task.id, TERMINAL_STATUS_TO_SET);
          repaired.push(`task ${task.id} "${task.name}": PR #${number} merged — moved to ${TERMINAL_STATUS_TO_SET}`);
        } catch (err) {
          unchecked.push(`task ${task.id} "${task.name}": PR #${number} merged, but could not move the task — ${err.message}`);
        }
      } else {
        repaired.push(`[DRY RUN] task ${task.id} "${task.name}": PR #${number} merged — would move to ${TERMINAL_STATUS_TO_SET}`);
      }
    } else {
      clean.push(`task ${task.id} "${task.name}": PR #${number} is ${pr.state.toLowerCase()}, matches ClickUp`);
    }
  }
}

/** Same injection shape as checkMergedTasks — see its doc comment. */
async function checkStampedBranches(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    branches: branchesOverride = null,
    getStampedTaskId = stampedTaskId,
    postBus = postBusMessage,
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

    const status = (task.status?.status || '').toLowerCase();
    if (!TERMINAL_STATUSES.has(status)) {
      clean.push(`branch ${branch.name}: tracked by task ${taskId} (${status})`);
      continue;
    }

    // The stamped task is already Live, but the branch is still here — the
    // closed-task cleanup (PR #344) should have removed it and did not.
    const message = `branch \`${branch.name}\` is still on this Mac, but its stamped task ` +
      `${taskId} ("${task.name}") is already ${task.status?.status}. \`npm run tidy\` should ` +
      `have cleaned this up — worth a look.`;
    if (isLive) {
      try {
        await postBus(BUS_CHANNEL, `[reconciler] ${message}`);
        repaired.push(`branch ${branch.name}: flagged to the bus (task ${taskId} already ${task.status?.status})`);
      } catch (err) {
        unchecked.push(`branch ${branch.name}: contradiction found but could not post to the bus — ${err.message}`);
      }
    } else {
      repaired.push(`[DRY RUN] branch ${branch.name}: would flag to the bus — ${message}`);
    }
  }
}

async function main() {
  const clean = [];
  const repaired = [];
  const unchecked = [];

  let tasks;
  try {
    tasks = await listTasks(LOOP_QUEUE_LIST);
  } catch (err) {
    console.error(`[reconcile] FAILED to read the Loop Queue — nothing could be checked: ${err.message}`);
    process.exit(1);
  }

  await checkMergedTasks(tasks, clean, repaired, unchecked);
  await checkStampedBranches(tasks, clean, repaired, unchecked);

  say('');
  say(`[reconcile] ${clean.length} checked clean, ${repaired.length} ${live ? 'repaired' : 'would repair'}, ${unchecked.length} could not check.`);
  if (repaired.length) {
    say(live ? '\nRepaired:' : '\nWould repair:');
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
  ghPrState,
  stampedTaskId,
  PR_URL_RE,
  IN_FLIGHT_STATUSES,
  TERMINAL_STATUSES,
  TERMINAL_STATUS_TO_SET,
};
