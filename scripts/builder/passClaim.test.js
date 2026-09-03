'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pc = require('./passClaim.js');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A marker as `readMarker` returns one. */
const found = (record) => ({ found: true, record: pc.claimRecord(record), why: '' });
const none = { found: false, record: null, why: '' };

// ---------------------------------------------------------------------------
// The decision (2026-09-02, task 86bbtmbpc).
// ---------------------------------------------------------------------------

test('the night of 2026-09-01, both shapes, repaired by the next pass', () => {
  // 86bbjt1b4: the pass ran to completion and forgot. 86bbr2jpq: the pass was
  // killed by a usage limit two minutes after claiming. From here they are the
  // same picture — a marker, and a ticket still in Building — which is the
  // point: the repair does not need to know how the pass died.
  for (const task of ['86bbjt1b4', '86bbr2jpq']) {
    const d = pc.reconcileDecision({ marker: found({ task, skill: 'loop-build' }), status: 'Building' });
    assert.equal(d.action, 'handback');
    assert.equal(d.task, task);
    assert.match(d.reason, /still "Building"/);
  }
});

test('a pass that finished leaves nothing to do', () => {
  assert.equal(pc.reconcileDecision({ marker: none, status: '' }).action, 'nothing');
});

test('a ticket that moved on by itself clears the marker quietly', () => {
  // What a pass that shipped but died before clearing looks like. Not a fault,
  // and it must not be reported as one.
  for (const status of ['In review', 'Live', 'Rework', 'Queued', 'Needs your input']) {
    const d = pc.reconcileDecision({ marker: found({ task: 'a1' }), status });
    assert.equal(d.action, 'resolved', `${status} is not a hand-back`);
  }
});

test('an unreadable STATUS is never a hand-back', () => {
  // The dangerous direction. Moving a ticket on a reading we did not take is
  // how a live build gets yanked out from under a pass that is genuinely
  // running — the one way this feature could do harm.
  const d = pc.reconcileDecision({ marker: found({ task: 'a1' }), status: '' });
  assert.equal(d.action, 'unreadable');
  assert.match(d.reason, /could not be read/);
  assert.doesNotMatch(pc.reconcileMessage(d), /Handed back/);
});

test('an unreadable MARKER is reported, not treated as "no claim"', () => {
  // `if (!ok) return nothing` here would silently drop the ticket the marker
  // names, which is the exact failure this module exists to prevent.
  const d = pc.reconcileDecision({ marker: { found: true, record: null, why: 'the marker is not valid JSON' }, status: '' });
  assert.equal(d.action, 'unreadable');
  assert.match(pc.reconcileMessage(d), /COULD NOT TELL/);
});

test('corrupt, empty and task-less marker files all read as unreadable', () => {
  const cases = ['not json at all', '{}', '{"task":"  "}', '[]', 'null'];
  for (const text of cases) {
    const m = pc.readMarker('/x', { exists: () => true, readFile: () => text });
    assert.equal(m.found, true, `${text} exists`);
    assert.equal(m.record, null, `${text} must not parse into a claim`);
    assert.ok(m.why, `${text} must say why`);
  }
  // And a good one does parse.
  const ok = pc.readMarker('/x', { exists: () => true, readFile: () => '{"task":"a1","skill":"loop-build"}' });
  assert.equal(ok.record.task, 'a1');
  assert.equal(ok.record.skill, 'loop-build');
});

test('a marker file that cannot be opened is "could not tell", not "absent"', () => {
  const m = pc.readMarker('/x', { exists: () => true, readFile: () => { throw new Error('EACCES'); } });
  assert.equal(m.found, true);
  assert.equal(m.record, null);
  assert.match(m.why, /could not be read/);
});

test('the exit code separates all four outcomes, and never hides a failure', () => {
  assert.equal(pc.reconcileExitCode({ action: 'nothing' }), 0);
  assert.equal(pc.reconcileExitCode({ action: 'resolved' }), 0);
  assert.equal(pc.reconcileExitCode({ action: 'handback', ok: true }), 3, 'a repair is visible, not silent');
  assert.equal(pc.reconcileExitCode({ action: 'handback', ok: false }), 1, 'a failed repair is a failure');
  assert.equal(pc.reconcileExitCode({ action: 'unreadable' }), 2, '"could not tell" is never 0');
});

test('the hand-back message is loud, because the log is the only witness', () => {
  const d = pc.reconcileDecision({ marker: found({ task: 'a1' }), status: 'Building' });
  const m = pc.reconcileMessage(d, { destination: 'Rework' });
  assert.match(m, /DROPPED ITS TICKET/);
  assert.match(m, /Rework/);
});

test('the marker lives beside the SHARED git dir, not inside a worktree', () => {
  // The claim happens in the main checkout; the hand-off happens inside the
  // pass's worktree, where plain `.git` is a file pointing elsewhere. A path
  // that resolved differently in those two places would write one marker and
  // clear another — worse than having none.
  assert.equal(pc.markerPath('/repo/.git'), path.join('/repo/.git', pc.MARKER_FILE));
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  assert.match(code, /rev-parse', '--git-common-dir'/,
    'the path must be asked of git, never assumed');
});

