'use strict';

/**
 * A REAL CONFLICT MUST NOT QUEUE FOR THE MERGE WINDOW (2026-10-07, task
 * 86bcemvj5).
 *
 * That morning Dane said "merge" on #771, #779 and #780. All three conflicted
 * with main for real — `git merge-tree` said so on the relay's own passes — and
 * none of them merged or said why for two to three hours. The conflict path
 * asked git, got a confirmed conflict, and then waited for the merge window so
 * it could attempt a local catch-up that could only fail. The window was busy
 * the whole time (#776, #773, #779, #780 in turn), so the hand-off that files
 * the fix as a Loop Queue ticket was never reached.
 *
 * The rule now: a conflict git has CONFIRMED goes straight to the hand-off —
 * no window, no catch-up, no arming — and an armed one is disarmed. A conflict
 * only GitHub reports still gets the local attempt, and a fake one (GitHub
 * says conflicting, git merges cleanly) still catches up and merges as before.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  githubGate,
  conflictRoute,
  autoMergeDecision,
  mergeTreeConflictFiles,
} = require('./mergeOnComment.js');
const mergeWindowLease = require('./mergeWindowLease.js');

const REPO = 'mentor24-maker/starcaster';
const CONFLICTING_PR = {
  state: 'OPEN',
  isDraft: false,
  mergeable: 'CONFLICTING',
  mergeStateStatus: 'DIRTY',
  statusCheckRollup: [{ name: 'verify', conclusion: 'SUCCESS' }],
};
const REAL = { known: true, conflicts: true, base: 'origin/main', head: 'abc12345', files: ['lib/site-import/map.ts'] };
const FAKE = { known: true, conflicts: false, base: 'origin/main', head: 'abc12345' };

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8');

test('a git-confirmed conflict goes straight to the hand-off, naming the files', () => {
  const gate = githubGate(CONFLICTING_PR, { gitCrossCheck: REAL });
  assert.equal(gate.action, 'conflict');
  assert.equal(gate.gitConfirmed, true);
  assert.equal(conflictRoute(gate), 'hand-off',
    'git already answered — queuing for the window to ask again is the 2026-10-07 stall');
  assert.match(gate.reason, /lib\/site-import\/map\.ts/, 'the reason names the conflicting file');
});

test('a confirmed conflict never arms auto-merge', () => {
  const gate = githubGate(CONFLICTING_PR, { gitCrossCheck: REAL });
  const auto = autoMergeDecision({ gate, autoMergeRequest: null, reviewGateState: 'fresh' });
  assert.equal(auto.action, 'none');
});

test('a conflict nothing confirmed still gets the local catch-up attempt', () => {
  const unchecked = githubGate(CONFLICTING_PR);
  assert.equal(conflictRoute(unchecked), 'catch-up');
  const couldNotAsk = githubGate(CONFLICTING_PR, { gitCrossCheck: { known: false, why: 'fetch failed' } });
  assert.equal(conflictRoute(couldNotAsk), 'catch-up');
  // A gate rebuilt by the BEHIND path when `update-branch` failed carries no
  // git reading either — it must still try, not hand off on GitHub's word.
  assert.equal(conflictRoute({ action: 'conflict', cannotTell: false, reason: 'the branch could not be caught up' }), 'catch-up');
});

test('a FAKE conflict (git merges cleanly) still catches up, exactly as before', () => {
  const gate = githubGate(CONFLICTING_PR, { gitCrossCheck: FAKE });
  assert.equal(gate.action, 'catch-up-locally');
  assert.equal(conflictRoute(gate), 'not-a-conflict');
  assert.notEqual(gate.gitConfirmed, true);
});

test('a window HOLDER that turns out to conflict gives the window to the next PR', () => {
  // #779 armed and took the window; main then moved under it. The hand-off
  // releases its hold, and the PR behind it may take the window that same pass.
  const now = '2026-10-07T17:34:00.000Z';
  const held = { ok: true, file: 'x', lease: mergeWindowLease.takeWindow({ read: { ok: true, lease: { windows: {} } }, repo: REPO, pr: 779, task: 't', branch: 'b', headSha: 'abc', now }) };
  assert.equal(mergeWindowLease.windowDecision({ read: held, repo: REPO, pr: 780, now }).action, 'blocked');
  const rel = mergeWindowLease.releaseWindow({ read: held, repo: REPO, pr: 779 });
  assert.equal(rel.changed, true);
  const after = { ok: true, file: 'x', lease: rel.lease };
  assert.equal(mergeWindowLease.windowDecision({ read: after, repo: REPO, pr: 780, now }).action, 'take');
});

// ── The wiring in clickup_direct.mjs ────────────────────────────────────────
// runMergeStep is IO end to end, so its ORDER is asserted on the source, the
// way branchCatchUp.test.js and conflictWork.test.js already do.

const catchUpGuard = "if (gate.action === 'conflict' && !dryRun && mergeOnComment.conflictRoute(gate) === 'catch-up') {";

test('the window-taking catch-up attempt is guarded by conflictRoute', () => {
  const at = SCRIPT.indexOf(catchUpGuard);
  assert.ok(at > 0, 'the conflict catch-up must only run on the catch-up route');
  const windowAt = SCRIPT.indexOf("claimMergeWindow('catch-up-locally')", at);
  const localAt = SCRIPT.indexOf('const local = branchCatchUp.catchUpBranchLocally(', at);
  const handOffAt = SCRIPT.indexOf("if (gate.action === 'conflict') {", at);
  assert.ok(windowAt > at && windowAt < handOffAt, 'the window is claimed inside the guarded block, not before it');
  assert.ok(localAt > at && localAt < handOffAt);
});

test('the hand-off releases the window and disarms an armed auto-merge before anything else', () => {
  const handOffAt = SCRIPT.indexOf("if (gate.action === 'conflict') {", SCRIPT.indexOf(catchUpGuard));
  const block = SCRIPT.slice(handOffAt, SCRIPT.indexOf('const localVerdict = verdictFromCatchUp(', handOffAt));
  assert.match(block, /releaseMergeWindow\('it was handed off as a conflict'\)/);
  assert.match(block, /if \(prJson\.autoMergeRequest && !dryRun\)/);
  assert.match(block, /'--disable-auto'/);
  assert.ok(block.indexOf('releaseMergeWindow(') < block.indexOf("'--disable-auto'"));
});

test('the cross-check reads the files and a freshly fetched main', () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf('function gitConflictCrossCheck('), SCRIPT.indexOf('function reportBusFailure('));
  assert.match(fn, /'--name-only'/);
  assert.match(fn, /files: mergeOnComment\.mergeTreeConflictFiles\(out\.stdout\)/);
  assert.ok(fn.indexOf('fetchedBase') < fn.indexOf("'merge-tree'"), 'main is fetched before it is merged against');
});

test('mergeTreeConflictFiles reads the path list and stops at the messages', () => {
  const out = 'deadbeef\nlib/supabase.js\nlib/supabase.js\nlib/site-import/map.ts\n\nAuto-merging lib/supabase.js\nCONFLICT (content): Merge conflict in lib/supabase.js\n';
  assert.deepEqual(mergeTreeConflictFiles(out), ['lib/supabase.js', 'lib/site-import/map.ts']);
  assert.deepEqual(mergeTreeConflictFiles('deadbeef\n'), []);
  assert.deepEqual(mergeTreeConflictFiles(''), []);
});

test('mergeTreeConflictFiles against REAL git output', (t) => {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status !== 0) { t.skip('SKIPPED OUT LOUD: git is not available here'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-real-conflict-'));
  const run = (...args) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  try {
    run('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
    fs.writeFileSync(path.join(dir, 'g.txt'), 'x\n');
    run('add', '.'); run('commit', '-qm', 'base');
    run('checkout', '-qb', 'side');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'b\n');
    run('commit', '-qam', 'side');
    run('checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'c\n');
    run('commit', '-qam', 'main');
    const out = run('merge-tree', '--write-tree', '--name-only', 'main', 'side');
    assert.equal(out.status, 1, 'git calls it a conflict');
    assert.deepEqual(mergeTreeConflictFiles(out.stdout), ['f.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
