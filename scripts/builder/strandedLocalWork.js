'use strict';

/**
 * IS THERE WORK IN PROGRESS FOR THIS STRANDED TICKET, ON ANY MACHINE?
 *
 * WHY THIS EXISTS (2026-09-04, task 86bbur9tk). The stranded sweep decides
 * whether a dead build left anything worth keeping by asking GitHub whether a
 * PULL REQUEST is open for the ticket. When none is, it says
 *
 *   nothing has been built for it that a new branch would duplicate
 *
 * and returns the ticket to `Queued`, where the next pass starts from zero.
 *
 * That sentence is false for every build that got as far as writing code and
 * not as far as pushing. Work in progress lives in a WORKTREE ON A MACHINE —
 * uncommitted, or committed to a branch nobody has pushed — and a PR lookup
 * has no window onto either.
 *
 * It cost on 2026-09-03: task 86bbuhph0 ("Split Related Articles out of the
 * Tag manager") was about two-thirds built in
 * `.claude/worktrees/related-articles-module` on the MacBook — 7 modified
 * files, branch stamped with the task id — and the sweep reported that nothing
 * had been built and put it back in the claim line. Nothing was lost, because
 * the worktree is still there. What was lost is the LINK: the ticket no longer
 * pointed at the work, and the next claimant would have rebuilt it. That is
 * the 2026-08-20 double-build shape, produced by the system rather than by a
 * second session.
 *
 * WHAT COUNTS AS EVIDENCE. `npm run thread` stamps every branch it creates
 * with `branch.<name>.clickup-task <id>`, and the fast-track lane stamps by
 * hand for the same reason. So a stamped branch is the ticket's own fingerprint
 * on a machine's disk, and it is readable without knowing anything else about
 * how the build was started. A stamped branch counts as work when EITHER its
 * worktree has uncommitted changes OR it carries commits `origin/main` does
 * not — pushed or not, because a pushed branch with no PR is still built work
 * a new branch would duplicate.
 *
 * WHY IT ASKS OTHER MACHINES. The evidence is on a disk, and the sweep runs
 * wherever it runs — the Mini owns the loops, the MacBook is where a
 * fast-track session usually sits. A sweep that only looked at its own disk
 * would answer "nothing was built" for every ticket built on the other
 * machine, which is the incident above exactly. So every known node is asked,
 * over SSH via `remoteProbe` (one connection per machine, login shell, short
 * timeout), and a machine that does not answer is UNSEEN rather than empty.
 *
 * THE THREE VERDICTS, and why there are three:
 *
 *   work         a stamped branch with uncommitted changes or unpushed
 *                commits was found. The ticket is half-built: leave it alone.
 *   none         every known machine was asked and answered, and none of them
 *                has anything. This is the sweep's real job and it must keep
 *                working — a guard that never lets anything through is the
 *                mirror-image defect, and this repo has shipped that one.
 *   cannot-tell  at least one machine could not be looked at (asleep, no key,
 *                git unreadable there). "I did not look" is not "there is
 *                nothing there" (DOCTRINE 3.11). The ticket is reported with
 *                the command to look by hand, and NOT moved.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never pushes, commits, or otherwise
 * touches the work it finds. Recovering a half-finished build is a decision,
 * not a sweep (this ticket's non-goals).
 *
 * Everything here is pure or injected: `shell` comes from
 * `remoteProbe.createExecutor`, the node list from `lib/nodeRoles`, the repo
 * path from `taskRepo`. The tests drive the real probe script against real
 * temporary git repositories, because a shell one-liner asserted against a
 * fixture of its own output is a test of the fixture.
 */

const os = require('node:os');
const path = require('node:path');

/** Printed by the probe as its last line. Its ABSENCE is the signal: a probe
 *  that was cut off, timed out, or died halfway must never read as "no work
 *  found here", which is the direction that loses a build. */
const PROBE_DONE = 'PROBE-DONE';

/** The probe found no checkout of this repo on that machine. */
const PROBE_NO_REPO = 'NO-REPO';

/** The probe found a checkout but git would not answer about it. */
const PROBE_GIT_FAILED = 'GIT-FAILED';

/**
 * The shell one-liner, as text.
 *
 * POSIX `sh`, not bash: it runs through `/bin/sh -c` locally and through a
 * login `bash -lc` remotely (remoteProbe rule 4), and the only way one script
 * can be correct in both seats is to stay inside what both guarantee.
 *
 * It prints one `BRANCH` line per stamped branch and nothing else, so the
 * parser never has to guess which lines are its own. Tab-separated because a
 * worktree path may contain spaces and a branch name may not contain a tab.
 *
 * `|| echo 0` on the rev-list guards a checkout with no `origin/main` — a
 * fresh clone mid-fetch, or a repo whose default branch is named otherwise.
 * Zero there is honest: it means "no commits I can prove are beyond main",
 * and the uncommitted-changes half of the test still stands on its own.
 */
