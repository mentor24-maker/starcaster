#!/bin/bash
#
# scripts/provision_node.sh — stand a machine up as a node, by script.
#
# WHY THIS EXISTS (NODES Slice D, principle P2)
# The Mac Mini setup procedure was a seven-page document with about thirty hand
# steps (ClickUp doc 2kydhxeu-754). A document with thirty steps is a document
# whose thirtieth step gets skipped — and several of these steps fail SILENTLY
# when skipped. A missing container runtime does not announce itself; it makes
# the visual gates unrunnable a week later, on a machine that looks fine.
#
# Charter Q3 stated the bar before the plan existed: "Dane's hands for the
# physical setup and logins; everything after is one script." This is that
# script.
#
#   npm run provision:node          # say what it WOULD do. Changes nothing.
#   npm run provision:node:apply    # actually do it.
#   npm run doctor:node             # the read-only verifier (a separate program)
#
# IDEMPOTENT, AND THAT IS TESTED
# Every item is check-then-fix. Run it twice and the second run reports PASS on
# everything the first one FIXED, and says so. The standing rule here is that
# the second run is a different program — so the second run is part of the
# acceptance criteria, not a nicety.
#
# THREE OUTCOMES PER ITEM, NEVER TWO
#   PASS   already correct; nothing done.
#   FIXED  was wrong; this script corrected it.
#   FAIL   was wrong; this script could not correct it. The command is printed.
#   WAIT   needs a live credential. Emitted as a ::: PROMPT FOR DANE ::: block.
#
# THE SECRETS BOUNDARY — NOT CROSSED
# Every step touching a live credential (doppler login, gh auth login, the
# Claude sign-in) is PRINTED as a prompt and never attempted. No agent session
# and no script here holds a credential value (docs/DOCTRINE.md §4.1, vault
# OPERATIONS.md SOP 6). A step this script declines is reported as WAITING, out
# loud — "the script did not do it" must never read as "the script forgot".
#
# WHAT IT DELIBERATELY CANNOT DO YET
# Installing the scheduled jobs for pulse needs pulse's bin/install-launchd.sh,
# which is NODES Slice B (ticket 86bbh9kh2) and is not written. That row reports
# CANNOT DO YET on every run and is never counted as a pass. A provisioning
# script that reported success across the board while quietly installing no
# scheduled jobs would be a green check on a machine that does nothing, which is
# the precise failure the whole plan was written against.
#
# NO MACHINE IS NAMED IN THIS FILE. Every path is derived (NODES P1);
# scripts/check_machine_paths.cjs fails the commit if one creeps in.

set -uo pipefail

# TWO ROOTS, AND THEY ARE NOT THE SAME QUESTION.
#
# $REPO is where this script and its inventory LIVE — code and table travel
# together, always. $MAIN_CHECKOUT is the folder being PROVISIONED, which must
# be the main checkout and never a worktree: a worktree is deleted when its
# thread ships, and provisioning a folder that is about to vanish is worse than
# not provisioning at all.
#
# Conflating them is not hypothetical. The first version loaded the inventory
# from $MAIN_CHECKOUT, so running from a worktree looked for a module that only
# existed on the branch — every `node -e` below died, and because none of them
# checked, the script printed "macbook-pro owns no exclusive jobs" straight
# after the crash and exited 0. A provisioner that reports success over a stack
# trace is the exact failure this ticket was written against, produced by the
# ticket's own script on its first run.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_CHECKOUT="$(node "$REPO/scripts/lib/main_checkout.mjs" 2>/dev/null || echo "$REPO")"

