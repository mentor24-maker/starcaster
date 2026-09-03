'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const board = require('./board.js');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

// ---------------------------------------------------------------------------
// The table (task 86bbtujf4): five owners, read-only, in reading order.
// ---------------------------------------------------------------------------

test('the board composes the five owners, deck first, in reading order', () => {
  assert.deepEqual(board.INSTRUMENTS.map((i) => i.id),
    ['pipeline', 'cap', 'throughput', 'beats', 'operator']);
});

test('every instrument is a READ-ONLY invocation of its owner', () => {
  // The board must never become a ninth actor. No --check (posts), no --apply,
  // no --live, no --beat — the sentinels keep their own alerting.
  for (const i of board.INSTRUMENTS) {
    for (const banned of ['--check', '--apply', '--live', '--beat', '--force']) {
      assert.ok(!i.npmArgs.includes(banned),
        `${i.id} carries ${banned} — a board that writes or posts is a new watchdog, and the audit's rule is composition, not coverage`);
    }
  }
});

test('every instrument names its drill command', () => {
  for (const i of board.INSTRUMENTS) {
    assert.ok(i.drill.startsWith('npm run '), `${i.id}: a red line that does not name its door is a hunt`);
  }
});

// ---------------------------------------------------------------------------
// Words: exit dialects plus the owner's own printed tokens, never recomputed.
// ---------------------------------------------------------------------------

test('an undocumented exit code reads FAIL, never guessed', () => {
  const t = board.INSTRUMENTS.find((i) => i.id === 'throughput');
  assert.equal(board.wordFor(t, { exitCode: 7, text: '' }), 'FAIL');
});

test('pipeline status always exits 0, so its news is read from its own words', () => {
  const p = board.INSTRUMENTS.find((i) => i.id === 'pipeline');
  assert.equal(board.wordFor(p, { exitCode: 0, text: 'The pipeline is RUNNING' }), 'ok');
  assert.equal(board.wordFor(p, { exitCode: 0, text: 'in flight: x\nSTRANDED: a build on t1' }), 'ATTN',
    'STRANDED is the owner\'s own token — matched, not recomputed from the queue');
  assert.equal(board.wordFor(p, { exitCode: 0, text: 'The pipeline is PAUSED — Dane has the deck' }), 'ATTN');
  assert.equal(board.wordFor(p, { exitCode: 0, text: 'in flight: could not be read, so this answer is INCOMPLETE.' }), '????');
});

test('the worst of exit and tokens wins, in FAIL > ???? > ATTN > ok order', () => {
  const p = board.INSTRUMENTS.find((i) => i.id === 'pipeline');
  assert.equal(board.wordFor(p, { exitCode: 0, text: 'STRANDED: x\nINCOMPLETE' }), '????',
    'could-not-tell outranks attention: an unsurveyed deck may hold worse');
  assert.equal(board.composeBoard(['ok', 'ATTN', '????']), '????');
  assert.equal(board.composeBoard(['ok', 'FAIL', '????']), 'FAIL');
  assert.equal(board.composeBoard(['ok', 'ok']), 'ok');
});

test('a capped pipeline draws the eye without reading as a fault', () => {
  const c = board.INSTRUMENTS.find((i) => i.id === 'cap');
  assert.equal(board.wordFor(c, { exitCode: 3, text: 'WIP cap reached' }), 'ATTN');
  assert.equal(board.wordFor(c, { exitCode: 1, text: '' }), '????', 'wip-check documents 1 as could-not-tell');
  assert.equal(board.wordFor(c, { exitCode: 0, text: 'stranded builds NOT checked, 0 in rework' }), '????',
    'the cap\'s own "NOT checked" token must not render as a green line');
});

// ---------------------------------------------------------------------------
// THE POINT OF THE BOARD: the morning's disagreement, on one screen.
// ---------------------------------------------------------------------------

