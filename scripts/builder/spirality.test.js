'use strict';

// SC-870: StarCaster reads Spirality's own code (lib/spirality.cjs) instead of
// a copy in loop/. These pin WHERE it looks and that a missing Spirality is a
// loud stop, never a quiet "no tickets".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const spirality = require('../../lib/spirality.cjs');
const REPO = path.resolve(__dirname, '..', '..');
const LAUNCHER = path.join(REPO, 'scripts', 'spirality.mjs');

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc870-'));
  const fakeSpirality = (where) => {
    fs.mkdirSync(path.join(where, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(where, 'lib', 'clickupTicketLink.js'), 'module.exports = { fake: true };\n');
    return where;
  };
  const root = path.join(dir, 'starcaster');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'spirality.project.json'), JSON.stringify({ projectSlug: 'starcaster', logDir: path.join(dir, 'logs') }));
  fs.writeFileSync(path.join(root, '.spirality-release'), '# a comment\nrelease-7\n');
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  return { dir, root, home, releases: path.join(dir, 'logs', 'releases'), fakeSpirality };
}

test('the pin names a release, and a bad pin is refused rather than guessed', () => {
  const s = scratch();
  assert.equal(spirality.pinnedRelease(s.root), 'release-7');
  fs.writeFileSync(path.join(s.root, '.spirality-release'), 'main\n');
  assert.throws(() => spirality.pinnedRelease(s.root), /not a Spirality release name/);
});

test("the committed pin is a release name (GitHub's checks download it)", () => {
  assert.match(spirality.pinnedRelease(), spirality.RELEASE_RE);
});

test('SPIRALITY_DIR wins, and one naming no Spirality is an error, not a fallback', () => {
  const s = scratch();
  const there = s.fakeSpirality(path.join(s.dir, 'ci-copy'));
  assert.deepEqual(spirality.locate({ env: { SPIRALITY_DIR: there }, root: s.root, home: s.home }).dir, there);
  assert.throws(() => spirality.locate({ env: { SPIRALITY_DIR: path.join(s.dir, 'nope') }, root: s.root, home: s.home }), /holds no Spirality/);
});

test("next, the release StarCaster's lanes ran last, only once that folder is whole", () => {
  const s = scratch();
  s.fakeSpirality(path.join(s.releases, 'release-3'));
  s.fakeSpirality(path.join(s.home, 'WebApps', 'spirality'));
  fs.writeFileSync(path.join(s.releases, 'last-starcaster'), 'release-3\n');
  // No .ready marker yet: Spirality is still preparing it, so the checkout is used, and says so.
  let got = spirality.locate({ env: {}, root: s.root, home: s.home });
  assert.equal(got.dir, path.join(s.home, 'WebApps', 'spirality'));
  assert.match(got.how, /not a release/);
  fs.writeFileSync(path.join(s.releases, '.ready-release-3'), 'abc\n');
  got = spirality.locate({ env: {}, root: s.root, home: s.home });
  assert.equal(got.dir, path.join(s.releases, 'release-3'));
  assert.equal(got.release, 'release-3');
});

test('no Spirality anywhere THROWS, naming every place it looked and the fix', () => {
  const s = scratch();
  assert.throws(() => spirality.locate({ env: {}, root: s.root, home: s.home }), (err) => {
    assert.match(err.message, /could not find Spirality/);
    assert.match(err.message, /SPIRALITY_DIR \(not set\)/);
    assert.match(err.message, /github\.com\/mentor24-maker\/spirality/);
    return true;
  });
});

test('the launcher with no Spirality stops with exit 1 and says why — never an empty answer', () => {
  const s = scratch();
  const r = spawnSync(process.execPath, [LAUNCHER, 'clickup', 'queue', '--status', 'Queued'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: s.home, SPIRALITY_DIR: path.join(s.dir, 'nope') },
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /holds no Spirality/);
});

test('the launcher refuses a verb it does not know (exit 2)', () => {
  const r = spawnSync(process.execPath, [LAUNCHER, 'clikup'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /say one of clickup, doctor, with-doppler, where/);
});

test('the launcher runs a command with SPIRALITY_PROJECT naming THIS checkout', () => {
  const s = scratch();
  const there = s.fakeSpirality(path.join(s.dir, 'spirality'));
  fs.mkdirSync(path.join(there, 'scripts'));
  // A stand-in Doppler wrapper: runs what it is given, no Doppler.
  fs.writeFileSync(path.join(there, 'scripts', 'with_doppler.mjs'),
    "import { spawnSync } from 'node:child_process';\nconst [c, ...a] = process.argv.slice(2);\nprocess.exit(spawnSync(c, a, { stdio: 'inherit' }).status ?? 1);\n");
  const r = spawnSync(process.execPath, [LAUNCHER, 'with-doppler', process.execPath, '-e', 'console.log(process.env.SPIRALITY_PROJECT)'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: s.home, SPIRALITY_DIR: there },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), REPO);
});

