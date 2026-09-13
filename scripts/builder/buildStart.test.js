'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveBuildStart, describeBuildStart, describeNextMove,
  needsLocalWorkReading, buildStartExitCode, prLookupArgs,
  withLocalWork, blindHere, describeFoundWork, repoBlocked,
} = require('./buildStart.js');

/**
 * 2026-08-23: a loop-build pass opened two duplicate pull requests in one
 * session — #407 beside the already-open #349, and #408 beside #350. Both
 * originals had been sent back to `Queued` days earlier for one small missing
 * test case, were still open, and each had a `PR opened:` comment naming it in
 * the ticket's own history.
 *
 * The claim was correct: a sent-back ticket really is queued, and
 * `--if-status Queued` did its job. The atomic claim answers "is anyone else
 * starting this right now"; nothing answered "was this already started and
 * handed back".
 *
 * These cases are the real ones from that day, with the real PR numbers.
 */

/** A ticket comment in the shape ClickUp returns. */
const c = (id, text, date) => ({ id: String(id), comment_text: text, date: String(date) });

const PR_LINE = (n) => `PR opened: https://github.com/mentor24-maker/starcaster/pull/${n}`;

/** A lookup that knows about some PRs and nothing else. */
const knows = (map) => (pr) => (Object.prototype.hasOwnProperty.call(map, pr.number) ? map[pr.number] : { state: 'MISSING' });

test('the real case: a sent-back ticket whose PR is still open', () => {
  // 86bb4wjeq, as it stood this morning. #349 open since 2026-08-19, sent back
  // on the 20th, ticket sitting in Queued. A pass that starts a branch here
  // has just duplicated four days of somebody's work.
  const comments = [
    c(1, PR_LINE(349), 1_000),
    c(2, 'REVIEW: sent back to Queued — one surviving mutant proves a coverage hole.', 2_000),
  ];
  const decision = resolveBuildStart(comments, { lookupPr: knows({ 349: { state: 'OPEN', headRefName: 'gallery-media-topic-test' } }) });

  assert.equal(decision.action, 'continue');
  assert.equal(decision.pr.number, 349);
  assert.equal(decision.pr.branch, 'gallery-media-topic-test', 'and it names the branch to check out');
  assert.match(decision.why, /do not start a second one/i);
});

test('a ticket nobody has built yet gets a fresh branch', () => {
  const decision = resolveBuildStart([c(1, 'Spec looks right to me.', 1_000)], { lookupPr: knows({}) });
  assert.equal(decision.action, 'fresh');
  assert.equal(decision.pr, null);
});

test('no comments at all is also a fresh branch', () => {
  assert.equal(resolveBuildStart([], { lookupPr: knows({}) }).action, 'fresh');
  assert.equal(resolveBuildStart(undefined, { lookupPr: knows({}) }).action, 'fresh');
});

test('a ticket whose PR was merged or closed gets a fresh branch', async (t) => {
  for (const state of ['MERGED', 'CLOSED']) {
    await t.test(`PR is ${state}`, () => {
      const decision = resolveBuildStart([c(1, PR_LINE(408), 1_000)], { lookupPr: knows({ 408: { state } }) });
      assert.equal(decision.action, 'fresh');
      assert.equal(decision.pr.number, 408, 'the old PR is still named, so the choice is visible');
      assert.match(decision.why, new RegExp(state.toLowerCase()));
    });
  }
});

test('a PR that no longer exists is not treated as open', () => {
  const decision = resolveBuildStart([c(1, PR_LINE(999), 1_000)], { lookupPr: knows({}) });
  assert.equal(decision.action, 'unknown', 'MISSING is not a state we act on blindly');
});

// ── The asymmetry that matters ────────────────────────────────────────────

test('a lookup that FAILS reports "cannot tell", never "fresh"', async (t) => {
  // If a failed lookup fell back to `fresh`, this module would rebuild the
  // exact bug it exists to prevent — quietly, on the day GitHub is slow.
  await t.test('the lookup returns nothing', () => {
    const decision = resolveBuildStart([c(1, PR_LINE(349), 1_000)], { lookupPr: () => null });
    assert.equal(decision.action, 'unknown');
    assert.match(decision.why, /could not be read/i);
    assert.match(decision.why, /do NOT start a branch on a guess/i);
  });

  await t.test('the lookup throws', () => {
    const decision = resolveBuildStart([c(1, PR_LINE(349), 1_000)], {
      lookupPr: () => { throw new Error('gh: network unreachable'); },
    });
    assert.equal(decision.action, 'unknown', 'an exception is not permission to start fresh');
  });

  await t.test('no lookup was supplied at all', () => {
    const decision = resolveBuildStart([c(1, PR_LINE(349), 1_000)], {});
    assert.equal(decision.action, 'unknown', 'a caller that forgot the lookup must not get a green light');
  });

  await t.test('the state is a word we do not recognise', () => {
    const decision = resolveBuildStart([c(1, PR_LINE(349), 1_000)], { lookupPr: () => ({ state: 'DRAFTED' }) });
    assert.equal(decision.action, 'unknown');
    assert.match(decision.why, /unrecognised state/i);
  });

  await t.test('and NONE of those is ever "fresh"', () => {
    const broken = [() => null, () => { throw new Error('x'); }, () => ({}), () => ({ state: '' })];
    for (const lookupPr of broken) {
      assert.notEqual(
        resolveBuildStart([c(1, PR_LINE(349), 1_000)], { lookupPr }).action,
        'fresh',
        'a failed check must never authorise the thing it was checking for'
      );
    }
  });
});

test('the NEWEST PR line wins when a ticket has more than one', () => {
  // Exactly the shape 86bb4wjeq is in now: #349 then #407. A pass reading the
  // oldest would check out a closed branch.
  const comments = [
    c(1, PR_LINE(349), 1_000),
    c(2, PR_LINE(407), 5_000),
  ];
  const decision = resolveBuildStart(comments, {
    lookupPr: knows({ 349: { state: 'CLOSED' }, 407: { state: 'OPEN', headRefName: 'gallery-topic-tests' } }),
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.pr.number, 407, 'the current PR, not the superseded one');
});

test('the decision is reported in one readable line', () => {
  const cont = resolveBuildStart([c(1, PR_LINE(349), 1)], { lookupPr: knows({ 349: { state: 'OPEN' } }) });
  assert.match(describeBuildStart(cont), /^CONTINUE — /);

  const fresh = resolveBuildStart([], { lookupPr: knows({}) });
  assert.match(describeBuildStart(fresh), /^FRESH BRANCH — /);

  const unknown = resolveBuildStart([c(1, PR_LINE(1), 1)], { lookupPr: () => null });
  assert.match(describeBuildStart(unknown), /^CANNOT TELL — /);
});

test('it reuses the merge step\'s own parser, not a second one', () => {
  // Two parsers of one comment shape drift apart, and then the build step and
  // the merge step disagree about which PR a ticket is about — which is the
  // failure loopTrail.js was written to prevent in the first place.
  const source = require('node:fs').readFileSync(require.resolve('./buildStart.js'), 'utf8');
  assert.match(source, /require\('\.\/mergeOnComment\.js'\)/);
  assert.doesNotMatch(source, /PR opened:.*RegExp|new RegExp\(.*pull/i, 'no second regex for the same line');
});

test('the skill actually tells a pass to run this, and what each exit means', () => {
  // A module nothing calls is a module that does not run. The command exists
  // to be a STEP; if the step is not written down, this is decoration.
  const fs = require('node:fs');
  const path = require('node:path');
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '..', '.claude', 'skills', 'loop-build', 'SKILL.md'),
    'utf8'
  );
  assert.match(skill, /npm run clickup -- build-start --task/, 'the command is in the skill');

  // A generous window on purpose: this step gained the two flavours of exit 3
  // and the seat rule behind exit 1 (round-1 review), and a window sized to
  // yesterday's prose fails on prose that got MORE complete, which trains the
  // next reader to shrink the doc.
  const step = skill.slice(skill.indexOf('build-start --task'), skill.indexOf('build-start --task') + 3200);
  assert.match(step, /exit 3/, 'and exit 3 is explained');
  assert.match(step, /Do NOT start a\s+second branch/i, 'as "continue the existing one"');
  assert.match(step, /exit 1/, 'and exit 1 is explained');
  assert.match(step, /Stop and say so/i, 'as a stop, not a shrug');
  assert.doesNotMatch(step, /exit 1[^.]{0,80}fresh branch/i, 'cannot-tell must never read as go-ahead');
});

