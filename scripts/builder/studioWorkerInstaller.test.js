'use strict';

/**
 * scripts/install_studio_worker.sh — the reading that said "not loaded" about a
 * loaded job.
 *
 * `launchctl list | grep -q "$LABEL"` under `set -o pipefail` is wrong 10 times
 * out of 10: `grep -q` exits on the first match, `launchctl` takes SIGPIPE and
 * exits 141, and pipefail hands that 141 to the `if`. The consequence was not
 * cosmetic — the `loaded: yes — PID` line could never print, and the status
 * told a reader on the Mini that a running daemon "has never run on this
 * machine". Round 2 of 86bbjv68y.
 *
 * THESE TESTS RUN THE FILE'S OWN BYTES. The shell functions are cut out of the
 * script by name and evaluated as they are written there — checking a
 * hand-copied version would be checking the copy, which is the mistake the
 * script's own `--print-plist` comment already warns about.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'install_studio_worker.sh');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

/** Cut one `name() { ... }` block out of the script, verbatim. */
function functionBody(name) {
  const start = SOURCE.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name}() is not in ${SCRIPT} — this test is asserting about a function that no longer exists`);
  const end = SOURCE.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name}() has no closing brace at column 0`);
  return SOURCE.slice(start, end + 3);
}

/** Every line that is actually shell, with comments and blanks dropped. */
function codeLines() {
  return SOURCE.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

test('nothing pipes `launchctl list` into grep — that pipe is the false "not loaded"', () => {
  // Anchored on the STRUCTURE (a pipe off launchctl) rather than on any phrase,
  // so a reworded comment cannot silently retire the check and a reintroduced
  // pipe cannot hide behind different spacing.
  // `||` is an OR, not a pipe: it is stripped first so `launchctl list || true`
  // — which starts no second process and can SIGPIPE nothing — is not flagged.
  const offenders = codeLines()
    .map((l) => l.replace(/\|\|/g, ' '))
    .filter((l) => /launchctl\s+list[^|]*\|/.test(l));
  assert.deepEqual(offenders, [],
    'a pipe straight off `launchctl list` SIGPIPEs it, and pipefail turns that into "not loaded"');
});

test('the loaded check asks launchctl about the one label, which takes no pipe', () => {
  const body = functionBody('is_loaded');
  assert.match(body, /launchctl\s+list\s+"\$LABEL"/,
    'it must name the label as an argument — that form exits non-zero when absent and cannot lose a pipe race');
  assert.doesNotMatch(body, /\|/, 'and it must not pipe at all');
});

test('the status output asks is_loaded, in BOTH places, rather than re-rolling the check', () => {
  // Two call sites drifted apart once already (one printed the PID line, the
  // other decided whether "the daemon has never run here" was true).
  const calls = codeLines().filter((l) => /^if is_loaded; then$/.test(l));
  assert.equal(calls.length, 2, 'both readings go through the one function');
});

test('a label that IS loaded reports as loaded — the script\'s own bytes, against a real one', (t) => {
  if (os.platform() !== 'darwin') {
    // Stated, not silent: a skip that does not say why reads as a pass.
    t.skip('launchctl exists only on macOS, so this reading cannot be taken here');
    return;
  }

  const listed = execFileSync('launchctl', ['list'], { encoding: 'utf8' }).split('\n');
  // Column 3 is the label; take one that is genuinely loaded right now.
  const real = listed.slice(1).map((l) => l.split('\t')[2]).find((l) => l && l.startsWith('com.apple.'));
  assert.ok(real, 'this machine has no loaded launchd label to test against');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-installer-'));
  const probe = path.join(dir, 'probe.sh');
  fs.writeFileSync(probe, [
    '#!/bin/bash',
    // The same three options the real script runs under — pipefail is what
    // turned the SIGPIPE into a wrong answer, so testing without it would test
    // nothing.
    'set -euo pipefail',
    `LABEL=${JSON.stringify(real)}`,
    functionBody('is_loaded'),
    functionBody('loaded_row'),
    'hits=0',
    'for _ in 1 2 3 4 5 6 7 8 9 10; do if is_loaded; then hits=$((hits + 1)); fi; done',
    'echo "hits=$hits"',
    'echo "row=$(loaded_row)"',
  ].join('\n'));

  const out = execFileSync('bash', [probe], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });

  assert.match(out, /hits=10/,
    `${real} is loaded right now, so is_loaded must say so every time — the old pipe said no 10/10`);
  assert.ok(out.includes(`row=`) && out.includes(real),
    'and the summary row names the label, so the `loaded: yes — PID` line has something to print');
});

/*
 * THE SETTINGS — 86bccuqpy. As first written, the plist ran `node daemon.js`
 * with only PATH and HOME, and the daemon loads no settings of its own: it
 * would start with no database, no Drive credential and no STUDIO_PROJECT_ID,
 * fail its first write, and be restarted by launchd once a minute forever. Now
 * it runs under `doppler run`, `--status` names what is missing, and `install`
 * refuses rather than installing a crash loop.
 *
 * These run the real script against a FAKE doppler (and a fake launchctl,
 * ffmpeg and ffprobe, so a refusal that stopped happening could never load a
 * real job on the machine running the tests). The environment is built from
 * nothing, so a real credential in the test runner's own environment cannot
 * make a missing setting read as present.
 */

