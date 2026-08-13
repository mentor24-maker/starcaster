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
const { BUILDER_MODULE_TYPES, createEmptyModule } = require(path.join(ROOT, 'lib/builder/template.js'));
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

/**
 * The page `check_panels.mjs` measures. It has to be SEEDED, not hand-built:
 * until 2026-08-11 the lattice check ran against a page somebody had made by
 * hand in their own local database, so "does Heading obey W0?" could only be
 * answered on that one machine — and when Heading joined the lattice the
 * check reported a confident pass across six Table panels while measuring no
 * heading at all. A browser-checked rule with an unreproducible fixture is
 * the honour system with extra steps.
 *
 * BUILT FROM THE TYPE LIST, not hand-listed (2026-08-13). The lattice is
 * universal now, so the fixture must carry one module of EVERY type — and a
 * hand-maintained roster is the same failure one step later: add a module
 * type, forget the fixture, and the check passes on a panel it never saw.
 * `BUILDER_MODULE_TYPES` is the single source; a type cannot exist without
 * appearing here.
 *
 * TUNED[type] overrides the factory defaults where a module needs awkward
 * content to be worth measuring — the longest labels, a shadow turned on,
 * an offsets block. Everything else takes `createEmptyModule`.
 */
const TUNED = {
  // Navigation's "Dropdown" sub-section is where the axis-section lattice
  // broke when the menu joined it (its six fields started at x=0 while the
  // rest of Structure started at 125). Also the widest labels in the app:
  // "Horizontal Padding" and "Shadow Opacity".
  navigation: {
    name: 'Top Menu',
    settings: {
      navItems: JSON.stringify([
        { id: 'home', label: 'Home', href: '/' },
        { id: 'play', label: 'Play', href: '/play' },
        { id: 'book', label: 'Book a Court', href: '/book', parentId: 'play' },
        { id: 'about', label: 'About', href: '/about' },
      ]),
      navDirection: 'horizontal', navDropdownStyle: 'list', navLevels: '2',
      navItemSizing: 'auto', menuName: 'Main Menu', menuLocation: 'primary',
    },
  },
  // The card manager runs its own lattice (L6a) and is measured as a group
  // by check_panels. It ships EMPTY from createEmptyModule, so without cards
  // here the check finds the group, measures nothing and passes — which is
  // precisely what happened on 2026-08-12: a clean run was read as proof the
  // new card layout obeyed W0, and it had never been measured at all. Two
  // cards, with the longest labels the manager has, so the tracks are real.
  'feature-cards': {
    name: 'Feature Cards',
    settings: {
      iconType: 'image',
      cards: JSON.stringify([
        {
          id: 'card-1', title: 'Court Fees & Lesson Prices', body: 'Rates, resident and guest.',
          linkUrl: '/delray-beach-tennis-center-court-fees', linkLabel: 'See Prices',
          imageUrl: '/images/courts.jpg', imageAlt: 'Clay courts at sunrise',
          icon: '★', iconImageUrl: '/images/icon-racquet.svg',
        },
        {
          id: 'card-2', title: 'Junior Tennis Programs', body: 'Camps and lessons.',
          linkUrl: '/juniors', linkLabel: 'Learn More',
          imageUrl: '/images/juniors.jpg', imageAlt: 'Junior players gathered at the net',
          icon: '●', iconImageUrl: '/images/icon-ball.svg',
        },
      ]),
    },
  },
  table: {
    name: 'Contact Strip',
    settings: {
      columns: '3', columnsCount: '3', rowsCount: '4', alignment: 'center',
      // A cell with a module in it: the cell editor is its own lattice
      // surface (a modal), and it is where the `label.field` pairs live —
      // the shape that hid from the check until 2026-08-12.
      tableData: JSON.stringify({
        headers: ['Phone', 'Hours', 'Status'],
        rowCount: 1,
        cells: {
          '0-0': [{
            id: 'cell-image', type: 'image', column: '0-0', name: 'Cell Image', text: '',
            settings: { url: '', alt: '', size: '100', linkUrl: '', newTab: 'false' },
          }],
        },
      }),
      borderColor: '#cccccc', borderWidth: '1', borderThickness: '1',
      cellPadding: '8', tableMaxWidth: '600', verticalMargin: '0',
      backgroundColor: '#ffffff',
    },
  },
  // An EYEBROW heading with its shadow on: the longest labels in the panel
  // ("Horizontal Margin", "Shadow Blur") and the offsets block, which is
  // where the lattice broke when Heading first joined it.
  heading: {
    name: 'Eyebrow Heading',
    text: 'Delray Beach • Public Tennis • Two Locations',
    settings: {
      variant: 'eyebrow', level: 'h6', fontSize: '14', fontWeight: '800',
      textAlign: 'left', textTransform: 'uppercase', lineHeight: '1.2', letterSpacing: '0',
      dropShadow: 'true', dropShadowColor: '#0b2a4a',
      dropShadowX: '3', dropShadowY: '3', dropShadowBlur: '2',
    },
  },
};

const PANEL_CHECK_SECTION = {
  id: 'section-panel-lattice-check',
  title: 'Panel Lattice Check',
  layout: 'single',
  locked: false,
  alignment: 'left',
  widthMode: 'contained',
  modules: BUILDER_MODULE_TYPES.map((type) => {
    const base = createEmptyModule(type, 'main');
    const tuned = TUNED[type] || {};
    return {
      ...base,
      id: `module-panel-check-${type}`,
      name: tuned.name ?? type,
      text: tuned.text ?? base.text ?? '',
      settings: { ...base.settings, ...(tuned.settings || {}) },
    };
  }),
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
  ['Panel Lattice Check', 'panel-lattice-check', [PANEL_CHECK_SECTION]],
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

const bySlug = new Map(existing.map((r) => [r.slug, r]));
let created = 0;
let refreshed = 0;
for (const [name, slug, sections = []] of PAGES) {
  const row = bySlug.get(slug);
  if (row) {
    // A page that carries modules is REWRITTEN on every seed. The empty
    // pages exist only to be listed, so leaving them alone protects any
    // hand-made edits; the check page is a fixture and must be exactly
    // what this file says, or the panel check silently measures something
    // else — which is how Heading went unmeasured on 2026-08-11.
    if (!sections.length) continue;
    const res = await sbQuery({
      method: 'PATCH', table: pagesTable, query: `id=eq.${row.id}`,
      body: { layout_sections: sections, updated_at: new Date().toISOString() },
    });
    if (!res.ok) { console.error(`  failed to refresh ${slug}: ${res.error}`); continue; }
    refreshed += 1;
    continue;
  }
  const res = await sbQuery({
    method: 'POST', table: pagesTable, query: 'select=id',
    body: {
      name, slug, project_id: project.id, template_kind: 'modular',
      is_published: true, layout_sections: sections, updated_at: new Date().toISOString(),
    },
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) { console.error(`  failed ${slug}: ${res.error}`); continue; }
  created += 1;
}

console.log(
  `fixture ready: ${PROJECT_NAME} (${project.id}) — ${created} page(s) created, ` +
  `${refreshed} refreshed, ${existing.length} already present.`
);
console.log(`export UI_HARNESS_PROJECT_ID=${project.id}`);
