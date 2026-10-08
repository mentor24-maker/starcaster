#!/bin/bash
#
# Install (or remove) the outreach posting worker on THIS machine — a launchd
# agent that KEEPS workers/youtube-outreach/poster.js alive. YouTube outreach
# 5/7, task 86bcda68h. Modelled on scripts/install_studio_worker.sh; read that
# file's header for the long version of every choice below.
#
#   ./scripts/install_youtube_outreach_worker.sh              # install it here
#   ./scripts/install_youtube_outreach_worker.sh --status     # installed? loaded? beating?
#   ./scripts/install_youtube_outreach_worker.sh --uninstall  # remove it from here
#   ./scripts/install_youtube_outreach_worker.sh --print-plist  # the exact plist, installing nothing
#
#   Any of them takes --doppler-config <name> (default prd) and
#   --doppler-scope <folder> (default ~/Studio — see below).
#
# DO NOT INSTALL IT BEFORE THE BROWSER IS SIGNED IN. The worker posts through
# OpenClaw's dane-of-earth browser; until Dane has signed that browser in to
# YouTube (ticket 86bcfbvvq), every comment he approves would fail. That is why
# lib/nodeProvision.js lists this job as blocked rather than letting
# `provision:node --apply` run this script. Check the sign-in first:
#
#   node scripts/openclaw_smoke.mjs        # exit 0 = signed in as Dane of Earth
#
# IT DOES NOT DECIDE WHETHER THIS MACHINE MAY RUN THE WORKER. lib/nodeRoles.js
# does (role `youtube-outreach-worker`, owner mac-mini); --status reports it.
#
# WHERE ITS SETTINGS COME FROM. launchd hands a job PATH and HOME and nothing
# else, so the plist runs the worker UNDER `doppler run`, and no value ever
# touches the plist, the disk or this script's output (docs/DOCTRINE.md §4.1).
# The config defaults to prd: the comments live in the production database, and
# a worker reading the Mini's local one would find nothing approved, forever,
# while looking perfectly healthy.
#
# THE DOPPLER KEY LIVES AT ~/Studio. Doppler keeps one key per folder, and the
# repo folder's key on the Mini is the read-only `dev` one the loops run on. The
# Studio worker's install put a `prd` key at ~/Studio (86bccuqq0); this worker
# reads the same one rather than asking Dane to mint a second production key.
#
# THE OPENCLAW TOKEN IS NOT IN DOPPLER. It is the gateway's own, in
# ~/.openclaw/.env, written by scripts/install_openclaw.sh; the worker reads it
# from there at start, exactly as scripts/openclaw_smoke.mjs does, and refuses
# to talk to any OpenClaw that is not on this machine.
#
# Every path is derived, never written down (vault doctrine/NODES.md, P1).

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.youtube-outreach-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LLOG="$HOME/Library/Logs/$LABEL.log"
ROLE="youtube-outreach-worker"

DEFAULT_DOPPLER_CONFIG="prd"
DOPPLER_CONFIG=""
DOPPLER_CONFIG_FROM=""
DOPPLER_SCOPE="$HOME/Studio"

# What the worker cannot work without. A line with a `|` is satisfied by any one
# of its names. YOUTUBE_OUTREACH_CHANNEL_ID is optional (when set, the proof
# check also compares the comment's author) and is not listed.
REQUIRED_SETTINGS="YOUTUBE_OUTREACH_PROJECT_ID
SUPABASE_URL
SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY
YOUTUBE_API_KEY|YOUTUBE_DATA_API_KEY|GOOGLE_API_KEY
BLOB_READ_WRITE_TOKEN"

