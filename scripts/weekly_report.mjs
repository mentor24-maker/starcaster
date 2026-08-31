#!/usr/bin/env node
/**
 * The weekly report — the figures half, gathered on a schedule.
 *
 * WHY THIS EXISTS (task 86bbkw1mn). Dane, 2026-08-24, after the first edition
 * was assembled by hand: "Let's schedule a weekly report to run, and save it to
 * an html file in Starcaster." That first edition took most of an afternoon,
 * and essentially all of it was gathering — every figure came out of a command.
 *
 * SO THIS SCRIPT GATHERS AND STOPS. It writes a complete figures page plus a
 * machine-readable copy of every number on it, and leaves a visible empty slot
 * where the narrative goes. It does not write prose. The ranked five, the
 * plain-language summaries, the "your inputs" section and the incident
 * write-ups are judgement, and a generated paragraph would be worse than no
 * paragraph. Ten minutes of writing on top of complete figures, instead of an
 * afternoon.
 *
 *   node scripts/weekly_report.mjs                  # 7 days ending today
 *   node scripts/weekly_report.mjs --window 14
 *   node scripts/weekly_report.mjs --out /tmp/x.html
 *   node scripts/weekly_report.mjs --publish        # + branch, commit, PR, ticket
 *
 * THE HONESTY RULE. A source that fails produces "not available" WITH ITS
 * REASON on the page, and the run still finishes and exits 0. A report that
 * silently drops a metric reads as though the metric was fine, and the reader
 * cannot tell "zero" from "we didn't look" (DOCTRINE §3.11). Nothing here is
 * ever estimated to fill a hole.
 *
 * ONLY MERGED WORK COUNTS. A `(#373)` in a subject line is not evidence that
 * #373 merged — the first edition credited exactly that PR while it was still
 * open. The check is GitHub's own state, and it is the reason this script asks
 * `gh` for the merged set instead of trusting git alone.
 *
 * WHERE IT WRITES. `docs/reports/YYYY-MM-DD.html` and `.data.json`, COMMITTED.
 * These are records, the same category as docs/WORK-LOG.md — not build
 * artifacts. They are deliberately absent from .gitignore and from
 * check_conventions' generated list: a report that vanishes on the next build
 * is not a record.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = require(path.join(REPO, 'scripts/builder/weeklyReport.js'));
const { run: runCommand } = require(path.join(REPO, 'scripts/builder/runCommand.js'));
const { checkRole } = require(path.join(REPO, 'lib/nodeRoles.js'));

const REPORTS_DIR = path.join(REPO, 'docs', 'reports');
const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const GH_REPO = 'mentor24-maker/starcaster';
// How many CI runs to ask GitHub for. Big enough that a normal week comes back
// whole — this repo ran 466 in one seven-day window — and finite so that a
// runaway range cannot hang the Monday job. Reaching it is not silently
// tolerated: see gatherCiMedian.
const CI_RUN_LIMIT = 1000;

// ── Arguments ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

if (flag('help')) {
  console.log(`Usage: node scripts/weekly_report.mjs [options]

  --window <n>     days in the window, ending today (default 7)
  --as-of <date>   the day the window ends (default today) — makes a run reproducible
  --out <path>     write the HTML here instead of docs/reports/<date>.html
  --publish        commit to a branch, open a PR, and file the narrative ticket
  --no-tests       skip the test-suite figure (it prints "not available" with that reason)
  --help

Figures only. The narrative is a person's job — see the ticket in the Loop Queue
this run files, or write it straight onto the page.`);
  process.exit(0);
}

// --out AND --publish DO NOT COMBINE, and the reason is not tidiness.
// Publishing copies the report into a throwaway worktree using its path
// RELATIVE TO THE REPO. An --out inside docs/reports/ makes that a copy of the
// file onto itself; an --out anywhere else makes it a relative path that climbs
// out of the worktree entirely (`../../tmp/x.html`), writing who-knows-where or
// failing with a message about a directory nobody asked for. Neither is a thing
// to leave for a Monday morning. Use --out to look at a report, --publish to
// ship one.
if (flag('publish') && arg('out')) {
  console.error('--out and --publish do not combine.\n');
  console.error('Publishing copies the report into docs/reports/ on a branch of its own, so it has');
  console.error('to know where inside the repo the file belongs. An --out path is somewhere else by');
  console.error('definition. Run one or the other:');
  console.error('  node scripts/weekly_report.mjs --out /tmp/look.html     # just look at it');
  console.error('  node scripts/weekly_report.mjs --publish                # branch, PR, ticket');
  process.exit(2);
}

const WINDOW_DAYS = Math.max(1, Number(arg('window', '7')) || 7);
// `toLocaleDateString('en-CA')` is YYYY-MM-DD in LOCAL time. `toISOString()`
// would be UTC, and a run at 11pm local is already tomorrow in UTC — which
// would date the report a day into the future and pick the wrong window with
// it. The report's day is the operator's day, not Greenwich's.
const AS_OF = arg('as-of') || new Date().toLocaleDateString('en-CA');
if (!/^\d{4}-\d{2}-\d{2}$/.test(AS_OF)) {
  console.error(`--as-of "${AS_OF}" is not a YYYY-MM-DD date.`);
  process.exit(2);
}
const WINDOW = R.windowRange(AS_OF, WINDOW_DAYS);
const OUT_HTML = arg('out') ? path.resolve(arg('out')) : path.join(REPORTS_DIR, `${AS_OF}.html`);
const OUT_JSON = R.dataPathFor(OUT_HTML);

// ── Running things ─────────────────────────────────────────────────────────

/**
 * Run a command and come back with a verdict, never an exception.
 *
 * Every figure below is allowed to fail, and each failure has to arrive as a
 * SENTENCE — that reason is printed on the page. So the reason is built here,
 * where what was actually run is still in scope, rather than in a catch block
 * that only knows something went wrong.
 */
