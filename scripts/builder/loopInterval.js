'use strict';

/**
 * How long should a loop sleep before its next pass?
 *
 * WHY THIS EXISTS (2026-08-25, task 86bbmg2fb). The build loop works about 14
 * minutes and then slept a flat 60 — a 23% duty cycle. Nothing was recovering
 * or waiting during that gap; the hour was a QUOTA THROTTLE, chosen as a
 * conservative default when the loops first ran unattended and never
 * revisited.
 *
 * The trade inverts on exactly one thing, the depth of the queue:
 *
 *   - Queue deep: a short interval is nearly free PER UNIT OF WORK. The
 *     session overhead is noise against a 14-minute build, and you pay for
 *     builds you wanted anyway, minus the idling.
 *   - Queue empty: a short interval is pure waste — a whole Claude session
 *     every few minutes to discover there is nothing to do.
 *
 * That is not hypothetical. `loop-review` was left at a TWO-MINUTE interval on
 * 2026-08-24 and ran about 360 passes, almost all of them finding nothing. A
 * fixed number is right at the moment it is chosen and wrong an hour later.
 *
 * So the runner asks for its next sleep each cycle instead of being told once
 * at startup, and the whole decision lives here — pure, injected, and tested —
 * rather than in `~/bin/loop-runner.sh`, which exists on one machine and is in
 * no repository. (Bringing that wrapper under version control is NODES Slice
 * B, task 86bbh9kh2, not this module's job.)
 *
 * Two biases are deliberate and run through every function below:
 *
 *   1. WHEN IN DOUBT, SLEEP LONGER. Every unreadable, absurd or ambiguous
 *      input resolves toward a longer interval, never a shorter one. Guessing
 *      long costs response time, which is visible. Guessing short costs quota,
 *      which is invisible until the month's bill.
 *   2. NOTHING IS SILENT. Every answer carries a reason the log can print, so
 *      the cadence is never a mystery the way the WIP cap's bare total was.
 */

/**
 * The floor, in seconds. NOT to be lowered without recording the decision on
 * task 86bbmg2fb and in docs/LOOP_ENGINEERING.md.
 *
 * This is not a round number picked for tidiness. It is the scar from the
 * 2026-08-24 incident above: at a 2-minute interval the review loop burned a
 * night of quota discovering an empty queue. 900s is the shortest cadence at
 * which the session overhead is still small against the ~14 minutes of real
 * work a pass does — below it, the loop spends more on starting than on
 * building. A number with no derivation gets tuned by whoever is annoyed that
 * day, so the derivation lives here, next to the number.
 */
const FLOOR_SECONDS = 900;

/**
 * What to sleep when the queue could not be read at all. The OLD default — an
 * hour — and specifically NOT the floor: a short interval on unknown state is
 * exactly how quota gets burned invisibly.
 */
const DEFAULT_FALLBACK_SECONDS = 3600;

/**
 * The starting curve, to be tuned with real data rather than defended as
 * correct. Ordered deepest-first; the first row whose `minDepth` is met wins.
 */
const CURVE = [
  { minDepth: 4, seconds: 900, why: 'deep enough that idling is the dominant cost' },
  { minDepth: 1, seconds: 1800, why: 'shallow, and the work will be gone soon anyway' },
  { minDepth: 0, seconds: 3600, why: 'nothing to do; do not pay to find that out often' },
];

/**
 * Which ClickUp status each loop drains. `loop-build` is paced by how much
 * work is waiting to be BUILT; `loop-review` by how much is waiting to be
 * CHECKED. Pacing review on `Queued` depth would wake it for work it cannot
 * touch.
 */
const LOOP_STATUS = {
  'loop-build': 'queued',
  'loop-review': 'in review',
};

/** The loops this module knows how to pace, for error messages. */
const KNOWN_LOOPS = Object.keys(LOOP_STATUS);

/**
 * Raise anything to the floor, and turn anything unusable into the fallback.
 *
 * Deliberately total: it is called on the curve's own output, on the state
 * file (which a human may have edited), and on the runner's `$INTERVAL`
 * argument (which a human definitely typed). "Never below the floor, whatever
 * the input" has to mean whatever the input.
 */
