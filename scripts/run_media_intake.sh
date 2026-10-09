#!/bin/bash
#
# One scheduled media-intake pass — what launchd runs every 15 minutes
# (scripts/install_media_intake.sh). Ticket 86bcfgyxp.
#
# The pass itself (scripts/media_intake.mjs) needs no secrets: it reads iCloud
# Drive and uploads through rclone, which keeps its own Google sign-in. Only the
# two bookkeeping steps after it go through npm, and so through Doppler, the
# same way the relay's do (scripts/run_bus_relay.sh):
#
#   exit 0     -> a beat for `media-intake` (clears its failure alarm too)
#   otherwise  -> one bus post per 6 hours (scripts/report_job_failure.mjs)
#
# A machine that does not own the role exits 0 from the pass having done
# nothing, and still records a beat — which is harmless: the roll call only
# ever counts the OWNER's row (same reasoning as the relay's beat).

set -uo pipefail

# A background job: it yields ClickUp capacity to the sessions Dane is talking
# to (scripts/lib/clickupCaller.cjs, SCHEDULED_LAUNCHERS).
export STARCASTER_CALLER=scheduled

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/Library/Logs/media-intake.log"
cd "$REPO" || exit 1

status=0
node scripts/media_intake.mjs || status=$?

if [ "$status" -eq 0 ]; then
  npm run --silent heartbeat -- --beat --role media-intake || true
else
  echo "=== media-intake pass exited $status"
  npm run --silent report:failure -- --job media-intake --status "$status" --log "$LOG" || true
fi
exit "$status"
