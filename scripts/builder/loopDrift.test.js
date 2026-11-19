// SC-868: `npm run loop:drift` says out loud when StarCaster's copy of the
// loop (loop/) differs from Spirality's main. These run the real script
// against a scratch copy of loop/ and a fake `gh`, so they never touch the
// real folder or the network.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const drift = require('../../lib/loopDrift.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'loop_drift.mjs');
const COMMIT = 'a262334000000000000000000000000000000000';

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-drift-'));
  const loop = path.join(dir, 'loop');
  fs.mkdirSync(path.join(loop, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(loop, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(loop, 'README.md'), 'StarCaster\'s own note, never compared\n');
  fs.writeFileSync(path.join(loop, 'lib', 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(loop, 'scripts', 'clickup.mjs'), 'console.log("door");\n');
  return { dir, loop };
}

/** The tree Spirality would list for an exact copy of `loop`. */
function treeFor(loop) {
  const tree = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) { tree.push({ path: rel, type: 'tree', sha: 'x' }); walk(path.join(d, e.name), rel); } else if (rel !== 'README.md') tree.push({ path: rel, type: 'blob', sha: drift.blobSha(fs.readFileSync(path.join(d, e.name))) });
    }
  };
  walk(loop, '');
  // Spirality has files StarCaster deliberately did not copy; those are not drift.
  tree.push({ path: 'docs/LOOP.md', type: 'blob', sha: 'f'.repeat(40) });
  return tree;
}

