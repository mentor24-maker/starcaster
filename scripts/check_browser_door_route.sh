#!/bin/bash
#
# Is the Mini's browser door reachable from the internet the way it should be —
# and is NOTHING ELSE? Run from OUTSIDE the Mini. Outreach wizard 5/19 · sign-in
# window slice 3 (ticket 86bcrmbdw). Plan: docs/LIVE_BROWSER_VIEW.md §3.
#
#   ./scripts/check_browser_door_route.sh --from macbook-pro
#       Run on the Mini: works out the addresses here, then runs the checks ON
#       macbook-pro over ssh. The MacBook needs only bash and curl, no checkout.
#
#   ./scripts/check_browser_door_route.sh --host <funnel host> [--lan <ip>] [--tailnet <ip>]
#       [--tailnet-shielded] [--idle "<ports not listening on the Mini>"]  (--from fills these in)
#       Run wherever you are. Refuses on the Mini itself: from inside, a refused
#       port proves nothing about the outside.
#
# WHAT IT CHECKS, each answered PASS / FAIL / CANNOT TELL:
#
#   1. https://<host>/live/ (no pass)  -> the door keeper's bare "404 Not found":
#      the route reaches the door keeper, and asking without a pass shows nothing.
#   2. POST https://<host>/live/open, unsigned -> 401 "Refused": nobody but
#      Starcaster's server can register a pass.
#   3. The viewer socket wss://<host>/live/live with no pass -> told "refused"
#      and closed, and not one picture sent.
#   4. Ports 18789 (OpenClaw gateway), 18800 (OpenClaw's Chrome control) and
#      8091 (the door keeper, which is loopback-only) -> NOT reachable on the
#      public host, the Mini's home-network address, or its tailnet address.
#      A refusal or a timeout both count as not reachable; the line says which,
#      and each private address is only read after a CONTROL port on it (8080)
#      answered from the same vantage — otherwise a timeout proves nothing.
#   5. From a tailnet device: the viewer socket on port 443 of the Mini's
#      TAILNET address -> the same "refused", so the Connect window opens on a
#      computer with Tailscale on. On a tailnet device the Funnel name resolves
#      to that address, so if the Tailscale access rule does not allow tcp:443
#      to the Mini, the window sits on "Opening…" (2026-10-28, task 86bcu7d6h).
#
# EXIT: 0 every check passed · 1 something is reachable that must not be, or
# the route answers wrongly · 2 a reading could not be taken (the door keeper
# is not answering behind the route, a name did not resolve, ssh failed).
# A 1 outranks a 2.

set -uo pipefail

HOST="" LAN="" TAILNET="" FROM="" SHIELDED="" IDLE=""
PRIVATE_PORTS="18789 18800 8091"

usage() {
  echo "usage: $0 --from <ssh-host>  |  $0 --host <funnel host> [--lan <ip>] [--tailnet <ip>]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) [ $# -ge 2 ] || usage; HOST="$2"; shift 2 ;;
    --lan) [ $# -ge 2 ] || usage; LAN="$2"; shift 2 ;;
    --tailnet) [ $# -ge 2 ] || usage; TAILNET="$2"; shift 2 ;;
    --from) [ $# -ge 2 ] || usage; FROM="$2"; shift 2 ;;
    --tailnet-shielded) SHIELDED=1; shift ;;
    --idle) [ $# -ge 2 ] || usage; IDLE="$2"; shift 2 ;;
    *) usage ;;
  esac
done

