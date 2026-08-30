'use strict';

/**
 * autoMergeLane — Lane A: "tests and documentation merge themselves after a
 * one-hour window."
 *
 * WHY THIS EXISTS (2026-08-25, task 86bbkw2au). Merge-on-comment removed the
 * HANDS from the merge step: Dane says "merge" and the machine performs it,
 * after checking review passed, checks are green, and nothing conflicts. What
 * remained was the WORD — and at scale that word is the ceiling. Ninety-four
 * merges in the week of 17-24 August is ninety-four decisions; at three hundred
 * it is not a decision any more, it is a rubber stamp, and a rubber stamp is
 * worse than a policy because it looks like oversight while providing none.
 *
 * So auto-merge goes exactly where his answer was never in doubt. Lane A is
 * 12% of the volume and approximately 0% of the risk — every changed file is a
 * test or a document, nothing runtime moves. That ratio is the REASON to start
 * here: what the first weeks measure is not whether documentation can be
 * merged safely, it is whether the MACHINERY is trustworthy — does the kill
 * switch work, does the digest get read, does the rate cap hold, does it
 * disable itself on trouble. Those questions are worth answering while the
 * blast radius is zero.
 *
 * Canon: vault `doctrine/AUTO-MERGE-LANES.md` (ratified 2026-08-24), including
 * Dane's three rulings — Lane A ships, it gets a one-hour objection window
 * ("to start", so a starting position rather than a permanent property), and
 * Lane C is never automated. Lane B was not ruled on and is not shipped;
 * nothing here knows what a Lane B is.
 *
 * EVERYTHING IN THIS FILE IS PURE. Path eligibility, window arithmetic, the
 * rate cap, the kill switch and the self-disable are decisions, and a decision
 * that can only be exercised against a live ClickUp and a live GitHub is a
 * decision nobody will break-test. The plumbing that carries these out lives
 * in scripts/clickup_direct.mjs (`bus-relay`), the same pass that already
 * relays his comments and performs his authorized merges.
 *
 * NOTHING HERE LOOSENS AN EXISTING PRECONDITION. Lane A replaces the
 * operator's comment and NOTHING else: a review PASS, an open PR, green
 * checks and a clean merge are all still required, and they are still checked
 * by mergeOnComment.githubGate on the way through. This module only ever
 * decides whether the machine may supply the word he would have said.
 */

const {
  normalizeCommand,
  isReviewVerdict,
  isReviewPassed,
  findPullRequest,
} = require('./mergeOnComment');

// ── Criterion 1: which files may ride in this lane ───────────────────────────

/**
 * The allow list, and it is an ALLOW list on purpose: one file outside it
 * disqualifies the whole PR. There is no partial credit and no "mostly tests"
 * — the doctrine's phrasing, and the reason is that a mixed PR's risk is the
 * risk of its riskiest file, not the average.
 */