// Shelling out lives in its own module so a test can reach it — the reasoning,
// and the two bugs that paid for it, are written down there.
const run = (cmd, args, opts = {}) => runCommand(cmd, args, { cwd: REPO, ...opts });

/**
 * A scratch file for a command that only takes `--body-file`, written OUTSIDE
 * the repo.
 *
 * These used to be written to the repo root and unlinked on the way out. That
 * works right up until a run is killed mid-publish, or `run()` throws before
 * the unlink — and then an untracked `.weekly-report-ticket.md` sits at the
 * root forever. `git status --porcelain` is non-empty from then on, so the
 * wrapper's self-update skips every week, and the machine quietly runs frozen
 * code: the exact deadlock the docs/reports/ cleanup was added to fix, coming
 * back through a second door. A file the repo cannot see cannot wedge it, so
 * the fix is to put them somewhere the repo has no opinion about rather than to
 * remember to delete them.
 */
function scratchFile(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-report-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return {
    path: file,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    },
  };
}

/** A figure whose gathering threw rather than failing cleanly still says why. */
function gather(label, fn) {
  try {
    const out = fn();
    if (!out || out.ok !== true) process.stderr.write(`  ${label}: not available — ${out && out.reason}\n`);
    else process.stderr.write(`  ${label}: read\n`);
    return out;
  } catch (err) {
    const reason = `gathering it threw (${err && err.message ? err.message : err})`;
    process.stderr.write(`  ${label}: not available — ${reason}\n`);
    return R.notAvailable(reason);
  }
}

// ── The figures ────────────────────────────────────────────────────────────

/**
 * Commits on main in the window, and which pull request each one was.
 *
 * Two sources, on purpose. git says WHAT landed and which files it touched;
 * GitHub says whether it was really a merged pull request. Trusting git alone
 * is what put an open PR in the first edition's shipped list.
 */
