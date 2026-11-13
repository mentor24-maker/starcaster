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

/**
 * The folder the report writes into, unless WEEKLY_REPORT_DIR says otherwise.
 *
 * NOT UNDER ~/Documents (SC-797). macOS privacy protection does not let a
 * scheduled (launchd) job read ~/Documents, ~/Desktop or ~/Downloads unless the
 * program has been granted access in System Settings. It let the Monday job
 * CREATE the week's files there but not LIST the folder, so from 2026-09-28 every
 * run wrote its edition and then died rebuilding the index — before the Drive
 * upload — five Mondays running. A plain folder in the home directory is not
 * protected, so the job needs nobody to click anything.
 */
const DEFAULT_HOME = path.join('Starcaster', 'Weekly Reports');

/** Where the report used to live, and the editions already there. */
const LEGACY_HOME = path.join('Documents', 'Starcaster', 'Weekly Reports');

/**
 * The folders macOS guards against scheduled jobs (relative to HOME). A default
 * inside one of these is the SC-797 failure again; a test pins that it is not.
 */
const PROTECTED_FOLDERS = ['Documents', 'Desktop', 'Downloads', path.join('Library', 'Mobile Documents')];

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

/**
 * Copy the editions from the old ~/Documents folder into the new home, once.
 *
 * Only for the DEFAULT home — an explicit WEEKLY_REPORT_DIR is somebody's
 * deliberate choice and is left alone. A file already in the new home is never
 * overwritten (it may carry the narrative written on it), and nothing is
 * deleted from the old folder.
 *
 * It never throws. Under launchd the old folder is exactly the one macOS will
 * not let this job list, so "could not read it" is an expected answer, returned
 * as a sentence for the log — and the report goes on, because the new home
 * works regardless.
 *
 * Returns { copied: [names], kept: [names], reason: string|null }.
 */
function carryOverLegacyEditions(env = process.env) {
  const result = { copied: [], kept: [], reason: null };
  if (String(env.WEEKLY_REPORT_DIR || '').trim()) {
    result.reason = 'WEEKLY_REPORT_DIR is set, so there is nothing to carry over';
    return result;
  }
  const home = env.HOME || os.homedir();
  const legacy = path.join(home, LEGACY_HOME);
  const target = reportHome(env);
  if (!fs.existsSync(legacy)) {
    result.reason = `no old folder at ${legacy}`;
    return result;
  }
  let names;
  try {
    names = fs.readdirSync(legacy);
  } catch (err) {
    result.reason = `could not read the old folder ${legacy} (${err.code || err.message}) — `
      + 'its editions stay there; copy them across by hand from a logged-in session';
    return result;
  }
  const editions = names.filter((f) => /^\d{4}-\d{2}-\d{2}\.(html|data\.json)$/.test(f));
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const name of editions) {
      const to = path.join(target, name);
      if (fs.existsSync(to)) { result.kept.push(name); continue; }
      fs.copyFileSync(path.join(legacy, name), to, fs.constants.COPYFILE_EXCL);
      result.copied.push(name);
    }
  } catch (err) {
    result.reason = `stopped carrying editions over (${err.code || err.message})`;
  }
  return result;
}

module.exports = {
  DEFAULT_HOME,
  LEGACY_HOME,
  PROTECTED_FOLDERS,
  carryOverLegacyEditions,
  checkReportHome,
  checkoutContaining,
  reportHome,
  resolveThroughLinks,
};
