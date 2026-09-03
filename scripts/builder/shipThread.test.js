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
  // authoritative check is the separate `gh pr view ... --json state` read
  // immediately after, which must still exist and must still fail() the
  // script when the state is not MERGED — that is what keeps criterion 3
  // (a genuine failure still exits non-zero) true.
  const mergeCallMatch = code.match(/'gh',\s*\[\s*'pr',\s*'merge',[^)]*\)/);
  assert.ok(mergeCallMatch, 'must find the gh pr merge call');
  assert.match(mergeCallMatch[0], /allowFail:\s*true/, 'gh\'s own cosmetic exit code must not stop the script');

  const afterMerge = code.slice(code.indexOf(mergeCallMatch[0]));
  assert.match(afterMerge, /json',\s*'state'/, 'must independently re-read the PR state after merging');
  assert.match(afterMerge, /merged\.out\s*!==\s*'MERGED'/, 'must compare against MERGED specifically');
  assert.match(afterMerge.slice(0, afterMerge.indexOf("merged.out !== 'MERGED'") + 200), /fail\(/, 'a state other than MERGED must still call fail()');
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

test('a failed nudge says WHICH step failed, because the advice is opposite', () => {
  // `nudgeChecks` returns false for two different situations. If the commit
  // failed, the branch really does need a new one. If the commit SUCCEEDED and
  // only the push failed, the commit is sitting on the branch locally and an
  // ordinary `git push` sends it. One message served both, and in the push case
  // it told the operator "re-running ship will NOT help" — the exact opposite
  // of the truth, in a script whose whole purpose is making these messages true.
  assert.match(source, /nudgeFailedAt/, 'the failing step has to be recorded somewhere');

  const nudge = source.slice(source.indexOf('function nudgeChecks'));
  const body = nudge.slice(0, nudge.indexOf('\n}\n'));
  assert.match(body, /nudgeFailedAt = 'commit'/, 'a failed commit is recorded as such');
  assert.match(body, /nudgeFailedAt = 'push'/, 'a failed push is recorded as such');

  const neverAppeared = source.slice(source.indexOf("outcome === 'never_appeared'"));
  const message = neverAppeared.slice(0, 1800);
  assert.match(message, /nudgeFailedAt === 'push'/, 'the message must branch on which step failed');

  // The push case must offer the recovery, not forbid it.
  const pushBranch = message.slice(message.indexOf("nudgeFailedAt === 'push'"));
  const pushCase = pushBranch.slice(0, pushBranch.indexOf(': `No checks ever appeared'));
  assert.match(pushCase, /git push/, 'the push case names the command that recovers it');
  assert.doesNotMatch(
    pushCase,
    /will NOT help/,
    'the push case must not repeat the commit-failed advice — re-running ship DOES help here'
  );
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
