#!/bin/bash
#
# What the schedule (every 10 minutes) actually runs. Two steps: bring the
# checkout up to date with main, then relay.
#
# WHY THE UPDATE STEP EXISTS
# The relay reads WHO MAY RUN IT out of lib/nodeRoles.js in this checkout, at
# run time. A machine nobody sits at is a machine nobody runs `git pull` on, so
# without this the Mini would keep running whatever code it had the day it was
# set up — and the day that matters is the day ownership changes, when the new
# owner would go on believing the job belongs to the old one. Nothing would
# error. The relay would simply never start, which is the exact shape of the
# failure this schedule was moved to fix.
#
# The update is deliberately timid, and never blocks the relay:
#   - only on the main branch, only with a clean tree, only fast-forward
#   - any refusal is logged and the relay runs anyway on the code that is here
# A background job may keep a checkout current; it may not rewrite someone's
# work to do it.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

echo "=== bus-relay $(date '+%Y-%m-%d %H:%M:%S') — $REPO"

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

# Does the machine still agree with the repo about how often to wake?
# Three answers, never two — and "could not tell" is one of them, said out
# loud. The reasoning and the exit codes live in the script itself.
REPO="$REPO" "$REPO/scripts/bus_relay_interval.sh" "interval: " || true

npm run --silent clickup -- bus-relay
status=$?
echo "=== exit $status"
exit $status
