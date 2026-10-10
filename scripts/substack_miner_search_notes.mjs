#!/usr/bin/env node
'use strict';
/**
 * Search Substack Notes for ONE of a project's Substack Miner keywords, through
 * the Mini's signed-in OpenClaw browser, and add the writers it finds as
 * candidates (Substack Miner 6/7, lib/acquire/SubstackNotesSearch.js). Run it
 * ON the Mini — the browser is there.
 *
 * Usage:
 *   npm run substack-miner:search-notes -- --project dane-of-earth --keyword polymath
 *   npm run substack-miner:search-notes -- --project dane-of-earth            # this hour's keyword
 *   npm run substack-miner:search-notes -- --project dane-of-earth --any-hour
 *
 * --project takes the project's id or its slug. Without --keyword the list is
 * walked one keyword per hour. --any-hour searches even outside the Substack
 * account's active hours (a by-hand try). It prints the keyword, how many Notes
 * were read, and how many writers were added. It writes to whichever database
 * this folder points at (`npm run db:use` says which); for production, run it
 * through the prd Doppler config:
 *   doppler run --project starcaster --config prd -- npm run substack-miner:search-notes -- --project dane-of-earth --keyword polymath
 *
 * It talks only to the OpenClaw gateway on THIS machine, and refuses to start
 * if a saved setting would send the gateway token anywhere else
 * (workers/youtube-outreach/poster.js configureOpenClaw).
 *
 * Exit: 0 searched (whatever it found), 3 not now (outside the active hours),
 * 1 refused — signed out, signed in as someone else, no such keyword — and
 * 2 no reading (OpenClaw down, or an answer it could not read). The line above
 * the exit says which.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
  dotenv.config({ path: path.join(ROOT, '.env.local'), override: false, quiet: true });
} catch { /* no dotenv: the environment must already carry the settings */ }

const { sbQuery, isConfigured } = require(path.join(ROOT, 'lib/supabase.js'));
const { configureOpenClaw } = require(path.join(ROOT, 'workers/youtube-outreach/poster.js'));
const { runNotesSearchPass, formatSearchSummary } = require(path.join(ROOT, 'lib/acquire/SubstackNotesSearch.js'));

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const projectArg = arg('project');
const keyword = arg('keyword');
const anyHour = process.argv.includes('--any-hour');
if (!projectArg) {
  console.error('Usage: npm run substack-miner:search-notes -- --project <id or slug> [--keyword <word>] [--any-hour]');
  process.exit(1);
}
if (!isConfigured()) {
  console.error('Supabase is not configured in this folder. Run `npm run env:local` (local database) or run through Doppler.');
  process.exit(1);
}
const openclaw = configureOpenClaw(process.env);
if (!openclaw.ok) {
  console.error(`No reading: ${openclaw.why}`);
  process.exit(2);
}

const lookup = await sbQuery({
  table: 'app_projects',
  query: `select=id,name,slug,timezone,created_by_user_id&or=(id.eq.${encodeURIComponent(projectArg)},slug.eq.${encodeURIComponent(projectArg)})&limit=1`,
});
const project = lookup.ok && Array.isArray(lookup.data) ? lookup.data[0] : null;
if (!project) {
  console.error(`No project with the id or slug ${JSON.stringify(projectArg)}: ${lookup.ok ? 'no such row' : lookup.error}`);
  process.exit(1);
}

const scope = { projectId: project.id, userId: String(project.created_by_user_id || '') };
console.log(`Project: ${project.name} (${project.id})`);

const run = await runNotesSearchPass({ keyword, anyHour }, scope, { projectTimeZone: async () => String(project.timezone || '') });
if (!run.ok) {
  if (run.keyword) console.error(`Keyword: "${run.keyword}"`);
  if (run.status === 409) {
    console.error(`Not now: ${run.error}`);
    process.exit(3);
  }
  console.error(run.error);
  process.exit(run.status === 502 ? 2 : 1);
}
console.log(formatSearchSummary(run.data));
