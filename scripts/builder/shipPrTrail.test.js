'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ticketUrl, decideTrailWrite, bodyWithTicketLink, describeTrailResult,
} = require('./shipPrTrail.js');
const { prTrailLanded, prOpenedComment } = require('./loopTrail.js');
const { bodyNamesTicket } = require('./clickupTicketLink.js');

/**
 * The rules `npm run ship` follows about a ticket's PR trail (task 86bbq7z1k).
 *
 * Everything around them in `ship` needs a remote, an open PR and a live CI run
 * to exercise, so these are the only assertions that can actually run — which
 * is why the decision logic was pulled out of the script and into a pure module
 * in the first place.
 */

/* ---------------------------------------------- criterion 1: it writes at all */

test('a stamped branch with a PR number is told to record the trail', () => {
  const decision = decideTrailWrite({ taskId: '86bbq7z1k', prNumber: 512 });
  assert.equal(decision.write, true);
  assert.equal(decision.taskId, '86bbq7z1k');
  assert.equal(decision.prNumber, 512);
  assert.equal(decision.url, 'https://app.clickup.com/t/86bbq7z1k');
});

test('the PR number survives as a number even when git hands it over as text', () => {
  // `gh pr list --jq` and the `/pull/(\d+)` match both produce strings, and
  // prTrailLanded compares with Number() — so a string that never gets coerced
  // would still work there but reads back wrong everywhere else.
  const decision = decideTrailWrite({ taskId: '86bbq7z1k', prNumber: '512' });
  assert.equal(decision.write, true);
  assert.equal(decision.prNumber, 512);
});

test('the URL this module writes is the one the ticket-link matcher accepts', () => {
  // The two used to disagree once already (task 86bbmmv7t, finding 2), which
  // is the whole reason clickupTicketLink exists. Assert the agreement rather
  // than assuming it.
  assert.equal(bodyNamesTicket(`ClickUp: ${ticketUrl('86bbq7z1k')}`, '86bbq7z1k', ''), true);
});

/* -------------------------------------- criterion 3: no stamp is not a failure */

test('an unstamped branch is not told to write, and says why it will matter', () => {
  for (const taskId of ['', null, undefined, '   ']) {
    const decision = decideTrailWrite({ taskId, prNumber: 512 });
    assert.equal(decision.write, false, `"${taskId}" must not be treated as a ticket`);
    assert.equal(decision.reason, 'no-stamp');
    assert.match(decision.message, /no "PR opened:" line was written/);
    assert.match(decision.message, /branch protection is\nenforcing/,
      'must name the consequence — a silent skip reads exactly like a success');
    assert.match(decision.message, /clickup -- pr-opened/, 'must name the repair command');
  }
});

test('a missing or malformed PR number is refused rather than sent to ClickUp', () => {
  for (const prNumber of ['', null, undefined, 'abc', '12a']) {
    const decision = decideTrailWrite({ taskId: '86bbq7z1k', prNumber });
    assert.equal(decision.write, false, `"${prNumber}" must not be sent as a PR number`);
    assert.equal(decision.reason, 'no-pr');
  }
});

/* ------------------------- criterion 1 + 2: the PR body's half of the trail */

test('a body with no ticket link gains one', () => {
  const out = bodyWithTicketLink('Summary of the change.', '86bbq7z1k');
  assert.match(out, /^Summary of the change\.\n\nClickUp: https:\/\/app\.clickup\.com\/t\/86bbq7z1k\n$/);
  assert.equal(bodyNamesTicket(out, '86bbq7z1k', ''), true);
});

test('a body that already links the ticket is returned untouched — no second copy', () => {
  const already = 'Summary.\n\nClickUp: https://app.clickup.com/t/86bbq7z1k\n';
  assert.equal(bodyWithTicketLink(already, '86bbq7z1k'), already);
  const links = already.match(/app\.clickup\.com/g) || [];
  assert.equal(links.length, 1);
});

test("ClickUp's own copy-link shape counts as already linked", () => {
  // `t/<workspace>/<id>` is what the ClickUp UI's copy button produces; the
  // matcher accepts it, so appending a second line would be a duplicate.
  const already = 'Summary.\n\nhttps://app.clickup.com/t/9012345/86bbq7z1k';
  assert.equal(bodyWithTicketLink(already, '86bbq7z1k'), already);
});

test('a body linking some OTHER ticket still gains this one', () => {
  const out = bodyWithTicketLink('Follows https://app.clickup.com/t/86bbjt18r', '86bbq7z1k');
  assert.equal(bodyNamesTicket(out, '86bbq7z1k', ''), true);
  assert.equal(bodyNamesTicket(out, '86bbjt18r', ''), true);
});

test('with no ticket, the body is left exactly as it was', () => {
  assert.equal(bodyWithTicketLink('Summary.', ''), 'Summary.');
  assert.equal(bodyWithTicketLink('Summary.', null), 'Summary.');
});

test('an empty body becomes the link alone, with no leading blank lines', () => {
  assert.equal(bodyWithTicketLink('', '86bbq7z1k'), 'ClickUp: https://app.clickup.com/t/86bbq7z1k\n');
});

/* ------------------- criterion 2: idempotence is asked of the consumer's reader */

