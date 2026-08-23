'use strict';

/**
 * docs/WORK-LOG.md is merged with git's `union` driver (.gitattributes, #386).
 *
 * That driver exists because every loop-built PR prepends one dated entry to
 * the top of this one file, so any two branches open at once collide there and
 * both entries are always keepers. Union keeps both sides instead of writing
 * conflict markers, which is exactly right for entries that were ADDED.
 *
 * It is NOT right for a line that was EDITED. Union has no way to know that
 * "…(#PR)" and "…(#368)" are the same heading corrected, so it keeps both and
 * leaves a stray heading with no body under it. That happened the first time
 * the driver ran a real merge (2026-08-22), and nothing would have caught it:
 * a duplicated heading is valid markdown, it renders, and no gate reads this
 * file. Left alone it accretes silently, one stray per corrected entry.
 *
 * So the driver comes with this guard. It is a TEST rather than a
 * check_conventions rule on purpose — that script runs continue-on-error in CI,
 * so a rule folded into it could never turn the build red (the same reasoning
 * check_model_ids.cjs and check_machine_paths.cjs are split out for).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORK_LOG = path.join(__dirname, '..', '..', 'docs', 'WORK-LOG.md');
const HEADING = /^## /;

function headings(text) {
  return text.split('\n')
    .map((line, i) => ({ line, number: i + 1 }))
    .filter((l) => HEADING.test(l.line));
}

test('no work-log entry heading is duplicated', () => {
  const seen = new Map();
  const dupes = [];
  for (const { line, number } of headings(fs.readFileSync(WORK_LOG, 'utf8'))) {
    if (seen.has(line)) dupes.push(`line ${number} repeats line ${seen.get(line)}: ${line}`);
    else seen.set(line, number);
  }
  assert.deepEqual(dupes, [], `docs/WORK-LOG.md has repeated entry heading(s):\n  ${dupes.join('\n  ')}`);
});

test('every work-log heading has a body under it', () => {
  // The shape a union merge leaves behind when one side corrected a heading:
  // two headings back to back, the first one orphaned from its text.
  const lines = fs.readFileSync(WORK_LOG, 'utf8').split('\n');
  const orphans = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!HEADING.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    if (j < lines.length && HEADING.test(lines[j])) {
      orphans.push(`line ${i + 1} has no body before the next heading: ${lines[i]}`);
    }
  }
  assert.deepEqual(orphans, [], `docs/WORK-LOG.md has heading(s) with no entry under them:\n  ${orphans.join('\n  ')}`);
});

test('no entry still carries the "(#PR)" placeholder', () => {
  // loop-build writes its entry before the PR exists, so the number is filled
  // in afterwards. One that ships unfilled is a broken link in the only record
  // written for a non-programmer to read.
  const left = headings(fs.readFileSync(WORK_LOG, 'utf8'))
    .filter(({ line }) => line.includes('(#PR)'))
    .map(({ line, number }) => `line ${number}: ${line}`);
  assert.deepEqual(left, [], `work-log entries still carry an unfilled PR number:\n  ${left.join('\n  ')}`);
});
