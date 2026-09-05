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
 * machine, which is the incident above exactly. So every node that HAS an ssh
 * route is asked, via `remoteProbe` (one connection per machine, login shell,
 * short timeout), and a routed machine that does not answer is UNSEEN rather
 * than empty.
 *
 * THE THREE VERDICTS, and why there are three:
 *
 *   work         a stamped branch with uncommitted changes or unpushed
 *                commits was found. The ticket is half-built: leave it alone.
 *   none         every machine that could be asked was asked and answered,
 *                and none of them has anything. This is the sweep's real job
 *                and it must keep working — a guard that never lets anything
 *                through is the mirror-image defect, and this repo has
 *                shipped that one.
 *   cannot-tell  a machine that SHOULD have answered did not (asleep, no key,
 *                git unreadable there). "I did not look" is not "there is
 *                nothing there" (DOCTRINE 3.11). The ticket is reported with
 *                the command to look by hand, and NOT moved.
 *
 * A FOURTH MACHINE STATE, AND IT IS NOT A VERDICT — `unrouted` (round-1
 * review, 2026-09-05). Some machines have no ssh route at all: the inventory
 * declares the Mini reachable "key-based, from the MacBook", one direction
 * only, and `macbook-pro` carries `probe: hostname`. From the Mini — the
 * machine that owns the loops and actually runs the sweep — `ssh macbook-pro`
 * exits 255, "could not resolve hostname".
 *
 * Round 1 folded that into `cannot-tell`, and the result was a sweep that
 * could never move ANYTHING from the only seat it runs on: acceptance
 * criterion 3 failing in production, the mirror-image defect arriving through
 * the node list instead of through `combineVerdicts`. So the two are separated,
 * because they are genuinely different facts:
 *
 *   unseen    a machine we had every reason to expect an answer from, and did
 *             not get one. A reading was attempted and failed. TRANSIENT —
 *             the next sweep may well succeed. → cannot-tell, do not move.
 *   unrouted  a machine there is no way to ask from here, and there was never
 *             going to be. PERMANENT, and known in advance. Waiting for it is
 *             waiting forever.
 *
 * An `unrouted` machine does NOT freeze the verdict. The sweep answers from
 * what it could genuinely see, and every sentence it writes — the terminal
 * line, the ticket note, the bus — NAMES the seat that was never looked at.
 * That is the honest reading of this ticket's complaint, which was never
 * "move fewer tickets": it was that the sweep asserted an absence it had not
 * checked. A qualified true sentence is not that. The residual risk (a build
 * sitting on the unroutable machine is still duplicated) is real, visible on
 * the ticket, and closed by giving the seat a route — not by a sweep that
 * stops working.
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
 * `homeRelative` IS THE WHOLE REMOTE PATH PROBLEM, and getting it wrong was
 * silent (found in review, round 1, 2026-09-05). Another machine's checkout
 * sits under ITS home directory, which only that machine can resolve — so the
 * path has to arrive as `$HOME/<rel>` and be expanded THERE. Single-quoting it
 * the way the local absolute path is quoted stops that expansion dead:
 *
 *     R='$HOME/WebApps/starcaster'        <- literal; `[ -e "$R/.git" ]` is false
 *
 * and the probe then answers `NO-REPO`, which `machineVerdict` treats as a real
 * answer (`seen: true`) rather than a blind spot. Measured on the Mini against
 * a path that DOES exist: `"NO-REPO\nPROBE-DONE\n"`. So every remote machine
 * reported confidently empty, `combineVerdicts` answered `none`, and a
 * half-built ticket went back to `Queued` — this ticket's own incident, from
 * the other seat, with the guard installed and silent.
 *
 * The two seats therefore quote differently, on purpose:
 *
 *     R='<abs>/WebApps/starcaster'    local — absolute, fully quoted
 *     R="$HOME"/'WebApps/starcaster'  remote — expanded on the far side
 *
 * The literal half stays single-quoted in both, so a path with spaces still
 * survives; only `$HOME` is left to the shell that knows what it means.
 *
 * COMMITS ARE COUNTED WITH `git cherry`, NOT `rev-list --count` (finding 3,
 * same review). This repo squash-merges, so a merged branch that still carries
 * its stamp is `ahead > 0` forever by commit count and would pin its ticket in
 * "Building" with nobody able to clear it. `git cherry` compares patch ids,
 * which is what CLAUDE.md names as the only correct test here and what
 * `scripts/lib/repo_state.cjs` uses as its first signal.
 *
 * It is only that FIRST signal, and the difference is stated rather than
 * papered over: `repo_state` follows cherry with a content probe and a GitHub
 * lookup, because a squash of N >= 2 commits matches none of the N patch ids.
 * Neither of those is reachable from a `sh` one-liner on a machine we can only
 * talk to down an ssh pipe. The residual is over-reporting — a multi-commit
 * branch already merged reads as work — and that direction is the safe one
 * here: the ticket is left in "Building" and named in the sweep's output every
 * run, with the branch and the command to settle it, rather than silently
 * handed to a second builder.
 *
 * A count of zero also comes back when there is no `origin/main` to compare
 * against (a fresh clone mid-fetch, a repo whose default branch is named
 * otherwise, or a checkout that has not fetched in a while). Zero is honest
 * there: it means "no commits I can prove are beyond main", and the
 * uncommitted-changes half of the test still stands on its own.
 */