# Every read of the inventory goes through this, so a broken read STOPS the run
# instead of being mistaken for an empty answer. An empty list and a crash look
# identical to a `while read` loop, and only one of them means "nothing to do".
#
# IT RETURNS; IT DOES NOT EXIT — and every caller must write `|| exit 1`.
# That is not stylistic. The first version called `exit 1` here, and it did
# nothing: each caller invokes this inside `$( )`, so the exit killed the
# command substitution's subshell and the script sailed on with an empty
# variable. The break test that found it copied the script somewhere its
# inventory did not exist; the run printed four stack traces and still finished
# with "0 passed ... this was a dry run" and exit 0 — the same silent green this
# whole ticket exists to prevent, hiding inside the guard written to prevent it.
# Diagnostics go to stderr so they survive the substitution.
# Locked in by scripts/builder/nodeProvision.test.js.
ask_inventory() {
  local description="$1"; shift
  local answer status
  answer="$(node "$@" 2>&1)"; status=$?
  if [ "$status" -ne 0 ]; then
    printf '\n%sCannot read the inventory (%s).%s\n' "$RED" "$description" "$OFF" >&2
    printf '%s%s%s\n' "$DIM" "$answer" "$OFF" >&2
    printf 'Refusing to continue: an unreadable inventory is not an empty one.\n' >&2
    return 1
  fi
  printf '%s' "$answer"
}

APPLY=0
NODE_NAME=""

usage() {
  cat >&2 <<USAGE
usage: $0 [--apply] [--node <name>]

  (no flags)      DRY RUN — report what would change, change nothing.
  --apply         perform the fixes this script is allowed to perform.
  --node <name>   declare which node this machine is (writes ~/.alphire-node).

Read-only verification is a separate program: npm run doctor:node
USAGE
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)  APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    --node)   NODE_NAME="${2:-}"; [ -n "$NODE_NAME" ] || usage; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

# --- reporting ---------------------------------------------------------------

