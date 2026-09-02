#!/usr/bin/env node
/**
 * clickup_direct.mjs — the loops' own door into ClickUp: read the queue,
 * claim a task, move statuses, hand work to and from the operator, comment,
 * and post to the bus — through ClickUp's OWN REST API, bypassing the
 * claude.ai connector.
 *
 * bus-relay (2026-08-18) is the operator-facing half of the same door: a
 * comment he leaves on an open "Agent Response" task is not itself wired to
 * anything (ClickUp has no outbound hook on its own Reply button), so this
 * is the poller that notices it and puts it on the bus where a CC-starcaster
 * session will actually see it. Not real-time by design — run it on a
 * schedule (a `/loop` timer or a scheduled routine), not on every keystroke.
 *
 * Since 2026-08-19 it also watches the Loop Queue, and does one thing more
 * than notify there: an answer on a "needs your input" ticket hands the
 * ticket back to Queued so a build loop picks it up with the answer in its
 * comments. The rules live in scripts/builder/busRelayPlan.js (tested);
 * this file is only the plumbing that carries them out.
 *
 * Since 2026-08-21 (task 86bbjd5nn) it does the same for the other end: a
 * comment on a "ready to launch" ticket that is EXACTLY a merge command,
 * from the operator's own user id, merges the PR — after checking that
 * loop-review passed it, the PR is open, its checks are green and it does
 * not conflict. That is not a loop authorizing its own merge: the
 * authorization is his, and this is only the hour of waiting removed. The
 * decisions live in scripts/builder/mergeOnComment.js (tested, every refusal
 * path included); runMergeStep below is the plumbing.
 *
 * WHY THIS EXISTS (2026-08-17, extended 2026-08-18). The connector enforces a
 * rolling budget shared by every agent session at once. When it is spent,
 * requests fail with junk wait times ("NaN minutes", "207 minutes"), which
 * presents as a random outage. ClickUp's own limits are a different bucket —
 * roughly 100 requests per MINUTE, reset in 60 seconds — far beyond what the
 * loops can use. See DOCTRINE 1.7.
 *
 * The token is read from the environment, never printed and never logged.
 * Agents do not handle the live value (DOCTRINE 4.1). The sanctioned way to
 * supply it is Doppler, which holds it in the `starcaster/dev` config:
 *
 *   npm run clickup -- whoami          # package.json wraps this in doppler run
 *
 * Run `npm run clickup` with no arguments for the full command list; usage()
 * below is the single source of truth for the command surface.
 *
 * Machine-first output contract: data goes to stdout (tab-separated where a
 * caller would parse it); counts, rate-limit lines and diagnostics go to
 * stderr. Piping stdout is always safe.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import loopNoteLib from './builder/loopNote.js';
const { loopNote, heartbeatNote } = loopNoteLib;
import { spawnSync } from 'node:child_process';
import busRelayPlan from './builder/busRelayPlan.js';
import mergeOnComment from './builder/mergeOnComment.js';
import loopTrail from './builder/loopTrail.js';
import buildStart from './builder/buildStart.js';
import operatorCard from './builder/operatorCard.js';
import machineComment from './builder/machineComment.js';
import nodeRoles from '../lib/nodeRoles.js';
import taskRepo from './builder/taskRepo.js';
import loopInterval from './builder/loopInterval.js';
import branchCatchUp from './builder/branchCatchUp.js';
import reviewGate from './builder/reviewGate.js';
import conflictWork from './builder/conflictWork.js';
import wipCap from './builder/wipCap.js';
import loopStatuses from './builder/loopStatuses.js';
import autoMergeLane from './builder/autoMergeLane.js';
import autoMergeLedgerFile from './builder/autoMergeLedgerFile.js';
import workLogPlaceholder from './builder/workLogPlaceholder.js';
import sendBackRounds from './builder/sendBackRounds.js';
import pipelinePause from './builder/pipelinePause.js';
import pipelinePauseStore from './builder/pipelinePauseStore.js';
import waitingOnOperator from './builder/waitingOnOperator.js';
const {
  defaultWatches, handbackTarget, mergeEnabled, operatorComments,
  deliveryVerdict, relayMarkerText, receiptText, isThisReceipt, busFailureBucket,
  SIMULATED_BUS_WHY, simulationGuard, simulationLine,
} = busRelayPlan;
const {
  mergeDecision, githubGate, MERGE_PHRASES, MERGE_MARKER, latestMergeMarker,
  refusalNotice, conflictHandOffNotice, mergedNotice,
} = mergeOnComment;
const {
  conflictTicketFiledComment, findConflictTicket, conflictTicketName,
  conflictTicketBody, handOffStalled, stalledHandOffLine, stalledHandOffHeadline,
  stalledSummaryHeadline, stalledSummaryClause,
  shouldFileConflictTicket, verdictFromCatchUp, isRealOverlap, isPermanent,
} = conflictWork;
const {
  prOpenedComment, verdictComment, prTrailLanded, prBodyCarriesTicket,
  commentsReadable, readyToLaunchGate, isReadyToLaunch,
} = loopTrail;
// Lane A (task 86bbkw2au). Every DECISION is in the module and tested there;
// what lives out here is the network and the file, nothing else.
const {
  laneADecision, laneAEligibility, laneGate, killSwitchState, switchCommand,
  rateCapState, selfDisableState, announcementNotice, cancellationNotice,
  digestDue, digestBody, digestSince, WINDOW_MS,
  ledgerAfterMerge, ledgerAfterSwitch, ledgerAfterDisable,
  ledgerAfterDigest, switchSignalsFromLedger, mergesSince,
} = autoMergeLane;
const { readLedgerFile, saveLedgerIfReadable } = autoMergeLedgerFile;
const { buildCard, CONTEXT_MIN_WORDS, CONTEXT_MAX_WORDS } = operatorCard;
const {
  isMachineComment, stampCommentBody, isCommentPostPath,
} = machineComment;
const { resolveTaskRepo } = taskRepo;
const {
  ESCALATE_AT_ROUND, currentRound, nextRound, wouldEscalate,
  roundSummaryLines, reasonOf, sendBacks,
} = sendBackRounds;
const {
  waitingVerdict, verdictFromStatusAlone, renderTicket, exitCodeFor, sweepSummary,
  operatorSpokeLast, WAITING: V_WAITING, NOT_WAITING: V_NOT_WAITING, CANNOT_TELL: V_CANNOT_TELL,
} = waitingOnOperator;

const TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
// The operator's ClickUp user id. Assignment is his inbox signal: a task in
// "Needs your input" / "Ready to launch" must carry it, a task in a machine
// status must not (loop-build SKILL.md, "Assignment is the handoff signal").
const OPERATOR_ID = Number(process.env.CLICKUP_OPERATOR_ID || 48012725);
const OPERATOR_STATUSES = ['needs your input', 'ready to launch'];
const PRIORITY = { urgent: 1, high: 2, normal: 3, low: 4 };
// Claim ordering lives in loopStatuses.js — one table, so the queue this
// prints and the depth the pacing curve counts can never disagree about which
// ticket is next (task 86bbr1u9v).
const PRIORITY_RANK = loopStatuses.PRIORITY_RANK;

// bus-relay defaults: the "Agent Response" list in the Dane of Earth space,
// and the party-line bus channel, so the common case needs no flags at all
// (a cron line should not have to carry these ids). Both are overridable —
// same pattern as WORKSPACE/OPERATOR_ID above — in case the list or channel
// ever moves.
const AGENT_RESPONSE_LIST = process.env.CLICKUP_AGENT_RESPONSE_LIST || '901418805125';
const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
// The pipeline pause switch (task 86bbmfc15). Optional: unset, the switch is
// found by name in the Loop Queue. Set it and every check is a single GET.
const PAUSE_TASK = process.env.CLICKUP_PAUSE_TASK || '';
const BUS_RELAY_OPEN_STATUSES = ['pending response', 'responding'];
// The dedup marker. A threaded reply starting with this exact prefix means
// "already relayed" — checked by prefix, not just presence-of-any-reply, so
// a human reply to Dane's comment can never be mistaken for our own marker.
// Imported rather than re-declared so the text a pass WRITES and the check
// that READS it are the same string by construction (task 86bbjxew2).
const { BUS_RELAY_MARKER } = busRelayPlan;
// The merge path's OWN dedup marker, separate from the relay's on purpose.
// The relay marks a comment the moment it reaches the bus; the merge path
// must only mark a comment once it has reached an answer (merged, handed to
// an agent session, or refused with a reason on the ticket). "Checks are still
// running" writes no marker, so the next pass picks the same
// authorization up instead of losing it.
//
// Not every marker is final. Since task 86bbjt18r a REFUSAL marker records
// its reason and is re-decided on every later pass, so an approval refused
// for a reason that has since been fixed goes through without the operator
// having to say "merge" a second time. MERGE_MARKER and the parser that
// reads it back both live in mergeOnComment.js — imported above, never
// re-declared here, so the shape cannot drift between writer and reader.

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

/**
 * Every occurrence of a repeatable flag (`--file a.png --file b.png`).
 * `arg()` returns only the first, which for an attachment upload would file
 * one image and report success — the "before" with no "after".
 */
function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

function readBody(spec) {
  return spec === '-' ? readFileSync(0, 'utf8') : readFileSync(spec, 'utf8');
}

/**
 * Report ClickUp's real rate-limit state from the response headers, on
 * stderr so it never contaminates parseable stdout. Printing the true
 * numbers is the whole point: the connector's own error text is not
 * trustworthy about this (it says "NaN minutes" on the chat endpoints).
 */
function reportLimits(res) {
  const limit = res.headers.get('x-ratelimit-limit');
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (!limit && !remaining) return;
  const secs = reset ? Number(reset) - Math.floor(Date.now() / 1000) : NaN;
  const resetTxt = Number.isFinite(secs) ? ` (resets in ${Math.max(0, secs)}s)` : '';
  console.error(`  ClickUp's own limit: ${remaining ?? '?'} of ${limit ?? '?'} left this minute${resetTxt}`);
}

/**
 * Counts every HTTP request this process makes to ClickUp. Nearly all of them
 * go through `call`; the one that does not is the multipart upload in `attach`
 * (FormData, so it cannot share this path), which increments the counter by
 * hand. If a third caller ever reaches for `fetch` directly it must do the
 * same — an uncounted request makes this total quietly too low, and the total
 * is the evidence the poll interval is safe.
 *
 * bus-relay reports the total at the end of each pass (task 86bbk2fuh): the
 * poll interval is only safe if a pass fits inside ClickUp's
 * ~100-requests-per-minute allowance, and "it feels like plenty" is not a
 * number anybody can check later. The count grows with the size of the open
 * queue, so it is worth re-reading whenever the interval is shortened again.
 *
 * Counted where the ATTEMPT is made, not where it succeeds: a request that
 * fails to connect still spent whatever the attempt costs, and for a budget
 * you would rather over-count than under-count.
 */
let requestCount = 0;

/**
 * A response-shaped stand-in for a request that never reached ClickUp at all
 * — DNS failure, a TLS reset, this machine offline, a connection timeout.
 *
 * WHY THIS EXISTS (2026-08-25, task 86bbm4zwd, review round 2). `fetch`
 * REJECTS on a transport failure rather than resolving with a non-ok
 * response, and nothing here caught it. The rejection travelled up through
 * `fetchAllTasks` to a top-level `await` with no handler, so the process died
 * with a stack trace and exit 1 — and `loop-build` reads exit 1 as "could not
 * tell, so proceed, unbounded by the cap". A routine network blip therefore
 * UNCAPPED the loop: the same inverted safety property the `fatal:false` fix
 * closed for HTTP errors, reached through a different door.
 *
 * Returning `res.ok === false` rather than throwing means every caller's
 * EXISTING failure path handles it — `die()` prints it, `fatal:false` falls
 * back to the stricter counting — and no caller has to know that `fetch` can
 * throw. That is the point: the next call site added here inherits the fix
 * instead of having to remember it.
 */
function unreachable(err) {
  return {
    res: { ok: false, status: 0, headers: { get: () => null } },
    json: null,
    text: `the request never reached ClickUp (${err?.message || err})`,
  };
}

async function call(method, path, body) {
  requestCount += 1;
  // THE ONE PLACE A MACHINE COMMENT IS MARKED (task 86bbqx2xe). The loops post
  // under Dane's own token, so nothing downstream can tell their writing from
  // his; the relay read an `ask` card as his answer and released the
  // escalation within ten minutes. There are fourteen comment-posting sites in
  // this file and a fifteenth would fail silently in the dangerous direction,
  // so the stamp goes on at the door rather than at each of them. See
  // scripts/builder/machineComment.js.
  const sendBody = (method === 'POST' && isCommentPostPath(path))
    ? stampCommentBody(body)
    : body;
  let res;
  try {
    res = await fetch(`https://api.clickup.com${path}`, {
      method,
      headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
      body: sendBody ? JSON.stringify(sendBody) : undefined,
    });
  } catch (err) {
    return unreachable(err);
  }
  let text;
  // The body can fail mid-stream after a perfectly good set of headers — a
  // dropped connection reads as a rejection here, not at the line above.
  try { text = await res.text(); } catch (err) { return unreachable(err); }
  let json = null;
  try { json = JSON.parse(text); } catch { /* provider returned a non-JSON error page */ }
  return { res, json, text };
}

function die(label, { res, json, text }) {
  console.error(`\n${label} FAILED — HTTP ${res.status}`);
  console.error(json?.err || json?.error || text.slice(0, 500));
  // Say what to do in terms of the thing the operator touches (DOCTRINE 2.2).
  if (res.status === 401) {
    if (/team not authorized/i.test(String(json?.err || json?.error || text))) {
      // 2026-08-18: a space id where a list id belongs earns exactly this
      // error, and it reads like an account problem. Say so at the moment it
      // happens, not in a doc nobody re-reads mid-failure.
      console.error('\n"Team not authorized" here usually means the ID is the wrong KIND of thing —');
      console.error('a space id where a list id belongs (the Starcaster SPACE is 90146476303;');
      console.error('the Loop Queue LIST is 901418546619). Run `npm run clickup -- lists --space <id>`');
      console.error('to resolve list ids by name before blaming the token.');
    } else {
      console.error('\n401 means the token is wrong or expired — not that ClickUp is down.');
      console.error('The token lives in Doppler (starcaster/dev, CLICKUP_API_TOKEN); run through');
      console.error('`npm run clickup -- ...` so doppler supplies it. Only if Doppler has lost it');
      console.error('should a human re-copy it: ClickUp -> avatar -> Settings -> Apps -> API Token.');
    }
  }
  if (res.status === 429) {
    console.error('\n429 is ClickUp itself throttling, and it clears in under a minute.');
    console.error('This is NOT the connector quota — wait 60s and run the same command again.');
  }
  if (res.status === 0) {
    // Not a ClickUp status at all — unreachable() invents it so a transport
    // failure travels the same road as an HTTP error instead of throwing.
    console.error('\nHTTP 0 is not something ClickUp said. The request never left this machine or never');
    console.error('arrived — DNS, TLS, a dropped connection, or being offline. Nothing was sent, so');
    console.error('nothing is half-done: check the network and run the same command again.');
  }
  process.exit(1);
}

function usage(code = 2) {
  console.error('Usage: node scripts/clickup_direct.mjs <command> [options]   (run via `npm run clickup -- <command> ...`)');
  console.error('  whoami');
  console.error('  task --list <id> --name "<name>" --body-file <file|-> [--status S] [--priority urgent|high|normal|low] [--tags a,b] [--id-out <file>]');
  console.error('                                             --priority urgent needs --operator-asked too — Urgent is the');
  console.error('                                             operator\'s lane, agents file at High or below by default');
  console.error('  priority --task <id> --priority urgent|high|normal|low [--operator-asked]');
  console.error('                                             change an existing task\'s priority, verified by read-back;');
  console.error('                                             same --operator-asked rule as `task` for urgent');
  console.error('  loop-note --task <id> --transition claimed|pr-open|review-started|verified|sent-back|merged|escalated|auto-merge-armed|auto-merge-cancelled [--pr N] [--round N] [--reason "..."] [--deadline "9:15pm"]');
  console.error('                                             stamp the "Loop note" field with a plain-language line; CANNOT STAMP if the field is absent.');
  console.error('                                             sent-back reads its round and reason off the ticket\'s verdicts — run it AFTER `verdict --fail`.');
  console.error('                                             auto-merge-armed needs --deadline: it is the whole content of the note, and');
  console.error('                                             "merging at undefined" tells him something is coming and refuses to say when');
  console.error('                                             review-started is loop-review\'s VISIBLE CLAIM — stamp it before verifying, and');
  console.error('                                             stand down if `queue`/`get` already shows one that is not stale');
  console.error('  loop-heartbeat --task <id> --in-line N --next "<name>"   one per pass onto the pinned heartbeat ticket');
  console.error('  chat --channel <id> --body-file <file|->');
  console.error('  queue --list <id> [--status "Queued" | --claimable]   open tasks, sorted priority-then-oldest, ALL pages:');
  console.error('                                             id <TAB> status <TAB> priority <TAB> repo <TAB> created <TAB> name <TAB> loop note');
  console.error('                                             --claimable is what a BUILD pass asks for: every status loop-build may take,');
  console.error('                                             in drain order — all Rework first (oldest first, priority ignored), then Queued');
  console.error('                                             the loop note is what a pass in flight looks like (e.g. a review already running)');
  console.error('                                             repo is the declared repo (repo:<name> tag); ?<name> = escalate, do not build');
  console.error('  stage-counts [--list <id>] [--since YYYY-MM-DD] [--until YYYY-MM-DD]');
  console.error('                                             every stage counted, as JSON, CLOSED TICKETS INCLUDED');
  console.error('                                             ("Live" is a closed status, so the open-queue fetch cannot see it);');
  console.error('                                             --since counts tickets closed on/after that date, --until');
  console.error('                                             bounds the other end — without it the count runs to NOW,');
  console.error('                                             so a report on an older week credits later closures to it');
  console.error('  get --task <id>                            one task: header lines, then "---", then the body markdown');
  console.error('  task-name --task <id>                      JUST the task name, on stdout, nothing else — for scripts that title');
  console.error('                                             a pull request from it (`npm run ship`). Everything else goes to stderr.');
  console.error('  comments --task <id>                       the task\'s comments, oldest first (where the PR URL lives)');
  console.error('  claim --task <id>                          THE build claim: reads the ticket\'s own status, refuses (exit 3) if it is');
  console.error('                                             not one loop-build may take, else moves it to Building guarded on that');
  console.error('                                             exact status. Removes the step of remembering which of Rework/Queued it');
  console.error('                                             was in — guarding on the wrong one refuses every send-back.');
  console.error('  migrate-rework [--apply] [--list <id>]     one-off: move tickets that are Queued WITH AN OPEN PR into Rework.');
  console.error('                                             Dry run unless --apply. Run it AFTER the claim rule is live on main —');
  console.error('                                             a Rework ticket is claimed by nothing until then.');
  console.error('  status --task <id> --status "In review" [--if-status "Queued"] [--assign <userId>] [--clear-assignees] [--no-auto-assign]');
  console.error('                                             move a task; operator statuses auto-assign the operator,');
  console.error('                                             machine statuses auto-clear; --if-status makes it a safe claim;');
  console.error('                                             status AND assignees verified from the write response');
  console.error('  comment --task <id> --body-file <file|->   add a comment, verified by reading the comments back');
  console.error('  attach --task <id> --file <path> [--file <path> ...]');
  console.error('                                             upload image(s) onto a task — the before/after pair');
  console.error("                                             the approval queue runs on; verified by reading the");
  console.error("                                             task's attachment list back");
  console.error('  build-start --task <id>                    BEFORE branching: is a PR for this ticket already open?');
  console.error('                                             exit 0 = start fresh, 3 = continue the existing branch,');
  console.error('                                             1 = could not tell (do NOT guess)');
  console.error('  wip-check [--repo owner/name]              is the merge side already full? 0 = room to claim,');
  console.error('                                             3 = capped (a normal decline), 1 = could not tell.');
  console.error('                                             Reads only; a capped pass writes nothing.');
  console.error('  next-interval --for <loop-build|loop-review> [--fallback <s>] [--list <id>] [--state-file <f>] [--repo owner/name]');
  console.error('                                             how long to sleep before the next pass, from how much work');
  console.error('                                             this loop could actually CLAIM. Prints one integer on stdout');
  console.error('                                             and the reason on stderr; always exits 0 (an unreadable queue');
  console.error('                                             answers with the configured fallback). Floor 900s.');
  console.error('  pr-opened --task <id> --pr <url|number> [--repo owner/name] [--body-file <file|->] [--if-missing]');
  console.error('                                             record the PR on the ticket in the ONE shape the merge step');
  console.error('                                             can read. Refuses first if the PR body carries no link back');
  console.error('                                             to the ticket, then verifies the comment by parsing it back.');
  console.error('                                             --if-missing writes nothing when the merge step can ALREADY');
  console.error('                                             find this PR on the ticket, whoever put it there — for');
  console.error('                                             `npm run ship`, which is meant to be re-run and would');
  console.error('                                             otherwise leave one line per catch-up round.');
  console.error('  send-back-rounds --task <id>               how many times this ticket has been sent back, what each round found,');
  console.error('                                             and whether the next one escalates. Exit 3 = escalate, do not send back.');
  console.error('  verdict --task <id> --pass|--fail --if-status "In review" [--body-file <file|->] [--no-guard] [--fourth-round-anyway]');
  console.error('                                             record loop-review\'s verdict in the ONE shape the merge step');
  console.error('                                             and the Ready-to-launch gate can read, verified by read-back.');
  console.error('                                             A ticket cannot reach Ready to launch without a PASS on it.');
  console.error('                                             --fail REFUSES at send-back round 4 (exit 3): three rounds means the spec');
  console.error('                                             is wrong, so it prints the prior rounds and the `ask` command instead.');
  console.error('                                             --if-status is REQUIRED: exit 3, nothing written, if the ticket');
  console.error('                                             moved while you reviewed. --no-guard opts out, on the record.');
  console.error('  describe --task <id> --body-file <file|->  REPLACE the task description — the left column, where the');
  console.error('                                             long detail belongs. Verified by reading it back.');
  console.error('  ask --task <id> --body-file <file|-> [--status "Needs your input"|"Ready to launch"] [--no-move]');
  console.error('      [--after-his-answer]                   hand the ticket to the operator: post an operator card, then');
  console.error('                                             move the status (he is auto-assigned). --no-move posts the');
  console.error('                                             card and leaves the status alone. The card body uses');
  console.error(`                                             @@ASKED / @@WHEN / @@CONTEXT / @@NEEDED; @@CONTEXT must be`);
  console.error(`                                             ${CONTEXT_MIN_WORDS}-${CONTEXT_MAX_WORDS} words. An ask that SPENDS MONEY or cannot be undone`);
  console.error('                                             also needs @@EVIDENCE: the command, its real output, and');
  console.error('                                             a "@@MEASURED 8:04pm" line saying when you ran it — the');
  console.error('                                             only clock that dates the card. Checked before it is sent.');
  console.error('                                             REFUSES if his own comment is the newest one on the ticket —');
  console.error('                                             handing it back then asks him to answer twice. The same');
  console.error('                                             refusal stands on `status --no-card`, the other door into his');
  console.error('                                             lane. --after-his-answer overrides it, on the record, when it');
  console.error('                                             genuinely is a NEW question.');
  console.error('  waiting [--task <id>]                     is anything ACTUALLY waiting on Dane? Live reads only.');
  console.error('                                             With --task: status, assignee, newest-comment author, verdict.');
  console.error('                                             With no arguments: every open ticket in Agent Response + the');
  console.error('                                             Loop Queue, listing only the ones waiting on him, newest first.');
  console.error('                                             exit 0 = nothing of his, 3 = something IS his, 1 = could not tell.');
  console.error('                                             READ-ONLY — it never writes. NO AGENT SAYS SOMETHING IS WAITING');
  console.error('                                             ON DANE WITHOUT RUNNING THIS FIRST (task 86bbk34x7).');
  console.error('  lists --space <id>                         every list in a space, with ids (a space id is NOT a list id)');
  console.error('  bus-relay [--list <id>] [--channel <id>] [--statuses "a,b"] [--dry-run] [--no-merge] [--simulate-bus-failure]');
  console.error('                                             relay the operator\'s new comments on open tasks to the bus.');
  console.error('                                             With no flags it watches Agent Response (notify-only) AND the');
  console.error('                                             Loop Queue: an answer on "needs your input" hands the ticket');
  console.error('                                             back to Queued; on "ready to launch" a comment that is exactly');
  console.error(`                                             a merge command (${MERGE_PHRASES.join(' / ')}) from the`);
  console.error('                                             operator MERGES the PR — but only if loop-review passed it,');
  console.error('                                             the PR is open, green and conflict-free; then the ticket goes');
  console.error('                                             Live. Conflicts go to an agent session, never resolved here.');
  console.error('                                             --list/--statuses = that one list, notify-only and no merging;');
  console.error('                                             --simulate-bus-failure (requires --dry-run) fails every party-line');
  console.error('                                             write WITHOUT sending a request, so PR #414\'s fallback can be');
  console.error('                                             rehearsed on demand: dry-run stops short-circuiting and runs the');
  console.error('                                             real delivery path, writing nothing.');
  console.error('                                             --no-merge disables merging everywhere; --dry-run reads GitHub');
  console.error('                                             and ClickUp and prints the decision, writing nothing at all;');
  console.error('                                             --only-task <id> confines the whole pass to one ticket.');
  console.error('                                             ONE machine relays (lib/nodeRoles.js); on any other it');
  console.error('                                             says so and exits 0. npm run node:whoami names this one');
  console.error('                                             LANE A: a Ready-to-launch ticket whose PR touches nothing but');
  console.error(`                                             tests and documentation is announced, left ${autoMergeLane.WINDOW_MS / 3600000} hour, then`);
  console.error('                                             merged unless he comments. --no-merge turns it off with the');
  console.error(`                                             rest; so does "${autoMergeLane.SWITCH_STOP}" on the bus or any`);
  console.error(`                                             ticket ("${autoMergeLane.SWITCH_RESUME}" to undo). Cap`);
  console.error(`                                             ${autoMergeLane.CAP_PER_HOUR}/hour and ${autoMergeLane.CAP_PER_DAY}/day; one digest a day, "none" included.`);
  console.error('  auto-merge-status                          what Lane A would do right now, reading only — the switch,');
  console.error('                                             the cap, the self-disable flag and the recent auto-merges');
  console.error('  task-open --task <id>                      exit 0 if the task is still open (status.type), 1 if closed/done');
  console.error('                                             or gone — used by `npm run thread`/`tidy` (Task-closes-thread)');
  process.exit(code);
}

