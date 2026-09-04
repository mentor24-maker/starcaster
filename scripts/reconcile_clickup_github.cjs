#!/usr/bin/env node
'use strict';

/**
 * The reconciler — Charter Q2 (2026-08-18): keeps the Loop Queue and GitHub
 * reality from silently drifting apart. Meant to run on a schedule (the Mac
 * Mini engine room).
 *
 *   npm run reconcile              # dry run — prints every proposed action
 *   npm run reconcile -- --live    # moves tasks / posts to the bus
 *   npm run reconcile -- --check   # the SCHEDULED shape: --live, plus the two
 *                                  # disciplines every sentinel here follows
 *
 * THE SCHEDULED SHAPE (2026-09-02, task 86bbtqytq). This tool named the stuck
 * ticket exactly — "86bbqw49y sits in ready to launch but PR #513 is already
 * MERGED" — and reached nobody, because at the time nothing ran it. That half
 * was fixed the same day by `npm run repair` (#544), which rides the relay's
 * ten-minute idle wake and calls this as its `drift` step. Two things were
 * still missing from THIS end, and both are the difference between a watchdog
 * and a noise source:
 *
 *   - **It never asked the pipeline switch.** Every actor asks. This one moves
 *     tickets and posts to the bus, so running it while Dane has the deck is
 *     exactly the collision the switch exists to prevent. `--check` asks first
 *     and reads nothing if he has it — exiting **3** when he genuinely has the
 *     deck and **2** when the switch could not be asked at all. Same
 *     stand-down, different words, because one of them is a decision and the
 *     other is a blind spot (see `deckVerdict` below).
 *   - **Its suppression had no window and never cleared.** A contradiction
 *     posted once was struck off FOREVER — an alarm that fires once and then
 *     goes quiet is the failure the suppression was meant to prevent, arriving
 *     through the thing meant to prevent it. It is now one post per key per
 *     6h, and a key whose contradiction has RESOLVED is cleared, so a drift
 *     that returns is announced again at once. Same discipline as
 *     `stale-ready` and `repair`, deliberately not a fourth dialect.
 *
 * WHAT IT CHECKS
 *   1. Every in-flight task whose comments link a GitHub PR. The NEWEST
 *      distinct PR is authoritative (a task sent back and rebuilt carries two
 *      links; the superseded one must not win forever). Then:
 *        - PR merged, task in an auto-repair status (Building / In review) →
 *          move to Live.
 *        - PR merged, task in an OPERATOR status (Needs your input / Ready to
 *          launch) → FLAG, never move: only the operator moves a task out of
 *          those two, and auto-moving a Needs-your-input task would bury the
 *          question waiting for him (two-account model).
 *        - PR CLOSED-unmerged while the task is in-flight → FLAG: the
 *          stuck-ticket case, drift this tool exists to surface.
 *        - PR open → clean.
 *   2. Every local branch stamped with a ClickUp task (Task-closes-thread /
 *      PR #344) whose stamped task has reached a terminal status → FLAG: the
 *      closed-task cleanup should have removed the branch and did not.
 *
 * Every task and branch lands in exactly ONE of three buckets — clean,
 * repaired (a write, or in dry-run a "would"), or COULD NOT CHECK. The third
 * is never folded into the first (DOCTRINE 3.11): a sweep that silently skips
 * what it could not read has surveyed nothing.
 *
 * What it deliberately does NOT do: auto-file tasks for unstamped branches.
 * Every branch predating PR #344 is unstamped, so that would manufacture
 * false positives on day one. Reported as "could not check", not skipped.
 *
 * Writes go through scripts/clickup_direct.mjs (lib/clickup.cjs shells out),
 * so a status move is verified and clears assignees, and the bus post reports
 * quota — one implementation of those rules, not a weaker second copy.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { listTasks, getTaskComments, moveTaskStatus, postBusMessage, requestsMade } = require('./lib/clickup.cjs');

/** How many terminal tasks the leftover-PR scan looks at, most recent first.
 *  Bounded because the terminal set grows forever — see the scan below. */
