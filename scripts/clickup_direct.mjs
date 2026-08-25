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
import loopNoteLib from './builder/loopNote.js';
const { loopNote, heartbeatNote } = loopNoteLib;
import { spawnSync } from 'node:child_process';
import busRelayPlan from './builder/busRelayPlan.js';
import mergeOnComment from './builder/mergeOnComment.js';
import loopTrail from './builder/loopTrail.js';
import buildStart from './builder/buildStart.js';
import operatorCard from './builder/operatorCard.js';
import nodeRoles from '../lib/nodeRoles.js';
import taskRepo from './builder/taskRepo.js';
import branchCatchUp from './builder/branchCatchUp.js';
import wipCap from './builder/wipCap.js';
import workLogPlaceholder from './builder/workLogPlaceholder.js';
const {
  defaultWatches, handbackTarget, mergeEnabled,
  deliveryVerdict, relayMarkerText, receiptText, isThisReceipt, busFailureBucket,
} = busRelayPlan;
const {
  mergeDecision, githubGate, MERGE_PHRASES, MERGE_MARKER, latestMergeMarker,
  refusalNotice, conflictHandOffNotice, mergedNotice,
} = mergeOnComment;
const {
  prOpenedComment, verdictComment, prTrailLanded, prBodyCarriesTicket,
  readyToLaunchGate, isReadyToLaunch,
} = loopTrail;
const { buildCard, CONTEXT_MIN_WORDS, CONTEXT_MAX_WORDS } = operatorCard;
const { resolveTaskRepo } = taskRepo;

const TOKEN = process.env.CLICKUP_API_TOKEN;
const WORKSPACE = process.env.CLICKUP_WORKSPACE_ID || '90141423066';
// The operator's ClickUp user id. Assignment is his inbox signal: a task in
// "Needs your input" / "Ready to launch" must carry it, a task in a machine
// status must not (loop-build SKILL.md, "Assignment is the handoff signal").
const OPERATOR_ID = Number(process.env.CLICKUP_OPERATOR_ID || 48012725);
const OPERATOR_STATUSES = ['needs your input', 'ready to launch'];
const PRIORITY = { urgent: 1, high: 2, normal: 3, low: 4 };
const PRIORITY_RANK = { urgent: 1, high: 2, normal: 3, low: 4 };

// bus-relay defaults: the "Agent Response" list in the Dane of Earth space,
// and the party-line bus channel, so the common case needs no flags at all
// (a cron line should not have to carry these ids). Both are overridable —
// same pattern as WORKSPACE/OPERATOR_ID above — in case the list or channel
// ever moves.
const AGENT_RESPONSE_LIST = process.env.CLICKUP_AGENT_RESPONSE_LIST || '901418805125';
const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
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
// a human, or refused with a reason on the ticket). "Checks are still
// running" writes no marker, so the next hourly pass picks the same
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