function gatherMerges() {
  const since = `${WINDOW.from}T00:00:00`;
  const until = `${WINDOW.to}T23:59:59`;
  const log = run('git', ['log', 'origin/main', `--since=${since}`, `--until=${until}`, '--date=short', '--format=%H%x09%ad%x09%s']);
  if (!log.ok) return { merges: R.notAvailable(log.reason), candidates: [] };

  const rows = log.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const commits = rows.map((line) => {
    const [sha, date, ...rest] = line.split('\t');
    return { sha, date, subject: rest.join('\t') };
  });

  // Which of these are pull requests at all? A direct commit to main has no
  // `(#N)` and is not counted as a PR — it is real work, but it is not a merge.
  const candidates = [];
  for (const c of commits) {
    const parsed = R.parseMergeSubject(c.subject);
    if (!parsed) continue;
    const files = run('git', ['show', '--name-only', '--format=', c.sha]);
    const paths = files.ok ? files.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    candidates.push({ number: parsed.number, title: parsed.title, date: c.date, sha: c.sha, paths });
  }

  // THE RECENT-MERGED SLICE IS A FAST PATH, NEVER THE ANSWER.
  //
  // `gh pr list --state merged --limit 300` returns the 300 most recently
  // CREATED merged pull requests, which on this repo reaches back only as far
  // as #128. Reading "absent from that slice" as "not merged" is the mistake
  // that made `--as-of 2026-08-10 --window 7` report TWO merges for a week
  // that had forty-three: forty-one real merges were classed NOT-MERGED and
  // dropped, and the page printed the 2 with no hint anything was missing.
  //
  // So the slice may only ever CONFIRM. A number in it is merged, full stop.
  // Anything it does not vouch for is asked about one at a time, and anything
  // GitHub still will not answer for is counted as unconfirmed ON THE PAGE
  // rather than quietly discarded. For a current window almost every candidate
  // is inside the slice, so this stays one call in the ordinary case.
  const list = run('gh', ['pr', 'list', '--repo', GH_REPO, '--state', 'merged', '--limit', '300', '--json', 'number,state'], { timeout: 120000 });
  let vouched = new Set();
  let sliceReason = null;
  if (!list.ok) {
    sliceReason = list.reason;
  } else {
    try {
      vouched = new Set(JSON.parse(list.stdout).map((p) => Number(p.number)));
    } catch (err) {
      sliceReason = `GitHub's merged-PR list did not parse as JSON (${err.message})`;
    }
  }

  const stated = [];
  const unconfirmedReasons = [];
  let unconfirmed = 0;
  for (const c of candidates) {
    if (vouched.has(c.number)) {
      stated.push({ ...c, state: 'MERGED' });
      continue;
    }
    const one = run('gh', ['pr', 'view', String(c.number), '--repo', GH_REPO, '--json', 'state'], { timeout: 60000 });
    let state = null;
    if (one.ok) {
      try {
        state = String(JSON.parse(one.stdout).state || '').toUpperCase() || null;
      } catch (err) {
        state = null;
        if (unconfirmedReasons.length < 3) unconfirmedReasons.push(`#${c.number}: its state did not parse as JSON (${err.message})`);
      }
    } else if (unconfirmedReasons.length < 3) {
      unconfirmedReasons.push(`#${c.number}: ${one.reason}`);
    }
    if (state === null) {
      unconfirmed += 1;
      stated.push({ ...c, state: 'UNCONFIRMED' });
    } else {
      stated.push({ ...c, state });
    }
  }

  // Nothing at all could be checked — GitHub is unreachable, not quiet. There
  // is no number to print here, and "0 merges" would read as a quiet week.
  if (candidates.length && unconfirmed === candidates.length) {
    const why = sliceReason || unconfirmedReasons[0] || 'GitHub did not answer';
    return {
      merges: R.notAvailable(`${why} — so merged state could not be confirmed for any pull request`),
      candidates: [],
      confirmable: false,
    };
  }

  const confirmed = R.mergedOnly(stated).map((m) => ({ ...m, area: R.areaForMerge(m.paths) }));
  const notMerged = stated.filter((m) => m.state !== 'MERGED' && m.state !== 'UNCONFIRMED').length;
  return {
    merges: R.ok(confirmed.length, {
      perDay: R.perDay(confirmed.map((m) => m.date), WINDOW.from, WINDOW.to),
      notCountedBecauseNotMerged: notMerged,
      couldNotConfirm: unconfirmed,
      couldNotConfirmReasons: unconfirmedReasons,
    }),
    candidates: confirmed,
    confirmable: true,
  };
}

/**
 * How much code moved INSIDE the window — both ends of it.
 *
 * The end of the window is not optional. Diffing `<oldest merge>^ .. origin/main`
 * happens to be right for a window ending today and is wildly wrong for any
 * other: `--as-of 2026-08-10 --window 7` reported 581 files and +113,964 lines
 * for one week, because it was measuring everything merged SINCE that week.
 * Both shas are already in hand, so use both.
 *
 * It also has to distinguish "nothing merged" from "we could not read what
 * merged". Those produced the same sentence — "no merged pull requests in the
 * window" — which reads as a quiet week when the truth is an unread source.
 */
