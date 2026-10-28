#!/bin/bash
#
# Install (or remove) the Site Import worker's schedule on THIS machine — a
# launchd job that runs `scripts/site_import_worker.mjs --drain` every five
# minutes, so a queued import is picked up without anybody starting anything.
#
#   ./scripts/install_site_import_worker.sh              # install it here
#   ./scripts/install_site_import_worker.sh --status     # installed? last run? beating? anything waiting?
#   ./scripts/install_site_import_worker.sh --uninstall  # remove it from here
#   ./scripts/install_site_import_worker.sh --print-plist  # the exact plist, installing nothing
#
#   Any of them takes --doppler-config <name> (default prd) and
#   --doppler-scope <folder> (default ~/Studio).
#
# WHY IT EXISTS (ticket 86bctakm0). Dane queued an import of alphire.agency on
# 2026-10-13 and it sat in `queued` for 14 days, never claimed, because the
# worker only ran when somebody typed the command — and the screen said only
# that it "starts when the worker runs on the operator's machine". A second
# import (wavecenter.com) was found the same way, 15 days old.
#
# A SCHEDULE, NOT A KeepAlive DAEMON. Each pass starts node afresh from the
# checkout on disk, so the worker never keeps importing with code from weeks
# ago — the trap a long-running `--watch` process would set. launchd does not
# start a second copy of a job that is still running, so a long import just
# delays the next pass. A pass with nothing queued takes a few seconds, and
# each one rebuilds the import engine from source before it starts.
#
# IT DOES NOT DECIDE WHETHER THIS MACHINE MAY RUN THE WORKER. lib/nodeRoles.js
# does (role `site-import-worker`): `--drain` asks it first and does nothing on
# a machine that does not own the role, so the schedule can be installed on a
# new machine before ownership moves, as with the other installers.
#
# WHERE ITS SETTINGS COME FROM — the same arrangement as the Studio worker
# (scripts/install_studio_worker.sh explains it in full). The worker needs
# PRODUCTION credentials: imports feed the live review screen, and the worker
# refuses a local database outright. On the Mini the repo folder's Doppler key
# is the read-only `dev` one the loops use, so the `prd` key lives at ~/Studio
# and every `doppler run` here names that scope. Names are checked, values are
# never printed (docs/DOCTRINE.md §4.1).
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.site-import-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROLE="site-import-worker"
LOG="$HOME/Library/Logs/$LABEL.log"
INTERVAL_SECONDS=300

DOPPLER_CONFIG="prd"
DOPPLER_SCOPE="$HOME/Studio"

# What the worker refuses to start without (its own checks, top of the script).
REQUIRED_SETTINGS="SUPABASE_URL
SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY
BLOB_READ_WRITE_TOKEN"

render_plist() {
  local NODE_BIN DOPPLER_BIN p
  NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
  DOPPLER_BIN="$(command -v doppler || echo /opt/homebrew/bin/doppler)"
  # Paths go into the plist unquoted; refuse anything the shell or XML would read.
  for p in "$DOPPLER_BIN" "$NODE_BIN" "$REPO" "$DOPPLER_SCOPE" "$LOG"; do
    if ! printf '%s' "$p" | grep -Eq '^[A-Za-z0-9/._+@-]+$'; then
      echo "Refusing to write a plist: the path \"$p\" has a space or a character this script does not quote." >&2
      exit 1
    fi
  done
  # The engine the worker loads (lib/site-import/dist/*.js) is a generated,
  # gitignored build that `npm run build` does NOT make, so the main checkout
  # can hold none of it — or last month's. Rebuilding from source first (about
  # 1.5 seconds) means every pass imports with the code on disk, and a pass
  # whose build fails stops there with no beat rather than importing with
  # whatever was left behind.
  local COMMAND_LINE="$NODE_BIN $REPO/scripts/build_site_import_bundle.mjs &amp;&amp; exec $DOPPLER_BIN run --scope $DOPPLER_SCOPE --project starcaster --config $DOPPLER_CONFIG --no-check-version -- $NODE_BIN $REPO/scripts/site_import_worker.mjs --drain"
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
}

# `launchctl list <label>` rather than `launchctl list | grep -q`: the pipe
# SIGPIPEs under pipefail and reads a loaded job as absent
# (install_studio_worker.sh, is_loaded, has the measurement).
is_loaded() {
  launchctl list "$LABEL" >/dev/null 2>&1
}

