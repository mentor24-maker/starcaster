'use strict';

/**
 * Before a build pass writes a line of code: is there already an open pull
 * request for this ticket?
 *
 * WHY THIS EXISTS (2026-08-23). A loop-build pass opened two duplicate PRs in
 * one session — #407 alongside the already-open #349, and #408 alongside #350.
 * Both originals had been sent back to `Queued` days earlier for one small
 * missing test case each, were still open, and each had a `PR opened:` comment
 * naming it sitting in the ticket's own history.
 *
 * The claim was not the problem. `--if-status Queued` did exactly its job,
 * because a sent-back ticket genuinely IS queued. THE ATOMIC CLAIM PROTECTS
 * AGAINST TWO BUILDERS STARTING AT ONCE; IT SAYS NOTHING ABOUT WORK THAT WAS
 * ALREADY STARTED AND HANDED BACK. Two different questions, and only one of
 * them was being asked.
 *
 * It was cheap that time only by luck — both duplicates happened to be
 * supersets, so closing the originals lost nothing. On a feature ticket it is
 * two branches diverging on one piece of work, and with a merge instruction
 * already on the ticket it is very nearly a relay merging one of two PRs with
 * nobody having decided which.
 *
 * The fix is a STEP, not a reminder. "Read the comments more carefully" is
 * advice, and a pass that must remember is a pass that will forget.
 */

const { findPullRequest } = require('./mergeOnComment.js');
const strandedLocalWork = require('./strandedLocalWork.js');

/**
 * WHAT A BUILD PASS SHOULD DO WITH THIS TICKET — the four answers.
 *
 *   continue   work already exists that this pass can carry on: an open PR,
 *              or (since task 86bbvur5a) a half-finished worktree on THIS
 *              machine. Check that branch out. Do NOT start a new one.
 *   elsewhere  work exists on ANOTHER machine, which this one cannot check
 *              out. Refuse, and say where it is. Also a "do not branch".
 *   fresh      nothing anywhere. A new branch is right.
 *   unknown    something could not be read HERE. STOP.
 *
 * `unknown` is not a soft `fresh`, and that asymmetry is the whole point: if
 * the lookup fails and we default to starting fresh, we have rebuilt the bug
 * this module exists to prevent. A check that could not run reports "cannot
 * tell", never a pass (the same rule `doctor:node` and the ecosystem drift
 * check follow).
 *
 * WITH ONE LINE DRAWN THROUGH IT, and it is the line round 1 got wrong: the
 * rule holds for the seat this pass is standing on. Another machine going
 * quiet is a blind spot NAMED on an answer that goes ahead, not a stop — see
 * `withLocalWork`'s cannot-tell branch, and the sleeping laptop that refused
 * every build on the Mini until it was drawn.
 *
 * THE ANSWER IS BUILT IN TWO HALVES. `resolveFromPullRequest` below is the
 * original, unchanged: it reads the ticket's `PR opened:` trail. `withLocalWork`
 * is the disk reading, and it is consulted ONLY when the first half says
 * `fresh` — see its own header for why, and for why it is injected rather than
 * imported.
 *
 * @param comments  the ticket's comments, as ClickUp returns them
 * @param lookupPr  (pr) => { state, headRefName } | null, where `pr` is the
 *                  WHOLE parsed pull request — `{ url, owner, repo, number }`,
 *                  not just its number. `null` means the lookup itself failed.
 *                  A PR that genuinely does not exist should come back as
 *                  { state: 'MISSING' }.
 *
 * IT IS HANDED THE REPO, NOT JUST THE NUMBER (2026-09-01, task 86bbqyyfn).
 * This used to pass `found.number` alone, and every caller then ran
 * `gh pr view <number>` with no `--repo`, so gh resolved the repo from the
 * working directory — always starcaster. On a `repo:pulse` ticket that read
 * STARCASTER's PR of the same number and answered about the wrong repo
 * entirely: on 2026-08-31, building 86bbq83j0, it reported "FRESH BRANCH —
 * PR #1 is merged" (starcaster's #1, merged in July) while pulse's #1 was open
 * with unmerged review work on it.
 *
 * It fails toward the unsafe side, which is what makes it worth a guard rather
 * than a note. Low PR numbers collide across repos almost by definition —
 * every repo has a #1, the newer repos are in single digits while starcaster
 * is past #500 — so the overlap is exactly the range cross-repo tickets live
 * in, and starcaster's early PRs are all merged, so the wrong answer is nearly
 * always the permissive one: "go ahead and branch".
 */