if [ -t 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
else
  GREEN=""; RED=""; YELLOW=""; DIM=""; BOLD=""; OFF=""
fi

n_pass=0; n_fixed=0; n_fail=0; n_wait=0; n_would=0

heading() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }
pass()    { n_pass=$((n_pass+1));   printf '  %sPASS%s   %s\n' "$GREEN" "$OFF" "$1"; }
fixed()   { n_fixed=$((n_fixed+1)); printf '  %sFIXED%s  %s\n' "$GREEN" "$OFF" "$1"; }
failed()  { n_fail=$((n_fail+1));   printf '  %sFAIL%s   %s\n' "$RED" "$OFF" "$1"
            [ $# -gt 1 ] && printf '         %s→%s %s\n' "$YELLOW" "$OFF" "$2"; }
would()   { n_would=$((n_would+1)); printf '  %sWOULD%s  %s\n' "$YELLOW" "$OFF" "$1"; }
detail()  { printf '         %s%s%s\n' "$DIM" "$1" "$OFF"; }

# A step nobody may automate. Printed through lib/nodeProvision.js so this and
# doctor:node emit a byte-identical block — the operator learns to recognise
# one shape, not two.
prompt_for_dane() {
  n_wait=$((n_wait+1))
  node -e '
    const p = require(process.argv[1] + "/lib/nodeProvision.js");
    const step = p.SECRET_STEPS.find((s) => s.id === process.argv[2]);
    if (!step) { console.error("no such secret step: " + process.argv[2]); process.exit(1); }
    console.log(p.promptBlock(step).split("\n").map((l) => "  " + l).join("\n"));
  ' "$REPO" "$1"
  echo
}

# The single place that decides whether a fix actually runs. Every fix in this
# script goes through it, so --dry-run cannot be honoured in some branches and
# forgotten in others — which is how a dry run ends up changing something.
#
#   do_fix "<what it will do>" <command...>
do_fix() {
  local what="$1"; shift
  if [ "$APPLY" -eq 0 ]; then
    would "$what"
    return 1
  fi
  if "$@" >/tmp/provision_node.$$ 2>&1; then
    fixed "$what"
    rm -f /tmp/provision_node.$$
    return 0
  fi
  failed "$what — the command failed." "$*"
  detail "$(tail -3 /tmp/provision_node.$$ | tr '\n' ' ')"
  rm -f /tmp/provision_node.$$
  return 1
}

printf '%s%s%s\n' "$BOLD" "Provisioning this machine as a node" "$OFF"
if [ "$APPLY" -eq 0 ]; then
  printf '%sDRY RUN — nothing will be changed. Re-run with --apply to perform the fixes.%s\n' "$YELLOW" "$OFF"
else
  printf '%sAPPLY — fixes will be performed.%s\n' "$GREEN" "$OFF"
fi
printf '%scheckout: %s%s\n' "$DIM" "$MAIN_CHECKOUT" "$OFF"

# --- 1. identity -------------------------------------------------------------
# First, because everything about schedules is conditional on it, and because a
# machine with no identity refuses every exclusive job — which is correct
# behaviour and also a machine sitting there doing nothing.

heading "IDENTITY"

IDENTITY_FILE="$HOME/.alphire-node"
CURRENT_NODE="$(ask_inventory 'the node identity' -e '
  const { thisNode, isKnownNode } = require(process.argv[1] + "/lib/nodeRoles.js");
  const n = thisNode();
  console.log([n.name, n.source, isKnownNode(n.name) ? "known" : "unknown"].join(" "));
' "$REPO")" || exit 1
read -r NODE_IS NODE_SOURCE NODE_KNOWN <<<"$CURRENT_NODE"

if [ "$NODE_SOURCE" = "file" ] && [ "$NODE_KNOWN" = "known" ]; then
  pass "This machine is ${NODE_IS} (declared in ${IDENTITY_FILE})."
elif [ -n "$NODE_NAME" ]; then
  do_fix "Declare this machine as \"${NODE_NAME}\" in ${IDENTITY_FILE}" \
    bash -c "printf '%s\n' \"$NODE_NAME\" > \"$IDENTITY_FILE\"" || true
else
  # Which machine this is, is a DECISION — not something to infer. The hostname
  # is a guess that changes the day somebody renames the Mac in System
  # Settings, at which point every guard silently stops recognising it.
  failed "This machine has no identity file, and none was given." \
    "$0 --apply --node <name>"
  detail "It called itself \"${NODE_IS}\" (from its ${NODE_SOURCE}). Known nodes: $(node -p "require('$REPO/lib/nodeRoles.js').KNOWN_NODES.join(', ')")"
  detail "Naming the machine is a decision, so this script will not guess one."
fi

# --- 2. toolchain ------------------------------------------------------------

heading "TOOLCHAIN"

# The tool table lives in lib/nodeProvision.js. Reading it here rather than
# repeating it is the point: a provisioner and a verifier that each carry their
# own idea of "provisioned" will disagree, and the disagreement will be a green
# check on a machine that does not work.
TOOLS="$(ask_inventory 'the toolchain' -e '
  const p = require(process.argv[1] + "/lib/nodeProvision.js");
  for (const t of p.REQUIRED_TOOLS) {
    console.log([t.id, t.command, t.brew || "-", t.manual ? "manual" : "auto", (t.fixHint || "-")].join("\t"));
  }
' "$REPO")" || exit 1

while IFS=$'\t' read -r id command brew manual hint; do
  [ -n "$id" ] || continue
  if command -v "$command" >/dev/null 2>&1; then
    pass "$command $("$command" --version 2>&1 | head -1 | tr -d '\n')"
    continue
  fi
  if [ "$manual" = "manual" ] || [ "$brew" = "-" ]; then
    # Installing Homebrew or the Claude CLI means piping a URL into a shell.
    # That is a decision with a person's name on it, not a step a 3am pass takes.
    failed "$command is not installed." "$hint"
    continue
  fi
  do_fix "Install $command (brew install $brew)" brew install "$brew" || true
done <<<"$TOOLS"

# The pinned Node version. NOT auto-fixed even with --apply: swapping the Node
# version underneath a machine that is running the loops would take the loops
# down mid-pass, and this script may well be run on exactly such a machine.
PINNED="$(node -p "require('$REPO/lib/nodeProvision.js').pinnedNodeVersion('$REPO') || ''" 2>/dev/null)"
RUNNING="$(node -v 2>/dev/null | tr -d 'v')"
if [ -z "$PINNED" ]; then
  failed "Cannot tell whether Node is the pinned version — .nvmrc is missing or unreadable." "git -C $MAIN_CHECKOUT checkout .nvmrc"
elif [ "$PINNED" = "$RUNNING" ]; then
  pass "node $RUNNING matches the pin in .nvmrc."
else
  failed "node is $RUNNING, but this repo pins $PINNED." "cd $MAIN_CHECKOUT && nvm install"
  detail "Not fixed automatically: changing the Node version under a machine that is running the loops takes them down mid-pass."
fi

# The container runtime. The two machines answer this differently ON PURPOSE —
# Docker Desktop on the laptop, Colima on the headless Mini — so what is checked
# is whether one ANSWERS, not which one is installed.
if docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
  pass "Container runtime is running (Docker server $(docker info --format '{{.ServerVersion}}' 2>/dev/null))."
elif command -v colima >/dev/null 2>&1; then
  do_fix "Start Colima (the container runtime is installed but not running)" colima start || true
elif command -v docker >/dev/null 2>&1; then
  failed "Docker is installed but not running." "open -a Docker      (then wait for the whale to stop animating)"
else
  do_fix "Install Colima and the docker CLI" brew install colima docker || true
fi

# --- 3. repos ----------------------------------------------------------------

heading "REPOS"

REPOS="$(ask_inventory 'the repo list' -e '
  const p = require(process.argv[1] + "/lib/nodeProvision.js");
  for (const r of p.requiredRepos()) console.log([r.name, r.home, r.url].join("\t"));
' "$REPO")" || exit 1

while IFS=$'\t' read -r name home url; do
  [ -n "$name" ] || continue
  if [ -d "$home/.git" ]; then
    pass "$name is checked out at $home"
    continue
  fi
  # Before cloning: is it already on this machine, somewhere else? Cloning on
  # top of that gives the machine TWO checkouts of one repo, diverging, with
  # nothing to say which one anybody is editing — a worse state than the one
  # being fixed. Refuse, and name the decision.
  ELSEWHERE="$(node -p "require('$REPO/lib/nodeProvision.js').findRepoElsewhere('$name', '$home') || ''")"
  if [ -n "$ELSEWHERE" ]; then
    failed "$name is on this machine at $ELSEWHERE, not at $home where the loops look." \
      "Move it (mv $ELSEWHERE $home) or change its home in scripts/builder/taskRepo.js — your call."
    detail "NOT cloned: a second checkout of the same repo is worse than the mismatch. Meanwhile every repo:$name ticket escalates on the one machine that has it."
    continue
  fi
  # Cloning needs working git credentials, which is a credentialed step — but
  # the clone itself holds no value, so it is attempted and its failure names
  # the prompt rather than being mistaken for a network problem.
  if do_fix "Clone $name into $home" git clone "$url" "$home"; then :; else
    if [ "$APPLY" -eq 1 ]; then
      detail "If that failed on authentication, GitHub is not set up on this machine yet:"
      prompt_for_dane gh-login
    fi
  fi
done <<<"$REPOS"

# --- 4. config ---------------------------------------------------------------

heading "CONFIG"

# The Claude memory folder's NAME is derived from the checkout's absolute path,
# so it differs on every machine and cannot be copied across. This is the step
# the old document got wrong: copying `.claude` between Macs put the memory
# under the other machine's folder name, where nothing would ever read it — and
# an empty memory folder looks exactly like a working one, so nothing errored.
MEMORY_DIR="$(node -p "require('$REPO/lib/nodeProvision.js').claudeMemoryDir('$MAIN_CHECKOUT')")"
if [ -d "$MEMORY_DIR" ]; then
  pass "Claude memory folder exists for this checkout."
  detail "$MEMORY_DIR"
else
  do_fix "Create the Claude memory folder for this checkout ($MEMORY_DIR)" mkdir -p "$MEMORY_DIR" || true
fi

# npm dependencies. Without them nothing in this repo runs, including the
# verifier that is supposed to report on it.
if [ -d "$MAIN_CHECKOUT/node_modules" ]; then
  pass "npm dependencies are installed."
else
  do_fix "Install npm dependencies (npm ci)" npm --prefix "$MAIN_CHECKOUT" ci || true
fi

# Doppler. Logging IN is Dane's; SCOPING a folder is not — it selects a project,
# it does not reveal or transmit a value — so the scope is fixed automatically
# once a login exists.
if ! command -v doppler >/dev/null 2>&1; then
  failed "Cannot configure Doppler — the doppler command is not installed." "brew install dopplerhq/cli/doppler"
elif ! doppler me >/dev/null 2>&1; then
  printf '  %sWAIT%s   Doppler is installed but this machine is not logged in.\n' "$YELLOW" "$OFF"
  prompt_for_dane doppler-login
else
  SCOPE="$(cd "$MAIN_CHECKOUT" && doppler configure get project --plain 2>/dev/null)"
  if [ "$SCOPE" = "starcaster" ]; then
    pass "Doppler scoped to starcaster/$(cd "$MAIN_CHECKOUT" && doppler configure get config --plain 2>/dev/null)."
  else
    do_fix "Scope this checkout to the starcaster/dev Doppler config" \
      bash -c "cd '$MAIN_CHECKOUT' && doppler setup --project starcaster --config dev --no-interactive" || true
  fi
fi

# GitHub. Tested by OUTCOME, not by mechanism: can git reach GitHub without
# stopping to ask for anything? Any credential helper satisfies that — this
# laptop uses macOS's osxkeychain and has never run `gh auth setup-git` — so
# checking for one blessed route would report a working machine as broken.
#
# GIT_TERMINAL_PROMPT=0 is what makes the probe honest. Without it git waits for
# a password and this hangs instead of answering, which is also exactly how a
# scheduled job experiences a missing credential: not as a failure, as a job
# that never finishes.
STARCASTER_URL="$(node -p "require('$REPO/lib/nodeProvision.js').REPO_URLS.starcaster")"
if GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=echo git ls-remote "$STARCASTER_URL" HEAD >/dev/null 2>&1; then
  pass "git can reach GitHub without prompting for anything."
elif ! command -v gh >/dev/null 2>&1; then
  failed "git cannot reach GitHub, and there is no gh to fix it with." "brew install gh"
elif ! gh auth status >/dev/null 2>&1; then
  printf '  %sWAIT%s   GitHub is not authenticated on this machine.\n' "$YELLOW" "$OFF"
  prompt_for_dane gh-login
else
  do_fix "Hand git the GitHub credentials (gh auth setup-git)" gh auth setup-git || true
fi

# The local settings file. `env:local` points the folder at the Supabase on THIS
# machine using the development defaults `supabase status` prints — no live
# credential is involved, which is exactly why a script may run it.
if [ -f "$MAIN_CHECKOUT/.env.local" ]; then
  pass "This checkout has a settings file (.env.local)."
else
  do_fix "Point this checkout at the local database (npm run env:local)" \
    bash -c "cd '$MAIN_CHECKOUT' && npm run --silent env:local" || true
fi

# --- 5. build ----------------------------------------------------------------

heading "BUILD"

# A fresh clone has no generated files at all, and the failure they produce is a
# 404 that reads as a broken route — it cost an hour twice on 2026-08-15. The
# FULL build, not build:assets: the short one skips public/app-shell.html, which
# IS the admin app, and lib/builder/template.js, which the server tests require.
if [ -f "$MAIN_CHECKOUT/public/app-shell.html" ] && [ -f "$MAIN_CHECKOUT/lib/builder/template.js" ]; then
  pass "Generated files are present."
else
  do_fix "Build the generated files (npm run build)" \
    bash -c "cd '$MAIN_CHECKOUT' && npm run --silent build" || true
fi

# --- 6. schedules ------------------------------------------------------------

heading "SCHEDULES — the jobs this machine owns"

if [ "$NODE_KNOWN" != "known" ]; then
  failed "Cannot install schedules — this machine has no recognised identity." "$0 --apply --node <name>"
  detail "Guessing which node it is would mean installing another machine's jobs here."
else
  SCHEDULES="$(ask_inventory 'the schedules' -e '
    const p = require(process.argv[1] + "/lib/nodeProvision.js");
    for (const s of p.schedulesForNode(process.argv[2])) {
      console.log([s.role, s.installer || "-", s.blocked ? "blocked" : (s.manual ? "manual" : "auto"),
        (s.blocked || s.why || "-").replace(/\s+/g, " ")].join("\t"));
    }
  ' "$REPO" "$NODE_IS")" || exit 1

  if [ -z "$SCHEDULES" ]; then
    detail "$NODE_IS owns no exclusive jobs."
  fi

  while IFS=$'\t' read -r role installer kind reason; do
    [ -n "$role" ] || continue
    case "$kind" in
      blocked)
        # CANNOT DO YET — loud, every run, never a pass. This is the row that
        # kept this ticket honest: the launchd step is not a trimmable corner
        # of "provision a node", it is the step that makes the machine
        # actually RUN anything.
        printf '  %sWAIT%s   %s: %sCANNOT DO YET%s — no installer exists.\n' "$YELLOW" "$OFF" "$role" "$BOLD" "$OFF"
        detail "$reason"
        n_wait=$((n_wait+1))
        ;;
      manual)
        pass "$role: no schedule, on purpose."
        detail "$reason"
        ;;
      *)
        if bash "$MAIN_CHECKOUT/$installer" --status 2>/dev/null | grep -q 'schedule:  *INSTALLED'; then
          pass "$role: schedule already installed."
        else
          # The installer refuses to run from a worktree, for the same reason
          # this script works against MAIN_CHECKOUT: a schedule pointing at a
          # folder that gets deleted when its thread ships.
          do_fix "Install the $role schedule ($installer)" bash "$MAIN_CHECKOUT/$installer" || true
        fi
        ;;
    esac
  done <<<"$SCHEDULES"