# The plist, to stdout, so --print-plist shows the EXACT bytes --install writes.
render_plist() {
  local NODE_BIN DOPPLER_BIN
  NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
  DOPPLER_BIN="$(command -v doppler || echo /opt/homebrew/bin/doppler)"
  local p
  for p in "$DOPPLER_BIN" "$NODE_BIN" "$REPO" "$DOPPLER_SCOPE"; do
    if ! printf '%s' "$p" | grep -Eq '^[A-Za-z0-9/._+@-]+$'; then
      echo "Refusing to write a plist: the path \"$p\" has a space or a character this script does not quote." >&2
      exit 1
    fi
  done
  local COMMAND_LINE="exec $DOPPLER_BIN run --scope $DOPPLER_SCOPE --project starcaster --config $DOPPLER_CONFIG --no-check-version -- $NODE_BIN $REPO/workers/youtube-outreach/poster.js"
  # The worker writes a line only when something changed (a post, a failure, a
  # new reason to wait), so this unrotated log grows by a few lines a day.
  # ThrottleInterval caps a crash loop at one stack trace a minute.
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

# `launchctl list <label>` — never `launchctl list | grep -q`, which SIGPIPEs
# under pipefail and reads "not loaded" about a loaded job (install_studio_worker.sh).
is_loaded() {
  launchctl list "$LABEL" >/dev/null 2>&1
}

loaded_row() {
  local all
  all="$(launchctl list 2>/dev/null || true)"
  printf '%s\n' "$all" | grep -F "$LABEL" || true
}

# Three answers, never two: 0 all present, 1 something missing (named),
# 2 CANNOT TELL. Names only, never values.
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
    echo "settings: CANNOT TELL — Doppler would not hand over the \"$DOPPLER_CONFIG\" config at $DOPPLER_SCOPE (exit $rc)."
    echo "          Doppler said: $(printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | head -1)"
    return 2
  fi
  local missing host_line host kind
  missing="$(printf '%s\n' "$out" | sed -n 's/^missing //p')"
  host_line="$(printf '%s\n' "$out" | grep '^host ' || true)"
  host="$(printf '%s\n' "$host_line" | awk '{print $2}')"
  kind="$(printf '%s\n' "$host_line" | awk '{print $3}')"
  case "$kind" in
    production) echo "database: the worker would read approved comments from $host — the PRODUCTION database" ;;
    local)      echo "database: the worker would read $host — a database on THIS machine, where nothing Dane approves ever appears" ;;
    *)          echo "database: CANNOT TELL — SUPABASE_URL is not a readable address under the \"$DOPPLER_CONFIG\" config" ;;
  esac

  local token_rc=0
  if grep -q '^OPENCLAW_GATEWAY_TOKEN=.' "$HOME/.openclaw/.env" 2>/dev/null; then
    echo "openclaw: gateway token present in ~/.openclaw/.env (value not shown)"
  else
    echo "openclaw: MISSING — no OPENCLAW_GATEWAY_TOKEN in ~/.openclaw/.env. Install OpenClaw here first (./scripts/install_openclaw.sh)."
    token_rc=1
  fi

  if [ -n "$missing" ]; then
    echo "settings: MISSING under Doppler config \"$DOPPLER_CONFIG\" — the worker would start and fail without:"
    printf '%s\n' "$missing" | sed 's/^/            /'
    return 1
  fi
  [ "$token_rc" -eq 0 ] || return 1
  echo "settings: OK — every required setting is present under Doppler config \"$DOPPLER_CONFIG\" (names checked, values not shown)"
  return 0
}

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    const v = checkRole(process.argv[2]);
    console.log(`role:     ${v.owned ? `this machine owns ${process.argv[2]}` : `${process.argv[2]} is owned by ${v.owner}`}`);
  ' "$REPO" "$ROLE"
  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST"; else echo "schedule: not installed on this machine"; fi
  echo "doppler:  config \"$DOPPLER_CONFIG\" ($DOPPLER_CONFIG_FROM), key stored at $DOPPLER_SCOPE"
  local preflight_rc=0
  settings_preflight || preflight_rc=$?
  if is_loaded; then
    echo "loaded:   yes — $(loaded_row)"
    echo "          (columns: PID, last exit code, label. A PID here means the worker is alive right now.)"
  else
    echo "loaded:   no"
  fi
  if [ -f "$LLOG" ]; then
    echo "log:      $LLOG ($(wc -c < "$LLOG" | tr -d ' ') bytes, last written $(date -r "$LLOG" '+%Y-%m-%d %H:%M'))"
  else
    echo "log:      $LLOG — not there, which means launchd has never started the worker here"
  fi
  node -e '
    const { readBeat } = require(process.argv[1] + "/lib/nodeHeartbeat.js");
    const b = readBeat({ role: process.argv[2] });
    if (!b.readable) { console.log(`beat:     could not be read — ${b.why}`); }
    else if (!b.found) { console.log("beat:     none yet on this machine (it has never run here, or never finished a pass)"); }
    else { console.log(`beat:     last pass ${b.beat.at}`); }
  ' "$REPO" "$ROLE"
  return "$preflight_rc"
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL from this machine. Approved comments stay approved until a worker runs again."
}

