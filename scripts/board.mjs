#!/usr/bin/env node
/**
 * `npm run board` — every watchdog, one screen (task 86bbtujf4).
 *
 *   npm run board             the screen
 *   npm run board -- --json   the same readings as JSON, for a future check
 *
 * The instruments, their dialects and the rendering live in
 * scripts/builder/board.js. This file spawns each owner's own CLI — all of
 * them IN PARALLEL, because five honest instruments read serially is ~20
 * seconds and a person who just sat down deserves the answer in the time of
 * the slowest one — and reprints their words. Read-only; posts nothing.
 *
 * A section that cannot be read renders ???? for THAT section only and never
 * kills the rest of the board: the whole point is seeing the disagreement.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const board = require('./builder/board.js');

const JSON_MODE = process.argv.includes('--json');
/** Generous per-instrument budget; a tool slower than this is its own news. */
const TIMEOUT_MS = 45 * 1000;

function runOne(instrument) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', '--silent', ...instrument.npmArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let done = false;
    const finish = (exitCode, note) => {
      if (done) return;
      done = true;
      resolve({ instrument, exitCode, text: `${out}\n${err}`, note: note || '' });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(NaN, `no answer within ${TIMEOUT_MS / 1000}s — run it alone`);
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); finish(NaN, String(e.message || e)); });
    child.on('close', (code) => { clearTimeout(timer); finish(code); });
  });
}

const started = Date.now();
const results = await Promise.all(board.INSTRUMENTS.map(runOne));

const sections = results.map(({ instrument, exitCode, text, note }) => {
  const word = note ? '????' : board.wordFor(instrument, { exitCode, text });
  const lines = note ? [note] : board.boardLines(text, instrument.maxLines);
  return { instrument, word, lines, exitCode };
});

const composed = board.composeBoard(sections.map((s) => s.word));

if (JSON_MODE) {
  console.log(JSON.stringify({
    composed,
    at: new Date(started).toISOString(),
    tookMs: Date.now() - started,
    sections: sections.map((s) => ({
      id: s.instrument.id, word: s.word, exitCode: s.exitCode, lines: s.lines, drill: s.instrument.drill,
    })),
  }, null, 2));
} else {
  console.log(`THE BOARD — ${composed}  (${((Date.now() - started) / 1000).toFixed(1)}s, read-only)`);
  console.log('');
  for (const s of sections) {
    for (const line of board.renderSection(s.instrument, s)) console.log(line);
    console.log('');
  }
  if (composed !== 'ok') {
    console.log('Non-ok sections name their drill command. Disagreement between sections is the finding —');
    console.log('four instruments were honest and insufficient one at a time on the morning of 2026-09-02.');
  }
}

process.exit(composed === 'FAIL' ? 1 : composed === '????' ? 2 : 0);