fi

# --- 7. the steps that are Dane's -------------------------------------------

heading "WAITING ON DANE"

# Claude Code's sign-in cannot be probed without running the CLI interactively,
# so this is stated rather than checked — and stated as WAITING, never as a
# pass. The loops are agent sessions; an unauthenticated CLI exits immediately
# and the queue silently stops moving, which looks exactly like an empty queue.
if command -v claude >/dev/null 2>&1; then
  printf '  %sWAIT%s   Claude Code sign-in cannot be checked from a script.\n' "$YELLOW" "$OFF"
  prompt_for_dane claude-login
else
  detail "Claude Code is not installed, so there is nothing to sign in to yet."
fi

# --- verdict -----------------------------------------------------------------

echo
printf '%s%d passed, %d fixed, %d could not be fixed, %d waiting on Dane%s\n' \
  "$BOLD" "$n_pass" "$n_fixed" "$n_fail" "$n_wait" "$OFF"

if [ "$APPLY" -eq 0 ] && [ "$n_would" -gt 0 ]; then
  printf '%s%d change(s) NOT made — this was a dry run. Re-run with --apply.%s\n' "$YELLOW" "$n_would" "$OFF"
fi

# The idempotence claim, stated in the output rather than left for the reader to
# infer from a zero in a tally. The standing rule here is that the second run is
# a different program, so "it changed nothing this time" is a result worth
# printing — and it is a SEPARATE statement from "everything is correct", which
# is why the unfixable count does not suppress it. A machine can be unchanged
# and still not finished.
if [ "$APPLY" -eq 1 ] && [ "$n_fixed" -eq 0 ]; then
  printf '%sNothing was changed — every item this script can fix was already correct.%s\n' "$GREEN" "$OFF"
fi
if [ "$n_fail" -eq 0 ] && [ "$n_would" -eq 0 ] && [ "$n_wait" -eq 0 ] && [ "$n_fixed" -eq 0 ]; then
  printf '%sThis machine is fully provisioned.%s\n' "$GREEN" "$OFF"
fi

printf '%sVerify independently:  npm run doctor:node%s\n' "$DIM" "$OFF"
echo

# A dry run reports; it does not judge. Only --apply can fail the machine.
if [ "$APPLY" -eq 1 ] && [ "$n_fail" -gt 0 ]; then exit 1; fi
exit 0