if (!TOKEN) {
  console.error('CLICKUP_API_TOKEN is not set in this environment.\n');
  console.error('The sanctioned route is Doppler, which already holds the token:');
  console.error('  npm run clickup -- <command> ...');
  console.error('(package.json wraps the script in `doppler run --project starcaster --config dev`.)\n');
  console.error('Only if Doppler is unavailable should a HUMAN export a token by hand —');
  console.error('agents never handle the live value (DOCTRINE 4.1).');
  process.exit(2);
}

/** Every page of a list's open tasks. The endpoint caps at 100 per page and
 *  a first-page-only read silently starves everything past it (DOCTRINE 5.12). */
async function fetchAllTasks(list, { includeClosed = false, fatal = true } = {}) {
  // includeClosed: ClickUp's v2 list endpoint DROPS closed-type statuses by
  // default, so `Live` tickets are invisible without it — 36 tasks come back
  // where 66 Live ones exist (measured 2026-08-25). Opt-in rather than global:
  // the `queue` command wants only open work, and flipping it there would put
  // 66 shipped tickets in front of the loop.
  //
  // `stage-counts` is the caller that needs them. The weekly report counts the
  // pipeline by stage, and "Live" IS a closed status — without this the report
  // counts every stage except the one that means the work shipped, and prints
  // a confident 0 (task 86bbkw1mn).
  //
  // fatal:false — die() ends in process.exit(1), so a caller that WANTS to
  // handle a failed read cannot: its try/catch never runs and loop-build reads
  // exit 1 as "proceed, unbounded by the cap". That inverted the wip-check
  // safety property outright (task 86bbm4zwd, review round 1).
  const tasks = [];
  const closedParam = includeClosed ? '&include_closed=true' : '';
  for (let page = 0; page < 50; page++) {
    const out = await call('GET', `/api/v2/list/${list}/task?archived=false${closedParam}&page=${page}`);
    if (!out.res.ok) {
      if (!fatal) return { tasks: null, res: out.res, failed: `HTTP ${out.res.status}` };
      die('list tasks', out);
    }
    // A 200 carrying a body that is not the expected JSON — a proxy's error
    // page, a truncated response — left `out.json` null, and spreading
    // `null.tasks` threw exactly like the transport failure above did, past
    // the fatal:false contract and out to exit 1 (review round 2).
    // `listTasks` in clickup.cjs has always guarded this; this did not.
    if (!out.json || !Array.isArray(out.json.tasks)) {
      const why = 'the response body was not the expected JSON';
      if (!fatal) return { tasks: null, res: out.res, failed: why };
      die(`list tasks (${why})`, out);
    }
    tasks.push(...out.json.tasks);
    if (out.json.last_page !== false || out.json.tasks.length === 0) {
      return { tasks, res: out.res };
    }
  }
  console.error('Stopped after 50 pages — the list is implausibly large; treat this output as INCOMPLETE.');
  return { tasks, res: null };
}

function assigneeNames(t) {
  return (t.assignees || []).map((a) => `${a.username} (${a.id})`).join(', ') || '(nobody)';
}

/**
 * The "Loop note" custom field's text, or '' if the list has no such field.
 * `queue` and `get` both print it, because it is the ONLY place a pass in
 * flight is visible: a review that has claimed a ticket stamps
 * `🔍 being checked — a review pass started …` there, and a second reviewer
 * must be able to see that from the one command it already runs. Resolved by
 * NAME, like stampLoopNote, so no field id is hardcoded.
 */
function loopNoteOf(t) {
  const f = (t.custom_fields || []).find(
    (x) => String(x.name || '').trim().toLowerCase() === 'loop note'
  );
  return String(f?.value ?? '').trim();
}

/** Run `gh` and report honestly. gh carries its OWN GitHub credentials; no
 *  ClickUp token is ever passed to it, and nothing here prints either. */
function gh(args) {
  const out = spawnSync('gh', args, { encoding: 'utf8' });
  if (out.error) {
    const why = out.error.code === 'ENOENT'
      ? 'the `gh` command is not installed on this machine'
      : String(out.error.message);
    return { ok: false, stdout: '', stderr: why };
  }
  return {
    ok: out.status === 0,
    stdout: String(out.stdout || ''),
    stderr: String(out.stderr || out.stdout || '').trim(),
  };
}

/**
 * "Is the merge side full?" — the ONE probe, wired to this script's `gh` and
 * `fetchAllTasks`.
 *
 * WHY IT IS A FUNCTION AND NOT TWO CALL SITES (2026-08-31, task 86bbq8br2).
 * `wip-check` and `next-interval` each asked that question in their own words
 * and got opposite answers: the claim gate reported room to claim while the
 * sleep timer wrote "the work-in-progress cap is full" into the log and slept
 * the maximum hour, with 38 tickets waiting. Neither was buggy in isolation.
 * `next-interval` simply asked GitHub for `number,state` and passed no ticket
 * statuses, so it took the documented conservative fallback of counting every
 * open PR — including the four whose tickets were `Queued` for rework, which
 * is the exact deadlock task 86bbm4zwd had already fixed for the claim gate.
 *
 * So the two things that have to match now live in one place: the `--json`
 * field list (it MUST include `body` — that is how `classifyPrs` finds a PR's
 * ticket, and without it every PR falls into "no ticket found" and counts),
 * and `include_closed` on the queue read (a zombie PR's ticket is `Live`, and
 * without it that PR reports as having no ticket at all).
 *
 * The callers still differ in the direction they fail, which is deliberate and
 * lives with them: `wip-check` fails open, `next-interval` fails toward capped.
 *
 * Both I/O calls THROW on failure and `wipCap.probeCap` catches them, which is
 * also what keeps the old last-resort guard here: an unhandled rejection is
 * exit 1, and loop-build reads exit 1 as "proceed, unbounded by the cap".
 */
/**
 * Every open pull request, with the fields `classifyPrs` needs.
 *
 * ONE PLACE BUILDS THIS LIST, and `wipCap.test.js` fails if a second one
 * appears. The reason is the 2026-08-31 incident this whole probe was written
 * for: `next-interval` asked for `number,state` while `wip-check` asked for
 * `number,state,body`, and because a PR is matched to its ticket THROUGH its
 * body, the shorter field list silently made every PR look untick-eted and
 * reported the cap as full while the claim gate reported room. A second copy
 * of these arguments is not duplication to tidy up later; it is that bug,
 * pre-built.
 *
 * THROWS rather than returning `[]`. An empty list and a failed call look
 * identical to a caller, and they mean opposite things — "no open PRs" versus
 * "we have no idea" (DOCTRINE 3.11).
 */
function listOpenPullRequests(repo) {
  const args = ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,state,body'];
  if (repo) args.push('--repo', repo);
  const out = gh(args);
  if (!out.ok) throw new Error(out.stderr.slice(0, 200) || 'gh failed');
  try {
    return JSON.parse(out.stdout);
  } catch {
    throw new Error('gh returned output that is not JSON');
  }
}

function capProbe({ repo } = {}) {
  return wipCap.probeCap({
    cap: wipCap.resolveCap(process.env),
    listOpenPrs: async () => listOpenPullRequests(repo),
    readTicketStatuses: async () => {
      // fatal:false is REQUIRED — see fetchAllTasks. With the default, a
      // routine ClickUp 429 exits 1 before this function can report anything.
      const listed = await fetchAllTasks(LOOP_QUEUE_LIST, { includeClosed: true, fatal: false });
      if (!Array.isArray(listed.tasks) || !listed.tasks.length) {
        throw new Error(listed.failed || 'no tasks came back');
      }
      const byId = Object.create(null);
      for (const t of listed.tasks) byId[String(t.id)] = t.status?.status ?? '';
      return byId;
    },
  });
}

/** Post to the party line. Returns ok/why so a caller can report a failure
 *  rather than assume the operator was told.
 *
 *  `simulate` (task 86bbjzg83) fails the write WITHOUT sending a request —
 *  the return is shaped exactly like a real failure, so every caller below
 *  takes its real failure branch. The guard in busRelayPlan.simulationGuard
 *  keeps this out of any pass that could write. */
async function postToBus(channel, content, { simulate } = {}) {
  if (simulate) return { ok: false, why: SIMULATED_BUS_WHY };
  const out = await call('POST', `/api/v3/workspaces/${WORKSPACE}/chat/channels/${channel}/messages`, {
    type: 'message', content, content_format: 'text/md',
  });
  return { ok: out.res.ok, why: out.res.ok ? '' : `HTTP ${out.res.status}` };
}

/**
 * Deliver a relayed message to somewhere DURABLE (task 86bbjxew2). The party
 * line first; if that fails, a short receipt comment on the ticket the
 * message concerns. Task comments were the one write in this API that kept
 * working through the 2026-08-23 chat outage, and the answer itself is
 * already a comment on that ticket — only the acknowledgement was missing.
 *
 * Returns { ok, via, why }: `ok` is the handback gate, `via` picks the marker
 * text, `why` carries the chat failure for the report even on success.
 */
async function deliverToBus(channel, content, { taskId, target, receipted, simulate } = {}) {
  const chat = await postToBus(channel, content, { simulate });
  // `why` is always the chat failure (the report quotes it on the success
  // path too); `reason` is deliveryVerdict's honest account of why nothing was
  // delivered. Keeping them apart is the whole of review finding 1: the old
  // spread put the verdict's reason in `why` and then overwrote it.
  const answer = (verdict) => ({ ok: verdict.ok, via: verdict.via, why: chat.why, reason: verdict.why || '' });
  if (chat.ok) return { ok: true, via: 'chat', why: '', reason: '' };

  // No handback target means nothing on this watch reads the ticket, so a
  // receipt there delivers nothing (busRelayPlan.deliveryVerdict says why).
  // Do not even post one: this watch retries every pass until the bus takes
  // it, and a receipt per pass would pile identical notes onto the ticket
  // forever while still losing the bus message.
  const handsBack = Boolean(taskId && target);
  if (!handsBack) {
    return answer(deliveryVerdict({ chatOk: false, handsBack: false, receiptAttempted: false }));
  }

  // One receipt per TICKET per pass, not per comment. Three of Dane's
  // comments during an outage otherwise leave three identical notes. The map
  // remembers whether that receipt was VERIFIED, so a second comment on the
  // same ticket inherits the first one's verdict rather than an assumed pass.
  if (receipted && receipted.has(String(taskId))) {
    return answer(deliveryVerdict({
      chatOk: false, handsBack: true, receiptAttempted: true,
      receiptPosted: true, receiptOk: receipted.get(String(taskId)),
    }));
  }

  const at = new Date().toISOString();
  const body = receiptText({ why: chat.why, target, at });

  // Under simulation the receipt is REHEARSED, not sent. The switch only runs
  // inside --dry-run, whose whole contract is that the pass writes nothing, so
  // posting here would break that contract to test it. What is being rehearsed
  // is the DECISION — deliveryVerdict's answer and the hand-back that follows
  // it — and that is reached identically either way. The rehearsal assumes the
  // receipt lands, which is the case worth watching: it is the one where #414
  // claims the hand-back still fires.
  if (simulate) {
    console.error(`  SIMULATION — would post the fallback receipt on ${taskId} (not sent):\n    ${body.split('\n')[0]}`);
    if (receipted) receipted.set(String(taskId), true);
    return answer(deliveryVerdict({
      chatOk: false, handsBack: true, receiptAttempted: true,
      receiptPosted: true, receiptOk: true,
    }));
  }

  const out = await call('POST', `/api/v2/task/${taskId}/comment`, { comment_text: body });
  const posted = Boolean(out.res.ok);

  // Read it back before trusting it. Every other comment write in this file
  // does (DOCTRINE 3.10), and this one now unlocks both the dedup marker and
  // the ticket move — a 200 that did not stick would move the ticket with the
  // acknowledgement existing nowhere. busRelayPlan.isThisReceipt matches THIS
  // write by its id and its timestamp, never by the constant fingerprint: a
  // leftover receipt from an earlier outage would otherwise satisfy the very
  // check that exists to catch a POST that did not stick.
  let stuck = false;
  if (posted) {
    const back = await call('GET', `/api/v2/task/${taskId}/comment`);
    stuck = Boolean(back.res.ok && (back.json.comments || []).some(
      (c) => isThisReceipt(c, { id: out.json && out.json.id, at })
    ));
  }

  // Record the ticket as soon as the POST lands, NOT only when the read-back
  // succeeded: a transient GET failure otherwise leaves the ticket unrecorded
  // and the next comment in the same pass posts a second identical note —
  // which is the pile-up this map was added to prevent. Whether it verified
  // travels in the value, so nothing is assumed away.
  if (posted && receipted) receipted.set(String(taskId), stuck);

  return answer(deliveryVerdict({
    chatOk: false, handsBack: true, receiptAttempted: true,
    receiptPosted: posted, receiptOk: stuck, receiptStatus: out.res.status,
  }));
}

/**
 * Route a failed bus post to the right report bucket. The decision itself is
 * busRelayPlan.busFailureBucket (tested); this is only the two pushes.
 *
 * `cosmetic` means the caller already wrote the real explanation onto the
 * ticket, so the bus post carried nothing that was lost — a chat outage must
 * not fail a pass that told the operator everything anyway (task 86bbjxew2).
 */
function reportBusFailure({ delivered, cosmetic, unchecked, busSkipped, line }) {
  if (busFailureBucket({ delivered, cosmetic }) === 'skipped') busSkipped.push(line);
  else unchecked.push(line);
}

/** Write the merge path's dedup marker as a threaded reply on the operator's
 *  own comment, and verify it stuck — an unverified marker means the next
 *  pass may act on the same authorization again, which must be reported, not
 *  assumed away (DOCTRINE 3.10). */
async function markMergeHandled(commentId, task, unchecked, what) {
  // `what` carries the KIND as well as the words: a string starting
  // "refused:" parses back as a re-decidable refusal, anything else as
  // terminal. See mergeOnComment.parseMergeMarker for the format.
  const text = `${MERGE_MARKER} ${what} — ${new Date().toISOString()}`;
  const out = await call('POST', `/api/v2/comment/${commentId}/reply`, { comment_text: text });
  if (!out.res.ok) {
    unchecked.push(`${task.id} comment ${commentId}: acted on the merge command (${what}) but could not write the dedup marker — the NEXT pass will see this authorization as unhandled`);
    return;
  }
  const verify = await call('GET', `/api/v2/comment/${commentId}/reply`);
  const stuck = verify.res.ok && (verify.json.comments || verify.json.replies || [])
    .some((r) => (r.comment_text || '').startsWith(MERGE_MARKER));
  if (!stuck) {
    unchecked.push(`${task.id} comment ${commentId}: merge marker did not verify — the NEXT pass may act on this authorization again`);
  }
}

/**
 * File the conflict resolution as an ordinary Queued ticket in the Loop Queue
 * (Dane's option C on task 86bbq0fh8, 2026-08-30), and record it on the
 * waiting ticket in the one shape `findConflictTicket` reads back.
 *
 * Returns `{ id, url }` on success and **null** on any failure. Null is
 * load-bearing: it is what tells the hand-off notice that no actor exists, so
 * the comment says the work is stalled instead of promising a merge. Filing
 * that half-succeeded — a task created but no trail comment — also returns
 * null, because the next pass would not find it and would file a second one.
 */
async function fileConflictTicket({ task, pr, branch, localVerdict, commentId, unchecked }) {
  // The conflict is in the same repo as the ticket that carries it, so the
  // repo tag is copied rather than guessed from the GitHub name (they are not
  // guaranteed to match, and an unrecognised repo:<name> tag makes the build
  // loop escalate instead of build).
  const inherited = (task.tags || [])
    .map((t) => String(t.name || ''))
    .filter((n) => /^repo:/i.test(n));
  const tags = inherited.length
    ? inherited
    : (taskRepo.KNOWN_REPOS && Object.prototype.hasOwnProperty.call(taskRepo.KNOWN_REPOS, pr.repo)
      ? [`repo:${pr.repo}`]
      : []);

  const out = await call('POST', `/api/v2/list/${LOOP_QUEUE_LIST}/task`, {
    name: conflictTicketName({ pr, branch, localVerdict }),
    markdown_description: conflictTicketBody({ task, pr, branch, localVerdict, commentId }),
    status: 'Queued',
    // High, not Urgent: Urgent is the operator's lane (ratified 2026-08-18)
    // and nothing here was asked for by him. High puts it above the ordinary
    // queue, which is right — an approved merge is being held up by it.
    priority: PRIORITY.high,
    tags: tags.length ? tags : undefined,
  });
  if (!out.res.ok) {
    unchecked.push(`${task.id}: could not file a conflict ticket for PR #${pr.number} (HTTP ${out.res.status}) — no actor exists for this conflict`);
    return null;
  }
  const id = out.json.id;
  const url = out.json.url || `https://app.clickup.com/t/${id}`;

  // A 200 proves a write happened, not that the right thing landed — the same
  // read-back the `task` command does, for the same reason. A shell of a
  // ticket in the queue is worse than none: the build loop claims it and finds
  // no instructions.
  const check = await call('GET', `/api/v2/task/${id}`);
  if (!check.res.ok || !(check.json.description || '').length) {
    unchecked.push(`${task.id}: filed conflict ticket ${id} for PR #${pr.number} but could not verify its description — check it by hand`);
    return null;
  }

  // The trail on the WAITING ticket. Without it the next pass cannot tell that
  // this conflict is already filed and would file another one every hour.
  const trail = await call('POST', `/api/v2/task/${task.id}/comment`, {
    comment_text: conflictTicketFiledComment({ id, url, prNumber: pr.number, localVerdict }),
  });
  if (!trail.res.ok) {
    unchecked.push(`${task.id}: filed conflict ticket ${id} but could NOT record it on this ticket — the next pass will file a duplicate. Add the line by hand: "CONFLICT TICKET FILED: PR #${pr.number} — ${url}"`);
    return null;
  }
  console.error(`  FILED conflict ticket ${id} (${url}) for PR #${pr.number}`);
  return { id, url, prNumber: pr.number };
}

/**
 * The merge path: the operator commented "merge" on a Ready-to-launch ticket
 * and this pass is his hands (task 86bbjd5nn). Every decision that can be
 * made without the network is made in scripts/builder/mergeOnComment.js and
 * tested there; this function is only the plumbing that carries one out.
 *
 * Contract with the caller: it returns a small outcome record, and pushes any
 * step it could not verify onto `unchecked` (DOCTRINE 3.11). It writes the
 * MERGE_MARKER only on a TERMINAL outcome — merged, or refused with the
 * reason on the ticket — so "checks are still running" is retried on the next
 * pass instead of being silently lost.
 */
/**
 * After a catch-up push: wait for the check run rather than going away for an
 * hour (task 86bbk2fb5). Bounded by a budget and a per-pass cap; on timeout it
 * returns exactly the `waiting` the pass used to return immediately.
 *
 * Re-reads the PR and hands the answer to githubGate — nothing here decides
 * whether a PR may merge.
 *
 * `gateOf` exists for exactly one caller: the stale-review-gate re-run below
 * (task 86bbmk7pv), which needs to keep waiting while the OLD answer is still
 * the one GitHub is reporting. Waiting on `githubGate` alone would merge on
 * that old answer in the first poll, because a re-run takes a few seconds to
 * show up and until it does the PR looks green and settled. The hook narrows
 * the "keep waiting" condition; it can never widen "may merge", because the
 * gate it composes with is still this one.
 */
async function waitForChecksInPass({ pr, repo, label, fields, budget, gateOf = githubGate }) {
  if (!budget || !mergeOnComment.mayWaitInPass(budget.used, budget.cap)) {
    return { action: 'wait', reason: 'the in-pass wait cap for this run is already spent' };
  }
  budget.used += 1;

  const startedAt = Date.now();
  const budgetMs = mergeOnComment.IN_PASS_WAIT_MS;
  console.error(`  waiting up to ${Math.round(budgetMs / 1000)}s for CI on PR #${pr.number} (${label})`);

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, mergeOnComment.IN_PASS_POLL_MS));

    const again = gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', fields]);
    if (!again.ok) return { action: 'wait', reason: 'could not re-read the PR while waiting' };
    let json;
    try { json = JSON.parse(again.stdout); } catch {
      return { action: 'wait', reason: 'gh returned unparseable JSON while waiting' };
    }

    const next = mergeOnComment.afterCatchUpDecision({
      gate: gateOf(json),
      elapsedMs: Date.now() - startedAt,
      budgetMs,
    });
    if (next.action !== 'poll-again') return { ...next, prJson: json };
  }
}

