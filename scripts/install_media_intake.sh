#!/bin/bash
#
# Install (or remove) the media-intake schedule on THIS machine — a launchd
# agent that runs scripts/run_media_intake.sh every 15 minutes. Ticket 86bcfgyxp.
#
#   ./scripts/install_media_intake.sh                # install it here
#   ./scripts/install_media_intake.sh --status       # installed? loaded? last run? beating?
#   ./scripts/install_media_intake.sh --uninstall    # remove it from here
#   ./scripts/install_media_intake.sh --print-plist  # the exact plist, installing nothing
#
# THE MACBOOK, AND IT REFUSES ANYWHERE ELSE. Zoom writes to the iCloud Drive of
# the Apple ID only the MacBook is signed in to; on the Mini the folder does not
# exist, so a schedule there would run every 15 minutes and fail every time.
# Unlike the studio-worker installer (which lets a schedule go in BEFORE
# ownership moves), this one refuses to install on a machine that does not own
# the role in lib/nodeRoles.js — there is no cutover to prepare, because no
# other machine can ever do this job.
#
# A SCHEDULED PASS, NOT A DAEMON. StartInterval 900 with RunAtLoad; launchd
# never starts a second copy while one is running, and a pass the laptop slept
# through simply runs at the next wake — nothing is lost, because each pass
# looks at everything since the cutover, not at "the last 15 minutes".
#
# WHAT IT NEEDS ON THE MACHINE, checked before installing:
#   - node and npm (the pass, and the beat/failure steps after it);
#   - rclone, with a remote named `gdrive:` signed in as mentorofaio — the one
#     account whose storage the uploads should spend (docs/STUDIO.md);
#   - read access to the Zoom folder from a scheduled job. macOS may refuse a
#     background job iCloud Drive until node has Full Disk Access; the pass
#     says so by name (EPERM) in the log rather than reporting "nothing new".
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.media-intake"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROLE="media-intake"
LOG="$HOME/Library/Logs/media-intake.log"

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
        <string>$REPO/scripts/run_media_intake.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>StartInterval</key>
    <integer>900</integer>
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
# (scripts/install_studio_worker.sh, is_loaded, round 2 of 86bbjv68y).
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
  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST (every 15 minutes)"; else echo "schedule: not installed on this machine"; fi
  if is_loaded; then echo "loaded:   yes"; else echo "loaded:   no"; fi
  if command -v rclone >/dev/null 2>&1; then
    if rclone listremotes 2>/dev/null | grep -qx 'gdrive:'; then echo "rclone:   found, remote gdrive: configured"
    else echo "rclone:   found, but NO remote named gdrive: — every upload would fail"; fi
  else
    echo "rclone:   NOT FOUND — every upload would fail (brew install rclone)"
  fi
  if [ -f "$LOG" ]; then
    echo "log:      $LOG, last written $(date -r "$LOG" '+%Y-%m-%d %H:%M')"
    echo "          last line: $(tail -n 1 "$LOG")"
  else
    echo "log:      $LOG — not there, so the pass has never run on this machine"
  fi
  node -e '
    const { readBeat } = require(process.argv[1] + "/lib/nodeHeartbeat.js");
    const b = readBeat({ role: "media-intake" });
    if (!b.readable) console.log(`beat:     could not be read — ${b.why}`);
    else if (!b.found) console.log("beat:     none yet on this machine (no pass has finished cleanly here)");
    else console.log(`beat:     last clean pass ${b.beat.at}`);
  ' "$REPO"
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine. The ledger is kept, so a reinstall never re-sends anything."
}

install_it() {
  local verdict machine owner
  IFS=$'\t' read -r verdict machine owner < <(role_verdict)
  if [ "$verdict" != "owned" ]; then
    echo "Refusing to install: $ROLE belongs to $owner and this machine is $machine ($verdict)." >&2
    echo "Zoom's recordings are in the iCloud Drive only $owner can see; here the pass would fail every 15 minutes." >&2
    exit 1
  fi
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi
  for bin in node npm rclone; do
    if ! command -v "$bin" >/dev/null; then
      echo "Cannot find $bin on this machine — the pass would install and then fail every 15 minutes." >&2
      exit 1
    fi
  done
  if ! rclone listremotes 2>/dev/null | grep -qx 'gdrive:'; then
    echo "rclone has no remote named gdrive: — set one up signed in as mentorofaio (rclone config), then run this again." >&2
    exit 1
  fi
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  render_plist > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — every 15 minutes from $REPO."
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
