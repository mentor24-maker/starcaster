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
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import busRelayPlan from './builder/busRelayPlan.js';
import mergeOnComment from './builder/mergeOnComment.js';
const { defaultWatches, handbackTarget, mergeEnabled } = busRelayPlan;
const { mergeDecision, githubGate, MERGE_PHRASES } = mergeOnComment;

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
const BUS_RELAY_MARKER = '[bus-relay]';
// The merge path's OWN dedup marker, separate from the relay's on purpose.
// The relay marks a comment the moment it reaches the bus; the merge path
// must only mark a comment once it has reached a TERMINAL answer (merged, or
// refused with a reason on the ticket). "Checks are still running" writes no
// marker, so the next hourly pass picks the same authorization up instead of
// losing it — which is what would happen if the two shared one marker.
const MERGE_MARKER = '[merge-on-comment]';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
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
  console.error('  chat --channel <id> --body-file <file|->');
  console.error('  queue --list <id> [--status "Queued"]     open tasks, sorted priority-then-oldest, ALL pages:');
  console.error('                                             id <TAB> status <TAB> priority <TAB> created <TAB> name');
  console.error('  get --task <id>                            one task: header lines, then "---", then the body markdown');
  console.error('  comments --task <id>                       the task\'s comments, oldest first (where the PR URL lives)');
  console.error('  status --task <id> --status "In review" [--if-status "Queued"] [--assign <userId>] [--clear-assignees] [--no-auto-assign]');
  console.error('                                             move a task; operator statuses auto-assign the operator,');
  console.error('                                             machine statuses auto-clear; --if-status makes it a safe claim;');
  console.error('                                             status AND assignees verified from the write response');
  console.error('  comment --task <id> --body-file <file|->   add a comment, verified by reading the comments back');
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
  console.error('                                             --only-task <id> confines the whole pass to one ticket');
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

/** Write the merge path's dedup marker as a threaded reply on the operator's
 *  own comment, and verify it stuck — an unverified marker means the next
 *  pass may act on the same authorization again, which must be reported, not
 *  assumed away (DOCTRINE 3.10). */
