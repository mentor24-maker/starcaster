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
const crmConfigStore = require(path.join(ROOT, 'lib/crmConfigStore.js'));
const crmFormsStore = require(path.join(ROOT, 'lib/crmFormsStore.js'));

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
 *
 * EVERY PANEL GETS CONTENT, not just the ones with an obvious list (added
 * 2026-08-22). Two things kept panels invisible to `check_panels`:
 *   1. an item manager with no items renders no fields, so the check found
 *      the group, measured nothing and passed — the exact hole that let the
 *      Feature Cards and Programs panels ship staggered in August; and
 *   2. a `visibleWhen` gate left at its default hides whole strips, so a
 *      green run is a green run over half a panel.
 * So the rule here is: seed the list, AND open the gate. Where a panel's
 * fields live behind a database row rather than a setting (the two CRM
 * panels), `ensureCrm` below creates the row and its id is threaded in.
 */
const LONG = 'Delray Beach Tennis Center — Junior High Performance Academy, Adult Clinics & Sunday Mixers';

/**
 * `ids` carries the database rows the fixture had to create before the page
 * could reference them: `{ crmConfigId, crmFormId }`. A module whose panel
 * gates on one of these gets it from here rather than from a hard-coded
 * string, because the ids are generated per machine.
 */
const buildTuned = (ids) => ({
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
      visibility: 'staff', icon: 'ladybug', corner: 'bottom-left', iconSize: '55',
      iconBlock: 'true', blockColor: '#7a1f3d', iconColor: '#fff4e6', labelText: 'Report a problem',
      popupTitle: 'Tell us what broke', promptPlaceholder: 'What happened, and what did you expect?',
      thankYouMessage: 'Got it — thank you for helping us fix this.',
    },
  },

  // ---------------------------------------------------------------------
  // The rest of the sweep (2026-08-22). Everything below was previously
  // seeded straight out of `createEmptyModule`, which meant its panel was
  // measured with empty text boxes and every gated strip hidden.
  // ---------------------------------------------------------------------

  // A cell with a module in it: the cell editor is its own lattice surface
  // (a modal), and it is where the `label.field` pairs live — the shape that
  // hid from the check until 2026-08-12. THREE cells now, of three different
  // types and in three different columns: the editor only exists where a
  // cell HAS a module, and one empty-settings image module measured a cell
  // editor full of blank boxes. Four columns and three rows, so the grid the
  // Rows/Columns selects report is not the 1×3 minimum either.
  table: {
    name: 'Contact Strip',
    settings: {
      columns: '4', columnsCount: '4', rowsCount: '3', alignment: 'center',
      showColumnHeads: 'true',
      tableData: JSON.stringify({
        headers: ['Phone', 'Hours', 'Status', 'Court Fees & Guest Rates'],
        rowCount: 3,
        cells: {
          '0-0': [{
            id: 'cell-image', type: 'image', column: '0-0', name: 'Cell Image', text: '',
            settings: {
              url: '/images/Gemini_Generated_starcaster_banner.png',
              alt: 'Clay courts at sunrise', size: '100',
              linkUrl: '/delray-champions-junior-tennis-high-performance', newTab: 'true',
            },
          }],
          '1-2': [{
            id: 'cell-heading', type: 'heading', column: '1-2', name: 'Cell Heading',
            text: LONG,
            settings: { variant: 'eyebrow', level: 'h6', fontSize: '14', textAlign: 'left' },
          }],
          '2-3': [{
            id: 'cell-text', type: 'text', column: '2-3', name: 'Cell Text',
            text: '<p>Resident and guest rates, posted at the desk.</p>',
            settings: { size: '100', alignment: 'left' },
          }],
        },
      }),
      borderColor: '#cccccc', borderWidth: '1', borderThickness: '1',
      cellPadding: '8', tableMaxWidth: '600', verticalMargin: '0',
      backgroundColor: '#ffffff',
    },
  },

  breadcrumb: {
    name: 'Breadcrumb',
    settings: {
      separator: '›', alignment: 'left', bold: 'true', fontSize: '13',
      items: JSON.stringify([
        { id: 'crumb-1', label: 'Home', url: '/' },
        { id: 'crumb-2', label: LONG, url: '/delray-champions-junior-tennis-high-performance' },
        { id: 'crumb-3', label: 'Court Fees', url: '/delray-beach-tennis-center-court-fees' },
      ]),
    },
  },

  'blog-toc': {
    name: 'On This Page',
    settings: {
      showTitle: 'true', title: 'On This Page', style: 'numbered',
      indentSubheadings: 'true', fontSize: '14',
      items: JSON.stringify([
        { id: 'toc-1', label: LONG, anchor: 'junior-high-performance-academy', depth: 1 },
        { id: 'toc-2', label: 'Court fees', anchor: 'court-fees', depth: 2 },
        { id: 'toc-3', label: 'Booking a court', anchor: 'booking', depth: 1 },
      ]),
    },
  },

  'blog-category-filter': {
    name: 'Category Filter',
    settings: {
      showAll: 'true', allLabel: 'All Programs', filterParam: 'category',
      targetPageUrl: '/blog', layout: 'pills', alignment: 'left', gap: '8',
      categories: JSON.stringify([
        { id: 'cat-1', label: LONG, slug: 'junior-high-performance-academy' },
        { id: 'cat-2', label: 'Adult Clinics', slug: 'adult-clinics' },
      ]),
    },
  },

  'blog-tag-cloud': {
    name: 'Tag Cloud',
    settings: {
      filterParam: 'tag', targetPageUrl: '/blog', showCounts: 'true',
      layout: 'cloud', alignment: 'left', minFontSize: '11', maxFontSize: '22',
      tags: JSON.stringify([
        { id: 'tag-1', label: LONG, slug: 'junior-high-performance-academy', count: 12 },
        { id: 'tag-2', label: 'Pickleball', slug: 'pickleball', count: 3 },
      ]),
    },
  },

  // `tags` here is a comma-separated string, not JSON — the two tag panels
  // do NOT share a shape, and seeding JSON into this one renders one tag
  // named `[{"id":...`. Worth the second look before copying the line above.
  'blog-post-tags': {
    name: 'Post Tags',
    settings: {
      linkToFilter: 'true', filterParam: 'tag', targetPageUrl: '/blog',
      showPrefix: 'true', prefix: 'Filed under',
      tags: `${LONG}, pickleball, junior tennis, round robin`,
      layout: 'pills', fontSize: '13', gap: '8',
    },
  },

  // `matchBy: manual` is the gate on the whole manual-post list; left at its
  // default the list does not render and the panel is three strips shorter.
  'blog-related-posts': {
    name: 'Related Posts',
    settings: {
      showTitle: 'true', title: LONG, matchBy: 'manual',
      layout: 'grid', columns: '3', cardGap: '16',
      showFeaturedImage: 'true', showExcerpt: 'true', showAuthor: 'true',
      showDate: 'true', showCategories: 'true',
      imageAspectRatio: '16:9', cardStyle: 'shadow',
      manualPosts: JSON.stringify([
        {
          id: 'rel-1', title: LONG,
          imageUrl: '/images/Gemini_Generated_starcaster_banner.png',
          url: '/delray-champions-junior-tennis-high-performance',
          date: 'Jun 20, 2026', categories: 'Juniors, High Performance',
        },
        {
          id: 'rel-2', title: 'Sunday Morning Mixer',
          imageUrl: '/images/background_galaxy_1920x1080.jpg',
          url: '/sunday-mixer', date: 'Jul 4, 2026', categories: 'Adults',
        },
      ]),
    },
  },

  'blog-author-bio': {
    name: 'Author Bio',
    settings: {
      name: 'Brent Wellman', title: LONG,
      bio: 'Junior Tennis Director. Twenty years on clay, three USTA sectional titles.',
      avatarUrl: '/images/Gemini_Generated_starcaster_banner.png',
      avatarShape: 'circle', avatarSize: '96', layout: 'horizontal',
      socialLinks: JSON.stringify([
        { id: 'link-1', platform: 'website', url: 'https://delraybeachtenniscenter.com/coaches/brent-wellman' },
        { id: 'link-2', platform: 'instagram', url: 'https://instagram.com/delraytennis' },
      ]),
    },
  },

  'blog-post-card': {
    name: 'Post Card',
    settings: {
      title: LONG,
      excerpt: 'Camps, clinics and private lessons all summer, on eight clay courts.',
      author: 'Brent Wellman', date: 'Jun 20, 2026',
      categories: 'Juniors, High Performance, Clay',
      url: '/delray-champions-junior-tennis-high-performance',
      imageUrl: '/images/Gemini_Generated_starcaster_banner.png',
      cardLayout: 'vertical', imageAspectRatio: '16:9',
      showFeaturedImage: 'true', showExcerpt: 'true', showAuthor: 'true',
      showDate: 'true', showCategories: 'true',
      showReadMore: 'true', readMoreLabel: 'Read the whole programme',
      cardStyle: 'shadow', cardBorderRadius: '12',
    },
  },

  'blog-post-list': {
    name: LONG,
    settings: {
      postTitle: LONG, postsPerPage: '9', layout: 'grid', columns: '3', cardGap: '16',
      showSearch: 'true', showCategoryFilter: 'true', showTagFilter: 'true',
      showAuthorFilter: 'true', showDateFilter: 'true',
    },
  },

  'blog-post': {
    name: 'Blog Post',
    text: LONG,
    settings: { title: LONG, slug: 'junior-high-performance-academy' },
  },

  'blog-post-create': {
    name: 'New Post Form',
    settings: {
      showFormTitle: 'true', formTitle: LONG,
      submitLabel: 'Publish this post', draftLabel: 'Save as draft',
      afterSubmitHeader: 'Posted', successMessage: 'Your post is live.',
      redirectAfterCreate: '/blog', defaultStatus: 'draft', allowStatusChange: 'true',
      fieldsHeader: 'Fields on the form',
      showSlug: 'true', showFeaturedImage: 'true', showExcerpt: 'true',
      showAuthorField: 'true', showCategories: 'true', showTags: 'true',
      showSeoFields: 'true',
    },
  },

  'blog-post-manager': {
    name: 'Post Manager',
    settings: {
      viewPageUrl: '/blog', editPageUrl: '/blog-post-edit',
      showStatus: 'true', showDate: 'true', showDelete: 'true',
      accentColor: '#0f4f8f',
    },
  },

  'blog-category-manager': {
    name: 'Category Manager',
    settings: {
      showDescription: 'true', showColor: 'true', showSortOrder: 'true',
      showDelete: 'true', accentColor: '#0f4f8f',
    },
  },

  'blog-search': {
    name: 'Blog Search',
    settings: {
      placeholder: LONG, buttonLabel: 'Search the blog',
      searchParam: 'q', targetPageUrl: '/blog-search-results', borderRadius: '20',
    },
  },

  'blog-search-results': {
    name: 'Blog Search Results',
    settings: {
      searchParam: 'q', postPageUrl: '/blog-post-view', limit: '20',
      thumbWidth: '120', emptyMessage: LONG,
    },
  },

  'blog-newsletter-subscribe': {
    name: 'Newsletter',
    settings: {
      headline: LONG,
      description: 'One email a month: court closures, clinic dates, league sign-ups.',
      showImage: 'true', imageUrl: '/images/Gemini_Generated_starcaster_banner.png',
      layout: 'inline',
    },
  },

  'site-search': {
    name: 'Site Search',
    settings: {
      placeholder: LONG, showButton: 'true', buttonLabel: 'Search this site',
      searchParam: 'q', targetPageUrl: '/site-search-results',
    },
  },

  'site-search-results': {
    name: 'Site Search Results',
    settings: {
      searchParam: 'q', limit: '25', showSearchField: 'true',
      placeholder: LONG, buttonLabel: 'Search again',
      showResultCount: 'true', showMatchLocation: 'true', showOtherMatches: 'true',
      emptyMessage: 'Nothing matched. Try a court name or a coach.',
    },
  },

  // `destinationType: custom` is what reveals BOTH the target page and the
  // filter-parameter field; at the default only one of the two renders.
  'messaging-tag-list': {
    name: 'Message Tags',
    settings: {
      destinationType: 'custom', targetPageUrl: '/messages',
      filterParam: 'tag', layout: 'cloud', gap: '8', maxTags: '24',
      minFontSize: '11', maxFontSize: '22',
    },
  },

  'messaging-topic-list': {
    name: 'Message Topics',
    settings: {
      showAll: 'true', allLabel: LONG, filterParam: 'topic',
      targetPageUrl: '/messages', layout: 'pills', gap: '8',
      fontSize: '14', borderRadius: '20', moduleBorderWidth: '2',
    },
  },

  // The two CRM panels gate on a DATABASE row, not a setting: with no form
  // id the whole "Form Appearance" block is absent and the panel measures
  // four controls. `ensureCrm` creates the row; the id arrives via `ids`.
  'crm-form': {
    name: 'Contact Form',
    settings: { crmFormId: ids.crmFormId, alignment: 'center' },
  },

  'crm-contacts-table': {
    name: 'Contacts',
    settings: {
      crmConfigId: ids.crmConfigId,
      showTitle: 'true', tableTitle: LONG,
      showAddButton: 'true', addButtonLabel: 'Add a new contact record',
      rowsPerPage: '25', showSearch: 'true',
      showViewButton: 'true', showEditButton: 'true', showDeleteButton: 'true',
    },
  },

  // `sound` off hides the volume control — the one gated field in the panel.
  confetti: {
    name: 'Confetti',
    settings: {
      particleCount: '120', spread: '70', originX: '50', originY: '40',
      zIndex: '60', sound: 'pop', popVolume: '70',
    },
  },

  // `flips` on purpose, NOT the image module's `tumbleweed`. Tumbleweed
  // travels, rotates and hops, so it reveals every effect field at once and
  // the panel is never measured with any of them hidden. Flips hops and spins
  // without travelling, so Direction / Speed / Repeat / Delay are absent here
  // — the half of the panel the image module above cannot show.
  'floating-image': {
    name: 'Floating Image',
    settings: {
      url: '/images/background_galaxy_1920x1080.jpg',
      alt: LONG,
      size: '40', overlayAnchor: 'bottom-right', offsetX: '24',
      effect: 'flips', effectRotationRate: '20',
      effectFrequency: '5', effectBounceHeight: '120',
      borderThickness: '3', borderColor: '#0f4f8f', borderRadius: '16',
    },
  },

  button: {
    name: 'Book a Court',
    settings: {
      text: 'Book a court on the reservation system',
      href: '/delray-beach-tennis-center-court-reservations',
      buttonSize: 'large', fontSize: '18', bold: 'true', underline: 'true',
      alignment: 'center', textColor: '#ffffff', buttonHoverColor: '#0b3a6b',
      borderStyle: 'solid', borderWidth: '2', borderColor: '#0f4f8f', borderRadius: '24',
    },
  },

  'speech-bubble': {
    name: 'Speech Bubble',
    text: LONG,
    settings: {
      text: LONG,
      containerWidth: '420', containerHeight: '180',
      offsetX: '12', offsetY: '-8', zIndex: '40',
      backgroundColor: '#ffffff', borderColor: '#0f4f8f', borderThickness: '3',
      textColor: '#0b2a4a',
    },
  },

  // `tractor-nav` already gets a second, CONTINUOUS module below; this is
  // the rings default with every ring control turned up so the linear-sizing
  // branch renders rather than the curve one.
  'tractor-nav': {
    name: 'Proximity Effect (Rings)',
    settings: {
      dotUrl: '/delray-champions-junior-tennis-high-performance',
      dotNewTab: 'true', effect: 'rings', dotSize: '18',
      ringCount: '4', sizingMode: 'linear', ringStep: '14',
      placement: 'anchored', posX: '30', posY: '60', zIndex: '35',
      innerOpacity: '80', opacityStep: '12', transition: '200',
    },
  },

  'headline-rotator': {
    name: 'Headline Rotator',
    text: [LONG, 'Eight clay courts, open to the public', 'Junior camps all summer'].join('\n'),
    settings: {
      fontSize: '34', bold: 'true', color: '#0b2a4a',
      displaySpeed: '2600', fadeDuration: '400', minHeight: '120',
      verticalAlignment: 'center',
      dropShadow: 'true', dropShadowColor: '#0b2a4a',
      dropShadowX: '2', dropShadowY: '2', dropShadowBlur: '4',
    },
  },

  'poll-category-list': {
    name: 'Poll Categories',
    text: LONG,
    settings: {
      listTitle: LONG, categoryListFlow: 'horizontal', categorySort: 'alpha',
      itemGap: '12', fontSize: '16', bold: 'true',
      color: '#0b2a4a', panelBorderColor: '#0f4f8f',
    },
  },

  'social-share': {
    name: 'Share',
    text: LONG,
    settings: {
      shareLabel: 'Share this page with a partner',
      shareTemplate: LONG,
      shareFallbackQuestion: 'Which court do you want?',
      shareHashtags: 'delraytennis,claycourts,juniortennis',
      shareVia: 'delraytennis',
      shareUrl: 'https://delraybeachtenniscenter.com/junior-high-performance',
      shareIconSize: '40', shareGlyphSize: '20', shareIconGap: '12',
      shareLabelSize: '15', shareIconBackground: '#0f4f8f',
    },
  },

  quote: { name: 'Quote', text: LONG },
  video: {
    name: 'Court Cam',
    text: LONG,
    settings: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', variant: 'video' },
  },
  code: {
    name: 'Embed',
    text: '<iframe src="https://example.com/court-availability" title="Court availability"></iframe>',
    settings: { label: LONG },
  },
  merch: { name: 'Merch', text: LONG },
  'contact-form': { name: 'Contact Form (legacy)', text: LONG },
  'player-portal': { name: 'Player Portal', text: LONG },
  'previous-results': { name: 'Previous Results', text: LONG },
  'current-poll': {
    name: 'Current Poll',
    text: LONG,
    settings: { alignment: 'center', size: '80' },
  },

  // TWO reminder records, and this one comes with a caveat worth reading
  // before ticket 11/15 trusts a green run: the record cards are COLLAPSED by
  // default (`isRecordCollapsed` returns true until clicked) and
  // `check_panels.openPanels` does not click them, so seeding here makes the
  // panel real for a person opening it and does NOT make it measurable. The
  // reminder panel is still the one panel in the sweep the checker sees only
  // one field of. Making it measurable means teaching openPanels to expand a
  // record card, which is a change to the checker rather than the fixture.
  reminder: {
    name: 'Reminders',
    settings: {
      reminderRecordsJson: JSON.stringify([
        {
          id: 'reminder-signup-nudge', name: LONG,
          messageHtml: '<p>Create a free account to save your picks and earn points.</p>',
          appearance: 'speech_bubble', gameAudience: 'both', isActive: true, sortOrder: 0,
          criteriaLogic: 'and',
          criteria: [
            { id: 'polls-taken', type: 'polls_taken', value: { operator: 'gte', count: 1 } },
            { id: 'not-registered', type: 'registered', value: { registered: false } },
          ],
          backgroundColor: '#ffffff', borderColor: '#4cbb17', borderThickness: '2',
          containerWidth: '520', offsetX: '12', offsetY: '-8', zIndex: '46',
          stripPlacement: 'top',
        },
        {
          id: 'reminder-court-fees', name: 'Court Fees Reminder',
          messageHtml: '<p>Guest rates apply after your third visit this month.</p>',
          appearance: 'strip', gameAudience: 'registered', isActive: true, sortOrder: 1,
          criteriaLogic: 'or',
          criteria: [{ id: 'polls-taken-3', type: 'polls_taken', value: { operator: 'gte', count: 3 } }],
          backgroundColor: '#eaf3e2', borderColor: '#0f4f8f', borderThickness: '3',
          containerWidth: '640', offsetX: '0', offsetY: '0', zIndex: '48',
          stripPlacement: 'bottom',
        },
      ]),
    },
  },

  'admin-team-users': {
    name: 'Team',
    settings: {
      showTitle: 'true', tableTitle: LONG,
      showAddButton: 'true', addButtonLabel: 'Invite somebody to the team',
      showEditButton: 'true', showDeleteButton: 'true',
    },
  },
  'admin-modules': {
    name: 'Admin Modules',
    settings: { showTitle: 'true', tableTitle: LONG, showToggle: 'true' },
  },
  'admin-site-settings': {
    name: 'Site Settings',
    settings: { showTitle: 'true', panelTitle: LONG },
  },
  'admin-login': {
    name: 'Admin Login',
    settings: {
      formTitle: LONG, buttonText: 'Sign in to the tenant admin',
      showForgotPassword: 'true', successRedirect: '/admin',
    },
  },
  'admin-nav-link': {
    name: 'Admin Link',
    settings: { linkText: LONG, linkHref: '/admin' },
  },
  'admin-support-form': {
    name: 'Support',
    settings: {
      showContact: 'true', contactHeading: LONG,
      contactIntro: 'Reach the desk between 8am and 8pm, seven days.',
      showTitle: 'true', formTitle: 'Tell us what went wrong',
      buttonText: 'Send it to the desk', defaultPriority: 'normal',
      showHistory: 'true', historyTitle: 'Your previous requests',
      showScreenshot: 'true', layout: 'stacked',
    },
  },
});