/* ------------------------------------------------------------------ *
 * WHICH REPO? (2026-09-01, task 86bbqyyfn)
 *
 * The lookup used to be handed a bare PR number, so every caller ran
 * `gh pr view <number>` with no `--repo` and gh resolved the repo from the
 * working directory — always starcaster. On 2026-08-31, building the
 * `repo:pulse` ticket 86bbq83j0, that reported "FRESH BRANCH — PR #1 is
 * merged" (starcaster's #1, merged in July) while pulse's #1 was open with
 * unmerged review work on it.
 *
 * The overlap is not a rare edge: every repo has a #1, the newer repos are in
 * single digits while starcaster is past #500, and starcaster's early PRs are
 * all merged — so the wrong answer is nearly always the permissive one.
 * ------------------------------------------------------------------ */

const PULSE_PR = (n) => `PR opened: https://github.com/mentor24-maker/pulse/pull/${n}`;

/** A lookup that answers per REPO, the way `gh --repo` does. Anything it is
 *  not told about is MISSING, so a repo-blind caller reads starcaster. */
const knowsAcrossRepos = (map) => (pr) => {
  const key = `${pr.owner}/${pr.repo}#${pr.number}`;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : { state: 'MISSING' };
};

const REAL_WORLD = {
  // starcaster #1: "Phase 0: security cleanup..." — merged 2026-07-02.
  'mentor24-maker/starcaster#1': { state: 'MERGED' },
  // pulse #1: "Read the ClickUp token at run time..." — still open.
  'mentor24-maker/pulse#1': { state: 'OPEN', headRefName: 'clickup-token-at-run-time' },
};

test('the real case: a repo:pulse ticket whose pulse PR #1 is OPEN says continue', () => {
  const decision = resolveBuildStart([c(1, PULSE_PR(1), 1_000)], {
    lookupPr: knowsAcrossRepos(REAL_WORLD),
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.pr.branch, 'clickup-token-at-run-time');
  assert.match(decision.why, /pulse/);
});

test('THE BUG: a repo-blind lookup answers about starcaster and says branch away', () => {
  // This is what the old code did — the lookup ignores the repo entirely.
  // It is pinned so the failure has a name if the `--repo` argument is ever
  // dropped again at a call site.
  const repoBlind = (pr) => REAL_WORLD[`mentor24-maker/starcaster#${pr.number}`] || { state: 'MISSING' };
  const decision = resolveBuildStart([c(1, PULSE_PR(1), 1_000)], { lookupPr: repoBlind });
  assert.equal(decision.action, 'fresh', 'the old behaviour: starcaster #1 is merged, so it says branch away');
});

test('the lookup is handed the owner and repo, not just the number', () => {
  let seen = null;
  resolveBuildStart([c(1, PULSE_PR(7), 1_000)], {
    lookupPr: (pr) => { seen = pr; return { state: 'OPEN' }; },
  });
  assert.equal(seen.owner, 'mentor24-maker');
  assert.equal(seen.repo, 'pulse');
  assert.equal(seen.number, 7);
});

test('a repo:pulse ticket whose pulse PR is merged is fresh', () => {
  const decision = resolveBuildStart([c(1, PULSE_PR(1), 1_000)], {
    lookupPr: knowsAcrossRepos({ 'mentor24-maker/pulse#1': { state: 'MERGED' } }),
  });
  assert.equal(decision.action, 'fresh');
});

test('a starcaster ticket is unaffected', () => {
  const open = resolveBuildStart([c(1, PR_LINE(349), 1_000)], {
    lookupPr: knowsAcrossRepos({ 'mentor24-maker/starcaster#349': { state: 'OPEN' } }),
  });
  assert.equal(open.action, 'continue');
  const merged = resolveBuildStart([c(1, PR_LINE(1), 1_000)], {
    lookupPr: knowsAcrossRepos(REAL_WORLD),
  });
  assert.equal(merged.action, 'fresh');
});

test('the lookup is NEVER called without a repo, whatever the comment said', () => {
  // The invariant, stated as a test rather than as a hope. The parser cannot
  // currently produce a PR line without an owner and repo (both are `[^/\s]+`
  // in PR_OPENED_RE), so resolveBuildStart's own no-repo guard is defence for
  // a future parser or a future caller — it cannot be reached from here, and
  // a test pretending to reach it would be a test that cannot fail. What IS
  // reachable, and what actually matters, is that nothing ever looks a PR up
  // without knowing where to look.
  for (const line of [PR_LINE(349), PULSE_PR(1), PULSE_PR(999)]) {
    let called = false;
    resolveBuildStart([c(1, line, 1_000)], {
      lookupPr: (pr) => {
        called = true;
        assert.ok(pr.owner, `no owner passed for: ${line}`);
        assert.ok(pr.repo, `no repo passed for: ${line}`);
        return { state: 'OPEN' };
      },
    });
    assert.ok(called, `the lookup never ran for: ${line}`);
  }
});

/* The argv itself, pinned. Both callers build their `gh` command through
 * prLookupArgs, so removing `--repo` is a change to THIS, and this fails. */

test('the gh lookup always names the repo', () => {
  assert.deepEqual(
    prLookupArgs({ owner: 'mentor24-maker', repo: 'pulse', number: 1 }),
    ['pr', 'view', '1', '--repo', 'mentor24-maker/pulse', '--json', 'state,headRefName'],
  );
});

test('the argv refuses to be built without a repo — it cannot silently omit one', () => {
  assert.throws(() => prLookupArgs({ number: 1 }), /owner, a repo and a number/);
  assert.throws(() => prLookupArgs({ owner: 'x', number: 1 }), /owner, a repo and a number/);
  assert.throws(() => prLookupArgs(null), /owner, a repo and a number/);
});

/* ------------------------------------------------------------------ *
 * THE DISK, NOT JUST THE PULL REQUEST (2026-09-07, task 86bbvur5a)
 *
 * A pull request is the LAST thing a build produces. `pass-reconcile` (#637)
 * and the stranded sweep (#624) both learned to look at a DISK before saying
 * nothing was built — and both hand the ticket back to `Rework` with a note
 * naming the machine, worktree and branch they found.
 *
 * `build-start` did not. So the next pass claimed that `Rework` ticket, asked
 * this module, got `fresh` (no PR exists — the pass died before pushing),
 * exit 0, and cut a second branch off `origin/main` over work the reconcile
 * had just gone to the trouble of finding. The step whose entire job is "has
 * this been started already?" was the one place still answering from comments
 * alone.
 * ------------------------------------------------------------------ */

/** A reading in the shape `strandedLocalWork.findWorkInProgress` returns. */
const reading = (verdict, extra = {}) => ({ verdict, work: [], unseen: [], unlooked: [], ...extra });

/** One stamped branch carrying work, as the probe reports it.
 *
 *  The worktree paths below are FICTIONAL roots on purpose (`/checkout/...`):
 *  a real one would name whichever machine this file was written on, which is
 *  the thing NODES principle P1 forbids and `check_conventions` blocks. What
 *  the assertions care about is that the path survives into the sentence, not
 *  where it points. */
const branch = (machine, name, { dirty = 0, ahead = 0, worktree = '' } = {}) =>
  ({ machine, branch: name, dirty, ahead, worktree });

test('THE REAL CASE: a half-finished worktree with no PR is no longer "fresh"', () => {
  // 86bbuhph0 as it actually stood on 2026-09-03: about two-thirds built in
  // `.claude/worktrees/related-articles-module`, 7 modified files, branch
  // stamped with the task id, and not one line pushed — so no PR to look up.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'macbook-pro',
    findLocalWork: () => reading('work', {
      work: [branch('macbook-pro', 'related-articles-module', {
        dirty: 7,
        worktree: '/checkout/.claude/worktrees/related-articles-module',
      })],
    }),
  });

  assert.equal(decision.action, 'continue', 'the same answer an open PR gets');
  assert.match(decision.why, /related-articles-module/, 'and it names the branch');
  assert.match(decision.why, /7 uncommitted files/, 'and what makes it count');
  assert.match(decision.why, /\.claude\/worktrees\/related-articles-module/, 'and the worktree to walk to');
  assert.match(decision.why, /do not start a second one/i);
  assert.equal(buildStartExitCode(decision), 3, 'a refusal, not a green light');
});

