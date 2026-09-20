#!/bin/bash
#
# What the Monday 07:00 schedule actually runs.
#
# Same two steps, and the same reasoning, as run_bus_relay.sh: bring the
# checkout up to date first, then do the job. The report reads WHO MAY RUN IT
# out of lib/nodeRoles.js in this checkout at run time, so a machine nobody
# sits at would otherwise keep running whatever code it had the day it was set
# up — and the day that matters is the day ownership moves, when the new owner
# would go on believing the job belongs to the old one. Nothing would error.
# The report would simply stop appearing.
#
# The update is deliberately timid and never blocks the report:
#   - only on main, only with a clean tree, only fast-forward
#   - any refusal is logged and the report runs on the code that is here
# A background job may keep a checkout current; it may not rewrite anyone's work.
#
# THE CLEANUP BELOW IS NOW A BACKSTOP, NOT THE DEFENCE (task 86bc0nbwq).
#
# Since 2026-09-14 the report does not write into this checkout at all: it
# writes to a folder outside every repo (lib/weeklyReportHome.js, which REFUSES
# if that folder turns out to be inside one) and publishes by uploading to
# Google Drive. So there is no residue to clean on a machine running current
# code, and these two calls do nothing on one.
#
# They stay because a machine can be running OLD code — which is the whole point
# of the self-update below — and old code's leftovers are exactly what stops the
# update that would fix it. A machine that fell behind before this change needs
# the cleanup to run once in order to catch up at all. Removing it would leave
# any such machine permanently stuck, quietly.
#
# What the old arrangement cost, kept because it is the reason for the refusal
# in weeklyReportHome.js and not only for these two calls: the report wrote
# docs/reports/<date>.html, <date>.data.json and index.html into this checkout
# and left them there. "Clean tree" then read false forever — run 1 dirtied the
# checkout, run 2 skipped the update, and it stayed dirty. A deadlock, and a
# silent one: every log line said "update: skipped", which is what a HEALTHY
# skip says too. On 2026-09-14 it cost 7 merges, the Mini missing that day's own
# pipeline fixes (#689, #700) until a session cleared it by hand.
#
# That is worse than staleness. The whole reason this update exists is so that
# moving `weekly-report` to another machine in lib/nodeRoles.js actually reaches
# this one; with the update dead, ownership could move and the Mini would go on
# publishing regardless.
#
# THE RESIDUE COMES IN TWO KINDS, AND REMOVING ONLY THE FIRST REOPENS THE
# DEADLOCK THROUGH A SECOND DOOR.
#
#   untracked — docs/reports/<date>.html and <date>.data.json. A new date every
#               week, so these are never on main when they are written.
#   TRACKED   — docs/reports/index.html. writeIndex() rewrites it on EVERY run,
#               and publish() commits it. So from the second published edition
#               onward it is a tracked file with a local modification, which
#               `git clean` cannot touch and `git status --porcelain` reports
#               forever. `git merge --ff-only` would refuse it too, with
#               "local changes would be overwritten".
#
# So the cleanup does both: remove what is untracked, restore what is tracked.
# Doing it BEFORE the fast-forward matters twice over — leftover output also
# makes `git merge --ff-only` refuse outright once the same file lands on main,
# which is exactly what the first published edition does.
#
# RESTORING IS DESTRUCTIVE, so it is fenced: only on `main`, and only under
# docs/reports/. That is this job's own output directory, and `main` in the
# always-on checkout is the one place nobody hand-edits — it auto-deploys, and
# the repo blocks edits to it. The narrative pass, which is the only thing that
# legitimately edits a report by hand, happens on a branch in its own worktree
# and is never touched by this. Everything restored is named in the log, so a
# surprise is visible rather than silent.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

# ── THIS IS A BACKGROUND JOB, AND IT SAYS SO ─────────────────────────────────
# The ClickUp budget is one allowance per token for the whole company, and the
# operator's decision (2026-09-03) is that scheduled jobs yield: "You are never
# blocked by a background job." Every child process inherits this, so anything
# this script runs will stop at the reserve instead of spending the budget an
# interactive session is about to need. See scripts/lib/clickupCaller.cjs —
# there is no tty guess anywhere; a scheduled job is one that declares itself.
export STARCASTER_CALLER=scheduled

echo "=== weekly-report $(date '+%Y-%m-%d %H:%M:%S') — $REPO"

