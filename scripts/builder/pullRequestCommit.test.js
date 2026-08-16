'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { pickPullRequestCommit, REPIN_SUBJECT } = require('./pullRequestCommit');

/**
 * Naming the pull request after the WORK, against a real repository.
 *
 * `ship` squash-merges, so whatever title it picks is the one that lands in
 * `main` permanently. It used to take `git log -1`, which by that point is
 * usually a commit `ship` itself wrote — the asset-pin re-stamp, or the merge
 * from catching up with main. On 2026-08-15 three of four merges went into
 * main titled "Re-pin asset hashes from a clean build" while carrying real
 * features, and `git log` stopped being able to answer "when did that ship?".
 *
 * A real repo rather than a source grep: this needs nothing but `git log`, so
 * there is no excuse for asserting on the shape of the code instead of on what
 * it does. (Its neighbour, the never-force-push property, does need a remote
 * and CI, which is why THAT one is a source assertion.)
 */

function repo(build) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-title-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  let n = 0;
  const commit = (subject, body = '') => {
    // Its own file each time: two branches touching one file makes the
    // catch-up merge below conflict, which is a fact about the fixture and
    // nothing to do with what is being tested.
    n += 1;
    fs.writeFileSync(path.join(dir, `f${n}.txt`), subject);
    run('add', '-A');
    run('commit', '-m', subject, ...(body ? ['-m', body] : []));
  };

  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 't@example.com');
  run('config', 'user.name', 'T');
  commit('base commit');
  // Stand in for origin/main: the real script always has it fetched.
  run('branch', 'origin/main');
  run('checkout', '-q', '-b', 'topic');

  build({ commit, run });

  const git = (argv, { allowFail = false } = {}) => {
    try {
      return execFileSync('git', argv, { cwd: dir, encoding: 'utf8' }).trim();
    } catch (err) {
      if (allowFail) return '';
      throw err;
    }
  };
  return { git, run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('skips the re-pin commit ship wrote and names the PR after the work', () => {
  const { git, cleanup } = repo(({ commit }) => {
    commit('Builder: Pages CRUD gets a Slug search', 'The filter row had an empty cell over Slug.');
    commit(REPIN_SUBJECT);
  });
  try {
    const picked = pickPullRequestCommit(git, { base: 'origin/main' });
    assert.equal(picked.subject, 'Builder: Pages CRUD gets a Slug search');
    assert.match(picked.body, /empty cell over Slug/);
  } finally {
    cleanup();
  }
});

test('skips the merge commit from catching up with main', () => {
  const { git, cleanup } = repo(({ commit, run }) => {
    commit('Themes: a page follows its theme');
    // main moves on, and ship merges it in — never rebases.
    run('checkout', '-q', 'origin/main');
    commit('someone else shipped');
    run('checkout', '-q', 'topic');
    run('merge', 'origin/main', '--no-edit');
  });
  try {
    assert.equal(
      pickPullRequestCommit(git, { base: 'origin/main' }).subject,
      'Themes: a page follows its theme'
    );
  } finally {
    cleanup();
  }
});

test('takes the newest authored commit when the branch has several', () => {
  const { git, cleanup } = repo(({ commit }) => {
    commit('first pass');
    commit('second pass');
    commit(REPIN_SUBJECT);
  });
  try {
    assert.equal(pickPullRequestCommit(git, { base: 'origin/main' }).subject, 'second pass');
  } finally {
    cleanup();
  }
});

test('falls back to HEAD rather than open a PR with an empty title', () => {
  // A branch carrying nothing but housekeeping should not be possible, but an
  // empty --title makes `gh pr create` fail outright, so it degrades instead.
  const { git, cleanup } = repo(({ commit }) => {
    commit(REPIN_SUBJECT);
  });
  try {
    assert.equal(pickPullRequestCommit(git, { base: 'origin/main' }).subject, REPIN_SUBJECT);
  } finally {
    cleanup();
  }
});

test('ship asks the picker for the title and writes the re-pin under the shared subject', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ship_thread.cjs'), 'utf8');
  assert.match(source, /pickPullRequestCommit\(git\)/, 'ship must use the picker');
  assert.doesNotMatch(
    source,
    /--title',\s*git\(\['log', '-1'/,
    'the title must not come straight from the newest commit again'
  );
  assert.match(source, /'-m', REPIN_SUBJECT/, 'the re-pin commit must use the shared subject the picker filters on');
});
