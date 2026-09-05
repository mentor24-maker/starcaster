'use strict';

/**
 * AM I A SCHEDULED JOB, OR A SESSION DANE IS TALKING TO? (2026-09-04, task
 * 86bbugd8j).
 *
 * The reserve in `clickupLedger.cjs` only means anything if this question has
 * a reliable answer, and the ticket is explicit about how: "make that explicit
 * and testable, not inferred from a tty."
 *
 * WHY NOT A TTY. `process.stdout.isTTY` is false for a headless agent session
 * Dane started and watching, and true for a job someone ran by hand from a
 * terminal to debug it. It answers "is a terminal attached", which is a
 * different question that happens to correlate. The loop lanes settle it: they
 * are unattended launchd jobs whose work is done by a headless Claude session
 * with no tty at all — and so is a `claude -p` session Dane fires off himself.
 *
 * SO IT IS DECLARED. A scheduled job says so, in its launchd wrapper, with an
 * environment variable that every child process inherits:
 *
 *     export STARCASTER_CALLER=scheduled
 *
 * THE DEFAULT IS `interactive`, ON PURPOSE. Getting this wrong in the
 * "scheduled" direction blocks a session Dane is sitting in front of, which is
 * the exact thing the operator's decision forbids: "You are never blocked by a
 * background job." Getting it wrong in the "interactive" direction costs a
 * background job spending a little of the reserve. Those are not symmetric.
 *
 * THE COST OF THAT DEFAULT is that a NEW scheduled job which forgets to
 * declare itself silently never yields — the quiet direction, and the one
 * nobody notices. `SCHEDULED_LAUNCHERS` below is the guard: it is the
 * committed, reviewable list of the wrapper scripts launchd runs unattended,
 * and `scripts/builder/clickupCaller.test.js` fails if any of them does not
 * export the marker. Adding a scheduled job means adding a row here, exactly
 * the way adding an exclusive job means adding a row to `lib/nodeRoles.js` —
 * a commit somebody reviews, not a setting flipped on one machine at 2am.
 */

const KINDS = ['scheduled', 'interactive'];

/**
 * THE REGISTRY — every wrapper script launchd runs on a schedule, and what it
 * is. A row here is a promise that the file exports STARCASTER_CALLER, and a
 * test holds it to that promise.
 */
const SCHEDULED_LAUNCHERS = {
  'run_bus_relay.sh': {
    job: 'bus-relay',
    why: 'Every ten minutes, all day. The heaviest ClickUp spender there is — '
      + 'a measured p90 of 94 requests in a pass — and the one that 429\'d on '
      + '2026-09-03 while reporting itself within budget.',
  },
  'loop_runner.sh': {
    job: 'loop-build / loop-review',
    why: 'Both loop lanes. A headless Claude session on a timer is still a '
      + 'background job: Dane is not talking to it, so it yields like any '
      + 'other. The marker is exported here rather than in the skills, '
      + 'because the child session inherits this environment and a skill '
      + 'cannot be relied on to remember.',
  },
  'run_pipeline_pulse.sh': {
    job: 'pipeline-pulse',
    why: 'Hourly. Reads a lot of tickets to produce its report.',
  },
  'run_weekly_report.sh': {
    job: 'weekly-report',
    why: 'Once a week, but it reads the whole board when it runs.',
  },
};

/**
 * What kind of caller is this?
 *
 *   { kind, source, why }
 *
 * `source` names WHERE the answer came from, so a wrong answer is traceable to
 * the thing that produced it rather than argued about.
 */
function callerKind({ env = process.env } = {}) {
  const declared = String(env.STARCASTER_CALLER || '').trim().toLowerCase();
  if (KINDS.includes(declared)) {
    return { kind: declared, source: 'STARCASTER_CALLER', why: `declared by the environment as "${declared}"` };
  }
  if (declared) {
    // A typo must not read as a declaration. Fall through to the default and
    // SAY SO — a silently ignored setting is how somebody spends an hour
    // wondering why a job never yields.
    return {
      kind: 'interactive',
      source: 'default',
      why: `STARCASTER_CALLER is set to "${declared}", which is not one of ${KINDS.join(' / ')} — ignored, treating this as interactive`,
    };
  }
  return {
    kind: 'interactive',
    source: 'default',
    why: 'nothing declared STARCASTER_CALLER, and the default is interactive so a session Dane is talking to is never blocked',
  };
}

/** Shorthand for the one question every caller of this module actually asks. */
function isScheduled({ env = process.env } = {}) {
  return callerKind({ env }).kind === 'scheduled';
}

module.exports = { KINDS, SCHEDULED_LAUNCHERS, callerKind, isScheduled };
