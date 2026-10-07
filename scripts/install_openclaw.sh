#!/bin/bash
#
# Install (or remove) the OpenClaw gateway on THIS machine — a launchd agent
# that KEEPS it alive, with a browser profile signed in to YouTube as Dane of
# Earth. YouTube outreach 3/7 (ticket 86bcda5wp).
#
#   ./scripts/install_openclaw.sh                # install it here (or repair it)
#   ./scripts/install_openclaw.sh --status       # installed? loaded? running? who can reach it?
#   ./scripts/install_openclaw.sh --uninstall    # stop it and remove the schedule
#   ./scripts/install_openclaw.sh --print-plist  # the exact plist, installing nothing
#   ./scripts/install_openclaw.sh --print-config # the exact openclaw.json, installing nothing
#
# PROVING THE RESTART, by hand, on the machine that owns the role — the claim
# no unit test can reach, because it is about launchd rather than our code:
#
#   ./scripts/install_openclaw.sh --status      # note the PID on the "loaded:" line
#   kill -9 <that pid>
#   sleep 65                                    # ThrottleInterval is 60s
#   ./scripts/install_openclaw.sh --status      # a DIFFERENT pid means KeepAlive worked
#
# PROVING NOTHING ELSE CAN REACH IT, from ANOTHER machine (the MacBook):
#
#   curl -m 5 http://<mini LAN address>:18789/        # refused or timed out
#   curl -m 5 http://<mini tailscale address>:18789/  # refused or timed out
#
# --status also lists every address the gateway is listening on, and says
# EXPOSED in capitals if any of them is not 127.0.0.1 / ::1.
#
# WHY LOCAL ONLY. This program can act as Dane in a logged-in browser. The July
# EC2 gateway (18.222.149.88) answered the open internet with no password. So:
# `gateway.bind` is loopback, Tailscale exposure is off, Bonjour advertising is
# off, and the gateway STILL requires its token from callers on the same
# machine. Starcaster never calls it; a worker on the Mini will (ticket 5),
# polling Starcaster outward — the same direction the Studio worker works in.
#
# WHY IT DOES NOT LIVE IN THE REPO. The plist points at ~/OpenClaw/app (a
# pinned npm install) and ~/.openclaw (its state: config, sessions, and the
# browser profile holding the sign-in). Nothing it runs is inside this checkout,
# so — unlike the Studio worker — installing from a worktree is safe: deleting
# the worktree later deletes nothing the job uses.
#
# WHY A SEPARATE NODE. OpenClaw needs Node >= 24.16; every other job on the
# Mini runs Node 22. Homebrew's node@24 is "keg-only", which means it installs
# beside node@22 without replacing the `node` command. The plist names its node
# by full path. ONE TRAP, found on 2026-10-05: `brew install node@24` upgraded a
# library node@22 shares (simdjson), and node@22 stopped starting at all until
# `brew upgrade node@22`. This script refuses to go on if the everyday `node`
# no longer runs, rather than installing a gateway on a machine whose every
# other job just died.
#
# SECRETS (docs/DOCTRINE.md §4.1 — nothing may render a value). Two live in
# ~/.openclaw/.env (mode 600), which OpenClaw reads itself:
#   ANTHROPIC_API_KEY       piped from Doppler `prd` (the existing key; Dane's
#                           decision, 2026-10-05). Doppler is on the GET side.
#   OPENCLAW_GATEWAY_TOKEN  generated here, written straight into the file.
# Neither is ever printed; --status prints names and lengths only. The token is
# NOT copied into Doppler: `doppler secrets set` prints the value it wrote
# (§4.1), and nothing off this machine may call the gateway anyway — the Mini
# worker reads the same file. openclaw.json carries `${OPENCLAW_GATEWAY_TOKEN}`,
# never the value, so --print-config is safe to paste anywhere.
#
# THE ONE HAND STEP is Dane's: signing in to YouTube inside the browser profile
# `dane-of-earth`, over Screen Sharing (docs/NODE_PROVISIONING.md, "openclaw").
# Then `node scripts/openclaw_smoke.mjs` says whether it took.
#
# IT DOES NOT DECIDE WHETHER THIS MACHINE MAY RUN IT. lib/nodeRoles.js does
# (role `openclaw`); --status reports the verdict and install refuses on a
# machine that does not own the role, because a second copy is a second,
# logged-out browser.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.starcaster.openclaw"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROLE="openclaw"
CLI="$HOME/.local/bin/openclaw"

