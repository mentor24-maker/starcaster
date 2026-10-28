#!/usr/bin/env node
'use strict';
/**
 * The Mini's scheduled Substack Notes search, for EVERY project with Substack
 * Miner keywords: one keyword's Notes search through the signed-in OpenClaw
 * browser, then Miner Suggest (lib/acquire/SubstackNotesSearchDue.js, Outreach
 * wizard 14/19). launchd runs it every six hours through
 * scripts/run_substack_notes_search.sh; run it by hand the same way:
 *
 *   doppler run --scope ~/Studio --project starcaster --config prd -- node scripts/substack_notes_search_due.mjs
 *   ... node scripts/substack_notes_search_due.mjs --any-hour      # even outside the active hours
 *
 * For one project and a chosen keyword, use `npm run substack-miner:search-notes`.
 *
 * It talks only to the OpenClaw gateway on THIS machine, and refuses to start
 * if a saved setting would send the gateway token anywhere else
 * (workers/youtube-outreach/poster.js configureOpenClaw).
 *
 * Exit: 0 at least one project searched and none failed; 1 a search refused or
 * failed for at least one project — signed out, the browser down, an answer it
 * could not read — or the project list or the keyword walk could not be read or
 * saved; 4 NOTHING was searched (every project outside its active hours, or no
 * project has keywords). A failed search is never "found nothing", and a pass
 * that searched nothing is not a clean pass: the runner records no beat for
 * either, so a schedule that never searches goes stale on the roll call.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** Nothing was due: no beat, and no failure post either. */
const NOTHING_SEARCHED = 4;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
  dotenv.config({ path: path.join(ROOT, '.env.local'), override: false, quiet: true });
} catch { /* no dotenv: the environment must already carry the settings */ }

const { isConfigured } = require(path.join(ROOT, 'lib/supabase.js'));
const { configureOpenClaw } = require(path.join(ROOT, 'workers/youtube-outreach/poster.js'));
const { formatSearchSummary } = require(path.join(ROOT, 'lib/acquire/SubstackNotesSearch.js'));
const { runNotesSearchDue, formatSearchDueLog } = require(path.join(ROOT, 'lib/acquire/SubstackNotesSearchDue.js'));

console.log(`=== substack-notes-search ${new Date().toISOString()}`);
if (!isConfigured()) {
  console.error('Supabase is not configured here. Run it through Doppler (see the header of this file).');
  process.exit(1);
}
const openclaw = configureOpenClaw(process.env);
if (!openclaw.ok) {
  console.error(`No search: ${openclaw.why}`);
  process.exit(1);
}

const run = await runNotesSearchDue({ anyHour: process.argv.includes('--any-hour') });
if (!run.ok) {
  console.error(run.error);
  process.exit(1);
}
console.log(formatSearchDueLog(run.data, { formatSearchSummary }));
if (run.data.failed) process.exit(1);
process.exit(run.data.searched ? 0 : NOTHING_SEARCHED);