// ---------------------------------------------------------------------------
// The wiring.
// ---------------------------------------------------------------------------

test('the marker is written BEFORE the status write, never after', () => {
  // The 2:06am case: claimed, then killed at 2:08. A marker written after the
  // status write would not exist for exactly the failure it exists to catch.
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  const claim = code.slice(code.indexOf("if (cmd === 'claim') {"), code.indexOf("} else if (cmd === 'build-start')"));
  assert.match(claim, /writePassMarker\(/, 'the claim command writes the marker');
  // The invariant that matters is not the order of two lines inside `claim` —
  // everything there runs before the status write. It is that the write is not
  // in the STATUS SUCCESS path, where it would only ever run for a pass that
  // survived long enough to finish claiming. That is precisely the pass that
  // does not need a marker.
  assert.equal((code.match(/writePassMarker\(/g) || []).length, 2,
    'exactly one definition and one call site');
  // Anchored on the status command itself, not on a phrase — "verified from
  // the write response" also appears in the usage text 2000 lines earlier, and
  // an assertion that matches the wrong occurrence is an assertion that cannot
  // fail. (It could not, until break-testing said so.)
  const statusCmd = code.indexOf('} else if (cmd === \'status\') {');
  assert.ok(statusCmd > 0, 'found the status command');
  assert.ok(code.indexOf('writePassMarker(task, passSkill)') < statusCmd,
    'the marker is written by `claim`, which runs before any status write — not in the status success path, '
    + 'which only ever runs for a pass that survived long enough to finish claiming');
});

test('the marker is opt-in, so a hand-driven claim never arms a loop', () => {
  // THE safety property. A fast-track session claims with this same command,
  // and a marker from one would let a later loop pass hand a ticket back out
  // from under a person who is building it.
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  const claim = code.slice(code.indexOf("if (cmd === 'claim') {"), code.indexOf("} else if (cmd === 'build-start')"));
  assert.match(claim, /const passSkill = arg\('pass'\);/, 'the flag is read');
  assert.match(claim, /if \(passSkill\) writePassMarker\(/, 'and nothing is written without it');
});

test('the marker is cleared only after a VERIFIED status write', () => {
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  const verified = code.indexOf('verified from the write response');
  const cleared = code.indexOf('clearPassMarkerFor(task, now)');
  assert.ok(cleared > verified && verified > 0,
    'clearing on a write that did not stick throws away the ticket and the safety net together');
});

test('a hand-back that failed keeps its marker, so the next pass retries', () => {
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  const cmd = code.slice(code.indexOf("} else if (cmd === 'pass-reconcile') {"), code.indexOf("} else if (cmd === 'wip-check')"));
  assert.match(cmd, /if \(decision\.action === 'resolved' \|\| \(decision\.action === 'handback' && ok\)\)/,
    'only a resolved or successfully handed-back marker may be deleted');
});

test('the reconcile reuses the sweep\'s destination rule and its note', () => {
  // Three places now hand a dead build back: the pause sweep, the cap's
  // advice, and this. A third definition of where one belongs would drift.
  const code = withoutComments(read('scripts/clickup_direct.mjs'));
  const cmd = code.slice(code.indexOf("} else if (cmd === 'pass-reconcile') {"), code.indexOf("} else if (cmd === 'wip-check')"));
  assert.match(cmd, /pipelinePause\.strandedBuildDestination\(dest\.action\)/);
  assert.match(cmd, /pipelinePause\.sweptTicketNote\(/);
  assert.match(cmd, /buildStart\.resolveBuildStart\(/, 'and asks about the PR the way build-start does');
});

test('the skill runs the reconcile FIRST and states the invariant', () => {
  // Since task 86bbtujen the reconcile is the second gate of the PREFLIGHT
  // table rather than a prose step — same order (before the pause: repairing
  // is not claiming), now unreorderable by a summary. The skill keeps two
  // duties: run the one command, and REPORT a hand-back, because that line is
  // the only evidence anywhere that a previous pass dropped its ticket.
  const preflight = require('./preflight.js');
  const ids = preflight.GATES['loop-build'].map((g) => g.id);
  assert.ok(ids.indexOf('reconcile') !== -1, 'the build preflight runs the reconcile');
  assert.ok(ids.indexOf('reconcile') < ids.indexOf('pause'), 'before the pause — repairing is not claiming');
  const rec = preflight.GATES['loop-build'][ids.indexOf('reconcile')];
  assert.deepEqual([...rec.npmArgs], ['clickup', '--', 'pass-reconcile'], 'calling the real command');

  const skill = read('.claude/skills/loop-build/SKILL.md');
  assert.match(skill, /npm run preflight -- loop-build/, 'the step exists as the one command');
  assert.match(skill, /DROPPED\s+its ticket, put that in your report/, 'and the report duty survives the collapse');
  assert.match(skill, /claim --task <id> --pass loop-build/, 'the claim still arms the marker');
  assert.match(skill, /A PASS MAY NOT END WITH ITS TICKET STILL IN `Building`/, 'the invariant is stated');
  assert.match(skill, /YOU CANNOT PROMISE TO COME BACK/, 'and the shape that broke it is named');
});