OPENCLAW_VERSION="2026.9.8"
APP_DIR="$HOME/OpenClaw/app"
STATE_DIR="$HOME/.openclaw"
CONFIG="$STATE_DIR/openclaw.json"
ENV_FILE="$STATE_DIR/.env"
LLOG="$HOME/Library/Logs/$LABEL.launchd.log"
PORT=18789
PROFILE="dane-of-earth"
CDP_PORT=18800
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MODEL="anthropic/claude-sonnet-5-5"

# Where the Mini keeps its Doppler key for `prd` (install_studio_worker.sh,
# DOPPLER_SCOPE: the repo folder's key is the read-only dev one the loops use).
DOPPLER_SCOPE="$HOME/Studio"

# A node new enough for OpenClaw, by full path. Empty when there is none.
find_node() {
  local c
  for c in /opt/homebrew/opt/node@24/bin/node /opt/homebrew/opt/node@26/bin/node /usr/local/opt/node@24/bin/node "$(command -v node || true)"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===24&&b>=16)||(a===26&&b>=1)||a>26?0:1)' 2>/dev/null; then
      echo "$c"; return 0
    fi
  done
  return 1
}

render_plist() {
  local NODE_BIN
  NODE_BIN="$(find_node || echo /opt/homebrew/opt/node@24/bin/node)"
  local NODE_DIR
  NODE_DIR="$(dirname "$NODE_BIN")"
  local p
  for p in "$NODE_BIN" "$APP_DIR" "$HOME"; do
    if ! printf '%s' "$p" | grep -Eq '^[A-Za-z0-9/._+@-]+$'; then
      echo "Refusing to write a plist: the path \"$p\" has a space or a character this script does not quote." >&2
      exit 1
    fi
  done
  # OPENCLAW_DISABLE_BONJOUR: no LAN advertising. The gateway is loopback-only,
  # so an advertisement would point at a door that is not there — but there is
  # no reason to announce the program's existence to every device in the house.
  # PATH puts Node 24 first so anything the gateway spawns gets the node it needs.
  cat <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$APP_DIR/node_modules/openclaw/openclaw.mjs</string>
        <string>gateway</string>
        <string>run</string>
        <string>--port</string>
        <string>$PORT</string>
        <string>--bind</string>
        <string>loopback</string>
        <string>--tailscale</string>
        <string>off</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$APP_DIR</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>60</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
        <key>OPENCLAW_DISABLE_BONJOUR</key>
        <string>1</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LLOG</string>
    <key>StandardErrorPath</key>
    <string>$LLOG</string>
</dict>
</plist>
PLIST_BODY
}

# The whole openclaw.json, as this script manages it. The token is a reference
# OpenClaw resolves from ~/.openclaw/.env at startup, never the value.
render_config() {
  node -e '
    const [port, profile, cdpPort, chrome, model] = process.argv.slice(1);
    const config = {
      gateway: {
        mode: "local",
        port: Number(port),
        bind: "loopback",
        auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
        tailscale: { mode: "off" },
        // No operator shell in the browser UI: the gateway is reachable only
        // from this machine, and what it is for is a browser, not a terminal.
        terminal: { enabled: false },
        cliAgents: { enabled: false },
        http: { endpoints: { responses: { enabled: true } } },
      },
      browser: {
        enabled: true,
        defaultProfile: profile,
        // A visible window, because Dane signs in to it over Screen Sharing.
        headless: false,
        profiles: {
          [profile]: { cdpPort: Number(cdpPort), executablePath: chrome },
        },
      },
      agents: { defaults: { model: { primary: model } } },
    };
    process.stdout.write(JSON.stringify(config, null, 2) + "\n");
  ' "$PORT" "$PROFILE" "$CDP_PORT" "$CHROME" "$MODEL"
}

is_loaded() {
  launchctl list "$LABEL" >/dev/null 2>&1
}

loaded_row() {
  local all
  all="$(launchctl list 2>/dev/null || true)"
  printf '%s\n' "$all" | grep -F "$LABEL" || true
}

# NAME=length for each secret, never a value. "missing" when absent or empty.
secret_line() {
  local name="$1" len
  if [ -f "$ENV_FILE" ]; then
    len="$(sed -n "s/^$name=//p" "$ENV_FILE" | head -1 | tr -d '\n' | wc -c | tr -d ' ')"
  else
    len=0
  fi
  if [ "${len:-0}" -gt 0 ]; then echo "present ($len characters, value not shown)"; else echo "MISSING"; fi
}

