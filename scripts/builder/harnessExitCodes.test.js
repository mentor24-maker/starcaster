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
    //
    // Scanned over `code(file)`, not `read(file)`: these files' comments quote
    // the very calls they replaced, so the raw source version of this
    // assertion would fail CI the moment somebody documented the old shape —
    // which is the trap this file's own header describes, and which the
    // neighbouring `stdio: 'ignore'` assertion already avoids the same way.
    assert.doesNotMatch(code(file), /process\.exit\(\s*2\s*\)/,
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
    ['check_render.mjs', ['NONE were measured']],
  ]) {
    const src = read(file);
    for (const needle of needles) {
      const at = src.indexOf(needle);
      assert.notEqual(at, -1, `${file} no longer contains the guard for "${needle}"`);
      /*
       * The guard must feed the blind list or refuse outright — never push a
       * failure. check_panels collects its two into `blind` and refuses at the
       * end (so a real W0/W9 violation can outrank it — see the ordering test
       * below); check_render refuses on the spot, having nothing to outrank.
       */
      const window = src.slice(Math.max(0, at - 400), at + 900);
      assert.match(window, /cannotTell\(|blind\.push\(/,
        `${file}: the "${needle}" guard must end in a 2 — nothing about it says the code under test is wrong`);
      assert.doesNotMatch(window, /failures\.push\(|allFailures\.push\(/,
        `${file}: the "${needle}" guard must not report a failure — the instrument was blind, ` +
        'and calling that a defect sends the reader hunting a bug that is not there');
    }
    /*
     * Exactly one exit(1) survives in each: the real assertion failure.
     *
     * Counted over `code(file)`, for the same reason the exit(2) scan above
     * is — and this one proved it the hard way. check_render's helper carries
     * a comment saying "one process.exit(1) in the file", and counting the RAW
     * source found two: the call and the sentence describing it.
     */
    const ones = code(file).match(/process\.exit\(1\)/g) || [];
    assert.equal(ones.length, 1,
      `${file} should have exactly one exit(1) — the genuine failure — but has ${ones.length}`);
  }

  // And whatever check_panels put in that list has to actually reach a 2.
  assert.match(code('check_panels.mjs'), /cannotTell\('check:panels', blind\./,
    'check_panels collects its blind reasons but never refuses with them — a list nothing reads ' +
    'is the same defect as no list at all');
});

test('the check:render baseline guard is a 1 — a dead preview surface is a defect', () => {
  /*
   * The one guard that went the OTHER way and had to come back (review round
   * 1). A baseline that will not render has exactly two causes: a stale bundle
   * or a broken preview surface. `ensureBuildIsCurrent` catches the stale
   * bundle earlier and exits 2, so by the time this guard is reached the only
   * live explanation is the code under test — and calling that a broken
   * instrument is the same 1-vs-2 mistake this whole ticket is about.
   */
  const src = read('check_render.mjs');
  const at = src.indexOf('rendered no text module');
  assert.notEqual(at, -1, 'check_render no longer guards the baseline render');

  const window = src.slice(at, at + 600);
  assert.match(window, /reportFailures\(/,
    'the baseline guard must report a FAILURE — a preview surface that does not render is the ' +
    'change\'s defect, not a broken instrument');
  assert.doesNotMatch(window, /cannotTell\(/,
    'the baseline guard must not refuse: the only instrument cause (a stale build) is already ' +
    'caught by ensureBuildIsCurrent, which exits 2 well before this line');

  // And the guard that DOES own the stale-build case still runs first.
  assert.ok(src.indexOf('ensureBuildIsCurrent(BASE_URL)') < at,
    'ensureBuildIsCurrent must run before the baseline guard, or the stale-build case ' +
    'reaches a guard that now calls it a failure');
});

test('a real failure outranks a could-not-tell — the refusal never short-circuits it', () => {
  /*
   * THE ROUND-1 SEND-BACK, held in place.
   *
   * `verdict()` encodes the ranking and DOCTRINE §5.33 states it, but three
   * harnesses called `cannotTell()` ABOVE their failure block, so the refusal
   * exited 2 and the real failures were never printed:
   *
   *   - check_render, every contract failing R1 → failures 41, measured 0 → 2
   *   - check_panels, a partial fixture plus a genuine W0/W9 violation → 2
   *
   * Both now compute `verdict()` first and act on it, the way check_screens
   * always did. Asserting on POSITION is the point: the bug was ordering, and
   * an assertion that only proved both calls exist would have passed on the
   * broken code.
   */
  for (const [file, needle] of [
    ['check_render.mjs', 'NONE were measured'],
    ['check_panels.mjs', 'No panels carrying'],
  ]) {
    const src = code(file);
    const verdictAt = src.indexOf('verdict({ failures:');
    assert.notEqual(verdictAt, -1,
      `${file} must reach its exit through verdict(), which is where the ranking lives`);

    const refusalAt = src.lastIndexOf('cannotTell(');
    assert.notEqual(refusalAt, -1, `${file} no longer refuses at all`);
    assert.ok(verdictAt < refusalAt,
      `${file}: the vacuity refusal runs BEFORE the verdict is computed, so a run with real ` +
      'failures exits 2 and prints none of them — that is the round-1 defect');

    // The failure branch must be gated on the verdict too, not on its own
    // separate `if (failures.length)` sitting below a refusal that already
    // exited.
    assert.match(src.slice(verdictAt, refusalAt), /code === EXIT_FAIL/,
      `${file}: the failure report must be selected by the verdict, so it cannot be skipped`);
  }
});

test('check:shots answers 0 or 2 and never 1 — it photographs, it does not judge', () => {
  /*
   * Three instrument-shaped stops (no shell on the control scene, the control
   * differing from itself, a scene rendering nothing) all exited 1. This tool
   * makes no assertion about the code at all, so it has no honest use for a
   * code that means "your change is wrong".
   */
  const src = code('shoot_changes.mjs');
  assert.doesNotMatch(src, /process\.exit\(1\)/,
    'check:shots must not exit 1 — it never judges the change, so every stop is a broken camera');
  assert.match(src, /if \(failure\) \{\s*\n\s*cannotTell\(/,
    'the single failure path must refuse with cannotTell so the 2 prints its banner');
});

test('check_screens counts every skipped screen as unmeasured, not just an empty run', () => {
  // 8 of 9 screens skipped with 1 measured printed "0 failing" and exited 0.
  // The line between 0 and 1 measured was arbitrary: both skip paths are the
  // screen failing to load, which is unmeasured by this file's own definition.
  const src = code('check_screens.mjs');
  assert.match(src, /\} else if \(skipped > 0\) \{\s*\n\s*blind\.push\(/,
    'a partly-skipped run must count as blind — an unreachable screen is not a clean one');
});

test('a precondition that talks a lot is not mistaken for one that failed', () => {
  // execFileSync's default maxBuffer is 1 MiB. A build or a vitest run exceeds
  // it, the child is killed, and the ENOBUFS was reported as "the fixture
  // failed" — a refusal on a setup that was working.
  const src = code('check_nav_controls.mjs');
  assert.match(src, /maxBuffer:/,
    "prepare() must raise maxBuffer, or a chatty build is killed and blamed for failing");
  assert.match(src, /ENOBUFS/,
    'and if the buffer is exceeded anyway, the refusal must say so rather than blaming the fixture');
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
