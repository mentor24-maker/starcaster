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
 * EXIT CODES, which `scripts/builder/repair.js` reads and a cross-file test
 * pins (`repair.test.js`, "reconcile exits the codes this table says it does"):
 *
 *   0  ran, and changed nothing
 *   4  ran, and WROTE — it moved at least one ticket (86bbuv66c)
 *   3  declined: Dane has the deck (--check only)
 *   2  could not TELL whether he has it — the switch could not be asked
 *   1  could not read the Loop Queue at all; nothing was checked
 *
 * The 4 looks arbitrary and is not. "It wrote" and "Dane has the deck" were
 * both given exit 3 on 2026-09-04, on two branches, hours apart, each correct
 * on its own. Together they would have made one integer mean two opposite
 * things — a pass that CLOSED a ticket read by the supervising job as a pass
 * that declined to run, reported as PAUSED, with every gate green. 3 kept the
 * decline because that dialect is repo-wide (`node:owns`, `pipeline -- check`,
 * `clickup claim`, the loop preflight); the write took the free number.
 *
 * WHAT A PASS COSTS. Measured, not estimated — the closing line counts it, and
 * the ticket that put this on a schedule asked for a figure rather than an
 * assumption, because a watchdog that exhausts the rate limit takes the relay
 * down with it. 2026-09-04, against a 340-task queue: **31 requests in 19
 * seconds** for the read half. Writes shell out to `clickup_direct.mjs`, a
 * separate process with its own budget, so a live pass that flags or moves
 * costs more than the number it prints — that figure is a floor. `npm run
 * repair` takes a fresh reading at most every 30 minutes (`READ_EVERY_MS`),
 * which is what 31 reads buys comfortably; it is NOT safe at the relay's own
 * ten-minute wake, and the throttle is the reason, not an accident.
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
const {
  listTasks,
  getTaskCommentRecords,
  moveTaskStatus,
  postBusMessage,
  commentOnTask,
  requestsMade,
} = require('./lib/clickup.cjs');
const { thisNode } = require('../lib/nodeRoles.js');
const { findPullRequests } = require('./builder/mergeOnComment.js');
// The Loop Queue's status ladder, defined ONCE (scripts/builder/loopStatuses.js).
// This file used to hand-maintain its own name lists; see the comment on
// CLAIMABLE_STATUSES below for what that cost.
const loopStatuses = require('./builder/loopStatuses.js');
// Which ticket a PULL REQUEST names, defined once. The reverse of
// `findPullRequests`, and deliberately the repo's existing reader rather than a
// second regex here (the mis-attribution comment on PR_OPENED below is about
// exactly that mistake, one direction over).
const { findTicketIds } = require('./builder/clickupTicketLink.js');

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
const AUTO_REPAIR_STATUSES = new Set(loopStatuses.IN_PROGRESS_STATUSES);

/** Which machine is writing. Never thrown from: a name is a nicety, not a gate. */
const NODE_NAME = (() => {
  try { return thisNode() || 'an unnamed machine'; } catch { return 'an unnamed machine'; }
})();
const OPERATOR_STATUSES = new Set(loopStatuses.OPERATOR_HELD_STATUSES);

/**
 * THE THIRD SET, AND WHY IT DID NOT EXIST (2026-09-02, task 86bbt3wzk).
 *
 * `Queued` and `Rework` satisfied NEITHER `isInFlight` NOR `isTerminal`, so
 * they fell out of both scans entirely. Not reported as drift, not reported as
 * "could not check" — not reported at all. That is a false all-clear, the
 * `if (error) continue` shape DOCTRINE 3.11 is about, and this tool's own
 * closing line ("N could not check — not the same as clean") could not cover
 * it because nothing ever landed in that bucket.
 *
 * The dangerous half is a CLAIMABLE ticket with an OPEN pull request: a status
 * loop-build claims from, advertising as unstarted, over work that already
 * exists. That is the 2026-08-20 two-sessions-one-epic collision arriving
 * through a side door — the atomic claim cannot prevent a duplicate when the
 * ticket itself says nobody has started. Found live on 86bbjt1b4 with PR #449
 * already open and recorded on it, and `npm run reconcile` said
 * "2 checked clean, 0 would repair/flag".
 *
 * ALL FOUR SETS ARE NOW DERIVED FROM `loopStatuses`, not hand-copied here.
 * Three name lists that each had to be remembered when `Rework` was added on
 * 2026-08-31 is precisely how a status came to belong to none of them, and a
 * list nobody updated fails silently and in the direction of looking fine.
 * `reconcileClickupGithub.test.js` pins the property that would have caught
 * this on day one: every status in the ladder belongs to exactly one set.
 */