test('unpushed commits count as work too, not only uncommitted files', () => {
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('work', {
      work: [branch('mac-mini', 'video-backgrounds', { ahead: 3, worktree: '/checkout/wt/video-backgrounds' })],
    }),
  });
  assert.equal(decision.action, 'continue');
  assert.match(decision.why, /3 commits not on main/);
});

test('work on ANOTHER machine gets its own answer — refuse, and say where', () => {
  // This one matters because "continue that branch" would be an instruction
  // the pass cannot follow: the worktree is on a disk it has no route to. A
  // pass told to continue something it cannot reach will branch anyway.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('work', {
      work: [branch('macbook-pro', 'related-articles-module', { dirty: 7, worktree: '/checkout/wt/related-articles-module' })],
    }),
  });

  assert.equal(decision.action, 'elsewhere');
  assert.match(decision.why, /macbook-pro/, 'it names the machine');
  assert.match(decision.why, /related-articles-module/, 'and the branch');
  assert.match(decision.why, /do NOT start a branch here/i);
  assert.equal(buildStartExitCode(decision), 3, 'still a refusal');
  assert.notEqual(decision.action, 'fresh');
});

test('work on this machine wins when both machines are holding some', () => {
  // If anything is here, the pass can act on it. `elsewhere` is only for the
  // case where acting is impossible from this seat.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('work', {
      work: [branch('macbook-pro', 'there', { dirty: 1 }), branch('mac-mini', 'here', { dirty: 2 })],
    }),
  });
  assert.equal(decision.action, 'continue');
  assert.match(decision.why, /"here"/, 'and it points at the branch this machine can actually check out');
});

// ── The mirror-image defect: a guard that never lets anything through ──────

test('nothing anywhere still answers "fresh", and a build proceeds', () => {
  // This is the case that has to keep working. A guard that refuses every
  // claim is not a safe guard, it is a dead loop — and this repo has shipped
  // that one (the sweep, round 1, could not move a single ticket).
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('none'),
  });
  assert.equal(decision.action, 'fresh');
  assert.equal(buildStartExitCode(decision), 0, 'exit 0 — go and build');
  assert.match(decision.why, /no half-finished build is on any disk/);
});

test('a stamped branch with NOTHING on it is not work — a fresh worktree must still build', () => {
  // `npm run thread` stamps the branch it creates. A pass that has just made
  // one, or one that finished and pushed, is clean and level with main: zero
  // dirty files, zero commits beyond main. `strandedLocalWork.branchHasWork`
  // is what draws that line, and the reading hands only real work through.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('none'),
  });
  assert.equal(decision.action, 'fresh');
});

test('a seat with NO ssh route does not freeze the answer — it is named instead', () => {
  // From the Mini, which is where the loops actually run, there is no ssh
  // route to the MacBook at all (docs/ecosystem/inventory.yaml). Treating that
  // permanent fact as a failed reading would refuse EVERY claim forever —
  // the round-1 sweep bug, arriving through this door instead.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('none', {
      unlooked: [{ machine: 'macbook-pro', why: 'no ssh route to it is declared in docs/ecosystem/inventory.yaml' }],
    }),
  });
  assert.equal(decision.action, 'fresh', 'the loop keeps working from the seat it runs on');
  assert.equal(buildStartExitCode(decision), 0);
  assert.match(decision.why, /not looked at: macbook-pro/, 'but the blind spot is stated, never implied');
  assert.match(decision.why, /no ssh route/);
});

// ── "Could not tell" is never "nothing there" ─────────────────────────────

test('THIS machine going unreadable is CANNOT TELL, never fresh', () => {
  // The seat the pass is standing on is the disk it is about to cut a branch
  // on. Not being able to read it means not knowing whether the pass is about
  // to orphan its OWN half-finished worktree, which is this module's whole job.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('cannot-tell', {
      unseen: [{ machine: 'mac-mini', why: 'git there would not answer about the checkout' }],
    }),
  });
  assert.equal(decision.action, 'unknown');
  assert.equal(buildStartExitCode(decision), 1, 'stop, do not branch');
  assert.match(decision.why, /CANNOT BE TOLD/);
  assert.match(decision.why, /mac-mini/, 'and it names the seat that went quiet');
});

test('a blind spot with NO machine named on it is treated as this seat', () => {
  // A row that does not say where it is could be here, and "could be here" has
  // to take the careful answer.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('cannot-tell', { unseen: [{ why: 'the probe could not be run' }] }),
  });
  assert.equal(decision.action, 'unknown');
});

test('a caller that never said WHERE it is standing gets the careful answer', () => {
  // Without `hereId` the seats cannot be told apart at all, so none of them
  // can be waved past.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    findLocalWork: () => reading('cannot-tell', {
      unseen: [{ machine: 'macbook-pro', why: 'ssh exited 255' }],
    }),
  });
  assert.equal(decision.action, 'unknown');
  assert.equal(buildStartExitCode(decision), 1);
});

test('a cannot-tell about THIS seat names BOTH kinds of blind spot, not only the failed one', () => {
  // Once we are not branching anyway, somebody going to look by hand needs
  // every seat that was not looked at (DOCTRINE 3.11).
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('cannot-tell', {
      unseen: [{ machine: 'mac-mini', why: 'git there would not answer' }, { machine: 'other-a', why: 'it could not be reached' }],
      unlooked: [{ machine: 'other-b', why: 'no ssh route is declared' }],
    }),
  });
  assert.equal(decision.action, 'unknown');
  assert.match(decision.why, /other-a/);
  assert.match(decision.why, /other-b/);
});

/* ── THE SLEEPING LAPTOP (round-1 review of this ticket, 2026-09-07) ──────
 *
 * Round 1 made ANY machine that went quiet fatal. `inventory.yaml` gives
 * `macbook-pro` `probe: ssh` — so from the Mini it is ROUTED, not `unrouted` —
 * and the same entry says it "sleeps and travels" and is closed at the end of
 * the day. A shut laptop is therefore `unseen`: a machine that should have
 * answered and did not. Round 1 turned that into exit 1, which loop-build
 * reads as "stop", so EVERY new build was refused on the Mini for as long as
 * the laptop was shut — which is its overnight state, and overnight is when
 * the loops work. The lane dead with every surface quiet: the 2026-09-03 shape.
 */

test('ANOTHER machine going quiet does not freeze the lane — it is named instead', () => {
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('cannot-tell', {
      unseen: [{ machine: 'macbook-pro', why: 'ssh exited 255' }],
    }),
  });
  assert.equal(decision.action, 'fresh', 'the loop keeps working from the seat it runs on');
  assert.equal(buildStartExitCode(decision), 0);
  assert.match(decision.why, /not looked at: macbook-pro/, 'but the blind spot is stated, never implied');
  assert.match(decision.why, /ssh exited 255/, 'with the reason it went quiet');
});

test('a quiet remote seat is still named when another seat had no route at all', () => {
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('cannot-tell', {
      unseen: [{ machine: 'other-a', why: 'ssh exited 255' }],
      unlooked: [{ machine: 'other-b', why: 'no ssh route is declared' }],
    }),
  });
  assert.equal(decision.action, 'fresh');
  assert.match(decision.why, /other-a/);
  assert.match(decision.why, /other-b/);
});

/* ── DRIVEN FROM THE FLEET AS inventory.yaml ACTUALLY DECLARES IT ─────────
 *
 * The tests above hand `withLocalWork` a reading they built themselves, which
 * is right for the decision rule and WRONG for the question round 1 got wrong.
 * Round 1's covering test hand-built its `unlooked` row, so it never touched
 * the real inventory and could not have failed on the real fleet: the sleeping
 * laptop arrives as `unseen`, not `unlooked`, and only the real file says so.
 * A test that cannot go red against the fleet is the green the next reader
 * inherits (round-1 review, finding 1).
 *
 * So this drives the WHOLE reading — the real `nodeRoles.KNOWN_NODES`, the
 * real `docs/ecosystem/inventory.yaml`, the real `findWorkInProgress` — and
 * fakes only the transport, which is the one thing a test cannot have: an ssh
 * hop to a machine that may or may not be awake.
 */

