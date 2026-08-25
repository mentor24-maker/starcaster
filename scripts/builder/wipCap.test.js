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
  ticketIdFromPrBody,
  classifyPrs,
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

// ── Counting work in flight, not open PRs (2026-08-25, task 86bbm4zwd) ─────

const pr = (number, ticket, state = 'OPEN') => ({
  number, state,
  body: ticket ? `Does the thing.\n\nTicket: https://app.clickup.com/t/${ticket}\n` : 'No ticket link here.',
});

test('the ticket id is read out of the PR body', () => {
  assert.equal(ticketIdFromPrBody('Ticket: https://app.clickup.com/t/86bbk2fuh'), '86bbk2fuh');
  // The workspace-scoped form ClickUp hands out when you copy from the UI.
  assert.equal(ticketIdFromPrBody('see https://app.clickup.com/t/90141423066/86bbjv681 ok'), '86bbjv681');
  assert.equal(ticketIdFromPrBody('no link at all'), null);
  assert.equal(ticketIdFromPrBody(undefined), null);
});

test('only in-flight tickets count; queued rework and live zombies do not', () => {
  const prs = [pr(1, 'tBuild'), pr(2, 'tReview'), pr(3, 'tReady'), pr(4, 'tQueued'), pr(5, 'tLive'), pr(6, null)];
  const g = classifyPrs({ prs, ticketStatusById: {
    tBuild: 'Building', tReview: 'In review', tReady: 'Ready to launch',
    tQueued: 'Queued', tLive: 'Live',
  }});
  assert.deepEqual(g.inFlight, [1, 2, 3], 'Building / In review / Ready to launch are in flight');
  assert.deepEqual(g.queued, [4], 'a queued ticket is REWORK — counting it is what caused the deadlock');
  assert.deepEqual(g.live, [5], 'a live ticket means the work shipped elsewhere; the PR is a leftover');
  assert.deepEqual(g.unknown, [6], 'a PR with no ticket is reported, never counted');
});

test('THE DEADLOCK: the real 2026-08-25 state must let the loop claim', () => {
  // Verbatim from the morning that broke it: 7 open PRs against cap 5, of
  // which 3 were queued for rework and 2 were zombies whose tickets were Live.
  // The old counting said "7 open, cap 5 — not claiming" for four consecutive
  // hourly passes while only two things were genuinely in flight.
  const prs = [
    pr(428, 'tQ1'), pr(426, 'tQ2'), pr(419, 'tQ3'),      // sent back to Queued
    pr(374, 'tL1'), pr(381, 'tL2'),                       // tickets already Live
    pr(373, 'tB1'), pr(422, 'tR1'),                       // genuinely in flight
  ];
  const ticketStatusById = {
    tQ1: 'Queued', tQ2: 'Queued', tQ3: 'Queued',
    tL1: 'Live', tL2: 'Live',
    tB1: 'Building', tR1: 'In review',
  };
  const d = wipDecision({ prs, cap: 5, ticketStatusById });
  assert.equal(d.claim, true, 'the loop must claim: only 2 of the 7 are in flight');
  assert.equal(d.code, 0);
  assert.equal(d.inFlight, 2);
  assert.equal(countOpenPrs(prs), 7, 'and the raw open count is still 7 — that is the whole point');
});

