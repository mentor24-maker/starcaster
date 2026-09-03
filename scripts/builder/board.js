'use strict';

/**
 * `npm run board` — every watchdog on one screen (2026-09-02, task 86bbtujf4,
 * audit Phase 5).
 *
 * WHY. Eight sentinels exist and there was no place where they are composed.
 * At 9am on 2026-09-02 five instruments gave five different answers about one
 * stuck pipeline — throughput said MOVING, heartbeat saw jobs firing,
 * reconcile said clean, pipeline status said STRANDED, and a review-loop
 * report sat unread. Four were honest; none was sufficient; diagnosis took a
 * morning of knowing which commands exist. The board is for whoever just sat
 * down.
 *
 * THE DESIGN RULE: every line is rendered by the instrument that OWNS the
 * reading. The runner spawns each owner's own CLI and reprints its words —
 * the strongest form of "never re-derive", proven twice today (preflight,
 * repair). A section's verdict word comes from two places only: the owner's
 * EXIT CODE, read by that owner's documented dialect, and the owner's own
 * printed verdict tokens (`STRANDED:`, `PAUSED`, `STALLED` …) — its words,
 * pattern-matched, never recomputed from data.
 *
 * READ-ONLY, POST-NOTHING. The sentinels keep their own alerting; a board
 * that wrote anything would be a ninth actor. And deliberately NO new
 * watchdog rides here — the audit's own rule: the gap was composition, not
 * coverage.
 *
 * Severity order for the composed header, worst wins:
 *   FAIL > ???? (could not tell — never folded into ok) > ATTN > ok
 */

const WORD_SEVERITY = Object.freeze({ 'ok': 0, 'ATTN': 1, '????': 2, 'FAIL': 3 });

/**
 * The instruments, in reading order: the deck first (may anything run?), then
 * work in flight, then whether anything ships, then the machines, then what
 * waits on Dane. Each row:
 *
 *   npmArgs       the owner's own CLI — READ-ONLY invocations only
 *   drill         what a reader runs when the section is red
 *   exitWords     the owner's exit dialect. An exit not listed reads as FAIL:
 *                 a tool speaking a new code has changed its contract.
 *   flagPatterns  the owner's own verdict tokens that mark attention states
 *                 its exit code cannot carry (pipeline status always exits 0;
 *                 its STRANDED news is text).
 *   maxLines      how much of the owner's output the board reprints.
 */
const INSTRUMENTS = Object.freeze([
  Object.freeze({
    id: 'pipeline',
    label: 'the deck',
    npmArgs: Object.freeze(['pipeline', '--', 'status']),
    drill: 'npm run pipeline -- status',
    exitWords: Object.freeze({ 0: 'ok' }),
    flagPatterns: Object.freeze([
      Object.freeze({ re: 'STRANDED:', word: 'ATTN' }),
      Object.freeze({ re: 'PAUSED', word: 'ATTN' }),
      Object.freeze({ re: 'INCOMPLETE', word: '????' }),
    ]),
    maxLines: 7,
  }),
  Object.freeze({
    id: 'cap',
    label: 'work in flight',
    npmArgs: Object.freeze(['clickup', '--', 'wip-check']),
    drill: 'npm run clickup -- wip-check',
    // 3 = capped. A full cap is a STATE the reader should see, not a fault —
    // but it is exactly what a person sitting down needs their eye drawn to.
    exitWords: Object.freeze({ 0: 'ok', 3: 'ATTN', 1: '????' }),
    flagPatterns: Object.freeze([
      Object.freeze({ re: 'NOT checked', word: '????' }),
    ]),
    maxLines: 4,
  }),
  Object.freeze({
    id: 'throughput',
    label: 'is anything shipping',
    npmArgs: Object.freeze(['throughput']),
    drill: 'npm run throughput',
    exitWords: Object.freeze({ 0: 'ok', 1: 'ATTN', 2: '????' }),
    flagPatterns: Object.freeze([]),
    maxLines: 5,
  }),
  Object.freeze({
    id: 'beats',
    label: 'the machines',
    npmArgs: Object.freeze(['heartbeat']),
    drill: 'npm run heartbeat',
    exitWords: Object.freeze({ 0: 'ok', 1: 'ATTN' }),
    flagPatterns: Object.freeze([
      Object.freeze({ re: 'gone quiet', word: 'ATTN' }),
      Object.freeze({ re: 'OVERDUE', word: 'ATTN' }),
    ]),
    maxLines: 11,
  }),
  Object.freeze({
    id: 'operator',
    label: 'waiting on Dane',
    npmArgs: Object.freeze(['stale-ready']),
    drill: 'npm run stale-ready',
    exitWords: Object.freeze({ 0: 'ok', 1: 'ATTN', 2: '????', 3: 'ATTN' }),
    flagPatterns: Object.freeze([]),
    maxLines: 5,
  }),
]);

/**
 * A section's verdict word: the exit dialect first, then the owner's own
 * flagged tokens, worst wins. An undocumented exit is FAIL, never guessed.
 */
function wordFor(instrument, { exitCode, text } = {}) {
  const fromExit = instrument.exitWords[Number(exitCode)] || 'FAIL';
  let worst = fromExit;
  for (const p of instrument.flagPatterns) {
    if (String(text || '').includes(p.re) && WORD_SEVERITY[p.word] > WORD_SEVERITY[worst]) worst = p.word;
  }
  return worst;
}

/** The composed header word — worst across sections, by the same order. */
function composeBoard(words) {
  let worst = 'ok';
  for (const w of words) if (WORD_SEVERITY[w] > WORD_SEVERITY[worst]) worst = w;
  return worst;
}

/**
 * The owner's output, trimmed for the board: rate-limit bookkeeping and npm
 * banners are that tool's plumbing, not its news.
 */
function boardLines(text, maxLines) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l
      && !l.startsWith('>')
      && !/ClickUp's own limit|requests this pass|resets in/.test(l))
    .slice(0, maxLines);
}

/** One section. The drill command is printed on every non-ok section — the
 *  board is the front door to seventeen pipeline scripts, and a red line that
 *  does not name its door is a hunt. */
function renderSection(instrument, { word, lines }) {
  const out = [`${word.padEnd(4)} ${instrument.label} (${instrument.id})`];
  for (const l of lines) out.push(`       ${l}`);
  if (word !== 'ok') out.push(`       → drill: ${instrument.drill}`);
  return out;
}

module.exports = {
  WORD_SEVERITY,
  INSTRUMENTS,
  wordFor,
  composeBoard,
  boardLines,
  renderSection,
};