async function runMergeStep({ task, comments, mergeHandled, mergeRefused, mergeRefusedAt, dryRun, channel, unchecked, busSkipped, stalledHandOffs, inPassBudget, lane }) {
  // ONE GATE, ONE MERGE COMMAND, ONE Live TRANSITION (task 86bbkw2au). Lane A
  // replaces the operator's WORD and nothing else, so it arrives here as a
  // decision of the same shape and takes the identical path afterwards:
  // githubGate, the catch-up, the in-pass CI wait, `gh pr merge --squash`.
  // A second merge implementation would be a second set of preconditions to
  // keep in step, and the one that drifted would be the one nobody was
  // watching.
  //
  // The one thing a lane does NOT reuse is the refusal WORDING. Every refusal
  // notice promises "your approval is still standing", which is true of a word
  // he said and meaningless about a window that expired — so a lane's refusals
  // and conflicts come back as `lane-cancel` and the caller announces them in
  // the lane's own terms.
  const decision = lane ? lane.decision : mergeDecision({
    status: task.status?.status,
    comments,
    operatorId: OPERATOR_ID,
    handled: mergeHandled,
    refused: mergeRefused,
    refusedAt: mergeRefusedAt,
  });
  if (decision.act === 'ignore') return { outcome: 'none' };

  // The comment the dedup marker threads under. For his word it is that
  // comment; for a lane it is the ANNOUNCEMENT — a laneADecision has no
  // commentId, and passing one through POSTed to /comment/undefined/reply,
  // which failed and filed a false "could not write the dedup marker" under
  // the very section the self-disable watches (2026-08-30, review round 2).
  const authorizingComment = lane ? decision.announcementId : decision.commentId;

  const label = `"${task.name}" (${task.id})`;

  // Terminal answer: say why on the ticket and on the bus, then mark the
  // authorizing comment handled so the same refusal is never posted twice.
  //
  // An answer this ticket has ALREADY been given, whose reason is still the
  // same, is not news. mergeDecision quiets its own refusals that way; the
  // two discovered against GitHub — checks red, and the conflict hand-off —
  // can only be quieted out here, because that is where they are found. Skip
  // the comment, the bus post and the marker rewrite: re-deriving the same
  // answer costs nothing and says nothing.
  const alreadySaid = (why) => decision.priorRefusal === why;

  const refuse = async (why, plainEnglish) => {
    if (lane) return { outcome: 'lane-cancel', reason: why };
    if (alreadySaid(why)) {
      console.error(`  MERGE REFUSED (unchanged, nothing posted) on ${label}: ${why}`);
      return { outcome: 'refused-quiet', reason: why };
    }
    console.error(`  MERGE REFUSED on ${label}: ${why}`);
    if (dryRun) return { outcome: 'would-refuse', reason: why };
    const notice = refusalNotice({ commentId: decision.commentId, why, plainEnglish });
    const cOut = await call('POST', `/api/v2/task/${task.id}/comment`, { comment_text: notice.body });
    if (!cOut.res.ok) {
      unchecked.push(`${task.id}: merge refused (${why}) but the explanation comment FAILED to post — the operator has not been told`);
      return { outcome: 'refused', reason: why };
    }
    const bus = await postToBus(channel, `[CC-starcaster bus-relay] Merge NOT performed on ${label} (${task.url}): ${why}. Explanation posted on the ticket; it is still Ready to launch.`);
    if (!bus.ok) reportBusFailure({ cosmetic: true, unchecked, busSkipped, line: `${task.id}: merge refusal explained on the ticket but the bus post failed (${bus.why})` });
    await markMergeHandled(decision.commentId, task, unchecked, notice.marker);
    return { outcome: 'refused', reason: why };
  };

  if (decision.act === 'refuse') {
    return refuse(decision.reason, 'This ticket is not in a state a script may merge from.');
  }

  const pr = decision.pr;
  const repo = `${pr.owner}/${pr.repo}`;
  // `reviewDecision` is here so a BLOCKED merge can name the rule that is
  // unmet instead of guessing at one (task 86bbrg9v0). Without it the gate
  // still answers, but it answers CANNOT TELL.
  const fields = 'number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,title,url,statusCheckRollup';
  const view = gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', fields]);
  if (!view.ok) {
    // A read that failed is not a red PR — it is a PR nobody checked. Say so
    // and try again next pass rather than guessing in either direction.
    unchecked.push(`${task.id}: could not read PR #${pr.number} from GitHub (${view.stderr.slice(0, 200)}) — merge authorization still pending`);
    console.error(`  MERGE WAITING on ${label}: could not read PR #${pr.number}`);
    return { outcome: 'waiting', reason: 'could not read the PR' };
  }
  let prJson;
  try {
    prJson = JSON.parse(view.stdout);
  } catch {
    unchecked.push(`${task.id}: gh returned unparseable JSON for PR #${pr.number} — merge authorization still pending`);
    return { outcome: 'waiting', reason: 'unparseable gh output' };
  }

  let gate = githubGate(prJson);

  // Behind main: catch the branch up, then stop for this pass. The push
  // restarts CI, so merging on the checks just read would be merging on a
  // result that no longer describes the branch.
  if (gate.action === 'update-branch') {
    if (dryRun) {
      console.error(`  DRY RUN — would update PR #${pr.number} from main, then wait for CI`);
      return { outcome: 'would-update-branch', pr: pr.number };
    }
    const upd = gh(['pr', 'update-branch', String(pr.number), '--repo', repo]);
    if (!upd.ok) {
      // update-branch fails on a genuine conflict too — treat that as the
      // conflict hand-off rather than retrying it forever.
      gate = { action: 'conflict', reason: `the branch could not be caught up with main (${upd.stderr.slice(0, 200)})` };
    } else {
      // Do not go away for an hour: CI takes ~85s and the whole merge is
      // three minutes of work. 'update-branch' out of the wait means main
      // moved AGAIN while we waited — the next pass catches up from the top
      // rather than this one chasing a moving target.
      const after = await waitForChecksInPass({ pr, repo, label, fields, budget: inPassBudget });
      if (after.action === 'wait' || after.action === 'update-branch') {
        console.error(`  MERGE WAITING on ${label}: branch updated from main — ${after.reason}`);
        return { outcome: 'waiting', reason: after.reason };
      }
      gate = { action: after.action, reason: after.reason };
      if (after.prJson) prJson = after.prJson;
    }
  }

  // GitHub says it conflicts. Before believing that, ask THIS machine —
  // GitHub's mergeability answer is often minutes stale, and on 2026-08-23 it
  // produced twelve false hand-offs in one day, each stalling a merge Dane
  // had authorized. (The original culprit, committed ?v= asset pins merged by
  // a driver GitHub could not run, was retired on 2026-08-24 — task 86bbkh288.)
  //
  // This does NOT resolve a conflict. It attempts an ordinary merge in a
  // throwaway worktree: clean means the difference was the driver and the
  // branch is pushed so CI re-runs; anything else — including "could not
  // tell" — falls straight through to the hand-off below, unchanged.
  if (gate.action === 'conflict' && !dryRun) {
    const local = branchCatchUp.catchUpBranchLocally({ repo, branch: prJson.headRefName });
    if (local.ok) {
      console.error(`  ${label}: GitHub reported a conflict, but ${local.reason}`);
      const after = await waitForChecksInPass({ pr, repo, label, fields, budget: inPassBudget });
      if (after.action === 'wait' || after.action === 'update-branch') {
        console.error(`  MERGE WAITING on ${label}: ${after.reason}`);
        return { outcome: 'waiting', reason: after.reason };
      }
      // CARRY THE CLEAN VERDICT (review round 2). If GitHub STILL says
      // conflict after a catch-up that merged and pushed, that is the textbook
      // stale answer — and this machine has the strongest possible evidence
      // there is no overlap, because it just did the merge. Dropping the
      // verdict here left `localVerdict` null, which the hand-off then had to
      // guess about. It is a finding; it travels.
      gate = { action: after.action, reason: after.reason, localVerdict: local };
      if (after.prJson) prJson = after.prJson;
    } else {
      // Carry WHY into the hand-off, so the reader learns whether it was a
      // real overlap or something that could not be checked at all.
      gate = { ...gate, reason: gate.reason, localVerdict: local };
    }
  }

  // A script never resolves a merge conflict (task 86bbjd5nn, binding). What
  // it must NOT also do is eat the authorization on the way past: resolving
  // the branch is a job for an agent session, saying "merge" a second time afterwards
  // is not (task 86bbk0g4u). The marker written here is re-decidable, so the
  // pass that runs after someone fixes the branch merges it on his original
  // word — which is what the comment promised all along.
  if (gate.action === 'conflict') {
    // What the local attempt found, in the operator's terms. "It really does
    // overlap" and "I could not check" are different problems with different
    // fixes, and reading one as the other is how a machine problem gets
    // diagnosed as a code problem.
    // The code-to-answer table lives in conflictWork beside the predicate that
    // reads it (review round 2). It used to be inline here and had only two
    // buckets, so `WRONG_REPO`, `FETCH_FAILED`, `WORKTREE_FAILED` and
    // `NOT_ANCESTOR` — four ways of never looking — came out wearing the same
    // answer as a lost push race, which is a finding. The bus post then
    // asserted that finding.
    const localVerdict = verdictFromCatchUp(gate.localVerdict);
    const branch = prJson.headRefName;

    // OPTION C (Dane's answer on task 86bbq0fh8, 2026-08-30): the resolution
    // becomes an ordinary Queued ticket in the Loop Queue the build loop
    // already drains every pass. The bus post this replaces asked an empty
    // room — nothing reads the bus — and PR #434 sat three days as a result.
    // Filing FIRST matters: the hand-off comment's promise is decided by
    // whether a ticket exists, so it must be settled before the body is built.
    //
    // ...but ONLY for a conflict that is real (2026-08-31, task 86bbq80j5).
    // This used to file on `gate.action === 'conflict'` alone, never reading
    // the verdict the block above had just computed. On 2026-08-30 a lost push
    // race — the merge was clean, the push lost a race, `PUSH_FAILED` — was
    // filed as "Resolve the merge conflict on PR #444", 200ms before the
    // hand-off comment beside it correctly said the next pass would merge it.
    // The acceptance criteria on that filed ticket described clearing conflict
    // markers that did not exist. `shouldFileConflictTicket` is the same
    // function `conflictHandOffNotice` reads to pick its actor, so the ticket
    // and the promise cannot name two different people again.
    let filed = findConflictTicket(comments, pr.number);
    const alreadyFiled = Boolean(filed);
    if (shouldFileConflictTicket(localVerdict) && !filed && !dryRun) {
      filed = await fileConflictTicket({
        task, pr, branch, localVerdict, commentId: decision.commentId, unchecked,
      });
    }

    const notice = conflictHandOffNotice({
      commentId: decision.commentId,
      pr,
      localVerdict,
      filed,
    });
    const handOffReason = notice.marker.replace(/^refused:\s*/, '');
    // WHO ACTS NEXT, asked once. Every branch below used to key off `filed`,
    // which conflates "no ticket" with "no actor" — wrong for a verdict that
    // found no overlap, where the actor is the next pass and is real. The
    // notice already decided this from the shared predicate; read its answer
    // rather than re-deriving one (task 86bbq80j5).
    const selfHealing = notice.actor === 'later-pass';
    // "It found no overlap" and "it never looked" are different facts and only
    // one of them is a finding — the distinction review round 2 sent this back
    // for. Both are non-self-healing, so `selfHealing` alone cannot tell the
    // copy below which sentence it is entitled to write.
    const isRealOverlapVerdict = isRealOverlap(localVerdict);
    if (lane) return { outcome: 'lane-cancel', reason: gate.reason };


    // The quiet path — right on the merits, and exactly where three days of
    // silence lived. It stays quiet only while a NAMED actor is plausibly
    // still on it: a filed ticket, recent enough to believe. No ticket, or a
    // day with no progress, and the pass says so instead (task 86bbq0fh8,
    // criterion 4).
    // A conflict ticket filed THIS pass is news even though the reason has not
    // changed — the actor is new, and naming it is the whole fix. This is also
    // the healing path for the hand-offs already sitting in the live record
    // with no ticket behind them (PR #434 and its shape): the next pass files
    // one and says so, with no command to remember to run by hand. Same
    // reasoning as the marker migration in mergeOnComment.parseMergeMarker.
    const freshlyFiled = Boolean(filed) && !alreadyFiled;
    if (alreadySaid(handOffReason) && !freshlyFiled) {
      const stalled = handOffStalled({
        at: decision.priorRefusalAt, now: Date.now(), filed, localVerdict,
      });
      if (!stalled.stalled) {
        console.error(`  MERGE HANDED OFF (unchanged, nothing posted) on ${label}: ${gate.reason}`);
        return { outcome: 'handed-off-quiet', reason: gate.reason };
      }
      // THE VERDICT, not `filed` and not the actor. These three surfaces reach
      // the BUS, and each of them used to ask a two-way question of a
      // three-way answer: round 1 caught them reading `filed`, round 3 caught
      // them reading a two-valued `actor`, which cannot tell a found overlap
      // apart from a check that never ran. They take `localVerdict` now and
      // derive what they need from the one table in conflictWork.js.
      const line = stalledHandOffLine({ task, pr, filed, stalled, localVerdict });
      console.error(`  MERGE HAND-OFF STALLED on ${label}: ${stalled.why}`);
      stalledHandOffs.push({ line, kind: notice.kind });
      if (dryRun) return { outcome: 'would-report-stalled', reason: stalled.why };
      const busStall = await postToBus(channel, `[CC-starcaster bus-relay] ${stalledHandOffHeadline({ localVerdict })} — ${line}\n\n${pr.url}`);
      // "One pass of noise per day is the price" (conflictWork.js) — and the
      // clock that meters it is the marker's timestamp, so a stall that has
      // been ANNOUNCED re-stamps the marker and the next nag is a day away.
      // An announcement that failed does not: leaving the old stamp is what
      // makes the next pass try again instead of going quiet for a day on
      // the strength of a post nobody saw (review round 1, task 86bbq0fh8).
      if (!busStall.ok) reportBusFailure({ cosmetic: false, unchecked, busSkipped, line: `${task.id}: a stalled conflict hand-off could not be announced on the bus (${busStall.why})` });
      else await markMergeHandled(decision.commentId, task, unchecked, notice.marker);
      return { outcome: 'handed-off-stalled', reason: stalled.why };
    }

    const handOffActorLine = filed
      ? ` — filed as ${filed.id}`
      : selfHealing
        ? ' — no overlap found; the next pass retries the catch-up'
        : ' — NOT FILED, nothing will pick this up';
    console.error(`  MERGE HANDED OFF on ${label}: ${gate.reason}${handOffActorLine}`);
    if (dryRun) {
      // A dry run never attempts the local catch-up, so it has NO verdict, and
      // no verdict now reads as could-not-check — the honest answer to "what
      // did you find?" when nothing was looked at (review round 2). That is
      // also what makes the dry run report a stalled, unfiled hand-off instead
      // of quietly calling it self-healing.
      //
      // It cannot know which of the three the real pass would land on, so it
      // names all three rather than trading one confident guess for another.
      console.error(`  DRY RUN — would attempt the catch-up on ${branch} and then hand off. A dry run computes no local verdict, so which hand-off it would be is unknown: no overlap means the next pass retries and nothing is filed; a real overlap, or a check that could not run at all, means a Loop Queue ticket is filed and named.`);
      return { outcome: 'would-hand-off', reason: gate.reason };
    }
    const cOut = await call('POST', `/api/v2/task/${task.id}/comment`, { comment_text: notice.body });
    if (!cOut.res.ok) unchecked.push(`${task.id}: PR #${pr.number} conflicts, but the hand-off comment FAILED to post`);
    // The bus post names the actor now instead of asking the room for one.
    // It is a notification, not a request — the work is already filed.
    // Three actors, three sentences. The self-healing one is new: it used to
    // get the UNFILED body, which tells the room to point an agent session at
    // a branch that has nothing wrong with it (task 86bbq80j5).
    // WHAT THE BUS IS TOLD, and it may only assert what the pass actually
    // found (review round 2). The self-healing sentence — "this machine found
    // no overlap ... nobody needs to claim it" — is TRUE only for a proven
    // no-overlap. It used to be printed for a failed fetch and for a repo this
    // machine has no checkout of, standing the room down on a look nobody took.
    // So the middle case is now its own sentence, and it says which it is.
    const couldNotLook = !selfHealing && !isRealOverlapVerdict;
    const blockedWhy = couldNotLook
      ? `GitHub called PR #${pr.number} a conflict and this machine could not check whether that is true — ${localVerdict ? localVerdict.reason : 'no local check was attempted'}${isPermanent(localVerdict) ? '. That answer is permanent from here: the branch is in a repo this machine has no checkout of, so no future pass can settle it either' : ''}`
      : `PR #${pr.number} conflicts with main`;
    const busBody = selfHealing
      ? `[CC-starcaster bus-relay] MERGE DEFERRED — ${label} (${task.url}): GitHub called PR #${pr.number} a conflict, but this machine merged it here with no overlap at all. Nothing needs resolving and nobody needs to claim it; the next relay pass retries the catch-up. Ticket left in Ready to launch.\n\n${pr.url}`
      : filed
        ? `[CC-starcaster bus-relay] MERGE BLOCKED — ${label} (${task.url}): ${blockedWhy}. Picking it up is filed as ${filed.url} in the Loop Queue, which the build loop drains — no session needs to claim this from here. Dane's approval still stands: once the branch is clean and CI is green, a later pass merges it with no second "merge" from him. Ticket left in Ready to launch.\n\n${pr.url}`
        : `[CC-starcaster bus-relay] MERGE BLOCKED AND UNFILED — ${label} (${task.url}): ${blockedWhy}, and the Loop Queue ticket could NOT be filed. Nothing is going to pick this up on its own. An agent session must be pointed at branch ${branch}. Ticket left in Ready to launch.\n\n${pr.url}`;
    const bus = await postToBus(channel, busBody);
    // An unfiled hand-off is NOT cosmetic: the ticket comment says nothing is
    // working on it, and if the bus post fails too, nobody has been told.
    if (!bus.ok) reportBusFailure({ cosmetic: Boolean(filed) || selfHealing, unchecked, busSkipped, line: `${task.id}: conflict hand-off posted to the ticket but the bus post failed (${bus.why})` });
    // IT MAY NOT ASSERT THE FINDING EITHER (review round 3, item 3). This line
    // said "conflicts" and "this conflict" for every non-healing verdict,
    // including the ones where nothing was looked at — the same sentence the
    // bus post beside it had already been fixed not to write.
    if (!filed && !selfHealing) unchecked.push(isRealOverlapVerdict
      ? `${task.id}: PR #${pr.number} conflicts and NO Loop Queue ticket could be filed for it — no actor exists for this conflict, and it will not merge on its own`
      : `${task.id}: GitHub called PR #${pr.number} a conflict, this machine could not check whether that is true, and NO Loop Queue ticket could be filed to find out — no actor exists for it, and it will not merge on its own`);
    if (alreadyFiled) console.error(`  (conflict ticket ${filed.id} was already on file — not filed twice)`);
    await markMergeHandled(decision.commentId, task, unchecked, notice.marker);
    return { outcome: 'handed-off', reason: gate.reason, filed: filed ? filed.id : null };
  }

  // -------------------------------------------------------------------------
  // THE CHECK MAY BE ANSWERING AN OLDER QUESTION (2026-08-26, task
  // 86bbmk7pv). A GitHub status check is computed ONCE PER COMMIT. The
  // `review-gate` check reads the ticket for a review PASS — and loop-review
  // posts that PASS *after* the last push, by definition. So the run that
  // already happened saw no verdict and will not re-run on its own; nothing
  // later changes its mind.
  //
  // While the gate is advisory that is harmless (it exits 0 either way). The
  // moment the branch-protection box is ticked it is a deadlock: every
  // correctly-reviewed PR carries a stale red check that only a new commit
  // can clear, and pushing a commit to clear it invalidates the review that
  // just passed. So the merge step re-runs a stale gate rather than merging
  // on it — and never the other way round, which would be weakening the gate
  // to work around its own staleness.
  //
  // THIS SITS ABOVE THE WAIT AND REFUSE BRANCHES, AND THE ORDER IS THE FIX
  // (found in review, 2026-08-30). In enforcing mode a stale gate exits 1 —
  // a RED check — so githubGate answers 'refuse', and a staleness question
  // asked after the refusal branch is never reached in the one mode it was
  // written for: the deadlock above, unchanged. A stale RED gate means
  // "re-run it"; only a re-run that comes back red is a real refusal. The
  // conflict hand-off and the catch-up stay above it on purpose: a conflict
  // needs an agent session no matter what the gate says, and a catch-up push
  // fires `synchronize`, which re-runs the gate on its own — this is the
  // path where nothing was pushed, so nothing re-ran.
  //
  // The one PR that skips the question is one that is not open for work at
  // all — closed, merged, or a draft. Its refusal reason is the honest one
  // ("the PR is already merged"), and re-running a check on it would spend a
  // CI run to change nothing.
  const prOpenForWork = String((prJson && prJson.state) || '').toUpperCase() === 'OPEN' && !prJson.isDraft;
  const staleness = reviewGate.reviewGateStaleness({ rollup: prJson.statusCheckRollup, comments });
  if (prOpenForWork) {
    if (staleness.state === 'pending') {
      console.error(`  MERGE WAITING on ${label}: ${staleness.reason}`);
      return { outcome: 'waiting', reason: staleness.reason };
    }
    if (staleness.state === 'stale') {
      if (dryRun) {
        console.error(`  DRY RUN — would re-run the stale review gate on PR #${pr.number}, then wait: ${staleness.reason}`);
        return { outcome: 'would-rerun-review-gate', pr: pr.number, reason: staleness.reason };
      }

      // The budget question comes BEFORE the re-run is fired, and the answer
      // to "no budget left" is a quiet wait, not a refusal: the cap is this
      // pass's own scheduling limit, not a fact about the PR, and firing the
      // re-run first meant spending a CI run only to post a refusal about a
      // result nobody had waited for (found in review, 2026-08-30).
      if (!inPassBudget || !mergeOnComment.mayWaitInPass(inPassBudget.used, inPassBudget.cap)) {
        const why = `the review gate is stale (${staleness.reason}) but this pass has no wait budget left — the next pass re-runs it`;
        console.error(`  MERGE WAITING on ${label}: ${why}`);
        return { outcome: 'waiting', reason: why };
      }

      const cannotRerun = (why) => refuse(
        `the review gate on PR #${pr.number} is out of date (${staleness.reason}) and ${why}`,
        `PR #${pr.number} carries a review check that was worked out BEFORE the review landed, so it is answering an older question. It could not be re-run, and merging on the old answer is not something this step will do.`,
      );
      if (!staleness.runId) return cannotRerun('its workflow run could not be identified, so it cannot be re-run');

      const rerun = gh(['run', 'rerun', String(staleness.runId), '--repo', repo]);
      if (!rerun.ok) return cannotRerun(`re-running it failed (${rerun.stderr.slice(0, 200)})`);
      console.error(`  ${label}: re-ran the stale review gate (run ${staleness.runId}) — ${staleness.reason}`);

      // Wait for the RE-RUN, not merely for "the checks look settled". A
      // re-run takes a few seconds to appear, and until it does GitHub still
      // reports the old, settled, stale answer — polling on githubGate alone
      // would act on it in the first poll, which is the whole bug wearing a
      // fresh coat. The hook is pure (reviewGate.duringRerunWait) and only a
      // FRESH answer falls through to the ordinary gate: 'absent' inside this
      // wait is the rollup mid-swap, not "no gate on this PR".
      const after = await waitForChecksInPass({
        pr, repo, label, fields, budget: inPassBudget,
        gateOf: (json) => reviewGate.duringRerunWait({
          staleness: reviewGate.reviewGateStaleness({ rollup: json.statusCheckRollup, comments }),
          gate: githubGate(json),
        }),
      });
      const next = reviewGate.afterRerunDecision(after);
      if (next.action === 'refuse') {
        return refuse(next.reason, `PR #${pr.number} was not merged: its review check had to be re-run first, and the re-run did not clear it.`);
      }
      if (next.action === 'conflict' || next.action === 'wait') {
        // Rare: the branch went stale or fell behind during the three minutes
        // of the re-run. Say nothing now and let the NEXT pass take it from
        // the top, where the conflict hand-off and the catch-up live — those
        // paths know how to explain themselves to the operator and this one
        // does not.
        console.error(`  MERGE WAITING on ${label}: ${next.reason} (found while re-running the review gate)`);
        return { outcome: 'waiting', reason: next.reason };
      }
      console.error(`  ${label}: the re-run of the review gate came back clean — ${next.reason}`);
      // The re-run rewrote the answer the rest of this function acts on: the
      // gate that said 'refuse' was refusing the stale red check that no
      // longer exists. Carry the fresh read forward so the refusal branch
      // below judges the PR as it is now, not as it was.
      gate = { action: next.action, reason: next.reason };
      if (after.prJson) prJson = after.prJson;
    }
  }

  // Not terminal: no marker, no comment, no noise. The next pass looks again.
  if (gate.action === 'wait') {
    console.error(`  MERGE WAITING on ${label}: ${gate.reason}`);
    return { outcome: 'waiting', reason: gate.reason };
  }

  if (gate.action === 'refuse') {
    return refuse(gate.reason, `PR #${pr.number} is not in a state that can be merged safely.`);
  }

  if (dryRun) {
    console.error(`  DRY RUN — would merge PR #${pr.number} (${gate.reason}) and set ${label} to Live`);
    return { outcome: 'would-merge', pr: pr.number };
  }

  // --squash to match every other merge in this repo; never --admin and
  // never a force of any kind (DOCTRINE 6.6 — a convenience command does not
  // get to route around a standing decision).
  const merged = gh(['pr', 'merge', String(pr.number), '--repo', repo, '--squash', '--delete-branch']);
  if (!merged.ok) {
    return refuse(`the merge command itself failed (${merged.stderr.slice(0, 300)})`, `PR #${pr.number} could not be merged.`);
  }
  const mergedAt = new Date().toISOString();
  console.error(`  MERGED PR #${pr.number} for ${label}`);

  // Marker first, now that the irreversible thing has happened: if the next
  // two writes fail, the worst case is a ticket that needs a hand, not a
  // second merge attempt against an already-merged PR.
  const mergedRecord = mergedNotice({
    commentId: authorizingComment,
    pr,
    mergedAt,
    lane: lane ? lane.name : undefined,
    files: lane ? lane.files : undefined,
  });
  await markMergeHandled(authorizingComment, task, unchecked, mergedRecord.marker);

  const recOut = await call('POST', `/api/v2/task/${task.id}/comment`, { comment_text: mergedRecord.body });
  if (!recOut.res.ok) unchecked.push(`${task.id}: PR #${pr.number} MERGED, but the record comment failed to post`);

  // Live is a closed status: the ticket leaves the open view here. Assignees
  // clear in the same write — the handoff rule, same as every other machine
  // status (loop-build SKILL.md, "Assignment is the handoff signal").
  const rem = (task.assignees || []).map((a) => a.id);
  const moveOut = await call('PUT', `/api/v2/task/${task.id}`, { status: 'Live', assignees: { add: [], rem } });
  if (!moveOut.res.ok) {
    unchecked.push(`${task.id}: PR #${pr.number} MERGED but the ticket did NOT move to Live — move it by hand`);
  } else {
    const now = moveOut.json.status?.status ?? '?';
    if (now.toLowerCase() !== 'live') {
      unchecked.push(`${task.id}: PR #${pr.number} MERGED but the move to Live did not stick (came back "${now}")`);
    } else {
      const leftover = (moveOut.json.assignees || []).map((a) => a.id);
      if (leftover.length) unchecked.push(`${task.id}: moved to Live but assignees did not clear ([${leftover.join(', ')}])`);
    }
  }

  const how = lane
    ? `AUTO-MERGED (Lane ${lane.name}, one-hour window elapsed with no objection)`
    : "MERGED on Dane's say-so";
  const bus = await postToBus(channel, `[CC-starcaster bus-relay] ${how}: ${label} — PR #${pr.number} squash-merged into main, ticket set to Live. main auto-deploys.\n\n${pr.url}`);
  if (!bus.ok) reportBusFailure({ cosmetic: true, unchecked, busSkipped, line: `${task.id}: PR #${pr.number} merged and the ticket moved and recorded, but the bus post failed (${bus.why})` });

  return { outcome: 'merged', pr: pr.number, url: pr.url, lane: lane ? lane.name : null, files: lane ? lane.files : null };
}

// ── Lane A plumbing (task 86bbkw2au) ─────────────────────────────────────────
//
// Everything below is network and file IO. Not one decision is made here: the
// rules live in scripts/builder/autoMergeLane.js, where they can be
// break-tested without a ClickUp, a GitHub or a clock.

/**
 * Where the ledger lives. `.git/` rather than a folder in the working tree,
 * for one reason: it is the only place in a repo that cannot be committed by
 * accident, and a record of what a machine merged on its own is not something
 * to discover in a `git status` six weeks later. `--git-common-dir` answers
 * from inside a linked worktree too, so the relay finds the same file wherever
 * it is started (vault doctrine/NODES.md P1 — derive the path, never write it
 * down).
 */
function ledgerPath() {
  const out = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  const dir = out.status === 0 ? String(out.stdout || '').trim() : '';
  if (!dir) return null;
  return `${dir}/auto-merge-ledger.json`;
}

