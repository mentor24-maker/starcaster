#!/usr/bin/env node
'use strict';

/**
 * scripts/check_live_placeholders.cjs — render every Builder module type as a
 * VISITOR would see it, and fail on Builder-time scaffolding that reaches them.
 *
 * Ticket 86bbvqcbk. Four review rounds of 86bbugd2e each closed the placeholder
 * the round before had named and missed the next one; three were still live on
 * client sites at the end of it — "Post body will appear here when opened with
 * ?post=slug." on delraytennis.starcaster.pro/blog-post and on a law firm's
 * public site, "?event=your-event-slug" on the events page, and "Use the Create
 * Post module" on five published pages across two tenants.
 *
 * check_builder_only_notes.cjs GREPS the source, and could not have found any
 * of those three: none carries a phrase on its list and none is an
 * `x.length ? x : PLACEHOLDER` fallback — they are plain JSX branches. The only
 * way to see them is to render the module and read the text. So this is the
 * sibling gate, and the two are complementary rather than redundant:
 *
 *   check:builder-notes      static, fast, catches a KNOWN PHRASE anywhere
 *   check:live-placeholders  renders 61 module types in 3 placements, catches
 *                            a phrase FAMILY wherever it actually comes out
 *
 * The sweep itself is a vitest file, because rendering React needs jsdom and
 * the repo already has that wired. This script exists so it is also a named,
 * blocking gate in pre-commit and CI — the same reason check_builder_only_notes
 * is its own step rather than a rule folded into check_conventions --all, which
 * runs continue-on-error in CI.
 *
 *   npm run check:live-placeholders
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SWEEP = 'components/builder-live-placeholder-sweep.test.tsx';
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/**
 * The three verdicts, the same scheme scripts/ui/harness-exit.mjs states for
 * the browser gates (that module is ESM; this gate is CJS, so the codes are
 * repeated rather than imported):
 *
 *   0  every module type rendered visitor-safe text
 *   1  a module leaks Builder-time text to visitors — a defect in the code
 *   2  could not take a reading — says NOTHING about the code
 *
 * The 2 exists because this gate had exactly the failure that scheme was
 * written against (ticket 86bbvqcbk, round-2 review). spawnSync only sets
 * `result.error` when the SPAWN fails; a missing node_modules/vitest is node
 * exiting 1, which landed in the status branch and printed "Blocked — a module
 * renders Builder-time text to visitors". A fresh worktree before `npm ci` is
 * routine here, so the routine case was a could-not-take-a-reading wearing a
 * defect's clothes, sending the reader to guard something on `liveSite`.
 */
const EXIT_FAIL = 1;
const EXIT_CANNOT_TELL = 2;

function leaks(message) {
  console.error(`\n[live-placeholders] BLOCKED — exiting ${EXIT_FAIL}.\n\n${message}\n`);
  process.exit(EXIT_FAIL);
}

function cannotTell(message) {
  console.error(
    `\n[live-placeholders] COULD NOT TAKE A READING — exiting ${EXIT_CANNOT_TELL}.\n\n` +
    `${message}\n`);
  process.exit(EXIT_CANNOT_TELL);
}

// Never a silent pass: a renamed or deleted sweep is the check not running,
// which is not the same as the check finding nothing. It is a 2 and not a 1 —
// the modules could all be perfect and this would still happen.
if (!fs.existsSync(path.join(ROOT, SWEEP))) {
  cannotTell(
    `${SWEEP} is missing.\n` +
    '    That file IS this gate. If it moved, update SWEEP here; if it was\n' +
    '    deleted, 61 module types are no longer being rendered for visitors.');
}

if (!fs.existsSync(VITEST)) {
  cannotTell(
    'vitest is not installed in this checkout.\n' +
    `    Looked for ${path.relative(ROOT, VITEST)}.\n` +
    '    Run `npm ci` here and try again. Nothing was rendered, so this says\n' +
    '    nothing about whether any module leaks.');
}

const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-placeholders-'));
const reportFile = path.join(reportDir, 'report.json');

// This gate runs on every commit; a temp directory left behind per run adds up.
process.on('exit', () => {
  try { fs.rmSync(reportDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

/*
 * --passWithNoTests=false because vitest.config.ts sets it TRUE, so a filter
 * matching no file exits 0 — and this gate would then print "every module type
 * renders visitor-safe text" having rendered nothing. The json report below
 * catches that case anyway (0 tests is a 2, not a pass); the flag is the belt
 * to that braces, and this PR's own history has two instances of
 * green-while-measuring-nothing.
 */
const result = spawnSync(
  process.execPath,
  [VITEST, 'run', SWEEP, '--passWithNoTests=false',
    '--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CI: '1' } },
);

if (result.error) {
  cannotTell(
    `vitest did not start (${result.error.message}).\n` +
    '    Nothing was rendered, so this says nothing about whether any module\n' +
    '    leaks. Run `npm ci` and try again.');
}

/*
 * The report, not the exit status, is what decides between 1 and 2. vitest
 * exits 1 for a failing assertion AND for a config error, an import that threw
 * and a filter that matched nothing — only the first of those is a defect in
 * the modules.
 */
let report = null;
try {
  report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
} catch (err) {
  cannotTell(
    `vitest ran but wrote no readable report (${err.message}).\n` +
    `    Expected json at ${reportFile}. vitest exited ${result.status}. Its\n` +
    '    output is above; a config error or a failed import looks like this.\n' +
    '    Until it is fixed, no module has been rendered and nothing is known.');
}

const total = Number(report.numTotalTests ?? 0);
const failed = Number(report.numFailedTests ?? 0);

if (total === 0) {
  cannotTell(
    'the sweep ran and contained no tests.\n' +
    `    ${SWEEP}\n` +
    '    exists but produced 0 assertions, so no module type was rendered.\n' +
    '    A gate that measures nothing must not report a pass.');
}

if (failed > 0) {
  leaks(
    'a module renders Builder-time text to visitors.\n' +
    `    ${failed} of ${total} assertions failed. The failing test names the\n` +
    '    module, the placement and the phrase, and prints what a visitor would\n' +
    '    actually read.\n\n' +
    '    Guard it on `liveSite`: render nothing, or ordinary visitor copy that\n' +
    '    names the reason (landmine 17). Where the note is ALL the module would\n' +
    '    render, return null — a lone heading over empty space is the same\n' +
    `    defect. If the module is genuinely admin-only, add it to ADMIN_ALLOWED\n` +
    `    in ${SWEEP} WITH ITS REASON.`);
}

if (result.status !== 0) {
  cannotTell(
    `every assertion passed but vitest exited ${result.status}.\n` +
    '    Something outside the assertions failed — a teardown, an unhandled\n' +
    '    rejection, a worker crash. The reading is not trustworthy; do not\n' +
    '    read it as a pass.');
}

console.log(
  `[live-placeholders] OK — ${total} assertions: every module type renders ` +
  'visitor-safe text in all three placements.');
