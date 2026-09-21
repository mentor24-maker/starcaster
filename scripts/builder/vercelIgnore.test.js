'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { matches, parseRule, unreadableRules } = require('./vercelIgnore.js');

test('a plain folder rule excludes everything under it', () => {
  const rules = 'workers/\n';
  assert.equal(matches(rules, 'workers/studio/daemon.js'), true);
  assert.equal(matches(rules, 'workers/studio/nested/deep/thing.js'), true);
  assert.equal(matches(rules, 'lib/nodeRoles.js'), false);
});

test('all four ways of writing the folder rule agree', () => {
  for (const rule of ['workers/', 'workers', '/workers/', 'workers/**']) {
    assert.equal(matches(rule, 'workers/studio/daemon.js'), true, `"${rule}" should exclude it`);
  }
});

test('a folder rule does not match a FILE of the same name', () => {
  // `workers/` names a directory; a file literally called `workers` is kept.
  assert.equal(matches('workers/', 'workers'), false);
  assert.equal(matches('workers', 'workers'), true);
});

test('a commented-out rule excludes nothing — the grep-shaped false pass', () => {
  // This is the case the check exists for: the word `workers` is right there
  // in the file, and the file no longer does anything.
  assert.equal(matches('# workers/ used to be ignored here\n', 'workers/studio/daemon.js'), false);
});

test('a later negation wins, per gitignore order', () => {
  const rules = 'workers/\n!workers/studio/daemon.js\n';
  assert.equal(matches(rules, 'workers/studio/daemon.js'), false);
  assert.equal(matches(rules, 'workers/studio/queue.js'), true);
});

test('an earlier negation does NOT win — order is what decides', () => {
  const rules = '!workers/studio/daemon.js\nworkers/\n';
  assert.equal(matches(rules, 'workers/studio/daemon.js'), true);
});

test('a similarly-named folder is not caught', () => {
  assert.equal(matches('workers/', 'my-workers/thing.js'), false);
  assert.equal(matches('workers/', 'lib/workers-helper.js'), false);
});

test('an unanchored single segment matches at any depth; one with a slash does not', () => {
  assert.equal(matches('*.log', 'lib/deep/x.log'), true);
  assert.equal(matches('api/*.js', 'api/index.js'), true);
  assert.equal(matches('api/*.js', 'nested/api/index.js'), false);
});

test('a leading slash anchors to the repo root', () => {
  assert.equal(matches('/workers/', 'workers/studio/daemon.js'), true);
  assert.equal(matches('/workers/', 'vendor/workers/studio/daemon.js'), false);
});

test('a pattern outside the supported subset answers null, never false', () => {
  // DOCTRINE 3.11: a rule this matcher cannot read could exclude or un-exclude
  // anything, so no verdict is claimed. `null` is what the check turns into
  // CANNOT TELL, and it must never be confused with "not excluded".
  assert.equal(matches('work[e]rs/\n', 'workers/studio/daemon.js'), null);
  assert.equal(matches('**/workers/**\n', 'workers/studio/daemon.js'), null);
  assert.equal(matches('{workers,scripts}/\n', 'workers/studio/daemon.js'), null);
});

test('unreadableRules names each pattern it could not read, and says why', () => {
  const found = unreadableRules('workers/\nwork[e]rs/\n# a comment\n');
  assert.equal(found.length, 1);
  assert.equal(found[0].pattern, 'work[e]rs/');
  assert.match(found[0].why, /glob feature/);
});

test('blank lines and comments are not rules', () => {
  assert.equal(parseRule(''), null);
  assert.equal(parseRule('   '), null);
  assert.equal(parseRule('# workers/'), null);
  assert.equal(parseRule('workers/').understood, true);
});

test('the repo\'s own .vercelignore really does exclude every worker file', () => {
  // The check script asserts this too; it is repeated here so a change to the
  // committed file is caught by the unit suite as well as by the gate, which
  // run at different moments in CI.
  const fs = require('node:fs');
  const path = require('node:path');
  const repo = path.resolve(__dirname, '..', '..');
  const text = fs.readFileSync(path.join(repo, '.vercelignore'), 'utf8');
  assert.equal(matches(text, 'workers/studio/daemon.js'), true);
  assert.equal(matches(text, 'workers/studio/queue.js'), true);
  assert.equal(matches(text, 'workers/youtube-media/anything.js'), true);
  // And it must not have grown teeth on something that is served.
  assert.equal(matches(text, 'routes/index.js'), false);
  assert.equal(matches(text, 'lib/nodeRoles.js'), false);
  assert.equal(matches(text, 'public/styles.css'), false);
});