const LANE_A_ALLOWED = [
  { label: 'a test file', re: /(^|\/)[^/]+\.test\.(js|ts|tsx|mjs)$/ },
  { label: 'a file under docs/', re: /^docs\// },
  { label: 'a Markdown document', re: /\.md$/ },
];

/**
 * Criterion 4, self-amendment: a machine may never auto-merge a change to the
 * machinery that governs machines. Not because such changes are usually bad —
 * most in August were excellent — but because a system that can widen its own
 * permissions has no ceiling, and the failure is undetectable from inside.
 *
 * Matched on the WHOLE repo-relative path, except CLAUDE.md which is matched
 * on its basename: this repo carries several (components/, src/css/, routes/,
 * public/js/, lib/builder-client/) and every one of them is an instruction to
 * agents, not prose.
 */
const GOVERNANCE_PATHS = [
  'docs/DOCTRINE.md',
  'docs/LOOP_ENGINEERING.md',
];

/** Any file with this basename is governance, wherever it sits. */
const GOVERNANCE_BASENAMES = ['CLAUDE.md'];

/**
 * A test that governs merging IS governance, even though it is a test file and
 * would otherwise sail through the allow list above.
 *
 * The ticket named four (mergeOnComment, branchCatchUp, wipCap, busRelayPlan).
 * Two more are here deliberately:
 *
 *   autoMergeLane — the rules of THIS lane. A lane that can auto-merge changes
 *   to its own eligibility rules is precisely the unbounded system criterion 4
 *   exists to prevent, and leaving it out would be a hole in the rule rather
 *   than a faithful reading of it.
 *
 *   reviewGate — the check that decides whether a ticket may reach Ready to
 *   launch at all. Lane A's whole safety rests on a review PASS being real, so
 *   the gate that defines "real" is the referee.
 *
 * Being STRICTER than the ticket is the safe direction here: the cost is that
 * two more PRs need Dane's word, which is the status quo.
 */
const GOVERNANCE_TEST_STEMS = [
  'mergeOnComment',
  'branchCatchUp',
  'wipCap',
  'busRelayPlan',
  'autoMergeLane',
  'reviewGate',
];

/**
 * `.github/` is CI machinery, and it contains Markdown (issue and PR
 * templates) that the allow list would otherwise wave through. A workflow file
 * is already ineligible because it is not `.md` — the templates are the hole.
 *
 * `.claude/` and `skills/` (2026-08-30, review round 2) are the same class and
 * were missed: `.claude/skills/loop-review/SKILL.md` IS the review gate's
 * instructions, every one of them is `.md`, and a PR rewriting how the review
 * loop gates work read as "documentation" and would have merged itself an hour
 * after announcing. Agent configuration is not prose, whichever folder it is in.
 */
const GOVERNANCE_PREFIXES = ['.github/', '.claude/', 'skills/'];

function basenameOf(p) {
  const s = String(p || '');
  const cut = s.lastIndexOf('/');
  return cut === -1 ? s : s.slice(cut + 1);
}

/**
 * Is this one path governance? Returns the reason string when it is, null when
 * it is not — so the caller can name the file AND why, rather than saying
 * "ineligible" and leaving the reader to guess.
 */
function governanceReason(file) {
  const path = String(file || '').trim();
  if (!path) return null;
  const base = basenameOf(path);

  if (GOVERNANCE_BASENAMES.includes(base)) {
    return `${path} is an instruction file for agents — a machine does not auto-merge its own instructions`;
  }
  if (GOVERNANCE_PATHS.includes(path)) {
    return `${path} is doctrine — a machine does not auto-merge the rules it is judged by`;
  }
  if (path.startsWith('.github/')) {
    return `${path} is CI machinery — a machine does not auto-merge what runs its own checks`;
  }
  if (GOVERNANCE_PREFIXES.some((p) => path.startsWith(p))) {
    return `${path} is agent configuration — a machine does not auto-merge the instructions it runs on`;
  }
  const m = /(^|\/)([^/]+)\.test\.(js|ts|tsx|mjs)$/.exec(path);
  if (m && GOVERNANCE_TEST_STEMS.includes(m[2])) {
    return `${path} tests the merge step itself — a test that governs merging is governance`;
  }
  return null;
}

/** Does this path match the allow list at all? */
function allowedReason(file) {
  const path = String(file || '').trim();
  const hit = LANE_A_ALLOWED.find((rule) => rule.re.test(path));
  return hit ? hit.label : null;
}

/**
 * Is every changed file eligible for Lane A?
 *
 * @param {string[]} files repo-relative paths, as `gh pr view --json files`
 *   reports them (which is what `git diff --name-only origin/main...HEAD`
 *   would give).
 * @returns {{eligible: boolean, reason: string, files: string[], blockedBy?: string}}
 */
function laneAEligibility(files) {
  const list = (Array.isArray(files) ? files : [])
    .map((f) => String(f && f.path ? f.path : f || '').trim())
    .filter(Boolean);

  // A PR that changed nothing is not a safe PR, it is an anomaly. Reading an
  // empty list as "every file matched" is the classic vacuous-truth bug, and
  // here it would auto-merge a PR nobody could describe.
  if (!list.length) {
    return { eligible: false, reason: 'the PR reports no changed files — nothing to judge', files: [] };
  }

  for (const file of list) {
    const gov = governanceReason(file);
    if (gov) return { eligible: false, reason: gov, files: list, blockedBy: file };
  }
  for (const file of list) {
    if (!allowedReason(file)) {
      return {
        eligible: false,
        reason: `${file} is not a test or a document, so this is not a Lane A change`,
        files: list,
        blockedBy: file,
      };
    }
  }
  return {
    eligible: true,
    reason: `all ${list.length} changed file(s) are tests or documentation`,
    files: list,
  };
}

// ── The window ───────────────────────────────────────────────────────────────

/**
 * One hour, Dane's ruling of 2026-08-24 — stricter than the draft, which
 * proposed merging immediately on a review PASS. Named rather than written as
 * a literal at the call site, because it is a decision he made with reasons
 * and shortening it is another decision he makes with the log in front of him.
 */
const WINDOW_MS = 60 * 60 * 1000;

/**
 * An announcement has a shelf life (2026-08-30, review round 2). Without one,
 * three PRs armed before a "stop auto-merging" would all be past their
 * deadline when he said "resume" a fortnight later, and would merge on the
 * next pass on windows that closed two weeks ago, with no fresh notice and
 * nothing on his screen. A day is generous: a pass runs every half hour, so an
 * armed ticket that is a day old was not waited out, it was forgotten.
 */
const STALE_MS = 24 * WINDOW_MS;

/**
 * How far into the window are we?
 *
 * `announcedAt` is ALWAYS the timestamp ClickUp put on the announcement
 * comment, read back from ClickUp — never local time at the moment of sending.
 * An announcement that failed to post is not a window, and a clock started
 * from the send would run even when the comment never arrived, merging
 * something nobody was ever told about.
 */
function windowState({ announcedAt, now, windowMs = WINDOW_MS, staleMs = STALE_MS } = {}) {
  const started = Number(announcedAt);
  const at = Number(now);
  if (!Number.isFinite(started) || started <= 0) {
    return { valid: false, elapsed: false, stale: false, elapsedMs: 0, remainingMs: windowMs, deadlineAt: null };
  }
  const deadlineAt = started + windowMs;
  const elapsedMs = at - started;
  return {
    valid: true,
    deadlineAt,
    elapsedMs,
    remainingMs: Math.max(0, deadlineAt - at),
    elapsed: at >= deadlineAt,
    // Past the deadline AND past its shelf life: the window closed long ago
    // and nobody was watching when it did.
    stale: elapsedMs >= staleMs,
  };
}

// ── The record on the ticket ─────────────────────────────────────────────────

/**
 * The announcement and its cancellation are ORDINARY TICKET COMMENTS carrying
 * a marker line, not a state file. That is deliberate: the ticket is the one
 * surface Dane and every pass can both see, the announcement has to be visible
 * to him anyway (an unannounced window is not a window), and a machine that
 * remembers its intentions somewhere he cannot look is how "it merged and I
 * never saw it coming" happens.
 *
 * It also means the clock is ClickUp's own comment timestamp, which is exactly
 * the confirmed-post time the doctrine requires.
 */
const AUTO_MERGE_MARKER = '[auto-merge]';

const AUTO_MERGE_MARKER_RE = /^\s*\[auto-merge\]\s+(armed|cancelled)\s+PR #(\d+)\b/im;

/** The marker line a notice carries, built where the notice is built. */
function markerLine(kind, prNumber, at) {
  return `${AUTO_MERGE_MARKER} ${kind} PR #${prNumber} lane A — ${at}`;
}

function parseAutoMergeMarker(text) {
  const m = AUTO_MERGE_MARKER_RE.exec(String(text || ''));
  if (!m) return null;
  return { kind: m[1].toLowerCase(), pr: Number(m[2]) };
}

function commentDate(c) {
  const n = Number(c && c.date);
  return Number.isFinite(n) ? n : 0;
}

function byDateNewestFirst(comments) {
  return (comments || []).slice().sort((a, b) => commentDate(b) - commentDate(a));
}

/**
 * The NEWEST auto-merge marker on the ticket decides where it stands. A ticket
 * announced, cancelled and announced again carries three, and only the last
 * one describes the present.
 */
function latestAutoMergeMarker(comments) {
  for (const c of byDateNewestFirst(comments)) {
    const parsed = parseAutoMergeMarker(c.comment_text);
    if (parsed) return { ...parsed, at: commentDate(c), commentId: String(c.id) };
  }
  return null;
}

/** The newest review verdict comment, whatever it says. */
function latestVerdict(comments) {
  const c = byDateNewestFirst(comments).find((x) => isReviewVerdict(x.comment_text));
  return c ? { at: commentDate(c), passed: isReviewPassed(c.comment_text) } : null;
}

// ── The kill switch ──────────────────────────────────────────────────────────

const SWITCH_STOP = 'stop auto-merging';
const SWITCH_RESUME = 'resume auto-merging';

/**
 * Read one of Dane's messages as a switch command.
 *
 * THE TWO HALVES ARE MATCHED DIFFERENTLY, ON PURPOSE. "stop" is found as a
 * SUBSTRING anywhere in his message; "resume" must be the whole message. The
 * asymmetry follows the cost: a stop that fires when he only mentioned it
 * costs a delay and one word to undo, while a resume that fires when he was
 * only talking about resuming costs an unwanted merge of something nobody
 * agreed to. When the two errors are that lopsided, the matcher should be too.
 *
 * Hyphen optional either way — nobody types punctuation the same way twice.
 */
function switchCommand(text) {
  const norm = normalizeCommand(text).replace(/auto[\s-]?merging/g, 'auto-merging');
  if (norm === SWITCH_RESUME) return 'resume';
  if (norm.includes(SWITCH_STOP)) return 'stop';
  return null;
}

/**
 * The switch's state, from every source that can carry it.
 *
 * @param {object}   opts
 * @param {Array}    opts.signals  [{ kind:'stop'|'resume', at:<ms>, where:<string> }]
 *                                 from the bus, from Loop Queue ticket comments,
 *                                 and from the ledger (a stop seen on an earlier
 *                                 pass — see why below).
 * @param {boolean}  opts.readable false if ANY source could not be read.
 *
 * FAIL-SAFE IS THE WHOLE POINT (standing condition 1). If the switch cannot be
 * read, auto-merge is OFF — not "assume fine". "He never said stop" and "I
 * could not find out whether he said stop" look identical from in here, and
 * only one of them is safe to act on.
 */
function killSwitchState({ signals, readable = true } = {}) {
  if (!readable) {
    return {
      state: 'off',
      why: 'the kill switch could not be read this pass, and an unreadable switch means OFF',
      at: null,
      where: null,
    };
  }
  const sorted = (signals || [])
    .filter((s) => s && (s.kind === 'stop' || s.kind === 'resume'))
    .slice()
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  const newest = sorted[0];
  if (!newest) return { state: 'on', why: 'no stop has been issued', at: null, where: null };
  if (newest.kind === 'stop') {
    return {
      state: 'off',
      why: `auto-merge was stopped${newest.where ? ` (${newest.where})` : ''}`,
      at: Number(newest.at) || null,
      where: newest.where || null,
    };
  }
  return {
    state: 'on',
    why: `auto-merge was resumed${newest.where ? ` (${newest.where})` : ''}`,
    at: Number(newest.at) || null,
    where: newest.where || null,
  };
}

// ── The rate cap ─────────────────────────────────────────────────────────────

/**
 * Standing condition 2. A burst is the signature of a loop misbehaving, so the
 * cap turns a runaway into a pause rather than into ninety merges.
 */
const CAP_PER_HOUR = 3;
const CAP_PER_DAY = 12;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * @param {Array}  entries  the ledger's merge records, [{ at:<ms>, ... }]
 * @param {number} now
 * Rolling windows, not calendar buckets: "12 per day" that resets at midnight
 * permits 24 in two hours across the boundary.
 */
function rateCapState(entries, now, { perHour = CAP_PER_HOUR, perDay = CAP_PER_DAY } = {}) {
  const at = Number(now);
  const list = (entries || []).map((e) => Number(e && e.at)).filter((n) => Number.isFinite(n));
  const inHour = list.filter((t) => at - t < HOUR_MS && t <= at).length;
  const inDay = list.filter((t) => at - t < DAY_MS && t <= at).length;
  if (inHour >= perHour) {
    return { allowed: false, inHour, inDay, why: `the hourly auto-merge cap is spent (${inHour}/${perHour} in the last hour)` };
  }
  if (inDay >= perDay) {
    return { allowed: false, inHour, inDay, why: `the daily auto-merge cap is spent (${inDay}/${perDay} in the last 24 hours)` };
  }
  return { allowed: true, inHour, inDay, why: `${inHour}/${perHour} this hour, ${inDay}/${perDay} today` };
}

// ── Self-disable ─────────────────────────────────────────────────────────────

/**
 * Standing condition 4. Two triggers, both meaning "this pass is not in a
 * position to be trusted with an irreversible action":
 *
 *   - the pass reported anything under "could not fully verify". That section
 *     is the relay's honest account of what it could not check (DOCTRINE 3.11),
 *     and a pass that could not check something is not a pass that should be
 *     merging on its own word.
 *   - `main`'s build went red after the last auto-merge. Whether or not the
 *     auto-merge caused it, merging more on top of a red main is how one bad
 *     change becomes five.
 *
 * A human re-enables it, with the same word that resumes the kill switch.
 */
function selfDisableState({ unchecked = [], mainBuildRed = false, persisted = null } = {}) {
  if (persisted && persisted.at) {
    return { disabled: true, why: persisted.why || 'auto-merge disabled itself earlier', at: Number(persisted.at) || null, fresh: false };
  }
  if (Array.isArray(unchecked) && unchecked.length) {
    return {
      disabled: true,
      fresh: true,
      at: null,
      why: `this pass could not fully verify ${unchecked.length} thing(s), so it is not in a position to merge on its own word`,
    };
  }
  if (mainBuildRed) {
    return {
      disabled: true,
      fresh: true,
      at: null,
      why: 'the build on main is red after the last auto-merge',
    };
  }
  return { disabled: false, why: '', at: null, fresh: false };
}

/**
 * Everything that can stop the lane, in one answer, cheapest and most
 * important first. Returned rather than thrown so the caller can SAY why —
 * silent automation and an unnoticed outage look the same (condition 3).
 */
function laneGate({ killSwitch, selfDisable, rateCap } = {}) {
  if (killSwitch && killSwitch.state === 'off') return { allowed: false, why: killSwitch.why, kind: 'kill-switch' };
  if (selfDisable && selfDisable.disabled) return { allowed: false, why: selfDisable.why, kind: 'self-disabled' };
  if (rateCap && !rateCap.allowed) return { allowed: false, why: rateCap.why, kind: 'rate-cap' };
  return { allowed: true, why: rateCap ? rateCap.why : 'no reason not to', kind: 'open' };
}

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * What should this pass do with one Ready-to-launch ticket?
 *
 *   'ignore'     — nothing to do, and usually nothing to say
 *   'need-files' — it is a candidate; the caller must fetch the PR's changed
 *                  files and ask again. Kept out of this module because it is
 *                  a network call, and the point of this file is that every
 *                  rule can be break-tested without one.
 *   'announce'   — eligible and unannounced: post the notice, start the clock
 *   'cancel'     — an announcement is live and must not proceed
 *   'merge'      — the hour has passed with no objection
 *
 * NOTE ON `files`: eligibility is checked at BOTH announce time and merge
 * time, against a fresh read. A branch can gain a commit during the window,
 * and a PR that was tests-only at 8:15 and touches `lib/` at 8:47 must not
 * merge at 9:15 on the strength of what it used to be.
 */
function laneADecision({
  status,
  comments,
  operatorId,
  now,
  files = null,
  windowMs = WINDOW_MS,
  staleMs = STALE_MS,
} = {}) {
  const all = byDateNewestFirst(comments);

  if (String(status || '').toLowerCase() !== 'ready to launch') {
    return { act: 'ignore', reason: `status is "${status}", not Ready to launch` };
  }

  // Criterion 8, and the precondition Lane A is least allowed to weaken: a
  // ticket with no review PASS is never eligible, whatever its files. Lane A
  // supplies the operator's word, not the reviewer's.
  const verdict = latestVerdict(all);
  if (!verdict) return { act: 'ignore', reason: 'no review verdict on this ticket — loop-review has not passed it' };
  if (!verdict.passed) return { act: 'ignore', reason: 'the most recent review verdict is not a PASS' };

  const pr = findPullRequest(all);
  if (!pr) return { act: 'ignore', reason: 'no "PR opened:" comment on this ticket — nothing to merge' };

  const marker = latestAutoMergeMarker(all);
  const armed = marker && marker.kind === 'armed' && marker.pr === pr.number;

  if (armed) {
    const win = windowState({ announcedAt: marker.at, now, windowMs, staleMs });

    // A stale announcement is cancelled, never merged: the hour it promised
    // him ended long ago, and a merge now would land on nobody's watch. It
    // takes a fresh review PASS to announce again, like any other cancel.
    if (win.stale) {
      return {
        act: 'cancel',
        pr,
        announcementId: marker.commentId,
        announcedAt: marker.at,
        reason: `the announcement is ${Math.round(win.elapsedMs / HOUR_MS)} hours old — its window closed long ago, so it is stale rather than due`,
        stale: true,
      };
    }

    // THE OBJECTION. Any comment from him during the window cancels it — any
    // comment, not a keyword. If he is talking about it, the machine stops.
    // A "false" objection costs him one word; a missed objection costs an
    // unwanted merge, so the asymmetry runs this way on purpose.
    const objection = all.find(
      (c) => Number(c.user && c.user.id) === Number(operatorId) && commentDate(c) > marker.at,
    );
    if (objection) {
      return {
        act: 'cancel',
        pr,
        announcementId: marker.commentId,
        announcedAt: marker.at,
        reason: 'you commented on this ticket while the window was open',
        objectionId: String(objection.id),
      };
    }

    if (files === null) return { act: 'need-files', pr, announcementId: marker.commentId, announcedAt: marker.at, reason: 'need the PR\'s changed files to re-check eligibility' };

    const still = laneAEligibility(files);
    if (!still.eligible) {
      return {
        act: 'cancel',
        pr,
        announcementId: marker.commentId,
        announcedAt: marker.at,
        reason: `the PR changed during the window and is no longer a Lane A change — ${still.reason}`,
        eligibility: still,
      };
    }

    if (!win.elapsed) {
      return {
        act: 'ignore',
        pr,
        announcedAt: marker.at,
        deadlineAt: win.deadlineAt,
        remainingMs: win.remainingMs,
        reason: `the objection window has ${Math.max(1, Math.round(win.remainingMs / 60000))} minute(s) left to run`,
      };
    }

    return {
      act: 'merge',
      pr,
      announcementId: marker.commentId,
      announcedAt: marker.at,
      eligibility: still,
      reason: `announced ${Math.round(win.elapsedMs / 60000)} minute(s) ago with no objection`,
    };
  }

  // Not armed for this PR. To announce (or re-announce) the newest review
  // verdict must be NEWER than the newest auto-merge marker of any kind.
  //
  // That single rule carries two requirements at once. Cancelling is terminal
  // for that announcement — it never re-announces without a fresh review PASS,
  // so he does not have to keep saying no to the same thing. And an `armed`
  // marker naming a DIFFERENT PR is stale in exactly the same way: the ticket
  // was rebuilt, and the new PR has to earn its own announcement.
  if (marker && verdict.at <= marker.at) {
    const what = marker.kind === 'cancelled'
      ? 'you stopped the last auto-merge on this ticket'
      : 'the last announcement was for a different PR';
    return { act: 'ignore', pr, reason: `${what}, and there has been no fresh review PASS since` };
  }

  if (files === null) return { act: 'need-files', pr, reason: 'need the PR\'s changed files to judge eligibility' };

  const eligibility = laneAEligibility(files);
  if (!eligibility.eligible) {
    return { act: 'ignore', pr, eligibility, reason: eligibility.reason };
  }

  return { act: 'announce', pr, eligibility, reason: eligibility.reason };
}

// ── What gets said ───────────────────────────────────────────────────────────

/**
 * Every notice is built HERE, returning the body and its marker as one object
 * — the pattern mergeOnComment.js arrived at the hard way, after a conflict
 * hand-off spent eleven tickets' authorizations while its comment promised the
 * opposite. Written apart, a promise and the record of what was actually done
 * drift; written together, a test can assert the pairing.
 */

/**
 * The announcement. `deadlineLabel` is formatted by the caller in Dane's local
 * clock with the zone read from his machine (OPERATIONS SOP 13) — this module
 * never touches a locale.
 *
 * A note on that time: it is computed from local time at the moment of
 * sending, while the BINDING deadline is the confirmed post time plus an hour.
 * The confirmed time is never earlier than the send, so the real deadline is
 * never earlier than the announced one. He can be merged on late; he can never
 * be merged on early, which is the direction that matters.
 */
function announcementNotice({ pr, files, deadlineLabel, at }) {
  const list = files.map((f) => `- \`${f}\``).join('\n');
  return {
    marker: markerLine('armed', pr.number, at),
    body: [
      `**Merging PR #${pr.number} at ${deadlineLabel} unless you say otherwise.**`,
      '',
      'This change touches nothing but tests and documentation, a review pass has already',
      'passed it, and its checks are green — so rather than wait for you to say "merge",',
      'this is announcing itself and giving you an hour to stop it.',
      '',
      `**To stop it, just comment on this ticket.** Anything at all — a word, a question,`,
      '"hold on". If you are talking about it, nothing merges, and it will not announce',
      'itself again until a fresh review pass has looked at it.',
      '',
      `The ${files.length} changed file(s), which are what made it eligible:`,
      '',
      list,
      '',
      `${pr.url}`,
      '',
      `(Automatic — Lane A, vault doctrine AUTO-MERGE-LANES. The one-hour clock starts when this comment posted. — bus-relay auto-merge)`,
      '',
      markerLine('armed', pr.number, at),
    ].join('\n'),
  };
}

/** He objected, or the PR stopped being eligible. Terminal for this announcement. */
function cancellationNotice({ pr, why, at }) {
  return {
    marker: markerLine('cancelled', pr.number, at),
    body: [
      `**Auto-merge stopped. Nothing was merged.**`,
      '',
      `Why: ${why}.`,
      '',
      `PR #${pr.number} is still open and this ticket is still Ready to launch, waiting on your`,
      'word exactly as it was before. It will not announce itself again unless a fresh review',
      'pass looks at it — so if you do want it in, say "merge" and it goes straight through.',
      '',
      `${pr.url}`,
      '',
      '(Automatic — Lane A. — bus-relay auto-merge)',
      '',
      markerLine('cancelled', pr.number, at),
    ].join('\n'),
  };
}

// ── The digest ───────────────────────────────────────────────────────────────

/**
 * Standing condition 3: announced, never silent. One post a day listing every
 * auto-merge with its lane and the files that qualified it — and saying "none"
 * on a quiet day, because a silent day and a broken job must not look alike.
 */
const DIGEST_EVERY_MS = 20 * HOUR_MS;

/** The span a digest covers when it has never run before. */
const DIGEST_WINDOW_MS = DAY_MS;

/**
 * Where this digest starts counting from. Consecutive digests are 20 hours
 * apart and used to each cover a fixed 24 — so every merge in the four-hour
 * overlap was reported twice (2026-08-30, review round 2). A digest now covers
 * everything since the LAST digest, and only the first ever one covers a day.
 */
function digestSince(ledger, now, windowMs = DIGEST_WINDOW_MS) {
  const last = Number(asLedger(ledger).lastDigestAt);
  return last > 0 ? last : Number(now) - windowMs;
}

/** Due if it has never run, or if the interval has passed. */
function digestDue(lastDigestAt, now, everyMs = DIGEST_EVERY_MS) {
  const last = Number(lastDigestAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return Number(now) - last >= everyMs;
}

function digestBody({ entries = [], sinceLabel = 'the last day', clockLabel } = {}) {
  const head = '[CC-starcaster bus-relay] Auto-merge digest';
  const when = clockLabel ? ` (${clockLabel})` : '';
  if (!entries.length) {
    return `${head}${when} — **none**. No pull request was auto-merged in ${sinceLabel}. (A quiet day and a broken job must not look alike, so this posts either way.)`;
  }
  const lines = entries.map((e) => {
    const files = (e.files || []).map((f) => `\`${f}\``).join(', ');
    return `- **Lane ${e.lane || 'A'}** · PR #${e.pr} · ${e.task ? `task ${e.task}` : 'task unknown'}\n  qualified by: ${files || '(files not recorded)'}`;
  });
  return `${head}${when} — ${entries.length} auto-merged in ${sinceLabel}:\n\n${lines.join('\n')}`;
}

// ── The ledger ───────────────────────────────────────────────────────────────

/**
 * The small amount of state that genuinely cannot live on a ticket: how many
 * auto-merges have happened recently (the rate cap), whether the lane has
 * disabled itself, and when the digest last posted.
 *
 * Pure transformations here, file IO in the caller — so the shape is testable
 * and the only untested part is `readFileSync`. Only one machine relays
 * (lib/nodeRoles.js), so one machine's file is the whole record.
 */
function emptyLedger() {
  return { version: 1, merges: [], switch: null, disabled: null, lastDigestAt: 0 };
}

/** Normalize whatever came off disk into a ledger, without throwing. */
function asLedger(raw) {
  const base = emptyLedger();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: 1,
    merges: Array.isArray(raw.merges) ? raw.merges.filter((m) => m && Number.isFinite(Number(m.at))) : [],
    switch: raw.switch && raw.switch.kind ? raw.switch : null,
    disabled: raw.disabled && raw.disabled.at ? raw.disabled : null,
    lastDigestAt: Number(raw.lastDigestAt) || 0,
  };
}

/**
 * Records older than two days cannot affect a 24-hour cap and are only there
 * to make the file grow forever.
 */
function pruneMerges(merges, now, keepMs = 2 * DAY_MS) {
  return (merges || []).filter((m) => Number(now) - Number(m.at) < keepMs);
}

function ledgerAfterMerge(ledger, entry, now) {
  const l = asLedger(ledger);
  return { ...l, merges: pruneMerges([...l.merges, entry], now) };
}

/**
 * Remember a stop.
 *
 * WHY IT IS PERSISTED. The switch can be set on any Loop Queue ticket, and a
 * pass only reads the OPEN ones. A "stop auto-merging" said on a ticket that
 * later goes Live would vanish from view and the lane would quietly switch
 * itself back on — the one direction a fail-safe must never fail in. Writing
 * it down makes the stop sticky, so only a `resume` NEWER than it can clear it.
 */
function ledgerAfterSwitch(ledger, signal) {
  const l = asLedger(ledger);
  if (!signal || (signal.kind !== 'stop' && signal.kind !== 'resume')) return l;
  const current = l.switch;
  if (current && Number(current.at) >= Number(signal.at)) return l;
  // Resuming clears a self-disable too: one word puts the lane back, rather
  // than a person having to find out there were two separate off switches.
  return { ...l, switch: signal, disabled: signal.kind === 'resume' ? null : l.disabled };
}

function ledgerAfterDisable(ledger, why, at) {
  const l = asLedger(ledger);
  if (l.disabled && l.disabled.at) return l;
  return { ...l, disabled: { at: Number(at), why: String(why || 'auto-merge disabled itself') } };
}

function ledgerAfterDigest(ledger, at) {
  return { ...asLedger(ledger), lastDigestAt: Number(at) };
}

/** The ledger's own switch record, in the shape killSwitchState wants. */
function switchSignalsFromLedger(ledger) {
  const l = asLedger(ledger);
  return l.switch ? [{ ...l.switch, where: l.switch.where || 'recorded on an earlier pass' }] : [];
}

/** Merges inside the digest window, newest first. */
function mergesSince(ledger, since) {
  return asLedger(ledger).merges
    .filter((m) => Number(m.at) >= Number(since))
    .sort((a, b) => Number(b.at) - Number(a.at));
}

module.exports = {
  // eligibility
  LANE_A_ALLOWED,
  GOVERNANCE_PATHS,
  GOVERNANCE_BASENAMES,
  GOVERNANCE_TEST_STEMS,
  GOVERNANCE_PREFIXES,
  governanceReason,
  allowedReason,
  laneAEligibility,
  // window
  WINDOW_MS,
  STALE_MS,
  windowState,
  // ticket record
  AUTO_MERGE_MARKER,
  markerLine,
  parseAutoMergeMarker,
  latestAutoMergeMarker,
  latestVerdict,
  // switch
  SWITCH_STOP,
  SWITCH_RESUME,
  switchCommand,
  killSwitchState,
  // cap
  CAP_PER_HOUR,
  CAP_PER_DAY,
  rateCapState,
  // self-disable
  selfDisableState,
  laneGate,
  // decision
  laneADecision,
  // notices
  announcementNotice,
  cancellationNotice,
  // digest
  DIGEST_EVERY_MS,
  DIGEST_WINDOW_MS,
  digestSince,
  digestDue,
  digestBody,
  // ledger
  emptyLedger,
  asLedger,
  pruneMerges,
  ledgerAfterMerge,
  ledgerAfterSwitch,
  ledgerAfterDisable,
  ledgerAfterDigest,
  switchSignalsFromLedger,
  mergesSince,
};
