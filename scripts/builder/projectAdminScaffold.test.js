'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN_MENU_ITEMS,
  ADMIN_HEADER_SECTION_NAME,
  ADMIN_PAGE_BLUEPRINTS,
  scaffoldModuleTypes,
  buildAdminHeaderSection,
  adminHeaderDroppedTypes,
  adminMenuFor,
  findMenuFrameSection,
  planAdminPages,
  buildAdminPageSections,
  pickProjectFrame,
  pickProjectThemeId,
} = require('../../lib/projectAdminScaffold');

/**
 * Scaffolding a tenant's admin back-end.
 *
 * The failures worth guarding here are all silent ones. A module type the
 * server does not know is coerced to "text" on every page load, so the page
 * quietly destroys itself. A page written with the wrong sections shape writes
 * an empty page and reports success. A re-run that overwrote instead of
 * skipping would eat hand-styling with nothing in the output to say so.
 */

/* ── module type registration ─────────────────────────────────────────────── */

test('every module type the scaffold emits is known to the server template', () => {
  const { normalizeModuleType } = require('../../lib/builder/template.js');
  for (const type of scaffoldModuleTypes()) {
    assert.equal(
      normalizeModuleType(type),
      type,
      `"${type}" is not registered in lib/builder/template.js — the server would coerce it to "text" on every page load. Run: npm run build:builder-template`
    );
  }
});

test('the blueprint set is the Marinoff six, and only admin-login is public', () => {
  assert.deepEqual(
    ADMIN_PAGE_BLUEPRINTS.map((b) => b.slug),
    [
      'admin-login',
      'admin-dashboard',
      'admin-blog-manager',
      'admin-contact-manager',
      'admin-settings',
      'admin-support',
    ]
  );
  const publicOnes = ADMIN_PAGE_BLUEPRINTS.filter((b) => !b.isPrivate).map((b) => b.slug);
  // admin-login is the front door — a signed-out visitor must be able to reach
  // it. Every other admin page is private. Making the login page private locks
  // the tenant out of their own site.
  assert.deepEqual(publicOnes, ['admin-login']);
});

