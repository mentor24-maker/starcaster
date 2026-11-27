#!/usr/bin/env node
// Give existing tickets their kind, who started them and how they ended
// (SC-813), from a decision table such as
// docs/ticket-classes/starcaster-2026-11-16.tsv.
//
// The table is where each value was chosen; the tracker is the record. Every
// write goes through the ticket door's `classify` command, which reads the
// ticket back and exits 1 if the value did not stick, so this script never
// reports a write it did not see land.
//
//   node scripts/spirality.mjs with-doppler node scripts/backfill_ticket_class.mjs \
//     --table docs/ticket-classes/starcaster-2026-11-16.tsv --door <clickup.mjs> [--apply]
//
// Without --apply it only says what it would change. A ticket whose three
// values already match is skipped, so a second run changes nothing.
// --door must be a ticket door that knows `classify` (Spirality's SP-345);
// by default, Spirality's own door (lib/spirality.cjs finds it, SC-870).
// Exit: 0 every row matches (or would be written), 1 a write did not stick or
// the tickets could not be read, 2 bad arguments or a bad table.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const KINDS = ['feature', 'fix', 'operational', 'documentation'];
const STARTERS = ['operator', 'client', 'agent'];
const OUTCOMES = ['done', 'wont-do', 'duplicate', 'test'];

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const apply = argv.includes('--apply');
const tablePath = arg('table');
const door = arg('door') || createRequire(import.meta.url)('../lib/spirality.cjs').spiralityPath('scripts/clickup.mjs');

function fail(code, msg) { console.error(msg); process.exit(code); }

if (!tablePath) fail(2, 'Say --table <file.tsv>. Nothing was read.');
if (!fs.existsSync(door) || !fs.readFileSync(door, 'utf8').includes("cmd === 'classify'")) {
  fail(2, `${door} is not a ticket door that knows "classify" (Spirality SP-345). Pass --door <path to Spirality's scripts/clickup.mjs>. Nothing was written.`);
}

// Read the table: id, kind, started_by, outcome, title. A bad row stops the
// whole run before anything is written.
function readTable(file) {
  const rows = [];
  const problems = [];
  for (const [n, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
    if (!line.trim() || line.startsWith('#') || line.startsWith('id\t')) continue;
    const [id, kind, startedBy, outcome = ''] = line.split('\t');
    if (!/^[A-Z]+-\d+$/.test(id || '')) problems.push(`line ${n + 1}: "${id}" is not a ticket id`);
    else if (!KINDS.includes(kind)) problems.push(`line ${n + 1} (${id}): kind "${kind}"`);
    else if (!STARTERS.includes(startedBy)) problems.push(`line ${n + 1} (${id}): started_by "${startedBy}"`);
    else if (outcome && !OUTCOMES.includes(outcome)) problems.push(`line ${n + 1} (${id}): outcome "${outcome}"`);
    else rows.push({ id, kind, startedBy, outcome: outcome || null });
  }
  const seen = new Set();
  for (const r of rows) { if (seen.has(r.id)) problems.push(`${r.id} appears twice`); seen.add(r.id); }
  return { rows, problems };
}

const { rows, problems } = readTable(tablePath);
if (problems.length) fail(2, `The table has ${problems.length} bad row(s), so nothing was written:\n  ${problems.join('\n  ')}`);

// One read of every ticket, closed ones included: what each holds now.
const listed = spawnSync(process.execPath, [door, 'tickets', '--json', '--include-closed'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (listed.status !== 0) fail(1, `Could not read the tickets (exit ${listed.status}):\n${listed.stderr.slice(-800)}\nNothing was written.`);
let current;
try { current = new Map(JSON.parse(listed.stdout).map((t) => [t.id, t])); } catch { fail(1, 'The ticket list did not come back as JSON. Nothing was written.'); }

let already = 0, set = 0;
const missing = [], openWithOutcome = [], failed = [];
for (const r of rows) {
  const t = current.get(r.id);
  if (!t) { missing.push(r.id); continue; }
  const isOpen = t.status !== 'live';
  if (isOpen && r.outcome) { openWithOutcome.push(`${r.id} (${t.status})`); continue; }
  const want = { kind: r.kind, 'started-by': r.startedBy, outcome: isOpen ? null : r.outcome };
  const have = { kind: t.kind ?? null, 'started-by': t.startedBy ?? null, outcome: t.outcome ?? null };
  const flags = [];
  for (const k of Object.keys(want)) if (want[k] !== have[k] && !(k === 'outcome' && isOpen)) flags.push(`--${k}`, want[k] ?? 'none');
  if (!flags.length) { already++; continue; }
  if (!apply) { console.log(`would set ${r.id}: ${flags.join(' ')}`); set++; continue; }
  const out = spawnSync(process.execPath, [door, 'classify', '--task', r.id, ...flags], { encoding: 'utf8' });
  if (out.status === 0) set++;
  else failed.push(`${r.id}: exit ${out.status}: ${(out.stderr || out.stdout).trim().split('\n').slice(-2).join(' ')}`);
}

const verb = apply ? 'set' : 'would set';
console.log(`\n${path.basename(tablePath)}: ${rows.length} row(s). ${verb} ${set}, already right ${already}, could not ${apply ? 'set' : 'check'} ${missing.length + openWithOutcome.length + failed.length}.`);
if (missing.length) console.log(`  not found in the tracker (${missing.length}): ${missing.join(', ')}`);
if (openWithOutcome.length) console.log(`  the table gives an ending to a ticket that is still open, so it was left alone (${openWithOutcome.length}): ${openWithOutcome.join(', ')}`);
if (failed.length) console.log(`  did not stick (${failed.length}):\n    ${failed.join('\n    ')}`);
if (!apply) console.log('  Nothing was written. Add --apply to write.');
process.exit(missing.length || openWithOutcome.length || failed.length ? 1 : 0);