# Every address the gateway port is listening on. Exit 0 = all loopback,
# 1 = something else is listening (EXPOSED), 3 = nothing is listening.
listeners() {
  local rows
  rows="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sort -u || true)"
  if [ -z "$rows" ]; then return 3; fi
  local bad=0 r
  for r in $rows; do
    case "$r" in
      127.0.0.1:*|\[::1\]:*|localhost:*) echo "          $r (this machine only)" ;;
      *) echo "          $r  <-- EXPOSED: reachable from other machines"; bad=1 ;;
    esac
  done
  return $bad
}

status() {
  node -e '
    const { thisNode, checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const n = thisNode();
    console.log(`machine:  ${n.name || "(unnamed)"} (from ${n.source})`);
    const v = checkRole("openclaw");
    console.log(`role:     ${v.owned ? "this machine owns openclaw" : `openclaw is owned by ${v.owner}`}`);
  ' "$REPO"

  local nb
  if nb="$(find_node)"; then echo "node:     $nb ($("$nb" -v))"; else echo "node:     NONE new enough — OpenClaw needs Node >= 24.16 (brew install node@24)"; fi
  local installed
  installed="$(node -p 'require(process.argv[1]).version' "$APP_DIR/node_modules/openclaw/package.json" 2>/dev/null || true)"
  if [ -n "$installed" ]; then echo "openclaw: $installed in $APP_DIR (this script pins $OPENCLAW_VERSION)"; else echo "openclaw: not installed in $APP_DIR"; fi
  if [ -f "$CONFIG" ]; then
    if [ "$(render_config)" = "$(cat "$CONFIG")" ]; then echo "config:   $CONFIG — matches what this script writes"
    else echo "config:   $CONFIG — CHANGED since this script wrote it (someone or something edited it; re-run install to put it back)"; fi
  else
    echo "config:   not written yet ($CONFIG)"
  fi
  echo "secrets:  ANTHROPIC_API_KEY $(secret_line ANTHROPIC_API_KEY)"
  echo "          OPENCLAW_GATEWAY_TOKEN $(secret_line OPENCLAW_GATEWAY_TOKEN)"
  if [ -f "$PLIST" ]; then echo "schedule: INSTALLED at $PLIST"; else echo "schedule: not installed on this machine"; fi
  if is_loaded; then
    echo "loaded:   yes — $(loaded_row)"
    echo "          (columns: PID, last exit code, label. A PID here means the gateway is alive right now.)"
  else
    echo "loaded:   no"
  fi

  local lrc=0
  echo "listening on port $PORT:"
  listeners || lrc=$?
  case "$lrc" in
    0) echo "          nothing else on the network can reach it" ;;
    1) echo "          !! the gateway is reachable from other machines — stop it: $0 --uninstall" ;;
    3) echo "          nothing is listening (not running, or still starting — it takes a few seconds)" ;;
  esac

  if [ -f "$LLOG" ]; then
    echo "log:      $LLOG ($(wc -c < "$LLOG" | tr -d ' ') bytes, last written $(date -r "$LLOG" '+%Y-%m-%d %H:%M'))"
  else
    echo "log:      $LLOG — not there, which means launchd has never started the job here"
  fi
  echo
  echo "Is the browser signed in as Dane of Earth?  node scripts/openclaw_smoke.mjs"
  [ "$lrc" -ne 1 ]
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$CLI"
  echo "Removed $LABEL from this machine. Its install ($APP_DIR) and its state — the config,"
  echo "the secrets file and the signed-in browser profile ($STATE_DIR) — are left in place,"
  echo "so installing again does not need Dane to sign in again."
  echo "Confirm with: $0 --status"
}

write_secrets() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  if ! grep -q '^OPENCLAW_GATEWAY_TOKEN=.' "$ENV_FILE"; then
    # Generated and written in one step; nothing is printed.
    printf 'OPENCLAW_GATEWAY_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$ENV_FILE"
    echo "secrets:  generated a new gateway token into $ENV_FILE (not shown)"
  fi

  if ! grep -q '^ANTHROPIC_API_KEY=.' "$ENV_FILE"; then
    if ! command -v doppler >/dev/null 2>&1; then
      echo "Cannot fetch ANTHROPIC_API_KEY: the doppler command is not on this machine." >&2
      exit 2
    fi
    local key
    # Captured into a variable, never echoed; written with printf so it does not
    # pass through a command line another process could list.
    if ! key="$(doppler secrets get ANTHROPIC_API_KEY --plain --scope "$DOPPLER_SCOPE" --project starcaster --config prd --no-check-version 2>/dev/null)" || [ -z "$key" ]; then
      echo "Cannot fetch ANTHROPIC_API_KEY from Doppler config \"prd\" (key stored at $DOPPLER_SCOPE). Nothing written." >&2
      exit 2
    fi
    printf 'ANTHROPIC_API_KEY=%s\n' "$key" >> "$ENV_FILE"
    key=""
    echo "secrets:  copied ANTHROPIC_API_KEY from Doppler prd into $ENV_FILE (not shown)"
  fi
}