const buildPanelCheckSection = (ids) => {
  const TUNED = buildTuned(ids);
  return {
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
    // A SECOND text module, in the PLAIN variant. `variant: 'plain'` swaps
    // the whole editor — BuilderSimpleTextModuleSettings instead of the rich
    // one — so the module above could never measure it, and it is the only
    // panel in the app that declares an `advanced` region. That region is
    // gated on having at least one visible advanced strip, so an unseeded
    // plain-text module is two whole columns the check has never opened.
    (() => {
      const base = createEmptyModule('text', 'main');
      return {
        ...base,
        id: 'module-panel-check-text-plain',
        name: 'Pro Shop (Plain Text)',
        text: LONG,
        settings: {
          ...base.settings,
          variant: 'plain',
          fontSize: '18', fontWeight: '600',
          lineHeight: '1.5', letterSpacing: '0.5',
          color: '#0b2a4a',
          alignment: 'left', size: '80',
        },
      };
    })(),
  ],
  };
};

/** Content chosen to break layouts, not to look plausible. */
const buildPages = (ids) => [
  ['Meet Brent Wellman, Junior Tennis Director of Delray Champions Junior Tennis & High Performance in Delray',
   'meet-brent-wellman-junior-tennis-director-of-delray-champions-junior-tennis-high-performance-in-delray'],
  ['The Delray Tennis Center is Looking for Players for our Women’s Team Tennis in all Divisions from 1-7',
   'the-delray-tennis-center-is-looking-for-players-for-our-womens-team-tennis-in-all-divisions-from-1-7'],
  ['Ürün Kataloğu — Übergrößen & Zubehör für Frühjahr', 'urun-katalogu-ubergrossen-zubehor-fur-fruhjahr'],
  ['Averyveryveryverylongunbrokenwordthatcannotwrapanywhere', 'unbrokenwordslugthatcannotwrapanywhereatall'],
  ['', 'empty-name-row'],
  ['Short', 's'],
  ['Court Fees', 'course-fees'],
  ['Panel Lattice Check', 'panel-lattice-check', [buildPanelCheckSection(ids)]],
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

/**
 * The two CRM panels are the only ones in the sweep whose fields live behind
 * a DATABASE row instead of a setting. `crm-form` renders its whole "Form
 * Appearance" block only once `crmFormId` names a form that exists, and
 * `crm-contacts-table` needs a config id for the same reason — so a fixture
 * that seeds neither leaves both panels at four visible controls and the
 * check reports a confident pass over the empty box.
 *
 * Written through the same stores the app uses, so the rows are tenanted the
 * way `scopedInsertRow` tenants them; the id is read back rather than assumed
 * (CLAUDE.md landmine 12 — an insert reporting success is not evidence the
 * row carries a project).
 */
async function ensureCrm(projectId, userId) {
  const scope = { projectId, userId };
  const CONFIG_NAME = 'UI Harness CRM';
  const FORM_NAME = 'UI Harness Contact Form';

  const configs = await crmConfigStore.listConfigs(scope);
  let config = (configs || []).find((c) => c.name === CONFIG_NAME) || null;
  if (!config) {
    config = await crmConfigStore.createConfig({
      name: CONFIG_NAME,
      standardFields: ['email', 'first_name', 'last_name', 'phone'],
      customFields: [
        { key: 'ntrp_rating', label: 'NTRP Rating', type: 'text', required: false },
        { key: 'preferred_court_surface', label: 'Preferred Court Surface', type: 'text', required: false },
      ],
    }, scope);
  }
  if (!config?.id) {
    console.error('  could not create the fixture CRM config — the two CRM panels will seed empty.');
    return { crmConfigId: '', crmFormId: '' };
  }

  const forms = await crmFormsStore.listForms(config.id, scope);
  let form = (forms || []).find((f) => f.name === FORM_NAME) || null;
  if (!form) {
    form = await crmFormsStore.createForm({
      crmConfigId: config.id,
      name: FORM_NAME,
      heading: LONG,
      submitLabel: 'Send it to the front desk',
      successMessage: 'Thank you — the desk has your details.',
      accentColor: '#0f4f8f',
      fields: [
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'ntrp_rating', label: 'NTRP Rating', type: 'text', required: false },
      ],
    }, scope);
  }
  if (!form?.id) {
    console.error('  could not create the fixture CRM form — the crm-form panel will seed empty.');
    return { crmConfigId: config.id, crmFormId: '' };
  }
  return { crmConfigId: config.id, crmFormId: form.id };
}

const ids = CLEAN ? { crmConfigId: '', crmFormId: '' } : await ensureCrm(project.id, userId);
if (!CLEAN) console.log(`CRM fixture: config ${ids.crmConfigId || '(none)'}, form ${ids.crmFormId || '(none)'}`);

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
for (const [name, slug, sections = []] of buildPages(ids)) {
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