function resolveFromPullRequest(comments, lookupPr) {
  const found = findPullRequest(comments);
  if (!found) {
    return {
      action: 'fresh',
      pr: null,
      why: 'no "PR opened:" line on this ticket — nothing has been built for it yet',
    };
  }

  // A PR line we could parse but cannot place in a repo is a CANNOT TELL, not
  // a fresh branch. "I do not know which repo" and "there is no PR" must never
  // share an answer — that is the same conflation one layer down.
  if (!found.owner || !found.repo) {
    return {
      action: 'unknown',
      pr: found,
      why: `this ticket names PR #${found.number} but not which repo it is in — `
        + 'do NOT look it up in whichever repo happens to be the working directory',
    };
  }

  let info;
  try {
    info = typeof lookupPr === 'function' ? lookupPr(found) : null;
  } catch {
    info = null;
  }

  if (!info || !info.state) {
    return {
      action: 'unknown',
      pr: found,
      why: `this ticket names ${found.owner}/${found.repo} PR #${found.number} but its state could not be read — do NOT start a branch on a guess`,
    };
  }

  const state = String(info.state).toUpperCase();
  if (state === 'OPEN') {
    return {
      action: 'continue',
      pr: { ...found, branch: info.headRefName || '' },
      why: `${found.owner}/${found.repo} PR #${found.number} is still OPEN — continue that branch, do not start a second one`,
    };
  }

  if (state === 'MERGED' || state === 'CLOSED') {
    return {
      action: 'fresh',
      pr: found,
      why: `${found.owner}/${found.repo} PR #${found.number} is ${state.toLowerCase()} — a new branch is right`,
    };
  }

  return {
    action: 'unknown',
    pr: found,
    why: `PR #${found.number} reports an unrecognised state "${info.state}" — do NOT guess`,
  };
}

/**
 * THE SECOND READING: is a half-finished build sitting on somebody's DISK?
 *
 * WHY (2026-09-07, task 86bbvur5a). Everything above is a pull-request lookup,
 * and a pull request is the LAST thing a build produces. A pass that wrote
 * seven files and died before pushing leaves no PR at all, so `fresh` came
 * back — exit 0 — and the next pass cut a second branch off `origin/main`,
 * orphaning the work.
 *
 * That is not hypothetical. `pass-reconcile` (#637) and the stranded sweep
 * (#624) both learned to take this reading before handing a ticket back, and
 * both write a note on the ticket naming the machine, worktree and branch they
 * found. But the note only helps somebody who READS the comments, and
 * `build-start` — the step whose entire job is "has this been started
 * already?" — was answering from PR comments alone. So the loop's own
 * defence ended one step short of the step that acts on it.
 *
 * IT IS ONLY CONSULTED ON `fresh`, because `fresh` is the only answer that
 * asserts an ABSENCE. `continue` and `unknown` already name a pull request and
 * already refuse to branch; asking a disk could not change either one, and an
 * ssh probe on a hot path that cannot change the answer is pure cost.
 *
 * THE READING IS INJECTED, NOT IMPORTED. `resolveBuildStart` stays pure and
 * synchronous, and a caller that does not supply `findLocalWork` gets exactly
 * today's behaviour — which is what keeps `pass-reconcile` and the sweep
 * unchanged (this ticket's non-goals). They take the same reading themselves,
 * through the same module, at the point where THEY decide.
 *
 * @param fresh          the `fresh` decision the PR reading produced
 * @param findLocalWork  () => the shape `strandedLocalWork.findWorkInProgress`
 *                       returns: { verdict, work, unseen, unlooked }
 * @param hereId         which machine we are standing on, in `nodeRoles` words
 */
