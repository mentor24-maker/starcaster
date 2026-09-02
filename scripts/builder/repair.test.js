'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repair = require('./repair.js');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The table (task 86bbtnk3k). Order and arguments are the behaviour.
// ---------------------------------------------------------------------------

test('the repair runs marker -> drift -> stranded, calling the real tools', () => {
  assert.deepEqual(repair.STEPS.map((s) => s.id), ['marker', 'drift', 'stranded']);
  assert.deepEqual([...repair.STEPS[0].npmArgs], ['clickup', '--', 'pass-reconcile']);
  assert.deepEqual([...repair.STEPS[1].npmArgs], ['reconcile', '--', '--live']);
  assert.deepEqual([...repair.STEPS[2].npmArgs], ['pipeline', '--', 'sweep']);
});

test('THE SAFETY PROPERTY: the scheduled sweep is dry by construction', () => {
  // The ticket's load-bearing question, answered in code: the pass marker is
  // the only machine-readable difference between a dead loop claim and a hand
  // session mid-build (five hand sessions held tickets in Building for hours
  // on 2026-09-02 alone). Marked strandings are repaired by the marker step;
  // unmarked ones are REPORTED, never moved unattended.
  const sweep = repair.STEPS.find((s) => s.id === 'stranded');
  assert.ok(!sweep.npmArgs.includes('--apply'),
    'an automatic --apply would eventually yank a ticket out from under a hand session — the one way this feature can do harm');
  // And the runner must not smuggle one into a SPAWN around the table. The
  // string does legitimately appear in the runner — as ADVICE, telling the
  // reader the exact command to run by hand — and the first version of this
  // assertion banned the string outright, which failed on the unbroken file:
  // it could not tell executing a flag from recommending one. Every
  // occurrence must be part of the advice phrase, and the spawn path takes
  // its arguments from the table alone.
  // Comments stripped first: the rationale comments in the runner mention the
  // flag while explaining its refusal, and iteration two of this assertion
  // failed on exactly that. Executable occurrences only — and each must be
  // the advice phrase.
  const io = read('scripts/repair.mjs')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const m of io.matchAll(/--apply/g)) {
    const around = io.slice(Math.max(0, m.index - 30), m.index + 10);
    assert.match(around, /pipeline -- sweep --apply/,
      'an --apply outside the hand-run advice phrase is a spawn about to happen');
  }
  assert.match(io, /spawnSync\('npm', \['run', '--silent', \.\.\.args\]/,
    'spawn arguments come from the table (plus the documented --dry-run downgrade), nowhere else');
  assert.ok(!io.includes("args.push"), 'nothing appends to a step\'s arguments');
});

