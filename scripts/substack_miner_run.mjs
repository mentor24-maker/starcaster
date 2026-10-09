#!/usr/bin/env node
'use strict';
/**
 * Run the Substack Miner web-search pass for one project from the terminal and
 * print its summary — the same code POST /api/acquire/substack-miner/run calls
 * (lib/acquire/SubstackMinerRun.js, Substack Miner 2/7). It exists so the pass
 * can be tried without a signed-in browser cookie.
 *
 * Usage:
 *   node scripts/substack_miner_run.mjs --project dane-of-earth
 *   node scripts/substack_miner_run.mjs --project dane-of-earth --keywords "Game B,metamodern"
 *
 * --project takes the project's id or its slug. Without --keywords it searches
 * the project's saved keyword list. It writes candidates to whichever database
 * this folder points at (`npm run db:use` says which), and needs a search key:
 * BRAVE_API_KEY, or the Google pair. The dev Doppler config carries one:
 *   doppler run --project starcaster --config dev -- node scripts/substack_miner_run.mjs --project dane-of-earth
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
const { runSubstackMinerSearch } = require(path.join(ROOT, 'lib/acquire/SubstackMinerRun.js'));

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const projectArg = arg('project');
const keywordsArg = arg('keywords');
if (!projectArg) {
  console.error('Usage: node scripts/substack_miner_run.mjs --project <id or slug> [--keywords "one,two"]');
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
const input = keywordsArg ? { keywords: keywordsArg.split(',').map((k) => k.trim()).filter(Boolean) } : {};
console.log(`Project : ${project.name} (${project.id})`);
console.log(`Keywords: ${input.keywords ? input.keywords.join(', ') : '(the saved list)'}`);

const run = await runSubstackMinerSearch(input, scope);
if (!run.ok) {
  console.error(`\nRefused (${run.status}): ${run.error}`);
  process.exit(1);
}
console.log(JSON.stringify(run.data, null, 2));
const s = run.data;
console.log(`\n${s.engine}: ${s.resultsSeen} results, ${s.droppedNotSubstack} not a Substack publication, `
  + `${s.handlesFound} writers — ${s.added} added, ${s.merged} already listed, `
  + `${s.unreadablePages.length} front page(s) not read, ${s.searchErrors.length} search(es) failed`
  + (s.keywordsNotSearched.length ? `, ${s.keywordsNotSearched.length} keyword(s) not searched (out of time).` : '.'));
