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
  probeCap,
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
  // Bounded at next-interval, which now follows it. Bounding at `queue` used
  // to sweep both commands into one "block" and would let a write added to
  // next-interval pass as if it were wip-check's (task 86bbq8br2).
  const end = src.indexOf("} else if (cmd === 'next-interval') {", start);
  assert.ok(end > start, 'could not bound the wip-check block');
  const block = src.slice(start, end);

  for (const forbidden of ["call('POST'", "call('PUT'", "call('DELETE'", 'stampLoopNote', 'postToBus']) {
    assert.ok(!block.includes(forbidden), `wip-check must not ${forbidden} — it is a read-only check`);
  }

  // "Open PRs only" is still the rule; since task 86bbq8br2 it is enforced in
  // the one shared probe rather than in this block, because both callers need
  // it and two copies of a rule are how they drifted in the first place.
  const ps = src.indexOf('function capProbe(');
  assert.ok(ps > -1, 'capProbe must exist — it is the single cap reading');
  const probe = src.slice(ps, src.indexOf('\n}\n', ps));
  assert.match(probe, /'--state', 'open'/, 'it must ask gh for open PRs only');
  for (const forbidden of ["call('POST'", "call('PUT'", "call('DELETE'"]) {
    assert.ok(!probe.includes(forbidden), `capProbe must not ${forbidden} — it is a read-only probe`);
  }
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

test('it reads a body exactly as loosely as pr-opened ACCEPTS one', () => {
  // Review round 2. At the time, the gate that guarantees every loop-opened PR
  // carries its ticket — prBodyCarriesTicket in loopTrail.js — took a BARE id
  // case-insensitively, while this reader demanded a URL and matched
  // case-sensitively against a lowercase map. So a body reading
  // `ClickUp: 86bbm4zwd` sailed through pr-opened and then went UNCOUNTED
  // here: the cap failing OPEN, the direction this ticket calls the dangerous
  // one. The gate has since tightened to URL-only (86bbmmv7t finding 2); this
  // reader stays loose on purpose, because over-counting is the cap's safe
  // direction and older PR bodies still carry the bare shape.
  //
  // BREAK TEST: revert ticketIdFromPrBody to `return m ? m[1] : null` with no
  // knownIds scan, and the first two assertions fail. Watched fail.
  const known = ['86bbm4zwd', '86bbk2fuh'];
  assert.equal(ticketIdFromPrBody('ClickUp: 86bbm4zwd', known), '86bbm4zwd',
    'a bare id is what pr-opened accepts, so it must be what this reads');
  assert.equal(ticketIdFromPrBody('see https://app.clickup.com/t/86BBM4ZWD', known), '86bbm4zwd',
    'the URL ClickUp\'s own UI copies is mixed case; the map is keyed lowercase');
  assert.equal(ticketIdFromPrBody('a run like 86bbm4zwdxx is not that id', known), null,
    'and it must not match an id buried inside a longer word');
  assert.equal(ticketIdFromPrBody('nothing familiar here', known), null);
});

test('the two readers agree — anything pr-opened lets through, the cap can count', () => {
  // The property, asserted against the REAL gate rather than a description of
  // it, so the two cannot drift apart again without this failing. The property
  // is one-directional on purpose: the cap may count MORE than the gate lets
  // through (over-counting trips the cap early, the safe direction), but it
  // must never count less — an uncounted in-flight PR is the cap failing OPEN.
  const { prBodyCarriesTicket } = require('./loopTrail');
  const id = '86bbm4zwd';
  const bodies = [
    `Ticket: https://app.clickup.com/t/${id}`,
    `Ticket: https://app.clickup.com/t/90141423066/${id}`,
    `ClickUp: ${id}`,
    `Closes ${id.toUpperCase()}.`,
  ];
  for (const body of bodies) {
    if (!prBodyCarriesTicket(body, id)) continue;
    assert.equal(ticketIdFromPrBody(body, [id]), id,
      `pr-opened accepts this, so the cap must resolve it too, or the PR silently stops counting: ${body}`);
  }

  // Pin what the gate accepts, so a loosening or tightening over there shows
  // up HERE as a failed expectation rather than as a silently vacuous loop.
  // Since 2026-08-26 (task 86bbmmv7t, finding 2) a bare id is NOT a ticket
  // reference — clickupTicketLink.js requires the full URL, both live shapes.
  assert.ok(prBodyCarriesTicket(`Ticket: https://app.clickup.com/t/${id}`, id),
    'pr-opened accepts the plain URL the loop writes');
  assert.ok(prBodyCarriesTicket(`Ticket: https://app.clickup.com/t/90141423066/${id}`, id),
    "pr-opened accepts the workspace URL ClickUp's copy-link button produces");
  assert.equal(prBodyCarriesTicket(`ClickUp: ${id}`, id), false,
    'a bare id no longer passes pr-opened (86bbmmv7t finding 2)');

  // The cap still resolves a bare id via the knownIds scan. That is deliberate
  // looseness in the safe direction, not drift: a PR whose body predates the
  // URL rule keeps counting against the cap.
  assert.equal(ticketIdFromPrBody(`ClickUp: ${id}`, [id]), id,
    'the cap counts a bare id even though the gate no longer accepts one');
});