test('a time limit that stops the launcher stops what it started too (no orphan door)', async () => {
  const s = scratch();
  const there = s.fakeSpirality(path.join(s.dir, 'spirality'));
  fs.mkdirSync(path.join(there, 'scripts'));
  const pidFile = path.join(s.dir, 'child.pid');
  const lateFile = path.join(s.dir, 'wrote-late');
  // A stand-in door that records its pid, then would write a file 3s later.
  fs.writeFileSync(path.join(there, 'scripts', 'with_doppler.mjs'),
    `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetTimeout(() => fs.writeFileSync(${JSON.stringify(lateFile)}, 'late'), 3000);\n`);
  const { spawn } = require('node:child_process');
  const launcher = spawn(process.execPath, [LAUNCHER, 'with-doppler', 'true'], {
    env: { PATH: process.env.PATH, HOME: s.home, SPIRALITY_DIR: there },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  assert.ok(fs.existsSync(pidFile), 'the stand-in door never started');
  const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
  const exited = new Promise((resolve) => launcher.on('exit', (code, signal) => resolve({ code, signal })));
  launcher.kill('SIGTERM');
  const { code } = await exited;
  assert.equal(code, 143, 'the launcher reports the stop as 128 + SIGTERM');
  const alive = () => { try { process.kill(childPid, 0); return true; } catch { return false; } };
  const gone = Date.now() + 2000;
  while (alive() && Date.now() < gone) await new Promise((r) => setTimeout(r, 25));
  assert.equal(alive(), false, 'the door the launcher started is still running after the launcher was stopped');
  await new Promise((r) => setTimeout(r, 3300));
  assert.equal(fs.existsSync(lateFile), false, 'the stopped door still wrote afterwards');
});

test('nothing outside lib/spirality.cjs reaches for a loop/ copy any more', () => {
  const out = spawnSync('git', ['grep', '-n', '-E', "(\\.\\./)+loop/(lib|scripts)/|'loop', 'scripts'", '--', 'lib', 'scripts', 'package.json', ':!scripts/builder/spirality.test.js'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(out.stdout, '', `still pointing at the deleted loop/ copy:\n${out.stdout}`);
});

test("Spirality's own merge rules refuse to auto-merge the launcher, the pin and the door wrappers (SC-870 review)", () => {
  // Since SC-905 the relay merges through SPIRALITY's lib/autoMergeLane.js,
  // which reads only `governancePaths` in spirality.project.json, never
  // scripts/builder/autoMergeLane.js. Every claim, verdict and bus post goes
  // through these files, so a machine pull request touching only one of them
  // must wait for Dane. Asked of the real rules, read through lib/spirality.cjs.
  const lane = spirality.requireSpirality('lib/autoMergeLane.js');
  const { governancePaths } = JSON.parse(fs.readFileSync(path.join(REPO, 'spirality.project.json'), 'utf8'));
  for (const file of [
    'scripts/spirality.mjs',
    'scripts/spirality_pin.mjs',
    'lib/spirality.cjs',
    'scripts/builder/spirality.test.js',
    'scripts/builder/spiralityPin.test.js',
    '.spirality-release',
    'scripts/lib/trackerDoor.cjs',
    'scripts/lib/trackerTickets.cjs',
  ]) {
    const verdict = lane.laneEligibility([file], governancePaths);
    assert.equal(verdict.eligible, false, `${file}: ${verdict.reason}`);
    assert.match(String(verdict.reason), /protected list/, file);
  }
});

test('both workflows accept exactly the release names lib/spirality.cjs does, and the gate reads its pin from the base branch', () => {
  const read = (name) => fs.readFileSync(path.join(REPO, '.github', 'workflows', name), 'utf8');
  for (const name of ['ci.yml', 'review-gate.yml']) {
    const m = /grep -Eq '([^']+)'/.exec(read(name));
    assert.ok(m, `${name} checks the release name`);
    const re = new RegExp(m[1]);
    for (const good of ['release-1', 'release-2', 'release-12']) assert.ok(re.test(good) && spirality.RELEASE_RE.test(good), `${name}: ${good}`);
    for (const bad of ['release-0', 'release-02', 'main', 'release-']) assert.equal(re.test(bad), spirality.RELEASE_RE.test(bad), `${name}: ${bad}`);
  }
  const gate = read('review-gate.yml');
  // A pull request must not choose the Spirality that grades it.
  assert.match(gate, /git show FETCH_HEAD:\.spirality-release/);
  assert.match(gate, /BASE_REF: \$\{\{ github\.base_ref \}\}/);
  // And a bad pin or failed download leaves the answer to the gate (CANNOT TELL), never a red job or Spirality's default branch.
  assert.match(gate, /if: steps\.spirality\.outputs\.release != ''/);
  assert.equal((gate.match(/continue-on-error: true/g) || []).length, 2);
});
