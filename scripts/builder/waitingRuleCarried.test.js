'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'LOOP_ENGINEERING.md');
const SKILLS = ['loop-build', 'loop-review', 'loop-spec']
  .map((s) => path.join(ROOT, '.claude', 'skills', s, 'SKILL.md'));
const CLI = path.join(ROOT, 'scripts', 'clickup_direct.mjs');

/**
 * The rule has to be WHERE THE AGENT IS LOOKING, not only in the module that
 * implements it (task 86bbk34x7, acceptance criterion 6).
 *
 * A command nobody is told to run is a command nobody runs, and this one only
 * pays off at the moment an agent is about to state that something needs Dane
 * — which is a moment in a skill file, not in a library. The 2026-08-23
 * failures were both agents that would have been correct if they had run one
 * command; nothing told them to.
 *
 * So: pin the mention. Cheap, and it fails the day someone rewrites a skill
 * and drops the line — which is exactly how a written-down step goes quiet
 * (the `pr-opened` step was in loop-build the whole time it was being skipped).
 */

const read = (p) => fs.readFileSync(p, 'utf8');

test('LOOP_ENGINEERING.md carries the rule and the command', () => {
  const doc = read(DOC);
  assert.match(doc, /npm run clickup -- waiting/, 'the doc must name the command');
  assert.match(doc, /waiting on you without running `waiting` first/i, 'the doc must state the rule as a rule');
});

test('all three loop skills tell the agent to run it', () => {
  for (const p of SKILLS) {
    const s = read(p);
    assert.match(s, /npm run clickup -- waiting/, `${path.basename(path.dirname(p))} must name the command`);
    assert.match(
      s,
      /Never say something is waiting on Dane without checking/,
      `${path.basename(path.dirname(p))} must carry the rule heading`,
    );
  }
});

test('the command actually exists in the CLI the docs point at', () => {
  // A doc that names a command the script does not have is worse than no doc:
  // the agent runs it, gets the usage text, and learns the instruction is
  // decorative.
  const cli = read(CLI);
  assert.match(cli, /cmd === 'waiting'/, 'clickup_direct.mjs must implement `waiting`');
  assert.match(cli, /console\.error\('  waiting \[--task <id>\]/, 'and list it in its own usage');
});

test('`ask` carries the guard that stops a second ask', () => {
  const cli = read(CLI);
  assert.match(cli, /operatorSpokeLast\(/, '`ask` must consult the same rule `waiting` uses');
  assert.match(cli, /--after-his-answer/, 'and offer the on-the-record override');
});