test('casing on EITHER side — the PR body or the queue — must not decide the count', () => {
  // Two separate lowercasings, so two assertions. The reader lowercases what
  // it captures; classifyPrs lowercases the map keys. Drop either one and a
  // real, in-flight PR silently stops counting — the cap failing OPEN.
  //
  // BREAK TEST: drop `.toLowerCase()` from the captured id and the first fails;
  // drop it from the map keys and the second fails. Both watched fail.
  const bodyCased = classifyPrs({
    prs: [pr(1, '86BBM4ZWD')],
    ticketStatusById: { '86bbm4zwd': 'Building' },
  });
  assert.deepEqual(bodyCased.inFlight, [1], 'a mixed-case id in the PR body must still resolve');

  const queueCased = classifyPrs({
    prs: [pr(2, '86bbm4zwd')],
    ticketStatusById: { '86BBM4ZWD': 'Building' },
  });
  assert.deepEqual(queueCased.inFlight, [2], 'a mixed-case id from the QUEUE must still resolve');
  assert.deepEqual(queueCased.unknown, []);
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
  assert.deepEqual(g.queued, []);
  // UPDATED AGAIN after review round 2: it must not be filed as "no ticket
  // found" either. A ticket WAS found — saying otherwise sends the reader
  // hunting for a missing ClickUp link that is not missing, which is round
  // 1's finding 1 in a different bucket.
  assert.deepEqual(g.unknown, [], 'a ticket was found, so this is not "no ticket found"');
  assert.deepEqual(g.unrecognised, [{ number: 9, status: 'Some New Status' }],
    'and the status it did not recognise is carried, so the message can quote it');
});

