'use strict';

/**
 * The heartbeat — making SILENCE detectable.
 *
 * WHY THIS EXISTS (NODES Slice E, principle P4, ticket 86bbhbadj)
 * A job that FAILS at least writes a log line and, since 2026-08-20, posts to
 * the bus. A job that never fires writes nothing at all, and nothing is
 * indistinguishable from a quiet week. The Mac Mini works overnight with
 * nobody watching; its schedule can be unloaded, its lid-less machine can be
 * unplugged, its launchd job can be evicted after an OS update, and every one
 * of those looks exactly like "no news".
 *
 * So each job records a BEAT when it succeeds, and something reads those beats
 * and speaks up when one stops arriving.
 *
 * THE PART THAT IS EASY TO GET WRONG
 * A watchdog that runs on the same machine as the job it watches cannot
 * detect that machine being off — the case it exists for. The beats therefore
 * live on a surface BOTH machines can read (a ClickUp task), and the check is
 * run by whichever machine happens to be awake, including the one that does
 * NOT own the job. That is why `scripts/run_bus_relay.sh` runs the check
 * before it asks whether it owns the relay: the non-owning machine's wake-up
 * was already happening every ten minutes and doing nothing at all, and it is
 * exactly the right vantage point.
 *
 * THREE STATES, NEVER TWO (docs/DOCTRINE.md §3.11)
 * A role reports as BEATING, OVERDUE, or NOT REPORTING — the last one meaning
 * the job has no beat emitter yet, which is not the same as healthy and must
 * never render as one. Today only `bus-relay` emits; the loops run inside
 * agent sessions with no committed runner to hang a beat on.
 *
 * TWO CLOCKS, ON PURPOSE
 *   - the LOCAL stamp is written on every successful run. It costs nothing,
 *     never touches the network, and gives `doctor:node` a precise answer to
 *     "when did this last work?" on the machine itself.
 *   - the SHARED row is pushed at most once a day. That is what keeps this
 *     from being channel noise x365, and it is the resolution the requirement
 *     actually needs: the acceptance criterion is "stop the job for a day and
 *     see the absence", not "see the absence within ten minutes".
 *
 * NOTHING HERE TOUCHES THE NETWORK. Every decision is a pure function over
 * data the caller fetched, so `node --test` drives every branch with no token,
 * no ClickUp and no clock of its own. The IO lives in
 * `scripts/node_heartbeat.mjs`.
 *
 * NO MACHINE IS NAMED HERE (NODES P1). Paths derive from os.homedir().
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const nodeRoles = require('./nodeRoles.js');

// --- where a beat is recorded ----------------------------------------------

/**
 * The local stamp folder. Under Application Support rather than in the repo
 * because it is a fact about the MACHINE, not about the code — a worktree gets
 * deleted when its thread ships, and a beat history that vanishes with it
 * would report a healthy job as silent.
 */
function heartbeatDir(homedir = os.homedir()) {
  return path.join(homedir, 'Library', 'Application Support', 'starcaster', 'heartbeat');
}

function beatFile(role, homedir = os.homedir()) {
  return path.join(heartbeatDir(homedir), `${String(role).replace(/[^a-z0-9-]/gi, '-')}.json`);
}

/**
 * WHAT KIND OF PASS THIS BEAT CAME FROM (task 86bc3t0n1).
 *
 * A beat used to mean one thing: the runner fired and the pass came back. That
 * held right up until the pass came back having done NOTHING, on purpose,
 * because Anthropic's usage limit was closed. From 2026-09-16 to 2026-09-19
 * both loop lanes fired hourly, stood down on a limit in seconds, exited
 * cleanly, and beat every time. 90 hours, 20 tickets open, three of them in
 * review for the better part of a week — and the roll call showed all six jobs
 * BEAT, because every one of those statements was true. Liveness was real;
 * usefulness was zero. It was found because Dane asked.
 *
 * So a beat carries its KIND. `ran` is a pass that did its work (or honestly
 * found none to do); `stood-down` is a pass that could not work and said so.
 * The roll call keeps them apart, and a stand-down that outlasts the role's own
 * window reads as an alarm rather than as a job in perfect health.
 *
 * THE ANSWER IS A DURATION, NOT A FLAG. One stand-down is normal and clears
 * itself an hour later; the failure is a stand-down that never ends. So the
 * stamp also carries `standingDownSince` — the instant the CURRENT unbroken run
 * of stand-downs began, carried forward from the previous stamp and reset by
 * the first pass that actually runs. Without it every reader sees only "the
 * last pass stood down", which is indistinguishable at hour 1 and at hour 90.
 */
const BEAT_RAN = 'ran';
const BEAT_STOOD_DOWN = 'stood-down';

/**
 * AND A THIRD KIND, BECAUSE TWO WAS STILL A LIE (task 86bc3t0n1, round 2).
 *
 * `stood-down` was built for a usage limit, and a usage limit is a clock
 * running down: one is ordinary, and the alarm rightly waits out the role's own
 * window before calling it a failure. The outage this ticket is named after was
 * NOT that. At 02:08 on 2026-09-18 the Mini hit a real weekly limit; ten minutes
 * later the message became `Failed to authenticate: OAuth session expired and
 * could not be refreshed` and never changed again. The quota reset the next
 * evening on schedule and nothing improved, because by then the login was gone.
 *
 * A dead login is a locked door. It does not clear itself in an hour, or in
 * ninety — it clears when a human opens it. Filing that under `stood-down`
 * would mean waiting out a window before saying so, and the whole lesson of
 * those 90 hours is that a wait is the wrong response to it.
 *
 * So: `blocked` is a pass that fired, did no work, and named nothing that will
 * change on its own. **It alarms on the first one**, and the report says how
 * long it has been true — so a single crashed pass reads as "blocked since 4
 * minutes ago" and clears on the next working pass, while a dead login reads as
 * "blocked for 2 days" and keeps saying so. One line, both cases, no timer to
 * get wrong.
 */
const BEAT_BLOCKED = 'blocked';

/** The two kinds that mean "this pass did no work". Both carry a reason and a
 *  start instant; they differ in whether anything will change without a human. */
function isIdleKind(kind) {
  return kind === BEAT_STOOD_DOWN || kind === BEAT_BLOCKED;
}

/** Normalise anything read back off a stamp or a pushed row. A kind written
 *  before kinds existed reads as `ran` — which is what those passes were. */
function normalizeKind(kind) {
  const k = String(kind || BEAT_RAN);
  return isIdleKind(k) ? k : BEAT_RAN;
}

/** The kind as a verb phrase, for a sentence somebody reads. */
function kindWord(kind) {
  const k = normalizeKind(kind);
  if (k === BEAT_STOOD_DOWN) return 'stood down';
  if (k === BEAT_BLOCKED) return 'was blocked';
  return 'ran';
}

/**
 * When did this unbroken run of stand-downs begin?
 *
 * Pure, so the carry-forward rule is testable without a filesystem: the caller
 * hands over the PREVIOUS stamp (a `readBeat()` result) and what this pass is
 * recording, and gets back the instant to write plus a note when the answer had
 * to be started fresh.
 *
 * AN UNREADABLE PRIOR STAMP STARTS THE CLOCK OVER, AND SAYS SO. The alternative
 * — treating it as "standing down since forever" — would raise a 90-hour alarm
 * off a corrupt file, and an alarm that can fire on its own bookkeeping is an
 * alarm that gets ignored. Starting fresh costs at most one window of delay,
 * which is the cheaper mistake, and the note goes in the caller's output so the
 * delay is never a mystery.
 */
function standDownSince({ prior, kind, at } = {}) {
  const now = String(at || new Date().toISOString());
  if (!isIdleKind(kind)) return { since: '', note: '' };

  const p = prior || {};
  if (!p.readable) {
    return { since: now, note: 'the previous beat stamp could not be read, so this run of doing no work is counted as starting now' };
  }
  if (!p.found) return { since: now, note: '' };

  // THE SAME KIND, not merely "also idle". A lane that stood down on a limit
  // and is now blocked on a dead login has started a NEW condition — carrying
  // the limit's start instant into it would date the login failure to before it
  // happened, which is precisely what 2026-09-18 looked like from the outside.
  const priorBeat = p.beat || {};
  if (normalizeKind(priorBeat.kind) !== kind) return { since: now, note: '' };

  const carried = String(priorBeat.standingDownSince || '').trim();
  if (!carried || !Number.isFinite(Date.parse(carried))) {
    return {
      since: now,
      note: 'the previous beat recorded no readable start instant, so this one is counted as starting now',
    };
  }
  return { since: carried, note: '' };
}

/**
 * Record a run locally. Best effort by design: a job must never
 * fail because its own bookkeeping could not be written, so this reports
 * rather than throws.
 *
 * `kind` defaults to `ran`, so every existing caller keeps its exact meaning
 * and every stamp written before this existed reads back as a real run — which
 * is what those passes were.
 */
function recordBeat({
  role, node, at, kind = BEAT_RAN, why = '', standingDownSince: since = '',
  homedir = os.homedir(), write = fs,
} = {}) {
  const beat = { role: String(role), node: String(node || ''), at: at || new Date().toISOString() };
  beat.kind = normalizeKind(kind);
  if (isIdleKind(beat.kind)) {
    beat.why = String(why || '').trim() || 'no reason was recorded';
    beat.standingDownSince = String(since || '').trim() || beat.at;
  }
  try {
    write.mkdirSync(heartbeatDir(homedir), { recursive: true });
    write.writeFileSync(beatFile(role, homedir), `${JSON.stringify(beat, null, 2)}\n`);
    return { ok: true, beat };
  } catch (err) {
    return { ok: false, beat, why: String(err && err.message) };
  }
}

/**
 * The last local beat for a role.
 *
 * A missing file and an unreadable one are DIFFERENT answers. "Never beat" is
 * a fact; "the file is corrupt" is a thing we could not read, and rendering
 * the second as the first would send somebody hunting a schedule that is fine.
 */
