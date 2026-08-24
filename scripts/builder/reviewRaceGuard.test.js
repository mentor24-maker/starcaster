'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'clickup_direct.mjs');
const source = fs.readFileSync(SCRIPT, 'utf8');

/**
 * Two review passes, one ticket (task 86bbjk5rw). On 2026-08-22 two
 * loop-review sessions verified PR #362 end to end at the same time — neither
 * could see the other, because a review in flight left no trace anywhere — and
 * the slower one then wrote "Ready to launch" over the faster one's FAIL
 * verdict AND over a fresh Building claim, from a queue snapshot ~25 minutes
 * stale. Two rules came out of it, and this file is what keeps them:
 *
 *   1. A verdict write is refused when the ticket moved underneath the review.
 *   2. A review in flight is visible from the one command the next pass runs.
 *
 * Source-level, not behavioral: `clickup_direct.mjs` needs CLICKUP_API_TOKEN
 * (Doppler-supplied, DOCTRINE 4.1) for anything past its guards, so a
 * subprocess test cannot run in CI. Same reasoning and same pattern as
 * clickupUrgentGuard.test.js. Both rules WERE driven for real against scratch
 * ticket 86bbgm68r — refused with a stale status (exit 3, nothing written),
 * refused with the flag missing (exit 2, nothing written), and allowed with a
 * matching status (the comment count moved 11 -> 12 only on that last one).
 * The transcript is in the PR body; it cannot be replayed without a live
 * token, which is exactly why this file exists.
 */

/** Executable source only: comments explain the rule and must not trip it. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = withoutComments(source);
const verdictBlock = code.slice(code.indexOf("cmd === 'verdict'"), code.indexOf("cmd === 'describe'"));

test('a verdict cannot be written without saying which status it was claimed under', () => {
  assert.match(verdictBlock, /arg\('if-status'\)/, 'verdict must read --if-status');
  assert.match(verdictBlock, /!ifStatus && !flag\('no-guard'\)/,
    'a missing --if-status must stop the command unless --no-guard is passed on the record');
  assert.match(verdictBlock, /process\.exit\(2\)/);
});

test('a verdict against a ticket that moved is refused with exit 3', () => {
  assert.match(verdictBlock, /was\.toLowerCase\(\) !== ifStatus\.toLowerCase\(\)/,
    'the guard must compare the ticket\'s CURRENT status with the claimed one');
  assert.match(verdictBlock, /process\.exit\(3\)/,
    'exit 3 is this script\'s "someone got there first" code — the same one `status --if-status` uses');
});

test('the refusal tells the reviewer what to do next: re-read, then stand down', () => {
  const refusal = verdictBlock.slice(verdictBlock.indexOf('NOTHING WRITTEN'));
  assert.match(refusal, /Stand down/i, 'a refusal that does not say what to do next gets retried blind');
  assert.match(refusal, /comments --task/, 'it must name the re-read command');
});

test('both guards run BEFORE the comment is posted — a refusal writes nothing', () => {
  const missingFlag = verdictBlock.search(/!ifStatus && !flag\('no-guard'\)/);
  const statusGuard = verdictBlock.search(/was\.toLowerCase\(\) !== ifStatus\.toLowerCase\(\)/);
  const post = verdictBlock.indexOf("call('POST'");
  assert.ok(missingFlag > -1 && statusGuard > -1 && post > -1, 'both guards and the POST must exist');
  assert.ok(missingFlag < post, 'the missing-flag guard must run before the verdict is posted');
  assert.ok(statusGuard < post, 'the moved-ticket guard must run before the verdict is posted');
});

test('a review in flight is visible from `queue` and from `get`', () => {
  // The claim is only worth stamping if the next pass can SEE it without
  // knowing to go looking — one command, the one it already runs.
  assert.match(code, /function loopNoteOf\(/, 'one reader for the Loop note field, resolved by name');
  const queueBlock = code.slice(code.indexOf("cmd === 'queue'"), code.indexOf("cmd === 'get'"));
  const getBlock = code.slice(code.indexOf("cmd === 'get'"), code.indexOf("cmd === 'comments'"));
  assert.match(queueBlock, /loopNoteOf\(t\)/, 'the queue listing must carry the Loop note');
  assert.match(getBlock, /loopNoteOf\(t\)/, 'get must print the Loop note');
});

test('the Loop note column is LAST, so the six existing columns keep their positions', () => {
  const queueBlock = code.slice(code.indexOf("cmd === 'queue'"), code.indexOf("cmd === 'get'"));
  const line = queueBlock.slice(queueBlock.indexOf('console.log(['), queueBlock.indexOf(".join('\\t')"));
  assert.ok(line.indexOf('t.name') < line.indexOf('loopNoteOf(t)'),
    'the note goes after the name; anything reading columns 1-6 must keep working');
});

test('the review claim is stamped with a dated clock, not a bare time of day', () => {
  assert.match(code, /function nowDateClock\(/);
  assert.match(code, /transition === 'review-started' \? nowDateClock\(\)/,
    'a claim whose age cannot be judged a day later either deadlocks the ticket or gets ignored');
});
