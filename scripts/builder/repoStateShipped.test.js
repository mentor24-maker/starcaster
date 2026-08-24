'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { classifyBranch, branchContentIsInMain } = require('../lib/repo_state.cjs');

/**
 * Is a branch's work already on main? The question `tidy` and `map` both ask.
 *
 * 2026-08-22: the `ecosystem-svg` worktree survived FOUR `npm run tidy` runs
 * with its pull request already merged, and was never once named in the output.
 * `git cherry` compares patch-ids one to one, and squash-merging a branch of
 * N >= 2 commits produces ONE commit on main matching none of the N — so cherry
 * said "+" (unshipped) for every commit, permanently. A one-commit branch
 * squashes to a matching patch-id, which is exactly why nobody noticed: the
 * common case works.
 *
 * These tests build REAL git repositories and really squash-merge into them.
 * Mocking git's output here would only pin what this file believes git does,
 * and the belief is precisely what was wrong.
 */

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * A repo with four branches, each a case that matters:
 *   one        — 1 commit, squash-merged   (cherry gets this right)
 *   two        — 2 commits, squash-merged  (cherry gets this WRONG — the bug)
 *   unshipped  — 2 commits, never merged   (must stay active)
 *   untouched  — no commits                (a prepared workspace)
 */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repostate-'));
  const run = (args) => sh(dir, args);

  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  run(['add', '-A']);
  run(['commit', '-qm', 'base']);

  // one: a single commit
  run(['checkout', '-qb', 'one']);
  fs.writeFileSync(path.join(dir, 'one.txt'), 'one\n');
  run(['add', '-A']);
  run(['commit', '-qm', 'the only commit']);

  // two: TWO commits — the shape that breaks patch-id matching
  run(['checkout', '-q', 'main']);
  run(['checkout', '-qb', 'two']);
  fs.writeFileSync(path.join(dir, 'two.txt'), 'first\n');
  run(['add', '-A']);
  run(['commit', '-qm', 'first half']);
  fs.appendFileSync(path.join(dir, 'two.txt'), 'second\n');
  run(['commit', '-qam', 'second half']);

  // unshipped: real work that never landed
  run(['checkout', '-q', 'main']);
  run(['checkout', '-qb', 'unshipped']);
  fs.writeFileSync(path.join(dir, 'unshipped.txt'), 'wip\n');
  run(['add', '-A']);
  run(['commit', '-qm', 'work in progress']);
  fs.appendFileSync(path.join(dir, 'unshipped.txt'), 'more\n');
  run(['commit', '-qam', 'more work in progress']);

  // untouched: a branch with nothing on it
  run(['checkout', '-q', 'main']);
  run(['checkout', '-qb', 'untouched']);

  // Squash-merge `one` and `two` into main, exactly as GitHub's squash does.
  run(['checkout', '-q', 'main']);
  for (const branch of ['one', 'two']) {
    run(['merge', '--squash', branch]);
    run(['commit', '-qm', `${branch} squashed (#1)`]);
  }

  return dir;
}

const branch = (name, onGitHub = false) => ({ name, ref: name, onMac: true, onGitHub });
const ghSilent = () => null;              // GitHub unreachable
const ghMerged = () => JSON.stringify([{ number: 7 }]);
const ghNoPr = () => JSON.stringify([]);

let dir;
test.before(() => { dir = sandbox(); });
test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

const classify = (name, runGh = ghSilent) =>
  classifyBranch(branch(name), 'main', { runGh, cwd: dir });

test('the bug: git cherry alone calls a squash-merged 2-commit branch unshipped', () => {
  // Pinning the DEFECT, so nobody "simplifies" back to cherry-only without
  // this failing first. This is the raw signal, not the classifier.
  const cherry = sh(dir, ['cherry', 'main', 'two']).split('\n').filter(Boolean);
  assert.equal(cherry.length, 2);
  assert.ok(cherry.every((line) => line.startsWith('+')),
    'cherry reports both commits as unshipped even though main has the squash');

  // And it gets the one-commit case right, which is why this went unnoticed.
  assert.ok(sh(dir, ['cherry', 'main', 'one']).startsWith('-'));
});

