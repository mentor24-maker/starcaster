#!/usr/bin/env node
/**
 * pipeline.mjs — the sanctioned way to clear the decks and go fast.
 *
 *   npm run pipeline -- status                    is the line running, and if not, since when and who
 *   npm run pipeline -- check                     the same question, for a machine: 0 = running, 3 = paused
 *   npm run pipeline -- pause [--now] [--why "…"] stop new claims, wait for work in flight to finish
 *   npm run pipeline -- resume --operator-asked   hand the deck back, and sweep up anything stranded
 *
 * THE `--` IS NOT OPTIONAL. Without it npm swallows every `--flag` before this
 * script ever sees it: `resume --operator-asked` is then refused for missing
 * the very flag that was typed, and `pause --now` silently waits the full half
 * hour. Every documented form in this repo carries it, and pipelinePause.test.js
 * fails if one ever loses it again (found in review, PR #434).
 *
 * WHY (2026-08-25, task 86bbmfc15). Until now there was the loop lane —
 * specced, built, reviewed, merged, about a day end to end — and nothing else.
 * When something was urgent the only option was to step outside the system,
 * into the one place where none of the guards apply. This is the missing lane:
 * a switch that stops the machines cleanly, is visible to every actor rather
 * than only the loops, fails safe, and refuses to be forgotten.
 *
 * It DRAINS, it does not kill. Killing a pass mid-build strands its ticket in
 * "Building" forever, because the loops only claim from "Rework" and "Queued" — that
 * happened twice in the week this was written. So `pause` stops new claims the
 * instant it writes the flag, then waits for what is already running.
 *
 * Every decision lives in scripts/builder/pipelinePause.js (pure, tested,
 * no network). This file is only the plumbing that carries them out.
 *
 * The token is Doppler's; the `pipeline` npm script wraps this in `doppler run`, and
 * nothing here prints or logs it (DOCTRINE 4.1).
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import pipelinePause from './builder/pipelinePause.js';
import buildStart from './builder/buildStart.js';
import pipelinePauseStore from './builder/pipelinePauseStore.js';
import nodeRoles from '../lib/nodeRoles.js';

const {
  SWITCH_TASK_NAME, STRANDED_AFTER_MS,
  pauseRecord, resumeRecord, readTrail, pauseVerdict,
  inFlight, describeTickets, strandedExplanation, drainReport,
  resumedMessage, sweptTicketNote, sweptSummary, sweepExitCode, resumeAuthorization, numericOption,
  humanTime, humanDuration,
  strandedBuildDestination,
} = pipelinePause;
const { resolveBuildStart, prLookupArgs } = buildStart;
// The switch is READ in exactly one place, shared with bus-relay, so the two
// can never hold different ideas of where the flag is or what counts as
// unreadable (pipelinePauseStore.js says why that matters).
const { readSwitch: storeReadSwitch, fetchQueue: storeFetchQueue, loopNoteOf, whyOf } = pipelinePauseStore;

const TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
/** Set this once the switch ticket exists and every read is a single GET. */
const PAUSE_TASK = process.env.CLICKUP_PAUSE_TASK || '';
/** The status the switch ticket rests in: outside every claim query and every
 *  bus-relay watch, so a pause switch can never be mistaken for work. */
const SWITCH_STATUS = process.env.CLICKUP_PAUSE_TASK_STATUS || 'Live';

const DEFAULT_WAIT_MINUTES = 30;
const DEFAULT_POLL_SECONDS = 20;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }

/** A numeric option, where ZERO is a real answer — the rule and its reasoning
 *  live in pipelinePause.js, which is where it can be tested. */
function num(name, fallback) { return numericOption(process.argv, name, fallback); }