function readBeat({ role, homedir = os.homedir(), read = fs } = {}) {
  const file = beatFile(role, homedir);
  let raw;
  try {
    raw = read.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { found: false, readable: true, file };
    return { found: false, readable: false, file, why: String(err && err.message) };
  }
  try {
    const beat = JSON.parse(raw);
    if (!beat || typeof beat.at !== 'string') {
      return { found: false, readable: false, file, why: 'the stamp has no `at` instant' };
    }
    return { found: true, readable: true, file, beat };
  } catch (err) {
    return { found: false, readable: false, file, why: `the stamp is not JSON — ${String(err && err.message)}` };
  }
}

// --- the shared surface -----------------------------------------------------

/**
 * The roll call's real identity is its NAME, exactly as the pause switch's is
 * (scripts/builder/pipelinePauseStore.js). An id in an env var is a shortcut,
 * never the definition — a shortcut that points at a deleted task must fall
 * back to the name rather than report the whole roll call missing.
 */
const ROLL_CALL_TASK_NAME = 'Node roll call';

const BEGIN = '<!-- roll-call:data -->';
const END = '<!-- /roll-call:data -->';

/**
 * How long a role may go without a beat before it is OVERDUE.
 *
 * WHY THIS IS PER-ROLE AND DERIVED, NOT ONE NUMBER FOR EVERY JOB
 * It used to be a flat 25 hours for everything. That works for a job that runs
 * every ten minutes and it CANNOT work for a job that runs once a day or once
 * a week, because such a job's honest beats legitimately land further apart
 * than the window — so the roll call reads a perfectly healthy job as dead.
 * That is not a hypothetical: it is already the written reason `weekly-report`
 * sits in the NOT_REPORTING column below rather than emitting a beat.
 *
 * THE ARITHMETIC, term by term.
 * A reader of the shared row sees an age made of two things, because the push
 * is throttled (PUSH_EVERY_MS) and the push RIDES ON A RUN — it is not a timer
 * of its own. So after the 24-hour push slot opens, the row is not refreshed
 * until the role's next run, which is at most one interval later:
 *
 *   window = PUSH_EVERY_MS + max(intervalMs, OVERDUE_SLACK_MS)
 *            ^ the row can be this stale while perfectly healthy
 *                             ^ plus one more run, because the push rides on one
 *
 * The `max` is where drift is bought. A role that runs OFTENER than the slack
 * is covered by the slack instead of by its own interval: an hour is far more
 * than the few minutes a launchd job wanders by, and it is what these four
 * roles have been measured against for weeks. A role SLOWER than the slack has
 * an interval so much larger than any plausible drift that adding a further
 * term would be decoration.
 *
 * WHAT THAT GIVES, AND WHY NOTHING MOVES TODAY
 * Every role currently declaring a cadence runs hourly or oftener, so the slack
 * term wins for all four and each keeps the exact 25 hours it has always had:
 *
 *   bus-relay        24h + max(10m, 1h) = 25h   (unchanged)
 *   pipeline-pulse   24h + max( 1h, 1h) = 25h   (unchanged)
 *   loop-build       24h + max( 1h, 1h) = 25h   (unchanged)
 *   loop-review      24h + max( 1h, 1h) = 25h   (unchanged)
 *   a daily role     24h + max(24h, 1h) = 48h   (the case this slice unblocks)
 *   a weekly role    24h + max( 7d, 1h) = 8d
 *
 * That is the property worth having: this is a widening no existing role can
 * feel, which is why it can be adopted everywhere at once without a single
 * verdict changing. `nodeHeartbeat.test.js` asserts all four, so a future edit
 * that quietly loosens `bus-relay` fails rather than shipping.
 *
 * OVERDUE_AFTER_MS is the FLOOR, for a role that declares no cadence at all —
 * a role this system cannot size must not become unmeasurable. It is no longer
 * a number somebody liked: it falls out of the same formula with the interval
 * term absent, which is why it is still exactly 25 hours.
 */
const PUSH_EVERY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_SLACK_MS = 60 * 60 * 1000;
const OVERDUE_AFTER_MS = PUSH_EVERY_MS + OVERDUE_SLACK_MS;

/** One post per role per 6 hours, matching the failure alert's suppression. */
const REPOST_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * THE RECENCY ALARM — a second, different question from the two above.
 *
 * The roll call asks "has this machine's row gone stale on the SHARED
 * surface", and it answers at DAY resolution because the shared row is pushed
 * at most once a day. That is the right resolution for the case it exists for
 * (a machine switched off, read by the other machine) and it is useless for
 * the case that cost 16 hours on 2026-09-03: the Mini was awake, the schedule
 * was loaded, and the job was simply not working. Nothing asked "when did this
 * last actually beat, HERE, on this machine?" — a question the local stamp has
 * always been able to answer precisely and for free (task 86bbugeda).
 *
 * WHY THE THRESHOLD IS PER-ROLE AND DERIVED, NOT A NUMBER SOMEBODY LIKED
 * The ticket proposed one hour. One hour is not survivable, and the numbers say
 * so — measured on the Mini's own logs on 2026-09-04, over 14 days of real
 * runs, as beat-to-beat gaps, which is what this alarm actually sees:
 *
 *   role              beats   median    p90     p95     p99     max
 *   bus-relay           802    0.17h   1.00h   1.00h   1.20h   4.51h
 *   pipeline-pulse       40    1.00h   1.01h   1.02h   1.02h   1.02h
 *   loop-build         1102    0.25h   1.00h   1.21h   1.55h   6.75h
 *   loop-review         630    0.11h   1.16h   1.26h   1.50h   3.37h
 *
 * A one-hour threshold sits ON the p90 of two roles: it would have fired on
 * roughly one interval in ten, for jobs that were working perfectly. That is
 * the alarm this project already killed once, on 2026-09-02, for going off on
 * eleven nights in fourteen — and an alarm nobody reads is worse than no alarm,
 * because it launders the real one too.
 *
 * The largest LEGITIMATE gaps are not blips at all, which is the finding that
 * fixes the threshold. loop-review's 3.37h on 2026-09-02 was the runner doing
 * exactly as designed: it hit a session limit that stated its own reset time,
 * and slept 10,380 seconds waiting for it (scripts/loop_runner_delay.mjs).
 * Nine such sleeps are in the logs, the longest 2.88h, and the session window
 * they wait out is five hours — so a threshold under about five hours would
 * eventually alarm on the runner's own correct behaviour.
 *
 * Hence ONE rule applied to every role, rather than a column of hand-picked
 * numbers: six missed runs, and never tighter than three hours.
 *
 *   bus-relay        6 x 10m =  1h -> floored to 3h   (2.5x its measured p99)
 *   pipeline-pulse   6 x  1h =  6h                    (5.9x its measured max)
 *   loop-build       6 x  1h =  6h                    (3.9x its measured p99)
 *   loop-review      6 x  1h =  6h                    (4.0x its measured p99)
 *
 * The floor is what protects the fast job: six missed relay passes is one hour,
 * and an hour is well inside that role's own ordinary tail. Six hours is not
 * "audible within the hour" — it is the tightest number these measurements
 * permit, and it turns the 16-hour silence this alarm was written for into at
 * most six.
 */
const QUIET_AFTER_MISSES = 6;
const MIN_QUIET_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * How often a job that STAYS quiet is repeated. Deliberately coarser than the
 * six-hour flapping throttle it sits beside: a dead job is dead, and saying so
 * on the same cadence as a failing one would only double every message.
 */
const STALE_REPOST_EVERY_MS = 12 * 60 * 60 * 1000;

/**
 * The roles that are EXPECTED to beat.
 *
 * Deliberately not "every role in lib/nodeRoles.js". `db-refresh` has no
 * schedule on purpose and a beat from it would mean nothing. Listing such a
 * role here as expected would produce a permanent false alarm; omitting it
 * silently would report a partially instrumented system as fully healthy.
 *
 * Two roles have graduated out of the not-reporting column, and the shape was
 * the same both times — the stated reason turned out to be a missing runner
 * rather than an impossibility, and it stopped being missing. The loop lanes
 * on 2026-09-02, when the runner joined this repo (task 86bbtuje2); the two
 * Pulse pipelines on 2026-09-12, when pulse grew an emitter of its own
 * (task 86bbw9nbj). A reason in this column is a thing to revisit, not a
 * verdict.
 *
 * So they are neither: `rollCallReport` reports an unlisted role as NOT
 * REPORTING, with the reason, every time.
 */