/** The ledger's IO lives in autoMergeLedgerFile.js so it can be tested;
 *  these two only supply the path. */
function readLedger() { return readLedgerFile(ledgerPath()); }

/**
 * The kill switch's other half: the party line. A read failure here is NOT a
 * quiet zero — it means we cannot know whether he said stop, and the entire
 * point of standing condition 1 is that those two are not the same thing.
 */
async function readBusSwitchSignals(channel) {
  const out = await call('GET', `/api/v3/workspaces/${WORKSPACE}/chat/channels/${channel}/messages`);
  if (!out.res.ok) {
    return { readable: false, signals: [], why: `the party line could not be read (HTTP ${out.res.status})` };
  }
  // An HTTP 200 whose body is not the shape we know is NOT "he never said
  // stop" — it is "we could not tell", which is the one place unreadable
  // must not equal absent (2026-08-30, review round 2).
  const messages = Array.isArray(out.json?.data) ? out.json.data
    : Array.isArray(out.json?.messages) ? out.json.messages : null;
  if (!messages) {
    return { readable: false, signals: [], why: 'the party line answered, but not in a shape this relay recognises as a message list' };
  }
  const signals = [];
  for (const m of messages) {
    // Only HIS words. An agent post quoting the phrase is a machine talking to
    // itself, and a bus full of agents discussing the kill switch would hold
    // it down permanently.
    //
    // THE USER ID IS NOT ENOUGH, AND SAYING SO WAS NOT ENOUGH EITHER. Every
    // agent posts to the party line under Dane's token, so `user_id` says
    // "his account", never "his words" — the sentence above described an
    // intent this function did not enforce, and the ticket path next door
    // (operatorComments) had been enforcing it with the machine marker all
    // along. Two readings of "only HIS words", one guarded and one not, and
    // the unguarded one is the channel nobody watches (task 86bbt038u).
    const body = m.content ?? m.text_content ?? m.comment_text;
    if (Number(m.user_id ?? m.userId ?? m.user?.id) !== OPERATOR_ID) continue;
    if (isMachineComment(body)) continue;
    const kind = switchCommand(body);
    if (kind) signals.push({ kind, at: Number(new Date(m.date ?? m.created_at ?? 0)) || 0, where: 'on the party line' });
  }
  return { readable: true, signals };
}

/** Is main's most recent build red? The second self-disable trigger (condition 4). */
function mainBuildIsRed(repo) {
  const out = gh(['run', 'list', '--repo', repo, '--branch', 'main', '--limit', '1', '--json', 'conclusion,status,createdAt']);
  if (!out.ok) return { known: false, red: false, why: 'could not read the build history for main' };
  try {
    const runs = JSON.parse(out.stdout);
    const last = runs[0];
    if (!last) return { known: true, red: false };
    // A run still in flight is not a red run. Reading "not yet green" as red
    // would disable the lane every time CI is merely busy.
    if (String(last.status || '').toUpperCase() !== 'COMPLETED') return { known: true, red: false };
    const c = String(last.conclusion || '').toUpperCase();
    return { known: true, red: !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c), at: Number(new Date(last.createdAt)) || 0 };
  } catch {
    return { known: false, red: false, why: 'the build history for main was unparseable' };
  }
}

/** The PR's changed files — the whole of criterion 1's evidence. */
function prChangedFiles(prNumber, repo) {
  const out = gh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'files,changedFiles']);
  if (!out.ok) return { ok: false, files: [], why: out.stderr.slice(0, 200) };
  try {
    const json = JSON.parse(out.stdout);
    const files = (json.files || []).map((f) => f.path);
    // `files` is capped at 100 by gh; `changedFiles` is the true count. A PR
    // judged on a truncated list could be "tests only" in the first hundred
    // and touch lib/ in the hundred-and-first. Refuse rather than judge.
    if (Number.isFinite(Number(json.changedFiles)) && Number(json.changedFiles) !== files.length) {
      return { ok: false, files: [], why: `gh listed ${files.length} files but the PR changes ${json.changedFiles} — the list is truncated, so eligibility cannot be judged` };
    }
    return { ok: true, files };
  } catch {
    return { ok: false, files: [], why: 'gh returned unparseable JSON for the file list' };
  }
}

/**
 * Post a Lane A notice on the ticket and READ IT BACK, returning ClickUp's own
 * timestamp for it.
 *
 * THE READ-BACK IS THE FEATURE, not diligence theatre. The one-hour clock runs
 * from the confirmed post time, never from local time at the moment of
 * sending: an announcement that failed to post is not a window, and a clock
 * started on the attempt would merge something nobody was ever told about.
 */
async function postLaneNotice(taskId, body) {
  const out = await call('POST', `/api/v2/task/${taskId}/comment`, { comment_text: body });
  if (!out.res.ok) return { ok: false, why: `the notice did not post (HTTP ${out.res.status}), so no clock was started` };
  const back = await call('GET', `/api/v2/task/${taskId}/comment`);
  if (!back.res.ok) return { ok: false, why: 'the notice posted but could not be read back, so no clock was started' };
  const id = String(out.json?.id ?? '');
  const found = (back.json.comments || []).find((c) => String(c.id) === id)
    || (back.json.comments || []).find((c) => String(c.comment_text || '').includes(body.slice(0, 60)));
  if (!found) return { ok: false, why: 'the notice did not read back, so no clock was started' };
  return { ok: true, at: Number(found.date) || 0, commentId: String(found.id) };
}

/** hh:mmam with the zone, read from this machine (OPERATIONS SOP 13). */
function clockAt(ms) {
  const d = new Date(Number(ms));
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
  const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(d).find((x) => x.type === 'timeZoneName')?.value;
  return zone ? `${time} ${zone}` : time;
}

/**
 * Stamp the Loop note without exiting the process. `stampLoopNote` is a CLI
 * command and calls process.exit on failure, which is right for a one-shot and
 * catastrophic inside a pass that still has tickets to get through.
 */
async function stampLoopNoteSoftly(taskId, text, unchecked) {
  const before = await call('GET', `/api/v2/task/${taskId}?include_markdown_description=false`);
  const field = before.res.ok && (before.json.custom_fields || []).find(
    (f) => String(f.name || '').trim().toLowerCase() === 'loop note');
  if (!field) {
    unchecked.push(`${taskId}: could not stamp the Loop note (the field was not found) — the queue will not show the auto-merge state`);
    return;
  }
  const out = await call('POST', `/api/v2/task/${taskId}/field/${field.id}`, { value: text });
  if (!out.res.ok) unchecked.push(`${taskId}: the Loop note write failed — the queue will not show the auto-merge state`);
}

/**
 * The `Ready to launch` gate (task 86bbjt18r). That status is the operator's
 * "safe to merge" signal, and on 2026-08-22 two tickets reached it with no
 * passing review recorded on them at all — he approved both in good faith.
 * Refusing here, in the one place every loop's status write passes through,
 * closes the path rather than adding another rule to a skill file.
 *
 * Returns true when the caller should stop. Runs BEFORE any write, so a
 * refusal leaves the ticket exactly where it was.
 */
async function readyToLaunchRefused(task, status) {
  if (!isReadyToLaunch(status)) return false;
  if (flag('operator-asked')) {
    console.error('Review gate bypassed on your say-so (--operator-asked). Recorded in this transcript.');
    return false;
  }
  const out = await call('GET', `/api/v2/task/${task}/comment`);
  if (!out.res.ok) {
    // Could not check is not the same as passed (DOCTRINE 3.11).
    console.error('\nCould not read this ticket\'s comments, so the review check could NOT be run.');
    console.error('Nothing was moved. Try again, or pass --operator-asked if you have checked by eye.\n');
    return true;
  }
  const gate = readyToLaunchGate(out.json?.comments || []);
  if (gate.ok) return false;
  console.error(`\n"Ready to launch" is the operator's safe-to-merge signal, and ${gate.why}.\n`);
  console.error('Nothing was moved — the ticket is where you left it.\n');
  console.error('If review really did pass, record the verdict first, then move it:');
  console.error(`  npm run clickup -- verdict --task ${task} --pass --body-file -\n`);
  console.error('If it did not pass, it belongs back in Queued with notes, not in his inbox.');
  console.error('To override anyway, add --operator-asked — that flag is your written claim');
  console.error('that a human checked this, visible in the transcript.\n');
  return true;
}

/**
 * THE OPERATOR MUST NOT BE ASKED FOR SOMETHING HE HAS ALREADY ANSWERED
 * (task 86bbk34x7). Moving a ticket into one of his statuses IS the claim that
 * something is needed from him — so it is checked against the live ticket, by
 * the same rule `waiting` uses, before anything is written.
 *
 * This is the 2026-08-23 failure: he answered `A` on the YouTube worker ticket
 * and an hour later was asked the same question again. Authorship only — no
 * reading of intent from his words (the ticket's own non-goal); if his comment
 * is the newest one, a machine owes the next move.
 *
 * IT HAS TO STAND ON BOTH DOORS. `ask` is one way into his lane;
 * `status --status "Needs your input" --no-card` is the other, and it
 * auto-assigns him just the same. A guard that covers one of two routes is
 * worse than none, because it invites the belief that the double-ask is now
 * impossible — the same lesson `readyToLaunchRefused` above already learned
 * (task 86bbjt18r). Both callers go through here; `waitingRuleCarried.test.js`
 * fails if either one loses it.
 *
 * Returns null when the caller may proceed, or the exit code it should stop
 * with (1 = could not read, 2 = refused). Runs BEFORE any write, so a refusal
 * leaves the ticket exactly where it was.
 */
async function alreadyAnsweredRefused(task, status) {
  if (!OPERATOR_STATUSES.includes(String(status || '').toLowerCase())) return null;

  // --after-his-answer says "yes, I know he just spoke; this is a NEW
  // question." A real thing to need, and worth saying out loud in the log.
  if (flag('after-his-answer')) {
    console.error('Handing this back although he spoke last (--after-his-answer). Recorded in this transcript.');
    return null;
  }

  const seen = await call('GET', `/api/v2/task/${task}/comment`);
  if (!seen.res.ok) {
    console.error(`\nCould not read the comments on ${task} — HTTP ${seen.res.status}.`);
    console.error('Refusing to hand this to Dane without knowing whether he has already answered it.');
    console.error('Nothing has been posted and the status has NOT moved. Try again, or pass');
    console.error('--after-his-answer if you already know this is a new question.');
    return 1;
  }
  // `call` leaves json null when a 2xx body is not JSON, so the optional chain
  // is what keeps this refusal a refusal instead of a TypeError at the one
  // moment it matters.
  if (operatorSpokeLast(seen.json?.comments || [], { operatorId: OPERATOR_ID })) {
    console.error(`\nREFUSED — Dane's own comment is the NEWEST one on ${task}, so a machine owes`);
    console.error('the next move here. Handing it back to him now asks him to answer twice, which');
    console.error('is exactly what this check exists to stop (task 86bbk34x7, 2026-08-23).');
    console.error('\nRead what he said:   npm run clickup -- waiting --task ' + task);
    console.error('If this really is a NEW question, say so on the record:  ... --after-his-answer');
    console.error('\nNothing was posted and the status has NOT moved.');
    return 2;
  }
  return null;
}

let cmd = process.argv[2];

// ---------------------------------------------------------------------------
// `claim` — the build loop's claim, with the status guard filled in for it.
//
// WHY IT EXISTS (2026-08-31, task 86bbr1u9v). loop-build now drains TWO
// statuses, `Rework` before `Queued`, and the atomic claim needs `--if-status`
// to name the one the caller actually read. That leaves a step that must be
// REMEMBERED — look at column two of the queue, then type it — and this repo
// has a standing answer to that shape: a pass that must remember is a pass that
// will forget (buildStart.js, loopTrail.js). Getting it wrong is not cosmetic.
// Guarding on `Queued` when the ticket is in `Rework` refuses every send-back,
// which silently reproduces the starvation the status was created to end;
// loosening the guard to accept either would break the one thing keeping two
// build sessions off the same ticket (acceptance criterion 5).
//
// So it is one read: the status is taken from the ticket itself and handed
// straight to the SAME `--if-status` guard, which then re-reads and compares
// before writing. That is exactly the window `status --if-status` has always
// had — this adds no race, it only removes the typing.
//
// It refuses (exit 3) on any status loop-build may not claim, which is the
// normal "someone got there first" code, and it deliberately does NOT reach
// into `Building` or `In review` to "help".
if (cmd === 'claim') {
  const task = arg('task');
  if (!task) {
    console.error('claim needs --task <id>.');
    process.exit(2);
  }
  const seen = await call('GET', `/api/v2/task/${task}`);
  if (!seen.res.ok) die('read the task before claiming it', seen);
  const now = seen.json.status?.status ?? '';
  if (!loopStatuses.isClaimableByBuild(now)) {
    console.error(`NOT claimed: "${task}" is "${now || '?'}", which loop-build may not claim.`);
    console.error(`Claimable statuses, in drain order: ${loopStatuses.CLAIMABLE_BY_BUILD.map((x) => loopStatuses.DISPLAY[x]).join(', ')}.`);
    console.error('Take the next task in the queue.');
    process.exit(3);
  }
  // Hand the exact status it is in to the ordinary guarded write, so there is
  // one writer, one verifier and one place that clears assignees.
  if (arg('status') || arg('if-status')) {
    console.error('claim sets --status and --if-status itself; pass neither.');
    console.error('If you need to name them by hand, use `status` directly — that is the honest form.');
    process.exit(2);
  }
  process.argv = [
    ...process.argv.slice(0, 2),
    'status',
    ...process.argv.slice(3),
    '--status', loopStatuses.DISPLAY[loopStatuses.BUILDING],
    '--if-status', now,
  ];
  console.error(`claiming ${task} out of "${now}" (guarded on that exact status)`);
  cmd = 'status';
}

