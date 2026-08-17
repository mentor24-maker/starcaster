#!/usr/bin/env node
'use strict';
/**
 * Scaffold a tenant's admin back-end — the admin-* Builder pages.
 *
 * All the thinking lives in lib/projectAdminScaffold.js; this is the operator's
 * handle on it. The same library is what the "creating the first admin user
 * scaffolds the area" trigger will call, so anything fixed here is fixed there.
 *
 * SAFETY
 * - Dry run by default. Nothing is written without --apply.
 * - Never edits an existing page: a slug that already exists is skipped and
 *   reported, so re-running cannot overwrite hand-styling.
 * - Never saves a saved-section master, so it cannot propagate into other pages.
 * - Writes a JSON record of what it created to docs/SQL/backups/ on --apply.
 *   (There is nothing to back UP — it only ever adds — so the record exists to
 *   tell you what to delete if you want it gone.)
 *
 * Usage:
 *   node scripts/scaffold_project_admin_area.mjs --project proj_xxx
 *   node scripts/scaffold_project_admin_area.mjs --project proj_xxx --apply
 *   node scripts/scaffold_project_admin_area.mjs --project proj_xxx --only admin-login,admin-dashboard
 *
 * Against production, run it through Doppler so it uses the production keys:
 *   doppler run --project starcaster --config prd -- node scripts/scaffold_project_admin_area.mjs --project proj_xxx
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

const { scaffoldProjectAdminArea } = require(path.join(ROOT, 'lib/projectAdminScaffold.js'));
const { sbQuery, isConfigured } = require(path.join(ROOT, 'lib/supabase.js'));

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const APPLY = process.argv.includes('--apply');
const projectId = arg('project');
const only = arg('only')
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean);

if (!projectId) {
  console.error('Usage: node scripts/scaffold_project_admin_area.mjs --project <projectId> [--apply] [--only slug,slug]');
  process.exit(1);
}

if (!isConfigured()) {
  console.error('Supabase is not configured in this environment. Run through Doppler, or set SUPABASE_URL / SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

// The whole row, deliberately. getPublicProjectById selects a narrow column set
// and defaults enabled_modules to { crm: true }, which would silently skip the
// blog manager on a project that has the blog switched on.
const projectResult = await sbQuery({
  table: 'app_projects',
  query: `select=*&id=eq.${encodeURIComponent(projectId)}&limit=1`,
});
const project = projectResult.ok && Array.isArray(projectResult.data) ? projectResult.data[0] : null;
if (!project) {
  console.error(`Project ${projectId} not found: ${projectResult?.error || 'no such project'}`);
  process.exit(1);
}

const ownerUserId = String(project.created_by_user_id || '');
const enabledModules = project.enabled_modules && typeof project.enabled_modules === 'object'
  ? project.enabled_modules
  : {};

console.log(`\nProject : ${project.name} (${projectId})`);
console.log(`Domain  : ${project.domain || project.website || '(none)'}`);
console.log(`Modules : ${Object.entries(enabledModules).filter(([, on]) => on === true).map(([key]) => key).join(', ') || '(none enabled)'}`);
console.log(`Mode    : ${APPLY ? 'APPLY — this writes to the database' : 'dry run — nothing will be written'}\n`);

const report = await scaffoldProjectAdminArea(
  { projectId, ownerUserId, enabledModules, dryRun: !APPLY, only },
  { projectId, userId: ownerUserId }
);

for (const note of report.notes) console.log(`note: ${note}`);

if (report.adminHeader) {
  const { id, created, builtFrom, menuItems } = report.adminHeader;
  console.log(
    created
      ? `\nAdmin Header saved section ${APPLY ? 'created' : 'would be created'} (${id}), built from "${builtFrom}"`
      : `\nAdmin Header saved section already exists (${id}) — reused`
  );
  if (menuItems) console.log(`  admin menu: ${menuItems.join(' · ')}`);
  if (report.adminHeader.droppedTypes?.length) {
    console.log(`  left out of the admin header (visitor-facing): ${report.adminHeader.droppedTypes.join(', ')}`);
  }
}

console.log(`\n${APPLY ? 'Created' : 'Would create'} ${report.created.length} page(s):`);
for (const page of report.created) {
  console.log(`  ${page.slug.padEnd(22)} ${page.isPrivate ? 'private' : 'PUBLIC '}  ${page.chrome} chrome  ${page.sectionCount} sections`);
  console.log(`  ${''.padEnd(22)} modules: ${page.moduleTypes.join(', ')}${page.id ? `  → page id ${page.id}` : ''}`);
}

if (report.skipped.length) {
  console.log(`\nSkipped ${report.skipped.length}:`);
  for (const item of report.skipped) console.log(`  ${item.slug.padEnd(22)} ${item.reason}`);
}

if (APPLY && report.created.length) {
  const dir = path.join(ROOT, 'docs/SQL/backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `admin_scaffold_${projectId}_${stamp}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nRecord of what was created: ${path.relative(ROOT, file)}`);
}

if (!APPLY) console.log('\nNothing was written. Re-run with --apply to create these pages.');
console.log('');