function usage(code = 2) {
  console.error('Usage: npm run pipeline -- <status|check|sweep|pause|resume> [options]');
  console.error('  (the `--` is required — without it npm eats every flag before this script sees it)');
  console.error('  status                          plain English: running or paused, since when, by whom, what is in flight');
  console.error('  check                           for a machine: exit 0 = running, 3 = paused (or unreadable, which counts as paused)');
  console.error('  sweep [--apply] [--by NAME] [--stranded-after-minutes N]');
  console.error('                                  hand back tickets whose pass died — a build with an open PR to Rework, an');
  console.error('                                  unstarted one to Queued, a review released where it stands. Runs whether the');
  console.error('                                  pipeline is running or paused. DRY RUN unless --apply.');
  console.error('                                  exit 0 = clean, 1 = something could not be unstuck, 2 = the queue could not');
  console.error('                                  be read (never 0 — "could not tell" is not an all-clear), 3 = a dry run found');
  console.error('                                  work and did not act.');
  console.error('  pause [--now] [--why "..."] [--by NAME] [--wait-minutes N]');
  console.error('                                  stop new claims immediately, then wait for work in flight to finish.');
  console.error('                                  --now skips the wait and names exactly what it left running.');
  console.error('  resume --operator-asked [--by NAME] [--no-sweep]');
  console.error('                                  hand the deck back. Refused without --operator-asked: an agent may pause');
  console.error('                                  the line but may not un-pause the operator\'s deck. Sweeps tickets that');
  console.error('                                  were stranded mid-pass, with a note: a half-built build goes to Rework, an');
  console.error('                                  unstarted one to Queued, and a review is released where it stands so its');
  console.error('                                  finished build is not lost. `sweep` is that same repair on its own.');
  process.exit(code);
}

if (!TOKEN) {
  console.error('CLICKUP_API_TOKEN is not set in this environment.\n');
  console.error('The sanctioned route is Doppler, which already holds the token:');
  console.error('  npm run pipeline -- <command>');
  console.error('Agents never handle the live value by hand (DOCTRINE 4.1).');
  process.exit(2);
}

/** Every request this process makes; reported at the end, like bus-relay's. */
let requestCount = 0;