/**
 * THE ONE QUESTION BOTH BRANCHES BELOW ASK: was the disk this pass is standing
 * on actually read?
 *
 * WHY IT IS A FUNCTION (round-2 review, findings 3 and 4, 2026-09-07). Round 2
 * asked it only on `cannot-tell`, inline. The `work` branch never asked it at
 * all, and the two failures that produced were the same missing question:
 *
 *   - a caller that omitted `hereId` had every found branch compared against
 *     `undefined`, so LOCAL work came back "WORK ON ANOTHER MACHINE ... this
 *     machine cannot check that out" — an escalation to Dane over a worktree
 *     sitting in front of it;
 *   - a failed LOCAL probe plus work found remotely produced an `elsewhere`
 *     card that never mentioned the local disk had not been read, which is the
 *     one fact the reader needs to judge it.
 *
 * A row with no machine, or one naming the seat we are standing on, is this
 * machine's. So is EVERY row when the caller did not say where it is standing:
 * without `hereId` there is no way to tell the seats apart, and the answer
 * then has to be the careful one.
 */
function blindHere(unseen = [], hereId) {
  return (Array.isArray(unseen) ? unseen : [])
    .filter((m) => !hereId || !m || !m.machine || m.machine === hereId);
}

/**
 * OF THE BLIND SPOTS THAT STOPPED THIS PASS, IS ONE OF THEM A TICKET A HUMAN
 * HAS TO FIX?
 *
 * WHY (round-3 review, finding 1, 2026-09-07). `cannot-tell` covers two
 * situations that look identical on the way out of the reading and want
 * opposite moves:
 *
 *   a disk went quiet     waiting fixes it. The laptop opens, the next pass
 *                         gets an answer. Stopping is the whole instruction.
 *   the repo does not     waiting fixes NOTHING. The ticket carries the same
 *   resolve               bad `repo:` tag on every pass, so every pass claims
 *                         it, gets exit 1, and stops with nothing posted. The
 *                         reconcile returns it to `Rework`, rework is claimed
 *                         first and oldest-first on a key that never changes,
 *                         and the ticket sits at the head of the claim line
 *                         killing the lane — silently, which is the shape
 *                         CLAUDE.md names from 2026-09-03.
 *
 * This is the same circle round 1's finding 3 sent this ticket back for, and
 * it is closed the same way: not by softening the refusal, but by printing the
 * move OUT of it. `elsewhere` and this one are the two answers where refusing
 * is not the whole instruction.
 *
 * ONLY A BLIND SPOT ON THIS SEAT COUNTS, through the same `blindHere` both
 * branches above ask their seat question through — a row that did not stop
 * this pass has no business changing what the pass is told to do.
 */
function repoBlocked(decision) {
  const hereId = decision?.here;
  return blindHere(decision?.unseen, hereId)
    .find((m) => m && m.blocked === strandedLocalWork.BLOCKED_REPO) || null;
}

