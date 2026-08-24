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

# DOES THE MACHINE STILL AGREE WITH THE REPO ABOUT HOW OFTEN TO WAKE?
#
# The interval lives in two places and only one of them is reviewable:
# INTERVAL_SECONDS in scripts/install_bus_relay.sh (in git, where it can be
# read and changed by anyone) and StartInterval in the generated plist (on one
# machine, where it actually takes effect). Changing the repo does NOT change
# the machine — that needs the installer re-run — so the two drift apart
# silently, and a relay still waking hourly looks exactly like one waking every
# ten minutes until you go and read a log.
#
# That is not hypothetical: it is precisely what happened when the interval was
# shortened on 2026-08-23 (task 86bbk2fuh). Say it out loud, every pass, rather
# than letting the schedule quietly disagree with the committed intent.
# Fixing the config-on-one-machine problem itself is NODES Slice B (86bbh9kh2).
want="$(sed -n 's/^INTERVAL_SECONDS=\([0-9][0-9]*\).*/\1/p' "$REPO/scripts/install_bus_relay.sh" | head -1)"
plist="$HOME/Library/LaunchAgents/com.starcaster.bus-relay.plist"
if [ -n "$want" ] && [ -f "$plist" ]; then
  have="$(grep -A1 '<key>StartInterval</key>' "$plist" | sed -n 's/.*<integer>\([0-9][0-9]*\)<\/integer>.*/\1/p' | head -1)"
  if [ -n "$have" ] && [ "$have" != "$want" ]; then
    echo "interval: MISMATCH — this machine wakes every ${have}s, the repo says ${want}s."
    echo "interval: the schedule is stale; re-run the installer from the main checkout to fix it:"
    echo "interval:   cd $REPO && ./scripts/install_bus_relay.sh"
  else
    echo "interval: every ${have:-?}s, matching the repo"
  fi
fi

npm run --silent clickup -- bus-relay
status=$?
echo "=== exit $status"
exit $status
