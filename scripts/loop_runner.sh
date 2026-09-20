#!/bin/bash
# Run one Starcaster loop skill on a repo-paced interval, forever.
#
#   loop_runner.sh <skill-name> [fallback-interval-seconds]
#
# COMMITTED SINCE 2026-09-02 (task 86bbtuje2, audit Phase 1). This script ran
# the whole factory from ~/bin/loop-runner.sh on the Mac Mini for its first
# two weeks — one hand-installed file, in no repository, with no history. The
# audit called that the highest-leverage gap on the board: no beats (so the
# heartbeat reported the loop lanes NOT REPORTING forever), no pull before a
# pass (so a merged skill edit lagged until some pass happened to fast-forward
# the checkout), no idea what a usage limit is (2:05am, three passes retried
# into the same closed window), and an END line that presented `claude -p`'s
# exit code as a verdict when it is nothing of the kind.
#
# Each iteration is a FRESH headless Claude Code session started in the main
# checkout. That is deliberate: both loop skills pick up the next ticket from
# ClickUp on every run, so there is no state to carry between runs, and a
# crashed run costs one interval rather than the whole night.
#
# --allowedTools is used instead of --dangerously-skip-permissions so the deny
# rules in ~/.claude/settings.json (notably git push --force) still apply, and
# so the repo PreToolUse hooks still block edits on main and edits to generated
# files. A headless run cannot answer a permission prompt, so anything not
# covered here is simply refused and the run continues.
set -u

# A launchd job gets almost no environment; a screen session inherits an odd
# one. Set the PATH once, here, rather than inline at each call site.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SKILL=${1:?usage: loop_runner.sh <skill-name> [fallback-interval-seconds]}
INTERVAL=${2:-3600}

# The repo is WHERE THIS SCRIPT LIVES, never a path typed from memory — this
# runs on more than one machine, and a literal path is an assumption that
# fails silently on all but the one it was typed on. And it must be the MAIN
# checkout: a worktree gets deleted when its thread ships, and the loops must
# not be running from a folder with that property.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
  echo "[loop-runner] Refusing to run from a worktree ($REPO) — worktrees are deleted when their work ships." >&2
  exit 1
fi

LOG="$HOME/loop-logs/$SKILL.log"
LOCK="$HOME/loop-logs/$SKILL.lock"
mkdir -p "$HOME/loop-logs"

# The claude binary, found rather than assumed, with the old hand-install
# location as the fallback of record.
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || echo "$HOME/.local/bin/claude")}"

# ── One runner per skill ─────────────────────────────────────────────────────
# Two review loops reviewing the same ticket overwrote each other on
# 2026-08-22; the lock makes an accidental double-start impossible.
#
# A STALE lock is detected rather than obeyed forever (new with the committed
# runner): the previous life records its PID inside the lock, and if that
# process is gone — a crash, a reboot, a kill -9 that skipped the trap — the
# lock is announced, cleared and taken over. Without this, launchd's
# RunAtLoad would find the lock of the life that died in the reboot and the
# loops would never start again, silently, which is the exact shape the
# heartbeat was built to catch but should not have to.
if ! mkdir "$LOCK" 2>/dev/null; then
  OLD_PID="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[loop-runner] $SKILL is already running (pid $OLD_PID, lock: $LOCK). Refusing to start a second."
    exit 1
  fi
  echo "[loop-runner] found a STALE lock (pid ${OLD_PID:-unrecorded}, no such process) — clearing it and taking over." | tee -a "$LOG"
  rm -rf "$LOCK"
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "[loop-runner] the lock could not be retaken — something else won the race. Stopping."
    exit 1
  fi
fi
echo "$$" > "$LOCK/pid"
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

cd "$REPO" || exit 1

# ── THIS IS A BACKGROUND JOB, AND IT SAYS SO ─────────────────────────────────
# The ClickUp budget is one allowance per token for the whole company, and the
# operator's decision (2026-09-03) is that scheduled jobs yield: "You are never
# blocked by a background job." Every child process inherits this, so anything
# this script runs will stop at the reserve instead of spending the budget an
# interactive session is about to need. See scripts/lib/clickupCaller.cjs —
# there is no tty guess anywhere; a scheduled job is one that declares itself.
export STARCASTER_CALLER=scheduled

