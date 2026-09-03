#!/bin/bash
#
# Install (or remove) the loop runners on THIS machine — loop-build and
# loop-review, each a launchd agent that KEEPS the committed runner alive.
#
#   ./scripts/install_loop_runner.sh              # install both loops here
#   ./scripts/install_loop_runner.sh --status     # installed? running? locks?
#   ./scripts/install_loop_runner.sh --uninstall  # remove both from here
#
# WHY LAUNCHD AND NOT SCREEN (2026-09-02, task 86bbtuje2). The loops ran for
# two weeks inside screen sessions somebody started by hand. That model has no
# boot story at all: reboot the Mini and both loops are dead until a person
# remembers them — and with no beats (the other half of this ticket) nothing
# would have said so. KeepAlive inverts it: launchd starts the runner at load,
# restarts it if it dies, and `--status` can actually answer "is it running?".
#
# It does NOT decide whether this machine may run the loops. That is
# lib/nodeRoles.js's job, checked by the pass itself at run time — so the
# schedule is harmless on a machine that does not own the roles, and can be
# installed on a new machine BEFORE ownership moves (the same layering as
# install_bus_relay.sh, for the same cutover-without-a-gap reason).
#
# THE LOCK AND KEEPALIVE TOGETHER: the runner refuses to start when another
# holds the lock, and launchd would relaunch a refuser forever. ThrottleInterval
# keeps that cheap (one line every 5 minutes), and the runner clears a STALE
# lock itself — so the only sustained refusal is the honest one, a second live
# runner, which is exactly the situation that must keep refusing.
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS=(loop-build loop-review)
# The fallback interval each runner is configured with — what it sleeps when
# `next-interval` cannot answer. The live pacing comes from the repo each
# cycle; these only bound the failure mode. Build 900 / review 1200 mirrors
# how the hand-started screens were run.
#
# A case statement, not an associative array: macOS ships bash 3.2, which
# has none, and this script exists to run on a Mac — the failure would be a
# launch-time error on exactly the machine that matters.
fallback_of() {
  case "$1" in
    loop-build)  echo 900 ;;
    loop-review) echo 1200 ;;
    *)           echo 3600 ;;
  esac
}

label_of() { echo "com.starcaster.$1"; }
plist_of() { echo "$HOME/Library/LaunchAgents/$(label_of "$1").plist"; }

status_one() {
  local skill="$1" label plist lock
  label="$(label_of "$skill")"
  plist="$(plist_of "$skill")"
  lock="$HOME/loop-logs/$skill.lock"
  echo "── $skill"
  if [ -f "$plist" ]; then echo "schedule: INSTALLED at $plist"; else echo "schedule: not installed on this machine"; fi
  if launchctl list | grep -q "$label"; then
    echo "loaded:   yes — $(launchctl list | grep "$label")"
    echo "          (columns: PID, last exit code, label. A PID here means the runner is alive right now.)"
  else
    echo "loaded:   no"
  fi
  # The lock, read honestly: held by a live process, stale, or absent. A stale
  # lock self-clears on the runner's next start, but a person asking --status
  # deserves the truth now, not after the next relaunch.
  if [ -d "$lock" ]; then
    local pid; pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "lock:     held by live pid $pid — a runner is working"
    else
      echo "lock:     STALE (pid ${pid:-unrecorded} is gone) — the next start clears it; if nothing starts, that is the fault to chase"
    fi
  else
    echo "lock:     none"
  fi
  local log="$HOME/loop-logs/$skill.log"
  if [ -f "$log" ]; then echo "log:      $log (last modified $(date -r "$log" '+%Y-%m-%d %H:%M'))"; else echo "log:      $log (nothing written yet)"; fi
}

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    for (const role of ["loop-build", "loop-review"]) {
      const v = checkRole(role);
      console.log(`${role}: ${v.owned ? "this machine owns it" : `owned by ${v.owner}`}`);
    }
  ' "$REPO"
  for s in "${SKILLS[@]}"; do status_one "$s"; done
}

uninstall() {
  for s in "${SKILLS[@]}"; do
    local_label="$(label_of "$s")"
    launchctl bootout "gui/$(id -u)/$local_label" 2>/dev/null || true
    rm -f "$(plist_of "$s")"
    echo "Removed $local_label from this machine."
  done
  echo "Locks are left for the runners' own stale-lock handling. Confirm with: $0 --status"
}

install() {
  # A schedule pointing at a worktree works until the worktree ships and is
  # deleted. Install from the main checkout only (same guard as the relay's).
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HOME/loop-logs"

  # launchd hands the job almost no environment: everything the runner and its
  # passes need has to be findable now, on the machine doing the installing.
  for bin in npm doppler claude; do
    if ! command -v "$bin" >/dev/null && [ ! -x "$HOME/.local/bin/$bin" ]; then
      echo "Cannot find $bin on this machine — the loops would install and then fail on every pass." >&2
      exit 1
    fi
  done

  for s in "${SKILLS[@]}"; do
    local_label="$(label_of "$s")"
    local_plist="$(plist_of "$s")"
    # The runner's own log is ~/loop-logs/<skill>.log; this launchd log only
    # catches what escapes it (startup refusals, PATH disasters).
    local_llog="$HOME/Library/Logs/$local_label.launchd.log"

    cat > "$local_plist" <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$local_label</string>
    <key>ProgramArguments</key>
    <array>
        <string>$REPO/scripts/loop_runner.sh</string>
        <string>$s</string>
        <string>$(fallback_of "$s")</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>300</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$local_llog</string>
    <key>StandardErrorPath</key>
    <string>$local_llog</string>
</dict>
</plist>
PLIST_BODY

    launchctl bootout "gui/$(id -u)/$local_label" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$local_plist"
    echo "Installed $local_label — kept alive from $REPO (fallback interval $(fallback_of "$s")s)."
  done
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