const BEAT_EMITTERS = {
  'bus-relay': {
    intervalMs: 10 * 60 * 1000,
    beatMeans: 'success',
    why: 'Runs on a launchd schedule every 10 minutes; scripts/run_bus_relay.sh records the beat.',
  },
  'loop-build': {
    // Graduated from NOT_REPORTING_WHY on 2026-09-02 (task 86bbtuje2), the day
    // the runner joined the repo. The cadence arithmetic that makes this
    // honest: a pass fires at most an hour apart (the pacing curve's ceiling,
    // scripts/builder/loopInterval.js), and the beat is recorded after EVERY
    // pass — liveness of the runner, deliberately not quality of the pass,
    // which is throughput's question — so a healthy loop beats dozens of
    // times inside the 25-hour overdue window and a dead one is named within
    // a day.
    intervalMs: 60 * 60 * 1000,
    beatMeans: 'liveness',
    why: 'Kept alive by launchd (scripts/install_loop_runner.sh); scripts/loop_runner.sh records '
      + 'a beat after every pass, whatever the pass concluded.',
  },
  'loop-review': {
    intervalMs: 60 * 60 * 1000,
    beatMeans: 'liveness',
    why: 'Same runner, own agent: scripts/loop_runner.sh records a beat after every review pass.',
  },
  'pipeline-pulse': {
    // A REAL emitter rather than a stated reason, and the cadence is what makes
    // that honest: it runs hourly, pushes its shared row at most once a day
    // (PUSH_EVERY_MS), and the overdue window below is 25 hours — so a healthy
    // pulse can never read as overdue, and one that stops is named within a
    // day. That arithmetic is the check `weekly-report` fails, which is why
    // that one is still a stated reason and this one is not.
    //
    // It is also load-bearing rather than decorative. This job is the one
    // watchdog with no free vantage point: the heartbeat and throughput checks
    // ride the relay's wake so they run on the machine that does NOT own what
    // they watch, and pipeline-pulse has its own schedule instead. Its beat is
    // what lets the roll call answer "is the Mini dead?" on its behalf. Remove
    // it and the hole reopens silently.
    intervalMs: 60 * 60 * 1000,
    beatMeans: 'success',
    why: 'Runs on a launchd schedule every hour; scripts/pulse_publish.mjs records the beat as its '
      + 'last act, and only on a pass that actually completed.',
  },
  // THE TWO PULSE PIPELINES (task 86bbw9nbj). They were a single
  // `pulse-pipelines` row in the NOT_REPORTING column until 2026-09-12, on the
  // reason "lives in the pulse repo; its runner is not in this checkout" —
  // true, and not a reason it cannot beat. On 2026-09-04 Pulse ran out of
  // Anthropic credit and both of these were dead for 33 hours, 127 skipped
  // runs, found by accident. The time before that was 820 failed runs over
  // twelve days, also found by accident.
  //
  // THE EMITTER IS IN THE OTHER REPO, AND THAT IS THE POINT. pulse's
  // bin/heartbeat-beat.py writes the same bytes to the same path recordBeat()
  // writes, so this repo reads its stamps without pulse needing a credential, a
  // network call or a Doppler dependency inside an unattended pipeline runner
  // (pulse design rule 1). It writes ONLY the local stamp; getting that stamp
  // to the shared roll-call row is `rollCallPushPlan` below.
  //
  // WHY TWO ROWS AND NOT ONE. The cadences are two orders of magnitude apart,
  // and every window in this file is derived from the cadence — one shared row
  // could only carry one of them, and whichever it carried would libel the
  // other. That is the whole of the objection the old single row could not
  // answer.
  'channel-steward': {
    intervalMs: 15 * 60 * 1000,
    beatMeans: 'success',
    why: 'Runs on a launchd schedule every 15 minutes (pulse launchd/com.danechristensen.pulse.'
      + 'channel-steward.plist, StartInterval 900); pulse bin/run-pipeline.sh records the beat '
      + 'wherever it clears the failure alarm and nowhere else, so a run whose report failed to '
      + 'deliver does NOT beat.',
  },
  'librarian-sweep': {
    // 24h, so this is the FIRST role in this file whose shared window (48h) is
    // TIGHTER than its local one (6 days: six missed runs of a daily job). That
    // inversion looks wrong and is not — the two checks read different surfaces,
    // and the arithmetic for each is independent of the other. It is called out
    // here because the usual relationship is the reverse, and a future reader
    // comparing the two numbers would otherwise reasonably suspect a bug.
    intervalMs: 24 * 60 * 60 * 1000,
    beatMeans: 'success',
    why: 'Runs on a launchd schedule once a day (pulse launchd/com.danechristensen.pulse.'
      + 'librarian-sweep.plist, StartInterval 86400); same runner and same beat rule as '
      + 'channel-steward. Its own gate skips a vault that has not moved, but it carries a seven-day '
      + 'heartbeat of its own so a permanently-shut gate still produces runs — and a skipped run is '
      + 'a successful run, so it still beats.',
  },
};

const NOT_REPORTING_WHY = {
  'db-refresh': 'Has no schedule on purpose — it spends production disk IO and wants a person nearby. '
    + 'Nothing to be silent about.',
  'youtube-media': 'Nothing has been installed to beat from yet — the launchd job, its shared secret and '
    + 'the Settings > APIs record are all slice 4 (86bbjve6q), which is the operator\'s hands. It is also '
    + 'the one role here that is a SERVICE rather than a scheduled pass: it succeeds by answering a '
    + 'request, so "when did it last succeed" is really "is it up", which GET /health answers directly. '
    + 'It gets an emitter when something is scheduled to ask that question on a timer.',
  // UNBLOCKED as of 2026-09-08 (task 86bbw9n9f) — the roll call now sizes each
  // role's overdue window from that role's own cadence, so a weekly job that
  // beats honestly reads as BEATING rather than as overdue six days in seven.
  // That was the whole of the objection, and it no longer holds. Switching this
  // role on is deliberately NOT part of that ticket: a role that starts beating
  // is a behaviour change and deserves its own break-test, and this one still
  // has no schedule installed either.
  'weekly-report': 'Runs once a WEEK. The roll call\'s one-window-fits-all objection is gone — as of '
    + '2026-09-08 each role is judged against its own cadence, so a weekly beat would read as healthy. '
    + 'It has a committed runner (scripts/run_weekly_report.sh) and could emit; what is left is turning '
    + 'the emitter on, which is its own ticket, and installing its schedule, which has never been done.',
};

// --- reading and writing the roll call's payload ----------------------------

/**
 * Pull the machine-readable rows out of a task description.
 *
 * The JSON block is the ONLY thing parsed. The human-readable table rendered
 * beside it is generated from these rows on every write and never read back —
 * the same rule the rest of this repo applies to generated files, for the same
 * reason: two representations that can be edited independently are two
 * answers, and they disagree quietly.
 *
 * An absent block on a description that plainly exists is an EMPTY roll call,
 * which is a real state (nobody has beaten yet).
 *
 * An EMPTY description is NOT that, and the difference was found by driving
 * this against the live API (2026-08-31): ClickUp answers a GET with
 * `markdown_description: ""` even for a task whose description it is holding
 * perfectly well, the content arriving under `description` instead. A parser
 * that read that empty string as "an empty roll call" would report every job
 * in the system as having gone quiet, all at once, off a field that simply was
 * not populated — a false-alarm storm, which is this feature's own failure
 * mode. Every roll call we write carries a preamble, so a roll call with no
 * text at all is something we could not read.
 */
function parseRollCall(description) {
  const text = String(description == null ? '' : description);
  if (!text.trim()) {
    return { parsed: false, rows: [], why: 'the roll call has no description text at all — nothing was read' };
  }
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return { parsed: true, rows: [] };
  const inner = text.slice(start + BEGIN.length, end);
  const fenced = inner.match(/```(?:json)?\s*([\s\S]*?)```/);
  const payload = (fenced ? fenced[1] : inner).trim();
  if (!payload) return { parsed: true, rows: [] };
  try {
    const data = JSON.parse(payload);
    const rows = Array.isArray(data) ? data : (Array.isArray(data && data.rows) ? data.rows : null);
    if (!rows) return { parsed: false, rows: [], why: 'the roll-call block is JSON but not a list of rows' };
    return { parsed: true, rows: rows.filter((r) => r && r.node && r.role && r.at) };
  } catch (err) {
    // NOT an empty roll call. A corrupt block means we do not know when
    // anything last ran, and reporting that as "no beats yet" would be a
    // confident wrong answer about every machine at once.
    return { parsed: false, rows: [], why: `the roll-call block is not JSON — ${String(err && err.message)}` };
  }
}

/** One row per (node, role). A newer beat replaces an older one; nothing else moves. */
function mergeRollCall(existing, incoming) {
  const key = (r) => `${String(r.node).toLowerCase()}::${String(r.role).toLowerCase()}`;
  const out = new Map();
  for (const row of existing || []) out.set(key(row), row);
  for (const row of incoming || []) {
    const prior = out.get(key(row));
    // Never move a row BACKWARDS. Two machines write this description, and a
    // read-modify-write can race; losing the newer beat would invent a silence
    // that never happened.
    if (prior && Date.parse(prior.at) >= Date.parse(row.at)) continue;
    out.set(key(row), row);
  }
  return [...out.values()].sort((a, b) => (`${a.node}${a.role}`).localeCompare(`${b.node}${b.role}`));
}

/**
 * The same number said as a LENGTH rather than as an age.
 *
 * `ageText` bakes "ago" in, which is right for "last succeeded 3h ago" and
 * wrong for "standing down for 3h" and for every window this file quotes. Three
 * call sites were already stripping the suffix with a regex; this is that, once,
 * with a name.
 */
function durationText(ms) {
  return ageText(ms).replace(/ ago$/, '');
}

/** Whole-hours-and-minutes age, for a human reading a table. */
function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'in the future (check the clocks)';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

/**
 * The table cell that keeps a working pass apart from a stood-down one.
 *
 * A row written before beats carried a kind has none, and reads as `ran` —
 * correct, because that is what those passes were.
 */
function standDownCell(row, now) {
  const kind = normalizeKind(row && row.kind);
  if (!isIdleKind(kind)) return 'ran';
  const sinceMs = Date.parse(String((row && row.standingDownSince) || row.at || ''));
  const forText = Number.isFinite(sinceMs) ? durationText(now - sinceMs) : 'an unknown length of time';
  const why = (row && row.why) || 'no reason recorded';
  if (kind === BEAT_BLOCKED) {
    return `**BLOCKED — needs a human** — no work for ${forText} (${why})`;
  }
  return `**stood down** — nothing claimed for ${forText} (${why})`;
}

/**
 * The whole description, rebuilt. Prose first for a person who opens the task,
 * then the generated table, then the data block the machines read.
 */
