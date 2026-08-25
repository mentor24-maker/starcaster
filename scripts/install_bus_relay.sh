#!/bin/bash
#
# Install (or remove) the bus-relay schedule on THIS machine (every 10 minutes).
#
# bus-relay is the only automated path from "Dane replied on a ticket" to "the
# loop carries on". Until 2026-08-23 its schedule existed as a launchd job
# somebody typed by hand on one Mac, written down nowhere — so moving it meant
# reconstructing it from memory, and "is it still installed on the old
# machine?" had no answer short of going and looking. This script is that
# answer: one command to install, one to remove, and `--status` to look.
#
#   ./scripts/install_bus_relay.sh              # install here, run every 10 minutes
#   ./scripts/install_bus_relay.sh --status     # is it installed here? when did it last run?
#   ./scripts/install_bus_relay.sh --uninstall  # remove it from here
#
# It does NOT decide whether this machine may relay. That is lib/nodeRoles.js's
# job and it is checked at RUN time, every run — so the schedule is harmless on
# a machine that does not own the role (it wakes, asks, says whose job it is,
# and exits 0). That layering is deliberate: it means the schedule can be
# installed on the new machine BEFORE ownership moves, and the cutover has no
# gap where neither machine is relaying.
#
# Every path is derived, never written down. This script runs on more than one
# machine and a literal path is an assumption that fails silently on all but
# the one it was typed on (vault doctrine/NODES.md, principle P1).

set -euo pipefail

LABEL="com.starcaster.bus-relay"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/bus-relay-launchd.log"
# How often the relay wakes. 600 = every 10 minutes.
#
# This was 3600 until 2026-08-23 (task 86bbk2fuh). Hourly was a sensible
# default while the relay only NOTIFIED; the day it started merging
# (2026-08-21) it became the throughput ceiling for the whole pipeline, and
# nobody revisited it. A pass does the entire job in about 14 seconds and
# costs no tokens at all — it is a plain Node script, not a Claude session —
# so the interval, not the work, was what made an approved PR wait up to an
# hour.
#
# The number that bounds this is ClickUp's ~100 requests per minute. A
# measured steady pass uses 39 (see docs/LOOP_ENGINEERING.md), and because a
# pass finishes in ~14 seconds it never shares a rate-limit minute with the
# next one — so shortening the interval does not raise the peak. What raises
# it is a bigger open queue: the count grows with open tickets and operator
# comments, so re-read the "requests this pass" line the relay prints before
# shortening this again.
INTERVAL_SECONDS=600

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    const v = checkRole("bus-relay");
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    console.log(`owns it:  ${v.owned ? "yes" : `no — ${v.owner} does`}`);
  ' "$REPO"
  if [ -f "$PLIST" ]; then
    echo "schedule: INSTALLED at $PLIST"
  else
    echo "schedule: not installed on this machine"
  fi
  # How often it actually wakes, and whether that still matches the repo.
  # Without this line the only place drift shows up is the relay's own log,
  # which is not where a person looks when they ask "is this running right?".
  REPO="$REPO" BUS_RELAY_PLIST="$PLIST" "$REPO/scripts/bus_relay_interval.sh" "interval: " || true
  if launchctl list | grep -q "$LABEL"; then
    echo "loaded:   yes — $(launchctl list | grep "$LABEL")"
    echo "          (columns: PID, last exit code, label. '-' for PID means not running right now, which is normal between runs.)"
  else
    echo "loaded:   no"
  fi
  if [ -f "$LOG" ]; then
    echo "log:      $LOG (last modified $(date -r "$LOG" '+%Y-%m-%d %H:%M'))"
  else
    echo "log:      $LOG (nothing written yet)"
  fi
}

uninstall() {
  if [ ! -f "$PLIST" ]; then
    echo "Nothing to remove — $LABEL is not installed on this machine."
    # Still try to unload, in case a plist was deleted without unloading first.
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    return 0
  fi
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine ($PLIST deleted, job unloaded)."
  echo "Confirm with: ./scripts/install_bus_relay.sh --status"
}

install() {
  # A worktree is a temporary folder that gets deleted when its thread ships.
  # A schedule pointing at one works perfectly until the day it silently does
  # not, which is the exact failure this whole ticket is about. Install from
  # the main checkout.
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their" >&2
    echo "work ships — the schedule would quietly point at a folder that no longer exists." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

  # A launchd job gets almost no environment, so `npm` and `doppler` have to be
  # findable through the PATH set in the plist below. Check now, on the machine
  # doing the installing, rather than discovering it in a log file ten minutes later.
  if ! command -v npm >/dev/null; then
    echo "Cannot find npm on this machine — install Node before installing the schedule." >&2
    exit 1
  fi
  if ! command -v doppler >/dev/null; then
    echo "Cannot find doppler on this machine. The relay reads its ClickUp token through" >&2
    echo "Doppler, so the schedule would install and then fail on every pass." >&2
    exit 1
  fi

  cat > "$PLIST" <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$REPO/scripts/run_bus_relay.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>StartInterval</key>
    <integer>$INTERVAL_SECONDS</integer>
    <key>RunAtLoad</key>
    <true/>
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
