#!/bin/bash
#
# Install (or remove) the Studio worker daemon on THIS machine — a launchd
# agent that KEEPS workers/studio/daemon.js alive.
#
#   ./scripts/install_studio_worker.sh              # install it here
#   ./scripts/install_studio_worker.sh --status     # installed? loaded? running? beating?
#   ./scripts/install_studio_worker.sh --uninstall  # remove it from here
#   ./scripts/install_studio_worker.sh --print-plist  # the exact plist, installing nothing
#
# PROVING THE RESTART, by hand, on the machine that owns the role — the
# acceptance criterion this script carries and the one no unit test can reach,
# because it is a claim about launchd rather than about our code:
#
#   ./scripts/install_studio_worker.sh --status     # note the PID in the "loaded:" line
#   kill -9 <that pid>
#   sleep 65                                        # ThrottleInterval is 60s
#   ./scripts/install_studio_worker.sh --status     # a DIFFERENT pid means KeepAlive worked
#
# The other half — the job the killed daemon was holding coming back — needs no
# launchd and is covered by scripts/builder/studioDaemon.test.js ("the tick
# reaps an expired lease"), because it is the queue's lease doing the work.
#
# WHY LAUNCHD AND KeepAlive. The daemon's recovery story is the queue's lease:
# a job whose worker died comes back when the next `reap()` finds the expired
# lease. That only helps if something starts a worker again, and nothing does
# it on its own — reboot the Mini and the pipeline is dead until a person
# remembers. KeepAlive inverts it: launchd starts the daemon at load, restarts
# it when it dies, and `--status` can actually answer "is it running?".
#
# ThrottleInterval bounds a crash loop. A daemon that dies on startup — a
# corrupt queue file, a missing disk — would otherwise be relaunched as fast as
# the machine can fork; 60 seconds keeps it to one attempt a minute, which is
# cheap enough to leave running and slow enough to read in a log.
#
# IT DOES NOT DECIDE WHETHER THIS MACHINE MAY RUN THE DAEMON. That is
# lib/nodeRoles.js's job (role `studio-worker`), and --status reports the
# verdict so the schedule can be installed on a new machine BEFORE ownership
# moves — the same layering as install_loop_runner.sh, for the same
# cutover-without-a-gap reason.
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1). The
# Mini's home is /Users/daneofearth and this laptop's is /Users/mentor; a
# literal path here would install cleanly and then fail on exactly the machine
# that matters, and launchd runs a job whose program does not exist by logging
# it where nobody looks.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.studio-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROLE="studio-worker"

# The plist, rendered to stdout. A separate function so `--print-plist` shows
# the EXACT bytes `--install` would write — checking a copy of a template is
# checking the copy. `plutil -lint <(./scripts/install_studio_worker.sh
# --print-plist)` is the whole verification, and it needs no launchd, no
# install and no privileges, so CI and a review pass can both run it.
render_plist() {
  # The daemon opens and writes its OWN log (workers/studio/daemon.js,
  # openLogWriter) and rotates it at a size cap, reopening the handle each time.
  # It echoes a line to stdout only when stdout is a terminal, so under launchd
  # this file really does catch nothing but what escapes — a startup refusal, a
  # PATH disaster, a stack trace on the way out.
  #
  # THAT IS WHY StandardOutPath IS NOT daemon.log. launchd opens this file once
  # and holds the handle; a rename does not move an open handle, so pointing it
  # at the rotated file would work exactly once and then grow forever inside
  # daemon.log.1 with nothing capping it. The daemon owning its own handle is
  # what makes the rotation real.
  #
  # Nothing rotates THIS file, and it does not need it: the only writer is a
  # crash, and ThrottleInterval below caps a crash loop at one stack trace a
  # minute — a few megabytes a week at the very worst, against a daemon log
  # capped at 48 MB. --status prints its size so it is never a blind spot.
  local LLOG="$HOME/Library/Logs/$LABEL.launchd.log"
  local NODE_BIN
  NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
  cat <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$REPO/workers/studio/daemon.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>60</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LLOG</string>
    <key>StandardErrorPath</key>
    <string>$LLOG</string>
</dict>
</plist>
PLIST_BODY
}

# IS THE JOB LOADED? — and `launchctl list | grep -q "$LABEL"` IS NOT HOW.
#
# It is not flaky, it is wrong 10 times out of 10 on this machine. `grep -q`
# exits the instant it matches; `launchctl list` is still writing its several
# hundred lines, so it takes SIGPIPE and exits 141 — and under `set -o pipefail`
# (line 48) that 141 becomes the pipeline's status, so the `if` takes the ELSE
# branch about a label that is loaded. Probed against a genuinely loaded system
# label: the pipe said "not loaded" 10/10, `launchctl list "$LABEL"` said
# "loaded" 10/10.
#
# What that cost: the `loaded: yes — PID` line could never print, which is the
# line the restart-proof procedure in this file tells you to read the PID from;
# and the status then said, confidently, "the daemon has never run on this
# machine" about a running daemon — the same class of false reading round 1 of
# this ticket was sent back for.
#
# `launchctl list` takes a label and exits non-zero when it is absent. No pipe,
# no race to lose.
is_loaded() {
  launchctl list "$LABEL" >/dev/null 2>&1
}