/** A fake gh: answers the commit read and the tree read from a JSON file, or fails. */
function fakeGh(dir, { tree, fail }) {
  const data = path.join(dir, 'tree.json');
  fs.writeFileSync(data, JSON.stringify({ sha: 'treesha', tree, truncated: false }));
  const bin = path.join(dir, 'gh');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (${fail ? 'true' : 'false'}) { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
if (args.includes('/commits/main')) { process.stdout.write(JSON.stringify({ sha: '${COMMIT}' })); process.exit(0); }
if (args.includes('/git/trees/${COMMIT}')) { process.stdout.write(require('fs').readFileSync(${JSON.stringify(data)}, 'utf8')); process.exit(0); }
process.stderr.write('unexpected call: ' + args + '\\n'); process.exit(1);
`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function run(loop, gh, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LOOP_DRIFT_DIR: loop, LOOP_DRIFT_GH: gh, ...extraEnv },
  });
}

test('blobSha is exactly what git hash-object prints', () => {
  const { dir } = scratch();
  const file = path.join(dir, 'loop', 'lib', 'a.js');
  const expected = execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim();
  assert.equal(drift.blobSha(fs.readFileSync(file)), expected);
});

test('an exact copy is IN STEP, exits 0, and names Spirality\'s commit', () => {
  const { dir, loop } = scratch();
  const r = run(loop, fakeGh(dir, { tree: treeFor(loop) }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /IN STEP — all 2 copied files match Spirality's main at a262334/);
  assert.match(r.stdout, new RegExp(COMMIT));
});

test('one byte changed in a copied file is BEHIND, names the file, exits 1', () => {
  const { dir, loop } = scratch();
  const tree = treeFor(loop);
  fs.appendFileSync(path.join(loop, 'scripts', 'clickup.mjs'), ' ');
  const r = run(loop, fakeGh(dir, { tree }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /BEHIND/);
  assert.match(r.stdout, /DIFFERS {2}loop\/scripts\/clickup\.mjs/);
  assert.doesNotMatch(r.stdout, /lib\/a\.js/);
});

test('a file Spirality has deleted is BEHIND and named as deleted', () => {
  const { dir, loop } = scratch();
  const tree = treeFor(loop).filter((e) => e.path !== 'lib/a.js');
  const r = run(loop, fakeGh(dir, { tree }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /DELETED IN SPIRALITY {2}loop\/lib\/a\.js/);
});

test('README.md differing is never drift: it is StarCaster\'s own', () => {
  const { dir, loop } = scratch();
  const tree = treeFor(loop);
  tree.push({ path: 'README.md', type: 'blob', sha: '0'.repeat(40) });
  const r = run(loop, fakeGh(dir, { tree }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('GitHub unreachable is CANNOT TELL and exits 2, never 0', () => {
  const { dir, loop } = scratch();
  const r = run(loop, fakeGh(dir, { tree: [], fail: true }));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /CANNOT TELL — could not read Spirality's main: gh failed: error connecting/);
});

test('no gh program at all is CANNOT TELL, not a crash or a pass', () => {
  const { dir, loop } = scratch();
  const r = run(loop, path.join(dir, 'no-such-gh'));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /CANNOT TELL/);
});

test('a truncated or empty file list is CANNOT TELL', () => {
  const local = [{ path: 'lib/a.js', sha: 'a' }];
  assert.equal(drift.judge({ local, remote: { commit: COMMIT, tree: [{ path: 'lib/a.js', type: 'blob', sha: 'a' }], truncated: true } }).verdict, drift.VERDICT.CANNOT_TELL);
  assert.equal(drift.judge({ local, remote: { commit: COMMIT, tree: [] } }).verdict, drift.VERDICT.CANNOT_TELL);
  assert.equal(drift.judge({ local: [], remote: { commit: COMMIT, tree: [{ path: 'x', type: 'blob', sha: 'a' }] } }).verdict, drift.VERDICT.CANNOT_TELL);
});

test('plan: BEHIND posts once a day, a second run the same day sends nothing', () => {
  const behind = { verdict: drift.VERDICT.BEHIND };
  const now = Date.parse('2026-11-18T12:00:00Z');
  const first = drift.plan({ judged: behind, state: {}, now });
  assert.equal(first.behind, true);
  const again = drift.plan({ judged: behind, state: first.next, now: now + 60 * 60 * 1000 });
  assert.equal(again.behind, false);
  assert.deepEqual(again.next, first.next, 'the stamp is not moved by a run that sent nothing');
  const tomorrow = drift.plan({ judged: behind, state: first.next, now: now + drift.DAY_MS + 1 });
  assert.equal(tomorrow.behind, true);
});

test('plan: CANNOT TELL posts once a day; a later reading clears it silently', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const first = drift.plan({ judged: { verdict: drift.VERDICT.CANNOT_TELL }, state: {}, now });
  assert.equal(first.cannotTell, true);
  assert.equal(drift.plan({ judged: { verdict: drift.VERDICT.CANNOT_TELL }, state: first.next, now: now + 1000 }).cannotTell, false);
  const read = drift.plan({ judged: { verdict: drift.VERDICT.IN_STEP }, state: first.next, now: now + 2000 });
  assert.equal(read.cleared, false, 'no all-clear for a CANNOT TELL: nothing was ever behind');
  assert.equal(read.next.cannotTellAt, '');
});

test('plan: IN STEP after a posted BEHIND sends one all-clear, then nothing', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const behind = drift.plan({ judged: { verdict: drift.VERDICT.BEHIND }, state: {}, now });
  const clear = drift.plan({ judged: { verdict: drift.VERDICT.IN_STEP }, state: behind.next, now: now + 1000 });
  assert.equal(clear.cleared, true);
  const quiet = drift.plan({ judged: { verdict: drift.VERDICT.IN_STEP }, state: clear.next, now: now + 2000 });
  assert.equal(quiet.cleared, false);
});

test('the BEHIND message names each file, Spirality\'s commit and the fix', () => {
  const judged = drift.judge({
    local: [{ path: 'scripts/clickup.mjs', sha: 'old' }, { path: 'lib/gone.js', sha: 'g' }],
    remote: { commit: COMMIT, tree: [{ path: 'scripts/clickup.mjs', type: 'blob', sha: 'new' }] },
  });
  const text = drift.renderBehind({ judged, node: 'mac-mini', at: '2026-11-18T12:00:00Z' });
  assert.match(text, /loop\/scripts\/clickup\.mjs differs/);
  assert.match(text, /loop\/lib\/gone\.js no longer exists in Spirality/);
  assert.match(text, /a262334/);
  assert.match(text, /npm run onboard:copy/);
  assert.match(text, /NOT in force on StarCaster/);
});

test('--check --dry-run stamps nothing and, off the relay\'s machine, posts nothing', () => {
  const { dir, loop } = scratch();
  const stamp = path.join(dir, 'stamp.json');
  const tree = treeFor(loop);
  fs.appendFileSync(path.join(loop, 'lib', 'a.js'), ' ');
  const r = run(loop, fakeGh(dir, { tree }), ['--check', '--dry-run'], { LOOP_DRIFT_STAMP: stamp });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(fs.existsSync(stamp), false, 'a dry run never writes the stamp');
  assert.doesNotMatch(r.stdout, /posted to the bus/);
});

test('the relay runs the check on its wake, never letting it fail the wake', () => {
  const relay = fs.readFileSync(path.join(ROOT, 'scripts', 'run_bus_relay.sh'), 'utf8');
  assert.match(relay, /^npm run --silent loop:drift -- --check \|\| true$/m);
});

test('--check repeats the last verdict within the hour without asking GitHub', () => {
  const { dir, loop } = scratch();
  const stamp = path.join(dir, 'stamp.json');
  fs.writeFileSync(stamp, JSON.stringify({ readAt: new Date().toISOString(), lastVerdict: drift.VERDICT.BEHIND, behindAt: new Date().toISOString() }));
  // A gh that would fail: a fresh reading would say CANNOT TELL.
  const r = run(loop, fakeGh(dir, { tree: [], fail: true }), ['--check'], { LOOP_DRIFT_STAMP: stamp });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /BEHIND at the last reading/);
});
