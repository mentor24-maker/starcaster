#!/bin/bash
# Run a command, and stop it if it is still running after N seconds.
#
#   run_with_time_limit.sh <seconds> -- <command> [args...]
#
# WHY (task 86bbzwuz6, 2026-09-13): a loop-build pass wrote its last line at
# 22:44 and then sat idle — 0% CPU, no child processes — for eleven hours.
# loop_runner.sh waited on it with no limit, so the build lane shipped nothing
# overnight with 30 tickets ready. It ignored SIGTERM and needed SIGKILL.
#
# macOS has no `timeout` command, hence this. It POLLS rather than arming a
# background `sleep`: a sleeping watcher outlives the pass it was watching, one
# orphan per pass, forever.
#
# Exit code: the command's own, or 124 when it was stopped (the GNU timeout
# convention), after one plain line on stdout saying what was stopped and why.

LIMIT=${1:?usage: run_with_time_limit.sh <seconds> -- <command...>}
shift
[ "$1" = "--" ] && shift
[ $# -gt 0 ] || { echo "run_with_time_limit: no command given" >&2; exit 2; }
if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || [ "$LIMIT" -lt 1 ]; then
  echo "run_with_time_limit: limit must be a whole number of seconds, got '$LIMIT'" >&2
  exit 2
fi
POLL=${RUN_WITH_TIME_LIMIT_POLL:-15}
GRACE=${RUN_WITH_TIME_LIMIT_GRACE:-30}

"$@" &
PID=$!
START=$(date +%s)

# Stop the command's children too: a pass's Bash tool can leave a child that
# keeps the output pipe open after the parent is gone.
stop() {
  local signal=$1
  pkill "-$signal" -P "$PID" 2>/dev/null
  kill "-$signal" "$PID" 2>/dev/null
}

while kill -0 "$PID" 2>/dev/null; do
  NOW=$(date +%s)
  if [ $((NOW - START)) -ge "$LIMIT" ]; then
    echo "[run_with_time_limit] $(date "+%Y-%m-%d %H:%M:%S") stopped after ${LIMIT}s — still running at the limit, which a working pass never reaches: $*"
    stop TERM
    WAITED=0
    while kill -0 "$PID" 2>/dev/null && [ "$WAITED" -lt "$GRACE" ]; do
      sleep 1
      WAITED=$((WAITED + 1))
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "[run_with_time_limit] it ignored the stop request for ${GRACE}s — forcing it."
      stop KILL
    fi
    wait "$PID" 2>/dev/null
    exit 124
  fi
  # Sleep in short steps so a command that finishes is noticed promptly.
  STEP=0
  while [ "$STEP" -lt "$POLL" ] && kill -0 "$PID" 2>/dev/null; do
    sleep 1
    STEP=$((STEP + 1))
  done
done

wait "$PID"
exit $?
