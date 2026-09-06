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

// STRING-ONLY FIXTURE PATHS. The tests below that use these never touch the
// filesystem — they assert the shell text the probe BUILDS — so the path only
// has to be absolute and outside any real home. Writing a literal
// somebody's real home directory here would be a machine-specific path, which
// `check_conventions` blocks and NODES principle P1 forbids.
const FIXTURE_HOME = '/fixture-home';
const FIXTURE_REPO = `${FIXTURE_HOME}/WebApps/starcaster`;

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
  assert.equal(here.homeRelative, false);
  const there = work.repoPathOn({ machine: 'macbook-pro', hereId: 'mac-mini', repoHome: `${home}/WebApps/starcaster`, homedir: home });
  // RELATIVE, with the flag that says so. Round 1 returned the assembled
  // string '$HOME/WebApps/starcaster', which reads like a path and was quoted
  // like one, so `$HOME` never expanded on the far side.
  assert.equal(there.path, 'WebApps/starcaster');
  assert.equal(there.homeRelative, true);
  assert.equal(there.display, '$HOME/WebApps/starcaster');
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
//
// This used to be regexes over pipeline.mjs, because the sweep lived at module
// scope in a CLI script that ran its dispatcher on import. It moved into
// pipelineSweep.js on 2026-09-05 (task 86bbt204x) with its dependencies
// injected, so the wiring can now be EXECUTED instead of pattern-matched.
// Those tests live in pipelineSweep.test.js, beside the sweep itself.

// ── THE REMOTE PATH ──────────────────────────────────────────────────────
//
// Round 1 shipped with the whole remote half broken, and every test stayed
// green, because every fixture injected a `shell` that ran /bin/sh HERE — so
// the string a remote machine would actually receive was never executed by
// anything. These tests run it, with a foreign `HOME`, which is precisely the
// difference between the two seats.

/**
 * A repo laid out the way a checkout is on a real machine: under a home
 * directory, at the same relative path both machines use. `home` is handed to
 * the probe as HOME, which is exactly what a remote login shell would do.
 */
function makeRepoUnderHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stranded-home-')));
  const bare = path.join(home, 'origin.git');
  const clone = path.join(home, 'WebApps', 'starcaster');
  fs.mkdirSync(bare);
  git(bare, 'init', '--bare', '--initial-branch=main', '.');
  fs.mkdirSync(clone, { recursive: true });
  git(clone, 'init', '--initial-branch=main', '.');
  git(clone, 'config', 'user.email', 'test@example.com');
  git(clone, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(clone, 'README.md'), 'hello\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'first');
  git(clone, 'remote', 'add', 'origin', bare);
  git(clone, 'push', '-u', 'origin', 'main');
  return { home, clone, rel: 'WebApps/starcaster' };
}

/** Run a script the way a REMOTE login shell would: another machine's HOME. */
function runAsRemote(script, home) {
  return execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, HOME: home } });
}

test('the string a REMOTE machine receives finds the repo — $HOME must expand THERE', () => {
  const { home, clone, rel } = makeRepoUnderHome();
  const wt = path.join(home, 'wt-remote');
  git(clone, 'worktree', 'add', wt, '-b', 'remote-branch');
  git(clone, 'config', 'branch.remote-branch.clickup-task', TASK);
  fs.writeFileSync(path.join(wt, 'dirty.txt'), 'x\n');

  const where = work.repoPathOn({ machine: 'macbook-pro', hereId: 'mac-mini', repoHome: clone, homedir: home });
  const script = work.probeScript({ repoPath: where.path, taskId: TASK, homeRelative: where.homeRelative });
  const parsed = work.parseProbe(runAsRemote(script, home));

  // The exact failure of round 1: NO-REPO for a repo that is right there.
  assert.equal(parsed.noRepo, false, 'the remote probe must find the checkout, not report NO-REPO');
  assert.equal(parsed.branches.length, 1);
  assert.equal(parsed.branches[0].branch, 'remote-branch');
  assert.ok(parsed.branches[0].dirty > 0);
  assert.equal(rel, 'WebApps/starcaster');
  fs.rmSync(home, { recursive: true, force: true });
});