find_tailscale() {
  local c
  for c in /opt/homebrew/opt/tailscale/bin/tailscale /opt/homebrew/bin/tailscale /usr/local/bin/tailscale; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

# --from: work the addresses out HERE (on the Mini), then run this same file on
# the other machine with them filled in. The file travels on stdin, so the other
# machine needs no checkout and cannot run a stale copy.
if [ -n "$FROM" ]; then
  ts="$(find_tailscale)" || { echo "CANNOT TELL — no tailscale command here, so the Funnel host is unknown. Pass --host." >&2; exit 2; }
  sock="$HOME/.tailscale/tailscaled.sock"
  fs="$("$ts" --socket "$sock" funnel status 2>&1 || true)"
  [ -n "$HOST" ] || HOST="$(printf '%s\n' "$fs" | sed -n 's|^https://\([^ ]*\) (Funnel on)$|\1|p' | head -1)"
  [ -n "$TAILNET" ] || TAILNET="$("$ts" --socket "$sock" ip -4 2>/dev/null | head -1 || true)"
  [ -n "$LAN" ] || LAN="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$HOST" ] || { echo "CANNOT TELL — Funnel is not on here, so there is no public host to check." >&2; exit 2; }
  # Shields up = tailscaled accepts NO incoming tailnet connection. Read from the
  # Mini's own prefs, because from outside "everything refused" and "the tailnet
  # path is broken" look the same; the control below tells them apart.
  if "$ts" --socket "$sock" debug prefs 2>/dev/null | grep -q '"ShieldsUp": *true'; then SHIELDED=1; fi
  # A port nothing listens on is refused from everywhere, so a refusal there
  # proves nothing about whether it WOULD be exposed. Say which are idle now.
  for port in $PRIVATE_PORTS; do
    [ -n "$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null)" ] || IDLE="${IDLE:+$IDLE }$port"
  done
  echo "Checking from $FROM (addresses worked out on $(hostname -s)): host $HOST, home network ${LAN:-unknown}, tailnet ${TAILNET:-unknown}, shields $([ -n "$SHIELDED" ] && echo up || echo down), not listening now: ${IDLE:-none}"
  args=(--host "$HOST")
  [ -n "$SHIELDED" ] && args+=(--tailnet-shielded)
  [ -n "$IDLE" ] && args+=(--idle "$IDLE")
  [ -n "$LAN" ] && args+=(--lan "$LAN")
  [ -n "$TAILNET" ] && args+=(--tailnet "$TAILNET")
  # ssh joins its arguments into ONE remote command line, so "18800 8091" would
  # arrive as two words. Quote each argument for the remote shell.
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$FROM" "bash -s -- $(printf '%q ' "${args[@]}")" < "${BASH_SOURCE[0]}"
  rc=$?
  [ "$rc" -eq 255 ] && { echo "CANNOT TELL — could not reach $FROM over ssh." >&2; exit 2; }
  exit "$rc"
fi

[ -n "$HOST" ] || usage
if [ -f "$HOME/.alphire-node" ] && grep -qx 'mac-mini' "$HOME/.alphire-node" 2>/dev/null; then
  echo "Refusing: this is the Mini. A port refused from inside proves nothing about the outside — use --from <another machine>." >&2
  exit 2
fi

FAILS=0 BLIND=0
pass() { echo "PASS         $*"; }
fail() { echo "FAIL         $*"; FAILS=$((FAILS + 1)); }
blind() { echo "CANNOT TELL  $*"; BLIND=$((BLIND + 1)); }

echo "From $(hostname -s), $(date '+%Y-%m-%d %H:%M %Z')"
BASE="https://$HOST/live"

# THE PUBLIC ROUTE, NOT THE TAILNET ONE. On a machine that is itself on the
# tailnet, the Funnel name resolves to the Mini's PRIVATE tailnet address, so
# "the public host" would quietly be the tailnet twice over — measured
# 2026-10-27 from the MacBook. So ask a public resolver what the internet sees
# (Tailscale's Funnel servers) and pin every public request to that address.
PUBLIC_IP="$(dig +short @1.1.1.1 "$HOST" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)"
if [ -z "$PUBLIC_IP" ]; then
  blind "public DNS — 1.1.1.1 gave no address for $HOST, so the internet route could not be pinned"
    PIN=()
else
  echo "Internet route: $HOST -> $PUBLIC_IP (public DNS, 1.1.1.1), pinned for every public check below"
  PIN=(--resolve "$HOST:443:$PUBLIC_IP")
fi

# 1. The route reaches the door keeper, and a request without a pass shows nothing.
out="$(curl -sS -m 10 "${PIN[@]}" -o - -w '\n%{http_code}' "$BASE/" 2>&1)"; rc=$?
code="$(printf '%s\n' "$out" | tail -1)"; body="$(printf '%s\n' "$out" | sed '$d' | head -c 200)"
if [ "$rc" -ne 0 ]; then
  blind "GET $BASE/ — curl could not connect (exit $rc): $(printf '%s' "$out" | head -1)"
elif [ "$code" = "404" ] && [ "$body" = "Not found" ]; then
  pass "GET $BASE/ (no pass) -> 404 \"Not found\": the door keeper answers and shows nothing"
elif [ "$code" = "502" ]; then
  blind "GET $BASE/ -> 502: the route exists but nothing answers behind it (is the door keeper running?)"
else
  fail "GET $BASE/ -> $code \"$body\": not the door keeper's bare 404 — something else is behind /live"
