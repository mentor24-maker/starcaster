#!/bin/bash
# Run one Spirality loop skill on a fixed interval, forever.
#
#   loop_runner.sh <skill-name> [interval-seconds]
#
# Spirality's runner at e5d86e4 (the Settings page's wake time, pause switches,
# model and the empty-queue check, SP-236/237/239/292; the work-in-progress cap,
# SP-238, is asked inside the work check) with StarCaster's own guards merged
# back in (SC-790, SC-807), each of which answers an incident:
#   - STARCASTER_CALLER=scheduled, so a background pass yields the ClickUp
#     reserve to the sessions Dane is talking to (scripts/lib/clickupCaller.cjs);
#   - the pause switch (`npm run pipeline -- check`) and the shared lane policy
#     (scripts/loop_policy.mjs), asked before every pass;
#   - the usage-limit guard (scripts/loop_runner_delay.mjs), which sleeps to a
#     stated reset instead of retrying into a closed window (2:05am, 2026-09-02);
#   - a heartbeat after every pass, stood-down, blocked, paused and skipped ones
#     included, so the roll call can tell a dead lane from a working one.
# This copy is a stopgap: it is deleted when Spirality runs StarCaster's lanes
# from its own folder (SP-273 / SP-276). Keep it a straight merge.
#
# Each iteration is a FRESH headless Claude Code session started in the main
# checkout. Every loop skill picks the next ticket from the tracker on each run,
# so there is no state to carry between runs, and a crashed run costs one
# interval rather than the whole night.
#
# --allowedTools is used instead of --dangerously-skip-permissions so the
# repo's PreToolUse hook (no edits on main) still applies. A headless run
# cannot answer a permission prompt, so anything not listed is refused and
# the run continues.
#
# Every project-specific name (the log folder, the short name each log and
# lock starts with, the launchd label) comes from the project config through
# scripts/project_config.mjs, the way the installer and run_relay.sh read
# them; nothing here names a project.
set -u

# launchd hands the job almost no environment. Set the PATH once, here.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

SKILL=${1:?usage: loop_runner.sh <skill-name> [interval-seconds]}
# The first sleep's length, handed in by the installer (the default in
# scripts/lib/loopSchedule.mjs). Before every sleep the runner asks the
# tracker for the wake time set on the Settings page (read_wake_time, below)
# and keeps this one only while that cannot be read.
INTERVAL=${2:-1800}

# The repo is WHERE THIS SCRIPT LIVES, never a path typed from memory, and it
# must be the MAIN checkout: a worktree is deleted when its work ships.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
  echo "[loop-runner] Refusing to run from a worktree ($REPO) — worktrees are deleted when their work ships." >&2
  exit 1
fi

cd "$REPO" || exit 1

SLUG="$(node "$REPO/scripts/project_config.mjs" projectSlug)" || { echo "[loop-runner] could not read projectSlug from the project config" >&2; exit 1; }
LOG_DIR="$(node "$REPO/scripts/project_config.mjs" logDir)" || { echo "[loop-runner] could not read logDir from the project config" >&2; exit 1; }
PREFIX="$(node "$REPO/scripts/project_config.mjs" launchdPrefix)" || { echo "[loop-runner] could not read launchdPrefix from the project config" >&2; exit 1; }
# Empty when the project runs no tracker: the restart step then does nothing.
TRACKER_PORT="$(node "$REPO/scripts/project_config.mjs" trackerPort)" || { echo "[loop-runner] could not read trackerPort from the project config" >&2; exit 1; }
LOG="$LOG_DIR/$SLUG-$SKILL.log"
LOCK="$LOG_DIR/$SLUG-$SKILL.lock"
# A file here ends the sleep between passes early (SP-219); `node
# scripts/lib/wakeLane.mjs <lane>` writes it. Named like the lock, from the
# project config.
WAKE="$LOG_DIR/$SLUG-$SKILL.wake"
# How often the sleep looks for the wake file, in seconds.
WAKE_POLL="${LOOP_WAKE_POLL_SECONDS:-5}"
case "$WAKE_POLL" in ""|*[!0-9]*|0) WAKE_POLL=5 ;; esac
# The longest a lane goes without a real Claude pass while its queue is
# empty, in seconds (SP-292): the work check skips empty passes only while
# the last real one is younger than this. 0 turns the skipping off.
IDLE_PASS_EVERY="${LOOP_IDLE_PASS_EVERY_SECONDS:-21600}"
case "$IDLE_PASS_EVERY" in ""|*[!0-9]*) IDLE_PASS_EVERY=21600 ;; esac
# When the last real pass started (epoch seconds); 0 until the first, which always runs.
LAST_REAL_PASS=0
mkdir -p "$LOG_DIR"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || echo "$HOME/.local/bin/claude")}"