# ── A FAILED RUN HAS TO MAKE A NOISE ─────────────────────────────────────────
#
# This wrapper had no failure path at all. A Monday run that gathered its
# figures and then could not publish them exited non-zero into a log file in
# ~/Library/Logs that nobody opens, and the week simply had no report — the
# same silence the whole report was built against.
#
# It matters more now than it did (task 86bc0nbwq): publishing used to mean
# opening a pull request, which is visible on GitHub whether or not anything
# announced it. It now means uploading to a Google Drive folder, and a failed
# upload leaves the report on ONE machine's disk with nothing on any shared
# surface to say it exists. Dane's own requirement: "A Drive upload that fails
# must report through the job-failure path, never 'succeed' with the report
# written nowhere."
#
# report_job_failure.mjs always exits 0 itself and throttles to one post per job
# per 6h, cleared by the next success, so this cannot turn one bad Monday into a
# stream of messages.
#
# IT IS A FUNCTION because there are two ways this run can fail and only one of
# them used to be heard: the publish exiting non-zero, and the refusal above it
# when yesterday's date cannot be worked out. Two call sites, one reporter.
#
# Through npm, not `node` directly: the reporter posts to ClickUp and reads
# CLICKUP_API_TOKEN from the environment, which Doppler supplies via the package
# script. launchd sets no environment at all, so a bare `node` here would fail on
# the one call whose entire job is not to fail quietly. `report:failure` is the
# name — there used to be a second, byte-identical `report:job-failure`, and two
# names for one command drift apart. Worse than untidy here: the scheduled-caller
# detector in scripts/builder/clickupCaller.test.js matches on the string
# `report:failure`, so a wrapper reaching ClickUp only under the other name would
# be invisible to it.
report_failure() {
  echo "failure: reporting to the bus (exit $1)"
  npm run --silent report:failure -- \
    --job weekly-report --status "$1" --log "$HOME/Library/Logs/weekly-report.log" || true
}

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

clean_report_residue() {
  [ -d docs/reports ] || return 0

  residue="$(git ls-files --others --exclude-standard -- docs/reports 2>/dev/null)"
  if [ -n "$residue" ]; then
    echo "cleanup: removing the last run's own untracked output under docs/reports/"
    echo "$residue" | sed 's/^/  /'
    git clean -fdq -- docs/reports 2>/dev/null || echo "cleanup: could not remove it — the checkout stays dirty and the next run will report it"
  fi

  # The tracked half — index.html, and any edition re-rendered for a date that
  # has already shipped. Only on main; see the fencing note above.
  if [ "$branch" = "main" ]; then
    modified="$(git diff --name-only -- docs/reports 2>/dev/null)"
    if [ -n "$modified" ]; then
      echo "cleanup: restoring the last run's own changes to TRACKED files under docs/reports/"
      echo "$modified" | sed 's/^/  /'
      git checkout -- docs/reports 2>/dev/null || echo "cleanup: could not restore them — the checkout stays dirty and the next run will report it"
    fi
  elif [ -n "$(git diff --name-only -- docs/reports 2>/dev/null)" ]; then
    echo "cleanup: tracked files under docs/reports/ are modified, but this checkout is on '$branch', not main — leaving them alone."
  fi
}

clean_report_residue

if [ "$branch" != "main" ]; then
  echo "update: skipped — checkout is on '$branch', not main. Running the code that is here."