test('the message says WHICH status it did not recognise, and does not call it missing', () => {
  // The wording is the whole fix: "no ticket found" for a PR whose ticket is
  // right there is a false statement, and it costs the reader a hunt. Naming
  // the status also makes the line actionable — either IN_FLIGHT_STATUSES is
  // out of date, or somebody typed a status by hand.
  const { message } = wipDecision({
    prs: [pr(1, 'a'), pr(2, 'b')], cap: 5,
    ticketStatusById: { a: 'Building', b: 'Parked Indefinitely' },
  });
  assert.match(message, /unrecognised status/);
  assert.match(message, /#2 — "Parked Indefinitely"/, 'quoted verbatim, in ClickUp\'s own casing');
  assert.doesNotMatch(message, /no ticket found/,
    'a ticket WAS found — reporting a missing link that is not missing is the defect');
});

test('a PR with genuinely no ticket still reports as no ticket found', () => {
  // The other side of the split: separating the buckets must not lose the
  // case criterion 4 is about. Reported by number, never counted, exit still 0.
  const d = wipDecision({ prs: [pr(1, 'a'), pr(7, null)], cap: 5, ticketStatusById: { a: 'Building' } });
  assert.deepEqual(d.groups.unknown, [7]);
  assert.deepEqual(d.groups.unrecognised, []);
  assert.equal(d.code, 0, 'an unidentifiable PR must not stop the pass');
  assert.match(d.message, /1 with no ticket found \(#7\)/);
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

// ── The doc must describe THIS code, not the code it replaced ─────────────
// Review round 2, finding 4: the section added to LOOP_ENGINEERING.md listed
// three counting statuses where the code has four, and described the reconcile
// scan as newest-PR-only after round 1 had already made it check every PR. Both
// were true of an earlier draft. A doc that documents the bug is worse than no
// doc, because the operator has no way to tell — so the claims that can be
// mechanically checked are checked here rather than re-read by hand.

const LOOP_DOC = fs.readFileSync(path.join(__dirname, '../../docs/LOOP_ENGINEERING.md'), 'utf8');

test('the doc names every status that counts, and none that does not', () => {
  const { IN_FLIGHT_STATUSES } = require('./wipCap');
  const start = LOOP_DOC.indexOf('## The work-in-progress cap');
  assert.ok(start > -1, 'the section must exist — a doc nobody can find is not a doc');
  const section = LOOP_DOC.slice(start, LOOP_DOC.indexOf('\n## ', start + 5));

  for (const status of IN_FLIGHT_STATUSES) {
    // Backticked, in the doc's own Title Case, as ClickUp shows it.
    const shown = status.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bIn Review\b/, 'In review');
    assert.ok(new RegExp(`\`${shown}\``, 'i').test(section),
      `IN_FLIGHT_STATUSES has "${status}" but the doc's cap section never mentions it`);
  }
  // And the reverse: a status that does NOT count must not be listed as one.
  // `Queued` and `Live` appear in the section on purpose — as the things that
  // count zero — so this checks the sentence that enumerates what counts.
  const sentence = /A PR counts only when its ticket is ([^.]+)\./.exec(section);
  assert.ok(sentence, 'the doc must state plainly which statuses count');
  for (const notCounted of ['Queued', 'Live']) {
    assert.ok(!sentence[1].includes(notCounted),
      `"${notCounted}" does not count, so it must not appear in the sentence that says what does`);
  }
});

test('the doc does not describe the reconcile scan as newest-PR-only', () => {
  const start = LOOP_DOC.indexOf('**The matching drift check.**');
  assert.ok(start > -1, 'the reconcile paragraph must exist');
  const para = LOOP_DOC.slice(start, start + 1200);
  assert.doesNotMatch(para, /newest PR is still open/,
    'round 1 replaced newest-only with every-distinct-PR; the doc documented the bug');
  assert.match(para, /any linked PR still open|every distinct PR/i,
    'it must say what the code actually does');
});

// ── One reading, two callers (2026-08-31, task 86bbq8br2) ─────────────────
// `wip-check` and `next-interval` answered "is the cap full?" differently:
// the claim gate said "4 in flight, cap 5 — room to claim another" while the
// sleep timer wrote "the work-in-progress cap is full" into the log and slept
// the maximum hour, with 38 tickets claimable. Neither function was wrong;
// they were two call sites, and only one of them passed ticket statuses.

// Eight open PRs, four of them rework whose tickets went back to `Queued` —
// the exact shape of the queue on the morning this was found.
const EIGHT = {
  prs: [
    pr(419, 'tq1'), pr(446, 'tq2'), pr(447, 'tq3'), pr(449, 'tq4'),
    pr(454, 'tf1'), pr(471, 'tf2'), pr(481, 'tf3'), pr(482, 'tf4'),
  ],
  statuses: {
    tq1: 'Queued', tq2: 'Queued', tq3: 'Queued', tq4: 'Queued',
    tf1: 'In review', tf2: 'Building', tf3: 'In review', tf4: 'Building',
  },
};

test('8 open PRs, 4 queued for rework, cap 5 — the cap is NOT reached', async () => {
  // THE regression. Counting all eight is what made loop-build sleep an hour
  // after every productive pass.
  const out = await probeCap({
    cap: 5,
    listOpenPrs: async () => EIGHT.prs,
    readTicketStatuses: async () => EIGHT.statuses,
  });
  assert.equal(out.determined, true);
  assert.equal(out.statusesAvailable, true);
  assert.equal(out.decision.inFlight, 4, 'the four sent back for rework must not count');
  assert.equal(out.decision.code, 0, 'code 3 here is the bug: a full cap that is not full');
  assert.equal(out.decision.claim, true);
});

test('an unreadable queue still counts every open PR, and says so', async () => {
  // Criterion 3: the conservative fallback is unchanged, and never silent.
  const out = await probeCap({
    cap: 5,
    listOpenPrs: async () => EIGHT.prs,
    readTicketStatuses: async () => { throw new Error('HTTP 429'); },
  });
  assert.equal(out.determined, true);
  assert.equal(out.statusesAvailable, false, 'the caller must be able to say statuses were unavailable');
  assert.match(out.queueFailure, /429/, 'and must be able to say WHY');
  assert.equal(out.decision.code, 3, 'all eight counted — the stricter reading');
  assert.match(out.decision.message, /statuses were NOT available/i);
});

test('an empty queue read is a failed read, not an empty queue', async () => {
  // `[]` back from ClickUp is never true here — the Loop Queue always has
  // tickets — so treating it as "no ticket is in flight" would uncap the loop.
  const out = await probeCap({
    cap: 5,
    listOpenPrs: async () => EIGHT.prs,
    readTicketStatuses: async () => ({}),
  });
  assert.equal(out.statusesAvailable, false);
  assert.equal(out.decision.code, 3, 'must fall back to the strict count, not claim nothing is in flight');
});

test('an unlistable PR set is UNDETERMINED — neither caller gets to guess here', async () => {
  const out = await probeCap({
    cap: 5,
    listOpenPrs: async () => { throw new Error('gh is not installed'); },
    readTicketStatuses: async () => EIGHT.statuses,
  });
  assert.equal(out.determined, false);
  assert.equal(out.decision, null, 'no decision at all, so wip-check can fail open and next-interval closed');
  assert.match(out.why, /gh is not installed/);
});

test('a PR list with no bodies UNCAPS the loop — which is why the field list is pinned at source', () => {
  // Worth stating exactly, because it is the opposite of what it looks like.
  // `--json number,state` omits the body, so classifyPrs matches no PR to a
  // ticket and all eight land in `unknown` — a bucket that deliberately does
  // NOT count, so a hand-made PR never caps the loop. The result is that a
  // body-less list fails OPEN: 0 in flight, claim away.
  //
  // (The old next-interval bug was the other one — it passed no statuses at
  // all, taking the fallback that counts every open PR, and so read as FULL.
  // Same missing field, opposite failure, depending on whether statuses came
  // with it. Neither is acceptable, and no runtime assertion can tell a
  // body-less list from a repo where nobody links tickets — so the guard is
  // the source test below, which requires 'body' in the one field list there
  // is.)
  const g = classifyPrs({
    prs: EIGHT.prs.map(({ number, state }) => ({ number, state })),
    ticketStatusById: EIGHT.statuses,
  });
  assert.equal(g.inFlight.length, 0);
  assert.equal(g.unknown.length, 8, 'every PR unmatched — invisible to the cap');
});

// ── The wiring, pinned at source ─────────────────────────────────────────
// The bug lived in the call sites, not in this module, so unit tests alone
// would pass on the broken code. These are the assertions that fail on it.

test('every cap probe goes through capProbe — no command reads the cap its own way', () => {
  assert.doesNotMatch(CD, /wipCap\.wipDecision\(/,
    'wipDecision must be reached only through wipCap.probeCap, or the two callers can drift apart again');
  const probes = CD.match(/await capProbe\(/g) || [];
  assert.equal(probes.length, 2, 'exactly two callers: wip-check and next-interval');
});

test('the PR list asks for the body, or every PR counts as having no ticket', () => {
  // `--json number,state` is what next-interval used, and it is why the cap
  // read as full: classifyPrs finds a PR's ticket through its body.
  assert.doesNotMatch(CD, /'--json', 'number,state'/,
    "a PR list without 'body' makes classifyPrs blind");
  assert.match(CD, /'--json', 'number,state,body'/);
  const lists = CD.match(/'pr', 'list'/g) || [];
  assert.equal(lists.length, 1, 'one place builds the PR list, so the field list cannot diverge');
});

test('next-interval logs the cap sentence itself, not just its effect', () => {
  // A disagreement with wip-check took a morning to spot because the interval
  // log said only "the cap is full". Printing the decision makes the two
  // comparable at a glance.
  assert.match(CD, /\(cap: \$\{String\(probe\.decision\.message\)/,
    'the interval log must quote the same sentence wip-check prints');
});
