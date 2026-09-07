'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHIP = path.join(__dirname, '..', 'ship_thread.cjs');
const source = fs.readFileSync(SHIP, 'utf8');

/**
 * `npm run ship` — the one safety property that has to survive every future
 * edit: IT NEVER FORCE-PUSHES.
 *
 * The first draft rebased and force-pushed with `--force-with-lease`. The
 * operator's settings carry `Bash(git push --force*)` on the deny list, and a
 * force-push buried inside a node script is invisible to a rule that matches
 * command text — so the command he would run most often would quietly have
 * done the thing he forbade (DOCTRINE.md 6.6). Catching up by merge instead of
 * rebase removes the need entirely, and costs nothing because every PR here is
 * squash-merged.
 *
 * A source-level assertion rather than a behavioural one on purpose: driving
 * the real script needs a remote, a PR and CI, so the property would go
 * untested in practice — and an untested property is how it came back.
 */

/** Executable source only: comments explain the rule and must not trip it. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = withoutComments(source);

test('the ship script contains no force-push, in any spelling', () => {
  assert.doesNotMatch(code, /--force/, 'no --force / --force-with-lease anywhere in executable code');
  assert.doesNotMatch(code, /'-f'/, "no bare -f flag in a git argv");
  assert.doesNotMatch(code, /push\s+-f\b/, 'no `push -f`');
});

test('it catches up by merging, not rebasing — that is what removes the force-push', () => {
  assert.match(code, /'merge',\s*'origin\/main'/, 'must merge origin/main');
  assert.doesNotMatch(code, /'rebase',\s*'origin\/main'/, 'must not rebase onto origin/main');
});

test('it never amends, which would rewrite pushed history into a force-push', () => {
  assert.doesNotMatch(code, /'--amend'/, 'the asset re-pin must be a new commit, not an amend');
});

test('main and master are refused as a branch to ship', () => {
  assert.match(code, /PROTECTED\s*=\s*new Set\(\[\s*'main',\s*'master'\s*\]\)/);
  assert.match(code, /PROTECTED\.has\(branch\)/, 'the guard must actually be consulted');
});

test('it refuses to ship a dirty tree, so nothing is left behind', () => {
  assert.match(code, /status',\s*'--porcelain'/);
});

test('a push rejection tells the operator to look, rather than escalating', () => {
  assert.match(source, /will not force-push over it/i);
});

test('the checks it runs include the gates CI runs', () => {
  for (const gate of ['typecheck', 'test:builder-ui', 'test:builder', 'test:hooks']) {
    assert.ok(code.includes(`'${gate}'`), `ship must run ${gate}`);
  }
  for (const gate of ['check_conventions.cjs', 'check_build_paths.cjs', 'check_syntax.cjs']) {
    assert.ok(code.includes(gate), `ship must run ${gate}`);
  }
});

test('a successful merge from a worktree does not attempt gh\'s own local branch-delete', () => {
  // gh pr merge --delete-branch tries to `git checkout main` locally to move
  // off the branch it is about to delete. Every `ship` run happens from a
  // worktree, where main is always checked out somewhere else, so that
  // checkout fails on every single run — printing a red `fatal: 'main' is
  // already used by worktree ...` and (per `gh help exit-codes`, "if a
  // command fails for any reason, the exit code will be 1") making gh's OWN
  // exit code non-zero even though the merge on GitHub genuinely succeeded.
  // The remote branch does not need the flag to be deleted — this repo has
  // GitHub's own "Automatically delete head branches" (delete_branch_on_merge)
  // on — and the local branch is `post-merge`'s and `npm run tidy`'s job
  // (via git cherry, not a plain checkout), so the flag was both redundant
  // and the actual source of the problem.
  const mergeCallMatch = code.match(/'gh',\s*\[\s*'pr',\s*'merge',\s*prNumber,([^\]]*)\]/);
  assert.ok(mergeCallMatch, 'must find the gh pr merge call');
  assert.doesNotMatch(mergeCallMatch[1], /delete-branch/, '--delete-branch must not be passed');
  assert.match(mergeCallMatch[1], /'--squash'/, 'the merge strategy itself must still be squash');
});

test('the merge call is still allowed to fail without stopping the script — the REAL check is what follows', () => {
  // gh's own exit code is not the source of truth for "did the merge work"
  // (see the test above — it can be non-zero on a real success). The
  // authoritative check is an independent re-read of the PR state after the
  // merge command, which must still fail() the script when the pull request
  // did not merge — that is what keeps criterion 3 (a genuine failure still
  // exits non-zero) true.
  //
  // THE SPELLING OF THAT RE-READ CHANGED (2026-09-05, task 86bbv35cq) and the
  // property did not. It used to be one `gh pr view --json state` an instant
  // after the merge command, compared against 'MERGED'. Under a merge queue
  // `gh pr merge` ENQUEUES and returns at once, so that single read sees OPEN
  // on a merge that is genuinely under way and ship would fail on every run.
  // The re-read is now `mergeCompletion.waitForMerge`, shared with the relay's
  // merge step so the two cannot answer "did it merge?" differently. What this
  // test asserts is the property, not the old line: ship still re-reads GitHub
  // itself, and still stops on anything that is not an observed merge.
  const mergeCallMatch = code.match(/'gh',\s*\[\s*'pr',\s*'merge',[^)]*\)/);
  assert.ok(mergeCallMatch, 'must find the gh pr merge call');
  assert.match(mergeCallMatch[0], /allowFail:\s*true/, 'gh\'s own cosmetic exit code must not stop the script');

  // AND THE SPELLING CHANGED AGAIN (round 2, same ticket). The re-read now
  // asks for the state and the HOLD in one call, because "still open" is not
  // "enqueued" until something says so — see mergeCompletion.js.
  const afterMerge = code.slice(code.indexOf(mergeCallMatch[0]));
  assert.match(afterMerge, /waitForMerge\(/, 'must independently re-read the PR state after merging');
  assert.match(afterMerge, /prObservationArgv\(/, 'the re-read asks GitHub for the state, its merge time AND what is holding it');

  // Every outcome that is NOT an observed merge stops the script, and the
  // success line is reached only after all four have been ruled out.
  const OUTCOMES = ['not-merged', 'queued', 'unknown', 'closed'];
  for (const outcome of OUTCOMES) {
    const at = afterMerge.indexOf(`mergeWait.outcome === '${outcome}'`);
    assert.ok(at > -1, `ship handles the ${outcome} outcome`);
    assert.match(afterMerge.slice(at, at + 900), /fail\(/, `a ${outcome} outcome must still call fail()`);
  }
  const success = afterMerge.indexOf('It is live once Vercel finishes deploying');
  assert.ok(success > -1, 'must find the merge success line');
  for (const outcome of OUTCOMES) {
    assert.ok(
      afterMerge.indexOf(`mergeWait.outcome === '${outcome}'`) < success,
      `ship declares the merge only after ruling out ${outcome}`
    );
  }
});

test('CRITERION 5 ON THE FAILURE PATH: a refused merge stays the fast, true answer', () => {
  // The half round 1 broke. `main`'s protection has strict:true, so a branch
  // that falls behind between ship's CI wait and its merge call is refused —
  // the commonest refusal there is. Round 1 turned that accurate one-second
  // answer into a fifteen-minute wait ending in "Nothing has gone wrong...
  // GitHub is still working through the merge queue", which named a mechanism
  // this repo does not have and, if followed, looped the same wait forever.
  //
  // Driven for real rather than asserted at source: waitForMerge is injectable
  // precisely so the shapes ship cannot reach in a test — a merge command that
  // succeeds while the PR stays open — are ordinary unit cases.
  const { waitForMerge } = require('./mergeCompletion');
  const drive = (payload, timeoutMs) => {
    let clock = 0;
    return {
      ...waitForMerge({
        readPr: () => payload,
        sleep: (ms) => { clock += ms; },
        now: () => clock,
        timeoutMs,
      }),
      elapsed: clock,
    };
  };

  // No queue, no auto-merge: GitHub refused it. One read, no sleep, and the
  // outcome ship maps to a plain failure.
  const refused = drive(
    { state: 'OPEN', mergedAt: null, isInMergeQueue: false, autoMergeEnabled: false },
    20 * 60 * 1000
  );
  assert.equal(refused.outcome, 'not-merged');
  assert.equal(refused.elapsed, 0, 'a twenty-minute budget is not spent on a merge nobody is holding');
  assert.notEqual(refused.outcome, 'queued', 'the false reassurance is gone');

  // The success path is unchanged and still costs nothing.
  const merged = drive(
    { state: 'MERGED', mergedAt: '2026-09-05T22:19:33Z', isInMergeQueue: false, autoMergeEnabled: false },
    20 * 60 * 1000
  );
  assert.equal(merged.outcome, 'merged');
  assert.equal(merged.elapsed, 0);

  // And the message ship prints for that failure must not mention a queue.
  const at = code.indexOf("mergeWait.outcome === 'not-merged'");
  const block = code.slice(at, at + 900);
  assert.doesNotMatch(block, /merge queue/, 'a refused merge is never announced as a queue wait');
  assert.match(block, /still OPEN/, 'it names the true state');
  assert.match(block, /run `npm run ship` again/i, 'and the advice actually resolves it — catch up and retry');
});

test('nothing overrides the exit code at the very end — a clean run relies on Node\'s own 0, not a forced one', () => {
  // Forcing `process.exit(0)` unconditionally at the end would be the
  // over-correction the ticket itself warns against: it would hide a REAL
  // late failure (e.g. in the tidy step) behind a fake success. The fix here
  // is removing the thing that was falsely non-zero, not adding a thing that
  // is falsely zero.
  const doneIndex = code.indexOf('is merged and main is up to date');
  assert.ok(doneIndex > -1, 'must find the final success message');
  assert.doesNotMatch(code.slice(doneIndex), /process\.exit\(0\)/, 'must not force success after the final message');
});

test('--dry-run and --no-merge exist, so it can be inspected before it acts', () => {
  assert.match(code, /dry-run/);
  assert.match(code, /no-merge/);
});

test('the CI step waits for checks to appear rather than reading absence as failure', () => {
  // The bug (PRs #356/#358): `gh pr checks --watch` returns non-zero the instant
  // a branch has zero checks, and ship read that as "the checks did not pass".
  // The fix routes the decision through waitForChecks, which tells "not yet"
  // apart from "failed". This is a source-level guard because driving the real
  // step needs a remote, a PR and CI (same reason as the force-push guard above).
  assert.match(code, /require\(['"]\.\/builder\/waitForChecks['"]\)/, 'ship must use the waitForChecks helper');
  assert.match(code, /waitForChecks\(/, 'the CI step must call waitForChecks');
});

test('absence, timeout and real failure are three DIFFERENT messages — none of them lies', () => {
  // never_appeared and timed_out_pending must not print "did not pass": that is
  // precisely the false alarm the ticket is about.
  const neverIdx = code.indexOf("=== 'never_appeared'");
  const timeoutIdx = code.indexOf("=== 'timed_out_pending'");
  const failedIdx = code.indexOf("=== 'failed'");
  assert.ok(neverIdx > -1, 'must handle the never_appeared outcome');
  assert.ok(timeoutIdx > -1, 'must handle the timed_out_pending outcome');
  assert.ok(failedIdx > -1, 'must handle the failed outcome');
  // "did not pass" belongs ONLY to the genuine-failure branch.
  assert.match(source, /did not pass/, 'the genuine-failure message is still present');
  const failedBranch = source.slice(source.indexOf("outcome === 'failed'"));
  assert.match(failedBranch.slice(0, 300), /did not pass/, 'only the failed branch says "did not pass"');
});

test('ship asks WHY the checks are absent before waiting or nudging (PR #630)', () => {
  // A pull request GitHub calls conflicting gets no runs at all — the workflows
  // trigger on `pull_request`, which runs against a merge ref GitHub cannot
  // build. Ship must therefore pass the mergeability probe in, or it goes back
  // to spending both windows and handing out the nudge remedy for a cause the
  // nudge cannot touch. Source-level for the same reason as the guards above.
  assert.match(code, /queryMergeable:\s*\(\)\s*=>\s*queryPullRequestMergeable\(prNumber\)/,
    'the CI wait must be given the mergeability probe');
  assert.match(code, /function queryPullRequestMergeable/);
  // Slice to the function's own closing brace, not a fixed character count: a
  // window that overruns into the next function reads ITS `fail(` and the
  // assertion below stops meaning anything.
  const from = code.indexOf('function queryPullRequestMergeable');
  const q = code.slice(from, code.indexOf('\n}\n', from));
  assert.match(q, /mergeable,mergeStateStatus/, 'it reads both fields GitHub answers with');
  assert.doesNotMatch(q, /fail\(/,
    'this probe only ADDS a diagnosis — an unreadable reading must never stop ship');
});

test('BOTH checkless outcomes go through ONE message builder, and ship writes no prose', () => {
  // Round 3 of 86bbvqkr1. `blocked_conflicting` and `never_appeared` used to be
  // two hand-written blocks here, and the second was assembled by APPENDING a
  // mergeability note to a nudge paragraph — a concatenation that told the
  // operator to do two opposite things in one message. The structural fix is
  // that ship no longer has any message strings to append to: it hands the
  // facts to `checklessMessage`, which fills exactly one remedy slot.
  assert.match(code, /require\('\.\/builder\/checklessMessage'\)/,
    'ship must get the message from the one place that decides it');
  const idx = code.indexOf("outcome === 'blocked_conflicting'");
  assert.ok(idx > -1, 'ship must still handle the blocked_conflicting outcome');
  const branch = code.slice(idx, code.indexOf("if (wait.outcome === 'timed_out_pending')", idx));
  assert.match(branch, /checklessMessage\(\{/, 'the branch builds its message with the builder');
  // The prose that used to live here, in both its spellings. Either one back in
  // this file is a second remedy waiting to be appended to the first.
  assert.doesNotMatch(branch, /Actions is enabled/);
  assert.doesNotMatch(branch, /will NOT help/);
  assert.doesNotMatch(branch, /catch-up merge/);
  // And it handles BOTH outcomes, so neither can drift away from the other.
  assert.match(branch, /outcome === 'never_appeared'/,
    'never_appeared is the same situation and must share the same builder');
});

test('ship asks gh for the `workflow` field — without it, CI cannot be told from Vercel', () => {
  // Round 2 of 86bbvqkr1, and the reason the guard above shipped unreachable.
  // A pull request here is never checkless in the literal sense: Vercel posts
  // its rows on every one, and they carry an empty `workflow` while our own
  // runs carry `CI` / `review-gate`. Drop this field from the --json list and
  // classifyChecks cannot see the difference — a board with nothing but Vercel
  // rows reads as fully green and ship walks into the merge with no CI at all.
  // classifyChecks throws rather than guessing, so this is belt and braces:
  // the throw catches it at runtime, this catches it at commit.
  const from = code.indexOf('function queryPullRequestChecks');
  assert.ok(from > -1, 'ship must still have its check reader');
  const q = code.slice(from, code.indexOf('\n}\n', from));
  assert.match(q, /'bucket,name,state,workflow'/,
    'the --json list must ask for workflow, or the CI/third-party distinction is unavailable');
});

test('THE COUPLING: the built message is what ship actually prints', () => {
  // The round-2 test asserted the mergeability note's three cases and nothing
  // asserted the note was USED — deleting `+ mergeNote` from the fail() call
  // left all 63 tests green while the operator got no cause diagnosis at all,
  // which was the round-1 defect back again. So the assertion is on the wiring:
  // one fail() in the branch, and its argument is the builder's own text.
  const idx = code.indexOf("outcome === 'blocked_conflicting'");
  const branch = code.slice(idx, code.indexOf("if (wait.outcome === 'timed_out_pending')", idx));
  assert.equal(branch.split('fail(').length - 1, 1, 'exactly one fail() in the checkless branch');
  assert.match(branch, /fail\(checklessMessage\(\{[\s\S]*\}\)\.text\)/,
    'the message ship prints must BE the built one, not a string beside it');
  // And it must be handed every fact the remedy is chosen from. A missing one
  // does not throw — it silently collapses the table onto a default.
  for (const field of ['outcome:', 'nudged:', 'nudgeFailedAt', 'mergeable:', 'localMerge:', 'checks:']) {
    assert.ok(branch.includes(field), `the builder must be given ${field}`);
  }
});

test('a conflicting reading is cross-checked against git before ship names a remedy', () => {
  // GitHub's mergeability is a cached computation and it is wrong here often
  // enough to have doctrine of its own (#567, #585, and PR #639 — this fix's
  // own pull request). "Bring main in" is the right answer on a stale branch
  // and a no-op loop on a current one, and ship merges main in at step 1, so
  // the phantom case is exactly the one that comes back round.
  assert.match(code, /function localMergeReading/);
  const from = code.indexOf('function localMergeReading');
  const probe = code.slice(from, code.indexOf('\n}\n', from));
  assert.match(probe, /merge-tree/, 'it asks git the same question GitHub answered');
  assert.match(probe, /classifyLocalMerge\(/, 'and classifies the answer in the tested place');
  assert.doesNotMatch(probe, /fail\(/,
    'a cross-check that cannot be taken must never stop ship — it is a diagnosis, not a gate');
  // Both refs resolved before the exit code is read: merge-tree exits 1 for an
  // unresolvable ref as well as for a conflict, and reading that bare 1 would
  // send the operator to resolve a conflict that does not exist.
  assert.match(probe, /\['rev-parse', '--verify', 'origin\/main/);
  assert.match(probe, /\['rev-parse', '--verify', 'HEAD/);
  assert.match(probe, /baseResolved/);
  assert.match(probe, /headResolved/);
  // Only paid for when GitHub has actually claimed a conflict.
  assert.match(code, /classifyMergeable\(wait\.mergeable\) === 'conflicting' \? localMergeReading\(\) : null/);
});

test('a broken gh call still stops ship — absence must not swallow a real error', () => {
  // queryPullRequestChecks returns [] for "no checks yet" but must fail() when
  // gh itself is broken (auth/network), or a dead endpoint would look like an
  // eternally-empty branch.
  assert.match(code, /function queryPullRequestChecks/);
  const q = code.slice(code.indexOf('function queryPullRequestChecks'));
  assert.match(q.slice(0, 800), /no checks reported/i, 'only the explicit "no checks reported" case returns empty');
  assert.match(q.slice(0, 800), /fail\(/, 'any other unreadable gh result stops ship');
});

test('the comment-stripper does not defeat the test it feeds', () => {
  // Guard the guard: if withoutComments ever ate real code, every assertion
  // above would pass vacuously.
  assert.ok(code.includes("spawnSync"), 'executable code survived stripping');
  assert.ok(!code.includes('force-push buried inside'), 'block comments were stripped');
  assert.ok(code.length > 2000, 'stripping left a plausible amount of code');
});

test('a failed nudge records WHICH step failed, because the advice is opposite', () => {
  // `nudgeChecks` returns false for two different situations. If the commit
  // failed, the branch really does need a new one. If the commit SUCCEEDED and
  // only the push failed, the commit is sitting on the branch locally and an
  // ordinary `git push` sends it. One message served both, and in the push case
  // it told the operator "re-running ship will NOT help" — the exact opposite
  // of the truth, in a script whose whole purpose is making these messages true.
  //
  // Ship's job is now only to RECORD which step failed; which advice follows
  // from it is decided and tested in checklessMessage.test.js, where every
  // combination is a real unit test rather than a slice of this file.
  assert.match(source, /nudgeFailedAt/, 'the failing step has to be recorded somewhere');

  const nudge = source.slice(source.indexOf('function nudgeChecks'));
  const body = nudge.slice(0, nudge.indexOf('\n}\n'));
  assert.match(body, /nudgeFailedAt = 'commit'/, 'a failed commit is recorded as such');
  assert.match(body, /nudgeFailedAt = 'push'/, 'a failed push is recorded as such');
  assert.match(body, /nudgeFailedAt = null/, 'and a successful nudge clears it');

  // And the record has to REACH the decision, or the two cases collapse.
  const idx = code.indexOf("outcome === 'blocked_conflicting'");
  const branch = code.slice(idx, code.indexOf("if (wait.outcome === 'timed_out_pending')", idx));
  assert.match(branch, /nudgeFailedAt,?/, 'the recorded step is handed to the message builder');
});

test('LOOP_ENGINEERING names BOTH causes of a checkless PR, and a remedy for each', () => {
  // Criterion 1 of task 86bbvqkr1. The doc used to describe one cause and one
  // remedy as though that were the whole story, so a pass reading it applied
  // the nudge commit to a conflicting head — which cannot work — and then
  // reported that Actions must be broken. Pinned here because a doc is the one
  // artifact that drifts with nothing failing.
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'LOOP_ENGINEERING.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## A build node must be able to make GitHub run its checks'));
  const body = section.slice(0, section.indexOf('\n## ', 4));
  assert.match(body, /mergeable,mergeStateStatus/,
    'it must give the command that tells the two causes apart');
  assert.match(body, /CONFLICTING/, 'the conflicting-head cause must be named');
  assert.match(body, /merge ref/i, 'and WHY a conflicting head gets no runs');
  assert.match(body, /git merge origin\/main/, 'the catch-up merge is the remedy for that cause');
  assert.match(body, /--allow-empty/, 'the nudge commit is the remedy for the other cause');
  assert.match(body, /UNKNOWN/, 'and UNKNOWN must be called out as neither');
});

test('LOOP_ENGINEERING no longer advises the ordering that steals the PR title', () => {
  // docs/LOOP_ENGINEERING.md used to say the work-log commit "is written and
  // pushed BEFORE the PR is opened". Follow that and the work-log commit is the
  // newest hand-authored commit when the PR is named, so pickPullRequestCommit
  // titles the PR after it — SHIP_AUTHORED_SUBJECTS skips only the re-pin and
  // nudge subjects. Squash-merge makes that permanent: the #304 failure, and
  // why docs/MISLABELED_MERGES.md exists. It also contradicted
  // loop-build/SKILL.md step 7 in the very same pull request.
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'LOOP_ENGINEERING.md'), 'utf8');
  const section = doc.slice(doc.indexOf('Avoiding it in the first place'));
  const advice = section.slice(0, 1200);

  assert.doesNotMatch(
    advice,
    /pushed \*?before\*? the PR is opened/,
    'the advice that causes the stolen title must not come back'
  );
  assert.match(advice, /gh pr checks/, 'it points at the ordering that avoids BOTH failures');
  assert.match(advice, /SKILL\.md/, 'and names where that ordering is written down');

  // A work-log commit is hand-authored, so nothing in ship skips it. If that
  // ever changes, this doc guidance can be revisited — until then it stands.
  const picker = fs.readFileSync(path.join(__dirname, 'pullRequestCommit.js'), 'utf8');
  assert.doesNotMatch(
    picker,
    /Work log/i,
    'ship does not skip work-log commits, which is why the ordering matters'
  );
});

// ---------------------------------------------------------------------------
// Decisions D2 and D3 (2026-09-03, task 86bbu2uhq — DOCTRINE §6.17).
// ---------------------------------------------------------------------------

test('ship asks the pause switch before merging, and quotes it when it stops', () => {
  // the module-level `code` (line ~35) is the comment-stripped source
  const ask = code.indexOf("'pipeline', '--', 'check'");
  const merge = code.indexOf("'pr', 'merge'");
  assert.ok(ask > 0, 'the ask exists — the audit found ship merging with no read of the switch');
  assert.ok(ask < merge, 'and it comes BEFORE the merge, or it is decoration');
  assert.match(code, /In its own words:/, 'a stop quotes the switch rather than paraphrasing it');
  assert.match(code, /resume --operator-asked/, 'and names whose call the resume is');
});

test('the review gate is stated before the merge, and never enforced by ship', () => {
  // the module-level `code` (line ~35) is the comment-stripped source
  const gate = code.indexOf("'waiting', '--task'");
  const merge = code.indexOf("'pr', 'merge'");
  assert.ok(gate > 0 && gate < merge, 'the gate context precedes the merge');
  // Reported, not enforced (D3, as approved): the gate block may not fail the
  // ship. Slice from the gate read to the Merging heading and prove no fail().
  const block = code.slice(gate, code.indexOf("heading('Merging')"));
  assert.doesNotMatch(block, /fail\(/,
    'enforcement stays with the one merge gate until a driving incident — ship only states');
  assert.match(block, /no ticket stamp, so there is nothing to read it from/,
    'an unstamped branch says so instead of pretending');
  assert.match(block, /reported here, not enforced/,
    'an unreadable gate is said out loud and the merge proceeds, as decided');
});

test('CLAUDE.md no longer answers yes AND no about merges and the switch', () => {
  const claude = fs.readFileSync(path.join(__dirname, '..', '..', 'CLAUDE.md'), 'utf8');
  assert.ok(!claude.includes('**No pause to merge**'),
    'the sentence that contradicted "before merging anything" is repaired (audit C1)');
  assert.match(claude, /every\s+merge still asks the switch/, 'and says what it always meant');
  const doctrine = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DOCTRINE.md'), 'utf8');
  assert.match(doctrine, /### 6\.17 /, 'the three decisions have one citable home');
  for (const d of ['D1', 'D2', 'D3', '86bbu2uhq']) {
    assert.ok(doctrine.includes(d), `§6.17 records ${d}`);
  }
});