function probeScript({ repoPath, taskId }) {
  const repo = String(repoPath || '');
  const task = String(taskId || '');
  if (!repo || !task) throw new Error('probeScript needs both repoPath and taskId');
  // Single-quoted in the script so a path with spaces survives; the values are
  // ours (a config path and a ClickUp id), never operator input.
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    `R=${q(repo)}`,
    `T=${q(task)}`,
    `if [ ! -e "$R/.git" ]; then echo ${PROBE_NO_REPO}; echo ${PROBE_DONE}; exit 0; fi`,
    `if ! git -C "$R" rev-parse --git-dir >/dev/null 2>&1; then echo ${PROBE_GIT_FAILED}; echo ${PROBE_DONE}; exit 0; fi`,
    `git -C "$R" config --get-regexp '^branch\\..*\\.clickup-task$' 2>/dev/null | while read -r key val; do`,
    `  [ "$val" = "$T" ] || continue`,
    `  b=${'${key#branch.}'}`,
    `  b=${'${b%.clickup-task}'}`,
    `  wt=$(git -C "$R" worktree list --porcelain 2>/dev/null | awk -v want="refs/heads/$b" '$1=="worktree"{p=substr($0,10)} $1=="branch" && $2==want {print p; exit}')`,
    `  dirty=0`,
    `  if [ -n "$wt" ] && [ -d "$wt" ]; then dirty=$(git -C "$wt" status --porcelain 2>/dev/null | grep -c . || true); fi`,
    `  ahead=$(git -C "$R" rev-list --count "origin/main..refs/heads/$b" 2>/dev/null || echo 0)`,
    `  printf 'BRANCH\\t%s\\t%s\\t%s\\t%s\\n' "$b" "$dirty" "$ahead" "$wt"`,
    `done`,
    `echo ${PROBE_DONE}`,
  ].join('\n');
}

/**
 * Read one machine's probe output.
 *
 * A missing `PROBE_DONE` is the whole reason this returns a `finished` flag
 * rather than just a list: output that stopped early looks exactly like output
 * that found nothing, and only one of those is an answer.
 */
function parseProbe(out) {
  const text = String(out == null ? '' : out);
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const finished = lines.some((l) => l.trim() === PROBE_DONE);
  const noRepo = lines.some((l) => l.trim() === PROBE_NO_REPO);
  const gitFailed = lines.some((l) => l.trim() === PROBE_GIT_FAILED);
  const branches = [];
  for (const line of lines) {
    if (!line.startsWith('BRANCH\t')) continue;
    const [, branch, dirty, ahead, worktree] = line.split('\t');
    branches.push({
      branch: String(branch || ''),
      dirty: Number.isFinite(Number(dirty)) ? Number(dirty) : 0,
      ahead: Number.isFinite(Number(ahead)) ? Number(ahead) : 0,
      worktree: String(worktree || ''),
    });
  }
  return { finished, noRepo, gitFailed, branches };
}

/** Does this stamped branch carry work a new branch would duplicate? */
function branchHasWork(b) {
  return Number(b?.dirty) > 0 || Number(b?.ahead) > 0;
}

/** Plain English for what makes one branch count. */
function describeBranchWork(b) {
  const parts = [];
  if (Number(b?.dirty) > 0) parts.push(`${b.dirty} uncommitted file${b.dirty === 1 ? '' : 's'}`);
  if (Number(b?.ahead) > 0) parts.push(`${b.ahead} commit${b.ahead === 1 ? '' : 's'} not on main`);
  return parts.join(' and ');
}

/**
 * One machine's verdict, from its probe result.
 *
 * `NO-REPO` is a real ANSWER, not a blind spot: a machine with no checkout of
 * this repo cannot be holding a worktree of it. That distinction is what keeps
 * `none` reachable — treating every machine that merely lacks the repo as
 * unseen would make the sweep permanently unable to return anything, which is
 * the failure this fix must not introduce.
 */
function machineVerdict({ machine, ran, why, out }) {
  // `remoteProbe` ends an unreachable-host reason with "; not treated as
  // drift" — precise where it was written (the ecosystem drift check) and
  // meaningless here, where nothing is measuring drift. The reason itself is
  // kept verbatim; only that trailing clause is dropped, so the line a reader
  // sees is about THIS question.
  if (!ran) return { machine, seen: false, why: String(why || 'it could not be reached').replace(/;\s*not treated as drift\s*$/, ''), work: [] };
  const parsed = parseProbe(out);
  if (!parsed.finished) {
    return { machine, seen: false, why: 'its probe did not finish, so its answer is not trustworthy', work: [] };
  }
  if (parsed.gitFailed) {
    return { machine, seen: false, why: 'git there would not answer about the checkout', work: [] };
  }
  if (parsed.noRepo) {
    return { machine, seen: true, why: 'the repo is not checked out there', work: [] };
  }
  return {
    machine,
    seen: true,
    why: '',
    work: parsed.branches.filter(branchHasWork).map((b) => ({ ...b, machine })),
  };
}

/**
 * Combine the machines into ONE verdict.
 *
 * Positive evidence outranks a blind spot: if any machine we DID reach is
 * holding work, the answer is `work` whether or not another machine was
 * unreachable — the ticket is half-built either way and the sweep's only job
 * is to stop moving it.
 */