function withLocalWork(fresh, { findLocalWork, hereId } = {}) {
  if (typeof findLocalWork !== 'function') return fresh;

  let reading;
  try {
    reading = findLocalWork();
  } catch (err) {
    return {
      ...fresh,
      action: 'unknown',
      why: `${fresh.why}, but the local-work reading could not be taken (${err?.message || err}) — `
        + 'a check that did not run is not a clean bill of health, so do NOT start a branch',
    };
  }

  if (!reading || !reading.verdict) {
    return {
      ...fresh,
      action: 'unknown',
      why: `${fresh.why}, but the local-work reading came back with no verdict — do NOT start a branch on a guess`,
    };
  }

  const work = Array.isArray(reading.work) ? reading.work : [];
  const unseen = Array.isArray(reading.unseen) ? reading.unseen : [];
  const unlooked = Array.isArray(reading.unlooked) ? reading.unlooked : [];

  if (reading.verdict === 'work') {
    // WHERE the work is decides what a pass can do about it, and the two are
    // genuinely different instructions. Work on THIS machine is a worktree the
    // pass can `cd` into — the same answer an open PR gets. Work on another
    // machine cannot be checked out from here at all, so telling a pass to
    // "continue that branch" would be an instruction it cannot follow, and it
    // would very likely cut a branch anyway. It gets its own answer, which
    // refuses and says where to go.
    // BEFORE ATTRIBUTING ANY OF IT: do we know which seat we are on, and was
    // that seat read? (round-2 review, findings 3 and 4.) Every line below
    // turns on `w.machine === hereId`, so a `hereId` that names nothing makes
    // the comparison meaningless rather than false — and answering `elsewhere`
    // on a meaningless comparison escalates a worktree that may be underfoot.
    const localBlind = blindHere(unseen, hereId);
    if (!hereId) {
      return {
        ...fresh,
        action: 'unknown',
        work,
        unseen,
        unlooked,
        here: hereId,
        why: `${fresh.why}, and a build IS in progress somewhere — ${strandedLocalWork.describeWork(work).join('; ')} — `
          + 'but this reading was never told which machine it is standing on, so whether that is a worktree '
          + 'underfoot or one on a disk this pass cannot reach is unknown. Do NOT start a branch on a guess.',
      };
    }
    const here = work.filter((w) => w.machine === hereId);
    const there = work.filter((w) => w.machine !== hereId);
    // THE PULL REQUEST IS DROPPED FROM THIS ANSWER ON PURPOSE (round-1 review,
    // finding 5). `fresh` is reached with a MERGED or CLOSED pull request as
    // well as with none at all, and carrying that `pr` through made the command
    // print `pr: #408 (branch old-branch)` directly under the sentence "no open
    // pull request" — naming a branch that is emphatically not the one to work
    // on, which is exactly the branch a fast-track session following CLAUDE.md
    // step 4 would then check out. The decision here is about a DISK, so the
    // closed PR is named in the prose and never in the `pr:` field, which every
    // reader takes to mean "the branch to continue".
    const closed = fresh.pr ? ` (PR #${fresh.pr.number} is closed or merged, and is not the branch to work on)` : '';
    if (here.length) {
      return {
        action: 'continue',
        pr: null,
        work,
        unseen,
        unlooked,
        here: hereId,
        why: `no open pull request${closed}, but a build is already in progress on this machine — `
          + `${strandedLocalWork.describeWork(here).join('; ')}. `
          + 'Work on THAT branch; do not start a second one.',
      };
    }
    // THE LOCAL DISK GOING UNREAD IS THE DECIDING FACT ON THIS CARD, and it
    // used to be dropped (round-2 review, finding 4). The direction is already
    // safe — `elsewhere` is a refusal either way — but the card that reaches
    // Dane says "the work is over there" and he has no way to know it is
    // really "the work is over there AND nobody looked here". Only the local
    // seat is named: a quiet REMOTE seat cannot change this answer, which is
    // a refusal to branch already.
    const alsoBlind = localBlind.length
      ? ` The disk on this machine was NOT read (${strandedLocalWork.describeUnlooked(localBlind)}), `
        + 'so there may be work here as well.'
      : '';
    return {
      action: 'elsewhere',
      pr: null,
      work,
      unseen,
      unlooked,
      here: hereId,
      why: `no open pull request${closed}, but a build is already in progress on another machine — `
        + `${strandedLocalWork.describeWork(there).join('; ')}. `
        + `This machine cannot check that out, so do NOT start a branch here.${alsoBlind}`,
    };
  }

  if (reading.verdict === 'cannot-tell') {
    // A machine that SHOULD have answered and did not — and WHICH machine
    // decides whether that stops the build or is merely stated.
    //
    // ROUND 1 STOPPED THE BUILD FOR ALL OF THEM, AND THAT KILLED THE LANE
    // (round-1 review, finding 1, 2026-09-07). `docs/ecosystem/inventory.yaml`
    // gives `macbook-pro` `probe: ssh`, so from the Mini it is ROUTED — and the
    // same entry says in its own words that it "sleeps and travels" and is
    // closed at the end of the day. A shut laptop is therefore not `unrouted`,
    // it is `unseen`: a machine that should have answered and did not. Round 1
    // turned that into `unknown`, exit 1, which loop-build reads as "stop and
    // say so" — so EVERY new build, on every pass, was refused for as long as
    // Dane's laptop was shut. That is its overnight state, and overnight is
    // when the loops do their work. It is the 2026-09-03 shape from CLAUDE.md:
    // the lane dead for sixteen hours with every surface quiet.
    //
    // THE LINE THAT IS DRAWN INSTEAD is which SEAT went quiet, because the two
    // are not the same question:
    //
    //   this machine   the disk this pass is about to cut a branch on. Not
    //                  being able to read it means not knowing whether the
    //                  pass is about to orphan its OWN half-finished worktree,
    //                  which is the whole defect this module exists to close.
    //                  Fatal — exit 1, and criterion 3 is about this seat.
    //   another        a disk this pass could not use whatever the answer was.
    //                  Work found there yields `elsewhere`, which is itself a
    //                  refusal this pass cannot act on. Named as a blind spot
    //                  on an answer that goes ahead — the same treatment
    //                  `unrouted` already gets, for the same reason.
    //
    // THE RESIDUAL RISK IS REAL AND IS STATED RATHER THAN ARGUED AWAY: if the
    // sleeping machine IS holding unpushed work for this exact ticket, a second
    // branch gets cut. That window is narrow and recoverable — the work is
    // still on that disk, and the sweep and `pass-reconcile` both name it every
    // run. The alternative is a lane that is dead every night by design.
    // Certain and total beats rare and recoverable in only one direction.
    const blind = strandedLocalWork.describeUnlooked([...unseen, ...unlooked]);
    // The seat rule, asked through the ONE predicate the `work` branch above
    // asks it through. It used to be spelled out here and nowhere else, which
    // is how the `work` branch came to be missing it entirely.
    //
    // A MACHINE THIS SYSTEM CANNOT NAME ARRIVES HERE TOO, and it is the reason
    // this exit was reachable but empty until 2026-09-07: with `hereId`
    // matching no known machine, every seat was probed as remote and no row
    // could ever carry `hereId`, so `fatal` was empty BY CONSTRUCTION and a
    // reading in which not one disk was read exited 0. The reading itself now
    // adds an `unseen` row for the seat it was taken from
    // (`strandedLocalWork.findWorkInProgress`), so the question below has
    // something to find. The guard is kept here as well as there because they
    // answer to different owners: the reading owes an honest row, this owes
    // the refusal.
    const fatal = blindHere(unseen, hereId);
    if (fatal.length) {
      return {
        ...fresh,
        action: 'unknown',
        work,
        unseen,
        unlooked,
        here: hereId,
        why: `${fresh.why}, but whether a build is half-finished on a disk CANNOT BE TOLD from here — ${blind}. `
          + 'Do NOT start a branch on a reading nobody took.',
      };
    }
    return {
      ...fresh,
      work: [],
      unlooked,
      unseen,
      here: hereId,
      why: `${fresh.why}, and no half-finished build is on any disk that could be asked `
        + `(not looked at: ${blind})`,
    };
  }

  if (reading.verdict === 'none') {
    // The reading's real job, and it has to keep working: a guard that never
    // lets anything through is the mirror-image defect, and this repo has
    // shipped that one. A seat with no ssh route declared does NOT freeze this;
    // it is named in the line instead. (Round 1 justified that by saying there
    // is no route from the Mini to the MacBook — `inventory.yaml` gives one
    // now, so the sleeping-laptop case arrives as `unseen` and is handled in
    // the branch above. The rule outlives the example.)
    const seats = strandedLocalWork.describeUnlooked(unlooked);
    return {
      ...fresh,
      work: [],
      unlooked,
      here: hereId,
      why: seats
        ? `${fresh.why}, and no half-finished build is on any disk that could be asked `
          + `(not looked at: ${seats})`
        : `${fresh.why}, and no half-finished build is on any disk`,
    };
  }

  return {
    ...fresh,
    action: 'unknown',
    work,
    unseen,
    unlooked,
    here: hereId,
    why: `${fresh.why}, but the local-work reading returned an unrecognised verdict `
      + `"${reading.verdict}" — do NOT guess`,
  };
}