fi

# 2. Nobody but Starcaster's server can register a pass.
out="$(curl -sS -m 10 "${PIN[@]}" -X POST -H 'content-type: application/json' \
  --data '{"pass":"outside-check","project_id":"outside-check","site":"youtube"}' \
  -o - -w '\n%{http_code}' "$BASE/open" 2>&1)"; rc=$?
code="$(printf '%s\n' "$out" | tail -1)"; body="$(printf '%s\n' "$out" | sed '$d' | head -c 200)"
if [ "$rc" -ne 0 ]; then
  blind "POST $BASE/open — curl could not connect (exit $rc)"
elif [ "$code" = "401" ]; then
  pass "POST $BASE/open, unsigned -> 401 \"$body\": no pass registered"
elif [ "$code" = "502" ]; then
  blind "POST $BASE/open -> 502: nothing answers behind the route"
else
  fail "POST $BASE/open, unsigned -> $code \"$body\": an unsigned open must be refused with 401"
fi

# 3. The viewer socket, no pass: refused and closed, not one picture. The door
# keeper waits 5 s for a hello, so 12 s is ample. Server frames are unmasked, so
# the JSON it sends is readable in the raw bytes curl prints.
out="$(curl -sS -i --http1.1 -m 12 "${PIN[@]}" -o - \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: b3V0c2lkZS1jaGVjay0xMjM0NQ==' "$BASE/live" 2>&1 | LC_ALL=C tr -d '\000' | head -c 4000)"
first="$(printf '%s\n' "$out" | head -1 | tr -d '\r')"
if printf '%s' "$out" | grep -q '"type":"frame"'; then
  fail "wss://$HOST/live/live with no pass -> a PICTURE was sent ($first)"
elif printf '%s' "$first" | grep -q ' 101' && printf '%s' "$out" | grep -q '"reason":"refused"'; then
  pass "wss://$HOST/live/live with no pass -> told \"refused\" and closed; no picture sent"
elif printf '%s' "$first" | grep -q ' 502'; then
  blind "wss://$HOST/live/live -> 502: nothing answers behind the route"
elif [ -z "$first" ]; then
  blind "wss://$HOST/live/live — no answer at all within 12 s"
else
  fail "wss://$HOST/live/live with no pass -> \"$first\", not the door keeper's refusal"
fi

# 4. The private ports. curl exit 7 = refused, 28 = timed out; both mean "not
# reachable from here". Anything that CONNECTS is a FAIL, whatever it said.
probe_port() {
  local where="$1" addr="$2" port="$3" rc
  curl -sS -m 6 -o /dev/null "http://$addr:$port/" 2>/dev/null; rc=$?
  local idle=""
  case " $IDLE " in *" $port "*) idle=1 ;; esac
  case "$rc" in
    7|28)
      local how="connection refused"; [ "$rc" = 28 ] && how="no answer within 6 s (filtered)"
      if [ -n "$idle" ]; then
        blind "$where $addr:$port -> $how, but nothing listens on $port on the Mini right now, so this proves nothing"
      else
        pass "$where $addr:$port -> $how"
      fi ;;
    6)  blind "$where $addr:$port -> the name did not resolve" ;;
    0|52|56|35|60|22) fail "$where $addr:$port -> CONNECTED (curl exit $rc) — this port must not be reachable" ;;
    *)  blind "$where $addr:$port -> curl exit $rc, which this check does not classify" ;;
  esac
}
# THE CONTROL. A timeout from a machine that cannot reach the address at all
# looks exactly like a filtered port, so before believing "not reachable" on an
# address, show that SOMETHING there is reachable from here: port 8080, the
# YouTube download helper, which listens on every address of the Mini. No
# control, no reading — the address is CANNOT TELL, never a pass.
control_ok() {
  curl -sS -m 6 -o /dev/null "http://$1:8080/" 2>/dev/null
  case $? in 0|22|52|56) return 0 ;; *) return 1 ;; esac
}
if [ -n "$PUBLIC_IP" ]; then
  for port in $PRIVATE_PORTS; do probe_port "internet    " "$PUBLIC_IP" "$port"; done
fi
LAN_CONTROL=""
if [ -z "$LAN" ]; then
  blind "home network — no address given (--lan), so it was not checked"
elif ! control_ok "$LAN"; then
  blind "home network $LAN — the control (port 8080) is not reachable from here either, so a refusal here would prove nothing"
