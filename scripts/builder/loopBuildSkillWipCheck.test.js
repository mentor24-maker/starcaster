'use strict';

// SC-807 send-back: the runner only asks the work-in-progress cap inside its
// work check, and it skips the work check on the first pass after a restart and
// on the forced idle pass every IDLE_PASS_EVERY. Those passes start Claude on
// the loop-build skill, so the skill itself must ask `wip-check` after
// `pass-reconcile` and before it reads the queue or claims, as Spirality's
// skill does (SP-238). Without it a full cap is ignored on every restart.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL = path.join(__dirname, '..', '..', '.claude', 'skills', 'loop-build', 'SKILL.md');
const text = fs.readFileSync(SKILL, 'utf8');

/** The first ```bash block under "1. **Claim the next task.**" in the Workflow. */
function claimBlock() {
  const start = text.indexOf('1. **Claim the next task.**');
  assert.ok(start >= 0, 'the Workflow has no "Claim the next task" step');
  const open = text.indexOf('```bash', start);
  const close = text.indexOf('```', open + 7);
  assert.ok(open > start && close > open, 'the claim step has no bash block');
  return text.slice(open, close);
}

test('the claim step runs wip-check after pass-reconcile and before the queue and the claim', () => {
  const block = claimBlock();
  const at = (cmd) => block.indexOf(`npm run clickup -- ${cmd}`);
  assert.ok(at('wip-check') >= 0, 'the claim step never asks wip-check');
  assert.ok(at('pass-reconcile') >= 0 && at('pass-reconcile') < at('wip-check'),
    'wip-check must come after pass-reconcile, so a ticket handed back is not counted');
  assert.ok(at('wip-check') < at('queue --claimable'), 'wip-check must come before the queue is read');
  assert.ok(at('wip-check') < at('claim --task'), 'wip-check must come before the claim');
});

test('the skill says what a full cap means: claim nothing, report WIP CAP REACHED', () => {
  assert.match(text, /## Then: is there room for another ticket\?/);
  assert.match(text, /\*\*3\*\*, `full: [^`]*`: claim nothing/);
  assert.match(text, /`WIP CAP REACHED: <the full: line>`/);
});