/**
 * @param comments       the ticket's comments, as ClickUp returns them
 * @param lookupPr       see `resolveFromPullRequest`
 * @param findLocalWork  optional; see `withLocalWork`. Omitted = today's
 *                       PR-only behaviour, exactly.
 * @param hereId         optional; which machine this is, for `findLocalWork`
 */
function resolveBuildStart(comments, { lookupPr, findLocalWork, hereId } = {}) {
  const fromPr = resolveFromPullRequest(comments, lookupPr);
  if (!needsLocalWorkReading(fromPr)) return fromPr;
  return withLocalWork(fromPr, { findLocalWork, hereId });
}

/**
 * Is this PR answer worth asking a disk about?
 *
 * Only `fresh` asserts an ABSENCE, and an absence is the only claim a disk can
 * contradict. `continue` and `unknown` already name a pull request and already
 * refuse to branch, so a reading there could not change the answer.
 *
 * IT IS A FUNCTION SO THE COMMAND AND THIS MODULE CANNOT DISAGREE (round-1
 * review, "also worth a look"). `clickup_direct.mjs` has to know the answer
 * BEFORE it decides whether to spend a second ClickUp read on the ticket — the
 * reading needs the ticket's `repo:` tag, and reading it unconditionally
 * doubled this command's ClickUp calls on every claim while contradicting the
 * comment three lines above it, which said nothing is probed on that path. The
 * predicate lives here so there is one answer to "when is the disk worth
 * asking", not two that drift.
 */