test('the comment ship asks for is the shape the merge step reads back', () => {
  // The end-to-end property, at the one seam a unit test can reach: the line
  // pr-opened posts for this PR is the line prTrailLanded finds for it.
  const comments = [{ id: '1', date: '2', comment_text: prOpenedComment(`https://github.com/mentor24-maker/starcaster/pull/512`) }];
  assert.equal(prTrailLanded(comments, 512).ok, true);
  // And a trail pointing at a DIFFERENT PR is not this PR's trail, so
  // `--if-missing` must not read it as "already recorded".
  assert.equal(prTrailLanded(comments, 513).ok, false);
});

/* ------------------------ criterion 4: a failed write is loud, never a stopper */

test('a successful record is quiet', () => {
  const told = describeTrailResult({ taskId: '86bbq7z1k', prNumber: 512, code: 0, output: 'recorded' });
  assert.equal(told.ok, true);
  assert.equal(told.loud, false);
});

test('exit 4 gets the fix-the-body advice, not the try-again advice', () => {
  const told = describeTrailResult({ taskId: '86bbq7z1k', prNumber: 512, code: 4, output: '' });
  assert.equal(told.ok, false);
  assert.equal(told.loud, true);
  assert.match(told.message, /no link back to/);
  assert.match(told.message, /ClickUp: https:\/\/app\.clickup\.com\/t\/86bbq7z1k/,
    'must give the exact line to add to the PR body');
  assert.match(told.message, /The ship itself is unaffected/);
});

test('any other failure is loud, names the ticket and the PR, and gives the repair', () => {
  for (const code of [1, 2, 7, null]) {
    const told = describeTrailResult({ taskId: '86bbq7z1k', prNumber: 512, code, output: 'network is down' });
    assert.equal(told.ok, false, `exit ${code} must not be read as success`);
    assert.equal(told.loud, true);
    assert.match(told.message, /COULD NOT RECORD PR #512 ON TICKET 86bbq7z1k/);
    assert.match(told.message, /npm run clickup -- pr-opened --task 86bbq7z1k --pr 512/);
    assert.match(told.message, /network is down/, 'the underlying output must not be swallowed');
  }
});

/* ------------------------------- the wiring, which only source can testify to */

const SHIP = fs.readFileSync(path.join(__dirname, '..', 'ship_thread.cjs'), 'utf8');
const CLICKUP = fs.readFileSync(path.join(__dirname, '..', 'clickup_direct.mjs'), 'utf8');

test('ship reads the ticket off the branch stamp `npm run thread` writes', () => {
  assert.match(SHIP, /branch\.\$\{branch\}\.clickup-task/,
    'must read the same branch.<name>.clickup-task key thread writes and tidy reads');
});

test('ship actually calls pr-opened, with --if-missing', () => {
  assert.match(SHIP, /'pr-opened'/, 'ship must invoke the pr-opened command');
  assert.match(SHIP, /'--if-missing'/, 'without it, every re-ship posts another identical line');
});

test('ship records the trail BEFORE it merges, so a red check still leaves one', () => {
  const trailAt = SHIP.indexOf("'pr-opened'");
  const mergeAt = SHIP.indexOf("'pr', 'merge'");
  assert.ok(trailAt > 0 && mergeAt > 0, 'both steps must exist');
  assert.ok(trailAt < mergeAt, 'the trail must be written before the merge, not after it');
});

test('the trail step cannot stop the ship', () => {
  // `quiet` never exits on its own; the assertion is that the trail step does
  // not reach for `fail`, which is what every other step does when it stops.
  const stepMatch = /5b\. record the PR on the ticket[\s\S]*?\nif \(DRY\) \{/.exec(SHIP);
  assert.ok(stepMatch, 'must find the trail step');
  assert.doesNotMatch(stepMatch[0], /\bfail\(/, 'a ClickUp failure must never stop a green, mergeable PR');
  assert.doesNotMatch(stepMatch[0], /process\.exit/, 'and must never exit');
});

test('--if-missing decides with the merge step\'s own reader, not a private one', () => {
  const guard = /if \(flag\('if-missing'\)\) \{[\s\S]*?\n  \}/.exec(CLICKUP);
  assert.ok(guard, 'must find the --if-missing preflight');
  assert.match(guard[0], /prTrailLanded\(/,
    'the skip must be decided by prTrailLanded — "is it findable" is the only question that matters');
});

/** The source between `{` at `open` and its matching `}`. */
function blockAt(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

test('the work-log placeholder fill still runs when the comment was skipped', () => {
  // The one state that would otherwise be unreachable: a run that posted the
  // trail and then failed to fill the placeholder. A second run must repair it
  // rather than skip straight past it.
  //
  // Measured by BRACE DEPTH, not by line order. The first version of this test
  // compared indexOf positions, which cannot fail — moving the fill inside the
  // skip leaves it later in the file either way. Break-testing found that; the
  // assertion below is what break-testing then made fail.
  const open = CLICKUP.indexOf('{', CLICKUP.indexOf('if (!alreadyRecorded)'));
  const block = blockAt(CLICKUP, open);
  assert.ok(block, 'must find the alreadyRecorded block');
  assert.match(block, /prOpenedComment\(/, 'the block must be the one that posts the comment');
  assert.doesNotMatch(block, /fillNewestPlaceholder/,
    'the work-log fill must sit OUTSIDE the skip, or a second run cannot repair an unfilled placeholder');
  assert.match(CLICKUP, /fillNewestPlaceholder/, 'and it must still be there at all');
});