# This loop's own tracker sign-in (docs/TRACKER_MVP.md, "Running it"): the
# NAME of its Doppler secret, e.g. loop-build -> TRACKER_TOKEN_LOOP_BUILD.
# The door reads the value inside its own `doppler run`, so the token never
# enters this session's environment or its log.
export TRACKER_TOKEN_NAME="TRACKER_TOKEN_$(printf '%s' "$SKILL" | tr 'a-z-' 'A-Z_')"

# THIS IS A BACKGROUND JOB, AND IT SAYS SO. The ClickUp budget is one allowance
# for the whole company and scheduled jobs yield (Dane, 2026-09-03: "You are
# never blocked by a background job."). Every child inherits this.
export STARCASTER_CALLER=scheduled

# One runner per skill. A stale lock (its pid gone) is announced and taken over,
# so a reboot never leaves the loop dead behind a lock nobody holds.
if ! mkdir "$LOCK" 2>/dev/null; then
  OLD_PID="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[loop-runner] $SKILL is already running (pid $OLD_PID, lock: $LOCK). Refusing to start a second."
    exit 1
  fi
  echo "[loop-runner] found a STALE lock (pid ${OLD_PID:-unrecorded}, no such process) — clearing it and taking over." | tee -a "$LOG"
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || { echo "[loop-runner] the lock could not be retaken. Stopping."; exit 1; }
fi
echo "$$" > "$LOCK/pid"
# The pass reads this to know it is the runner's pass, not a hand-run session:
# only a claim made under the build runner writes the claim marker that lets
# the next pass hand back a ticket a dead pass left in Building (SP-101).
export LOOP_RUNNER_PID="$$"

# The sync lock every lane takes around pull + npm ci (the only lock the lanes
# share; each lane's own lock above is its alone). Wait up to 10 minutes
# for another lane; a lock whose pid is gone is cleared, as above.
SYNC_LOCK="$LOG_DIR/$SLUG-sync.lock"
take_sync_lock() {
  local waited=0 holder
  until mkdir "$SYNC_LOCK" 2>/dev/null; do
    holder="$(cat "$SYNC_LOCK/pid" 2>/dev/null || true)"
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then rm -rf "$SYNC_LOCK"; continue; fi
    [ "$waited" -ge 600 ] && return 1
    sleep 5; waited=$((waited + 5))
  done
  echo "$$" > "$SYNC_LOCK/pid"
}

# The sleep between passes, in steps of WAKE_POLL seconds, so a wake file
# ends it early. It never cuts a pass short: it only runs between passes. A
# wake that arrived during the pass is still there, so the next pass starts at
# once, and any number of wakes sent during one pass start exactly one more
# (they are all the same file). The file is cleared as a pass starts, never
# here, so a wake that lands just as the timer runs out is not left over to
# start a second pass behind it.
sleep_until_woken() {
  local slept=0 step
  while [ "$slept" -lt "$INTERVAL" ]; do
    if [ -e "$WAKE" ]; then
      echo "[loop-runner] $(date "+%H:%M:%S") woken early after ${slept}s of ${INTERVAL}s (wake file $WAKE) — starting the next /$SKILL now" >> "$LOG"
      return 0
    fi
    step=$WAKE_POLL
    [ $((INTERVAL - slept)) -lt "$step" ] && step=$((INTERVAL - slept))
    sleep "$step"; slept=$((slept + step))
  done
}

# The wake time Dane set for this lane on the tracker's Settings page
# (SP-236), read before every sleep, so a change takes effect at the next
# sleep with no launchd reload. scripts/lib/wakeSetting.mjs prints the number,
# or one line saying why it could not; only a whole number of at least 60
# seconds is ever slept on. Anything else keeps the last good value (on the
# first pass, the one launchd passed in), and the log says so in one line:
# the lane never stops and never sleeps 0.
read_wake_time() {
  local said
  said="$(node "$REPO/scripts/lib/wakeSetting.mjs" "$SKILL" 2>/dev/null)"
  local code=$?
  case "$said" in
    ""|*[!0-9]*) ;;
    *) if [ "$code" -eq 0 ] && [ "$said" -ge 60 ]; then INTERVAL="$said"; return 0; fi ;;
  esac
  echo "[loop-runner] $(date "+%H:%M:%S") could not read /$SKILL's wake time from the tracker (${said:-no answer}) — keeping the last good value, ${INTERVAL}s" >> "$LOG"
}

