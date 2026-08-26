'use strict';

/**
 * `npm run pulse` — the pipeline's vital signs. Phase 1 of the diagnostics
 * design (task 86bbm9h60): the three checks that would have caught this week.
 *
 * THE THESIS. Seven incidents in the week to 2026-08-25. NOT ONE WAS A CRASH.
 * Every one was a component that ran, exited 0, and accomplished nothing — a
 * build loop declining 13 passes in a row on a deadlocked cap, tickets sitting
 * 70 hours in `Building`, a PR and its ticket linked in only one direction.
 * A health check would have passed during all of them, because every process
 * involved was alive and every exit code was 0.
 *
 * So THESE DIAGNOSTICS MEASURE FLOW, NEVER STATUS. "Is it running" is the
 * question that failed; "is anything moving" is the question that works.
 *
 * This file is the pure half: parsing, thresholds and classification, with no
 * network, no filesystem and no clock of its own. Every reader lives in
 * `scripts/pulse.cjs`. That split is criterion 6 of the ticket and it is what
 * makes the thresholds testable — a number nobody can break-test is a number
 * that gets tuned by whoever is annoyed that day.
 *
 * THE FIVE RULES, which matter more than the checks themselves:
 *
 *   1. SILENCE IS NEVER ALL-CLEAR. Every check reports even when it is happy,
 *      so "all clear" and "the job died" can never look alike. That is the
 *      failure this whole module exists to prevent, so it is not optional and
 *      `formatReport` has no quiet mode.
 *   2. "CANNOT TELL" IS ITS OWN STATE, never folded into "fine" (DOCTRINE
 *      3.11). Every check returns a `cannotTell` array beside its findings,
 *      and a source that could not be read is named with its reason.
 *   3. EVERY COUNT CARRIES ITS BREAKDOWN. `7 open, cap 5` was true and hid a
 *      deadlock for four passes. A bare number is not a finding here.
 *   4. NAME THE BOTTLENECK IN A SENTENCE. A table of rates makes the reader do
 *      arithmetic they will skip, so `bottleneckSentence` does it for them.
 *   5. THE PULSE CANNOT FAIL SILENTLY EITHER. It ends with a stamped
 *      completion line, so a scheduled run that produces no report is itself
 *      the alert. (It writes no file: the ticket's non-goals forbid the pulse
 *      writing anything, so the completion line is the heartbeat, and a
 *      persisted one belongs to phase 2.)
 */

const MS_PER_HOUR = 3600 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// A1 — the no-op streak
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The wrapper writes one of these around every pass:
 *
 *   ===== 2026-08-22 01:43:14 START /loop-build =====
 *   ===== 2026-08-22 02:08:42 END /loop-build (exit 0) =====
 *
 * Anchored whole-line so a pass whose own prose quotes a banner cannot open a
 * phantom pass inside the real one.
 */
const PASS_BANNER_RE =
  /^=====\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(START|END)\s+\/(\S+)(?:\s+\(exit (-?\d+)\))?\s+=====$/;

/**
 * Split a loop log into passes.
 *
 * A START with no END is NOT dropped. A pass that began and never finished is
 * one of the two shapes of a dead loop — the other being a pass that finishes
 * instantly forever — so it comes back separately as `unterminated` for the
 * caller to report rather than vanishing into the gap between two banners.
 *
 * A second START before an END means the first pass never closed; the partial
 * is kept as unterminated rather than being silently merged into the second.
 */
function parsePassLog(text) {
  const passes = [];
  const unterminated = [];
  let open = null;

  for (const line of String(text || '').split('\n')) {
    const m = PASS_BANNER_RE.exec(line);
    if (!m) {
      if (open) open.body.push(line);
      continue;
    }
    const [, stamp, kind, job, exit] = m;
    if (kind === 'START') {
      if (open) unterminated.push(open);
      open = { job, start: stamp, end: null, exitCode: null, body: [] };
      continue;
    }
    if (!open) continue; // an END with no START — a truncated log head
    open.end = stamp;
    open.exitCode = exit === undefined ? null : Number(exit);
    passes.push(open);
    open = null;
  }
  if (open) unterminated.push(open);
  return { passes, unterminated };
}

