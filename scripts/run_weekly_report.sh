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
# throwaway worktree, so the originals stay behind, untracked. "Clean tree" then
# reads false forever: run 1 dirties the checkout, run 2 skips the update, the
# files never become tracked, so it stays dirty. A deadlock, and a silent one —
# every log line says "update: skipped", which is what a HEALTHY skip says too.
#
# That is worse than staleness. The whole reason this update exists is so that
# moving `weekly-report` to another machine in lib/nodeRoles.js actually reaches
# this one; with the update dead, ownership could move and the Mini would go on
# publishing regardless.
#
# So: remove the residue this job itself wrote, and nothing else. Untracked
# files under docs/reports/ are by definition its own output. Doing it BEFORE
# the fast-forward matters twice over — an untracked docs/reports/2026-08-25.html
# also makes `git merge --ff-only` refuse outright once that same file lands on
# main, which is exactly what the first published edition does.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

echo "=== weekly-report $(date '+%Y-%m-%d %H:%M:%S') — $REPO"

if [ -d docs/reports ]; then
  residue="$(git ls-files --others --exclude-standard -- docs/reports 2>/dev/null)"
  if [ -n "$residue" ]; then
    echo "cleanup: removing the last run's own untracked output under docs/reports/"
    echo "$residue" | sed 's/^/  /'
    git clean -fdq -- docs/reports 2>/dev/null || echo "cleanup: could not remove it; the update below will say so"
  fi
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
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

# --publish is what makes this a scheduled job rather than a local command: it
# commits the report to a branch, opens the pull request and files the ticket
# for the narrative pass. It refuses on any machine that does not own the role,
# which is why the schedule is harmless if it is ever installed in two places.
node scripts/weekly_report.mjs --window 7 --publish
status=$?
echo "=== exit $status"
exit $status