test('the 9am stall, replayed: STRANDED renders red beside an honest MOVING', () => {
  // Throughput said MOVING (true — 35 closed in its 24h window) while four
  // builds sat stranded. One instrument at a time, that is a morning of
  // diagnosis; on one screen, the disagreement IS the finding.
  const p = board.INSTRUMENTS.find((i) => i.id === 'pipeline');
  const t = board.INSTRUMENTS.find((i) => i.id === 'throughput');
  const pipeline = {
    word: board.wordFor(p, { exitCode: 0, text: 'STRANDED: a build on 86bbjt1b0, a build on 86bbjt1b4' }),
    lines: ['STRANDED: a build on 86bbjt1b0, a build on 86bbjt1b4'],
  };
  const throughput = {
    word: board.wordFor(t, { exitCode: 0, text: 'MOVING\n35 ticket(s) reached Live in the last 24h.' }),
    lines: ['MOVING', '35 ticket(s) reached Live in the last 24h.'],
  };
  assert.equal(pipeline.word, 'ATTN');
  assert.equal(throughput.word, 'ok');
  const screen = [
    ...board.renderSection(p, pipeline),
    ...board.renderSection(t, throughput),
  ].join('\n');
  assert.match(screen, /ATTN {1}the deck[\s\S]*ok {3}is anything shipping/,
    'both verdicts visible at once — neither instrument is wrong, and the board exists for exactly this pair');
  assert.match(screen, /→ drill: npm run pipeline -- status/, 'the red section names its door');
  assert.equal(board.composeBoard([pipeline.word, throughput.word]), 'ATTN',
    'and the composed header refuses to let the honest MOVING average the stall away');
});

test('a section the board could not read degrades alone, never as the screen', () => {
  // The runner turns a spawn error or timeout into ???? for that section; the
  // composition then refuses to render ok. What it must never do is kill the
  // other sections — seeing four healthy readings beside one ???? is itself
  // diagnostic.
  assert.equal(board.composeBoard(['ok', '????', 'ok', 'ok', 'ok']), '????');
  const io = read('scripts/board.mjs');
  assert.match(io, /renders \?\?\?\? for THAT section only/, 'the degradation contract is stated in the runner');
  assert.match(io, /Promise\.all/, 'sections are independent by construction');
});

// ---------------------------------------------------------------------------
// Rendering and plumbing.
// ---------------------------------------------------------------------------

test('the owners\' bookkeeping lines are trimmed, their news kept', () => {
  const lines = board.boardLines([
    '> starcaster@1.0.0 throughput',
    "  ClickUp's own limit: 94 of 100 left this minute (resets in 12s)",
    '  requests this pass: 4',
    'MOVING',
    '32 ticket(s) reached Live.',
  ].join('\n'), 5);
  assert.deepEqual(lines, ['MOVING', '32 ticket(s) reached Live.']);
});

test('only non-ok sections carry the drill line', () => {
  const p = board.INSTRUMENTS.find((i) => i.id === 'pipeline');
  const green = board.renderSection(p, { word: 'ok', lines: ['The pipeline is RUNNING'] }).join('\n');
  assert.doesNotMatch(green, /drill:/, 'a green board with five drill prompts is noise');
  const red = board.renderSection(p, { word: 'ATTN', lines: ['STRANDED: x'] }).join('\n');
  assert.match(red, /drill: npm run pipeline -- status/);
});

test('the runner spawns FROM the table, in parallel, and exits by the composed word', () => {
  const io = read('scripts/board.mjs');
  assert.match(io, /board\.INSTRUMENTS\.map\(runOne\)/, 'the table is the board');
  assert.match(io, /\.\.\.instrument\.npmArgs/, 'no instrument is re-implemented or hardcoded');
  assert.match(io, /composed === 'FAIL' \? 1 : composed === '\?\?\?\?' \? 2 : 0/,
    'FAIL 1, could-not-tell 2 (never 0), everything else 0 — ATTN is a state to read, not a script failure');
});