const nodeRoles = require('../../lib/nodeRoles.js');
const strandedLocalWork = require('./strandedLocalWork.js');

/** The fleet, exactly as the committed inventory declares it. */
function realFleet() {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'ecosystem', 'inventory.yaml'),
    'utf8'
  );
  return { nodes: nodeRoles.KNOWN_NODES, routes: strandedLocalWork.sshRoutedMachines(text) };
}

/**
 * Take the real reading with a transport that answers the way a shut laptop
 * does. `quiet` is the set of machines whose ssh hop fails.
 *
 * The home directory is fictional on purpose — a real one would name the
 * machine this file was written on, which NODES principle P1 forbids and
 * `check_conventions` blocks.
 */
function readingFromFleet({ here, quiet = [], localOut = `${strandedLocalWork.PROBE_DONE}\n` }) {
  const { nodes, routes } = realFleet();
  const homedir = '/home/somebody';
  return strandedLocalWork.findWorkInProgress({
    taskId: '86bbvur5a',
    repoHome: `${homedir}/WebApps/starcaster`,
    nodes,
    hereId: here,
    homedir,
    routedMachines: routes.machines,
    routesKnown: routes.known,
    shell: (machine) => (quiet.includes(machine)
      ? { ran: false, why: 'ssh exited 255; not treated as drift' }
      : { ran: true, out: localOut }),
  });
}

test('the fleet really does contain a routed machine other than the one running the loops', () => {
  // The premise every test below rests on, asserted against the file rather
  // than assumed. If this ever fails, the inventory changed and the two tests
  // under it are aimed at a fleet that no longer exists — re-aim them, do not
  // delete them. A silent pass here is how round 1 shipped.
  const { nodes, routes } = realFleet();
  assert.ok(routes.known, 'docs/ecosystem/inventory.yaml must be readable and declare objects');
  const others = nodes.filter((n) => routes.machines.includes(n));
  assert.ok(others.length >= 2,
    `at least two machines must carry \`probe: ssh\` for the unseen path to exist at all; found ${JSON.stringify(others)}`);
});

test('THE ROUND-1 BUG: a sleeping machine must not refuse every fresh claim', () => {
  // Driven from every seat the loops could run on, because "it works from the
  // Mini" is the assumption that produced the bug in the other direction.
  const { nodes, routes } = realFleet();
  for (const here of nodes.filter((n) => routes.machines.includes(n))) {
    const quiet = nodes.filter((n) => n !== here);
    const decision = resolveBuildStart([], {
      lookupPr: knows({}),
      hereId: here,
      findLocalWork: () => readingFromFleet({ here, quiet }),
    });
    assert.equal(decision.action, 'fresh',
      `standing on ${here} with ${quiet.join(', ')} asleep, a ticket nobody has built must still be buildable`);
    assert.equal(buildStartExitCode(decision), 0);
    for (const m of quiet) {
      assert.match(decision.why, new RegExp(m), `and ${m} is named as a seat that was not looked at`);
    }
  }
});

test('...but the seat it is STANDING on going quiet still stops it', () => {
  // The mirror image, from the same fleet: an unreadable local probe is the
  // disk this pass is about to branch on.
  const { nodes, routes } = realFleet();
  for (const here of nodes.filter((n) => routes.machines.includes(n))) {
    const decision = resolveBuildStart([], {
      lookupPr: knows({}),
      hereId: here,
      // Local probe output with no PROBE-DONE line: output that stopped early
      // looks exactly like output that found nothing, and only one is an answer.
      findLocalWork: () => readingFromFleet({ here, quiet: nodes.filter((n) => n !== here), localOut: '' }),
    });
    assert.equal(decision.action, 'unknown', `standing on ${here}, an unreadable local disk is a stop`);
    assert.equal(buildStartExitCode(decision), 1);
  }
});

test('work found on the fleet still refuses, seats quiet or not', () => {
  // The guard has to keep guarding: this is the same fleet, same transport,
  // with the local probe reporting a stamped branch carrying uncommitted work.
  const { nodes, routes } = realFleet();
  const here = nodes.filter((n) => routes.machines.includes(n))[0];
  const out = `BRANCH\tbuild-start-local-work\t4\t0\t/home/somebody/WebApps/starcaster/.claude/worktrees/build-start-local-work\n${strandedLocalWork.PROBE_DONE}\n`;
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: here,
    findLocalWork: () => readingFromFleet({ here, quiet: nodes.filter((n) => n !== here), localOut: out }),
  });
  assert.equal(decision.action, 'continue');
  assert.equal(buildStartExitCode(decision), 3);
  assert.match(decision.why, /build-start-local-work/);
  assert.match(decision.why, /4 uncommitted files/);
});

test('a reading that THROWS, returns nothing, or answers gibberish is never fresh', async (t) => {
  const broken = {
    throws: () => { throw new Error('ssh: connection reset'); },
    'returns null': () => null,
    'returns no verdict': () => ({ work: [] }),
    'a verdict nobody taught it': () => reading('probably-fine'),
  };
  for (const [label, findLocalWork] of Object.entries(broken)) {
    await t.test(label, () => {
      const decision = resolveBuildStart([], { lookupPr: knows({}), hereId: 'mac-mini', findLocalWork });
      assert.equal(decision.action, 'unknown', 'a check that could not run is not a clean bill of health');
      assert.equal(buildStartExitCode(decision), 1);
    });
  }
});

// ── It costs nothing on the paths that already refuse ─────────────────────

test('the disk is not probed when a PR already answers the question', async (t) => {
  // An ssh probe sits on the hot path of every claim. `continue` and
  // `unknown` already name a pull request and already refuse to branch, so a
  // reading there could not change the answer — it would be pure cost.
  for (const [label, lookupPr] of [
    ['an open PR', knows({ 349: { state: 'OPEN' } })],
    ['an unreadable PR', () => null],
  ]) {
    await t.test(label, () => {
      let probed = false;
      resolveBuildStart([c(1, PR_LINE(349), 1_000)], {
        lookupPr,
        hereId: 'mac-mini',
        findLocalWork: () => { probed = true; return reading('none'); },
      });
      assert.equal(probed, false, 'nothing on a disk could change this answer');
    });
  }
});

test('a merged or closed PR DOES get the disk reading — it asserts an absence too', () => {
  let probed = false;
  const decision = resolveBuildStart([c(1, PR_LINE(408), 1_000)], {
    lookupPr: knows({ 408: { state: 'MERGED' } }),
    hereId: 'mac-mini',
    findLocalWork: () => {
      probed = true;
      return reading('work', { work: [branch('mac-mini', 'follow-up', { dirty: 2, worktree: '/w/follow-up' })] });
    },
  });
  assert.equal(probed, true, '"a new branch is right" is a claim about a disk as well');
  assert.equal(decision.action, 'continue');
});

test('a caller that does not ask for the reading gets exactly today\'s behaviour', () => {
  // `pass-reconcile` and the stranded sweep take this reading themselves, at
  // the point where THEY decide, and this ticket's non-goals say not to touch
  // either. They call `resolveBuildStart` without `findLocalWork`, so the
  // omission has to stay a no-op rather than a cannot-tell.
  assert.equal(resolveBuildStart([], { lookupPr: knows({}) }).action, 'fresh');
  assert.equal(resolveBuildStart([c(1, PR_LINE(349), 1)], { lookupPr: knows({ 349: { state: 'OPEN' } }) }).action, 'continue');
});