function needsLocalWorkReading(fromPr) {
  return fromPr?.action === 'fresh';
}

/**
 * WHAT A PASS SHOULD DO NEXT, for the answers where refusing is not enough.
 *
 * WHY (round-1 review, finding 3). `elsewhere` had no way out. The claim
 * happens before `build-start`, so the ticket is already in `Building`; a pass
 * that gets `elsewhere` refuses and stops; `reconciledBuildDestination` later
 * returns it to `Rework`; `queue --claimable` puts all rework first, oldest
 * first; the next pass claims it and refuses it again. The lane spends every
 * pass on the one ticket it can never build.
 *
 * The move out is an ESCALATION rather than another hand-back, because the
 * decision genuinely is not a loop's: work sitting on another machine can only
 * be finished on that machine (the loops run on one), so somebody has to say
 * whether to go and finish it there or abandon it and let the loop rebuild.
 * Handing it back to a claimable status just re-enters the same circle.
 *
 * Returns '' where refusing IS the whole instruction — `continue` names a
 * branch on this disk, and `unknown` means stop and say so.
 */
function describeNextMove(decision, { task = '<id>' } = {}) {
  // A TICKET WHOSE REPO DOES NOT RESOLVE IS THE OTHER ANSWER THAT NEEDS A WAY
  // OUT, and it needs one more badly than `elsewhere` does: `elsewhere` at
  // least depends on a disk that might come back, and this cannot change until
  // somebody edits the ticket. Named FIRST because a decision can only be one
  // action, and this one is `unknown` — the answer whose documented handling is
  // "stop and say so", which is precisely why the pass used to leave nothing
  // behind. (Round-3 review, finding 1.)
  const blocked = decision?.action === 'unknown' ? repoBlocked(decision) : null;
  if (blocked) {
    return 'This is not a disk that went quiet — nothing was probed at all, because the ticket does not say '
      + `which repo to look in (${blocked.why}). Waiting will not change that: the tag is the same on every `
      + 'pass, so handing this back to the claim line puts it at the head of the rework queue to be claimed '
      + 'and refused again, on every pass, for good. Escalate it instead — the loop-build skill\'s own repo '
      + `rule: \`npm run clickup -- ask --task ${task} --status "Needs your input" --body-file -\`, quoting `
      + 'the line above and asking which repo the ticket means. Then take the next ticket.';
  }
  if (decision?.action !== 'elsewhere') return '';
  return `Do not hand this back to the claim line — it would be claimed and refused again on every pass. `
    + `Escalate it: \`npm run clickup -- ask --task ${task} --status "Needs your input" --body-file -\`, `
    + 'naming the machine, worktree and branch above, and offering the two moves that exist — '
    + 'finish it on that machine with the fast-track lane, or abandon that work so the loop can rebuild it. '
    + 'Then take the next ticket.';
}