test('the message names the split, never a bare total', () => {
  // A bare "7 open, cap 5" is true and useless: it hid the deadlock for four
  // passes. Whatever the verdict, the uncounted PRs must be itemised.
  const prs = [pr(1, 'a'), pr(2, 'b'), pr(3, 'c')];
  const byId = { a: 'Building', b: 'Queued', c: 'Live' };
  const { message } = wipDecision({ prs, cap: 5, ticketStatusById: byId });
  assert.match(message, /1 in flight, cap 5/);
  assert.match(message, /queued for rework \(#2\)/);
  assert.match(message, /already live \(#3\)/);
  assert.doesNotMatch(message, /3 PR\(s\) open/, 'the old bare-total phrasing must be gone');
});

test('a genuinely full pipeline still caps', () => {
  // The cap is right and must keep working — this ticket changed WHAT it
  // counts, not whether it counts.
  const prs = [1, 2, 3, 4, 5].map((n) => pr(n, `t${n}`));
  const byId = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`t${n}`, 'In review']));
  const d = wipDecision({ prs, cap: 5, ticketStatusById: byId });
  assert.equal(d.claim, false);
  assert.equal(d.code, 3);
  assert.match(d.message, /5 in flight, cap 5/);
});

test('no ticket statuses at all falls back to the OLD, stricter counting', () => {
  // If ClickUp cannot be read we must fail TOWARD the cap. Failing away from
  // it would reinstate the churn the cap exists to prevent, silently.
  const prs = [1, 2, 3, 4, 5].map((n) => pr(n, `t${n}`));
  const d = wipDecision({ prs, cap: 5 });
  assert.equal(d.claim, false, 'unreadable queue must not uncap the loop');
  assert.equal(d.code, 3);
  assert.match(d.message, /statuses were NOT available/i);
});

test('an unknown status is not counted AND is not mislabelled as live', () => {
  // A status nobody anticipated must not silently consume cap — and must not
  // be reported as "already live" either. UPDATED after review round 1: the
  // first version bucketed everything unrecognised as live, which is a claim
  // that the work SHIPPED. A wrong claim there is the exact thing this ticket
  // exists to stop.
  const g = classifyPrs({ prs: [pr(9, 'x')], ticketStatusById: { x: 'Some New Status' } });
  assert.deepEqual(g.inFlight, []);
  assert.deepEqual(g.live, []);
  assert.deepEqual(g.unknown, [9], 'unrecognised means unknown, not shipped');
});

test('Needs your input counts as in flight — it is operator-held, like Ready to launch', () => {
  // Review round 1 caught this reported as "already live", which is false.
  // Decided: it counts. A ticket parked on Dane with an open PR is real work
  // occupying the merge pipeline, its branch still needs catching up on every
  // merge, and if his inbox is full the pipeline genuinely IS full. Ready to
  // launch is operator-held and was never in doubt; this is the same category.
  const g = classifyPrs({ prs: [pr(7, 'n')], ticketStatusById: { n: 'Needs your input' } });
  assert.deepEqual(g.inFlight, [7]);
  assert.deepEqual(g.live, []);
});

// ── The wiring, pinned at source ──────────────────────────────────────────
// clickup_direct.mjs has no harness, and review round 1 showed exactly why
// that matters: the include-closed and non-fatal options are invisible to a
// unit test that injects task objects, and BOTH were wrong in ways that made
// the feature silently not work. Breaking either must fail here.

const CD = fs.readFileSync(path.join(__dirname, '../clickup_direct.mjs'), 'utf8');

test('wip-check asks ClickUp for closed tasks, or Live tickets are invisible', () => {
  // Without include_closed the v2 list endpoint drops closed-type statuses:
  // 36 tasks come back where 66 Live ones exist. A zombie PR's ticket is then
  // simply absent, and it reports as "no ticket found" — sending the reader
  // after drift that does not exist.
  assert.match(CD, /fetchAllTasks\(LOOP_QUEUE_LIST, \{ includeClosed: true, fatal: false \}\)/,
    'wip-check must pass includeClosed:true AND fatal:false');
  assert.match(CD, /include_closed=true/, 'and fetchAllTasks must actually send it');
});

test('the failed-read path cannot exit the process — that inverted the safety property', () => {
  // fetchAllTasks calls die() -> process.exit(1) on a bad response. loop-build
  // reads exit 1 as "proceed, unbounded by the cap", so a routine ClickUp 429
  // UNCAPPED the loop instead of capping it. The non-fatal mode must return
  // rather than die.
  assert.match(CD, /if \(!fatal\) return \{ tasks: null, res: out\.res, failed:/,
    'a non-fatal read must RETURN on failure, never die()');
  assert.doesNotMatch(CD, /try \{\s*const \{ tasks \} = await fetchAllTasks\(LOOP_QUEUE_LIST\);/,
    'the old unreachable try/catch around a die()-ing call must be gone');
});

test('a failed read falls back to the STRICTER counting, never to uncapped', () => {
  // The property the inverted fallback broke, asserted on the decision itself.
  const prs = [1, 2, 3, 4, 5, 6].map((n) => pr(n, `t${n}`));
  const d = wipDecision({ prs, cap: 5 });
  assert.equal(d.claim, false, 'no ticket data must mean MORE restrictive, not less');
  assert.equal(d.code, 3, 'and a normal decline, never exit 1 which means "proceed uncapped"');
});
