'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBuildStart, describeBuildStart } = require('./buildStart.js');

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
const knows = (map) => (n) => (Object.prototype.hasOwnProperty.call(map, n) ? map[n] : { state: 'MISSING' });

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
