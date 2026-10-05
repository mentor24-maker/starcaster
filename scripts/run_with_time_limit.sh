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
#
# WHAT IT WAS DOING (task 86bccr85c, 2026-10-04): before stopping anything it
# writes the process tree under the command to stdout — and, when
# RUN_WITH_TIME_LIMIT_SNAPSHOT names a file, to that file too, one line per
# process: depth<TAB>pid<TAB>running-for<TAB>command. Five build passes in a
# row were stopped that day while each re-ran an 8-minute check that never
# went green, and because a pass prints its report only at the end, the log
# showed START, END and nothing between. A stuck test looked like a dead
# machine. loop_runner.sh hands the file to `clickup pass-timeout`.

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

# Every process under the command, walked down from it, shallowest first.
# `pkill -P` below reaches only direct children; this has to see the whole
# tree, because the gate a pass was stuck in sits two or three levels down
# (claude -> the Bash tool's shell -> npm -> node).
snapshot() {
  ps -A -o pid=,ppid=,etime=,command= 2>/dev/null | awk -v root="$PID" '
    { pid = $1; ppid = $2; et = $3; $1 = ""; $2 = ""; $3 = ""; sub(/^ +/, "")
      n++; order[n] = pid; parent[pid] = ppid; elapsed[pid] = et; cmd[pid] = $0 }
    END {
      depth[root] = 0; queue[1] = root; head = 1; tail = 1
      while (head <= tail) {
        p = queue[head++]
        for (i = 1; i <= n; i++) {
          c = order[i]
          if (parent[c] == p && !(c in depth)) {
            depth[c] = depth[p] + 1; queue[++tail] = c
            printf "%d\t%s\t%s\t%s\n", depth[c], c, elapsed[c], substr(cmd[c], 1, 400)
          }
        }
      }
    }'
}

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
    TREE="$(snapshot)"
    if [ -n "$TREE" ]; then
      echo "[run_with_time_limit] what was running under it (depth, pid, running for, command):"
      printf '%s\n' "$TREE" | sed 's/^/    /'
    else
      echo "[run_with_time_limit] nothing was running under it — the command itself had gone quiet."
    fi
    if [ -n "${RUN_WITH_TIME_LIMIT_SNAPSHOT:-}" ]; then
      printf '%s\n' "$TREE" > "$RUN_WITH_TIME_LIMIT_SNAPSHOT" 2>/dev/null \
        || echo "[run_with_time_limit] could not write the snapshot to $RUN_WITH_TIME_LIMIT_SNAPSHOT"
    fi
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