# The one-line summary row, for when it IS loaded. `launchctl list` is captured
# WHOLE into a variable first — grepping a variable cannot SIGPIPE the producer,
# because by then there is no producer left to signal.
loaded_row() {
  local all
  all="$(launchctl list 2>/dev/null || true)"
  printf '%s\n' "$all" | grep -F "$LABEL" || true
}

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    const v = checkRole("studio-worker");
    console.log(`role:     ${v.owned ? "this machine owns studio-worker" : `studio-worker is owned by ${v.owner}`}`);
  ' "$REPO"

  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST"; else echo "schedule: not installed on this machine"; fi
  if is_loaded; then
    echo "loaded:   yes — $(loaded_row)"
    echo "          (columns: PID, last exit code, label. A PID here means the daemon is alive right now.)"
  else
    echo "loaded:   no"
  fi

  # AN EMPTY READING THAT DOES NOT SAY WHY READS AS A BROKEN ONE (DOCTRINE 5.31).
  # "nothing written yet" was printed on every healthy daemon in the world,
  # because until this was fixed nothing ever wrote to this file at all. Now its
  # absence means something specific, so say the specific thing.
  local log="${STUDIO_LOG_DIR:-$HOME/Studio/logs}/daemon.log"
  local llog="$HOME/Library/Logs/$LABEL.launchd.log"
  if [ -f "$log" ]; then
    local rolled=0 f
    # `|| continue`, not `&&`: with `set -e`, a body whose last command is a
    # failed test kills the script, and an unmatched glob leaves "$log".* as a
    # literal — which is the ordinary case before the first rotation.
    for f in "$log".*; do [ -f "$f" ] || continue; rolled=$((rolled + 1)); done
    echo "log:      $log"
    echo "          $(wc -c < "$log" | tr -d ' ') bytes, last written $(date -r "$log" '+%Y-%m-%d %H:%M'), $rolled rotated copy/copies kept beside it"
  else
    echo "log:      $log — NOT THERE, and the daemon creates it the moment it starts."
    if is_loaded; then
      echo "          launchd says it is loaded, so this means it is failing before its first line."
      echo "          Read $llog — the refusal is in there."
    else
      echo "          Nothing is loaded here, so this is expected: the daemon has never run on this machine."
    fi
  fi
  if [ -f "$llog" ]; then
    echo "launchd:  $llog ($(wc -c < "$llog" | tr -d ' ') bytes — crashes and startup failures only)"
  else
    echo "launchd:  $llog — not there, which means launchd has never started the job here"
  fi

  # THE BEAT IS THE ONLY ANSWER THAT SURVIVES A LIE. launchd can report a live
  # PID for a process that is wedged and doing nothing; the beat is written by
  # the daemon's own loop, so it is the one line here that a stuck daemon
  # cannot produce.
  node -e '
    const { readBeat } = require(process.argv[1] + "/lib/nodeHeartbeat.js");
    const b = readBeat({ role: "studio-worker" });
    if (!b.readable) { console.log(`beat:     could not be read — ${b.why}`); }
    else if (!b.found) { console.log("beat:     none yet on this machine (it has never run here, or has never completed a tick)"); }
    else { console.log(`beat:     last tick ${b.beat.at}`); }
  ' "$REPO"
  echo
  echo "Is it beating, judged against its threshold:  npm run heartbeat -- --stale-check"
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine."
  echo "Any job it was holding comes back on its own when another daemon reaps the expired lease."
  echo "Confirm with: $0 --status"
}

install_it() {
  # A schedule pointing at a worktree works until the worktree ships and is
  # deleted. Install from the main checkout only (same guard as the loop
  # runner's and the relay's).
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi

  # launchd hands the job almost no environment, so everything it needs has to
  # be findable now, on the machine doing the installing — not discovered at
  # 3am by a job that exits 1 into a log nobody reads.
  for bin in node ffmpeg ffprobe; do
    if ! command -v "$bin" >/dev/null; then
      echo "Cannot find $bin on this machine — the daemon would install and then fail on every media job." >&2
      echo "Install it first (brew install ffmpeg covers the last two), then run this again." >&2
      exit 1
    fi
  done

  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "${STUDIO_LOG_DIR:-$HOME/Studio/logs}"

  render_plist > "$PLIST"

  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — kept alive from $REPO."
  echo
  status
}

case "${1:-}" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  --print-plist)        render_plist ;;
  ""|--install)         install_it ;;
  *)
    echo "usage: $0 [--install | --uninstall | --status | --print-plist]" >&2
    exit 2
    ;;
esac