/**
 * A pass with no END banner is either still running or dead, and the two are
 * the same bytes on disk. Age settles it.
 *
 * WHY THIS MATTERS ENOUGH TO NEED A THRESHOLD. The pulse runs while the loop
 * runs, so the newest pass is very often the live one — the first production
 * run reported the pulse's own in-flight pass as "it either hung or was
 * killed". A diagnostic that raises the same false note on every single run
 * teaches the reader to skim past that line, and the day it means something
 * they will skim past it then too.
 *
 * FOUR HOURS, derived: a pass is 10-15 minutes of work; the longest real one
 * in the 580-pass sample was 38 minutes. Four hours is far outside that and
 * still well inside the interval at which anyone would want to know.
 */
const PASS_HUNG_AFTER_HOURS = 4;

/**
 * @param pass  an unterminated pass from `parsePassLog`
 * @param now   epoch ms, passed in — this module owns no clock
 * @returns { state: 'running' | 'hung' | 'cannot-tell', message }
 */
function classifyUnterminated(pass, { now, hungAfterHours = PASS_HUNG_AFTER_HOURS } = {}) {
  // The banner stamp is local wall-clock with no zone, which is what the
  // wrapper writes; Date.parse reads it as local time, matching it.
  const started = Date.parse(String(pass?.start || '').replace(' ', 'T'));
  if (!Number.isFinite(started)) {
    return {
      state: 'cannot-tell',
      message: `a pass began with an unreadable timestamp ("${pass?.start}") and never printed an END banner`,
    };
  }
  const hours = (now - started) / MS_PER_HOUR;
  if (hours < 0) {
    return {
      state: 'cannot-tell',
      message: `a pass is stamped ${pass.start}, in the future — the clock or the log is wrong`,
    };
  }
  if (hours <= hungAfterHours) {
    return {
      state: 'running',
      message: `a pass started ${pass.start} (${formatDuration(hours)} ago) and has not finished — ` +
        'almost certainly the one running right now',
    };
  }
  return {
    state: 'hung',
    message: `a pass started ${pass.start} and never printed an END banner ${formatDuration(hours)} later — ` +
      `it hung or was killed (a pass takes 10-15 minutes; anything past ${hungAfterHours}h is dead)`,
  };
}

/**
 * How a pass is classified, and WHY these markers and not others.
 *
 * The log body is the agent's own prose report, not tool output — there is no
 * structured claim record to read. So classification keys off the DETERMINISTIC
 * STRINGS the loop's own commands print, which a pass quotes verbatim when it
 * declines: `wipCap.js`'s "WIP cap reached — N PR(s) open, cap M",
 * `nodeRoles.js`'s "so it did nothing.", and the harness's own quota notice.
 *
 * Measured against 580 real passes (2026-08-22 → 08-26): 90% classify, and the
 * remaining 10% land in `unknown`, which is reported as CANNOT TELL rather than
 * as a decline. THAT ASYMMETRY IS DELIBERATE. Guessing "declined" from an
 * unreadable pass invents an outage; guessing "claimed" hides one. Neither is
 * acceptable, so an unreadable pass says so.
 *
 * Order matters: a decline marker wins over the claim marker, because a capped
 * pass often names the PRs it counted and would otherwise read as a claim. The
 * markers are the quoted messages precisely so that stays true — an early
 * draft matched `wip-check` and `exit 3` anywhere in the body and mislabelled a
 * rework pass whose `build-start` had exited 3 for an entirely different reason.
 */
const PASS_MARKERS = [
  {
    key: 'quota-exhausted',
    label: 'the model quota was exhausted — the pass could not run at all',
    re: /hit your (?:weekly|usage) limit|usage limit reached|limit\s*·\s*resets/i,
  },
  {
    key: 'wip-cap',
    label: 'the WIP cap was reached — the merge side was full',
    // Both the exact message and the paraphrase a pass writes when it
    // summarises the exit-3 line in its own words.
    re: /WIP cap reached\s*[—-]|\b\d+\s*PRs?(?:\(s\))?\s+open,\s*cap\s+\d+/i,
  },
  {
    key: 'not-this-machine',
    label: 'another machine owns the loop',
    re: /so it did nothing\.|is owned by \S+\. This machine is/i,
  },
  {
    key: 'queue-empty',
    label: 'the queue was empty',
    re: /queue (?:is |was )?empty|no (?:task|tickets?) (?:is |are |was |were )?queued/i,
  },
];