function renderRollCall(rows, { now = Date.now() } = {}) {
  const sorted = mergeRollCall([], rows);
  const table = sorted.length === 0
    ? '_No beats recorded yet._'
    : [
      '| node | role | last beat (UTC) | age | what that pass did |',
      '| --- | --- | --- | --- | --- |',
      ...sorted.map((r) => `| ${r.node} | ${r.role} | ${r.at} | ${ageText(now - Date.parse(r.at))} | ${standDownCell(r, now)} |`),
    ].join('\n');

  return [
    `The **${ROLL_CALL_TASK_NAME}**. Do not build this, do not close it, do not delete it.`,
    '',
    'Each row is the last time a scheduled job on that machine finished. The last column says what that',
    'pass DID, and there are three answers. **ran** — it did its work. **stood down** — it fired, found it',
    'could not work (a usage limit) and exited cleanly; that clears itself when the limit resets.',
    '**BLOCKED** — it fired, did no work, and the reason will not clear on its own: an expired login, most',
    'often. That last one needs a human at the machine, so it is reported the first time it happens rather',
    'than after a waiting period.',
    '',
    'All three beat like any other pass, so without that column 90 hours of doing nothing reads as 90 hours',
    'of perfect health; it did, from 2026-09-16 to 2026-09-19 — a usage limit for the first few hours and',
    'an expired OAuth login for the remaining three days. A job that fails posts to the bus on its own;',
    'this ticket is for the other half — a job that stops firing writes nothing anywhere, and nothing looks',
    'exactly like a quiet week.',
    '',
    'Whichever machine is awake reads this and posts to the bus when a row goes stale, so the check',
    'survives the machine it is checking being switched off. Read it in plain English with',
    '`npm run heartbeat` (`npm run heartbeat -- --check` also posts).',
    '',
    'Rows are pushed at most once a day. How stale a row may get before it is reported as overdue depends on'
    + ' how often that job runs — a day plus one of its own runs — so a job that runs hourly is overdue after'
    + ` ${Math.round(OVERDUE_AFTER_MS / 3600000)} hours and a daily job is not overdue until it has missed a whole day on top of that.`,
    '',
    '### Last successful run',
    '',
    '_Generated from the block below on every write — edit neither; the next push overwrites both._',
    '',
    table,
    '',
    BEGIN,
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
    END,
    '',
  ].join('\n');
}

// --- the verdict ------------------------------------------------------------

/**
 * What the roll call says, as a decision rather than a printout.
 *
 * `readable: false` is the caller's cue to say CANNOT TELL and post nothing.
 * A watchdog that treats an unreachable ClickUp as "no overdue rows" is a
 * watchdog that goes quiet at exactly the moment the infrastructure is sick —
 * the fail-open shape `pipelinePause.js` was written against.
 */
function rollCallReport({
  readable = true, why = '', rows = [], now = Date.now(), roles = nodeRoles.ROLES, emitters = BEAT_EMITTERS,
} = {}) {
  if (!readable) {
    return {
      readable: false, why, beating: [], overdue: [], stoodDown: [], blocked: [], notReporting: [], silent: false,
    };
  }

  const beating = [];
  const overdue = [];
  // FOUR BUCKETS, NOT THREE (task 86bc3t0n1). A stood-down role is neither
  // BEATING — it did nothing — nor OVERDUE, because its runner is demonstrably
  // alive and firing on time. Folding it into either one is a wrong fact: the
  // first is what let 90 hours of dead pipeline read as healthy, and the second
  // would send somebody hunting a schedule that is working perfectly.
  const stoodDown = [];
  // FIVE BUCKETS NOW (round 2). `blocked` is split out of `stoodDown` because
  // the two want opposite responses: one is waited out, the other is carried to
  // a human. Folding them together would mean a dead login sat inside a bucket
  // whose whole design is "one of these is ordinary".
  const blocked = [];
  const notReporting = [];

  for (const role of Object.keys(roles)) {
    const owner = roles[role] && roles[role].owner;
    if (!emitters[role]) {
      notReporting.push({
        role,
        owner,
        why: NOT_REPORTING_WHY[role] || 'No beat emitter is registered for this role in lib/nodeHeartbeat.js.',
      });
      continue;
    }
    // Only the OWNER's row counts. A stale row left behind by a machine that
    // used to own the job is a cutover artefact, not a heartbeat, and treating
    // it as one would report a job as healthy on the strength of a beat from a
    // machine that has not run it for weeks.
    const row = rows.find(
      (r) => String(r.role).toLowerCase() === role && String(r.node).toLowerCase() === String(owner).toLowerCase(),
    );
    if (!row) {
      // NEVER BEATEN IS NOT THE SAME FAILURE AS STOPPED BEATING, and until
      // 2026-09-12 both rendered with the same sentence — "a job that stops
      // firing writes nothing anywhere. This is that." — which is simply untrue
      // of a role that has not stopped anything. It is flagged rather than
      // demoted: it stays in `overdue` and still reaches the bus, because a role
      // expected to beat that never has is genuinely not healthy. What changes
      // is that the message says which of the two it is, so the reader knows
      // whether to look for a dead job or for an emitter that was switched on
      // before its job next ran.
      //
      // Found by rehearsing this on the machine rather than by reading it: the
      // day `librarian-sweep` was named here, it had a perfectly healthy daily
      // schedule and no stamp yet, and the roll call called it a job that had
      // stopped firing. Every future emitter graduation has the same day-one
      // window (task 86bbw9nbj).
      overdue.push({
        role, owner, at: null, ageMs: null, overdueAfterMs: overdueAfterFor(role, emitters),
        neverBeaten: true,
        reason: 'no beat has ever been recorded',
      });
      continue;
    }
    // The window is this ROLE's, not one number for the whole system — see
    // OVERDUE_AFTER_MS. It is named in the reason because "last succeeded 30
    // hours ago" is not a verdict on its own: 30 hours is dead for the relay
    // and perfectly healthy for a daily job, and a reader cannot tell which
    // without being told what it was measured against.
    const overdueAfterMs = overdueAfterFor(role, emitters);
    const ageMs = now - Date.parse(row.at);
    if (!Number.isFinite(ageMs)) {
      overdue.push({
        role, owner, at: row.at, ageMs: null, overdueAfterMs, reason: 'its recorded time cannot be read as a date',
      });
    } else if (ageMs > overdueAfterMs) {
      overdue.push({
        role,
        owner,
        at: row.at,
        ageMs,
        overdueAfterMs,
        reason: `last succeeded ${ageText(ageMs)}, and this role is overdue after ${ageText(overdueAfterMs)}`,
      });
    } else if (normalizeKind(row.kind) === BEAT_BLOCKED) {
      // ALARMING FROM THE FIRST ONE, and never window-gated. The row is FRESH —
      // the runner fired — and the pass could not work for a reason that will
      // not change on its own. Waiting out a window before saying so is exactly
      // what turned an expired login into 90 hours of green screens. The
      // duration is still reported, so a one-off crash reads as minutes and
      // clears on the next working pass.
      const sinceAt = String(row.standingDownSince || row.at || '');
      const sinceMs = Date.parse(sinceAt);
      const forMs = Number.isFinite(sinceMs) ? now - sinceMs : null;
      const why = String(row.why || '').trim() || 'no reason was recorded';
      blocked.push({
        role,
        owner,
        at: row.at,
        ageMs,
        overdueAfterMs,
        since: sinceAt,
        forMs,
        alarming: true,
        why,
        reason: forMs === null
          ? `its last pass did no work and could not say when that started ("${sinceAt || '(nothing)'}" `
            + `does not read as a date) — and the cause named will not clear on its own (${why})`
          : `it has fired and done no work for ${durationText(forMs)}, and the cause will not clear `
            + `on its own (${why})`,
      });
    } else if (normalizeKind(row.kind) === BEAT_STOOD_DOWN) {
      // The row is FRESH — the runner fired recently — and the pass it recorded
      // did no work. How long that has been true is the whole question, and it
      // is measured against this role's own window: one stand-down is ordinary
      // and clears itself; one that has outlasted the window the roll call
      // already uses for silence is the 90-hour outage.
      const sinceAt = String(row.standingDownSince || row.at || '');
      const sinceMs = Date.parse(sinceAt);
      const forMs = Number.isFinite(sinceMs) ? now - sinceMs : null;
      const why = String(row.why || '').trim() || 'no reason was recorded';
      // A start instant that cannot be read ALARMS rather than passing. The
      // duration is the only thing standing between this and a job that has
      // been dead for days, so an unreadable one is a reading we could not
      // take, and this file's rule is that those never render as healthy.
      const alarming = forMs === null || forMs > overdueAfterMs;
      stoodDown.push({
        role,
        owner,
        at: row.at,
        ageMs,
        overdueAfterMs,
        since: sinceAt,
        forMs,
        alarming,
        why,
        reason: forMs === null
          ? `its last pass stood down (${why}), and the instant that stand-down began reads as `
            + `"${sinceAt || '(nothing)'}", which cannot be read as a date — so how long this has been going on cannot be told`
          : `it has fired and claimed nothing for ${durationText(forMs)} (${why})`
            + (alarming
              ? `, which is longer than the ${durationText(overdueAfterMs)} this role is judged against`
              : `, within the ${durationText(overdueAfterMs)} this role is judged against`),
      });
    } else {
      beating.push({ role, owner, at: row.at, ageMs, overdueAfterMs });
    }
  }

  const alarmingStandDowns = stoodDown.filter((s) => s.alarming);
  return {
    readable: true,
    why: '',
    beating,
    overdue,
    stoodDown,
    blocked,
    notReporting,
    silent: overdue.length > 0 || alarmingStandDowns.length > 0 || blocked.length > 0,
  };
}

// --- relaying a local stamp onto the shared row -----------------------------