function combineVerdicts(rows = []) {
  const machines = Array.isArray(rows) ? rows : [];
  const work = machines.flatMap((m) => m.work || []);
  if (work.length) return { verdict: 'work', work, unseen: machines.filter((m) => !m.seen) };
  const unseen = machines.filter((m) => !m.seen);
  if (unseen.length) return { verdict: 'cannot-tell', work: [], unseen };
  return { verdict: 'none', work: [], unseen: [] };
}

/**
 * Where this repo lives on `machine`.
 *
 * On the machine we are standing on, the absolute path `taskRepo` derived is
 * exactly right. On another machine it is not: the checkouts sit under each
 * machine's own home directory, and `repoHome` can only speak for this one
 * (NODES P1 — no committed artifact names a machine). So a remote path is the
 * local one re-rooted at `$HOME`, and a repo that does NOT live under this
 * home cannot be located remotely at all — which is stated as a blind spot,
 * never guessed at.
 */
function repoPathOn({ machine, hereId, repoHome, homedir = os.homedir() }) {
  if (machine === hereId) return { path: repoHome, remote: false };
  const rel = path.relative(homedir, repoHome);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { path: '', remote: true, why: `this repo's checkout (${repoHome}) is not under a home directory, so its path on another machine cannot be derived` };
  }
  return { path: `$HOME/${rel.split(path.sep).join('/')}`, remote: true };
}

/**
 * Ask every known machine whether it is holding work for this ticket.
 *
 * @param {object}   opts
 * @param {string}   opts.taskId    the ClickUp id stamped on the branch
 * @param {string}   opts.repoHome  this machine's checkout of the task's repo
 * @param {string[]} opts.nodes     every known machine (lib/nodeRoles.KNOWN_NODES)
 * @param {string}   opts.hereId    which of them we are standing on
 * @param {Function} opts.shell     remoteProbe executor's `shell(machine, cmd)`
 * @param {number}   [opts.timeoutMs]
 */
function findWorkInProgress({ taskId, repoHome, nodes = [], hereId, shell, homedir = os.homedir(), timeoutMs = 20000 }) {
  const rows = [];
  for (const machine of nodes) {
    const where = repoPathOn({ machine, hereId, repoHome, homedir });
    if (!where.path) {
      rows.push({ machine, seen: false, why: where.why, work: [] });
      continue;
    }
    const script = probeScript({ repoPath: where.path, taskId });
    let res;
    try {
      res = shell(machine, script, timeoutMs);
    } catch (err) {
      // A probe that THREW tells us nothing about that machine. Saying so is
      // the whole point; swallowing it would be the false all-clear again.
      rows.push({ machine, seen: false, why: `the probe could not be run there (${err?.message || err})`, work: [] });
      continue;
    }
    rows.push(machineVerdict({ machine, ran: res?.ran !== false, why: res?.why, out: res?.out }));
  }
  return combineVerdicts(rows);
}

/**
 * WHERE THE WORK IS, in one line per branch — machine, worktree, branch, and
 * what makes it count. This is the sentence the sweep prints instead of the
 * false one, so it has to be enough to walk to the work with.
 */
function describeWork(work = []) {
  return (Array.isArray(work) ? work : []).map((w) => {
    const at = w.worktree ? ` in ${w.worktree}` : ' (no worktree — the branch exists but is not checked out)';
    const what = describeBranchWork(w);
    return `branch "${w.branch}" on ${w.machine}${at}${what ? ` — ${what}` : ''}`;
  });
}

/**
 * What the sweep says about a ticket it is NOT moving, and how to look for
 * yourself.
 *
 * The command is named in every case (this ticket's third scope bullet, and
 * the rule `npm run repair` already follows): a ticket reported as unjudgeable
 * with no way to settle it is a line nobody can act on, so it gets skimmed.
 */
function preservedLine({ id, name, verdict, work = [], unseen = [], age = '' }) {
  const who = `${id}${name ? ` ("${name}")` : ''}`;
  if (verdict === 'work') {
    return `  ${who} is NOT being returned to the claim line — a build is half-finished for it${age}: `
      + `${describeWork(work).join('; ')}. Left in "Building"; nothing has been pushed or committed for you. `
      + 'Finish it there, or hand the ticket back yourself with '
      + `\`npm run clickup -- status --task ${id} --status "Rework"\`.`;
  }
  const blind = unseen.map((m) => `${m.machine} (${m.why})`).join('; ');
  return `  ${who} CANNOT TELL whether anything was built for it${age} — ${blind}. `
    + 'Left exactly where it is rather than moved on a reading nobody took. '
    + `Look on that machine with \`git config --get-regexp 'clickup-task' | grep ${id}\`, `
    + `then \`npm run clickup -- status --task ${id} --status "Rework"\` if there is work, or `
    + '`--status "Queued"` if there is not.';
}

module.exports = {
  PROBE_DONE,
  PROBE_NO_REPO,
  PROBE_GIT_FAILED,
  probeScript,
  parseProbe,
  branchHasWork,
  describeBranchWork,
  machineVerdict,
  combineVerdicts,
  repoPathOn,
  findWorkInProgress,
  describeWork,
  preservedLine,
};
