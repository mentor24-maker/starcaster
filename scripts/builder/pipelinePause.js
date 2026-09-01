'use strict';

/**
 * pipelinePause — is the pipeline running, or has the operator taken the deck?
 *
 * WHY THIS EXISTS (2026-08-25, task 86bbmfc15). Dane: "what I need is an
 * 'emergency shutdown' of the pipeline that clears the decks so I can run a
 * priority task through on the MacBook."
 *
 * The gap is real. There is the loop lane — specced, built, reviewed, merged,
 * roughly a day end to end — and there is nothing else. So when something is
 * urgent the only option is to step outside the system entirely, into the one
 * place where none of the guards apply. That is a MISSING LANE, not an
 * operator being careless, and the fix is to make going fast a sanctioned
 * move with a switch rather than an improvisation.
 *
 * Four properties, each of which the design turns on:
 *
 *   IT DRAINS, IT DOES NOT KILL. Stopping a pass mid-build strands its ticket
 *   in "Building" forever — the loops claim only from "Rework" and "Queued" — and
 *   that happened twice in the week this was written. So a pause stops new
 *   CLAIMS immediately and lets work in flight finish.
 *
 *   EVERY ACTOR ASKS, NOT JUST THE LOOPS. A pause only the loops respected
 *   would not have prevented what it was written for: the session that merged
 *   PR #432 was a hand-driven one and would never have looked. So the flag
 *   lives in ClickUp, where every actor already is, and is checked the way
 *   `node:owns` is checked — asked every time, never remembered.
 *
 *   IT FAILS SAFE. Cannot read the flag -> treated as PAUSED. The two costs
 *   are not symmetric: wrongly running means colliding with whatever the
 *   operator is doing on the deck, and wrongly pausing means idle machines
 *   and a loud message. `wipCap` deliberately fails the other way and says so;
 *   this one is a correctness guard, not a throughput optimisation.
 *
 *   IT CANNOT BE FORGOTTEN. A pause left on is indistinguishable from a broken
 *   pipeline, which is precisely the confusion that cost most of 2026-08-25.
 *   So it announces itself after two hours and keeps saying so hourly.
 *
 * Pure and time-injected on purpose, like loopNote and mergeOnComment: every
 * verdict below is a function of a comment list and a clock, so the whole
 * decision surface — including the fail-safe — is testable with no network,
 * no ClickUp token and no waiting. The plumbing that carries these decisions
 * out lives in scripts/pipeline.mjs and scripts/clickup_direct.mjs.
 */

/**
 * The state lives as a trail of comments on ONE ClickUp task — the pause
 * switch. Comments, not a status or a custom field, for three reasons:
 *
 *   - they are append-only, so the record says who paused, when, and why,
 *     and a later reader can reconstruct the whole history;
 *   - task comments were the single most reliable write in this API through
 *     the sixteen-hour chat outage of 2026-08-23 (see busRelayPlan.js), and a
 *     switch that cannot be read is a pipeline that stops;
 *   - a STATUS on that ticket would put it inside bus-relay's watches and the
 *     loops' claim query, where a pause switch has no business being.
 *
 * Markers are line-anchored whole-line prefixes so prose that merely mentions
 * one ("I paused it earlier") can never be mistaken for a record. Same
 * discipline as MERGE_MARKER and BUS_RELAY_MARKER.
 */
const PAUSE_MARKER = '[pipeline] PAUSED';
const RESUME_MARKER = '[pipeline] RUNNING';
const NAG_MARKER = '[pipeline] STILL PAUSED';

/** The reserved name of the switch task, when it is resolved by name rather
 *  than by CLICKUP_PAUSE_TASK. Matched trimmed and case-insensitively. */
const SWITCH_TASK_NAME = 'Pipeline pause switch';

/** Two hours before the first nag, hourly after that (acceptance criterion 5). */
const NAG_AFTER_MS = 2 * 60 * 60 * 1000;
const NAG_EVERY_MS = 60 * 60 * 1000;

/**
 * How long a ticket may sit in a machine status untouched before it is
 * treated as STRANDED rather than in flight.
 *
 * Generous on purpose. A build pass stamps its Loop note when it claims and
 * then says nothing until the PR is open, which is routinely half an hour of
 * real work; calling that "stranded" and yanking the ticket back into the claim line
 * would hand the same job to a second builder. Ninety minutes is longer than
 * any pass observed to date and far shorter than "forever", which is what the
 * two stranded tickets of 2026-08-25 actually got.
 */
