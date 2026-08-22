'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const {
  resolveTaskRepo,
  repoHome,
  KNOWN_REPOS,
  DEFAULT_REPO,
} = require('./taskRepo.js');

/**
 * Charter "a task declares its repo" — the rule the build/review loops read to
 * decide which checkout to work in. The whole point is that the four outcomes
 * are decided ONCE here, not re-derived (differently) by each loop skill.
 */

test('no repo tag defaults to starcaster — today\'s behaviour is the default, so nothing in the queue changes', () => {
  for (const tags of [[], undefined, [{ name: 'loop-engineering' }], ['test-coverage']]) {
    const r = resolveTaskRepo(tags);
    assert.equal(r.repo, 'starcaster');
    assert.equal(r.action, 'build');
    assert.equal(r.known, true);
  }
  assert.equal(DEFAULT_REPO, 'starcaster');
});

test('a known repo tag resolves to that repo (tag objects OR plain strings)', () => {
  assert.deepEqual(
    resolveTaskRepo([{ name: 'repo:vault' }]),
    { repo: 'vault', known: true, action: 'build', reason: 'tagged repo:vault' }
  );
  assert.equal(resolveTaskRepo(['repo:normie']).repo, 'normie');
  assert.equal(resolveTaskRepo(['repo:pulse']).action, 'build');
  // Case-insensitive on the tag and the repo name.
  assert.equal(resolveTaskRepo(['Repo:VAULT']).repo, 'vault');
});

test('an UNKNOWN repo escalates, never guesses (would run wrong gates in wrong checkout)', () => {
  const r = resolveTaskRepo(['repo:nonsense']);
  assert.equal(r.action, 'escalate');
  assert.equal(r.known, false);
  assert.equal(r.repo, 'nonsense');
  assert.match(r.reason, /unknown repo "nonsense"/);
  assert.match(r.reason, /starcaster, normie, pulse, vault/);
});

test('TWO different repo tags escalate — "both" is not a repo', () => {
  const r = resolveTaskRepo([{ name: 'repo:vault' }, { name: 'repo:normie' }]);
  assert.equal(r.action, 'escalate');
  assert.equal(r.repo, null);
  assert.match(r.reason, /more than one repo tag/);
});

test('the same repo tagged twice is not ambiguous — it is that repo', () => {
  const r = resolveTaskRepo(['repo:vault', { name: 'repo:vault' }]);
  assert.equal(r.action, 'build');
  assert.equal(r.repo, 'vault');
});

test('repo homes resolve to the MAIN checkout and its siblings, not the worktree this runs in', () => {
  const starcaster = repoHome('starcaster');
  // The main checkout, even though this test runs from inside a linked
  // worktree — that was the bug the first version of this test caught.
  assert.equal(path.basename(starcaster), 'starcaster');
  assert.doesNotMatch(starcaster, /\.claude\/worktrees/, 'must be the main checkout, never the worktree');
  const siblings = path.dirname(starcaster);
  assert.equal(repoHome('normie'), path.join(siblings, 'normie'));
  assert.equal(repoHome('pulse'), path.join(siblings, 'pulse'));
  assert.equal(repoHome('vault'), path.join(os.homedir(), 'vault'));
  assert.equal(repoHome('nonsense'), '', 'an unknown repo has no home');
});

test('the SOURCE hardcodes no machine path (NODES P1) — homes are derived at runtime', () => {
  // The rule is about COMMITTED bytes, not the runtime value: repoHome() at
  // runtime naturally contains the current user's home (from os.homedir()),
  // and that is correct. What must never ship is a literal in the file.
  const src = require('node:fs').readFileSync(require.resolve('./taskRepo.js'), 'utf8');
  assert.doesNotMatch(src, /\/Users\//, 'no /Users/... literal may be committed');
  assert.match(src, /os\.homedir\(\)/, 'the vault home comes from os.homedir()');
});

test('clickup_direct.mjs uses the resolver for its queue/get repo column (one implementation, not a second copy)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../clickup_direct.mjs'), 'utf8');
  assert.match(src, /import taskRepo from '\.\/builder\/taskRepo\.js'/);
  assert.match(src, /resolveTaskRepo\(t\.tags\)/);
});