install_it() {
  # Who may run it.
  local verdict
  verdict="$(node -e '
    const { checkRole } = require(process.argv[1] + "/lib/nodeRoles.js");
    const v = checkRole("openclaw");
    console.log(v.owned ? "yes" : `no ${v.owner}`);
  ' "$REPO")"
  if [ "$verdict" != "yes" ]; then
    echo "Refusing to install: lib/nodeRoles.js gives the openclaw role to ${verdict#no }, not this machine." >&2
    echo "A second copy is a second, logged-out browser. Move the role first if this is meant to be the one." >&2
    exit 3
  fi

  if [ ! -x "$CHROME" ]; then
    echo "Cannot find Google Chrome at $CHROME — OpenClaw's browser profile runs in it." >&2
    exit 1
  fi

  local NODE_BIN
  if ! NODE_BIN="$(find_node)"; then
    echo "No Node new enough for OpenClaw (it needs >= 24.16). Install it beside the everyday one:" >&2
    echo "    brew install node@24        # keg-only: does not replace the node other jobs use" >&2
    echo "    brew upgrade node@22        # then this, if 'node -v' stops working (shared libraries)" >&2
    exit 1
  fi
  # The 2026-10-05 trap: installing node@24 can leave the everyday node unable
  # to start. Every other job on this machine runs it — stop here, loudly.
  if ! node -v >/dev/null 2>&1; then
    echo "The everyday 'node' command no longer starts — every other job on this machine is down." >&2
    echo "Fix that first:  brew upgrade node@22   then run this again." >&2
    exit 1
  fi

  mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  local installed
  installed="$(node -p 'require(process.argv[1]).version' "$APP_DIR/node_modules/openclaw/package.json" 2>/dev/null || true)"
  if [ "$installed" != "$OPENCLAW_VERSION" ]; then
    echo "openclaw: installing $OPENCLAW_VERSION into $APP_DIR"
    (cd "$APP_DIR" && [ -f package.json ] || echo '{"private":true}' > "$APP_DIR/package.json")
    # npm 11 (Node 24's) skips every package's install script unless it is
    # named. Skipped, OpenClaw installs "fine" and runs without its bundled
    # plugins (found 2026-10-05) — so name the five it needs, and only those.
    (cd "$APP_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" npm install --no-fund --no-audit --save-exact \
      --allow-scripts=@google/genai,esbuild,koffi,protobufjs,openclaw "openclaw@$OPENCLAW_VERSION" >/dev/null)
  fi

  # An `openclaw` command for people and agents on this machine, pinned to the
  # same Node and install as the service. Without it, `openclaw` would resolve
  # to the everyday Node 22 and refuse to start.
  mkdir -p "$(dirname "$CLI")"
  cat > "$CLI" <<CLI_BODY
#!/bin/sh
# Written by scripts/install_openclaw.sh. OpenClaw needs Node >= 24.16.
exec "$NODE_BIN" "$APP_DIR/node_modules/openclaw/openclaw.mjs" "\$@"
CLI_BODY
  chmod +x "$CLI"

  write_secrets

  local fresh
  fresh="$(render_config)"
  if [ -f "$CONFIG" ] && [ "$fresh" != "$(cat "$CONFIG")" ]; then
    cp "$CONFIG" "$CONFIG.before-install.$(date +%Y%m%d%H%M%S)"
    echo "config:   $CONFIG had changed; the old copy is kept beside it"
  fi
  printf '%s\n' "$fresh" > "$CONFIG"
  chmod 600 "$CONFIG"

  render_plist > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed $LABEL — kept alive by launchd, listening on 127.0.0.1:$PORT only."
  echo "Giving it 15 seconds to start..."
  sleep 15
  echo
  status
}

MODE="${1:-}"
[ $# -le 1 ] || { echo "usage: $0 [--install | --uninstall | --status | --print-plist | --print-config]" >&2; exit 2; }

case "$MODE" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  --print-plist)        render_plist ;;
  --print-config)       render_config ;;
  ""|--install)         install_it ;;
  *) echo "usage: $0 [--install | --uninstall | --status | --print-plist | --print-config]" >&2; exit 2 ;;
esac
