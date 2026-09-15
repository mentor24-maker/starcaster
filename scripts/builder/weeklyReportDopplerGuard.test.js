'use strict';

/**
 * THE MONDAY RUN CAN REACH ITS GOOGLE CREDENTIAL.
 *
 * This file exists because of one measured failure (round 1 of task 86bc0nbwq).
 * `scripts/run_weekly_report.sh` called `node scripts/weekly_report.mjs
 * --publish` directly. launchd hands that script a PATH and a HOME and nothing
 * else — no Doppler, so no GOOGLE_DRIVE_* values in the environment — so the
 * upload to Drive could not even sign in. Every Monday would have reported a
 * failure, with the report sitting on one machine's disk and nowhere else,
 * which is the exact outcome the whole ticket was filed to prevent.
 *
 * IT HID PERFECTLY, and that is why a test is worth having rather than a
 * comment. Every way a person exercises this by hand supplies the credential:
 * `doppler run -- node scripts/weekly_report.mjs --publish` works, a shell with
 * the variables already exported works, `npm run report:weekly` works. Only the
 * scheduled invocation — the one nobody watches — was blind, and it reported a
 * clean-looking failure into a log file.
 *
 * The precedent is scripts/builder/clickupCaller.test.js, which pins that every
 * scheduled launcher declares itself. This is the same class of defect: a job
 * that runs unattended and cannot reach a credential.
 *
 * THESE ARE SOURCE ASSERTIONS ON PURPOSE. Running the real thing needs Doppler,
 * a Google account and a network, so a test that ran it would be skipped in CI
 * and would therefore pin nothing. What can be checked cheaply and always is
 * the two halves of the arrangement: the wrapper goes through `npm run`, and
 * the npm script it names is Doppler-wrapped. Undo either one and this fails.
 * The end-to-end proof is the break test recorded on the ticket — the wrapper
 * run under `env -i` with only PATH and HOME set, the same pair the plist
 * provides.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const WRAPPER = path.join(REPO, 'scripts', 'run_weekly_report.sh');

/** The wrapper's lines with comments and blanks dropped — what actually runs. */
function codeLines(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'));
}

function packageScripts() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts || {};
}

test('the scheduled weekly report is invoked through an npm script, not a bare node', () => {
  const lines = codeLines(WRAPPER);

  // The seam is allowed to call node directly — it stands in a FAKE report, and
  // launchd never sets it. Everything else that runs the real report must go
  // through npm, because npm is where the Doppler wrapper lives.
  const seamGuarded = lines.some((l) => l.includes('WEEKLY_REPORT_NODE'));
  assert.ok(seamGuarded, 'the test seam is still named in the wrapper');

  const realRun = lines.filter((l) => l.includes('report:weekly'));
  assert.ok(realRun.length >= 1,
    'the wrapper must run the report through `npm run report:weekly` — a bare `node '
    + 'scripts/weekly_report.mjs` runs with no Doppler under launchd, so the Google '
    + 'credential is invisible and the upload never even tries (round 1, 86bc0nbwq)');

  for (const line of realRun) {
    assert.match(line, /npm run (--silent )?report:weekly/,
      `"${line.trim()}" names report:weekly but does not run it through npm`);
    assert.match(line, /--publish/, 'the scheduled run publishes');
    assert.match(line, /--as-of/, 'and pins the window to a finished day');
  }

  // A bare `node scripts/weekly_report.mjs` outside the seam is the defect
  // itself coming back.
  const bareNode = lines.filter((l) => /(^|[^A-Z_])node\s+scripts\/weekly_report\.mjs/.test(l)
    && !l.includes('WEEKLY_REPORT_NODE'));
  assert.deepEqual(bareNode, [],
    'a bare `node scripts/weekly_report.mjs` in the wrapper gets no Doppler under launchd');
});

test('report:weekly carries the Doppler wrapper — the other half of the same fix', () => {
  const scripts = packageScripts();
  assert.ok(scripts['report:weekly'], 'the npm script still exists');
  assert.match(scripts['report:weekly'], /^doppler run /,
    'report:weekly must be Doppler-wrapped: it is what the Monday schedule runs, and without it '
    + 'the Google credential is not in the environment (round 1, 86bc0nbwq)');
  assert.match(scripts['report:weekly'], /--project starcaster --config dev/,
    'the same project and config every other scheduled script here uses');
  assert.match(scripts['report:weekly'], /node scripts\/weekly_report\.mjs/,
    'and it still runs the report');
});

test('the failure reporter has ONE name, and the wrapper uses it', () => {
  // `report:job-failure` was added beside the existing `report:failure`,
  // byte-identical. Two names for one command drift apart — and the
  // scheduled-caller detector in clickupCaller.test.js matches on the string
  // `report:failure`, so a wrapper whose only ClickUp call went through the
  // other name would be invisible to it and would never be held to declaring
  // itself scheduled.
  const scripts = packageScripts();
  assert.ok(scripts['report:failure'], 'report:failure is the name');
  assert.equal(scripts['report:job-failure'], undefined,
    'report:job-failure was a duplicate of report:failure and does not come back');

  const src = fs.readFileSync(WRAPPER, 'utf8');
  assert.match(src, /npm run --silent report:failure/, 'the wrapper reports failures under that name');
});

test('a run that refuses before it starts is reported too, not only a failed publish', () => {
  // The early return for "could not work out yesterday's date" sat ABOVE the
  // failure block at the bottom of the file, so the one path that refuses to
  // run at all was the one path nobody heard about.
  const src = fs.readFileSync(WRAPPER, 'utf8');
  const early = src.slice(src.indexOf('refusing to report on a partial week'));
  const untilExit = early.slice(0, early.indexOf('exit 1'));
  assert.match(untilExit, /report_failure/,
    'refusing to run is still a Monday with no report, and has to make the same noise');

  // And the reporter is reachable from there: defined above its first use.
  const lines = codeLines(WRAPPER);
  const defined = lines.findIndex((l) => l.includes('report_failure()'));
  const firstUse = lines.findIndex((l) => /^\s*report_failure /.test(l));
  assert.ok(defined >= 0, 'report_failure is defined');
  assert.ok(firstUse > defined,
    'bash reads top to bottom — a function used before it is defined is a "command not found" '
    + 'on the one path whose job is not to fail quietly');
});
