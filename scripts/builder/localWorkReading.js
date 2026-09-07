'use strict';

/**
 * localWorkReading — THE ONE WIRING for "is a half-finished build sitting on
 * somebody's disk for this ticket?"
 *
 * `strandedLocalWork.js` holds the RULE and is deliberately pure: every
 * dependency it has is injected, so its tests can drive it against real
 * temporary git repositories with no ssh and no inventory. Something still has
 * to hand it the real ssh executor, the real node list, the real inventory and
 * the real checkout path — and until 2026-09-06 that plumbing lived inside
 * `scripts/pipeline.mjs`, reachable from the sweep and from nowhere else.
 *
 * WHY THAT MATTERED (task 86bbvj44f). `npm run clickup -- pass-reconcile` is
 * the loop's dropped-claim backstop, and it hands a dead build back by asking
 * a PULL REQUEST lookup whether anything was built. When no PR is open it said
 *
 *   nothing has been built for it that a new branch would duplicate
 *
 * which is the exact false sentence task 86bbur9tk was written to remove. #624
 * removed it from the sweep — the path a person types by hand — and left
 * `pass-reconcile`, which is the path that fires on a TIMER: `npm run repair`
 * runs `pass-reconcile --scheduled` FIRST and the sweep third, so on the Mini,
 * where the loops actually run, a dead loop-build pass had its ticket moved to
 * `Queued` before the sweep with the guard in it ever looked.
 *
 * The obvious fix — copy the six lines of wiring into `clickup_direct.mjs` —
 * would be a second reading of the same question, and this ticket's own scope
 * forbids it: "One definition of 'was anything built', shared with the sweep.
 * A third one would drift, which is the reason `strandedBuildDestination` is
 * shared in the first place." So the wiring moved HERE and both callers import
 * it. `pipeline.mjs` behaves exactly as it did; this file is its old code, in
 * a place a second caller can reach.
 *
 * Nothing here decides anything. Where a ticket goes once the reading is in is
 * `pipelinePause.strandedBuildDestination` (no work) and
 * `pipelinePause.reconciledBuildDestination` (with the reading), for the same
 * reason: one definition, in one place, read by everyone.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const nodeRoles = require('../../lib/nodeRoles.js');
const taskRepo = require('./taskRepo.js');
const remoteProbe = require('./remoteProbe.js');
const { findWorkInProgress, sshRoutedMachines, BLOCKED_REPO, BLOCKED_TICKET } = require('./strandedLocalWork.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Which machine are we standing on, in the words `nodeRoles` uses. */
function thisNodeName() {
  const n = nodeRoles.thisNode();
  return n.name || 'an unidentified machine';
}

/**
 * Run a command here. Every failure resolves to an ANSWER rather than an
 * exception — a sweep or a reconcile must never die half-way through — and
 * `remoteProbe` turns the shape below into the `ran`/`why` a verdict needs.
 */
function runLocal(cmd, args, timeoutMs = 8000) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { timeout: timeoutMs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return {
      ok: false,
      missing: err.code === 'ENOENT',
      timedOut: remoteProbe.isTimeout(err),
      code: typeof err.status === 'number' ? err.status : null,
    };
  }
}

/**
 * The executor plus the answer to "which machines can be asked at all".
 *
 * Build it ONCE per run and pass it to every `workInProgressFor` call: the
 * inventory read is the same answer every time, and a per-ticket re-read is a
 * per-ticket chance for the two readings to disagree.
 */
function workProbe({ readFile = readFileSync, repoRoot = REPO_ROOT } = {}) {
  const here = thisNodeName();
  const exec = remoteProbe.createExecutor({ run: runLocal, hereId: here });
  // WHICH MACHINES HAVE AN SSH ROUTE, read once from the same field of the
  // same file `check_ecosystem_drift.cjs` reads. Without it the sweep ssh'd a
  // machine with no route — 255, every ticket, every run — and reported the
  // whole queue as unjudgeable from the one seat it runs on.
  let routes = { known: false, machines: [] };
  try {
    routes = sshRoutedMachines(readFile(path.join(repoRoot, 'docs', 'ecosystem', 'inventory.yaml'), 'utf8'));
  } catch {
    // Unreadable inventory -> every machine is tried, and an ssh failure
    // becomes an honest cannot-tell. Fail towards not moving things.
  }
  return { here, shell: exec.shell, routedMachines: routes.machines, routesKnown: routes.known };
}