/**
 * "Which of this machine's local stamps are not on the shared roll call yet?"
 *
 * WHY THIS EXISTS (task 86bbw9nbj, and it is the half the Pulse slice
 * deliberately left here).
 * `doBeat` pushes the shared row for the role that has just beaten, which works
 * for every job whose runner lives in THIS repo and calls it. The two Pulse
 * pipelines do not: their runner is in another repo and writes only the local
 * stamp, on purpose — a beat that needs Doppler, a ClickUp token and a network
 * round trip inside an unattended pipeline runner is a beat that goes missing on
 * exactly the bad night it exists for (pulse design rule 1). So something on
 * this side has to carry the stamp the rest of the way, or `rollCallReport`
 * reads the shared row, finds nothing, and calls a healthy job overdue.
 *
 * ONE GENERAL RULE, NOT A SPECIAL CASE FOR PULSE. Push the local stamp of any
 * role this machine owns whose stamp is newer than its last push. Written
 * generally because the special case is not actually special: a role whose own
 * emitter could not reach ClickUp — the network was down, the token had
 * rotated, the budget reserve had been hit — is in precisely the same position,
 * and until now its row simply stayed stale until the next daily slot happened
 * to coincide with a working call.
 *
 * THE PUSHED INSTANT IS THE STAMP'S, NEVER THE CLOCK. This is the property that
 * makes the whole mechanism safe: relaying can only ever report when a job last
 * actually ran, so a relay firing every ten minutes over a job that died on
 * Tuesday cannot make it look alive. A version that stamped `now` would have
 * silenced this feature's own alarm permanently, which is worse than not
 * building it.
 *
 * FOUR ANSWERS, NEVER TWO (docs/DOCTRINE.md §3.11). `unknown` is the one that
 * matters: a stamp that cannot be read is not a job that has not beaten, and
 * "never beaten here" is already the roll call's own business — it reports
 * exactly that as overdue — so relaying nothing for it is right and saying so
 * is how a reader can tell that apart from a bug.
 *
 * Pure, like everything else in this file: `beat` is a `readBeat()` result and
 * `lastPushAt` is whatever the caller's push stamp says. The IO is in
 * `scripts/node_heartbeat.mjs`.
 */
function rollCallPushPlan({ entries = [], now = Date.now(), everyMs = PUSH_EVERY_MS } = {}) {
  const push = [];
  const held = [];
  const unknown = [];

  for (const entry of entries) {
    const role = String((entry && entry.role) || '').trim().toLowerCase();
    const beat = (entry && entry.beat) || {};
    const lastPushAt = (entry && entry.lastPushAt) || '';
    const lastPushKind = String((entry && entry.lastPushKind) || '').trim();

    if (!beat.readable) {
      unknown.push({ role, why: `its local beat file could not be read — ${beat.why || 'no reason given'}` });
      continue;
    }
    if (!beat.found) {
      held.push({ role, why: 'it has never beaten on this machine, so there is nothing to relay — the roll call already reports that as overdue' });
      continue;
    }
    const at = beat.beat && beat.beat.at;
    const beatMs = Date.parse(at);
    if (!Number.isFinite(beatMs)) {
      unknown.push({ role, why: `its local beat records "${at}", which cannot be read as a date` });
      continue;
    }
    // A stamp from the FUTURE is a clock problem. Pushing it would park a row
    // ahead of real time and keep this role reading as fresh for as long as the
    // skew lasts — the same reasoning recencyReport applies, and the same
    // refusal.
    if (beatMs > now) {
      unknown.push({ role, why: `its local beat is dated ${at}, which is in the future — check the clock on this machine` });
      continue;
    }
    // ALREADY THERE. Pushing again would write the same instant back and cost a
    // ClickUp round trip a day, for ever, over a job that is not producing new
    // beats. Nothing would be falsified — the row keeps the stamp's own instant —
    // but a write that changes nothing is a write that should not happen.
    const pushedMs = Date.parse(lastPushAt);
    if (Number.isFinite(pushedMs) && pushedMs >= beatMs) {
      held.push({ role, why: 'its newest local beat is already on the roll call' });
      continue;
    }
    const kind = normalizeKind(beat.beat && beat.beat.kind);
    // `standDownWhy`, NOT `why`: every item in this plan already carries a `why`
    // that explains why it is being PUSHED, and reusing the name would have the
    // push reason relayed onto the shared row as the reason the job stood down.
    // Caught by the caller spreading one into the other.
    const row = {
      role,
      at,
      kind,
      ...(isIdleKind(kind)
        ? {
          standDownWhy: String((beat.beat && beat.beat.why) || '').trim() || 'no reason was recorded',
          standingDownSince: String((beat.beat && beat.beat.standingDownSince) || at),
        }
        : {}),
    };

    // A CHANGE OF KIND OUTRANKS THE THROTTLE (task 86bc3t0n1). The daily slot is
    // the right resolution for "when did this last run", which moves a little
    // every hour and matters at day scale. It is the wrong resolution for "this
    // job has stopped doing any work", which is a transition: held for a day, a
    // pipeline that went dead at 9am is reported dead the following morning, and
    // a pipeline that CAME BACK goes on reading as dead just as long. Both
    // directions, and at most two extra writes per outage.
    const kindChanged = Boolean(lastPushKind) && lastPushKind !== kind;

    // THE THROTTLE, unchanged from `doBeat`'s: at most one push per role per
    // day. It is what keeps this from being a ClickUp write every ten minutes
    // per role, and it is the resolution the shared row is documented at.
    if (!kindChanged && !dueAgain({ lastAt: lastPushAt, now, everyMs })) {
      held.push({ role, why: `its row was pushed within the last ${durationText(everyMs)}` });
      continue;
    }
    push.push({
      ...row,
      why: kindChanged
        ? `its last pass ${kindWord(kind)} where the pushed row says it ${kindWord(lastPushKind)} — a change of kind is pushed at once, not at the next daily slot`
        : (lastPushAt ? `its local beat (${at}) is newer than its last push (${lastPushAt})` : `its local beat (${at}) has never been pushed`),
    });
  }

  return { push, held, unknown };
}

/**
 * "Which of this machine's healthy jobs are sitting under an alarm that nobody
 * ever closed?"
 *
 * THE HOLE THIS FILLS (task 86bbw9nbj, round 1 send-back). Every alarm in this
 * system used to be closed in exactly one place: `--beat`, which a job calls on
 * its own successful run. That works for every role whose runner lives in this
 * repo, and it cannot work for the two Pulse pipelines — their runner is in
 * another repo and writes only the local stamp, deliberately. So the two roles
 * this feature exists to instrument were the only two that could raise an alarm
 * and never close it: quiet, then recovered, and nobody told. An alarm that
 * fires and never clears is the alarm fatigue this whole slice was written
 * against.
 *
 * THE STAMP IS CLOSED BY A SUCCESS THAT CAME AFTER IT, NEVER BY FRESHNESS
 * ALONE (round 2 send-back — the fix for round 1 caused this one). Round 2
 * cleared all three suppression stamps for every role in `recencyReport().fresh`,
 * and *fresh* means only "the newest beat is inside this role's threshold" —
 * up to three hours for `bus-relay`, six for the loops and the pulse. It does
 * not mean a run just succeeded. `failed-<role>` is the six-hour suppression
 * for the failure alert and `report_job_failure.mjs` states its contract in as
 * many words: cleared by the next SUCCESS, not by a timer. Clearing it off an
 * hours-old beat while the job is failing *right now* defeats that throttle —
 * and both steps run in one pass of `run_bus_relay.sh` (the closeout at line
 * 121, the failure report at line 265), so a failing relay would post roughly
 * eighteen times over three hours in place of once. `quiet-<role>` is the same
 * bug on the shared-row channel: `--check` writes it at line 98 and the
 * closeout removed it twenty-three lines later on the same wake.
 *
 * So the rule is one sentence, applied to all three stamps alike: AN ALARM IS
 * CLOSED ONLY BY A BEAT NEWER THAN THE ALARM ITSELF. One rule rather than three
 * special cases, because a per-stamp exception is a thing the next reader has
 * to re-derive — and re-deriving it is what produced this defect.
 *
 * For `stale-<role>` the new rule is provably the old one, which is why nothing
 * about the silence alarm changes: that stamp is written at the instant a role
 * was reported quiet, and a role is reported quiet only when its newest beat is
 * already older than its threshold. A beat that is fresh now is therefore
 * necessarily one recorded after the stamp. Stating it as the same comparison
 * costs nothing and removes the subtlety.
 *
 * TWO OUTPUTS PLUS TWO REFUSALS, BECAUSE THEY ARE DIFFERENT ACTS. `clear` is
 * bookkeeping — one entry per stamp actually removed. `announce` is the only
 * good news this system ever posts, and it is restricted to roles whose silence
 * ACTUALLY reached the bus, so a healthy job nobody ever reported posts nothing
 * here, ever. That is what keeps this from becoming the "all is well" x365 the
 * non-goals forbid.
 *
 * BOTH SILENCE CHANNELS ANNOUNCE, NOT ONLY `stale-` (task 86bbzzyxb). There are
 * two independent silence alarms with independently-derived windows, and each
 * writes its own stamp when a post actually goes out:
 *
 *   `stale-<role>` — the LOCAL recency alarm (`--stale-check --check`), which
 *                    fires at six missed runs with a three-hour floor.
 *   `quiet-<role>` — the SHARED-ROW watchdog (`--check`), which fires at the
 *                    roll call's own window, a day plus the role's cadence.
 *
 * This used to announce off `stale-` alone. For every role with a cadence of an
 * hour or less that is harmless, because the local window is the tighter of the
 * two, so `stale-` is always raised as well and the `quiet-` clear rides along
 * with it. `librarian-sweep` runs DAILY and inverts the pair — 48h shared
 * against 6 days local — so an outage landing between those two numbers was
 * reported to the bus as quiet, recovered, had its `quiet-` stamp cleared in
 * silence, and nobody was ever told it came back. That is precisely the shape of
 * the incident this feature was built for: the Pulse outage that started it ran
 * 33 hours, and the one before it was twelve days.
 *
 * ONE POST PER ROLE PER PASS, not one per stamp. A role whose two alarms both
 * clear on the same pass recovered once, and it is announced with the EARLIER
 * of the two instants — the moment its silence first reached the bus, which is
 * the number that tells the reader how long it was dark.
 *
 * `failed-<role>` is deliberately NOT in this set. It is raised by
 * scripts/report_job_failure.mjs for a job that ran and exited non-zero, which
 * is a different event from a silence, and `renderRecoveredPost` says "it was
 * reported quiet" in as many words. Closing it stays bookkeeping.
 * `keep` names an alarm deliberately left standing (no success since it was
 * raised) and `cannotTell` names one left standing because a date could not be
 * read — never folded together, because a cannot-tell that renders as a
 * decision is how a blind instrument reads as a working one.
 *
 * Pure. The caller passes each fresh role's beat instant and whatever its three
 * stamps say (absent or empty means no alarm); the stamp IO stays in
 * `scripts/node_heartbeat.mjs`, so exactly one file knows where those stamps
 * live (vault doctrine NODES, principle P1).
 */