const REQUIRED_FULL = {
  STUDIO_PROJECT_ID: 'proj-planted',
  STUDIO_DRIVE_INBOX_FOLDER_ID: 'inbox-planted',
  STUDIO_DRIVE_PLATES_FOLDER_ID: 'plates-planted',
  SUPABASE_URL: 'https://plantedhost.supabase.co/rest/v1?apikey=PLANTED-URL-SECRET',
  SUPABASE_SERVICE_KEY: 'PLANTED-SERVICE-KEY-VALUE',
  GOOGLE_DRIVE_CLIENT_ID: 'PLANTED-CLIENT-ID',
  GOOGLE_DRIVE_CLIENT_SECRET: 'PLANTED-CLIENT-SECRET',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'PLANTED-REFRESH-TOKEN',
};

/** A bin directory with fake doppler/launchctl/ffmpeg/ffprobe, and a home. */
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-installer-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  // doppler: `run ... -- cmd args` execs cmd with the planted settings, or
  // fails the way an unauthenticated CLI does. Records its arguments.
  fs.writeFileSync(path.join(bin, 'doppler'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, 'doppler.calls'))}, JSON.stringify(args) + '\\n');
if (process.env.FAKE_DOPPLER_MODE === 'auth-fail') {
  console.error('Doppler Error: Unable to fetch secrets from the Doppler API');
  process.exit(1);
}
const cut = args.indexOf('--');
const env = { ...process.env, ...JSON.parse(process.env.FAKE_DOPPLER_ENV || '{}') };
const r = require('child_process').spawnSync(args[cut + 1], args.slice(cut + 2), { env, stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
`, { mode: 0o755 });
  // launchctl: nothing is loaded; any bootstrap is recorded, never performed.
  fs.writeFileSync(path.join(bin, 'launchctl'), `#!/bin/bash
echo "$*" >> ${JSON.stringify(path.join(dir, 'launchctl.calls'))}
[ "$1" = list ] && exit 1
exit 0
`, { mode: 0o755 });
  for (const name of ['ffmpeg', 'ffprobe']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  }
  return { dir, bin, home };
}

function runScript(box, args, fakeEnv, mode = 'ok') {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${box.bin}:${process.env.PATH}`,
      HOME: box.home,
      FAKE_DOPPLER_MODE: mode,
      FAKE_DOPPLER_ENV: JSON.stringify(fakeEnv),
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('the plist runs the daemon under `doppler run ... --config prd`, on one line', () => {
  const out = execFileSync('bash', [SCRIPT, '--print-plist'], { encoding: 'utf8' });
  const lines = out.split('\n').filter((l) => /doppler run --scope \S+ --project starcaster --config prd --no-check-version -- /.test(l));
  assert.equal(lines.length, 1, `exactly one line carries the wrapper:\n${out}`);
  assert.match(lines[0], /workers\/studio\/daemon\.js<\/string>$/, 'and the daemon is what it runs');
  if (os.platform() === 'darwin') {
    const { spawnSync } = require('node:child_process');
    const lint = spawnSync('plutil', ['-lint', '-'], { input: out, encoding: 'utf8' });
    assert.equal(lint.status, 0, `plutil -lint: ${lint.stdout}${lint.stderr}`);
  }
});

test('the worker reads its Doppler key from ~/Studio, never the repo folder the loops\' key lives in', (t) => {
  // On the Mini the repo folder holds the read-only `dev` key every loop runs
  // on; one folder holds one key, so the worker's `prd` key lives at ~/Studio
  // and BOTH the plist and the preflight must name that scope — a preflight
  // reading a different key from the job it vouches for is a check of nothing.
  const box = sandbox(t);
  const plist = runScript(box, ['--print-plist'], REQUIRED_FULL);
  assert.match(plist.out, new RegExp(`doppler run --scope ${path.join(box.home, 'Studio')} --project starcaster`));

  const status = runScript(box, ['--status'], REQUIRED_FULL);
  assert.match(status.out, /settings: OK/, status.out);
  const calls = fs.readFileSync(path.join(box.dir, 'doppler.calls'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const runs = calls.filter((a) => a[0] === 'run');
  assert.ok(runs.length >= 1, 'the preflight ran under doppler');
  for (const a of runs) {
    assert.equal(a[a.indexOf('--scope') + 1], path.join(box.home, 'Studio'), `every doppler run names the scope: ${JSON.stringify(a)}`);
  }

  const moved = runScript(box, ['--print-plist', '--doppler-scope', '/opt/elsewhere'], REQUIRED_FULL);
  assert.match(moved.out, /doppler run --scope \/opt\/elsewhere --project starcaster/);
});

test('a Homebrew node at .../node@22/bin/node is accepted; a path with a space is still refused', (t) => {
  // The Mini's node is /opt/homebrew/opt/node@22/bin/node, and the first real
  // install (2026-10-05) refused it: `@` was not in the allowed set, though it
  // means nothing to sh or to XML.
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-installer-node-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const place = (folder) => {
    const bin = path.join(dir, folder, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    return bin;
  };
  const run = (bin) => spawnSync('bash', [SCRIPT, '--print-plist'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const versioned = run(place('node@22'));
  assert.equal(versioned.status, 0, versioned.stderr);
  assert.match(versioned.stdout, /node@22\/bin\/node \S+\/workers\/studio\/daemon\.js<\/string>/);

  const spaced = run(place('has space'));
  assert.notEqual(spaced.status, 0, 'a space is still refused rather than written unquoted');
  assert.match(spaced.stderr, /Refusing to write a plist/);
});

test('--doppler-config changes the config in the plist, and a non-name is refused', () => {
  const out = execFileSync('bash', [SCRIPT, '--print-plist', '--doppler-config', 'stg'], { encoding: 'utf8' });
  assert.match(out, /--config stg --no-check-version/);
  const { spawnSync } = require('node:child_process');
  const bad = spawnSync('bash', [SCRIPT, '--print-plist', '--doppler-config', 'x</string>'], { encoding: 'utf8' });
  assert.equal(bad.status, 2, 'a config name that would break the XML is refused');
});

test('a missing STUDIO_PROJECT_ID is named by --status, and install refuses naming it', (t) => {
  const box = sandbox(t);
  const env = { ...REQUIRED_FULL };
  delete env.STUDIO_PROJECT_ID;

  const status = runScript(box, ['--status'], env);
  assert.equal(status.code, 1, `status exits 1 when something is missing:\n${status.out}`);
  assert.match(status.out, /settings: MISSING under Doppler config "prd"/);
  assert.match(status.out, /^\s+STUDIO_PROJECT_ID$/m, 'the missing name is on its own line');
  assert.doesNotMatch(status.out, /^\s+SUPABASE_URL$/m, 'and only what is missing is named');

  const install = runScript(box, ['--install'], env);
  assert.equal(install.code, 1, `install refuses:\n${install.out}`);
  assert.match(install.out, /Refusing to install: the worker would crash-loop/);
  assert.match(install.out, /STUDIO_PROJECT_ID/);
  assert.ok(!fs.existsSync(path.join(box.home, 'Library', 'LaunchAgents', 'com.starcaster.studio-worker.plist')),
    'no plist was written');
  const calls = fs.existsSync(path.join(box.dir, 'launchctl.calls'))
    ? fs.readFileSync(path.join(box.dir, 'launchctl.calls'), 'utf8') : '';
  assert.doesNotMatch(calls, /bootstrap/, 'and nothing was loaded');
});

test('a Doppler that will not authenticate reads CANNOT TELL — never OK — and install refuses', (t) => {
  const box = sandbox(t);
  const status = runScript(box, ['--status'], REQUIRED_FULL, 'auth-fail');
  assert.equal(status.code, 2, `status exits 2 when it could not tell:\n${status.out}`);
  assert.match(status.out, /settings: CANNOT TELL/);
  assert.doesNotMatch(status.out, /settings: OK/);

  const install = runScript(box, ['--install'], REQUIRED_FULL, 'auth-fail');
  assert.equal(install.code, 2, `install refuses on a reading it could not take:\n${install.out}`);
  assert.match(install.out, /Refusing to install: could not confirm/);
});

test('everything present reads OK and names the database HOST — and no value ever appears', (t) => {
  const box = sandbox(t);
  const status = runScript(box, ['--status'], REQUIRED_FULL);
  assert.equal(status.code, 0, status.out);
  assert.match(status.out, /settings: OK/);
  assert.match(status.out, /database: the worker would write to plantedhost\.supabase\.co — the PRODUCTION database/);
  for (const [name, value] of Object.entries(REQUIRED_FULL)) {
    if (name === 'SUPABASE_URL') {
      assert.ok(!status.out.includes('PLANTED-URL-SECRET'), 'only the host of the URL is printed');
      continue;
    }
    assert.ok(!status.out.includes(value), `${name}'s value leaked into the output`);
  }
  const calls = fs.readFileSync(path.join(box.dir, 'doppler.calls'), 'utf8');
  assert.match(calls, /"--config","prd"/, 'it asked the config the plist would use');
});

test('the other spelling of the service key satisfies the requirement, and a local database is called out', (t) => {
  const box = sandbox(t);
  const env = { ...REQUIRED_FULL, SUPABASE_URL: 'http://127.0.0.1:54321' };
  delete env.SUPABASE_SERVICE_KEY;
  env.SUPABASE_SERVICE_ROLE_KEY = 'PLANTED-ROLE-KEY';
  const status = runScript(box, ['--status'], env);
  assert.equal(status.code, 0, status.out);
  assert.match(status.out, /127\.0\.0\.1 — a database on THIS machine/);
});
