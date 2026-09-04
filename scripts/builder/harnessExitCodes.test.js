/**
 * A check that could not run must not exit 0 (task 86bbt6hgx).
 *
 * The browser harnesses under `scripts/ui/` are the one family of gates CI
 * cannot run — CI has no browser — so their exit code is the only thing a
 * script, a log skim or an unattended pass ever sees. On 2026-09-02 two
 * refusals were reported as passes, and the audit found eight paths across
 * four harnesses that printed an excellent explanation of why they could
 * measure nothing and then exited 0, or exited 1 and blamed the code under
 * test for a broken instrument.
 *
 * These tests hold the scheme in place: 0 ran-and-passed, 1 ran-and-failed,
 * 2 could-not-take-a-reading. Two of them run a real harness and read its real
 * exit code — neither needs a browser, a server or a database, which is why
 * they can live in the node suite at all.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'scripts', 'ui');
const read = (f) => fs.readFileSync(path.join(UI, f), 'utf8');
/*
 * The same source with block comments stripped. These files carry long
 * explanations that QUOTE the mistakes they fixed — the first version of the
 * test below matched its own "used to run with `stdio: 'ignore'`" note and
 * failed on the fix's own documentation.
 */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');

/** The harnesses that own a precondition, and so can refuse. */
const HARNESSES = [
  'check_panels.mjs', 'check_render.mjs', 'check_screens.mjs',
  'check_nav_controls.mjs', 'shoot_changes.mjs', 'app-driver.mjs',
];

test('the verdict scheme ranks a blind run above a pass and below a failure', async () => {
  const { verdict, EXIT_PASS, EXIT_FAIL, EXIT_CANNOT_TELL } =
    await import(path.join(UI, 'harness-exit.mjs'));

  assert.equal(EXIT_PASS, 0);
  assert.equal(EXIT_FAIL, 1);
  assert.equal(EXIT_CANNOT_TELL, 2);

  assert.equal(verdict({ failures: 0, blind: 0 }), EXIT_PASS);
  assert.equal(verdict({ failures: 3, blind: 0 }), EXIT_FAIL);

  // The whole point: a clean run that could not see anything is NOT a pass.
  assert.equal(verdict({ failures: 0, blind: 1 }), EXIT_CANNOT_TELL,
    'a run with nothing to report and something it could not see must be 2, not 0');

  // A real failure outranks a blind reading — a screen that overflowed its
  // viewport overflowed it, whatever else about the run was hollow.
  assert.equal(verdict({ failures: 1, blind: 5 }), EXIT_FAIL);

  // No arguments is a pass, so a caller that forgets to pass counts cannot
  // silently become permanently blind.
  assert.equal(verdict(), EXIT_PASS);
});

test('every harness refusal goes through the shared module, so they cannot disagree', () => {
  for (const file of HARNESSES) {
    const src = read(file);
    assert.match(src, /harness-exit\.mjs/,
      `${file} does not import the shared exit-code module — a second definition of ` +
      '"could not take a reading" is how these drift apart');
    // A literal exit(2) is not wrong, but it is a refusal written without the
    // banner that makes a 2 legible in a log. Route it through cannotTell.
    assert.doesNotMatch(src, /process\.exit\(\s*2\s*\)/,
      `${file} still exits 2 by literal — use cannotTell() so the refusal prints its banner`);
  }
});

test('check_screens treats each hollow-run condition as a reading it could not take', () => {
  const src = read('check_screens.mjs');
  // The four conditions found by the audit. Each printed its own excellent
  // explanation and then exited 0.
  assert.match(src, /blind\.push\([^)]*UI_HARNESS_PROJECT_ID/,
    'an unset fixture project must count as blind — its own text says "these checks are hollow"');
  assert.match(src, /blind\.push\(`the fixture project/,
    'a project that would not activate must count as blind — screens render empty');
  assert.match(src, /blind\.push\(`\$\{throttled\}/,
    'a rate-limited run must count as blind — its own text says "treat everything above as unreliable"');
  assert.match(src, /if \(!checked\) \{\s*\n\s*blind\.push/,
    'measuring no screens at all must count as blind — "0 failing" is what a clean sweep prints too');

  assert.match(src, /process\.exitCode = code;/, 'the verdict must decide the exit code');
  assert.doesNotMatch(src, /process\.exitCode = failures\.length \? 1 : 0;/,
    'the old two-way verdict cannot come back — it is what made a hollow run green');
});

test('check_nav_controls fails to tell when a control has no fixture variant', () => {
  const src = read('check_nav_controls.mjs');
  // `broken` was collected, printed, and then never gated the exit; only
  // `dead` did. Every variant missing printed "OK — all 0 controls move the
  // rendered page" and exited 0.
  assert.match(src, /verdict\(\{ failures: 0, blind: broken\.length \}\)/,
    'an unmeasured control must reach the verdict — collecting and printing it is not enough');
  assert.match(src, /stdio: 'pipe'/,
    "a precondition failure must print the tool's own output, not a bare stack trace");
  assert.doesNotMatch(code('check_nav_controls.mjs'), /stdio: 'ignore'/,
    "stdio: 'ignore' is why a failed setup arrived with no explanation at all");
});

test('a vacuity guard is a 2, not a 1 — the instrument failed, not the code', () => {
  // Each of these says, in its own words, that it measured nothing. Exit 1
  // sends whoever reads the log hunting a defect in code that may be perfect.
  for (const [file, needles] of [
    ['check_panels.mjs', ['The fixture is INCOMPLETE', 'No panels carrying']],
    ['check_render.mjs', ['rendered no text module', 'NONE were measured']],
  ]) {
    const src = read(file);
    for (const needle of needles) {
      const at = src.indexOf(needle);
      assert.notEqual(at, -1, `${file} no longer contains the guard for "${needle}"`);
      const window = src.slice(Math.max(0, at - 400), at + 900);
      assert.match(window, /cannotTell\(/,
        `${file}: the "${needle}" guard must exit 2 — nothing about it says the code under test is wrong`);
    }
    // Exactly one exit(1) survives in each: the real assertion failure.
    const ones = src.match(/process\.exit\(1\)/g) || [];
    assert.equal(ones.length, 1,
      `${file} should have exactly one exit(1) — the genuine failure — but has ${ones.length}`);
  }
});

/*
 * The two end-to-end readings. Both refuse before opening a browser, so they
 * cost milliseconds and need no server, database or fixture.
 */

test('check:panels really exits 2 with no fixture project', () => {
  const generated = path.join(ROOT, 'lib', 'builder', 'template.js');
  if (!fs.existsSync(generated)) return; // unbuilt folder refuses one step earlier, also with 2

  const env = { ...process.env };
  delete env.UI_HARNESS_PROJECT_ID;
  const r = spawnSync(process.execPath, [path.join(UI, 'check_panels.mjs')], { env, encoding: 'utf8' });

  assert.equal(r.status, 2, `expected 2, got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /COULD NOT TAKE A READING/);
  assert.match(r.stderr, /UI_HARNESS_PROJECT_ID/);
});

test('check:shots really exits 2 when it cannot find a merge base', () => {
  const generated = path.join(ROOT, 'lib', 'builder', 'template.js');
  if (!fs.existsSync(generated)) return;

  const r = spawnSync(
    process.execPath,
    [path.join(UI, 'shoot_changes.mjs'), '--base', 'refs/heads/no-such-ref-86bbt6hgx'],
    { cwd: ROOT, encoding: 'utf8' }
  );

  assert.equal(r.status, 2, `expected 2, got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /COULD NOT TAKE A READING/);
  assert.match(r.stderr, /merge base/);
});