function alarmCloseoutPlan({ fresh = [] } = {}) {
  const clear = [];
  const keep = [];
  const cannotTell = [];
  const announce = [];

  for (const entry of fresh) {
    const role = String((entry && (entry.role !== undefined ? entry.role : entry)) || '').trim().toLowerCase();
    if (!role) continue;

    const beatAt = String((entry && entry.beatAt) || '').trim();
    const beatMs = Date.parse(beatAt);
    const stamps = (entry && entry.stamps) || {};
    // WHAT THE CLOSING BEAT ACTUALLY DID. A stand-down still beats, so it is
    // rightly allowed to close the alarms that mean "this job stopped firing" —
    // it plainly has not stopped firing. It must NEVER close the one that means
    // "this job is doing no work", because it IS the thing that alarm is about.
    // Today the duration arithmetic makes that unreachable (a role still
    // standing down never reads as fresh), but a rule that holds only by luck of
    // another module's arithmetic is a rule waiting to be broken from a
    // distance. It is stated here, where the closing happens.
    const beatKind = normalizeKind(entry && entry.beatKind);

    // The instant this role's silence first reached the bus, across whichever
    // of the two silence stamps actually cleared on this pass. Collected rather
    // than announced inline because a role gets ONE post per pass however many
    // of its alarms close together.
    let announceSince = '';
    // Which announcing alarms closed, so the caller can say the right sentence.
    // A role can close both on one pass — it stopped beating, came back, stood
    // down, then worked — and "beating again" is the bigger claim of the two,
    // so a mixed close uses that one and a stand-down-only close uses its own.
    const announcedKinds = [];

    // Order matters only for the reader: the two silence channels either side
    // of `failed`, which is the one kind that never announces. `standdown` is a
    // fourth channel (task 86bc3t0n1) and it announces, because its alarm
    // promises in so many words that it clears when a pass does real work —
    // and the recovery is the half that went four days unbuilt last time
    // (86bbzzyxb).
    for (const kind of ['quiet', 'failed', 'stale', 'standdown']) {
      const raw = String((stamps && stamps[kind]) || '').trim();
      if (!raw) continue; // no alarm of this kind — the normal case, and silent.

      // A BLOCKED BEAT CLOSES IT NO MORE THAN A STAND-DOWN DOES (round 2). Both
      // are passes that did no work, and this alarm is about exactly that — a
      // beat that closed it would announce a recovery for a lane whose login is
      // still expired.
      if (kind === 'standdown' && isIdleKind(beatKind)) {
        keep.push({
          role,
          kind,
          why: `its newest beat ${kindWord(beatKind)}, and only a pass that does real work closes this alarm`,
        });
        continue;
      }

      if (!Number.isFinite(beatMs)) {
        cannotTell.push({ role, kind, why: `its beat records "${beatAt || '(nothing)'}", which cannot be read as a date, so this pass cannot say the alarm is stale` });
        continue;
      }
      const stampMs = Date.parse(raw);
      if (!Number.isFinite(stampMs)) {
        cannotTell.push({ role, kind, why: `the ${kind}-${role} stamp records "${raw}", which cannot be read as a date, so this pass cannot say the beat came after it` });
        continue;
      }
      if (beatMs <= stampMs) {
        keep.push({ role, kind, why: `its newest beat (${beatAt}) is not newer than the ${kind} alarm raised at ${raw} — nothing has succeeded since, so the alarm stands` });
        continue;
      }

      clear.push({ role, kind });
      if (kind === 'quiet' || kind === 'stale' || kind === 'standdown') {
        announcedKinds.push(kind);
        const soFar = Date.parse(announceSince);
        if (!announceSince || !Number.isFinite(soFar) || stampMs < soFar) announceSince = raw;
      }
    }

    if (announceSince) {
      announce.push({
        role,
        quietSince: announceSince,
        wasStandDown: announcedKinds.length > 0 && announcedKinds.every((k) => k === 'standdown'),
      });
    }
  }

  return { clear, keep, cannotTell, announce };
}

/**
 * The verdict for one `--push-owned` pass, as a pure function BECAUSE THE TWO
 * PATHS THROUGH IT ANSWERED THE SAME QUESTION DIFFERENTLY (task 86bbw9nbj,
 * round 1 send-back). The nothing-to-push path already returned 2 when a stamp
 * could not be read; the path that pushed something returned 0 unconditionally,
 * so an unreadable stamp was downgraded to a pass whenever some OTHER role
 * happened to push on the same wake. One function, one answer.
 *
 * TWO ANSWERS ONLY: 0 and 2 (scripts/ui/harness-exit.mjs). There is no 1 here —
 * this mode judges no job's health, it moves a fact from one surface to
 * another, and the judging belongs to `--check` and `--stale-check`.
 *
 * A MACHINE OWNING NO BEATING ROLE IS A 2, NOT A GREEN PASS. "Every local beat
 * this machine owns is already on the roll call" is vacuously true of zero
 * beats, and it is reachable — `macbook-pro` owns only `db-refresh`, which
 * records no beat on purpose. `recencyReport`'s caller already refuses to call
 * that an all-clear in the identical situation, and two different answers to
 * one question is exactly the drift that makes a board of green meaningless.
 */
function relayVerdict({ ownedEmitters = 0, pushed = 0, unknown = 0 } = {}) {
  if (ownedEmitters === 0) {
    return {
      exit: 2,
      reading: false,
      why: 'this machine owns no job that records a beat, so nothing could be relayed and nothing was measured',
    };
  }
  if (unknown > 0) {
    return {
      exit: 2,
      reading: false,
      why: `${unknown} local stamp${unknown === 1 ? '' : 's'} could not be read, so this pass cannot say every owned beat is on the roll call`,
    };
  }
  return {
    exit: 0,
    reading: true,
    why: pushed > 0
      ? `${pushed} beat${pushed === 1 ? '' : 's'} relayed, and every other owned beat was already there`
      : 'every local beat this machine owns is already on the shared roll call',
  };
}

// --- the recency alarm ------------------------------------------------------

/**
 * How long this role may go without a beat before it counts as quiet, or null
 * if the role has no declared cadence (which is not the same as "fine" — the
 * caller reports it as something it could not judge).
 *
 * ONE rule, not a column of numbers. See the QUIET_AFTER_MISSES comment for
 * the measurements that chose it, and why the ticket's proposed one hour is
 * not a threshold this system can carry.
 */
function quietAfterFor(role, emitters = BEAT_EMITTERS) {
  const entry = emitters[String(role || '').trim().toLowerCase()];
  if (!entry || !Number.isFinite(entry.intervalMs) || entry.intervalMs <= 0) return null;
  return Math.max(entry.intervalMs * QUIET_AFTER_MISSES, MIN_QUIET_AFTER_MS);
}

/**
 * How long THIS role may go without a beat on the SHARED roll call before it
 * is overdue. Never null: a role with no declared cadence gets the floor,
 * because a role this system cannot size must not become unmeasurable.
 *
 * The arithmetic and the measurements behind it are on OVERDUE_AFTER_MS above.
 * Note this is a different question from `quietAfterFor` and deliberately far
 * coarser: that one reads precise LOCAL stamps, this one reads a shared row
 * whose refresh is throttled to once a day.
 */
function overdueAfterFor(role, emitters = BEAT_EMITTERS) {
  const entry = emitters[String(role || '').trim().toLowerCase()];
  if (!entry || !Number.isFinite(entry.intervalMs) || entry.intervalMs <= 0) return OVERDUE_AFTER_MS;
  return PUSH_EVERY_MS + Math.max(entry.intervalMs, OVERDUE_SLACK_MS);
}

/**
 * "Is anything this machine owns not beating?" — decided from the LOCAL stamps,
 * which are written on every run and are therefore precise, unlike the shared
 * row this same module throttles to once a day.
 *
 * THIS IS A DIFFERENT CHECK FROM `rollCallReport`, ON PURPOSE, AND IT DOES NOT
 * REPLACE IT. The two see different failures and neither can see the other's:
 *
 *   rollCallReport   reads the SHARED surface, so it survives this machine
 *                    being switched off — and answers at day resolution.
 *   recencyReport    reads THIS machine's own stamps, so it is precise to the
 *                    minute — and sees nothing at all if this machine is off.
 *
 * The 2026-09-03 incident was the second shape: the Mini was awake, launchd
 * was firing, and the work was not happening. Sixteen hours.
 *
 * FOUR ANSWERS, NEVER TWO. `unknown` is the one that matters: a role with no
 * declared cadence, or one that has never beaten on this machine, is NOT
 * quiet and is NOT healthy — it is something this check cannot judge, and
 * saying so is the whole of DOCTRINE 3.11. "Never beaten here" in particular
 * is already the roll call's business (it reports exactly that as overdue), so
 * duplicating it would post twice about one silence.
 *
 * Entries are supplied by the caller — `{ role, owner, beat }` where `beat` is
 * a `readBeat()` result — because reading files is IO and this module holds no
 * IO by design.
 */
