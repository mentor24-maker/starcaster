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
    'This script writes rows and must only ever touch the local stack. Run `npm run env:local` in this folder first.'
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
  // The platform list joined the manager family on 2026-08-15, and it is the
  // third module to need real rows here for the same reason: an empty list
  // renders no fields, so its lattice would be measured across nothing at all.
  // Two platforms, one of them missing its icon and its link, so the "Choose
  // From Gallery" button (the widest control in the grid) is on screen and the
  // tracks are measured against it.
  social: {
    name: 'Social',
    settings: {
      socialIconSize: '44',
      socialGap: '14',
      socialShowLabels: 'true',
      socialItems: JSON.stringify([
        {
          id: 'facebook', label: 'Facebook', href: 'https://facebook.com/delraytennis',
          iconUrl: '/images/icon-facebook.svg', backgroundColor: '#1877f2',
        },
        {
          id: 'instagram', label: 'Instagram', href: '', iconUrl: '', backgroundColor: '#c13584',
        },
      ]),
    },
  },
  // Same lesson as feature-cards, learned again on 2026-08-13: the Programs
  // manager shipped with a staggered, overlapping panel while `check:panels`
  // reported clean, because an empty module renders no fields and a group
  // with no pairs measured nothing. Two programs, carrying the longest
  // labels the manager has and both repeating grids populated, so the tracks
  // are real. `check_panels` now FAILS on an empty manager rather than
  // passing it, so this seed cannot quietly rot either.
  'program-list': {
    name: 'Programs',
    settings: {
      reservePhone: '(561) 243-7360',
      policyNote: 'All programs carry a 24-hour cancellation policy.',
      programs: JSON.stringify([
        {
          id: 'program-1', title: 'Back to Basics',
          subtitle: 'Drills and intermediate king of the court',
          levelBadge: '3.0 - 3.5 Players',
          sessions: [
            { id: 's1', day: 'Tuesday', startTime: '7:00 PM', endTime: '8:30 PM', instructor: 'Zach Schneider' },
            { id: 's2', day: 'Thursday', startTime: '7:00 PM', endTime: '8:30 PM', instructor: 'Vincent Williams' },
          ],
          pricing: [{ id: 'p1', amount: '$30', appliesTo: 'members & non-members' }],
          bullets: [],
        },
        {
          id: 'program-2', title: 'Sunday Morning Mixer',
          subtitle: 'with Jeff Kantor',
          levelBadge: '3.0 - 5.0 Players',
          sessions: [{ id: 's1', day: 'Sunday', startTime: '10:00 AM', endTime: '12:00 PM' }],
          pricing: [
            { id: 'p1', amount: '$20', appliesTo: 'members' },
            { id: 'p2', amount: '$25', appliesTo: 'non-members' },
          ],
          bullets: ['Progressive mixed doubles', 'Winners move up, losers move down'],
        },
      ]),
    },
  },
  // The carousel, both formats. Same lesson as feature-cards and
  // program-list: its item manager ships EMPTY from createEmptyModule, so
  // without real items here the check finds the grid, measures nothing and
  // passes. Captions ON, because the item sub-row's other four fields are
  // gated behind that toggle and would otherwise never be measured — the
  // exact "a control the check cannot see is a control the rule does not
  // cover" hole. Two items, one missing its link, so the widest control in
  // the grid (Choose From Gallery) is on screen against a real track.
  // Drop shadow ON for the same reason captions are: the six shadow controls
  // added 2026-08-16 only render once the box is ticked, so an unticked
  // fixture measures the Image Border strip at half its width and reports OK
  // on controls it never saw.
  carousel: {
    name: 'Slideshow',
    settings: {
      format: 'slideshow',
      showCaptions: 'true',
      captionPosition: 'bottom-left',
      heightPx: '420',
      imageBorderWidth: '6',
      imageShadow: 'true',
      items: JSON.stringify([
        {
          id: 'item-1', title: 'Junior Tennis Programs', body: 'Camps, clinics and private lessons all summer.',
          // Real files in public/, not the plausible-looking paths the older
          // seeds use: a 404 image collapses to a 20px broken icon, so a frame
          // that takes its height from its picture measures nothing.
          imageUrl: '/images/Gemini_Generated_starcaster_banner.png', imageAlt: 'Junior players gathered at the net',
          linkUrl: '/delray-champions-junior-tennis-high-performance', linkLabel: 'See the schedule',
          icon: '', iconImageUrl: '',
        },
        {
          id: 'item-2', title: 'Court Fees & Lesson Prices', body: 'Resident and guest rates.',
          imageUrl: '/images/background_galaxy_1920x1080.jpg', imageAlt: 'Clay courts at sunrise',
          linkUrl: '', linkLabel: '', icon: '', iconImageUrl: '',
        },
      ]),
    },
  },
  // The standalone image module. It was seeded before 2026-08-16 the way
  // every type is — straight out of `createEmptyModule`, so with no picture,
  // no link and no effect. That is how its panel drifted into five separate
  // mini-layouts stacked above its axis columns with every check green: an
  // empty module renders half its controls, and a control the check cannot
  // see is a control the rule does not cover.
  // `effect: 'tumbleweed'` is the same point at field level — Rotation Rate
  // is visibleWhen-gated behind a rotating effect and would never be measured
  // with the effect left at None.
  image: {
    name: 'Court Photo',
    settings: {
      url: '/images/Gemini_Generated_starcaster_banner.png',
      alt: 'Clay courts at sunrise',
      linkUrl: '/delray-champions-junior-tennis-high-performance',
      newTab: 'true',
      size: '50',
      alignment: 'center',
      paddingTop: '10', paddingBottom: '10', paddingLeft: '20', paddingRight: '20',
      marginTop: '10', marginBottom: '10', marginLeft: '5', marginRight: '5',
      horizontalOffset: '4', verticalOffset: '-4',
      borderThickness: '4', borderColor: '#0f4f8f', borderRadius: '20',
      effect: 'tumbleweed', effectRotationRate: '40', effectFrequency: '6',
      effectBounceHeight: '150', effectDirection: 'rtl',
      effectSpeed: '16', effectRepeat: 'once', effectDelay: '2',
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
  // The rich-text module's Structure / Text / Placement / Frame axes
  // (2026-08-15). Every frame and spacing setting is non-default and no field
  // is visibleWhen-gated, so all four columns render every control the panel
  // has — including "Paragraph Gap", which is the longest label on the Text
  // axis and therefore the one that sets its track. Real body copy, because
  // an empty module measures nothing and passes.
  text: {
    name: 'Pro Shop',
    text: '<p><strong>Visit our <a href="/pro-shop">Pro Shop</a> for racket stringing and all your tennis and pickleball needs.</strong></p><p>Stringing, grips, demo racquets and a full pickleball wall.</p>',
    settings: {
      size: '66', alignment: 'center',
      lineHeight: '1.2', paragraphGap: '4',
      marginTop: '10', marginBottom: '10', marginLeft: '5', marginRight: '5',
      paddingTop: '15', paddingBottom: '15', paddingLeft: '20', paddingRight: '20',
      horizontalOffset: '4', verticalOffset: '-4',
      borderStyle: 'dashed', borderWidth: '2', borderColor: '#0f4f8f', borderRadius: '10',
      backgroundColor: '#eaf3e2',
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
  // Bug Report module (task 4/5): the floating icon + popup. Every setting
  // non-default and nothing visibleWhen-gated except the block colour, which
  // is ON here so the Frame strip renders its full width. The label text is
  // the longest control on the Content axis and sets that track.
  'bug-report': {
    name: 'Bug Report (floating, staff only)',
    settings: {
      visibility: 'staff', emailReports: 'true', icon: 'ladybug', corner: 'bottom-left', iconSize: '55',
      iconBlock: 'true', blockColor: '#7a1f3d', iconColor: '#fff4e6', labelText: 'Report a problem',
      popupTitle: 'Tell us what broke', promptPlaceholder: 'What happened, and what did you expect?',
      thankYouMessage: 'Got it — thank you for helping us fix this.',
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
  modules: [
    ...BUILDER_MODULE_TYPES.map((type) => {
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
    // A SECOND menu, in Mega Panel mode. Half the Panel controls (Columns,
    // Width, Placement) are `visibleWhen: isMegaMenu`, so the list-mode menu
    // above hides them and the check would report a pass over fields it never
    // measured — the exact hole this file exists to close. One module per
    // type is the floor, not the ceiling.
    (() => {
      const base = createEmptyModule('navigation', 'main');
      return {
        ...base,
        id: 'module-panel-check-navigation-mega',
        name: 'Top Menu (Mega Panel)',
        settings: {
          ...base.settings,
          ...TUNED.navigation.settings,
          navDropdownStyle: 'mega',
          navMegaPlacement: 'menu',
        },
      };
    })(),
    // A THIRD menu, on CUSTOM sizing. The Links list grows a fifth column
    // ("Width") only under this setting, so the two menus above render the
    // four-column shape and a check over them says nothing at all about the
    // five-column one. Same hole as the mega panel above it: a variant that
    // never renders is a variant nobody is measuring. Widths that sum under
    // 100 so the manager is not also showing its over-budget warning.
    (() => {
      const base = createEmptyModule('navigation', 'main');
      return {
        ...base,
        id: 'module-panel-check-navigation-custom-width',
        name: 'Top Menu (Custom Widths)',
        settings: {
          ...base.settings,
          ...TUNED.navigation.settings,
          navItemSizing: 'custom',
          navItems: JSON.stringify([
            { id: 'home', label: 'Home', href: '/', width: '25' },
            { id: 'play', label: 'Play', href: '/play', width: '25' },
            { id: 'book', label: 'Book a Court', href: '/book', parentId: 'play' },
            { id: 'about', label: 'About', href: '/about', width: '25' },
          ]),
        },
      };
    })(),
    // A SECOND proximity-effect module, on a CONTINUOUS preset. Rings is the
    // default, and Reach and Falloff are `visibleWhen: isContinuous`, so the
    // module above renders neither and the check measured a panel two fields
    // short while reporting a clean pass. Caught by dumping the field names
    // the run actually saw rather than by trusting the green line — same hole
    // as the mega-panel menu and the cards carousel around it.
    (() => {
      const base = createEmptyModule('tractor-nav', 'main');
      return {
        ...base,
        id: 'module-panel-check-tractor-nav-glow',
        name: 'Proximity Effect (Glow)',
        settings: {
          ...base.settings,
          effect: 'glow',
          reach: '460',
          falloff: '2',
        },
      };
    })(),
    // A SECOND carousel, in the cards format. `format` decides which controls
    // exist — Card Width appears, Transition and the whole Captions group
    // vanish — so the slideshow module above can only ever measure half of
    // this panel. Same reasoning as the mega-panel menu directly above.
    (() => {
      const base = createEmptyModule('carousel', 'main');
      return {
        ...base,
        id: 'module-panel-check-carousel-cards',
        name: 'Card Slider',
        settings: {
          ...base.settings,
          ...TUNED.carousel.settings,
          format: 'cards',
          cardWidth: '280',
          gap: '16',
        },
      };
    })(),
  ],
};

/**
 * A SHARED SECTION AND ITS COPIES — so the block-state chip has something to
 * be, on screen, where a check and a person can both see it.
 *
 * Three of the chip's four states need real data behind them: a master to
 * follow, a copy whose content matches it, and a copy whose content does not.
 * Without this the fixture holds nothing canonical at all and every header in
 * it reads "Independent" — a clean pass over the one state that needs no data
 * to get right, which is the same hole that let two panels ship measured-but-
 * unseen (see PANEL_CHECK_SECTION above).
 *
 * The master and the Following copy are built from ONE function so their
 * content is byte-identical. `hasSectionDrifted` compares
 * `JSON.stringify(getSectionContent(...))`, so key ORDER decides the answer —
 * two hand-written literals that merely look alike would read as drifted.
 */
const SHARED_SECTION_ID = 'saved-section-fixture-menu-banner';
const SHARED_SECTION_NAME = '2 - Menu Banner';
const SHARED_SECTION_TEXT = '<p>Book a court, join a clinic, or meet the pros.</p>';

function sharedSectionBody(text) {
  return {
    title: 'Menu Banner',
    layout: 'single',
    locked: false,
    alignment: 'left',
    widthMode: 'contained',
    modules: [
      {
        ...createEmptyModule('text', 'main'),
        id: 'module-shared-banner-text',
        name: 'Banner copy',
        text,
      },
    ],
  };
}

/** A copy on a page. `canonical: true` is what makes it Following. */
function sharedSectionCopy(id, text) {
  return { id, savedSectionId: SHARED_SECTION_ID, canonical: true, ...sharedSectionBody(text) };
}

const SHARED_SECTION_MASTER = { id: SHARED_SECTION_ID, ...sharedSectionBody(SHARED_SECTION_TEXT) };

/** Chip: Independent. Same shape, linked to nothing. */
const UNLINKED_SECTION = {
  id: 'section-independent-copy',
  ...sharedSectionBody('<p>This block belongs to this page and nothing else.</p>'),
  title: 'Local Notice',
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
  // Two pages follow the same master, so the lineage line reads "2 pages" and
  // exercises the plural path rather than the "1 page" special case.
  ['Block States', 'block-states', [
    sharedSectionCopy('section-following-copy', SHARED_SECTION_TEXT),
    sharedSectionCopy('section-changed-copy', '<p>Hand-edited here, on this page only.</p>'),
    UNLINKED_SECTION,
  ]],
  ['Block States (second follower)', 'block-states-second', [
    sharedSectionCopy('section-following-copy-2', SHARED_SECTION_TEXT),
  ]],
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
const savedSectionsTable = tableConfig().builderSavedSections;
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

/**
 * The saved-section master the Block States page follows.
 *
 * Rewritten on every seed for the same reason the check page is: a master
 * somebody hand-edited locally would make the Following copy read as Changed,
 * and the fixture would then be measuring the opposite of what it claims.
 *
 * BOTH project_id and owner_user_id are stamped — a tenant-scoped table that
 * carries only one of them takes rows with no tenant at all (CLAUDE.md
 * landmine 12), and this table has both columns precisely so it does not.
 */
async function seedSharedSectionMaster() {
  const row = {
    id: SHARED_SECTION_ID,
    name: SHARED_SECTION_NAME,
    section: SHARED_SECTION_MASTER,
    project_id: project.id,
    owner_user_id: userId,
    updated_at: new Date().toISOString(),
  };
  const found = await sbQuery({
    method: 'GET', table: savedSectionsTable,
    query: `select=id&id=eq.${encodeURIComponent(SHARED_SECTION_ID)}&limit=1`,
  });
  if (!found.ok) {
    console.error(`  failed to look up the shared section master: ${found.error}`);
    return false;
  }
  const res = (found.data || []).length
    ? await sbQuery({
        method: 'PATCH', table: savedSectionsTable,
        query: `id=eq.${encodeURIComponent(SHARED_SECTION_ID)}`, body: row,
      })
    : await sbQuery({ method: 'POST', table: savedSectionsTable, body: row });
  if (!res.ok) {
    console.error(`  failed to seed the shared section master: ${res.error}`);
    return false;
  }
  return true;
}

const sharedSectionSeeded = await seedSharedSectionMaster();

/**
 * Pages are written as `{ sections: [...] }`, NOT as a bare array.
 *
 * Both shapes load and render, which is what makes the bare one dangerous:
 * `coerceLayoutInput` (lib/builder/document.js) only rescues the fields
 * `normalizeLayoutSections` whitelists away — `savedSectionId`, `canonical`,
 * `locked`, the saved-module links — when the input is the wrapped shape.
 * Seeded as a bare array, a section written here as a canonical copy comes
 * back from the server with no lineage at all and every block header reads
 * "Independent". The fixture has to be the shape production actually stores.
 */
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
      body: { layout_sections: { sections }, updated_at: new Date().toISOString() },
    });
    if (!res.ok) { console.error(`  failed to refresh ${slug}: ${res.error}`); continue; }
    refreshed += 1;
    continue;
  }
  const res = await sbQuery({
    method: 'POST', table: pagesTable, query: 'select=id',
    body: {
      name, slug, project_id: project.id, template_kind: 'modular',
      is_published: true, layout_sections: { sections }, updated_at: new Date().toISOString(),
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
// Said out loud rather than swallowed: without the master, the Block States
// page shows three Independent headers and a check over it proves nothing.
console.log(
  sharedSectionSeeded
    ? `shared section "${SHARED_SECTION_NAME}" seeded — Block States shows Following / Changed / Independent.`
    : 'WARNING: the shared section master was NOT seeded; every block header will read Independent.'
);
console.log(`export UI_HARNESS_PROJECT_ID=${project.id}`);
