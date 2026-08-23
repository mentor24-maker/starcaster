'use strict';

// This test lives in the NODE suite (scripts/builder/*.test.js), not vitest —
// which is the very rule the module under test enforces: it requires a .cjs
// under scripts/, and node tests run after the build. A vitest copy of this
// would be the exact bug (PR #343) the guard exists to prevent.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  run,
  reachesLibBuilder,
  isVitestTestFile,
  isUnderLibBuilder,
  specifiersIn,
} = require('../check_vitest_generated_lib.cjs');

/**
 * A synthetic import graph so the walk is tested without a real tree.
 * `edges` maps a node id to the specifiers it imports; `links` resolves
 * (fromId, spec) → target id; `builder` is the set that counts as lib/builder/.
 */
function graphDeps(edges, links, builder) {
  return {
    readFile: (id) => (edges[id] || []).map((s) => `import x from '${s}';`).join('\n'),
    resolve: (from, spec) => links[`${from}|${spec}`] || null,
    isUnderLibBuilder: (id) => builder.has(id),
  };
}

test('flags a DIRECT require of a lib/builder file', () => {
  const deps = graphDeps(
    { test: ['./document'] },
    { 'test|./document': 'document' },
    new Set(['document']),
  );
  const chain = reachesLibBuilder('test', deps);
  assert.ok(chain, 'should report a reach');
  assert.deepEqual(chain, ['test', 'document']);
});

test('flags a TRANSITIVE reach — the PR #343 shape (test → source → generated)', () => {
  // section-drift.test.ts → builder/document.js → builder/template.js
  const deps = graphDeps(
    { test: ['./document'], document: ['./template'], template: [] },
    { 'test|./document': 'document', 'document|./template': 'template' },
    new Set(['template', 'document']), // both are under lib/builder/
  );
  const chain = reachesLibBuilder('test', deps);
  assert.ok(chain);
  assert.equal(chain[0], 'test');
  assert.equal(chain[chain.length - 1], 'document'); // stops at the first hit
});

test('does NOT flag a test that stays in TypeScript sources', () => {
  const deps = graphDeps(
    { test: ['./component'], component: ['./helper'], helper: [] },
    { 'test|./component': 'component', 'component|./helper': 'helper' },
    new Set(), // nothing under lib/builder/
  );
  assert.equal(reachesLibBuilder('test', deps), null);
});

test('ignores bare/package specifiers — they cannot reach lib/builder/', () => {
  const deps = {
    readFile: (id) => (id === 'test' ? "import React from 'react';\nimport { z } from 'zod';" : ''),
    resolve: () => { throw new Error('resolve must not be called for bare specifiers'); },
    isUnderLibBuilder: () => false,
  };
  assert.equal(reachesLibBuilder('test', deps), null);
});

test('a require() cycle does not hang the walk', () => {
  const deps = graphDeps(
    { a: ['./b'], b: ['./a'] },
    { 'a|./b': 'b', 'b|./a': 'a' },
    new Set(),
  );
  assert.equal(reachesLibBuilder('a', deps), null);
});

test('specifiersIn parses import-from, side-effect import, require(), and dynamic import()', () => {
  const text = [
    "import a from './a';",
    "import './side-effect';",
    "export { z } from './z';",
    "const m = require('./m');",
    "const d = await import('./d');",
    "import pkg from 'react';",
  ].join('\n');
  const specs = specifiersIn(text);
  for (const s of ['./a', './side-effect', './z', './m', './d', 'react']) {
    assert.ok(specs.includes(s), `should find ${s}`);
  }
});

test('isVitestTestFile matches vitest.config.ts globs and nothing else', () => {
  assert.equal(isVitestTestFile('components/foo.test.tsx'), true);
  assert.equal(isVitestTestFile('components/deep/bar.test.ts'), true);
  assert.equal(isVitestTestFile('lib/builder-client/baz.test.ts'), true);
  // Not vitest-run: builder-client has no .test.tsx glob; non-test files; node suite.
  assert.equal(isVitestTestFile('lib/builder-client/baz.test.tsx'), false);
  assert.equal(isVitestTestFile('components/foo.tsx'), false);
  assert.equal(isVitestTestFile('scripts/builder/thing.test.js'), false);
});

test('isUnderLibBuilder separates lib/builder/ from the lib/builder-client/ source tree', () => {
  const path = require('node:path');
  const ROOT = path.resolve(__dirname, '..', '..');
  assert.equal(isUnderLibBuilder(path.join(ROOT, 'lib/builder/template.js')), true);
  assert.equal(isUnderLibBuilder(path.join(ROOT, 'lib/builder/document.js')), true);
  assert.equal(isUnderLibBuilder(path.join(ROOT, 'lib/builder-client/builder-template.ts')), false);
});

test('the repo starts GREEN — no vitest test currently reaches lib/builder/', () => {
  // If this ever fails, a real offender has been introduced; the message names
  // the chain. As of 2026-08-22 there were none (section-drift moved to node).
  const { failures } = run({ all: true });
  assert.deepEqual(failures, [], failures.join('\n'));
});
