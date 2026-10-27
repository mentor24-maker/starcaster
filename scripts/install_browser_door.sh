#!/bin/bash
#
# Install (or remove) the browser door keeper on THIS machine — a launchd agent
# that keeps workers/browser-door/server.js alive, plus the one Tailscale Funnel
# path (/live) that lets Starcaster's server and the viewer reach it.
# Outreach wizard 5/19 · sign-in window slice 3 (ticket 86bcrmbdw).
# Plan: docs/LIVE_BROWSER_VIEW.md §3 and §9.
#
#   ./scripts/install_browser_door.sh                # install it here (or repair it)
#   ./scripts/install_browser_door.sh --status       # installed? loaded? answering? is /live routed?
#   ./scripts/install_browser_door.sh --uninstall    # stop it, remove the schedule AND the route
#   ./scripts/install_browser_door.sh --print-plist  # the exact plist, installing nothing
#
#   Any of them takes --doppler-scope <folder> (default ~/Studio): which folder's
#   Doppler key the door keeper's `prd` settings are read through.
#
# THEN PROVE IT FROM OUTSIDE — the acceptance check this script carries:
#
#   ./scripts/check_browser_door_route.sh --from macbook-pro
#
# WHAT IS EXPOSED, AND WHAT IS NOT. The Mini already has one public address,
# Tailscale Funnel's, and `/` on it leads to the YouTube download helper (port
# 8080). This adds ONE more path, `/live`, leading to 127.0.0.1:8091. Funnel
# forwards only the paths it is told about, and Tailscale strips the `/live`
# prefix on the way in, so the door keeper sees `/open` and `/live` exactly as
# it does locally — which is why Starcaster's BROWSER_DOOR_URL is
# `https://<funnel host>/live` and nothing longer. The OpenClaw gateway (18789)
# and OpenClaw's Chrome control port (18800) are not routed anywhere, and the
# door keeper itself listens on loopback only (written into server.js, not a
# setting), so the Funnel path is its single way in.
#
# TAILSCALE IS NOT INSTALLED HERE. scripts/install_tailscale.sh keeps tailscaled
# alive under launchd (com.starcaster.tailscaled, ticket 86bcfn4yb), and this
# script refuses to add a route when that job is not loaded — a route on a
# tunnel nothing restarts is the 24-day outage of 2026-09/10 waiting to repeat.
#
# THE ROUTE IS ADDED ONLY ONCE THE DOOR KEEPER ANSWERS. A Funnel path to a port
# nothing listens on is harmless (Funnel answers 502) but it reads as "installed"
# to anyone looking at `funnel status`, so install waits for 127.0.0.1:8091 to
# answer its bare 404 first, and refuses the route if it never does.
#
# WHERE ITS SECRET COMES FROM. The door keeper refuses to start without
# BROWSER_DOOR_SECRET, the value it shares with Starcaster's server (Vercel)
# and nothing else. launchd hands a job PATH and HOME and nothing more, so the
# plist runs the door keeper UNDER `doppler run` and the value never touches
# the plist, the disk or this script's output. Config `prd`, because it is the
# same value Vercel holds. Doppler keeps ONE key per folder, and on the Mini the
# repo folder's key is the read-only `dev` one the loops use, so the `prd` key
# lives at ~/Studio (where install_studio_worker.sh already put one, 86bccuqq0)
# and every `doppler run` here names that scope.
#
# NAMES, NEVER VALUES (docs/DOCTRINE.md §4.1). The settings preflight prints only
# whether the setting is present. Generating the secret is Dane's keystroke —
# it is a new value — so a missing one is refused with the step to take.
#
# IT DOES NOT DECIDE WHETHER THIS MACHINE MAY RUN IT. lib/nodeRoles.js does
# (role `browser-door`), and install refuses elsewhere: the door keeper drives
# the browser profiles on ONE disk, and a second machine adding `/live` to the
# same Funnel hostname is not possible anyway.
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.browser-door"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROLE="browser-door"
PORT=8091
ROUTE="/live"
DOPPLER_CONFIG="prd"
DOPPLER_SCOPE="$HOME/Studio"
TAILSCALE_LABEL="com.starcaster.tailscaled"
TS_SOCKET="$HOME/.tailscale/tailscaled.sock"
LLOG="$HOME/Library/Logs/$LABEL.launchd.log"
DOOR_LOG="$HOME/.starcaster/logs/browser-door.log"

