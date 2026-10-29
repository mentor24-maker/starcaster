#!/bin/bash
#
# One scheduled Reddit watch pass — what launchd runs every four hours on the
# Mini (scripts/install_reddit_watch.sh). Outreach wizard 18/19, task 86bcrmbwm.
#
# The pass reads and writes the PRODUCTION database (that is where Dane's
# subreddits, keywords and canon live), so it runs under `doppler run` with
# the prd key kept at ~/Studio — the same key the Studio and outreach workers
# use (scripts/install_youtube_outreach_worker.sh explains why that folder).
# No value is ever written to the plist, the disk or the log.
#
#   exit 0     -> a beat for `reddit-watch` (clears its failure alarm)
#   exit 4     -> nothing was read (no project has an approved subreddit):
#                 NO beat and no failure post. A schedule that never reads
#                 must go stale on the roll call
#                 (`npm run heartbeat -- --stale-check`), not read as healthy.
#   otherwise  -> one bus post per 6 hours (scripts/report_job_failure.mjs) —
#                 a signed-out browser included: it is a failure, never
#                 "found nothing".
#
# A machine that does not own the role exits 3 having done nothing, and
# records no beat: a pass that did not read is not a clean pass.

set -uo pipefail

export STARCASTER_CALLER=scheduled

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/Library/Logs/reddit-watch.log"
ROLE="reddit-watch"
DOPPLER_SCOPE="${REDDIT_WATCH_DOPPLER_SCOPE:-$HOME/Studio}"
DOPPLER_CONFIG="${REDDIT_WATCH_DOPPLER_CONFIG:-prd}"
cd "$REPO" || exit 1

owns=0
node -e '
  const { checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
  const v = checkRole(process.argv[2]);
  if (v.verdict !== "owned") { console.log(`=== ${process.argv[2]}: not this machine'"'"'s job (${v.verdict}, owner ${v.owner}) — nothing read`); process.exit(3); }
' "$REPO" "$ROLE" || owns=$?
if [ "$owns" -ne 0 ]; then exit "$owns"; fi

status=0
doppler run --scope "$DOPPLER_SCOPE" --project starcaster --config "$DOPPLER_CONFIG" --no-check-version -- \
  node scripts/reddit_watch_due.mjs || status=$?

if [ "$status" -eq 0 ]; then
  npm run --silent heartbeat -- --beat --role "$ROLE" || true
elif [ "$status" -eq 4 ]; then
  echo "=== $ROLE: nothing was read this pass — no beat recorded"
else
  echo "=== $ROLE pass exited $status"
  npm run --silent report:failure -- --job "$ROLE" --status "$status" --log "$LOG" || true
fi
exit "$status"