test('the reading comes from strandedLocalWork, not a second copy of the rule', () => {
  // The ticket's non-goal, as a test: "Do not add a second definition of
  // 'was anything built'." Two definitions drift, and then the reconcile that
  // preserved a ticket and the build-start that branches over it disagree.
  const source = require('node:fs').readFileSync(require.resolve('./buildStart.js'), 'utf8');
  assert.match(source, /require\('\.\/strandedLocalWork\.js'\)/);
  assert.doesNotMatch(source, /function (findWorkInProgress|probeScript|branchHasWork)\s*\(/,
    'no second copy of the probe or its rule');
  assert.doesNotMatch(source, /clickup-task/, 'and no second idea of what evidence looks like');
});

test('the command wires it to the SHARED module and to nothing else', () => {
  const block = buildStartCommandSource();
  assert.match(block, /localWorkReading\.workInProgressFor/, 'it has to take the reading');
  assert.match(block, /localWorkReading\.thisNodeName\(\)/, 'and know which machine it is standing on');
  assert.match(block, /buildStart\.buildStartExitCode\(decision\)/, 'and exit through the pinned mapping');
});

/** The `build-start` branch of the command, as text. */
function buildStartCommandSource() {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8');
  return src.slice(src.indexOf("cmd === 'build-start'"), src.indexOf("cmd === 'pr-opened'"));
}

/* ── FINDING 2: an unreadable ticket probed the WRONG repo, and said "fresh" ─
 *
 * The command fell back to `{ id: task }` when the ticket GET failed. That
 * fabrication has no `tags`; `resolveTaskRepo` answers `starcaster` for a task
 * with none — because no tag legitimately MEANS starcaster — so on any
 * transient ClickUp failure a `repo:pulse` ticket was probed against the
 * STARCASTER checkout, found nothing, and exited 0. The exact false all-clear
 * this reading exists to close, arriving through the reading itself, and the
 * second time this file has been bitten by "which repo?" (task 86bbqyyfn).
 */

test('a ticket that could not be read is CANNOT TELL, never "no work anywhere"', () => {
  const { workInProgressFor } = require('./localWorkReading.js');
  const probe = { here: 'mac-mini', shell: () => { throw new Error('nothing should be probed'); }, routedMachines: [], routesKnown: true };
  for (const [label, task] of [
    ['the fabrication the command used to build', { id: '86bbq83j0' }],
    ['no task at all', null],
    ['tags that are not a list', { id: '86bbq83j0', tags: 'repo:pulse' }],
  ]) {
    const reading = workInProgressFor(task, probe);
    assert.equal(reading.verdict, 'cannot-tell', label);
    assert.equal(reading.work.length, 0);
    assert.match(reading.unseen[0].why, /not read|could not be resolved/);
  }
});

test('a ticket with NO repo tag is still a real ticket — starcaster, and it gets probed', () => {
  // The mirror image. "No `repo:` tag" legitimately means starcaster, and
  // hardening the unread case must not turn every untagged ticket into a stop.
  const { workInProgressFor } = require('./localWorkReading.js');
  let probed = false;
  const probe = {
    here: 'mac-mini',
    shell: () => { probed = true; return { ran: true, out: `${strandedLocalWork.PROBE_DONE}\n` }; },
    routedMachines: [],
    routesKnown: true,
  };
  const reading = workInProgressFor({ id: '86bbvur5a', tags: [] }, probe);
  assert.equal(probed, true, 'an untagged ticket is looked at, not refused');
  assert.equal(reading.verdict, 'none');
});

test('the blind spot names the SEAT, so a caller can tell here from there', () => {
  // `build-start` draws its whole line on this. A literal 'this machine' can
  // never equal `hereId`, so the fatal/named split could not be made against it.
  const { workInProgressFor } = require('./localWorkReading.js');
  const reading = workInProgressFor({ id: 'x' }, { here: 'mac-mini', shell: () => ({ ran: true }), routedMachines: [], routesKnown: true });
  assert.equal(reading.unseen[0].machine, 'mac-mini');
});

test('the command no longer fabricates a ticket when ClickUp will not answer', () => {
  const block = buildStartCommandSource();
  assert.doesNotMatch(block, /\{\s*id:\s*task\s*\}/, 'a fabricated ticket is a guess about which repo to probe');
  assert.match(block, /throw new Error\([^)]*could not be read/, 'it refuses out loud instead');
});

/* ── The extra ClickUp read is only spent when it can change the answer ──── */

test('the ticket is read ONLY on the path that asks a disk', () => {
  assert.equal(needsLocalWorkReading({ action: 'fresh' }), true);
  for (const action of ['continue', 'elsewhere', 'unknown', 'something-new']) {
    assert.equal(needsLocalWorkReading({ action }), false, `${action} already refuses to branch`);
  }
  assert.equal(needsLocalWorkReading(null), false);
  // And the command gates the read on that predicate rather than a copy of it.
  const block = buildStartCommandSource();
  const gate = block.indexOf('buildStart.needsLocalWorkReading(fromPr)');
  assert.ok(gate > 0, 'the command asks the module when the disk is worth asking');
  assert.ok(block.indexOf('/api/v2/task/${task}`') > gate,
    'and the second ClickUp read sits INSIDE that gate, not above it');
});

test('resolveBuildStart and the command agree on when the disk is asked', () => {
  // One predicate, two callers. Two copies drift, and the drift here is either
  // a wasted read on every claim or a reading that never happens.
  const source = require('node:fs').readFileSync(require.resolve('./buildStart.js'), 'utf8');
  assert.match(source, /if \(!needsLocalWorkReading\(fromPr\)\) return fromPr;/);
});

/* ── FINDING 3: `elsewhere` had no way out ─────────────────────────────── */

test('"work on another machine" prints a decided next move, not just a refusal', () => {
  // The claim happens BEFORE this check, so the ticket is already in
  // "Building"; the reconcile returns it to "Rework"; rework is claimed first
  // and oldest-first; the next pass refuses it again. Without a way out the
  // lane spends every pass on the one ticket it can never build.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('work', { work: [branch('macbook-pro', 'b', { dirty: 1, worktree: '/w/b' })] }),
  });
  const next = describeNextMove(decision, { task: '86bbvur5a' });
  assert.match(next, /ask --task 86bbvur5a/, 'the escalation, in runnable form');
  assert.match(next, /Needs your input/);
  assert.match(next, /not hand this back to the claim line/i, 'and why a hand-back is the wrong move');
  assert.match(next, /take the next ticket/i, 'so the lane keeps moving');
});

test('the answers where refusing IS the instruction get no next move', () => {
  for (const action of ['continue', 'fresh', 'unknown']) {
    assert.equal(describeNextMove({ action }), '', `${action} already says what to do`);
  }
  assert.equal(describeNextMove(null), '');
});

test('the command prints the next move, and the skill tells a pass to follow it', () => {
  const block = buildStartCommandSource();
  assert.match(block, /buildStart\.describeNextMove\(decision, \{ task \}\)/);
  assert.match(block, /next:/);
  const fs = require('node:fs');
  const path = require('node:path');
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', '.claude', 'skills', 'loop-build', 'SKILL.md'), 'utf8');
  const i = skill.indexOf('build-start --task');
  const step = skill.slice(i, i + 3200);
  assert.match(step, /WORK ON ANOTHER MACHINE/, 'the flavour is named');
  assert.match(step, /take the next\s+ticket/i, 'and the pass is told to move on rather than stall');
});

/* ── FINDING 5: a merged PR plus local work printed a stale `pr:` line ──── */

test('a closed PR is named in words, never in the `pr:` field the reader follows', () => {
  // `fresh` is reached with a MERGED pull request as well as with none, and
  // carrying that `pr` through printed `pr: #408 (branch old-branch)` directly
  // under "no open pull request" — naming the one branch that must NOT be
  // checked out, which is exactly what CLAUDE.md step 4 tells a session to do
  // with a `pr:` line.
  const decision = resolveBuildStart([c(1, PR_LINE(408), 1_000)], {
    lookupPr: knows({ 408: { state: 'MERGED' } }),
    hereId: 'mac-mini',
    findLocalWork: () => reading('work', { work: [branch('mac-mini', 'follow-up', { dirty: 2, worktree: '/w/follow-up' })] }),
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.pr, null, 'nothing for the command to print as "the branch to continue"');
  assert.match(decision.why, /PR #408 is closed or merged/, 'the fact is kept');
  assert.match(decision.why, /not the branch to work on/, 'and disarmed');
  assert.match(decision.why, /follow-up/, 'while the branch that IS the work is named');
});

test('with no PR at all the sentence stays the short one', () => {
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('work', { work: [branch('mac-mini', 'wt', { dirty: 1 })] }),
  });
  assert.match(decision.why, /^no open pull request, but a build is already in progress/);
});

