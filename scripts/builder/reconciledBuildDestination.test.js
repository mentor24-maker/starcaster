'use strict';

/**
 * `pass-reconcile` MUST LOOK BEFORE IT SAYS NOTHING WAS BUILT (task 86bbvj44f).
 *
 * `npm run repair` runs `pass-reconcile --scheduled` first and the stranded
 * sweep third, so on the machine that owns the loops a dead loop-build pass
 * had its ticket moved to `Queued` — with the words "nothing has been built
 * for it that a new branch would duplicate" — before the sweep's own guard
 * ever looked at a disk. #624 fixed the path a person types by hand and left
 * the path that fires on a timer.
 *
 * These tests drive the WHOLE decision chain the reconcile now takes:
 *
 *   a REAL git repo with a stamped branch
 *     -> the real probe, through /bin/sh
 *       -> strandedLocalWork.findWorkInProgress   (the shared reading)
 *         -> pipelinePause.reconciledBuildDestination  (where it goes)
 *           -> pipelinePause.sweptTicketNote            (what the ticket says)
 *
 * Only the two ClickUp HTTP calls are left out, because they are the only part
 * `clickup_direct.mjs` adds. Asserting the chain against a fixture of the
 * probe's own output would be a test of the fixture — the same reasoning
 * `strandedLocalWork.test.js` states, and the same real-repo helpers.
 *
 * All four acceptance criteria are named in the test titles, including the
 * SECOND — a guard that never lets anything through is the mirror-image defect
 * and this repo has shipped it before, which is why "nothing anywhere" still
 * has to reach `Queued` untouched.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const work = require('./strandedLocalWork.js');
const { reconciledBuildDestination, strandedBuildDestination, sweptTicketNote } = require('./pipelinePause.js');

const TASK = '86bbvj44f';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A clone with a real `origin/main` behind it, so "unpushed" means it. */
function makeRepo() {
  // realpath, because on macOS /var is a symlink to /private/var and git
  // reports the resolved path.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-')));
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
  return { root, clone };
}

function shellHere() {
  return (machine, script) => ({
    ran: true,
    ok: true,
    out: execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' }),
    where: 'this machine',
  });
}

/** Exactly the shape `clickup_direct.mjs` hands `reconciledBuildDestination`. */
function planFor(local, buildStartAction = 'fresh') {
  return reconciledBuildDestination(buildStartAction, {
    verdict: local.verdict,
    work: local.work,
    unlookedSeats: work.describeUnlooked(local.unlooked),
    blindSpots: work.describeUnlooked([...(local.unseen || []), ...(local.unlooked || [])]),
  }, { describeWork: work.describeWork });
}

// ── criterion 1: work on disk → Rework, naming machine, worktree and branch ──

test('criterion 1 — a stamped branch with uncommitted changes sends the ticket to Rework, and the note names machine, worktree and branch', () => {
  const { clone, root } = makeRepo();
  git(clone, 'checkout', '-b', 'half-built-thing');
  git(clone, 'config', 'branch.half-built-thing.clickup-task', TASK);
  fs.writeFileSync(path.join(clone, 'unfinished.tsx'), 'export const x = 1;\n');

  const local = work.findWorkInProgress({
    taskId: TASK, repoHome: clone, nodes: ['mac-mini'], hereId: 'mac-mini', shell: shellHere(),
  });
  assert.equal(local.verdict, 'work');

  const plan = planFor(local);
  assert.equal(plan.status, 'Rework', 'half-built work goes to Rework, never Queued');
  assert.doesNotMatch(plan.why, /nothing has been built/,
    'the false sentence this ticket exists to remove must not survive on this path');

  const note = sweptTicketNote({
    at: '2026-09-06T12:00:00.000Z', by: 'an agent session on mac-mini', kind: 'a build',
    destination: plan.status, why: plan.why, command: 'npm run clickup -- pass-reconcile --scheduled',
  });
  assert.match(note, /Returned to Rework/);
  assert.match(note, /mac-mini/, 'the machine to walk to');
  assert.ok(note.includes(clone), 'the worktree to walk to');
  assert.match(note, /half-built-thing/, 'the branch to check out');
  fs.rmSync(root, { recursive: true, force: true });
});

