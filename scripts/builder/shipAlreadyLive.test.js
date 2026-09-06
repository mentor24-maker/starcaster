'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { decideAlreadyLive } = require('./shipAlreadyLive');

/**
 * ROUND 3 of task 86bbv35cq. Ship's `queued` and `unknown` endings both told
 * the reader to run `npm run ship` again and it would "see the merge and carry
 * on with the tidy-up". Ship had no such path — it looks for an OPEN pull
 * request, and a merged one is not open — so the rerun opened a SECOND pull
 * request for work already live. Advice naming an action that does not exist,
 * which is the same class as the defect round 1 was sent back for.
 *
 * The property that has to hold: the skip is taken ONLY on two positive
 * readings, and never on a cannot-tell.
 */

test('both signals say yes — this branch is live and only the tidy-up is left', () => {
  const d = decideAlreadyLive({ contentInMain: true, mergedPr: true });
  assert.equal(d.live, true);
  assert.match(d.why, /merged pull request/);
  assert.match(d.why, /already carries/);
});

test('a mid-flight branch is an ordinary ship, and never asks GitHub', () => {
  // The common case, and the one that must cost nothing: the local reading
  // alone settles it, so ship makes no network call for this check at all.
  const d = decideAlreadyLive({ contentInMain: false, mergedPr: null });
  assert.equal(d.live, false);
  assert.match(d.why, /still holds changes main does not have/);
});

test('a merged pull request is NOT enough on its own', () => {
  // GitHub deletes the head branch on merge, so a same-named branch created
  // afterwards still matches `--head` and still finds that merged pull
  // request. Skipping the ship there would silently strand real work.
  const d = decideAlreadyLive({ contentInMain: false, mergedPr: true });
  assert.equal(d.live, false, 'new commits on a reused branch name still ship');
});

test('content-in-main is NOT enough on its own either', () => {
  // A branch can hold nothing unique because it never changed anything, or
  // because somebody else's pull request carried the same change. Neither is
  // "this branch shipped".
  const d = decideAlreadyLive({ contentInMain: true, mergedPr: false });
  assert.equal(d.live, false);
  assert.match(d.why, /no merged pull request/);
});

test('A CANNOT-TELL NEVER AUTHORIZES THE SKIP — from either signal', () => {
  // DOCTRINE 3.2. `branchHasMergedPr` returns null when GitHub could not be
  // reached (offline, unauthenticated, rate-limited) and
  // `branchContentIsInMain` returns null when a git probe failed. Null is not
  // false and is emphatically not true.
  const github = decideAlreadyLive({ contentInMain: true, mergedPr: null });
  assert.equal(github.live, false);
  assert.match(github.why, /cannot-tell/);

  const local = decideAlreadyLive({ contentInMain: null, mergedPr: true });
  assert.equal(local.live, false);
  assert.match(local.why, /could not be read/);

  const neither = decideAlreadyLive({ contentInMain: null, mergedPr: null });
  assert.equal(neither.live, false);

  // And no argument at all is the safe answer, not the exciting one.
  assert.equal(decideAlreadyLive().live, false);
});

test('the skip is unreachable without a true from BOTH', () => {
  // Exhaustive, because this is the one decision that can stop a ship.
  const values = [true, false, null, undefined];
  for (const contentInMain of values) {
    for (const mergedPr of values) {
      const expected = contentInMain === true && mergedPr === true;
      assert.equal(
        decideAlreadyLive({ contentInMain, mergedPr }).live, expected,
        `contentInMain=${contentInMain} mergedPr=${mergedPr}`
      );
    }
  }
});

test('every answer says WHY, so a skip and a non-skip are never told apart by silence', () => {
  const values = [true, false, null];
  for (const contentInMain of values) {
    for (const mergedPr of values) {
      const d = decideAlreadyLive({ contentInMain, mergedPr });
      assert.equal(typeof d.why, 'string');
      assert.ok(d.why.length > 20, `a real sentence, got "${d.why}"`);
    }
  }
});

/* --------------------------------------------------- ship, at source level */

function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const shipCode = withoutComments(
  fs.readFileSync(path.join(__dirname, '..', 'ship_thread.cjs'), 'utf8'));

test('ship asks this BEFORE it catches up, rebuilds or pushes', () => {
  // Order is the whole point. Every one of those steps is wrong on a branch
  // already in main, and the push would re-create the head branch GitHub
  // deleted when it merged.
  const decision = shipCode.indexOf('decideAlreadyLive(');
  assert.ok(decision > 0, 'ship asks the shared decision');

  const catchUp = shipCode.indexOf("heading('Catching up with the live branch')");
  const push = shipCode.indexOf("heading('Sending it to GitHub')");
  const pr = shipCode.indexOf("heading('Pull request')");
  assert.ok(catchUp > decision, 'the catch-up comes after');
  assert.ok(push > decision, 'the push comes after');
  assert.ok(pr > decision, 'and so does opening a pull request');
});