# The model Dane chose for this lane on the tracker's Settings page (SP-239),
# read before every pass, so a change takes effect at the next pass with no
# launchd reload. scripts/lib/modelSetting.mjs prints `default` or one id from
# the Settings page's own list (scripts/lib/laneModels.mjs MODELS), or one
# line saying why it could not. A chosen model adds `--model <id>` to the
# claude line; `default`, or anything that could not be read or is not a
# plain model id, adds nothing, so the command is exactly what it was before
# the setting existed, and the log says why in one line. PASS_MODEL is what
# the START line names.
read_model() {
  PASS_MODEL=default
  MODEL_ARGS=()
  local said code
  said="$(node "$REPO/scripts/lib/modelSetting.mjs" "$SKILL" 2>/dev/null)"
  code=$?
  if [ "$code" -eq 0 ]; then
    case "$said" in
      default) return 0 ;;
      *[!a-z0-9.-]*) ;;
      claude-?*) PASS_MODEL="$said"; MODEL_ARGS=(--model "$said"); return 0 ;;
    esac
  fi
  echo "[loop-runner] $(date "+%H:%M:%S") could not read /$SKILL's model from the tracker (${said:-no answer}) — this pass runs on Claude's default" >> "$LOG"
}

# A template with X's, the one form macOS and GNU mktemp both accept.
PASS_OUT="$(mktemp "${TMPDIR:-/tmp}/$SLUG-pass.XXXXXX")"
trap 'rm -rf "$LOCK" "$PASS_OUT" 2>/dev/null; [ "$(cat "$SYNC_LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$SYNC_LOCK"' EXIT

# shellcheck source=lib/back_to_main.sh
source "$REPO/scripts/lib/back_to_main.sh"
# A pull that changes a file the tracker server loads restarts it, so it runs the new code (SP-150).
# shellcheck source=lib/tracker_restart.sh
source "$REPO/scripts/lib/tracker_restart.sh"

