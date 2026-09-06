#!/usr/bin/env node
/**
 * HOW BIG SHOULD THE RESERVE BE? — the measurement, not the guess
 * (2026-09-04, task 86bbugd8j).
 *
 * The ticket set this as its FIRST acceptance criterion, in as many words:
 * "The reserve size is NOT measured. 75/25 is a starting proposal, not a
 * finding." So this reads the evidence the machine has actually been writing
 * down for ten days and reports what is in it. Nobody has to trust a number
 * in a comment; they can re-run this.
 *
 * WHAT IT READS. The bus relay's launchd log. Every pass writes three things
 * this needs, and has since the one-door slice landed:
 *
 *     === bus-relay 2026-09-04 13:49:35 — <the checkout it ran in>
 *       requests this pass: 9 (ClickUp allows ~100/minute)
 *       ClickUp's own limit: 88 of 100 left this minute (resets in 52s)
 *
 * WHAT IT INFERS, and the one place it is approximate. For each pass:
 *
 *     other processes' spend in that minute  >=  limit - remaining - mine
 *
 * `limit - remaining` is what EVERYTHING spent against the token in that
 * minute; subtracting the relay's own pass leaves what everyone else spent.
 * It is a FLOOR, not an exact figure: if a pass straddles a minute reset then
 * some of `mine` was spent in the previous window, so the true concurrent load
 * was higher than this says. Understating it is the honest direction for a
 * number used to size a safety margin — it can only make the reserve look
 * smaller than it needs to be, never larger.
 *
 * WHAT IT CANNOT SEE, stated because it matters: the OTHER MACHINE. The
 * MacBook Pro spends against the same token and writes no log here. Its spend
 * is inside the "other processes" figure — that is precisely why the figure is
 * worth having — but it cannot be separated out from this side.
 *
 *   node scripts/measure_clickup_headroom.mjs [path-to-log]
 *
 * Default log: ~/Library/Logs/bus-relay-launchd.log
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_LOG = path.join(os.homedir(), 'Library', 'Logs', 'bus-relay-launchd.log');

/**
 * The parse, as a pure function over lines, so a test can drive it without a
 * log file. A pass counts only when BOTH its own request count and a
 * rate-limit reading are present and in that order — a half-parsed pass is
 * dropped rather than guessed at.
 */
export function parsePasses(lines) {
  const rows = [];
  let stamp = null;
  let mine = null;
  for (const line of lines) {
    let m = line.match(/^=== bus-relay (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/);
    if (m) { stamp = m[1]; mine = null; continue; }
    m = line.match(/^\s*requests this pass: (\d+)/);
    if (m) { mine = Number(m[1]); continue; }
    m = line.match(/ClickUp's own limit: (\d+) of (\d+) left this minute/);
    if (m && mine !== null) {
      const remaining = Number(m[1]);
      const limit = Number(m[2]);
      rows.push({ stamp, mine, remaining, limit, others: Math.max(0, limit - remaining - mine) });
      mine = null;
    }
  }
  return rows;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function line(label, values) {
  const at = (p) => String(percentile(values, p)).padStart(4);
  return `${label.padEnd(30)} min${at(0)}  p50${at(0.5)}  p90${at(0.9)}  p95${at(0.95)}  p99${at(0.99)}  max${at(1)}`;
}

function main() {
  const file = process.argv[2] || DEFAULT_LOG;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // CANNOT TELL, out loud, exit 2 — never a reassuring empty table.
    console.error(`CANNOT MEASURE — ${file} could not be read (${err.message}).`);
    console.error('This log only exists on the machine that runs the relay (the Mac Mini today).');
    process.exit(2);
  }
  const rows = parsePasses(text.split('\n'));
  if (!rows.length) {
    console.error(`CANNOT MEASURE — no complete relay passes found in ${file}.`);
    console.error('A pass counts only when it printed BOTH "requests this pass" and "ClickUp\'s own limit".');
    process.exit(2);
  }
  const mine = rows.map((r) => r.mine);
  const others = rows.map((r) => r.others);
  const remaining = rows.map((r) => r.remaining);

  console.log(`ClickUp headroom, measured from ${file}`);
  console.log(`${rows.length} complete relay pass(es), ${rows[0].stamp} .. ${rows[rows.length - 1].stamp}\n`);
  console.log(line('requests THIS pass spent', mine));
  console.log(line('remaining at end of pass', remaining));
  console.log(line('OTHER processes, same minute', others));
  console.log('\n"OTHER processes" is a FLOOR — a pass that straddled a minute reset understates it.');
  console.log('It includes the other machine, and the other scheduled jobs on this one.\n');

  console.log('What each candidate reserve would cost the relay:');
  for (const reserve of [0, 10, 20, 25, 30, 40]) {
    const allowance = 100 - reserve;
    const fits = mine.filter((v) => v <= allowance).length;
    console.log(`  reserve ${String(reserve).padStart(2)} -> ${String(allowance).padStart(3)} requests/minute for scheduled jobs; `
      + `${fits}/${mine.length} passes (${(100 * fits / mine.length).toFixed(1)}%) fit in one minute`);
  }
  console.log('\nAnd how often other processes needed more than a candidate reserve:');
  for (const reserve of [10, 20, 25, 30, 40]) {
    const over = others.filter((v) => v > reserve).length;
    console.log(`  reserve ${String(reserve).padStart(2)} -> exceeded in ${over}/${others.length} minutes (${(100 * over / others.length).toFixed(1)}%)`);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
