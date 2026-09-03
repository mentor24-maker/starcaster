#!/usr/bin/env node
/**
 * `npm run preflight -- <loop>` — every gate a loop pass must clear, one
 * command, one line per gate, one composed verdict (task 86bbtujen).
 *
 * The sequence, the dialect translations and the verdict live in
 * scripts/builder/preflight.js, pure and tested. This file only runs the
 * gates and prints. Each gate is CALLED through its own npm script — never
 * re-implemented — so a refusal's message is the refusing tool's own.
 *
 * Exit: 0 go · 3 normal decline · 2 could not tell (never 0) · 1 real failure.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pf = require('./builder/preflight.js');

const loop = String(process.argv[2] || '').trim();
if (!pf.KNOWN_LOOPS.includes(loop)) {
  console.error(`usage: npm run preflight -- <${pf.KNOWN_LOOPS.join('|')}>`);
  console.error(loop ? `"${loop}" is not a loop this preflight knows.` : 'No loop named.');
  process.exit(2);
}

/** The tool's own first meaningful line — stdout first, stderr as fallback —
 *  so the gate line carries the refusing tool's words, not a paraphrase. */
function firstLineOf(out) {
  for (const stream of [out.stdout, out.stderr]) {
    const line = String(stream || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('>'));
    if (line) return line;
  }
  return '(the gate printed nothing)';
}

const results = [];
for (const gate of pf.GATES[loop]) {
  const out = spawnSync('npm', ['run', '--silent', ...gate.npmArgs], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  // A gate that could not even be SPAWNED is a real failure of the preflight
  // itself, not a verdict about the pipeline.
  const raw = out.error ? NaN : out.status;
  const r = pf.interpretGate(gate, raw);
  console.log(pf.renderGateLine(gate, raw, out.error ? String(out.error.message || out.error) : firstLineOf(out)));
  if (r.note) console.error(`      (${r.note})`);
  results.push({ ...r, gateId: gate.id });
  if (r.stop) break;
}

const verdict = pf.composeVerdict(results);
console.log(verdict.line);
process.exit(verdict.code);