test('the four decisions map to exit codes, and an unknown action is never a 0', () => {
  assert.equal(buildStartExitCode({ action: 'fresh' }), 0);
  assert.equal(buildStartExitCode({ action: 'continue' }), 3);
  assert.equal(buildStartExitCode({ action: 'elsewhere' }), 3);
  assert.equal(buildStartExitCode({ action: 'unknown' }), 1);
  // The default matters: a reader that has not learned a new action must not
  // fall through to the permissive answer.
  assert.equal(buildStartExitCode({ action: 'something-new' }), 1);
  assert.equal(buildStartExitCode(null), 1);
});

test('"work on another machine" has its own words in the run report', () => {
  const elsewhere = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('work', { work: [branch('macbook-pro', 'b', { dirty: 1 })] }),
  });
  assert.match(describeBuildStart(elsewhere), /^WORK ON ANOTHER MACHINE — /);
});

test('the fast-track lane Dane runs by hand describes the exit 3 he will actually get', () => {
  // CLAUDE.md step 4 said exit 3 means `git worktree add ... origin/<branch>`.
  // On the worktree shape the branch was NEVER PUSHED, so `origin/<branch>`
  // does not exist and that command fails; on the other-machine shape the work
  // is on a disk this one cannot reach at all. SKILL.md was updated in round 1
  // and this consumer was not (round-1 review, finding 4) — and this is the
  // copy a person follows, with no exit code to fall back on.
  const fs = require('node:fs');
  const path = require('node:path');
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'CLAUDE.md'), 'utf8');
  const i = md.indexOf('build-start --task <id>`');
  assert.ok(i > 0, 'the fast-track lane still names the command');
  const step = md.slice(i, i + 1600);
  assert.match(step, /worktree/i, 'the disk half is described');
  assert.match(step, /another machine/i, 'including the seat it cannot reach');
  assert.match(step, /never pushed|does not exist/i, 'and why origin/<branch> is not always there');
  assert.doesNotMatch(step, /exit 3 means a branch\s+already exists/, 'the single-shape sentence is gone');
});

test('the skill tells a pass that a worktree with no PR also exits 3', () => {
  // A module nothing calls is a module that does not run; a refusal a pass has
  // not been told about is a refusal it will read as a crash and work around.
  const fs = require('node:fs');
  const path = require('node:path');
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '..', '.claude', 'skills', 'loop-build', 'SKILL.md'),
    'utf8'
  );
  const i = skill.indexOf('build-start --task');
  const step = skill.slice(i, i + 3200);
  assert.match(step, /worktree/i, 'the disk half is described');
  assert.match(step, /another machine/i, 'including the seat it cannot reach');
});

/* ══════════════════════════════════════════════════════════════════════ *
 * ROUND-2 REVIEW (2026-09-07) — one question, asked in four places.
 *
 * Round 2 drew the right line: the seat this pass is STANDING on going quiet
 * is fatal, another machine going quiet is named and stepped past. The review
 * found four ways that line did not hold, and they are one missing question —
 * WAS THE DISK UNDER OUR FEET ACTUALLY READ?
 *
 *   1  a machine this system cannot NAME made every seat remote, so no row
 *      could carry `hereId`, so `fatal` was empty BY CONSTRUCTION and a
 *      reading in which not one disk was read exited 0;
 *   2  a third consumer doc still described the single-shape exit 3;
 *   3  the `work` branch never asked the question at all, so a caller that
 *      omitted `hereId` had LOCAL work reported as another machine's;
 *   4  the same branch dropped `unseen`, so an `elsewhere` card omitted that
 *      the local disk had not been read.
 * ══════════════════════════════════════════════════════════════════════ */

/* ── FINDING 1: a machine with a name this system does not know ─────────── */

test('THE ROUND-2 BUG: a machine this system cannot NAME never reads as fresh', () => {
  // `nodeRoles.thisNode()` falls back to the HOSTNAME when `~/.alphire-node`
  // is missing, so a renamed Mac, a third node or a DHCP name lands here. Then
  // `repoPathOn` calls every seat remote — including the disk about to be
  // branched on — every one is ssh'd, and no `unseen` row can carry `hereId`.
  //
  // Driven through the REAL fleet with only the transport faked, and with a
  // `hereId` the real KNOWN_NODES does not contain: a hand-built one-machine
  // node list is what let round 1's mirror bug through, and the review asked
  // for this test specifically to be able to go red against the real file.
  const { nodes } = realFleet();
  const here = 'danes-new-mac';
  assert.ok(!nodes.includes(here), 'the premise: this name is genuinely unknown to the fleet');

  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: here,
    findLocalWork: () => readingFromFleet({ here, quiet: nodes }),
  });
  assert.equal(decision.action, 'unknown', 'not one disk was read, so this cannot be a go-ahead');
  assert.equal(buildStartExitCode(decision), 1);
  assert.match(decision.why, new RegExp(here), 'and the seat that was never looked at is NAMED');
  assert.match(decision.why, /own disk was never looked at/i);
});

test('...and it is caught even when every OTHER machine answers happily', () => {
  // The sneakier half, and the one no failing ssh makes visible: the remote
  // hops all succeed and report nothing, so the reading looks like a complete
  // sweep of a fleet — with the reader's own disk missing from it. `unseen`
  // would be empty here but for the row the reading adds for its own seat.
  const here = 'danes-new-mac';
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: here,
    findLocalWork: () => readingFromFleet({ here, quiet: [] }),
  });
  assert.equal(decision.action, 'unknown');
  assert.equal(buildStartExitCode(decision), 1);
  assert.match(decision.why, new RegExp(here));
});

test('the reading itself is what names the unread seat, so BOTH callers get it', () => {
  // The rule belongs to the reading, not to `build-start`'s policy: the sweep
  // and `pass-reconcile` take the same reading and must not assert an absence
  // on a fleet whose local disk was never in it either. Asserted on the
  // reading directly so a future `withLocalWork` rewrite cannot hide it.
  const here = 'danes-new-mac';
  const r = readingFromFleet({ here, quiet: [] });
  assert.equal(r.verdict, 'cannot-tell', 'a reading missing its own seat is not "none"');
  assert.ok(r.unseen.some((m) => m.machine === here), 'and the seat is a row, not a footnote');
});

test('a KNOWN seat is not given a duplicate row — the mirror image', () => {
  // The guard must not fire on the ordinary case, or every build on a properly
  // named machine stops. One row per machine, and the local seat's row is the
  // real probe's.
  const { nodes, routes } = realFleet();
  for (const here of nodes.filter((n) => routes.machines.includes(n))) {
    const r = readingFromFleet({ here, quiet: [] });
    assert.equal(r.verdict, 'none', `standing on ${here}, a clean sweep is still a clean sweep`);
    assert.equal(r.unseen.length, 0, 'and nothing is reported unseen');
  }
});

/* ── FINDINGS 3 AND 4: the `work` branch never asked the same question ──── */

test('a caller that omits hereId is never told LOCAL work is on another machine', () => {
  // Finding 3. Every line in the `work` branch turns on `w.machine === hereId`,
  // so an absent `hereId` made the comparison meaningless rather than false:
  // a worktree sitting underfoot came back "WORK ON ANOTHER MACHINE ... this
  // machine cannot check that out", which escalates to Dane over work in front
  // of it. The honest answer is that the seat is unknown.
  const decision = withLocalWork(
    { action: 'fresh', pr: null, why: 'no "PR opened:" line on this ticket — nothing has been built for it yet' },
    { findLocalWork: () => reading('work', { work: [branch('mac-mini', 'b', { dirty: 2, worktree: '/w' })] }) }
  );
  assert.equal(decision.action, 'unknown', 'the seat is unknown, so the attribution is too');
  assert.equal(buildStartExitCode(decision), 1);
  assert.doesNotMatch(decision.why, /cannot check that out/, 'and it does not claim to know where the work is');
  assert.match(decision.why, /never told which machine it is standing on/i);
  assert.match(decision.why, /branch "b"/, 'while still naming what was found');
});