async function call(method, path, body) {
  requestCount += 1;
  const res = await fetch(`https://api.clickup.com${path}`, {
    method,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a non-JSON error page */ }
  return { res, json, text, ok: res.ok };
}

/** Never throw out of a WRITE either. The store wraps every read it makes;
 *  this is the same shield for the posts and moves below, so a dropped
 *  connection is reported as "the pause did not take" rather than as a stack
 *  trace with an exit code somebody else's script would misread. */
async function tryCall(method, path, body) {
  try {
    return await call(method, path, body);
  } catch (err) {
    return { res: { status: 0, ok: false }, json: null, text: '', ok: false, threw: String(err && err.message) };
  }
}

/**
 * Has anything already been BUILT for this stranded ticket?
 *
 * The same question `npm run clickup -- build-start` answers, through the same
 * module, so the sweep and the next build pass cannot reach different
 * conclusions about the same ticket. Two readings: the ticket's comments (for
 * the `PR opened:` trail loop-build writes) and `gh` (for that PR's state).
 *
 * Everything that can fail here resolves to an ANSWER rather than an exception
 * — a resume must never die half-swept — and `resolveBuildStart` already has a
 * name for "a PR is named but its state is unreadable": `unknown`. Where that
 * answer sends the ticket, and why, is `pipelinePause.strandedBuildDestination`.
 */
async function buildStartFor(taskId) {
  const seen = await tryCall('GET', `/api/v2/task/${taskId}/comment`);
  // A comment list we could not read is NOT "no comments" — that would report
  // a half-built ticket as fresh, which is the direction that loses work
  // (DOCTRINE 3.11). No readable trail at all means no PR is named, so
  // resolveBuildStart's own `fresh` is not reachable from a failed read: say
  // unknown instead.
  if (!seen.ok || !Array.isArray(seen.json?.comments)) {
    return { action: 'unknown', why: `this ticket's comments could not be read (${whyOf(seen)})` };
  }
  return resolveBuildStart(seen.json.comments, {
    // --repo, ALWAYS (task 86bbqyyfn). This is the second copy of the bug the
    // ticket was filed for: `resume` unsticks stranded builds by asking the
    // same question, and it was asking it of whichever repo the process
    // happened to be running in.
    lookupPr: (pr) => {
      try {
        const out = execFileSync('gh', prLookupArgs(pr), {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        return JSON.parse(out);
      } catch {
        // null, not a guess — resolveBuildStart turns it into `unknown`.
        return null;
      }
    },
  });
}

function thisNodeName() {
  const n = nodeRoles.thisNode();
  return n.name || 'an unidentified machine';
}

/** Find the switch and read its trail — see pipelinePauseStore for the three
 *  outcomes and why "could not read" and "no switch" must never be conflated. */
function readSwitch(opts = {}) {
  return storeReadSwitch({ call, list: LOOP_QUEUE_LIST, pauseTaskId: PAUSE_TASK, ...opts });
}

function fetchQueue() {
  return storeFetchQueue({ call, list: LOOP_QUEUE_LIST });
}

/** The verdict, from whatever the read managed to establish. */
function verdictFrom(sw) {
  return pauseVerdict({
    readable: sw.readable,
    why: sw.why,
    switchFound: sw.switchFound,
    comments: sw.comments || [],
  });
}

/** Post a record onto the switch and prove it stuck. A 200 is not evidence
 *  (DOCTRINE 3.10), and a pause that reports success without landing is worse
 *  than one that fails loudly — the operator would go and work on the deck. */
async function writeRecord(taskId, text, label, at) {
  const out = await tryCall('POST', `/api/v2/task/${taskId}/comment`, { comment_text: text, notify_all: false });
  if (!out.ok) {
    console.error(`\n${label} FAILED — the record could not be written (${whyOf(out)}).`);
    console.error('Nothing has changed. Do NOT treat the pipeline as paused.');
    process.exit(1);
  }
  // Find THIS write, not merely a record of the same kind. The `at:` line
  // carries an ISO instant unique to this call — the same lesson as
  // busRelayPlan's receipt signature, where a constant fingerprint let a
  // leftover comment from an earlier outage "verify" a POST that never stuck.
  // Deliberately UNPAGED, unlike the state read: this is looking for a comment
  // written a moment ago, and the endpoint answers newest-first, so it is
  // always on page one. Paging here would be extra requests for no answer.
  const back = await tryCall('GET', `/api/v2/task/${taskId}/comment`);
  const stuck = back.ok && (back.json?.comments || []).some((c) => {
    const body = String(c.comment_text || '');
    return body.trim().startsWith(text.split('\n')[0]) && body.includes(`at: ${at}`);
  });
  if (!stuck) {
    console.error(`\n${label} reported success but the record could not be read back.`);
    console.error('Treat the pipeline as being in an UNKNOWN state and run `npm run pipeline -- status`.');
    process.exit(1);
  }
  return true;
}

/** Best effort, loudly reported. The switch's own trail is the durable record;
 *  the party line is the announcement, and it was down for sixteen hours on
 *  2026-08-23 (busRelayPlan.js). A failed announcement must not fail the
 *  command, and must never be silent either. */
async function announce(content) {
  const out = await tryCall('POST', `/api/v3/workspaces/${WORKSPACE}/chat/channels/${BUS_CHANNEL}/messages`, {
    type: 'message', content, content_format: 'text/md',
  });
  if (out.ok) { console.error('  announced on the party line.'); return true; }
  console.error(`  NOT announced on the party line (${whyOf(out)}) — the record is on the switch ticket instead.`);
  return false;
}

/** Best effort, loudly reported. The field is created once by hand in ClickUp;
 *  a missing one is a note nobody gets, never a pause that did not happen. */
async function stampSwitchNote(task, text) {
  const field = (task?.custom_fields || []).find((f) => String(f.name || '').trim().toLowerCase() === 'loop note');
  if (!field) { console.error('  (no "Loop note" field on this list — the queue will not show the state at a glance)'); return; }
  const out = await tryCall('POST', `/api/v2/task/${task.id}/field/${field.id}`, { value: text });
  if (!out.ok) console.error(`  (could not stamp the Loop note — ${whyOf(out)})`);
}

/** Wipe a ticket's Loop note, and say whether it actually went. Used to
 *  release a ticket whose review pass died: the note is the claim, so clearing
 *  it IS the release. Verified by reading the write's own response back — a
 *  200 that did not stick would leave the ticket looking taken forever. */
async function clearLoopNote(task) {
  const field = (task?.custom_fields || []).find((f) => String(f.name || '').trim().toLowerCase() === 'loop note');
  if (!field) return true; // no field on this list — nothing is claiming by note either
  const out = await tryCall('POST', `/api/v2/task/${task.id}/field/${field.id}`, { value: '' });
  return Boolean(out.ok);
}

/** One formatter for the whole feature, shared with the verdict wording. */
const fmt = pipelinePause.humanTime;

// ---------------------------------------------------------------------------

/**
 * THE STRANDED-TICKET SWEEP — the one repair for work whose pass died, and
 * until 2026-09-02 it was reachable from nowhere that mattered.
 *
 * It used to live inline in `resume`, BELOW that command's early exit for "the
 * pipeline is already running". So the repair `status` recommends by name could
 * only run as a side effect of lifting a pause — while a ticket strands when a
 * session dies, which happens overwhelmingly while the pipeline is RUNNING. On
 * 2026-09-02 four stranded builds filled four of the five in-flight slots
 * overnight; `status` printed the advice, `resume --operator-asked` answered
 * "Nothing to resume — the pipeline is already running", and changed nothing.
 * A guard placed above the work it protects, never exercised in the state it
 * exists for (DOCTRINE, unreachable guards).
 *
 * So it is a function with a queue passed in, called from two places: `resume`
 * (before the flag is lifted, exactly as before) and the standalone `sweep`
 * command (at any time). `--no-sweep` is now decided by the CALLER, because
 * only `resume` has such a flag — a sweep asked not to sweep is not a thing
 * the sweep needs to know how to be.
 *
 * `apply` is false by default at the command, and the dry run is a real
 * preview: it asks `build-start` the same question and names the same
 * destination, and writes nothing. That default is also the safety property
 * that makes an always-available sweep sound — 90 minutes is longer than any
 * loop pass but NOT longer than a hand-driven fast-track session, which holds
 * a ticket in "Building" for hours without touching it. Nothing moves unless
 * somebody who has read the ages types `--apply`.
 *
 * Returns `{ swept, found, sweepState }`. The three-part report is unchanged
 * and is the reason this is worth reading: `swept` is what moved, `left` is
 * what was examined and could NOT be moved, `checked` is whether the queue was
 * looked at at all. Not looking and finding nothing are different answers
 * (86bbqw49y).
 */
async function sweepStranded({ by, queue, apply = false, strandedAfterMs = STRANDED_AFTER_MS }) {
  // Sweep first, then lift the flag. In this order a ticket that was stranded
  // is back in the line BEFORE the loops start claiming again, so the very
  // next pass can pick it up rather than finding it a minute later.
  // Three things the report needs, and only this loop can know two of them.
  // `swept` is what was unstuck. `left` is what was EXAMINED and could not be —
  // invisible to a summary that is only shown what was taken, which is how an
  // all-clear came to print one line under "it is still stranded" (86bbqw49y).
  // `checked` is whether the queue was looked at at all: not looking and
  // finding nothing are different answers, and only one of them is an
  // all-clear.
  const swept = [];
  const left = [];
  let sweepChecked = false;
  let sweepWhy = '';
  let found = 0;
  if (queue?.readable) {
    sweepChecked = true;
    const rows = (queue.tasks || []).map((t) => ({ ...t, loopNote: loopNoteOf(t) }));
    const { stranded } = inFlight(rows, { nowMs: Date.now(), strandedAfterMs });
    found = stranded.length;
    for (const s of stranded) {
      // WHERE a stranded ticket belongs depends on what died on it.
      //
      // A stranded BUILD has no finished work to protect, so it goes back to
      // Queued and the next build pass picks it up (its `build-start` check
      // finds any half-pushed branch, which is what the note tells it to do).
      //
      // A stranded REVIEW is different: the ticket is already in "In review",
      // which is where a ticket WAITS for a reviewer. All that is wrong with it
      // is the stale claim note saying a review is running. Sending it to
      // Queued would throw away a completed, PR-open build and hand the whole
      // job to a second builder. So it is released where it stands — note
      // cleared, status untouched — and the next review pass claims it.
      const reviewing = s.kind === 'a review';
      // WHERE a stranded build goes depends on whether anything was built for
      // it (task 86bbr1u9v). Asked BEFORE the note is written, because the note
      // names the destination — a note saying "Queued" above a move to "Rework"
      // is a trail that contradicts the board, and the trail is the only thing
      // the next pass reads. Reviews skip it: they never move.
      const dest = reviewing ? { action: 'n/a' } : await buildStartFor(s.id);
      const plan = reviewing ? null : strandedBuildDestination(dest.action);
      // HOW STALE, on every line. The sweep can now be run at any moment
      // rather than only out of a pause, so its reader has to be able to tell
      // a ticket dead since midnight from one a hand-driven session claimed 91
      // minutes ago and is still working on. The threshold cannot make that
      // call for them; the age can.
      const age = s.ageMs != null ? `, untouched for ${humanDuration(s.ageMs)}` : '';

      // A DRY RUN STOPS HERE, having written nothing. It still does the full
      // `build-start` lookup above, because "where would this go" is the whole
      // question the dry run is asked, and answering it from a guess would
      // make the preview a different program from the thing it previews.
      if (!apply) {
        console.error(`  ${s.id} ("${s.name}") WOULD ${reviewing
          ? 'be released where it stands in "In review" — its build is finished and its PR is open'
          : `return to ${plan.status} — ${plan.why}`}; it is ${s.kind} with nothing working on it${age}.`);
        swept.push({ id: s.id, kind: s.kind, destination: reviewing ? 'In review' : plan.status });
        continue;
      }
      const note = await tryCall('POST', `/api/v2/task/${s.id}/comment`, {
        comment_text: sweptTicketNote({
          at: new Date().toISOString(), by, kind: s.kind,
          destination: plan?.status, why: plan?.why,
        }),
        notify_all: false,
      });
      if (!note.ok) {
        console.error(`  ${s.id}: could not write the hand-back note (${whyOf(note)}) — LEAVING it where it is rather than moving it silently.`);
        left.push(s.id);
        continue;
      }

      const task = (queue.tasks || []).find((t) => String(t.id) === s.id);

      if (reviewing) {
        const cleared = await clearLoopNote(task);
        if (!cleared) {
          console.error(`  ${s.id}: the note landed but the stale review claim could NOT be cleared — the next review pass will still see it as taken.`);
          left.push(s.id);
          continue;
        }
        console.error(`  ${s.id} ("${s.name}") released in "In review" — its review pass died${age}, but its build is finished and its PR is open.`);
        swept.push({ id: s.id, kind: s.kind, destination: 'In review' }); // matches the per-ticket line above, verbatim
        continue;
      }

      const rem = (task?.assignees || []).map((a) => a.id);
      const where = plan;
      const move = await tryCall('PUT', `/api/v2/task/${s.id}`, { status: where.status, assignees: { add: [], rem } });
      if (!move.ok || String(move.json?.status?.status || '').toLowerCase() !== where.status.toLowerCase()) {
        console.error(`  ${s.id}: the note landed but the move to ${where.status} did NOT (${whyOf(move)}) — it is still stranded.`);
        left.push(s.id);
        continue;
      }
      console.error(`  ${s.id} ("${s.name}") returned to ${where.status} — it was ${s.kind} with nothing working on it${age}; ${where.why}.`);
      swept.push({ id: s.id, kind: s.kind, destination: where.status });
    }
  } else {
    sweepWhy = 'the queue could not be read';
    console.error('  the queue could not be read, so nothing was swept — run `npm run pipeline -- status` after this.');
  }
  return { swept, found, sweepState: { checked: sweepChecked, left: left.length, why: sweepWhy } };
}

const cmd = process.argv[2];

if (cmd === 'check') {
  // The machine-readable guard. Mirrors `node:owns`: 0 = go ahead, 3 = a
  // normal decline. An unreadable switch returns 3 as well — "we could not
  // check" and "it is paused" must lead to the SAME behaviour, while never
  // being described in the same words.
  const sw = await readSwitch();
  const v = verdictFrom(sw);
  (v.code === 0 ? console.log : console.error)(v.message);
  process.exit(v.code);

} else if (cmd === 'status') {
  const sw = await readSwitch({ withQueue: true });
  const v = verdictFrom(sw);
  console.log(v.message);

  if (sw.readable && sw.switchFound) {
    const { state } = readTrail(sw.comments || []);
    if (state?.paused) {
      console.log('');
      console.log(`paused since:  ${fmt(state.atMs) || state.at}`);
      console.log(`paused by:     ${state.by || '(not recorded)'}`);
      console.log(`from machine:  ${state.node || '(not recorded)'}`);
      console.log(`why:           ${state.why || '(not recorded)'}`);
    }
    console.log('');
    console.log(`switch ticket: ${sw.task.url} (${sw.task.id})`);
    if (loopNoteOf(sw.task)) console.log(`loop note:     ${loopNoteOf(sw.task)}`);
  }

  if (sw.queue?.readable) {
    const rows = (sw.queue.tasks || []).map((t) => ({ ...t, loopNote: loopNoteOf(t) }));
    const { working, stranded } = inFlight(rows, { nowMs: Date.now() });
    console.log('');
    console.log(working.length
      ? `in flight:     ${describeTickets(working)}`
      : 'in flight:     nothing — the decks are clear');
    if (stranded.length) {
      console.log(`STRANDED:      ${describeTickets(stranded)}`);
      // WHY each one is stuck differs by kind, so it is said per kind. A build
      // is stuck because of its status; a review's status is already correct
      // and only its stale claim note is wrong. One reason over both sent a
      // reader hunting for a status problem that was not there (86bbqw49y).
      for (const line of strandedExplanation(stranded)) console.log(`               ${line}`);
      // NOT `resume --operator-asked`. That was the advice here until
      // 2026-09-02 and it is unreachable in the state this line is printed in
      // — `resume` exits early when the pipeline is already running, which is
      // exactly when tickets strand. Telling a reader to run a no-op is worse
      // than saying nothing: they run it, see a calm sentence, and stop.
      console.log('               `npm run pipeline -- sweep` says what would put them right; add `--apply` to do it.');
    }
  } else {
    console.log('\nin flight:     could not be read, so this answer is INCOMPLETE.');
  }
  console.error(`  requests this pass: ${requestCount}`);

} else if (cmd === 'sweep') {
  // The repair, on its own, runnable at ANY time — which is the whole of this
  // command (2026-09-02). It deliberately does NOT ask whether the pipeline is
  // paused: a pause stops claims and merges, and unsticking work that nothing
  // is doing is neither. It says which state it found, because that is context
  // a reader wants, and then sweeps either way.
  //
  // It also does not ask for `--operator-asked`. Resuming is the operator's
  // call because only he knows whether he is finished with the deck; clearing
  // dead work is housekeeping, and housekeeping is the agent's job to do
  // silently (CLAUDE.md). What guards it instead is the dry-run default.
  const apply = flag('apply');
  const by = arg('by', `an agent session on ${thisNodeName()}`);
  // The 90-minute threshold, overridable. It exists so the dry run is a real
  // instrument: without it the only way to see this command find anything is
  // to wait an hour and a half for a pass to die, which is how a sweep ships
  // having never been watched to work. Named in the output whenever it is not
  // the default, because a reading taken with a moved threshold is a different
  // reading and must not be quoted as if it were the standard one.
  const strandedAfterMs = num('stranded-after-minutes', STRANDED_AFTER_MS / 60000) * 60000;
  const sw = await readSwitch({ withQueue: true });
  console.log(verdictFrom(sw).message);
  console.log('');

  if (strandedAfterMs !== STRANDED_AFTER_MS) {
    console.log(`(counting a ticket stranded after ${humanDuration(strandedAfterMs)}, not the usual ${humanDuration(STRANDED_AFTER_MS)})`);
  }
  const { swept, found, sweepState } = await sweepStranded({ by, queue: sw.queue, apply, strandedAfterMs });
  console.log(sweptSummary(swept, { ...sweepState, applied: apply }));

  // Only a sweep that CHANGED something is worth the party line. A dry run is
  // a question somebody asked, and a clean run is the normal case — announcing
  // either is the "all is well ×365" the bus discipline exists to prevent.
  if (apply && swept.length) await announce(resumedMessage({ by, swept, ...sweepState }).replace(
    /^\[CC-starcaster\] The build pipeline is RUNNING again[^\n]*\n/,
    `[CC-starcaster] Stranded work swept by ${by}.\n`,
  ));

  console.error(`  requests this pass: ${requestCount}`);
  process.exit(sweepExitCode({ ...sweepState, found, applied: apply }));

} else if (cmd === 'pause') {
  const now = flag('now');
  const why = arg('why', '');
  const by = arg('by', `an agent on ${thisNodeName()}`);
  const waitMs = Math.max(0, num('wait-minutes', DEFAULT_WAIT_MINUTES)) * 60000;
  const pollMs = Math.max(5, num('poll-seconds', DEFAULT_POLL_SECONDS)) * 1000;

  let sw = await readSwitch({ withQueue: true });
  if (!sw.readable) {
    console.error(`\nCannot pause: the switch could not be read (${sw.why}).`);
    console.error('Refusing to guess. Creating a second switch ticket would leave two flags disagreeing,');
    console.error('which is worse than no flag at all. Fix the read and run this again.');
    process.exit(1);
  }

  // Create the switch the first time it is used. Deliberately in a status
  // outside every claim query and every bus-relay watch — a switch that could
  // be picked up as work would be picked up as work.
  if (!sw.switchFound) {
    console.error(`No switch ticket yet — creating "${SWITCH_TASK_NAME}" in the Loop Queue.`);
    const made = await tryCall('POST', `/api/v2/list/${LOOP_QUEUE_LIST}/task`, {
      name: SWITCH_TASK_NAME,
      status: SWITCH_STATUS,
      description:
        'The pipeline pause switch. Do not build this, do not close it, do not delete it.\n\n' +
        'Its COMMENTS are the flag: the newest `[pipeline] PAUSED` / `[pipeline] RUNNING` record is the state '
        + 'of the whole build pipeline, and every loop, the bus relay and every hand-driven session asks it '
        + 'before claiming a ticket or merging anything.\n\n'
        + 'Run `npm run pipeline -- status` to read it in plain English. Only the operator resumes.',
    });
    if (!made.ok) {
      console.error(`\nCould not create the switch ticket (${whyOf(made)}).`);
      console.error(`If the failure names the status, this list has no "${SWITCH_STATUS}" status — set`);
      console.error('CLICKUP_PAUSE_TASK_STATUS to a status the Loop Queue actually has, one that no loop claims from.');
      process.exit(1);
    }
    sw = await readSwitch({ withQueue: true });
    if (!sw.readable || !sw.switchFound) {
      console.error('\nThe switch ticket was created but could not be read back. Treating the pause as NOT taken.');
      process.exit(1);
    }
  }

  const at = new Date().toISOString();
  await writeRecord(sw.task.id, pauseRecord({ by, node: thisNodeName(), at, why }), 'Pause', at);
  await stampSwitchNote(sw.task, `⏸ PAUSED — ${by} has the deck (since ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '')})`);
  console.error(`Pause recorded on ${sw.task.url} — nothing may claim a ticket or merge from this moment.`);

  // Now drain. Claiming has ALREADY stopped; this is only the wait for work
  // that was already running.
  const startedAt = Date.now();
  let working = [];
  let stranded = [];
  for (;;) {
    const q = await fetchQueue();
    if (!q.readable) {
      console.error(`\nPaused, but the queue could not be read to see what is in flight (${q.why}).`);
      console.error('The pause itself is recorded and holding. Run `npm run pipeline -- status` once the read works.');
      process.exit(3);
    }
    const rows = (q.tasks || []).map((t) => ({ ...t, loopNote: loopNoteOf(t) }));
    ({ working, stranded } = inFlight(rows, { nowMs: Date.now() }));

    if (!working.length) {
      const r = drainReport({ ended: 'clear', working, stranded, waitedMs: Date.now() - startedAt });
      console.log(r.message);
      console.error(`  requests this pass: ${requestCount}`);
      process.exit(r.code);
    }
    if (now) {
      const r = drainReport({ ended: 'left', working, stranded });
      console.log(r.message);
      console.error(`  requests this pass: ${requestCount}`);
      process.exit(r.code);
    }
    if (Date.now() - startedAt >= waitMs) {
      const r = drainReport({ ended: 'timeout', working, stranded, budgetMs: waitMs });
      console.log(r.message);
      console.error(`  requests this pass: ${requestCount}`);
      process.exit(r.code);
    }
    console.error(`  waiting on ${describeTickets(working)} … (checked ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`);
    await sleep(pollMs);
  }

} else if (cmd === 'resume') {
  const auth = resumeAuthorization({ operatorAsked: flag('operator-asked') });
  if (!auth.allowed) { console.error(auth.message); process.exit(auth.code); }
  console.error(auth.message);

  const by = arg('by', `Dane (relayed by an agent on ${thisNodeName()})`);
  const sw = await readSwitch({ withQueue: true });
  if (!sw.readable) {
    console.error(`\nCannot resume: the switch could not be read (${sw.why}).`);
    console.error('Every actor is treating the pipeline as paused right now, which is the safe state.');
    console.error('Fix the read and run this again — nothing has been changed.');
    process.exit(1);
  }
  if (!sw.switchFound) {
    console.log('Nothing to resume — no pause switch exists, so the pipeline has never been paused.');
    process.exit(0);
  }
  const before = readTrail(sw.comments || []).state;
  if (!before?.paused) {
    console.log('Nothing to resume — the pipeline is already running.');
    process.exit(0);
  }

  // Sweep first, then lift the flag. In this order a ticket that was stranded
  // is back in the line BEFORE the loops start claiming again, so the very
  // next pass can pick it up rather than finding it a minute later.
  const { swept, sweepState } = flag('no-sweep')
    ? { swept: [], sweepState: { checked: false, left: 0, why: 'the --no-sweep flag was used' } }
    : await sweepStranded({ by, queue: sw.queue, apply: true });

  const at = new Date().toISOString();
  await writeRecord(sw.task.id, resumeRecord({ by, node: thisNodeName(), at }), 'Resume', at);
  await stampSwitchNote(sw.task, `▶ running — resumed ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '')}`);

  const pausedForMs = Number.isFinite(before.atMs) ? Date.now() - before.atMs : null;
  await announce(resumedMessage({ by, pausedForMs, swept, ...sweepState }));

  // No destination is true of every swept ticket — a half-built one goes to
  // Rework, a fresh one to Queued, and a stranded REVIEW does not move at all.
  // So the summary carries each ticket's own outcome rather than naming one
  // for the group, which is how a released review came to be announced as
  // "returned to Queued" one line under the truth (86bbqw49y).
  //
  // And it is handed `sweepState` because an empty `swept` is three different
  // pieces of news — nothing stranded, a step that failed, or nothing checked —
  // and only the first is an all-clear. The other two used to print one anyway,
  // directly under the stderr line saying the ticket was still stranded.
  console.log(`The pipeline is RUNNING again. ${sweptSummary(swept, sweepState)}`);
  console.error(`  requests this pass: ${requestCount}`);

} else {
  usage();
}
