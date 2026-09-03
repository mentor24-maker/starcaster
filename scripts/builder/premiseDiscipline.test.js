'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

// ---------------------------------------------------------------------------
// Premise discipline (2026-09-02, task 86bbtujfj — audit Phase 6). The rules
// are prose in three skills; these tripwires are what keeps prose from
// eroding, the same pattern the pass-marker and preflight rules use.
// ---------------------------------------------------------------------------

test('the spec lane demands the mechanism, and downgrades a suspicion to a question', () => {
  const spec = read('.claude/skills/loop-spec/SKILL.md');
  assert.match(spec, /## Evidence, or it is a question/);
  assert.match(spec, /not the log line that prompted the/,
    'the distinction that produced 4-of-5 wrong premises on 2026-09-02');
  assert.match(spec, /file it as a QUESTION/, 'the downgrade path exists');
  assert.match(spec, /names its measurement|says plainly \*"not measured"\*/,
    'a threshold carries what it was measured against, or admits it was not');
  assert.match(spec, /four had a materially wrong premise/, 'the incident is the WHY, recorded');
});

test('the build lane treats a defect ticket as a claim to verify', () => {
  const build = read('.claude/skills/loop-build/SKILL.md');
  assert.match(build, /VERIFY THE PREMISE BEFORE BUILDING IT/);
  assert.match(build, /post the correction on the ticket FIRST, then\n\s+build what is true/,
    'correct-then-build, never silently either way');
  assert.match(build, /claim to\n\s+verify, not a specification to obey/);
});

test('the review lane is the rule\'s reader', () => {
  const review = read('.claude/skills/loop-review/SKILL.md');
  assert.match(review, /## A defect ticket's premise is part of the review/);
  assert.match(review, /send back/i, 'a missing premise trail is send-back material');
  assert.match(review, /correction comment posted before the build/,
    'the trail that separates "built what is true" from "built what was written"');
  assert.match(review, /even when the code is good/,
    'a ticket left asserting the wrong mechanism misleads its next reader — that alone sends back');
});

test('all three lanes cite the same task, so the rule has one root', () => {
  for (const f of ['loop-spec', 'loop-build', 'loop-review']) {
    assert.match(read(`.claude/skills/${f}/SKILL.md`), /86bbtujfj/,
      `${f} must trace the discipline to its incident and decision record`);
  }
});