const CLAIMABLE_STATUSES = new Set(loopStatuses.CLAIMABLE_BY_BUILD);

const TERMINAL_STATUS_TO_SET = 'Live';
/**
 * WHICH PULL REQUEST IS THIS TICKET'S? Asked of `mergeOnComment`, never
 * answered here (2026-09-04, ticket 86bbuv66c).
 *
 * This file used to match `github.com/<owner>/<repo>/pull/<n>` against every
 * comment on the ticket and treat the newest hit as the ticket's own work. A
 * ticket's comments routinely cite other tickets' PRs — the loops file
 * cross-references as evidence, which is exactly what they should do — so that
 * regex answered a different question than the one being asked, and answered
 * it confidently.
 *
 * On 2026-09-03 it closed 86bbu60ax, an urgent claimed ticket, on the strength
 * of PR #558 ("Docs: overlay screens…"), unrelated work merged two hours
 * earlier and mentioned once in a comment. No PR of its own, no branch, no fix
 * on main — marked shipped. The merge path had already learned this lesson and
 * written it down: `findPullRequest`'s own header says merging a PR that a
 * comment mentioned in passing "would be a catastrophe that looks like
 * success". It trusts one shape, the `PR opened: <url>` line the loop writes
 * through `clickup pr-opened`, and refuses rather than guesses.
 *
 * So there is now ONE definition of "this ticket's PR" in the repo and this
 * file calls it. A second regex here would be a second definition, and two
 * definitions of a safety rule disagree quietly — which is the whole shape of
 * the incident.
 */

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
 *  name fallback for callers/tests that carry no type. The NAMES come from
 *  `loopStatuses.TERMINAL_STATUSES` (decision D1: `live` is the only one), so
 *  a fourth hand-kept list cannot drift from the other three. */
function isTerminal(task) {
  const type = (task.status?.type || '').toLowerCase();
  if (type === 'closed' || type === 'done') return true;
  return loopStatuses.TERMINAL_STATUSES.includes((task.status?.status || '').toLowerCase());
}

