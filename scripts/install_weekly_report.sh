#!/bin/bash
#
# Install (or remove) the weekly-report schedule on THIS machine (Mondays 07:00).
#
#   ./scripts/install_weekly_report.sh              # install here
#   ./scripts/install_weekly_report.sh --status     # is it installed? when did it last run?
#   ./scripts/install_weekly_report.sh --uninstall  # remove it from here
#
# Written the same way as install_bus_relay.sh, and for the same reason: the
# bus relay's schedule existed for months as something somebody typed by hand on
# one Mac, written down nowhere, so "is it still installed on the old machine?"
# had no answer short of going and looking. One script to install, one flag to
# look, and the arrangement is a file rather than a memory.
#
# It does NOT decide whether this machine may run the report. lib/nodeRoles.js
# decides that, at RUN time, every run — so the schedule is harmless on a
# machine that does not own the role (it wakes, writes the figures locally,
# declines to publish, and exits 0). That layering means the schedule can be
# installed on a new machine BEFORE ownership moves, with no gap where neither
# machine reports.
#
# Every path is derived, never written down: this runs on more than one machine
# and a literal path is an assumption that fails silently on all but the one it
# was typed on (vault doctrine/NODES.md, principle P1).

set -euo pipefail

LABEL="com.starcaster.weekly-report"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/weekly-report.log"
# Monday, 07:00 local. Monday because the window it reports is the week that
# just ended; 07:00 because the pull request should be waiting when Dane starts,
# not arrive while he is reading it.
WEEKDAY=1
HOUR=7
MINUTE=0

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    const v = checkRole("weekly-report");
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    console.log(`owns it:  ${v.owned ? "yes" : `no — ${v.owner} does`}`);
  ' "$REPO"
  if [ -f "$PLIST" ]; then
    echo "schedule: INSTALLED at $PLIST (Mondays $(printf '%02d:%02d' "$HOUR" "$MINUTE"))"
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
  else
    echo "log:      $LOG (nothing written yet)"
  fi
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
  echo "Confirm with: ./scripts/install_weekly_report.sh --status"
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
  # the machine doing the installing, rather than in a log file next Monday.
  for tool in npm node git gh doppler; do
    if ! command -v "$tool" >/dev/null; then
      echo "Cannot find $tool on this machine. The report needs it, so the schedule would" >&2
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
        <string>$REPO/scripts/run_weekly_report.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>$WEEKDAY</integer>
        <key>Hour</key>
        <integer>$HOUR</integer>
        <key>Minute</key>
        <integer>$MINUTE</integer>
    </dict>
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
  echo "Installed $LABEL — runs Mondays at $(printf '%02d:%02d' "$HOUR" "$MINUTE") from $REPO."
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