test('a NO-REPO from a remote machine is still a real answer when the repo really is absent', () => {
  const { home, clone } = makeRepoUnderHome();
  fs.rmSync(clone, { recursive: true, force: true });
  const where = work.repoPathOn({ machine: 'macbook-pro', hereId: 'mac-mini', repoHome: path.join(home, 'WebApps', 'starcaster'), homedir: home });
  const script = work.probeScript({ repoPath: where.path, taskId: TASK, homeRelative: where.homeRelative });
  const verdict = work.machineVerdict({ machine: 'macbook-pro', ran: true, out: runAsRemote(script, home) });
  assert.equal(verdict.seen, true, 'a genuinely absent checkout is an ANSWER — this is what keeps `none` reachable');
  assert.deepEqual(verdict.work, []);
  fs.rmSync(home, { recursive: true, force: true });
});

test('the two seats quote the path differently, and only the remote one leaves $HOME to the shell', () => {
  const local = work.probeScript({ repoPath: FIXTURE_REPO, taskId: TASK });
  assert.equal(local.split('\n')[0], `R='${FIXTURE_REPO}'`);
  const remote = work.probeScript({ repoPath: 'WebApps/starcaster', taskId: TASK, homeRelative: true });
  assert.match(remote.split('\n')[0], /^R="\$HOME"\/'WebApps\/starcaster'$/,
    '$HOME must be OUTSIDE the single quotes or the far shell cannot expand it');
});

test('findWorkInProgress hands a routed remote machine the home-relative script', () => {
  let seen = null;
  work.findWorkInProgress({
    taskId: TASK,
    repoHome: FIXTURE_REPO,
    homedir: FIXTURE_HOME,
    nodes: ['mac-mini'],
    hereId: 'macbook-pro',
    routedMachines: ['mac-mini'],
    routesKnown: true,
    shell: (machine, script) => { seen = script; return { ran: true, out: `${work.PROBE_DONE}\n` }; },
  });
  assert.ok(seen, 'the routed machine must actually be asked');
  assert.match(seen.split('\n')[0], /^R="\$HOME"\/'WebApps\/starcaster'$/);
});

// ── NO SSH ROUTE IS NOT A FAILED READING ─────────────────────────────────

