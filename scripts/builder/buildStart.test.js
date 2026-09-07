'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBuildStart, describeBuildStart, buildStartExitCode, prLookupArgs } = require('./buildStart.js');

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

  const step = skill.slice(skill.indexOf('build-start --task'), skill.indexOf('build-start --task') + 1400);
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

test('a machine that SHOULD have answered and did not is CANNOT TELL, never fresh', () => {
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('cannot-tell', {
      unseen: [{ machine: 'macbook-pro', why: 'it could not be reached' }],
    }),
  });
  assert.equal(decision.action, 'unknown');
  assert.equal(buildStartExitCode(decision), 1, 'stop, do not branch');
  assert.match(decision.why, /CANNOT BE TOLD/);
  assert.match(decision.why, /macbook-pro/, 'and it names the seat that went quiet');
});

test('a cannot-tell names BOTH kinds of blind spot, not only the failed one', () => {
  // Once we are not branching anyway, somebody going to look by hand needs
  // every seat that was not looked at (DOCTRINE 3.11).
  const decision = resolveBuildStart([], {
    lookupPr: knows({}),
    hereId: 'mac-mini',
    findLocalWork: () => reading('cannot-tell', {
      unseen: [{ machine: 'other-a', why: 'it could not be reached' }],
      unlooked: [{ machine: 'other-b', why: 'no ssh route is declared' }],
    }),
  });
  assert.match(decision.why, /other-a/);
  assert.match(decision.why, /other-b/);
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
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8');
  const block = src.slice(src.indexOf("cmd === 'build-start'"), src.indexOf("cmd === 'pr-opened'"));
  assert.match(block, /localWorkReading\.workInProgressFor/, 'it has to take the reading');
  assert.match(block, /localWorkReading\.thisNodeName\(\)/, 'and know which machine it is standing on');
  assert.match(block, /buildStart\.buildStartExitCode\(decision\)/, 'and exit through the pinned mapping');
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
  const step = skill.slice(i, i + 1400);
  assert.match(step, /worktree/i, 'the disk half is described');
  assert.match(step, /another machine/i, 'including the seat it cannot reach');
});