if (cmd === 'whoami') {
  const out = await call('GET', '/api/v2/user');
  if (!out.res.ok) die('whoami', out);
  // Report identity, not just success (DOCTRINE 3.5).
  console.log(`Token valid. Acting as: ${out.json.user.username} <${out.json.user.email}>`);
  reportLimits(out.res);

} else if (cmd === 'task') {
  const list = arg('list'), name = arg('name'), bodyFile = arg('body-file');
  if (!list || !name || !bodyFile) usage();

  // Urgent is the human lane (ratified 2026-08-18): the queue sorts
  // priority-then-age, so an Urgent flag is a human override that outranks
  // everything the machine decided — with no other machinery needed. An
  // agent filing Urgent on its own defeats that outright. --operator-asked
  // is not a real permission check (nothing here CAN check who typed the
  // command) — it is the agent's own written claim that the operator said
  // so, sitting in shell history and the transcript where it can be
  // checked later, same shape as every other "say why" guard in this file.
  if (String(arg('priority', '')).toLowerCase() === 'urgent' && !flag('operator-asked')) {
    console.error('\nUrgent is reserved for the operator, not something an agent sets on its own.');
    console.error('File at High or below by default.');
    console.error('If the operator explicitly asked for Urgent, add --operator-asked to confirm that —');
    console.error('it is your written claim that this is what happened, visible in the transcript.\n');
    process.exit(1);
  }

  const tags = arg('tags') ? arg('tags').split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const out = await call('POST', `/api/v2/list/${list}/task`, {
    name,
    markdown_description: readBody(bodyFile),
    status: arg('status') || undefined,
    priority: PRIORITY[arg('priority', '')] || undefined,
    tags,
  });
  if (!out.res.ok) die('create task', out);

  const id = out.json.id;
  const idOut = arg('id-out');
  if (idOut) writeFileSync(idOut, id);
  console.log(`\nCreated task ${id}\n  ${out.json.url}`);
  reportLimits(out.res);

  // A 200 proves a write happened, not that the right thing landed. Read it
  // back — an empty description is the silent failure this repo keeps hitting.
  const check = await call('GET', `/api/v2/task/${id}`);
  if (!check.res.ok) {
    console.error('  WARNING: created, but could not read it back to verify.');
    process.exit(1);
  }
  const t = check.json;
  const chars = (t.description || '').length;
  console.log('\nVerified by reading the task back:');
  console.log(`  name:        ${t.name}`);
  console.log(`  list:        ${t.list?.name} (${t.list?.id})`);
  console.log(`  status:      ${t.status?.status}`);
  console.log(`  priority:    ${t.priority?.priority ?? '(none)'}`);
  console.log(`  description: ${chars} characters`);
  // Tags are load-bearing now (loop-spec routes a task to its repo by a
  // repo:<name> tag) and a dropped one reads as starcaster and looks fine —
  // so verify they landed, same discipline as the body/status read-back.
  if (tags && tags.length) {
    const landed = new Set((t.tags || []).map((x) => String(x.name || '').toLowerCase()));
    const missing = tags.filter((want) => !landed.has(want.toLowerCase()));
    console.log(`  tags:        ${(t.tags || []).map((x) => x.name).join(', ') || '(none)'}`);
    if (missing.length) {
      console.error(`\n  TAGS DID NOT STICK: asked for [${missing.join(', ')}] — a repo:<name> tag dropped here routes the task to the wrong repo.`);
      process.exit(1);
    }
  }
  if (chars === 0) {
    console.error('\n  BODY IS EMPTY — the description did not save. Task exists but is a shell.');
    process.exit(1);
  }

} else if (cmd === 'chat') {
  const channel = arg('channel'), bodyFile = arg('body-file');
  if (!channel || !bodyFile) usage();
  const out = await call('POST', `/api/v3/workspaces/${WORKSPACE}/chat/channels/${channel}/messages`, {
    type: 'message',
    content: readBody(bodyFile),
    content_format: 'text/md',
  });
  if (!out.res.ok) die('send chat message', out);
  console.log(`\nPosted to channel ${channel}. Message id ${out.json?.data?.id ?? out.json?.id ?? '(unknown)'}`);
  reportLimits(out.res);

} else if (cmd === 'wip-check') {
  // Is the merge side already full? Exit codes mirror `node:owns`:
  //   0 = room to claim   3 = capped, a normal decline   1 = could not tell
  //
  // Reads only. A capped pass must leave the queue exactly as it found it, so
  // nothing here writes to ClickUp — no status, no comment, no Loop note.
  // One shared probe (`capProbe`), so this and `next-interval` cannot answer
  // the same question differently again — task 86bbq8br2. What stays here is
  // only what is genuinely this command's own: it fails OPEN.
  const probe = await capProbe({ repo: arg('repo') || '' });

  if (!probe.determined) {
    const undecided = wipCap.undeterminedDecision(probe.why);
    console.error(undecided.message);
    process.exit(undecided.code);
  }

  // Say WHY the stricter reading is in force. "6 open, cap 5" with no
  // explanation is how the original deadlock stayed invisible for four
  // passes; the same silence about a failed read would do it again.
  if (!probe.statusesAvailable) {
    console.error(`The Loop Queue could not be read (${probe.queueFailure}), so every open PR is counted.`);
  }

  console.log(probe.decision.message);
  process.exit(probe.decision.code);

} else if (cmd === 'next-interval') {
  // How long should this loop sleep before its next pass? Prints ONE INTEGER
  // (seconds) on stdout and the reason on stderr, so a runner can do
  //   NEXT=$(npm run --silent clickup -- next-interval --for loop-build --fallback 3600)
  // and still have the reason land in its log. Always exits 0: an unreadable
  // queue is answered with the configured fallback, not with a failure the
  // runner would have to interpret. (task 86bbmg2fb)
  const loop = arg('for');
  if (!loop || !loopInterval.LOOP_STATUS[loop]) {
    console.error(`next-interval needs --for <${loopInterval.KNOWN_LOOPS.join('|')}>`);
    usage();
  }
  const fallbackSeconds = arg('fallback', String(loopInterval.DEFAULT_FALLBACK_SECONDS));
  const list = arg('list', LOOP_QUEUE_LIST);
  const stateFile = arg('state-file')
    || process.env.LOOP_INTERVAL_STATE
    || path.join(os.homedir(), 'loop-logs', `${loop}.interval-state.json`);

  // Answer and leave: one exit path, so no branch can forget to print the
  // integer or to exit 0.
  const answer = (decision, { writeState = true } = {}) => {
    if (writeState && decision.state) {
      try {
        mkdirSync(path.dirname(stateFile), { recursive: true });
        writeFileSync(stateFile, `${JSON.stringify(decision.state)}\n`);
      } catch (err) {
        // A state file we cannot write costs hysteresis, not correctness: the
        // next pass simply reads no history and holds at the fallback, which
        // is the safe direction. Say so rather than dying.
        console.error(`  (could not save interval state to ${stateFile}: ${err.message} — hysteresis will restart next cycle)`);
      }
    }
    console.error(`interval: ${decision.reason}`);
    console.log(String(decision.seconds));
    process.exit(0);
  };

  // Previous cycle's reading. A missing or corrupt file is simply no history.
  let state = null;
  try {
    if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    console.error(`  (interval state at ${stateFile} is unreadable — starting the hysteresis over)`);
  }

  // Is the merge side full? Only `loop-build` can be stopped by the cap, so
  // only `loop-build` pays for asking.
  let capReached = false;
  if (loop === 'loop-build') {
    // The SAME probe `wip-check` uses — ticket statuses and all. Before task
    // 86bbq8br2 this read `number,state` and passed no statuses, so it counted
    // PRs whose tickets were `Queued` for rework and reported a full cap while
    // the claim gate reported room. `--repo` pins it to a repository the way
    // `wip-check` allows, so it is not silently cwd-dependent (review round 1).
    const probe = await capProbe({ repo: arg('repo') || '' });
    if (!probe.determined) {
      // Unlike `wip-check`, this one assumes the cap IS full when it cannot
      // count. `wip-check` fails open because refusing there would stop all
      // work on a transient `gh` hiccup; here the pass has already run and the
      // only question is how long to sleep, so the safe direction is the long
      // one. Never silent.
      capReached = true;
      console.error(`  (could not count open PRs — ${probe.why}; assuming the WIP cap is full, which lengthens this sleep rather than shortening it)`);
    } else {
      if (!probe.statusesAvailable) {
        console.error(`  (the Loop Queue could not be read — ${probe.queueFailure}; every open PR is counted, the conservative reading)`);
      }
      capReached = probe.decision.code === 3;
      // Print the cap sentence itself, not just its effect. This is the line
      // that makes a disagreement with `wip-check` visible in the log instead
      // of having to be inferred from an interval, which is how the original
      // took a morning to spot.
      console.error(`  (cap: ${String(probe.decision.message).split('\n')[0]})`);
    }
  }

  // The queue itself — EVERY page. The first version read page 0 only, on the
  // argument that the curve saturates at 4; but ClickUp pages newest-first and
  // the loops claim oldest-first, so the oldest `Queued` backlog is exactly
  // what a one-page read drops (review round 1; DOCTRINE 5.12).
  let tasks = null;
  let res = null;
  try {
    const out = await fetchAllTasks(list, { fatal: false });
    if (out.failed || !Array.isArray(out.tasks)) throw new Error(`ClickUp list read failed (${out.failed || 'no tasks'})`);
    tasks = out.tasks;
    res = out.res;
    console.error(`  (read ${tasks.length} open task(s) in the list, every page)`);
  } catch (err) {
    answer(loopInterval.fallbackInterval({ fallbackSeconds, why: err.message }), { writeState: false });
  }

  // Blockers the list cannot show. The list read returns OPEN tasks only, so
  // a blocker that has finished is precisely the one that is missing — and
  // the one that must not keep its dependant looking blocked forever (review
  // round 1: a ticket waiting on a Live blocker read as blocked on every
  // cycle). Read each such id back once; one that cannot be read stays
  // unseen, which the module treats as still blocking — the safe direction.
  const blockers = [];
  for (const id of loopInterval.outsideBlockerIds(tasks)) {
    try {
      const out = await call('GET', `/api/v2/task/${id}`);
      if (out.res.ok && out.json?.id) blockers.push(out.json);
      else console.error(`  (blocker ${id} could not be read — HTTP ${out.res.status}; treated as still open)`);
    } catch (err) {
      console.error(`  (blocker ${id} could not be read — ${err.message}; treated as still open)`);
    }
  }

  const { depth, excluded, note } = loopInterval.claimableDepth({
    loop,
    tasks,
    capReached,
    resolveRepo: resolveTaskRepo,
    blockers,
  });
  if (note) console.error(`  (${note})`);
  for (const x of excluded) console.error(`  (not claimable: ${x.id} — ${x.why})`);

  const decision = loopInterval.decideInterval({ depth, state, fallbackSeconds });
  if (res) reportLimits(res);
  answer(decision);

} else if (cmd === 'queue') {
  const list = arg('list');
  if (!list) usage();
  const status = arg('status');
  // `--claimable` is what a build pass asks for (task 86bbr1u9v): every status
  // loop-build may take, in the order it must take them — all of `Rework`
  // first, oldest first, then `Queued` by priority-then-oldest.
  //
  // IT IS A SEPARATE FLAG AND NOT A CHANGE TO `--status Queued`, because those
  // are different questions and the old one still has honest answers ("show me
  // the fresh work"). What is NOT honest any more is using `--status Queued`
  // as the claim list: it silently hides every sent-back ticket, which is the
  // bug this whole ticket is about, arriving through the command meant to fix
  // it. So asking for both at once is refused rather than quietly resolved.
  const claimable = flag('claimable');
  if (claimable && status) {
    console.error('--claimable and --status are two different questions; pass one.');
    console.error('  --claimable    every status loop-build may take, in claim order (Rework, then Queued)');
    console.error(`  --status <s>   one status exactly as spelled: ${loopStatuses.STAGE_ORDER.join(' / ')}`);
    process.exit(2);
  }
  const { tasks, res } = await fetchAllTasks(list);
  // Filter locally, case-insensitively — the same matching the `status`
  // command's verify uses — so a casing mismatch cannot masquerade as an
  // empty queue the way a server-side filter miss would.
  let wanted;
  if (claimable) {
    // Filtering AND ordering in one call, from the module the pacing curve
    // reads, so the first line is the ticket the claim rule actually names.
    wanted = loopStatuses.claimOrder(tasks);
  } else {
    wanted = status
      ? tasks.filter((t) => (t.status?.status ?? '').toLowerCase() === status.toLowerCase())
      : tasks;
    // Within one status the rule is unchanged: highest priority first, then
    // oldest.
    wanted.sort((a, b) =>
      (PRIORITY_RANK[a.priority?.priority] ?? loopStatuses.PRIORITY_UNKNOWN)
        - (PRIORITY_RANK[b.priority?.priority] ?? loopStatuses.PRIORITY_UNKNOWN)
      || Number(a.date_created) - Number(b.date_created));
  }
  for (const t of wanted) {
    const created = new Date(Number(t.date_created)).toISOString().slice(0, 10);
    // The repo a task declares (Charter: a task declares its repo). A loop
    // reads this to decide WHICH checkout to build in — '?<name>' marks a tag
    // that resolves to nothing known, so the loop escalates rather than
    // building it in the wrong place.
    const r = resolveTaskRepo(t.tags);
    const repoCol = r.action === 'escalate' ? `?${r.repo ?? 'ambiguous'}` : r.repo;
    // The Loop note last, so anything already reading the first six columns
    // keeps working. It is what says "a pass is already running on this one".
    console.log([t.id, t.status?.status ?? '?', t.priority?.priority ?? 'none', repoCol, created, t.name, loopNoteOf(t)].join('\t'));
  }
  const scope = claimable
    ? ` claimable by loop-build (${loopStatuses.CLAIMABLE_BY_BUILD.join(' then ')})`
    : (status ? ` with status "${status}"` : '');
  console.error(`${wanted.length} task(s)${scope} in list ${list} (all pages; first line is the one to claim)`);
  if (claimable && wanted.length) {
    const first = wanted[0];
    // The claim command, spelled out with THIS ticket's status already in it.
    // `--if-status` must name the status the caller actually read, and a
    // build pass that has to remember which of two statuses it just saw is a
    // pass that will guard on the wrong one — see `claim`, which removes the
    // step entirely.
    console.error(`  claim it: npm run clickup -- claim --task ${first.id}`);
  }
  if (res) reportLimits(res);

} else if (cmd === 'migrate-rework') {
  // The one-off that puts the existing send-backs where they belong
  // (task 86bbr1u9v, acceptance criterion 6). Leaving them behind in `Queued`
  // reproduces this ticket's own bug on day one.
  //
  // THE ORDER MATTERS AND IT IS THE TRAP ON THIS TICKET. Until the claim rule
  // above is live on `main`, a ticket in `Rework` is claimed by NOTHING — it
  // drops out of `claimableDepth`, out of the pacing curve, and out of the
  // build loop's reach entirely, which is strictly worse than sitting visible
  // in `Queued`. So this runs after the merge, never before. It is idempotent
  // and dry by default, so running it twice is free and running it early is
  // at worst a listing.
  //
  // WHICH TICKETS: `Queued` with an OPEN pull request naming them. That is the
  // definition of a send-back that nothing else can express — it is exactly
  // what `wipCap.classifyPrs` already computes for the cap, so it is read from
  // there rather than re-derived, and the migration cannot disagree with the
  // number the cap reports.
  const list = arg('list') || LOOP_QUEUE_LIST;
  const apply = flag('apply');

  const probe = await capProbe({ repo: arg('repo') || '' });
  if (!probe.determined) {
    console.error(`Could not list the open pull requests (${probe.why}), so there is no way to tell which`);
    console.error('queued tickets are half-built. NOTHING was changed — this refuses rather than guessing,');
    console.error('because moving a ticket that has no PR into Rework is a lie the next reader acts on.');
    process.exit(1);
  }
  if (!probe.statusesAvailable) {
    console.error(`The Loop Queue could not be read (${probe.queueFailure}). NOTHING was changed.`);
    process.exit(1);
  }

  const { tasks } = await fetchAllTasks(list, { includeClosed: true });
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const knownIds = tasks.map((t) => String(t.id));
  const openPrs = probe.decision.groups?.queued || [];

  // Back from PR number to ticket, through the SAME reader the cap uses.
  const targets = [];
  const prsByTicket = new Map();
  let openPrList;
  try {
    openPrList = listOpenPullRequests(arg('repo') || '');
  } catch (err) {
    console.error(`Could not re-read the open pull requests (${err.message}). NOTHING was changed.`);
    process.exit(1);
  }
  for (const pr of openPrList) {
    if (!openPrs.includes(pr.number)) continue;
    const id = wipCap.ticketIdFromPrBody(pr.body, knownIds);
    if (!id) continue;
    const task = byId.get(id) || [...byId.values()].find((t) => String(t.id).toLowerCase() === id);
    if (!task) continue;
    if (!prsByTicket.has(String(task.id))) {
      prsByTicket.set(String(task.id), pr.number);
      targets.push(task);
    }
  }

  if (!targets.length) {
    console.log('Nothing to migrate: no ticket is Queued with an open pull request against it.');
    process.exit(0);
  }

  console.log(`${targets.length} ticket(s) are Queued with an open PR — they are send-backs, not fresh work:`);
  for (const t of targets) console.log(`  ${t.id}  #${prsByTicket.get(String(t.id))}  ${t.name}`);
  if (!apply) {
    console.log('\nDRY RUN — nothing was changed. Re-run with --apply once the claim rule is live on main.');
    process.exit(0);
  }

  let moved = 0;
  for (const t of targets) {
    const rem = (t.assignees || []).map((a) => a.id);
    const out = await call('PUT', `/api/v2/task/${t.id}`, {
      status: loopStatuses.DISPLAY[loopStatuses.REWORK],
      assignees: { add: [], rem },
    });
    // Verified from the write response, the same rule `status` follows: a 200
    // is not evidence the status changed.
    const now = String(out.json?.status?.status || '').toLowerCase();
    if (!out.res.ok || now !== loopStatuses.REWORK) {
      console.error(`  ${t.id}: NOT moved (HTTP ${out.res.status}, status now "${now || '?'}")`);
      continue;
    }
    console.log(`  ${t.id} -> Rework (verified)`);
    moved += 1;
  }
  console.log(`${moved} of ${targets.length} moved.`);

  // The list's own DESCRIPTION documents the flow, and it still describes the
  // six-status one. A list description that documents the WRONG flow is worse
  // than none, because a reader has no way to tell — so it moves with the
  // tickets, in the same post-merge step, rather than being a chore somebody
  // remembers. Only the flow sentence is rewritten; anything else Dane has
  // written there is left exactly as it is.
  const listRead = await call('GET', `/api/v2/list/${list}`);
  if (!listRead.res.ok) {
    console.error(`The tickets moved, but the list description could NOT be read (HTTP ${listRead.res.status}) — it still documents the old flow.`);
    process.exit(1);
  }
  const oldFlow = /Statuses:[^\n]*/;
  const newFlow = 'Statuses: Rework -> Queued -> Building -> In review -> '
    + 'Needs your input / Ready to launch -> Live (closed). '
    + 'A build loop drains every Rework ticket (a send-back, with a branch and an open PR already) '
    + 'before any Queued one, oldest first.';
  const content = String(listRead.json?.content || '');
  const nextContent = oldFlow.test(content) ? content.replace(oldFlow, newFlow) : `${content}\n\n${newFlow}`.trim();
  if (nextContent === content) {
    console.log('The list description already describes the Rework flow.');
  } else {
    const wrote = await call('PUT', `/api/v2/list/${list}`, { content: nextContent });
    if (!wrote.res.ok || !String(wrote.json?.content || '').includes('Rework ->')) {
      console.error(`The tickets moved, but the list description did NOT update (HTTP ${wrote.res.status}).`);
      process.exit(1);
    }
    console.log('The list description now documents the Rework flow (verified from the write response).');
  }

  if (moved !== targets.length) process.exit(1);

} else if (cmd === 'stage-counts') {
  // Every stage of the pipeline, counted, as JSON — for the weekly report
  // (task 86bbkw1mn) and anything else that wants the shape of the queue
  // rather than its contents.
  //
  // It is a command here, and not a `queue | wc -l` in the report script, for
  // one reason: the token. Reading ClickUp means holding the API token, and
  // the standing rule is that the token lives in exactly one script that
  // Doppler feeds (DOCTRINE 4.1). A second reader would be a second place to
  // get that wrong.
  const list = arg('list') || LOOP_QUEUE_LIST;
  const since = arg('since'); // YYYY-MM-DD; counts tickets CLOSED on/after it
  // A floor with no ceiling counted everything closed from --since until NOW,
  // so `--since 2026-08-25` on a window that ended the 25th was still counting
  // tickets closed on the 28th. Right for a window ending today by accident,
  // wrong for every other one.
  const until = arg('until'); // YYYY-MM-DD; the other end of that count

  // Work the range out BEFORE asking ClickUp for anything. A date typo is the
  // caller's mistake either way, but finding it after the fetch spends a page
  // of the API budget to tell them so.
  let cutoff = null;
  let ceiling = Infinity;
  if (since) {
    cutoff = Date.parse(`${since}T00:00:00Z`);
    if (Number.isNaN(cutoff)) {
      console.error(`--since "${since}" is not a YYYY-MM-DD date.`);
      process.exit(2);
    }
    if (until) {
      ceiling = Date.parse(`${until}T23:59:59.999Z`);
      if (Number.isNaN(ceiling)) {
        console.error(`--until "${until}" is not a YYYY-MM-DD date.`);
        process.exit(2);
      }
      if (ceiling < cutoff) {
        console.error(`--until "${until}" is before --since "${since}".`);
        process.exit(2);
      }
    }
  } else if (until) {
    console.error('--until needs --since; a ceiling with no floor is not a window.');
    process.exit(2);
  }

  const { tasks } = await fetchAllTasks(list, { includeClosed: true });
  const byStatus = {};
  for (const t of tasks) {
    const key = (t.status?.status ?? 'unknown').toLowerCase();
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  let closedInWindow = null;
  if (cutoff !== null) {
    closedInWindow = tasks.filter((t) => {
      const closedAt = Number(t.date_closed);
      return Number.isFinite(closedAt) && closedAt > 0 && closedAt >= cutoff && closedAt <= ceiling;
    }).length;
  }
  console.log(JSON.stringify({ list, total: tasks.length, byStatus, since: since || null, until: until || null, closedInWindow }, null, 2));

} else if (cmd === 'get') {
  const task = arg('task');
  if (!task) usage();
  const out = await call('GET', `/api/v2/task/${task}?include_markdown_description=true`);
  if (!out.res.ok) die('get task', out);
  const t = out.json;
  console.log(`id:       ${t.id}`);
  console.log(`name:     ${t.name}`);
  console.log(`status:   ${t.status?.status ?? '?'}`);
  console.log(`loop note:${loopNoteOf(t) ? ` ${loopNoteOf(t)}` : ' (none)'}`);
  console.log(`priority: ${t.priority?.priority ?? 'none'}`);
  console.log(`assigned: ${assigneeNames(t)}`);
  console.log(`list:     ${t.list?.name} (${t.list?.id})`);
  const r = resolveTaskRepo(t.tags);
  console.log(`repo:     ${r.action === 'escalate' ? `ESCALATE — ${r.reason}` : `${r.repo} (${r.reason})`}`);
  console.log(`url:      ${t.url}`);
  console.log('---');
  console.log(t.markdown_description || t.description || '(no body)');
  reportLimits(out.res);

} else if (cmd === 'task-name') {
  // The machine-readable half of `get`. `get` prints a header block meant for a
  // human, so a script wanting the name has to parse `name: ` off line 2 — which
  // breaks the moment the header gains a line or a name wraps. `npm run ship`
  // titles the pull request from this (task 86bbqwupk), and the title has to be
  // BYTE-IDENTICAL to the ticket name for the Closed list and the deploy list to
  // pair up, so a parse that is nearly right is worse than no parse at all.
  //
  // Contract, and the reason every other line here goes to stderr: stdout is the
  // name and a newline, and nothing else. `reportLimits` is deliberately not
  // called — it writes to stderr, but a caller reading combined output would
  // still get the rate-limit line glued onto the title.
  const task = arg('task');
  if (!task) usage();
  const out = await call('GET', `/api/v2/task/${task}`);
  if (!out.res.ok) die('get task name', out);
  const name = String(out.json?.name ?? '');
  if (!name.trim()) {
    console.error(`Task ${task} has an empty name — nothing to print.`);
    process.exit(1);
  }
  process.stdout.write(`${name}\n`);

} else if (cmd === 'comments') {
  const task = arg('task');
  if (!task) usage();
  const out = await call('GET', `/api/v2/task/${task}/comment`);
  if (!out.res.ok) die('read comments', out);
  const comments = (out.json.comments || []).slice().reverse(); // API is newest-first; oldest first reads as a story
  for (const c of comments) {
    const when = new Date(Number(c.date)).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`[${when}] ${c.user?.username ?? '?'} (comment ${c.id}):`);
    console.log(c.comment_text || '(empty)');
    console.log('---');
  }
  console.error(`${comments.length} comment(s) on task ${task}`);
  reportLimits(out.res);

} else if (cmd === 'status') {
  const task = arg('task'), status = arg('status');
  if (!task || !status) usage();
  if (flag('assign') && !arg('assign')) {
    console.error('--assign needs a user id after it (e.g. --assign 48012725); refusing to guess.');
    process.exit(2);
  }
  const assignId = arg('assign') ? Number(arg('assign')) : null;
  if (assignId !== null && !Number.isInteger(assignId)) {
    console.error(`--assign got "${arg('assign')}", which is not a numeric ClickUp user id.`);
    process.exit(2);
  }

  // Handing a ticket to the operator means saying what you need from him.
  // Before 2026-08-22 those were two separate commands, so the status could
  // move on its own and routinely did — Sync 7/7 sat in his inbox for a day
  // wearing a red "Needs your input" badge with no answerable question
  // anywhere on it. `ask` does both together; this refuses the half of it
  // that produces that state. Runs BEFORE any network call: a refusal must
  // leave the ticket exactly where it was.
  if (OPERATOR_STATUSES.includes(status.toLowerCase()) && !flag('no-card')) {
    console.error(`\n"${status}" is a handoff to the operator, not just a status.\n`);
    console.error('Use `ask` instead — it posts the operator card and moves the status together:');
    console.error(`  npm run clickup -- ask --task ${task} --status "${status}" --body-file -\n`);
    console.error('The card body is these sections, and the check runs before anything is sent:');
    console.error('  @@ASKED    his own words that caused this ticket, verbatim');
    console.error('  @@WHEN     optional — when and where he said it');
    console.error(`  @@CONTEXT  the problem and the fix in plain English, ${CONTEXT_MIN_WORDS}-${CONTEXT_MAX_WORDS} words`);
    console.error('  @@NEEDED   the specific ask ("Nothing right now" is fine — say it out loud)');
    console.error('  @@EVIDENCE required only when the ask spends money or cannot be undone: the');
    console.error('             command, its real output, and when you ran it ("measured at 8:04pm")\n');
    console.error('If this really is a status move with no ask attached, pass --no-card. That flag is');
    console.error('your written claim that a card is not owed here, visible in the transcript.\n');
    process.exit(2);
  }

  // A ticket may not reach "Ready to launch" without a passing review on it.
  // `status --no-card` is the other door into that status, so the gate has to
  // stand on both (task 86bbjt18r).
  if (await readyToLaunchRefused(task, status)) process.exit(2);

  // And the same reasoning for the already-answered guard (task 86bbk34x7):
  // `--no-card` walks past the "use `ask` instead" refusal above and still
  // lands the ticket in his lane with his name auto-assigned to it, so the
  // double-ask has a route here too unless this stands on both doors.
  const answeredStop = await alreadyAnsweredRefused(task, status);
  if (answeredStop !== null) process.exit(answeredStop);

  // One read up front: it powers the --if-status claim guard, the
  // clear-assignees list, and the was→now line in the report.
  const before = await call('GET', `/api/v2/task/${task}`);
  if (!before.res.ok) die('read task before update', before);
  const was = before.json.status?.status ?? '?';

  const ifStatus = arg('if-status');
  if (ifStatus && was.toLowerCase() !== ifStatus.toLowerCase()) {
    console.error(`NOT claimed: expected status "${ifStatus}" but the task is "${was}" —`);
    console.error('another loop or the operator got there first. Pick the next task instead.');
    process.exit(3);
  }

  // The handoff rule, enforced where every handoff passes (so it cannot be
  // forgotten at a call site): operator statuses carry the operator,
  // machine statuses carry nobody. Explicit flags override; --no-auto-assign
  // opts out entirely.
  const toOperator = OPERATOR_STATUSES.includes(status.toLowerCase());
  let add = assignId !== null ? [assignId] : [];
  let clearing = flag('clear-assignees');
  if (!flag('no-auto-assign')) {
    if (toOperator && add.length === 0) add = [OPERATOR_ID];
    if (!toOperator && !clearing && add.length === 0) clearing = true;
  }
  const rem = clearing
    ? (before.json.assignees || []).map((a) => a.id).filter((id) => !add.includes(id))
    : [];

  const body = { status };
  if (add.length || rem.length) body.assignees = { add, rem };
  const out = await call('PUT', `/api/v2/task/${task}`, body);
  if (!out.res.ok) die('set status', out);

  // Verify from the write's OWN response — server-authoritative post-update
  // state, no second request, no window for a parallel loop to muddy the
  // comparison. Status AND assignees: a 200 with the assignee half dropped
  // is the silent handoff loss this command exists to prevent.
  const t = out.json;
  const now = t.status?.status ?? '?';
  if (now.toLowerCase() !== status.toLowerCase()) {
    console.error(`Status did NOT stick: asked for "${status}", the write came back "${now}".`);
    console.error('Usually the list does not have that status — statuses are per-list in ClickUp.');
    process.exit(1);
  }
  const finalIds = (t.assignees || []).map((a) => a.id);
  for (const id of add) {
    if (!finalIds.includes(id)) {
      console.error(`Assignee did NOT stick: asked to assign ${id}, the task carries [${finalIds.join(', ')}].`);
      console.error('The status moved, but the handoff signal is missing — fix the assignment before relying on it.');
      process.exit(1);
    }
  }
  if (clearing) {
    const leftover = finalIds.filter((id) => !add.includes(id));
    if (leftover.length) {
      console.error(`Assignees did NOT clear: [${leftover.join(', ')}] still on the task.`);
      process.exit(1);
    }
  }
  console.log(`Task ${task}: "${was}" -> "${now}", assigned: ${assigneeNames(t)} (verified from the write response).`);
  reportLimits(out.res);

} else if (cmd === 'priority') {
  const task = arg('task'), priorityArg = arg('priority');
  if (!task || !priorityArg) usage();
  const wanted = priorityArg.toLowerCase();
  if (!(wanted in PRIORITY)) {
    console.error(`"${priorityArg}" is not a priority. Use one of: ${Object.keys(PRIORITY).join(', ')}.`);
    process.exit(2);
  }

  // Same guard as `task`, same reasoning: Urgent is the operator's lane.
  if (wanted === 'urgent' && !flag('operator-asked')) {
    console.error('\nUrgent is reserved for the operator, not something an agent sets on its own.');
    console.error('If the operator explicitly asked for Urgent, add --operator-asked to confirm that —');
    console.error('it is your written claim that this is what happened, visible in the transcript.\n');
    process.exit(1);
  }

  const before = await call('GET', `/api/v2/task/${task}`);
  if (!before.res.ok) die('read task before update', before);
  const was = before.json.priority?.priority ?? '(none)';

  const out = await call('PUT', `/api/v2/task/${task}`, { priority: PRIORITY[wanted] });
  if (!out.res.ok) die('set priority', out);

  // Verify from the write's OWN response — same discipline as `status`: a
  // 200 proves a request landed, not that ClickUp actually changed the
  // value (a priority name only valid in some lists, a stale id, etc.).
  const now = out.json.priority?.priority ?? '(none)';
  if (now !== wanted) {
    console.error(`Priority did NOT stick: asked for "${wanted}", the write came back "${now}".`);
    process.exit(1);
  }
  console.log(`Task ${task}: priority "${was}" -> "${now}" (verified from the write response).`);
  reportLimits(out.res);

} else if (cmd === 'comment') {
  const task = arg('task'), bodyFile = arg('body-file');
  if (!task || !bodyFile) usage();
  const sent = readBody(bodyFile);
  const out = await call('POST', `/api/v2/task/${task}/comment`, { comment_text: sent });
  if (!out.res.ok) die('add comment', out);
  const newId = String(out.json.id ?? '');
  // Read the comments back: a write that normalizes to nothing looks exactly
  // like a success (DOCTRINE 3.10).
  const check = await call('GET', `/api/v2/task/${task}/comment`);
  if (!check.res.ok) {
    console.error('WARNING: comment posted, but reading comments back failed — verify by eye.');
    process.exit(1);
  }
  const found = (check.json.comments || []).find((c) => String(c.id) === newId);
  if (!found || !(found.comment_text || '').trim()) {
    console.error(`Comment did NOT land intact: id ${newId || '(none)'} ${found ? 'saved empty' : 'not found on the task'}.`);
    process.exit(1);
  }
  console.log(`Comment ${newId} added to task ${task} (${found.comment_text.length} characters, verified by reading it back).`);
  reportLimits(check.res);

} else if (cmd === 'attach') {
  /*
   * SCREENSHOTS ARE THE POINT OF THE APPROVAL QUEUE.
   *
   * Charter Q5 (2026-08-18): a visual change reaches the operator as
   * before/after pictures on the ticket, so the decision he is asked for is
   * "does this look right" rather than "check out this branch and run it".
   * `scripts/ui/shoot_changes.mjs` produces the pair; this puts them where he
   * will actually see them.
   *
   * Multipart, not JSON — so this cannot go through call(), which pins
   * Content-Type to application/json. Node supplies FormData/Blob natively;
   * fetch sets the multipart boundary, and setting Content-Type by hand here
   * breaks the upload with a boundary mismatch.
   */
  const task = arg('task');
  const files = argAll('file');
  if (!task || !files.length) usage();

  const before = await call('GET', `/api/v2/task/${task}`);
  if (!before.res.ok) die('read task before attaching', before);
  const had = (before.json.attachments || []).length;

  const uploaded = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const form = new FormData();
    form.append('attachment', new Blob([bytes]), basename(file));
    // Not routed through `call` (multipart), so count it here or the pass
    // total under-reports — see the note beside `requestCount`.
    requestCount += 1;
    const res = await fetch(`https://api.clickup.com/api/v2/task/${task}/attachment`, {
      method: 'POST',
      headers: { Authorization: TOKEN },
      body: form,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* provider returned a non-JSON error page */ }
    if (!res.ok) die(`attach ${basename(file)}`, { res, json, text });
    uploaded.push({ name: basename(file), id: json?.id ?? '(no id)', bytes: bytes.length });
    reportLimits(res);
  }

  // A 200 per upload is not proof the task carries them: read the list back
  // and count. The write response is not the record (DOCTRINE 3.10).
  const after = await call('GET', `/api/v2/task/${task}`);
  if (!after.res.ok) {
    console.error('WARNING: uploaded, but could not read the task back to verify.');
    process.exit(1);
  }
  const now = (after.json.attachments || []).length;
  for (const u of uploaded) console.log(`${u.id}\t${u.name}\t${u.bytes} bytes`);
  console.error(`Attached ${uploaded.length} file(s) to task ${task}; the task now lists ${now} (was ${had}).`);
  if (now < had + uploaded.length) {
    console.error('\nFEWER attachments than were uploaded — ClickUp accepted the request but did not keep them all.');
    process.exit(1);
  }
  reportLimits(after.res);
} else if (cmd === 'build-start') {
  // "Is somebody already building this?" — asked BEFORE a branch is created.
  //
  // On 2026-08-23 a build pass opened two duplicate PRs in one session,
  // because the atomic claim answers a different question: it stops two
  // builders starting at once, and says nothing about work that was started
  // days ago and handed back. A sent-back ticket is genuinely `Queued`, its
  // PR is genuinely still open, and nothing looked.
  const task = arg('task');
  if (!task) usage();

  const got = await call('GET', `/api/v2/task/${task}/comment`);
  if (!got.res.ok) die('read the task comments', got);

  // gh, not the GitHub API directly: it is already the repo's authenticated
  // path everywhere else, and a second auth story is a second thing to break.
  // --repo, ALWAYS (task 86bbqyyfn). Without it gh resolves the repo from the
  // working directory, which is always starcaster — so a `repo:pulse` ticket
  // was answered with starcaster's PR of the same number.
  const lookupPr = (pr) => {
    const out = spawnSync('gh', buildStart.prLookupArgs(pr), {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (out.status !== 0) return null; // could not tell — NOT "no PR"
    try {
      return JSON.parse(out.stdout);
    } catch {
      return null;
    }
  };

  const decision = buildStart.resolveBuildStart(got.json.comments || [], { lookupPr });
  console.log(buildStart.describeBuildStart(decision));
  if (decision.pr) {
    console.log(`pr:     #${decision.pr.number}${decision.pr.branch ? ` (branch ${decision.pr.branch})` : ''}`);
    console.log(`url:    ${decision.pr.url}`);
  }
  reportLimits(got.res);

  // Exit codes so a shell can branch on this without parsing prose, matching
  // `node:owns`: 0 = go ahead, 3 = somebody else's work, 1 = cannot tell.
  if (decision.action === 'continue') process.exit(3);
  if (decision.action === 'unknown') process.exit(1);
  process.exit(0);
} else if (cmd === 'pr-opened') {
  // The build loop's audit trail, made into a command (task 86bbjt18r).
  // Until now step 7 of loop-build said "add the PR URL as a ClickUp
  // comment" in prose, and on 2026-08-22 four Ready-to-launch tickets had no
  // such comment at all — the merge step then correctly refused to guess
  // which PR they meant, and the approvals went quiet. Prose is followed
  // most of the time; a command is followed every time, and this one fails
  // loudly rather than leaving a trail nothing can read.
  const task = arg('task'), prArg = arg('pr');
  if (!task || !prArg) usage();

  const before = await call('GET', `/api/v2/task/${task}`);
  if (!before.res.ok) die('read the task', before);
  const taskUrl = before.json.url || `https://app.clickup.com/t/${task}`;

  // Accept a full URL or a bare number with --repo, because both are what a
  // session actually has to hand after `gh pr create`.
  const urlMatch = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(prArg.trim());
  let repo = arg('repo'), prNumber, prUrl;
  if (urlMatch) {
    repo = repo || `${urlMatch[1]}/${urlMatch[2]}`;
    prNumber = Number(urlMatch[3]);
    prUrl = `https://github.com/${repo}/pull/${prNumber}`;
  } else if (/^\d+$/.test(prArg.trim())) {
    if (!repo) {
      console.error('--pr got a bare number, so --repo owner/name is needed to know which repository.');
      process.exit(2);
    }
    prNumber = Number(prArg.trim());
    prUrl = `https://github.com/${repo}/pull/${prNumber}`;
  } else {
    console.error(`--pr got "${prArg}", which is neither a GitHub pull-request URL nor a number.`);
    process.exit(2);
  }

  // The link the OTHER way round. Two of those four PRs also shipped with no
  // ClickUp link in the body, so ticket and PR could only be matched by
  // reading titles. Checked before the comment is posted: a PR that cannot be
  // traced back to its ticket is not a finished hand-off, and fixing the body
  // afterwards is a step nobody remembers.
  //
  // IT RUNS BEFORE --if-missing CAN SHORT-CIRCUIT (task 86bbq7z1k, round 2).
  // This check used to sit inside the idempotence skip below, so a
  // ticket that already carried a trail was reported as "already recorded",
  // exit 0, whatever its PR body said. Ship then declared success and the
  // review gate FAILED the same PR with "the PR body carries no ClickUp ticket
  // link, so there is no review to check" — a cheerful all-clear standing in
  // front of a refusal, which is the precise failure mode this ticket exists to
  // eliminate. Reachable whenever ship reuses an already-open PR whose body
  // predates this change and whose trail was written by hand.
  //
  // So `--if-missing` skips the COMMENT, never the verification. Both halves of
  // the trail are checked on every run; only the write is idempotent.
  const view = gh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'body,url,title,number']);
  if (!view.ok) {
    console.error(`Could not read PR #${prNumber} from ${repo}: ${view.stderr.slice(0, 300)}`);
    console.error('Nothing was written to the ticket.');
    process.exit(1);
  }
  let prJson;
  try { prJson = JSON.parse(view.stdout); } catch {
    console.error(`gh returned output that is not JSON for PR #${prNumber}. Nothing was written.`);
    process.exit(1);
  }
  if (!prBodyCarriesTicket(prJson.body, task, taskUrl)) {
    console.error(`\nPR #${prNumber} has no link back to this ticket in its body, so nothing was written.`);
    console.error('The trail has to run both ways: the ticket names the PR, the PR names the ticket.');
    console.error('Otherwise the only way to pair them later is by reading titles and guessing.\n');
    console.error('Add the line to the PR body and run this again:');
    console.error(`  ClickUp: ${taskUrl}\n`);
    process.exit(4);
  }

  // IDEMPOTENCE (--if-missing, task 86bbq7z1k). `npm run ship` now records the
  // trail itself, and ship is designed to be run again whenever main moves
  // under it — so the SAME PR reaches this command repeatedly. Without a
  // preflight each run posts another identical line, and the ticket collects
  // one per catch-up round. The question is not "did I already post" but the
  // consumer's own question, asked with the consumer's own reader: can the
  // merge step already find THIS PR here? A line written by a loop, or by hand,
  // counts exactly the same — it is the trail that matters, not its author.
  let alreadyRecorded = false;
  if (flag('if-missing')) {
    const pre = await call('GET', `/api/v2/task/${task}/comment`);
    if (!pre.res.ok) die('read the task comments', pre);
    // CANNOT TELL IS NOT "NOT RECORDED". This used to read
    // `pre.json.comments || []`, so a 200 carrying no comments list collapsed
    // to an empty array, read as "no trail here", and wrote — a duplicate
    // "PR opened:" line, which is the one thing --if-missing exists to prevent.
    // An empty ARRAY is a real answer and still writes; a missing one is not.
    if (!commentsReadable(pre.json)) {
      console.error(`\nCould not read task ${task}'s comments: HTTP ${pre.res.status} with no comment list in the body.`);
      console.error('--if-missing cannot tell whether this PR is already recorded, and a guard that');
      console.error('cannot tell must not write — that is how a SECOND "PR opened:" line gets posted.');
      console.error('Nothing was written. Run the same command again.\n');
      process.exit(1);
    }
    if (prTrailLanded(pre.json.comments, prNumber).ok) {
      alreadyRecorded = true;
      console.log(`Task ${task}: PR #${prNumber} is already recorded on this ticket — nothing written.`);
    }
  }

  let lastRes = null;
  if (!alreadyRecorded) {
    const text = prOpenedComment(prUrl, arg('body-file') ? readBody(arg('body-file')) : '');
    const out = await call('POST', `/api/v2/task/${task}/comment`, { comment_text: text });
    if (!out.res.ok) die('post the "PR opened" comment', out);

    // Read it back and parse it with the SAME function the merge step uses.
    // "The write returned 200" is not the question; "can the merge step find
    // this PR tomorrow" is (DOCTRINE 3.10).
    const check = await call('GET', `/api/v2/task/${task}/comment`);
    // An unreadable body belongs HERE, with the other "could not check" case —
    // not below with "the trail did NOT land". The write already succeeded, so
    // the trail is UNVERIFIED, not absent, and saying absent sends whoever
    // reads it off to fix a comment that is probably fine.
    if (!check.res.ok || !commentsReadable(check.json)) {
      console.error(`WARNING: the comment posted but reading it back FAILED, so the trail is UNVERIFIED.`);
      console.error('Check the ticket by eye before treating this task as handed off.');
      process.exit(1);
    }
    const landed = prTrailLanded(check.json.comments, prNumber);
    if (!landed.ok) {
      console.error(`\nThe "PR opened" trail did NOT land: ${landed.why}.`);
      console.error('The merge step will refuse this ticket, and the operator\'s approval will sit');
      console.error('there doing nothing. Fix the comment by hand before handing this to review.\n');
      process.exit(1);
    }
    console.log(`Task ${task}: PR #${prNumber} recorded (${prUrl}), read back and parsed by the merge step's own reader.`);
    lastRes = check.res;
  }

  // Now the number exists, so fill it into the work-log entry that was written
  // before it did. This is the whole point of doing it HERE: it is the one
  // moment where the PR number is known and the pass has not moved on yet.
  // Three branches went red in one day on the unfilled placeholder (task
  // 86bbk1r7w) — not because the guard is wrong, but because "go back and fill
  // it in" is a step that has to be remembered.
  //
  // Nothing to fill is the ordinary case and says nothing. A failure to record
  // it is NOT ordinary: leaving the PR link on the ticket while the placeholder
  // still ships is precisely the state this exists to prevent, so it exits
  // non-zero and names what is unfilled.
  try {
    const logPath = 'docs/WORK-LOG.md';
    const abs = new URL(`../${logPath}`, import.meta.url).pathname;
    const repoDir = new URL('..', import.meta.url).pathname;
    if (existsSync(abs)) {
      const before = readFileSync(abs, 'utf8');
      const filled = workLogPlaceholder.fillNewestPlaceholder(before, prNumber);
      if (filled.changed) {
        const runGit = (args, { cwd } = {}) => {
          const out = spawnSync('git', args, { cwd, encoding: 'utf8' });
          return { ok: out.status === 0, stdout: String(out.stdout || '').trim(), stderr: String(out.stderr || '').trim() };
        };
        const already = runGit(['diff', '--name-only', '--', logPath], { cwd: repoDir });
        if (already.ok && already.stdout) {
          console.error(`NOTE: ${logPath} already had uncommitted changes, so the (#PR) placeholder was NOT filled in.`);
          console.error(`Fill it by hand: change (#PR) to (#${prNumber}) in the newest entry, then commit and push.`);
          process.exit(1);
        }
        writeFileSync(abs, filled.text);
        const done = workLogPlaceholder.commitAndPushWorkLog({ runGit, cwd: repoDir, relPath: logPath, prNumber });
        if (!done.ok) {
          console.error(`\nThe work-log placeholder was NOT recorded: ${done.why}`);
          console.error(`CI will go red on it. Change (#PR) to (#${prNumber}) in the newest entry, then commit and push.\n`);
          process.exit(1);
        }
        console.log(done.why);
      }
    }
  } catch (e) {
    console.error(`NOTE: could not fill the work-log PR number (${e.message}). Check docs/WORK-LOG.md for a leftover (#PR).`);
    process.exit(1);
  }

  // Deliberately OUTSIDE the skip above: the placeholder fill has to run even
  // when the comment was already there. The one state that would otherwise be
  // unreachable is a run that posted the trail and then failed to fill the
  // work-log — a second run would skip straight past the repair it exists for.
  if (lastRes) reportLimits(lastRes);

} else if (cmd === 'verdict') {
  // loop-review's verdict, made into a command for the same reason as
  // pr-opened (task 86bbjt18r). The merge step has always required a PASS
  // verdict comment, but nothing ever required loop-review to WRITE one, so
  // tickets reached Ready to launch with no verdict at all. One shape, one
  // writer, one reader.
  const task = arg('task');
  const passed = flag('pass'), failed = flag('fail');
  if (!task || passed === failed) {
    console.error('verdict needs --task <id> and exactly one of --pass or --fail.');
    process.exit(2);
  }
  // THE RACE GUARD (task 86bbjk5rw). A review takes many minutes, so the queue
  // snapshot it started from is stale by the time it decides. On 2026-08-22 two
  // review passes verified PR #362 at the same time, and the slower one wrote
  // its verdict over the faster one's FAIL — and over a fresh `Building` claim
  // — from a snapshot ~25 minutes old. A verdict is only a statement about the
  // ticket you actually reviewed, so the write is refused when the ticket moved
  // underneath you. --no-guard is the written claim that you meant to skip it.
  const ifStatus = arg('if-status');
  if (!ifStatus && !flag('no-guard')) {
    console.error('\nverdict needs --if-status "<the status you claimed>" — normally --if-status "In review".');
    console.error('It refuses to write if the ticket moved while you were reviewing, which is how one');
    console.error("review pass overwrote another's verdict on 2026-08-22.\n");
    console.error(`  npm run clickup -- verdict --task ${task} ${passed ? '--pass' : '--fail'} --if-status "In review" --body-file -\n`);
    console.error('If this verdict genuinely is not being written from a review claim, pass --no-guard.');
    console.error('That flag is your written claim, visible in the transcript.\n');
    process.exit(2);
  }
  if (ifStatus) {
    const before = await call('GET', `/api/v2/task/${task}`);
    if (!before.res.ok) die('read the task before the verdict', before);
    const was = before.json.status?.status ?? '?';
    if (was.toLowerCase() !== ifStatus.toLowerCase()) {
      console.error(`\nNOTHING WRITTEN: expected "${ifStatus}", the ticket is now "${was}".`);
      console.error('It moved while you were reviewing — another loop or the operator has it now,');
      console.error('and your verdict is about a state that no longer exists.\n');
      console.error('Stand down. Do not write this verdict and do not move the status. Re-read first:');
      console.error(`  npm run clickup -- comments --task ${task}`);
      console.error(`  npm run clickup -- get --task ${task}`);
      console.error('Then take the next task in the queue.\n');
      process.exit(3);
    }
  }

  const note = arg('body-file') ? readBody(arg('body-file')).trim() : '';

  // THE FOURTH-ROUND GATE (task 86bbmg2tq). Three send-backs means the SPEC was
  // wrong, not the builder, and a fourth pass at the same ticket is the system
  // failing to notice it is stuck. So the send-back is REFUSED at round 4 and
  // the pass hands the ticket to Dane instead — a judgement call (respec,
  // split, or drop) that was always his. This is a command and not a line in a
  // skill file for the loopTrail reason: a step that must be remembered is a
  // step that will be forgotten.
  if (!passed) {
    const seen = await call('GET', `/api/v2/task/${task}/comment`);
    if (!seen.res.ok) die('read the ticket\'s send-back history', seen);
    const history = seen.json.comments || [];
    const round = nextRound(history);
    if (wouldEscalate(history) && !flag('fourth-round-anyway')) {
      console.error(`\nNOTHING WRITTEN: this would be send-back round ${round}, and the loop escalates at ${ESCALATE_AT_ROUND}.`);
      console.error('Three rounds means the spec is wrong, not the build. Ask Dane instead of sending it back.\n');
      console.error('What the previous rounds found:');
      for (const line of roundSummaryLines(history)) console.error(`  ${line}`);
      console.error('\nHand it to him — the card must name all three, one line each, so he sees the');
      console.error('pattern rather than the latest symptom, and @@NEEDED should offer him named');
      console.error('options (respec / split / drop) rather than an open question:\n');
      console.error(`  npm run clickup -- ask --task ${task} --status "Needs your input" --body-file -`);
      console.error(`  npm run clickup -- loop-note --task ${task} --transition escalated\n`);
      console.error('If he has already settled this and a fourth round is genuinely the right move,');
      console.error('pass --fourth-round-anyway. That flag is your written claim, visible in the transcript.\n');
      process.exit(3);
    }
    if (!note) {
      console.error('\nNOTHING WRITTEN: a send-back needs a reason (--body-file -).');
      console.error('Its first line becomes the Loop note clause the board shows, so the queue says');
      console.error(`"round ${round} — <why>" rather than "returned to the line" for the ${round}${round === 1 ? 'st' : 'th'} time.\n`);
      process.exit(2);
    }
  }

  const text = verdictComment(passed, note);
  const out = await call('POST', `/api/v2/task/${task}/comment`, { comment_text: text });
  if (!out.res.ok) die('post the review verdict', out);
  const newId = String(out.json.id ?? '');

  const check = await call('GET', `/api/v2/task/${task}/comment`);
  if (!check.res.ok) {
    console.error('WARNING: the verdict posted but reading it back FAILED — it is UNVERIFIED.');
    process.exit(1);
  }
  const stored = (check.json.comments || []).find((c) => String(c.id) === newId);
  if (!stored || !(stored.comment_text || '').trim()) {
    console.error(`The verdict did NOT land: id ${newId || '(none)'} ${stored ? 'saved empty' : 'not found'}.`);
    process.exit(1);
  }
  // Parse it back through the gate itself, not through a second copy of the
  // rule — the point of the read-back is to answer "will the gate accept
  // this", and only the gate can answer that.
  const gate = readyToLaunchGate(check.json.comments || []);
  if (passed && !gate.ok) {
    console.error(`\nThe PASS verdict posted but does NOT read back as a pass: ${gate.why}.`);
    console.error('Moving this ticket to Ready to launch would be refused. Check the comment by eye.\n');
    process.exit(1);
  }
  if (!passed && gate.ok) {
    console.error('\nA send-back verdict posted, but the newest verdict on this ticket still reads');
    console.error('as a PASS. Nothing else was changed — check the ticket by eye.\n');
    process.exit(1);
  }
  const roundNow = passed ? 0 : currentRound(check.json.comments || []);
  console.log(`Task ${task}: verdict ${passed ? 'PASSED' : `sent back (round ${roundNow})`} recorded as comment ${newId}, verified through the Ready-to-launch gate itself.`);
  if (!passed) {
    console.log(`Next: npm run clickup -- loop-note --task ${task} --transition sent-back`);
    if (roundNow + 1 >= ESCALATE_AT_ROUND) {
      console.log(`NOTE: a further send-back on this ticket would be round ${roundNow + 1} — the loop escalates to Dane at ${ESCALATE_AT_ROUND}.`);
    }
  }
  reportLimits(check.res);

} else if (cmd === 'describe') {
  // The left column. Until 2026-08-22 this script could write a comment but
  // not a description, so every loop put its reasoning in the narrow
  // right-hand column and the roomy left one kept a machine-shaped spec.
  // That is the wrong way round, and it is what stalled Sync 6/7 and 7/7.
  const task = arg('task'), bodyFile = arg('body-file');
  if (!task || !bodyFile) usage();
  const sent = readBody(bodyFile);
  if (!sent.trim()) {
    console.error('Refusing to write an empty description — that replaces the whole left column with nothing.');
    console.error('If you really mean to blank it, do it in the ClickUp UI where you can see what you are erasing.');
    process.exit(2);
  }

  // ClickUp deletes blockquote lines from descriptions too, not just comments
  // (found live 2026-08-22 — the "## Dane asked for" section of the first
  // rewritten ticket came back with the quoted instruction gone). Refuse
  // before sending: a partial description is worse than none, because it looks
  // finished.
  const quoted = operatorCard.findBlockquoteLines(sent);
  if (quoted.length) {
    console.error(`\nThis body uses "> " blockquotes (line ${quoted.join(', ')}), and ClickUp DELETES them.`);
    console.error('They do not arrive unformatted — they arrive not at all, and the write still returns 200.\n');
    console.error('Use plain text, **bold**, or a fenced block. A "> " inside a ``` fence is fine.\n');
    process.exit(2);
  }

  const out = await call('PUT', `/api/v2/task/${task}`, { markdown_content: sent });
  if (!out.res.ok) die('set description', out);

  // Read it back. A description write that normalizes to nothing returns a
  // clean 200 (DOCTRINE 3.10) — and this one replaces the whole field, so a
  // silent truncation loses the previous text too.
  const back = await call('GET', `/api/v2/task/${task}?include_markdown_description=true`);
  if (!back.res.ok) {
    console.error('WARNING: description written, but reading it back failed — verify by eye before trusting it.');
    process.exit(1);
  }
  const saved = back.json.markdown_description ?? back.json.description ?? '';
  if (!saved.trim()) {
    console.error(`Description did NOT land: task ${task} reads back empty. The left column has been wiped.`);
    console.error('Restore it from your source file before doing anything else.');
    process.exit(1);
  }
  // ClickUp normalizes markdown on save, so an exact match is the wrong test.
  // A large shortfall is not normalization, it is loss.
  if (saved.length < sent.trim().length * 0.6) {
    console.error(`Description looks TRUNCATED: sent ${sent.trim().length} characters, read back ${saved.length}.`);
    console.error('Open the task and compare before trusting it.');
    process.exit(1);
  }
  console.log(`Task ${task}: description replaced (${sent.trim().length} characters sent, ${saved.length} read back).`);
  reportLimits(back.res);

} else if (cmd === 'ask') {
  // The ONE way a loop hands a ticket to the operator. It posts the card and
  // moves the status together, so the two can never come apart — a status
  // change with no card is a ticket in his inbox with no stated ask, which
  // is exactly how Sync 7/7 sat there for a day (2026-08-22).
  const task = arg('task'), bodyFile = arg('body-file');
  if (!task || !bodyFile) usage();
  // --no-move posts the card and leaves the status alone. For a ticket that
  // stays in a machine status but is still worth explaining — a Queued ticket
  // whose ask is genuinely "nothing right now" reads far better with a card on
  // it than with a bare status, and it is not a handoff.
  const noMove = flag('no-move');
  const status = arg('status') || 'Needs your input';
  if (!noMove && !OPERATOR_STATUSES.includes(status.toLowerCase())) {
    console.error(`\`ask\` hands work to the operator, so --status must be one of: ${OPERATOR_STATUSES.join(', ')}.`);
    console.error(`Got "${status}". For a machine status use \`status\`, or --no-move to post a card without moving.`);
    process.exit(2);
  }

  // A ticket may not reach "Ready to launch" without a passing review on it
  // (task 86bbjt18r). Checked before the card is posted, so a refusal leaves
  // no half-done handoff — the same discipline as the card shape check below.
  if (!noMove && await readyToLaunchRefused(task, status)) process.exit(2);

  // Shape first, network second: a card that fails the check must not leave
  // a half-done handoff behind.
  let rendered, card, commentBody;
  try {
    ({ rendered, card, comment: commentBody } = buildCard(readBody(bodyFile)));
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(2);
  }

  // He must not be asked for something he has already answered (task
  // 86bbk34x7). The rule and its message live in `alreadyAnsweredRefused`, so
  // that `status --no-card` — the other door into his lane — enforces exactly
  // the same thing rather than a copy that can drift.
  if (!noMove) {
    const stop = await alreadyAnsweredRefused(task, status);
    if (stop !== null) process.exit(stop);
  }

  // Posted in ClickUp's STRUCTURED shape, not as markdown text: the banner is
  // bold and red (task 86bbq5ruz), and colour only exists in that shape. The
  // text rendering is what the read-back below compares against, because
  // `comment_text` on a structured comment is its plain text.
  const posted = await call('POST', `/api/v2/task/${task}/comment`, { comment: commentBody });
  if (!posted.res.ok) die('post the operator card', posted);
  void rendered;
  const cardId = String(posted.json.id ?? '');

  // Read the card back and confirm the operator's own words are in it. This
  // check is not hypothetical: it is how the blockquote bug was found (see the
  // note at the top of operatorCard.js). ClickUp returned a healthy 200 and a
  // long comment with his instruction silently deleted out of the middle.
  const readBack = await call('GET', `/api/v2/task/${task}/comment`);
  if (!readBack.res.ok) {
    console.error(`WARNING: card ${cardId} posted, but reading it back failed — check it by eye.`);
    process.exit(1);
  }
  const stored = (readBack.json.comments || []).find((c) => String(c.id) === cardId);
  if (!stored || !(stored.comment_text || '').trim()) {
    console.error(`The card did NOT land: id ${cardId || '(none)'} ${stored ? 'saved empty' : 'not found'}.`);
    console.error('The status has NOT been moved — the ticket is where you left it.');
    process.exit(1);
  }
  const lost = operatorCard.cardSurvived(card, stored.comment_text);
  if (lost) {
    console.error(`\n${lost}\n`);
    console.error(`Comment ${cardId} is on the task. The status has NOT been moved.`);
    process.exit(1);
  }

  if (noMove) {
    console.log(`Task ${task}: card ${cardId} posted (status untouched, --no-move).`);
    reportLimits(readBack.res);
    process.exit(0);
  }

  const before = await call('GET', `/api/v2/task/${task}`);
  if (!before.res.ok) die('read task before handoff', before);
  const was = before.json.status?.status ?? '?';

  const moved = await call('PUT', `/api/v2/task/${task}`, {
    status,
    assignees: { add: [OPERATOR_ID], rem: [] },
  });
  if (!moved.res.ok) {
    console.error(`The card posted (comment ${cardId}) but the status did NOT move.`);
    die('set status', moved);
  }
  const now = moved.json.status?.status ?? '?';
  if (now.toLowerCase() !== status.toLowerCase()) {
    console.error(`Card posted (comment ${cardId}), but the status did NOT stick: asked "${status}", got "${now}".`);
    process.exit(1);
  }
  if (!(moved.json.assignees || []).some((a) => a.id === OPERATOR_ID)) {
    console.error(`Card posted and status moved to "${now}", but the operator is NOT assigned.`);
    console.error('Assignment is how he finds this — the handoff is incomplete until it sticks.');
    process.exit(1);
  }
  console.log(`Task ${task}: card ${cardId} posted, "${was}" -> "${now}", assigned: ${assigneeNames(moved.json)}.`);
  reportLimits(moved.res);

} else if (cmd === 'waiting') {
  // "Is this actually waiting on Dane?" — the whole point is that it is
  // CHEAPER TO RUN THAN THE CLAIM IS TO REASON ABOUT (task 86bbk34x7). Twice on
  // 2026-08-23 an agent stated flatly that something was waiting on him while
  // reading something other than the state — a terminal buffer once, a stale
  // impression of a list the other time — and he acted on both. The
  // authoritative answer was one API call away each time.
  //
  // Read-only, always. It moves nothing, assigns nobody and comments nowhere:
  // a command an agent must run before speaking cannot also be a command that
  // changes what it is describing.
  const one = arg('task');
  const operatorId = OPERATOR_ID;

  /** m/d h:mmam local — the register he reads, same as the loop notes. */
  const whenClock = (ms) => {
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return '';
    const clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      .toLowerCase().replace(/\s/g, '');
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${clock}`;
  };

  if (one) {
    // One ticket: read both halves in full, even where the status alone would
    // settle it. It is two requests, and showing the last word is most of the
    // value — "you answered this an hour ago" is the sentence that was missing.
    const got = await call('GET', `/api/v2/task/${one}`);
    if (!got.res.ok) {
      console.error(`Could not read task ${one} — HTTP ${got.res.status}. Reporting CANNOT TELL rather than guessing.`);
    }
    const task = got.res.ok ? got.json : null;
    const cm = await call('GET', `/api/v2/task/${one}/comment`);
    if (!cm.res.ok) {
      console.error(`Could not read the comments on ${one} — HTTP ${cm.res.status}.`);
    }
    const comments = cm.res.ok ? (cm.json?.comments || []) : null;

    const result = waitingVerdict({ task, comments }, { operatorId });
    console.log(renderTicket({ id: one, name: task?.name, result }, { formatWhen: whenClock }));
    if (task?.url) console.log(`  url:        ${task.url}`);
    reportLimits(cm.res);
    process.exit(exitCodeFor(result.verdict));
  }

  // No arguments: the answer to "what actually needs me?" — a question he
  // asked five times that evening and got a wrong answer to twice.
  const watched = [
    { id: AGENT_RESPONSE_LIST, label: 'Agent Response' },
    { id: LOOP_QUEUE_LIST, label: 'Loop Queue' },
  ];
  const flagged = [];
  let checked = 0;
  let readInFull = 0;
  let lastRes = null;

  for (const w of watched) {
    // fetchAllTasks pages to the end and dies loudly on a failed read — a
    // partial sweep must never print as "nothing is waiting on you".
    const { tasks, res } = await fetchAllTasks(w.id);
    if (res) lastRes = res;
    for (const t of tasks) {
      checked += 1;
      // A machine status is settled by the status alone (proven against the
      // full verdict in waitingOnOperator.test.js), so the comment read is
      // skipped there — otherwise the sweep would spend most of ClickUp's
      // per-minute allowance confirming things already decided.
      let result = verdictFromStatusAlone(t, { operatorId });
      if (!result) {
        const cm = await call('GET', `/api/v2/task/${t.id}/comment`);
        readInFull += 1;
        if (!cm.res.ok) {
          console.error(`Could not read the comments on ${t.id} — HTTP ${cm.res.status}.`);
        }
        result = waitingVerdict(
          { task: t, comments: cm.res.ok ? (cm.json?.comments || []) : null },
          { operatorId },
        );
        if (cm.res) lastRes = cm.res;
      }
      if (result.verdict !== V_NOT_WAITING) {
        flagged.push({ id: t.id, name: t.name, list: w.label, url: t.url, updated: t.date_updated, result });
      }
    }
  }

  // Newest question first: the most recent comment on the ticket, falling back
  // to when the ticket itself last moved. The fallback matters — a genuinely
  // waiting ticket with no comments on it has no lastWord date, and sorting
  // that to 0 buries the newest thing in the list at the bottom of it.
  const sortKey = (x) => Number(x.result.facts?.lastWord?.date) || Number(x.updated) || 0;
  flagged.sort((a, b) => sortKey(b) - sortKey(a));

  const waiting = flagged.filter((x) => x.result.verdict === V_WAITING);
  const unclear = flagged.filter((x) => x.result.verdict === V_CANNOT_TELL);

  for (const x of waiting) {
    console.log(renderTicket({ id: x.id, name: `${x.name}  [${x.list}]`, result: x.result }, { formatWhen: whenClock }));
    if (x.url) console.log(`  url:        ${x.url}`);
    console.log('');
  }
  if (unclear.length) {
    console.log('--- could NOT be decided — do not assume either way ---');
    for (const x of unclear) {
      console.log(renderTicket({ id: x.id, name: `${x.name}  [${x.list}]`, result: x.result }, { formatWhen: whenClock }));
      if (x.url) console.log(`  url:        ${x.url}`);
      console.log('');
    }
  }

  console.error(sweepSummary({
    checked,
    waiting: waiting.length,
    cannotTell: unclear.length,
    lists: watched.map((w) => w.label),
  }));
  console.error(`  ${readInFull} of them were in his lane and had their comments read in full; the rest were settled by status.`);
  if (lastRes) reportLimits(lastRes);
  process.exit(exitCodeFor(flagged.map((x) => x.result.verdict)));

} else if (cmd === 'lists') {
  // Exists because of 2026-08-18: 90146476303 (the Starcaster SPACE) was
  // written down where a LIST id belonged, and ClickUp answers that mistake
  // with "Team not authorized" — an error about the wrong thing entirely.
  const space = arg('space');
  if (!space) usage();
  const [folderless, folders] = await Promise.all([
    call('GET', `/api/v2/space/${space}/list?archived=false`),
    call('GET', `/api/v2/space/${space}/folder?archived=false`),
  ]);
  // A resolver that silently omits the folders it could not read would
  // recreate the very trap it exists to fix (DOCTRINE 3.11): fail loudly.
  if (!folderless.res.ok || !folderless.json) die('list folderless lists', folderless);
  if (!folders.res.ok || !folders.json) die('list folders', folders);
  for (const l of folderless.json.lists) console.log(`${l.id}\t${l.name}`);
  for (const f of folders.json.folders) {
    for (const l of f.lists || []) console.log(`${l.id}\t${f.name} / ${l.name}`);
  }
  reportLimits(folders.res);

} else if (cmd === 'bus-relay') {
  // Exactly one machine relays. Two of them can both read "this comment has
  // not been relayed yet" in the same minute and both post it before either
  // writes its marker back, and the operator sees his own message twice.
  // Who that machine is lives in lib/nodeRoles.js — the same table db:refresh
  // and the loop skills read, so nothing here can hold a second opinion.
  //
  // Not the owner is a NORMAL outcome for a poller running on a timer, so it
  // says which machine owns the job and exits 0 rather than failing. But a
  // machine we cannot IDENTIFY is a different thing entirely: quietly doing
  // nothing there is how a relay stops relaying for a week with nobody the
  // wiser, so that one exits loudly (DOCTRINE 3.11).
  const guard = nodeRoles.checkRole('bus-relay');
  if (!guard.owned) {
    console.error(guard.message);
    console.error(guard.verdict === 'other-node'
      ? 'bus-relay: 0 relayed, 0 handed back — not this machine\'s job.'
      : 'bus-relay: nothing was checked, and this is a FAILURE, not a quiet no-op.');
    process.exit(guard.verdict === 'other-node' ? 0 : 1);
  }

  const channel = arg('channel', BUS_CHANNEL);
  const dryRun = flag('dry-run');

  // Break the party line on purpose (task 86bbjzg83). Refused outside
  // --dry-run: see busRelayPlan.simulationGuard for why that is a refusal and
  // not a warning. Checked BEFORE the first read, so a refused run does
  // nothing at all — not even look.
  const simulateBusFailure = flag('simulate-bus-failure');
  const simGuard = simulationGuard({ simulate: simulateBusFailure, dryRun });
  if (!simGuard.ok) {
    console.error(simGuard.why);
    process.exit(2);
  }
  if (simulateBusFailure) {
    console.error('SIMULATING A PARTY-LINE OUTAGE — every chat write will report failure without a request being sent.');
    console.error('This is a rehearsal of the PR #414 fallback. Nothing is posted, moved or merged.\n');
  }

  // No flags: the standing watch list (Agent Response + Loop Queue), rules
  // in scripts/builder/busRelayPlan.js. Explicit --list/--statuses narrows
  // the run to that one list, notify-only — the pre-handback behaviour,
  // kept for ad-hoc runs: a hand-typed list id should never move tickets.
  const watches = (arg('list') || arg('statuses'))
    ? [{
        list: arg('list', AGENT_RESPONSE_LIST),
        label: 'custom',
        statuses: (arg('statuses') || BUS_RELAY_OPEN_STATUSES.join(','))
          .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
        handback: {},
        merge: false,
      }]
    : defaultWatches({ agentResponseList: AGENT_RESPONSE_LIST, loopQueueList: LOOP_QUEUE_LIST });

  // The escape hatch: --no-merge runs the relay exactly as it behaved before
  // 2026-08-21, notify-only everywhere. Nothing depends on it, but a job that
  // can perform a merge should have an off switch that is not "edit the code".
  const mergeSwitchOn = !flag('no-merge');

  // THE PIPELINE PAUSE SWITCH (task 86bbmfc15). When the operator has taken
  // the deck, nothing merges — a paused pipeline that still merged would put
  // new code under him while he is working, which is most of what the pause is
  // for. Relaying his own words CONTINUES: carrying a message is not claiming
  // work, and a pause must never swallow the operator's instructions.
  //
  // Fails safe. An unreadable switch counts as paused (pipelinePause.js says
  // why the two costs are not symmetric), so a ClickUp outage stops merging
  // rather than merging blind.
  const pauseSwitch = await pipelinePauseStore.readSwitch({ call, list: LOOP_QUEUE_LIST, pauseTaskId: PAUSE_TASK });
  const pauseState = pipelinePause.pauseVerdict({
    readable: pauseSwitch.readable,
    why: pauseSwitch.why,
    switchFound: pauseSwitch.switchFound,
    comments: pauseSwitch.comments || [],
  });
  if (pauseState.paused) console.error(`\n${pauseState.message}\n`);
  const mergingAllowed = mergeSwitchOn && !pauseState.paused;

  // Scope a pass to ONE ticket. This is how the merge path gets exercised
  // for real without touching anything else: a fixture ticket, a real run,
  // real writes, and every other ticket in the list provably untouched
  // because it was never looked at. Also the first thing anyone will want
  // when a single ticket misbehaves at 2am.
  const onlyTask = arg('only-task');

  let relayed = 0, skipped = 0, handedBack = 0;
  // How many tickets may hold this pass open waiting for CI. Worst case is
  // cap x budget, which is what keeps a pass from becoming unbounded
  // and stops one stuck PR starving the rest (task 86bbk2fb5).
  const inPassBudget = { used: 0, cap: mergeOnComment.MAX_IN_PASS_WAITS };
  const merges = { merged: 0, refused: 0, handedOff: 0, waiting: 0, unchanged: 0, stalled: 0 };
  // Report what could not be checked rather than silently passing over it
  // (DOCTRINE 3.11) — a task this script could not read is a task whose
  // comments might be sitting unrelayed, not a clean zero.
  const unchecked = [];
  // Conflicts that have been handed off and are STILL not resolved. Kept apart
  // from `unchecked` on purpose: `unchecked` means "this pass could not verify
  // something" and exits 1, which is a health signal about the pass itself. A
  // stalled conflict is a healthy pass reporting an unhealthy ticket, so it is
  // reported loudly and does not fail the run (task 86bbq0fh8).
  const stalledHandOffs = [];
  // Bus posts that did not land but cost nothing, because the message reached
  // a durable surface anyway (task 86bbjxew2). Reported under their own
  // heading and deliberately NOT a run failure: on 2026-08-23 every chat
  // write returned 400 for sixteen hours and the whole pipeline stopped
  // behind it, though every answer was sitting on its ticket the entire time.
  const busSkipped = [];
  // Tickets already receipted THIS pass, mapped to whether that receipt was
  // read back successfully. One acknowledgement per ticket, not one per
  // comment — three answers during an outage otherwise leave three identical
  // notes on the same ticket (review finding, 2026-08-23). The VALUE matters
  // too: a second comment on the same ticket inherits the first receipt's
  // verdict, so an unverified receipt never hands anything back by proxy.
  const receipted = new Map();
  // Lane A (task 86bbkw2au). Two things are gathered while the pass is already
  // reading every open ticket, so the lane costs no extra ClickUp requests
  // for either: the kill switch as he may have set it on a ticket, and the
  // Ready-to-launch tickets that are candidates for the lane.
  //
  // The lane itself runs AFTER this loop, deliberately. Standing condition 4
  // disables it if the pass "could not fully verify" anything, and `unchecked`
  // is not final until every ticket has been through — so a lane that ran
  // inline would be judging a half-finished account of its own reliability.
  const laneSwitchSignals = [];
  const laneCandidates = [];
  let lastRes = null;

  for (const watch of watches) {
    const { tasks, res: listRes } = await fetchAllTasks(watch.list);
    if (listRes) lastRes = listRes;
    const open = tasks
      .filter((t) => watch.statuses.includes((t.status?.status ?? '').toLowerCase()))
      .filter((t) => !onlyTask || String(t.id) === String(onlyTask));
    console.error(`${watch.label}: ${open.length} open task(s) of ${tasks.length} total in list ${watch.list} (statuses: ${watch.statuses.join(', ')})`);

    for (const t of open) {
      const commentsOut = await call('GET', `/api/v2/task/${t.id}/comment`);
      if (!commentsOut.res.ok) { unchecked.push(`${t.id} (${t.name}): could not read comments`); continue; }
      // Authorship is id AND marker (task 86bbqx2xe) — the rule lives in
      // busRelayPlan.operatorComments so a test can reach it without a network.
      const fromOperator = operatorComments(commentsOut.json.comments, {
        operatorId: OPERATOR_ID,
        isMachine: isMachineComment,
      });

      // The kill switch, as he may have set it on a ticket rather than on the
      // party line (standing condition 1: "on the bus or any Loop Queue
      // ticket"). Free — these comments are already in hand.
      for (const c of fromOperator) {
        const kind = switchCommand(c.comment_text);
        if (kind) laneSwitchSignals.push({ kind, at: Number(c.date) || 0, where: `on task ${t.id}` });
      }

      // Comments relayed on THIS run, for THIS task. This is the handback
      // trigger: only a comment that was actually DELIVERED counts, so a
      // failed relay can never move a ticket its answer never left. Since
      // task 86bbjxew2 "delivered" means the party line OR a receipt comment
      // on the ticket — the gate is re-pointed at a durable surface, never
      // weakened.
      let fresh = 0;
      // Merge commands this pass must NOT act on: either terminally acted on
      // (merged, or handed to an agent session for a conflict), or unknowable because
      // the reply read failed. The second case is deliberate — a comment
      // whose history could not be read is a comment that might already have
      // merged its PR, and acting on what you could not check is the failure
      // DOCTRINE 3.11 names.
      const mergeHandled = new Set();
      // Commands previously REFUSED, and the reason each refusal gave. These
      // are re-decided every pass (task 86bbjt18r): a refusal is a snapshot
      // of a moment, not a verdict on the ticket, and the reason may well
      // have been fixed since. The recorded reason is what keeps the
      // re-decide quiet — the same answer twice says nothing new.
      const mergeRefused = new Map();
      // ...and WHEN each was written, off the marker's own ISO tail. The
      // reason alone cannot tell a hand-off posted five minutes ago from one
      // that has been sitting for three days, and only the second is news
      // (task 86bbq0fh8).
      const mergeRefusedAt = new Map();

      for (const c of fromOperator) {
        const repliesOut = await call('GET', `/api/v2/comment/${c.id}/reply`);
        if (!repliesOut.res.ok) {
          unchecked.push(`${t.id} comment ${c.id}: could not read replies — not relayed, and NOT eligible to merge this pass`);
          mergeHandled.add(String(c.id));
          continue;
        }
        const replies = repliesOut.json.comments || repliesOut.json.replies || [];
        // The NEWEST merge marker decides: terminal means spent forever,
        // refused means "look again, and stay quiet only if the same reason
        // still holds".
        const marker = latestMergeMarker(replies);
        if (marker && marker.kind === 'refused') {
          mergeRefused.set(String(c.id), marker.reason);
          mergeRefusedAt.set(String(c.id), marker.at || '');
        }
        else if (marker) mergeHandled.add(String(c.id));
        const already = replies.some((r) => (r.comment_text || '').startsWith(BUS_RELAY_MARKER));
        if (already) { skipped++; continue; }

        const when = new Date(Number(c.date)).toISOString().slice(0, 16).replace('T', ' ');
        console.error(`\nRelaying: task "${t.name}" (${t.id}), comment ${c.id} [${when}]`);
        // Plain dry-run stops here, as it always has: it reports what WOULD be
        // posted and asserts nothing about delivery. Under --simulate-bus-failure
        // it deliberately does NOT stop, because the whole point is to run the
        // fallback path rather than describe it.
        if (dryRun && !simulateBusFailure) { console.error(`  DRY RUN — would post:\n  ${c.comment_text}`); relayed++; fresh++; continue; }

        const busBody = `[CC-starcaster bus-relay] Dane replied on "${t.name}" (${t.url}):\n\n${c.comment_text}`;
        // Chat, then a receipt comment on this very ticket. Only if BOTH fail
        // is the answer genuinely undelivered.
        const simTarget = handbackTarget(watch, t.status?.status, 1);
        const delivery = await deliverToBus(channel, busBody, {
          taskId: t.id,
          target: simTarget,
          receipted,
          simulate: simulateBusFailure,
        });

        // A simulated pass reports the verdict and writes nothing further: no
        // dedup marker (permanent, and this outage is not real) and no status
        // move. `fresh` is advanced only on a delivery that counted, which is
        // what makes the hand-back line below tell the truth about whether the
        // #414 guarantee holds on THIS watch.
        if (simulateBusFailure) {
          console.error(simulationLine({ verdict: delivery, target: simTarget }));
          if (delivery.ok) { relayed++; fresh++; }
          else unchecked.push(`${t.id} comment ${c.id}: SIMULATION — not delivered (${delivery.reason || delivery.why}); nothing was marked relayed`);
          continue;
        }

        if (!delivery.ok) {
          // The reason is deliveryVerdict's, not this line's. It used to hard-code a
          // claim that the fallback receipt had failed as well — even on a notify-only
          // watch, where no receipt is ever attempted — telling the reader that task
          // comments were failing too, which during a chat outage is the opposite of
          // the truth and points the diagnosis in exactly the wrong direction.
          const failedWhy = [`the party line failed (${delivery.why})`, delivery.reason].filter(Boolean).join(', and ');
          unchecked.push(`${t.id} comment ${c.id}: could not deliver anywhere — ${failedWhy}. NOT marked relayed (will retry next run)`);
          continue;
        }
        if (delivery.via === 'ticket') {
          reportBusFailure({ delivered: true, unchecked, busSkipped, line: `${t.id} comment ${c.id}: party line unavailable (${delivery.why}) — receipted on the ticket instead` });
        }

        // Mark relayed by replying on Dane's own comment. Deliberately AFTER
        // delivery, not before: if this write fails, the worst case is a
        // harmless duplicate relay next run — the alternative order risks
        // marking a comment "relayed" that nobody ever actually got. The
        // marker records WHICH surface carried it, behind the same prefix the
        // "already relayed" check reads.
        const markerText = relayMarkerText({ via: delivery.via, channel, at: new Date().toISOString() });
        const markOut = await call('POST', `/api/v2/comment/${c.id}/reply`, { comment_text: markerText });
        if (!markOut.res.ok) { unchecked.push(`${t.id} comment ${c.id}: delivered (via ${delivery.via}) but could not write the dedup marker — will re-relay next run`); relayed++; fresh++; continue; }

        // Verify the marker actually landed, same discipline as `comment`'s
        // read-back (DOCTRINE 3.10) — a 200 here is not proof it stuck.
        const verify = await call('GET', `/api/v2/comment/${c.id}/reply`);
        const stuck = verify.res.ok && (verify.json.comments || verify.json.replies || [])
          .some((r) => (r.comment_text || '').startsWith(BUS_RELAY_MARKER));
        if (!stuck) unchecked.push(`${t.id} comment ${c.id}: delivered (via ${delivery.via}) but the dedup marker did not verify — will re-relay next run`);
        console.error(`  delivered via ${delivery.via === 'chat' ? 'the party line' : 'a receipt on the ticket'}, marker ${stuck ? 'verified' : 'UNVERIFIED'}`);
        relayed++;
        fresh++;
      }

      // Comment-driven MERGE (task 86bbjd5nn): the other thing an operator
      // comment can be. Deliberately after the relay, so his words reach the
      // bus whatever the merge decision turns out to be — and deliberately
      // NOT gated on `fresh`, because an authorization relayed on an earlier
      // pass (or one whose bus post failed) is still an authorization. Its
      // own marker, checked above, is what stops it firing twice.
      if (mergingAllowed && mergeEnabled(watch)) {
        const m = await runMergeStep({ task: t, comments: commentsOut.json.comments || [], mergeHandled, mergeRefused, mergeRefusedAt, dryRun, channel, unchecked, busSkipped, stalledHandOffs, inPassBudget });
        if (m.outcome === 'merged' || m.outcome === 'would-merge') merges.merged++;
        else if (m.outcome === 'refused' || m.outcome === 'would-refuse') merges.refused++;
        else if (m.outcome === 'handed-off' || m.outcome === 'would-hand-off') merges.handedOff++;
        // Re-derived the same answer as last pass and posted nothing. Counted
        // separately so a silent pass is legibly "still stuck", not "clean".
        else if (m.outcome === 'refused-quiet' || m.outcome === 'handed-off-quiet') merges.unchanged++;
        // Handed off before, still not resolved. NOT 'unchanged': that bucket
        // means "nothing to say", and this is the one thing that most needs
        // saying (task 86bbq0fh8).
        else if (m.outcome === 'handed-off-stalled' || m.outcome === 'would-report-stalled') merges.stalled++;
        else if (m.outcome === 'waiting' || m.outcome === 'would-update-branch' || m.outcome === 'would-rerun-review-gate') merges.waiting++;
        // A merged ticket is now Live, which is not a status this watch
        // handles — skip the handback check rather than acting on a status
        // this pass itself just changed.
        if (m.outcome === 'merged') continue;

        // Still Ready to launch after his own word was considered: a Lane A
        // candidate. Collected rather than acted on here — see the note beside
        // `laneCandidates` for why the lane runs after this loop.
        if (isReadyToLaunch(t.status?.status)) {
          laneCandidates.push({ task: t, comments: commentsOut.json.comments || [] });
        }
      }

      // Comment-driven handback (task 86bbh9g7k): a fresh answer from the
      // operator on a "needs your input" ticket releases it back to the
      // machine. His comment is the authorization; no fresh comment, no
      // move — that is the doctrine checkpoint, enforced in handbackTarget.
      const target = handbackTarget(watch, t.status?.status, fresh);
      if (!target) continue;
      if (dryRun) {
        console.error(`  DRY RUN — would hand back: "${t.name}" -> ${target}`);
        handedBack++;
        continue;
      }
      // A machine status carries no assignees (the handoff rule) — clear
      // them in the same write, and verify BOTH halves from its response.
      const rem = (t.assignees || []).map((a) => a.id);
      const moveOut = await call('PUT', `/api/v2/task/${t.id}`, { status: target, assignees: { add: [], rem } });
      if (!moveOut.res.ok) { unchecked.push(`${t.id}: the answer was delivered but the hand-back to "${target}" FAILED — the ticket is still parked in "${t.status?.status}"`); continue; }
      const now = moveOut.json.status?.status ?? '?';
      if (now.toLowerCase() !== target.toLowerCase()) {
        unchecked.push(`${t.id}: hand-back did not stick (asked "${target}", the write came back "${now}")`);
        continue;
      }
      const leftover = (moveOut.json.assignees || []).map((a) => a.id);
      if (leftover.length) unchecked.push(`${t.id}: handed back to "${now}" but assignees did not clear ([${leftover.join(', ')}])`);
      console.error(`  handed back: "${t.name}" -> "${now}" (verified from the write response)`);
      handedBack++;
    }
  }

  // ── Lane A: announce, wait one hour, merge ─────────────────────────────────
  //
  // Canon: vault doctrine/AUTO-MERGE-LANES.md. Lane A replaces the operator's
  // WORD and nothing else — a review PASS, an open PR, green checks and a
  // clean merge are all still required, and are still checked by the same
  // githubGate this pass uses for his own authorizations.
  const lane = { announced: 0, merged: 0, cancelled: 0, waiting: 0, ineligible: 0, halted: '' };
  if (mergingAllowed) {
    const now = Date.now();
    const led = readLedger();
    let ledger = led.ledger;

    // Every source the switch can be set from. `readable` is the fail-safe:
    // if the party line or the ledger could not be read, we cannot know
    // whether he said stop, and standing condition 1 says an unreadable
    // switch is OFF — not "assume fine".
    const busSw = await readBusSwitchSignals(channel);
    const readable = busSw.readable && led.ok;
    if (!busSw.readable) busSkipped.push(`the kill switch could not be read from the party line (${busSw.why}) — auto-merge is OFF this pass`);
    if (!led.ok) unchecked.push(led.why);

    const liveSignals = [...busSw.signals, ...laneSwitchSignals];
    // Remember a stop the moment it is seen. A pass only reads OPEN tickets,
    // so a "stop auto-merging" said on a ticket that later goes Live would
    // vanish from view and the lane would quietly switch itself back on —
    // the one direction a fail-safe must never fail in.
    const newestLive = liveSignals.slice().sort((a, b) => b.at - a.at)[0];
    if (newestLive) ledger = ledgerAfterSwitch(ledger, newestLive);

    const killSwitch = killSwitchState({
      signals: [...liveSignals, ...switchSignalsFromLedger(ledger)],
      readable,
    });

    // Condition 4, trigger two: main going red after an auto-merge. Only
    // asked when there IS a previous auto-merge to be "after" — a red main
    // that predates the lane is not the lane's evidence about itself.
    const lastMerge = ledger.merges[ledger.merges.length - 1];
    let mainRed = false;
    if (lastMerge && lastMerge.repo && !ledger.disabled) {
      const build = mainBuildIsRed(lastMerge.repo);
      if (!build.known) unchecked.push(`${build.why} — auto-merge cannot confirm main is healthy`);
      else if (build.red && Number(build.at) >= Number(lastMerge.at)) mainRed = true;
    }

    const selfDisable = selfDisableState({ unchecked, mainBuildRed: mainRed, persisted: ledger.disabled });
    if (selfDisable.disabled && selfDisable.fresh) {
      ledger = ledgerAfterDisable(ledger, selfDisable.why, now);
      const line = `[CC-starcaster bus-relay] AUTO-MERGE DISABLED ITSELF: ${selfDisable.why}. No pull request will be auto-merged until a human says "resume auto-merging". Merges on your own word are unaffected.`;
      // A dry run says what it would post. Until 2026-08-30 this was the one
      // Lane A write with no guard — and because the ledger write IS guarded,
      // the flag never persisted and it re-posted on every dry run.
      if (dryRun) console.error(`  DRY RUN — would post to the bus: ${line}`);
      else await postToBus(channel, line);
    }

    const gate = laneGate({
      killSwitch,
      selfDisable,
      rateCap: rateCapState(ledger.merges, now),
    });

    if (!gate.allowed) {
      lane.halted = gate.why;
      console.error(`  Lane A is not running this pass: ${gate.why}`);
    } else {
      for (const cand of laneCandidates) {
        const t = cand.task;
        const label = `"${t.name}" (${t.id})`;

        // Re-checked per ticket, not once per pass: three merges into a pass
        // the hourly cap is spent, and a cap read before the first one would
        // let the fourth through.
        const cap = rateCapState(ledger.merges, Date.now());
        if (!cap.allowed) { lane.halted = cap.why; console.error(`  Lane A stopping: ${cap.why}`); break; }

        let decision = laneADecision({
          status: t.status?.status,
          comments: cand.comments,
          operatorId: OPERATOR_ID,
          now: Date.now(),
        });

        // The file list is a network call, so the module asks for it rather
        // than reaching for it — that is what keeps every rule in there
        // break-testable without a GitHub.
        if (decision.act === 'need-files') {
          const repo = `${decision.pr.owner}/${decision.pr.repo}`;
          const got = prChangedFiles(decision.pr.number, repo);
          if (!got.ok) {
            unchecked.push(`${t.id}: could not read PR #${decision.pr.number}'s changed files (${got.why}) — Lane A did not judge it`);
            continue;
          }
          decision = laneADecision({
            status: t.status?.status,
            comments: cand.comments,
            operatorId: OPERATOR_ID,
            now: Date.now(),
            files: got.files,
          });
        }

        if (decision.act === 'ignore') {
          if (decision.eligibility) lane.ineligible++;
          else if (decision.deadlineAt) lane.waiting++;
          continue;
        }

        const pr = decision.pr;
        const repo = `${pr.owner}/${pr.repo}`;

        if (decision.act === 'announce') {
          const at = new Date().toISOString();
          const deadlineLabel = clockAt(Date.now() + WINDOW_MS);
          const notice = announcementNotice({ pr, files: decision.eligibility.files, deadlineLabel, at });
          if (dryRun) {
            console.error(`  DRY RUN — would announce Lane A on ${label}: PR #${pr.number} merging at ${deadlineLabel}`);
            lane.announced++;
            continue;
          }
          const posted = await postLaneNotice(t.id, notice.body);
          if (!posted.ok) {
            // An announcement that failed to post is not a window. Nothing is
            // armed, no clock runs, and the next pass starts over.
            unchecked.push(`${t.id}: the Lane A announcement failed (${posted.why}) — nothing is armed and nothing will merge`);
            continue;
          }
          // The BINDING deadline is ClickUp's confirmed post time plus an
          // hour, which is never earlier than the time announced above. He
          // can be merged on late; he cannot be merged on early.
          await stampLoopNoteSoftly(t.id, loopNote('auto-merge-armed', { deadline: clockAt(posted.at + WINDOW_MS) }), unchecked);
          const bus = await postToBus(channel, `[CC-starcaster bus-relay] Lane A armed on ${label} (${t.url}): PR #${pr.number} is tests and documentation only and has a review PASS, so it merges at ${clockAt(posted.at + WINDOW_MS)} unless Dane comments on the ticket.\n\n${pr.url}`);
          if (!bus.ok) reportBusFailure({ cosmetic: true, unchecked, busSkipped, line: `${t.id}: Lane A announced on the ticket but the bus post failed (${bus.why})` });
          console.error(`  LANE A ARMED on ${label}: PR #${pr.number}, merging at ${clockAt(posted.at + WINDOW_MS)}`);
          lane.announced++;
          continue;
        }

        if (decision.act === 'cancel') {
          const notice = cancellationNotice({ pr, why: decision.reason, at: new Date().toISOString() });
          if (dryRun) { console.error(`  DRY RUN — would cancel Lane A on ${label}: ${decision.reason}`); lane.cancelled++; continue; }
          const out = await call('POST', `/api/v2/task/${t.id}/comment`, { comment_text: notice.body });
          if (!out.res.ok) {
            unchecked.push(`${t.id}: Lane A was cancelled (${decision.reason}) but the notice FAILED to post — he has not been told, and the announcement is still armed`);
            continue;
          }
          await stampLoopNoteSoftly(t.id, loopNote('auto-merge-cancelled', { at: clockAt(Date.now()) }), unchecked);
          console.error(`  LANE A CANCELLED on ${label}: ${decision.reason}`);
          lane.cancelled++;
          continue;
        }

        if (decision.act === 'merge') {
          if (dryRun) { console.error(`  DRY RUN — would auto-merge PR #${pr.number} for ${label} (${decision.reason})`); lane.merged++; continue; }
          const m = await runMergeStep({
            task: t,
            comments: cand.comments,
            mergeHandled: new Set(),
            mergeRefused: new Map(),
            dryRun,
            channel,
            unchecked,
            busSkipped,
            stalledHandOffs,
            inPassBudget,
            lane: { name: 'A', decision, files: decision.eligibility.files },
          });
          if (m.outcome === 'merged') {
            lane.merged++;
            ledger = ledgerAfterMerge(ledger, {
              at: Date.now(), lane: 'A', pr: pr.number, url: pr.url, task: t.id, repo, files: decision.eligibility.files,
            }, Date.now());
            const saved = saveLedgerIfReadable(led, ledger);
            // The ledger IS the rate cap. If it cannot be written, the next
            // pass has no idea this merge happened and the cap stops
            // capping — which is exactly the runaway condition 2 exists for.
            if (!saved.ok) unchecked.push(`${t.id}: PR #${pr.number} auto-merged but the auto-merge ledger could not be written (${saved.why}) — the rate cap has lost this merge`);
          } else if (m.outcome === 'lane-cancel') {
            // The gate said no after the window had already run: checks went
            // red, the branch conflicts, something changed. He is told, and it
            // needs a fresh review PASS before it can announce itself again.
            const notice = cancellationNotice({ pr, why: m.reason, at: new Date().toISOString() });
            const out = await call('POST', `/api/v2/task/${t.id}/comment`, { comment_text: notice.body });
            if (!out.res.ok) unchecked.push(`${t.id}: Lane A was cancelled at merge time (${m.reason}) but the notice FAILED to post`);
            else await stampLoopNoteSoftly(t.id, loopNote('auto-merge-cancelled', { at: clockAt(Date.now()) }), unchecked);
            console.error(`  LANE A CANCELLED at merge time on ${label}: ${m.reason}`);
            lane.cancelled++;
          } else {
            // 'waiting' — CI is still running. The announcement stays armed
            // and the next pass tries again. Nothing is said, because nothing
            // has happened.
            lane.waiting++;
          }
        }
      }
    }

    // Standing condition 3: announced, never silent. One post a day, and it
    // posts "none" on a quiet day — a silent day and a broken job must not
    // look alike.
    if (!dryRun && digestDue(ledger.lastDigestAt, now)) {
      const since = digestSince(ledger, now);
      const body = digestBody({
        entries: mergesSince(ledger, since),
        sinceLabel: ledger.lastDigestAt > 0 ? `the last digest (${clockAt(since)})` : 'the last 24 hours',
        clockLabel: clockAt(now),
      });
      const bus = await postToBus(channel, body);
      if (bus.ok) ledger = ledgerAfterDigest(ledger, now);
      else reportBusFailure({ cosmetic: false, unchecked, busSkipped, line: `the daily auto-merge digest could not be posted (${bus.why}) — it will be retried next pass` });
    }

    // NEVER over a ledger that could not be read: the file may hold a stop
    // this pass never saw, and an empty ledger written over it would lift
    // that stop on the next pass (2026-08-30, review round 2).
    if (!dryRun) {
      const saved = saveLedgerIfReadable(led, ledger);
      if (!saved.ok && !saved.skipped) unchecked.push(`the auto-merge ledger could not be written (${saved.why})`);
      else if (saved.skipped && !led.ok) console.error(`  ${saved.why}`);
    }
  }

  // A pause that has outlived its welcome announces itself (task 86bbmfc15,
  // criterion 5). Two hours of silence, then hourly — because a pause nobody
  // remembers looks exactly like a pipeline that has broken, and telling those
  // two apart cost most of 2026-08-25. This relay is the announcer because it
  // is the one job that already wakes on a timer on the always-on machine.
  if (pauseState.paused && pauseState.certain && !dryRun) {
    const trail = pipelinePause.readTrail(pauseSwitch.comments || []);
    const nag = pipelinePause.nagDecision({
      paused: true,
      sinceMs: trail.state?.atMs,
      lastNagAt: trail.lastNagAt,
      nowMs: Date.now(),
    });
    if (!nag.post) {
      console.error(`pipeline pause: saying nothing this pass — ${nag.reason}.`);
    } else {
      const text = pipelinePause.nagMessage({
        by: trail.state?.by, why: trail.state?.why, sinceMs: trail.state?.atMs, nowMs: Date.now(),
      });
      const chat = await postToBus(channel, text);
      // One write either way, and it is the marker as well as the fallback
      // record: on a chat outage the announcement still lands somewhere
      // durable, and either way the next pass knows it has already spoken.
      const body = pipelinePause.nagRecord({ node: nodeRoles.thisNode().name, at: new Date().toISOString() })
        + (chat.ok ? '' : `\n\nThe party line was unavailable (${chat.why}), so this is the record instead:\n\n${text}`);
      const wrote = await call('POST', `/api/v2/task/${pauseSwitch.task.id}/comment`, { comment_text: body, notify_all: false });
      if (!wrote.res.ok) {
        // No marker written, so the next pass tries again rather than losing
        // the announcement altogether.
        unchecked.push(`pipeline pause: could not announce (chat ${chat.ok ? 'ok' : chat.why}) and could not record it on the switch (HTTP ${wrote.res.status}) — will retry next pass`);
      } else if (chat.ok) {
        console.error('pipeline pause: announced on the party line.');
      } else {
        reportBusFailure({ delivered: true, unchecked, busSkipped, line: `pipeline pause: party line unavailable (${chat.why}) — the still-paused notice was recorded on the switch ticket instead` });
      }
    }
  }

  // "0 announced" and "never looked" must not read the same (DOCTRINE 3.11),
  // so the line says how many tickets were JUDGED as well as what happened to
  // them. On the queue of 2026-08-25 the honest answer was "9 considered, 9
  // ineligible" — which is Lane A working, not Lane A asleep.
  const laneLine = mergingAllowed
    ? `, Lane A: ${laneCandidates.length} considered, ${lane.announced} announced, ${lane.waiting} in window, ${lane.merged} auto-merged, ${lane.cancelled} cancelled, ${lane.ineligible} ineligible${lane.halted ? ` (HALTED: ${lane.halted})` : ''}`
    : '';

  const mergeLine = mergingAllowed
    ? `, ${merges.merged} merged, ${merges.refused} merge refused, ${merges.handedOff} handed to an agent session, ${merges.waiting} waiting on checks, ${merges.unchanged} unchanged since last pass`
    : pauseState.paused
      ? `, merging disabled — the pipeline is PAUSED${pauseState.certain ? '' : ' (the switch could not be read, which counts as paused)'}`
      : ', merging disabled (--no-merge)';
  // Counted APART, because calling a self-healing deferral a conflict is the
  // same overstatement the per-line banner was fixed for, one surface across
  // (review round 2, item 4).
  const stalledKinds = stalledHandOffs.map((h) => h.kind);
  const stalledLine = stalledSummaryClause(stalledKinds);
  console.log(`bus-relay: ${relayed} relayed, ${skipped} already relayed, ${handedBack} handed back${mergeLine}${laneLine}${stalledLine}, ${busSkipped.length} bus post(s) skipped, ${unchecked.length} could not be checked.${dryRun ? (simulateBusFailure ? ' (DRY RUN + SIMULATED PARTY-LINE OUTAGE — nothing was merged, posted or moved)' : ' (DRY RUN — nothing was merged, posted or moved)') : ''}`);

  // Its own heading, and unmissable. The whole point of task 86bbq0fh8 is
  // that `0 merged` on a quiet pass looked identical to progress for three
  // days. A conflict that has been handed off and is still sitting there now
  // says so on every pass, by name, until it clears.
  if (stalledHandOffs.length) {
    console.error(`\n${stalledSummaryHeadline(stalledKinds)} — ${stalledHandOffs.length} approved merge(s) are not moving:`);
    for (const h of stalledHandOffs) console.error(`  - ${h.line}`);
  }
  // Its own heading, above the failures and visibly not one of them. A chat
  // outage is worth seeing; it is not worth stopping the pipeline for.
  if (busSkipped.length) {
    // Not all of these are receipts: the merge step's three posts write their
    // real explanation onto the ticket themselves, so they land here with no
    // receipt comment. The heading names what is true of all of them — the
    // record is on the ticket, one way or the other.
    console.error(`\nParty line unavailable — ${busSkipped.length} bus post(s) skipped; the record is on the ticket in each case:`);
    for (const line of busSkipped) console.error(`  - ${line}`);
  }
  if (unchecked.length) {
    console.error('\nCould not fully verify:');
    for (const line of unchecked) console.error(`  - ${line}`);
  }
  // What this pass COST, in the same units ClickUp throttles on. The poll
  // interval and this number are one decision, not two: at 10-minute polling
  // (task 86bbk2fuh) a pass gets a fresh ~100-request minute every time, so
  // the headroom to watch is per-pass, not per-hour. If this creeps toward
  // 100 the answer is a cheaper pass, not a longer interval — the relay is
  // the pipeline's consumer and slowing it down is what the ticket undid.
  console.error(`  requests this pass: ${requestCount} (ClickUp allows ~100/minute)`);
  if (lastRes) reportLimits(lastRes);
  if (unchecked.length) process.exit(1);

} else if (cmd === 'loop-note') {
  // Stamp the "Loop note" custom field with a plain-language transition line
  // (Queue visibility). CANNOT STAMP loudly if the field does not exist — the
  // field must be created once in the ClickUp UI (the API cannot create it);
  // a missing field is reported, never silently skipped (DOCTRINE 3.11). This
  // is ONE write per real transition — not per pass, not per queued ticket.
  const task = arg('task'), transition = arg('transition');
  if (!task || !transition) usage();
  let text;
  try {
    // The review claim carries the DATE as well as the clock: the next
    // reviewer reads it to decide "is that pass still running, or did it die
    // hours ago?", and a bare time of day cannot tell today's claim from
    // yesterday's abandoned one. Every other transition is read live and a
    // clock is enough.
    const at = transition === 'review-started' ? nowDateClock() : nowClock();
    // A send-back note carries the round and the reason (task 86bbmg2tq), and
    // both are DERIVED from the ticket's own verdict comments rather than
    // passed in — no new state, so nothing to fall out of sync. This runs
    // AFTER `verdict --fail` has posted, which is the order the review pass
    // works in, so the send-back being stamped is already among them and the
    // round is the count itself, not the count plus one.
    let extra = {};
    if (transition === 'sent-back') extra = await sentBackRoundAndReason(task);
    text = loopNote(transition, { at, pr: arg('pr'), deadline: arg('deadline'), ...extra });
  } catch (e) {
    console.error(`\nloop-note: ${e.message}`);
    process.exit(2);
  }
  await stampLoopNote(task, text);

} else if (cmd === 'loop-heartbeat') {
  // One write per loop pass, onto the pinned "Loop heartbeat" ticket, so the
  // list shows the pipeline is alive and what is next. Target ticket id from
  // --task or CLICKUP_HEARTBEAT_TASK (created once in the UI, like the field).
  const task = arg('task', process.env.CLICKUP_HEARTBEAT_TASK);
  if (!task) {
    console.error('\nloop-heartbeat: no heartbeat ticket — pass --task <id> or set CLICKUP_HEARTBEAT_TASK.');
    console.error('Create one ticket in the Loop Queue named "Loop heartbeat" once, then use its id.');
    process.exit(2);
  }
  const text = heartbeatNote({ at: nowClock(), inLine: Number(arg('in-line', '0')), nextUp: arg('next', '') });
  await stampLoopNote(task, text);
} else if (cmd === 'auto-merge-status') {
  // Read-only. "Is Lane A on, and why not" is the first question anyone asks
  // when a PR did not merge itself, and the answer must be gettable without
  // running a pass that might act on what it finds.
  const now = Date.now();
  const led = readLedger();
  if (!led.ok) console.log(`ledger:  UNREADABLE — ${led.why}`);
  else console.log(`ledger:  ${led.file}${led.fresh ? ' (not created yet — no auto-merge has happened)' : ''}`);

  const busSw = await readBusSwitchSignals(arg('channel', BUS_CHANNEL));
  if (!busSw.readable) console.log(`bus:     UNREADABLE — ${busSw.why}`);

  const ks = killSwitchState({
    signals: [...busSw.signals, ...switchSignalsFromLedger(led.ledger)],
    readable: busSw.readable && led.ok,
  });
  const disabled = selfDisableState({ persisted: led.ledger.disabled });
  const cap = rateCapState(led.ledger.merges, now);
  const gate = laneGate({ killSwitch: ks, selfDisable: disabled, rateCap: cap });

  console.log(`switch:  ${ks.state} — ${ks.why}`);
  console.log(`disabled:${disabled.disabled ? ` yes — ${disabled.why}` : ' no'}`);
  console.log(`cap:     ${cap.why}`);
  console.log(`window:  ${WINDOW_MS / 60000} minutes`);
  console.log(`digest:  ${digestDue(led.ledger.lastDigestAt, now) ? 'due' : `last posted ${clockAt(led.ledger.lastDigestAt)}`}`);
  console.log(`LANE A:  ${gate.allowed ? 'RUNNING' : `NOT RUNNING — ${gate.why}`}`);
  const recent = mergesSince(led.ledger, digestSince(led.ledger, now));
  console.log(`recent:  ${recent.length} auto-merge(s) since the last digest (or the last 24 hours if none has posted)`);
  for (const m of recent) console.log(`  PR #${m.pr}  task ${m.task}  ${clockAt(m.at)}  ${(m.files || []).join(' ')}`);
  process.exit(gate.allowed ? 0 : 3);

} else if (cmd === 'task-open') {
  // Charter Q1 (Task-closes-thread): a thread should only exist while its
  // ClickUp task is open. ClickUp's own status.type is the general signal —
  // 'closed' or 'done' means the task is finished (however that list's
  // workflow spells its terminal status: "Live", "Done", "Cancelled", ...),
  // anything else ('open' or a workflow 'custom' status) means it is still
  // in flight. This is deliberately NOT a status-NAME allowlist: npm run
  // thread is used against arbitrary ClickUp lists, not only the Loop Queue.
  //
  // Exit codes are the contract callers rely on to decide whether to DELETE
  // something, so a transient failure must never look the same as a
  // confirmed "closed" — three-way, not two-way:
  //   0 = confirmed open        1 = confirmed closed/done/gone
  //   3 = could not tell (network, auth, rate limit — NOT a "safe to delete")
  const task = arg('task');
  if (!task) usage();
  // A REJECTED fetch (offline, DNS, TLS) would otherwise throw out of here and
  // node would exit 1 — indistinguishable from "confirmed closed", which is
  // the one thing this contract must never let happen (a caller deletes on 1).
  // Catch it and route to the exit-3 "cannot tell" path with the reason.
  let out;
  try {
    out = await call('GET', `/api/v2/task/${task}`);
  } catch (err) {
    console.error(`\ncheck task ${task}: could not reach ClickUp — ${err.message}`);
    console.error('This is NOT a "closed" result — treat it as "unknown", never "safe to delete".');
    process.exit(3);
  }
  if (out.res.status === 404) {
    console.log(`task:   ${task}`);
    console.log('status: (not found)');
    console.log('type:   (not found)');
    console.log('open:   false');
    reportLimits(out.res);
    process.exit(1);
  }
  if (!out.res.ok) {
    console.error(`\ncheck task ${task}: could not determine open/closed — HTTP ${out.res.status}`);
    console.error(out.json?.err || out.json?.error || out.text.slice(0, 500));
    console.error('This is NOT a "closed" result — a caller deciding whether to delete something');
    console.error('must treat this the same as "unknown", never the same as "confirmed closed".');
    if (out.res) reportLimits(out.res);
    process.exit(3);
  }
  const t = out.json;
  const type = t.status?.type ?? '?';
  const isOpen = type !== 'closed' && type !== 'done';
  console.log(`task:   ${t.id}`);
  console.log(`status: ${t.status?.status ?? '?'}`);
  console.log(`type:   ${type}`);
  console.log(`open:   ${isOpen}`);
  reportLimits(out.res);
  process.exit(isOpen ? 0 : 1);

} else if (cmd === 'send-back-rounds') {
  // "How many times has this ticket been round already, and what did each one
  // find?" — the question a review pass has to answer BEFORE deciding to send
  // back, and the one Dane needs answered to settle a stuck ticket. Reads
  // only; the gate that acts on it lives in `verdict --fail`.
  const task = arg('task');
  if (!task) usage();
  const out = await call('GET', `/api/v2/task/${task}/comment`);
  if (!out.res.ok) die('read the ticket comments', out);
  const history = out.json.comments || [];
  const done = sendBacks(history);
  console.log(`task:        ${task}`);
  console.log(`sent back:   ${done.length} time(s)`);
  console.log(`next round:  ${nextRound(history)} (the loop escalates to Dane at ${ESCALATE_AT_ROUND})`);
  for (const line of roundSummaryLines(history)) console.log(`  ${line}`);
  if (wouldEscalate(history)) {
    console.log('\nESCALATE — do not send this back again. Hand it to Dane with `ask`,');
    console.log('naming all of the rounds above so he sees the pattern, not the latest symptom.');
  }
  reportLimits(out.res);
  process.exit(wouldEscalate(history) ? 3 : 0);

} else {
  usage();
}

