'use strict';

/**
 * `npm run map` — what it says about a branch with ZERO commits.
 *
 * The map used to describe a freshly prepared worktree as "already shipped,
 * safe to delete" whenever it was read from any folder other than that branch
 * — which is the normal case, because you set the folder up from the main
 * folder and then read the map from the main folder. The folder it was telling
 * the operator to throw away held a real `npm ci` and a full build.
 *
 * `npm run tidy` was never wrong here (it only removes worktrees whose state
 * is 'shipped'), so this is a wording defect — and a wording defect is exactly
 * the kind no other gate can see. Hence a test.
 *
 * It drives the REAL script inside a throwaway git repo rather than stubbing
 * the classification, because the thing worth protecting is the pairing of
 * `git cherry`'s answer with the English sentence; testing either half alone
 * would let them drift apart again. Lives under scripts/builder/ because that
 * is the only glob `npm run test:builder` runs (see mergeAssetPins.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..');

/**
 * A scratch repo carrying a copy of the two files the map is made of, so the
 * script's own `__dirname`-derived root points at the scratch repo and not at
 * Starcaster. Isolated from the machine's global git config and hooks.
 *
 * Returns the map's output, read from `main`.
 */
function mapOfAScratchRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-wording-')));

  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPTS, 'repo_map.cjs'), path.join(dir, 'scripts', 'repo_map.cjs'));
  fs.copyFileSync(
    path.join(SCRIPTS, 'lib', 'repo_state.cjs'),
    path.join(dir, 'scripts', 'lib', 'repo_state.cjs')
  );

  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(dir, 'nonexistent-gitconfig'),
    GIT_CONFIG_SYSTEM: path.join(dir, 'nonexistent-gitconfig'),
    GIT_AUTHOR_NAME: 'Map Test',
    GIT_AUTHOR_EMAIL: 'map@test.invalid',
    GIT_COMMITTER_NAME: 'Map Test',
    GIT_COMMITTER_EMAIL: 'map@test.invalid',
  };

  const git = (args, extraEnv = {}) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], {
      cwd: dir,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  // A fixed, advancing clock. Two commits with the same tree, parent, author,
  // message and second ARE the same commit — the branch and main would quietly
  // converge and the test would stop testing anything, on some runs only.
  let clock = 1700000000;
  const commit = (file, body, message) => {
    fs.writeFileSync(path.join(dir, file), body);
    git(['add', file]);
    const when = `${(clock += 60)} +0000`;
    git(['commit', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  };

  git(['init', '-b', 'main']);
  commit('README.md', 'start\n', 'first commit');

  // 1. A branch created seconds ago with nothing on it — `npm run thread`.
  git(['branch', 'fresh-thread']);

  // 2. A branch whose work is genuinely on main under a DIFFERENT commit id.
  //    That is what a squash-merge leaves behind: same patch, new message, new
  //    sha. `git cherry` marks it "-"; `git branch -d` still calls it unmerged,
  //    which is why patch equivalence is the only correct test here.
  git(['checkout', '-q', '-b', 'shipped-thread']);
  commit('feature.txt', 'the feature\n', 'add the feature');
  git(['checkout', '-q', 'main']);
  commit('feature.txt', 'the feature\n', 'Add the feature (#123)');

  // 3. Real unshipped work, so the third path is covered too.
  git(['checkout', '-q', '-b', 'live-work']);
  commit('wip.txt', 'in progress\n', 'work in progress');

  // Read the map from MAIN — the folder the operator actually reads it from,
  // and the case the old wording got wrong.
  git(['checkout', '-q', 'main']);

  try {
    return execFileSync('node', [path.join(dir, 'scripts', 'repo_map.cjs')], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MAP = mapOfAScratchRepo();

/** The one line of the report that talks about a given branch. */
function lineFor(name) {
  const line = MAP.split('\n').find((text) => text.trim().startsWith(`${name} —`));
  assert.ok(line, `the map said nothing about "${name}". Full output:\n${MAP}`);
  return line;
}

test('a zero-commit branch is never called shipped, read from another branch', () => {
  const line = lineFor('fresh-thread');
  assert.doesNotMatch(line, /shipped/i, 'a branch with no commits has shipped nothing');
  assert.doesNotMatch(line, /safe to delete/i, 'the folder holds an npm ci and a full build');
  assert.doesNotMatch(line, /already live/i, 'none of it is live');
  assert.match(line, /nothing committed yet/i, 'it should say what it actually is');
});

test('a squash-merged branch still reports as live and safe to delete', () => {
  const line = lineFor('shipped-thread');
  assert.match(line, /already live/i);
  assert.match(line, /safe to delete/i);
});

test('a branch with unshipped commits is reported as live work', () => {
  const line = lineFor('live-work');
  assert.match(line, /1 unshipped change/);
  assert.doesNotMatch(line, /safe to delete/i);
});
