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

# THE UPDATE, AND THE ALARM WHEN IT CANNOT HAPPEN (task 86bbrf2vf).
#
# The five conditions above are unchanged and live in scripts/checkout_currency.mjs
# now: only main, only clean, only fast-forward. That timidity was never the
# bug. What was wrong is what happened AFTER a refusal — an `echo` into a log
# nobody reads, carrying a reason that was sometimes flatly wrong.
#
# On 2026-09-01 this machine could not fast-forward for hours because three
# untracked weekly-report files had become tracked paths in a later commit.
# The branch it fell through to printed "main has diverged from origin", which
# was false: main had not diverged. It was found by hand, and only because
# somebody happened to watch a pull.
#
# So a blocked update now posts to the bus (once per 6h, cleared by the next
# success) and NAMES the blocking files. `--fix` is deliberately NOT passed
# here: displacing a file is reversible, but it is still a decision, and the
# rule that a background job may not rewrite someone's work is the reason this
# step is trusted at all. It reports; a person or an agent session repairs.
#
# Never allowed to fail the relay, like its neighbours below.
npm run --silent checkout:current -- --check || true

# Does the machine still agree with the repo about how often to wake?
# Three answers, never two — and "could not tell" is one of them, said out
# loud. The reasoning and the exit codes live in the script itself.
REPO="$REPO" "$REPO/scripts/bus_relay_interval.sh" "interval: " || true

# THE WATCHDOG, BEFORE THE OWNERSHIP CHECK — deliberately (NODES Slice E).
#
# A watchdog that runs on the same machine as the job it watches cannot notice
# that machine being switched off, which is the case it exists for. This wake-up
# happens on every machine that has the schedule installed, and on a machine
# that does NOT own the relay it has until now done nothing at all: it wakes,
# reads lib/nodeRoles.js, says whose job it is and exits. That idle wake is the
# one vantage point in the system that survives the owning machine being dead,
# so it is where the check belongs.
#
# Reads the shared roll call and posts to the bus only when a job has gone
# quiet; it is silent otherwise. Never allowed to fail the relay.
npm run --silent heartbeat -- --check || true

# THE OTHER WATCHDOG, IN THE SAME PLACE AND FOR THE SAME REASON (task 86bbqrw3p).
#
# The heartbeat above asks "did a job stop firing?". This asks the question a
# heartbeat structurally cannot: the job fired, and did anything come out?
#
# On 2026-08-31 the build loop fired every hour, exited 0 every time, and the
# queue did not move — 52 queued, 1 in review, the oldest rework PR sitting
# since Aug 25. Every gate was green and every green was honest. A loop that
# runs and achieves nothing writes a full, cheerful log, which reads as health
# and so stops anybody looking; finding it took a morning of reading logs.
#
# Before the ownership check for the same reason the heartbeat is: the machine
# that does NOT own the relay is already awake here doing nothing, and that
# idle wake is the vantage point that survives the owning machine being dead.
#
# Posts to the bus only on a STALLED verdict, once per 6h, cleared by the next
# run that is not stalled. Silent otherwise, and never allowed to fail the
# relay — it exits 1 on a stall, which is a finding, not this script's failure.
npm run --silent throughput -- --check || true

npm run --silent clickup -- bus-relay
status=$?
echo "=== exit $status"

if [ "$status" -eq 0 ]; then
  # A beat, and only on a real success. Recorded locally every time (free,
  # offline); pushed to the shared roll call at most once a day, which is what
  # keeps this from being channel noise x365 and is the resolution the
  # requirement actually asks for — a day-long absence, not a ten-minute one.
  #
  # A pass on a machine that does not own the relay also exits 0, and that is
  # correct: `--role bus-relay` records THIS machine as the beater, and the
  # report only ever counts the OWNER's row, so a non-owner's beat can never
  # make a dead relay look alive.
  # It also clears this job's failure and silence alarms, so a fault that is
  # fixed and returns is announced again straight away rather than being
  # swallowed by the earlier one's six-hour suppression window. That clearing
  # lives in the beat rather than here so only one file knows where the stamps
  # are kept (NODES P1 — a path written twice is a path that drifts).
  npm run --silent heartbeat -- --beat --role bus-relay || true
else
  # The failure alert, in the repo at last. It was built by hand on 2026-08-20
  # inside an uncommitted wrapper on the MacBook Pro; when Slice B brought the
  # schedule into git and ownership moved to the Mini, the alert did not come
  # with it, and a failure on the machine that actually runs the relay reached
  # nobody. Nothing announced that — which is what an uncommitted file does.
  # Through npm, not node, so Doppler supplies the ClickUp token the same way
  # every other write in this file gets it — and NOT redirected to /dev/null:
  # this script's stdout IS the launchd log, so an alert that could not be sent
  # has to leave its reason where the next reader will find it.
  npm run --silent report:failure -- --job bus-relay --status "$status" \
    --log "$HOME/Library/Logs/bus-relay-launchd.log" || true
fi

exit $status