test('ship uses the shared repo-state probes, not a second opinion of its own', () => {
  // `map` and `tidy` already answer "is this branch's work on main"; a third
  // answer in ship is how one of them quietly stops matching.
  assert.match(shipCode, /require\('\.\/lib\/repo_state\.cjs'\)/);
  assert.match(shipCode, /branchContentIsInMain\(/);
  assert.match(shipCode, /branchHasMergedPr\(/);
});

test('the already-live path cleans up and stops — it never opens anything', () => {
  const start = shipCode.indexOf('if (alreadyLive.live)');
  assert.ok(start > 0, 'there is an already-live branch of the script');
  const block = shipCode.slice(start, shipCode.indexOf("heading('Catching up with the live branch')"));
  assert.match(block, /tidyUp\(\)/, 'it finishes the tidy-up');
  assert.match(block, /process\.exit\(0\)/, 'and stops cleanly rather than failing');
  assert.doesNotMatch(block, /pr['"], ['"]create/, 'it never opens a pull request');
});

test('a dry run on an already-live branch changes nothing', () => {
  const start = shipCode.indexOf('if (alreadyLive.live)');
  const block = shipCode.slice(start, shipCode.indexOf("heading('Catching up with the live branch')"));
  const dry = block.indexOf('if (DRY)');
  const tidy = block.indexOf('tidyUp()');
  assert.ok(dry > 0 && dry < tidy, 'the dry-run exit comes before the tidy-up, or a rehearsal deletes branches');
});

test('there is ONE tidy-up sequence, shared by both callers', () => {
  assert.match(shipCode, /function tidyUp\(\)/);
  assert.equal((shipCode.match(/run\('npm', \['run', 'tidy'\]/g) || []).length, 1,
    'the cleanup sequence is written once');
  assert.ok((shipCode.match(/tidyUp\(\)/g) || []).length >= 3, 'and called from both endings');
});

/* ------------------------------- ROUND 4: a branch that changed nothing */

test('ROUND 4: a branch that touched no files is never "already live"', () => {
  // `branchContentIsInMain` answers true for a branch that changed no files —
  // right for its own question, and `npm run tidy` relies on it. Composed
  // here it made a THIRD way to reach `live` on no evidence: GitHub deletes
  // the head branch on merge, so a freshly made branch reusing a topic name
  // whose earlier pull request merged scores true on BOTH signals.
  const empty = decideAlreadyLive({ contentInMain: true, mergedPr: true, touchedFiles: false });
  assert.equal(empty.live, false, 'two yeses on no evidence is still no evidence');
  assert.match(empty.why, /not changed a single file/);
});

test('ROUND 4: the emptiness veto does not disturb either real answer', () => {
  // It is only ever a veto. A branch that DID touch files decides exactly as
  // it did before, and the default keeps any caller that does not pass it
  // reading the same way.
  assert.equal(decideAlreadyLive({ contentInMain: true, mergedPr: true, touchedFiles: true }).live, true);
  assert.equal(decideAlreadyLive({ contentInMain: true, mergedPr: true }).live, true);
  assert.equal(decideAlreadyLive({ contentInMain: false, mergedPr: true, touchedFiles: true }).live, false);

  // A cannot-tell from the probe never authorizes the skip and never blocks a
  // decision the other two signals can make on their own (DOCTRINE 3.2).
  assert.equal(decideAlreadyLive({ contentInMain: true, mergedPr: true, touchedFiles: null }).live, true);
  assert.equal(decideAlreadyLive({ contentInMain: true, mergedPr: null, touchedFiles: false }).live, false);
});

test('ROUND 4: ship asks that question, and only where it can change the answer', () => {
  // The probe is a second pair of git calls, so it runs only on the rare path
  // where the free local reading already said yes — an ordinary mid-flight
  // ship still pays nothing for any of this.
  assert.match(shipCode, /branchTouchedFiles\(/, 'ship takes the reading');
  const step0 = shipCode.slice(shipCode.indexOf('const alreadyLive = '), shipCode.indexOf('if (alreadyLive.live)'));
  assert.match(step0, /if \(contentInMain !== true\) return decideAlreadyLive/,
    'the free local reading still short-circuits first');
  assert.ok(
    step0.indexOf('branchTouchedFiles(') > step0.indexOf('contentInMain !== true'),
    'the extra probe is taken after that short-circuit, not before it'
  );
  assert.match(step0, /touchedFiles/, 'and the answer reaches the decision');
});
