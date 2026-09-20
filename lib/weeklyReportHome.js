'use strict';

/**
 * Where the weekly report is allowed to write — and the check that it is not
 * inside anybody's code checkout.
 *
 * WHY THIS FILE EXISTS (task 86bc0nbwq). The report used to write
 * docs/reports/<date>.html, <date>.data.json and a rewritten index.html into
 * the checkout it ran from. Those files make `git status` non-empty, and the
 * Mini's automatic self-update refuses to run over uncommitted work — so one
 * report run switched off the machine's updates and it silently kept running
 * last week's pipeline code.
 *
 * On 2026-09-14 that cost 7 merges: the Mini missed every pipeline fix shipped
 * on 2026-09-13 (#689, #700) until an agent session backed the leftovers up and
 * restored the checkout by hand. run_weekly_report.sh already carried two
 * separate cleanup passes written against exactly this, and they did not
 * prevent it — which is the argument for not writing there at all rather than
 * for a third cleanup.
 *
 * Dane, 2026-09-14: "It shouldn't be saved to the Mini. It should either be
 * saved to the MacBook and/or Google Drive in the Projects/Starcaster folder in
 * a dedicated sub-folder."
 *
 * So the report's home is a plain folder in the operator's home directory —
 * the staging copy that gets uploaded to Drive — and THIS MODULE REFUSES if
 * that folder turns out to sit inside a git checkout. The refusal matters more
 * than the default: the default can be overridden with WEEKLY_REPORT_DIR, and
 * an override pointing back into a repo would quietly reopen the whole thing.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** The folder the report writes into, unless WEEKLY_REPORT_DIR says otherwise. */
const DEFAULT_HOME = path.join('Documents', 'Starcaster', 'Weekly Reports');

/**
 * `dir` with symlinks resolved as far as it actually exists on disk.
 *
 * The folder itself usually does NOT exist yet — the first run creates it — so
 * realpath cannot simply be called on it. But the guard below has to follow
 * symlinks or it fails open through the easiest door there is: a tidy-looking
 * ~/Documents/Starcaster that is a symlink INTO a repo reads as outside every
 * checkout if you only ever call path.resolve.
 */
function resolveThroughLinks(dir) {
  let current = path.resolve(dir);
  const tail = [];
  for (;;) {
    if (fs.existsSync(current)) {
      let real = current;
      try { real = fs.realpathSync(current); } catch { /* unreadable: use it as given */ }
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(dir);
    tail.push(path.basename(current));
    current = parent;
  }
}

/**
 * The git checkout containing `dir`, or null.
 *
 * It walks up looking for a `.git` entry of EITHER kind: a directory in an
 * ordinary checkout, a file in a linked worktree. Checking only for a directory
 * would call every worktree "outside a checkout", which is the one place this
 * guard most needs to fire — a worktree is deleted when its thread ships.
 *
 * No `git` process: this runs inside a launchd job with almost no environment,
 * and a guard that needs a tool on PATH is a guard that can fail open.
 */
function checkoutContaining(dir) {
  let current = resolveThroughLinks(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Where this run may write. Absolute, never created here.
 *
 * `env` is a parameter so a test can ask the question without editing the
 * process it is running in.
 */
function reportHome(env = process.env) {
  const override = String(env.WEEKLY_REPORT_DIR || '').trim();
  if (override) return path.resolve(override);
  return path.join(env.HOME || os.homedir(), DEFAULT_HOME);
}

/**
 * The verdict, in words, so the caller can print it rather than invent one.
 *
 * Returns { ok: true, dir } or { ok: false, dir, checkout, message }. It does
 * not throw — a refusal here is a thing the Monday job has to REPORT, and an
 * exception stack is not a sentence the operator can act on.
 */
function checkReportHome(env = process.env) {
  const dir = reportHome(env);
  const checkout = checkoutContaining(dir);
  if (!checkout) return { ok: true, dir, checkout: null };
  return {
    ok: false,
    dir,
    checkout,
    message: `The weekly report would write into ${dir}, which is inside the git checkout at `
      + `${checkout}. Report output left in a checkout makes it dirty, and a dirty checkout `
      + `stops that machine updating itself — the exact failure this was moved out for `
      + `(task 86bc0nbwq). Point WEEKLY_REPORT_DIR at a folder outside every repo.`,
  };
}

module.exports = {
  DEFAULT_HOME,
  checkReportHome,
  checkoutContaining,
  reportHome,
  resolveThroughLinks,
};
