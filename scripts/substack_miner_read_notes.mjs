#!/usr/bin/env node
'use strict';
/**
 * Read every approved Substack Miner writer's newest Notes for one project and
 * line up a like and a reply for each newest one on the Substack Notes screen —
 * the same code POST /api/acquire/substack-miner/read-notes calls
 * (lib/acquire/SubstackNotesReadRun.js, Substack Miner 5/7). One line per
 * writer: "read 3 Notes …" or "skipped, read 2 days ago".
 *
 * Usage:
 *   npm run substack-miner:read-notes -- --project dane-of-earth
 *   npm run substack-miner:read-notes -- --project dane-of-earth --any-hour
 *
 * --project takes the project's id or its slug. --any-hour reads even outside
 * the Substack account's active hours (a by-hand try). It needs no browser and
 * no Substack sign-in: the Notes come from Substack's public feed. It writes to
 * whichever database this folder points at (`npm run db:use` says which); for
 * production, run it through the prd Doppler config:
 *   doppler run --project starcaster --config prd -- npm run substack-miner:read-notes -- --project dane-of-earth
 *
 * Exit: 0 read (whatever it found), 3 not now (outside the active hours),
 * 1 refused or failed — the line above says why.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

// The same settings files server.js reads, so this talks to the same database
// the app in this folder does. dotenv is a dev dependency; absent is fine.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
  dotenv.config({ path: path.join(ROOT, '.env.local'), override: false, quiet: true });
} catch { /* no dotenv: the environment must already carry the settings */ }

const { sbQuery, isConfigured } = require(path.join(ROOT, 'lib/supabase.js'));
const { runSubstackNotesRead, formatReadSummary } = require(path.join(ROOT, 'lib/acquire/SubstackNotesReadRun.js'));

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const projectArg = arg('project');
const anyHour = process.argv.includes('--any-hour');
if (!projectArg) {
  console.error('Usage: npm run substack-miner:read-notes -- --project <id or slug> [--any-hour]');
  process.exit(1);
}
if (!isConfigured()) {
  console.error('Supabase is not configured in this folder. Run `npm run env:local` (local database) or run through Doppler.');
  process.exit(1);
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

const run = await runSubstackNotesRead({ anyHour }, scope, { projectTimeZone: async () => String(project.timezone || '') });
if (!run.ok) {
  console.error(`${run.status === 409 ? 'Not now' : `Refused (${run.status})`}: ${run.error}`);
  process.exit(run.status === 409 ? 3 : 1);
}
console.log(formatReadSummary(run.data));