/**
 * The exact `gh` arguments for looking one pull request up.
 *
 * IT LIVES HERE SO THE `--repo` CANNOT BE DROPPED QUIETLY (task 86bbqyyfn).
 * Two callers ask this question — the `build-start` command and
 * `pipeline.mjs`'s `buildStartFor` — and both built their own argument list.
 * A unit test cannot reach either closure, so removing `--repo` from one of
 * them passed the entire suite: the break-test for this very fix did exactly
 * that and nothing went red. One builder, pinned by one test, is what makes
 * "break it on purpose and watch it fail" possible at all here.
 */
function prLookupArgs(pr) {
  if (!pr || !pr.owner || !pr.repo || !pr.number) {
    throw new Error('prLookupArgs needs a pull request with an owner, a repo and a number');
  }
  return ['pr', 'view', String(pr.number), '--repo', `${pr.owner}/${pr.repo}`, '--json', 'state,headRefName'];
}

/**
 * THE `work:` LINES, each one saying whether THIS pass can act on it.
 *
 * WHY (round-2 review, "also worth a look"). The command printed
 * `describeWork(decision.work)` — every branch the reading found, on every
 * machine, in identical lines under a heading a reader takes to mean "the work
 * to continue". A `continue` on this machine therefore listed the other
 * machine's branch in exactly the same voice, and CLAUDE.md step 4 tells a
 * session to check a named branch out. Honest and unlabelled is still a line
 * somebody can act on wrongly.
 *
 * The whole list is kept, because dropping the remote row would hide a real
 * fact; only the attribution is added. `strandedLocalWork.describeWork` stays
 * the one renderer of a branch, so the two cannot describe one differently.
 */
function describeFoundWork(decision) {
  const work = Array.isArray(decision?.work) ? decision.work : [];
  const here = decision?.here;
  return work.map((w) => {
    const line = strandedLocalWork.describeWork([w])[0];
    if (!here) {
      return `${line} — which machine this pass is standing on is not known, so it is not known whether this is a branch it could check out`;
    }
    return w.machine === here
      ? line
      : `${line} — NOT on this machine, so not a branch this pass can check out`;
  });
}

/** One line for a run report, so the choice is visible rather than implied. */
function describeBuildStart(decision) {
  if (!decision) return '';
  const prefix = {
    continue: 'CONTINUE',
    elsewhere: 'WORK ON ANOTHER MACHINE',
    fresh: 'FRESH BRANCH',
    unknown: 'CANNOT TELL',
  }[decision.action] || decision.action.toUpperCase();
  return `${prefix} — ${decision.why}`;
}

/**
 * The exit code for one decision, so the command and its tests cannot drift.
 *
 * The dialect is `node:owns`', which the loop-build skill already documents:
 * 0 = go ahead, 3 = somebody else's work, 1 = cannot tell. `elsewhere` is a 3
 * rather than a new code on purpose — it IS "somebody else's work", every
 * caller that branches on 3 already refuses to cut a branch, and the sentence
 * printed alongside it says which of the two kinds it is. A fourth code would
 * have to be taught to every reader of this command, and a reader that had not
 * learned it would fall through to its default, which is the permissive one.
 */
function buildStartExitCode(decision) {
  const action = decision?.action;
  if (action === 'continue' || action === 'elsewhere') return 3;
  if (action === 'unknown') return 1;
  if (action === 'fresh') return 0;
  // An action nobody taught this function about must not read as "go ahead".
  return 1;
}

module.exports = {
  resolveBuildStart,
  resolveFromPullRequest,
  withLocalWork,
  blindHere,
  repoBlocked,
  needsLocalWorkReading,
  describeBuildStart,
  describeFoundWork,
  describeNextMove,
  buildStartExitCode,
  prLookupArgs,
};
