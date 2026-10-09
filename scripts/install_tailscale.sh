#!/bin/bash
#
# Keep Tailscale running on THIS machine — a launchd agent for `tailscaled`, the
# background half of Tailscale that carries the Funnel route production uses to
# reach the YouTube download helper (workers/youtube-media, port 8080).
# Ticket 86bcfn4yb.
#
#   ./scripts/install_tailscale.sh                # install it here (or repair it)
#   ./scripts/install_tailscale.sh --status       # installed? loaded? running? is Funnel on?
#   ./scripts/install_tailscale.sh --uninstall    # stop it and remove the schedule
#   ./scripts/install_tailscale.sh --print-plist  # the exact plist, installing nothing
#
# WHY THIS EXISTS. The README used to start tailscaled by hand with `nohup ... &`.
# That survives nothing: a crash, a sign-out, a reboot, and it is gone with no
# job to bring it back. It went down that way twice — off 2026-09-10 to 10-04
# (24 days, found when Dane tried a download), and again 2026-10-05 21:35 until
# this ticket. Production could not download a single video either time.
#
# PROVING THE RESTART, by hand, on the machine that owns the role:
#
#   ./scripts/install_tailscale.sh --status     # note the PID on the "loaded:" line
#   kill -9 <that pid>
#   sleep 15                                    # ThrottleInterval is 10s
#   ./scripts/install_tailscale.sh --status     # a DIFFERENT pid means KeepAlive worked
#
# THE FUNNEL ROUTE IS NOT IN THIS SCRIPT. `tailscale funnel --bg 8080` is saved
# in tailscaled's own state file (~/.tailscale/tailscaled.state), so it comes
# back by itself whenever tailscaled does. --status shows it; if it is ever
# missing, `$TS funnel --bg 8080` puts it back (README step 8).
#
# THE ONE HAND STEP is Dane's: the first `tailscale login`, in a browser. The
# state file keeps that sign-in, so restarts never need him again.
#
# IT DOES NOT DECIDE WHETHER THIS MACHINE MAY RUN IT. lib/nodeRoles.js does
# (role `youtube-media`, which is what the tunnel exists for); install refuses
# on a machine that does not own it, because a second machine claiming the same
# Tailscale hostname would steal the route.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.tailscaled"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROLE="youtube-media"

STATE_DIR="$HOME/.tailscale"
SOCKET="$STATE_DIR/tailscaled.sock"
LOG="$HOME/Library/Logs/tailscaled.log"

find_bin() {
  local name="$1" c
  for c in "/opt/homebrew/opt/tailscale/bin/$name" "/opt/homebrew/bin/$name" "/usr/local/bin/$name"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

render_plist() {
  local DAEMON
  DAEMON="$(find_bin tailscaled || echo /opt/homebrew/opt/tailscale/bin/tailscaled)"
  local p
  for p in "$DAEMON" "$STATE_DIR" "$LOG"; do
    if ! printf '%s' "$p" | grep -Eq '^[A-Za-z0-9/._+@-]+$'; then
      echo "Refusing to write a plist: the path \"$p\" has a space or a character this script does not quote." >&2
      exit 1
    fi
  done
  # Userspace networking: no root, and Funnel exposes one local port outward
  # without routing anything into the machine's network stack (README step 8).
  cat <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$DAEMON</string>
        <string>--tun=userspace-networking</string>
        <string>--statedir=$STATE_DIR</string>
        <string>--socket=$SOCKET</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
</dict>
</plist>
PLIST_BODY
}

is_loaded() {
  launchctl list "$LABEL" >/dev/null 2>&1
}

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
    const v = checkRole(process.argv[2]);
    console.log(`role:     ${v.owned ? `this machine owns ${process.argv[2]}` : `${process.argv[2]} is owned by ${v.owner}`}`);
  ' "$REPO" "$ROLE"

  local daemon cli
  if daemon="$(find_bin tailscaled)"; then echo "binary:   $daemon"; else echo "binary:   tailscaled NOT FOUND (brew install tailscale)"; fi
  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST"; else echo "schedule: not installed on this machine"; fi
  if is_loaded; then
    echo "loaded:   yes — $(loaded_row)"
    echo "          (columns: PID, last exit code, label. A PID here means tailscaled is alive right now.)"
  else
    echo "loaded:   no"
  fi

  local ok=0
  if cli="$(find_bin tailscale)"; then
    local st
    # Captured whole, then trimmed: piping straight into `head` lets the pipe
    # close early, and under pipefail that reads as tailscale having failed.
    if st="$("$cli" --socket "$SOCKET" status 2>&1)"; then
      echo "tailnet:  connected"
      printf '%s\n' "$st" | head -1 | sed 's/^/          /'
    else
      echo "tailnet:  NOT connected — $(printf '%s\n' "$st" | head -1)"
      ok=1
    fi
    local fs
    fs="$("$cli" --socket "$SOCKET" funnel status 2>&1 || true)"
    if printf '%s' "$fs" | grep -q 'Funnel on'; then
      echo "funnel:   on"
      printf '%s\n' "$fs" | grep -E 'https://|proxy' | sed 's/^/          /'
    else
      echo "funnel:   NOT on — production cannot reach the YouTube download helper"
      echo "          put it back with: $cli --socket $SOCKET funnel --bg 8080"
      ok=1
    fi
  fi
  if [ -f "$LOG" ]; then
    echo "log:      $LOG ($(wc -c < "$LOG" | tr -d ' ') bytes, last written $(date -r "$LOG" '+%Y-%m-%d %H:%M'))"
  fi
  echo
  echo "Can production reach it?  npm run worker-watch"
  return $ok
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine. Its state ($STATE_DIR — the sign-in and the"
  echo "Funnel route) is left in place, so installing again does not need Dane to sign in again."
  echo "Production cannot reach the YouTube download helper until it is installed again."
}

install_it() {
  local verdict
  verdict="$(node -e '
    const { checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const v = checkRole(process.argv[2]);
    console.log(v.owned ? "yes" : `no ${v.owner}`);
  ' "$REPO" "$ROLE")"
  if [ "$verdict" != "yes" ]; then
    echo "Refusing to install: lib/nodeRoles.js gives the $ROLE role to ${verdict#no }, not this machine." >&2
    echo "The Tailscale tunnel belongs with the helper it carries traffic to." >&2
    exit 3
  fi
  if ! find_bin tailscaled >/dev/null; then
    echo "tailscaled is not installed here:  brew install tailscale" >&2
    exit 1
  fi

  # A copy started by hand (the old README way) holds the socket; a second one
  # would fail to start and launchd would restart it every 10 seconds forever.
  local stray
  stray="$(pgrep -f 'tailscaled.*--socket' || true)"
  if [ -n "$stray" ] && ! is_loaded; then
    echo "Stopping a tailscaled started by hand (pid $stray) so launchd can own it."
    kill $stray 2>/dev/null || true
    sleep 2
  fi

  mkdir -p "$STATE_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  render_plist > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — kept alive by launchd, restarted after a stop or a reboot."
  echo "Giving it 10 seconds to reconnect..."
  sleep 10
  echo
  status
}

MODE="${1:-}"
[ $# -le 1 ] || { echo "usage: $0 [--install | --uninstall | --status | --print-plist]" >&2; exit 2; }

case "$MODE" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  --print-plist)        render_plist ;;
  ""|--install)         install_it ;;
  *) echo "usage: $0 [--install | --uninstall | --status | --print-plist]" >&2; exit 2 ;;
esac