const TERMINAL_SCAN_MAX = 25;
const { branchInventory, stampedTaskId, root } = require('./lib/repo_state.cjs');
// The one grader for what `pipeline.mjs check --json` said. Plain CommonJS,
// so a .cjs requires it directly — one reader of the switch, not a second.
const digest = require('../lib/pulseDigest.js');

const LOOP_QUEUE_LIST = process.env.CLICKUP_LOOP_QUEUE_LIST || '901418546619';
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';

// The status ladder, by ROLE — not a hand-copied name list per concern.
// Auto-repair: the machine may move these on its own. Operator: only Dane
// moves a task out of these (two-account model), so the tool flags, never
// moves. A merged PR is meaningful against BOTH; the difference is the action.
const AUTO_REPAIR_STATUSES = new Set(['building', 'in review']);
const OPERATOR_STATUSES = new Set(['needs your input', 'ready to launch']);
const TERMINAL_STATUS_TO_SET = 'Live';
const PR_URL_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

// Where flagged contradictions are remembered between scheduled runs, so an
// unchanged drift is posted to the bus ONCE, not every run (channel spam +
// the rolling ClickUp write quota). Machine-local, never committed.
const FLAG_STATE_FILE = path.join(root, '.git', 'reconciler-flags.json');

/** One post per contradiction per this window, cleared the moment the
 *  contradiction resolves. The number is `nodeHeartbeat`'s, not a fourth copy
 *  of six hours — every sentinel in this system shares one. */
const { REPOST_EVERY_MS } = require('../lib/nodeHeartbeat.js');

const check = process.argv.includes('--check');
// --check IS the live shape. A scheduled watchdog that only proposed repairs
// would leave the ticket it named sitting exactly where it found it.
const live = check || process.argv.includes('--live');
const quiet = process.argv.includes('--quiet');

/** A switch read is one ClickUp call. Unbounded, a hung read hangs the
 *  relay's ten-minute wake with nothing to break it; `pulse_publish.mjs`
 *  passes the same deadline for the same reason. */
const SWITCH_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Has Dane taken the deck? Asked by RUNNING the one switch implementation
 * rather than reading the flag a second way here — two readers of a safety
 * flag are two flags, and they disagree quietly (stale_ready.mjs makes the
 * same call for the same reason).
 *
 * THE SWITCH HAS TWO NON-ZERO ANSWERS AND THEY ARE NOT THE SAME NEWS (review
 * round 1, 2026-09-03). `pipeline.mjs check` says so in its own comment: an
 * unreadable switch exits 3 as well, because "we could not check" and "it is
 * paused" must lead to the SAME behaviour **while never being described in
 * the same words**. This function used to grade every non-zero exit as a
 * pause, so a blind switch — a throttled ClickUp read, a rotated token —
 * printed a false statement about what Dane was doing and took this watchdog
 * off the air on a green board, indefinitely. That is the exact failure class
 * this whole ticket exists to close, arriving through the check meant to
 * close it.
 *
 * So: ask with `--json` and grade with the one grader, `pulseDigest`'s
 * `switchVerdict` — not a second copy of the rules, and already break-tested
 * where it lives. It returns `readable`, which is the distinction the exit
 * code cannot carry.
 *
 * The ACTION is unchanged and still fails safe in the switch's own direction:
 * unreadable stands down exactly as a pause does. Running while he has the
 * deck collides with whatever he is doing on it; declining when he does not
 * costs one idle wake. Only the words and the exit code differ.
 */
function deckVerdict(spawn = require('child_process').spawnSync) {
  const out = spawn(
    process.execPath,
    [path.join(root, 'scripts', 'pipeline.mjs'), 'check', '--json'],
    { encoding: 'utf8', timeout: SWITCH_TIMEOUT_MS },
  );
  return digest.switchVerdict({ ...out, timeoutMs: SWITCH_TIMEOUT_MS });
}