function probeScript({ repoPath, taskId, homeRelative = false }) {
  const repo = String(repoPath || '');
  const task = String(taskId || '');
  if (!repo || !task) throw new Error('probeScript needs both repoPath and taskId');
  // Single-quoted in the script so a path with spaces survives; the values are
  // ours (a config path and a ClickUp id), never operator input.
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    `R=${homeRelative ? `"$HOME"/${q(repo)}` : q(repo)}`,
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
    `  ahead=$(git -C "$R" cherry origin/main "refs/heads/$b" 2>/dev/null | grep -c '^+' || true)`,
    `  [ -n "$ahead" ] || ahead=0`,
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
function machineVerdict({ machine, ran, why, out, unrouted = false }) {
  // No way to ask, and there never was. Distinct from `seen: false` on purpose
  // — see the header. `seen` stays false because nothing was looked at; the
  // `unrouted` flag is what stops it counting as a failed reading.
  if (unrouted) return { machine, seen: false, unrouted: true, why: String(why || 'no ssh route to it is declared, so it cannot be looked at from here'), work: [] };
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
 *
 * `unseen` and `unlooked` are kept apart all the way out (round-1 review), and
 * only `unseen` can force `cannot-tell`. An `unrouted` machine is reported in
 * `unlooked` on EVERY verdict including `none`, because the caller has to be
 * able to say which seat it could not see even when it is going ahead with the
 * move. Collapsing them here is what made the sweep unable to move anything.
 */
function combineVerdicts(rows = []) {
  const machines = Array.isArray(rows) ? rows : [];
  const unseen = machines.filter((m) => !m.seen && !m.unrouted);
  const unlooked = machines.filter((m) => m.unrouted);
  const work = machines.flatMap((m) => m.work || []);
  if (work.length) return { verdict: 'work', work, unseen, unlooked };
  if (unseen.length) return { verdict: 'cannot-tell', work: [], unseen, unlooked };
  return { verdict: 'none', work: [], unseen: [], unlooked };
}

/**
 * Where this repo lives on `machine`.
 *
 * On the machine we are standing on, the absolute path `taskRepo` derived is
 * exactly right. On another machine it is not: the checkouts sit under each
 * machine's own home directory, and `repoHome` can only speak for this one
 * (NODES P1 — no committed artifact names a machine). So a remote path is the
 * local one re-rooted at that machine's own `$HOME`, and a repo that does NOT
 * live under this home cannot be located remotely at all — which is stated as
 * a blind spot, never guessed at.
 *
 * A REMOTE PATH COMES BACK RELATIVE, and `homeRelative` says so. Returning the
 * assembled string `$HOME/WebApps/starcaster` is what made round 1 wrong: it
 * reads like a path, so it was quoted like a path, and `$HOME` never expanded
 * (see `probeScript`). Handing back the two halves separately means the caller
 * cannot make that mistake without noticing — `homeRelative: true` has no
 * meaning unless something acts on it. `display` is the assembled form, for
 * messages only.
 */
function repoPathOn({ machine, hereId, repoHome, homedir = os.homedir() }) {
  if (machine === hereId) return { path: repoHome, remote: false, homeRelative: false, display: repoHome };
  const rel = path.relative(homedir, repoHome);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { path: '', remote: true, homeRelative: false, why: `this repo's checkout (${repoHome}) is not under a home directory, so its path on another machine cannot be derived` };
  }
  const posix = rel.split(path.sep).join('/');
  return { path: posix, remote: true, homeRelative: true, display: `$HOME/${posix}` };
}

/**
 * Which machines does the ecosystem inventory claim an SSH route to?
 *
 * WHY THIS IS ASKED AT ALL (finding 2 of the round-1 review, 2026-09-05).
 * Round 1 walked `nodeRoles.KNOWN_NODES` and ssh'd every entry. There is no
 * route from the Mini to the MacBook — `docs/ecosystem/inventory.yaml` says so
 * itself, `macbook-pro` is `probe: hostname` while `mac-mini` is `probe: ssh
 * (key-based, from the MacBook)`, one direction only — so on the Mini, which
 * is the machine that owns the loops and actually runs the sweep, EVERY
 * stranded build answered `cannot-tell` and none could ever be unstuck.
 * Measured there: `ssh macbook-pro` exits 255, "could not resolve hostname".
 *
 * That is acceptance criterion 3 failing in production ("the fix must not
 * disable the sweep's real job") — the mirror-image defect this ticket names,
 * arrived at through the node list rather than through `combineVerdicts`. The
 * unit test passed because it was handed a one-machine node list; the shipped
 * sweep never gets that list.
 *
 * `check_ecosystem_drift.cjs` already draws this line (`m.probe === 'ssh'`)
 * and this reads the same field of the same file, so the two cannot come to
 * different conclusions about which machines are reachable.
 *
 * AN UNREADABLE INVENTORY MEANS EVERY MACHINE IS ROUTED, not none. A missing
 * or malformed file must not silently convert a fleet into "nothing to look
 * at"; treating every machine as routed sends it down the ssh path, where a
 * failure becomes an honest `cannot-tell` and the ticket is left alone. Fail
 * towards not moving things.
 */
function sshRoutedMachines(inventoryText, { parseYaml } = {}) {
  const parse = parseYaml || require('js-yaml').load;
  let doc;
  try {
    doc = parse(String(inventoryText || ''));
  } catch {
    return { known: false, machines: [] };
  }
  const objects = Array.isArray(doc?.objects) ? doc.objects : null;
  if (!objects) return { known: false, machines: [] };
  return {
    known: true,
    machines: objects.filter((o) => o?.kind === 'machine' && o?.probe === 'ssh').map((o) => String(o.id)),
  };
}

/**
 * Ask every machine that CAN be asked whether it is holding work for this
 * ticket.
 *
 * `routedMachines` is the list from `sshRoutedMachines`; a remote machine
 * outside it is never ssh'd at all. Round 1 ssh'd every entry in
 * `nodeRoles.KNOWN_NODES` and paid a 255 for the one with no route, on every
 * ticket, forever. `routesKnown: false` (an unreadable inventory) means every
 * machine is tried — failing towards not moving things, never towards a fleet
 * that reads as nothing to look at.
 *
 * @param {object}   opts
 * @param {string}   opts.taskId          the ClickUp id stamped on the branch
 * @param {string}   opts.repoHome        this machine's checkout of the task's repo
 * @param {string[]} opts.nodes           every known machine (lib/nodeRoles.KNOWN_NODES)
 * @param {string}   opts.hereId          which of them we are standing on
 * @param {Function} opts.shell           remoteProbe executor's `shell(machine, cmd)`
 * @param {string[]} [opts.routedMachines] machines the inventory gives an ssh route
 * @param {boolean}  [opts.routesKnown]    was the inventory readable at all?
 * @param {number}   [opts.timeoutMs]
 */
function findWorkInProgress({
  taskId, repoHome, nodes = [], hereId, shell,
  routedMachines = [], routesKnown = false,
  homedir = os.homedir(), timeoutMs = 20000,
}) {
  const routed = new Set(routedMachines || []);
  const rows = [];
  for (const machine of nodes) {
    const where = repoPathOn({ machine, hereId, repoHome, homedir });
    // No route declared to this machine — not a failed reading, a seat that
    // was never reachable from here. Asked BEFORE the path check so the
    // reported reason is the one that actually stops us.
    if (where.remote && routesKnown && !routed.has(machine)) {
      rows.push(machineVerdict({
        machine,
        unrouted: true,
        why: 'no ssh route to it is declared in docs/ecosystem/inventory.yaml, so it cannot be looked at from this machine',
      }));
      continue;
    }
    if (!where.path) {
      rows.push({ machine, seen: false, why: where.why, work: [] });
      continue;
    }
    const script = probeScript({ repoPath: where.path, taskId, homeRelative: where.homeRelative });
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
 * The seats the sweep could not look at, as one clause for a sentence that is
 * going ahead anyway.
 *
 * Exported and shared so the terminal line, the ticket note and the bus
 * message cannot end up describing the blind spot three different ways.
 */
function describeUnlooked(unlooked = []) {
  const rows = (Array.isArray(unlooked) ? unlooked : []).filter(Boolean);
  if (!rows.length) return '';
  return rows.map((m) => `${m.machine} (${m.why})`).join('; ');
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
function preservedLine({ id, name, verdict, work = [], unseen = [], unlooked = [], age = '' }) {
  const who = `${id}${name ? ` ("${name}")` : ''}`;
  if (verdict === 'work') {
    return `  ${who} is NOT being returned to the claim line — a build is half-finished for it${age}: `
      + `${describeWork(work).join('; ')}. Left in "Building"; nothing has been pushed or committed for you. `
      + 'Finish it there, or hand the ticket back yourself with '
      + `\`npm run clickup -- status --task ${id} --status "Rework"\`.`;
  }
  // BOTH KINDS OF BLIND SPOT, on a ticket that is being left alone. The
  // verdict is driven by `unseen` — a routeless machine never forces
  // cannot-tell — but once we are not moving the ticket anyway, a reader
  // going to look by hand needs every seat that was not looked at, not just
  // the ones that failed to answer.
  const blind = [...unseen, ...unlooked].map((m) => `${m.machine} (${m.why})`).join('; ');
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
  sshRoutedMachines,
  findWorkInProgress,
  describeWork,
  describeUnlooked,
  preservedLine,
};