test('criterion 3, IN THE SHIPPED CONFIGURATION — the real node list and the real inventory answer "none" with no seat left unlooked', () => {
  // THE TEST ROUND 1 DID NOT HAVE, and the reason it shipped broken. Its
  // criterion-3 test was handed a one-machine node list; the shipped sweep
  // walks nodeRoles.KNOWN_NODES, which contains a machine with no ssh route
  // from the Mini — so in production every stranded build answered
  // `cannot-tell` and none could ever be unstuck. This test uses the real
  // list and the real inventory so that gap cannot reopen.
  //
  // Since 86bbvhzqv every node in KNOWN_NODES carries a declared ssh route,
  // so the caveat the sweep used to append forever is gone. That is asserted
  // here rather than against the sweep's wording: dropping `probe: ssh` from
  // any machine in docs/ecosystem/inventory.yaml puts the caveat straight
  // back, and this is the line that says so.
  const { clone, root } = makeRepo();          // nothing stamped here
  const nodeRoles = require('../../lib/nodeRoles.js');
  const routes = work.sshRoutedMachines(
    fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'ecosystem', 'inventory.yaml'), 'utf8'));
  assert.equal(routes.known, true, 'the committed inventory must be readable');

  const verdict = work.findWorkInProgress({
    taskId: TASK,
    repoHome: clone,
    homedir: path.dirname(clone),
    nodes: nodeRoles.KNOWN_NODES,
    hereId: 'mac-mini',
    routedMachines: routes.machines,
    routesKnown: true,
    shell: shellHere(clone),
  });
  assert.equal(verdict.verdict, 'none', 'the sweep must still be able to move a genuinely unbuilt ticket');
  assert.deepEqual(verdict.unlooked.map((m) => m.machine), [],
    '…and with every node routed, no seat is left unlooked and no caveat is appended');
  for (const node of nodeRoles.KNOWN_NODES) {
    assert.ok(routes.machines.includes(node),
      `${node} is a known node with no ssh route declared in docs/ecosystem/inventory.yaml`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('a machine with no ssh route is never ssh\'d at all', () => {
  const asked = [];
  work.findWorkInProgress({
    taskId: TASK,
    repoHome: FIXTURE_REPO,
    homedir: FIXTURE_HOME,
    nodes: ['mac-mini', 'macbook-pro'],
    hereId: 'mac-mini',
    routedMachines: ['mac-mini'],
    routesKnown: true,
    shell: (machine) => { asked.push(machine); return { ran: true, out: `${work.PROBE_DONE}\n` }; },
  });
  assert.deepEqual(asked, ['mac-mini'], 'only this machine — the unrouted one must not cost an ssh timeout');
});

test('a ROUTED machine that does not answer is still CANNOT TELL — criterion 4 survives the containment', () => {
  const verdict = work.findWorkInProgress({
    taskId: TASK,
    repoHome: FIXTURE_REPO,
    homedir: FIXTURE_HOME,
    nodes: ['macbook-pro', 'mac-mini'],
    hereId: 'macbook-pro',
    routedMachines: ['mac-mini'],
    routesKnown: true,
    shell: (machine) => (machine === 'mac-mini'
      ? { ran: false, why: 'ssh "mac-mini" did not answer — asleep, off this network, or key not set up; not treated as drift' }
      : { ran: true, out: `${work.PROBE_DONE}\n` }),
  });
  assert.equal(verdict.verdict, 'cannot-tell');
  assert.equal(verdict.unseen[0].machine, 'mac-mini');
  assert.deepEqual(verdict.unlooked, [], 'a machine that HAS a route and went quiet is a failed reading, not a missing route');
});

test('an unreadable inventory means every machine is TRIED, never that none is', () => {
  const asked = [];
  const verdict = work.findWorkInProgress({
    taskId: TASK,
    repoHome: FIXTURE_REPO,
    homedir: FIXTURE_HOME,
    nodes: ['mac-mini', 'macbook-pro'],
    hereId: 'mac-mini',
    routedMachines: [],
    routesKnown: false,
    shell: (machine) => {
      asked.push(machine);
      return machine === 'mac-mini' ? { ran: true, out: `${work.PROBE_DONE}\n` } : { ran: false, why: 'no answer' };
    },
  });
  assert.deepEqual(asked, ['mac-mini', 'macbook-pro']);
  assert.equal(verdict.verdict, 'cannot-tell', 'failing towards not moving things');
});

test('the route reader takes only machines the inventory gives an ssh probe', () => {
  const yaml = [
    'objects:',
    '  - id: a', '    kind: machine', '    probe: ssh',
    '  - id: b', '    kind: machine', '    probe: hostname',
    '  - id: c', '    kind: repo', '    probe: ssh',
  ].join('\n');
  assert.deepEqual(work.sshRoutedMachines(yaml), { known: true, machines: ['a'] });
  assert.equal(work.sshRoutedMachines(':\n  - [').known, false);
  assert.equal(work.sshRoutedMachines('').known, false);
});

// ── patch equivalence, not commit count ──────────────────────────────────

test('a squash-merged branch is NOT work — `git cherry`, not `rev-list --count`', () => {
  const { clone, root } = makeRepo();
  git(clone, 'checkout', '-b', 'feature');
  fs.writeFileSync(path.join(clone, 'feature.txt'), 'the change\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'the feature');
  git(clone, 'config', 'branch.feature.clickup-task', TASK);
  // Squash-merge it, exactly as GitHub does, and push that to origin/main.
  git(clone, 'checkout', 'main');
  git(clone, 'merge', '--squash', 'feature');
  git(clone, 'commit', '-m', 'the feature (#999)');
  git(clone, 'push', 'origin', 'main');
  git(clone, 'checkout', 'feature');

  const parsed = probe(clone);
  assert.equal(parsed.branches.length, 1, 'the stamped branch is still found');
  assert.equal(parsed.branches[0].ahead, 0,
    'its patch is already on main — counting commits would pin this ticket in "Building" forever');
  assert.equal(work.branchHasWork(parsed.branches[0]), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a branch whose commits are genuinely NOT on main is still work', () => {
  const { clone, root } = makeRepo();
  git(clone, 'checkout', '-b', 'unshipped');
  fs.writeFileSync(path.join(clone, 'new.txt'), 'never merged\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'unshipped work');
  git(clone, 'config', 'branch.unshipped.clickup-task', TASK);

  const parsed = probe(clone);
  assert.equal(parsed.branches[0].ahead, 1);
  assert.equal(work.branchHasWork(parsed.branches[0]), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a ticket left alone names EVERY seat that was not looked at, both kinds', () => {
  const line = work.preservedLine({
    id: '86bbAAA', name: 'a ticket', verdict: 'cannot-tell',
    unseen: [{ machine: 'mac-mini', why: 'ssh "mac-mini" did not answer' }],
    unlooked: [{ machine: 'macbook-pro', why: 'no ssh route to it is declared' }],
  });
  assert.match(line, /mac-mini/);
  assert.match(line, /macbook-pro/, 'a routeless seat does not force the verdict, but it was still not looked at');
});