/**
 * Is a build in flight for this ticket on somebody's disk?
 *
 * The repo comes from the ticket's own `repo:` tag through `taskRepo`, the
 * same resolver the build loop uses, so the reading looks in the checkout the
 * builder would actually have used. A repo that cannot be resolved, or has no
 * checkout here, is `cannot-tell` and never `none`: not knowing where to look
 * is not the same as having looked (DOCTRINE 3.11).
 *
 * @param {{id: string, tags?: Array}} task  the ClickUp task, tags included
 * @param {object} probe  the value `workProbe()` returned
 */
function workInProgressFor(task, probe) {
  // THE SEAT IS NAMED, so a caller can tell a blind spot HERE from one on
  // another machine. `build-start` draws exactly that line — a disk it cannot
  // read here is fatal, another machine going quiet is stated and stepped past
  // — and it cannot draw it against the literal string this used to write.
  const here = probe?.here || 'this machine';

  // A TICKET THAT WAS NEVER READ IS NOT A TICKET WITH NO TAGS (round-1 review,
  // finding 2). `resolveTaskRepo(undefined)` answers `starcaster`, because no
  // `repo:` tag legitimately MEANS starcaster — so a caller that fabricated
  // `{ id }` after a failed ClickUp read had a `repo:pulse` ticket probed
  // against the starcaster checkout, found nothing there, and answered `none`:
  // the exact false all-clear this reading exists to close, arriving through
  // the reading itself. The API always returns a `tags` array, so its absence
  // is the fabrication's own fingerprint, and this is the one wiring both
  // callers come through — the guard belongs here rather than at each of them.
  if (!task || !Array.isArray(task.tags)) {
    return { verdict: 'cannot-tell', work: [], unlooked: [], unseen: [{ machine: here, blocked: BLOCKED_TICKET, why: 'the ticket itself was not read, so which repo to look in is unknown — nothing was probed' }] };
  }
  // A REPO THAT DOES NOT RESOLVE IS MARKED, NOT JUST DESCRIBED (round-3
  // review, finding 1, 2026-09-07). Both of the returns below are blind spots
  // that WAITING CANNOT CLEAR: the ticket carries a tag naming no known repo,
  // or a repo whose checkout is not on this machine, and it will carry it
  // again on the next pass and every pass after that. Left as a plain `unseen`
  // row they were indistinguishable from a laptop that happened to be shut, so
  // `build-start` stopped the pass with nothing to say and the ticket went
  // back to the head of the claim line to be refused again — for good.
  // `BLOCKED_REPO` is what lets `describeNextMove` print the escalation the
  // loop-build skill already prescribes for exactly this ticket.
  const resolved = taskRepo.resolveTaskRepo(task.tags);
  if (resolved.action !== 'build' || !resolved.repo) {
    return { verdict: 'cannot-tell', work: [], unlooked: [], unseen: [{ machine: here, blocked: BLOCKED_REPO, why: `the task's repo could not be resolved (${resolved.reason})` }] };
  }
  const home = taskRepo.repoHome(resolved.repo);
  if (!home) {
    return { verdict: 'cannot-tell', work: [], unlooked: [], unseen: [{ machine: here, blocked: BLOCKED_REPO, why: `no checkout path is known for repo:${resolved.repo}` }] };
  }
  return findWorkInProgress({
    taskId: task.id,
    repoHome: home,
    nodes: nodeRoles.KNOWN_NODES,
    hereId: probe.here,
    shell: probe.shell,
    routedMachines: probe.routedMachines,
    routesKnown: probe.routesKnown,
  });
}

module.exports = { thisNodeName, runLocal, workProbe, workInProgressFor, REPO_ROOT };
