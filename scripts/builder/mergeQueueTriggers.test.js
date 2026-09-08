'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The merge queue's two trigger decisions, pinned (2026-09-04, task 86bbv1qp9).
 *
 * WHY A TEST AND NOT A COMMENT. Both decisions fail SILENTLY and in opposite
 * directions, and neither shows up as a red check on anybody's pull request:
 *
 *   - `ci.yml` losing `merge_group:` stops every queued merge forever. The
 *     queue waits for `verify` to report on the merge-group ref; nothing
 *     starts, nothing fails, and each individual PR still shows a full row of
 *     green ticks from its own `pull_request` run. The merge lane goes from
 *     slow to dead and the board looks perfect.
 *   - `review-gate.yml` GAINING `merge_group:` makes it run with an empty
 *     `github.event.pull_request.number`, so it asks its question about no
 *     pull request at all. A gate answering about nothing is worse than an
 *     absent one, because it reports.
 *
 * These are read out of the workflow YAML as text on purpose: the files are
 * consumed by GitHub, not by any code in this repo, so nothing else here would
 * ever notice them changing.
 */

const WORKFLOWS = path.join(__dirname, '..', '..', '.github', 'workflows');

const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');

/** The `on:` block only — so a `merge_group` mentioned in a COMMENT further
 *  down the file cannot be mistaken for a live trigger. That is the exact way
 *  this test could pass while being wrong: review-gate.yml carries a long
 *  comment about merge_group, and a naive substring search over the whole file
 *  would find it and call the trigger present. */
function triggerBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(start > -1, 'the workflow must have a block-style `on:` section');
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    // The block ends at the next top-level key (a non-indented, non-comment,
    // non-blank line).
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    if (line.trim().startsWith('#')) continue;
    out.push(line);
  }
  return out.join('\n');
}

test('CI listens for merge_group, or the queue waits forever for a check that never runs', () => {
  const on = triggerBlock(read('ci.yml'));
  assert.match(on, /^\s+merge_group:/m,
    'ci.yml must trigger on merge_group — without it every queued merge hangs, silently, '
    + 'while each pull request still shows green');
});

test('CI still runs on pull requests and on main — the queue trigger is an ADDITION', () => {
  // The failure this catches: "moved to merge_group" rather than "also runs on
  // merge_group". A PR would then get no CI at all, and could not even enter a
  // queue, because entering requires the merge checks to have passed.
  const on = triggerBlock(read('ci.yml'));
  assert.match(on, /^\s+pull_request:/m, 'pull-request CI must survive');
  assert.match(on, /^\s+push:/m, 'push-to-main CI must survive');
  assert.match(on, /branches:\s*\[main\]/, 'and it must still be main it watches');
});

test('review-gate does NOT listen for merge_group — it has no PR to ask about', () => {
  const text = read('review-gate.yml');
  const on = triggerBlock(text);
  assert.doesNotMatch(on, /^\s+merge_group:/m,
    'review-gate reads github.event.pull_request.number, which a merge_group event does not carry — '
    + 'adding the trigger makes it answer about no pull request at all');

  // The control on this test: prove the gate really is PR-shaped, so that the
  // assertion above is protecting something real rather than passing because
  // the file happens not to say a word. If this gate is ever rewritten to ask
  // about commits instead, this line fails and the decision gets re-made
  // deliberately rather than inherited.
  assert.match(text, /github\.event\.pull_request\.number/,
    'if review-gate no longer asks about a PR number, the reason it is excluded from the queue has changed');
});

test('the decision is written down where the next reader will be', () => {
  // A rule with no reason gets "tidied up" by the next person who sees an
  // asymmetry between two workflow files and assumes it is an oversight.
  // That is precisely what this pair looks like at a glance.
  assert.match(read('ci.yml'), /merge queue does not test the pull request branch/i,
    'ci.yml must say WHY the trigger is there');
  assert.match(read('review-gate.yml'), /deliberately no `merge_group:` here/i,
    'review-gate.yml must say why it is absent, or the asymmetry reads as a mistake');
});