test('criterion 1 — unpushed commits with a clean tree count too, and still reach Rework', () => {
  const { clone, root } = makeRepo();
  git(clone, 'checkout', '-b', 'committed-not-pushed');
  git(clone, 'config', 'branch.committed-not-pushed.clickup-task', TASK);
  fs.writeFileSync(path.join(clone, 'module.js'), 'module.exports = 1;\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'two thirds of the work');

  const local = work.findWorkInProgress({
    taskId: TASK, repoHome: clone, nodes: ['mac-mini'], hereId: 'mac-mini', shell: shellHere(),
  });
  assert.equal(local.verdict, 'work');
  const plan = planFor(local);
  assert.equal(plan.status, 'Rework');
  assert.match(plan.why, /committed-not-pushed/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── criterion 2: genuinely nothing → Queued, exactly as before ───────────────
//
// THE MIRROR-IMAGE DEFECT. A guard that never lets anything through is as
// broken as no guard at all, and it is the failure mode nobody notices,
// because the board simply stops moving.

test('criterion 2 — a real repo with nothing stamped still sends the ticket to Queued, word for word as before', () => {
  const { clone, root } = makeRepo();

  const local = work.findWorkInProgress({
    taskId: TASK, repoHome: clone, nodes: ['mac-mini'], hereId: 'mac-mini', shell: shellHere(),
  });
  assert.equal(local.verdict, 'none', 'nothing stamped anywhere is a real answer, not a blind spot');

  const plan = planFor(local);
  const before = strandedBuildDestination('fresh');
  assert.deepEqual(plan, before, 'the untouched path must be byte-identical to what it was');
  assert.equal(plan.status, 'Queued');
  fs.rmSync(root, { recursive: true, force: true });
});

test('criterion 2 — a branch stamped with ANOTHER ticket is not this ticket\'s work', () => {
  const { clone, root } = makeRepo();
  git(clone, 'checkout', '-b', 'someone-elses');
  git(clone, 'config', 'branch.someone-elses.clickup-task', '86bbOTHER');
  fs.writeFileSync(path.join(clone, 'theirs.txt'), 'not ours\n');

  const local = work.findWorkInProgress({
    taskId: TASK, repoHome: clone, nodes: ['mac-mini'], hereId: 'mac-mini', shell: shellHere(),
  });
  assert.equal(local.verdict, 'none');
  assert.equal(planFor(local).status, 'Queued');
  fs.rmSync(root, { recursive: true, force: true });
});

test('an OPEN pull request still sends it to Rework without any disk reading at all', () => {
  // `continue` and `unknown` assert no absence, so the reconcile never takes a
  // reading for them — and their destinations must not have shifted.
  assert.equal(reconciledBuildDestination('continue', { verdict: 'none' }).status, 'Rework');
  assert.equal(reconciledBuildDestination('unknown', { verdict: 'none' }).status, 'Rework');
});

// ── criterion 3: the unlooked-seat caveat survives onto the Queued note ──────

test('criterion 3 — a seat that could not be looked at is named inside the Queued note, not dropped', () => {
  const local = {
    verdict: 'none',
    work: [],
    unseen: [],
    unlooked: [{ machine: 'macbook-pro', why: 'no ssh route to it is declared in docs/ecosystem/inventory.yaml' }],
  };
  const plan = planFor(local);
  assert.equal(plan.status, 'Queued', 'a routeless machine must not stop the move — that is criterion 2');
  assert.match(plan.why, /macbook-pro/, 'but it must be named');
  assert.doesNotMatch(plan.why, /^nothing has been built for it that a new branch would duplicate$/,
    'the flat absence claim must be qualified when a seat went unlooked-at');

  const note = sweptTicketNote({
    at: '2026-09-06T12:00:00.000Z', by: 'an agent session on mac-mini', kind: 'a build',
    destination: plan.status, why: plan.why, command: 'npm run clickup -- pass-reconcile --scheduled',
  });
  assert.match(note, /macbook-pro/, 'the caveat has to reach the ticket, where the next builder reads it');
});

test('cannot-tell goes to Rework — never Queued, and never held in Building', () => {
  // The non-goal of this ticket: `pass-reconcile` exists to stop a ticket
  // being invisible in "Building", so the sweep's answer (leave it there) is
  // not available here. Rework is claimable and asserts nothing.
  const local = {
    verdict: 'cannot-tell',
    work: [],
    unseen: [{ machine: 'mac-mini', why: 'its probe did not finish, so its answer is not trustworthy' }],
    unlooked: [],
  };
  const plan = planFor(local);
  assert.equal(plan.status, 'Rework');
  assert.notEqual(plan.status, 'Building');
  assert.match(plan.why, /could NOT be checked/);
  assert.match(plan.why, /mac-mini/, 'which machine went unread');
  assert.doesNotMatch(plan.why, /nothing has been built/);
});

// ── criterion 4: ONE definition of "was anything built" ──────────────────────

test('criterion 4 — the reading comes from strandedLocalWork, and the sweep and the reconcile share the wiring', () => {
  const wiring = require('./localWorkReading.js');
  assert.equal(typeof wiring.workProbe, 'function');
  assert.equal(typeof wiring.workInProgressFor, 'function');

  // Both callers reach the disk through this ONE module. A second copy of the
  // ssh-and-inventory wiring is how two answers to one question start to
  // drift, which is the reason `strandedBuildDestination` is shared at all.
  const pipelineSrc = fs.readFileSync(path.join(__dirname, '..', 'pipeline.mjs'), 'utf8');
  const reconcileSrc = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8');
  for (const [name, src] of [['pipeline.mjs', pipelineSrc], ['clickup_direct.mjs', reconcileSrc]]) {
    assert.match(src, /localWorkReading/, `${name} must take its reading from the shared module`);
    assert.doesNotMatch(src, /function workProbe\s*\(/, `${name} must not carry a second copy of the wiring`);
    assert.doesNotMatch(src, /function workInProgressFor\s*\(/, `${name} must not carry a second copy of the wiring`);
  }

  // And the reconcile must actually ASK before it asserts an absence.
  const block = reconcileSrc.slice(
    reconcileSrc.indexOf("} else if (cmd === 'pass-reconcile') {"),
    reconcileSrc.indexOf("} else if (cmd === 'wip-check')"),
  );
  assert.ok(block.length > 0, 'the pass-reconcile block must still be findable');
  assert.match(block, /localWorkReading\.workInProgressFor/, 'it has to take the reading');
  assert.match(block, /reconciledBuildDestination/, 'and decide from it');
});