function clampToFloor(seconds, { fallback = DEFAULT_FALLBACK_SECONDS } = {}) {
  const long = Math.max(FLOOR_SECONDS, Math.trunc(Number(fallback)) || DEFAULT_FALLBACK_SECONDS);
  // `Number(null)`, `Number('')`, `Number([])` and `Number(false)` are all 0 —
  // finite, and therefore "raise 0 to the floor", the SHORT end. Review round
  // 1 (2026-08-29) found exactly that: a state file reading
  // `{"interval": null}` made the cadence in force 900s, every proposal was
  // then >= it, and ONE deep reading dropped the interval with no hysteresis
  // at all. So the test is "is this actually a number", not "does Number()
  // manage to make one" — anything that is not a number or a non-blank
  // numeric string resolves to the long fallback (bias 1).
  const usable = typeof seconds === 'number'
    || (typeof seconds === 'string' && seconds.trim() !== '');
  if (!usable) return long;
  const n = Number(seconds);
  // NaN, Infinity, 'soon' — none of these is a number of seconds either.
  if (!Number.isFinite(n)) return long;
  return Math.max(FLOOR_SECONDS, Math.trunc(n));
}

/**
 * Normalise a claimable-depth reading.
 *
 * Absurd input resolves to 0, which the curve maps to the LONGEST interval.
 * That includes `Infinity`, which reads like "infinitely deep, wake often" but
 * is not a depth at all — it is garbage, and garbage takes the safe direction
 * (bias 1).
 */
function normalizeDepth(depth) {
  const n = Number(depth);
  if (!Number.isFinite(n) || n < 0) return { depth: 0, absurd: true };
  return { depth: Math.floor(n), absurd: false };
}

/**
 * The curve itself: claimable depth in, seconds and a reason out.
 * Pure, and the only place the table above is consulted.
 */
function intervalForDepth(depth) {
  const { depth: d, absurd } = normalizeDepth(depth);
  const row = CURVE.find((r) => d >= r.minDepth) || CURVE[CURVE.length - 1];
  const seconds = clampToFloor(row.seconds);
  const reason = absurd
    ? `${seconds}s — depth reading "${String(depth)}" is not a number of tickets, so it was read as 0 (${row.why})`
    : `${seconds}s (${d} claimable — ${row.why})`;
  return { seconds, reason, depth: d, absurd };
}

/**
 * Is this task actually claimable by this loop right now?
 *
 * "Claimable", not "queued" — a queue full of tickets the loop CANNOT take is
 * not a reason to wake more often. Returns null when it is claimable, or a
 * short human reason when it is not, so the caller can log what it excluded
 * rather than just a smaller number.
 *
 * @param {object} task            a ClickUp task as the list endpoint returns it
 * @param {object} opts
 * @param {string} opts.wantStatus the status this loop drains, lower-cased
 * @param {(tags:any)=>{action:string}} opts.resolveRepo  taskRepo.resolveTaskRepo
 * @param {Map<string,object>} opts.byId  every task in the list, for blockers
 * @param {Map<string,object>} [opts.blockers]  blockers read from OUTSIDE the
 *   list (finished tickets never appear in it), consulted for status only
 */
function unclaimableReason(task, { wantStatus, resolveRepo, byId, blockers } = {}) {
  if (!task || typeof task !== 'object') return 'not a task';

  const status = String(task.status?.status ?? '').toLowerCase();
  if (status !== String(wantStatus ?? '').toLowerCase()) return `status is "${status || '?'}"`;

  // Wrong repo, unknown repo, two repo tags, or a repo not checked out on this
  // machine. Every one of those makes the loop ESCALATE rather than build
  // (see scripts/builder/taskRepo.js), so none of them is work this pass would
  // take, and none of them should shorten the cadence.
  if (typeof resolveRepo === 'function') {
    const r = resolveRepo(task.tags);
    if (r && r.action === 'escalate') return `repo escalates — ${r.reason}`;
  }

  // Blocked by an unfinished dependency. ClickUp records a "waiting on" edge
  // as an entry whose `task_id` is THIS task and whose `depends_on` is the
  // blocker; the mirror entry (this task blocking another) has them the other
  // way round and must not count.
  for (const dep of Array.isArray(task.dependencies) ? task.dependencies : []) {
    if (!dep || String(dep.task_id) !== String(task.id)) continue;
    const key = String(dep.depends_on);
    const blocker = (byId instanceof Map ? byId.get(key) : null)
      || (blockers instanceof Map ? blockers.get(key) : null)
      || null;
    // A blocker we cannot see is treated as still blocking. That is the safe
    // direction: it can only make the queue look shallower and the interval
    // longer (bias 1).
    //
    // BUT A FINISHED BLOCKER IS NEVER IN THE LIST (review round 1,
    // 2026-08-29). The list read returns open tasks only — ClickUp's
    // `include_closed` defaults to false — so a ticket waiting on work that
    // has already shipped would read as blocked on every cycle, forever. The
    // caller resolves those ids separately (`outsideBlockerIds` says which)
    // and hands them in as `blockers`; one that could not be resolved stays
    // unseen, and stays blocking.
    const type = String(blocker?.status?.type ?? '').toLowerCase();
    const done = type === 'closed' || type === 'done';
    if (!done) return `waiting on ${key}${blocker ? ` (${blocker.status?.status})` : ' (not in this list and not resolvable — treated as still open)'}`;
  }

  return null;
}

