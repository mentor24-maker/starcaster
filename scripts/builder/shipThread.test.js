'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHIP = path.join(__dirname, '..', 'ship_thread.cjs');
const source = fs.readFileSync(SHIP, 'utf8');

/**
 * `npm run ship` — the one safety property that has to survive every future
 * edit: IT NEVER FORCE-PUSHES.
 *
 * The first draft rebased and force-pushed with `--force-with-lease`. The
 * operator's settings carry `Bash(git push --force*)` on the deny list, and a
 * force-push buried inside a node script is invisible to a rule that matches
 * command text — so the command he would run most often would quietly have
 * done the thing he forbade (DOCTRINE.md 6.6). Catching up by merge instead of
 * rebase removes the need entirely, and costs nothing because every PR here is
 * squash-merged.
 *
 * A source-level assertion rather than a behavioural one on purpose: driving
 * the real script needs a remote, a PR and CI, so the property would go
 * untested in practice — and an untested property is how it came back.
 */

/** Executable source only: comments explain the rule and must not trip it. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = withoutComments(source);

test('the ship script contains no force-push, in any spelling', () => {
  assert.doesNotMatch(code, /--force/, 'no --force / --force-with-lease anywhere in executable code');
  assert.doesNotMatch(code, /'-f'/, "no bare -f flag in a git argv");
  assert.doesNotMatch(code, /push\s+-f\b/, 'no `push -f`');
});

test('it catches up by merging, not rebasing — that is what removes the force-push', () => {
  assert.match(code, /'merge',\s*'origin\/main'/, 'must merge origin/main');
  assert.doesNotMatch(code, /'rebase',\s*'origin\/main'/, 'must not rebase onto origin/main');
});

test('it never amends, which would rewrite pushed history into a force-push', () => {
  assert.doesNotMatch(code, /'--amend'/, 'the asset re-pin must be a new commit, not an amend');
});

test('main and master are refused as a branch to ship', () => {
  assert.match(code, /PROTECTED\s*=\s*new Set\(\[\s*'main',\s*'master'\s*\]\)/);
  assert.match(code, /PROTECTED\.has\(branch\)/, 'the guard must actually be consulted');
});

test('it refuses to ship a dirty tree, so nothing is left behind', () => {
  assert.match(code, /status',\s*'--porcelain'/);
});

test('a push rejection tells the operator to look, rather than escalating', () => {
  assert.match(source, /will not force-push over it/i);
});

test('the checks it runs include the gates CI runs', () => {
  for (const gate of ['typecheck', 'test:builder-ui', 'test:builder', 'test:hooks']) {
    assert.ok(code.includes(`'${gate}'`), `ship must run ${gate}`);
  }
  for (const gate of ['check_conventions.cjs', 'check_build_paths.cjs', 'check_syntax.cjs']) {
    assert.ok(code.includes(gate), `ship must run ${gate}`);
  }
});

test('--dry-run and --no-merge exist, so it can be inspected before it acts', () => {
  assert.match(code, /dry-run/);
  assert.match(code, /no-merge/);
});

test('the comment-stripper does not defeat the test it feeds', () => {
  // Guard the guard: if withoutComments ever ate real code, every assertion
  // above would pass vacuously.
  assert.ok(code.includes("spawnSync"), 'executable code survived stripping');
  assert.ok(!code.includes('force-push buried inside'), 'block comments were stripped');
  assert.ok(code.length > 2000, 'stripping left a plausible amount of code');
});
