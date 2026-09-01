'use strict';

// The parse gate. Lives in the NODE suite rather than vitest because it
// requires a .cjs under scripts/ — and because the thing it guards (files that
// nothing imports) is a node-side concern.
//
// The incident: on 2026-08-30 a "keep both sides" conflict resolution fused two
// `const { ... } = X;` statements in scripts/clickup_direct.mjs. Valid to git,
// a SyntaxError to node, and nothing in the toolchain looked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  collectFlat,
  collectDeep,
  collectFiles,
  parseAll,
  SKIP_DIRS,
  NODE_EXTENSIONS,
} = require('../check_syntax.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Build a throwaway tree from a {relPath: contents} map and return its root. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-syntax-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

test('scripts/ is swept RECURSIVELY, and .mjs and .cjs count', () => {
  const root = fixture({
    'scripts/top.js': 'const a = 1;\n',
    'scripts/builder/nested.mjs': 'export const b = 2;\n',
    'scripts/hooks/deep/deeper.cjs': 'module.exports = 3;\n',
    'scripts/notes.md': 'not javascript\n',
    'scripts/data.json': '{}\n',
  });
  assert.deepEqual(collectDeep('scripts', { root }), [
    'scripts/builder/nested.mjs',
    'scripts/hooks/deep/deeper.cjs',
    'scripts/top.js',
  ]);
});

test('generated artifacts under lib/builder/ are NOT parsed (landmine 14)', () => {
  // These do not exist at CI time — the gate runs before `npm run build`. A
  // sweep that insisted on reading them would pass locally and fail CI forever.
  const root = fixture({
    'lib/builder/template.js': 'this is not ( valid javascript\n',
    'lib/builder/template-frame.js': 'nor ) is this\n',
    'lib/builder/email-render.js': 'or ] this\n',
    'lib/site-import/dist/normalize.js': 'broken (\n',
    'lib/site-import/dist/a-fourth-output.js': 'also broken (\n',
    'lib/projectScope.js': 'const scope = 1;\n',
  });
  const found = collectDeep('lib', { root });
  assert.deepEqual(found, ['lib/projectScope.js'], 'only the hand-written file');
  assert.equal(parseAll(found, { root }).length, 0, 'and it parses');
});

test('node_modules is never descended into', () => {
  assert.ok(SKIP_DIRS.has('node_modules'));
  const root = fixture({
    'lib/real.js': 'const a = 1;\n',
    'lib/node_modules/vendor/broken.js': 'function ( {\n',
  });
  assert.deepEqual(collectDeep('lib', { root }), ['lib/real.js']);
});

test('a fused statement is reported, with the file and the line', () => {
  // The 2026-08-30 shape, verbatim: two destructuring statements merged into one.
  const root = fixture({
    'scripts/fused.mjs': "const { a } = X;const { b } = Y;\nconst { c = Z;\n",
  });
  const failures = parseAll(collectDeep('scripts', { root }), { root });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].file, 'scripts/fused.mjs');
  assert.ok(failures[0].message, 'names what went wrong');
  assert.equal(failures[0].line, 2);
});

test('an unterminated statement in a .mjs fails, and restoring it passes', () => {
  const broken = fixture({ 'scripts/foo.mjs': "export const rows = [1, 2\n" });
  assert.equal(parseAll(collectDeep('scripts', { root: broken }), { root: broken }).length, 1);

  const fixed = fixture({ 'scripts/foo.mjs': "export const rows = [1, 2];\n" });
  assert.equal(parseAll(collectDeep('scripts', { root: fixed }), { root: fixed }).length, 0);
});

test('public/js/ behaviour is unchanged — flat, .js only, generated bundle skipped', () => {
  const root = fixture({
    'public/js/core.js': 'var App = {};\n',
    'public/js/richtext-vendor.js': 'this ( is generated and broken\n',
    'public/js/module.mjs': 'export const x = 1;\n',
    'public/js/sub/nested.js': 'const nested = 1;\n',
  });
  assert.deepEqual(
    collectFlat('public/js', { root }),
    ['public/js/core.js'],
    'flat, .js only, and the generated vendor bundle stays out',
  );
});

test('the real repo sweep covers the file the incident happened in', () => {
  const files = collectFiles({ root: REPO_ROOT });
  assert.ok(
    files.includes('scripts/clickup_direct.mjs'),
    'scripts/clickup_direct.mjs must be parsed — it is the 2026-08-30 file',
  );
  assert.ok(files.includes('scripts/check_syntax.cjs'), 'the gate parses itself');
  assert.ok(files.includes('public/js/core.js'), 'and still parses the browser JS');
  assert.ok(
    !files.some((f) => f.startsWith('lib/builder/template')),
    'and never the generated builder template',
  );
});

test('.ts and .tsx are out of scope — esbuild would need a different loader', () => {
  assert.ok(!NODE_EXTENSIONS.has('.ts'));
  const root = fixture({
    'lib/builder-client/thing.ts': 'const x: number = 1;\n',
    'lib/plain.js': 'const y = 1;\n',
  });
  assert.deepEqual(collectDeep('lib', { root }), ['lib/plain.js']);
});