/**
 * What this pass SAYS and EXITS when it stands down, which is the whole point
 * of the distinction above. Pure, exported and tested: a rule that only lives
 * inside a `main()` is a rule nothing can break-test.
 *
 *   paused      exit 3 — a normal decline, the same dialect `node:owns` and
 *               the preflight speak. Dane is named, because he is the reason.
 *   unreadable  exit 2 — could not tell. Dane is NOT named and must not be:
 *               nothing here knows what he is doing, and saying otherwise is
 *               the lie that hid this. 2 is what `repair`'s drift step reads
 *               as cannot-tell, so the whole pass composes to CANNOT TELL
 *               instead of exiting 0 with the word PAUSED.
 */
function standDownReport(verdict) {
  if (verdict.readable === false) {
    return {
      exit: 2,
      lines: [
        `[reconcile] COULD NOT TELL whether the pipeline is paused: ${verdict.why}`,
        '[reconcile] Standing down, which is the safe direction — but this is not an all-clear '
          + 'and it is not a decline: the switch could not be asked. Nothing was read, nothing '
          + 'was moved, nothing was posted.',
      ],
    };
  }
  return {
    exit: 3,
    lines: [
      `[reconcile] not running: ${verdict.why}`,
      '[reconcile] Dane has the deck. Nothing was read, nothing was moved, nothing was posted.',
    ],
  };
}

function say(line) {
  if (!quiet) console.log(line);
}

/** In-flight for the PURPOSE of the merged-PR check (either action path). */
function isInFlight(task) {
  const s = (task.status?.status || '').toLowerCase();
  return AUTO_REPAIR_STATUSES.has(s) || OPERATOR_STATUSES.has(s);
}

/** Terminal from ClickUp's own status.type where present (so a future
 *  "Won't do" done-type status is terminal without being name-listed), with a
 *  name fallback for callers/tests that carry no type. */
function isTerminal(task) {
  const type = (task.status?.type || '').toLowerCase();
  if (type === 'closed' || type === 'done') return true;
  return (task.status?.status || '').toLowerCase() === 'live';
}