elif [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "update: skipped — uncommitted changes present; a background job does not touch them."
elif ! git fetch --quiet origin main 2>/dev/null; then
  echo "update: skipped — could not reach origin. Running the code that is here."
elif ! git merge --ff-only origin/main 2>&1; then
  echo "update: skipped — main has diverged from origin and only a person should sort that out."
else
  echo "update: checkout is at $(git rev-parse --short HEAD)"
fi

# A seam for the test that pins the deadlock above. The self-update is the only
# part of this wrapper a test can exercise honestly — the report itself wants
# doppler, npm and the network — so the test runs the wrapper with this set and
# reads the update lines. launchd sets no environment, so the real Monday run
# never takes this branch.
if [ -n "${WEEKLY_REPORT_UPDATE_ONLY:-}" ]; then
  echo "=== exit 0 (update only)"
  exit 0
fi

# THE WINDOW IS THE WEEK THAT HAS FINISHED, NOT THE ONE WE ARE STANDING IN.
#
# `--window 7` on its own means "the 7 days ending TODAY". Fired Monday 07:00
# that covers up to Monday 07:00, and the next edition starts Tuesday — so
# everything merged between Monday 07:00 and Monday midnight lands in no edition
# at all, and nothing says so, because from the report's point of view that time
# never existed. On real history since 1 July that is 70 of 107 Monday merges,
# and Monday afternoon is not a quiet part of the week:
#
#   git log origin/main --since=2026-07-01 --format='%ad' \
#     --date=format:'%u %H:%M' | awk '$1==1'
#
# It also drew the last bar of the per-day chart from 7 hours of Monday at the
# same width as the six whole days beside it, which reads as a slow Monday every
# single week.
#
# `--as-of yesterday` makes the window Monday-to-Sunday: a week that has
# actually finished, nothing missed, no partial day on the chart.
as_of="$(date -v-1d +%F 2>/dev/null || date -d 'yesterday' +%F)"
if [ -z "$as_of" ]; then
  echo "could not work out yesterday's date — refusing to report on a partial week"
  # AND IT SAYS SO OUT LOUD. This early return used to sit above the failure
  # block at the bottom of the file, so the one path that refuses to run at all
  # was the one path nobody heard about — the same silence that block was added
  # for. Refusing is correct; refusing quietly is not.
  report_failure 1
  echo "=== exit 1"
  exit 1
fi
echo "window: the 7 days ending $as_of (the week that has finished)"

# --publish is what makes this a scheduled job rather than a local command: it
# uploads the edition to Google Drive — Projects > Starcaster > Weekly Reports —
# and files the ticket for the narrative pass. Nothing is committed and nothing
# is pushed; that mechanism was removed in task 86bc0nbwq and is the reason this
# job stopped dirtying the checkout. It refuses on any machine that does not own
# the role, which is why the schedule is harmless if it is ever installed in two
# places.
#
# THROUGH `npm run`, NOT A BARE `node` — THIS IS THE WHOLE JOB (round 1 of
# 86bc0nbwq). launchd hands this script a PATH and a HOME and nothing else, so a
# bare `node scripts/weekly_report.mjs` runs with no Doppler and therefore no
# GOOGLE_* credential in its environment: signing in to Drive fails, the upload
# never even tries, and every Monday reports a failure while the report sits on
# one machine's disk and nowhere else. Running it by hand hides this perfectly,
# because a person types `doppler run` or has a shell that already has it.
# `report:weekly` in package.json is Doppler-wrapped, which is the same move the
# failure reporter below already makes and for the same stated reason.
# `weeklyReportDopplerGuard.test.js` fails if either half is undone.
#
# WEEKLY_REPORT_NODE is the second test seam, and it exists for the same reason
# as the first: the real report wants doppler, npm and the network, so the only
# honest way to test the cleanup BELOW is to stand in a fake report that leaves
# the same files behind. launchd sets no environment, so the real Monday run
# never takes that branch — it always goes through npm.
if [ -n "${WEEKLY_REPORT_NODE:-}" ]; then
  "$WEEKLY_REPORT_NODE" scripts/weekly_report.mjs --as-of "$as_of" --window 7 --publish
else
  npm run --silent report:weekly -- --as-of "$as_of" --window 7 --publish
fi
status=$?

# AND IT CLEANS UP AGAIN HERE, WHICH IS THE CALL THAT ACTUALLY MATTERS.
#
# Cleaning only at the top of the run does work — but the repair does not land
# until the NEXT run, and this job runs once a week. So the checkout sits dirty
# for six days out of seven, the self-update skips every one of those days, and
# EVERY OTHER scheduled job on that machine quietly runs whatever commit was
# current last Monday.
#
# On 2026-09-07 the Mini sat 11 commits behind origin/main from 07:01 until it
# was cleared by hand at 17:50, and it was hiding two more stale checkouts on
# the same machine — pulse 3 commits behind and the VAULT 50, which meant the
# machine was reading canon a fortnight out of date. The stale-checkout alarm
# fired correctly and said "this one needs a person"; it posted to the bus,
# which was refusing writes that day (86bbw860m), so nobody heard it.
#
# Only on success. A publish that failed halfway leaves its output where a
# person can look at it, and the cleanup at the top of the next run is the
# backstop for that case — which is why that call stays exactly where it is.
if [ "$status" -eq 0 ]; then
  clean_report_residue
else
  echo "cleanup: skipped — the publish exited $status, so its output stays put for a person to look at."
fi

# EXIT 3 IS NOT A FAILURE, which is the whole of what this condition decides.
# It is this machine correctly declining a job that belongs to another one
# (lib/nodeRoles.js) — the schedule is deliberately harmless to install
# anywhere, and an alert on every wake of every non-owning machine is how an
# alert becomes noise. What reporting a failure involves is up in
# report_failure(), with the reasoning.
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then
  report_failure "$status"
fi

echo "=== exit $status"
exit $status
