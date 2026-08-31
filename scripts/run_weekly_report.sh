#!/bin/bash
#
# What the Monday 07:00 schedule actually runs.
#
# Same two steps, and the same reasoning, as run_bus_relay.sh: bring the
# checkout up to date first, then do the job. The report reads WHO MAY RUN IT
# out of lib/nodeRoles.js in this checkout at run time, so a machine nobody
# sits at would otherwise keep running whatever code it had the day it was set
# up — and the day that matters is the day ownership moves, when the new owner
# would go on believing the job belongs to the old one. Nothing would error.
# The report would simply stop appearing.
#
# The update is deliberately timid and never blocks the report:
#   - only on main, only with a clean tree, only fast-forward
#   - any refusal is logged and the report runs on the code that is here
# A background job may keep a checkout current; it may not rewrite anyone's work.
#
# AND IT HAS TO CLEAN UP AFTER ITSELF FIRST, or it disables itself on run two.
# The report writes docs/reports/<date>.html, <date>.data.json and index.html
# into this checkout and leaves them there — publishing copies them into a
# throwaway worktree, so the originals stay behind. "Clean tree" then reads
# false forever: run 1 dirties the checkout, run 2 skips the update, and it
# stays dirty. A deadlock, and a silent one — every log line says
# "update: skipped", which is what a HEALTHY skip says too.
#
# That is worse than staleness. The whole reason this update exists is so that
# moving `weekly-report` to another machine in lib/nodeRoles.js actually reaches
# this one; with the update dead, ownership could move and the Mini would go on
# publishing regardless.
#
# THE RESIDUE COMES IN TWO KINDS, AND REMOVING ONLY THE FIRST REOPENS THE
# DEADLOCK THROUGH A SECOND DOOR.
#
#   untracked — docs/reports/<date>.html and <date>.data.json. A new date every
#               week, so these are never on main when they are written.
#   TRACKED   — docs/reports/index.html. writeIndex() rewrites it on EVERY run,
#               and publish() commits it. So from the second published edition
#               onward it is a tracked file with a local modification, which
#               `git clean` cannot touch and `git status --porcelain` reports
#               forever. `git merge --ff-only` would refuse it too, with
#               "local changes would be overwritten".
#
# So the cleanup does both: remove what is untracked, restore what is tracked.
# Doing it BEFORE the fast-forward matters twice over — leftover output also
# makes `git merge --ff-only` refuse outright once the same file lands on main,
# which is exactly what the first published edition does.
#
# RESTORING IS DESTRUCTIVE, so it is fenced: only on `main`, and only under
# docs/reports/. That is this job's own output directory, and `main` in the
# always-on checkout is the one place nobody hand-edits — it auto-deploys, and
# the repo blocks edits to it. The narrative pass, which is the only thing that
# legitimately edits a report by hand, happens on a branch in its own worktree
# and is never touched by this. Everything restored is named in the log, so a
# surprise is visible rather than silent.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

echo "=== weekly-report $(date '+%Y-%m-%d %H:%M:%S') — $REPO"

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

if [ -d docs/reports ]; then
  residue="$(git ls-files --others --exclude-standard -- docs/reports 2>/dev/null)"
  if [ -n "$residue" ]; then
    echo "cleanup: removing the last run's own untracked output under docs/reports/"
    echo "$residue" | sed 's/^/  /'
    git clean -fdq -- docs/reports 2>/dev/null || echo "cleanup: could not remove it; the update below will say so"
  fi

  # The tracked half — index.html, and any edition re-rendered for a date that
  # has already shipped. Only on main; see the fencing note above.
  if [ "$branch" = "main" ]; then
    modified="$(git diff --name-only -- docs/reports 2>/dev/null)"
    if [ -n "$modified" ]; then
      echo "cleanup: restoring the last run's own changes to TRACKED files under docs/reports/"
      echo "$modified" | sed 's/^/  /'
      git checkout -- docs/reports 2>/dev/null || echo "cleanup: could not restore them; the update below will say so"
    fi
  elif [ -n "$(git diff --name-only -- docs/reports 2>/dev/null)" ]; then
    echo "cleanup: tracked files under docs/reports/ are modified, but this checkout is on '$branch', not main — leaving them alone."
  fi
fi

if [ "$branch" != "main" ]; then
  echo "update: skipped — checkout is on '$branch', not main. Running the code that is here."
elif [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "update: skipped — uncommitted changes present; a background job does not touch them."
elif ! git fetch --quiet origin main 2>/dev/null; then
  echo "update: skipped — could not reach origin. Running the code that is here."
elif ! git merge --ff-only origin/main 2>&1; then
  echo "update: skipped — main has diverged from origin and only a person should sort that out."
else
  echo "update: checkout is at $(git rev-parse --short HEAD)"
fi

# A seam for the test that pins the deadlock above. The self-update is the only
# part of this wrapper a test can exercise honestly — the report itself wants
# doppler, npm and the network — so the test runs the wrapper with this set and
# reads the update lines. launchd sets no environment, so the real Monday run
# never takes this branch.
if [ -n "${WEEKLY_REPORT_UPDATE_ONLY:-}" ]; then
  echo "=== exit 0 (update only)"
  exit 0
fi

# THE WINDOW IS THE WEEK THAT HAS FINISHED, NOT THE ONE WE ARE STANDING IN.
#
# `--window 7` on its own means "the 7 days ending TODAY". Fired Monday 07:00
# that covers up to Monday 07:00, and the next edition starts Tuesday — so
# everything merged between Monday 07:00 and Monday midnight lands in no edition
# at all, and nothing says so, because from the report's point of view that time
# never existed. On real history since 1 July that is 70 of 107 Monday merges,
# and Monday afternoon is not a quiet part of the week:
#
#   git log origin/main --since=2026-07-01 --format='%ad' \
#     --date=format:'%u %H:%M' | awk '$1==1'
#
# It also drew the last bar of the per-day chart from 7 hours of Monday at the
# same width as the six whole days beside it, which reads as a slow Monday every
# single week.
#
# `--as-of yesterday` makes the window Monday-to-Sunday: a week that has
# actually finished, nothing missed, no partial day on the chart.
as_of="$(date -v-1d +%F 2>/dev/null || date -d 'yesterday' +%F)"
if [ -z "$as_of" ]; then
  echo "could not work out yesterday's date — refusing to report on a partial week"
  echo "=== exit 1"
  exit 1
fi
echo "window: the 7 days ending $as_of (the week that has finished)"

# --publish is what makes this a scheduled job rather than a local command: it
# commits the report to a branch, opens the pull request and files the ticket
# for the narrative pass. It refuses on any machine that does not own the role,
# which is why the schedule is harmless if it is ever installed in two places.
node scripts/weekly_report.mjs --as-of "$as_of" --window 7 --publish
status=$?
echo "=== exit $status"
exit $status