/** null means "could not tell" — never treated as a real answer. */
function ghPrState(owner, repoName, number) {
  try {
    const out = execFileSync(
      'gh', ['pr', 'view', String(number), '--repo', `${owner}/${repoName}`, '--json', 'state,mergedAt,title'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Distinct PR URLs in a comment list, in order (comments arrive oldest-first,
 *  so the LAST entry is the newest — the authoritative one). */
function distinctPrs(comments) {
  const seen = new Set();
  const prs = [];
  for (const text of comments) {
    const m = String(text || '').match(PR_URL_RE);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}#${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prs.push({ owner: m[1], repoName: m[2], number: m[3] });
  }
  return prs;
}

/**
 * key -> ISO time this machine last posted it.
 *
 * It used to be a bare ARRAY of keys with no times, which made the window
 * infinite: a contradiction posted once was never said again, however long it
 * went unfixed and however many times it came back. Legacy arrays still on
 * disk load with NO timestamp, which reads as "never posted" and errs towards
 * speaking — one duplicate at most, once, and only on the first run after this
 * change.
 */
function loadFlagState() {
  try {
    const raw = JSON.parse(fs.readFileSync(FLAG_STATE_FILE, 'utf8'));
    if (Array.isArray(raw)) return new Map(raw.map((k) => [String(k), '']));
    return new Map(Object.entries(raw || {}).map(([k, v]) => [String(k), String(v || '')]));
  } catch {
    return new Map();
  }
}

function saveFlagState(state) {
  try {
    fs.writeFileSync(FLAG_STATE_FILE, JSON.stringify(Object.fromEntries(state), null, 2));
  } catch (err) {
    // Best-effort: a missing state file only costs one duplicate post, never
    // a wrong action — but say so rather than pretend it saved.
    console.error(`[reconcile] could not save flag state (${err.message}) — a flag may repost next run`);
  }
}

/**
 * May this contradiction be posted? Pure, so the suppression rule itself is
 * break-testable — the same split `lib/staleReady.js` uses for `duePosts`.
 * An unparseable or missing stamp reads as never posted.
 */
function flagDue({ key, state, now, everyMs = REPOST_EVERY_MS }) {
  const seen = state instanceof Map ? state : new Map(Object.entries(state || {}));
  const at = Date.parse(seen.get(String(key)) || '');
  if (!Number.isFinite(at)) return { due: true, why: 'never said' };
  const ago = now - at;
  if (ago >= everyMs) return { due: true, why: `last said ${Math.round(ago / 3600000)}h ago` };
  return { due: false, why: `already said ${Math.round(ago / 60000)}m ago (one post per ${Math.round(everyMs / 3600000)}h)` };
}

/**
 * Drop the stamps for contradictions that have RESOLVED, so a drift that comes
 * back is announced at once instead of being swallowed by a window its first
 * appearance opened.
 *
 * Resolved means: this pass EXAMINED the subject (a task id, a branch name)
 * and did not raise that key. A subject the pass could not look at — an
 * unreadable ticket, a terminal task outside the bounded scan — keeps its
 * stamp, because "I did not see it" is not "it is fixed". The subject is
 * carried explicitly rather than parsed back out of the key: two of the four
 * key shapes put a branch where the others put a task id, and a reader that
 * guessed would fail silently, which is the exact bug the permanent window
 * already was.
 */
function pruneFlags(state, { subjects, raised }) {
  const seen = state instanceof Map ? state : new Map(Object.entries(state || {}));
  const examined = subjects instanceof Set ? subjects : new Set(subjects || []);
  const live = raised instanceof Set ? raised : new Set(raised || []);
  const next = new Map();
  const cleared = [];
  for (const [key, at] of seen) {
    const subject = String(key).split('|')[1] || '';
    if (examined.has(subject) && !live.has(key)) { cleared.push(key); continue; }
    next.set(key, at);
  }
  return { state: next, cleared };
}

/** The stamp key. The subject is fenced off with a `|` so `pruneFlags` can
 *  recover it without knowing which of the four contradiction shapes this is. */
function flagKey(reason, subject, detail) {
  return `contradiction:${reason}|${subject}|${detail}`;
}

/**
 * @param {object} deps injectable so a test drives this with fake data instead
 *   of the network — every one defaults to the real implementation.
 */
async function checkMergedTasks(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    getComments = getTaskComments,
    prState = ghPrState,
    updateStatus = moveTaskStatus,
    postBus = postBusMessage,
    alreadyFlagged = null,
    recordFlagged = () => {},
    recordRaised = () => {},
    // Which subjects this pass actually LOOKED at. A subject examined and not
    // flagged is a contradiction that has resolved; one that was never
    // examined keeps its stamp, because "I did not see it" is not "it is
    // fixed" (DOCTRINE 3.11 in the suppression layer).
    recordExamined = () => {},
    isLive = live,
    now = Date.now(),
    log = say,
  } = deps;

  const inFlight = tasks.filter(isInFlight);
  log(`[reconcile] ${inFlight.length} in-flight task(s) of ${tasks.length} total in the Loop Queue`);

  // The OTHER direction (2026-08-25, task 86bbm4zwd): a task that is Live
  // while its PR is still open. The loop below only ever looked at in-flight
  // tasks, so this pair was invisible — and it is not harmless. Two such
  // zombies (#374 under a Live 86bbjk5rw, #381 under a Live 86bbjk5wj, both
  // shipped by a DIFFERENT PR) counted against the work-in-progress cap and
  // helped deadlock the build loop for four hourly passes that morning.
  //
  // Never repaired automatically: the right answer is sometimes "close the
  // PR" and sometimes "the ticket was closed too early", and only a person
  // can tell which. Flagged, with both facts, so the choice is one command.
  // Bounded on purpose (review round 1): one comment read plus one `gh` call
  // per terminal task, per run. There are already 66 Live tickets and the set
  // only grows, so the scan takes the most recently updated TERMINAL_SCAN_MAX
  // and says how many it skipped. An unbounded scan that grows forever is a
  // job that quietly gets slower until someone notices it timing out.
  const terminal = tasks.filter(isTerminal)
    .sort((a, b) => Number(b.date_updated || 0) - Number(a.date_updated || 0));
  const scanned = terminal.slice(0, TERMINAL_SCAN_MAX);
  if (terminal.length > scanned.length) {
    log(`[reconcile] scanning the ${scanned.length} most recently updated of ${terminal.length} terminal task(s) for leftover open PRs`);
  }

  for (const task of scanned) {
    const label = `task ${task.id} "${task.name}"`;
    let comments;
    try {
      comments = await getComments(task.id);
    } catch {
      unchecked.push(`${label}: terminal, but its comments could not be read — cannot tell whether a PR is still open`);
      continue;
    }
    // EVERY distinct linked PR, not just the newest (review round 1). The real
    // 2026-08-25 shape is a Live ticket linking an open leftover AND a later
    // merged PR that actually shipped it — so "newest" is the merged one and
    // the check returned silently on the exact case it was written for.
    let everyPrRead = true;
    for (const linked of distinctPrs(comments)) {
      const pr = prState(linked.owner, linked.repoName, linked.number);
      if (!pr) {
        everyPrRead = false;
        unchecked.push(`${label}: terminal, but the state of PR #${linked.number} could not be read`);
        continue;
      }
      if (pr.state !== 'OPEN') continue;
      await flag(
        flagKey('open-pr-under-terminal', task.id, linked.number),
        `${label} is "${task.status?.status}" but its linked PR #${linked.number} is still OPEN. ` +
          'Either the work shipped under a different PR and this one is a leftover — which counts against the ' +
          'work-in-progress cap and blocks the build loop — or the task was closed too early. Close the PR, or reopen the task.',
        { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, recordRaised, isLive, now, what: `${label}: open PR under a terminal task` }
      );
    }
    if (everyPrRead) recordExamined(String(task.id));
  }


  for (const task of inFlight) {
    const status = (task.status?.status || '').toLowerCase();
    const label = `task ${task.id} "${task.name}"`;

    let comments;
    try {
      comments = await getComments(task.id);
    } catch (err) {
      unchecked.push(`${label}: could not read comments — ${err.message}`);
      continue;
    }

    const prs = distinctPrs(comments);
    if (prs.length === 0) {
      // Not clean: an in-flight task with no PR link cannot be confirmed
      // shipped-or-not, so it is unverified, not fine (DOCTRINE 3.11).
      unchecked.push(`${label}: in-flight but no PR linked in its comments — cannot confirm whether it shipped`);
      continue;
    }

    // Newest distinct PR is authoritative; a superseded older link never wins.
    const authoritative = prs[prs.length - 1];
    const pr = prState(authoritative.owner, authoritative.repoName, authoritative.number);
    const prName = `PR #${authoritative.number}`;
    if (!pr) {
      unchecked.push(`${label}: could not read ${prName} (${authoritative.owner}/${authoritative.repoName}) from GitHub`);
      continue;
    }
    const multi = prs.length > 1 ? ` (newest of ${prs.length} linked PRs)` : '';
    recordExamined(String(task.id));

    if (pr.state === 'OPEN') {
      clean.push(`${label}: ${prName} is open${multi}, matches ClickUp`);
      continue;
    }

    if (pr.state === 'MERGED') {
      if (AUTO_REPAIR_STATUSES.has(status)) {
        if (isLive) {
          try {
            updateStatus(task.id, TERMINAL_STATUS_TO_SET);
            repaired.push(`${label}: ${prName} merged${multi} — moved to ${TERMINAL_STATUS_TO_SET}`);
          } catch (err) {
            unchecked.push(`${label}: ${prName} merged, but could not move the task — ${err.message}`);
          }
        } else {
          repaired.push(`[DRY RUN] ${label}: ${prName} merged${multi} — would move to ${TERMINAL_STATUS_TO_SET}`);
        }
      } else {
        // Operator status: flag, never move — the operator owns the exit.
        await flag(
          flagKey('merged-operator', task.id, authoritative.number),
          `${label} sits in "${task.status?.status}" but ${prName} is already MERGED. ` +
            `Only you move a task out of that status — moving it automatically would bury the handoff. Worth a look.`,
          { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, recordRaised, isLive, now, what: `${label}: merged PR under an operator status` }
        );
      }
      continue;
    }

    // CLOSED (unmerged) while still in-flight — the stuck-ticket case.
    await flag(
      flagKey('closed-pr', task.id, authoritative.number),
      `${label} is in-flight ("${task.status?.status}") but its newest PR ${prName} is CLOSED without merging` +
        `${multi}. The work is not shipping under that PR — reopen it, link a new one, or park the task.`,
      { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, recordRaised, isLive, now, what: `${label}: in-flight over a closed, unmerged PR` }
    );
  }
}

/**
 * Post a contradiction to the bus, at most once per 6h per key; dry-run
 * proposes. Every raised key is recorded whether or not it was posted — that
 * is what tells the next prune the contradiction is still live, and a held
 * finding that vanished from the record would be cleared and then re-posted on
 * the following pass, which is the noise this window exists to stop.
 */
async function flag(key, message, ctx) {
  const { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, recordRaised, isLive, what, now } = ctx;
  if (recordRaised) recordRaised(key);
  if (!isLive) {
    repaired.push(`[DRY RUN] ${what} — would flag to the bus: ${message}`);
    return;
  }
  const decision = flagDue({ key, state: alreadyFlagged, now: now || Date.now() });
  if (!decision.due) {
    // Held by the window, and never silently dropped from the report.
    repaired.push(`${what} — ${decision.why}, not re-posted`);
    return;
  }
  try {
    await postBus(BUS_CHANNEL, `[reconciler] ${message}`);
    recordFlagged(key, now || Date.now());
    repaired.push(`${what} — flagged to the bus (${decision.why})`);
  } catch (err) {
    unchecked.push(`${what}: contradiction found but could not post to the bus — ${err.message}`);
  }
}

/** Same injection shape as checkMergedTasks. */
async function checkStampedBranches(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    branches: branchesOverride = null,
    getStampedTaskId = stampedTaskId,
    postBus = postBusMessage,
    alreadyFlagged = null,
    recordFlagged = () => {},
    recordRaised = () => {},
    recordExamined = () => {},
    isLive = live,
    now = Date.now(),
  } = deps;

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const branches = branchesOverride || branchInventory().filter((b) => b.onMac && b.name !== 'main');

  for (const branch of branches) {
    const taskId = getStampedTaskId(branch.name);
    if (!taskId) {
      unchecked.push(
        `branch ${branch.name}: no ClickUp task stamp — cannot verify whether it is tracked ` +
        `(only threads started with \`npm run thread <topic> <task-id>\` after PR #344 carry one)`
      );
      continue;
    }

    const task = tasksById.get(taskId);
    if (!task) {
      unchecked.push(`branch ${branch.name}: stamped task ${taskId} is not in this Loop Queue list — cannot verify`);
      continue;
    }

    recordExamined(String(branch.name));
    if (!isTerminal(task)) {
      clean.push(`branch ${branch.name}: tracked by task ${taskId} (${task.status?.status})`);
      continue;
    }

    await flag(
      flagKey('stale-branch', branch.name, taskId),
      `branch \`${branch.name}\` is still on this Mac, but its stamped task ${taskId} ("${task.name}") ` +
        `is already ${task.status?.status}. \`npm run tidy\` should have cleaned this up — worth a look.`,
      { repaired, unchecked, postBus, alreadyFlagged, recordFlagged, recordRaised, isLive, now, what: `branch ${branch.name}: stamped task already terminal` }
    );
  }
}

async function main() {
  const clean = [];
  const repaired = [];
  const unchecked = [];

  // THE SWITCH, BEFORE ANYTHING IS READ OR WRITTEN. Only in --check: a person
  // running this by hand has already decided to look, and a read costs him
  // nothing. The scheduled pass is the one that must not move a ticket out
  // from under him. Exit 3 is the same "normal decline" dialect the preflight
  // and `node:owns` speak.
  if (check) {
    const deck = deckVerdict();
    if (deck.paused) {
      const stand = standDownReport(deck);
      for (const line of stand.lines) console.log(line);
      process.exit(stand.exit);
    }
  }

  let tasks;
  try {
    // include_closed: ClickUp drops closed-type statuses by default, so
    // without it `tasks.filter(isTerminal)` is structurally empty and the
    // leftover-PR scan below can never fire (review round 1, measured: 36
    // tasks returned while 66 Live tickets existed).
    tasks = await listTasks(LOOP_QUEUE_LIST, { includeClosed: true });
  } catch (err) {
    console.error(`[reconcile] FAILED to read the Loop Queue — nothing could be checked: ${err.message}`);
    process.exit(1);
  }

  // Flag state is only touched on a live run; dry-run must change nothing.
  const alreadyFlagged = live ? loadFlagState() : new Map();
  const now = Date.now();
  const raised = new Set();
  const examined = new Set();
  const recordFlagged = (key, at) => alreadyFlagged.set(key, new Date(at || now).toISOString());
  const deps = {
    alreadyFlagged,
    recordFlagged,
    recordRaised: (key) => raised.add(key),
    recordExamined: (subject) => examined.add(subject),
    now,
  };

  await checkMergedTasks(tasks, clean, repaired, unchecked, deps);
  await checkStampedBranches(tasks, clean, repaired, unchecked, deps);

  if (live) {
    // Clear the stamps for contradictions that have resolved, THEN save. An
    // alarm that fires once and never again is the failure the suppression was
    // meant to prevent; this is the half that was missing.
    const pruned = pruneFlags(alreadyFlagged, { subjects: examined, raised });
    if (pruned.cleared.length) {
      say(`[reconcile] ${pruned.cleared.length} earlier flag(s) cleared — those contradictions are resolved, `
        + 'so if one returns it is announced at once rather than held by an old window.');
    }
    saveFlagState(pruned.state);
  }

  say('');
  say(`[reconcile] ${clean.length} checked clean, ${repaired.length} ${live ? 'repaired/flagged' : 'would repair/flag'}, ${unchecked.length} could not check.`);
  // What this pass COST, in the units ClickUp throttles on — the same closing
  // line the relay prints, for the same reason. The ticket that scheduled this
  // check asked for a MEASURED figure rather than an assumed one: a watchdog
  // that exhausts the rate limit takes the relay down with it, which is worse
  // than the drift it watches for. If this creeps toward 100 the answer is a
  // cheaper pass (the terminal scan is already capped) or a longer throttle,
  // decided on this number.
  say(`[reconcile] ClickUp requests this pass: ${requestsMade()} (ClickUp allows ~100/minute)`);
  if (repaired.length) {
    say(live ? '\nRepaired / flagged:' : '\nWould repair / flag:');
    repaired.forEach((line) => say(`  ✓ ${line}`));
  }
  if (unchecked.length) {
    say('\nCould NOT check — not the same as clean:');
    unchecked.forEach((line) => say(`  ? ${line}`));
  }
  if (!quiet && clean.length) {
    say('\nChecked, no drift:');
    clean.forEach((line) => say(`  · ${line}`));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[reconcile] unexpected failure: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  checkMergedTasks,
  deckVerdict,
  standDownReport,
  SWITCH_TIMEOUT_MS,
  checkStampedBranches,
  flagDue,
  flagKey,
  pruneFlags,
  REPOST_EVERY_MS,
  isInFlight,
  isTerminal,
  distinctPrs,
  ghPrState,
  PR_URL_RE,
  AUTO_REPAIR_STATUSES,
  OPERATOR_STATUSES,
  TERMINAL_STATUS_TO_SET,
};