test('a squash-merged branch is shipped, however many commits it had', async (t) => {
  await t.test('one commit — caught by cherry, as it always was', () => {
    const result = classify('one');
    assert.equal(result.state, 'shipped');
    assert.equal(result.signals.cherry, true);
  });

  await t.test('two commits — caught by the content check, with GitHub unreachable', () => {
    const result = classify('two');
    assert.equal(result.state, 'shipped', 'this is the branch that survived four tidy runs');
    assert.equal(result.signals.cherry, false, 'cherry still says no — it must not be the last word');
    assert.equal(result.signals.content, true);
  });

  await t.test('two commits — GitHub alone would also have caught it', () => {
    // Prove the primary signal independently: blind the content check by
    // asking about a branch main has NOT absorbed, and let GitHub answer.
    const result = classify('unshipped', ghMerged);
    assert.equal(result.state, 'shipped');
    assert.equal(result.signals.github, true);
  });
});

test('a branch with real unshipped work is still left alone', async (t) => {
  await t.test('every signal says active', () => {
    const result = classify('unshipped', ghNoPr);
    assert.equal(result.state, 'active');
    assert.equal(result.fresh.length, 2);
    assert.match(result.reason, /commits main does not have/);
  });

  await t.test('and with GitHub unreachable it is STILL active, not unknown', () => {
    // The content check answered, so the branch is confidently active. Only a
    // case where NOTHING could answer earns 'unknown'.
    const result = classify('unshipped', ghSilent);
    assert.equal(result.state, 'active');
    assert.equal(result.signals.content, false);
  });
});

test('a branch with no commits is a prepared workspace, never "shipped"', () => {
  const result = classify('untouched');
  assert.equal(result.state, 'empty');
});

test('when nothing can answer, the verdict is "unknown" — never a delete', () => {
  // A ref that does not exist: the content probe cannot run, and GitHub is
  // silent. "Could not confirm" must not read as "unshipped" (which would be
  // merely wrong) and must never read as "shipped" (which would delete work).
  const result = classifyBranch(
    { name: 'ghost', ref: 'refs/heads/does-not-exist', onMac: true, onGitHub: true },
    'main',
    { runGh: ghSilent, cwd: dir }
  );
  assert.notEqual(result.state, 'shipped', 'an unanswerable branch must never be deletable');
  if (result.state === 'unknown') {
    assert.match(result.reason, /could not confirm/i);
  }
});

test('GitHub returning nonsense is treated as "could not tell", not as "no PR"', () => {
  const result = classify('unshipped', () => 'not json at all');
  assert.equal(result.state, 'active', 'falls back to the local signals');
  assert.equal(result.signals.github, null, 'unparseable is null, never false');
});

test('branchContentIsInMain answers the narrow question on its own', () => {
  assert.equal(branchContentIsInMain(branch('two'), 'main', dir), true);
  assert.equal(branchContentIsInMain(branch('unshipped'), 'main', dir), false);
  assert.equal(
    branchContentIsInMain({ name: 'ghost', ref: 'refs/heads/does-not-exist' }, 'main', dir),
    null,
    'a probe that could not run returns null, not false'
  );
});

test('the content check compares only the paths the branch touched', () => {
  // main carries `one.txt`, which `two` never had. A whole-tree comparison
  // would therefore be non-empty and call every branch active — which is why
  // the check is scoped to the branch's own paths.
  const mainFiles = sh(dir, ['ls-tree', '--name-only', 'main']).split('\n').filter(Boolean);
  assert.ok(mainFiles.includes('one.txt'), 'main has work the branch never had');
  assert.ok(!sh(dir, ['ls-tree', '--name-only', 'two']).includes('one.txt'));
  assert.equal(branchContentIsInMain(branch('two'), 'main', dir), true);
});

test('no failure path can ever answer "shipped"', () => {
  // The asymmetry that matters. `false` (has unique content) merely leaves a
  // branch alone; `true` authorizes a DELETE. So every way this probe can fail
  // must land on null, never on true. An earlier draft used a whitespace string
  // as git's failure value, which `lines()` trimmed to nothing — read as "the
  // branch touched no files", reported as shipped. A failed probe would have
  // authorized deleting the branch it could not read.
  const cases = [
    [branch('two'), 'no-such-base', 'base ref does not exist'],
    [{ name: 'x', ref: 'refs/heads/no-such-ref' }, 'main', 'branch ref does not exist'],
    [{ name: 'y', ref: '' }, 'main', 'empty ref'],
  ];
  for (const [b, base, why] of cases) {
    const answer = branchContentIsInMain(b, base, dir);
    assert.notEqual(answer, true, `a probe that could not run must not report shipped (${why})`);
    assert.equal(answer, null, why);
  }
});