find_tailscale() {
  local c
  for c in /opt/homebrew/opt/tailscale/bin/tailscale /opt/homebrew/bin/tailscale /usr/local/bin/tailscale; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

# The plist, rendered to stdout, so `--print-plist` shows the EXACT bytes
# `--install` writes. `plutil -lint <(... --print-plist)` is the whole check.
render_plist() {
  local NODE_BIN DOPPLER_BIN
  NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
  DOPPLER_BIN="$(command -v doppler || echo /opt/homebrew/bin/doppler)"
  # Unquoted on one sh line, so a path with a space or a character sh or XML
  # would read is refused rather than escaped. `@` is fine (node@22).
  local p
  for p in "$DOPPLER_BIN" "$NODE_BIN" "$REPO" "$DOPPLER_SCOPE"; do
    if ! printf '%s' "$p" | grep -Eq '^[A-Za-z0-9/._+@-]+$'; then
      echo "Refusing to write a plist: the path \"$p\" has a space or a character this script does not quote." >&2
      exit 1
    fi
  done
  local COMMAND_LINE="exec $DOPPLER_BIN run --scope $DOPPLER_SCOPE --project starcaster --config $DOPPLER_CONFIG --no-check-version -- $NODE_BIN $REPO/workers/browser-door/server.js"
  cat <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>$COMMAND_LINE</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO/workers/browser-door</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
        <key>BROWSER_DOOR_PORT</key>
        <string>$PORT</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LLOG</string>
    <key>StandardErrorPath</key>
    <string>$LLOG</string>
</dict>
</plist>
PLIST_BODY
}

# `launchctl list "$LABEL"`, never `launchctl list | grep -q` — under pipefail
# that pipe reads "not loaded" about a loaded job 10 times in 10
# (scripts/builder/studioWorkerInstaller.test.js has the story).
is_loaded() {
  launchctl list "$LABEL" >/dev/null 2>&1
}

loaded_row() {
  local all
  all="$(launchctl list 2>/dev/null || true)"
  printf '%s\n' "$all" | grep -F "$LABEL" || true
}

# Three answers, never two: 0 present, 1 missing, 2 CANNOT TELL. The check runs
# INSIDE `doppler run` and prints a marker first; no marker means Doppler
# refused, whatever else it printed.
settings_preflight() {
  if ! command -v doppler >/dev/null 2>&1; then
    echo "settings: CANNOT TELL — the doppler command is not on this machine, and the door keeper's secret comes from it."
    return 2
  fi
  local out rc=0
  out="$(doppler run --scope "$DOPPLER_SCOPE" --project starcaster --config "$DOPPLER_CONFIG" --no-check-version -- \
    node -e '
      console.log("@@PREFLIGHT");
      console.log(String(process.env.BROWSER_DOOR_SECRET || "").trim() ? "present" : "missing");
      console.log(String(process.env.BROWSER_DOOR_ATTACH || "").trim() ? "attach set" : "attach unset");
    ' 2>&1)" || rc=$?
  if ! printf '%s\n' "$out" | grep -q '^@@PREFLIGHT$'; then
    echo "settings: CANNOT TELL — Doppler would not hand over the \"$DOPPLER_CONFIG\" config through the key at $DOPPLER_SCOPE (exit $rc)."
    echo "          Doppler said: $(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | head -1)"
    return 2
  fi
  if printf '%s\n' "$out" | grep -q '^attach set$'; then
    echo "attach:   BROWSER_DOOR_ATTACH is set — one project attaches to a Chrome that is already running (OpenClaw's)"
  else
    echo "attach:   BROWSER_DOOR_ATTACH is not set — every project gets a Chrome of its own"
  fi
  if printf '%s\n' "$out" | grep -q '^missing$'; then
    echo "settings: MISSING — BROWSER_DOOR_SECRET is not in Doppler config \"$DOPPLER_CONFIG\". The door keeper refuses to start without it."
    return 1
  fi
  echo "settings: OK — BROWSER_DOOR_SECRET is present in Doppler config \"$DOPPLER_CONFIG\" (name checked, value not shown)"
  return 0
}

# Does the door keeper answer on loopback? Its answer to anything but its two
# routes is a bare `404 Not found`, so that exact reply is the proof it is the
# door keeper and not something else that took the port.
door_answers() {
  local body code
  body="$(curl -sS -m 3 -o - -w '\n%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  code="$(printf '%s\n' "$body" | tail -1)"
  [ "$code" = "404" ] && printf '%s\n' "$body" | head -1 | grep -qx 'Not found'
}

# The funnel status, captured whole (piping into grep can SIGPIPE tailscale and
# pipefail would read that as a failure).
funnel_status() {
  local ts
  ts="$(find_tailscale)" || return 1
  "$ts" --socket "$TS_SOCKET" funnel status 2>&1 || true
}

route_present() {
  local fs
  fs="$(funnel_status)" || return 1
  printf '%s\n' "$fs" | grep -Eq "^\|-- $ROUTE +proxy http://127\.0\.0\.1:$PORT\$"
}

funnel_host() {
  local fs
  fs="$(funnel_status)" || return 1
  printf '%s\n' "$fs" | sed -n 's|^https://\([^ ]*\) (Funnel on)$|\1|p' | head -1
}

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    const v = checkRole(process.argv[2]);
    console.log(`role:     ${v.owned ? `this machine owns ${process.argv[2]}` : `${process.argv[2]} is owned by ${v.owner}`}`);
  ' "$REPO" "$ROLE"

  local rc=0 pre=0
  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST"; else echo "schedule: not installed on this machine"; fi
  settings_preflight || pre=$?
  if is_loaded; then
    echo "loaded:   yes — $(loaded_row)"
    echo "          (columns: PID, last exit code, label. A PID here means the door keeper is alive right now.)"
  else
    echo "loaded:   no"
  fi
  if door_answers; then
    echo "answers:  yes — 127.0.0.1:$PORT gives the door keeper's bare 404"
  else
    echo "answers:  NO — nothing on 127.0.0.1:$PORT gives the door keeper's reply"
    rc=1
  fi
  if launchctl list "$TAILSCALE_LABEL" >/dev/null 2>&1; then
    echo "tunnel:   $TAILSCALE_LABEL is loaded (scripts/install_tailscale.sh --status for the detail)"
  else
    echo "tunnel:   $TAILSCALE_LABEL is NOT loaded — nothing restarts Tailscale, so the route below dies with it"
    rc=1
  fi
  local ts
  if ts="$(find_tailscale)" && "$ts" --socket "$TS_SOCKET" debug prefs 2>/dev/null | grep -q '"ShieldsUp": *true'; then
    echo "shields:  up — no device on the tailnet can open a connection to this Mini"
  else
    echo "shields:  DOWN — Tailscale here hands a tailnet connection to the same port on 127.0.0.1, so every"
    echo "          loopback-only service (OpenClaw 18789, its Chrome 18800, this door keeper) is reachable"
    echo "          from every device on the tailnet. Measured 2026-10-27; docs/LIVE_BROWSER_VIEW.md §3."
  fi
  if route_present; then
    local host
    host="$(funnel_host || true)"
    echo "route:    $ROUTE -> 127.0.0.1:$PORT is on Funnel"
    [ -n "$host" ] && echo "          Starcaster's BROWSER_DOOR_URL is https://$host$ROUTE"
  else
    echo "route:    NO $ROUTE path on Funnel — Starcaster cannot reach the door keeper"
    rc=1
  fi
  if [ -f "$DOOR_LOG" ]; then
    echo "log:      $DOOR_LOG ($(wc -c < "$DOOR_LOG" | tr -d ' ') bytes, last written $(date -r "$DOOR_LOG" '+%Y-%m-%d %H:%M'); input counts only, never what was typed)"
  else
    echo "log:      $DOOR_LOG — not there yet (the door keeper writes it on its first window)"
  fi
  if [ -f "$LLOG" ]; then
    echo "launchd:  $LLOG ($(wc -c < "$LLOG" | tr -d ' ') bytes — startup line, refusals and crashes)"
  fi
  echo
  if [ "$pre" -ne 0 ] || [ "$rc" -ne 0 ]; then
    echo "verdict:  NOT SERVING — see the lines above"
  else
    echo "verdict:  serving on $ROUTE"
  fi
  echo "From outside:  ./scripts/check_browser_door_route.sh --from macbook-pro"
  # Exit 0 whenever the reading was TAKEN, whatever it found: doctor:node runs
  # this and reads a non-zero exit as "--status did not answer", which would
  # turn "not installed here" into CANNOT TELL. The verdict line is the answer.
  return 0
}

