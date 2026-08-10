#!/usr/bin/env node
/**
 * Seed the LOCAL database with a project whose content is deliberately
 * hostile to layout, so the screen checks exercise something.
 *
 * WHY THE DATA IS UGLY ON PURPOSE
 * Every layout bug found on 2026-08-09/10 needed real content to appear.
 * An empty table fits any viewport, so a check run against an empty local
 * database reports a confident pass and means nothing — that happened, and
 * cost a rerun. The fixture therefore carries the shapes that actually
 * broke things: 100-character page titles, hyphen-monster slugs, accented
 * characters, and rows with fields left empty.
 *
 * The project is created through the same store the app uses, so the owner
 * membership is created too. Seeding rows into a project the signed-in user
 * is not a member of leaves every screen empty — also learned the hard way.
 *
 * SAFETY
 * Refuses to run unless SUPABASE_URL points at localhost. This writes rows;
 * it must never touch the cloud database.
 *
 * USAGE
 *   node scripts/ui/seed_fixture.mjs            # create or refresh
 *   node scripts/ui/seed_fixture.mjs --clean    # delete the fixture project's pages
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));

require('dotenv').config({ path: path.join(ROOT, '.env.local'), quiet: true });

const { sbQuery, tableConfig } = require(path.join(ROOT, 'lib/supabase.js'));
const projectsStore = require(path.join(ROOT, 'lib/projectsStore.js'));

const CLEAN = process.argv.includes('--clean');
const PROJECT_NAME = process.env.UI_HARNESS_PROJECT || 'UI Harness Fixture';
const OWNER_EMAIL = process.env.UI_HARNESS_EMAIL || 'mentor24@gmail.com';

const supabaseUrl = String(process.env.SUPABASE_URL || '');
if (!/localhost|127\.0\.0\.1/.test(supabaseUrl)) {
  console.error(
    `Refusing to seed: SUPABASE_URL is "${supabaseUrl || '(unset)'}", which is not local.\n` +
    'This script writes rows and must only ever touch the local stack. Copy .env.local into the worktree first.'
  );
  process.exit(1);
}

const must = (res, what) => {
  if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || 'failed'}`);
  return res.data ?? res;
};

/** Content chosen to break layouts, not to look plausible. */
const PAGES = [
  ['Meet Brent Wellman, Junior Tennis Director of Delray Champions Junior Tennis & High Performance in Delray',
   'meet-brent-wellman-junior-tennis-director-of-delray-champions-junior-tennis-high-performance-in-delray'],
  ['The Delray Tennis Center is Looking for Players for our Women’s Team Tennis in all Divisions from 1-7',
   'the-delray-tennis-center-is-looking-for-players-for-our-womens-team-tennis-in-all-divisions-from-1-7'],
  ['Ürün Kataloğu — Übergrößen & Zubehör für Frühjahr', 'urun-katalogu-ubergrossen-zubehor-fur-fruhjahr'],
  ['Averyveryveryverylongunbrokenwordthatcannotwrapanywhere', 'unbrokenwordslugthatcannotwrapanywhereatall'],
  ['', 'empty-name-row'],
  ['Short', 's'],
  ['Court Fees', 'course-fees'],
];

async function findOwnerUserId() {
  const table = String(process.env.SUPABASE_AUTH_USERS_TABLE || 'app_auth_users').trim();
  const res = await sbQuery({
    method: 'GET', table,
    query: `select=id,email&email=eq.${encodeURIComponent(OWNER_EMAIL)}&limit=1`,
  });
  if (!res.ok) throw new Error(`look up ${OWNER_EMAIL}: ${res.error}`);
  const row = (res.data || [])[0];
  if (!row) throw new Error(`No local user ${OWNER_EMAIL}. Sign in once against the local app first.`);
  return String(row.id);
}

async function findFixtureProject(userId) {
  const res = must(await projectsStore.listProjectsForUser(userId), 'list projects');
  const list = Array.isArray(res) ? res : res.projects || [];
  return list.find((p) => p.name === PROJECT_NAME) || null;
}

const userId = await findOwnerUserId();
let project = await findFixtureProject(userId);

if (!project) {
  project = must(
    await projectsStore.createProjectForUser(
      { name: PROJECT_NAME, description: 'Deliberately awful content for the UI layout checks.' },
      userId
    ),
    'create fixture project'
  );
  // createProjectForUser may return {project} or the row itself.
  project = project.project || project;
  console.log(`created fixture project ${project.id}`);
} else {
  console.log(`reusing fixture project ${project.id}`);
}

const pagesTable = tableConfig().builderPages;
const existing = must(
  await sbQuery({
    method: 'GET', table: pagesTable,
    query: `select=id,slug&project_id=eq.${encodeURIComponent(project.id)}&limit=500`,
  }),
  'list fixture pages'
);

if (CLEAN) {
  for (const row of existing) {
    await sbQuery({ method: 'DELETE', table: pagesTable, query: `id=eq.${row.id}` });
  }
  console.log(`deleted ${existing.length} fixture page(s). Done.`);
  process.exit(0);
}

const have = new Set(existing.map((r) => r.slug));
let created = 0;
for (const [name, slug] of PAGES) {
  if (have.has(slug)) continue;
  const res = await sbQuery({
    method: 'POST', table: pagesTable, query: 'select=id',
    body: {
      name, slug, project_id: project.id, template_kind: 'modular',
      is_published: true, layout_sections: [], updated_at: new Date().toISOString(),
    },
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) { console.error(`  failed ${slug}: ${res.error}`); continue; }
  created += 1;
}

console.log(`fixture ready: ${PROJECT_NAME} (${project.id}) — ${created} page(s) created, ${existing.length} already present.`);
console.log(`export UI_HARNESS_PROJECT_ID=${project.id}`);
