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
#   exit 5     -> stopped for today by the Mini's daily AI limit (AI Quota
#                 5/5) before anything was read: NO beat and no failure post.
#                 The limit posts its own one line a day; a "reddit-watch
#                 failed" alarm on top of it would make the brake read as a
#                 broken job.
#   otherwise  -> one bus post per 6 hours (scripts/report_job_failure.mjs) —
#                 a signed-out browser included: it is a failure, never
#                 "found nothing".
#
# A machine that does not own the role exits 3 having done nothing, and
# records no beat: a pass that did not read is not a clean pass.
#
# --requested (SC-883, Read now): what the SECOND schedule runs every ten
# minutes (com.starcaster.reddit-watch-requests). It reads only the projects
# whose Read now is waiting. With nothing waiting the pass exits 4 at once
# having started no browser, and this script says nothing — 144 quiet wakes a
# day must not fill the log.
#
# ONE BROWSER PASS AT A TIME. Both schedules take the same lock
# ($HOME/Library/Caches/reddit-watch.flock), because two passes at once would be
# two browsers reading Dane's account together. The ten-minute check gives up
# quietly when the lock is held (its request stays waiting for the next wake);
# the four-hourly pass waits up to 30 minutes for a Read now pass to finish —
# the longest one can run is two subreddits at five minutes plus two post
# visits at three each, 22 minutes.

set -uo pipefail

export STARCASTER_CALLER=scheduled

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/Library/Logs/reddit-watch.log"
ROLE="reddit-watch"
MODE=""
if [ "${1:-}" = "--requested" ]; then
  MODE="--requested"
  LOG="$HOME/Library/Logs/reddit-watch-requests.log"
fi
LOCK="${REDDIT_WATCH_LOCK:-$HOME/Library/Caches/reddit-watch.flock}"
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

# The lock is a kernel lock (flock) on a file, held by a small perl wrapper
# around the pass (perl ships with macOS; there is no flock command). The
# kernel releases it the instant the holder dies, however it dies, so there
# is no stale lock to take over and no takeover race: two waiters can never
# both decide a lock is dead, and a death between taking it and writing a
# pid cannot leave it held forever — the two faults the earlier mkdir lock
# had (review of PR #1085).
#
# with_lock <seconds to wait, 0 = do not wait> <command...>
#   exits 75 if the lock could not be taken in time; otherwise the command's
#   own exit code.
LOCK_BUSY=75
with_lock() {
  local wait="$1"; shift
  mkdir -p "$(dirname "$LOCK")"
  /usr/bin/perl -MFcntl=:flock -e '
    my ($file, $wait, @cmd) = @ARGV;
    open(my $fh, ">>", $file) or do { print STDERR "reddit-watch: cannot open the lock $file: $!\n"; exit 75 };
    if ($wait > 0) {
      local $SIG{ALRM} = sub { exit 75 };
      alarm $wait;
      flock($fh, LOCK_EX) or exit 75;
      alarm 0;
    } else {
      flock($fh, LOCK_EX | LOCK_NB) or exit 75;
    }
    my $rc = system(@cmd);
    exit 127 if $rc == -1;
    exit 128 + ($rc & 127) if $rc & 127;
    exit $rc >> 8;
  ' "$LOCK" "$wait" "$@"
}

if [ -n "$MODE" ]; then
  # A pass is already reading: the request waits for the next wake.
  wait_for=0
else
  wait_for=1800
fi

status=0
with_lock "$wait_for" doppler run --scope "$DOPPLER_SCOPE" --project starcaster --config "$DOPPLER_CONFIG" --no-check-version -- \
  node scripts/reddit_watch_due.mjs $MODE || status=$?

if [ "$status" -eq "$LOCK_BUSY" ]; then
  if [ -n "$MODE" ]; then exit 4; fi
  echo "=== $ROLE: a Read now pass has held the browser for 30 minutes — this pass did not run"
  npm run --silent report:failure -- --job "$ROLE" --status 6 --log "$LOG" || true
  exit 6
fi

if [ "$status" -eq 0 ]; then
  # Only the four-hourly pass beats. A Read now pass beating under the same
  # role would let presses mask a four-hourly schedule that has died.
  if [ -z "$MODE" ]; then npm run --silent heartbeat -- --beat --role "$ROLE" || true; fi
elif [ "$status" -eq 4 ]; then
  # Read now's check with nothing waiting: the usual case, and silent.
  if [ -z "$MODE" ]; then echo "=== $ROLE: nothing was read this pass — no beat recorded"; fi
elif [ "$status" -eq 5 ]; then
  echo "=== $ROLE: stopped for today by the Mini's AI limit — no beat, no failure post"
else
  echo "=== $ROLE pass exited $status"
  npm run --silent report:failure -- --job "$ROLE" --status "$status" --log "$LOG" || true
fi
exit "$status"