remove_route() {
  local ts
  ts="$(find_tailscale)" || return 0
  if route_present; then
    "$ts" --socket "$TS_SOCKET" funnel --bg --yes --set-path "$ROUTE" off >/dev/null
    echo "Removed the $ROUTE path from Funnel. The other paths (/ -> the YouTube download helper) are untouched."
  fi
}

uninstall() {
  remove_route
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine. The browser profiles (~/.starcaster/browsers) are left in place,"
  echo "so the sign-ins survive a reinstall."
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
    exit 3
  fi

  # A schedule pointing at a worktree works until the worktree ships and is
  # deleted. Main checkout only (same guard as the other installers).
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi

  local pre=0
  settings_preflight || pre=$?
  if [ "$pre" -eq 1 ]; then
    cat >&2 <<'PROMPT'
Refusing to install: the door keeper would restart every 30 seconds, refusing to start each time.

::: PROMPT FOR DANE :::
  Add BROWSER_DOOR_SECRET to Doppler (project starcaster, config prd) AND to Vercel (Production)
  Why: it is the one value the Mini and Starcaster's server share so only Starcaster can open a
       window. It is a NEW secret, so the keystroke is yours (docs/DOCTRINE.md §4.1).

  Doppler dashboard > starcaster > prd > Add Secret > BROWSER_DOOR_SECRET, value from:
      openssl rand -hex 32
  Then put the SAME value in Vercel > starcaster > Settings > Environment Variables (Production).
:::::::::::::::::::::::
PROMPT
    exit 1
  elif [ "$pre" -ne 0 ]; then
    echo "Refusing to install: could not confirm the door keeper's secret (see above)." >&2
    exit 2
  fi

  if ! launchctl list "$TAILSCALE_LABEL" >/dev/null 2>&1; then
    echo "Refusing to install: $TAILSCALE_LABEL is not loaded, so nothing would restart the tunnel the route rides on." >&2
    echo "Run ./scripts/install_tailscale.sh first." >&2
    exit 1
  fi
  local ts
  if ! ts="$(find_tailscale)"; then
    echo "Cannot find the tailscale command (brew install tailscale)." >&2
    exit 1
  fi
  for bin in node doppler curl; do
    command -v "$bin" >/dev/null || { echo "Cannot find $bin on this machine." >&2; exit 1; }
  done
  if [ ! -d "$REPO/workers/browser-door/node_modules" ]; then
    echo "Installing the door keeper's own packages (workers/browser-door, npm ci)..."
    (cd "$REPO/workers/browser-door" && npm ci --no-audit --no-fund >/dev/null)
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HOME/.starcaster/logs"
  render_plist > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — kept alive from $REPO."

  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    door_answers && break
    sleep 2
  done
  if ! door_answers; then
    echo "The door keeper did not answer on 127.0.0.1:$PORT within 20 seconds, so the route was NOT added." >&2
    echo "Read $LLOG for why." >&2
    exit 1
  fi

  if ! route_present; then
    "$ts" --socket "$TS_SOCKET" funnel --bg --yes --set-path "$ROUTE" "http://127.0.0.1:$PORT" >/dev/null
    echo "Added the $ROUTE path to Funnel."
  fi
  echo
  status
}

usage() {
  echo "usage: $0 [--install | --uninstall | --status | --print-plist] [--doppler-scope <folder>]" >&2
  exit 2
}

MODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --doppler-scope)
      [ $# -ge 2 ] || usage
      DOPPLER_SCOPE="$2"; shift 2 ;;
    --doppler-scope=*)
      DOPPLER_SCOPE="${1#*=}"; shift ;;
    --uninstall|--remove|--status|--print-plist|--install)
      [ -z "$MODE" ] || usage
      MODE="$1"; shift ;;
    *) usage ;;
  esac
done

case "$MODE" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  --print-plist)        render_plist ;;
  ""|--install)         install_it ;;
esac
