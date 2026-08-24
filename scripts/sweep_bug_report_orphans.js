#!/usr/bin/env node
'use strict';

/**
 * Delete abandoned bug-report screenshots — the row AND the public file.
 *
 * Dry-run unless you pass --apply, and it prints what it KEPT as well as what
 * it would remove, because a sweep that only lists its kills cannot be checked.
 *
 *   npm run sweep:bug-report-orphans:dry-run
 *   npm run sweep:bug-report-orphans:dry-run -- --hours=48
 *   npm run sweep:bug-report-orphans:apply
 *
 * The scheduled copy of this runs in production as a Vercel cron
 * (/api/support/bug-reports/sweep-orphans, daily). This script is the one a
 * person runs to see what that job is about to do, or to run it by hand.
 *
 * Exit code is 1 when anything could not be deleted or could not be checked,
 * so a wrapper cannot mistake "finished" for "clean".
 */

try { require('dotenv').config(); } catch (_) {}

const {
  sweepBugReportOrphans,
  DEFAULT_OLDER_THAN_HOURS,
} = require('../lib/bugReportOrphanSweep');

function parseArgs(argv) {
  const args = { apply: false, hours: DEFAULT_OLDER_THAN_HOURS };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--dry-run') args.apply = false;
    else if (raw.startsWith('--hours=')) {
      const n = Number(raw.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) args.hours = n;
    }
  }
  return args;
}

const KEPT_EXPLANATIONS = {
  REFERENCED_BY_A_REPORT: 'a bug report points at it',
  NEWER_THAN_THRESHOLD: 'too recent — someone may still be filling in the form',
  UNREADABLE_CREATED_AT: 'its upload date could not be read, so its age is unknown',
  UNUSABLE_ID: 'the row has no usable id',
  NOT_A_PENDING_BUG_REPORT_ASSET: 'it is not a pending bug-report screenshot',
};

const NOT_DELETED_EXPLANATIONS = {
  NO_DELETER: 'stored somewhere with no deleter wired up (Google Drive, or an outside URL) — remove it by hand',
  BLOB_DELETE_FAILED: 'the file could not be deleted, so the row was left alone',
  ROW_DELETE_FAILED: 'the file went but the row could not be deleted',
  ROW_VANISHED: 'the file went but no pending row matched the delete',
  CHANGED_UNDERNEATH: 'it was attached to a report between the scan and the delete',
  RECHECK_FAILED: 'its current state could not be re-read, so nothing was touched',
  NO_LOCATION: 'the row stores no file location',
};

function countReasons(items) {
  const counts = {};
  for (const item of items) {
    const key = item.reason || item.code || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Bug-report screenshot sweep — ${args.apply ? 'APPLY (this deletes)' : 'dry run (nothing is deleted)'}`);
  console.log(`Anything unreferenced and older than ${args.hours}h is an orphan.\n`);

  const res = await sweepBugReportOrphans({ olderThanHours: args.hours, dryRun: !args.apply });

  if (!res.data) {
    console.error(`REFUSED: ${res.error}`);
    process.exitCode = 1;
    return;
  }

  const { scanned, reportsRead, proposed, kept, deleted, notDeleted, byProject } = res.data;
  console.log(`Read ${scanned} pending screenshot(s) and ${reportsRead} bug report(s).`);

  console.log(`\nKept ${kept.length}:`);
  for (const [reason, count] of Object.entries(countReasons(kept))) {
    console.log(`  ${count} — ${KEPT_EXPLANATIONS[reason] || reason}`);
  }

  const label = args.apply ? 'Deleted' : 'Would delete';
  const list = args.apply ? deleted : proposed;
  console.log(`\n${label} ${list.length}:`);
  for (const item of list) {
    console.log(`  asset ${item.id} · project ${item.projectId || '(none)'} · uploaded ${item.createdAt}`);
  }
  const perProject = args.apply ? byProject.deleted : byProject.proposed;
  for (const [projectId, count] of Object.entries(perProject)) {
    console.log(`  ${projectId}: ${count}`);
  }

  if (notDeleted.length) {
    console.log(`\nCOULD NOT DELETE ${notDeleted.length} — these are still there:`);
    for (const item of notDeleted) {
      console.log(`  asset ${item.id} · ${NOT_DELETED_EXPLANATIONS[item.code] || item.code}`);
      console.log(`    ${item.location || '(no location)'}`);
      console.log(`    ${item.error}`);
    }
  }

  if (!args.apply && proposed.length) {
    console.log(`\nNothing was deleted. Run the same command with --apply to remove those ${proposed.length}.`);
  }

  process.exitCode = res.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(`Sweep failed: ${err.message}`);
  process.exitCode = 1;
});
