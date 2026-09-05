'use strict';

/**
 * The stranded sweep must LOOK before it says nothing was built (task
 * 86bbur9tk).
 *
 * The probe is a shell one-liner, so most of these tests build a REAL git
 * repository in a temp directory and run the real script against it through
 * /bin/sh — the same path the sweep takes on the machine it is standing on.
 * A shell script asserted against a fixture of its own output is a test of the
 * fixture: every quoting, awk and `read` bug this thing can have lives in the
 * gap between the two.
 *
 * The four acceptance criteria are marked in the test names, including the
 * third — a guard that never lets anything through is the mirror-image defect,
 * and this repo has shipped that one before.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const work = require('./strandedLocalWork.js');

const TASK = '86bbur9tk';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * A repo with an `origin/main` that is real enough for `rev-list --count
 * origin/main..branch` to mean what it means in the live repo: a bare remote,
 * cloned, so the branch genuinely has commits the remote does not.
 */
function makeRepo() {
  // realpath, because on macOS /var is a symlink to /private/var and git
  // reports the resolved path — the probe is right and a raw mkdtemp path
  // would make a correct answer look wrong.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stranded-')));
  const bare = path.join(root, 'origin.git');
  const clone = path.join(root, 'repo');
  fs.mkdirSync(bare);
  git(bare, 'init', '--bare', '--initial-branch=main', '.');
  fs.mkdirSync(clone);
  git(clone, 'init', '--initial-branch=main', '.');
  git(clone, 'config', 'user.email', 'test@example.com');
  git(clone, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(clone, 'README.md'), 'hello\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'first');
  git(clone, 'remote', 'add', 'origin', bare);
  git(clone, 'push', '-u', 'origin', 'main');
  return { root, clone, bare };
}

/** Run the real probe the way the local seat runs it. */
function probe(repoPath, taskId = TASK) {
  const script = work.probeScript({ repoPath, taskId });
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' });
  return work.parseProbe(out);
}

/** One machine, reachable, answering with whatever the real probe says here. */
function shellHere(repoPath) {
  return (machine, script) => ({
    ran: true,
    ok: true,
    out: execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' }),
    where: 'this machine',
  });
}

// ── criterion 1: uncommitted changes on a stamped branch ──────────────────

test('criterion 1 — a stamped branch with uncommitted files is found, with its worktree named', () => {
  const { clone, root } = makeRepo();
  git(clone, 'checkout', '-b', 'half-built');
  git(clone, 'config', `branch.half-built.clickup-task`, TASK);
  fs.writeFileSync(path.join(clone, 'new-settings.tsx'), 'export const x = 1;\n');

  const parsed = probe(clone);
  assert.equal(parsed.finished, true, 'the probe must run to completion');
  assert.equal(parsed.branches.length, 1);
  assert.equal(parsed.branches[0].branch, 'half-built');
  assert.ok(parsed.branches[0].dirty > 0, 'the uncommitted file must be counted');
  assert.equal(parsed.branches[0].worktree, clone, 'the worktree path is what somebody walks to');
  assert.ok(work.branchHasWork(parsed.branches[0]));

  const verdict = work.findWorkInProgress({
    taskId: TASK, repoHome: clone, nodes: ['mac-mini'], hereId: 'mac-mini', shell: shellHere(clone),
  });
  assert.equal(verdict.verdict, 'work');
  const said = work.describeWork(verdict.work).join(' ');
  assert.match(said, /half-built/);
  assert.match(said, /mac-mini/);
  assert.ok(said.includes(clone), 'the line must name the worktree');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── criterion 2: unpushed commits, clean tree ─────────────────────────────

test('criterion 2 — a stamped branch with unpushed commits is found even with a clean tree', () => {
  const { clone, root } = makeRepo();
  git(clone, 'checkout', '-b', 'committed-not-pushed');
  git(clone, 'config', 'branch.committed-not-pushed.clickup-task', TASK);
  fs.writeFileSync(path.join(clone, 'module.js'), 'module.exports = 1;\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'two thirds of the work');

  const parsed = probe(clone);
  assert.equal(parsed.branches.length, 1);
  assert.equal(parsed.branches[0].dirty, 0, 'the tree is clean — this must rest on the commit alone');
  assert.equal(parsed.branches[0].ahead, 1);
  assert.ok(work.branchHasWork(parsed.branches[0]));

  const verdict = work.findWorkInProgress({
    taskId: TASK, repoHome: clone, nodes: ['mac-mini'], hereId: 'mac-mini', shell: shellHere(clone),
  });
  assert.equal(verdict.verdict, 'work');
  assert.match(work.describeBranchWork(parsed.branches[0]), /1 commit not on main/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── criterion 3: the sweep's real job must keep working ───────────────────

test('criterion 3 — nothing stamped anywhere still answers "none", so the sweep can still move tickets', () => {
  const { clone, root } = makeRepo();
  // A branch for a DIFFERENT ticket, and a stamped branch for this one that
  // carries nothing: neither may count.
  git(clone, 'checkout', '-b', 'someone-elses');
  git(clone, 'config', 'branch.someone-elses.clickup-task', '86bbOTHER');
  fs.writeFileSync(path.join(clone, 'theirs.txt'), 'x\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'their work');
  git(clone, 'checkout', 'main');
  git(clone, 'branch', 'empty-thread');
  git(clone, 'config', 'branch.empty-thread.clickup-task', TASK);

  const parsed = probe(clone);
  assert.equal(parsed.finished, true);
  assert.equal(parsed.branches.length, 1, 'the stamped branch is seen…');
  assert.equal(work.branchHasWork(parsed.branches[0]), false, '…but it carries no work');

  const verdict = work.findWorkInProgress({
    taskId: TASK, repoHome: clone, nodes: ['mac-mini'], hereId: 'mac-mini', shell: shellHere(clone),
  });
  assert.equal(verdict.verdict, 'none', 'a guard that never lets anything through is the mirror-image defect');
  fs.rmSync(root, { recursive: true, force: true });
});

test('criterion 3 — a machine with no checkout of the repo is an ANSWER, not a blind spot', () => {
  const missing = path.join(os.tmpdir(), 'stranded-nothing-here-at-all');
  const parsed = probe(missing);
  assert.equal(parsed.noRepo, true);
  assert.equal(parsed.finished, true);
  const v = work.machineVerdict({ machine: 'mac-mini', ran: true, out: `${work.PROBE_NO_REPO}\n${work.PROBE_DONE}\n` });
  assert.equal(v.seen, true, 'a machine that cannot be holding a worktree of a repo it does not have is not unseen');
  assert.equal(work.combineVerdicts([v]).verdict, 'none');
});

// ── criterion 4: a machine that could not be looked at ────────────────────

test('criterion 4 — an unreachable machine makes the verdict CANNOT TELL, never "nothing was built"', () => {
  const shell = (machine) => (machine === 'mac-mini'
    ? { ran: true, ok: true, out: `${work.PROBE_NO_REPO}\n${work.PROBE_DONE}\n` }
    : { ran: false, why: 'ssh "macbook-pro" did not answer — asleep, off this network, or key not set up' });
  // The repo must live UNDER the home directory here, or `repoPathOn` refuses
  // to derive a remote path and the machine is unseen for that reason instead
  // — which is a different bug's test, and this one would then pass without
  // ever exercising the unreachable-machine path. (Found by break-testing:
  // the first version of this test used /tmp and stayed green with the guard
  // removed.)
  const verdict = work.findWorkInProgress({
    taskId: TASK, repoHome: `${os.homedir()}/WebApps/starcaster`, nodes: ['mac-mini', 'macbook-pro'], hereId: 'mac-mini', shell,
  });
  assert.equal(verdict.verdict, 'cannot-tell');
  assert.equal(verdict.unseen.length, 1, 'only the machine that did not answer is a blind spot');
  assert.equal(verdict.unseen[0].machine, 'macbook-pro');
  assert.match(verdict.unseen[0].why, /did not answer/, 'the reason must be the ssh failure, not a path it could not derive');
  const line = work.preservedLine({ id: TASK, name: 'a ticket', verdict: verdict.verdict, unseen: verdict.unseen });
  assert.match(line, /CANNOT TELL/);
  assert.match(line, /macbook-pro/);
  assert.match(line, /npm run clickup -- status/, 'a ticket reported as unjudgeable needs the command to settle it');
});

test('criterion 4 — a probe that dies halfway is unseen, not empty', () => {
  const v = work.machineVerdict({ machine: 'mac-mini', ran: true, out: 'BRANCH\tx\t0\t0\t\n' }); // no PROBE-DONE
  assert.equal(v.seen, false);
  assert.match(v.why, /did not finish/);
  assert.equal(work.combineVerdicts([v]).verdict, 'cannot-tell');
});

test('criterion 4 — git refusing to answer about a checkout is unseen, not empty', () => {
  const v = work.machineVerdict({ machine: 'mac-mini', ran: true, out: `${work.PROBE_GIT_FAILED}\n${work.PROBE_DONE}\n` });
  assert.equal(v.seen, false);
  assert.equal(work.combineVerdicts([v]).verdict, 'cannot-tell');
});

test('a probe that THREW tells us nothing about that machine', () => {
  const verdict = work.findWorkInProgress({
    taskId: TASK,
    repoHome: '/tmp/whatever',
    nodes: ['mac-mini'],
    hereId: 'mac-mini',
    shell: () => { throw new Error('spawn ENOMEM'); },
  });
  assert.equal(verdict.verdict, 'cannot-tell');
  assert.match(verdict.unseen[0].why, /ENOMEM/);
});

// ── positive evidence outranks a blind spot ──────────────────────────────

test('work found on a machine we DID reach beats a machine we did not', () => {
  const shell = (machine) => (machine === 'macbook-pro'
    ? { ran: true, ok: true, out: `BRANCH\trelated-articles-module\t7\t0\t/Users/x/.claude/worktrees/related-articles-module\n${work.PROBE_DONE}\n` }
    : { ran: false, why: 'asleep' });
  const verdict = work.findWorkInProgress({
    taskId: TASK, repoHome: `${os.homedir()}/WebApps/starcaster`, nodes: ['mac-mini', 'macbook-pro'], hereId: 'mac-mini', shell,
  });
  assert.equal(verdict.verdict, 'work');
  assert.match(work.describeWork(verdict.work)[0], /7 uncommitted files/);
});

// ── where a repo lives on another machine ────────────────────────────────

test('a remote path is this one re-rooted at $HOME — never this machine\'s absolute path', () => {
  const home = os.homedir();
  const here = work.repoPathOn({ machine: 'mac-mini', hereId: 'mac-mini', repoHome: `${home}/WebApps/starcaster`, homedir: home });
  assert.equal(here.path, `${home}/WebApps/starcaster`);
  assert.equal(here.remote, false);
  const there = work.repoPathOn({ machine: 'macbook-pro', hereId: 'mac-mini', repoHome: `${home}/WebApps/starcaster`, homedir: home });
  assert.equal(there.path, '$HOME/WebApps/starcaster');
});

test('a checkout outside the home directory cannot be located on another machine, and says so', () => {
  const there = work.repoPathOn({ machine: 'macbook-pro', hereId: 'mac-mini', repoHome: '/opt/checkouts/starcaster', homedir: '/Users/x' });
  assert.equal(there.path, '');
  assert.match(there.why, /cannot be derived/);
  const verdict = work.findWorkInProgress({
    taskId: TASK, repoHome: '/opt/checkouts/starcaster', nodes: ['macbook-pro'], hereId: 'mac-mini', shell: () => { throw new Error('must not be asked'); },
  });
  assert.equal(verdict.verdict, 'cannot-tell');
});

// ── the probe script itself ──────────────────────────────────────────────

test('the probe never guesses: both a repo path and a task id are required', () => {
  assert.throws(() => work.probeScript({ repoPath: '', taskId: TASK }), /needs both/);
  assert.throws(() => work.probeScript({ repoPath: '/tmp/x', taskId: '' }), /needs both/);
});

test('a worktree path with a space survives the probe', () => {
  const { clone, root } = makeRepo();
  const wt = path.join(root, 'a folder with spaces');
  git(clone, 'config', 'user.email', 'test@example.com');
  git(clone, 'worktree', 'add', wt, '-b', 'spacey');
  git(clone, 'config', 'branch.spacey.clickup-task', TASK);
  fs.writeFileSync(path.join(wt, 'dirty.txt'), 'x\n');

  const parsed = probe(clone);
  assert.equal(parsed.branches.length, 1);
  assert.equal(parsed.branches[0].worktree, wt, 'the space must not split the field');
  assert.ok(parsed.branches[0].dirty > 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── the wiring: the sweep must actually ask ──────────────────────────────

test('the sweep asks for local work before returning a build to Queued', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'pipeline.mjs'), 'utf8');
  // The CALL SITE, not the definition. The first version of this test matched
  // `workInProgressFor(` anywhere in the file and stayed green when the call
  // inside the sweep was replaced with a hard-coded "nothing found" — the
  // function was still defined, just never asked. (Found by break-testing.)
  assert.match(code, /const local = reviewing \|\| plan\.status !== 'Queued'/,
    'the probe is asked only where the PR lookup asserts an ABSENCE');
  assert.match(code, /:\s*workInProgressFor\(queue\.tasks/,
    'the sweep must actually ask the probe, not assume an answer');
  assert.match(code, /local\.verdict !== 'none'/, "…and must act on anything that is not a clean 'none'");
  // One executor for the whole sweep: reachability is established at most once
  // per machine (remoteProbe rule 1), not once per stranded ticket.
  assert.match(code, /const probe = workProbe\(\);[\s\S]*for \(const s of stranded\)/,
    'the ssh probe must be created ONCE, outside the per-ticket loop');
});
