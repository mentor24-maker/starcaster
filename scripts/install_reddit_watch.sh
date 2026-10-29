#!/bin/bash
#
# Install (or remove) the Reddit watch schedule on THIS machine — a
# launchd agent that runs scripts/run_reddit_watch.sh every four hours.
# Outreach wizard 18/19, task 86bcrmbwm.
#
#   ./scripts/install_reddit_watch.sh                # install it here
#   ./scripts/install_reddit_watch.sh --status       # installed? loaded? last run? beating?
#   ./scripts/install_reddit_watch.sh --uninstall    # remove it from here
#   ./scripts/install_reddit_watch.sh --print-plist  # the exact plist, installing nothing
#
# THE MINI, AND IT REFUSES ANYWHERE ELSE. The watch reads subreddits
# through the OpenClaw browser, which lives on the machine that owns `openclaw`
# in lib/nodeRoles.js; role `reddit-watch` sits beside it. Anywhere
# else there is no signed-in browser, and every pass would fail.
#
# A SCHEDULED PASS, NOT A DAEMON. StartInterval 14400 (four hours) with
# RunAtLoad; launchd never starts a second copy while one is running.
#
# WHAT IT NEEDS, checked before installing: node, npm and doppler; and a
# Doppler key for the prd config at ~/Studio (the Studio worker's install put
# it there). The OpenClaw gateway token is the gateway's own, in
# ~/.openclaw/.env, read by the pass at start.
#
# AFTER INSTALLING, move the `reddit-watch` row in lib/nodeHeartbeat.js
# from NOT_REPORTING_WHY to BEAT_EMITTERS (the numbers are written beside it),
# so the roll call starts expecting a beat.
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.reddit-watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROLE="reddit-watch"
LOG="$HOME/Library/Logs/reddit-watch.log"

render_plist() {
  local p
  for p in "$REPO" "$HOME"; do
    if ! printf '%s' "$p" | grep -Eq '^[A-Za-z0-9/._+@-]+$'; then
      echo "Refusing to write a plist: the path \"$p\" has a space or a character this script does not quote." >&2
      exit 1
    fi
  done
  cat <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$REPO/scripts/run_reddit_watch.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>StartInterval</key>
    <integer>14400</integer>
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
}

# `launchctl list <label>` rather than `launchctl list | grep -q`: under
# pipefail the grep's early exit SIGPIPEs launchctl and reads as "not loaded"
# (scripts/install_studio_worker.sh, is_loaded).
is_loaded() {
  launchctl list "$LABEL" >/dev/null 2>&1
}

role_verdict() {
  node -e '
    const { checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const v = checkRole(process.argv[2]);
    console.log(v.verdict + "\t" + (v.node.name || "(unnamed)") + "\t" + v.owner);
  ' "$REPO" "$ROLE"
}

status() {
  local verdict machine owner
  IFS=$'\t' read -r verdict machine owner < <(role_verdict)
  echo "machine:  $machine"
  if [ "$verdict" = "owned" ]; then echo "role:     this machine owns $ROLE"; else echo "role:     $ROLE is owned by $owner ($verdict)"; fi
  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST (every 4 hours)"; else echo "schedule: not installed on this machine"; fi
  if is_loaded; then echo "loaded:   yes"; else echo "loaded:   no"; fi
  if [ -f "$LOG" ]; then
    echo "log:      $LOG, last written $(date -r "$LOG" '+%Y-%m-%d %H:%M')"
    echo "          last line: $(tail -n 1 "$LOG")"
  else
    echo "log:      $LOG — not there, so the pass has never run on this machine"
  fi
  node -e '
    const { readBeat } = require(process.argv[1] + "/lib/nodeHeartbeat.js");
    const b = readBeat({ role: process.argv[2] });
    if (!b.readable) console.log(`beat:     could not be read — ${b.why}`);
    else if (!b.found) console.log("beat:     none yet on this machine (no pass has finished cleanly here)");
    else console.log(`beat:     last clean pass ${b.beat.at}`);
  ' "$REPO" "$ROLE"
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine."
}

install_it() {
  local verdict machine owner
  IFS=$'\t' read -r verdict machine owner < <(role_verdict)
  if [ "$verdict" != "owned" ]; then
    echo "Refusing to install: $ROLE belongs to $owner and this machine is $machine ($verdict)." >&2
    echo "The watch needs the signed-in OpenClaw browser, which is on $owner." >&2
    exit 1
  fi
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi
  for bin in node npm doppler; do
    if ! command -v "$bin" >/dev/null; then
      echo "Cannot find $bin on this machine — the pass would install and then fail every 4 hours." >&2
      exit 1
    fi
  done
  if ! doppler run --scope "$HOME/Studio" --project starcaster --config prd --no-check-version -- true >/dev/null 2>&1; then
    echo "Doppler cannot open the prd config from ~/Studio — the pass reads the production database through it and would fail every 4 hours." >&2
    exit 1
  fi
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  render_plist > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — every 4 hours from $REPO."
  echo
  status
}

case "${1:-}" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  --print-plist)        render_plist ;;
  ""|--install)         install_it ;;
  *) echo "usage: $0 [--install | --uninstall | --status | --print-plist]" >&2; exit 2 ;;
esac