function recencyReport({ entries = [], now = Date.now(), emitters = BEAT_EMITTERS } = {}) {
  const quiet = [];
  const fresh = [];
  const unknown = [];

  for (const entry of entries) {
    const role = String((entry && entry.role) || '').trim().toLowerCase();
    const owner = (entry && entry.owner) || '';
    const beat = (entry && entry.beat) || {};
    const thresholdMs = quietAfterFor(role, emitters);
    const beatMeans = (emitters[role] && emitters[role].beatMeans) || 'success';

    if (thresholdMs === null) {
      unknown.push({ role, owner, why: 'no run interval is declared for this role in lib/nodeHeartbeat.js, so there is no threshold to judge it against' });
      continue;
    }
    if (!beat.readable) {
      unknown.push({ role, owner, why: `its local beat file could not be read — ${beat.why || 'no reason given'}` });
      continue;
    }
    if (!beat.found) {
      unknown.push({ role, owner, why: 'it has never beaten on this machine, which the roll call already reports as overdue — not counted twice here' });
      continue;
    }
    const at = beat.beat && beat.beat.at;
    const ageMs = now - Date.parse(at);
    if (!Number.isFinite(ageMs)) {
      unknown.push({ role, owner, why: `its local beat records "${at}", which cannot be read as a date` });
      continue;
    }
    // A beat from the FUTURE is a clock problem, not a healthy job. Calling it
    // fresh would silence this role for as long as the skew lasts.
    if (ageMs < 0) {
      unknown.push({ role, owner, why: `its local beat is dated ${at}, which is in the future — check the clock on this machine` });
      continue;
    }
    // The declared cadence, NOT the threshold divided back down: `bus-relay`'s
    // threshold is FLOORED at three hours, so dividing it by the miss count
    // says "expected about every 30m" about a job that runs every ten minutes.
    // A wrong fact inside an alarm is how an alarm stops being believed.
    const intervalMs = emitters[role].intervalMs;
    const common = { role, owner, at, ageMs, thresholdMs, intervalMs, beatMeans };

    // A STAND-DOWN IS NOT A RUN, AND THIS IS THE CHECK THAT CAN SAY SO FIRST
    // (task 86bc3t0n1). The roll call reads the shared row, which is pushed at
    // day resolution and needs ClickUp to be reachable; this one reads the
    // stamps on this disk and needs nothing. During the 2026-09-16 outage the
    // stamps were fresh every hour, so this check saw a healthy job — for 90
    // hours. The stamp now says what the pass did, so the same threshold that
    // catches a job that stopped beating catches a job that kept beating and
    // stopped working.
    const kind = normalizeKind(beat.beat && beat.beat.kind);
    if (kind === BEAT_BLOCKED) {
      // NO THRESHOLD AT ALL (round 2). Every other branch here asks "has this
      // been true for longer than we tolerate?", which is the right question
      // about a usage limit and the wrong one about an expired login: the
      // answer will be yes eventually and nothing improves in the meantime.
      // One blocked pass is enough to say so, and the duration goes in the
      // sentence so a one-off crash is legible as one.
      const sinceAt = String((beat.beat && beat.beat.standingDownSince) || at || '');
      const sinceMs = Date.parse(sinceAt);
      const why = String((beat.beat && beat.beat.why) || '').trim() || 'no reason was recorded';
      const blockedForMs = Number.isFinite(sinceMs) ? now - sinceMs : null;
      quiet.push({
        ...common,
        blocked: true,
        standDown: true,
        standingForMs: blockedForMs,
        standingSince: sinceAt,
        standDownWhy: why,
        reason: blockedForMs === null
          ? `its last pass did no work (${why}) and recorded "${sinceAt || '(nothing)'}" as the instant `
            + 'that began, which cannot be read as a date'
          : `has fired and done no work for ${durationText(blockedForMs)} (${why}) — this one does not `
            + 'clear itself with time; it needs a human on the machine that runs this lane',
      });
      continue;
    }
    if (kind === BEAT_STOOD_DOWN) {
      const sinceAt = String((beat.beat && beat.beat.standingDownSince) || at || '');
      const sinceMs = Date.parse(sinceAt);
      const why = String((beat.beat && beat.beat.why) || '').trim() || 'no reason was recorded';
      if (!Number.isFinite(sinceMs)) {
        unknown.push({
          role,
          owner,
          why: `its last pass stood down (${why}) and recorded "${sinceAt || '(nothing)'}" as the instant that `
            + 'began, which cannot be read as a date — so how long it has been standing down cannot be told',
        });
        continue;
      }
      const standingForMs = now - sinceMs;
      if (standingForMs > thresholdMs) {
        quiet.push({
          ...common,
          standDown: true,
          standingForMs,
          standingSince: sinceAt,
          standDownWhy: why,
          reason: `has fired on time and claimed nothing for ${durationText(standingForMs)} (${why}), `
            + `and ${durationText(thresholdMs)} is as long as this job may do that before it counts as stopped`,
        });
      } else {
        fresh.push({ ...common, standDown: true, standingForMs, standingSince: sinceAt, standDownWhy: why });
      }
      continue;
    }

    if (ageMs > thresholdMs) {
      quiet.push({
        ...common,
        reason: `${beatMeans === 'liveness' ? 'last ran' : 'last succeeded'} ${ageText(ageMs)}, `
          + `and this job is expected about every ${ageText(intervalMs).replace(' ago', '')}`,
      });
    } else {
      fresh.push(common);
    }
  }

  return { quiet, fresh, unknown, silent: quiet.length > 0 };
}

/**
 * The bus message for a job that has stopped beating on the machine that owns
 * it. Deliberately NOT the same message as `renderSilencePost` — that one
 * means "the shared roll call has gone stale", which can be a dead machine or
 * a dead network, and this one means "this machine is awake and this job is
 * not working", which is a much narrower and more actionable finding.
 */
function renderStalePost({ quiet, node, now = Date.now() }) {
  return [
    '🔇 **A scheduled job has stopped running on the machine that owns it.**',
    '',
    ...quiet.map((q) => `- **${q.role}** on **${node}** — ${q.reason}`
      + ` (threshold ${durationText(q.thresholdMs)}; last beat ${q.at}).`
      // Two completely different findings wearing one alarm, and the remedies
      // are opposite. "It stopped firing" sends somebody to launchd; "it keeps
      // firing and does nothing" sends them to the usage limit. Saying the
      // wrong one is how an alarm stops being believed.
      + (q.standDown
        ? ' _The runner is ALIVE and on schedule — every pass fired, stood down and exited cleanly. Nothing is'
          + ' wrong with the machine or the schedule; the passes are not able to do any work. This is the shape'
          + ' that ran for 90 hours from 2026-09-16 while every status screen said healthy._'
        : (q.beatMeans === 'liveness'
          ? ' _This role beats once per pass whatever the pass concluded, so this means the runner itself has stopped, not that its work is failing._'
          : ''))),
    '',
    `This machine (**${node}**) is awake and checking, so it is not a dead node — the job itself has`,
    'stopped producing successes. That is the gap this alarm was added for: on 2026-09-03 the merge',
    'lane was dead for sixteen hours while every other surface said nothing or said something',
    'reassuring.',
    '',
    'Where to look:',
    '```',
    'npm run doctor:node                          # is this machine still set up correctly?',
    'npm run heartbeat                            # the whole roll call',
    './scripts/install_bus_relay.sh --status      # is the schedule installed and loaded?',
    './scripts/install_pipeline_pulse.sh --status # the same for the hourly pulse',
    '```',
    '',
    `_Noticed at ${new Date(now).toISOString()} on ${node}. Repeated at most once every `
      + `${Math.round(STALE_REPOST_EVERY_MS / 3600000)} hours until it beats again._`,
    '',
    '— [CC-starcaster]',
  ].join('\n');
}

/**
 * The one message this alarm posts when things are GOOD — and the reason it is
 * not the "all is well x365" the non-goals forbid: it is only ever sent when a
 * quiet post was actually made, so it closes an alarm somebody already read
 * rather than announcing routine health. A dead job that nobody was told about
 * produces neither message.
 */
function renderRecoveredPost({ role, node, quietSince, now = Date.now(), wasStandDown = false }) {
  // A LANE THAT WAS STANDING DOWN NEVER STOPPED BEATING, so "beating again" is
  // a wrong fact in the one message that closes its alarm — it would read as
  // though a dead schedule had been repaired. Same channel, same mechanism,
  // different sentence.
  if (wasStandDown) {
    return [
      `🔊 **${role} is doing real work again on ${node}.**`,
      '',
      quietSince
        ? `It was reported as firing and claiming nothing at ${quietSince}, and a pass has just done real work.`
        : 'It was reported as firing and claiming nothing, and a pass has just done real work.',
      '',
      '_This is the close of that alarm, not a routine all-clear — nothing is posted here unless a',
      'stand-down report went out first._',
      '',
      '— [CC-starcaster]',
    ].join('\n');
  }
  return [
    `🔊 **${role} is beating again on ${node}.**`,
    '',
    quietSince
      ? `It was reported quiet at ${quietSince}, and has just recorded a beat.`
      : 'It was reported quiet, and has just recorded a beat.',
    '',
    '_This is the close of that alarm, not a routine all-clear — nothing is posted here unless a',
    'quiet report went out first._',
    '',
    '— [CC-starcaster]',
  ].join('\n');
}

/** Has enough time passed since the last post/push of this kind? */
function dueAgain({ lastAt, now = Date.now(), everyMs }) {
  if (!lastAt) return true;
  const then = Date.parse(lastAt);
  if (!Number.isFinite(then)) return true;
  return now - then >= everyMs;
}

/**
 * The bus message for a silence. Written to be readable by somebody who was
 * not already suspicious, which is the whole requirement: it names the
 * machine, the job, when it last worked, and the one command that says more.
 */
function renderSilencePost({ overdue, now = Date.now(), reportedBy = '' }) {
  // A role that has NEVER beaten and one that has STOPPED beating need different
  // sentences and a different repair, and the headline used to assert the second
  // about both. When every finding is the first kind, say so — telling somebody a
  // job "has gone quiet" when it has a healthy schedule and a new emitter sends
  // them looking for a fault that is not there.
  const neverBeaten = overdue.filter((o) => o.neverBeaten);
  const allNew = neverBeaten.length === overdue.length && overdue.length > 0;
  const lines = [
    allNew
      ? '🔕 **A scheduled job that should be reporting has never reported.**'
      : '🔕 **A scheduled job has gone quiet.**',
    '',
    ...overdue.map((o) => `- **${o.role}** on **${o.owner}** — ${o.reason}${o.at ? ` (last beat ${o.at})` : ''}.`
      + (o.neverBeaten
        ? ' _Never beaten, which is not the same as stopped: either nothing is installed to beat from, or its'
          + ' emitter was switched on and the job has not run since._'
        : '')),
    '',
    allNew
      ? 'Nothing failed — that would have posted on its own, and nothing has stopped either. These roles are'
      : 'Nothing failed — that would have posted on its own. This is the other half: the job stopped',
    allNew
      ? 'expected to beat and never have, so the thing to check is whether their schedule is installed and'
      : 'firing, which writes nothing anywhere and reads exactly like a quiet week.',
    ...(allNew ? ['whether they have run at all since the beat was added.'] : []),
    '',
    'Check it with:',
    '```',
    'npm run doctor:node                      # is that machine still a valid node?',
    './scripts/install_bus_relay.sh --status  # is the schedule installed and loaded?',
    'npm run heartbeat                        # the whole roll call',
    '```',
    '',
    `_Noticed at ${new Date(now).toISOString()}${reportedBy ? ` by ${reportedBy}` : ''}. `
      + `Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until a beat returns._`,
    '',
    '— [CC-starcaster]',
  ];
  return lines.join('\n');
}

