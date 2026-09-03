#!/usr/bin/env node
/**
 * `npm run repair` — the one repair entry point (task 86bbtnk3k).
 *
 *   npm run repair                     run all three steps, print, post nothing
 *   npm run repair -- --dry-run        every step dry (reconcile too), post nothing
 *   npm run repair -- --check          the scheduled shape: throttled to one
 *                                      fresh reading per 30 min, findings
 *                                      posted to the bus once per 6h, cleared
 *                                      by the next clean run
 *   npm run repair -- --check --force  take a fresh reading regardless
 *
 * Policy, order and the safety argument live in scripts/builder/repair.js —
 * in particular WHY the sweep step never gets --apply. This file only runs
 * the table and handles stamps and the post.
 *
 * Exit: 0 clean/repaired · 3 findings reported · 2 could not tell · 1 failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repair = require('./builder/repair.js');
const heartbeat = require('../lib/nodeHeartbeat.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const CHECK = flag('check');
const DRY = flag('dry-run');
const NOW = Date.now();

const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const STAMP_DIR = heartbeat.heartbeatDir();
const readStamp = path.join(STAMP_DIR, 'repair-read.stamp');
const postStamp = path.join(STAMP_DIR, 'repair-post.stamp');

const readFileMs = (f) => { try { return Date.parse(fs.readFileSync(f, 'utf8').trim()); } catch { return NaN; } };
const writeStamp = (f) => { try { fs.mkdirSync(STAMP_DIR, { recursive: true }); fs.writeFileSync(f, `${new Date(NOW).toISOString()}\n`); } catch { /* stamps are best-effort */ } };
const clearStamp = (f) => { try { fs.rmSync(f, { force: true }); } catch { /* likewise */ } };

// The scheduled throttle — taken BEFORE any read, so a throttled wake costs
// nothing at all (throughput's pattern).
if (CHECK && !flag('force') && !repair.readDue({ lastReadAtMs: readFileMs(readStamp), nowMs: NOW })) {
  console.log('Read within the last half hour — not asking ClickUp or GitHub again. (`--force` overrides.)');
  process.exit(0);
}
if (CHECK) writeStamp(readStamp);

function firstLineOf(out, step) {
  const all = [out.stdout, out.stderr].map((x) => String(x || '')).join('\n')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('>'));
  // The sweep opens with the pipeline banner; its FINDING line is the one a
  // reader needs on the step line.
  if (step && step.id === 'stranded') {
    const finding = all.find((l) => /stranded ticket/i.test(l));
    if (finding) return finding;
  }
  return all[0] || '(the step printed nothing)';
}

const meanings = [];
const lines = [];
for (const step of repair.STEPS) {
  // --dry-run downgrades the one writing step; the sweep is dry by CONSTRUCTION
  // (the table carries no --apply and the test refuses one), and pass-reconcile
  // has no dry form — in --dry-run it is skipped and said so, not run quietly.
  let args = [...step.npmArgs];
  if (DRY && step.id === 'drift') args = ['reconcile'];
  if (DRY && step.id === 'marker') {
    lines.push(`skip  ${step.id.padEnd(9)} --dry-run (pass-reconcile has no dry form; it moves a ticket or nothing)`);
    meanings.push('clean');
    continue;
  }
  const out = spawnSync('npm', ['run', '--silent', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const meaning = out.error ? 'failed' : repair.readStep(step, out.status);
  meanings.push(meaning);
  lines.push(repair.renderStepLine(step, meaning, out.error ? String(out.error.message || out.error) : firstLineOf(out, step)));
  // The sweep's full dry-run detail matters when it found something — it names
  // the tickets and the destinations. It rides UNDER its step line (collected
  // here, printed below), not interleaved above the report it belongs to.
  if (step.id === 'stranded' && meaning === 'findings') {
    const headline = lines[lines.length - 1];
    for (const l of String(out.stdout || '').split('\n').filter((l) => l.trim() && !/^The pipeline is/.test(l.trim()) && !headline.includes(l.trim()))) {
      lines.push(`      ${l.trim()}`);
    }
  }
}

for (const l of lines) console.log(l);
const outcome = repair.composeOutcome(meanings);
console.log(`REPAIR: ${outcome.word}${outcome.code === 3 ? ' — stranded work found; a decision is needed: `npm run pipeline -- sweep --apply` (or leave a hand session to finish)' : ''}`);

if (CHECK && !DRY) {
  const decision = repair.postDecision({ outcomeCode: outcome.code, lastPostedAtMs: readFileMs(postStamp), nowMs: NOW });
  if (decision.clear) clearStamp(postStamp);
  if (decision.post) {
    const body = [
      `[repair] ${outcome.word} on this wake (${new Date(NOW).toISOString()}):`,
      ...lines.map((l) => `- ${l}`),
      outcome.code === 3
        ? 'Stranded work is REPORTED, never auto-applied: the pass marker is the only machine-readable difference between a dead loop claim and a hand session mid-build (scripts/builder/repair.js says why). To act: `npm run pipeline -- sweep --apply`.'
        : 'A reading could not be taken or a step failed — this is not an all-clear.',
    ].join('\n');
    const posted = spawnSync('npm', ['run', '--silent', 'clickup', '--', 'chat', '--channel', BUS_CHANNEL, '--body-file', '-'], {
      encoding: 'utf8', input: body, stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (posted.status === 0) { writeStamp(postStamp); console.error('  (posted to the bus)'); }
    else console.error('  (the bus post FAILED — the finding above is only in this log)');
  } else {
    console.error(`  (no post: ${decision.why})`);
  }
}

process.exit(outcome.code);
