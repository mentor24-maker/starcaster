#!/usr/bin/env node
/**
 * `npm run connections:verify` — the health sweep, on the command line.
 * Connections 6a of 7 (86bbpz1gv).
 *
 *   npm run connections:verify -- --project <id>              check one project
 *   npm run connections:verify -- --project <id> --dry-run    say what it WOULD write
 *   npm run connections:verify -- --project <id> --batch 5    a smaller batch
 *   npm run connections:verify -- --project <id> --once       one batch, then stop
 *
 * NOTHING SCHEDULES THIS. Wiring it to a timer is a separate operator step and
 * is deliberately not part of the ticket that built it: a cron added in the
 * same change as the thing it runs is a cron nobody has watched run by hand
 * first. `POST /api/connections/verify` is the same pass through the app.
 *
 * The LIBRARY does one batch and reports what remains — that shape exists
 * because a serverless invocation frozen mid-loop leaves half the work done
 * (lib/connections/verifySweep.js). This is a real machine with a real process,
 * so it may loop; it prints each batch as it goes, and `--once` matches the
 * serverless shape exactly if you want to see one.
 *
 * Exit: 0 every connection healthy · 3 something needs attention ·
 *       2 something could not be checked · 1 the sweep itself failed.
 * "Could not check" outranks "unhealthy" on purpose: an unknown is the answer
 * you must not read as either a pass or a fail.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const verifySweep = require('../lib/connections/verifySweep.js');
const projectConnectionsStore = require('../lib/projectConnectionsStore.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? String(argv[at + 1] || '').trim() : '';
};

const PROJECT = value('project') || String(process.env.PROJECT_ID || '').trim();
const DRY = flag('dry-run');
const ONCE = flag('once');
const BATCH = Number(value('batch')) || verifySweep.VERIFY_BATCH_SIZE;
/** A stop, not a policy: a runaway loop against a provider's API is expensive. */
const MAX_BATCHES = 50;

if (!PROJECT) {
  console.error('Which project? Pass --project <id> (or set PROJECT_ID).');
  console.error('A sweep with no project scope would touch every tenant\'s connections, so there is no default.');
  process.exit(1);
}

/**
 * A dry run must not write, and it must not pretend it did.
 *
 * The store is wrapped rather than the sweep being given a flag, so the read
 * path, the adapter calls and every decision are EXACTLY the ones a live run
 * makes — only the writes are intercepted. A rehearsal that takes a different
 * route through the code is a rehearsal of something else (task 86bbu4hd8 is
 * the same lesson on the throughput alarm).
 */
const store = DRY
  ? {
    ...projectConnectionsStore,
    updateConnectionStatus: async (input) => {
      console.log(`    [dry run] would write status="${input.status}"`
        + `${input.lastError ? ` lastError="${String(input.lastError).slice(0, 80)}"` : ''}`);
      return { ok: true, status: 200, data: null };
    },
    saveConnection: async () => {
      console.log('    [dry run] would re-store a refreshed token');
      return { ok: true, status: 200, data: null };
    },
  }
  : projectConnectionsStore;

const scope = { projectId: PROJECT };
let unhealthy = 0;
let couldNotCheck = 0;
let batches = 0;
let remaining = 1;

console.log(`Connections health sweep — project ${PROJECT}${DRY ? ' (DRY RUN — nothing is written)' : ''}`);

while (remaining > 0 && batches < MAX_BATCHES) {
  // eslint-disable-next-line no-await-in-loop
  const swept = await verifySweep.runVerifySweep({ scope, limit: BATCH, store });
  if (!swept.ok) {
    console.error(`FAILED: ${swept.error}`);
    process.exit(1);
  }
  batches += 1;
  const d = swept.data;
  console.log(`\nBatch ${batches}: looked at ${d.seen} of the ${d.due} due `
    + `(${d.total} connection(s) in total), ${d.remaining} still due`);
  for (const r of d.results) {
    const mark = r.healthy === true ? 'ok  ' : (r.healthy === false ? 'FAIL' : '????');
    console.log(`  ${mark} ${r.provider} / ${r.accountLabel} — ${r.status}: ${r.reason}`);
    if (r.drifted) {
      console.log(`       DRIFT: saved as ${r.previousIdentity?.label || r.previousIdentity?.id || '(unnamed)'}, `
        + `now ${r.currentIdentity?.label || r.currentIdentity?.id || '(unnamed)'}`);
    }
    if (r.written === false && r.writeError) console.log(`       could not record the outcome: ${r.writeError}`);
  }
  if (d.listCapped) {
    console.log(`  NOTE: this project holds at least ${verifySweep.SWEEP_LIST_LIMIT} connections, which is the most `
      + 'one sweep will count — "total" and "left" are floors, not the number.');
  }
  unhealthy += d.unhealthy;
  couldNotCheck += d.couldNotCheck;
  remaining = d.remaining;
  // A dry run never records that it checked anything, so the cursor never
  // moves and the same batch would come back forever. Say so and stop.
  if (ONCE || DRY) {
    if (DRY && remaining > 0) {
      console.log('\nStopping after one batch: a dry run writes nothing, so the "least recently checked" '
        + 'cursor never moves and every batch after this one would be the same rows.');
    }
    break;
  }
}

if (batches >= MAX_BATCHES && remaining > 0) {
  console.log(`\nStopped at ${MAX_BATCHES} batches with ${remaining} still unchecked — run it again.`);
}

console.log(`\n${unhealthy} needing attention, ${couldNotCheck} that could not be checked, `
  + `across ${batches} batch(es).`);
if (couldNotCheck > 0) process.exit(2);
if (unhealthy > 0) process.exit(3);
process.exit(0);