/**
 * The ids of every blocker a "waiting on" edge points at that is NOT in the
 * list itself. Pure; the caller decides whether to fetch them.
 *
 * Why the caller needs this at all: the list endpoint returns open tasks
 * only, so a blocker that has FINISHED is exactly the one that is missing —
 * and the one that must not keep its dependant looking blocked. Nothing is
 * fetched here; a cadence hint should not cost a network call per ticket, so
 * only the ids actually pointing outside the list are handed back.
 */
function outsideBlockerIds(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const present = new Set(list.filter((t) => t && t.id != null).map((t) => String(t.id)));
  const out = new Set();
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    for (const dep of Array.isArray(t.dependencies) ? t.dependencies : []) {
      if (!dep || String(dep.task_id) !== String(t.id)) continue;
      const id = String(dep.depends_on ?? '').trim();
      if (id && !present.has(id)) out.add(id);
    }
  }
  return [...out];
}

/**
 * How many tickets this loop could actually claim on its next pass.
 *
 * @param {object} opts
 * @param {string} opts.loop        'loop-build' | 'loop-review'
 * @param {object[]} opts.tasks     every task in the Loop Queue list
 * @param {boolean} opts.capReached is the work-in-progress cap already full?
 * @param {Function} opts.resolveRepo
 * @param {object[]|Map<string,object>} [opts.blockers]  tasks read from outside
 *   the list because a dependency pointed at them (see outsideBlockerIds).
 *   They are consulted for a blocker's status only — never counted as
 *   claimable themselves, whatever status they carry.
 * @returns {{ depth:number, claimable:object[], excluded:Array<{id:string,why:string}>, note:string|null }}
 */
function claimableDepth({ loop, tasks, capReached = false, resolveRepo, blockers } = {}) {
  const wantStatus = LOOP_STATUS[String(loop || '').trim()];
  if (!wantStatus) {
    throw new Error(`unknown loop "${loop}" — known: ${KNOWN_LOOPS.join(', ')}`);
  }

  // The work-in-progress cap zeroes the whole reading rather than filtering
  // ticket by ticket: when the merge side is full, `loop-build` claims NOTHING
  // this pass, however many tickets are queued, so waking sooner cannot help.
  //
  // It applies to `loop-build` only. `loop-review` does not claim new build
  // work — it drains PRs that are already open, which is the very thing the
  // cap is waiting on. Pausing review because the cap is full would deadlock
  // the pipeline against itself.
  if (capReached && loop === 'loop-build') {
    return {
      depth: 0,
      claimable: [],
      excluded: [],
      note: 'the work-in-progress cap is full, so nothing is claimable this pass however deep the queue is',
    };
  }

  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.filter((t) => t && t.id != null).map((t) => [String(t.id), t]));
  const seen = blockers instanceof Map
    ? blockers
    : new Map((Array.isArray(blockers) ? blockers : []).filter((t) => t && t.id != null).map((t) => [String(t.id), t]));

  const claimable = [];
  const excluded = [];
  for (const t of list) {
    const why = unclaimableReason(t, { wantStatus, resolveRepo, byId, blockers: seen });
    if (why === null) claimable.push(t);
    // Only worth reporting the ones that are the RIGHT status but still
    // unclaimable. Every other ticket in the list has a different status and
    // was never a candidate; listing those is noise.
    else if (String(t?.status?.status ?? '').toLowerCase() === wantStatus) {
      excluded.push({ id: String(t.id), why });
    }
  }

  return { depth: claimable.length, claimable, excluded, note: null };
}