/**
 * The round a just-written send-back is, and the reason its verdict gave —
 * both read back off the ticket, so the board line and the audit trail cannot
 * disagree. Called only for the `sent-back` transition.
 *
 * A ticket with no send-back verdict on it at all is a BROKEN TRAIL, not a
 * round zero: `verdict --fail` should have run first. Rather than stamping a
 * nonsense round it says so and treats this as round 1, which is the only
 * honest reading of "a send-back is happening and nothing recorded it".
 */
async function sentBackRoundAndReason(taskId) {
  const out = await call('GET', `/api/v2/task/${taskId}/comment`);
  if (!out.res.ok) die('read the ticket\'s send-back history', out);
  const history = out.json.comments || [];
  const counted = currentRound(history);
  if (counted === 0) {
    console.error('\nWARNING: no "REVIEW: sent back" verdict is on this ticket, so the round cannot be');
    console.error('counted. Stamping round 1. Record the verdict first — the verdict, not this note,');
    console.error('is what the merge step and the Ready-to-launch gate read:');
    console.error(`  npm run clickup -- verdict --task ${taskId} --fail --if-status "In review" --body-file -\n`);
  }
  const newest = sendBacks(history)[counted - 1];
  return {
    round: Number(arg('round', String(Math.max(1, counted)))),
    reason: arg('reason', newest ? newest.reason : ''),
  };
}

