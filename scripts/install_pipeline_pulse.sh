#!/bin/bash
#
# Install (or remove) the pipeline-pulse schedule on THIS machine (hourly).
#
#   ./scripts/install_pipeline_pulse.sh              # install here
#   ./scripts/install_pipeline_pulse.sh --status     # is it installed? when did it last run?
#   ./scripts/install_pipeline_pulse.sh --uninstall  # remove it from here
#
# WHY THIS FILE EXISTS AT ALL (task 86bbqz7rg)
# `npm run pulse` was built, reviewed, shipped and declared Live in phase 1,
# and then never ran once on a schedule, because nobody ever created one. Its
# own closing line says "if a scheduled run does not print this line, that
# absence IS the alert" — and the absence was total, permanent, and alerted
# nobody for weeks while it had two live alarms in it.
#
# So the schedule is a committed script rather than a plist somebody types on
# one Mac. That is the same lesson install_bus_relay.sh was written for: an
# uncommitted schedule cannot be moved, cannot be inspected from anywhere else,
# and is how the failure alert got lost when ownership changed machines.
#
# WHY HOURLY, AND WHY THAT IS NOT A ROUND NUMBER PICKED FROM THE AIR
# The pulse's own stage thresholds are 2h (building), 4h (in review), 24h
# (ready to launch) and 7d (queued). A daily run cannot honour a two-hour
# threshold: it would report a stall up to a day after it started, which is a
# check that LOOKS like it works. Hourly gives two readings inside the tightest
# window with room to spare, and a pass costs one Loop Queue read plus a
# handful of `gh` calls — cheap enough that the tighter cadence buys real
# resolution rather than load.
#
# It does NOT decide whether this machine may run the pulse. lib/nodeRoles.js
# decides that, at RUN time, every run — so the schedule is harmless on a
# machine that does not own the role (it wakes, asks, says whose job it is, and
# exits 0). That layering means the schedule can be installed on a new machine
# BEFORE ownership moves, with no gap where nobody is watching.
#
# Every path is derived, never written down: this runs on more than one machine
# and a literal path is an assumption that fails silently on every machine but
# the one it was typed on (vault doctrine/NODES.md, principle P1).

set -euo pipefail

LABEL="com.starcaster.pipeline-pulse"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/pipeline-pulse.log"
# 3600 = hourly. See the note above for why this number and not a rounder one.
INTERVAL_SECONDS=3600

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    const v = checkRole("pipeline-pulse");
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    console.log(`owns it:  ${v.owned ? "yes" : `no — ${v.owner || "nobody"} does`}`);
  ' "$REPO"
  if [ -f "$PLIST" ]; then
    echo "schedule: INSTALLED at $PLIST (every $((INTERVAL_SECONDS / 60)) minutes)"
  else
    echo "schedule: not installed on this machine"
  fi
  if launchctl list | grep -q "$LABEL"; then
    echo "loaded:   yes — $(launchctl list | grep "$LABEL")"
    echo "          (columns: PID, last exit code, label. '-' for PID means not running right now, which is normal between runs.)"
  else
    echo "loaded:   no"
  fi
  if [ -f "$LOG" ]; then
    echo "log:      $LOG (last modified $(date -r "$LOG" '+%Y-%m-%d %H:%M'))"
    # "Installed and loaded" and "actually completing" are different questions,
    # and this job exists because the second one went unasked for weeks. The
    # publisher prints one line per pass; the last one is the honest answer.
    last_run="$(grep -c '^=== pipeline-pulse ' "$LOG" 2>/dev/null || echo 0)"
    echo "runs:     $last_run pass(es) recorded in that log"
    echo "last:     $(grep '^=== pipeline-pulse ' "$LOG" 2>/dev/null | tail -1 || echo '(none yet)')"
    echo "          $(grep '^=== exit ' "$LOG" 2>/dev/null | tail -1 || echo 'no pass has finished yet')"
  else
    echo "log:      $LOG (nothing written yet)"
  fi
  echo "beats:    $(node -e '
    const hb = require(process.argv[1] + "/lib/nodeHeartbeat.js");
    const b = hb.readBeat({ role: "pipeline-pulse" });
    if (b.found) console.log(`last local beat ${b.beat.at}`);
    else if (b.readable) console.log("no local beat recorded yet");
    else console.log(`the local beat stamp could not be read — ${b.why}`);
  ' "$REPO")"
}

uninstall() {
  if [ ! -f "$PLIST" ]; then
    echo "Nothing to remove — $LABEL is not installed on this machine."
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    return 0
  fi
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine ($PLIST deleted, job unloaded)."
  echo "Confirm with: ./scripts/install_pipeline_pulse.sh --status"
}

install() {
  # A worktree is a temporary folder that gets deleted when its thread ships. A
  # schedule pointing at one works perfectly until the day it silently does not.
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their" >&2
    echo "work ships — the schedule would quietly point at a folder that no longer exists." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

  # A launchd job gets almost no environment. Check for what it needs HERE, on
  # the machine doing the installing, rather than in a log file next week.
  for tool in npm node git gh doppler; do
    if ! command -v "$tool" >/dev/null; then
      echo "Cannot find $tool on this machine. The pulse needs it, so the schedule would" >&2
      echo "install and then fail on every run. Install it first." >&2
      exit 1
    fi
  done

  cat > "$PLIST" <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$REPO/scripts/run_pipeline_pulse.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>StartInterval</key>
    <integer>$INTERVAL_SECONDS</integer>
    <key>RunAtLoad</key>
    <false/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
</dict>
</plist>
PLIST_BODY

  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — runs every $((INTERVAL_SECONDS / 60)) minutes from $REPO."
  echo "Log: $LOG"
  echo
  echo "Trigger one now, rather than waiting an hour to find out it is broken:"
  echo "  launchctl kickstart -p gui/$(id -u)/$LABEL && sleep 60 && tail -40 \"$LOG\""
  echo
  status
}

case "${1:-}" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  ""|--install)         install ;;
  *)
    echo "usage: $0 [--install | --uninstall | --status]" >&2
    exit 2
    ;;
esac