while true; do
  # ── 1. A timid pull, so a pass runs the code and skills on main ────────────
  # Same rules as the relay's update step, through the same committed tool:
  # only the main branch, only a clean tree, only fast-forward, and a refusal
  # is reported (checkout:current posts to the bus itself) but never blocks
  # the pass — a background job may keep a checkout current; it may not
  # rewrite someone's work or refuse to work because it could not.
  npm run --silent checkout:current >> "$LOG" 2>&1 || true

  echo "" >> "$LOG"
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /$SKILL =====" >> "$LOG"
  # A time limit, because a pass that freezes otherwise blocks this lane
  # forever: on 2026-09-12 one sat idle for eleven hours and nothing was built
  # overnight (task 86bbzwuz6). A pass takes 10-15 minutes; two hours is dead.
  # Exit 124 means it was stopped; the next pass's pass-reconcile hands back
  # any ticket it had claimed.
  "$REPO/scripts/run_with_time_limit.sh" "${LOOP_PASS_LIMIT_SECONDS:-7200}" -- \
    "$CLAUDE_BIN" -p "/$SKILL" \
    --allowedTools Bash Edit Write Read Glob Grep Task TodoWrite WebFetch \
    >> "$LOG" 2>&1
  CODE=$?
  # The exit code is recorded because its ABSENCE would look like a truncated
  # log, but it is labelled for what it is. `claude -p` exits 0 whenever it
  # produced output — the pass that abandoned ticket 86bbjt1b4 with a
  # finished, green PR exited 0 — so the pass's own report above is the only
  # verdict there is.
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /$SKILL (exit $CODE — not a verdict; the pass's report above is) =====" >> "$LOG"

  # ── 2. What did this pass actually DO? ────────────────────────────────────
  # ASKED BEFORE THE BEAT, AND THAT ORDER IS THE POINT (task 86bc3t0n1). This
  # used to run after, so the beat could only ever say "a pass happened" — and
  # from 2026-09-16 to 2026-09-19 both lanes fired every fifteen minutes, died
  # in about a second, and beat every time. 90 hours, 20 tickets open, and the
  # roll call showed all six jobs healthy, because every one of those
  # statements was true.
  #
  # THE EXIT CODE IS A FACT; THE LOG TEXT IS A GUESS ABOUT A FACT (round 2).
  # $CODE is right here and was never consulted, so the kind was decided by
  # grepping the pass's prose — which failed in both directions, live:
  #
  #   - `Failed to authenticate: OAuth session expired and could not be
  #     refreshed` contains none of the expected words, so 278 dead passes beat
  #     as healthy working ones. That is the 90-hour outage.
  #   - A pass that merely WROTE about limits matched the pattern: on
  #     2026-09-20 the review pass quoted the guard's own regex in its report
  #     and the review lane slept half an hour for nothing.
  #
  # So a pass that exited 0 is a pass that ran, full stop — no sentence inside
  # its own report can change that — and only a non-zero pass is handed to the
  # guard, which says WHICH kind of failure it was. The guard is pure and
  # tested (scripts/builder/loopRunnerGuard.js); it may never fail the runner.
  #
  #   ran         it worked. Pace normally.
  #   stood-down  a usage limit closed it. Sleep until the stated reset — the
  #               limit names its own, and retrying before it is a pass spent
  #               rediscovering the same closed window (2:05, 2:23, 2:38am on
  #               2026-09-02).
  #   blocked     it could not work and nothing will change that without a
  #               human — an expired login, or a failure naming no cause that
  #               clears itself. Never slept on: sleeping in front of a locked
  #               door 48 times a day is what the 90 hours were.
  PASS_KIND=ran
  LIMIT_SLEEP=0
  if [ "$CODE" -ne 0 ]; then
    GUARD_ANSWER=$(node "$REPO/scripts/loop_runner_delay.mjs" "$LOG" --exit "$CODE" 2>> "$LOG")
    # Two fields, "<kind> <seconds>". Anything else means the guard did not
    # answer, and a pass that exited non-zero is not called healthy on the
    # strength of a broken reading — it is `blocked`, paced normally.
    read -r ANSWER_KIND ANSWER_SLEEP <<< "$GUARD_ANSWER"
    case "$ANSWER_KIND" in
      ran|stood-down|blocked) PASS_KIND="$ANSWER_KIND" ;;
      *)
        echo "[loop-runner] the pass guard gave no usable answer ('$GUARD_ANSWER') for a pass that exited $CODE — recording it as blocked" >> "$LOG"
        PASS_KIND=blocked
        ;;
    esac
    if [[ "$ANSWER_SLEEP" =~ ^[0-9]+$ ]]; then LIMIT_SLEEP="$ANSWER_SLEEP"; fi
    # Only a stand-down sleeps. A `blocked` pass waiting half an hour is the
    # wrong answer to a locked door, and `ran` never reaches here anyway.
    if [ "$PASS_KIND" != "stood-down" ]; then LIMIT_SLEEP=0; fi
  fi

  # ── 3. The beat: this runner fired a pass, and what that pass could do ─────
  # LIVENESS, not quality — recorded whatever the pass concluded, because what
  # the heartbeat exists to catch is the runner going quiet (a dead Mini, a
  # dead screen, a stale lock), and pass QUALITY is throughput's question.
  #
  # A STAND-DOWN AND A BLOCK ARE STILL BEATS, marked as what they are. The
  # runner IS alive, and saying otherwise would send somebody to launchd over a
  # working schedule — so it beats, and the beat carries the kind so nothing
  # downstream has to read this log to find out. `--beat` never fails its
  # caller by contract (scripts/node_heartbeat.mjs).
  case "$PASS_KIND" in
    stood-down)
      npm run --silent heartbeat -- --beat --role "$SKILL" \
        --stood-down "a usage limit closed this pass; the runner is sleeping ${LIMIT_SLEEP}s until it resets" \
        >> "$LOG" 2>&1 || true
      ;;
    blocked)
      npm run --silent heartbeat -- --beat --role "$SKILL" \
        --blocked "the pass exited $CODE having done no work; see $LOG for the reason the guard read" \
        >> "$LOG" 2>&1 || true
      ;;
    *)
      npm run --silent heartbeat -- --beat --role "$SKILL" >> "$LOG" 2>&1 || true
      ;;
  esac

  # ── 4. How long to sleep ───────────────────────────────────────────────────
  if [[ "$LIMIT_SLEEP" =~ ^[0-9]+$ ]] && [ "$LIMIT_SLEEP" -gt 0 ]; then
    echo "[loop-runner] $(date "+%H:%M:%S") usage limit — sleeping ${LIMIT_SLEEP}s (the reason is above)" >> "$LOG"
    sleep "$LIMIT_SLEEP"
    continue
  fi

  # How long to sleep is asked fresh each cycle, not fixed at startup: a number
  # chosen once is right at that moment and wrong an hour later (task 86bbmg2fb).
  # The decision lives in scripts/builder/loopInterval.js, tested, and this
  # stays one call plus its fallback.
  NEXT=$(npm run --silent clickup -- \
           next-interval --for "$SKILL" --fallback "$INTERVAL" 2>>"$LOG" | tail -1)
  # Anything that is not a plain integer means the command did not answer, so
  # the runner keeps working on its configured argument — never on a guess.
  if ! [[ "$NEXT" =~ ^[0-9]+$ ]]; then
    echo "[loop-runner] next-interval gave no usable answer ('$NEXT') — falling back to ${INTERVAL}s" >> "$LOG"
    NEXT=$INTERVAL
  fi
  echo "[loop-runner] $(date "+%H:%M:%S") sleeping ${NEXT}s before the next /$SKILL" >> "$LOG"
  sleep "$NEXT"
done
