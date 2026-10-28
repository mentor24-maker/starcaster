'use strict';
/**
 * The check an operator script runs before loading compiled code
 * (scripts/lib/build_inputs.cjs). Incident: 2026-10-27, the Site Import page
 * builder crashed on the Alphire job because lib/site-import/dist/ was built
 * from Oct 9 source while the script expected Oct 14's, and nothing said so
 * (task 86bctakmc).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  GENERATED_LIBS,
  inputsFromMetafiles,
  recordBuildInputs,
  checkBuildInputs,
  ensureBuildCurrent,
} = require('../lib/build_inputs.cjs');

const REPO = path.resolve(__dirname, '..', '..');

function fakeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-inputs-test-'));
  fs.mkdirSync(path.join(root, 'lib/site-import'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib/site-import/map.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'lib/site-import/ir.ts'), 'export type X = 1;\n');
  return root;
}

// The shape esbuild's --metafile writes: inputs keyed relative to its cwd.
const META = {
  inputs: {
    'lib/site-import/map.ts': {},
    'lib/site-import/ir.ts': {},
    'node_modules/cheerio/index.js': {},
  },
};

test('inputs come from the metafile, without node_modules', () => {
  const root = fakeRepo();
  assert.deepEqual(inputsFromMetafiles(root, [META]), ['lib/site-import/ir.ts', 'lib/site-import/map.ts']);
});

test('a build that matches its source reads fresh', () => {
  const root = fakeRepo();
  recordBuildInputs({ root, lib: 'site-import', metafiles: [META] });
  const r = checkBuildInputs({ root, lib: 'site-import' });
  assert.equal(r.state, 'fresh');
  assert.deepEqual(r.changed, []);
});

test('the Alphire shape: a source edited after the build reads stale and is named', () => {
  const root = fakeRepo();
  recordBuildInputs({ root, lib: 'site-import', metafiles: [META] });
  fs.writeFileSync(path.join(root, 'lib/site-import/map.ts'), 'export const a = 2;\n');
  const r = checkBuildInputs({ root, lib: 'site-import' });
  assert.equal(r.state, 'stale');
  assert.deepEqual(r.changed, ['lib/site-import/map.ts']);
  assert.equal(r.rebuild, 'npm run build:site-import');
});

test('a deleted source reads stale, not fresh', () => {
  const root = fakeRepo();
  recordBuildInputs({ root, lib: 'site-import', metafiles: [META] });
  fs.rmSync(path.join(root, 'lib/site-import/ir.ts'));
  const r = checkBuildInputs({ root, lib: 'site-import' });
  assert.equal(r.state, 'stale');
  assert.deepEqual(r.changed, ['lib/site-import/ir.ts (deleted)']);
});

test('output with no build record (built before this check existed) is unstamped, never fresh', () => {
  const root = fakeRepo();
  assert.equal(checkBuildInputs({ root, lib: 'site-import' }).state, 'unstamped');
  fs.mkdirSync(path.join(root, 'lib/site-import/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, GENERATED_LIBS['site-import'].stamp), '{not json');
  assert.equal(checkBuildInputs({ root, lib: 'site-import' }).state, 'unstamped');
  fs.writeFileSync(path.join(root, GENERATED_LIBS['site-import'].stamp), '{"inputs":{}}');
  assert.equal(checkBuildInputs({ root, lib: 'site-import' }).state, 'unstamped');
});

test('ensureBuildCurrent does nothing when fresh', () => {
  const root = fakeRepo();
  recordBuildInputs({ root, lib: 'site-import', metafiles: [META] });
  let rebuilt = 0;
  ensureBuildCurrent(root, ['site-import'], { log: () => {}, rebuild: () => { rebuilt += 1; } });
  assert.equal(rebuilt, 0);
});

test('ensureBuildCurrent rebuilds a stale lib, says so, and goes on', () => {
  const root = fakeRepo();
  recordBuildInputs({ root, lib: 'site-import', metafiles: [META] });
  fs.writeFileSync(path.join(root, 'lib/site-import/map.ts'), 'export const a = 3;\n');
  const logs = [];
  const calls = [];
  ensureBuildCurrent(root, ['site-import'], {
    log: (m) => logs.push(m),
    rebuild: (r, script) => {
      calls.push(script);
      recordBuildInputs({ root: r, lib: 'site-import', metafiles: [META] });
    },
  });
  assert.deepEqual(calls, ['build:site-import']);
  assert.match(logs[0], /out of date.*lib\/site-import\/map\.ts.*npm run build:site-import/);
  assert.match(logs[1], /now matches the source/);
});

test('ensureBuildCurrent refuses, naming the command, when the rebuild fails', () => {
  const root = fakeRepo();
  assert.throws(
    () => ensureBuildCurrent(root, ['site-import'], { log: () => {}, rebuild: () => { throw new Error('esbuild exploded'); } }),
    (err) => /cannot be confirmed current/.test(err.message)
      && /esbuild exploded/.test(err.message)
      && /Run `npm run build:site-import`/.test(err.message),
  );
});

test('ensureBuildCurrent refuses when a rebuild still does not match', () => {
  const root = fakeRepo();
  recordBuildInputs({ root, lib: 'site-import', metafiles: [META] });
  fs.writeFileSync(path.join(root, 'lib/site-import/map.ts'), 'export const a = 4;\n');
  assert.throws(
    () => ensureBuildCurrent(root, ['site-import'], { log: () => {}, rebuild: () => {} }),
    /A rebuild did not fix it\. Run `npm run build:site-import`/,
  );
});

// The real builds, end to end: CI runs this suite after `npm run build`, and
// both libs are built by it or by test:site-import; build them here so the
// test does not depend on step order.
test('the real builds record their sources, including imports from outside the folder', () => {
  for (const lib of Object.keys(GENERATED_LIBS)) {
    execFileSync('npm', ['run', '-s', GENERATED_LIBS[lib].rebuild], { cwd: REPO, stdio: 'ignore' });
    const r = checkBuildInputs({ root: REPO, lib });
    assert.equal(r.state, 'fresh', `${lib}: ${JSON.stringify(r)}`);
  }
  const stamp = JSON.parse(fs.readFileSync(path.join(REPO, GENERATED_LIBS['site-import'].stamp), 'utf8'));
  // map.ts imports builder-template.ts from outside the folder — the record
  // must follow it, or an edit there would read as fresh.
  assert.ok(stamp.inputs['lib/site-import/map.ts']);
  assert.ok(stamp.inputs['lib/builder-client/builder-template.ts']);
  assert.ok(stamp.inputs['scripts/build_site_import_bundle.mjs']);
});
