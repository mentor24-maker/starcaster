#!/bin/bash
#
# One scheduled Substack Notes search pass — what launchd runs every six hours
# on the Mini (scripts/install_substack_notes_search.sh). Outreach wizard 14/19,
# task 86bcrmbqu.
#
# The pass reads and writes the PRODUCTION database (that is where Dane's
# approved writers and keywords live), so it runs under `doppler run` with the
# prd key kept at ~/Studio — the same key the Studio and outreach workers use
# (scripts/install_youtube_outreach_worker.sh explains why that folder). No
# value is ever written to the plist, the disk or the log.
#
#   exit 0     -> a beat for `substack-notes-search` (clears its failure alarm)
#   otherwise  -> one bus post per 6 hours (scripts/report_job_failure.mjs)
#
# A machine that does not own the role exits 3 having done nothing, and records
# no beat: a pass that did not search is not a clean pass.

set -uo pipefail

export STARCASTER_CALLER=scheduled

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/Library/Logs/substack-notes-search.log"
ROLE="substack-notes-search"
DOPPLER_SCOPE="${SUBSTACK_SEARCH_DOPPLER_SCOPE:-$HOME/Studio}"
DOPPLER_CONFIG="${SUBSTACK_SEARCH_DOPPLER_CONFIG:-prd}"
cd "$REPO" || exit 1

owns=0
node -e '
  const { checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
  const v = checkRole(process.argv[2]);
  if (v.verdict !== "owned") { console.log(`=== ${process.argv[2]}: not this machine'"'"'s job (${v.verdict}, owner ${v.owner}) — nothing searched`); process.exit(3); }
' "$REPO" "$ROLE" || owns=$?
if [ "$owns" -ne 0 ]; then exit "$owns"; fi

status=0
doppler run --scope "$DOPPLER_SCOPE" --project starcaster --config "$DOPPLER_CONFIG" --no-check-version -- \
  node scripts/substack_notes_search_due.mjs || status=$?

if [ "$status" -eq 0 ]; then
  npm run --silent heartbeat -- --beat --role "$ROLE" || true
else
  echo "=== $ROLE pass exited $status"
  npm run --silent report:failure -- --job "$ROLE" --status "$status" --log "$LOG" || true
fi
exit "$status"