# Three answers, never two: 0 present, 1 missing (named), 2 CANNOT TELL.
settings_preflight() {
  if ! command -v doppler >/dev/null 2>&1; then
    echo "settings: CANNOT TELL — the doppler command is not on this machine, and the worker gets every setting from it."
    return 2
  fi
  local out rc=0
  out="$(doppler run --scope "$DOPPLER_SCOPE" --project starcaster --config "$DOPPLER_CONFIG" --no-check-version -- \
    node -e '
      const { classify } = require(process.argv[1] + "/lib/environmentBanner.js");
      const has = (n) => String(process.env[n] || "").trim() !== "";
      console.log("@@PREFLIGHT");
      for (const line of process.argv[2].split("\n").filter(Boolean)) {
        const names = line.split("|");
        console.log((names.some(has) ? "present " : "missing ") + names.join(" or "));
      }
      let host = "";
      try { host = new URL(String(process.env.SUPABASE_URL || "").trim()).hostname; } catch (_) {}
      console.log("host " + (host || "-") + " " + classify(process.env.SUPABASE_URL));
    ' "$REPO" "$REQUIRED_SETTINGS" 2>&1)" || rc=$?

  if ! printf '%s\n' "$out" | grep -q '^@@PREFLIGHT$'; then
    echo "settings: CANNOT TELL — Doppler would not hand over the \"$DOPPLER_CONFIG\" config from $DOPPLER_SCOPE (exit $rc)."
    echo "          Doppler said: $(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | head -1)"
    return 2
  fi
  local missing host_line host kind
  missing="$(printf '%s\n' "$out" | sed -n 's/^missing //p')"
  host_line="$(printf '%s\n' "$out" | grep '^host ' || true)"
  host="$(printf '%s\n' "$host_line" | awk '{print $2}')"
  kind="$(printf '%s\n' "$host_line" | awk '{print $3}')"
  case "$kind" in
    production) echo "database: imports would be written to $host — the PRODUCTION database the Site Import screen reads" ;;
    local)      echo "database: $host is a database on THIS machine — the worker refuses that, so every pass would fail" ;;
    *)          echo "database: CANNOT TELL — SUPABASE_URL is not a readable address under \"$DOPPLER_CONFIG\"" ;;
  esac
  if [ -n "$missing" ]; then
    echo "settings: MISSING under Doppler config \"$DOPPLER_CONFIG\" — every pass would fail without:"
    printf '%s\n' "$missing" | sed 's/^/            /'
    return 1
  fi
  if [ "$kind" != "production" ]; then return 1; fi
  echo "settings: OK — every required setting is present under \"$DOPPLER_CONFIG\" (names checked, values not shown)"
  return 0
}

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    const v = checkRole("site-import-worker");
    console.log(`role:     ${v.owned ? "this machine owns site-import-worker" : `site-import-worker is owned by ${v.owner || "nobody"} — a pass here does nothing`}`);
  ' "$REPO"
  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST (every $INTERVAL_SECONDS seconds)"; else echo "schedule: not installed on this machine"; fi
  echo "doppler:  config \"$DOPPLER_CONFIG\", key stored at $DOPPLER_SCOPE"
  local preflight_rc=0
  settings_preflight || preflight_rc=$?
  if is_loaded; then
    echo "loaded:   yes — $(launchctl list "$LABEL" 2>/dev/null | grep -E '"(PID|LastExitStatus)"' | tr -s ' \n' ' ')"
    echo "          (a PID means a pass is running right now; LastExitStatus 0 means the last pass finished cleanly)"
  else
    echo "loaded:   no"
  fi
  if [ -f "$LOG" ]; then
    echo "log:      $LOG ($(wc -c < "$LOG" | tr -d ' ') bytes, last written $(date -r "$LOG" '+%Y-%m-%d %H:%M'))"
  else
    echo "log:      $LOG — not there, so launchd has never run a pass on this machine"
  fi
  # The beat is written by the worker itself after it has read the queue, so it
  # is the one line here a broken pass cannot produce.
  node -e '
    const { readBeat } = require(process.argv[1] + "/lib/nodeHeartbeat.js");
    const b = readBeat({ role: "site-import-worker" });
    if (!b.readable) console.log(`beat:     could not be read — ${b.why}`);
    else if (!b.found) console.log("beat:     none yet on this machine (no pass has read the queue here)");
    else console.log(`beat:     last read the queue at ${b.beat.at}`);
  ' "$REPO"
  echo
  echo "Anything waiting in production's queue right now:  npm run site-import-watch"
  return "$preflight_rc"
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine. Queued imports will now wait until it is installed somewhere."
}

install_it() {
  local preflight_rc=0
  settings_preflight || preflight_rc=$?
  if [ "$preflight_rc" -ne 0 ]; then
    echo "Refusing to install: every pass would fail without the settings above (or they could not be confirmed)." >&2
    exit "$preflight_rc"
  fi
  # A schedule pointing at a worktree works until the worktree ships and is deleted.
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi
  for bin in node doppler; do
    if ! command -v "$bin" >/dev/null; then
      echo "Cannot find $bin on this machine — every pass would fail. Install it first." >&2
      exit 1
    fi
  done
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  render_plist > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — a drain every $INTERVAL_SECONDS seconds from $REPO."
  echo
  status
}

usage() {
  echo "usage: $0 [--install | --uninstall | --status | --print-plist] [--doppler-config <name>] [--doppler-scope <folder>]" >&2
  exit 2
}

MODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --doppler-config) [ $# -ge 2 ] || usage; DOPPLER_CONFIG="$2"; shift 2 ;;
    --doppler-config=*) DOPPLER_CONFIG="${1#*=}"; shift ;;
    --doppler-scope) [ $# -ge 2 ] || usage; DOPPLER_SCOPE="$2"; shift 2 ;;
    --doppler-scope=*) DOPPLER_SCOPE="${1#*=}"; shift ;;
    --uninstall|--remove|--status|--print-plist|--install)
      [ -z "$MODE" ] || usage
      MODE="$1"; shift ;;
    *) usage ;;
  esac
done
if ! printf '%s' "$DOPPLER_CONFIG" | grep -Eq '^[A-Za-z0-9_-]+$'; then
  echo "\"$DOPPLER_CONFIG\" is not a Doppler config name (letters, digits, - and _ only)." >&2
  exit 2
fi

case "$MODE" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  --print-plist)        render_plist ;;
  ""|--install)         install_it ;;
esac