while true; do
  # Where main was before this pass synced: noted BEFORE step 0, because that
  # step can fast-forward main itself, and a tracker change it brings in must
  # count too (SP-150).
  BEFORE="$(git rev-parse HEAD 2>/dev/null)"

  # 0. A checkout left on a branch that has merged and gone from origin (a new
  #    project's lanes run from its setup branch until it merges) goes
  #    back to main, under the sync lock, so the pull below can run.
  if [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" != "main" ] && [ -z "$(git status --porcelain)" ]; then
    if take_sync_lock; then
      MOVED="$(back_to_main_if_merged)"
      [ -n "$MOVED" ] && echo "[loop-runner] $(date "+%H:%M:%S") $MOVED" >> "$LOG"
      rm -rf "$SYNC_LOCK"
    fi
  fi

  # 1. A timid pull: only main, only a clean tree, only fast-forward. A refusal
  #    is logged but never blocks the pass. Every lane shares this checkout, so
  #    the pull and `npm ci` happen under one shared lock: two at once collide
  #    on .git/index.lock and rebuild node_modules under each other.
  if [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] && [ -z "$(git status --porcelain)" ]; then
    if take_sync_lock; then
      git pull -q --ff-only origin main >> "$LOG" 2>&1 || echo "[loop-runner] $(date "+%H:%M:%S") pull of main refused (see above) — running on the checkout as it is" >> "$LOG"
      # Dependencies follow the lockfile, so a merged change to package.json takes effect on the next pass.
      npm ci --silent >> "$LOG" 2>&1 || echo "[loop-runner] $(date "+%H:%M:%S") npm ci failed — running with the node_modules already present" >> "$LOG"
      # After npm ci, so a merge that adds a dependency restarts onto it.
      RESTARTED="$(restart_tracker_if_changed "$BEFORE" "$(git rev-parse HEAD 2>/dev/null)" "$PREFIX" "$TRACKER_PORT")"
      [ -n "$RESTARTED" ] && echo "[loop-runner] $(date "+%H:%M:%S") $RESTARTED" >> "$LOG"
      rm -rf "$SYNC_LOCK"
    else
      echo "[loop-runner] $(date "+%H:%M:%S") another lane held the sync lock for 10 minutes — not pulling this pass" >> "$LOG"
    fi
  else
    echo "[loop-runner] $(date "+%H:%M:%S") main checkout is not on a clean main — not pulling. Every pass runs stale code until it is put back on main." >> "$LOG"
  fi

  # 1a. (StarCaster) Has Dane paused the line? Every actor asks before claiming
  #     (CLAUDE.md, "The pipeline can be paused"), and the copied skills do not
  #     ask, so the runner asks for them. It FAILS SAFE: anything but exit 0
  #     (running) is treated as paused, because running while he has the deck
  #     collides with what he is doing and idling costs one interval.
  if ! npm run --silent pipeline -- check >> "$LOG" 2>&1; then
    PAUSE_SLEEP="${PAUSE_RECHECK_SECONDS:-600}"
    echo "[loop-runner] $(date "+%H:%M:%S") the pipeline is paused (or the switch could not be read) — no /$SKILL pass; asking again in ${PAUSE_SLEEP}s" >> "$LOG"
    npm run --silent heartbeat -- --beat --role "$SKILL" \
      --stood-down "the pipeline is paused; the runner is alive and asking again every ${PAUSE_SLEEP}s" >> "$LOG" 2>&1 || true
    sleep "$PAUSE_SLEEP"
    continue
  fi

  # 1b. (StarCaster) One Claude limit, shared by Dane and every lane on this
  #     machine (task 86bcgjbfk): `quiet` is Dane's hours, `stand-down` means
  #     another lane already read a usage-limit reset. FAILURE-OPEN: anything
  #     unreadable answers `run`, and says so in this log.
  POLICY_ANSWER=$(node "$REPO/scripts/loop_policy.mjs" check --lane "$SLUG/$SKILL" 2>> "$LOG")
  read -r POLICY_ACTION POLICY_SLEEP POLICY_LINE <<< "$POLICY_ANSWER"
  if { [ "$POLICY_ACTION" = "quiet" ] || [ "$POLICY_ACTION" = "stand-down" ]; } \
     && [[ "$POLICY_SLEEP" =~ ^[0-9]+$ ]] && [ "$POLICY_SLEEP" -gt 0 ]; then
    echo "[loop-runner] $(date "+%H:%M:%S") $POLICY_LINE; asking again in ${POLICY_SLEEP}s" >> "$LOG"
    # Still a beat (the runner is alive and obeying the rule), marked as a
    # stand-down so the roll call does not read it as a pass that worked.
    npm run --silent heartbeat -- --beat --role "$SKILL" \
      --stood-down "$POLICY_LINE" >> "$LOG" 2>&1 || true
    sleep "$POLICY_SLEEP"
    continue
  fi

  # 2. Paused? (SP-237) The Settings page's switches, the whole pipeline and
  #    this lane, asked here, between passes, so a pause never stops a pass
  #    already running: it drains. Asked after the pull, so the check is the
  #    newest code. ANY non-zero exit counts as paused, a check that could not
  #    run included (it fails safe), and the line it printed says which.
  PAUSE_LINE="$("$REPO/scripts/pause_check.sh" "$SKILL" 2>>"$LOG")"
  PAUSE_CODE=$?
  if [ "$PAUSE_CODE" -ne 0 ]; then
    [ -n "$PAUSE_LINE" ] || PAUSE_LINE="could not read the pipeline settings (the check exited $PAUSE_CODE and said nothing; its errors are above), so /$SKILL is treated as PAUSED and not starting (it fails safe)"
    echo "[loop-runner] $(date "+%H:%M:%S") $PAUSE_LINE" >> "$LOG"
    # (StarCaster) Alive and obeying the switch: a stood-down beat, as for 1a.
    npm run --silent heartbeat -- --beat --role "$SKILL" \
      --stood-down "paused on the Settings page; the runner is alive and asking again every ${INTERVAL}s" >> "$LOG" 2>&1 || true
    # A wake sent while paused is answered by this check, not kept: kept, it
    # would end every sleep at once and ask again every few seconds.
    rm -f "$WAKE"
    echo "[loop-runner] $(date "+%H:%M:%S") sleeping ${INTERVAL}s before the next /$SKILL (a wake ends it early)" >> "$LOG"
    sleep_until_woken
    continue
  fi

  # This pass reads the queue afresh (the work check below, then the pass), so
  # every wake sent before now is answered by it. A wake sent from here on is
  # kept for the next one.
  rm -f "$WAKE"

  # 3. Anything to do? (SP-292) A pass with nothing to do used to start a
  #    Claude session only to say "nothing to do", and every one counted
  #    against the weekly limit, so a short wake time cost quota on every
  #    empty tick. scripts/work_check.sh asks the door the same first
  #    questions the skill asks, with no AI, and exits 3 only on a clean read
  #    that found nothing; any other exit (work, could not tell, the check
  #    could not run) starts the pass as before, so a ticket is never left
  #    waiting on the check. It is not asked on the first pass after this
  #    runner starts, nor when the last real pass is IDLE_PASS_EVERY seconds
  #    old or more: those passes run anyway, so a broken Claude sign-in still
  #    shows on the Pipeline Status pod within hours, and a new project's
  #    first pass is still there for `npm run onboard:lanes` to read. The
  #    skipped pass leaves a dated SKIP line (never START or END, so no
  #    reader counts it as a pass), which the pod dates its sleeping lines by.
  if [ "$LAST_REAL_PASS" -gt 0 ] && [ $(( $(date +%s) - LAST_REAL_PASS )) -lt "$IDLE_PASS_EVERY" ]; then
    WORK_LINE="$("$REPO/scripts/work_check.sh" "$SKILL" 2>>"$LOG")"
    WORK_CODE=$?
    if [ "$WORK_CODE" -eq 3 ]; then
      echo "===== $(date "+%Y-%m-%d %H:%M:%S") SKIP /$SKILL (${WORK_LINE:-no work}; Claude not started) =====" >> "$LOG"
      # (StarCaster) A pass that honestly found nothing to do is a `ran` beat
      # (lib/nodeHeartbeat.js), so a quiet lane never trips the stale alarm.
      npm run --silent heartbeat -- --beat --role "$SKILL" >> "$LOG" 2>&1 || true
      read_wake_time
      echo "[loop-runner] $(date "+%H:%M:%S") sleeping ${INTERVAL}s before the next /$SKILL (a wake ends it early)" >> "$LOG"
      sleep_until_woken
      continue
    fi
    echo "[loop-runner] $(date "+%H:%M:%S") work check: ${WORK_LINE:-the check exited $WORK_CODE and said nothing} — starting /$SKILL" >> "$LOG"
  fi
  LAST_REAL_PASS="$(date +%s)"
  read_model
  echo "" >> "$LOG"
  # The START line names the model, so the Settings page (tracker/pipeline.mjs)
  # and the time-in-status report can tell which pass ran on what.
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /$SKILL (model: $PASS_MODEL) =====" >> "$LOG"
  # The pass's output goes to the log as it happens AND to its own file, so
  # the sign-in check below reads this pass only, not an older one.
  # The time limit writes what the pass was running into this file when it has
  # to stop it; the pass's own report never arrives in that case. Cleared
  # first, so a stop never reports the previous stop's snapshot.
  SNAPSHOT="$LOG_DIR/$SLUG-$SKILL.timeout-snapshot"
  rm -f "$SNAPSHOT"
  RUN_WITH_TIME_LIMIT_SNAPSHOT="$SNAPSHOT" \
  "$REPO/scripts/run_with_time_limit.sh" "${LOOP_PASS_LIMIT_SECONDS:-7200}" -- \
    "$CLAUDE_BIN" -p "/$SKILL" ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
    --allowedTools Bash Edit Write Read Glob Grep Task TodoWrite WebFetch \
    2>&1 | tee "$PASS_OUT" >> "$LOG"
  CODE=${PIPESTATUS[0]}
  # `claude -p` exits 0 whenever it produced output, so the code is a fact
  # about the process, not a verdict on the pass. The pass's own report is.
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /$SKILL (exit $CODE — not a verdict; the pass's report above is) =====" >> "$LOG"
  # A pass the time limit stopped has no report, so the door is asked to say
  # what it was doing, on the ticket the pass held (lib/passTimeout.js). It
  # never fails the runner: until the door has a `pass-timeout` command the
  # line below logs its "Unknown command" answer and carries on.
  if [ "$CODE" -eq 124 ]; then
    npm run --silent clickup -- pass-timeout --pass "$SKILL" \
      --limit "${LOOP_PASS_LIMIT_SECONDS:-7200}" --snapshot "$SNAPSHOT" \
      >> "$LOG" 2>&1 || true
    echo "[loop-runner] the pass hit the ${LOOP_PASS_LIMIT_SECONDS:-7200}s time limit and was stopped; its ticket may still be in Building — the next pass or a person should hand it back." >> "$LOG"
  fi
  # Only Claude's own sign-in errors, and only in this pass's last lines: a
  # pass that merely mentions "not logged in" (gh, supabase) is not one.
  if tail -20 "$PASS_OUT" | grep -qiE "OAuth session expired|Failed to authenticate|Invalid API key|Please run /login"; then
    echo "[loop-runner] $(date "+%H:%M:%S") THIS PASS COULD NOT SIGN IN TO CLAUDE. Nothing will change until a person signs in on this machine (claude login) and restarts this job: launchctl kickstart -k gui/$(id -u)/$PREFIX.$SKILL" >> "$LOG"
  fi

  # 4. (StarCaster) What did this pass DO? Asked BEFORE the beat (task 86bc3t0n1), so the
  #    beat can say which kind of pass it was. The exit code is the fact: a pass
  #    that exited 0 ran, whatever its prose says about limits, and only a
  #    non-zero pass is handed to the guard (scripts/builder/loopRunnerGuard.js)
  #    to say WHICH failure it was: stood-down (a usage limit; sleep to its
  #    reset), blocked (needs a human, e.g. an expired login; never slept on),
  #    or timed-out (the time limit stopped a working pass).
  PASS_KIND=ran
  LIMIT_SLEEP=0
  if [ "$CODE" -ne 0 ]; then
    GUARD_ANSWER=$(node "$REPO/scripts/loop_runner_delay.mjs" "$LOG" --exit "$CODE" \
      --skill "$SKILL" --limit "${LOOP_PASS_LIMIT_SECONDS:-7200}" 2>> "$LOG")
    read -r ANSWER_KIND ANSWER_SLEEP ANSWER_WHY <<< "$GUARD_ANSWER"
    case "$ANSWER_KIND" in
      ran|stood-down|blocked|timed-out) PASS_KIND="$ANSWER_KIND" ;;
      *)
        echo "[loop-runner] the pass guard gave no usable answer ('$GUARD_ANSWER') for a pass that exited $CODE — recording it as blocked" >> "$LOG"
        PASS_KIND=blocked
        ;;
    esac
    if [[ "$ANSWER_SLEEP" =~ ^[0-9]+$ ]]; then LIMIT_SLEEP="$ANSWER_SLEEP"; fi
    if [ "$PASS_KIND" != "stood-down" ]; then LIMIT_SLEEP=0; fi
  fi

  # A limit this lane read is a limit every lane is under: write it where the
  # others look (step 1b), so their next cycle sleeps instead of hitting it.
  if [ "$PASS_KIND" = "stood-down" ] && [[ "$LIMIT_SLEEP" =~ ^[0-9]+$ ]] && [ "$LIMIT_SLEEP" -gt 0 ]; then
    node "$REPO/scripts/loop_policy.mjs" stand-down --lane "$SLUG/$SKILL" \
      --seconds "$LIMIT_SLEEP" --reason "a usage limit closed a /$SKILL pass" >> "$LOG" 2>&1 || true
  fi

  # 5. (StarCaster) The beat: LIVENESS, recorded whatever the pass concluded, and carrying
  #    the kind so nothing downstream has to read this log. `--beat` never
  #    fails its caller by contract (scripts/node_heartbeat.mjs).
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
    timed-out)
      npm run --silent heartbeat -- --beat --role "$SKILL" \
        --timed-out "${ANSWER_WHY:-the pass ran the full time limit without finishing and was stopped; see $LOG}" \
        >> "$LOG" 2>&1 || true
      ;;
    *)
      npm run --silent heartbeat -- --beat --role "$SKILL" >> "$LOG" 2>&1 || true
      ;;
  esac

  # 6. How long to sleep: a usage limit's stated reset outranks the wake time.
  if [[ "$LIMIT_SLEEP" =~ ^[0-9]+$ ]] && [ "$LIMIT_SLEEP" -gt 0 ]; then
    echo "[loop-runner] $(date "+%H:%M:%S") usage limit — sleeping ${LIMIT_SLEEP}s (the reason is above)" >> "$LOG"
    sleep "$LIMIT_SLEEP"
    continue
  fi
  read_wake_time
  echo "[loop-runner] $(date "+%H:%M:%S") sleeping ${INTERVAL}s before the next /$SKILL (a wake ends it early)" >> "$LOG"
  sleep_until_woken
done