async function markMergeHandled(commentId, task, unchecked, what) {
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
async function runMergeStep({ task, comments, mergeHandled, dryRun, channel, unchecked }) {
  const decision = mergeDecision({
    status: task.status?.status,
    comments,
    operatorId: OPERATOR_ID,
    handled: mergeHandled,
  });
  if (decision.act === 'ignore') return { outcome: 'none' };

  const label = `"${task.name}" (${task.id})`;

  // Terminal answer: say why on the ticket and on the bus, then mark the
  // authorizing comment handled so the same refusal is never posted twice.
  const refuse = async (why, plainEnglish) => {
    console.error(`  MERGE REFUSED on ${label}: ${why}`);
    if (dryRun) return { outcome: 'would-refuse', reason: why };
    const body = `Merge not performed. ${plainEnglish}\n\n(Automatic: your comment ${decision.commentId} on this ticket was read as a merge authorization, but ${why}. Nothing on GitHub or this ticket was changed. — bus-relay merge step)`;
    const cOut = await call('POST', `/api/v2/task/${task.id}/comment`, { comment_text: body });
    if (!cOut.res.ok) {
      unchecked.push(`${task.id}: merge refused (${why}) but the explanation comment FAILED to post — the operator has not been told`);
      return { outcome: 'refused', reason: why };
    }
    const bus = await postToBus(channel, `[CC-starcaster bus-relay] Merge NOT performed on ${label} (${task.url}): ${why}. Explanation posted on the ticket; it is still Ready to launch.`);
    if (!bus.ok) unchecked.push(`${task.id}: merge refusal explained on the ticket but the bus post failed (${bus.why})`);
    await markMergeHandled(decision.commentId, task, unchecked, `refused: ${why}`);
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
      console.error(`  MERGE WAITING on ${label}: branch updated from main, CI restarting`);
      return { outcome: 'waiting', reason: 'branch updated from main; waiting for CI' };
    }
  }

  // A script never resolves a merge conflict (task 86bbjd5nn, binding).
  if (gate.action === 'conflict') {
    console.error(`  MERGE HANDED OFF on ${label}: ${gate.reason}`);
    if (dryRun) return { outcome: 'would-hand-off', reason: gate.reason };
    const body = `Needs a hand: the branch for PR #${pr.number} conflicts with newer work that has landed on main since it was built, and a script must never resolve a conflict blind. A session will merge main into the branch, sort out the overlap and re-run the checks — then your merge still stands and this goes through.\n\nNothing was merged and nothing was changed; the ticket stays Ready to launch.\n\n${pr.url}\n\n(Automatic — bus-relay merge step, authorized by your comment ${decision.commentId}.)`;
    const cOut = await call('POST', `/api/v2/task/${task.id}/comment`, { comment_text: body });
    if (!cOut.res.ok) unchecked.push(`${task.id}: PR #${pr.number} conflicts, but the hand-off comment FAILED to post`);
    const bus = await postToBus(channel, `[CC-starcaster bus-relay] MERGE BLOCKED — ${label} (${task.url}): PR #${pr.number} conflicts with main. Dane authorized the merge; a session needs to resolve the conflict and re-run CI. Ticket left in Ready to launch.\n\n${pr.url}`);
    if (!bus.ok) unchecked.push(`${task.id}: conflict hand-off posted to the ticket but the bus post failed (${bus.why})`);
    await markMergeHandled(decision.commentId, task, unchecked, `conflict hand-off on PR #${pr.number}`);
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
  await markMergeHandled(decision.commentId, task, unchecked, `merged PR #${pr.number} at ${mergedAt}`);

  const record = `Merged: PR #${pr.number} (${pr.url}) squash-merged into main at ${mergedAt}, merged on operator comment ${decision.commentId}. Checks were green and the branch was up to date at merge time; the branch has been deleted. main auto-deploys, so this is on its way live now.\n\n(Automatic — bus-relay merge step.)`;
  const recOut = await call('POST', `/api/v2/task/${task.id}/comment`, { comment_text: record });
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
  if (!bus.ok) unchecked.push(`${task.id}: PR #${pr.number} merged and ticket moved, but the bus post failed (${bus.why})`);

  return { outcome: 'merged', pr: pr.number };
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
    console.log([t.id, t.status?.status ?? '?', t.priority?.priority ?? 'none', created, t.name].join('\t'));
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
  console.log(`priority: ${t.priority?.priority ?? 'none'}`);
  console.log(`assigned: ${assigneeNames(t)}`);
  console.log(`list:     ${t.list?.name} (${t.list?.id})`);
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
  const merges = { merged: 0, refused: 0, handedOff: 0, waiting: 0 };
  // Report what could not be checked rather than silently passing over it
  // (DOCTRINE 3.11) — a task this script could not read is a task whose
  // comments might be sitting unrelayed, not a clean zero.
  const unchecked = [];
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
      // trigger: only a comment that actually reached the bus counts, so a
      // failed post can never move a ticket its answer never left.
      let fresh = 0;
      // Merge commands this pass must NOT act on: either already acted on
      // (the marker is there), or unknowable because the reply read failed.
      // The second case is deliberate — a comment whose history could not be
      // read is a comment that might already have merged its PR, and acting
      // on what you could not check is the failure DOCTRINE 3.11 names.
      const mergeHandled = new Set();

      for (const c of fromOperator) {
        const repliesOut = await call('GET', `/api/v2/comment/${c.id}/reply`);
        if (!repliesOut.res.ok) {
          unchecked.push(`${t.id} comment ${c.id}: could not read replies — not relayed, and NOT eligible to merge this pass`);
          mergeHandled.add(String(c.id));
          continue;
        }
        const replies = repliesOut.json.comments || repliesOut.json.replies || [];
        if (replies.some((r) => (r.comment_text || '').startsWith(MERGE_MARKER))) mergeHandled.add(String(c.id));
        const already = replies.some((r) => (r.comment_text || '').startsWith(BUS_RELAY_MARKER));
        if (already) { skipped++; continue; }

        const when = new Date(Number(c.date)).toISOString().slice(0, 16).replace('T', ' ');
        console.error(`\nRelaying: task "${t.name}" (${t.id}), comment ${c.id} [${when}]`);
        if (dryRun) { console.error(`  DRY RUN — would post:\n  ${c.comment_text}`); relayed++; fresh++; continue; }

        const busBody = `[CC-starcaster bus-relay] Dane replied on "${t.name}" (${t.url}):\n\n${c.comment_text}`;
        const busOut = await call('POST', `/api/v3/workspaces/${WORKSPACE}/chat/channels/${channel}/messages`, {
          type: 'message', content: busBody, content_format: 'text/md',
        });
        if (!busOut.res.ok) { unchecked.push(`${t.id} comment ${c.id}: bus post failed, NOT marked relayed (will retry next run)`); continue; }

        // Mark relayed by replying on Dane's own comment. Deliberately AFTER
        // the bus post, not before: if this write fails, the worst case is a
        // harmless duplicate relay next run — the alternative order risks
        // marking a comment "relayed" that the bus never actually got.
        const markerText = `${BUS_RELAY_MARKER} sent to channel ${channel} at ${new Date().toISOString()}`;
        const markOut = await call('POST', `/api/v2/comment/${c.id}/reply`, { comment_text: markerText });
        if (!markOut.res.ok) { unchecked.push(`${t.id} comment ${c.id}: relayed to bus but could not write the dedup marker — will re-relay next run`); relayed++; fresh++; continue; }

        // Verify the marker actually landed, same discipline as `comment`'s
        // read-back (DOCTRINE 3.10) — a 200 here is not proof it stuck.
        const verify = await call('GET', `/api/v2/comment/${c.id}/reply`);
        const stuck = verify.res.ok && (verify.json.comments || verify.json.replies || [])
          .some((r) => (r.comment_text || '').startsWith(BUS_RELAY_MARKER));
        if (!stuck) unchecked.push(`${t.id} comment ${c.id}: relayed to bus but the dedup marker did not verify — will re-relay next run`);
        console.error(`  posted to bus, marker ${stuck ? 'verified' : 'UNVERIFIED'}`);
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
        const m = await runMergeStep({ task: t, comments: commentsOut.json.comments || [], mergeHandled, dryRun, channel, unchecked });
        if (m.outcome === 'merged' || m.outcome === 'would-merge') merges.merged++;
        else if (m.outcome === 'refused' || m.outcome === 'would-refuse') merges.refused++;
        else if (m.outcome === 'handed-off' || m.outcome === 'would-hand-off') merges.handedOff++;
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
      if (!moveOut.res.ok) { unchecked.push(`${t.id}: answer is on the bus but the hand-back to "${target}" FAILED — the ticket is still parked in "${t.status?.status}"`); continue; }
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
    ? `, ${merges.merged} merged, ${merges.refused} merge refused, ${merges.handedOff} handed to a human, ${merges.waiting} waiting on checks`
    : ', merging disabled (--no-merge)';
  console.log(`bus-relay: ${relayed} relayed, ${skipped} already relayed, ${handedBack} handed back${mergeLine}, ${unchecked.length} could not be checked.${dryRun ? ' (DRY RUN — nothing was merged, posted or moved)' : ''}`);
  if (unchecked.length) {
    console.error('\nCould not fully verify:');
    for (const line of unchecked) console.error(`  - ${line}`);
  }
  if (lastRes) reportLimits(lastRes);
  if (unchecked.length) process.exit(1);

} else {
  usage();
}
