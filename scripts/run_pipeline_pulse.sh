#!/bin/bash
#
# What the hourly schedule actually runs.
#
# Same two steps, and the same reasoning, as run_bus_relay.sh and
# run_weekly_report.sh: bring the checkout up to date first, then do the job.
# The pulse reads WHO MAY RUN IT out of lib/nodeRoles.js in this checkout at
# run time, so a machine nobody sits at would otherwise keep running whatever
# code it had the day it was set up — and the day that matters is the day
# ownership moves, when the new owner would go on believing the job belongs to
# the old one. Nothing would error. The pulse would simply stop appearing,
# which is EXACTLY the failure this whole job exists to detect, one floor up.
#
# WHY THE OWNERSHIP CHECK IS HERE AND NOT IN THE PUBLISHER
# It is here, before the publisher runs, rather than inside it. That is the
# opposite of what run_bus_relay.sh does with its watchdogs, and the difference
# is deliberate. Those watchdogs are hung off the relay's wake precisely so
# they run on the machine that does NOT own the job they watch — a watchdog
# that only runs where its job runs cannot see that machine switched off.
#
# This job has its own schedule, so it has no such free vantage point. The
# question "is the Mini dead?" is answered for it by the roll call
# (lib/nodeHeartbeat.js): pipeline-pulse is a beat emitter, so if this machine
# stops, whichever machine is awake reads the roll call and says so on the bus.
# That is the layering, and it only holds while this job actually beats — which
# is why the publisher's last act is a beat and why removing it would quietly
# reopen the hole.
#
# Not owning the role is a NORMAL outcome and exits 0: the schedule is harmless
# on a machine that does not own it, which means it can be installed on a new
# machine BEFORE ownership moves, with no gap where nobody is watching.
#
# The update is deliberately timid and never blocks the pulse:
#   - only on main, only with a clean tree, only fast-forward
#   - any refusal is logged and the pulse runs on the code that is here
# A background job may keep a checkout current; it may not rewrite anyone's work.
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1).

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

echo "=== pipeline-pulse $(date '+%Y-%m-%d %H:%M:%S') — $REPO"

# The shared update-and-alarm step its neighbours use. `--fix` is deliberately
# NOT passed: displacing a file is reversible, but it is still a decision, and
# a background job may not rewrite someone's work. Never allowed to fail the
# pulse.
npm run --silent checkout:current -- --check || true

# Does this machine own the job? Asked by RUNNING lib/nodeRoles.js's one
# implementation, never by re-deriving the answer here — two readers of an
# ownership rule are two rules, and they disagree quietly.
#
#   0 = mine        3 = another machine's, and that is normal
#   1 = CANNOT TELL, which must never be treated as "not mine": "someone else
#       is doing it" and "nobody is doing it" look identical from here, and
#       only one of them is safe.
npm run --silent node:owns -- pipeline-pulse
owns=$?
if [ "$owns" -eq 3 ]; then
  echo "=== exit 0 (another machine owns pipeline-pulse — nothing to do here)"
  exit 0
fi
if [ "$owns" -ne 0 ]; then
  echo "This machine could not say which node it is, so it cannot know whether it owns pipeline-pulse."
  echo "Refusing to run rather than skipping quietly — a silent skip here is indistinguishable from"
  echo "a healthy pass, and this job's whole purpose is to make silence detectable."
  echo "Fix it once: echo <machine-name> > ~/.alphire-node   (npm run node:whoami shows the picture)"
  echo "=== exit 1"
  exit 1
fi

# --job is the loop whose log A1 reads. loop-build is the default and the one
# whose claims the check is actually about.
npm run --silent pulse:publish
status=$?
echo "=== exit $status"

if [ "$status" -ne 0 ]; then
  # A pulse that could not take a reading is a blind watchdog, and a blind
  # watchdog that says nothing is worse than none at all. Through npm, not
  # node, so Doppler supplies the ClickUp token the same way every other write
  # here gets it — and NOT redirected away: this script's stdout IS the launchd
  # log, so an alert that could not be sent has to leave its reason where the
  # next reader will find it.
  npm run --silent report:failure -- --job pipeline-pulse --status "$status" \
    --log "$HOME/Library/Logs/pipeline-pulse.log" || true
fi

exit $status