async function call(method, path, body) {
  const res = await fetch(`https://api.clickup.com${path}`, {
    method,
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
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
  console.error('  loop-note --task <id> --transition claimed|pr-open|review-started|verified|sent-back|merged|escalated [--pr N]');
  console.error('                                             stamp the "Loop note" field with a plain-language line; CANNOT STAMP if the field is absent.');
  console.error('                                             review-started is loop-review\'s VISIBLE CLAIM — stamp it before verifying, and');
  console.error('                                             stand down if `queue`/`get` already shows one that is not stale');
  console.error('  loop-heartbeat --task <id> --in-line N --next "<name>"   one per pass onto the pinned heartbeat ticket');
  console.error('  chat --channel <id> --body-file <file|->');
  console.error('  queue --list <id> [--status "Queued"]     open tasks, sorted priority-then-oldest, ALL pages:');
  console.error('                                             id <TAB> status <TAB> priority <TAB> repo <TAB> created <TAB> name <TAB> loop note');
  console.error('                                             the loop note is what a pass in flight looks like (e.g. a review already running)');
  console.error('                                             repo is the declared repo (repo:<name> tag); ?<name> = escalate, do not build');
  console.error('  get --task <id>                            one task: header lines, then "---", then the body markdown');
  console.error('  comments --task <id>                       the task\'s comments, oldest first (where the PR URL lives)');
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
  console.error('  pr-opened --task <id> --pr <url|number> [--repo owner/name] [--body-file <file|->]');
  console.error('                                             record the PR on the ticket in the ONE shape the merge step');
  console.error('                                             can read. Refuses first if the PR body carries no link back');
  console.error('                                             to the ticket, then verifies the comment by parsing it back.');
  console.error('  verdict --task <id> --pass|--fail --if-status "In review" [--body-file <file|->] [--no-guard]');
  console.error('                                             record loop-review\'s verdict in the ONE shape the merge step');
  console.error('                                             and the Ready-to-launch gate can read, verified by read-back.');
  console.error('                                             A ticket cannot reach Ready to launch without a PASS on it.');
  console.error('                                             --if-status is REQUIRED: exit 3, nothing written, if the ticket');
  console.error('                                             moved while you reviewed. --no-guard opts out, on the record.');
  console.error('  describe --task <id> --body-file <file|->  REPLACE the task description — the left column, where the');
  console.error('                                             long detail belongs. Verified by reading it back.');
  console.error('  ask --task <id> --body-file <file|-> [--status "Needs your input"|"Ready to launch"] [--no-move]');
  console.error('                                             hand the ticket to the operator: post an operator card, then');
  console.error('                                             move the status (he is auto-assigned). --no-move posts the');
  console.error('                                             card and leaves the status alone. The card body uses');
  console.error(`                                             @@ASKED / @@WHEN / @@CONTEXT / @@NEEDED; @@CONTEXT must be`);
  console.error(`                                             ${CONTEXT_MIN_WORDS}-${CONTEXT_MAX_WORDS} words. Checked before anything is sent.`);
  console.error('  lists --space <id>                         every list in a space, with ids (a space id is NOT a list id)');
  console.error('  bus-relay [--list <id>] [--channel <id>] [--statuses "a,b"] [--dry-run] [--no-merge]');
  console.error('                                             relay the operator\'s new comments on open tasks to the bus.');
  console.error('                                             With no flags it watches Agent Response (notify-only) AND the');
  console.error('                                             Loop Queue: an answer on "needs your input" hands the ticket');
  console.error('                                             back to Queued; on "ready to launch" a comment that is exactly');
  console.error(`                                             a merge command (${MERGE_PHRASES.join(' / ')}) from the`);
  console.error('                                             operator MERGES the PR — but only if loop-review passed it,');
  console.error('                                             the PR is open, green and conflict-free; then the ticket goes');
  console.error('                                             Live. Conflicts are handed to a human, never resolved here.');
  console.error('                                             --list/--statuses = that one list, notify-only and no merging;');
  console.error('                                             --no-merge disables merging everywhere; --dry-run reads GitHub');
  console.error('                                             and ClickUp and prints the decision, writing nothing at all;');
  console.error('                                             --only-task <id> confines the whole pass to one ticket.');
  console.error('                                             ONE machine relays (lib/nodeRoles.js); on any other it');
  console.error('                                             says so and exits 0. npm run node:whoami names this one');
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
async function fetchAllTasks(list) {
  const tasks = [];
  for (let page = 0; page < 50; page++) {
    const out = await call('GET', `/api/v2/list/${list}/task?archived=false&page=${page}`);
    if (!out.res.ok) die('list tasks', out);
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

/** Post to the party line. Returns ok/why so a caller can report a failure
 *  rather than assume the operator was told. */
async function postToBus(channel, content) {
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
async function deliverToBus(channel, content, { taskId, target, receipted } = {}) {
  const chat = await postToBus(channel, content);
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
 */
async function waitForChecksInPass({ pr, repo, label, fields, budget }) {
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
      gate: githubGate(json),
      elapsedMs: Date.now() - startedAt,
      budgetMs,
    });
    if (next.action !== 'poll-again') return { ...next, prJson: json };
  }
}

async function runMergeStep({ task, comments, mergeHandled, mergeRefused, dryRun, channel, unchecked, busSkipped, inPassBudget }) {
  const decision = mergeDecision({
    status: task.status?.status,
    comments,
    operatorId: OPERATOR_ID,
    handled: mergeHandled,
    refused: mergeRefused,
  });
  if (decision.act === 'ignore') return { outcome: 'none' };

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
  const fields = 'number,state,isDraft,mergeable,mergeStateStatus,headRefName,title,url,statusCheckRollup';
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
      // three minutes of work.
      const after = await waitForChecksInPass({ pr, repo, label, fields, budget: inPassBudget });
      if (after.action === 'wait') {
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
      if (after.action === 'wait') {
        console.error(`  MERGE WAITING on ${label}: ${after.reason}`);
        return { outcome: 'waiting', reason: after.reason };
      }
      gate = { action: after.action, reason: after.reason };
      if (after.prJson) prJson = after.prJson;
    } else {
      // Carry WHY into the hand-off, so the reader learns whether it was a
      // real overlap or something that could not be checked at all.
      gate = { ...gate, reason: gate.reason, localVerdict: local };
    }
  }

  // A script never resolves a merge conflict (task 86bbjd5nn, binding). What
  // it must NOT also do is eat the authorization on the way past: resolving
  // the branch is a job for a person, saying "merge" a second time afterwards
  // is not (task 86bbk0g4u). The marker written here is re-decidable, so the
  // pass that runs after someone fixes the branch merges it on his original
  // word — which is what the comment promised all along.
  if (gate.action === 'conflict') {
    // What the local attempt found, in the operator's terms. "It really does
    // overlap" and "I could not check" are different problems with different
    // fixes, and reading one as the other is how a machine problem gets
    // diagnosed as a code problem.
    const verdict = gate.localVerdict;
    const notice = conflictHandOffNotice({
      commentId: decision.commentId,
      pr,
      localVerdict: verdict
        ? {
            kind: verdict.code === branchCatchUp.CODES.REAL_CONFLICT ? 'real-conflict' : 'unknown',
            reason: verdict.reason,
          }
        : null,
    });
    const handOffReason = notice.marker.replace(/^refused:\s*/, '');
    if (alreadySaid(handOffReason)) {
      console.error(`  MERGE HANDED OFF (unchanged, nothing posted) on ${label}: ${gate.reason}`);
      return { outcome: 'handed-off-quiet', reason: gate.reason };
    }
    console.error(`  MERGE HANDED OFF on ${label}: ${gate.reason}`);
    if (dryRun) return { outcome: 'would-hand-off', reason: gate.reason };
    const cOut = await call('POST', `/api/v2/task/${task.id}/comment`, { comment_text: notice.body });
    if (!cOut.res.ok) unchecked.push(`${task.id}: PR #${pr.number} conflicts, but the hand-off comment FAILED to post`);
    const bus = await postToBus(channel, `[CC-starcaster bus-relay] MERGE BLOCKED — ${label} (${task.url}): PR #${pr.number} conflicts with main. Dane authorized the merge; a session needs to resolve the conflict and push. His approval still stands — once the branch is clean and CI is green, a later pass merges it with no second "merge" from him. Ticket left in Ready to launch.\n\n${pr.url}`);
    if (!bus.ok) reportBusFailure({ cosmetic: true, unchecked, busSkipped, line: `${task.id}: conflict hand-off posted to the ticket but the bus post failed (${bus.why})` });
    await markMergeHandled(decision.commentId, task, unchecked, notice.marker);
    return { outcome: 'handed-off', reason: gate.reason };
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
  const mergedRecord = mergedNotice({ commentId: decision.commentId, pr, mergedAt });
  await markMergeHandled(decision.commentId, task, unchecked, mergedRecord.marker);

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

  const bus = await postToBus(channel, `[CC-starcaster bus-relay] MERGED on Dane's say-so: ${label} — PR #${pr.number} squash-merged into main, ticket set to Live. main auto-deploys.\n\n${pr.url}`);
  if (!bus.ok) reportBusFailure({ cosmetic: true, unchecked, busSkipped, line: `${task.id}: PR #${pr.number} merged and the ticket moved and recorded, but the bus post failed (${bus.why})` });

  return { outcome: 'merged', pr: pr.number };
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
  const gate = readyToLaunchGate(out.json.comments || []);
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

const cmd = process.argv[2];

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
  const cap = wipCap.resolveCap(process.env);
  const repoArg = arg('repo') || '';
  const listArgs = ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,state'];
  if (repoArg) listArgs.push('--repo', repoArg);

  const out = gh(listArgs);
  if (!out.ok) {
    const undecided = wipCap.undeterminedDecision(out.stderr.slice(0, 200) || 'gh failed');
    console.error(undecided.message);
    process.exit(undecided.code);
  }
  let prs;
  try { prs = JSON.parse(out.stdout); } catch {
    const undecided = wipCap.undeterminedDecision('gh returned output that is not JSON');
    console.error(undecided.message);
    process.exit(undecided.code);
  }

  const decision = wipCap.wipDecision({ prs, cap });
  console.log(decision.message);
  process.exit(decision.code);

} else if (cmd === 'queue') {
  const list = arg('list');
  if (!list) usage();
  const status = arg('status');
  const { tasks, res } = await fetchAllTasks(list);
  // Filter locally, case-insensitively — the same matching the `status`
  // command's verify uses — so a casing mismatch cannot masquerade as an
  // empty queue the way a server-side filter miss would.
  const wanted = status
    ? tasks.filter((t) => (t.status?.status ?? '').toLowerCase() === status.toLowerCase())
    : tasks;
  // The loops claim "the oldest Queued task, highest priority first": encode
  // that rule here, so the first output line IS the task to claim.
  wanted.sort((a, b) =>
    (PRIORITY_RANK[a.priority?.priority] ?? 9) - (PRIORITY_RANK[b.priority?.priority] ?? 9)
    || Number(a.date_created) - Number(b.date_created));
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
  console.error(`${wanted.length} task(s)${status ? ` with status "${status}"` : ''} in list ${list} (all pages; first line is the one to claim)`);
  if (res) reportLimits(res);

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
    console.error('The card body is four sections, and the check runs before anything is sent:');
    console.error('  @@ASKED    his own words that caused this ticket, verbatim');
    console.error('  @@WHEN     optional — when and where he said it');
    console.error(`  @@CONTEXT  the problem and the fix in plain English, ${CONTEXT_MIN_WORDS}-${CONTEXT_MAX_WORDS} words`);
    console.error('  @@NEEDED   the specific ask ("Nothing right now" is fine — say it out loud)\n');
    console.error('If this really is a status move with no ask attached, pass --no-card. That flag is');
    console.error('your written claim that a card is not owed here, visible in the transcript.\n');
    process.exit(2);
  }

  // A ticket may not reach "Ready to launch" without a passing review on it.
  // `status --no-card` is the other door into that status, so the gate has to
  // stand on both (task 86bbjt18r).
  if (await readyToLaunchRefused(task, status)) process.exit(2);

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
  const lookupPr = (number) => {
    const out = spawnSync('gh', ['pr', 'view', String(number), '--json', 'state,headRefName'], {
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

  const text = prOpenedComment(prUrl, arg('body-file') ? readBody(arg('body-file')) : '');
  const out = await call('POST', `/api/v2/task/${task}/comment`, { comment_text: text });
  if (!out.res.ok) die('post the "PR opened" comment', out);

  // Read it back and parse it with the SAME function the merge step uses.
  // "The write returned 200" is not the question; "can the merge step find
  // this PR tomorrow" is (DOCTRINE 3.10).
  const check = await call('GET', `/api/v2/task/${task}/comment`);
  if (!check.res.ok) {
    console.error(`WARNING: the comment posted but reading it back FAILED, so the trail is UNVERIFIED.`);
    console.error('Check the ticket by eye before treating this task as handed off.');
    process.exit(1);
  }
  const landed = prTrailLanded(check.json.comments || [], prNumber);
  if (!landed.ok) {
    console.error(`\nThe "PR opened" trail did NOT land: ${landed.why}.`);
    console.error('The merge step will refuse this ticket, and the operator\'s approval will sit');
    console.error('there doing nothing. Fix the comment by hand before handing this to review.\n');
    process.exit(1);
  }
  console.log(`Task ${task}: PR #${prNumber} recorded (${prUrl}), read back and parsed by the merge step's own reader.`);

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

  reportLimits(check.res);

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
  console.log(`Task ${task}: verdict ${passed ? 'PASSED' : 'sent back'} recorded as comment ${newId}, verified through the Ready-to-launch gate itself.`);
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
  let rendered, card;
  try {
    ({ rendered, card } = buildCard(readBody(bodyFile)));
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(2);
  }

  const posted = await call('POST', `/api/v2/task/${task}/comment`, { comment_text: rendered });
  if (!posted.res.ok) die('post the operator card', posted);
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
  const mergingAllowed = !flag('no-merge');

  // Scope a pass to ONE ticket. This is how the merge path gets exercised
  // for real without touching anything else: a fixture ticket, a real run,
  // real writes, and every other ticket in the list provably untouched
  // because it was never looked at. Also the first thing anyone will want
  // when a single ticket misbehaves at 2am.
  const onlyTask = arg('only-task');

  let relayed = 0, skipped = 0, handedBack = 0;
  // How many tickets may hold this pass open waiting for CI. Worst case is
  // cap x budget, which is what keeps an hourly pass from becoming unbounded
  // and stops one stuck PR starving the rest (task 86bbk2fb5).
  const inPassBudget = { used: 0, cap: mergeOnComment.MAX_IN_PASS_WAITS };
  const merges = { merged: 0, refused: 0, handedOff: 0, waiting: 0, unchanged: 0 };
  // Report what could not be checked rather than silently passing over it
  // (DOCTRINE 3.11) — a task this script could not read is a task whose
  // comments might be sitting unrelayed, not a clean zero.
  const unchecked = [];
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
      const fromOperator = (commentsOut.json.comments || [])
        .filter((c) => Number(c.user?.id) === OPERATOR_ID);

      // Comments relayed on THIS run, for THIS task. This is the handback
      // trigger: only a comment that was actually DELIVERED counts, so a
      // failed relay can never move a ticket its answer never left. Since
      // task 86bbjxew2 "delivered" means the party line OR a receipt comment
      // on the ticket — the gate is re-pointed at a durable surface, never
      // weakened.
      let fresh = 0;
      // Merge commands this pass must NOT act on: either terminally acted on
      // (merged, or handed to a human for a conflict), or unknowable because
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
        if (marker && marker.kind === 'refused') mergeRefused.set(String(c.id), marker.reason);
        else if (marker) mergeHandled.add(String(c.id));
        const already = replies.some((r) => (r.comment_text || '').startsWith(BUS_RELAY_MARKER));
        if (already) { skipped++; continue; }

        const when = new Date(Number(c.date)).toISOString().slice(0, 16).replace('T', ' ');
        console.error(`\nRelaying: task "${t.name}" (${t.id}), comment ${c.id} [${when}]`);
        if (dryRun) { console.error(`  DRY RUN — would post:\n  ${c.comment_text}`); relayed++; fresh++; continue; }

        const busBody = `[CC-starcaster bus-relay] Dane replied on "${t.name}" (${t.url}):\n\n${c.comment_text}`;
        // Chat, then a receipt comment on this very ticket. Only if BOTH fail
        // is the answer genuinely undelivered.
        const delivery = await deliverToBus(channel, busBody, {
          taskId: t.id,
          target: handbackTarget(watch, t.status?.status, 1),
          receipted,
        });
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
        const m = await runMergeStep({ task: t, comments: commentsOut.json.comments || [], mergeHandled, mergeRefused, dryRun, channel, unchecked, busSkipped, inPassBudget });
        if (m.outcome === 'merged' || m.outcome === 'would-merge') merges.merged++;
        else if (m.outcome === 'refused' || m.outcome === 'would-refuse') merges.refused++;
        else if (m.outcome === 'handed-off' || m.outcome === 'would-hand-off') merges.handedOff++;
        // Re-derived the same answer as last pass and posted nothing. Counted
        // separately so a silent pass is legibly "still stuck", not "clean".
        else if (m.outcome === 'refused-quiet' || m.outcome === 'handed-off-quiet') merges.unchanged++;
        else if (m.outcome === 'waiting' || m.outcome === 'would-update-branch') merges.waiting++;
        // A merged ticket is now Live, which is not a status this watch
        // handles — skip the handback check rather than acting on a status
        // this pass itself just changed.
        if (m.outcome === 'merged') continue;
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

  const mergeLine = mergingAllowed
    ? `, ${merges.merged} merged, ${merges.refused} merge refused, ${merges.handedOff} handed to a human, ${merges.waiting} waiting on checks, ${merges.unchanged} unchanged since last pass`
    : ', merging disabled (--no-merge)';
  console.log(`bus-relay: ${relayed} relayed, ${skipped} already relayed, ${handedBack} handed back${mergeLine}, ${busSkipped.length} bus post(s) skipped, ${unchecked.length} could not be checked.${dryRun ? ' (DRY RUN — nothing was merged, posted or moved)' : ''}`);
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
    text = loopNote(transition, { at, pr: arg('pr') });
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

} else {
  usage();
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