install_it() {
  local preflight_rc=0
  settings_preflight || preflight_rc=$?
  if [ "$preflight_rc" -eq 1 ]; then
    echo "Refusing to install: the worker would fail without the setting(s) named above." >&2
    exit 1
  elif [ "$preflight_rc" -ne 0 ]; then
    echo "Refusing to install: could not confirm the worker's settings (see above)." >&2
    exit 2
  fi
  # A schedule pointing at a worktree works until the worktree ships and is deleted.
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships." >&2
    echo "Run this from the main checkout instead." >&2
    exit 1
  fi
  for bin in node doppler; do
    if ! command -v "$bin" >/dev/null; then
      echo "Cannot find $bin on this machine — install it first." >&2
      exit 1
    fi
  done
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  render_plist > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — kept alive from $REPO."
  echo
  status
}

usage() {
  echo "usage: $0 [--install | --uninstall | --status | --print-plist] [--doppler-config <name>] [--doppler-scope <folder>]" >&2
  exit 2
}

MODE=""
DOPPLER_SCOPE_FLAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --doppler-config)
      [ $# -ge 2 ] || usage
      DOPPLER_CONFIG="$2"; DOPPLER_CONFIG_FROM="from --doppler-config"; shift 2 ;;
    --doppler-config=*)
      DOPPLER_CONFIG="${1#*=}"; DOPPLER_CONFIG_FROM="from --doppler-config"; shift ;;
    --doppler-scope)
      [ $# -ge 2 ] || usage
      DOPPLER_SCOPE_FLAG="$2"; shift 2 ;;
    --doppler-scope=*)
      DOPPLER_SCOPE_FLAG="${1#*=}"; shift ;;
    --uninstall|--remove|--status|--print-plist|--install)
      [ -z "$MODE" ] || usage
      MODE="$1"; shift ;;
    *) usage ;;
  esac
done

# No flag: what the INSTALLED plist uses, so --status describes the real job.
if [ -z "$DOPPLER_CONFIG" ] && [ -f "$PLIST" ]; then
  DOPPLER_CONFIG="$(sed -n 's/.* --project starcaster --config \([A-Za-z0-9_-]*\) .*/\1/p' "$PLIST" | head -1)"
  [ -n "$DOPPLER_CONFIG" ] && DOPPLER_CONFIG_FROM="read from the installed schedule"
fi
if [ -z "$DOPPLER_SCOPE_FLAG" ] && [ -f "$PLIST" ]; then
  installed_scope="$(sed -n 's/.* run --scope \([A-Za-z0-9/._+@-]*\) .*/\1/p' "$PLIST" | head -1)"
  [ -n "$installed_scope" ] && DOPPLER_SCOPE="$installed_scope"
fi
if [ -n "$DOPPLER_SCOPE_FLAG" ]; then DOPPLER_SCOPE="$DOPPLER_SCOPE_FLAG"; fi
if [ -z "$DOPPLER_CONFIG" ]; then
  DOPPLER_CONFIG="$DEFAULT_DOPPLER_CONFIG"; DOPPLER_CONFIG_FROM="the default"
fi
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