test('an `elsewhere` card says when THIS machine\'s disk was not read', () => {
  // Finding 4. The direction was already safe — `elsewhere` is a refusal
  // either way — but the card that reaches Dane said "the work is over there"
  // when the truth was "the work is over there AND nobody looked here", and
  // that second half is the deciding fact for whoever acts on it.
  const decision = withLocalWork(
    { action: 'fresh', pr: null, why: 'no "PR opened:" line on this ticket — nothing has been built for it yet' },
    {
      hereId: 'mac-mini',
      findLocalWork: () => reading('work', {
        work: [branch('macbook-pro', 'b', { dirty: 2, worktree: '/w' })],
        unseen: [{ machine: 'mac-mini', why: 'its probe did not finish, so its answer is not trustworthy' }],
      }),
    }
  );
  assert.equal(decision.action, 'elsewhere', 'still a refusal, and still exit 3');
  assert.equal(buildStartExitCode(decision), 3);
  assert.match(decision.why, /disk on this machine was NOT read/i);
  assert.match(decision.why, /probe did not finish/, 'with the reason, not just the fact');
  assert.ok(decision.unseen?.some((m) => m.machine === 'mac-mini'), 'and `unseen` survives to the caller');
});

test('a quiet REMOTE seat does not add that clause — it could not change this answer', () => {
  // The mirror image of finding 4: `elsewhere` is already a refusal to branch,
  // so a remote seat going quiet cannot change it, and a clause on every card
  // is a clause nobody reads. Only the seat we are standing on earns one.
  const decision = withLocalWork(
    { action: 'fresh', pr: null, why: 'nothing built yet' },
    {
      hereId: 'mac-mini',
      findLocalWork: () => reading('work', {
        work: [branch('macbook-pro', 'b', { dirty: 1, worktree: '/w' })],
        unseen: [{ machine: 'some-third-box', why: 'ssh exited 255' }],
      }),
    }
  );
  assert.equal(decision.action, 'elsewhere');
  assert.doesNotMatch(decision.why, /disk on this machine was NOT read/i);
});

test('both branches ask the seat question through ONE predicate', () => {
  // The two branches disagreed for a whole round because the rule was spelled
  // out inline in one of them and nowhere in the other. `blindHere` is the
  // shared answer; this pins that it really is shared.
  assert.equal(blindHere([{ machine: 'mac-mini', why: 'x' }], 'mac-mini').length, 1, 'the seat we are on');
  assert.equal(blindHere([{ machine: 'macbook-pro', why: 'x' }], 'mac-mini').length, 0, 'not another seat');
  assert.equal(blindHere([{ machine: '', why: 'x' }], 'mac-mini').length, 1, 'a row with no machine is ours');
  assert.equal(blindHere([{ machine: 'macbook-pro', why: 'x' }]).length, 1, 'with no hereId, every row is ours');

  const source = require('node:fs').readFileSync(require.resolve('./buildStart.js'), 'utf8');
  const inline = source.match(/unseen\.filter\(\(m\) => !hereId/g) || [];
  assert.equal(inline.length, 0, 'no branch may re-spell the rule inline');
});

/* ── "ALSO WORTH A LOOK": every branch printed in one voice ─────────────── */

test('a `work:` line on ANOTHER machine cannot be read as one to check out', () => {
  // The command printed `describeWork(decision.work)` — every branch found, on
  // every machine, in identical lines under a heading a reader takes to mean
  // "the work to continue". CLAUDE.md step 4 tells a session to check a named
  // branch out, so an unlabelled remote line is an instruction it cannot follow.
  const decision = withLocalWork(
    { action: 'fresh', pr: null, why: 'nothing built yet' },
    {
      hereId: 'mac-mini',
      findLocalWork: () => reading('work', {
        work: [
          branch('mac-mini', 'mine', { dirty: 2, worktree: '/w/mine' }),
          branch('macbook-pro', 'theirs', { dirty: 1, worktree: '/w/theirs' }),
        ],
      }),
    }
  );
  assert.equal(decision.action, 'continue');
  const lines = describeFoundWork(decision);
  assert.equal(lines.length, 2, 'nothing is dropped — hiding the remote row would hide a real fact');
  assert.match(lines[0], /branch "mine"/);
  assert.doesNotMatch(lines[0], /NOT on this machine/, 'the local one carries no caveat');
  assert.match(lines[1], /NOT on this machine, so not a branch this pass can check out/);
});

test('with no seat known, every `work:` line says the attribution is unknown', () => {
  const lines = describeFoundWork({ work: [branch('mac-mini', 'b', { dirty: 1, worktree: '/w' })] });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /not known whether this is a branch it could check out/i);
});

test('the command prints the LABELLED lines, not the bare ones', () => {
  // The label is worthless if the command still renders `describeWork` itself.
  const source = buildStartCommandSource();
  assert.match(source, /buildStart\.describeFoundWork\(decision\)/,
    'the command asks the module for its work lines');
  assert.doesNotMatch(source, /strandedLocalWork\.describeWork\(decision\.work/,
    'and never re-renders them unlabelled');
});

/* ── FINDING 2: the THIRD consumer doc ─────────────────────────────────── */

test('the doc CLAUDE.md defers to describes the exit 3 a hand session will get', () => {
  // Round 1 named two consumers and round 2 fixed both; there is a third, and
  // it is the one CLAUDE.md calls "the full version, with the incidents behind
  // each step". Its step 4 still said exit 3 means a PR is open and gave
  // `git worktree add ... origin/<branch>` as the only move — which fails on
  // the worktree shape, because that branch was never pushed. Same defect as
  // round 1's finding 4, one doc further out.
  const fs = require('node:fs');
  const path = require('node:path');
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'LOOP_ENGINEERING.md'), 'utf8');
  const i = md.indexOf('**Find the branch.**');
  assert.ok(i > 0, 'the fast-track lane still has its step 4');
  // THE SECTION, NOT A CHARACTER COUNT. A fixed 2600 broke the moment round 4
  // added the third `CONTINUE` shape ahead of the exit-1 paragraph: the
  // assertions below went red on a doc that had just been made MORE complete,
  // which is a test measuring length rather than content.
  const end = md.indexOf('5. **On a send-back', i);
  assert.ok(end > i, 'step 4 still ends where step 5 begins');
  const step = md.slice(i, end);
  assert.match(step, /worktree/i, 'the disk half is described');
  assert.match(step, /another machine/i, 'including the seat it cannot reach');
  assert.match(step, /never pushed|does not exist/i, 'and why origin/<branch> is not always there');
  assert.match(step, /exit 1/i, 'and exit 1 is named as a stop');
  assert.doesNotMatch(step, /exit 3\s*\n?\s*means a PR is already open, so the work continues on THAT branch, not a\s+fresh one/,
    'the single-shape sentence is gone');
});

test('all three consumer docs describe the same command', () => {
  // Three docs drifted one at a time, one round each. This asserts them
  // together so the next edit cannot fix two and leave the third.
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..');
  const docs = {
    'CLAUDE.md': fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'),
    'docs/LOOP_ENGINEERING.md': fs.readFileSync(path.join(root, 'docs', 'LOOP_ENGINEERING.md'), 'utf8'),
    '.claude/skills/loop-build/SKILL.md': fs.readFileSync(path.join(root, '.claude', 'skills', 'loop-build', 'SKILL.md'), 'utf8'),
  };
  for (const [name, text] of Object.entries(docs)) {
    assert.match(text, /build-start --task/, `${name} names the command`);
    assert.match(text, /another machine/i, `${name} describes the seat it cannot reach`);
  }
});

