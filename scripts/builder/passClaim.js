'use strict';

/**
 * THE CLAIM MARKER — how a loop-build pass proves it finished what it started.
 *
 * WHY THIS EXISTS (2026-09-02, task 86bbtmbpc). A loop pass claims a ticket by
 * moving it to "Building", and the loops claim only from "Rework" and
 * "Queued". So a pass that ends without handing its ticket on leaves it
 * unreachable — not slow, not queued, but invisible to every actor in the
 * system, forever, until a person moves it by hand.
 *
 * It happened twice on the night of 2026-09-01, in two shapes that need
 * different answers:
 *
 *   86bbjt1b4  the pass RAN TO COMPLETION. It finished PR #449, wrote
 *              "I have a waiter armed that will bring me back the moment all
 *              four checks settle", and exited 0 at 00:29 without moving the
 *              ticket. There is no coming back: a pass is a one-shot
 *              `claude -p` session that ends when it stops producing output.
 *
 *   86bbr2jpq  the pass was KILLED. Claimed at 2:06am, dead at 2:08 on
 *              "You've hit your session limit · resets 2:50am".
 *
 * The second is why none of this lives inside the pass. Nothing in a killed
 * session runs again — no `Stop` hook, no "before you finish" instruction, no
 * amount of skill prose. The repair has to be done by something that runs
 * AFTERWARDS, and the cheapest thing guaranteed to run afterwards is the next
 * pass: the runner is a `while true` loop, and a fresh session is precisely
 * what survives the previous one being killed.
 *
 * So: claiming writes a marker, handing off clears it, and every pass begins
 * by reconciling whatever the last one left behind.
 *
 * WHY THE MARKER IS OPT-IN. A hand-driven fast-track session claims tickets
 * with the same command. If every claim wrote a marker, a later loop pass
 * would find a ticket a person is actively building and hand it back out from
 * under them. Only the loop skill passes `--pass`, and that is the whole of
 * the safety argument — there is no timing heuristic here to get wrong.
 */

const fs = require('node:fs');
const path = require('node:path');

/** The one filename, so writer and reader cannot drift. */
const MARKER_FILE = 'loop-pass-claim.json';

/**
 * Where the marker lives: beside the SHARED git directory, not inside the
 * worktree the pass is about to create.
 *
 * `git rev-parse --git-common-dir` is the shared `.git` even when it is asked
 * from inside a linked worktree, where plain `.git` is a file pointing
 * somewhere else. That matters because the claim happens in the main checkout
 * and the hand-off happens inside the pass's worktree — a path that resolved
 * differently in those two places would write one marker and clear another,
 * which is worse than having none at all.
 */
function markerPath(gitCommonDir) {
  return path.join(String(gitCommonDir || '.git'), MARKER_FILE);
}

/**
 * What one claim records. `pid` and `at` are not read by the reconcile — the
 * marker's mere existence is the signal — but they are what turns a confusing
 * file into a legible one when somebody finds it by hand at 3am.
 */
function claimRecord({ task, skill, at, pid }) {
  return {
    task: String(task || ''),
    skill: String(skill || ''),
    at: at || new Date().toISOString(),
    pid: Number.isFinite(Number(pid)) ? Number(pid) : null,
  };
}

/**
 * Read a marker back, or null.
 *
 * A FILE THAT CANNOT BE PARSED IS NOT "NO CLAIM". Returning null for corrupt
 * JSON would silently drop the ticket it names, which is the failure this
 * whole module exists to prevent — so it is reported as unreadable and the
 * caller says so rather than proceeding as if the deck were clear
 * (DOCTRINE 3.11).
 */
function readMarker(file, { readFile = (f) => fs.readFileSync(f, 'utf8'), exists = fs.existsSync } = {}) {
  if (!exists(file)) return { found: false, record: null, why: '' };
  let text;
  try {
    text = readFile(file);
  } catch (err) {
    return { found: true, record: null, why: `the marker could not be read (${err?.message || err})` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { found: true, record: null, why: 'the marker is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || !String(parsed.task || '').trim()) {
    return { found: true, record: null, why: 'the marker names no task' };
  }
  return { found: true, record: claimRecord(parsed), why: '' };
}

/**
 * What to do about the marker the last pass left, given the ticket's status
 * NOW. The decision, separated from the doing, so every branch is testable.
 *
 *   nothing      no marker: the last pass handed its ticket on. The normal case.
 *   unreadable   a marker exists and could not be understood. Say so; act on
 *                nothing, because acting would mean guessing which ticket.
 *   resolved     the ticket has moved on by itself. Clear the marker quietly —
 *                this is what a pass that hit `ship` but died before clearing
 *                looks like, and it is not a fault.
 *   handback     the ticket is STILL in "Building" and nothing is working on
 *                it. This is the defect. Hand it back.
 */
function reconcileDecision({ marker, status } = {}) {
  if (!marker || !marker.found) return { action: 'nothing', reason: 'no pass left a claim behind' };
  if (!marker.record) return { action: 'unreadable', reason: marker.why || 'the marker could not be understood' };

  const task = marker.record.task;
  const now = String(status || '').trim().toLowerCase();

  // The status could not be read. NOT a hand-back: moving a ticket on a
  // reading we did not take is how a live build gets yanked out from under a
  // pass that is genuinely running.
  if (!now) {
    return { action: 'unreadable', task, reason: `the status of ${task} could not be read, so nothing was moved` };
  }
  if (now !== 'building') {
    return { action: 'resolved', task, status: now, reason: `${task} is "${now}" — the pass handed it on` };
  }
  return {
    action: 'handback',
    task,
    reason: `${task} is still "Building" and the pass that claimed it is gone — nothing claims from Building, so it would sit there forever`,
  };
}

/**
 * The line the pass prints about what it found. It is deliberately loud on
 * `handback`: that line is the only evidence in the runner log that a previous
 * pass dropped its ticket, and a defect nobody can see is a defect nobody
 * fixes.
 */
function reconcileMessage(decision, { destination = '' } = {}) {
  if (!decision) return '';
  switch (decision.action) {
    case 'nothing':
      return 'No claim was left behind by the previous pass.';
    case 'resolved':
      return `Cleared a stale claim marker — ${decision.reason}.`;
    case 'unreadable':
      return `COULD NOT TELL: ${decision.reason}. Nothing was moved; the marker is left in place.`;
    case 'handback':
      return `THE PREVIOUS PASS DROPPED ITS TICKET — ${decision.reason}. `
        + `Handed back to ${destination || 'the claim line'}.`;
    default:
      return `Unrecognised reconcile action "${decision.action}" — nothing was done.`;
  }
}

/**
 * Exit code for the standalone command.
 *
 *   0  nothing to do, or a stale marker cleared
 *   1  a hand-back was needed and could not be completed
 *   2  a marker exists and could not be understood, or the status could not be
 *      read — "could not tell", which must never read as 0
 *   3  a hand-back was performed. A normal outcome, and NOT 0, because the
 *      caller (and the log) should be able to see that a previous pass failed
 *      to finish without reading prose.
 */
function reconcileExitCode({ action, ok = true } = {}) {
  if (action === 'unreadable') return 2;
  if (action === 'handback') return ok ? 3 : 1;
  return 0;
}

module.exports = {
  MARKER_FILE,
  markerPath,
  claimRecord,
  readMarker,
  reconcileDecision,
  reconcileMessage,
  reconcileExitCode,
};