/**
 * Apply the curve to a reading, with hysteresis.
 *
 * SHORTENING NEEDS TWO CONSECUTIVE READINGS. One burst of tickets must not
 * flip the cadence for the rest of the night — the queue may be drained again
 * before the loop even wakes.
 *
 * LENGTHENING IS IMMEDIATE. Same asymmetry as everywhere else here: the
 * expensive mistake is staying fast, so the cheap direction never waits.
 *
 * With no state at all, the interval in force is taken to be the runner's
 * CONFIGURED fallback, not the proposal. So a first pass against a deep queue
 * holds one cycle at the old hour and shortens on the next — which is the same
 * rule every later pass follows, rather than a special case that skips the
 * guard exactly when nothing is known yet.
 *
 * @param {object} opts
 * @param {number} opts.depth
 * @param {{interval?:number,lastProposed?:number}|null} opts.state  previous cycle's state
 * @param {number} opts.fallbackSeconds  the runner's configured interval
 * @returns {{ seconds:number, reason:string, state:object, held:boolean }}
 */
function decideInterval({ depth, state, fallbackSeconds } = {}) {
  const configured = clampToFloor(fallbackSeconds ?? DEFAULT_FALLBACK_SECONDS);
  const proposal = intervalForDepth(depth);
  const proposed = proposal.seconds;

  const prev = Number.isFinite(Number(state?.interval)) ? clampToFloor(state.interval) : null;
  const current = prev ?? configured;
  const lastProposed = Number.isFinite(Number(state?.lastProposed)) ? Number(state.lastProposed) : null;

  // Same or longer — take it now.
  if (proposed >= current) {
    return {
      seconds: proposed,
      reason: proposal.reason,
      state: { interval: proposed, lastProposed: proposed },
      held: false,
    };
  }

  // Shorter, and the previous reading also wanted shorter: two consecutive, so
  // shorten — to the LATEST proposal, which is the freshest reading of the
  // queue rather than the more excited older one.
  if (lastProposed !== null && lastProposed < current) {
    return {
      seconds: proposed,
      reason: `${proposal.reason}; second consecutive short reading, so the cadence drops from ${current}s`,
      state: { interval: proposed, lastProposed: proposed },
      held: false,
    };
  }

  // Shorter, but this is the first such reading. Hold, and remember it.
  return {
    seconds: current,
    reason: `${current}s — holding. ${proposal.reason} would shorten it, but one reading does not (two consecutive do)`,
    state: { interval: current, lastProposed: proposed },
    held: true,
  };
}

/**
 * What to answer when the queue could not be read.
 *
 * Exits 0 on purpose — this is not the loop's problem to solve, and a non-zero
 * exit would make the runner fall back to the SAME number by a noisier route.
 * The state is left untouched: a failed read is not a reading, and must not
 * count as one of hysteresis' two consecutive readings.
 */
function fallbackInterval({ fallbackSeconds, why } = {}) {
  const raw = Number(fallbackSeconds);
  const seconds = clampToFloor(fallbackSeconds ?? DEFAULT_FALLBACK_SECONDS);
  // Two different endings, because one sentence cannot honestly cover both.
  // Normally the point worth making is that this is NOT the floor. But when
  // the configured value was itself under the floor, it HAS been raised to it,
  // and saying "not the floor" in that breath would be a contradiction the
  // reader has to untangle at exactly the wrong moment.
  const tail = Number.isFinite(raw) && Math.trunc(raw) < seconds
    ? `, and the configured ${Math.trunc(raw)}s was raised to the ${FLOOR_SECONDS}s floor.`
    : '. NOT the floor: a short interval on unknown state is how quota gets burned invisibly.';
  return {
    seconds,
    reason: `${seconds}s — the queue could not be read (${why || 'reason not given'}), so the configured fallback is in force${tail}`,
    state: null,
    held: false,
  };
}

module.exports = {
  FLOOR_SECONDS,
  DEFAULT_FALLBACK_SECONDS,
  CURVE,
  LOOP_STATUS,
  KNOWN_LOOPS,
  clampToFloor,
  normalizeDepth,
  intervalForDepth,
  unclaimableReason,
  outsideBlockerIds,
  claimableDepth,
  decideInterval,
  fallbackInterval,
};
