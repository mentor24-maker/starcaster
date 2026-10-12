#!/usr/bin/env node
'use strict';
/**
 * Suggest Approve or Reject, with reasons, for each undecided Substack Miner
 * writer in one project, from the decisions Dane has already made — the same
 * code POST /api/acquire/substack-miner/suggest calls
 * (lib/acquire/SubstackSuggestRun.js, task 86bch3f2v). One line per writer.
 * Nothing is decided here; only Dane's Agree on the Candidates tab does that.
 *
 * Usage:
 *   npm run substack-miner:suggest -- --project dane-of-earth
 *   npm run substack-miner:suggest -- --project dane-of-earth --redo
 *
 * --redo suggests again for writers that already have a suggestion. Each writer
 * is one paid AI call. It writes to whichever database this folder points at
 * (`npm run db:use` says which); for production, run it through Doppler:
 *   doppler run --project starcaster --config prd -- npm run substack-miner:suggest -- --project dane-of-earth
 *
 * Exit: 0 ran (whatever it suggested), 3 not enough decisions to learn from yet,
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
const { runSubstackSuggestions, formatSuggestSummary } = require(path.join(ROOT, 'lib/acquire/SubstackSuggestRun.js'));

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const projectArg = arg('project');
const redo = process.argv.includes('--redo');
if (!projectArg) {
  console.error('Usage: npm run substack-miner:suggest -- --project <id or slug> [--redo]');
  process.exit(1);
}
if (!isConfigured()) {
  console.error('Supabase is not configured in this folder. Run `npm run env:local` (local database) or run through Doppler.');
  process.exit(1);
}

const lookup = await sbQuery({
  table: 'app_projects',
  query: `select=id,name,slug,created_by_user_id&or=(id.eq.${encodeURIComponent(projectArg)},slug.eq.${encodeURIComponent(projectArg)})&limit=1`,
});
const project = lookup.ok && Array.isArray(lookup.data) ? lookup.data[0] : null;
if (!project) {
  console.error(`No project with the id or slug ${JSON.stringify(projectArg)}: ${lookup.ok ? 'no such row' : lookup.error}`);
  process.exit(1);
}

const scope = { projectId: project.id, userId: String(project.created_by_user_id || '') };
console.log(`Project: ${project.name} (${project.id})`);

const run = await runSubstackSuggestions(scope, { redo });
if (!run.ok) {
  console.error(`${run.status === 409 ? 'Not yet' : `Refused (${run.status})`}: ${run.error}`);
  process.exit(run.status === 409 ? 3 : 1);
}
for (const line of formatSuggestSummary(run.data)) console.log(line);