const STRANDED_AFTER_MS = 90 * 60 * 1000;

/** The statuses a pass in flight can hold, and what kind of pass it is. */
const IN_FLIGHT_STATUSES = { building: 'a build', 'in review': 'a review' };

/**
 * The Loop note a review pass stamps when it claims a ticket to check —
 * IMPORTED, never re-typed. A hand copy would drift the first time the note
 * was reworded, and the drain would then see a live review as a resting
 * ticket. loopNote.js is the one source (it is pure, so this file stays pure).
 */
const { REVIEW_CLAIM_NOTE } = require('./loopNote.js');

/**
 * The register the operator reads. The RECORD keeps a machine-precise ISO
 * instant — the read-back that proves a write stuck depends on it being exact
 * — but nothing a person is shown should say "2026-08-25T23:02:10.656Z". He
 * is not a career programmer and the repo's first standing rule is to say
 * things in the language he actually uses (CLAUDE.md, "Coach the operator").
 */
function humanTime(ms) {
  if (!Number.isFinite(Number(ms))) return null;
  return new Date(Number(ms)).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function line(label, value) {
  return value == null || value === '' ? null : `${label}: ${value}`;
}

/**
 * One record, in the shape the parser below reads back. Writer and reader are
 * in the same file for the same reason MERGE_MARKER is: two copies of a wire
 * format are two formats, and they drift the first time one is edited.
 */
function record(marker, { by, node, at, why } = {}) {
  return [
    marker,
    line('by', by),
    line('node', node),
    line('at', at),
    line('why', why),
  ].filter(Boolean).join('\n');
}

function pauseRecord(fields) { return record(PAUSE_MARKER, fields); }
function resumeRecord(fields) { return record(RESUME_MARKER, fields); }
function nagRecord(fields) { return record(NAG_MARKER, fields); }

const FIELD_RE = /^(by|node|at|why):\s*(.*)$/i;

/**
 * Read one comment back into a record, or null if it is not one.
 *
 * The marker must be the comment's FIRST line. A record is a machine's own
 * write; anything that merely quotes one — a relayed bus message, someone
 * pasting the trail into a note — is prose and must not steer the pipeline.
 */
function parseRecord(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const head = String(lines[0] || '').trim();
  const kind = head === PAUSE_MARKER ? 'paused'
    : head === RESUME_MARKER ? 'running'
      : head === NAG_MARKER ? 'nag'
        : null;
  if (!kind) return null;
  const out = { kind, by: '', node: '', at: '', why: '' };
  for (const raw of lines.slice(1)) {
    const m = FIELD_RE.exec(String(raw).trim());
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

function commentDate(c) {
  const n = Number(c && c.date);
  return Number.isFinite(n) ? n : 0;
}

/** Newest first, by ClickUp's own comment timestamp. */
function byDateNewestFirst(comments) {
  return (Array.isArray(comments) ? comments.slice() : [])
    .sort((a, b) => commentDate(b) - commentDate(a));
}

/**
 * The trail reduced to a state: the NEWEST pause-or-resume record wins, and
 * the newest nag tells the announcer when it last spoke.
 *
 * Deliberately "newest wins" rather than "any pause anywhere": a switch that
 * could only ever be turned on would be a pipeline with an off button and no
 * on button.
 */
function readTrail(comments) {
  const sorted = byDateNewestFirst(comments);
  let state = null;
  let lastNagAt = null;
  let sawNag = false;
  for (const c of sorted) {
    const rec = parseRecord(c && c.comment_text);
    if (!rec) continue;
    if (rec.kind === 'nag') {
      sawNag = true;
      if (lastNagAt == null) lastNagAt = commentDate(c) || Date.parse(rec.at) || null;
      continue;
    }
    if (!state) {
      state = {
        paused: rec.kind === 'paused',
        by: rec.by,
        node: rec.node,
        why: rec.why,
        at: rec.at,
        atMs: commentDate(c) || Date.parse(rec.at) || null,
      };
    }
    // Keep scanning: a nag older than the newest state record is still the
    // last thing the announcer said, and stopping here would re-announce a
    // pause every single pass.
  }
  return { state, lastNagAt, sawNag };
}

/**
 * THE GUARD. Every actor calls this before claiming a ticket or merging.
 *
 * Returns a verdict rather than exiting, for the same reason `checkRole` does:
 * a background loop should say so and exit 0, while a command someone just
 * typed should refuse out loud.
 *
 *   code 0 — running, go ahead
 *   code 3 — paused. A NORMAL outcome, the same shape as "another machine owns
 *            this job": claim nothing, write nothing, say so once.
 *
 * There is no third code. An unreadable switch returns 3 as well, because the
 * whole point is that "we could not check" and "it is paused" must lead to the
 * same behaviour — while never being described in the same words.
 */
function pauseVerdict({ readable = true, why = '', switchFound = true, comments = [] } = {}) {
  if (!readable) {
    return {
      paused: true,
      certain: false,
      code: 3,
      message:
        'Could not read the pipeline pause switch, so the pipeline is being treated as PAUSED.\n' +
        // On its own line: the reason is sometimes several lines long (see
        // pipelinePauseStore's 401 hint), and folded into a parenthesis it
        // ran straight into the next sentence.
        `Reason: ${why || 'unknown'}\n\n` +
        'That is deliberate and it is not symmetric: running when the operator has the deck collides with\n' +
        'whatever he is doing there, while pausing when he does not costs idle machines and this message.\n' +
        'Fix the read (network, token, the switch ticket) and everything starts again on its own.',
    };
  }

  if (!switchFound) {
    return {
      paused: false,
      certain: true,
      code: 0,
      message:
        'The pipeline is RUNNING — no pause switch exists, so it has never been paused.\n' +
        `(\`npm run pipeline -- pause\` creates the switch ticket "${SWITCH_TASK_NAME}" the first time it is used.)`,
    };
  }

  const { state, sawNag } = readTrail(comments);

  // A NAG with no state record behind it means the read was TRUNCATED, not
  // that the pipeline is running. A nag is only ever written while paused, so
  // seeing one without the pause it refers to proves the trail is incomplete —
  // and an incomplete trail must fail the same way an unreadable one does.
  //
  // This is the belt behind the braces. The braces are the paged read in
  // pipelinePauseStore; on 2026-08-26 an unpaged one lost the pause record
  // after roughly 25 hourly nags and reported the pipeline RUNNING. If the
  // paging is ever wrong again, this catches it in the safe direction.
  if (!state && sawNag) {
    return {
      paused: true,
      certain: false,
      truncated: true,
      code: 3,
      message:
        'The pipeline pause switch is being treated as PAUSED: its record is INCOMPLETE.\n' +
        'The switch carries a "still paused" reminder but not the pause it refers to, and a reminder is only\n' +
        'ever written while the line is off — so part of the trail was not read.\n\n' +
        'Claim nothing and merge nothing until `npm run pipeline -- status` gives a straight answer.',
    };
  }

  if (!state || !state.paused) {
    return {
      paused: false,
      certain: true,
      code: 0,
      message: state
        ? `The pipeline is RUNNING — resumed${state.by ? ` by ${state.by}` : ''}${state.at ? ` at ${humanTime(state.atMs) || state.at}` : ''}.`
        : 'The pipeline is RUNNING — the switch exists but carries no pause record.',
    };
  }

  return {
    paused: true,
    certain: true,
    code: 3,
    since: state.at,
    sinceMs: state.atMs,
    by: state.by,
    node: state.node,
    reason: state.why,
    message:
      `The pipeline is PAUSED${state.by ? ` — ${state.by} has the deck` : ''}${state.at ? ` (since ${humanTime(state.atMs) || state.at})` : ''}.\n` +
      (state.why ? `Why: ${state.why}\n` : '') +
      'Claim nothing and merge nothing. This is a normal outcome, not a failure — say so once and stop.\n' +
      'Only the operator resumes: `npm run pipeline -- resume --operator-asked`.',
  };
}

/**
 * Is a ticket in a machine status a pass in flight, or one that was stranded?
 *
 * The distinction is the whole of acceptance criterion 7. A pass in flight
 * must be waited for; a stranded ticket must be handed back to a claimable
 * status, because nothing will ever pick it up again on its own. WHICH
 * claimable status is `strandedBuildDestination`'s call, not this one's.
 */
function classifyTicket(task, { nowMs, strandedAfterMs = STRANDED_AFTER_MS } = {}) {
  const status = String(task?.status?.status || task?.status || '').toLowerCase();
  const kind = IN_FLIGHT_STATUSES[status];
  if (!kind) return null;

  // "In review" is a resting status as well as a working one: a ticket waits
  // there for a review pass to pick it up. Only one carrying the review claim
  // note has a pass actually running on it.
  if (status === 'in review' && !String(task.loopNote || '').startsWith(REVIEW_CLAIM_NOTE)) return null;

  const updated = Number(task.date_updated);
  const age = Number.isFinite(updated) && Number.isFinite(nowMs) ? nowMs - updated : null;
  const stranded = age != null && age > strandedAfterMs;
  return {
    id: String(task.id),
    name: String(task.name || ''),
    status: task?.status?.status || status,
    kind,
    ageMs: age,
    stranded,
  };
}

/** Everything a drain is waiting on, split into the two cases. */
function inFlight(tasks, opts = {}) {
  const rows = (Array.isArray(tasks) ? tasks : [])
    .map((t) => classifyTicket(t, opts))
    .filter(Boolean);
  return {
    working: rows.filter((r) => !r.stranded),
    stranded: rows.filter((r) => r.stranded),
  };
}

/** "1 build and 1 review", for a sentence a person reads. */
function describeTickets(rows) {
  if (!rows.length) return 'nothing';
  return rows.map((r) => `${r.kind} on ${r.id} ("${r.name}")`).join(', ');
}

/**
 * What `pause` reports when it stops waiting, and whether that is a clean
 * stop. It must never return a promise it has not kept — "the decks are
 * clear" said over a running build is the one sentence this command cannot
 * be allowed to say.
 *
 *   ended 'clear'    nothing is claiming and nothing is mid-build. Exit 0.
 *   ended 'left'     --now was used. Names exactly what was left running.
 *   ended 'timeout'  waited the full budget and work is still in flight.
 *
 * Both non-clear endings exit 3, deliberately the same code as "paused":
 * claiming HAS stopped in all three cases, which is what a caller acts on.
 */
function drainReport({ ended, working = [], stranded = [], waitedMs = 0, budgetMs = 0 } = {}) {
  const waitedMin = Math.round(waitedMs / 60000);
  const strandedLine = stranded.length
    ? `\n${stranded.length} ticket(s) look STRANDED rather than busy (nothing has touched them in a long while): ` +
      `${describeTickets(stranded)}.\nThey are not being waited for. \`npm run pipeline -- resume --operator-asked\` puts them right.`
    : '';

  if (ended === 'clear') {
    const waited = waitedMin ? ` (waited ${waitedMin} min)` : '';
    // "The decks are clear" is the one sentence this command must never say
    // loosely: the operator reads it and goes to work on the deck. Nothing
    // MOVING is not the same as nothing THERE — a ticket is reclassified as
    // stranded merely by being untouched for 90 minutes, and a CI wait passes
    // that routinely, so a live build can be sitting in the stranded column.
    // Say what is true instead of reaching for the reassuring word.
    return {
      clear: true,
      code: 0,
      message: stranded.length
        ? `Pipeline PAUSED and nothing is still moving${waited} — but the decks are NOT empty.${strandedLine}`
        : `Pipeline PAUSED and the decks are clear — nothing is claiming and nothing is mid-build${waited}.`,
    };
  }

  if (ended === 'left') {
    return {
      clear: false,
      code: 3,
      message:
        'Pipeline PAUSED immediately (--now), so the decks are NOT clear.\n' +
        `Still in flight, and left running: ${describeTickets(working)}.\n` +
        'Each will finish on its own and hand its ticket on; nothing will claim anything new.' +
        strandedLine,
    };
  }

  return {
    clear: false,
    code: 3,
    message:
      `Pipeline PAUSED, but the decks did NOT clear within ${Math.round(budgetMs / 60000)} minutes.\n` +
      `Still in flight: ${describeTickets(working)}.\n` +
      'Nothing new can be claimed, so it is safe to work — but a pass is still running, and if it is\n' +
      'writing to the repo you are about to touch, wait for it or check what it is doing.' +
      strandedLine,
  };
}

/**
 * Should the announcer say something this pass?
 *
 * Two hours of silence, then hourly. The threshold is not politeness: a pause
 * nobody remembers looks exactly like a pipeline that has broken, and telling
 * those two apart cost most of a day on 2026-08-25.
 */
function nagDecision({ paused, sinceMs, lastNagAt, nowMs, afterMs = NAG_AFTER_MS, everyMs = NAG_EVERY_MS } = {}) {
  if (!paused) return { post: false, reason: 'the pipeline is running' };
  if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) {
    return { post: false, reason: 'no readable pause time to measure from' };
  }
  const heldFor = nowMs - sinceMs;
  if (heldFor < afterMs) {
    return { post: false, reason: `paused ${Math.round(heldFor / 60000)} min — under the ${Math.round(afterMs / 60000)} min threshold` };
  }
  if (Number.isFinite(Number(lastNagAt)) && Number(lastNagAt) > 0) {
    const sinceNag = nowMs - Number(lastNagAt);
    if (sinceNag < everyMs) {
      return { post: false, reason: `last said ${Math.round(sinceNag / 60000)} min ago — hourly` };
    }
  }
  return { post: true, reason: 'paused past the threshold and due to say so', heldMs: heldFor };
}

/** What the announcer actually says on the party line. */
function nagMessage({ by, why, sinceMs, nowMs } = {}) {
  const hours = Number.isFinite(sinceMs) && Number.isFinite(nowMs)
    ? Math.max(1, Math.round((nowMs - sinceMs) / 3600000))
    : null;
  return '[CC-starcaster] The build pipeline is still PAUSED' +
    (hours ? ` — ${hours} hour${hours === 1 ? '' : 's'} now` : '') +
    (by ? `, paused by ${by}` : '') + '.' +
    (why ? `\nWhy: ${why}` : '') +
    '\nNothing is being claimed, reviewed or merged while it is off.' +
    '\nResume with: npm run pipeline -- resume --operator-asked';
}

/** What it says once, when the deck goes back. */
function resumedMessage({ by, pausedForMs, swept = [] } = {}) {
  const mins = Number.isFinite(pausedForMs) ? Math.round(pausedForMs / 60000) : null;
  return '[CC-starcaster] The build pipeline is RUNNING again' +
    (by ? `, resumed by ${by}` : '') +
    (mins != null ? ` after ${mins} min paused` : '') + '.' +
    (swept.length
      ? `\n${swept.length} ticket(s) whose pass had died were unstuck: ${swept.join(', ')}.`
      : '\nNothing was left stranded.');
}

/**
 * Where a stranded BUILD belongs — `Rework` or `Queued`.
 *
 * WHY THE DISTINCTION (2026-08-31, task 86bbr1u9v). Both statuses are claimable
 * by loop-build, so this is not about visibility. It is about ORDER and about
 * telling the truth: rework drains first, because a half-built ticket has a
 * branch, a PR and review notes already, and every day it waits costs another
 * catch-up merge against a moving `main`. Sweeping a half-built ticket into
 * `Queued` puts it back at the end of the priority contest it has already been
 * losing — the exact staleness the Rework status was created to end.
 *
 * It takes `buildStart.resolveBuildStart`'s answer rather than re-deriving one,
 * so the sweep and the next build pass can never disagree about whether work
 * exists. The three answers map cleanly:
 *
 *   continue  an OPEN PR — half-built, so Rework
 *   fresh     no PR at all, or one already merged/closed — genuinely new work
 *   unknown   a PR is named but its state could not be read
 *
 * `unknown` goes to REWORK, and that is the safe direction here rather than a
 * contradiction of buildStart's "never guess": buildStart refuses because the
 * cost of guessing wrong is a duplicate branch, which is a correctness problem.
 * Here the ticket is going to a claimable status either way and `build-start`
 * will ask the same question again before a line is written — so the only thing
 * at stake is which queue it waits in, and a ticket that NAMES a PR belongs
 * with the half-built ones. The caller says out loud that it could not read the
 * state.
 */
function strandedBuildDestination(buildStartAction) {
  switch (String(buildStartAction || '')) {
    case 'continue':
      return { status: 'Rework', why: 'its pull request is still open, so this is half-built work to be finished' };
    case 'unknown':
      return { status: 'Rework', why: 'it names a pull request whose state could not be read — a ticket that names a PR belongs with the half-built work' };
    case 'fresh':
      return { status: 'Queued', why: 'nothing has been built for it that a new branch would duplicate' };
    default:
      // An answer nobody anticipated is not a licence to pick one. Rework is
      // the conservative choice for the same reason `unknown` is: it cannot
      // lose work, only order it ahead of fresh tickets.
      return { status: 'Rework', why: `the build-start check answered "${buildStartAction}", which is not one of its three answers — treated as half-built rather than guessed away` };
  }
}

/**
 * The note left on a ticket the sweep unstuck.
 *
 * A returned ticket with no explanation is how a builder rebuilds work that
 * was already half done. Say what happened and what the next pass should
 * check before it starts over.
 */
function sweptTicketNote({ at, by, kind = 'a build', destination = 'Queued', why = '' } = {}) {
  const signature = `\n\n(Automatic — pipeline resume${by ? `, ${by}` : ''}${at ? `, ${at}` : ''}.)`;

  // A stranded REVIEW keeps its status. It is already in "In review", which is
  // where a ticket waits for a reviewer; the only thing wrong with it is the
  // stale claim note. Sending it to Queued would throw away a finished build
  // with an open PR and hand the same job to a second builder.
  if (kind === 'a review') {
    return 'Released by the pipeline pause sweep.\n\n' +
      'A review pass claimed this ticket and then ended without leaving a verdict, so it sat here looking ' +
      'like it was being checked when nothing was. **Nothing about the build has changed** — the branch and ' +
      'its PR are exactly as they were, and this ticket stays in "In review" so the next review pass picks ' +
      'it up instead of the work being rebuilt.' + signature;
  }

  const where = String(destination || 'Queued');
  return `Returned to ${where} by the pipeline pause sweep.\n\n` +
    'This ticket was sitting in a machine status with nothing working on it — its pass ended without ' +
    'handing it on, which leaves it invisible to the loops (they only claim from Rework and Queued). ' +
    `It went to **${where}**${why ? ` because ${why}` : ''}. ` +
    'Nothing has been undone: **check for an existing branch and PR before building** ' +
    '(`npm run clickup -- build-start --task <id>`), because part of the work may already be pushed.' +
    signature;
}

/**
 * A numeric command-line option, where ZERO is a real answer.
 *
 * `Number(arg(...)) || DEFAULT` swallows a falsy 0, so `--wait-minutes 0` —
 * "pause, but do not wait for the drain" — silently waited the full half hour
 * instead (found in review, PR #434). Only a MISSING or unparseable value may
 * fall back to the default; a supplied 0 means 0.
 *
 * Here rather than in pipeline.mjs so it can be driven in `node --test`: the
 * command itself exits before argv parsing unless a live token is present.
 */
function numericOption(argv, name, fallback) {
  const list = Array.isArray(argv) ? argv : [];
  const i = list.indexOf(`--${name}`);
  const raw = i !== -1 && list[i + 1] && !String(list[i + 1]).startsWith('--') ? list[i + 1] : null;
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Who may resume.
 *
 * The pipeline may be paused by anyone — an agent that finds itself about to
 * collide with the operator should be able to stop the line. Resuming is the
 * opposite: it hands the deck back, and only the person standing on it knows
 * whether he is finished. So `resume` refuses unless the caller states, on the
 * record, that the operator asked for it.
 *
 * This is the same `--operator-asked` claim the Urgent-priority guard uses,
 * and it is honest about what it is: an agent CAN type the flag, exactly as it
 * can type it to file an Urgent ticket. What makes it a real control is that
 * every resume is written to the switch's own trail with the machine name and
 * announced on the party line, so a resume nobody authorized is visible within
 * minutes rather than never. Prevention where it is possible, evidence where
 * it is not (DOCTRINE §3.11).
 */
function resumeAuthorization({ operatorAsked } = {}) {
  if (operatorAsked) return { allowed: true, message: 'Resuming on the operator\'s say-so (--operator-asked). Recorded on the switch and announced on the party line.' };
  return {
    allowed: false,
    code: 2,
    message:
      'Refusing to resume: only the operator takes the pipeline off pause.\n' +
      'An agent may pause the line — that is a safety move anyone should be able to make — but it may not\n' +
      'hand the deck back, because only the person working on it knows whether he is finished.\n' +
      'If Dane has said to resume, re-run with --operator-asked. That claim is recorded on the switch ticket\n' +
      'with this machine\'s name and announced on the party line, so it is checkable afterwards.',
  };
}

module.exports = {
  humanTime,
  PAUSE_MARKER,
  RESUME_MARKER,
  NAG_MARKER,
  SWITCH_TASK_NAME,
  NAG_AFTER_MS,
  NAG_EVERY_MS,
  STRANDED_AFTER_MS,
  REVIEW_CLAIM_NOTE,
  pauseRecord,
  resumeRecord,
  nagRecord,
  parseRecord,
  readTrail,
  pauseVerdict,
  classifyTicket,
  inFlight,
  describeTickets,
  drainReport,
  nagDecision,
  nagMessage,
  resumedMessage,
  strandedBuildDestination,
  sweptTicketNote,
  resumeAuthorization,
  numericOption,
};
