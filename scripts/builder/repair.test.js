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
  // `--scheduled` since 2026-09-04 (task 86bbu60ax): a timer proves nothing
  // about whether a pass is alive, so without it this call was revoking LIVE
  // build claims every half hour. passClaim.test.js owns the behaviour; this
  // pins the argument, because the argument IS the fix.
  assert.deepEqual([...repair.STEPS[0].npmArgs], ['clickup', '--', 'pass-reconcile', '--scheduled']);
  // --check, not --live: the scheduled shape asks the pipeline switch before
  // it reads anything and puts a 6h window on its bus flags (task 86bbtqytq).
  // The writes are identical; the discipline is what --check adds.
  assert.deepEqual([...repair.STEPS[1].npmArgs], ['reconcile', '--', '--check']);
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
  assert.equal(repair.readStep(drift, 4), 'repaired',
    'reconcile 4 = it WROTE. Until 2026-09-04 this step had no such code, reconcile exited 0 whether it '
    + 'had changed the board or not, and the pass that wrongly closed a live ticket printed REPAIR: CLEAN '
    + '(86bbuv66c). A destructive step that cannot report its own writes is narrating, not watching.');
  assert.equal(repair.readStep(drift, 3), 'paused',
    'reconcile 3 = Dane has the deck — the repo-wide decline dialect, the same 3 node:owns and the '
    + 'preflight speak');
  assert.equal(repair.readStep(drift, 2), 'cannot-tell',
    'reconcile 2 = the switch could not be ASKED, which is not a decline and never an all-clear');

  // BREAK-TEST FOR THE MERGE ITSELF (2026-09-04). "it wrote" and "Dane has the
  // deck" arrived on two branches on the same day, both claiming exit 3. Give
  // them one number and nothing fails — a pass that CLOSED a ticket reports
  // PAUSED, quietly, forever. Collapse the two lines above onto one code and
  // this assertion is what says so.
  assert.notEqual(repair.readStep(drift, 3), repair.readStep(drift, 4),
    'a decline and a destructive write must never read as the same thing');
  assert.equal(repair.composeOutcome(['repaired', 'clean', 'clean']).code, 0,
    'a repaired run is a change to report, not a failure to page on');
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

// ── a step that declined is not a step that passed (task 86bbtqytq) ─────────

test('a drift step that stood down for the deck reads PAUSED, never CLEAN', () => {
  // reconcile exits 3 when Dane has the deck: it read nothing and moved
  // nothing. Folding that into "clean" would report a pass that checked
  // nothing as a healthy one — DOCTRINE 3.11 in the composer.
  const drift = repair.STEPS.find((s) => s.id === 'drift');
  assert.equal(repair.readStep(drift, 3), 'paused');
  const outcome = repair.composeOutcome(['clean', 'paused', 'clean']);
  assert.equal(outcome.word, 'PAUSED');
  assert.equal(outcome.code, 0, 'a deliberate operator state is not an alarm');
  assert.match(repair.renderStepLine(drift, 'paused', 'Dane has the deck'), /SKIP/);
});

test('BREAK-TEST: a drift step that could not ASK the switch reads CANNOT TELL, not PAUSED', () => {
  // Review round 1 (2026-09-03). reconcile now exits 2 when the switch itself
  // could not be read — a throttled ClickUp call, a rotated token. Before this
  // lane existed, that arrived as exit 3 and the whole pass composed to
  // `exit 0 / PAUSED`: the drift watchdog off the air, on a green board,
  // indefinitely. Break it by deleting the `2:` entry from the drift dialect
  // and this fails — `readStep` falls through to 'failed', which is loud but
  // wrong, because nothing failed.
  const drift = repair.STEPS.find((s) => s.id === 'drift');
  assert.equal(repair.readStep(drift, 2), 'cannot-tell');
  const outcome = repair.composeOutcome(['clean', 'cannot-tell', 'clean']);
  assert.equal(outcome.word, 'CANNOT TELL');
  assert.equal(outcome.code, 2, 'a blind watchdog must not exit 0');
  assert.notEqual(repair.readStep(drift, 2), repair.readStep(drift, 3),
    'the two non-zero switch answers must not collapse into one reading');
});

test('BREAK-TEST: no step may run without a deadline', () => {
  // The runner had none, so a step that never returned pinned the relay's
  // ten-minute wake and the next wake found it still there.
  const io = read('scripts/repair.mjs');
  assert.match(io, /timeout: STEP_TIMEOUT_MS/, 'the step spawn carries a deadline');
  assert.match(io, /const STEP_TIMEOUT_MS = /);
});

test('a real finding still outranks a paused step', () => {
  assert.equal(repair.composeOutcome(['paused', 'findings']).code, 3);
  assert.equal(repair.composeOutcome(['paused', 'cannot-tell']).code, 2);
  assert.equal(repair.composeOutcome(['paused', 'failed']).code, 1);
});

// ---------------------------------------------------------------------------
// The dialect is a CONTRACT BETWEEN TWO FILES, so test it across both.
// ---------------------------------------------------------------------------

test('reconcile exits the codes this table says it does', () => {
  // repair.js declares what reconcile's exit codes MEAN; reconcile.cjs decides
  // what they ARE. Nothing made the two agree, and on 2026-09-04 they very
  // nearly did not: two branches gave exit 3 two different meanings on the same
  // day — "Dane has the deck" and "this pass wrote" — and merging both would
  // have made a pass that CLOSED a ticket report PAUSED. An exit code is an
  // integer; every gate in this repo stays green through a wrong one.
  const src = read('scripts/reconcile_clickup_github.cjs');
  const [, drift] = repair.STEPS;

  assert.match(src, /if \(live && wrote\.count > 0\) process\.exit\(4\)/,
    `a live write exits 4, which this table reads as "${repair.readStep(drift, 4)}"`);
  assert.match(src, /exit: 3,[\s\S]{0,400}?Dane has the deck/,
    `a genuine pause exits 3, which this table reads as "${repair.readStep(drift, 3)}"`);
  assert.match(src, /exit: 2,[\s\S]{0,400}?COULD NOT TELL/,
    `an unaskable switch exits 2, which this table reads as "${repair.readStep(drift, 2)}"`);
});