else
  LAN_CONTROL=1
  for port in $PRIVATE_PORTS; do probe_port "home network" "$LAN" "$port"; done
fi
# THE TAILNET. Tailscale here runs without root ("userspace networking"), and in
# that mode a connection to the Mini's tailnet address is handed to the SAME
# port on 127.0.0.1 — so "listens on loopback only" does not keep a service off
# the tailnet. Measured 2026-10-27: the OpenClaw gateway answered its control
# page to the MacBook on 100.x:18789. Shields up is what closes it, and with
# shields up the control port is blocked too, which is the expected reading —
# provided 8080 demonstrably answers on the home network, so it is up.
if [ -z "$TAILNET" ]; then
  blind "tailnet — no address given (--tailnet), so it was not checked"
elif control_ok "$TAILNET"; then
  [ -n "$SHIELDED" ] && fail "tailnet      $TAILNET:8080 -> CONNECTED although the Mini reports shields up"
  for port in $PRIVATE_PORTS; do probe_port "tailnet     " "$TAILNET" "$port"; done
elif [ -n "$SHIELDED" ] && [ -n "$LAN_CONTROL" ]; then
  for port in $PRIVATE_PORTS; do probe_port "tailnet     " "$TAILNET" "$port"; done
  pass "tailnet      $TAILNET -> shields up: not even 8080 is accepted over the tailnet, though it answers on the home network"
else
  blind "tailnet      $TAILNET — the control (port 8080) is not reachable over the tailnet from here, so a refusal here would prove nothing"
fi

# 5. FROM A TAILNET DEVICE. Dane's MacBook is on the tailnet, and there MagicDNS
# resolves the Funnel name to the Mini's tailnet address, so the Connect window's
# feed goes over the tailnet, not the internet. Port 443 there is served by
# Tailscale itself (the same /live route), but only if the access rule lets it
# through: on 2026-10-28 a rule allowing 22, 5900 and 8080 dropped every one of
# the MacBook's connections ("Drop: ... :443 no rules matched" in the Mini's
# tailscaled log) and the window never opened. Pinned to the tailnet address so
# the reading is that path whatever this machine's DNS says.
if [ -n "$TAILNET" ] && { control_ok "$TAILNET" || [ -n "$SHIELDED" ]; }; then
  out="$(curl -sS -i --http1.1 --connect-timeout 6 -m 12 --resolve "$HOST:443:$TAILNET" -o - \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: b3V0c2lkZS1jaGVjay0xMjM0NQ==' "$BASE/live" 2>&1 | LC_ALL=C tr -d '\000' | head -c 4000; exit "${PIPESTATUS[0]}")"; rc=$?
  first="$(printf '%s\n' "$out" | head -1 | tr -d '\r')"
  if printf '%s' "$out" | grep -q '"type":"frame"'; then
    fail "tailnet      wss://$HOST/live/live via $TAILNET with no pass -> a PICTURE was sent"
  elif printf '%s' "$first" | grep -q ' 101' && printf '%s' "$out" | grep -q '"reason":"refused"'; then
    pass "tailnet      wss://$HOST/live/live via $TAILNET -> the door keeper answers: the Connect window opens from a tailnet device"
  elif printf '%s' "$first" | grep -q ' 502'; then
    blind "tailnet      wss://$HOST/live/live via $TAILNET -> 502: nothing answers behind the route"
  elif [ "$rc" = 7 ] || [ "$rc" = 28 ]; then
    fail "tailnet      wss://$HOST/live/live via $TAILNET -> not reachable (curl exit $rc): the Connect window cannot open from a computer with Tailscale on. The Tailscale access rule must allow tcp:443 to the Mini$([ -n "$SHIELDED" ] && echo ', and shields up blocks it outright')"
  else
    fail "tailnet      wss://$HOST/live/live via $TAILNET -> \"$first\" (curl exit $rc), not the door keeper's refusal"
  fi
fi

echo
if [ "$FAILS" -gt 0 ]; then
  echo "VERDICT: FAIL — $FAILS check(s) found something reachable or answering that must not be ($BLIND could not be taken)."
  exit 1
elif [ "$BLIND" -gt 0 ]; then
  echo "VERDICT: CANNOT TELL — nothing wrong found, but $BLIND reading(s) could not be taken."
  exit 2
fi
echo "VERDICT: PASS — the door keeper answers on /live and shows nothing without a pass, from the internet and from a tailnet device; 18789, 18800 and 8091 are unreachable from the internet, the home network and the tailnet."
exit 0