/** A ClickUp task id. A pass that engaged a ticket names it; a pass that
 *  declined at a gate writes nothing to ClickUp and names none. */
const CLICKUP_TASK_RE = /\b86bb[a-z0-9]{5,}\b/i;

/**
 * One pass → `{ outcome, reasonKey, reason }`.
 *
 *   claimed   it took a ticket and worked it
 *   declined  it stopped at a gate, and we know which one
 *   failed    it ended non-zero for a reason no marker explains
 *   unknown   we could not tell — never folded into any of the above
 */
function classifyPass(pass) {
  const body = (pass?.body || []).join('\n');

  for (const marker of PASS_MARKERS) {
    if (marker.re.test(body)) {
      return { outcome: 'declined', reasonKey: marker.key, reason: marker.label };
    }
  }
  if (Number.isFinite(pass?.exitCode) && pass.exitCode !== 0) {
    return {
      outcome: 'failed',
      reasonKey: 'nonzero-exit',
      reason: `the pass ended with exit ${pass.exitCode} and gave no reason a marker recognises`,
    };
  }
  if (CLICKUP_TASK_RE.test(body)) {
    return { outcome: 'claimed', reasonKey: 'claimed', reason: 'the pass worked a ticket' };
  }
  return {
    outcome: 'unknown',
    reasonKey: 'unreadable',
    reason: 'the pass report matches no known decline marker and names no ticket',
  };
}

/**
 * Three consecutive claimless passes, and only while something is queued.
 *
 * WHY THREE. One claimless pass is normal — the cap fills, a ticket is
 * escalated. Two is plausible. Eight happened, and thirteen happened on
 * 2026-08-25, and both looked from outside exactly like a quiet morning. Three
 * is the first count that cannot be explained away, so it is the first count
 * worth interrupting for.
 *
 * WHY `queued > 0` GATES IT. A loop declining an empty queue is working
 * perfectly. Alarming on that trains the reader to ignore the alarm, which
 * costs more than the check is worth.
 */
const NOOP_STREAK_THRESHOLD = 3;

/**
 * @param passes        oldest-first, as `parsePassLog` returns them
 * @param queuedCount   how many tickets are waiting. null = could not read it.
 */
function noOpStreak(passes, { queuedCount, threshold = NOOP_STREAK_THRESHOLD } = {}) {
  const classified = (passes || []).map((p) => ({ pass: p, ...classifyPass(p) }));

  // Walk back from the newest until a confirmed claim stops it.
  const streak = [];
  for (let i = classified.length - 1; i >= 0; i--) {
    if (classified[i].outcome === 'claimed') break;
    streak.push(classified[i]);
  }
  streak.reverse();

  const breakdown = {};
  for (const s of streak) breakdown[s.reasonKey] = (breakdown[s.reasonKey] || 0) + 1;
  const unreadable = streak.filter((s) => s.outcome === 'unknown').length;

  const base = {
    streak: streak.length,
    threshold,
    breakdown,
    unreadable,
    since: streak.length ? streak[0].pass.start : null,
    latest: streak.length ? streak[streak.length - 1].pass.start : null,
    queuedCount,
    passesRead: classified.length,
  };

  if (queuedCount === null || queuedCount === undefined) {
    return {
      ...base,
      verdict: 'cannot-tell',
      message:
        `${streak.length} consecutive claimless pass(es), but the queued count could not be read — ` +
        'a loop declining an empty queue is healthy, so this cannot be judged without it',
    };
  }
  if (streak.length < threshold) {
    return {
      ...base,
      verdict: 'clear',
      message:
        `${streak.length} consecutive claimless pass(es), threshold ${threshold}` +
        (streak.length ? ` (${describeBreakdown(breakdown)})` : '') +
        `; ${queuedCount} queued`,
    };
  }
  if (queuedCount === 0) {
    return {
      ...base,
      verdict: 'clear',
      message:
        `${streak.length} consecutive claimless pass(es), but the queue is empty — ` +
        'declining an empty queue is the loop working correctly, not a stall',
    };
  }
  // Every pass in the streak unreadable means we do not actually know it
  // declined. Say that, rather than inventing an outage from silence.
  if (unreadable === streak.length) {
    return {
      ...base,
      verdict: 'cannot-tell',
      message:
        `${streak.length} consecutive pass(es) show no claim, but NONE of them could be classified — ` +
        `the loop may be stalled or the reports may simply be unreadable (${queuedCount} queued)`,
    };
  }
  return {
    ...base,
    verdict: 'finding',
    message:
      `${streak.length} consecutive claimless passes (threshold ${threshold}) with ${queuedCount} queued — ` +
      `since ${base.since}. Reasons: ${describeBreakdown(breakdown)}`,
  };
}