/** A status loop-build may CLAIM FROM — the set neither other scan could see. */
function isClaimable(task) {
  return CLAIMABLE_STATUSES.has((task.status?.status || '').toLowerCase());
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

/**
 * How many MERGED pull requests the claimable index reads, newest first.
 *
 * THE INDEX IS TWO QUERIES, NOT ONE, AND THE ASYMMETRY IS THE POINT.
 *
 * Open pull requests are fetched WITHOUT a limit, because that half is the
 * dangerous one — a claimable ticket over a live PR is what lets one piece of
 * work be built twice — and the set is small and stays small by construction:
 * the work-in-progress cap exists to keep it so (five today, 5 measured
 * 2026-09-04). Bounding a set that is already bounded would only add a way to
 * miss the case this ticket is about.
 *
 * Merged pull requests are bounded, because that set grows forever — 607 in
 * this repo on 2026-09-04. "An unbounded scan that grows forever is a job that
 * quietly gets slower until someone notices it timing out" is TERMINAL_SCAN_MAX's
 * reasoning, and it applies to the half that actually grows.
 *
 * AND THE BOUND REPORTS ITSELF PRECISELY, WHICH TOOK TWO TRIES. The first
 * version said "the index hit its limit" whenever it read `limit` rows — which
 * is true on every run for as long as the repo has that many merges, so an
 * honest "could not check" line became wallpaper within one pass of being
 * written. Reading `limit` rows is not a defect; it is only a defect if a
 * ticket's answer lies outside the window. So the window's floor is carried
 * with the index, and the report names the claimable tickets that PREDATE it —
 * the only ones whose merged pull request could have been missed. Today that
 * count is zero and the line stays silent, which is what a bound that is
 * comfortably wide should do.
 */
const PR_INDEX_LIMIT = 400;

/**
 * Every pull request that could name a claimable ticket, with its body.
 *
 * `null` means the index could not be read — never an empty list, which would
 * read as "no PR anywhere names a claimable ticket" and is exactly the
 * confident wrong answer this whole ticket is about not inventing. If EITHER
 * half fails, the whole index fails: half an index reported as a whole one is
 * the same false all-clear one level down.
 *
 * Costs no ClickUp quota at all, which is the reason it is asked this way
 * round (see `claimableCandidates`).
 */
function ghPrIndex(limit = PR_INDEX_LIMIT) {
  const ask = (args) => {
    const out = execFileSync(
      'gh',
      ['pr', 'list', ...args, '--json', 'number,state,body,url,mergedAt'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
    );
    const list = JSON.parse(out);
    if (!Array.isArray(list)) throw new Error('gh pr list did not return a list');
    return list;
  };
  try {
    // The open half is deliberately unlimited; `--limit` is required by gh, so
    // it is set far above anything the WIP cap permits rather than left to
    // gh's default of 30, which WOULD silently truncate.
    const open = ask(['--state', 'open', '--limit', '1000']);
    const merged = ask(['--state', 'merged', '--limit', String(limit)]);
    const index = open.concat(merged);
    // The floor of the merged window, and ONLY when the window was actually
    // bounded. `null` means "this covers every merge there is", which is a
    // different statement from "the oldest merge I read was on this date".
    const truncated = merged.length >= limit;
    const floor = truncated
      ? merged.reduce((min, pr) => {
        const at = Date.parse(pr?.mergedAt || '');
        return Number.isFinite(at) && (min === null || at < min) ? at : min;
      }, null)
      : null;
    Object.defineProperty(index, 'mergedWindowStart', { value: floor, enumerable: false });
    return index;
  } catch {
    return null;
  }
}

/**
 * Ticket id -> the pull requests whose BODY names it, restricted to the ids
 * asked about. Pure, so the index rule is break-testable on its own.
 *
 * WHY THE INDEX RUNS THIS WAY ROUND, AND WHAT IT COSTS (measured 2026-09-04).
 * The obvious reading of this ticket is "read every claimable ticket's
 * comments". There are 66 claimable tickets and the pass already makes 34
 * ClickUp requests in 19 seconds; 66 more puts a watchdog that runs every 30
 * minutes at ~100 requests inside one rolling minute, against ClickUp's ~100
 * per minute — sharing that budget with the relay. The ticket said to measure
 * before assuming it was free, and it is not.
 *
 * Asking GitHub instead costs ONE call and no ClickUp quota at all, and it is
 * not a weaker question: `clickup pr-opened` REFUSES (exit 4) to write a
 * `PR opened:` trail unless the PR body names the ticket — `prBodyCarriesTicket`
 * in loopTrail.js, gated on `bodyNamesTicket`. So every trail-recorded PR
 * carries its ticket's link BY CONSTRUCTION, and the reverse index sees all of
 * them. It also sees one shape reading comments cannot: an open PR that names a
 * claimable ticket whose trail was never written at all.
 *
 * The index only NOMINATES. Every verdict below is still decided by
 * `findPullRequests` on the ticket's own trail plus a fresh `gh pr view` — the
 * one definition of "this ticket's PR" (86bbuv66c). A body link is an index
 * entry, never a safety decision, which is the same role it plays in
 * `wipCap.classifyPrs`.
 */
function claimableCandidates(prs, claimableIds) {
  const want = new Set([...(claimableIds || [])].map((id) => String(id || '').trim().toLowerCase()));
  const byTicket = new Map();
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!pr || typeof pr !== 'object') continue;
    for (const id of findTicketIds(pr.body)) {
      if (!want.has(id)) continue;
      if (!byTicket.has(id)) byTicket.set(id, []);
      byTicket.get(id).push(pr);
    }
  }
  return byTicket;
}

/** Distinct PR URLs in a comment list, in order (comments arrive oldest-first,
 *  so the LAST entry is the newest — the authoritative one). */
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
 * The comment this job posts before it closes anything.
 *
 * WHY A JOB SAYING ITS OWN NAME MATTERS HERE. Every write in this repo goes
 * through one ClickUp API token, and that token is Dane's — so ClickUp's
 * activity feed labelled the false close of 86bbu60ax as HIS doing. He was
 * asked whether he had closed it and could only say he did not think so. The
 * feed carried no information in either direction, and the answer came from
 * reading this file, not from any audit trail.
 *
 * Comments are the one place an actor can be named, and the loops already sign
 * theirs. A status change signed nothing, which is backwards: the close is the
 * destructive half.
 */