/* ══════════════════════════════════════════════════════════════════════ *
 * ROUND-3 REVIEW (2026-09-07) — the two answers where refusing is not the
 * whole instruction.
 *
 *   1  A ticket whose `repo:` tag does not resolve made the reading answer
 *      `cannot-tell` naming THIS seat, so `build-start` exited 1 and the
 *      skill's exit-1 branch ("Stop and say so") ended the pass with nothing
 *      posted anywhere. `reconciledBuildDestination` then returned it to
 *      `Rework`, `queue --claimable` sorts rework first and oldest-first on a
 *      key that never changes, and the ticket sat at the head of the claim
 *      line being claimed and refused by every pass. One mis-tagged ticket
 *      killed the lane. On `main` this did not happen — `build-start` never
 *      consulted the reading, so the pass reached the repo rule three
 *      paragraphs further down and escalated correctly. A regression.
 *
 *   2  `CONTINUE` has a THIRD shape — a stamped branch whose worktree was
 *      removed — and all three docs gave a command that fails on it.
 * ══════════════════════════════════════════════════════════════════════ */

const localWorkReading = require('./localWorkReading.js');

/**
 * The reading for a ticket carrying `tags`, taken through the REAL resolver.
 *
 * The shell THROWS on purpose: the review asked for a break-test against a tag
 * that really does not resolve rather than a hand-built row, and a transport
 * that cannot be used is also the assertion that nothing was probed at all —
 * which is the fact the escalation's wording rests on.
 */
function readingForTags(tags, here = 'mac-mini') {
  return localWorkReading.workInProgressFor({ id: '86bbvur5a', tags }, {
    here,
    shell: () => { throw new Error('no disk should be probed when we do not know where to look'); },
    routedMachines: [],
    routesKnown: false,
  });
}

test('THE ROUND-3 BUG: a tag that really does not resolve leaves the pass an escalation', () => {
  // Driven through the real `taskRepo`, so a fleet or a rename that changed
  // the known repos cannot make this go quietly green.
  for (const tags of [[{ name: 'repo:does-not-exist' }], [{ name: 'repo:pulse' }, { name: 'repo:normie' }]]) {
    const decision = resolveBuildStart([], {
      lookupPr: knows({}),
      hereId: 'mac-mini',
      findLocalWork: () => readingForTags(tags),
    });
    const label = JSON.stringify(tags);
    // Exit 1 is still the right ANSWER — it genuinely cannot tell. The defect
    // was that nothing caught it.
    assert.equal(decision.action, 'unknown', `${label} still cannot tell`);
    assert.equal(buildStartExitCode(decision), 1, `${label} is still a stop`);

    const next = describeNextMove(decision, { task: '86bbvur5a' });
    assert.ok(next, `${label} must leave the pass something to DO, or the lane dies on it`);
    assert.match(next, /ask --task 86bbvur5a --status "Needs your input"/,
      `${label} names the escalation command, runnable as printed`);
    assert.match(next, /every\s+pass|for good/i, `${label} says why waiting does not fix it`);
    assert.match(next, /repo/i, `${label} names the repo tag as the cause`);
  }
});

test('a disk that merely went QUIET gets no escalation — stopping IS the instruction', () => {
  // The mirror, and the one that matters: an escalation offered here would
  // send Dane a card every time his laptop was shut, and would turn a blind
  // spot that clears itself into a ticket taken out of the lane.
  const { nodes, routes } = realFleet();
  const here = nodes.filter((n) => routes.machines.includes(n))[0];
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: here,
    findLocalWork: () => readingFromFleet({ here, quiet: nodes, localOut: 'truncated' }),
  });
  assert.equal(decision.action, 'unknown', 'the local disk going unread is still fatal');
  assert.equal(buildStartExitCode(decision), 1);
  assert.equal(describeNextMove(decision, { task: '86bbvur5a' }), '',
    'a seat that will answer on the next pass must not be escalated to Dane');
});

test('a ticket that could not be READ is transient, not an escalation', () => {
  // `BLOCKED_TICKET` and `BLOCKED_REPO` both stop the pass, and only one of
  // them is a ticket a human has to edit. A ClickUp blip must not put work in
  // front of Dane.
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => localWorkReading.workInProgressFor({ id: 'x' }, { here: 'mac-mini' }),
  });
  assert.equal(decision.action, 'unknown');
  assert.equal(describeNextMove(decision, { task: 'x' }), '',
    'a transient read failure clears itself; escalating it spends Dane on a retry');
});

test('the escalation is only offered for a blind spot on THIS seat', () => {
  // Through the same `blindHere` both other branches ask their seat question
  // through: a row that did not stop this pass has no business changing what
  // the pass is told to do.
  const elsewhereRow = {
    action: 'unknown',
    here: 'mac-mini',
    unseen: [{ machine: 'macbook-pro', blocked: strandedLocalWork.BLOCKED_REPO, why: 'not our seat' }],
  };
  assert.equal(repoBlocked(elsewhereRow), null);
  assert.equal(describeNextMove(elsewhereRow, { task: 'x' }), '');

  const ourRow = { ...elsewhereRow, unseen: [{ machine: 'mac-mini', blocked: strandedLocalWork.BLOCKED_REPO, why: 'ours' }] };
  assert.ok(repoBlocked(ourRow));

  // And it is only offered on the answer that stops the pass.
  assert.equal(describeNextMove({ ...ourRow, action: 'fresh' }, { task: 'x' }), '',
    'a decision that goes ahead needs no way out of a circle it is not in');
});

test('the marker is a shared constant, not a string spelled twice', () => {
  // Two files read this field. A bare literal in each is how the `work` and
  // `cannot-tell` branches came to disagree for a whole round.
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname);
  for (const f of ['buildStart.js', 'localWorkReading.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /blocked:\s*'repo'|blocked ===\s*'repo'/,
      `${f} must reach the marker through strandedLocalWork.BLOCKED_REPO`);
  }
  assert.equal(strandedLocalWork.BLOCKED_REPO, 'repo');
  assert.notEqual(strandedLocalWork.BLOCKED_REPO, strandedLocalWork.BLOCKED_TICKET);
});

/* ── FINDING 2: the third shape of CONTINUE, and the command that works ── */

test('the branch with no worktree is a shape the renderer really produces', () => {
  // The premise, asserted rather than assumed: if `describeWork` stops saying
  // this, the doc assertions below are pinning prose about nothing.
  const line = strandedLocalWork.describeWork([{ machine: 'mac-mini', branch: 'b', worktree: '', ahead: 1 }])[0];
  assert.match(line, /no worktree — the branch exists but is not checked out/);
});

test('all three consumer docs give a command that WORKS on all three shapes', () => {
  // Three docs, three shapes, and until round 3 every one of them offered two
  // moves for three cases: `-b <branch> origin/<branch>` fails on a branch
  // that was never pushed, and "cd into the folder it prints" has no folder.
  // `git worktree add <path> <branch>` — no -b, no origin/ — is the third.
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..');
  const docs = {
    'CLAUDE.md': fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'),
    'docs/LOOP_ENGINEERING.md': fs.readFileSync(path.join(root, 'docs', 'LOOP_ENGINEERING.md'), 'utf8'),
    '.claude/skills/loop-build/SKILL.md': fs.readFileSync(path.join(root, '.claude', 'skills', 'loop-build', 'SKILL.md'), 'utf8'),
  };
  for (const [name, raw] of Object.entries(docs)) {
    // Wrapped to ~76 columns, so a phrase legitimately straddles a newline.
    // The assertion is about the WORDS being there, never about where the
    // paragraph happened to break.
    const text = raw.replace(/\s+/g, ' ');
    assert.match(text, /build-start --task/, `${name} names the command`);
    assert.match(text, /another machine/i, `${name} describes the seat it cannot reach`);
    assert.match(text, /no worktree — the branch exists but is not checked out/,
      `${name} names the third shape in the words the command actually prints`);
    assert.match(text, /worktree add [^\n]*<topic> <branch>/,
      `${name} gives the move that works on it — no -b, no origin/`);
    assert.match(text, /[Nn]o `-b`/, `${name} says why -b is wrong there`);
    // And the exit-1 half, which is the same defect one answer over: a pass
    // told only to stop leaves a mis-tagged ticket to kill the lane.
    assert.match(text, /`next:`/, `${name} tells a reader exit 1 can carry an instruction`);
    assert.match(text, /repo:` tag does not resolve|repo:\*\* tag does not resolve/,
      `${name} names the exit-1 case that never clears on its own`);
  }
});