/**
 * The bus message for a lane that is FIRING PERFECTLY AND PRODUCING NOTHING.
 *
 * A separate message from `renderSilencePost` on purpose, because the two
 * findings send a reader to opposite places. "A scheduled job has gone quiet"
 * means check launchd, check the machine, check the network. This one means the
 * machine is fine, the schedule is fine, every pass fired on time — and the
 * passes cannot do any work. Printing the first sentence about the second fault
 * is how an alarm teaches people to ignore it.
 *
 * Task 86bc3t0n1, and the incident is 2026-09-16 to 2026-09-19: 90 hours, 20
 * tickets open, three of them in review for the better part of a week, and
 * every status screen in the system either silent or reassuring.
 */
function renderStandDownPost({ standingDown = [], now = Date.now(), reportedBy = '' }) {
  return [
    '🛑 **A pipeline lane is firing on schedule and doing no work.**',
    '',
    ...standingDown.map((sd) => `- **${sd.role}** on **${sd.owner}** — ${sd.reason}`
      + `${sd.since ? ` (standing down since ${sd.since}; last beat ${sd.at})` : ''}.`),
    '',
    'This is NOT a dead machine and NOT a dead schedule — both are working, which is why every other',
    'check on the board reads healthy. Each pass started, found it could not work, and exited cleanly.',
    'The usual cause is an Anthropic usage limit; the lane comes back on its own when that clears, and',
    'this alarm clears with it.',
    '',
    'What it costs while it lasts: nothing is claimed, nothing is built, nothing is reviewed, and',
    'nothing reaches Live. On 2026-09-16 that ran for 90 hours before a person happened to ask.',
    '',
    'Where to look:',
    '```',
    'npm run heartbeat                        # the roll call, with what each pass actually did',
    'npm run throughput                       # is the queue getting shorter?',
    'tail -50 ~/loop-logs/loop-build.log      # the limit message names its own reset time',
    '```',
    '',
    `_Noticed at ${new Date(now).toISOString()}${reportedBy ? ` by ${reportedBy}` : ''}. `
      + `Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until a pass does real work._`,
    '',
    '— [CC-starcaster]',
  ].join('\n');
}

/**
 * The bus message for a lane that is BLOCKED — firing, doing no work, and not
 * coming back without a human (task 86bc3t0n1, round 2).
 *
 * A separate message from the stand-down one, not a flag on it, because the
 * stand-down text ends "the lane comes back on its own when that clears, and
 * this alarm clears with it" — a true sentence about a usage limit and a
 * dangerously false one about an expired login. Posting that about the
 * 2026-09-18 outage would have told whoever read it to do nothing, which is
 * what everybody did, for three days.
 */
function renderBlockedPost({ blocked = [], now = Date.now(), reportedBy = '' }) {
  return [
    '⛔ **A pipeline lane cannot work at all, and it will not fix itself.**',
    '',
    ...blocked.map((b) => `- **${b.role}** on **${b.owner}** — ${b.reason}`
      + `${b.since ? ` (doing no work since ${b.since}; last beat ${b.at})` : ''}.`),
    '',
    'This is NOT a dead machine and NOT a dead schedule — both are working, which is why every other',
    'check on the board reads healthy. Each pass started, could not work at all, and exited with an',
    'error in about a second.',
    '',
    '**Unlike a usage limit, waiting does not help.** The usual cause is an expired login on the machine',
    'that runs the lane: on 2026-09-18 a real weekly limit was replaced ten minutes later by',
    '`Failed to authenticate: OAuth session expired and could not be refreshed`, the quota reset on',
    'schedule the next evening, and nothing improved for another two days. Somebody has to sign in on',
    'that machine.',
    '',
    'What it costs while it lasts: nothing is claimed, nothing is built, nothing is reviewed, and',
    'nothing reaches Live.',
    '',
    'Where to look:',
    '```',
    'npm run heartbeat                        # the roll call, with what each pass actually did',
    'npm run throughput                       # is the queue getting shorter?',
    'tail -50 ~/loop-logs/loop-build.log      # the last pass\'s own error, verbatim',
    '```',
    '',
    `_Noticed at ${new Date(now).toISOString()}${reportedBy ? ` by ${reportedBy}` : ''}. `
      + `Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until a pass does real work._`,
    '',
    '— [CC-starcaster]',
  ].join('\n');
}

/** The bus message for a job that failed — the committed half of the Phase 0 alert. */
function renderFailurePost({ job, node, status, at = new Date().toISOString(), logTail = '', logPath = '' }) {
  return [
    `🚨 **${job} FAILED on ${node}** — exit status ${status} at ${at}.`,
    '',
    logPath ? `Log: \`${logPath}\`` : '',
    logTail ? ['', 'Last lines:', '```', String(logTail).trimEnd(), '```'].join('\n') : '',
    '',
    `_Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until the job succeeds again._`,
    '',
    '— [CC-starcaster]',
  ].filter((l) => l !== '').join('\n');
}

/**
 * WHAT A `blocked` SCHEDULE ROW IS ENTITLED TO SAY ABOUT A JOB'S HEALTH — which
 * is, on its own, nothing at all (task 86bbzzyxb).
 *
 * `blocked` in lib/nodeProvision.js means one thing: THIS PROVISIONER cannot
 * install that job's schedule. It is a fact about scripts/provision_node.sh.
 * Every reader of it used to slide from there to "so there is nothing to report
 * about this job", which held only while the two coincided — and PR #673 ended
 * that. `channel-steward` and `librarian-sweep` are blocked because their
 * installer lives in the pulse repo, and they are simultaneously the two roles
 * with live local beat stamps on this machine. `loop-build` and `loop-review`
 * are blocked and beating too.
 *
 * So CANNOT DO YET, printed alone, tells the operator a running job is not
 * running. This is the sentence that goes underneath it, and it is derived from
 * the stamps rather than from the blocked flag.
 *
 * Pure: the caller does the stamp IO (`readBeat`) and passes the result, so
 * exactly one file knows where beat stamps live (vault doctrine NODES,
 * principle P1). Returns '' when there is genuinely nothing to add, which is
 * the common case and must stay silent — a line per blocked row saying "no
 * information" is noise that trains the eye to skip the section.
 */
function blockedScheduleBeatNote({ role, beat, now = Date.now(), emitters = BEAT_EMITTERS } = {}) {
  const key = String(role || '').trim().toLowerCase();
  if (!emitters[key]) return '';
  if (!beat) return '';

  if (!beat.readable) {
    return `Whether anything is running it anyway cannot be told from here: its beat stamp could not be read (${beat.why || 'no reason given'}).`;
  }
  if (!beat.found) {
    return 'Nothing is running it here either, as far as this machine can tell — it has never recorded a beat.';
  }

  const at = String((beat.beat && beat.beat.at) || '').trim();
  const beatMs = Date.parse(at);
  if (!Number.isFinite(beatMs)) {
    return `Whether anything is running it anyway cannot be told from here: its beat records "${at || '(nothing)'}", which cannot be read as a date.`;
  }

  const ageMs = now - beatMs;
  const overdueAfterMs = overdueAfterFor(key, emitters);
  // `ageText` bakes "ago" in, which is right for an age and wrong for a window.
  const windowText = ageText(overdueAfterMs).replace(/ ago$/, '');
  if (ageMs > overdueAfterMs) {
    return `It has beaten here before — last ${ageText(ageMs)} (${at}) — but that is older than this system `
      + `treats as alive for it (overdue after ${windowText}), so nothing appears to be running it now.`;
  }
  // "is running it", not "installed its schedule": two of the four roles this
  // reaches are kept alive by an agent session rather than by launchd, and this
  // sentence must be true of both.
  return `IT IS RUNNING ANYWAY — it last succeeded here ${ageText(ageMs)} (${at}). `
    + 'Something outside this provisioner is running it; only the install step is blocked.';
}

module.exports = {
  BEAT_EMITTERS,
  BEAT_RAN,
  BEAT_STOOD_DOWN,
  BEAT_BLOCKED,
  isIdleKind,
  normalizeKind,
  kindWord,
  BEGIN,
  END,
  MIN_QUIET_AFTER_MS,
  NOT_REPORTING_WHY,
  OVERDUE_AFTER_MS,
  OVERDUE_SLACK_MS,
  PUSH_EVERY_MS,
  QUIET_AFTER_MISSES,
  REPOST_EVERY_MS,
  ROLL_CALL_TASK_NAME,
  STALE_REPOST_EVERY_MS,
  ageText,
  alarmCloseoutPlan,
  blockedScheduleBeatNote,
  beatFile,
  dueAgain,
  durationText,
  heartbeatDir,
  mergeRollCall,
  overdueAfterFor,
  parseRollCall,
  quietAfterFor,
  readBeat,
  recencyReport,
  recordBeat,
  relayVerdict,
  renderFailurePost,
  renderRecoveredPost,
  renderRollCall,
  renderSilencePost,
  renderBlockedPost,
  renderStandDownPost,
  renderStalePost,
  rollCallPushPlan,
  rollCallReport,
  standDownSince,
};