function closureNote({ prName, prUrl, mergedAt }) {
  const when = mergedAt ? ` (merged ${mergedAt})` : '';
  return [
    `Closed to ${TERMINAL_STATUS_TO_SET} by \`npm run reconcile -- --live\` on ${NODE_NAME}.`,
    '',
    `Evidence: this ticket's own \`PR opened:\` trail names ${prName} — ${prUrl} — and GitHub reports it MERGED${when}.`,
    '',
    'If that is wrong, the trail is wrong: a PR merely mentioned in discussion is never read as this'
    + " ticket's work (86bbuv66c). Reopen the ticket and say so on it.",
    '',
    '[machine] posted by the reconciler under Dane\'s token — not his word',
  ].join('\n');
}

/**
 * @param {object} deps injectable so a test drives this with fake data instead
 *   of the network — every one defaults to the real implementation.
 */
async function checkMergedTasks(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    getComments = getTaskCommentRecords,
    prState = ghPrState,
    updateStatus = moveTaskStatus,
    postBus = postBusMessage,
    commentOn = commentOnTask,
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
    onWrite = () => {},
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
    // EVERY PR in the ticket's trail, not just the newest (review round 1).
    // The real 2026-08-25 shape is a Live ticket whose trail carries an open
    // leftover AND a later merged PR that actually shipped it — so "newest" is
    // the merged one and the check returned silently on the exact case it was
    // written for. Trail only, for the reason at PR_OPENED above: a PR quoted
    // in discussion belongs to another ticket, and flagging its owner's open PR
    // as this ticket's leftover is the same mis-attribution, one degree less
    // destructive.
    //
    // `everyPrRead` feeds the suppression prune below: a ticket whose PRs could
    // not all be read was not fully EXAMINED, so its old stamps are kept rather
    // than cleared — "I could not see it" is not "it is fixed".
    let everyPrRead = true;
    for (const linked of findPullRequests(comments)) {
      const pr = prState(linked.owner, linked.repo, linked.number);
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

    // The ticket's OWN pull request, from its `PR opened:` trail. A PR merely
    // mentioned in a comment is somebody else's work and decides nothing here.
    const prs = findPullRequests(comments);
    if (prs.length === 0) {
      // Not clean: an in-flight task with no PR trail cannot be confirmed
      // shipped-or-not, so it is unverified, not fine (DOCTRINE 3.11).
      unchecked.push(`${label}: in-flight but no "PR opened:" trail in its comments — cannot confirm whether it shipped`);
      continue;
    }

    // Newest trail PR is authoritative; a superseded older link never wins.
    const authoritative = prs[0];
    const pr = prState(authoritative.owner, authoritative.repo, authoritative.number);
    const prName = `PR #${authoritative.number}`;
    if (!pr) {
      unchecked.push(`${label}: could not read ${prName} (${authoritative.owner}/${authoritative.repo}) from GitHub`);
      continue;
    }
    const multi = prs.length > 1 ? ` (newest of ${prs.length} trail PRs)` : '';
    recordExamined(String(task.id));

    if (pr.state === 'OPEN') {
      clean.push(`${label}: ${prName} is open${multi}, matches ClickUp`);
      continue;
    }

    if (pr.state === 'MERGED') {
      if (AUTO_REPAIR_STATUSES.has(status)) {
        if (isLive) {
          // THE TRAIL COMES FIRST, AND IT GATES THE WRITE (86bbuv66c).
          // Closing a ticket is destructive and this path wrote nothing at all
          // — no comment, no tag, no log line naming the ticket — so the false
          // close of 86bbu60ax took three sessions an hour to attribute, and
          // would never have been noticed on a ticket nobody was holding. The
          // merge path posts its record before moving; so does this one now.
          // A comment that cannot be posted means the move does not happen:
          // an unexplained close is the failure, so writing one anyway to
          // "at least get the status right" would be doing the damage on
          // purpose.
          const note = closureNote({ prName, prUrl: authoritative.url, mergedAt: pr.mergedAt });
          try {
            commentOn(task.id, note);
          } catch (err) {
            unchecked.push(
              `${label}: ${prName} merged, but the explanation comment could not be posted (${err.message}) — `
              + `NOT moved to ${TERMINAL_STATUS_TO_SET}, because a close with no trail is what this check exists to prevent`
            );
            continue;
          }
          try {
            updateStatus(task.id, TERMINAL_STATUS_TO_SET);
            onWrite();
            repaired.push(`${label}: ${prName} merged${multi} — moved to ${TERMINAL_STATUS_TO_SET}`);
          } catch (err) {
            unchecked.push(`${label}: ${prName} merged, but could not move the task — ${err.message}`);
          }
        } else {
          repaired.push(`[DRY RUN] ${label}: ${prName} merged${multi} — would move to ${TERMINAL_STATUS_TO_SET}`);
        }
      } else {
        // Operator status: flag, never move — the operator owns the exit.
        //
        // AND SAY IT ON THE TICKET, not only on the bus (2026-09-03, task
        // 86bbtqpxd). This exact finding was made about ticket 86bbqw49y and
        // went to the bus, where it competed with everything else and nobody
        // acted on it; the ticket sat twelve hours with its work already live
        // in production. A merged PR under an operator status means FINISHED
        // WORK IS INVISIBLE ON THE DEPLOY LIST, which is not a line in a
        // sweep report — so it also lands as a comment on the ticket it is
        // about, where the next reader of that ticket cannot miss it. Still
        // never a MOVE: only Dane takes a task out of an operator status.
        await flag(
          flagKey('merged-operator', task.id, authoritative.number),
          `${label} sits in "${task.status?.status}" but ${prName} is already MERGED. ` +
            `Only you move a task out of that status — moving it automatically would bury the handoff. Worth a look.`,
          {
            repaired,
            unchecked,
            postBus,
            commentOn,
            alreadyFlagged,
            recordFlagged,
            recordRaised,
            isLive,
            now,
            what: `${label}: merged PR under an operator status`,
            ticketComment: {
              taskId: task.id,
              text: `**${prName} for this ticket is already MERGED, and this ticket is still "${task.status?.status}".**\n\n`
                + 'The work is on `main` and `main` auto-deploys, so it is live. Nothing further is going to happen '
                + 'here on its own: only Dane moves a ticket out of an operator status, and the reconciler will not '
                + 'do it for him — moving it automatically would bury whatever hand-off the status is holding.\n\n'
                + '**Dane** moves this to Live, or **an agent session** asks him to. Until one of those happens this '
                + 'is finished work that does not appear on the deploy list.\n\n'
                + '(Automatic — npm run reconcile. Posted once; it will not repeat while nothing changes.)',
            },
          }
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
 * THE THIRD SCAN: claimable tickets that already have work in flight.
 *
 * `Queued` and `Rework` are the statuses loop-build claims from, and until
 * 2026-09-02 neither of the other two scans could see them (CLAIMABLE_STATUSES
 * above carries the incident). Two contradictions live in that gap, and they
 * want opposite treatment:
 *
 *   PR OPEN   -> FLAG, never move. A claimable ticket with a live pull request
 *                means either the ticket is stale (it was already built) or the
 *                PR is (it was abandoned), and only a reader can tell which.
 *                Moving it either way would be guessing about work in flight.
 *                This is the half that can cause a DUPLICATE BUILD, so it is
 *                also written onto the ticket itself, where the next pass that
 *                claims it cannot miss it — a bus line competes with everything
 *                else in the room (86bbtqpxd).
 *
 *   PR MERGED -> REPAIR to Live, exactly as the in-flight scan does: the
 *                explanation comment first, and no move if that comment cannot
 *                be posted. The work is in production and `main` auto-deploys,
 *                so a ticket left claimable is a ticket a loop may rebuild.
 *
 *   PR CLOSED unmerged -> CLEAN, and it is worth being explicit about why: an
 *                abandoned branch under a claimable ticket is the system
 *                working. The ticket IS the work still to do.
 *
 * @param {object} deps injectable, same shape as the other two scans.
 */
async function checkClaimableTasks(tasks, clean, repaired, unchecked, deps = {}) {
  const {
    prIndex = ghPrIndex,
    getComments = getTaskCommentRecords,
    prState = ghPrState,
    updateStatus = moveTaskStatus,
    postBus = postBusMessage,
    commentOn = commentOnTask,
    alreadyFlagged = null,
    recordFlagged = () => {},
    recordRaised = () => {},
    recordExamined = () => {},
    isLive = live,
    now = Date.now(),
    log = say,
    onWrite = () => {},
    indexLimit = PR_INDEX_LIMIT,
  } = deps;

  const claimable = tasks.filter(isClaimable);
  log(`[reconcile] ${claimable.length} claimable task(s) (${[...CLAIMABLE_STATUSES].join(' / ')}) — the set neither other scan could see`);
  if (claimable.length === 0) return;

  const prs = prIndex(indexLimit);
  if (!prs) {
    // Never "clean". The index is the only thing that nominates candidates, so
    // without it NOTHING in this set was checked — say exactly that.
    unchecked.push(
      `${claimable.length} claimable task(s): the pull request index could not be read `
      + '(`gh pr list` failed) — cannot tell whether any of them already has work in flight'
    );
    return;
  }
  const candidates = claimableCandidates(prs, claimable.map((t) => t.id));
  const notNominated = claimable.length - candidates.size;

  // Only the MERGED half is bounded, so only it can miss anything — and it can
  // only miss a ticket OLDER than the window it read. A ticket created after
  // the oldest merge in the window cannot have a merged pull request outside
  // it. `mergedWindowStart` is null when the window covered every merge there
  // is, and absent on a hand-built index in a test; neither is a truncation.
  const windowStart = typeof prs.mergedWindowStart === 'number' ? prs.mergedWindowStart : null;
  if (windowStart !== null) {
    const predating = claimable.filter((t) => !candidates.has(String(t.id).toLowerCase())
      && Number(t.date_created || 0) > 0 && Number(t.date_created) < windowStart);
    if (predating.length) {
      unchecked.push(
        `${predating.length} claimable task(s) are older than the ${indexLimit} merged pull requests read `
        + `(the window starts ${new Date(windowStart).toISOString().slice(0, 10)}), so a pull request that `
        + 'merged before then would not have been seen — raise PR_INDEX_LIMIT if this persists'
      );
    }
  }
  if (notNominated > 0) {
    // The honest edge of the cheap index, stated once rather than as N lines.
    // `pr-opened` refuses to write a trail unless the PR body names the ticket,
    // so this can only bite a PR whose trail was written by hand, or one in
    // another repo (the index is this repo's).
    unchecked.push(
      `${notNominated} claimable task(s): no pull request in this repo names them, so their comments were `
      + 'not read directly — a trail written by hand against a PR whose body omits the ClickUp link, or a '
      + 'PR in another repo, would be missed here'
    );
  }

  for (const task of claimable) {
    const nominated = candidates.get(String(task.id).toLowerCase());
    if (!nominated) continue;

    const status = task.status?.status || '';
    const label = `task ${task.id} "${task.name}"`;
    const nominatedBy = nominated.map((pr) => `#${pr.number}`).join(', ');

    let comments;
    try {
      comments = await getComments(task.id);
    } catch (err) {
      unchecked.push(`${label}: claimable, and PR ${nominatedBy} names it, but its comments could not be read — ${err.message}`);
      continue;
    }

    // The ticket's OWN trail decides, not the index that nominated it.
    const trailPrs = findPullRequests(comments);
    if (trailPrs.length === 0) {
      unchecked.push(
        `${label}: is "${status}" and PR ${nominatedBy} names it in the pull request body, but the ticket `
        + 'carries no `PR opened:` trail — cannot confirm that PR is this ticket\'s work '
        + '(`npm run clickup -- pr-opened` writes the trail)'
      );
      continue;
    }

    const authoritative = trailPrs[0];
    const prName = `PR #${authoritative.number}`;
    const pr = prState(authoritative.owner, authoritative.repo, authoritative.number);
    if (!pr) {
      unchecked.push(`${label}: claimable, but the state of ${prName} could not be read from GitHub`);
      continue;
    }
    const multi = trailPrs.length > 1 ? ` (newest of ${trailPrs.length} trail PRs)` : '';
    recordExamined(String(task.id));

    if (pr.state === 'OPEN') {
      await flag(
        flagKey('open-pr-under-claimable', task.id, authoritative.number),
        `${label} is "${status}" — a status loop-build CLAIMS FROM — but its own ${prName} is still OPEN${multi}. `
          + 'A loop can claim this ticket and build it a second time, on a second branch, against the first. '
          + 'Either the ticket is stale (the work is already built) or the PR is (it was abandoned) — nothing '
          + 'here can tell which, so nothing is moved.',
        {
          repaired,
          unchecked,
          postBus,
          commentOn,
          alreadyFlagged,
          recordFlagged,
          recordRaised,
          isLive,
          now,
          what: `${label}: open PR under a claimable task`,
          ticketComment: {
            taskId: task.id,
            text: `**This ticket is "${status}", which loop-build claims from — and ${prName} for it is still OPEN.**\n\n`
              + `${authoritative.url}\n\n`
              + 'That combination is what lets the same work get built twice, on two branches, against each other '
              + '(2026-08-20). The atomic claim cannot prevent it: the ticket itself is advertising as unstarted.\n\n'
              + '**Before building this, run `npm run clickup -- build-start --task ' + task.id + '`** — it will find '
              + 'that pull request and tell you to continue it rather than open a second one. If the pull request is '
              + 'the stale one, close it and say so here.\n\n'
              + '(Automatic — npm run reconcile. Posted once; it will not repeat while nothing changes.)',
          },
        }
      );
      continue;
    }

    if (pr.state === 'MERGED') {
      if (isLive) {
        // Same order as the in-flight path, for the same reason: the record
        // comes first and it GATES the move. An unexplained close is the
        // failure (86bbuv66c), so writing the status anyway would be doing the
        // damage on purpose.
        const note = closureNote({ prName, prUrl: authoritative.url, mergedAt: pr.mergedAt });
        try {
          commentOn(task.id, note);
        } catch (err) {
          unchecked.push(
            `${label}: claimable while ${prName} is merged, but the explanation comment could not be posted `
            + `(${err.message}) — NOT moved to ${TERMINAL_STATUS_TO_SET}`
          );
          continue;
        }
        try {
          updateStatus(task.id, TERMINAL_STATUS_TO_SET);
          onWrite();
          repaired.push(`${label}: claimable ("${status}") but ${prName} is merged${multi} — moved to ${TERMINAL_STATUS_TO_SET}`);
        } catch (err) {
          unchecked.push(`${label}: ${prName} merged, but could not move the task — ${err.message}`);
        }
      } else {
        repaired.push(`[DRY RUN] ${label}: claimable ("${status}") but ${prName} is merged${multi} — would move to ${TERMINAL_STATUS_TO_SET}`);
      }
      continue;
    }

    // CLOSED without merging: the branch was abandoned and the ticket is
    // legitimately back in the queue. Not drift.
    clean.push(`${label}: "${status}" with ${prName} closed unmerged${multi} — abandoned branch, the ticket is the work still to do`);
  }
}

/**
 * Post a contradiction — to the bus, and where the finding names one ticket,
 * onto that ticket. Dry run proposes.
 *
 * `ticketComment` is the DURABLE half (2026-09-03, task 86bbtqpxd). A bus line
 * is a message in a room; a ticket comment is on the thing the finding is
 * about. Findings that name one ticket and mean "somebody has to act on THIS"
 * carry both. It is written FIRST, because it is the one that survives — if
 * the bus post then fails, the finding is still recorded where it belongs, and
 * the failure is reported rather than swallowed.
 *
 * THE TWO SURFACES DEDUP SEPARATELY, AND THAT IS THE WHOLE POINT (review round
 * 1 of the same task). There was ONE key, checked before either post, so the
 * moment the durable half was added it was already suppressed on every ticket
 * that had ever been flagged to the bus — including 86bbqb08p, a live instance
 * of exactly the case this comment exists for, whose key was already in
 * `.git/reconciler-flags.json` from before the feature shipped. The finding
 * would have stayed a bus line on that ticket forever, which is the condition
 * being fixed, surviving the fix.
 *
 * Splitting the keys also makes each half RECOVERABLE. A single key was
 * recorded when EITHER surface succeeded, so a ticket comment that threw while
 * the bus post landed was never retried — reported, but not recoverable. Each
 * key is recorded only when its own surface actually carried the finding, so a
 * failed half is tried again on the next run and a succeeded half is not
 * repeated.
 *
 * AND EACH KEY IS ON THE 6h WINDOW, not on "ever" (task 86bbtqytq, merged here
 * 2026-09-04). The two halves of this function arrived within a day of each
 * other on different branches: one split the key, the other gave the key a
 * clock and a prune. They compose, and the composition is the point — a
 * suppression that never expires is an alarm that fires once and then goes
 * quiet, which is the failure the suppression was meant to prevent. Both keys
 * are recorded as RAISED whether or not either was posted, because that is
 * what tells `pruneFlags` the contradiction is still live; a held finding that
 * vanished from the record would be cleared and re-posted next pass, which is
 * the noise the window exists to stop.
 */
async function flag(key, message, ctx) {
  const {
    repaired, unchecked, postBus, commentOn, alreadyFlagged, recordFlagged,
    recordRaised, isLive, what, ticketComment, now,
  } = ctx;

  // The bus key is the ORIGINAL string, so runs from before the durable half
  // existed keep suppressing the bus repeat exactly as they did. The ticket
  // comment gets its own, which no earlier run can have written. Both keep the
  // `|`-fenced subject `pruneFlags` reads, so both prune correctly.
  const busKey = key;
  const commentKey = `${key}#ticket-comment`;
  const wantsComment = Boolean(ticketComment && commentOn);

  if (recordRaised) {
    recordRaised(busKey);
    if (wantsComment) recordRaised(commentKey);
  }

  if (!isLive) {
    repaired.push(`[DRY RUN] ${what} — would flag to the bus: ${message}`);
    if (ticketComment) repaired.push(`[DRY RUN] ${what} — would also comment on task ${ticketComment.taskId} (the durable record)`);
    return;
  }

  const at = now || Date.now();
  const busDue = flagDue({ key: busKey, state: alreadyFlagged, now: at });
  const commentDue = wantsComment
    ? flagDue({ key: commentKey, state: alreadyFlagged, now: at })
    : { due: false, why: 'this finding carries no ticket comment' };

  if (!busDue.due && !commentDue.due) {
    // Both surfaces are inside their window — not re-posted, and not silently
    // dropped from the report either.
    repaired.push(`${what} — ${busDue.why}, not re-posted`);
    return;
  }

  if (commentDue.due) {
    try {
      await commentOn(ticketComment.taskId, ticketComment.text);
      recordFlagged(commentKey, at);
      repaired.push(`${what} — recorded on the ticket itself (${commentDue.why})`);
    } catch (err) {
      unchecked.push(`${what}: contradiction found but the ticket comment FAILED to post — ${err.message} (it will be tried again next run)`);
    }
  }

  if (!busDue.due) {
    // The ticket comment was the outstanding half; say which surface was
    // skipped and why, rather than reporting a bus post that did not happen.
    repaired.push(`${what} — the bus half: ${busDue.why}, not re-posted`);
    return;
  }

  try {
    await postBus(BUS_CHANNEL, `[reconciler] ${message}`);
    recordFlagged(busKey, at);
    repaired.push(`${what} — flagged to the bus (${busDue.why})`);
  } catch (err) {
    unchecked.push(`${what}: contradiction found but could not post to the bus — ${err.message} (it will be tried again next run)`);
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
  const wrote = { count: 0 };
  const recordFlagged = (key, at) => alreadyFlagged.set(key, new Date(at || now).toISOString());
  const deps = {
    alreadyFlagged,
    recordFlagged,
    recordRaised: (key) => raised.add(key),
    recordExamined: (subject) => examined.add(subject),
    onWrite: () => { wrote.count += 1; },
    now,
  };

  await checkMergedTasks(tasks, clean, repaired, unchecked, deps);
  await checkClaimableTasks(tasks, clean, repaired, unchecked, deps);
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

  // A PASS THAT WROTE MUST NOT EXIT LIKE A PASS THAT DID NOT (86bbuv66c).
  // This exited 0 whether it had changed the board or not, and `npm run repair`
  // maps the drift step's 0 to "clean" — so the supervising job printed
  // REPAIR: CLEAN in the very pass that closed a live ticket. Found by session
  // starcaster-3e while re-deriving the chain.
  //
  // FOUR, NOT THREE, and the number is the whole of the merge decision here
  // (2026-09-04). This exit code arrived on #593 as a 3 on the same day the
  // scheduled shape above claimed 3 for "Dane has the deck". Both are house
  // dialect and both were right in isolation; together they would have made
  // one number mean two opposite things, so a pass that CLOSED a ticket would
  // have been read by `npm run repair` as a pass that declined to run — and
  // reported PAUSED. Nothing would have failed: the exit code is an integer
  // and every gate stays green through a wrong one. That is DOCTRINE 6.7's
  // "keep both sides" shape, and this file is the second place it was nearly
  // taken tonight (`scripts/lib/clickup.cjs` was the first).
  //
  // 3 stays with the decline because that dialect is repo-wide — `node:owns`,
  // `pipeline -- check`, `clickup claim`, the loop preflight all speak it, and
  // `standDownReport` above cites it by name. The write takes 4.
  //
  // Only a LIVE write counts. A dry run fills `repaired` with "would move"
  // lines, and exiting non-zero for those would report a rehearsal as a change.
  if (live && wrote.count > 0) process.exit(4);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[reconcile] unexpected failure: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  checkMergedTasks,
  checkClaimableTasks,
  claimableCandidates,
  ghPrIndex,
  PR_INDEX_LIMIT,
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
  isClaimable,
  ghPrState,
  AUTO_REPAIR_STATUSES,
  OPERATOR_STATUSES,
  CLAIMABLE_STATUSES,
  TERMINAL_STATUS_TO_SET,
  closureNote,
};