function gatherDiffstat(mergesFigure, merges) {
  if (!mergesFigure || mergesFigure.ok !== true) {
    const why = mergesFigure && mergesFigure.reason ? mergesFigure.reason : 'no reason given';
    return R.notAvailable(`the merge list could not be read, so there is nothing to diff from — ${why}`);
  }
  if (!merges.length) return R.notAvailable('no merged pull requests in the window, so there is nothing to diff');
  // `candidates` keeps git log's order, which is newest first.
  const newest = merges[0].sha;
  const oldest = merges[merges.length - 1].sha;
  const res = run('git', ['diff', '--shortstat', `${oldest}^`, newest]);
  if (!res.ok) return R.notAvailable(res.reason);
  const text = res.stdout.trim();
  const files = /(\d+) files? changed/.exec(text);
  const ins = /(\d+) insertions?\(\+\)/.exec(text);
  const del = /(\d+) deletions?\(-\)/.exec(text);
  if (!files) return R.notAvailable(`git's shortstat did not parse: "${text}"`);
  return R.ok({
    filesChanged: Number(files[1]),
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  });
}

function gatherTests() {
  if (flag('no-tests')) return R.notAvailable('skipped with --no-tests on this run');
  // A FAILING SUITE EXITS NON-ZERO, and that is precisely the run whose numbers
  // matter most — "1439 pass / 3 fail" is a figure, not an error. So this is the
  // one caller that reads the output whatever the exit status was, and it says
  // so right here, rather than through an option that quietly did the same to
  // every other caller. If the counts are missing, the exit status is the reason.
  const res = run('npm', ['run', '--silent', 'test:builder'], { timeout: 600000 });
  const text = `${res.stdout}\n${res.stderr}`;
  const pass = /^# pass (\d+)$/m.exec(text);
  const fail = /^# fail (\d+)$/m.exec(text);
  if (!pass) return R.notAvailable(res.ok ? 'the test run produced no "# pass" line to read' : res.reason);
  return R.ok({ pass: Number(pass[1]), fail: fail ? Number(fail[1]) : 0 });
}