/** hh:mmam local — the register the operator reads. */
function nowClock() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
}

/** m/d hh:mmam local — the same register, dated, for notes whose staleness
 *  has to be judgeable a day later (the review claim). */
function nowDateClock() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()} ${nowClock()}`;
}

/**
 * Set the "Loop note" text custom field on a task and verify by read-back.
 * Resolves the field id by NAME from the task's own custom_fields, so no id is
 * hardcoded. Missing field → CANNOT STAMP, loud, exit 1 (never a silent pass).
 */
async function stampLoopNote(taskId, text) {
  const before = await call('GET', `/api/v2/task/${taskId}?include_markdown_description=false`);
  if (!before.res.ok) die('read task for loop-note', before);
  const field = (before.json.custom_fields || []).find(
    (f) => String(f.name || '').trim().toLowerCase() === 'loop note'
  );
  if (!field) {
    console.error('\nCANNOT STAMP — custom field "Loop note" not found on this list.');
    console.error('Create it once in ClickUp: the list -> Columns -> + -> Create field -> Text, named "Loop note".');
    console.error('This is reported, not skipped: the build/review pass continues; only the note is missing.');
    process.exit(1);
  }
  const out = await call('POST', `/api/v2/task/${taskId}/field/${field.id}`, { value: text });
  if (!out.res.ok) die('set loop-note field', out);

  // Verify from a fresh read — a 200 is not proof the value stuck.
  const after = await call('GET', `/api/v2/task/${taskId}`);
  const got = after.res.ok
    ? (after.json.custom_fields || []).find((f) => f.id === field.id)?.value
    : undefined;
  if (String(got ?? '') !== text) {
    console.error(`\nLoop note did NOT stick: wrote ${JSON.stringify(text)}, read back ${JSON.stringify(got ?? null)}.`);
    process.exit(1);
  }
  console.log(`Loop note on ${taskId}: ${text} (verified by reading it back).`);
  reportLimits(out.res);
}
