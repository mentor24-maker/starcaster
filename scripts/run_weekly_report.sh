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

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

echo "=== weekly-report $(date '+%Y-%m-%d %H:%M:%S') — $REPO"

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

# --publish is what makes this a scheduled job rather than a local command: it
# commits the report to a branch, opens the pull request and files the ticket
# for the narrative pass. It refuses on any machine that does not own the role,
# which is why the schedule is harmless if it is ever installed in two places.
node scripts/weekly_report.mjs --window 7 --publish
status=$?
echo "=== exit $status"
exit $status