function gatherCiMedian() {
  // LOCAL, not UTC — the same bounds gatherMerges uses. Dropping the `Z` is the
  // whole fix: every other figure on the page is bounded by the operator's local
  // day, and at -04:00 a UTC bound here measured a span shifted four hours from
  // the week the page names. The effect on a median of a few hundred runs is
  // negligible, which is exactly why it would never have shown up as a wrong
  // number — but two figures on one page must not mean two different weeks.
  const from = Date.parse(`${WINDOW.from}T00:00:00`);
  const to = Date.parse(`${WINDOW.to}T23:59:59`);
  // Ask GitHub for the WINDOW, do not trim a recent slice down to it. A day of
  // slack each side because --created is dated in UTC while the window is the
  // operator's local day; the exact in-or-out decision is made below, on the
  // timestamps.
  const created = `${R.shiftDate(WINDOW.from, -1)}..${R.shiftDate(WINDOW.to, 1)}`;
  const res = run('gh', ['run', 'list', '--repo', GH_REPO, '--created', created,
    '--limit', String(CI_RUN_LIMIT), '--json', 'startedAt,updatedAt,conclusion'], { timeout: 300000 });
  if (!res.ok) return R.notAvailable(res.reason);
  let runs;
  try {
    runs = JSON.parse(res.stdout);
  } catch (err) {
    return R.notAvailable(`GitHub's run list did not parse as JSON (${err.message})`);
  }
  if (!Array.isArray(runs)) return R.notAvailable("GitHub's run list was not a list of runs");

  // THE ANSWER PROVES ITS OWN COMPLETENESS. Fewer rows than the limit means
  // GitHub had no more to give for this range, so the slice IS the window.
  // Exactly the limit means it may have been cut off, and that gets said out
  // loud rather than absorbed into a confident number.
  const truncated = runs.length >= CI_RUN_LIMIT;

  const seconds = runs
    .filter((r) => r && r.conclusion === 'success')
    .map((r) => ({ start: Date.parse(r.startedAt), end: Date.parse(r.updatedAt) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= from && r.start <= to && r.end >= r.start)
    .map((r) => (r.end - r.start) / 1000);
  const med = R.median(seconds);
  if (med === null) {
    // "Nothing ran that week" and "we could not see that far back" are
    // different answers and must never share a sentence. The old code gave
    // both of them the same one, which read as a quiet week.
    if (truncated) {
      return R.notAvailable(`GitHub returned the full ${CI_RUN_LIMIT} runs it was asked for, so this slice may not cover the window — no median is reported rather than one taken from a partial view`);
    }
    return R.notAvailable('no successful CI runs finished inside the window');
  }
  return R.ok(med, { sampleSize: seconds.length, partial: truncated, limit: CI_RUN_LIMIT });
}

function gatherOpenPrs() {
  const res = run('gh', ['pr', 'list', '--repo', GH_REPO, '--state', 'open', '--limit', '200', '--json', 'number'], { timeout: 120000 });
  if (!res.ok) return R.notAvailable(res.reason);
  try {
    return R.ok(JSON.parse(res.stdout).length);
  } catch (err) {
    return R.notAvailable(`GitHub's open-PR list did not parse as JSON (${err.message})`);
  }
}

function gatherStages() {
  // --until as well as --since. With only a floor, "closed in the window"
  // counted everything closed from the window start UNTIL NOW, so a report for
  // an older week credited itself with tickets closed days after it ended.
  const res = run('npm', ['run', '--silent', 'clickup', '--', 'stage-counts', '--list', LOOP_QUEUE_LIST, '--since', WINDOW.from, '--until', WINDOW.to], { timeout: 180000 });
  if (!res.ok) return R.notAvailable(res.reason);
  try {
    const json = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
    return R.ok(json.byStatus || {}, { total: json.total, closedInWindow: json.closedInWindow });
  } catch (err) {
    return R.notAvailable(`the stage counts did not parse as JSON (${err.message})`);
  }
}

/**
 * How much unattended machine time went in this week.
 *
 * A labelled PROXY, and the page says so. What a reader actually wants is the
 * Anthropic quota spent, and that is not readable from this repo at all — the
 * first edition said so in plain words rather than leaving the row out, and
 * this keeps that shape. Loop passes are the closest honest thing the machine
 * can count about itself.
 *
 * Local to whichever machine runs the report, which is why the schedule pins
 * the job to one machine: counted anywhere else the number is simply wrong.
 */
function gatherLoopPasses() {
  const dir = path.join(process.env.HOME || '', 'loop-logs');
  if (!fs.existsSync(dir)) return R.notAvailable(`there is no ${dir} on this machine, so loop passes cannot be counted here`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
  if (!files.length) return R.notAvailable(`${dir} holds no .log files`);
  const from = `${WINDOW.from} 00:00:00`;
  const to = `${WINDOW.to} 23:59:59`;
  const byLoop = {};
  let total = 0;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (err) {
      return R.notAvailable(`${file} could not be read (${err.message})`);
    }
    for (const line of text.split('\n')) {
      const m = /^=+\s(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\sSTART (\/loop-[a-z-]+)/.exec(line.trim());
      if (!m) continue;
      if (m[1] < from || m[1] > to) continue;
      byLoop[m[2]] = (byLoop[m[2]] || 0) + 1;
      total += 1;
    }
  }
  if (!total) return R.notAvailable(`no loop passes are recorded in ${dir} inside this window`);
  return R.ok({ total, byLoop });
}

// ── Publishing ─────────────────────────────────────────────────────────────

/**
 * Commit the report on its own branch and open a pull request.
 *
 * NEVER onto main. main auto-deploys to production, so a scheduled job with a
 * commit bit on main is a scheduled job that can deploy at 07:00 on a Monday
 * with nobody awake (CLAUDE.md landmine 4). The report goes through the same
 * gate as every other change.
 *
 * And only from the machine that owns the role: two machines running this
 * would open two pull requests for the same week, every week.
 */
function publish(reportPath, jsonPath, indexPath) {
  const verdict = checkRole('weekly-report');
  if (!verdict.owned) {
    console.error(`\nNot publishing: ${verdict.message}`);
    console.error('The files above were still written — publishing is the part that must not happen twice.');
    return { published: false, reason: verdict.verdict };
  }

  const branch = `weekly-report-${AS_OF}`;
  const rel = (p) => path.relative(REPO, p);

  // PUBLISH FROM A THROWAWAY WORKTREE, NEVER BY SWITCHING BRANCHES HERE.
  //
  // The obvious version of this — `git checkout -B <branch> origin/main`, add,
  // commit, push — works once and then quietly breaks the machine it runs on.
  // The scheduled job runs in the MAIN checkout, so that checkout would be left
  // parked on `weekly-report-2026-08-25` forever. The very next bus-relay pass
  // reads its own branch to decide whether it may update itself, sees it is not
  // on main, and skips the update — from then on the Mini runs frozen code and
  // says so only in a log nobody opens.
  //
  // A worktree costs a folder for ten seconds and leaves the checkout exactly
  // as it found it, on whatever branch it was on, with whatever uncommitted
  // work was in it.
  const tmp = path.join(REPO, '.git', 'weekly-report-publish');
  run('git', ['worktree', 'remove', '--force', tmp]); // may not exist yet; nothing to report

  const fail = (reason) => {
    bus(`Weekly report could not publish: ${reason}`);
    console.error(`\nPublishing stopped: ${reason}`);
    run('git', ['worktree', 'remove', '--force', tmp]); // best effort on the way out
    return { published: false, reason };
  };

  const fetched = run('git', ['fetch', 'origin', '--quiet'], { timeout: 180000 });
  if (!fetched.ok) return fail(fetched.reason);

  const made = run('git', ['worktree', 'add', '-B', branch, tmp, 'origin/main'], { timeout: 180000 });
  if (!made.ok) return fail(made.reason);

  try {
    // Copy the freshly generated files in. The report is a product of THIS run,
    // not of whatever happens to be on the branch.
    const targets = [reportPath, jsonPath, indexPath].filter((p) => p && fs.existsSync(p));
    for (const src of targets) {
      const dest = path.join(tmp, rel(src));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }

    const add = run('git', ['-C', tmp, 'add', ...targets.map(rel)], { timeout: 120000 });
    if (!add.ok) return fail(add.reason);

    // Nothing changed since last week's edition? Then there is nothing to open
    // a pull request about, and an empty PR every Monday is how a useful signal
    // becomes something people filter out of their inbox.
    const staged = run('git', ['-C', tmp, 'diff', '--cached', '--name-only'], { timeout: 120000 });
    if (staged.ok && !staged.stdout.trim()) {
      console.error('\nNothing to publish — this edition is identical to what is already on main.');
      return { published: false, reason: 'no changes' };
    }

    const message = `Weekly figures for ${WINDOW.from} to ${WINDOW.to}\n\n`
      + 'Generated by scripts/weekly_report.mjs on a schedule. Figures only — the\n'
      + 'narrative is written by a person on top of these numbers.\n\n'
      + 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>';
    const commit = run('git', ['-C', tmp, 'commit', '-m', message], { timeout: 120000 });
    if (!commit.ok) return fail(commit.reason);

    // An ordinary push. The branch is new every week and only ever gains
    // commits, so a force is never needed — and a force-push inside a script is
    // invisible to the operator's own deny rule (DOCTRINE 6.6).
    const push = run('git', ['-C', tmp, 'push', '-u', 'origin', branch], { timeout: 300000 });
    if (!push.ok) return fail(push.reason);

    const body = `Weekly figures for **${WINDOW.from} to ${WINDOW.to}**, generated by \`scripts/weekly_report.mjs\` on a schedule.

This PR carries figures only. The narrative — the ranked five, the plain-language
summaries, "your inputs" and any incident write-ups — is a person's job and is
queued as its own ticket in the Loop Queue.

Everything on the page is also in \`${rel(jsonPath)}\`, so the narrative pass needs
no re-gathering.

A figure that could not be read says "not available" and gives its reason. Nothing
is estimated, and only pull requests GitHub reports as MERGED are counted.

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

    const pr = run('gh', ['pr', 'create', '--repo', GH_REPO, '--base', 'main', '--head', branch,
      '--title', `Weekly figures: ${WINDOW.from} to ${WINDOW.to}`, '--body', body], { timeout: 180000 });
    if (!pr.ok) {
      bus(`Weekly report pushed its branch but could not open a PR: ${pr.reason}`);
      return { published: false, reason: pr.reason };
    }
    // gh normally prints the PR url and nothing else, but `.pop()` on an empty
    // list is `undefined`, and `undefined` interpolates into a ticket body as the
    // WORD "undefined" — a narrative ticket pointing at nothing, filed and
    // looking fine. A PR we cannot name is a publish that did not finish.
    const url = pr.stdout.trim().split('\n').filter((l) => l.startsWith('http')).pop();
    if (!url) {
      return fail('gh reported success creating the pull request but printed no URL, '
        + 'so there is nothing to point the narrative ticket at');
    }
    console.error(`\nPull request: ${url}`);

    fileNarrativeTicket(url, rel(reportPath), rel(jsonPath));
    return { published: true, pr: url, branch };
  } finally {
    // Always. A worktree left behind turns next Monday's run into a confusing
    // "already exists" failure rather than a report.
    run('git', ['worktree', 'remove', '--force', tmp]); // best effort on the way out
  }
}

/**
 * File the narrative pass as a ticket.
 *
 * The whole design of this script is "figures generated, narrative written", and
 * the second half only actually happens if something remembers it. A ticket is
 * that something; a line in a log is not.
 */
function fileNarrativeTicket(prUrl, reportRel, jsonRel) {
  const body = `## What this is

The figures for **${WINDOW.from} to ${WINDOW.to}** are generated and in a pull request:
${prUrl}

The page is \`${reportRel}\`; every number on it is also in \`${jsonRel}\`, so this pass
needs no re-gathering at all.

## What to do

Write the narrative sections onto the page — the parts a script must not invent:

*   the ranked five (what mattered most this week, in order, and why)
*   a plain-language summary for each area group
*   "Your inputs" — what Dane was asked for and what it unblocked
*   any incident write-up the week deserves

## Acceptance

The page reads as a report rather than a dashboard, and no figure was changed —
the numbers are the script's, the words are yours.`;

  const scratch = scratchFile('ticket.md', body);
  const res = run('npm', ['run', '--silent', 'clickup', '--', 'task',
    '--list', LOOP_QUEUE_LIST, '--name', `Weekly report: ${WINDOW.from} to ${WINDOW.to} — write the narrative`,
    '--body-file', scratch.path, '--status', 'Queued', '--priority', 'normal'], { timeout: 180000 });
  scratch.cleanup();
  if (!res.ok) {
    bus(`Weekly report opened ${prUrl} but could not file the narrative ticket: ${res.reason}`);
    console.error(`Could not file the narrative ticket: ${res.reason}`);
    return;
  }
  console.error('Narrative ticket filed in the Loop Queue.');
}

/**
 * Tell the bus when an unattended run fails (NODES Phase 0: failures and
 * silence both reach the bus). Best effort by design — if the bus itself is
 * down, that must not turn a partial success into a crash.
 */
function bus(message) {
  let scratch = null;
  try {
    scratch = scratchFile('bus.md', `[CC-starcaster] ${message}`);
    const res = run('npm', ['run', '--silent', 'clickup', '--', 'chat', '--channel', BUS_CHANNEL, '--body-file', scratch.path], { timeout: 120000 });
    if (!res.ok) console.error(`(could not reach the bus either: ${res.reason})`);
  } catch (err) {
    console.error(`(could not reach the bus either: ${err.message})`);
  } finally {
    if (scratch) scratch.cleanup();
  }
}

/** Rebuild the index from whatever editions are on disk. */
function writeIndex() {
  const editions = fs.readdirSync(REPORTS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .map((file) => {
      const date = file.slice(0, 10);
      let window = '';
      try {
        const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, `${date}.data.json`), 'utf8'));
        window = `${data.window.from} to ${data.window.to}`;
      } catch (_) { window = ''; }
      return { date, file, window };
    });
  const indexPath = path.join(REPORTS_DIR, 'index.html');
  fs.writeFileSync(indexPath, R.renderIndexHtml(editions));
  return indexPath;
}

// ── Main ───────────────────────────────────────────────────────────────────

process.stderr.write(`Weekly figures for ${WINDOW.from} to ${WINDOW.to} (${WINDOW.days} days)\n`);

// FETCH BEFORE READING origin/main, AND SAY SO IF IT FAILED.
//
// The merge count, both lines-changed figures and the per-day chart are all
// read out of `origin/main` as this machine last saw it — and nothing used to
// refresh it. The wrapper's self-update is deliberately timid and skips on any
// of four conditions; on every one of those paths origin/main is however stale
// it happened to be, and all four figures go short with nothing on the page
// marked unread. That is the honesty rule's exact failure mode: a number that
// is a floor, printed as a total.
const originFetch = run('git', ['fetch', 'origin', 'main', '--quiet'], { timeout: 300000 });
process.stderr.write(originFetch.ok
  ? '  origin/main: fetched\n'
  : `  origin/main: NOT fetched — ${originFetch.reason}\n`);

// Merges are gathered apart from the rest because they produce two things:
// the figure, and the list every other section is built from. Reporting on it
// by hand keeps `gather()` honest about what a figure is.
let mergeResult;
try {
  mergeResult = gatherMerges();
} catch (err) {
  mergeResult = { merges: R.notAvailable(`gathering merges threw (${err && err.message ? err.message : err})`), candidates: [] };
}
const merges = mergeResult.merges;
const confirmed = mergeResult.candidates;
process.stderr.write(merges.ok ? `  merges: read (${merges.value})\n` : `  merges: not available — ${merges.reason}\n`);
if (merges.ok && merges.couldNotConfirm) {
  // Loudly, in the log as well as on the page: this count is a floor.
  process.stderr.write(`  merges: ${merges.couldNotConfirm} could NOT be confirmed with GitHub and are not counted\n`);
  for (const why of merges.couldNotConfirmReasons || []) process.stderr.write(`    ${why}\n`);
}

const figures = {
  merges,
  diffstat: gather('diffstat', () => gatherDiffstat(merges, confirmed)),
  tests: gather('tests', gatherTests),
  ciMedianSeconds: gather('CI median', gatherCiMedian),
  openPrs: gather('open PRs', gatherOpenPrs),
  stages: gather('ticket stages', gatherStages),
  loopPasses: gather('loop passes', gatherLoopPasses),
};

const data = {
  repo: GH_REPO,
  window: WINDOW,
  dataFile: path.basename(OUT_JSON),
  originFetch: { ok: originFetch.ok === true, reason: originFetch.ok ? null : originFetch.reason },
  figures,
  merges: confirmed.map(({ number, title, date, sha, area }) => ({ number, title, date, sha, area })),
  groups: R.groupMergesByArea(confirmed).map((g) => ({
    area: g.area,
    entries: g.entries.map(({ number, title, date }) => ({ number, title, date })),
  })),
};
fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
fs.writeFileSync(OUT_JSON, `${JSON.stringify(data, null, 2)}\n`);
fs.writeFileSync(OUT_HTML, R.renderReportHtml({ ...data, groups: R.groupMergesByArea(confirmed) }));

const indexPath = fs.existsSync(REPORTS_DIR) && OUT_HTML.startsWith(REPORTS_DIR) ? writeIndex() : null;

process.stderr.write(`\nWrote ${path.relative(REPO, OUT_HTML)}\n      ${path.relative(REPO, OUT_JSON)}\n`);
if (indexPath) process.stderr.write(`      ${path.relative(REPO, indexPath)}\n`);

const unread = Object.entries(figures).filter(([, f]) => !f.ok);
if (unread.length) {
  process.stderr.write(`\n${unread.length} figure(s) not available — each says why on the page:\n`);
  for (const [name, f] of unread) process.stderr.write(`  ${name}: ${f.reason}\n`);
}

// EXIT 0 EVEN WITH UNREADABLE FIGURES. A report that says "not available" IS a
// successful run — the honesty rule only works if the honest outcome is not
// also treated as a failure.
//
// A FAILED PUBLISH IS A DIFFERENT THING and does not get that grace. It is not
// an honest gap in a report that exists; it is no report at all. launchd and
// anything watching exit codes would otherwise record a clean Monday for a week
// that produced nothing, which is the same silence this whole script is written
// against. "Nothing to publish" is not a failure — an edition identical to the
// one already on main is the correct outcome of a quiet week.
if (flag('publish')) {
  const result = publish(OUT_HTML, OUT_JSON, indexPath || path.join(REPORTS_DIR, 'index.html'));
  if (!result.published) {
    // Two of the ways publishing does not happen are not failures, and saying
    // so is the difference between a monitor that gets read and one that gets
    // muted:
    //   'no changes'  — a week identical to the edition already on main.
    //   the role guard — this machine does not own `weekly-report`. That is a
    //                    designed decline, so it takes exit 3, the same code
    //                    `npm run node:owns` uses for "another machine's job".
    if (result.reason === 'no changes') process.exit(0);
    if (result.reason === 'other-node' || result.reason === 'unidentified') {
      process.stderr.write('\nExiting 3: publishing belongs to another machine.\n');
      process.exit(3);
    }
    process.stderr.write(`\nExiting 1: --publish was asked for and did not happen (${result.reason}).\n`);
    process.exit(1);
  }
}

process.exit(0);