/** Rule 3: a count always arrives with what it is made of. */
function describeBreakdown(breakdown) {
  const entries = Object.entries(breakdown || {});
  if (!entries.length) return 'nothing to break down';
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${n}× ${k}`)
    .join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 — stage residency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a ticket may sit in a stage before that is worth saying out loud.
 *
 * Each number carries where it came from, because a threshold with no
 * derivation gets tuned by whoever is annoyed that day and then means nothing.
 */
const STAGE_THRESHOLDS = {
  building: {
    hours: 2,
    severity: 'alarm',
    why: 'a build takes 10-15 minutes; three tickets measured 65-72 hours on 2026-08-25',
  },
  'in review': {
    hours: 4,
    severity: 'alarm',
    why: 'a review takes about 10 minutes on an hourly poll, so four hours is already several missed polls',
  },
  'ready to launch': {
    hours: 24,
    severity: 'notice',
    why: 'operator-held — surface it, do not alarm; only Dane moves a ticket out of this stage',
  },
  queued: {
    hours: 24 * 7,
    severity: 'notice',
    why: 'long is fine, forgotten is not — a week is the point where nobody remembers filing it',
  },
};

/**
 * `date_updated` IS A PROXY FOR STAGE ENTRY, NOT A MEASUREMENT OF IT. ClickUp
 * bumps it on any edit, so a comment or a Loop-note stamp resets the clock. The
 * error runs one way — it makes a stuck ticket look FRESHER than it is — so the
 * check under-reports rather than over-reports, and the output says so instead
 * of implying a precision the data does not have.
 */
const RESIDENCY_PROXY_NOTE =
  'measured from date_updated, which is a proxy for stage entry: any edit resets it, ' +
  'so these ages are the FLOOR of the real wait, never the ceiling';

/**
 * @param tasks  ClickUp task objects
 * @param now    epoch ms — passed in, never read from a clock, so tests are real
 */
function stageResidency(tasks, { now, thresholds = STAGE_THRESHOLDS } = {}) {
  const findings = [];
  const cannotTell = [];
  const census = {};
  const unmeasured = [];

  for (const task of tasks || []) {
    const status = String(task?.status?.status || '').toLowerCase();
    census[status] = (census[status] || 0) + 1;

    const rule = thresholds[status];
    if (!rule) {
      unmeasured.push({ taskId: task?.id, name: task?.name, status });
      continue;
    }

    const updated = Number(task?.date_updated);
    if (!Number.isFinite(updated) || updated <= 0) {
      cannotTell.push({
        taskId: task?.id,
        name: task?.name,
        status,
        reason: 'ClickUp returned no usable date_updated, so its age in this stage is unknowable',
      });
      continue;
    }

    const hours = (now - updated) / MS_PER_HOUR;
    if (hours <= rule.hours) continue;

    findings.push({
      taskId: task?.id,
      name: task?.name,
      status,
      hours: Math.round(hours * 10) / 10,
      thresholdHours: rule.hours,
      severity: rule.severity,
      why: rule.why,
      message:
        `${task?.id} "${truncate(task?.name, 60)}" has been in ${status} for ` +
        `${formatDuration(hours)} — threshold ${rule.hours}h (${rule.why})`,
    });
  }

  findings.sort((a, b) => b.hours - a.hours);
  return { findings, cannotTell, census, unmeasured, proxyNote: RESIDENCY_PROXY_NOTE };
}

function formatDuration(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// B1 — ticket ↔ PR drift, in BOTH directions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ticket the machine is responsible for moving. Matches `reconcile`'s ladder
 * by role rather than by a second hand-copied name list.
 */
const IN_FLIGHT_STATUSES = new Set(['building', 'in review', 'needs your input', 'ready to launch']);

/**
 * Finished. `queued` IS DELIBERATELY IN NEITHER SET, and that is the whole
 * subtlety of this check.
 *
 * A queued ticket with an open PR is not drift — it is a SEND-BACK, the
 * ordinary state of work a review handed back for a fix, and the exact state
 * `build-start` exists to recognise. The first run of this check against
 * production called two of them zombies (86bbjve6b/#419, 86bbev0gx/#428) for
 * no better reason than that `queued` is not in the in-flight set, and
 * "not in flight" had been treated as a synonym for "finished".
 *
 * It is not. Three states exist — in flight, waiting to start again, and done —
 * and collapsing the middle one into either of the others invents findings.
 * A diagnostic that cries wolf is worse than no diagnostic, because the reader
 * stops reading it and then misses the real one.
 */
const TERMINAL_STATUSES = new Set(['live']);

/** ClickUp's own status.type settles it where present, so a future "Won't do"
 *  is terminal without being name-listed; the name set is the fallback. */
function isTerminalStatus(status, statusType) {
  const type = String(statusType || '').toLowerCase();
  if (type === 'closed' || type === 'done') return true;
  return TERMINAL_STATUSES.has(String(status || '').toLowerCase());
}

/**
 * The four shapes of drift, all four observed in the wild.
 *
 *   shape-1  in-flight ticket, PR merged     → `reconcile` already repairs it;
 *                                              reported so the pulse and the
 *                                              reconciler cannot disagree
 *   shape-2  terminal ticket, PR still open  → the zombies (added 2026-08-25)
 *   shape-3  in-flight ticket, NO PR at all  → stranded
 *   shape-4  a PR names a ticket, the ticket has no record of that PR
 *
 * SHAPE 4 IS THE DANGEROUS ONE and it is why this check reads both directions.
 * `build-start` decides whether a branch already exists by reading THE TICKET.
 * A link that exists only on the PR side is invisible to it, so the next pass
 * opens a second branch for work that already has one — exactly how #407 and
 * #408 were born. Found while writing the design: PR #373 ↔ 86bbjj6qb.
 *
 * REPORT, NEVER REPAIR. Shape 4 has two valid fixes — add the comment to the
 * ticket, or close the PR as superseded — and only a person knows which.
 *
 * @param records  one per ticket:
 *   { taskId, name, status,
 *     ticketPrNumbers,   every "PR opened:" number in the ticket's comments
 *     buildStartSees,    what findPullRequest() returns — the number
 *                        build-start would act on, or null
 *     buildStartPrState, that PR's state, or null for "could not read it"
 *     openPrsNamingTicket, open PR numbers whose body names this ticket
 *     commentsReadable } false when the comment fetch itself failed
 */
/**
 * The ClickUp link a PR body is REQUIRED to carry (`loop-build` step 7, and
 * `pr-opened` refuses without it). This is the PR's declaration of which
 * ticket it belongs to.
 *
 * IT IS NOT THE SAME AS "a ticket id appears somewhere in the PR". The first
 * production run of this check scanned for bare ids and reported four one-way
 * links that did not exist: PR #435 discusses four other tickets in its prose
 * — one of them the literal example `86bbnonexistent` — while declaring
 * exactly one. Prose mentions another ticket all the time; the URL line means
 * "this PR is that ticket's work", which is the only claim shape 4 is about.
 */
const CLICKUP_URL_RE = /https:\/\/app\.clickup\.com\/t\/(86bb[a-z0-9]+)/gi;

/** taskId -> [open PR numbers that DECLARE it via the required link]. */
function indexPrsByTicket(openPrs) {
  const index = new Map();
  for (const pr of openPrs || []) {
    const text = `${pr.title || ''}\n${pr.body || ''}`;
    const declared = new Set([...text.matchAll(CLICKUP_URL_RE)].map((m) => m[1].toLowerCase()));
    for (const id of declared) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(pr.number);
    }
  }
  return index;
}

function driftFindings(records) {
  const findings = [];
  const cannotTell = [];

  for (const r of records || []) {
    const status = String(r?.status || '').toLowerCase();
    const inFlight = IN_FLIGHT_STATUSES.has(status);
    const terminal = isTerminalStatus(status, r?.statusType);
    const ticketPrs = Array.isArray(r?.ticketPrNumbers) ? r.ticketPrNumbers.map(Number) : [];
    const openNaming = Array.isArray(r?.openPrsNamingTicket) ? r.openPrsNamingTicket.map(Number) : [];

    if (r?.commentsReadable === false) {
      cannotTell.push({
        taskId: r?.taskId,
        name: r?.name,
        status,
        reason: 'this ticket\'s comments could not be read, so its PR link is unknown in both directions',
      });
      continue;
    }

    // Shape 4 — the one-way link. Checked first: it is the only shape that can
    // still cause a duplicate PR, and it is true regardless of the others.
    const oneWay = openNaming.filter((n) => !ticketPrs.includes(n));
    for (const number of oneWay) {
      findings.push({
        shape: 'shape-4',
        severity: 'alarm',
        taskId: r?.taskId,
        name: r?.name,
        status,
        pr: number,
        message:
          `PR #${number} names ${r?.taskId} but the ticket carries no "PR opened:" line for it ` +
          `(build-start would see ${r?.buildStartSees ? `#${r.buildStartSees}` : 'nothing'}) — ` +
          'a one-way link, so the next build pass can open a duplicate branch',
      });
    }

    if (r?.buildStartSees && !r?.buildStartPrState) {
      cannotTell.push({
        taskId: r?.taskId,
        name: r?.name,
        status,
        reason: `the ticket names PR #${r.buildStartSees} but GitHub would not say whether it is open, merged or closed`,
      });
      continue;
    }

    const prState = String(r?.buildStartPrState || '').toUpperCase();

    // Shape 3 — stranded: in flight, and nothing anywhere links a PR.
    if (inFlight && !ticketPrs.length && !openNaming.length) {
      findings.push({
        shape: 'shape-3',
        severity: 'alarm',
        taskId: r?.taskId,
        name: r?.name,
        status,
        pr: null,
        message:
          `${r?.taskId} "${truncate(r?.name, 60)}" is ${status} but no PR is linked from either side — ` +
          'stranded: the stage says work is happening and nothing has been opened',
      });
      continue;
    }

    // Shape 1 — the work is live and the ticket did not follow. Keyed on
    // "not terminal" rather than "in flight" so a ticket sent back to `queued`
    // whose PR then merged is caught too.
    if (!terminal && prState === 'MERGED') {
      findings.push({
        shape: 'shape-1',
        severity: 'notice',
        taskId: r?.taskId,
        name: r?.name,
        status,
        pr: r.buildStartSees,
        message:
          `${r?.taskId} is ${status} but PR #${r.buildStartSees} is merged — ` +
          'the work is live and the ticket did not follow (npm run reconcile repairs this shape)',
      });
      continue;
    }

    // Shape 2 — terminal ticket, PR still open. The zombies. `terminal`, NOT
    // `!inFlight`: see TERMINAL_STATUSES above for the two false positives
    // that distinction cost on the first production run.
    if (terminal && prState === 'OPEN') {
      findings.push({
        shape: 'shape-2',
        severity: 'alarm',
        taskId: r?.taskId,
        name: r?.name,
        status,
        pr: r.buildStartSees,
        message:
          `${r?.taskId} is ${status} — a finished stage — but PR #${r.buildStartSees} is still open: ` +
          'a zombie branch nobody is watching',
      });
    }
  }

  return { findings, cannotTell };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 4 — the bottleneck, in one sentence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Throughput is min(build rate, review rate, merge rate), and the reader wants
 * to know WHICH — not a table of three numbers to compare themselves.
 *
 * The ladder is deliberately ordered by who can act:
 *   BUILD    the loop is declining while work waits — a machine problem
 *   REVIEW   review is backed up past its threshold — a machine problem
 *   OPERATOR merges are waiting on a person — worth naming so the machine side
 *            is not blamed for it
 * Build outranks review because a stalled builder starves the reviewer, so
 * fixing review first fixes nothing.
 */