test('every step is executed FROM the table, never re-implemented', () => {
  const io = read('scripts/repair.mjs');
  assert.match(io, /spawnSync\('npm', \['run', '--silent', \.\.\.args\]/,
    'the runner executes the table (with the documented --dry-run downgrade), or a step is that step pre-drifted');
  assert.match(io, /for \(const step of repair\.STEPS\)/, 'and iterates the table itself');
});

// ---------------------------------------------------------------------------
// Readings and the composed outcome.
// ---------------------------------------------------------------------------

test('each dialect reads by its own contract, and an undefined code is a failure', () => {
  const [marker, drift, stranded] = repair.STEPS;
  assert.equal(repair.readStep(marker, 3), 'repaired', 'a hand-back is news, not an abort');
  assert.equal(repair.readStep(marker, 2), 'cannot-tell');
  assert.equal(repair.readStep(drift, 1), 'cannot-tell', 'reconcile 1 = nothing could be checked');
  assert.equal(repair.readStep(stranded, 3), 'findings', 'a dry sweep that found work is the point of the schedule');
  assert.equal(repair.readStep(stranded, 7), 'failed', 'a tool speaking a new code has changed its contract');
});

test('the outcome composes by severity and never averages', () => {
  assert.equal(repair.composeOutcome(['clean', 'clean', 'clean']).code, 0);
  assert.equal(repair.composeOutcome(['repaired', 'clean', 'clean']).word, 'REPAIRED');
  assert.equal(repair.composeOutcome(['clean', 'clean', 'findings']).code, 3);
  assert.equal(repair.composeOutcome(['repaired', 'cannot-tell', 'findings']).code, 2,
    '"could not tell" outranks findings — an unsurveyed queue may hold worse');
  assert.equal(repair.composeOutcome(['failed', 'cannot-tell', 'findings']).code, 1);
});

test('"could not tell" is never rendered as clean', () => {
  for (const m of [['cannot-tell'], ['clean', 'cannot-tell', 'clean']]) {
    assert.notEqual(repair.composeOutcome(m).code, 0);
  }
});

// ---------------------------------------------------------------------------
// The scheduled discipline.
// ---------------------------------------------------------------------------

test('findings post once per window and a clean run clears the stamp', () => {
  const now = Date.parse('2026-09-02T20:00:00.000Z');
  const fresh = repair.postDecision({ outcomeCode: 3, lastPostedAtMs: NaN, nowMs: now });
  assert.equal(fresh.post, true);
  const again = repair.postDecision({ outcomeCode: 3, lastPostedAtMs: now - HOUR, nowMs: now });
  assert.equal(again.post, false, 'already said this window');
  const later = repair.postDecision({ outcomeCode: 3, lastPostedAtMs: now - 7 * HOUR, nowMs: now });
  assert.equal(later.post, true, 'a standing finding renews once per 6h');
  const clean = repair.postDecision({ outcomeCode: 0, lastPostedAtMs: now - HOUR, nowMs: now });
  assert.equal(clean.post, false);
  assert.equal(clean.clear, true, 'so the NEXT finding posts immediately');
});

test('the scheduled read throttles to one per half hour', () => {
  const now = Date.parse('2026-09-02T20:00:00.000Z');
  assert.equal(repair.readDue({ lastReadAtMs: NaN, nowMs: now }), true);
  assert.equal(repair.readDue({ lastReadAtMs: now - 10 * 60 * 1000, nowMs: now }), false,
    'the relay wakes every 10 minutes on two machines; the state changes far slower than the request budget would drain');
  assert.equal(repair.readDue({ lastReadAtMs: now - 31 * 60 * 1000, nowMs: now }), true);
});

test('the step line leads with a word a column of which scans', () => {
  const sweep = repair.STEPS[2];
  assert.match(repair.renderStepLine(sweep, 'findings', '2 stranded'), /^HELD/);
  assert.match(repair.renderStepLine(sweep, 'clean', 'none'), /^ok {2}/);
  assert.match(repair.renderStepLine(sweep, 'cannot-tell', 'queue unreadable'), /^\?\?\?\?/);
  assert.match(repair.renderStepLine(repair.STEPS[0], 'repaired', 'handed back'), /^FIX /);
});

// ---------------------------------------------------------------------------
// The wiring: scheduled, on the vantage that survives the owner dying.
// ---------------------------------------------------------------------------

test('the relay wake runs the repair, before the relay, and may not be failed by it', () => {
  const sh = read('scripts/run_bus_relay.sh');
  const line = 'npm run --silent repair -- --check || true';
  assert.ok(sh.includes(line), 'the schedule exists — a repair nobody runs was the whole ticket');
  assert.ok(sh.indexOf(line) < sh.indexOf('npm run --silent clickup -- bus-relay'),
    'before the ownership-gated relay step, like every sentinel: the idle wake on the non-owning machine is the vantage that survives the owner being dead');
});

test('the sweep-never-applies rationale is written where the refusal lives', () => {
  const src = read('scripts/builder/repair.js');
  assert.match(src, /hand session/i);
  assert.match(src, /only machine-readable difference/i,
    'the safety argument must live beside the code, or the next editor adds --apply as an obvious improvement');
});
