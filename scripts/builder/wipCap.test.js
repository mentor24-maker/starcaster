'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_WIP_CAP,
  CAP_ENV,
  resolveCap,
  countOpenPrs,
  wipDecision,
  undeterminedDecision,
} = require('./wipCap');

/**
 * Task 86bbk2fkp. Branch protection is strict:true, so every merge invalidates
 * every other open branch — the catch-up cost is quadratic in the number of
 * open PRs. With 24 open, one merge dated 23 branches.
 *
 * The danger in a feature like this is not that it caps too little. It is that
 * it becomes a quiet way for the loop to STOP WORKING — so the tests that
 * matter most are the ones proving it still claims when it should, and that a
 * capped pass leaves the queue untouched rather than half-stamped.
 */

const open = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, state: 'OPEN' }));

// ── The decision ─────────────────────────────────────────────────────────

test('at or above the cap it declines, and says the count, the cap and why', () => {
  const out = wipDecision({ prs: open(21), cap: 5 });
  assert.equal(out.claim, false);
  assert.equal(out.code, 3, 'a normal decline, the same shape as node:owns');
  assert.equal(out.openCount, 21);
  assert.match(out.message, /21 PR\(s\) open/);
  assert.match(out.message, /cap 5/);
  assert.match(out.message, /merge side is the bottleneck/);
  assert.match(out.message, /not a failure/, 'it must not read as an error');
});

test('exactly AT the cap declines — the boundary, not one past it', () => {
  assert.equal(wipDecision({ prs: open(5), cap: 5 }).claim, false);
  assert.equal(wipDecision({ prs: open(4), cap: 5 }).claim, true);
});

test('below the cap it behaves exactly as before', () => {
  // The test that matters most: this must never become a silent way for the
  // loop to stop working.
  const out = wipDecision({ prs: open(2), cap: 5 });
  assert.equal(out.claim, true);
  assert.equal(out.code, 0);
  assert.match(out.message, /room to claim/);
});

test('an empty repo claims', () => {
  assert.equal(wipDecision({ prs: [], cap: 5 }).claim, true);
  assert.equal(wipDecision({ cap: 5 }).claim, true);
  assert.equal(wipDecision({ prs: null, cap: 5 }).claim, true);
});

// ── Counting ─────────────────────────────────────────────────────────────

test('only OPEN pull requests count', () => {
  // Miscounting here silently halves or doubles the effective cap.
  const mixed = [
    { number: 1, state: 'OPEN' },
    { number: 2, state: 'MERGED' },
    { number: 3, state: 'CLOSED' },
    { number: 4, state: 'open' },
  ];
  assert.equal(countOpenPrs(mixed), 2);
  assert.equal(wipDecision({ prs: mixed, cap: 3 }).claim, true, '2 open is under a cap of 3');
});

test('a PR with no state is assumed open, not assumed gone', () => {
  // `gh pr list --state open` omits it. Treating an unlabelled row as closed
  // would undercount and let the cap drift upward unnoticed.
  assert.equal(countOpenPrs([{ number: 1 }, { number: 2 }]), 2);
});

test('malformed input does not throw', () => {
  assert.equal(countOpenPrs(null), 0);
  assert.equal(countOpenPrs('nonsense'), 0);
  assert.equal(countOpenPrs([null, undefined, {}]), 1);
});

// ── The cap itself ───────────────────────────────────────────────────────

test('the cap is a named constant, overridable by env', () => {
  assert.equal(DEFAULT_WIP_CAP, 5);
  assert.equal(resolveCap({}), 5);
  assert.equal(resolveCap({ [CAP_ENV]: '12' }), 12);
  assert.equal(resolveCap({ [CAP_ENV]: '0' }), 0, 'zero is a legitimate "stop building"');
});

test('a malformed override is IGNORED, not obeyed', () => {
  // A typo in an env var must not silently switch the loop off, and must not
  // silently switch the cap off either.
  for (const bad of ['abc', '-3', '2.5', '', '   ', 'null']) {
    assert.equal(resolveCap({ [CAP_ENV]: bad }), DEFAULT_WIP_CAP, `"${bad}" should fall back`);
  }
});

// ── Failing open, deliberately, and loudly ───────────────────────────────

test('an uncountable pass proceeds, but says it is unbounded', () => {
  // This is the ONE place that differs from node:owns. That guard protects a
  // check-then-act claim, where guessing wrong means two machines building the
  // same ticket — a correctness problem, so it must refuse. This is a
  // throughput optimisation: guessing wrong costs churn, refusing on a
  // transient gh failure would stop all work.
  const out = undeterminedDecision('gh exited 1');
  assert.equal(out.claim, true, 'a transient failure must not stop all work');
  assert.equal(out.code, 1, 'and must not be reported as a clean pass either');
  assert.match(out.message, /NOT applied/);
  assert.match(out.message, /gh exited 1/);
  assert.match(out.message, /worth noticing if it repeats/);
});

test('the three exit codes are distinct', () => {
  assert.equal(wipDecision({ prs: open(1), cap: 5 }).code, 0);
  assert.equal(wipDecision({ prs: open(9), cap: 5 }).code, 3);
  assert.equal(undeterminedDecision('x').code, 1);
});

// ── A capped pass must touch nothing ─────────────────────────────────────

test('the wip-check command reads only — no ClickUp writes anywhere in it', () => {
  // AC4: a capped pass leaves the queue exactly as it found it. A stray status
  // or Loop note would mark tickets as being worked when nothing is.
  const src = fs.readFileSync(path.join(__dirname, '../clickup_direct.mjs'), 'utf8');
  const start = src.indexOf("} else if (cmd === 'wip-check') {");
  assert.ok(start > -1, 'the wip-check command must exist');
  const end = src.indexOf("} else if (cmd === 'queue') {", start);
  assert.ok(end > start, 'could not bound the wip-check block');
  const block = src.slice(start, end);

  for (const forbidden of ["call('POST'", "call('PUT'", "call('DELETE'", 'stampLoopNote', 'postToBus']) {
    assert.ok(!block.includes(forbidden), `wip-check must not ${forbidden} — it is a read-only check`);
  }
  assert.match(block, /--state', 'open'/, 'it must ask gh for open PRs only');
});

test('the build skill actually consults it before claiming', () => {
  // A check nothing calls is a check that does not run — the buildStart lesson
  // (86bbjymxr), which shipped a guard and then had to add the instruction.
  const skill = fs.readFileSync(path.join(__dirname, '../../.claude/skills/loop-build/SKILL.md'), 'utf8');
  assert.match(skill, /wip-check/, 'SKILL.md must tell the pass to run it');
  assert.match(skill, /exit 3/i, 'and must say what a capped answer means');
});