function bottleneckSentence({ noOp, residency } = {}) {
  const census = residency?.census || {};
  const count = (s) => census[s] || 0;
  const overIn = (stage) =>
    (residency?.findings || []).filter((f) => f.status === stage).length;

  // The queued count comes from the streak check when it has one, NOT from the
  // census, because that is the number the streak decision was actually made
  // against. Reading it twice from two places is how the sentence ends up
  // saying "0 queued" directly above a finding that says 26 — one report
  // contradicting itself is worse than no report.
  const queued = Number.isFinite(noOp?.queuedCount) ? noOp.queuedCount : count('queued');
  const ready = count('ready to launch');
  const review = count('in review');

  if (noOp?.verdict === 'finding') {
    return (
      `Bottleneck: BUILD — ${noOp.streak} consecutive claimless passes with ${queued} queued ` +
      `(${describeBreakdown(noOp.breakdown)}). Ready to launch holds ${ready}.`
    );
  }
  if (overIn('in review') >= 2) {
    return (
      `Bottleneck: REVIEW — ${overIn('in review')} of ${review} tickets in review are past ` +
      `${STAGE_THRESHOLDS['in review'].hours}h. Not the builder; ${queued} still queued and the loop is claiming.`
    );
  }
  if (overIn('ready to launch') >= 1) {
    return (
      `Bottleneck: OPERATOR — ${overIn('ready to launch')} of ${ready} approved tickets have waited past ` +
      `${STAGE_THRESHOLDS['ready to launch'].hours}h for a merge. The machine side is keeping up.`
    );
  }
  if (noOp?.verdict === 'cannot-tell') {
    return `Bottleneck: CANNOT TELL — ${noOp.message}`;
  }
  return `No bottleneck: the loop is claiming, ${review} in review, ${ready} awaiting merge, ${queued} queued.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The report
// ─────────────────────────────────────────────────────────────────────────────

/** Rule 5's heartbeat: printed on every completed run, whatever it found. */
const COMPLETION_MARKER = 'PULSE COMPLETE';

/**
 * Rule 1 in code: every check prints a section whether or not it found
 * anything, so an all-clear run and a run that died halfway cannot be
 * confused. `formatReport` has no quiet mode on purpose.
 */
function formatReport(result) {
  const lines = [];
  const push = (s = '') => lines.push(s);

  push(`PIPELINE PULSE — ${result.generatedAt}`);
  push('='.repeat(72));
  push('');
  push(bottleneckSentence(result));
  push('');

  // A1
  push('A1  NO-OP STREAK — consecutive loop passes that claimed nothing');
  push('-'.repeat(72));
  const noOp = result.noOp;
  if (!noOp) {
    push('  CANNOT TELL — the loop log was not read at all');
  } else if (noOp.sourceError) {
    push(`  CANNOT TELL — ${noOp.sourceError}`);
  } else {
    push(`  ${verdictTag(noOp.verdict)} ${noOp.message}`);
    push(`  read ${noOp.passesRead} pass(es) from ${noOp.source || 'the loop log'}`);
    if (noOp.unreadable) {
      push(`  ${noOp.unreadable} pass(es) in the streak could not be classified — counted, not assumed`);
    }
    for (const u of noOp.unterminated || []) {
      push(`  ${verdictTag(u.state === 'hung' ? 'alarm' : u.state === 'running' ? 'clear' : 'cannot-tell')} ${u.message}`);
    }
  }
  push('');

  // A2
  push('A2  STAGE RESIDENCY — how long tickets have sat where they are');
  push('-'.repeat(72));
  const res = result.residency;
  if (!res) {
    push('  CANNOT TELL — the queue was not read at all');
  } else {
    push(`  note: ${res.proxyNote}`);
    push(`  census: ${describeCensus(res.census)}`);
    if (!res.findings.length) push('  CLEAR   every measured ticket is inside its threshold');
    for (const f of res.findings) push(`  ${verdictTag(f.severity)} ${f.message}`);
    for (const c of res.cannotTell) push(`  CANNOT  ${c.taskId} (${c.status}) — ${c.reason}`);
    if (res.unmeasured.length) {
      push(`  not measured: ${res.unmeasured.length} ticket(s) in stages with no threshold ` +
        `(${[...new Set(res.unmeasured.map((u) => u.status))].join(', ')})`);
    }
  }
  push('');

  // B1
  push('B1  TICKET <-> PR DRIFT — checked in both directions');
  push('-'.repeat(72));
  const drift = result.drift;
  if (!drift) {
    push('  CANNOT TELL — neither ClickUp nor GitHub was read');
  } else {
    push(`  compared ${drift.ticketsCompared ?? '?'} ticket(s) against ${drift.openPrsCompared ?? '?'} open PR(s)`);
    if (!drift.findings.length) push('  CLEAR   every ticket and PR names the other');
    for (const f of drift.findings) push(`  ${verdictTag(f.severity)} [${f.shape}] ${f.message}`);
    for (const c of drift.cannotTell) push(`  CANNOT  ${c.taskId} (${c.status}) — ${c.reason}`);
  }
  push('');

  push('='.repeat(72));
  push(`  ${summaryLine(result)}`);
  push(`${COMPLETION_MARKER} ${result.generatedAt} — if a scheduled run does not print this line, that absence IS the alert`);
  return lines.join('\n');
}

function verdictTag(v) {
  return {
    finding: 'ALARM  ',
    alarm: 'ALARM  ',
    notice: 'NOTICE ',
    'cannot-tell': 'CANNOT ',
    clear: 'CLEAR  ',
  }[v] || 'NOTICE ';
}

function describeCensus(census) {
  const entries = Object.entries(census || {});
  if (!entries.length) return 'no tickets read';
  return entries.sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
}

/** Rule 3 again, at the top level: the totals arrive with their parts. */
function summaryLine(result) {
  const { alarms, notices, cannotTell } = tally(result);
  return (
    `${alarms} alarm(s), ${notices} notice(s), ${cannotTell} could-not-tell. ` +
    'A could-not-tell is not a pass.'
  );
}

function tally(result) {
  let alarms = 0;
  let notices = 0;
  let cannotTell = 0;

  if (result?.noOp?.sourceError) cannotTell++;
  else if (result?.noOp?.verdict === 'finding') alarms++;
  else if (result?.noOp?.verdict === 'cannot-tell') cannotTell++;
  // A pass that is merely still running is neither a finding nor a blind spot.
  for (const u of result?.noOp?.unterminated || []) {
    if (u.state === 'hung') alarms++;
    else if (u.state === 'cannot-tell') cannotTell++;
  }

  for (const f of result?.residency?.findings || []) {
    if (f.severity === 'alarm') alarms++;
    else notices++;
  }
  cannotTell += (result?.residency?.cannotTell || []).length;

  for (const f of result?.drift?.findings || []) {
    if (f.severity === 'alarm') alarms++;
    else notices++;
  }
  cannotTell += (result?.drift?.cannotTell || []).length;

  return { alarms, notices, cannotTell };
}

/**
 * A diagnostic is not a gate, so the command exits 0 by default whatever it
 * finds (criterion 1). `--exit-code` opts a caller into acting on it:
 *   0  clean       1  something was found       2  nothing found, but a source
 *                                                 could not be read
 * Two is separate from one for the same reason CANNOT TELL is separate from
 * CLEAR: a caller must be able to treat "I could not look" differently from
 * "I looked and it was fine".
 */
function exitCodeFor(result) {
  const { alarms, notices, cannotTell } = tally(result);
  if (alarms + notices > 0) return 1;
  if (cannotTell > 0) return 2;
  return 0;
}

module.exports = {
  // A1
  PASS_BANNER_RE,
  PASS_MARKERS,
  NOOP_STREAK_THRESHOLD,
  PASS_HUNG_AFTER_HOURS,
  classifyUnterminated,
  parsePassLog,
  classifyPass,
  noOpStreak,
  // A2
  STAGE_THRESHOLDS,
  RESIDENCY_PROXY_NOTE,
  stageResidency,
  // B1
  IN_FLIGHT_STATUSES,
  TERMINAL_STATUSES,
  isTerminalStatus,
  CLICKUP_URL_RE,
  indexPrsByTicket,
  driftFindings,
  // report
  COMPLETION_MARKER,
  bottleneckSentence,
  describeBreakdown,
  formatDuration,
  formatReport,
  tally,
  exitCodeFor,
};