test('the login form sends people to the dashboard, which the scaffold also builds', () => {
  const makeId = idFactory();
  const login = ADMIN_PAGE_BLUEPRINTS.find((b) => b.slug === 'admin-login');
  const [section] = login.buildBody(makeId);
  const form = section.modules.find((m) => m.type === 'admin-login');
  const target = form.settings.successRedirect.replace(/^\//, '');
  assert.ok(
    ADMIN_PAGE_BLUEPRINTS.some((b) => b.slug === target),
    `admin-login redirects to /${target}, which no blueprint creates — signing in would land on "Coming soon"`
  );
});

/* ── the Admin Header ─────────────────────────────────────────────────────── */

function idFactory() {
  let n = 0;
  return () => `id${++n}`;
}

const publicHeader = () => ({
  id: 'section-public-header',
  title: 'Menu Banner',
  layout: 'one-three-one',
  background: { mode: 'color', color: '#072a59' },
  modules: [
    { id: 'm-logo', type: 'image', column: 'left', settings: { url: 'logo.png' } },
    {
      id: 'm-nav',
      type: 'navigation',
      column: 'center',
      settings: { menuName: 'Main Menu', navItems: '[{"label":"Home","href":"home"}]', navBold: 'true' },
    },
    { id: 'm-signin', type: 'button', column: 'right', settings: { href: '/admin-login', label: 'Sign In' } },
  ],
});

test('the Admin Header keeps the site design and swaps in the admin menu', () => {
  const section = buildAdminHeaderSection(publicHeader(), { makeId: idFactory() });

  assert.equal(section.title, ADMIN_HEADER_SECTION_NAME);
  // The look is the project's own — not a generic header dropped on the tenant.
  assert.deepEqual(section.background, { mode: 'color', color: '#072a59' });
  assert.equal(section.layout, 'one-three-one');

  const nav = section.modules.find((m) => m.type === 'navigation');
  assert.equal(nav.settings.navBold, 'true', 'unrelated nav settings survive');
  assert.deepEqual(
    JSON.parse(nav.settings.navItems).map((item) => item.href),
    ADMIN_MENU_ITEMS.map((item) => item.href)
  );
});

test('the Admin Header keeps logo and menu and drops visitor CTAs', () => {
  const source = publicHeader();
  const section = buildAdminHeaderSection(source, { makeId: idFactory() });

  // Delray's header carries "Book a Court" and "Register"; Marinoff's carried a
  // language switcher and a social row. None of it belongs in the admin area,
  // and a Sign In button shown to someone already signed in is a dead end.
  assert.equal(section.modules.some((m) => m.type === 'button'), false);
  assert.ok(section.modules.some((m) => m.type === 'image'), 'the logo stays');
  assert.ok(section.modules.some((m) => m.type === 'navigation'), 'the menu stays');

  // What was left out is reportable BEFORE the write, not discoverable on the page.
  assert.deepEqual(adminHeaderDroppedTypes(source), ['button']);
});

test('the Admin Header carries no Logout link — the corner button is the way out', () => {
  // Two controls doing one job. BuilderPublicSitePage renders the fixed corner
  // button as "Logout" on every admin page (isAdminAreaPage), so a text link in
  // the header as well was redundant (operator, 2026-08-17).
  const section = buildAdminHeaderSection(publicHeader(), { makeId: idFactory() });
  assert.equal(
    section.modules.some((m) => /admin-logout/.test(String(m.text || ''))),
    false
  );
});

test('module ids are regenerated, so the copy never collides with the original', () => {
  const source = publicHeader();
  const section = buildAdminHeaderSection(source, { makeId: idFactory() });
  const sourceIds = new Set(source.modules.map((m) => m.id));
  for (const module of section.modules) {
    assert.equal(sourceIds.has(module.id), false, `module id ${module.id} was carried over`);
  }
});

test('a header with no navigation module yields no Admin Header rather than a broken one', () => {
  const headerless = { id: 's', title: 'Strip', modules: [{ id: 'm', type: 'text', text: 'hi' }] };
  assert.equal(buildAdminHeaderSection(headerless, { makeId: idFactory() }), null);
  assert.equal(buildAdminHeaderSection(null), null);
});

test('the admin menu never lists a page that does not exist', () => {
  // A tenant without the blog module gets no blog manager. Leaving it in the
  // menu would land them on "Coming soon" inside their own admin area — the
  // exact failure this scaffold exists to remove.
  const menu = adminMenuFor(['admin-dashboard', 'admin-contact-manager', 'admin-settings', 'admin-support']);
  assert.deepEqual(
    menu.map((item) => item.href),
    ['admin-dashboard', 'admin-contact-manager', 'admin-settings', 'admin-support']
  );
  assert.equal(menu.some((item) => item.href === 'admin-blog-manager'), false);

  const header = buildAdminHeaderSection(publicHeader(), { makeId: idFactory(), menuItems: menu });
  const nav = header.modules.find((m) => m.type === 'navigation');
  assert.equal(JSON.parse(nav.settings.navItems).length, 4);
});

/* ── picking the project's chrome ─────────────────────────────────────────── */

test('the menu-bearing frame section is found by content, not by name', () => {
  // Marinoff calls it "Header"; Delray splits chrome into "1 - Contact Strip"
  // and "2 - Menu Banner". Matching on names would work for one and not the
  // other, and would fail silently on the third tenant.
  const frame = [
    { id: 'f1', canonical: true, savedSectionId: 'ss-strip' },
    { id: 'f2', canonical: true, savedSectionId: 'ss-menu' },
    { id: 'f3', canonical: true, savedSectionId: 'ss-footer' },
  ];
  const saved = [
    { id: 'ss-strip', name: '1 - Contact Strip', section: { modules: [{ type: 'text' }] } },
    { id: 'ss-menu', name: '2 - Menu Banner', section: { modules: [{ type: 'navigation' }] } },
    { id: 'ss-footer', name: '3 - Footer', section: { modules: [{ type: 'text' }] } },
  ];
  assert.equal(findMenuFrameSection(frame, saved).savedSectionId, 'ss-menu');
  assert.equal(findMenuFrameSection(frame, []), null);
});

test('the chosen page template is the one the project actually uses', () => {
  const templates = [
    { id: '43', name: 'Newsletter', layoutSections: [{ id: 'a', title: 'body' }] },
    {
      id: '47',
      name: 'Website Main',
      layoutSections: [
        { id: 'h', canonical: true, savedSectionId: 'ss-menu' },
        { id: 'b', title: 'PLACEHOLDER' },
        { id: 'f', canonical: true, savedSectionId: 'ss-footer' },
      ],
    },
  ];
  const pages = [{ pageTemplateId: '47' }, { pageTemplateId: '47' }, { pageTemplateId: '43' }];
  const picked = pickProjectFrame({ pageTemplates: templates, existingPages: pages });
  assert.equal(picked.pageTemplateId, '47');
  assert.equal(picked.frameSections.length, 3);

  // A project whose templates carry no frame reports empty rather than
  // pretending the newsletter template is the site chrome.
  assert.deepEqual(
    pickProjectFrame({ pageTemplates: [templates[0]], existingPages: pages }).frameSections,
    []
  );
});

test('the theme is the one most of the project pages already use', () => {
  const pages = [{ themeId: 'a' }, { themeId: 'b' }, { themeId: 'b' }, { themeId: '' }];
  assert.equal(pickProjectThemeId(pages), 'b');
  assert.equal(pickProjectThemeId([]), '');
});

/* ── planning ─────────────────────────────────────────────────────────────── */

test('a page that already exists is skipped with a reason, never overwritten', () => {
  const { create, skip } = planAdminPages({
    existingPages: [{ slug: 'admin-login' }, { slug: 'home' }],
    enabledModules: { crm: true, blog: true },
  });
  assert.equal(create.some((b) => b.slug === 'admin-login'), false);
  assert.equal(
    skip.find((s) => s.slug === 'admin-login').reason,
    'page already exists'
  );
});

test('re-running after a full scaffold creates nothing', () => {
  const all = ADMIN_PAGE_BLUEPRINTS.map((b) => ({ slug: b.slug }));
  const { create } = planAdminPages({ existingPages: all, enabledModules: { crm: true, blog: true } });
  assert.deepEqual(create, []);
});

test('a project without the blog module gets no blog manager', () => {
  const { create, skip } = planAdminPages({ existingPages: [], enabledModules: { crm: true } });
  assert.equal(create.some((b) => b.slug === 'admin-blog-manager'), false);
  assert.match(
    skip.find((s) => s.slug === 'admin-blog-manager').reason,
    /blog module not enabled/
  );
  assert.equal(create.some((b) => b.slug === 'admin-contact-manager'), true);
});

test('--only narrows the set and says so', () => {
  const { create, skip } = planAdminPages({
    existingPages: [],
    enabledModules: { crm: true, blog: true },
    only: ['admin-login'],
  });
  assert.deepEqual(create.map((b) => b.slug), ['admin-login']);
  assert.equal(skip.find((s) => s.slug === 'admin-settings').reason, 'not requested');
});

/* ── assembling a page ────────────────────────────────────────────────────── */

const frameSections = [
  { id: 'f-menu', title: 'Menu Banner', canonical: true, savedSectionId: 'ss-menu' },
  { id: 'f-body', title: 'PLACEHOLDER SECTION', modules: [] },
  { id: 'f-foot', title: 'Footer', canonical: true, savedSectionId: 'ss-footer' },
];
const savedSections = [
  { id: 'ss-menu', name: 'Menu Banner', section: { id: 's', title: 'Menu Banner', modules: [{ id: 'm', type: 'navigation', settings: {} }] } },
  { id: 'ss-admin', name: ADMIN_HEADER_SECTION_NAME, section: { id: 's2', title: 'Admin Header', modules: [{ id: 'm2', type: 'navigation', settings: {} }] } },
  { id: 'ss-footer', name: 'Footer', section: { id: 's3', title: 'Footer', modules: [{ id: 'm3', type: 'text', text: 'foot' }] } },
];

test('a private page wears the Admin Header; the rest of the chrome is untouched', () => {
  const blueprint = ADMIN_PAGE_BLUEPRINTS.find((b) => b.slug === 'admin-settings');
  const sections = buildAdminPageSections({
    blueprint,
    frameSections,
    savedSections,
    adminHeaderSectionId: 'ss-admin',
    menuFrameSectionId: 'ss-menu',
    makeId: idFactory(),
  });

  const frameIds = sections.filter((s) => s.canonical).map((s) => s.savedSectionId);
  assert.deepEqual(frameIds, ['ss-admin', 'ss-footer']);
  assert.ok(
    sections.some((s) => (s.modules || []).some((m) => m.type === 'admin-site-settings')),
    'the page body must survive the frame being applied'
  );
});

test('the login page keeps the public header — it is seen signed out', () => {
  const blueprint = ADMIN_PAGE_BLUEPRINTS.find((b) => b.slug === 'admin-login');
  const sections = buildAdminPageSections({
    blueprint,
    frameSections,
    savedSections,
    adminHeaderSectionId: 'ss-admin',
    menuFrameSectionId: 'ss-menu',
    makeId: idFactory(),
  });
  assert.deepEqual(
    sections.filter((s) => s.canonical).map((s) => s.savedSectionId),
    ['ss-menu', 'ss-footer']
  );
});

test('the body sits between the header and the footer, not after both', () => {
  const blueprint = ADMIN_PAGE_BLUEPRINTS.find((b) => b.slug === 'admin-dashboard');
  const sections = buildAdminPageSections({
    blueprint,
    frameSections,
    savedSections,
    adminHeaderSectionId: 'ss-admin',
    menuFrameSectionId: 'ss-menu',
    makeId: idFactory(),
  });
  const bodyIndex = sections.findIndex((s) => (s.modules || []).some((m) => m.type === 'admin-team-users'));
  const footerIndex = sections.findIndex((s) => s.savedSectionId === 'ss-footer');
  assert.ok(bodyIndex > 0, 'header comes first');
  assert.ok(bodyIndex < footerIndex, 'footer comes last');
});

test('a project with no frame still gets its page body, not an empty page', () => {
  const blueprint = ADMIN_PAGE_BLUEPRINTS.find((b) => b.slug === 'admin-support');
  const sections = buildAdminPageSections({
    blueprint,
    frameSections: [],
    savedSections: [],
    makeId: idFactory(),
  });
  assert.ok(sections.length >= 1);
  assert.ok(sections.some((s) => (s.modules || []).some((m) => m.type === 'admin-support-form')));
});
