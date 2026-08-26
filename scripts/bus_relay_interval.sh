#!/bin/bash
# Does this machine still agree with the repo about how often the relay wakes?
#
# The interval lives in two places and only one of them is reviewable:
# INTERVAL_SECONDS in scripts/install_bus_relay.sh (in git, where anyone can
# read and change it) and StartInterval in the generated plist (on one machine,
# where it actually takes effect). Changing the repo does NOT change the
# machine — that needs the installer re-run — so the two drift apart silently,
# and a relay still waking hourly looks exactly like one waking every ten
# minutes until you go and read a log.
#
# That is not hypothetical: it is precisely what happened when the interval was
# shortened on 2026-08-23 (task 86bbk2fuh). Fixing the config-on-one-machine
# problem itself belongs to the NODES slices (closest live one: Slice D,
# 86bbhbaay), not here.
#
# THREE answers, never two. This check is the compensating control for the one
# acceptance criterion that PR could not meet on its own — the installer re-run
# is a human step, and this is the thing that keeps it from being forgotten
# silently forever. A check like that may say "matching" ONLY when it actually
# compared two numbers. "Could not check" is never folded into "all clear"
# (docs/DOCTRINE.md 3.11).
#
#   exit 0 — both values read and equal
#   exit 2 — both values read and different (drift; the installer fixes it)
#   exit 1 — could not read one of them, and it says which
#
# Usage:  bus_relay_interval.sh [line-prefix]
# Env:    BUS_RELAY_PLIST  override the plist path (used by the tests)

set -uo pipefail

PREFIX="${1:-interval: }"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$HERE/.." && pwd)}"
INSTALLER="$REPO/scripts/install_bus_relay.sh"
PLIST="${BUS_RELAY_PLIST:-$HOME/Library/LaunchAgents/com.starcaster.bus-relay.plist}"

say() { echo "${PREFIX}$1"; }

# Where to tell someone to run the installer. NOT necessarily $REPO: the
# installer refuses to run from a worktree (they get deleted when their thread
# ships, taking the schedule's script with them), so naming the folder we
# happen to be in would hand out a command that is guaranteed to be refused.
# Ask git for the main checkout instead, and fall back to $REPO only if that
# cannot be answered — a slightly wrong path beats no command at all.
main_checkout() {
  local m=""
  if command -v node >/dev/null 2>&1 && [ -f "$REPO/scripts/lib/main_checkout.mjs" ]; then
    m="$(cd "$REPO" && node "$REPO/scripts/lib/main_checkout.mjs" 2>/dev/null)"
  fi
  echo "${m:-$REPO}"
}

want=""
if [ -f "$INSTALLER" ]; then
  want="$(sed -n 's/^INTERVAL_SECONDS=\([0-9][0-9]*\).*/\1/p' "$INSTALLER" | head -1)"
fi

if [ -z "$want" ]; then
  say "CANNOT TELL — no readable INTERVAL_SECONDS in $INSTALLER;"
  say "  nothing to compare the machine against. Read both by hand."
  exit 1
fi

if [ ! -f "$PLIST" ]; then
  # Name the NEXT STEP, not another way of asking the same question. This used
  # to say "check with ./scripts/install_bus_relay.sh --status" — but --status
  # is one of the two things that CALLS this check, so on a machine with no
  # relay installed it printed "not installed" and then advised running the
  # command that had just printed it. Advice that loops back on itself reads as
  # a dead end, which is the opposite of what a CANNOT TELL is for.
  #
  # There are exactly two ways to be here, and they need opposite actions, so
  # say both rather than guessing which machine this is.
  say "CANNOT TELL — no plist at $PLIST;"
  say "  nothing schedules the relay on this machine. Two possibilities:"
  say "  - this machine SHOULD run it — install the schedule:"
  say "      cd $(main_checkout) && ./scripts/install_bus_relay.sh"
  say "  - it should not — then nothing is wrong. lib/nodeRoles.js says which"
  say "      machine owns the job:  npm run node:owns -- bus-relay"
  exit 1
fi

# Why not `plutil -extract StartInterval raw`? It is format-agnostic (it would
# also read a BINARY plist, which the parse below reports as CANNOT TELL) and
# it would retire this regex. Deliberately not used: plutil is macOS-only, and
# the node suite that pins this file runs on ubuntu in CI — so the plutil path
# could never be exercised by the gate that is supposed to protect it, and a
# check that silently does not run is the failure mode this whole file exists
# to avoid. The installer only ever writes XML, and a binary plist's answer
# today is CANNOT TELL, which is the safe one. Revisit if CI ever runs macOS.
#
# A plist is XML, not a line-oriented file — launchd accepts the whole <dict>
# on a single line, and other keys (Nice, ThrottleInterval) carry <integer>
# values of their own. So match the integer that FOLLOWS the StartInterval key,
# never just "an integer near it": flatten the newlines, then require
# <integer> to be the very next tag after </key>. Grabbing the last integer on
# the line is how this reported a neighbouring key's value as the schedule —
# a fourth answer, in a check whose contract is three and never a guess.
have="$(tr '\n' ' ' < "$PLIST" \
  | sed -n 's/.*<key>StartInterval<\/key>[[:space:]]*<integer>\([0-9][0-9]*\)<\/integer>.*/\1/p' \
  | head -1)"

if [ -z "$have" ]; then
  say "CANNOT TELL — the plist at $PLIST has no readable StartInterval"
  say "  (empty value, or the schedule moved to StartCalendarInterval);"
  say "  read it by hand before trusting the schedule. The repo says ${want}s."
  exit 1
fi

if [ "$have" != "$want" ]; then
  say "MISMATCH — this machine wakes every ${have}s, the repo says ${want}s."
  say "the schedule is stale; re-run the installer from the main checkout to fix it:"
  say "  cd $(main_checkout) && ./scripts/install_bus_relay.sh"
  exit 2
fi

say "every ${have}s, matching the repo"
exit 0
